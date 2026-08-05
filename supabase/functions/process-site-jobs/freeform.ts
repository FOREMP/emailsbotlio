// Freeform site engine (generation_mode = 'freeform').
//
// DeepSeek V4 remains the creative builder, but the pipeline is deliberately
// defensive: every long model step has a deterministic escape hatch so one slow
// OpenRouter/DeepSeek response cannot strand a lead in "generating".
//
// Progress lives in generated_sites.gen_progress:
//   {
//     version: 3,
//     stage: 'plan' | 'design' | 'pages' | 'polish' | 'done',
//     plan,
//     design,
//     built: [slug],
//     polished: [slug],
//     lastStage,
//     lastError,
//     fallbacksUsed,
//     model,
//     updatedAt
//   }
//
// The template engine in index.ts is untouched — flipping generation_mode back
// to 'template' restores the old behaviour exactly.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export const BUILD_MODEL = 'deepseek/deepseek-v4-flash-0731'
export const LANG_MODEL = 'openai/gpt-4.1-mini'

const MAX_PAGES = 5
const REQUIRED_PAGES = ['index', 'om-oss', 'kontakt']
const PROGRESS_VERSION = 3

const BLUEPRINT_MAX_TOKENS = 2200
const DESIGN_MAX_TOKENS = 3200
const INDEX_PAGE_MAX_TOKENS = 11000
const INNER_PAGE_MAX_TOKENS = 7500
const PAGE_RETRY_MAX_TOKENS = 5200
const BLUEPRINT_TIMEOUT_MS = 45_000
const DESIGN_TIMEOUT_MS = 32_000
const INDEX_PAGE_TIMEOUT_MS = 65_000
const INNER_PAGE_TIMEOUT_MS = 55_000
const PAGE_RETRY_TIMEOUT_MS = 35_000
const POLISH_TIMEOUT_MS = 35_000
const PLANNING_HOME_LIMIT = 2400
const PLANNING_ABOUT_LIMIT = 1200
const PLANNING_SERVICES_LIMIT = 1400
const PAGE_HOME_LIMIT = 1700
const PAGE_ABOUT_LIMIT = 1000
const PAGE_SERVICES_LIMIT = 1300
const CSS_PROMPT_LIMIT = 2800
const IMAGE_PROMPT_LIMIT = 5

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
  source?: 'ai' | 'fallback'
}

export interface FreeformProgress {
  version?: number
  stage: FreeformStage
  plan?: FreeformPlan
  design?: FreeformDesign
  built?: string[]
  polished?: string[]
  lastStage?: string
  lastError?: string
  fallbacksUsed?: string[]
  model?: string
  updatedAt?: string
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
  source: 'ai' | 'fallback'
}

// ---------------------------------------------------------------------------
// Public entry point: runs exactly ONE step and returns updated state.
// ---------------------------------------------------------------------------
export async function runFreeformStep(
  ctx: FreeformCtx,
  existingFiles: Record<string, string>,
): Promise<FreeformStepResult> {
  const files: Record<string, string> = { ...(existingFiles ?? {}) }
  const progress = normalizeProgress(ctx.progress, files)

  if (progress.stage === 'plan' || !progress.plan) {
    const plan = await buildBlueprint(ctx)
    const usedFallback = plan.designDirective?.includes('[fallback-plan]')
    return {
      done: false,
      files,
      progress: withProgressMeta({
        ...progress,
        version: PROGRESS_VERSION,
        stage: 'design',
        plan,
        design: progress.design,
        built: [],
        polished: [],
        fallbacksUsed: usedFallback ? addFallback(progress, 'blueprint') : progress.fallbacksUsed,
        lastStage: 'plan',
      }),
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
      progress: withProgressMeta({
        ...progress,
        version: PROGRESS_VERSION,
        stage: 'pages',
        design: { designNote: design.designNote, source: design.source },
        fallbacksUsed: design.source === 'fallback' ? addFallback(progress, 'design') : progress.fallbacksUsed,
        lastStage: 'design',
        lastError: design.source === 'fallback' ? progress.lastError : undefined,
      }),
      note: design.source === 'fallback' ? 'design fallback ready' : 'design system ready',
    }
  }

  const built = dedupeSlugs(progress.built ?? [])

  if (progress.stage === 'pages') {
    const next = plan.pages.find((page) => !built.includes(page.slug))
    if (next) {
      const pageResult = await buildPageResilient(ctx, plan, next, files['style.css'] ?? '', progress.design?.designNote ?? '')
      files[fileNameFor(next.slug)] = pageResult.html
      const nowBuilt = dedupeSlugs([...built, next.slug])
      const allBuilt = nowBuilt.length >= plan.pages.length
      return {
        done: false,
        files,
        progress: withProgressMeta({
          ...progress,
          version: PROGRESS_VERSION,
          stage: allBuilt ? 'polish' : 'pages',
          built: nowBuilt,
          fallbacksUsed: pageResult.source === 'fallback' ? addFallback(progress, `page:${next.slug}`) : progress.fallbacksUsed,
          lastStage: `page:${next.slug}`,
          lastError: pageResult.error ?? progress.lastError,
        }),
        note: `${pageResult.source === 'fallback' ? 'fallback built' : 'built'} ${next.slug} (${nowBuilt.length}/${plan.pages.length})`,
      }
    }
  }

  const polished = dedupeSlugs(progress.polished ?? []).filter((slug) => built.includes(slug))
  const nextPolish = plan.pages.find((page) => built.includes(page.slug) && !polished.includes(page.slug))
  if (nextPolish) {
    const fname = fileNameFor(nextPolish.slug)
    const html = files[fname]
    let polishError: string | undefined
    if (html) {
      try {
        files[fname] = await polishPageLanguage(ctx, html)
      } catch (err) {
        polishError = `language pass failed for ${nextPolish.slug}: ${(err as Error).message}`
        console.warn(polishError)
      }
    }
    const nowPolished = dedupeSlugs([...polished, nextPolish.slug])
    const finished = nowPolished.length >= plan.pages.length
    return {
      done: finished,
      files: finished ? finalize(files, plan) : files,
      progress: withProgressMeta({
        ...progress,
        version: PROGRESS_VERSION,
        stage: finished ? 'done' : 'polish',
        polished: nowPolished,
        lastStage: `polish:${nextPolish.slug}`,
        lastError: polishError ?? progress.lastError,
      }),
      note: `language pass ${nowPolished.length}/${plan.pages.length}`,
    }
  }

  return {
    done: true,
    files: finalize(files, plan),
    progress: withProgressMeta({
      ...progress,
      version: PROGRESS_VERSION,
      stage: 'done',
      lastStage: 'done',
    }),
    note: 'done',
  }
}

// ---------------------------------------------------------------------------
// Step 1 — blueprint. DeepSeek first, deterministic fallback second.
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

  try {
    const raw = await callModel(
      ctx.openrouterKey,
      BUILD_MODEL,
      'freeform-blueprint',
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
  } catch (err) {
    console.warn('blueprint failed, using fallback plan:', (err as Error).message)
    return buildFallbackPlan(ctx)
  }
}

function buildFallbackPlan(ctx: FreeformCtx): FreeformPlan {
  const isBeauty = /salon|fris|hair|beauty|skönhet|hud|spa|nail|klinik/i.test(`${ctx.nicheLabel} ${ctx.category ?? ''} ${ctx.facts.niche}`)
  const serviceSlug = isBeauty ? 'behandlingar' : 'tjanster'
  const business = ctx.facts.business_name || ctx.nicheLabel || 'Företaget'
  return {
    designDirective: `[fallback-plan] Premium, luftig och förtroendeingivande design med stark typografi, generösa bildytor, tydliga CTA-knappar och mobil layout utan sidscroll. Anpassa känslan efter ${ctx.nicheLabel.toLowerCase()} och använd fakta sparsamt men konkret.`,
    pages: [
      {
        slug: 'index',
        title: business,
        purpose: 'Presentera företaget snabbt, skapa förtroende och leda besökaren till kontakt.',
        sections: ['hero', 'intro', 'services', 'trust', 'contact'],
      },
      {
        slug: serviceSlug,
        title: isBeauty ? 'Behandlingar' : 'Tjänster',
        purpose: 'Visa de viktigaste erbjudandena på ett tydligt och säljande sätt utan påhittade priser.',
        sections: ['page-hero', 'service-list', 'how-it-works', 'cta'],
      },
      {
        slug: 'om-oss',
        title: 'Om oss',
        purpose: 'Bygga förtroende genom arbetssätt, känsla och det som går att veta från källmaterialet.',
        sections: ['page-hero', 'story', 'values', 'cta'],
      },
      {
        slug: 'kontakt',
        title: 'Kontakt',
        purpose: 'Göra det enkelt att ringa, mejla och hitta rätt nästa steg.',
        sections: ['page-hero', 'contact-details', 'cta'],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Step 2 — shared design system / CSS. AI when fast, fallback when slow.
// ---------------------------------------------------------------------------
async function buildDesignSystem(ctx: FreeformCtx, plan: FreeformPlan): Promise<DesignStepResult> {
  const palette = Object.entries(ctx.brandPalette)
    .map(([key, value]) => `  --${kebab(key)}: ${value};`)
    .join('\n')

  const system = `Du är en svensk senior frontend-designer. Du skriver ett gemensamt style.css för en modern företagssajt.

REGLER:
- Svara ENDAST med JSON: {"designNote":"...","css":"..."}.
- css-fältet ska innehålla ENBART rå CSS, inte <style>-taggar.
- CSS ska vara komplett för: header, details/summary-mobilmeny, hero, sektioner, kort, bildrutor, CTA-band, FAQ, kontakt och footer.
- Sajten måste kännas premium, tydlig och mänskligt designad — inte billig AI-demo.
- Mobil först: ingen horisontell scroll, stora klickytor och tydlig meny.
- Text måste alltid ha bra kontrast. Ändra textfärger hellre än bakgrund.
- Ingen extern @import.
- Definiera dessa CSS-variabler i :root och använd dem.

:root {
${palette}
}`

  const user = buildDesignSourceBlock(ctx, plan)

  try {
    const raw = await callModel(
      ctx.openrouterKey,
      BUILD_MODEL,
      'freeform-design',
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
      css: ensureCssSafetyNet(css),
      designNote: cleanPlainText(String(parsed?.designNote ?? '')).slice(0, 700),
      source: 'ai',
    }
  } catch (err) {
    const reason = (err as Error).message
    console.warn('design step failed, using deterministic CSS fallback:', reason)
    const fallback = buildFallbackDesignSystem(ctx, plan, reason)
    return fallback
  }
}

function buildDesignSourceBlock(ctx: FreeformCtx, plan: FreeformPlan): string {
  const name = ctx.facts.business_name || ctx.nicheLabel
  const city = ctx.facts.city ? ` i ${ctx.facts.city}` : ''
  return [
    `FÖRETAG: ${name}${city}`,
    `BRANSCH: ${ctx.nicheLabel}${ctx.category ? ` / ${ctx.category}` : ''}`,
    `DESIGNRIKTNING: ${plan.designDirective || 'premium, luftig, förtroendeingivande, modern'}`,
    `SIDOR:\n${plan.pages.map((page) => `- ${page.slug}: ${page.title}`).join('\n')}`,
    `TYPSNITT FRÅN KÄLLAN: ${ctx.brandFonts.join(', ') || 'inga — använd moderna webbsäkra systemtypsnitt'}`,
    `KOMPONENTKONTRAKT:\n${COMPONENT_GUIDE}`,
    'VIKTIGT: CSS:en ska kunna bära även AI-genererad HTML som följer kontraktet. Prioritera robusthet, premiumkänsla och mobil.',
  ].join('\n\n')
}

function buildFallbackDesignSystem(ctx: FreeformCtx, plan: FreeformPlan, reason = 'AI design unavailable'): DesignStepResult {
  const p = normalizePalette(ctx.brandPalette, ctx.facts.niche)
  const isSalon = /salon|fris|hair|beauty|skönhet|hud|spa|nail|klinik/i.test(`${ctx.nicheLabel} ${ctx.category ?? ''} ${ctx.facts.niche}`)
  const displayStack = fontStack(ctx.brandFonts[0], isSalon ? 'Georgia, "Times New Roman", serif' : 'Inter, ui-sans-serif, system-ui, sans-serif')
  const bodyStack = fontStack(ctx.brandFonts[1], 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif')
  const css = `
:root{
  --primary:${p.primary};
  --secondary:${p.secondary};
  --accent:${p.accent};
  --background:${p.background};
  --surface:${p.surface};
  --surface-strong:${p.surfaceStrong};
  --text-primary:${p.textPrimary};
  --text-secondary:${p.textSecondary};
  --on-primary:${p.onPrimary};
  --on-primary-muted:${p.onPrimaryMuted};
  --border:${p.border};
  --shadow:${p.shadow};
  --radius:28px;
  --radius-sm:18px;
  --wrap:1180px;
  --display:${displayStack};
  --body:${bodyStack};
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;overflow-x:hidden}
body{margin:0;min-width:0;overflow-x:hidden;background:
  radial-gradient(circle at top right,color-mix(in srgb,var(--accent) 18%,transparent),transparent 34rem),
  linear-gradient(180deg,color-mix(in srgb,var(--background) 92%,var(--surface)) 0%,var(--background) 42%,color-mix(in srgb,var(--surface) 72%,var(--background)) 100%);
  color:var(--text-primary);font-family:var(--body);font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img,svg,video{display:block;max-width:100%}
a{color:inherit;text-decoration-thickness:.08em;text-underline-offset:.18em}
.wrap{width:min(var(--wrap),calc(100% - 40px));margin-inline:auto}
.site-header{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--background) 84%,transparent);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.nav-shell{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:22px}
.brand{font-family:var(--display);font-size:clamp(20px,2vw,30px);font-weight:800;letter-spacing:-.035em;text-decoration:none;max-width:52vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nav-desktop{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap;justify-content:flex-end}
.nav-desktop a,.nav-drawer a{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:10px 14px;border-radius:999px;text-decoration:none;color:var(--text-secondary);font-weight:750;font-size:14px;letter-spacing:.01em;transition:background .18s ease,color .18s ease,transform .18s ease}
.nav-desktop a:hover,.nav-drawer a:hover{background:color-mix(in srgb,var(--primary) 11%,transparent);color:var(--text-primary);transform:translateY(-1px)}
.nav-desktop a[aria-current="page"],.nav-desktop .active,.nav-drawer a[aria-current="page"],.nav-drawer .active{background:color-mix(in srgb,var(--primary) 13%,transparent);color:var(--text-primary)}
.nav-mobile{display:none;position:relative}
.nav-mobile summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:10px;min-height:46px;padding:11px 16px;border:1px solid var(--border);border-radius:999px;background:var(--surface);box-shadow:0 12px 30px var(--shadow);font-weight:800;color:var(--text-primary)}
.nav-mobile summary::-webkit-details-marker{display:none}
.nav-mobile summary:before{content:"";width:18px;height:12px;background:linear-gradient(var(--text-primary),var(--text-primary)) top/100% 2px no-repeat,linear-gradient(var(--text-primary),var(--text-primary)) center/100% 2px no-repeat,linear-gradient(var(--text-primary),var(--text-primary)) bottom/100% 2px no-repeat}
.nav-drawer{position:absolute;right:0;top:calc(100% + 12px);width:min(86vw,360px);padding:12px;border:1px solid var(--border);border-radius:24px;background:color-mix(in srgb,var(--surface) 96%,var(--background));box-shadow:0 26px 70px var(--shadow);display:grid;gap:4px}
.nav-drawer a{justify-content:flex-start;width:100%;padding:14px 16px;border-radius:16px;color:var(--text-primary)}
.section{padding:clamp(68px,9vw,128px) 0;position:relative}
.section-alt{background:color-mix(in srgb,var(--surface) 58%,transparent)}
.stack{display:grid;gap:20px}.split{display:grid;grid-template-columns:minmax(0,1.02fr) minmax(280px,.78fr);gap:clamp(28px,5vw,72px);align-items:center}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.contact-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(280px,1.1fr);gap:28px;align-items:start}.gallery-grid{display:grid;grid-template-columns:1.2fr .8fr .8fr;gap:18px}.faq-list{display:grid;gap:12px;max-width:900px}
.eyebrow{display:inline-flex;align-items:center;gap:10px;margin:0 0 18px;color:var(--primary);font-size:12px;line-height:1.2;font-weight:900;letter-spacing:.22em;text-transform:uppercase}.eyebrow:before{content:"";width:28px;height:1px;background:currentColor;opacity:.65}
h1,h2,h3,h4,p{overflow-wrap:anywhere}h1,h2,h3,.h1,.h2,.h3{font-family:var(--display);margin:0;color:var(--text-primary);letter-spacing:-.045em;line-height:.98}h1,.h1{font-size:clamp(42px,7vw,88px);max-width:12ch}h2,.h2{font-size:clamp(30px,4.6vw,60px);max-width:14ch}h3,.h3{font-size:clamp(21px,2.1vw,30px);line-height:1.08}.lead{font-size:clamp(17px,1.7vw,21px);line-height:1.72;color:var(--text-secondary);max-width:66ch}.lead.lg{font-size:clamp(18px,2vw,24px)}
.btn-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:14px 22px;border:1px solid var(--border);border-radius:999px;background:color-mix(in srgb,var(--surface) 82%,transparent);color:var(--text-primary);font-weight:850;text-decoration:none;box-shadow:0 12px 28px color-mix(in srgb,var(--shadow) 70%,transparent);transition:transform .18s ease,box-shadow .18s ease}.btn:hover{transform:translateY(-2px);box-shadow:0 18px 38px var(--shadow)}.btn-primary,.btn.btn-primary{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}.btn-secondary,.btn.btn-secondary{background:transparent;color:var(--text-primary)}
.hero{position:relative;isolation:isolate;min-height:min(780px,86svh);display:grid;align-items:end;padding:clamp(86px,11vw,150px) 0 clamp(54px,7vw,86px);overflow:hidden}.hero:before{content:"";position:absolute;inset:0;z-index:-2;background:linear-gradient(110deg,color-mix(in srgb,var(--background) 96%,transparent) 0%,color-mix(in srgb,var(--background) 82%,transparent) 48%,color-mix(in srgb,var(--background) 22%,transparent) 100%)}.hero>img,.hero .hero-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-3;filter:brightness(.82) saturate(.88)}.hero .wrap{display:grid;gap:24px}.hero .lead{margin:6px 0 0}.page-hero{position:relative;isolation:isolate;padding:clamp(100px,12vw,160px) 0 clamp(58px,8vw,94px);overflow:hidden;background:color-mix(in srgb,var(--surface) 72%,var(--background))}.page-hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.16;z-index:-2}.page-hero:after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,var(--background),color-mix(in srgb,var(--background) 72%,transparent))}.page-hero .lead{margin-top:20px}
.card,.media-card{min-width:0;padding:clamp(22px,3vw,34px);border:1px solid var(--border);border-radius:var(--radius);background:color-mix(in srgb,var(--surface) 91%,var(--background));box-shadow:0 24px 70px var(--shadow)}.card p,.media-card p{color:var(--text-secondary)}.media-card{overflow:hidden;padding:0}.media-card img{width:100%;height:260px;object-fit:cover}.media-card .media-body{padding:24px}.tag-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.tag-row span,.tag{display:inline-flex;padding:8px 12px;border-radius:999px;background:color-mix(in srgb,var(--primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--primary) 18%,transparent);color:var(--text-primary);font-weight:800;font-size:13px}.gallery-grid img{width:100%;height:260px;object-fit:cover;border-radius:var(--radius);box-shadow:0 24px 70px var(--shadow)}.gallery-grid img:first-child{height:330px}
.cta-band{padding:clamp(28px,5vw,56px);border-radius:calc(var(--radius) + 8px);background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 64%,var(--accent)));color:var(--on-primary);box-shadow:0 28px 80px color-mix(in srgb,var(--primary) 24%,transparent)}.cta-band h1,.cta-band h2,.cta-band h3,.cta-band .h1,.cta-band .h2,.cta-band .h3{color:var(--on-primary)}.cta-band p,.cta-band .lead{color:var(--on-primary-muted)}.cta-band .btn-primary{background:var(--surface);border-color:var(--surface);color:var(--text-primary)}.contact-list{display:grid;gap:12px}.contact-list a{color:var(--text-primary);font-weight:800}.contact-list li,.contact-list p,.contact-item{padding:18px;border:1px solid var(--border);border-radius:var(--radius-sm);background:color-mix(in srgb,var(--surface) 82%,transparent);color:var(--text-secondary)}.contact-item strong{color:var(--text-primary)}iframe,.map{width:100%;min-height:340px;border:0;border-radius:var(--radius);box-shadow:0 24px 70px var(--shadow)}details.faq,.faq-list details{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);padding:18px 20px}details.faq summary,.faq-list summary{cursor:pointer;font-weight:850;color:var(--text-primary)}details.faq p,.faq-list p{color:var(--text-secondary)}
.site-footer{padding:54px 0;background:color-mix(in srgb,var(--surface) 88%,var(--background));border-top:1px solid var(--border);color:var(--text-secondary)}.site-footer .footer-grid{display:grid;grid-template-columns:1.2fr .8fr .8fr;gap:28px}.site-footer a{color:var(--text-secondary)}.site-footer a:hover{color:var(--text-primary)}.site-footer .footer-title{font-family:var(--display);font-weight:900;color:var(--text-primary);letter-spacing:-.02em}.site-footer .foot-bottom{margin-top:34px;font-size:13px;color:color-mix(in srgb,var(--text-secondary) 76%,transparent)}
${isSalon ? `.hero h1,.page-hero h1{font-weight:650}.card,.media-card,.cta-band{border-radius:34px}.eyebrow{letter-spacing:.26em}.hero:before{background:linear-gradient(100deg,color-mix(in srgb,var(--background) 98%,transparent) 0%,color-mix(in srgb,var(--background) 88%,transparent) 46%,color-mix(in srgb,var(--background) 30%,transparent) 100%)}` : ''}
@media(max-width:980px){.nav-desktop{display:none}.nav-mobile{display:block}.nav-shell{min-height:68px}.split,.contact-grid{grid-template-columns:1fr}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.gallery-grid{grid-template-columns:1fr 1fr}.hero{min-height:auto}.site-footer .footer-grid{grid-template-columns:1fr 1fr}}
@media(max-width:680px){body{font-size:16px}.wrap{width:min(100% - 32px,var(--wrap))}.brand{max-width:62vw}.section{padding:60px 0}.hero{padding:94px 0 52px}.page-hero{padding:92px 0 54px}h1,.h1{font-size:clamp(38px,12vw,58px)}h2,.h2{font-size:clamp(29px,9vw,44px)}.lead,.lead.lg{font-size:17px;line-height:1.68}.grid,.gallery-grid,.site-footer .footer-grid{grid-template-columns:1fr}.gallery-grid img,.gallery-grid img:first-child,.media-card img{height:240px}.btn-row{display:grid}.btn{width:100%}.cta-band{border-radius:26px}.nav-drawer{right:-4px}.contact-list li,.contact-list p,.contact-item{padding:16px}.site-footer{padding:42px 0}}
`.trim()

  return {
    css: ensureCssSafetyNet(css),
    designNote: `Deterministiskt premiumsystem användes eftersom AI-designsteget inte blev klart: ${cleanPlainText(reason).slice(0, 180)}. CSS:en prioriterar mobil, läsbarhet, premiumkänsla och robusta komponenter för ${ctx.nicheLabel}.`,
    source: 'fallback',
  }
}

// ---------------------------------------------------------------------------
// Step 3 — one page at a time. DeepSeek first, fallback page second.
// ---------------------------------------------------------------------------
async function buildPageResilient(
  ctx: FreeformCtx,
  plan: FreeformPlan,
  page: FreeformPageSpec,
  existingCss: string,
  designNote: string,
): Promise<{ html: string; source: 'ai' | 'fallback'; error?: string }> {
  try {
    const html = await buildPage(ctx, plan, page, existingCss, designNote)
    return { html, source: 'ai' }
  } catch (err) {
    const msg = (err as Error).message
    console.warn(`page ${page.slug} failed, using fallback page:`, msg)
    return {
      html: buildFallbackPage(ctx, plan, page),
      source: 'fallback',
      error: `page ${page.slug}: ${msg}`,
    }
  }
}

async function buildPage(
  ctx: FreeformCtx,
  plan: FreeformPlan,
  page: FreeformPageSpec,
  existingCss: string,
  designNote: string,
): Promise<string> {
  const nav = plan.pages.map((p) => `${p.title} → ${fileNameFor(p.slug)}`).join('\n')

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
- Håll sidan koncentrerad och skarp: startsidan 5–7 huvudsektioner, undersidor 4–6 huvudsektioner.
`

  const buildPageUser = (compact = false) => [
    buildPageSourceBlock(ctx, page, compact),
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
    `BEFINTLIG style.css (använd dess klasser och rytm):\n${buildCssPromptContext(existingCss, compact)}`,
    '',
    `BILDPOOL (endast dessa URL:er):\n${buildImagePromptContext(ctx.imagePool, compact)}`,
    compact ? '\nKOMPAKT LÄGE: bygg färre sektioner, men komplett dokument med tydlig premiumkänsla.' : '',
  ]
    .filter(Boolean)
    .join('\n')

  const maxTokens = page.slug === 'index' ? INDEX_PAGE_MAX_TOKENS : INNER_PAGE_MAX_TOKENS
  const timeoutMs = page.slug === 'index' ? INDEX_PAGE_TIMEOUT_MS : INNER_PAGE_TIMEOUT_MS
  const raw = await callModelWithCompactRetry({
    key: ctx.openrouterKey,
    model: BUILD_MODEL,
    label: `freeform-page:${page.slug}`,
    system,
    user: buildPageUser(false),
    maxTokens,
    timeoutMs,
    jsonMode: true,
    retryUser: buildPageUser(true),
    retryMaxTokens: PAGE_RETRY_MAX_TOKENS,
    retryTimeoutMs: PAGE_RETRY_TIMEOUT_MS,
  })
  const parsed = JSON.parse(stripFence(raw))
  const html = sanitizeHtml(String(parsed?.html ?? ''), ctx, plan)
  if (html.length < 850) throw new Error(`page ${page.slug} came back too short (${html.length} chars)`)
  return html
}

function buildFallbackPage(ctx: FreeformCtx, plan: FreeformPlan, page: FreeformPageSpec): string {
  const facts = ctx.facts
  const business = cleanPlainText(facts.business_name || ctx.nicheLabel || 'Företaget')
  const city = facts.city ? ` i ${facts.city}` : ''
  const image = ctx.imagePool.find(Boolean) || ''
  const isHome = page.slug === 'index'
  const isContact = page.slug === 'kontakt'
  const isAbout = page.slug === 'om-oss'
  const sourceSummary = buildSourceSummary(ctx, page)
  const services = extractServiceIdeas(ctx, page).slice(0, isHome ? 3 : 6)
  const navHtml = buildNav(plan, business, page.slug)
  const ctas = buildCtaHtml(facts)
  const contact = buildContactCards(ctx)
  const title = isHome ? business : page.title
  const subline = isContact
    ? 'Här finns de tydligaste sätten att ta nästa steg. Ring eller mejla så blir det enkelt att komma vidare.'
    : isAbout
      ? `En modern presentation av ${business}, byggd för att kännas tydlig, personlig och lätt att agera på.`
      : `${ctx.nicheLabel}${city} med fokus på tydlig information, trygg känsla och ett enkelt nästa steg.`

  const heroImage = image ? `<img src="${escapeAttribute(image)}" alt="${escapeAttribute(business)}">` : ''
  const serviceCards = services.map((name, i) => `
        <article class="card">
          <p class="eyebrow">${escapeText(String(i + 1).padStart(2, '0'))}</p>
          <h3>${escapeText(name)}</h3>
          <p>${escapeText(serviceDescription(name, ctx))}</p>
        </article>`).join('')

  const body = isHome ? `
    <section class="hero">${heroImage}<div class="wrap">
      <p class="eyebrow">${escapeText(ctx.nicheLabel)}${city ? ` / ${escapeText(city.slice(3))}` : ''}</p>
      <h1>${escapeText(business)}</h1>
      <p class="lead lg">${escapeText(subline)}</p>
      ${ctas}
      <div class="tag-row"><span>Mobilvänlig</span><span>Tydlig kontakt</span><span>Premium känsla</span></div>
    </div></section>
    <section class="section"><div class="wrap split"><div><p class="eyebrow">Överblick</p><h2>En sida som gör valet lättare.</h2><p class="lead">${escapeText(sourceSummary)}</p></div><div class="card"><h3>Byggd kring verklig information</h3><p>Texten håller sig till det som finns i underlaget och fyller ut med trygg, branschrelevant vägledning där fakta är tunn.</p></div></div></section>
    <section class="section section-alt"><div class="wrap"><p class="eyebrow">Utvalt</p><h2>Tjänster och vägar in.</h2><div class="grid" style="margin-top:32px">${serviceCards}</div></div></section>
    <section class="section"><div class="wrap"><div class="cta-band"><p class="eyebrow">Nästa steg</p><h2>Vill du veta mer?</h2><p class="lead">Kontakta företaget direkt och välj den väg som passar bäst.</p>${ctas}</div></div></section>
    ${contact}` : isContact ? `
    <section class="page-hero">${heroImage}<div class="wrap"><p class="eyebrow">Kontakt</p><h1>${escapeText(title)}</h1><p class="lead">${escapeText(subline)}</p>${ctas}</div></section>
    ${contact}` : `
    <section class="page-hero">${heroImage}<div class="wrap"><p class="eyebrow">${escapeText(ctx.nicheLabel)}</p><h1>${escapeText(title)}</h1><p class="lead">${escapeText(subline)}</p></div></section>
    <section class="section"><div class="wrap split"><div><p class="eyebrow">Innehåll</p><h2>${escapeText(page.purpose || 'Tydlig information, utan krångel.')}</h2><p class="lead">${escapeText(sourceSummary)}</p>${ctas}</div><div class="stack">${serviceCards || '<article class="card"><h3>Tydligt nästa steg</h3><p>Kontakta företaget för mer information och bokning.</p></article>'}</div></div></section>
    ${contact}`

  return normalizeDocument(`<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeAttribute(buildMetaDescription(ctx))}">
  <title>${escapeText(title)} | ${escapeText(business)}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  ${navHtml}
  <main>
    ${body}
  </main>
  ${buildFooter(plan, business, ctx)}
</body>
</html>`, ctx)
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
    'freeform-language-pass',
    system,
    user,
    3200,
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
    `HEM (markdown):\n${takeSnippet(pages.home?.markdown || scraped.markdown || '', PLANNING_HOME_LIMIT)}`,
    pages.about ? `\nOM OSS (markdown):\n${takeSnippet(pages.about.markdown, PLANNING_ABOUT_LIMIT)}` : '',
    pages.services ? `\nTJÄNSTER (markdown):\n${takeSnippet(pages.services.markdown, PLANNING_SERVICES_LIMIT)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildPageSourceBlock(ctx: FreeformCtx, page: FreeformPageSpec, compact = false): string {
  const scraped = ctx.scraped ?? {}
  const pages = scraped.pages ?? {}
  const home = String(pages.home?.markdown ?? scraped.markdown ?? '')
  const about = String(pages.about?.markdown ?? '')
  const services = String(pages.services?.markdown ?? '')

  const pageSlug = page.slug
  const relevantBlocks: string[] = []

  const homeLimit = compact ? 1000 : PAGE_HOME_LIMIT
  const aboutLimit = compact ? 700 : PAGE_ABOUT_LIMIT
  const servicesLimit = compact ? 800 : PAGE_SERVICES_LIMIT

  if (pageSlug === 'index') {
    relevantBlocks.push(`HEM (viktigast):\n${takeSnippet(home, homeLimit)}`)
    if (services) relevantBlocks.push(`TJÄNSTER:\n${takeSnippet(services, Math.min(servicesLimit, 850))}`)
    if (about) relevantBlocks.push(`OM OSS:\n${takeSnippet(about, Math.min(aboutLimit, 650))}`)
  } else if (pageSlug === 'om-oss') {
    if (about) relevantBlocks.push(`OM OSS (viktigast):\n${takeSnippet(about, aboutLimit + 600)}`)
    relevantBlocks.push(`HEM:\n${takeSnippet(home, Math.min(homeLimit, 1000))}`)
    if (services) relevantBlocks.push(`TJÄNSTER:\n${takeSnippet(services, Math.min(servicesLimit, 750))}`)
  } else if (pageSlug === 'kontakt') {
    relevantBlocks.push(`HEM:\n${takeSnippet(home, Math.min(homeLimit, 1000))}`)
    if (about) relevantBlocks.push(`OM OSS:\n${takeSnippet(about, Math.min(aboutLimit, 650))}`)
  } else if (/tjanster|priser|vanliga-fragor|galleri|behandlingar|projekt/.test(pageSlug)) {
    if (services) relevantBlocks.push(`TJÄNSTER (viktigast):\n${takeSnippet(services, servicesLimit + 200)}`)
    relevantBlocks.push(`HEM:\n${takeSnippet(home, Math.min(homeLimit, 1100))}`)
    if (about) relevantBlocks.push(`OM OSS:\n${takeSnippet(about, Math.min(aboutLimit, 700))}`)
  } else {
    relevantBlocks.push(`HEM:\n${takeSnippet(home, Math.min(homeLimit, 1300))}`)
    if (about) relevantBlocks.push(`OM OSS:\n${takeSnippet(about, Math.min(aboutLimit, 800))}`)
    if (services) relevantBlocks.push(`TJÄNSTER:\n${takeSnippet(services, Math.min(servicesLimit, 900))}`)
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

function ensureCssSafetyNet(css: string): string {
  const safety = `
html,body{max-width:100%;overflow-x:hidden}
img,video,svg{max-width:100%;height:auto}
.site-header{z-index:50}
.nav-mobile summary{touch-action:manipulation}
@media(max-width:900px){.nav-desktop{display:none!important}.nav-mobile{display:block!important}.nav-drawer{max-width:calc(100vw - 32px)}}
@media(min-width:901px){.nav-mobile{display:none!important}.nav-desktop{display:flex!important}}
`
  return `${css}\n\n/* Botlio safety net: mobile navigation + overflow guard */\n${safety}`.trim()
}

function normalizeDocument(html: string, ctx: FreeformCtx): string {
  let out = html.trim()

  if (!/^<!doctype html>/i.test(out)) out = `<!DOCTYPE html>\n${out}`
  if (/<html(?![^>]*\blang=)/i.test(out)) out = out.replace(/<html/i, '<html lang="sv"')
  if (!/<body/i.test(out)) out = `${out}\n<body></body>`
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
  if (facts.phone) parts.push(`<a class="btn btn-primary" href="tel:${facts.phone.replace(/\s/g, '')}">Ring ${escapeText(facts.phone)}</a>`)
  if (facts.email) parts.push(`<a class="btn btn-secondary" href="mailto:${escapeAttribute(facts.email)}">Mejla oss</a>`)
  return parts.length ? `<div class="btn-row">${parts.join('')}</div>` : ''
}

function finalize(files: Record<string, string>, plan: FreeformPlan): Record<string, string> {
  const out = { ...files }
  if (!out['index.html']) {
    const firstHtml = Object.keys(out).find((name) => name.endsWith('.html'))
    if (firstHtml) out['index.html'] = out[firstHtml]
  }
  if (!out['style.css']) {
    out['style.css'] = ensureCssSafetyNet(':root{--primary:#111111;--background:#ffffff;--surface:#ffffff;--text-primary:#111111;--text-secondary:#555555}body{margin:0;font-family:system-ui,sans-serif;color:var(--text-primary);background:var(--background)}')
  }
  for (const page of plan.pages) {
    const fname = fileNameFor(page.slug)
    if (!out[fname]) out[fname] = buildFallbackPage({} as FreeformCtx, plan, page)
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
    if (out.length >= 36) break
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
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// Fallback page helpers
// ---------------------------------------------------------------------------
function buildNav(plan: FreeformPlan, business: string, activeSlug: string): string {
  const links = plan.pages.map((page) => {
    const href = fileNameFor(page.slug)
    const active = page.slug === activeSlug ? ' aria-current="page" class="active"' : ''
    return `<a href="${escapeAttribute(href)}"${active}>${escapeText(page.slug === 'index' ? 'Hem' : page.title)}</a>`
  }).join('')
  return `<header class="site-header"><div class="wrap nav-shell"><a class="brand" href="index.html">${escapeText(business)}</a><nav class="nav-desktop" aria-label="Huvudmeny">${links}</nav><details class="nav-mobile"><summary>Meny</summary><nav class="nav-drawer" aria-label="Mobilmeny">${links}</nav></details></div></header>`
}

function buildFooter(plan: FreeformPlan, business: string, ctx: FreeformCtx): string {
  const links = plan.pages.map((page) => `<a href="${escapeAttribute(fileNameFor(page.slug))}">${escapeText(page.slug === 'index' ? 'Hem' : page.title)}</a>`).join('<br>')
  const contact = [ctx?.facts?.phone, ctx?.facts?.email, [ctx?.facts?.address, ctx?.facts?.city].filter(Boolean).join(', ')].filter(Boolean).map(escapeText).join('<br>')
  return `<footer class="site-footer"><div class="wrap"><div class="footer-grid"><div><div class="footer-title">${escapeText(business)}</div><p>Demo skapad för en modernare digital kundupplevelse.</p></div><div><div class="footer-title">Navigering</div><p>${links}</p></div><div><div class="footer-title">Kontakt</div><p>${contact || 'Kontakta företaget för mer information.'}</p></div></div><p class="foot-bottom">© ${new Date().getFullYear()} ${escapeText(business)} — Demo skapad av Botlio</p></div></footer>`
}

function buildContactCards(ctx: FreeformCtx): string {
  const facts = ctx.facts
  const rows = [
    facts.phone ? `<article class="card"><h3>Telefon</h3><p><a href="tel:${escapeAttribute(facts.phone.replace(/\s+/g, ''))}">${escapeText(facts.phone)}</a></p></article>` : '',
    facts.email ? `<article class="card"><h3>E-post</h3><p><a href="mailto:${escapeAttribute(facts.email)}">${escapeText(facts.email)}</a></p></article>` : '',
    facts.address || facts.city ? `<article class="card"><h3>Adress</h3><p>${escapeText([facts.address, facts.city].filter(Boolean).join(', '))}</p></article>` : '',
  ].filter(Boolean).join('')
  if (!rows) return ''
  return `<section id="kontakt" class="section section-alt"><div class="wrap"><p class="eyebrow">Kontakt</p><h2>Ta nästa steg.</h2><div class="grid" style="margin-top:32px">${rows}</div></div></section>`
}

function buildSourceSummary(ctx: FreeformCtx, page: FreeformPageSpec): string {
  const scraped = ctx.scraped ?? {}
  const pages = scraped.pages ?? {}
  const raw = [
    page.slug === 'om-oss' ? pages.about?.summary || pages.about?.description || '' : '',
    /tjanster|behandlingar|priser/.test(page.slug) ? pages.services?.summary || pages.services?.description || '' : '',
    pages.home?.summary || scraped.summary || pages.home?.description || scraped.description || '',
    takeSnippet(pages.home?.markdown || scraped.markdown || '', 260),
  ].filter(Boolean).join(' ')
  const cleaned = cleanPlainText(raw)
  if (cleaned.length > 80) return cleaned.slice(0, 420)
  return `Här får besökaren en tydlig bild av ${ctx.facts.business_name || ctx.nicheLabel}: vad de erbjuder, hur kontakten tas och varför det känns tryggt att välja dem.`
}

function extractServiceIdeas(ctx: FreeformCtx, page: FreeformPageSpec): string[] {
  const raw = `${page.sections.join(' ')} ${ctx.scraped?.pages?.services?.markdown ?? ''} ${ctx.scraped?.pages?.home?.markdown ?? ctx.scraped?.markdown ?? ''}`
  const candidates = raw
    .split(/[\n•|,;]+/)
    .map((s) => cleanPlainText(s).replace(/^[-–—*\d.\s]+/, ''))
    .filter((s) => s.length >= 4 && s.length <= 56 && !/^https?:/i.test(s))
    .filter((s) => /klipp|färg|sling|balayage|styling|massage|hud|behandling|service|reparation|felsök|kontakt|boka|rådgiv/i.test(s))
  const out = dedupeLoose(candidates).slice(0, 6)
  if (out.length >= 3) return out
  if (/salon|fris|hair|beauty|skönhet|hud|spa|nail|klinik/i.test(`${ctx.nicheLabel} ${ctx.category ?? ''} ${ctx.facts.niche}`)) {
    return ['Personlig konsultation', 'Behandlingar med tydlig känsla', 'Rådgivning inför nästa steg', 'Kontakt och bokning']
  }
  return ['Tydlig rådgivning', 'Genomtänkt utförande', 'Smidig kontakt', 'Nästa steg utan krångel']
}

function serviceDescription(name: string, ctx: FreeformCtx): string {
  if (/konsult|rådgiv/i.test(name)) return 'Ett lugnt första steg där behov, förväntningar och rätt väg framåt blir tydliga.'
  if (/kontakt|boka/i.test(name)) return 'Gör det enkelt för kunden att ringa eller mejla utan formulär, friktion eller osäkerhet.'
  if (/klipp|färg|sling|balayage|styling|hud|massage|behandling/i.test(name)) return 'Presenterat med fokus på känsla, kvalitet och ett resultat som passar kunden i vardagen.'
  return `En tydlig presentation av ${ctx.nicheLabel.toLowerCase()}ens erbjudande, skriven utan påhittade priser eller löften.`
}

function dedupeLoose(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase().replace(/[^a-zåäö0-9]+/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
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
  const designSource = raw?.design?.source === 'fallback' ? 'fallback' : raw?.design?.source === 'ai' ? 'ai' : undefined
  const fallbacksUsed = Array.isArray(raw?.fallbacksUsed)
    ? raw!.fallbacksUsed!.map((v) => cleanPlainText(String(v))).filter(Boolean).slice(0, 12)
    : []

  if (!plan) {
    return withProgressMeta({
      version: PROGRESS_VERSION,
      stage: 'plan',
      built: [],
      polished: [],
      fallbacksUsed,
      lastError: raw?.lastError,
      lastStage: raw?.lastStage,
    })
  }

  let nextStage: FreeformStage = stage
  if (!hasUsableCss(files) && stage !== 'done') nextStage = 'design'
  else if (built.length < plan.pages.length) nextStage = 'pages'
  else if (polished.length < plan.pages.length && stage !== 'done') nextStage = 'polish'
  else if (polished.length >= plan.pages.length) nextStage = 'done'

  return withProgressMeta({
    version: PROGRESS_VERSION,
    stage: nextStage,
    plan,
    design: designNote ? { designNote, source: designSource } : undefined,
    built,
    polished,
    fallbacksUsed,
    lastError: raw?.lastError,
    lastStage: raw?.lastStage,
  })
}

function withProgressMeta(progress: FreeformProgress): FreeformProgress {
  return {
    ...progress,
    version: PROGRESS_VERSION,
    model: BUILD_MODEL,
    updatedAt: new Date().toISOString(),
  }
}

function addFallback(progress: FreeformProgress, label: string): string[] {
  const current = Array.isArray(progress.fallbacksUsed) ? progress.fallbacksUsed : []
  return Array.from(new Set([...current, label])).slice(0, 12)
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
  return typeof files['style.css'] === 'string' && files['style.css'].trim().length > 900
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
  return String(s || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim()
}

function takeSnippet(value: string, limit: number): string {
  return String(value || '').trim().slice(0, limit)
}

function cleanPlainText(value: string): string {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildCssPromptContext(css: string, compact = false): string {
  const cleaned = sanitizeCss(css).replace(/\s+/g, ' ').trim()
  if (!cleaned) return '[ingen befintlig CSS]'
  const rootBlock = cleaned.match(/:root\s*\{[^}]*\}/i)?.[0] ?? ''
  const focus = [rootBlock, cleaned].filter(Boolean).join('\n')
  return takeSnippet(focus, compact ? 1500 : CSS_PROMPT_LIMIT)
}

function buildImagePromptContext(images: string[], compact = false): string {
  const picked = images.filter(Boolean).slice(0, compact ? 3 : IMAGE_PROMPT_LIMIT)
  return picked.length ? picked.join('\n') : '[inga bilder — bygg utan foton, använd färg, komposition och typografi]'
}

function shouldRetryCompact(err: unknown): boolean {
  const msg = (err as Error)?.message || ''
  return (err as Error)?.name === 'AbortError'
    || /timed out/i.test(msg)
    || /returned empty content/i.test(msg)
    || /came back too short/i.test(msg)
    || /JSON/i.test(msg)
}

function normalizePalette(input: Record<string, string>, niche: string): Record<string, string> {
  const salon = /hair|salon|beauty|hud|spa|nail|klinik/i.test(niche)
  const defaults = salon
    ? { primary: '#9a5f6a', secondary: '#c7a78a', accent: '#d6b98c', background: '#f7f2ed', surface: '#fffaf6', textPrimary: '#2d2525', textSecondary: '#665a57' }
    : { primary: '#f97316', secondary: '#0ea5e9', accent: '#f59e0b', background: '#0a0e1a', surface: '#131a2b', textPrimary: '#f1f5f9', textSecondary: '#cbd5e1' }
  const raw = { ...defaults, ...(input ?? {}) }
  const background = cssColor(raw.background, defaults.background)
  const surface = cssColor(raw.surface, defaults.surface)
  const primary = cssColor(raw.primary, defaults.primary)
  const secondary = cssColor(raw.secondary, defaults.secondary)
  const accent = cssColor(raw.accent, defaults.accent)
  const textPrimary = cssColor(raw.textPrimary, defaults.textPrimary)
  const textSecondary = cssColor(raw.textSecondary, defaults.textSecondary)
  const light = isLightColor(background)
  return {
    primary,
    secondary,
    accent,
    background,
    surface,
    surfaceStrong: light ? '#ffffff' : '#182033',
    textPrimary: ensureReadable(background, textPrimary, light ? '#251d1d' : '#ffffff'),
    textSecondary: ensureReadable(background, textSecondary, light ? '#5f5350' : '#d8d0ca'),
    onPrimary: pickBestContrast(primary, '#ffffff', '#241b1b'),
    onPrimaryMuted: pickBestContrast(primary, '#f8efea', '#3d302d'),
    border: light ? 'rgba(54,42,38,.13)' : 'rgba(255,255,255,.13)',
    shadow: light ? 'rgba(70,50,43,.12)' : 'rgba(0,0,0,.34)',
  }
}

function fontStack(font: string | undefined, fallback: string): string {
  const clean = String(font || '').replace(/[^a-zA-Z0-9 åäöÅÄÖ_-]/g, '').trim().slice(0, 70)
  return clean ? `"${clean}",${fallback}` : fallback
}

function cssColor(value: string, fallback: string): string {
  const v = String(value || '').trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || /^rgb(a)?\([^)]+\)$/i.test(v) || /^[a-z]+$/i.test(v) ? v : fallback
}

function ensureReadable(background: string, preferred: string, fallback: string): string {
  if (contrastRatio(background, preferred) >= 4.5) return preferred
  if (contrastRatio(background, fallback) >= 4.5) return fallback
  return pickBestContrast(background, '#111111', '#ffffff')
}

function pickBestContrast(background: string, optionA: string, optionB: string): string {
  return contrastRatio(background, optionA) >= contrastRatio(background, optionB) ? optionA : optionB
}

function isLightColor(color: string): boolean {
  return relativeLuminance(color) > 0.56
}

function contrastRatio(a: string, b: string): number {
  const lumA = relativeLuminance(a)
  const lumB = relativeLuminance(b)
  const light = Math.max(lumA, lumB)
  const dark = Math.min(lumA, lumB)
  return (light + 0.05) / (dark + 0.05)
}

function relativeLuminance(color: string): number {
  const rgb = parseCssColor(color)
  if (!rgb) return 0
  const channels = [rgb.r, rgb.g, rgb.b].map((value) => {
    const srgb = value / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function parseCssColor(color: string): { r: number; g: number; b: number } | null {
  const value = String(color || '').trim().toLowerCase()
  if (/^#([0-9a-f]{3})$/i.test(value)) {
    const hex = value.slice(1)
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    }
  }
  if (/^#([0-9a-f]{6})$/i.test(value)) {
    return {
      r: parseInt(value.slice(1, 3), 16),
      g: parseInt(value.slice(3, 5), 16),
      b: parseInt(value.slice(5, 7), 16),
    }
  }
  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (rgb) {
    return {
      r: Math.max(0, Math.min(255, Number(rgb[1]))),
      g: Math.max(0, Math.min(255, Number(rgb[2]))),
      b: Math.max(0, Math.min(255, Number(rgb[3]))),
    }
  }
  if (value === 'white') return { r: 255, g: 255, b: 255 }
  if (value === 'black') return { r: 0, g: 0, b: 0 }
  return null
}

async function callModelWithCompactRetry(args: {
  key: string
  model: string
  label: string
  system: string
  user: string
  maxTokens: number
  timeoutMs: number
  jsonMode: boolean
  retryUser: string
  retryMaxTokens: number
  retryTimeoutMs: number
}): Promise<string> {
  const {
    key,
    model,
    label,
    system,
    user,
    maxTokens,
    timeoutMs,
    jsonMode,
    retryUser,
    retryMaxTokens,
    retryTimeoutMs,
  } = args

  try {
    return await callModel(key, model, `${label}:primary`, system, user, maxTokens, timeoutMs, jsonMode)
  } catch (err) {
    if (!shouldRetryCompact(err)) throw err
    return await callModel(key, model, `${label}:compact-retry`, system, retryUser, retryMaxTokens, retryTimeoutMs, jsonMode)
  }
}

async function callModel(
  key: string,
  model: string,
  label: string,
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
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s on ${model}`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}
