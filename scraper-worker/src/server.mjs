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
let activeBrowsers = 0

if (!sharedSecret) throw new Error('SCRAPER_SHARED_SECRET is required')

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
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
  const records = await dns.lookup(host, { all: true, verbatim: true })
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

function analyseHtml(html, baseUrl, status = 200, renderedColours = []) {
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
  const colors = unique([...extractColours(html), ...renderedColours.map((c) => String(c).toLowerCase())], 32)
  const fonts = unique([...html.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map((m) => stripHtml(m[1]).replace(/["']/g, '').split(',')[0].trim()), 8)
  const markdown = `# ${title || 'Website'}\n\n${description ? `${description}\n\n` : ''}${text}`.trim()
  return { metadata: { title, description, statusCode: status }, markdown, links: unique(links), summary: text.slice(0, 500), branding: { colors, fonts, images: unique(images, 20) } }
}

async function withBrowser(fn) {
  if (activeBrowsers >= maxBrowserConcurrency) throw new Error('browser capacity is busy; retry shortly')
  activeBrowsers++
  let browser
  try { browser = await chromium.launch({ headless: true }); return await fn(browser) }
  finally { activeBrowsers--; await browser?.close().catch(() => {}) }
}

async function browserScrape(rawUrl, screenshot) {
  const safe = await assertSafeUrl(rawUrl)
  return withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, userAgent: 'BotlioAuditBot/1.0 (+https://foremp.se)' })
    await page.route('**/*', async (route) => {
      const requestUrl = route.request().url()
      try { await assertSafeUrl(requestUrl); await route.continue() } catch { await route.abort() }
    })
    await page.goto(safe.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(900)
    const html = await page.content()
    const finalUrl = page.url()
    const renderedColours = await page.evaluate(() => {
      const values = []
      const add = (value) => { if (typeof value === 'string' && value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)') values.push(value) }
      const root = getComputedStyle(document.documentElement)
      for (const name of Array.from(document.documentElement.style)) {
        if (name.startsWith('--') && /(color|primary|secondary|accent|brand|background|surface|text|link|button)/i.test(name)) add(root.getPropertyValue(name).trim())
      }
      for (const element of Array.from(document.querySelectorAll('body, header, main, footer, a, button, [class*="btn" i], [class*="hero" i]')).slice(0, 160)) {
        const style = getComputedStyle(element)
        add(style.color); add(style.backgroundColor); add(style.borderTopColor)
      }
      return [...new Set(values)].slice(0, 80)
    })
    const data = analyseHtml(html, finalUrl, 200, renderedColours)
    let screenshotUrl = null
    if (screenshot) {
      if (!publicBaseUrl) throw new Error('PUBLIC_BASE_URL is required for screenshots')
      await mkdir(screenshotDir, { recursive: true })
      const id = randomUUID().replace(/-/g, '')
      await page.screenshot({ path: join(screenshotDir, `${id}.png`), fullPage: false, type: 'png' })
      screenshotUrl = `${publicBaseUrl}/v1/screenshots/${id}.png`
    }
    return { ...data, screenshot: screenshotUrl, rendered: true, source_url_used: finalUrl }
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
    if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true, service: 'botlio-scraper', browser_slots: maxBrowserConcurrency, browser_active: activeBrowsers })
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
    const status = /unsafe|blocked|only http|standard web ports|too large/.test(message) ? 400 : /busy/.test(message) ? 429 : 502
    return json(res, status, { ok: false, error: message })
  }
}).listen(port, '0.0.0.0', () => console.log(`Botlio scraper listening on ${port}`))
