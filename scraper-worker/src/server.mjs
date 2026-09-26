import { createServer } from 'node:http'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'

const port = Number(process.env.PORT || 3000)
const sharedSecret = process.env.SCRAPER_SHARED_SECRET || ''
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')
const screenshotDir = '/var/lib/botlio-scraper/screenshots'
const maxHttpBytes = Number(process.env.MAX_HTTP_BYTES || 1_500_000)
const maxBrowserConcurrency = Math.max(1, Number(process.env.MAX_BROWSER_CONCURRENCY || 1))
const maxBrowserQueue = Math.max(1, Number(process.env.MAX_BROWSER_QUEUE || 12))
const browserQueueTimeoutMs = Math.max(5_000, Number(process.env.BROWSER_QUEUE_TIMEOUT_MS || 30_000))
const browserJobTimeoutMs = Math.max(20_000, Number(process.env.BROWSER_JOB_TIMEOUT_MS || 55_000))
const browserCloseTimeoutMs = Math.max(2_000, Number(process.env.BROWSER_CLOSE_TIMEOUT_MS || 5_000))
const dnsLookupTimeoutMs = Math.max(500, Number(process.env.DNS_LOOKUP_TIMEOUT_MS || 3_000))
// Keep the cache short. It removes repeated lookups during one page render
// without trusting a public hostname's old address for a long time.
const dnsCacheTtlMs = Math.max(5_000, Number(process.env.DNS_CACHE_TTL_MS || 30_000))
let activeBrowsers = 0
const browserWaiters = []
const activeBrowserJobs = new Map()
const dnsCache = new Map()
let completedBrowserJobs = 0
let browserJobTimeouts = 0
let browserJobFailures = 0
let lastBrowserSuccessAt = null
let lastBrowserErrorAt = null
let lastBrowserError = null

if (!sharedSecret) throw new Error('SCRAPER_SHARED_SECRET is required')

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function withTimeout(promise, timeoutMs, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 128_000) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function verifySignature(req, rawBody) {
  const timestamp = String(req.headers['x-botlio-timestamp'] || '')
  const signature = String(req.headers['x-botlio-signature'] || '')
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || Math.abs(Date.now() - seconds * 1000) > 5 * 60_000) return false
  const expected = createHmac('sha256', sharedSecret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex')
  if (signature.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

function privateIpv4(ip) {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224
}

function unsafeIp(ip) {
  const kind = isIP(ip)
  if (kind === 4) return privateIpv4(ip)
  if (kind === 6) {
    const value = ip.toLowerCase()
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:') || value.startsWith('::ffff:127.')
  }
  return true
}

async function assertSafeUrl(raw) {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only http and https URLs are allowed')
  if (url.username || url.password || !url.hostname) throw new Error('unsafe URL')
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('only standard web ports are allowed')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('local hosts are blocked')
  if (isIP(host)) {
    if (unsafeIp(host)) throw new Error('private addresses are blocked')
    return url
  }
  const cached = dnsCache.get(host)
  let records
  if (cached && cached.expiresAt > Date.now()) {
    records = cached.records
  } else {
    records = await withTimeout(
      dns.lookup(host, { all: true, verbatim: true }),
      dnsLookupTimeoutMs,
      `DNS lookup timed out for ${host}`,
    )
    if (dnsCache.size >= 500) {
      const oldest = dnsCache.keys().next().value
      if (oldest) dnsCache.delete(oldest)
    }
    dnsCache.set(host, { records, expiresAt: Date.now() + dnsCacheTtlMs })
  }
  if (!records.length || records.some((record) => unsafeIp(record.address))) throw new Error('host resolves to a blocked address')
  return url
}

async function fetchSafe(rawUrl) {
  let current = await assertSafeUrl(rawUrl)
  for (let redirects = 0; redirects < 5; redirects++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 18_000)
    try {
      const response = await fetch(current, {
        redirect: 'manual', signal: controller.signal,
        headers: { 'user-agent': 'BotlioAuditBot/1.0 (+https://foremp.se)', accept: 'text/html,application/xhtml+xml' },
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = response.headers.get('location')
        if (!target) throw new Error('redirect without a target')
        current = await assertSafeUrl(new URL(target, current).toString())
        continue
      }
      const type = String(response.headers.get('content-type') || '')
      if (!response.ok) throw new Error(`website returned HTTP ${response.status}`)
      if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error('website did not return HTML')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('website returned an empty body')
      const chunks = []
      let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxHttpBytes) throw new Error('website response is too large')
        chunks.push(value)
      }
      return { url: current.toString(), status: response.status, html: new TextDecoder().decode(concat(chunks, size)) }
    } finally { clearTimeout(timer) }
  }
  throw new Error('too many redirects')
}

function concat(chunks, size) {
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}

function decode(value = '') {
  return value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
}
function stripHtml(value = '') { return decode(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--([\s\S]*?)-->/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() }
function attribute(html, name) { return html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`, 'i'))?.slice(1).find(Boolean) || '' }
function unique(items, limit = 200) { return [...new Set(items.filter(Boolean))].slice(0, limit) }

function extractColours(value) {
  return unique([...String(value || '').matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{3,80}\)/g)].map((m) => m[0].toLowerCase()), 32)
}

function analyseHtml(html, baseUrl, status = 200, renderedBranding = null) {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
  const description = decode(attribute(html, 'description') || attribute(html, 'og:description'))
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html
  const text = stripHtml(main).slice(0, 30_000)
  const links = []
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#?][^"']*)["']/gi)) {
    try { const url = new URL(match[1], baseUrl); if (/^https?:$/.test(url.protocol)) links.push(url.toString()) } catch { /* ignore */ }
  }
  const images = []
  for (const match of html.matchAll(/<(?:img|source)\b[^>]*(?:src|srcset)=["']([^"'\s,]+)[^"']*["']/gi)) {
    try { images.push(new URL(match[1], baseUrl).toString()) } catch { /* ignore */ }
  }
  // Include short hex/RGB values and, when a browser was used, computed visible
  // colours. External stylesheets otherwise never appear in page.content().
  const renderedColours = Array.isArray(renderedBranding?.colors) ? renderedBranding.colors : []
  const colors = unique([...renderedColours, ...extractColours(html)], 32)
  const validFont = (value) => typeof value === 'string' && value.length >= 2 && value.length <= 60 && !/^(inherit|initial|unset|var\(|serif$|sans-serif$|system-ui$)/i.test(value) && !/[<>{};]/.test(value)
  const renderedFonts = Array.isArray(renderedBranding?.fonts) ? renderedBranding.fonts : []
  const fonts = unique([...renderedFonts, ...[...html.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map((m) => stripHtml(m[1]).replace(/["']/g, '').split(',')[0].trim())].filter(validFont), 8)
  const markdown = `# ${title || 'Website'}\n\n${description ? `${description}\n\n` : ''}${text}`.trim()
  return { metadata: { title, description, statusCode: status }, markdown, links: unique(links), summary: text.slice(0, 500), branding: { colors, fonts, images: unique(images, 20), palette: renderedBranding?.palette ?? null, colorEvidence: renderedBranding?.colorEvidence ?? [], fontEvidence: renderedBranding?.fontEvidence ?? [], imageEvidence: renderedBranding?.imageEvidence ?? [] } }
}

async function acquireBrowserSlot() {
  if (activeBrowsers < maxBrowserConcurrency) {
    activeBrowsers++
    return
  }
  if (browserWaiters.length >= maxBrowserQueue) {
    throw new Error('browser queue is full; retry shortly')
  }

  await new Promise((resolve, reject) => {
    const waiter = { resolve, timer: null }
    waiter.timer = setTimeout(() => {
      const index = browserWaiters.indexOf(waiter)
      if (index >= 0) browserWaiters.splice(index, 1)
      reject(new Error('browser queue wait timed out; retry shortly'))
    }, browserQueueTimeoutMs)
    browserWaiters.push(waiter)
  })
}

function releaseBrowserSlot() {
  activeBrowsers = Math.max(0, activeBrowsers - 1)
  const next = browserWaiters.shift()
  if (!next) return
  clearTimeout(next.timer)
  activeBrowsers++
  next.resolve()
}

async function withBrowser(fn) {
  await acquireBrowserSlot()
  const jobId = randomUUID()
  const startedAt = Date.now()
  activeBrowserJobs.set(jobId, startedAt)
  let browser
  let job
  let launch
  try {
    launch = chromium.launch({ headless: true })
    // A launch that resolves after our deadline must not leave an orphaned
    // Chromium process behind.
    launch.catch(() => {})
    browser = await withTimeout(
      launch,
      12_000,
      'browser launch timed out',
    )
    job = Promise.resolve().then(() => fn(browser))
    const result = await withTimeout(
      job,
      browserJobTimeoutMs,
      `browser job timed out after ${browserJobTimeoutMs}ms`,
    )
    completedBrowserJobs++
    lastBrowserSuccessAt = new Date().toISOString()
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    browserJobFailures++
    if (/browser (?:job|launch) timed out/i.test(message)) browserJobTimeouts++
    lastBrowserErrorAt = new Date().toISOString()
    lastBrowserError = message.slice(0, 300)
    throw error
  }
  finally {
    // Closing Chromium rejects any still-running page operation. Attach a
    // handler first so a timed-out job cannot later become an unhandled
    // rejection after the HTTP request has already finished.
    job?.catch(() => {})
    let closeTimedOut = false
    if (!browser && launch) {
      launch.then((lateBrowser) => lateBrowser.close().catch(() => {})).catch(() => {})
    }
    if (browser) {
      await withTimeout(
        browser.close().catch(() => {}),
        browserCloseTimeoutMs,
        'browser close timed out',
      ).catch(() => { closeTimedOut = true })
    }
    activeBrowserJobs.delete(jobId)
    releaseBrowserSlot()
    if (closeTimedOut) {
      console.error('Chromium did not close cleanly; restarting scraper worker')
      setTimeout(() => process.exit(1), 25).unref()
    }
  }
}

async function dismissConsentBanner(page) {
  const selectors = [
    '#onetrust-accept-btn-handler',
    '[data-testid="uc-accept-all-button"]',
    '[data-cookiefirst-action="accept"]',
    '.cmplz-accept',
    '.cky-btn-accept',
  ]
  for (const selector of selectors) {
    const target = page.locator(selector).first()
    if (await target.isVisible().catch(() => false)) {
      await target.click({ timeout: 1_000 }).catch(() => {})
      await page.waitForTimeout(250)
      return true
    }
  }

  const consentText = /^(accept( all)?|allow all|agree|ok|got it|godkänn( alla)?|acceptera( alla)?|tillåt alla|jag förstår)$/i
  const buttons = page.locator('button, [role="button"], input[type="button"], input[type="submit"]')
  const count = Math.min(await buttons.count().catch(() => 0), 80)
  for (let index = 0; index < count; index++) {
    const button = buttons.nth(index)
    if (!await button.isVisible().catch(() => false)) continue
    const label = String(await button.innerText().catch(() => '') || await button.getAttribute('value').catch(() => '') || '').trim()
    if (!consentText.test(label)) continue
    await button.click({ timeout: 1_000 }).catch(() => {})
    await page.waitForTimeout(250)
    return true
  }
  return false
}

async function pageReadiness(page) {
  return page.evaluate(() => {
    const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0)
    const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight || 0)
    const visible = (element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0.05
        && rect.width > 8
        && rect.height > 8
        && rect.bottom > 0
        && rect.top < viewportHeight
    }
    const elements = Array.from(document.querySelectorAll('body *')).filter(visible).slice(0, 600)
    const text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim()
    const main = document.querySelector('main, [role="main"], #main, .main') || document.body
    const mainText = String(main?.innerText || '').replace(/\s+/g, ' ').trim()
    const images = Array.from(document.images).filter(visible)
    const loadedImages = images.filter((image) => image.complete && image.naturalWidth > 40 && image.naturalHeight > 40).length
    const loadingText = /^(loading|please wait|laddar|vänta|just a moment)[.!…\s]*$/i.test(mainText)
    const overlay = elements.find((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const area = rect.width * rect.height
      const label = `${element.id} ${element.className} ${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.toLowerCase()
      return (style.position === 'fixed' || style.position === 'sticky')
        && area > viewportWidth * viewportHeight * 0.35
        && /(cookie|consent|privacy|integritet|kakor)/i.test(label)
    })
    return {
      visible_text_characters: text.length,
      main_text_characters: mainText.length,
      visible_elements: elements.length,
      visible_images: images.length,
      loaded_images: loadedImages,
      loading_screen: loadingText,
      consent_overlay: Boolean(overlay),
    }
  })
}

function isReadyForScreenshot(metrics) {
  if (!metrics || metrics.loading_screen || metrics.consent_overlay) return false
  return metrics.main_text_characters >= 100
    || metrics.visible_text_characters >= 180
    || metrics.visible_elements >= 18
    || metrics.loaded_images >= 2
}

async function settlePageForScreenshot(page) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  await page.waitForTimeout(900)
  await dismissConsentBanner(page)
  await page.evaluate(() => {
    window.scrollTo(0, Math.min(document.body?.scrollHeight || 0, Math.round(window.innerHeight * 0.8)))
  }).catch(() => {})
  await page.waitForTimeout(500)
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
  await page.waitForTimeout(350)

  let metrics = await pageReadiness(page)
  if (!isReadyForScreenshot(metrics)) {
    // Hydrated sites and intro animations frequently need more than the old
    // fixed 900 ms delay. One bounded retry is cheaper than a false audit.
    await page.waitForTimeout(3_500)
    await dismissConsentBanner(page)
    await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => {})
    metrics = await pageReadiness(page)
  }
  return { ...metrics, reliable: isReadyForScreenshot(metrics) }
}

async function browserScrape(rawUrl, screenshot) {
  const safe = await assertSafeUrl(rawUrl)
  return withBrowser(async (browser) => {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      locale: 'sv-SE',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    })
    await page.route('**/*', async (route) => {
      const requestUrl = route.request().url()
      const resourceType = route.request().resourceType()
      if (resourceType === 'media' || resourceType === 'websocket' || resourceType === 'eventsource') {
        return route.abort()
      }
      try {
        await assertSafeUrl(requestUrl)
        await route.continue()
      } catch {
        await route.abort().catch(() => {})
      }
    })
    await page.goto(safe.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const screenshotQuality = await settlePageForScreenshot(page)
    const html = await page.content()
    const finalUrl = page.url()
    const renderedBranding = await page.evaluate(() => {
      const ignored = (element) => Boolean(element.closest('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[class*="chat" i],[id*="chat" i]'))
      const visible = (element) => { const s = getComputedStyle(element); const r = element.getBoundingClientRect(); return !ignored(element) && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > .05 && r.width > 8 && r.height > 8 }
      const evidence = new Map()
      const add = (value, role, element) => {
        if (typeof value !== 'string' || !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return
        const rect = element?.getBoundingClientRect?.() || { width: 0, height: 0 }
        const key = `${value}|${role}`; const old = evidence.get(key) || { value, role, count: 0, area: 0 }
        old.count++; old.area += Math.min(rect.width * rect.height, innerWidth * innerHeight); evidence.set(key, old)
      }
      const body = document.body; const header = document.querySelector('header'); const cta = document.querySelector('button,[class*="btn" i],a[class*="button" i]'); const link = document.querySelector('main a')
      for (const [element, role] of [[body, 'background'], [body, 'text'], [header, 'header'], [cta, 'primary'], [link, 'accent']]) if (element && visible(element)) { const s = getComputedStyle(element); add(role === 'text' ? s.color : s.backgroundColor, role, element); if (role === 'primary' || role === 'accent') add(s.color, `${role}Text`, element) }
      for (const element of Array.from(document.querySelectorAll('main section, main article, footer, h1, h2, button, [class*="hero" i]')).filter(visible).slice(0, 120)) { const s = getComputedStyle(element); add(s.color, 'text', element); add(s.backgroundColor, 'surface', element) }
      const ranked = [...evidence.values()].sort((a, b) => (b.count * 1000 + b.area) - (a.count * 1000 + a.area))
      const role = (name) => ranked.find((item) => item.role === name)?.value || null
      const fontMap = new Map()
      for (const element of Array.from(document.querySelectorAll('body,h1,h2,h3,p,a,button')).filter(visible).slice(0, 160)) { const family = getComputedStyle(element).fontFamily.split(',')[0].replace(/["']/g, '').trim(); if (family && !/^(inherit|initial|unset|serif|sans-serif|system-ui)$/i.test(family)) fontMap.set(family, (fontMap.get(family) || 0) + 1) }
      const imageEvidence = Array.from(document.images).filter((img) => visible(img) && img.naturalWidth >= 240 && img.naturalHeight >= 160 && !/(logo|icon|avatar|pixel|tracking|facebook|instagram)/i.test(`${img.src} ${img.alt} ${img.className}`)).map((img) => ({ url: img.currentSrc || img.src, alt: img.alt || '', width: img.naturalWidth, height: img.naturalHeight, role: img.closest('[class*="hero" i]') ? 'hero' : img.closest('main') ? 'content' : 'other', score: Math.round(Math.min(img.naturalWidth * img.naturalHeight / 10000, 100)) })).sort((a, b) => b.score - a.score).slice(0, 20)
      return { colors: [...new Set(ranked.map((item) => item.value))].slice(0, 32), colorEvidence: ranked.slice(0, 40), palette: { primary: role('primary'), accent: role('accent'), background: role('background'), surface: role('surface'), text: role('text'), confidence: ranked.length >= 4 ? .86 : .55 }, fonts: [...fontMap.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 6), fontEvidence: [...fontMap.entries()].map(([family, count]) => ({ family, count })).sort((a, b) => b.count - a.count), imageEvidence }
    })
    const data = analyseHtml(html, finalUrl, 200, renderedBranding)
    let screenshotUrl = null
    if (screenshot) {
      if (!publicBaseUrl) throw new Error('PUBLIC_BASE_URL is required for screenshots')
      await mkdir(screenshotDir, { recursive: true })
      const id = randomUUID().replace(/-/g, '')
      await page.screenshot({ path: join(screenshotDir, `${id}.png`), fullPage: false, type: 'png', animations: 'disabled' })
      screenshotUrl = `${publicBaseUrl}/v1/screenshots/${id}.png`
    }
    return {
      ...data,
      screenshot: screenshotUrl,
      screenshot_quality: screenshotQuality,
      rendered: true,
      source_url_used: finalUrl,
    }
  })
}

async function scrape(body) {
  const url = await assertSafeUrl(body?.url)
  const wantScreenshot = Boolean(body?.screenshot)
  let fast
  try {
    const raw = await fetchSafe(url.toString())
    fast = { ...analyseHtml(raw.html, raw.url, raw.status), screenshot: null, rendered: false, source_url_used: raw.url }
  } catch (error) {
    if (!wantScreenshot) throw error
  }
  if (wantScreenshot || !fast || fast.markdown.length < 300) return browserScrape(url.toString(), wantScreenshot)
  return fast
}

async function cleanupOldScreenshots() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  try {
    const files = await readdir(screenshotDir)
    await Promise.all(files.filter((name) => /^[a-f0-9]{32}\.png$/.test(name)).map(async (name) => {
      const file = join(screenshotDir, name)
      if ((await stat(file)).mtimeMs < cutoff) await unlink(file)
    }))
  } catch (error) { console.error('screenshot cleanup failed', error) }
}

await mkdir(screenshotDir, { recursive: true })
setInterval(cleanupOldScreenshots, 6 * 60 * 60 * 1000).unref()
void cleanupOldScreenshots()
createServer(async (req, res) => {
  try {
    const path = new URL(req.url || '/', 'http://localhost').pathname
    if (req.method === 'GET' && path === '/health') {
      const now = Date.now()
      const oldestBrowserJobMs = activeBrowserJobs.size
        ? Math.max(...[...activeBrowserJobs.values()].map((startedAt) => now - startedAt))
        : 0
      const stuck = oldestBrowserJobMs > browserJobTimeoutMs + browserCloseTimeoutMs
      return json(res, stuck ? 503 : 200, {
        ok: !stuck,
        service: 'botlio-scraper',
        browser_slots: maxBrowserConcurrency,
        browser_active: activeBrowsers,
        browser_active_jobs: activeBrowserJobs.size,
        browser_oldest_job_ms: oldestBrowserJobMs,
        browser_job_timeout_ms: browserJobTimeoutMs,
        browser_queue_depth: browserWaiters.length,
        browser_queue_limit: maxBrowserQueue,
        browser_queue_timeout_ms: browserQueueTimeoutMs,
        browser_jobs_completed: completedBrowserJobs,
        browser_job_failures: browserJobFailures,
        browser_job_timeouts: browserJobTimeouts,
        last_browser_success_at: lastBrowserSuccessAt,
        last_browser_error_at: lastBrowserErrorAt,
        last_browser_error: lastBrowserError,
      })
    }
    const shot = path.match(/^\/v1\/screenshots\/([a-f0-9]{32})\.png$/)
    if (req.method === 'GET' && shot) {
      const image = await readFile(join(screenshotDir, `${shot[1]}.png`))
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800, immutable', 'x-content-type-options': 'nosniff' })
      return res.end(image)
    }
    if (req.method !== 'POST' || path !== '/v1/scrape') return json(res, 404, { error: 'not found' })
    const raw = await readBody(req)
    if (!verifySignature(req, raw)) return json(res, 401, { error: 'invalid request signature' })
    const data = await scrape(JSON.parse(raw.toString('utf8')))
    return json(res, 200, { ok: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /unsafe|blocked|only http|standard web ports|too large/.test(message)
      ? 400
      : /browser (?:capacity|queue)|busy/i.test(message)
        ? 429
        : /browser (?:job|launch) timed out/i.test(message)
          ? 504
        : 502
    return json(res, status, { ok: false, error: message })
  }
}).listen(port, '0.0.0.0', () => console.log(`Botlio scraper listening on ${port}`))

// A normal timeout should close Chromium and release its slot. This watchdog
// is the final safety net for native browser hangs where even browser.close()
// cannot make progress. Docker's restart policy then starts a clean worker.
setInterval(() => {
  const now = Date.now()
  const stuck = [...activeBrowserJobs.values()].some(
    (startedAt) => now - startedAt > browserJobTimeoutMs + browserCloseTimeoutMs + 10_000,
  )
  if (!stuck) return
  console.error('Browser watchdog detected a stuck job; restarting scraper worker')
  process.exit(1)
}, 5_000).unref()
