// Freeform site engine (generation_mode = 'freeform').
//
// Instead of filling a fixed niche template, the AI designs and writes the whole
// site from the raw Firecrawl material. Work is split into small steps and one
// step runs per worker invocation, so a 6-page site never hits the edge function
// wall clock. Progress lives in generated_sites.gen_progress:
//
//   { stage: 'plan' | 'pages' | 'polish' | 'done', plan, built: [slug], polished: [slug] }
//
// The template engine in index.ts is untouched — flipping generation_mode back
// to 'template' restores the old behaviour exactly.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export const BUILD_MODEL = 'deepseek/deepseek-v4-flash-0731'
// Language pass. OpenRouter has no "gpt-4.2-mini" — 4.1-mini is the current
// mini model there and is what the template engine already uses.
export const LANG_MODEL = 'openai/gpt-4.1-mini'

const MAX_PAGES = 6
const REQUIRED_PAGES = ['index', 'om-oss', 'kontakt']

export interface FreeformFacts {
  business_name: string | null
  phone: string | null
  address: string | null
  city: string | null
  email: string | null
  source_url: string | null
  google_maps_url: string | null
  niche: string
}

export interface FreeformCtx {
  supabase: any
  siteId: string
  openrouterKey: string
  scraped: any
  facts: FreeformFacts
  nicheLabel: string
  category?: string | null
  brandPalette: Record<string, string>
  brandFonts: string[]
  imagePool: string[]
  regenFeedback: string | null
  progress: FreeformProgress | null
}

export interface FreeformPageSpec {
  slug: string
  title: string
  purpose: string
  sections: string[]
}

export interface FreeformProgress {
  stage: 'plan' | 'pages' | 'polish' | 'done'
  plan?: {
    designDirective?: string
    pages: FreeformPageSpec[]
  }
  built?: string[]
  polished?: string[]
}

export interface FreeformStepResult {
  /** true when the whole site is finished and status can flip to 'generated' */
  done: boolean
  progress: FreeformProgress
  files: Record<string, string>
  note: string
}

// ---------------------------------------------------------------------------
// Public entry point: runs exactly ONE step and returns updated state.
// ---------------------------------------------------------------------------
export async function runFreeformStep(ctx: FreeformCtx, existingFiles: Record<string, string>): Promise<FreeformStepResult> {
  const progress: FreeformProgress = ctx.progress ?? { stage: 'plan', built: [], polished: [] }
  const files: Record<string, string> = { ...existingFiles }

  if (progress.stage === 'plan' || !progress.plan) {
    const plan = await buildBlueprint(ctx)
    return {
      done: false,
      files,
      progress: { stage: 'pages', plan, built: [], polished: [] },
      note: `blueprint: ${plan.pages.map((p) => p.slug).join(', ')}`,
    }
  }

  const plan = progress.plan
  const built = progress.built ?? []

  if (progress.stage === 'pages') {
    const next = plan.pages.find((p) => !built.includes(p.slug))
    if (next) {
      const isFirst = built.length === 0
      const out = await buildPage(ctx, plan, next, isFirst, files['style.css'] ?? null)
      files[fileNameFor(next.slug)] = out.html
      if (out.css) files['style.css'] = out.css
      const nowBuilt = [...built, next.slug]
      const allDone = nowBuilt.length >= plan.pages.length
      return {
        done: false,
        files,
        progress: { ...progress, built: nowBuilt, stage: allDone ? 'polish' : 'pages' },
        note: `built ${next.slug} (${nowBuilt.length}/${plan.pages.length})`,
      }
    }
    progress.stage = 'polish'
  }

  // --- language pass, one page per invocation ---
  const polished = progress.polished ?? []
  const nextPolish = plan.pages.find((p) => !polished.includes(p.slug))
  if (nextPolish) {
    const fname = fileNameFor(nextPolish.slug)
    const html = files[fname]
    if (html) {
      try {
        files[fname] = await polishPageLanguage(ctx, html)
      } catch (e) {
        console.warn('language pass failed, keeping original:', (e as Error).message)
      }
    }
    const nowPolished = [...polished, nextPolish.slug]
    const finished = nowPolished.length >= plan.pages.length
    return {
      done: finished,
      files: finished ? finalize(files, plan) : files,
      progress: { ...progress, polished: nowPolished, stage: finished ? 'done' : 'polish' },
      note: `language pass ${nowPolished.length}/${plan.pages.length}`,
    }
  }

  return { done: true, files: finalize(files, plan), progress: { ...progress, stage: 'done' }, note: 'done' }
}

// ---------------------------------------------------------------------------
// Step 1 — blueprint
// ---------------------------------------------------------------------------
async function buildBlueprint(ctx: FreeformCtx): Promise<NonNullable<FreeformProgress['plan']>> {
  const system = `Du är en svensk senior webbdesigner och art director. Du planerar moderna, säljande företagssajter för små svenska företag.

REGLER:
- Svara ENDAST med JSON.
- Sajten ska ALLTID ha minst sidorna "index" (startsida), "om-oss" och "kontakt".
- Lägg till fler sidor (t.ex. "tjanster", "priser", "projekt", "vanliga-fragor", "galleri") ENDAST om källdatan faktiskt räcker till innehåll på dem. Max ${MAX_PAGES} sidor totalt.
- Hitta aldrig på priser, årtal, certifikat, kundnamn eller referenser.
- Inga kontaktformulär får planeras. Kontakt sker via telefon och e-post.

SCHEMA:
{
  "designDirective": "2-4 meningar om visuell riktning: typografi, layoutkaraktär, rytm, bildanvändning",
  "pages": [
    { "slug": "index", "title": "Sidtitel", "purpose": "vad sidan ska göra", "sections": ["hero", "..."] }
  ]
}`

  const user = buildSourceBlock(ctx, 'Planera sajten. Bestäm själv antal sidor utifrån hur mycket underlag som finns.')
  const raw = await callModel(ctx.openrouterKey, BUILD_MODEL, system, user, 2500, 60_000, true)
  const parsed = JSON.parse(stripFence(raw))

  let pages: FreeformPageSpec[] = Array.isArray(parsed?.pages) ? parsed.pages : []
  pages = pages
    .map((p: any) => ({
      slug: slugify(String(p?.slug ?? '')),
      title: String(p?.title ?? '').trim() || 'Sida',
      purpose: String(p?.purpose ?? '').trim(),
      sections: Array.isArray(p?.sections) ? p.sections.map((s: any) => String(s)).slice(0, 10) : [],
    }))
    .filter((p) => !!p.slug)

  // Guarantee the required pages and de-duplicate
  for (const req of REQUIRED_PAGES) {
    if (!pages.some((p) => p.slug === req)) {
      pages.push({
        slug: req,
        title: req === 'index' ? 'Start' : req === 'om-oss' ? 'Om oss' : 'Kontakt',
        purpose: '',
        sections: [],
      })
    }
  }
  const seen = new Set<string>()
  pages = pages.filter((p) => (seen.has(p.slug) ? false : (seen.add(p.slug), true))).slice(0, MAX_PAGES)
  // index first
  pages.sort((a, b) => (a.slug === 'index' ? -1 : b.slug === 'index' ? 1 : 0))

  return { designDirective: String(parsed?.designDirective ?? '').trim(), pages }
}

// ---------------------------------------------------------------------------
// Step 2 — one page at a time
// ---------------------------------------------------------------------------
async function buildPage(
  ctx: FreeformCtx,
  plan: NonNullable<FreeformProgress['plan']>,
  page: FreeformPageSpec,
  isFirst: boolean,
  existingCss: string | null,
): Promise<{ html: string; css: string | null }> {
  const nav = plan.pages.map((p) => `${p.title} → ${fileNameFor(p.slug)}`).join('\n')
  const palette = Object.entries(ctx.brandPalette).map(([k, v]) => `  --${kebab(k)}: ${v};`).join('\n')

  const system = `Du är en svensk senior frontend-utvecklare och designer. Du skriver komplett, produktionsklar HTML för moderna företagssajter.

HÅRDA REGLER:
- Svara ENDAST med JSON: ${isFirst ? '{"html": "...", "css": "..."}' : '{"html": "..."}'}
- HTML ska vara ett komplett dokument (<!DOCTYPE html> ... </html>), på svenska, med lang="sv", meta description och <link rel="stylesheet" href="style.css">.
- ALDRIG kontaktformulär. Inga <form>, <input>, <textarea> eller submit-knappar. Kontakt sker via <a href="tel:..."> och <a href="mailto:...">.
- Ingen extern JavaScript, inga trackers, inga iframes (Google Maps-inbäddning är enda undantaget).
- Använd ENDAST bild-URL:er ur den givna bildpoolen. Alla bilder ska ha alt-text.
- Interna länkar får bara peka på filerna i navigationen nedan.
- Hitta aldrig på priser, årtal, certifikat, kundnamn eller referensprojekt.
- Responsivt, modernt, generös whitespace, tydlig hierarki, mobilanpassad meny utan JS (details/summary eller CSS-only).
${isFirst ? `- Du skriver även hela style.css: ett komplett designsystem baserat på CSS-variablerna nedan. Den återanvänds av ALLA sidor, så täck header, footer, hero, kort, sektioner, knappar, typografi och responsivitet.` : '- style.css finns redan. Återanvänd dess klasser, skriv ingen ny CSS.'}`

  const cssContext = isFirst
    ? `FÄRGVARIABLER som style.css MÅSTE definiera i :root (företagets egna färger):\n:root {\n${palette}\n}\nTypsnitt från deras nuvarande sajt: ${ctx.brandFonts.join(', ') || 'inga — välj moderna webbsäkra typsnitt'}`
    : `BEFINTLIG style.css (använd dess klasser):\n${(existingCss ?? '').slice(0, 6000)}`

  const user = [
    buildSourceBlock(ctx, `Bygg sidan "${page.title}" (${fileNameFor(page.slug)}).`),
    '',
    `SIDANS SYFTE: ${page.purpose || page.title}`,
    page.sections.length ? `SEKTIONER: ${page.sections.join(', ')}` : '',
    '',
    `DESIGNRIKTNING (gäller hela sajten): ${plan.designDirective || 'modern, luftig, förtroendeingivande'}`,
    '',
    `NAVIGATION (exakt dessa länkar):\n${nav}`,
    '',
    cssContext,
    '',
    `BILDPOOL (endast dessa URL:er):\n${ctx.imagePool.join('\n') || '[inga bilder — bygg utan foton, använd färg och typografi]'}`,
  ].filter(Boolean).join('\n')

  // One page (plus style.css on the first one) is the biggest single output in
  // the pipeline — give it room; only one page runs per worker invocation.
  const raw = await callModel(ctx.openrouterKey, BUILD_MODEL, system, user, 12000, 170_000, true)
  const parsed = JSON.parse(stripFence(raw))
  const html = sanitizeHtml(String(parsed?.html ?? ''), ctx, plan)
  if (html.length < 800) throw new Error(`page ${page.slug} came back too short (${html.length} chars)`)
  const css = isFirst ? sanitizeCss(String(parsed?.css ?? '')) : null
  return { html, css }
}

// ---------------------------------------------------------------------------
// Step 3 — language pass (text only, structure untouched)
// ---------------------------------------------------------------------------
async function polishPageLanguage(ctx: FreeformCtx, html: string): Promise<string> {
  const texts = extractTexts(html)
  if (!texts.length) return html

  const system = `Du är svensk copywriter. Du får en numrerad lista med textsnuttar från en företagssajt.
Skriv om varje snutt till naturlig, säljande, korrekt svenska. Behåll ungefär samma längd.
Hitta ALDRIG på priser, årtal, certifikat, kundnamn eller referenser. Ändra inte telefonnummer, e-post, adresser eller egennamn.
Svara ENDAST med JSON: {"texts": {"0": "...", "1": "..."}} med samma index.`

  const user = `FAKTA:\n${JSON.stringify(ctx.facts, null, 2)}\n\nTEXTER:\n${JSON.stringify(
    Object.fromEntries(texts.map((t, i) => [i, t])), null, 2)}`

  const raw = await callModel(ctx.openrouterKey, LANG_MODEL, system, user, 4000, 45_000, true)
  const parsed = JSON.parse(stripFence(raw))
  const map = parsed?.texts ?? parsed
  if (!map || typeof map !== 'object') return html
  return replaceTexts(html, texts, (i) => {
    const v = map[String(i)]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  })
}

// ---------------------------------------------------------------------------
// Shared source-data block
// ---------------------------------------------------------------------------
function buildSourceBlock(ctx: FreeformCtx, intro: string): string {
  const s = ctx.scraped ?? {}
  const pages = s.pages ?? {}
  return [
    intro,
    '',
    ctx.regenFeedback ? `--- ANVÄNDARENS FEEDBACK (HÖGSTA PRIORITET) ---\n${ctx.regenFeedback}\n` : '',
    `BRANSCHTAGG (kontext, inte mall): ${ctx.nicheLabel}${ctx.category ? ` / ${ctx.category}` : ''}`,
    '',
    'FAKTA (endast detta får användas som hårda uppgifter):',
    JSON.stringify(ctx.facts, null, 2),
    '',
    '--- RÅDATA FRÅN DERAS NUVARANDE SAJT ---',
    `Titel: ${pages.home?.title || s.title || ''}`,
    `Beskrivning: ${pages.home?.description || s.description || ''}`,
    `Sammanfattning: ${pages.home?.summary || s.summary || ''}`,
    '',
    `HEM (markdown):\n${(pages.home?.markdown || '').slice(0, 6000)}`,
    pages.about ? `\nOM OSS (markdown):\n${pages.about.markdown.slice(0, 3000)}` : '',
    pages.services ? `\nTJÄNSTER (markdown):\n${pages.services.markdown.slice(0, 4000)}` : '',
  ].filter(Boolean).join('\n')
}

// ---------------------------------------------------------------------------
// Sanitizers / guards
// ---------------------------------------------------------------------------
export function sanitizeHtml(input: string, ctx: FreeformCtx, plan: NonNullable<FreeformProgress['plan']>): string {
  let html = stripFence(input).trim()

  // Kill forms and their controls — replace with tel/mailto CTAs.
  const cta = buildCtaHtml(ctx.facts)
  html = html.replace(/<form[\s\S]*?<\/form>/gi, cta)
  html = html.replace(/<(input|textarea|select|option|label|fieldset|legend)\b[^>]*>/gi, '')
  html = html.replace(/<\/(textarea|select|option|label|fieldset|legend)>/gi, '')
  html = html.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, '')

  // No scripts / trackers.
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  html = html.replace(/<script\b[^>]*\/?>/gi, '')
  html = html.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
  html = html.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')

  // Only allow Google Maps iframes.
  html = html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (m) =>
    /google\.[a-z.]+\/maps|maps\.google/i.test(m) ? m : '')

  // Internal links must point at pages we actually generated.
  const allowed = new Set(plan.pages.map((p) => fileNameFor(p.slug)))
  html = html.replace(/href\s*=\s*"([^"]+)"/gi, (m, href: string) => {
    const h = String(href)
    if (/^(https?:|tel:|mailto:|#|\/\/)/i.test(h)) return m
    const clean = h.split(/[?#]/)[0].replace(/^\.?\//, '')
    if (clean === '' || clean === 'style.css') return m
    return allowed.has(clean) ? `href="${clean}"` : 'href="index.html"'
  })

  // Images: only from the approved pool.
  const pool = new Set(ctx.imagePool)
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/src\s*=\s*"([^"]+)"/i)?.[1]
    if (src && (pool.has(src) || src.startsWith('data:'))) return tag
    const fallback = ctx.imagePool[0]
    if (!fallback) return ''
    return src ? tag.replace(src, fallback) : tag
  })

  return html
}

function sanitizeCss(css: string): string {
  return stripFence(css)
    .replace(/@import[^;]+;/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .trim()
}

function buildCtaHtml(facts: FreeformFacts): string {
  const parts: string[] = []
  if (facts.phone) parts.push(`<a class="btn btn-primary" href="tel:${facts.phone.replace(/\s/g, '')}">Ring ${facts.phone}</a>`)
  if (facts.email) parts.push(`<a class="btn btn-secondary" href="mailto:${facts.email}">Mejla oss</a>`)
  return parts.length ? `<div class="cta-actions">${parts.join('')}</div>` : ''
}

/** Last guard before the site is marked generated. */
function finalize(files: Record<string, string>, plan: NonNullable<FreeformProgress['plan']>): Record<string, string> {
  const out = { ...files }
  if (!out['index.html']) {
    const firstHtml = Object.keys(out).find((f) => f.endsWith('.html'))
    if (firstHtml) out['index.html'] = out[firstHtml]
  }
  if (!out['style.css']) out['style.css'] = ':root{--primary:#111}body{font-family:system-ui,sans-serif;margin:0}'
  for (const p of plan.pages) {
    const f = fileNameFor(p.slug)
    if (!out[f]) delete out[f]
  }
  return out
}

// ---------------------------------------------------------------------------
// Text extraction for the language pass
// ---------------------------------------------------------------------------
const TEXT_TAGS = 'h1|h2|h3|h4|p|li|span|strong|em|blockquote|figcaption|small'
const textRe = new RegExp(`<(${TEXT_TAGS})(\\s[^>]*)?>([^<]{12,600})</\\1>`, 'gi')

function extractTexts(html: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(textRe.source, 'gi')
  while ((m = re.exec(html)) !== null) {
    const t = m[3].trim()
    if (t && !/^[\d\s+()-]+$/.test(t) && !/@/.test(t)) out.push(t)
    if (out.length >= 60) break
  }
  return out
}

function replaceTexts(html: string, texts: string[], pick: (i: number) => string | null): string {
  let i = 0
  const re = new RegExp(textRe.source, 'gi')
  return html.replace(re, (full, tag, attrs, inner) => {
    const t = String(inner).trim()
    if (!t || /^[\d\s+()-]+$/.test(t) || /@/.test(t)) return full
    const idx = texts.indexOf(t, 0)
    const replacement = idx >= 0 ? pick(idx) : pick(i)
    i++
    if (!replacement) return full
    return `<${tag}${attrs ?? ''}>${escapeText(replacement)}</${tag}>`
  })
}

function escapeText(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
export function fileNameFor(slug: string): string {
  return slug === 'index' ? 'index.html' : `${slug}.html`
}

function slugify(s: string): string {
  const base = s.trim().toLowerCase()
    .replace(/\.html?$/, '')
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base === '' || base === 'home' || base === 'start' ? 'index' : base
}

function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function stripFence(s: string): string {
  return s.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim()
}

async function callModel(
  key: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  timeoutMs: number,
  jsonMode: boolean,
): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://emailsbotlio.lovable.app',
        'X-Title': 'Botlio Freeform Site Builder',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
        max_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    if (!resp.ok) throw new Error(`${model} ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
    const data = await resp.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error(`${model} returned empty content`)
    return String(content)
  } finally {
    clearTimeout(timeoutId)
  }
}
