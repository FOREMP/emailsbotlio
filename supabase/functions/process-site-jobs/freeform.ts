// Freeform site engine (generation_mode = 'freeform').
//
// Instead of filling a fixed niche template, the AI designs and writes the whole
// site from the raw Firecrawl material. Work is split into small steps and one
// step runs per worker invocation, so a multi-page site can finish without one
// giant long-running Edge Function call.
//
// Progress lives in generated_sites.gen_progress:
//   {
//     version: 2,
//     stage: 'plan' | 'design' | 'pages' | 'polish' | 'done',
//     plan,
//     design,
//     built: [slug],
//     polished: [slug]
//   }
//
// The template engine in index.ts is untouched — flipping generation_mode back
// to 'template' restores the old behaviour exactly.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export const BUILD_MODEL = 'deepseek/deepseek-v4-flash-0731'
export const LANG_MODEL = 'openai/gpt-4.1-mini'

const MAX_PAGES = 6
const REQUIRED_PAGES = ['index', 'om-oss', 'kontakt']
const PROGRESS_VERSION = 2

const BLUEPRINT_MAX_TOKENS = 3200
const DESIGN_MAX_TOKENS = 7000
const INDEX_PAGE_MAX_TOKENS = 25000
const INNER_PAGE_MAX_TOKENS = 18000
const BLUEPRINT_TIMEOUT_MS = 70_000
const DESIGN_TIMEOUT_MS = 90_000
const INDEX_PAGE_TIMEOUT_MS = 120_000
const INNER_PAGE_TIMEOUT_MS = 95_000
const POLISH_TIMEOUT_MS = 45_000

const COMPONENT_GUIDE = `
KOMPONENTKONTRAKT — HTML måste följa detta:

1. Sidhuvud och meny
<header class="site-header">
  <div class="wrap nav-shell">
    <a class="brand" href="index.html">Företagsnamn</a>
    <nav class="nav-desktop" aria-label="Huvudmeny">...</nav>
    <details class="nav-mobile">
      <summary>Meny</summary>
      <nav class="nav-drawer" aria-label="Mobilmeny">...</nav>
    </details>
  </div>
</header>

2. Hero / toppsektion
<section class="hero">...</section>
eller
<section class="page-hero">...</section>

3. Layoutblock
- .wrap
- .section
- .section.section-alt
- .grid
- .split
- .stack
- .card
- .media-card
- .tag-row
- .cta-band
- .contact-grid
- .contact-list
- .gallery-grid
- .faq-list

4. Typografi och CTA
- .eyebrow
- .lead
- .btn-row
- .btn
- .btn.btn-primary
- .btn.btn-secondary

5. Fot
<footer class="site-footer">...</footer>

REGLER:
- Mobilmenyn ska bygga på details/summary ovan. Ingen JavaScript.
- Samma komponenter ska återanvändas på alla sidor.
- Använd högst några få nya klassnamn utöver kontraktet ovan.
- Ingen inline-CSS och inga <style>-taggar i HTML.
`.trim()

type FreeformStage = 'plan' | 'design' | 'pages' | 'polish' | 'done'

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

export interface FreeformPlan {
  designDirective?: string
  pages: FreeformPageSpec[]
}

export interface FreeformDesign {
  designNote?: string
}

export interface FreeformProgress {
  version?: number
  stage: FreeformStage
  plan?: FreeformPlan
  design?: FreeformDesign
  built?: string[]
  polished?: string[]
}

export interface FreeformStepResult {
  done: boolean
  progress: FreeformProgress
  files: Record<string, string>
  note: string
}

interface DesignStepResult {
  css: string
  designNote: string
}

// ---------------------------------------------------------------------------
// Public entry point: runs exactly ONE step and returns updated state.
// ---------------------------------------------------------------------------
export async function runFreeformStep(
  ctx: FreeformCtx,
  existingFiles: Record<string, string>,
): Promise<FreeformStepResult> {
  const files: Record<string, string> = { ...existingFiles }
  const progress = normalizeProgress(ctx.progress, files)

  if (progress.stage === 'plan' || !progress.plan) {
    const plan = await buildBlueprint(ctx)
    return {
      done: false,
      files,
      progress: {
        version: PROGRESS_VERSION,
        stage: 'design',
        plan,
        design: progress.design,
        built: [],
        polished: [],
      },
      note: `blueprint ready: ${plan.pages.map((p) => p.slug).join(', ')}`,
    }
  }

  const plan = progress.plan

  if (progress.stage === 'design' || !hasUsableCss(files)) {
    const design = await buildDesignSystem(ctx, plan)
    files['style.css'] = design.css
    return {
      done: false,
      files,
      progress: {
        ...progress,
        version: PROGRESS_VERSION,
        stage: 'pages',
        design: { designNote: design.designNote },
      },
      note: 'design system ready',
    }
  }

  const built = dedupeSlugs(progress.built ?? [])

  if (progress.stage === 'pages') {
    const next = plan.pages.find((page) => !built.includes(page.slug))
    if (next) {
      const html = await buildPage(ctx, plan, next, files['style.css'] ?? '', progress.design?.designNote ?? '')
      files[fileNameFor(next.slug)] = html
      const nowBuilt = dedupeSlugs([...built, next.slug])
      const allBuilt = nowBuilt.length >= plan.pages.length
      return {
        done: false,
        files,
        progress: {
          ...progress,
          version: PROGRESS_VERSION,
          stage: allBuilt ? 'polish' : 'pages',
          built: nowBuilt,
        },
        note: `built ${next.slug} (${nowBuilt.length}/${plan.pages.length})`,
      }
    }
  }

  const polished = dedupeSlugs(progress.polished ?? []).filter((slug) => built.includes(slug))
  const nextPolish = plan.pages.find((page) => built.includes(page.slug) && !polished.includes(page.slug))
  if (nextPolish) {
    const fname = fileNameFor(nextPolish.slug)
    const html = files[fname]
    if (html) {
      try {
        files[fname] = await polishPageLanguage(ctx, html)
      } catch (err) {
        console.warn('language pass failed, keeping original:', (err as Error).message)
      }
    }
    const nowPolished = dedupeSlugs([...polished, nextPolish.slug])
    const finished = nowPolished.length >= plan.pages.length
    return {
      done: finished,
      files: finished ? finalize(files, plan) : files,
      progress: {
        ...progress,
        version: PROGRESS_VERSION,
        stage: finished ? 'done' : 'polish',
        polished: nowPolished,
      },
      note: `language pass ${nowPolished.length}/${plan.pages.length}`,
    }
  }

  return {
    done: true,
    files: finalize(files, plan),
    progress: {
      ...progress,
      version: PROGRESS_VERSION,
      stage: 'done',
    },
    note: 'done',
  }
}

// ---------------------------------------------------------------------------
// Step 1 — blueprint
// ---------------------------------------------------------------------------
async function buildBlueprint(ctx: FreeformCtx): Promise<FreeformPlan> {
  const system = `Du är en svensk senior webbdesigner och art director. Du planerar moderna, säljande företagssajter för små svenska företag.

REGLER:
- Svara ENDAST med JSON.
- Sajten ska ALLTID ha minst sidorna "index" (startsida), "om-oss" och "kontakt".
- Lägg till fler sidor ENDAST om källdatan faktiskt räcker till innehåll på dem. Max ${MAX_PAGES} sidor totalt.
- Hitta aldrig på priser, årtal, certifikat, kundnamn eller referenser.
- Inga kontaktformulär får planeras. Kontakt sker via telefon och e-post.
- Välj hellre få men starka sidor än många tunna sidor.

SCHEMA:
{
  "designDirective": "2-4 meningar om visuell riktning: typografi, layoutkaraktär, rytm, bildanvändning",
  "pages": [
    { "slug": "index", "title": "Sidtitel", "purpose": "vad sidan ska göra", "sections": ["hero", "..."] }
  ]
}`

  const user = buildPlanningSourceBlock(
    ctx,
    'Planera sajten. Bestäm själv antal sidor utifrån hur mycket underlag som finns.',
  )
  const raw = await callModel(
    ctx.openrouterKey,
    BUILD_MODEL,
    system,
    user,
    BLUEPRINT_MAX_TOKENS,
    BLUEPRINT_TIMEOUT_MS,
    true,
  )
  const parsed = JSON.parse(stripFence(raw))
  const plan = sanitizePlan(parsed)
  if (!plan) throw new Error('blueprint returned no valid pages')
  return plan
}

// ---------------------------------------------------------------------------
// Step 2 — shared design system / CSS
// ---------------------------------------------------------------------------
async function buildDesignSystem(ctx: FreeformCtx, plan: FreeformPlan): Promise<DesignStepResult> {
  const palette = Object.entries(ctx.brandPalette)
    .map(([key, value]) => `  --${kebab(key)}: ${value};`)
    .join('\n')

  const system = `Du är en svensk senior frontend-designer. Du skriver ENDAST ett gemensamt style.css för en modern företagssajt.

REGLER:
- Svara ENDAST med JSON: {"designNote":"...","css":"..."}.
- css-fältet ska innehålla ENBART rå CSS, inte <style>-taggar.
- CSS ska vara komplett och produktionsklar för hela sajten: header, meny, hero, sektioner, kort, bildrutor, CTA-band, FAQ, kontakt och footer.
- Sajten måste kännas premium, genomarbetad och tydlig — inte billig AI-demo.
- Mobil först: menyn måste fungera snyggt med details/summary-lösning utan JavaScript.
- Skriv ingen reset som gör texten mikroskopisk. Prioritera tydlig typografi, bra radavstånd och stark visuell hierarki.
- Ingen extern @import.
- Definiera exakt dessa CSS-variabler i :root.

:root {
${palette}
}`

  const user = [
    buildPlanningSourceBlock(ctx, 'Bygg designsystemet för hela sajten.'),
    '',
    `SIDOR SOM SKA FINNAS:\n${plan.pages.map((page) => `- ${page.slug}: ${page.title} — ${page.purpose}`).join('\n')}`,
    '',
    `DESIGNRIKTNING FRÅN BLUEPRINT:\n${plan.designDirective || 'modern, luftig, förtroendeingivande, premium'}`,
    '',
    `KOMPONENTKONTRAKT SOM CSS MÅSTE STÖDJA:\n${COMPONENT_GUIDE}`,
    '',
    `TYPSNITT FRÅN DERAS NUVARANDE SAJT:\n${ctx.brandFonts.join(', ') || 'inga — välj moderna webbsäkra systemtypsnitt'}`,
  ].join('\n')

  const raw = await callModel(
    ctx.openrouterKey,
    BUILD_MODEL,
    system,
    user,
    DESIGN_MAX_TOKENS,
    DESIGN_TIMEOUT_MS,
    true,
  )
  const parsed = JSON.parse(stripFence(raw))
  const css = sanitizeCss(String(parsed?.css ?? ''))
  if (css.length < 1200) throw new Error(`design system came back too short (${css.length} chars)`)
  return {
    css,
    designNote: cleanPlainText(String(parsed?.designNote ?? '')).slice(0, 700),
  }
}

// ---------------------------------------------------------------------------
// Step 3 — one page at a time
// ---------------------------------------------------------------------------
async function buildPage(
  ctx: FreeformCtx,
  plan: FreeformPlan,
  page: FreeformPageSpec,
  existingCss: string,
  designNote: string,
): Promise<string> {
  const nav = plan.pages.map((p) => `${p.title} → ${fileNameFor(p.slug)}`).join('\n')
  const pageSpecificSource = buildPageSourceBlock(ctx, page)

  const system = `Du är en svensk senior frontend-utvecklare och designer. Du skriver komplett, produktionsklar HTML för EN sida i en modern företagssajt.

HÅRDA REGLER:
- Svara ENDAST med JSON: {"html":"..."}.
- html-fältet ska vara ett komplett dokument (<!DOCTYPE html> ... </html>) på svenska, med lang="sv", meta description, viewport och <link rel="stylesheet" href="style.css">.
- Ingen CSS i HTML. Inga <style>-taggar. Ingen JavaScript. Inga trackers.
- ALDRIG kontaktformulär. Inga <form>, <input>, <textarea> eller submit-knappar. Kontakt sker via <a href="tel:..."> och <a href="mailto:...">.
- Använd ENDAST bild-URL:er ur den givna bildpoolen. Alla bilder ska ha alt-text.
- Interna länkar får bara peka på filerna i navigationen nedan.
- Hitta aldrig på priser, årtal, certifikat, kundnamn eller referensprojekt.
- Följ komponentkontraktet nedan. Menyn ska använda details/summary för mobilversionen.
- Skapa en sida som känns skräddarsydd för företaget, men återanvänd de gemensamma komponenterna så att hela sajten blir konsekvent.
`

  const user = [
    pageSpecificSource,
    '',
    `BYGG SIDAN:\n- slug: ${page.slug}\n- fil: ${fileNameFor(page.slug)}\n- titel: ${page.title}\n- syfte: ${page.purpose || page.title}`,
    page.sections.length ? `- prioriterade sektioner: ${page.sections.join(', ')}` : '',
    '',
    `DESIGNRIKTNING:\n${plan.designDirective || 'modern, luftig, förtroendeingivande, premium'}`,
    designNote ? `\nDESIGNNOT FRÅN CSS-STEGET:\n${designNote}` : '',
    '',
    `KOMPONENTKONTRAKT:\n${COMPONENT_GUIDE}`,
    '',
    `NAVIGATION (exakt dessa länkar):\n${nav}`,
    '',
    `BEFINTLIG style.css (använd dess klasser och rytm):\n${existingCss.slice(0, 9000)}`,
    '',
    `BILDPOOL (endast dessa URL:er):\n${ctx.imagePool.join('\n') || '[inga bilder — bygg utan foton, använd färg, komposition och typografi]'}`,
  ]
    .filter(Boolean)
    .join('\n')

  const maxTokens = page.slug === 'index' ? INDEX_PAGE_MAX_TOKENS : INNER_PAGE_MAX_TOKENS
  const timeoutMs = page.slug === 'index' ? INDEX_PAGE_TIMEOUT_MS : INNER_PAGE_TIMEOUT_MS
  const raw = await callModel(ctx.openrouterKey, BUILD_MODEL, system, user, maxTokens, timeoutMs, true)
  const parsed = JSON.parse(stripFence(raw))
  const html = sanitizeHtml(String(parsed?.html ?? ''), ctx, plan)
  if (html.length < 850) throw new Error(`page ${page.slug} came back too short (${html.length} chars)`)
  return html
}

// ---------------------------------------------------------------------------
// Step 4 — language pass (text only, structure untouched)
// ---------------------------------------------------------------------------
async function polishPageLanguage(ctx: FreeformCtx, html: string): Promise<string> {
  const texts = extractTexts(html)
  if (!texts.length) return html

  const system = `Du är svensk copywriter. Du får en numrerad lista med textsnuttar från en företagssajt.
Skriv om varje snutt till naturlig, säljande, korrekt svenska. Behåll ungefär samma längd.
Hitta ALDRIG på priser, årtal, certifikat, kundnamn eller referenser. Ändra inte telefonnummer, e-post, adresser eller egennamn.
Svara ENDAST med JSON: {"texts": {"0": "...", "1": "..."}} med samma index.`

  const user = `FAKTA:\n${JSON.stringify(ctx.facts, null, 2)}\n\nTEXTER:\n${JSON.stringify(
    Object.fromEntries(texts.map((text, i) => [i, text])),
    null,
    2,
  )}`

  const raw = await callModel(
    ctx.openrouterKey,
    LANG_MODEL,
    system,
    user,
    4000,
    POLISH_TIMEOUT_MS,
    true,
  )
  const parsed = JSON.parse(stripFence(raw))
  const map = parsed?.texts ?? parsed
  if (!map || typeof map !== 'object') return html
  return replaceTexts(html, texts, (i) => {
    const value = map[String(i)]
    return typeof value === 'string' && value.trim() ? value.trim() : null
  })
}

// ---------------------------------------------------------------------------
// Shared source-data blocks
// ---------------------------------------------------------------------------
function buildPlanningSourceBlock(ctx: FreeformCtx, intro: string): string {
  const scraped = ctx.scraped ?? {}
  const pages = scraped.pages ?? {}
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
    `Titel: ${pages.home?.title || scraped.title || ''}`,
    `Beskrivning: ${pages.home?.description || scraped.description || ''}`,
    `Sammanfattning: ${pages.home?.summary || scraped.summary || ''}`,
    '',
    `HEM (markdown):\n${takeSnippet(pages.home?.markdown || '', 6000)}`,
    pages.about ? `\nOM OSS (markdown):\n${takeSnippet(pages.about.markdown, 3200)}` : '',
    pages.services ? `\nTJÄNSTER (markdown):\n${takeSnippet(pages.services.markdown, 4200)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildPageSourceBlock(ctx: FreeformCtx, page: FreeformPageSpec): string {
  const scraped = ctx.scraped ?? {}
  const pages = scraped.pages ?? {}
  const home = String(pages.home?.markdown ?? '')
  const about = String(pages.about?.markdown ?? '')
  const services = String(pages.services?.markdown ?? '')

  const pageSlug = page.slug
  const relevantBlocks: string[] = []

  if (pageSlug === 'index') {
    relevantBlocks.push(`HEM (viktigast):\n${takeSnippet(home, 4200)}`)
    if (services) relevantBlocks.push(`TJÄNSTER:\n${takeSnippet(services, 1800)}`)
    if (about) relevantBlocks.push(`OM OSS:\n${takeSnippet(about, 1400)}`)
  } else if (pageSlug === 'om-oss') {
    if (about) relevantBlocks.push(`OM OSS (viktigast):\n${takeSnippet(about, 4200)}`)
    relevantBlocks.push(`HEM:\n${takeSnippet(home, 2200)}`)
    if (services) relevantBlocks.push(`TJÄNSTER:\n${takeSnippet(services, 1200)}`)
  } else if (pageSlug === 'kontakt') {
    relevantBlocks.push(`HEM:\n${takeSnippet(home, 1800)}`)
    if (about) relevantBlocks.push(`OM OSS:\n${takeSnippet(about, 1000)}`)
  } else if (/tjanster|priser|vanliga-fragor|galleri|behandlingar|projekt/.test(pageSlug)) {
    if (services) relevantBlocks.push(`TJÄNSTER (viktigast):\n${takeSnippet(services, 4200)}`)
    relevantBlocks.push(`HEM:\n${takeSnippet(home, 2200)}`)
    if (about) relevantBlocks.push(`OM OSS:\n${takeSnippet(about, 1200)}`)
  } else {
    relevantBlocks.push(`HEM:\n${takeSnippet(home, 2800)}`)
    if (about) relevantBlocks.push(`OM OSS:\n${takeSnippet(about, 1600)}`)
    if (services) relevantBlocks.push(`TJÄNSTER:\n${takeSnippet(services, 1800)}`)
  }

  return [
    `Bygg sidan "${page.title}" (${fileNameFor(page.slug)}).`,
    '',
    ctx.regenFeedback ? `--- ANVÄNDARENS FEEDBACK (HÖGSTA PRIORITET) ---\n${ctx.regenFeedback}\n` : '',
    `BRANSCHTAGG (kontext, inte mall): ${ctx.nicheLabel}${ctx.category ? ` / ${ctx.category}` : ''}`,
    '',
    'FAKTA (endast detta får användas som hårda uppgifter):',
    JSON.stringify(ctx.facts, null, 2),
    '',
    '--- RELEVANT KÄLLDATA FÖR JUST DENNA SIDA ---',
    ...relevantBlocks,
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Sanitizers / guards
// ---------------------------------------------------------------------------
export function sanitizeHtml(input: string, ctx: FreeformCtx, plan: FreeformPlan): string {
  let html = stripFence(input).trim()

  html = html.replace(/<style[\s\S]*?<\/style>/gi, '')
  html = html.replace(/<form[\s\S]*?<\/form>/gi, buildCtaHtml(ctx.facts))
  html = html.replace(/<(input|textarea|select|option|label|fieldset|legend)\b[^>]*>/gi, '')
  html = html.replace(/<\/(textarea|select|option|label|fieldset|legend)>/gi, '')
  html = html.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, '')

  html = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  html = html.replace(/<script\b[^>]*\/?>/gi, '')
  html = html.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
  html = html.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')

  html = html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (match) =>
    /google\.[a-z.]+\/maps|maps\.google/i.test(match) ? match : '')

  const allowed = new Set(plan.pages.map((page) => fileNameFor(page.slug)))
  html = html.replace(/href\s*=\s*"([^"]+)"/gi, (full, href: string) => {
    const value = String(href)
    if (/^(https?:|tel:|mailto:|#|\/\/)/i.test(value)) return full
    const clean = value.split(/[?#]/)[0].replace(/^\.?\//, '')
    if (clean === '' || clean === 'style.css') return full
    return allowed.has(clean) ? `href="${clean}"` : 'href="index.html"'
  })

  const pool = new Set(ctx.imagePool)
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/src\s*=\s*"([^"]+)"/i)?.[1]
    if (src && (pool.has(src) || src.startsWith('data:'))) return tag
    const fallback = ctx.imagePool[0]
    if (!fallback) return ''
    return src ? tag.replace(src, fallback) : tag.replace(/<img/i, `<img src="${fallback}"`)
  })

  html = normalizeDocument(html, ctx)
  return html
}

function sanitizeCss(css: string): string {
  return stripFence(css)
    .replace(/<style[^>]*>/gi, '')
    .replace(/<\/style>/gi, '')
    .replace(/@import[^;]+;/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .trim()
}

function normalizeDocument(html: string, ctx: FreeformCtx): string {
  let out = html.trim()

  if (!/^<!doctype html>/i.test(out)) out = `<!DOCTYPE html>\n${out}`
  if (/<html(?![^>]*\blang=)/i.test(out)) out = out.replace(/<html/i, '<html lang="sv"')
  if (!/<meta\s+name=["']viewport["']/i.test(out) && /<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, '  <meta name="viewport" content="width=device-width, initial-scale=1">\n</head>')
  }
  if (!/<meta\s+name=["']description["']/i.test(out) && /<\/head>/i.test(out)) {
    const meta = escapeAttribute(buildMetaDescription(ctx))
    out = out.replace(/<\/head>/i, `  <meta name="description" content="${meta}">\n</head>`)
  }
  if (!/rel=["']stylesheet["'][^>]*href=["']style\.css["']/i.test(out) && /<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, '  <link rel="stylesheet" href="style.css">\n</head>')
  }

  return out
}

function buildMetaDescription(ctx: FreeformCtx): string {
  const name = ctx.facts.business_name || 'Företaget'
  const city = ctx.facts.city ? ` i ${ctx.facts.city}` : ''
  return `${name}${city} — modern företagssajt med tydlig information om tjänster, kontakt och verksamheten.`
}

function buildCtaHtml(facts: FreeformFacts): string {
  const parts: string[] = []
  if (facts.phone) parts.push(`<a class="btn btn-primary" href="tel:${facts.phone.replace(/\s/g, '')}">Ring ${facts.phone}</a>`)
  if (facts.email) parts.push(`<a class="btn btn-secondary" href="mailto:${facts.email}">Mejla oss</a>`)
  return parts.length ? `<div class="btn-row">${parts.join('')}</div>` : ''
}

function finalize(files: Record<string, string>, plan: FreeformPlan): Record<string, string> {
  const out = { ...files }
  if (!out['index.html']) {
    const firstHtml = Object.keys(out).find((name) => name.endsWith('.html'))
    if (firstHtml) out['index.html'] = out[firstHtml]
  }
  if (!out['style.css']) {
    out['style.css'] = ':root{--primary:#111111;--background:#ffffff}body{margin:0;font-family:system-ui,sans-serif}'
  }
  for (const page of plan.pages) {
    const fname = fileNameFor(page.slug)
    if (!out[fname]) delete out[fname]
  }
  return out
}

// ---------------------------------------------------------------------------
// Text extraction for the language pass
// ---------------------------------------------------------------------------
const TEXT_TAGS = 'h1|h2|h3|h4|p|li|span|strong|em|blockquote|figcaption|small'
const textRe = new RegExp(`<(${TEXT_TAGS})(\\s[^>]*)?>([^<]{12,600})<\\/\\1>`, 'gi')

function extractTexts(html: string): string[] {
  const out: string[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(textRe.source, 'gi')
  while ((match = re.exec(html)) !== null) {
    const value = match[3].trim()
    if (value && !/^[\d\s+()-]+$/.test(value) && !/@/.test(value)) out.push(value)
    if (out.length >= 60) break
  }
  return out
}

function replaceTexts(html: string, texts: string[], pick: (i: number) => string | null): string {
  let i = 0
  const re = new RegExp(textRe.source, 'gi')
  return html.replace(re, (full, tag, attrs, inner) => {
    const text = String(inner).trim()
    if (!text || /^[\d\s+()-]+$/.test(text) || /@/.test(text)) return full
    const idx = texts.indexOf(text, 0)
    const replacement = idx >= 0 ? pick(idx) : pick(i)
    i++
    if (!replacement) return full
    return `<${tag}${attrs ?? ''}>${escapeText(replacement)}</${tag}>`
  })
}

function escapeText(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// Progress normalization / migration
// ---------------------------------------------------------------------------
function normalizeProgress(
  raw: FreeformProgress | null | undefined,
  files: Record<string, string>,
): FreeformProgress {
  const stage = isStage(raw?.stage) ? raw!.stage : 'plan'
  const plan = sanitizePlan(raw?.plan)
  const built = dedupeSlugs(Array.isArray(raw?.built) ? raw!.built! : [])
  const polished = dedupeSlugs(Array.isArray(raw?.polished) ? raw!.polished! : []).filter((slug) => built.includes(slug))
  const designNote = typeof raw?.design?.designNote === 'string'
    ? cleanPlainText(raw.design.designNote).slice(0, 700)
    : ''

  if (!plan) {
    return {
      version: PROGRESS_VERSION,
      stage: 'plan',
      built: [],
      polished: [],
    }
  }

  let nextStage: FreeformStage = stage
  if (!hasUsableCss(files) && stage !== 'done') nextStage = 'design'
  else if (built.length < plan.pages.length) nextStage = 'pages'
  else if (polished.length < plan.pages.length && stage !== 'done') nextStage = 'polish'
  else if (polished.length >= plan.pages.length) nextStage = 'done'

  return {
    version: PROGRESS_VERSION,
    stage: nextStage,
    plan,
    design: designNote ? { designNote } : undefined,
    built,
    polished,
  }
}

function sanitizePlan(input: any): FreeformPlan | null {
  if (!input || typeof input !== 'object') return null
  let pages: FreeformPageSpec[] = Array.isArray(input?.pages) ? input.pages : []
  pages = pages
    .map((page: any) => ({
      slug: slugify(String(page?.slug ?? '')),
      title: String(page?.title ?? '').trim() || 'Sida',
      purpose: cleanPlainText(String(page?.purpose ?? '')).slice(0, 180),
      sections: Array.isArray(page?.sections)
        ? page.sections.map((section: any) => cleanPlainText(String(section))).filter(Boolean).slice(0, 10)
        : [],
    }))
    .filter((page) => !!page.slug)

  for (const required of REQUIRED_PAGES) {
    if (!pages.some((page) => page.slug === required)) {
      pages.push({
        slug: required,
        title: required === 'index' ? 'Start' : required === 'om-oss' ? 'Om oss' : 'Kontakt',
        purpose: '',
        sections: [],
      })
    }
  }

  const seen = new Set<string>()
  pages = pages
    .filter((page) => (seen.has(page.slug) ? false : (seen.add(page.slug), true)))
    .slice(0, MAX_PAGES)
  pages.sort((a, b) => (a.slug === 'index' ? -1 : b.slug === 'index' ? 1 : 0))
  if (!pages.length) return null

  return {
    designDirective: cleanPlainText(String(input?.designDirective ?? '')).slice(0, 500),
    pages,
  }
}

function hasUsableCss(files: Record<string, string>): boolean {
  return typeof files['style.css'] === 'string' && files['style.css'].trim().length > 600
}

function dedupeSlugs(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const slug = slugify(String(value || ''))
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
}

function isStage(value: unknown): value is FreeformStage {
  return value === 'plan' || value === 'design' || value === 'pages' || value === 'polish' || value === 'done'
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
export function fileNameFor(slug: string): string {
  return slug === 'index' ? 'index.html' : `${slug}.html`
}

function slugify(s: string): string {
  const base = s
    .trim()
    .toLowerCase()
    .replace(/\.html?$/, '')
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
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

function takeSnippet(value: string, limit: number): string {
  return String(value || '').trim().slice(0, limit)
}

function cleanPlainText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
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
