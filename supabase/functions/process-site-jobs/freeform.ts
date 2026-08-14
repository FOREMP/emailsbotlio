import {
  pagesForTemplate,
  selectBlockTemplateFamily,
  templateDirective,
  templatePromptNotes,
  type BlockTemplateFamilyKey,
} from './block-templates.ts'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const BUILD_MODEL = 'deepseek/deepseek-v4-flash-0731'
export const BUILD_FALLBACK_MODEL = 'deepseek/deepseek-chat-v3.1'
export const BUILD_LAST_RESORT_MODEL = 'openai/gpt-4o-mini'
export const LANG_MODEL = 'openai/gpt-4o-mini'
const VERSION = 10
const MAX_PAGES = 6
type Stage = 'plan' | 'theme' | 'content' | 'polish_content' | 'render' | 'quality_check' | 'done'

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
  language?: 'sv' | 'en'
  progress: FreeformProgress | null
}
export interface FreeformPageSpec { slug: string; title: string; purpose: string; sections: string[]; pageKind?: 'landing' | 'services' | 'process' | 'about' | 'faq' | 'contact'; templateFamily?: BlockTemplateFamilyKey }
export interface FreeformPlan { designDirective?: string; templateFamily?: BlockTemplateFamilyKey; templateLabel?: string; templateNotes?: string[]; pages: FreeformPageSpec[] }
export interface BusinessProfile {
  category: string
  businessType: string
  venueNoun: string
  servicePlural: string
  aboutTitle: string
  heroEyebrow: string
  servicesHeading: string
  servicesLead: string
  isBeauty: boolean
  isClinic: boolean
  kind?: string

}
export interface FactPack {
  category: string
  facts: FreeformFacts
  sourceSummary: string
  services: string[]
  warnings: string[]
}
export interface FreeformPageContent {
  metaTitle?: string
  metaDescription?: string
  heroEyebrow?: string
  heroTitle?: string
  heroLead?: string
  introTitle?: string
  introText?: string
  primaryCta?: string
  secondaryCta?: string
  services?: { title: string; text: string; detail?: string }[]
  sections?: { eyebrow?: string; title: string; text: string; bullets?: string[] }[]
  faqs?: { question: string; answer: string }[]
  faqGroups?: { title: string; items: { question: string; answer: string }[] }[]
  closingTitle?: string
  closingText?: string
  source?: 'ai' | 'fallback' | 'polished'
}
export interface FreeformProgress {
  version?: number
  stage: Stage | 'design' | 'pages' | 'polish'
  plan?: FreeformPlan
  profile?: BusinessProfile
  factPack?: FactPack
  theme?: { designNote?: string; source?: string; cssVersion?: number }
  design?: { designNote?: string; source?: string }
  content?: Record<string, FreeformPageContent>
  rendered?: string[]
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

export async function runFreeformStep(ctx: FreeformCtx, existingFiles: Record<string, string>): Promise<FreeformStepResult> {
  const keep = ctx.progress?.version === VERSION
  const files = keep ? { ...(existingFiles ?? {}) } : {}
  const progress = normalizeProgress(keep ? ctx.progress : null, files, ctx)
  console.log(`[freeform-v${VERSION}] site=${ctx.siteId} stage=${progress.stage} category=${ctx.category || 'missing'}`)
  if (progress.stage === 'plan' || !progress.plan) {
    const plan = buildPlan(ctx)
    return step(false, files, meta({ ...progress, stage: 'theme', plan, profile: buildProfile(ctx), factPack: buildFactPack(ctx), content: {}, rendered: [], built: [], polished: [], lastStage: 'plan' }), `v${VERSION} plan ready: ${plan.pages.map((p) => p.slug).join(', ')}`)
  }
  const plan = progress.plan
  if (progress.stage === 'theme' || !files['style.css'] || files['style.css'].length < 1200) {
    files['style.css'] = buildCss(ctx, plan)
    return step(false, files, meta({ ...progress, profile: progress.profile ?? buildProfile(ctx), factPack: progress.factPack ?? buildFactPack(ctx), stage: 'content', theme: { designNote: `Template/block renderer: ${plan.templateLabel || plan.templateFamily || 'default'}`, source: 'template-blocks', cssVersion: VERSION }, design: { designNote: `Template/block renderer: ${plan.templateLabel || plan.templateFamily || 'default'}`, source: 'template-blocks' }, lastStage: 'theme' }), `v${VERSION} theme ready`)
  }
  if (progress.stage === 'content') {
    const content = cleanContentMap(progress.content)
    const next = plan.pages.find((p) => !content[p.slug])
    if (next) {
      const got = await pageContent(ctx, plan, next)
      content[next.slug] = got.content
      const done = plan.pages.every((p) => content[p.slug])
      return step(false, files, meta({ ...progress, stage: done ? 'polish_content' : 'content', content, lastStage: `content:${next.slug}`, lastError: got.error ?? progress.lastError, fallbacksUsed: got.source === 'fallback' ? addFallback(progress, `content:${next.slug}`) : progress.fallbacksUsed }), `${got.source} content ready for ${next.slug}${got.model ? ` via ${got.model}` : ''}`)
    }
    return step(false, files, meta({ ...progress, stage: 'polish_content', content, lastStage: 'content:complete' }), 'v7 content complete')
  }
  if (progress.stage === 'polish_content') {
    const content = cleanContentMap(progress.content)
    const polished = Array.isArray(progress.polished) ? progress.polished : []
    const next = plan.pages.find((p) => content[p.slug] && !polished.includes(p.slug))
    if (next) {
      const got = await polishContent(ctx, plan, next, content[next.slug])
      content[next.slug] = repairContent(ctx, got.content)
      const nowPolished = Array.from(new Set([...polished, next.slug]))
      const done = plan.pages.every((p) => nowPolished.includes(p.slug))
      return step(false, files, meta({ ...progress, stage: done ? 'render' : 'polish_content', content, polished: nowPolished, lastStage: `polish:${next.slug}`, lastError: got.error ?? progress.lastError, fallbacksUsed: got.source === 'fallback' ? addFallback(progress, `polish:${next.slug}`) : progress.fallbacksUsed }), `${got.source} polish ready for ${next.slug}${got.model ? ` via ${got.model}` : ''}`)
    }
    return step(false, files, meta({ ...progress, stage: 'render', content, lastStage: 'polish:complete' }), 'v7 polish complete')
  }
  if (progress.stage === 'render') {
    const content = cleanContentMap(progress.content)
    for (const p of plan.pages) files[fileNameFor(p.slug)] = render(ctx, plan, p, repairContent(ctx, content[p.slug] ?? fallbackContent(ctx, p)))
    return step(false, files, meta({ ...progress, stage: 'quality_check', rendered: plan.pages.map((p) => p.slug), built: plan.pages.map((p) => p.slug), lastStage: 'render' }), `v${VERSION} rendered ${plan.pages.length} pages`)
  }
  if (progress.stage === 'quality_check') {
    const checked = qualityFixFiles(files, isEnglish(ctx))
    return step(true, checked, meta({ ...progress, stage: 'done', lastStage: 'quality_check' }), `v${VERSION} quality checked`)
  }
  return step(true, files, meta({ ...progress, stage: 'done', lastStage: 'done' }), 'v7 done')
}

function step(done: boolean, files: Record<string, string>, progress: FreeformProgress, note: string): FreeformStepResult {
  return { done, files, progress, note }
}
function meta(p: FreeformProgress): FreeformProgress {
  return { ...p, version: VERSION, updatedAt: new Date().toISOString() }
}

function isEnglish(ctx: FreeformCtx): boolean {
  return ctx.language === 'en'
}

function buildPlan(ctx: FreeformCtx): FreeformPlan {
  const profile = buildProfile(ctx)
  const business = ctx.facts.business_name || ctx.nicheLabel || 'Företaget'
  const family = selectBlockTemplateFamily({
    category: ctx.category,
    niche: ctx.facts.niche,
    nicheLabel: ctx.nicheLabel,
    businessName: ctx.facts.business_name,
    source: sourceFor(ctx, { slug: 'index', title: '', purpose: '', sections: [] }),
  })
  const pages = pagesForTemplate(family, {
    business,
    serviceTitle: profile.servicePlural,
    aboutTitle: profile.aboutTitle,
    includeFaqPage: shouldIncludeFaqPage(ctx, profile, family.key),
  }).slice(0, MAX_PAGES).map((page) => ({ ...page, templateFamily: family.key }))
  return {
    designDirective: templateDirective(family),
    templateFamily: family.key,
    templateLabel: family.label,
    templateNotes: [...family.notesFromEric, ...family.aiDecisionNotes],
    pages,
  }
}

// --------------------------------------------------------------------------
// Business classification.
// Priority: uploaded lead CATEGORY -> niche tag -> company name -> source text.
// The scraped page text is only consulted when nothing else says anything,
// because loose substring matching on body copy used to turn electricians into
// hair salons ("huvud" matched /hud/, "spara" matched /spa/, ...).
// --------------------------------------------------------------------------
type BizKind =
  | 'hair' | 'nails' | 'beauty' | 'clinic' | 'massage'
  | 'electrical' | 'plumbing' | 'construction' | 'auto'
  | 'cleaning' | 'restaurant' | 'general'

const KIND_RULES: { kind: BizKind; label: string; re: RegExp }[] = [
  { kind: 'electrical', label: 'Elfirma', re: /(elektriker|elfirma|elinstallat|elentreprenad|eltekni|elservice|elarbete|electrician|electrical)/ },
  { kind: 'plumbing', label: 'VVS- och rörfirma', re: /(rörmokar|rormokar|rörfirma|\bvvs\b|plumber|plumbing|avloppsspol)/ },
  { kind: 'construction', label: 'Byggföretag', re: /(byggfirma|byggföretag|byggservice|byggnadsfirma|\bbygg\b|snickar|snickeri|murar|mureri|plattsätt|kakelsätt|badrumsrenover|renoveringsfirma|takläggar|takarbete|fasadarbete|målerifirma|måleri|markarbete|markentrepren|anläggningsfirma|betongarbete|construction|builder|contractor|roofing|carpenter)/ },
  { kind: 'auto', label: 'Bilverkstad', re: /(bilverkstad|bilservice|bilrekond|däckverkstad|dackverkstad|däckhotell|billack|bilplåt|bilglas|motorverkstad|mekaniker|auto repair|car repair|auto shop|mechanic|tyre shop)/ },
  { kind: 'hair', label: 'Frisörsalong', re: /(frisör|frisor|hairdress|hair salon|\bhair\b|barbershop|barber|herrfrisör|damfrisör)/ },
  { kind: 'nails', label: 'Nagelstudio', re: /(nagelsalong|nagelstudio|nagelteknolog|nail salon|\bnails\b|manikyr|pedikyr)/ },
  { kind: 'clinic', label: 'Klinik', re: /(klinik|clinic|hudterapeut|hudvård|skin care|botox|fillers|injektionsbehandling|laserklinik|medicinsk|tandläkare|dentist|fysioterap|naprapat|kiropraktor|vårdcentral)/ },
  { kind: 'massage', label: 'Massage', re: /(massage|massör|massor\b|massageterapeut|\bspa\b|spaanläggning)/ },
  { kind: 'beauty', label: 'Skönhetssalong', re: /(skönhetssalong|skönhetsstudio|beauty salon|\bbeauty\b|fransstylist|frans- och bryn|brynstylist|lash|brow|makeup|make-up)/ },
  { kind: 'cleaning', label: 'Städfirma', re: /(städfirma|städservice|städbolag|lokalvård|flyttstäd|fönsterputs|cleaning service)/ },
  { kind: 'restaurant', label: 'Restaurang', re: /(restaurang|restaurant|pizzeria|\bcafé\b|\bcafe\b|bageri|catering|bistro)/ },
]

const NEUTRAL_NICHE = /^(other|okänd|unknown|)$/i

function matchKind(text: string): { kind: BizKind; label: string } | null {
  const x = clean(decodeText(text)).toLowerCase()
  if (!x) return null
  for (const rule of KIND_RULES) if (rule.re.test(x)) return { kind: rule.kind, label: rule.label }
  return null
}

function buildProfile(ctx: FreeformCtx): BusinessProfile {
  const en = isEnglish(ctx)
  const category = clean(decodeText(ctx.category || '')).toLowerCase()
  const nicheTag = NEUTRAL_NICHE.test(String(ctx.facts.niche || '')) ? '' : String(ctx.facts.niche || '')
  const companyName = clean(decodeText(ctx.facts.business_name || ''))

  // 1) Uploaded category is the authority.
  let hit = matchKind(category)
  // 2) Manual niche tag, only when no category was uploaded.
  if (!hit && !category) hit = matchKind(`${nicheTag} ${ctx.nicheLabel || ''}`)
  // 3) Company name, then the scraped source text as a last resort.
  if (!hit) hit = matchKind(companyName)
  if (!hit && !category && !nicheTag) {
    hit = matchKind(clean(sourceFor(ctx, { slug: 'index', title: '', purpose: '', sections: [] })).slice(0, 4000))
  }

  const kind: BizKind = hit?.kind ?? 'general'
  const clinic = kind === 'clinic' || kind === 'massage'
  const salon = kind === 'hair'
  const beauty = clinic || salon || kind === 'nails' || kind === 'beauty'

  // Business type: prefer a clean label from the matched kind, but keep the
  // uploaded category wording when it is short and specific.
  let businessType = hit?.label || ''
  if (category && category.length <= 34 && !/,|;/.test(category)) businessType = category
  if (!businessType) businessType = nicheTag ? titleCaseSv(nicheTag.replace(/_/g, ' ')) : (en ? 'Business' : 'Företag')
  businessType = titleCaseSv(businessType)

  const city = ctx.facts.city ? `${en ? ' in ' : ' i '}${decodeText(ctx.facts.city)}` : ''
  const venueNoun = en
    ? clinic ? 'clinic' : salon ? 'salon' : kind === 'nails' || kind === 'beauty' ? 'studio' : kind === 'restaurant' ? 'restaurant' : 'business'
    : clinic ? 'kliniken' : salon ? 'salongen' : kind === 'nails' || kind === 'beauty' ? 'studion' : kind === 'restaurant' ? 'restaurangen' : 'verksamheten'
  const servicePlural = en ? (beauty ? 'Treatments' : 'Services') : (beauty ? 'Behandlingar' : 'Tjänster')
  const aboutTitle = en
    ? clinic ? 'About the clinic' : salon ? 'About the salon' : kind === 'nails' || kind === 'beauty' ? 'About the studio' : 'About us'
    : clinic ? 'Om kliniken' : salon ? 'Om salongen' : kind === 'nails' || kind === 'beauty' ? 'Om studion' : 'Om oss'

  return {
    category: ctx.category || nicheTag || '',
    businessType,
    venueNoun,
    servicePlural,
    aboutTitle,
    heroEyebrow: `${businessType}${city}`,
    servicesHeading: en
      ? beauty ? 'Treatments presented clearly.' : 'Services explained clearly.'
      : beauty ? 'Behandlingar med tydlig väg in.' : 'Tjänster som är lätta att förstå.',
    servicesLead: en
      ? beauty
        ? 'The visitor should quickly understand what is offered, what fits, and how to take the next step.'
        : 'The offer should feel concrete, clear and easy to act on.'
      : beauty
        ? 'Besökaren ska snabbt förstå vad som erbjuds, vad som passar och hur nästa steg tas.'
        : 'Erbjudandet presenteras konkret med tydliga vägar till kontakt.',
    isBeauty: beauty,
    isClinic: clinic,
    kind,
  }
}


function buildFactPack(ctx: FreeformCtx): FactPack {
  const all = decodeText(sourceFor(ctx, { slug: 'index', title: '', purpose: '', sections: [] }))
  return {
    category: ctx.category || ctx.nicheLabel || '',
    facts: { ...ctx.facts, address: decodeText(ctx.facts.address || ''), city: decodeText(ctx.facts.city || '') },
    sourceSummary: all.slice(0, 1600),
    services: serviceIdeas(ctx),
    warnings: ctx.category ? [] : ['Lead saknar category; använder fallback från niche/source.'],
  }
}

async function pageContent(ctx: FreeformCtx, plan: FreeformPlan, page: FreeformPageSpec): Promise<{ source: 'ai' | 'fallback'; content: FreeformPageContent; error?: string; model?: string }> {
  const profile = buildProfile(ctx)
  const pack = buildFactPack(ctx)
  const system = `${isEnglish(ctx)
    ? 'You are writing the first draft for a premium English-language website. If any instruction below is in Swedish, interpret it and still produce final website copy in natural English. Respond only with JSON. No HTML. No CSS.'
    : 'Du skriver första utkastet till innehåll för en svensk premium-webbplats. Svara endast med JSON. Ingen HTML. Ingen CSS.'}
HÅRDA REGLER:
- ${isEnglish(ctx) ? 'All final text must be in English. Translate Swedish source material when needed.' : 'All text ska vara på svenska. Översätt källtext som är på engelska.'}
- VERKSAMHETSTYPEN i profilen (härledd från uppladdad kategori) är sanning. Skriv ALDRIG om en annan bransch.
- Om källtexten tydligt motsäger verksamhetstypen (t.ex. el, rör, bygg, bil) ska du följa källtexten, aldrig en skönhets- eller salongsvinkel.
- Använd bara branschord som passar verksamheten. Skriv inte "behandling", "salong" eller "klinik" om det inte är ett skönhets-/vårdföretag.

- Skriv som företaget, aldrig som systemet. Skriv inte "sidan visar", "webbplatsen är byggd", "AI" eller "demo".
- Hitta aldrig på priser, årtal, certifikat, kundnamn, recensioner, personalnamn eller öppettider.
- Använd bara tjänster/behandlingar från godkänd tjänstelista eller tydlig källtext.
- FAQ ska hjälpa riktig kund att boka/förstå behandlingar, inte handla om webbplatsen.
- Följ vald templatefamilj och blockordning. Blocken styr struktur/känsla; du fyller dem med företagets fakta.
- Om templatefamiljen är restaurant landingpage: skriv bara restaurang/bar/café-relevant text och håll allt för index.html.
- Om templatefamiljen är editorial service: gör texten varmare och mer premium, men fortfarande saklig och baserad på kategori/källa.
- Om sidan är FAQ: använd faqGroups med 2-3 kategorier och bara frågor som passar företagets kategori/källa. Hellre färre bra frågor än många generiska.
- Om underlaget är tunt: skriv elegant och branschrelevant men försiktigt.
- Varje textfält max 45 ord.
Schema: {"metaTitle":"","metaDescription":"","heroEyebrow":"","heroTitle":"","heroLead":"","introTitle":"","introText":"","primaryCta":"","secondaryCta":"","services":[{"title":"","text":"","detail":""}],"sections":[{"eyebrow":"","title":"","text":"","bullets":[""]}],"faqs":[{"question":"","answer":""}],"faqGroups":[{"title":"","items":[{"question":"","answer":""}]}],"closingTitle":"","closingText":""}`
  const user = [
    `Företag: ${ctx.facts.business_name || '[okänt]'}`,
    `UPPLADDAD LEAD-KATEGORI (primär signal): ${ctx.category || '[saknas]'}`,
    `Profil: ${JSON.stringify(profile)}`,
    `Stad: ${ctx.facts.city || '[saknas]'}`,
    `Sida: ${page.slug} - ${page.title}`,
    `Syfte: ${page.purpose}`,
    `Templatefamilj: ${plan.templateLabel || plan.templateFamily || '[saknas]'}`,
    `Template/block-instruktioner:\n${templatePromptNotes(selectBlockTemplateFamily({
      category: ctx.category,
      niche: ctx.facts.niche,
      nicheLabel: ctx.nicheLabel,
      businessName: ctx.facts.business_name,
      source: sourceFor(ctx, page),
    }), page)}`,
    ctx.regenFeedback ? `Feedback: ${ctx.regenFeedback}` : '',
    `Alla sidor: ${plan.pages.map((p) => p.slug + ':' + p.title).join(', ')}`,
    'Faktapaket som får användas:',
    JSON.stringify(pack),
    'Källtext:',
    sourceFor(ctx, page).slice(0, 2200) || '[Tunt underlag. Använd säker branschcopy utan påhittade fakta.]',
  ].filter(Boolean).join('\n')
  try {
    const got = await callBuildModelCascade(ctx, ctx.openrouterKey, `freeform-v7-content:${page.slug}`, system, user, 3000)
    const raw = got.text
    const parsed = parseJson(raw)
    const c = repairContent(ctx, cleanContent(parsed, ctx, page))
    if (!c.heroTitle || !c.heroLead) throw new Error('missing hero fields')
    return { source: 'ai', content: { ...c, source: 'ai' }, model: got.model }
  } catch (e) {
    const error = (e as Error).message
    console.warn(`[freeform-v7] content fallback for ${page.slug}: ${error}`)
    return { source: 'fallback', content: fallbackContent(ctx, page), error }
  }
}

async function polishContent(ctx: FreeformCtx, plan: FreeformPlan, page: FreeformPageSpec, draft: FreeformPageContent): Promise<{ source: 'polished' | 'fallback'; content: FreeformPageContent; error?: string; model?: string }> {
  const profile = buildProfile(ctx)
  const pack = buildFactPack(ctx)
  const system = `${isEnglish(ctx)
    ? 'You are a senior English editor and conversion copywriter. You receive JSON content for one page. Rewrite it into natural, polished English and improve thin content carefully using the approved fact pack.'
    : 'Du är en senior svensk redaktör och conversion copywriter. Du får JSON-innehåll till EN sida. Uppgift: skriv om till naturlig, korrekt, premium svensk text och fyll ut tunt innehåll med försiktig, relevant copy från faktapaketet.'}

HÅRDA REGLER:
- Svara endast med samma JSON-schema. Ingen markdown.
- Behåll hårda fakta exakt: namn, telefon, e-post, adress, stad.
- Lägg aldrig till priser, årtal, certifikat, kundnamn, recensioner, personalnamn eller öppettider.
- ${isEnglish(ctx) ? 'All final text must be English.' : 'All text ska vara svenska. Ingen engelska.'}
- Ta bort allt som låter internt: "sidan", "webbplats", "demo", "AI", "anpassad efter företaget".
- Korrigera mojibake, t.ex. VÃ¥rvÃ¤dersvÃ¤gen -> Vårvädersvägen.
- FAQ ska vara kundnyttig och verksamhetsspecifik.
- Service-titlar ska vara korta riktiga tjänster/behandlingar, inte meningar eller instruktioner.
- Följ profilens verksamhetstyp. Använd ord som klinik/behandling/salong ENBART för skönhets- och vårdföretag. För el, rör, bygg, bil, städ m.fl. används tjänst, uppdrag, installation, service.
- Behåll vald templatefamiljs känsla: restaurang = stämning/mat/besök; editorial service = varm premium service; practical service = tydlig trygghet/process.
- Texten ska aldrig låta som intern malltext. Ta bort generiska rader som "Besökaren får..." och skriv i företagets röst.
- För FAQ-sidor: gruppera frågorna i faqGroups. Använd bara grupper som faktiskt passar verksamheten, exempelvis Första kontakt, Planering, Omfattning, Besök, Genomförande eller Praktiska frågor.
- Om utkastet beskriver fel bransch: skriv om det så att det matchar profilens verksamhetstyp och källtexten.`
  const user = [
    `Sida: ${page.slug} - ${page.title}`,
    `Profil från uppladdad kategori: ${JSON.stringify(profile)}`,
    `Templatefamilj: ${plan.templateLabel || plan.templateFamily || '[saknas]'}`,
    `Template/block-instruktioner:\n${templatePromptNotes(selectBlockTemplateFamily({
      category: ctx.category,
      niche: ctx.facts.niche,
      nicheLabel: ctx.nicheLabel,
      businessName: ctx.facts.business_name,
      source: sourceFor(ctx, page),
    }), page)}`,
    `Faktapaket: ${JSON.stringify(pack)}`,
    `Alla sidor: ${plan.pages.map((p) => p.slug + ':' + p.title).join(', ')}`,
    ctx.regenFeedback ? `Feedback: ${ctx.regenFeedback}` : '',
    'Utkast från DeepSeek:',
    JSON.stringify(draft),
  ].filter(Boolean).join('\n')
  try {
    const raw = await callModel(ctx.openrouterKey, LANG_MODEL, `freeform-v7-polish:${page.slug}`, system, user, 3000, 36_000)
    const parsed = parseJson(raw)
    const c = repairContent(ctx, cleanContent(parsed, ctx, page))
    if (!c.heroTitle || !c.heroLead) throw new Error('polish missing hero fields')
    return { source: 'polished', content: { ...c, source: 'polished' }, model: LANG_MODEL }
  } catch (e) {
    const error = (e as Error).message
    console.warn(`[freeform-v7] polish fallback for ${page.slug}: ${error}`)
    return { source: 'fallback', content: repairContent(ctx, draft), error }
  }
}

function fallbackContent(ctx: FreeformCtx, page: FreeformPageSpec): FreeformPageContent {
  const profile = buildProfile(ctx)
  const business = ctx.facts.business_name || ctx.nicheLabel || 'Företaget'
  const city = ctx.facts.city ? ` i ${ctx.facts.city}` : ''
  const salon = profile.isBeauty
  const services = serviceIdeas(ctx).map((title) => ({ title, text: serviceText(title, salon), detail: salon ? 'Vi hjälper dig förstå vad som passar innan du tar nästa steg.' : 'Presenterat tydligt så kunden förstår nästa steg.' }))
  return {
    metaTitle: `${page.title} | ${business}`,
    metaDescription: `${business}${city} - ${profile.businessType.toLowerCase()} med tydlig information om ${profile.servicePlural.toLowerCase()} och kontakt.`,
    heroEyebrow: profile.heroEyebrow,
    heroTitle: page.slug === 'index' ? (profile.isClinic ? 'Trygga behandlingar med personlig vägledning' : salon ? 'En upplevelse som känns rätt från start' : `En tydligare väg till ${business}`) : page.title,
    heroLead: profile.isClinic ? `${business}${city} erbjuder ${profile.servicePlural.toLowerCase()} med fokus på trygghet, personlig service och enkel kontakt.` : salon ? `${business}${city} presenterar ${profile.servicePlural.toLowerCase()} med varm känsla, tydlig rådgivning och enkel bokning.` : `${business}${city} presenterar tjänster, förtroende och kontakt på ett tydligt sätt.`,
    introTitle: page.slug === 'index' ? (profile.isClinic ? 'Trygg väg in till rätt behandling' : 'Ett första intryck som känns genomarbetat') : page.title,
    introText: sourceFor(ctx, page).slice(0, 360) || `Här får besökaren snabbt förstå vad ${business} erbjuder och hur kontakten tas.`,
    primaryCta: ctx.facts.phone ? 'Ring oss' : 'Kontakta oss',
    secondaryCta: ctx.facts.email ? 'Mejla oss' : 'Kontakt',
    services,
    sections: [
      { eyebrow: salon ? 'Trygghet' : 'Förtroende', title: profile.isClinic ? 'Rätt behandling börjar med tydlig information' : salon ? 'Varmt, noggrant och lätt att välja' : 'Tydligt, tryggt och lätt att förstå', text: profile.isClinic ? `${profile.venueNoun[0].toUpperCase() + profile.venueNoun.slice(1)} gör det enkelt att förstå utbudet och ta kontakt innan bokning.` : salon ? 'Varje besök börjar med förståelse för kundens behov och avslutas med en tydlig väg vidare.' : 'Det viktigaste lyfts fram först så att nästa steg blir enkelt.', bullets: salon ? ['Personlig rådgivning', profile.servicePlural, 'Mobilanpassad kontakt'] : ['Tydlig struktur', 'Snabb kontakt', 'Inga påhittade detaljer'] },
      { eyebrow: 'Nästa steg', title: 'Gör kontakten enkel', text: 'Besökaren ska aldrig behöva leta efter telefon, e-post eller rätt väg vidare.', bullets: [ctx.facts.phone || 'Telefon kan läggas till', ctx.facts.email || 'E-post kan läggas till'] },
    ],
    faqs: [
      { question: `Hur bokar jag hos ${business}?`, answer: ctx.facts.phone || ctx.facts.email ? 'Ring eller mejla så hjälper vi dig vidare till rätt tid och behandling.' : 'Kontakta verksamheten via uppgifterna på kontaktsidan.' },
      { question: `Vilken ${salon ? 'behandling' : 'tjänst'} passar mig?`, answer: 'Berätta kort vad du vill ha hjälp med, så blir det lättare att rekommendera rätt nästa steg.' },
      { question: `Finns ${profile.venueNoun} i ${decodeText(ctx.facts.city || 'området')}?`, answer: ctx.facts.address || ctx.facts.city ? `Ja, kontakt- och adressuppgifter finns längre ned på sidan.` : 'Kontakta verksamheten för aktuell platsinformation.' },
    ],
    faqGroups: profile.kind === 'construction' || profile.kind === 'electrical' || profile.kind === 'plumbing' || profile.kind === 'cleaning' ? [
      {
        title: 'Första kontakt',
        items: [
          { question: 'Vad behöver jag skicka med från början?', answer: 'Beskriv vad du vill ha hjälp med, var uppdraget finns och vilket underlag du redan har, till exempel bilder, mått eller ritningar.' },
          { question: 'Behöver allt vara färdigplanerat?', answer: 'Nej. Det räcker ofta med en första beskrivning för att kunna avgöra vilka frågor som behöver lösas härnäst.' },
        ],
      },
      {
        title: 'Planering och omfattning',
        items: [
          { question: 'När blir det tydligt vad som ingår?', answer: 'Omfattningen behöver gås igenom innan arbetet planeras. I vissa uppdrag krävs kompletterande information först.' },
          { question: 'Vad händer om förutsättningarna ändras?', answer: 'Nya önskemål eller upptäckta förutsättningar bör diskuteras innan arbetet fortsätter i den delen.' },
        ],
      },
    ] : undefined,
    closingTitle: 'Redo att ta nästa steg?',
    closingText: `Kontakta ${business} direkt så får du svar på vad som passar bäst.`,
    source: 'fallback',
  }
}

function render(ctx: FreeformCtx, plan: FreeformPlan, page: FreeformPageSpec, c: FreeformPageContent): string {
  const business = decodeText(ctx.facts.business_name || ctx.nicheLabel || 'Företaget')
  const imgs = images(ctx)
  const home = page.slug === 'index'
  const faqPage = page.pageKind === 'faq'
  const processPage = page.pageKind === 'process'
  const contactPage = page.pageKind === 'contact'
  const showServices = shouldRenderServices(plan, page)
  const showIntro = shouldRenderIntro(plan, page)
  const showGallery = shouldRenderGallery(plan, page, home)
  const showContact = shouldRenderContact(plan, page)
  const html = [
    nav(plan, business, page.slug, ctx),
    home ? hero(c, imgs[0], ctx) : pageHero(c, imgs[0], ctx),
    showIntro ? intro(c, imgs[1], ctx) : '',
    showServices ? services(c, ctx) : '',
    sections(c, processPage),
    showGallery ? gallery(ctx, imgs) : '',
    faq(c, faqPage),
    showContact ? contact(ctx, c) : '',
    contactPage ? '' : cta(c, ctx),
    footer(plan, business, ctx),
  ].filter(Boolean).join('\n')
  return `<!DOCTYPE html>
<html lang='${isEnglish(ctx) ? 'en' : 'sv'}'>
<head>
  <meta charset='UTF-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1'>
  <title>${esc(c.metaTitle || page.title + ' | ' + business)}</title>
  <meta name='description' content='${attr(c.metaDescription || business)}'>
  <link rel='stylesheet' href='style.css'>
</head>
<body class='template-${attr(plan.templateFamily || 'service_clarity_default')}'>
${html}
</body>
</html>`
}

function nav(plan: FreeformPlan, business: string, active: string, ctx: FreeformCtx): string {
  const en = isEnglish(ctx)
  const links = plan.pages.map((p) => `<a href='${attr(fileNameFor(p.slug))}'${p.slug === active ? ` aria-current='page'` : ''}>${esc(p.slug === 'index' ? (en ? 'Home' : 'Hem') : p.title)}</a>`).join('')
  return `<header class='site-header'><div class='wrap nav-shell'><a class='brand' href='index.html'>${esc(business)}</a><nav class='nav-desktop' aria-label='${en ? 'Main menu' : 'Huvudmeny'}'>${links}</nav><details class='nav-mobile'><summary>${en ? 'Menu' : 'Meny'}</summary><nav class='nav-drawer' aria-label='${en ? 'Mobile menu' : 'Mobilmeny'}'>${links}</nav></details></div></header>`
}
function hero(c: FreeformPageContent, img: string, ctx: FreeformCtx): string {
  return `<section class='hero'>${img ? `<img src='${attr(img)}' alt=''>` : ''}<div class='wrap'><div class='hero-card'><p class='eyebrow'>${esc(c.heroEyebrow || 'Utvald upplevelse')}</p><h1>${esc(c.heroTitle || 'En modern webbplats med tydligt första intryck')}</h1><p class='lead lg'>${esc(c.heroLead || '')}</p>${buttons(ctx, c)}</div></div></section>`
}
function pageHero(c: FreeformPageContent, img: string, ctx: FreeformCtx): string {
  return `<section class='page-hero'>${img ? `<img src='${attr(img)}' alt=''>` : ''}<div class='wrap'><p class='eyebrow'>${esc(c.heroEyebrow || 'Information')}</p><h1>${esc(c.heroTitle || 'Tydlig information')}</h1><p class='lead'>${esc(c.heroLead || ctx.nicheLabel)}</p></div></section>`
}
function intro(c: FreeformPageContent, img: string, ctx: FreeformCtx): string {
  const profile = buildProfile(ctx)
  const tags = profile.kind === 'restaurant'
    ? ['Mat och dryck', 'Stämning', 'Boka eller besök']
    : profile.isBeauty
      ? ['Personlig rådgivning', profile.servicePlural, 'Lätt att kontakta']
      : ['Tydligt upplägg', profile.servicePlural, 'Snabb kontakt']
  const mediaTitle = profile.kind === 'restaurant' ? 'En känsla av platsen' : profile.isBeauty ? 'Känslan inför besöket' : 'Tydligt från första intryck'
  const mediaText = profile.kind === 'restaurant'
    ? 'Bild, rytm och kort text hjälper gästen förstå atmosfären innan besöket.'
    : profile.isBeauty
      ? 'En varm och tydlig presentation som gör det enklare att förstå utbudet innan bokning.'
      : 'En konkret presentation som gör det enkelt att förstå erbjudandet och ta kontakt.'
  return `<section class='section'><div class='wrap split'><div class='stack'><p class='eyebrow'>${profile.kind === 'restaurant' ? 'Upplevelse' : 'Första intrycket'}</p><h2>${esc(c.introTitle || c.heroTitle || 'Byggt för förtroende')}</h2><p class='lead'>${esc(c.introText || '')}</p><div class='tag-row'>${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div></div>${img ? `<article class='media-card'><img src='${attr(img)}' alt=''><div class='media-body'><h3>${esc(mediaTitle)}</h3><p>${esc(mediaText)}</p></div></article>` : ''}</div></section>`
}
function services(c: FreeformPageContent, ctx: FreeformCtx): string {
  const profile = buildProfile(ctx)
  const list = (c.services?.length ? c.services : fallbackContent(ctx, { slug: 'x', title: 'x', purpose: '', sections: [] }).services || []).slice(0, 6)
  return `<section class='section section-alt'><div class='wrap'><p class='eyebrow'>${esc(profile.servicePlural)}</p><h2>${esc(profile.servicesHeading)}</h2><p class='lead'>${esc(profile.servicesLead)}</p><div class='grid'>${list.map((s) => `<article class='card'><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>${s.detail ? `<p>${esc(s.detail)}</p>` : ''}</article>`).join('')}</div></div></section>`
}
function sections(c: FreeformPageContent, processStyle = false): string {
  const list = (c.sections || []).slice(0, 4)
  if (!list.length) return ''
  if (processStyle) {
    return `<section class='section'><div class='wrap process-list'>${list.map((s, i) => `<article class='process-step'><span class='process-number'>${String(i + 1).padStart(2, '0')}</span><div><p class='eyebrow'>${esc(s.eyebrow || 'Steg')}</p><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>${s.bullets?.length ? `<div class='tag-row'>${s.bullets.slice(0, 5).map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}</div></article>`).join('')}</div></section>`
  }
  return `<section class='section'><div class='wrap stack'>${list.map((s) => `<article class='card'><p class='eyebrow'>${esc(s.eyebrow || 'Detalj')}</p><h2>${esc(s.title)}</h2><p class='lead'>${esc(s.text)}</p>${s.bullets?.length ? `<div class='tag-row'>${s.bullets.slice(0, 5).map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}</article>`).join('')}</div></section>`
}
function gallery(ctx: FreeformCtx, imgs: string[]): string {
  const profile = buildProfile(ctx)
  if (imgs.length < 2) return ''
  return `<section class='section'><div class='wrap split'><div><p class='eyebrow'>${profile.isBeauty ? 'Känsla' : 'Intryck'}</p><h2>${profile.isClinic ? 'En trygg känsla redan innan bokning.' : profile.isBeauty ? 'En visuell känsla som lyfter upplevelsen.' : 'En design som känns arbetad.'}</h2><p class='lead'>Stora bildytor, tydlig rytm och bra kontrast ger ett mer exklusivt första intryck och gör innehållet lättare att ta in.</p></div><div class='gallery-grid'>${imgs.slice(0, 3).map((src) => `<img src='${attr(src)}' alt=''>`).join('')}</div></div></section>`
}
function faq(c: FreeformPageContent, fullPage = false): string {
  const groups = (c.faqGroups || []).filter((g) => g.title && g.items?.length).slice(0, 3)
  const flat = (c.faqs || []).slice(0, fullPage ? 8 : 4)
  if (fullPage && groups.length) {
    return `<section class='section section-alt'><div class='wrap faq-layout'><aside><p class='eyebrow'>Vanliga frågor</p><h2>${esc(c.introTitle || 'Inför nästa steg.')}</h2><p class='lead'>${esc(c.introText || 'Här samlas frågor som är relevanta inför kontakt och planering.')}</p></aside><div class='faq-groups'>${groups.map((g) => `<section class='faq-category'><h2>${esc(g.title)}</h2><div class='faq-list'>${g.items.slice(0, 5).map((f) => `<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('')}</div></section>`).join('')}</div></div></section>`
  }
  if (!flat.length) return ''
  return `<section class='section section-alt'><div class='wrap'><p class='eyebrow'>Frågor</p><h2>${fullPage ? 'Frågor inför kontakt.' : 'Snabba svar innan kontakt.'}</h2><div class='faq-list'>${flat.map((f) => `<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('')}</div></div></section>`
}
function contact(ctx: FreeformCtx, c: FreeformPageContent): string {
  const en = isEnglish(ctx)
  const profile = buildProfile(ctx)
  const business = decodeText(ctx.facts.business_name || ctx.nicheLabel || 'företaget')
  const title = en
    ? profile.kind === 'restaurant'
      ? 'Book, ask or plan your visit.'
      : profile.isBeauty
        ? `Book or ask ${business}.`
        : 'Get in touch when you are ready.'
    : profile.kind === 'restaurant'
      ? 'Boka, fråga eller planera ditt besök.'
      : profile.isBeauty
        ? `Boka eller fråga ${business}.`
        : 'Ta kontakt när du vill vidare.'
  const lead = en
    ? profile.kind === 'restaurant'
      ? 'Call or email for bookings, visit questions or current information.'
      : profile.isBeauty
        ? 'Call or email if you want to book, ask about the offer, or understand what fits best.'
        : 'Call or email for questions, a quote, or the next step.'
    : profile.kind === 'restaurant'
      ? 'Ring eller mejla för bokning, frågor om besök eller aktuell information.'
      : profile.isBeauty
        ? 'Ring eller mejla om du vill boka, fråga om utbudet eller veta vad som passar bäst.'
        : 'Ring eller mejla för frågor, offert eller nästa steg. Uppgifterna finns samlade här.'
  const rows = [
    ctx.facts.phone ? `<a href='tel:${attr(ctx.facts.phone.replace(/\s+/g, ''))}'>${en ? 'Phone' : 'Telefon'}<br>${esc(ctx.facts.phone)}</a>` : '',
    ctx.facts.email ? `<a href='mailto:${attr(ctx.facts.email)}'>${en ? 'Email' : 'E-post'}<br>${esc(ctx.facts.email)}</a>` : '',
    ctx.facts.address || ctx.facts.city ? `<span>${en ? 'Address' : 'Adress'}<br>${esc(decodeText([ctx.facts.address, ctx.facts.city].filter(Boolean).join(', ')))}</span>` : '',
    ctx.facts.google_maps_url ? `<a href='${attr(ctx.facts.google_maps_url)}'>Google Maps<br>${en ? 'Get directions' : 'Visa vägbeskrivning'}</a>` : '',
  ].filter(Boolean).join('')
  return rows ? `<section id='kontakt' class='section'><div class='wrap contact-grid'><div><p class='eyebrow'>Kontakt</p><h2>${esc(title)}</h2><p class='lead'>${esc(lead)}</p></div><div class='contact-list'>${rows}</div></div></section>` : ''
}
function cta(c: FreeformPageContent, ctx: FreeformCtx): string {
  return `<section class='section'><div class='wrap'><div class='cta-band'><div><h2>${esc(c.closingTitle || (isEnglish(ctx) ? 'Ready for the next step?' : 'Redo att ta nästa steg?'))}</h2><p>${esc(c.closingText || (isEnglish(ctx) ? 'Call or email to make the next step clear.' : 'Ring eller mejla så blir vägen framåt tydlig.'))}</p></div>${buttons(ctx, c)}</div></div></section>`
}
function footer(plan: FreeformPlan, business: string, ctx: FreeformCtx): string {
  const en = isEnglish(ctx)
  const links = plan.pages.map((p) => `<a href='${attr(fileNameFor(p.slug))}'>${esc(p.slug === 'index' ? (en ? 'Home' : 'Hem') : p.title)}</a>`).join('<br>')
  const info = [ctx.facts.phone, ctx.facts.email, decodeText([ctx.facts.address, ctx.facts.city].filter(Boolean).join(', '))].filter(Boolean).map((v) => esc(String(v))).join('<br>')
  return `<footer class='site-footer'><div class='wrap'><div class='footer-grid'><div><div class='footer-title'>${esc(business)}</div><p>${en ? 'Clear information, a warm tone and an easy next step.' : 'Tydlig information, varm känsla och enkel kontakt inför nästa steg.'}</p></div><div><div class='footer-title'>${en ? 'Navigation' : 'Navigering'}</div><p>${links}</p></div><div><div class='footer-title'>${en ? 'Contact' : 'Kontakt'}</div><p>${info || (en ? 'Contact the business for more information.' : 'Kontakta företaget för mer information.')}</p></div></div><p class='foot-bottom'>© ${new Date().getFullYear()} ${esc(business)}</p></div></footer>`
}
function buttons(ctx: FreeformCtx, c: FreeformPageContent): string {
  const parts: string[] = []
  if (ctx.facts.phone) parts.push(`<a class='btn btn-primary' href='tel:${attr(ctx.facts.phone.replace(/\s+/g, ''))}'>${esc(c.primaryCta || (isEnglish(ctx) ? 'Call us' : 'Ring oss'))}</a>`)
  if (ctx.facts.email) parts.push(`<a class='btn btn-secondary' href='mailto:${attr(ctx.facts.email)}'>${esc(c.secondaryCta || (isEnglish(ctx) ? 'Email us' : 'Mejla oss'))}</a>`)
  return parts.length ? `<div class='btn-row'>${parts.join('')}</div>` : ''
}

function buildCss(ctx: FreeformCtx, plan?: FreeformPlan): string {
  const p = palette(ctx)
  const display = font(ctx.brandFonts?.[0], isSalon(ctx) ? 'Georgia, Times New Roman, serif' : 'Inter, ui-sans-serif, system-ui, sans-serif')
  const body = font(ctx.brandFonts?.[1], 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif')
  const template = plan?.templateFamily || selectBlockTemplateFamily({
    category: ctx.category,
    niche: ctx.facts.niche,
    nicheLabel: ctx.nicheLabel,
    businessName: ctx.facts.business_name,
    source: sourceFor(ctx, { slug: 'index', title: '', purpose: '', sections: [] }),
  }).key
  return `
:root{--primary:${p.primary};--secondary:${p.secondary};--accent:${p.accent};--background:${p.background};--surface:${p.surface};--text-primary:${p.text};--text-secondary:${p.muted};--on-primary:${p.onPrimary};--border:${p.border};--shadow:${p.shadow};--wrap:1180px;--display:${display};--body:${body};--radius:30px}
*{box-sizing:border-box}html,body{max-width:100%;overflow-x:hidden}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 88% 8%,${p.glow},transparent 32rem),linear-gradient(180deg,var(--background),color-mix(in srgb,var(--surface) 62%,var(--background)));color:var(--text-primary);font-family:var(--body);font-size:16px;line-height:1.7;-webkit-font-smoothing:antialiased}img,svg,video{display:block;max-width:100%;height:auto}a{color:inherit}.wrap{width:min(var(--wrap),calc(100% - 40px));margin-inline:auto}.site-header{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--background) 86%,transparent);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}.nav-shell{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-family:var(--display);font-size:clamp(20px,2vw,30px);font-weight:850;letter-spacing:-.045em;text-decoration:none;max-width:52vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nav-desktop{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.nav-desktop a,.nav-drawer a{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:10px 14px;border-radius:999px;text-decoration:none;color:var(--text-secondary);font-weight:800;font-size:14px}.nav-desktop a:hover,.nav-desktop a[aria-current=page],.nav-drawer a:hover,.nav-drawer a[aria-current=page]{background:color-mix(in srgb,var(--primary) 13%,transparent);color:var(--text-primary)}.nav-mobile{display:none;position:relative}.nav-mobile summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:10px;min-height:46px;padding:11px 16px;border:1px solid var(--border);border-radius:999px;background:var(--surface);box-shadow:0 12px 30px var(--shadow);font-weight:850;color:var(--text-primary)}.nav-mobile summary::-webkit-details-marker{display:none}.nav-mobile summary:before{content:'';width:18px;height:12px;background:linear-gradient(var(--text-primary),var(--text-primary)) top/100% 2px no-repeat,linear-gradient(var(--text-primary),var(--text-primary)) center/100% 2px no-repeat,linear-gradient(var(--text-primary),var(--text-primary)) bottom/100% 2px no-repeat}.nav-drawer{position:absolute;right:0;top:calc(100% + 12px);width:min(86vw,360px);max-width:calc(100vw - 32px);padding:12px;border:1px solid var(--border);border-radius:24px;background:color-mix(in srgb,var(--surface) 96%,var(--background));box-shadow:0 26px 70px var(--shadow);display:grid;gap:4px}.nav-drawer a{justify-content:flex-start;width:100%;padding:14px 16px;border-radius:16px;color:var(--text-primary)}.section{padding:clamp(66px,9vw,128px) 0}.section-alt{background:color-mix(in srgb,var(--surface) 58%,transparent)}.stack{display:grid;gap:20px}.split{display:grid;grid-template-columns:minmax(0,1.02fr) minmax(280px,.78fr);gap:clamp(28px,5vw,72px);align-items:center}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin-top:34px}.contact-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(280px,1.1fr);gap:28px}.gallery-grid{display:grid;grid-template-columns:1.2fr .8fr .8fr;gap:18px}.eyebrow{display:inline-flex;align-items:center;gap:10px;margin:0 0 18px;color:var(--primary);font-size:12px;font-weight:950;letter-spacing:.22em;text-transform:uppercase}.eyebrow:before{content:'';width:28px;height:1px;background:currentColor}h1,h2,h3,p,li{overflow-wrap:anywhere}h1,h2,h3{font-family:var(--display);margin:0;color:var(--text-primary);letter-spacing:-.045em;line-height:.98}h1{font-size:clamp(42px,7vw,88px);max-width:12ch}h2{font-size:clamp(30px,4.6vw,60px);max-width:14ch}h3{font-size:clamp(21px,2.1vw,30px);line-height:1.08}p{margin:0;color:var(--text-secondary)}.lead{font-size:clamp(17px,1.7vw,21px);line-height:1.72;color:var(--text-secondary);max-width:66ch}.lead.lg{font-size:clamp(18px,2vw,24px)}.btn-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:14px 22px;border:1px solid var(--border);border-radius:999px;background:color-mix(in srgb,var(--surface) 82%,transparent);color:var(--text-primary);font-weight:900;text-decoration:none;box-shadow:0 12px 28px color-mix(in srgb,var(--shadow) 70%,transparent)}.btn-primary{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}.hero{position:relative;isolation:isolate;min-height:min(780px,86svh);display:grid;align-items:end;padding:clamp(92px,11vw,154px) 0 clamp(54px,7vw,88px);overflow:hidden}.hero:before{content:'';position:absolute;inset:0;z-index:-2;background:linear-gradient(110deg,color-mix(in srgb,var(--background) 96%,transparent),color-mix(in srgb,var(--background) 30%,transparent))}.hero img,.page-hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-3;filter:brightness(.84) saturate(.9)}.hero-card{max-width:760px;padding:clamp(26px,4vw,48px);border:1px solid var(--border);border-radius:38px;background:color-mix(in srgb,var(--background) 74%,transparent);backdrop-filter:blur(12px);box-shadow:0 34px 90px var(--shadow)}.hero .lead{margin-top:20px}.page-hero{position:relative;isolation:isolate;padding:clamp(104px,12vw,160px) 0 clamp(58px,8vw,94px);overflow:hidden;background:color-mix(in srgb,var(--surface) 72%,var(--background))}.page-hero:after{content:'';position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,var(--background),color-mix(in srgb,var(--background) 74%,transparent))}.page-hero .lead{margin-top:20px}.card,.media-card{min-width:0;padding:clamp(22px,3vw,34px);border:1px solid var(--border);border-radius:var(--radius);background:color-mix(in srgb,var(--surface) 91%,var(--background));box-shadow:0 24px 70px var(--shadow)}.card h3,.media-card h3{margin-bottom:12px}.card p+p{margin-top:12px}.media-card{overflow:hidden;padding:0}.media-card img{width:100%;height:260px;object-fit:cover}.media-body{padding:24px}.tag-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.tag-row span{display:inline-flex;padding:8px 12px;border-radius:999px;background:color-mix(in srgb,var(--primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--primary) 18%,transparent);color:var(--text-primary);font-weight:850;font-size:13px}.gallery-grid img{width:100%;height:260px;object-fit:cover;border-radius:var(--radius);box-shadow:0 24px 70px var(--shadow)}.gallery-grid img:first-child{height:330px}.cta-band{padding:clamp(28px,5vw,56px);border-radius:38px;background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--secondary) 65%,var(--primary)));color:var(--on-primary);box-shadow:0 30px 90px var(--shadow);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center}.cta-band h2,.cta-band p{color:var(--on-primary)}.cta-band p{opacity:.9}.cta-band .btn{background:var(--on-primary);border-color:transparent;color:var(--primary);box-shadow:none}.contact-list{display:grid;gap:14px}.contact-list a,.contact-list span{display:flex;gap:12px;align-items:flex-start;padding:16px;border:1px solid var(--border);border-radius:18px;background:color-mix(in srgb,var(--surface) 78%,transparent);text-decoration:none;color:var(--text-primary);font-weight:800}.faq-list{display:grid;gap:12px;max-width:900px;margin-top:28px}.faq-list details{border:1px solid var(--border);border-radius:20px;background:color-mix(in srgb,var(--surface) 88%,transparent);padding:18px 20px}.faq-list summary{cursor:pointer;font-weight:900;color:var(--text-primary)}.faq-list p{margin-top:10px}.site-footer{padding:58px 0 34px;background:color-mix(in srgb,var(--text-primary) 8%,var(--surface));border-top:1px solid var(--border)}.footer-grid{display:grid;grid-template-columns:1.2fr .7fr .9fr;gap:28px}.footer-title{font-family:var(--display);font-weight:900;font-size:20px;letter-spacing:-.03em;margin-bottom:12px;color:var(--text-primary)}.site-footer a{color:var(--text-primary);text-decoration:none}.foot-bottom{margin-top:32px;padding-top:22px;border-top:1px solid var(--border);font-size:13px;color:var(--text-secondary)}
@media(max-width:960px){.wrap{width:min(100% - 32px,var(--wrap))}.nav-desktop{display:none!important}.nav-mobile{display:block!important}.brand{max-width:calc(100vw - 140px)}.split,.contact-grid,.footer-grid,.cta-band{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr}.gallery-grid{grid-template-columns:1fr 1fr}.hero{min-height:auto;align-items:center}}
@media(min-width:961px){.nav-mobile{display:none!important}.nav-desktop{display:flex!important}}
@media(max-width:640px){body{font-size:15px}.wrap{width:calc(100% - 28px)}.nav-shell{min-height:68px}.brand{font-size:19px;max-width:calc(100vw - 122px)}.section{padding:58px 0}.hero{padding:72px 0 44px}.hero-card{padding:24px;border-radius:24px}h1{font-size:clamp(38px,13vw,58px);max-width:11ch}h2{font-size:clamp(29px,10vw,44px)}.lead{font-size:16px}.grid,.gallery-grid{grid-template-columns:1fr}.btn-row{display:grid}.btn{width:100%;min-height:52px}.media-card img,.gallery-grid img,.gallery-grid img:first-child{height:230px}.cta-band{border-radius:24px;padding:26px}}
${templateCss(template)}
`.trim()
}

function templateCss(template: BlockTemplateFamilyKey): string {
  if (template === 'bistro_atmospheric_landing') return `
body.template-bistro_atmospheric_landing{--radius:26px;background:#090806;color:#fff7ed}
.template-bistro_atmospheric_landing .site-header{background:rgba(9,8,6,.72);border-bottom-color:rgba(255,255,255,.13)}
.template-bistro_atmospheric_landing .brand{font-family:Georgia,Times New Roman,serif;letter-spacing:-.055em}
.template-bistro_atmospheric_landing .hero{min-height:96svh;align-items:end;padding-top:130px}
.template-bistro_atmospheric_landing .hero:before{background:linear-gradient(90deg,rgba(8,7,5,.9),rgba(8,7,5,.35) 58%,rgba(8,7,5,.72)),radial-gradient(circle at 78% 20%,rgba(245,158,11,.24),transparent 30rem)}
.template-bistro_atmospheric_landing .hero-card{max-width:860px;background:rgba(9,8,6,.54);border-color:rgba(255,255,255,.18);box-shadow:0 38px 120px rgba(0,0,0,.52)}
.template-bistro_atmospheric_landing h1{max-width:10.5ch;font-size:clamp(48px,8.4vw,112px)}
.template-bistro_atmospheric_landing h2{font-family:Georgia,Times New Roman,serif}
.template-bistro_atmospheric_landing .section-alt{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.015))}
.template-bistro_atmospheric_landing .card,.template-bistro_atmospheric_landing .media-card,.template-bistro_atmospheric_landing .faq-list details{background:rgba(255,255,255,.055);border-color:rgba(255,255,255,.14)}
.template-bistro_atmospheric_landing .gallery-grid img{filter:saturate(.9) contrast(1.05);border-radius:34px}
.template-bistro_atmospheric_landing .contact-list a,.template-bistro_atmospheric_landing .contact-list span{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14)}
`.trim()

  if (template === 'byggform_architectural_trust') return `
body.template-byggform_architectural_trust{--primary:#73553b;--secondary:#354034;--accent:#997453;--background:#faf9f5;--surface:#f1eee7;--text-primary:#252921;--text-secondary:#52574f;--border:rgba(37,41,33,.16);--shadow:rgba(26,30,24,.14);--radius:2px;background:var(--background)}
.template-byggform_architectural_trust .site-header{background:color-mix(in srgb,var(--background) 92%,transparent);border-bottom-color:var(--border)}
.template-byggform_architectural_trust .brand{font-family:Inter,ui-sans-serif,system-ui,sans-serif;letter-spacing:-.02em}
.template-byggform_architectural_trust .nav-desktop a,.template-byggform_architectural_trust .nav-drawer a{border-radius:2px;text-transform:uppercase;letter-spacing:.06em;font-size:12px}
.template-byggform_architectural_trust .hero{min-height:100svh;align-items:end}
.template-byggform_architectural_trust .hero:before{background:linear-gradient(90deg,rgba(21,25,20,.9),rgba(21,25,20,.48) 62%,rgba(21,25,20,.16)),linear-gradient(0deg,rgba(21,25,20,.5),transparent 55%)}
.template-byggform_architectural_trust .hero-card{max-width:900px;border-radius:0;border-color:rgba(255,255,255,.2);background:rgba(21,25,20,.56);box-shadow:0 22px 80px rgba(0,0,0,.32)}
.template-byggform_architectural_trust .hero-card h1,.template-byggform_architectural_trust .hero-card p,.template-byggform_architectural_trust .hero-card .eyebrow{color:#fff}
.template-byggform_architectural_trust h1,.template-byggform_architectural_trust h2{font-family:Georgia,Times New Roman,serif;font-weight:400;letter-spacing:-.035em}
.template-byggform_architectural_trust h1{max-width:13ch;font-size:clamp(48px,7vw,102px)}
.template-byggform_architectural_trust h2{max-width:16ch}
.template-byggform_architectural_trust .section-alt{background:#f1eee7}
.template-byggform_architectural_trust .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:0;border-top:1px solid var(--border);border-left:1px solid var(--border)}
.template-byggform_architectural_trust .grid .card{grid-column:span 2;min-height:285px;border:0;border-right:1px solid var(--border);border-bottom:1px solid var(--border);border-radius:0;background:rgba(255,255,255,.25);box-shadow:none}
.template-byggform_architectural_trust .grid .card:nth-child(4),.template-byggform_architectural_trust .grid .card:nth-child(5){grid-column:span 3}
.template-byggform_architectural_trust .card,.template-byggform_architectural_trust .media-card{border-radius:0;background:color-mix(in srgb,var(--surface) 86%,white);box-shadow:0 22px 65px var(--shadow)}
.template-byggform_architectural_trust .process-list{border-top:1px solid var(--border)}
.template-byggform_architectural_trust .process-step{display:grid;grid-template-columns:64px 1fr;gap:24px;padding:34px 0;border-bottom:1px solid var(--border)}
.template-byggform_architectural_trust .process-number{color:var(--primary);font-weight:850;font-size:12px;letter-spacing:.12em}
.template-byggform_architectural_trust .process-step h3{font-family:Georgia,Times New Roman,serif;font-weight:400;font-size:clamp(24px,2.4vw,34px)}
.template-byggform_architectural_trust .faq-layout{display:grid;grid-template-columns:minmax(260px,.72fr) minmax(0,1.28fr);gap:clamp(40px,7vw,100px);align-items:start}
.template-byggform_architectural_trust .faq-layout aside{position:sticky;top:110px}
.template-byggform_architectural_trust .faq-category+.faq-category{margin-top:56px}
.template-byggform_architectural_trust .faq-category h2{font-size:clamp(28px,3vw,43px);margin-bottom:18px}
.template-byggform_architectural_trust .faq-list details{border:0;border-bottom:1px solid var(--border);border-radius:0;background:transparent;box-shadow:none;padding:22px 0}
.template-byggform_architectural_trust .faq-list summary{font-size:17px}
.template-byggform_architectural_trust .contact-grid{align-items:start}
.template-byggform_architectural_trust .cta-band{border-radius:0;background:#dcd7cd;color:#252921;box-shadow:none}
.template-byggform_architectural_trust .cta-band h2,.template-byggform_architectural_trust .cta-band p{color:#252921}
.template-byggform_architectural_trust .site-footer{background:#1b1e19}
@media(max-width:960px){.template-byggform_architectural_trust .grid{grid-template-columns:1fr 1fr}.template-byggform_architectural_trust .grid .card,.template-byggform_architectural_trust .grid .card:nth-child(4),.template-byggform_architectural_trust .grid .card:nth-child(5){grid-column:auto}.template-byggform_architectural_trust .faq-layout{grid-template-columns:1fr}.template-byggform_architectural_trust .faq-layout aside{position:static}}
@media(max-width:640px){.template-byggform_architectural_trust .grid{grid-template-columns:1fr}.template-byggform_architectural_trust .process-step{grid-template-columns:40px 1fr;gap:14px}.template-byggform_architectural_trust h1{font-size:clamp(44px,14vw,68px)}}
`.trim()

  if (template === 'salon_editorial_luxury') return `
body.template-salon_editorial_luxury{--radius:34px}
.template-salon_editorial_luxury .site-header{background:color-mix(in srgb,var(--background) 78%,transparent)}
.template-salon_editorial_luxury .hero{min-height:min(820px,88svh);align-items:center}
.template-salon_editorial_luxury .hero:before{background:linear-gradient(105deg,color-mix(in srgb,var(--background) 97%,transparent),color-mix(in srgb,var(--background) 42%,transparent) 58%,color-mix(in srgb,var(--surface) 26%,transparent)),radial-gradient(circle at 80% 20%,color-mix(in srgb,var(--accent) 34%,transparent),transparent 28rem)}
.template-salon_editorial_luxury .hero-card{max-width:790px;border-radius:44px;background:color-mix(in srgb,var(--surface) 72%,transparent)}
.template-salon_editorial_luxury .grid{grid-template-columns:repeat(4,minmax(0,1fr))}
.template-salon_editorial_luxury .card:nth-child(2n){transform:translateY(18px)}
.template-salon_editorial_luxury .media-card img{height:340px}
.template-salon_editorial_luxury .gallery-grid{grid-template-columns:1.05fr .75fr .9fr}
.template-salon_editorial_luxury .gallery-grid img:first-child{height:410px}
.template-salon_editorial_luxury .cta-band{border-radius:46px}
@media(max-width:960px){.template-salon_editorial_luxury .grid{grid-template-columns:1fr 1fr}.template-salon_editorial_luxury .card:nth-child(2n){transform:none}}
@media(max-width:640px){.template-salon_editorial_luxury .grid{grid-template-columns:1fr}.template-salon_editorial_luxury .media-card img,.template-salon_editorial_luxury .gallery-grid img:first-child{height:250px}}
`.trim()

  if (template === 'clinic_private_care') return `
body.template-clinic_private_care{--primary:#c8e86b;--secondary:#1b211e;--accent:#dce4d8;--background:#f4f2eb;--surface:#fffefa;--text-primary:#111412;--text-secondary:#5d665f;--border:rgba(17,20,18,.14);--shadow:rgba(17,20,18,.10);--radius:18px;background:var(--background)}
.template-clinic_private_care .site-header{background:rgba(17,20,18,.88);border-bottom-color:rgba(255,255,255,.08)}
.template-clinic_private_care .brand{font-family:"Manrope",Inter,ui-sans-serif,system-ui,sans-serif;font-size:clamp(20px,2vw,28px);font-weight:750;letter-spacing:-.05em;color:#fff}
.template-clinic_private_care .nav-desktop a,.template-clinic_private_care .nav-drawer a{font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
.template-clinic_private_care .hero{min-height:min(840px,92svh);align-items:end}
.template-clinic_private_care .hero:before{background:linear-gradient(90deg,rgba(17,20,18,.90) 0%,rgba(17,20,18,.58) 48%,rgba(17,20,18,.18)),radial-gradient(circle at 78% 18%,rgba(200,232,107,.12),transparent 22rem)}
.template-clinic_private_care .hero-card{max-width:860px;border-radius:0;background:transparent;border:0;box-shadow:none;padding:0}
.template-clinic_private_care .hero-card h1,.template-clinic_private_care .hero-card p,.template-clinic_private_care .hero-card .eyebrow{color:#fff}
.template-clinic_private_care h1,.template-clinic_private_care h2{font-family:"Space Grotesk",Georgia,serif;font-weight:600;letter-spacing:-.08em}
.template-clinic_private_care h1{max-width:12ch;font-size:clamp(48px,8vw,104px)}
.template-clinic_private_care .grid{grid-template-columns:1fr;gap:0;border-top:1px solid var(--border)}
.template-clinic_private_care .card{display:grid;grid-template-columns:76px 1fr 1fr 40px;align-items:center;gap:24px;padding:26px 0;border:0;border-bottom:1px solid var(--border);border-radius:0;background:transparent;box-shadow:none}
.template-clinic_private_care .card:hover{padding-inline:18px;background:#dce4d8}
.template-clinic_private_care .card h3{font-family:"Space Grotesk",Georgia,serif;font-size:clamp(26px,2.4vw,34px)}
.template-clinic_private_care .media-card{border-radius:0;overflow:hidden}
.template-clinic_private_care .media-card img{height:560px}
.template-clinic_private_care .section-alt{background:#1b211e;color:#fff}
.template-clinic_private_care .section-alt p,.template-clinic_private_care .section-alt h2,.template-clinic_private_care .section-alt h3,.template-clinic_private_care .section-alt .eyebrow,.template-clinic_private_care .section-alt .lead{color:inherit}
.template-clinic_private_care .contact-list a,.template-clinic_private_care .contact-list span{padding:20px 0;border:0;border-top:1px solid var(--border);border-radius:0;background:transparent}
.template-clinic_private_care .faq-list details{border:0;border-bottom:1px solid var(--border);border-radius:0;background:transparent;box-shadow:none;padding:24px 0}
.template-clinic_private_care .faq-list summary{font-family:"Space Grotesk",Georgia,serif;font-size:clamp(22px,2vw,30px)}
.template-clinic_private_care .cta-band{border-radius:0;background:#111412;box-shadow:none}
.template-clinic_private_care .cta-band h2,.template-clinic_private_care .cta-band p{color:#fff}
.template-clinic_private_care .cta-band .btn{background:#c8e86b;color:#111412}
.template-clinic_private_care .site-footer{background:#111412}
@media(max-width:960px){.template-clinic_private_care .card{grid-template-columns:42px 1fr 25px;gap:12px}.template-clinic_private_care .card p{display:none}}
@media(max-width:640px){.template-clinic_private_care h1{font-size:clamp(42px,14vw,68px)}.template-clinic_private_care .media-card img{height:320px}}
`.trim()

  if (template === 'mechanic_precision_workshop') return `
body.template-mechanic_precision_workshop{--primary:#e46c3b;--secondary:#202222;--accent:#ff9a65;--background:#f1efe9;--surface:#fbfaf6;--text-primary:#151616;--text-secondary:#616764;--border:rgba(21,22,22,.15);--shadow:rgba(21,22,22,.10);--radius:18px;background:var(--background)}
.template-mechanic_precision_workshop .site-header{background:rgba(21,22,22,.92);border-bottom-color:rgba(255,255,255,.10)}
.template-mechanic_precision_workshop .brand{font-family:"Space Grotesk",Inter,ui-sans-serif,system-ui,sans-serif;font-size:clamp(20px,2vw,28px);font-weight:700;letter-spacing:-.04em;color:#fff}
.template-mechanic_precision_workshop .nav-desktop a,.template-mechanic_precision_workshop .nav-drawer a{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.template-mechanic_precision_workshop .hero{min-height:min(860px,92svh);align-items:end}
.template-mechanic_precision_workshop .hero:before{background:linear-gradient(90deg,rgba(15,16,16,.92),rgba(15,16,16,.46) 57%,rgba(15,16,16,.12)),radial-gradient(circle at 82% 20%,rgba(228,108,59,.18),transparent 24rem)}
.template-mechanic_precision_workshop .hero-card{max-width:860px;border-radius:0;background:transparent;border:0;box-shadow:none;padding:0}
.template-mechanic_precision_workshop .hero-card h1,.template-mechanic_precision_workshop .hero-card p,.template-mechanic_precision_workshop .hero-card .eyebrow{color:#fff}
.template-mechanic_precision_workshop h1,.template-mechanic_precision_workshop h2{font-family:"Space Grotesk",Inter,ui-sans-serif,system-ui,sans-serif;font-weight:600;letter-spacing:-.09em}
.template-mechanic_precision_workshop h1{max-width:11ch;font-size:clamp(48px,8vw,102px)}
.template-mechanic_precision_workshop .grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
.template-mechanic_precision_workshop .card{display:grid;grid-template-rows:auto 1fr auto;gap:16px;padding:28px;border-radius:0;background:#202222;color:#fff;box-shadow:none}
.template-mechanic_precision_workshop .card p{color:rgba(255,255,255,.72)}
.template-mechanic_precision_workshop .card h3{font-family:"Space Grotesk",Inter,ui-sans-serif,system-ui,sans-serif;font-size:clamp(26px,2.2vw,34px)}
.template-mechanic_precision_workshop .section-alt{background:#202222;color:#fff}
.template-mechanic_precision_workshop .section-alt p,.template-mechanic_precision_workshop .section-alt h2,.template-mechanic_precision_workshop .section-alt h3,.template-mechanic_precision_workshop .section-alt .eyebrow,.template-mechanic_precision_workshop .section-alt .lead{color:inherit}
.template-mechanic_precision_workshop .contact-list a,.template-mechanic_precision_workshop .contact-list span{padding:18px 0;border:0;border-top:1px solid var(--border);border-radius:0;background:transparent}
.template-mechanic_precision_workshop .faq-list details{border:0;border-bottom:1px solid var(--border);border-radius:0;background:transparent;box-shadow:none;padding:24px 0}
.template-mechanic_precision_workshop .faq-list summary{font-family:"Space Grotesk",Inter,ui-sans-serif,system-ui,sans-serif;font-size:clamp(22px,2vw,30px)}
.template-mechanic_precision_workshop .cta-band{border-radius:0;background:#151616;box-shadow:none}
.template-mechanic_precision_workshop .cta-band h2,.template-mechanic_precision_workshop .cta-band p{color:#fff}
.template-mechanic_precision_workshop .cta-band .btn{background:#e46c3b;color:#fff}
.template-mechanic_precision_workshop .site-footer{background:#151616}
@media(max-width:960px){.template-mechanic_precision_workshop .grid{grid-template-columns:1fr}.template-mechanic_precision_workshop h1{font-size:clamp(44px,12vw,72px)}}
`.trim()

  if (template === 'service_company_modern') return `
body.template-service_company_modern{--primary:#d66a3d;--secondary:#2b4037;--accent:#f1c6a8;--background:#f7f7f3;--surface:#ffffff;--text-primary:#17221f;--text-secondary:#52615b;--border:rgba(23,34,31,.10);--shadow:rgba(23,34,31,.10);--radius:22px;background:linear-gradient(180deg,#f7f7f3,#f1f4ef)}
.template-service_company_modern .site-header{background:rgba(247,247,243,.88);border-bottom-color:rgba(23,34,31,.08)}
.template-service_company_modern .brand{font-family:Manrope,Inter,ui-sans-serif,system-ui,sans-serif;font-size:clamp(21px,2vw,31px);font-weight:850;letter-spacing:-.05em}
.template-service_company_modern .nav-desktop a,.template-service_company_modern .nav-drawer a{font-size:14px;font-weight:700}
.template-service_company_modern .hero{min-height:min(780px,88svh);align-items:center}
.template-service_company_modern .hero:before{background:linear-gradient(90deg,rgba(12,22,19,.92),rgba(12,22,19,.72) 46%,rgba(12,22,19,.18)),radial-gradient(circle at 78% 22%,rgba(214,106,61,.24),transparent 24rem)}
.template-service_company_modern .hero-card{max-width:760px;border-radius:32px;background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.16);box-shadow:0 30px 90px rgba(0,0,0,.22)}
.template-service_company_modern .hero-card h1,.template-service_company_modern .hero-card p,.template-service_company_modern .hero-card .eyebrow{color:#fff}
.template-service_company_modern .grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}
.template-service_company_modern .card{border-radius:22px;background:#fff;box-shadow:0 24px 60px rgba(23,34,31,.08)}
.template-service_company_modern .card h3{font-family:Manrope,Inter,ui-sans-serif,system-ui,sans-serif;font-size:clamp(20px,1.9vw,28px)}
.template-service_company_modern .section-alt{background:linear-gradient(180deg,rgba(220,229,220,.46),rgba(255,255,255,.2))}
.template-service_company_modern .contact-list a,.template-service_company_modern .contact-list span{padding:18px 20px;border-radius:20px;background:linear-gradient(180deg,#fff,#f9fbf8);box-shadow:0 18px 40px rgba(23,34,31,.06)}
.template-service_company_modern .faq-list details{border-radius:22px;background:#fff;box-shadow:0 18px 40px rgba(23,34,31,.06)}
.template-service_company_modern .cta-band{border-radius:30px;background:linear-gradient(135deg,#17221f,#2b4037 58%,#d66a3d);box-shadow:0 28px 80px rgba(23,34,31,.18)}
.template-service_company_modern .cta-band h2,.template-service_company_modern .cta-band p{color:#fff}
.template-service_company_modern .cta-band .btn{background:#fff;color:#17221f}
.template-service_company_modern .site-footer{background:#17221f}
.template-service_company_modern .site-footer p,.template-service_company_modern .site-footer a,.template-service_company_modern .footer-title,.template-service_company_modern .foot-bottom{color:#f6f3ed}
@media(max-width:960px){.template-service_company_modern .grid{grid-template-columns:1fr 1fr}}
@media(max-width:640px){.template-service_company_modern .grid{grid-template-columns:1fr}.template-service_company_modern .hero-card{border-radius:24px;padding:24px}}
`.trim()

  return `
body.template-service_clarity_default .hero-card{max-width:820px}
body.template-service_clarity_default .grid{grid-template-columns:repeat(3,minmax(0,1fr))}
body.template-service_clarity_default .card{border-radius:24px}
@media(max-width:960px){body.template-service_clarity_default .grid{grid-template-columns:1fr 1fr}}
@media(max-width:640px){body.template-service_clarity_default .grid{grid-template-columns:1fr}}
`.trim()
}

function shouldIncludeFaqPage(ctx: FreeformCtx, profile: BusinessProfile, template: BlockTemplateFamilyKey): boolean {
  if (template !== 'byggform_architectural_trust' && template !== 'service_company_modern' && template !== 'clinic_private_care' && template !== 'mechanic_precision_workshop') return false
  const source = sourceFor(ctx, { slug: 'index', title: '', purpose: '', sections: [] })
  const serviceCount = serviceIdeas(ctx).filter(isGoodServiceTitle).length
  const questionSignals = (source.match(/\?/g) || []).length
  const processSignals = (source.match(/\b(process|planering|offert|förfrågan|projekt|ritning|underlag|renovering|installation|service|genomförande|omfattning|kontakt)\b/gi) || []).length
  const categoryScore = ctx.category ? 2 : 0
  const projectKindScore = /construction|electrical|plumbing|cleaning|general/.test(String(profile.kind || '')) ? 2 : 0
  const sourceScore = Math.min(4, Math.floor(source.length / 650))
  const total = categoryScore + projectKindScore + sourceScore + Math.min(3, serviceCount) + Math.min(3, questionSignals + Math.floor(processSignals / 4))
  if (template === 'mechanic_precision_workshop') return total >= 4
  if (template === 'clinic_private_care') return total >= 4
  if (template === 'service_company_modern') return total >= 5
  return total >= 6
}

function shouldRenderServices(plan: FreeformPlan, page: FreeformPageSpec): boolean {
  if (plan.templateFamily === 'mechanic_precision_workshop') return page.pageKind === 'landing' || page.pageKind === 'services'
  if (plan.templateFamily === 'clinic_private_care') return page.pageKind === 'landing' || page.pageKind === 'services'
  if (plan.templateFamily === 'byggform_architectural_trust') return page.pageKind === 'landing' || page.pageKind === 'services'
  if (plan.templateFamily === 'service_company_modern') return page.pageKind === 'landing' || page.pageKind === 'services'
  if (plan.templateFamily === 'service_clarity_default') return page.pageKind === 'landing' || page.pageKind === 'services'
  if (plan.templateFamily === 'salon_editorial_luxury') return page.pageKind === 'landing' || page.pageKind === 'services'
  return page.pageKind !== 'faq'
}

function shouldRenderIntro(plan: FreeformPlan, page: FreeformPageSpec): boolean {
  if (plan.templateFamily === 'mechanic_precision_workshop') return page.pageKind === 'landing' || page.pageKind === 'about' || page.pageKind === 'contact'
  if (plan.templateFamily === 'clinic_private_care') return page.pageKind === 'landing' || page.pageKind === 'about' || page.pageKind === 'contact'
  if (plan.templateFamily === 'byggform_architectural_trust') return page.pageKind === 'landing' || page.pageKind === 'services' || page.pageKind === 'about'
  if (plan.templateFamily === 'service_company_modern') return page.pageKind === 'landing' || page.pageKind === 'about' || page.pageKind === 'contact'
  if (plan.templateFamily === 'service_clarity_default') return page.pageKind !== 'faq'
  return page.pageKind !== 'faq'
}

function shouldRenderGallery(plan: FreeformPlan, page: FreeformPageSpec, home: boolean): boolean {
  if (!home || page.pageKind === 'faq') return false
  if (plan.templateFamily === 'mechanic_precision_workshop') return false
  if (plan.templateFamily === 'clinic_private_care') return false
  if (plan.templateFamily === 'byggform_architectural_trust') return false
  if (plan.templateFamily === 'service_company_modern') return false
  return true
}

function shouldRenderContact(plan: FreeformPlan, page: FreeformPageSpec): boolean {
  if (plan.templateFamily === 'mechanic_precision_workshop') return page.pageKind === 'landing' || page.pageKind === 'contact'
  if (plan.templateFamily === 'clinic_private_care') return page.pageKind === 'landing' || page.pageKind === 'contact'
  if (plan.templateFamily === 'byggform_architectural_trust') return page.pageKind === 'landing' || page.pageKind === 'contact' || page.pageKind === 'faq'
  if (plan.templateFamily === 'service_company_modern') return page.pageKind === 'landing' || page.pageKind === 'contact'
  return page.pageKind !== 'contact'
}

function sourceFor(ctx: FreeformCtx, page: FreeformPageSpec): string {
  const p = ctx.scraped?.pages ?? {}
  const parts = [page.slug === 'om-oss' ? `${p.about?.summary ?? ''} ${p.about?.markdown ?? ''}` : '', /tjanster|behandlingar|service/i.test(page.slug) ? `${p.services?.summary ?? ''} ${p.services?.markdown ?? ''}` : '', `${p.home?.summary ?? ctx.scraped?.summary ?? ''} ${p.home?.markdown ?? ctx.scraped?.markdown ?? ''}`]
  return clean(decodeText(parts.filter(Boolean).join(' ')))
}
const SERVICE_HINTS: Record<string, RegExp> = {
  hair: /klipp|färg|sling|balayage|styling|hårvård|permanent|toning/i,
  nails: /nagel|manikyr|pedikyr|gele|akryl|fyllning/i,
  beauty: /frans|bryn|makeup|ansikt|vax|hudvård/i,
  clinic: /behandling|konsultation|injektion|laser|hudvård|undersökning|terapi/i,
  massage: /massage|behandling|terapi|stretch|avslappning/i,
  electrical: /elinstallat|elarbete|belysning|laddbox|elcentral|felsök|jordfelsbrytare|solcell|installation|service/i,
  plumbing: /rörarbete|avlopp|vattenläck|badrum|värmepump|installation|felsök|service/i,
  construction: /renover|badrum|kök|tillbygg|snicker|tak|fasad|mark|betong|mureri|plattsätt|montage/i,
  auto: /service|reparation|felsök|däck|bromsar|besiktning|motor|kamrem|ac-service|lack/i,
  cleaning: /städ|lokalvård|flyttstäd|fönsterputs|golvvård|storstäd/i,
  restaurant: /meny|lunch|catering|pizza|à la carte|dryck|frukost/i,
  general: /service|installation|reparation|underhåll|rådgiv|projekt|montage|konsultation/i,
}

const SERVICE_DEFAULTS: Record<string, string[]> = {
  hair: ['Personlig konsultation', 'Klippning och form', 'Färg och nyans', 'Styling inför tillfälle'],
  nails: ['Personlig konsultation', 'Manikyr', 'Pedikyr', 'Förstärkning och påfyllning'],
  beauty: ['Personlig konsultation', 'Fransar och bryn', 'Ansiktsbehandling', 'Rådgivning inför behandling'],
  clinic: ['Personlig konsultation', 'Behandlingsrådgivning', 'Uppföljning', 'Kontakt inför bokning'],
  massage: ['Massagebehandlingar', 'Personlig konsultation', 'Behandlingsrådgivning', 'Kontakt inför bokning'],
  electrical: ['Elinstallation', 'Felsökning och service', 'Belysning och uttag', 'Laddbox och elcentral'],
  plumbing: ['Rörinstallation', 'Felsökning och service', 'Badrum och våtrum', 'Akut hjälp vid läckage'],
  construction: ['Renovering', 'Snickeriarbeten', 'Tak och fasad', 'Projektledning och offert'],
  auto: ['Service och underhåll', 'Felsökning', 'Bromsar och däck', 'Rådgivning inför reparation'],
  cleaning: ['Regelbunden städning', 'Flyttstädning', 'Lokalvård för företag', 'Fönsterputs'],
  restaurant: ['Meny och rätter', 'Lunch', 'Catering', 'Bordsbokning'],
  general: ['Tydlig rådgivning', 'Genomtänkt utförande', 'Smidig kontakt', 'Nästa steg utan krångel'],
}

function serviceIdeas(ctx: FreeformCtx): string[] {
  const profile = buildProfile(ctx)
  const kind = profile.kind || 'general'
  const hint = SERVICE_HINTS[kind] ?? SERVICE_HINTS.general
  const raw = decodeText(`${ctx.scraped?.pages?.services?.markdown ?? ''} ${ctx.scraped?.pages?.home?.markdown ?? ctx.scraped?.markdown ?? ''}`)
  const found = raw.split(/[\n•|,;]+/)
    .map((s) => clean(s).replace(/^[-–—*\d.\s#]+/, '').replace(/\s{2,}/g, ' '))
    .filter(isGoodServiceTitle)
    .filter((s) => hint.test(s))
  const unique = Array.from(new Map(found.map((s) => [s.toLowerCase(), titleCaseSv(s)])).values()).slice(0, 6)
  if (unique.length >= 3) return unique
  return SERVICE_DEFAULTS[kind] ?? SERVICE_DEFAULTS.general
}
function serviceText(title: string, salon: boolean): string {
  if (/konsult|rådgiv/i.test(title)) return 'Ett lugnt första steg där behov, förväntningar och rätt väg framåt blir tydliga.'
  if (/klipp|färg|sling|balayage|styling|hud|massage|behandling|frans|bryn|nagel/i.test(title)) return 'Presenterat med fokus på känsla, kvalitet och ett resultat som passar kunden i vardagen.'
  return salon ? 'En tydlig behandlingstext med fokus på känsla, trygghet och personlig rådgivning.' : 'En tydlig presentation av erbjudandet, skriven utan påhittade priser eller löften.'
}

const STOCK_BY_KIND: Record<string, string[]> = {
  hair: ['https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1600&q=80', 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=1400&q=80', 'https://images.unsplash.com/photo-1522337660859-02fbefca4702?auto=format&fit=crop&w=1400&q=80'],
  nails: ['https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=1600&q=80', 'https://images.unsplash.com/photo-1607779097040-26e80aa78e66?auto=format&fit=crop&w=1400&q=80', 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1400&q=80'],
  beauty: ['https://images.unsplash.com/photo-1596704017254-9b121068fb31?auto=format&fit=crop&w=1600&q=80', 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1400&q=80', 'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&w=1400&q=80'],
  clinic: ['https://images.unsplash.com/photo-1519823551278-64ac92734fb1?auto=format&fit=crop&w=1600&q=80', 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1400&q=80', 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=1400&q=80'],
  massage: ['https://images.unsplash.com/photo-1600334129128-685c5582fd35?auto=format&fit=crop&w=1600&q=80', 'https://images.unsplash.com/photo-1519823551278-64ac92734fb1?auto=format&fit=crop&w=1400&q=80', 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1400&q=80'],
  electrical: ['https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=1600&q=80', 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=1400&q=80', 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=1400&q=80'],
  plumbing: ['https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?auto=format&fit=crop&w=1600&q=80', 'https://images.unsplash.com/photo-1585704032915-c3400ca199e7?auto=format&fit=crop&w=1400&q=80', 'https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1400&q=80'],
  construction: ['https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1600&q=80', 'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=1400&q=80', 'https://images.unsplash.com/photo-1581094794329-c8112a89af12?auto=format&fit=crop&w=1400&q=80'],
  auto: ['https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=1600&q=80', 'https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?auto=format&fit=crop&w=1400&q=80', 'https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?auto=format&fit=crop&w=1400&q=80'],
  cleaning: ['https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1600&q=80', 'https://images.unsplash.com/photo-1563453392212-326f5e854473?auto=format&fit=crop&w=1400&q=80', 'https://images.unsplash.com/photo-1585421514738-01798e348b17?auto=format&fit=crop&w=1400&q=80'],
  restaurant: ['https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=80', 'https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1400&q=80', 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1400&q=80'],
  general: ['https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1600&q=80', 'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1400&q=80', 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1400&q=80'],
}

function images(ctx: FreeformCtx): string[] {
  const profile = buildProfile(ctx)
  const stock = STOCK_BY_KIND[profile.kind || 'general'] ?? STOCK_BY_KIND.general
  const own = (ctx.imagePool || []).filter((u) => /^https?:\/\//i.test(u) && !/images\.unsplash\.com/i.test(u))
  return Array.from(new Set([...stock, ...own])).slice(0, 6)

}
function cleanContentMap(input: any): Record<string, FreeformPageContent> {
  const out: Record<string, FreeformPageContent> = {}
  if (!input || typeof input !== 'object') return out
  for (const [k, v] of Object.entries(input)) if (v && typeof v === 'object') out[slug(k)] = cleanContent(v, null, { slug: slug(k), title: k, purpose: '', sections: [] })
  return out
}
function cleanContent(v: any, ctx: FreeformCtx | null, page: FreeformPageSpec): FreeformPageContent {
  const arr = (a: any) => Array.isArray(a) ? a : []
  const faqItems = (items: any) => arr(items).map((f: any) => ({ question: clean(decodeText(String(f?.question ?? ''))).slice(0, 90), answer: clean(decodeText(String(f?.answer ?? ''))).slice(0, 260) })).filter((f: any) => f.question && f.answer).slice(0, 6)
  return {
    metaTitle: clean(decodeText(String(v?.metaTitle ?? ''))).slice(0, 80) || page.title,
    metaDescription: clean(decodeText(String(v?.metaDescription ?? ''))).slice(0, 155),
    heroEyebrow: clean(decodeText(String(v?.heroEyebrow ?? ''))).slice(0, 44),
    heroTitle: clean(decodeText(String(v?.heroTitle ?? ''))).slice(0, 95),
    heroLead: clean(decodeText(String(v?.heroLead ?? ''))).slice(0, 320),
    introTitle: clean(decodeText(String(v?.introTitle ?? ''))).slice(0, 90),
    introText: clean(decodeText(String(v?.introText ?? ''))).slice(0, 520),
    primaryCta: clean(decodeText(String(v?.primaryCta ?? ''))).slice(0, 34),
    secondaryCta: clean(decodeText(String(v?.secondaryCta ?? ''))).slice(0, 34),
    services: arr(v?.services).map((s: any) => ({ title: clean(decodeText(String(s?.title ?? ''))).slice(0, 58), text: clean(decodeText(String(s?.text ?? ''))).slice(0, 240), detail: clean(decodeText(String(s?.detail ?? ''))).slice(0, 180) })).filter((s: any) => s.title && s.text).slice(0, 6),
    sections: arr(v?.sections).map((s: any) => ({ eyebrow: clean(decodeText(String(s?.eyebrow ?? ''))).slice(0, 34), title: clean(decodeText(String(s?.title ?? ''))).slice(0, 85), text: clean(decodeText(String(s?.text ?? ''))).slice(0, 420), bullets: arr(s?.bullets).map((b: any) => clean(decodeText(String(b)))).filter(Boolean).slice(0, 5) })).filter((s: any) => s.title && s.text).slice(0, 5),
    faqs: faqItems(v?.faqs).slice(0, 5),
    faqGroups: arr(v?.faqGroups).map((g: any) => ({ title: clean(decodeText(String(g?.title ?? ''))).slice(0, 52), items: faqItems(g?.items) })).filter((g: any) => g.title && g.items.length).slice(0, 3),
    closingTitle: clean(decodeText(String(v?.closingTitle ?? ''))).slice(0, 90),
    closingText: clean(decodeText(String(v?.closingText ?? ''))).slice(0, 260),
    source: v?.source === 'fallback' ? 'fallback' : v?.source === 'polished' ? 'polished' : v?.source === 'ai' ? 'ai' : undefined,
  }
}

function repairContent(ctx: FreeformCtx, input: FreeformPageContent): FreeformPageContent {
  const profile = buildProfile(ctx)
  const fallback = fallbackContent(ctx, { slug: 'index', title: ctx.facts.business_name || 'Start', purpose: '', sections: [] })
  const badText = (s?: string) => !s || hasBadLanguage(s) || /sidan|webbplats|demo|AI|anpassad efter företaget/i.test(s)
  const services = (input.services || [])
    .filter((s) => isGoodServiceTitle(s.title))
    .filter((s, i, arr) => arr.findIndex((x) => x.title.toLowerCase() === s.title.toLowerCase()) === i)
    .slice(0, 6)
  const faqs = (input.faqs || []).filter((f) => f.question && f.answer && !/anpassad efter företaget|sidan|webbplats/i.test(`${f.question} ${f.answer}`)).slice(0, 4)
  const faqGroups = (input.faqGroups || [])
    .map((g) => ({ ...g, items: (g.items || []).filter((f) => f.question && f.answer && !/anpassad efter företaget|sidan|webbplats|random|mall/i.test(`${f.question} ${f.answer}`)).slice(0, 5) }))
    .filter((g) => g.title && g.items.length >= 2)
    .slice(0, 3)
  return {
    ...input,
    heroEyebrow: badText(input.heroEyebrow) ? profile.heroEyebrow : decodeText(input.heroEyebrow || ''),
    heroTitle: badText(input.heroTitle) ? fallback.heroTitle : decodeText(input.heroTitle || ''),
    heroLead: badText(input.heroLead) ? fallback.heroLead : decodeText(input.heroLead || ''),
    introTitle: badText(input.introTitle) ? fallback.introTitle : decodeText(input.introTitle || ''),
    introText: badText(input.introText) ? fallback.introText : decodeText(input.introText || ''),
    services: services.length >= 3 ? services : fallback.services,
    sections: (input.sections || []).filter((s) => !badText(s.title) && !badText(s.text)).slice(0, 4).length ? (input.sections || []).filter((s) => !badText(s.title) && !badText(s.text)).slice(0, 4) : fallback.sections,
    faqs: faqs.length >= 3 ? faqs : fallback.faqs,
    faqGroups: faqGroups.length ? faqGroups : fallback.faqGroups,
    closingTitle: badText(input.closingTitle) ? fallback.closingTitle : decodeText(input.closingTitle || ''),
    closingText: badText(input.closingText) ? fallback.closingText : decodeText(input.closingText || ''),
  }
}
function normalizeProgress(raw: FreeformProgress | null | undefined, files: Record<string, string>, ctx: FreeformCtx): FreeformProgress {
  const plan = raw?.plan || buildPlan(ctx)
  const content = cleanContentMap(raw?.content)
  let stage: Stage = raw?.stage === 'theme' || raw?.stage === 'content' || raw?.stage === 'polish_content' || raw?.stage === 'render' || raw?.stage === 'quality_check' || raw?.stage === 'done' ? raw.stage : raw?.stage === 'design' ? 'theme' : raw?.stage === 'pages' || raw?.stage === 'polish' ? 'content' : 'plan'
  if (stage !== 'done') {
    if (!files['style.css'] || files['style.css'].length < 1200) stage = 'theme'
    else if (plan.pages.some((p) => !content[p.slug])) stage = 'content'
    else if (plan.pages.some((p) => !(raw?.polished || []).includes(p.slug))) stage = 'polish_content'
    else if (plan.pages.some((p) => !files[fileNameFor(p.slug)])) stage = 'render'
    else stage = 'quality_check'
  }
  return meta({ version: VERSION, stage, plan, profile: raw?.profile ?? buildProfile(ctx), factPack: raw?.factPack ?? buildFactPack(ctx), theme: raw?.theme, design: raw?.design, content, rendered: raw?.rendered || raw?.built || [], built: raw?.built || [], polished: raw?.polished || [], fallbacksUsed: raw?.fallbacksUsed || [], lastError: raw?.lastError, lastStage: raw?.lastStage })
}
function addFallback(p: FreeformProgress, label: string): string[] { return Array.from(new Set([...(p.fallbacksUsed || []), label])).slice(0, 20) }
export function fileNameFor(s: string): string { return slug(s) === 'index' ? 'index.html' : `${slug(s)}.html` }
function slug(s: string): string { const x = String(s || '').toLowerCase().replace(/\.html?$/, '').replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); return !x || x === 'home' || x === 'start' ? 'index' : x }
function strip(s: string): string { return String(s || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim() }
function parseJson(s: string): any { const x = strip(s); try { return JSON.parse(x) } catch (_) { const a = x.indexOf('{'), b = x.lastIndexOf('}'); if (a >= 0 && b > a) return JSON.parse(x.slice(a, b + 1)); throw new Error(`invalid JSON: ${x.slice(0, 160)}`) } }
function clean(s: string): string { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }
function esc(s: string): string { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function attr(s: string): string { return esc(s).replace(/'/g, '&#39;') }
function isSalon(ctx: FreeformCtx): boolean { return buildProfile(ctx).isBeauty }

function titleCaseSv(s: string): string { return clean(decodeText(s)).split(/\s+/).map((w) => w.length <= 3 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ') }
function decodeText(s: string): string {
  return String(s || '')
    .replace(/Ã¥/g, 'å').replace(/Ã¤/g, 'ä').replace(/Ã¶/g, 'ö')
    .replace(/Ã…/g, 'Å').replace(/Ã„/g, 'Ä').replace(/Ã–/g, 'Ö')
    .replace(/Ã©/g, 'é').replace(/â€“/g, '–').replace(/â€”/g, '—').replace(/â€™/g, '’').replace(/Â/g, '')
}
function hasBadLanguage(s: string): boolean {
  const x = decodeText(s)
  const englishHits = (x.match(/\b(the|and|with|for|patients|clinic|offers|including|quality|personalized|booking|available)\b/gi) || []).length
  return /Ã|Â|â€/.test(s) || englishHits >= 2
}
function isGoodServiceTitle(s: string): boolean {
  const x = clean(decodeText(s))
  if (x.length < 4 || x.length > 48) return false
  if (x.split(/\s+/).length > 6) return false
  if (/^(behandlingar|tjänster|kontakt|hem|om oss|pris|priser)$/i.test(x)) return false
  if (/[.!?]$/.test(x)) return false
  if (/\b(bör|ska|måste|innan|under|efter|timmarna|cookies|policy|meny|copyright|läs mer|klicka|online)\b/i.test(x)) return false
  return true
}
function qualityFixFiles(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(files)) {
    let v = decodeText(value)
      .replace(/\bPersonligt anpassad\b/g, 'Personlig rådgivning')
      .replace(/\bModern presentation med tydlig information, stark mobilupplevelse och enkel kontakt\./g, 'Tydlig information, varm känsla och enkel kontakt inför nästa steg.')
      .replace(/\bSidan visar\b/gi, 'Här finns')
      .replace(/\bwebbplatsen\b/gi, 'informationen')
      .replace(/\bdemo\b/gi, 'presentation')
    out[name] = v
  }
  return out
}
function font(f: string | undefined, fallback: string): string { const x = String(f || '').replace(/[^a-zA-Z0-9 åäöÅÄÖ_-]/g, '').trim().slice(0, 60); return x ? `'${x}',${fallback}` : fallback }
function palette(ctx: FreeformCtx) {
  const salon = isSalon(ctx)
  const input = ctx.brandPalette || {}
  const bg = color(input.background, salon ? '#f8f1eb' : '#0a0e1a')
  const primary = color(input.primary, salon ? '#8f5563' : '#f97316')
  const light = lum(bg) > .56
  return {
    primary,
    secondary: color(input.secondary, salon ? '#bd9075' : '#0ea5e9'),
    accent: color(input.accent, salon ? '#d7b98d' : '#f59e0b'),
    background: bg,
    surface: color(input.surface, salon ? '#fffaf6' : '#131a2b'),
    text: readable(bg, color(input.textPrimary, light ? '#291f20' : '#f1f5f9'), light ? '#241b1d' : '#ffffff'),
    muted: readable(bg, color(input.textSecondary, light ? '#665756' : '#cbd5e1'), light ? '#5f5150' : '#d8d0ca'),
    onPrimary: contrast(primary, '#fff') >= contrast(primary, '#241b1d') ? '#fff' : '#241b1d',
    border: light ? 'rgba(54,42,38,.13)' : 'rgba(255,255,255,.13)',
    shadow: light ? 'rgba(70,50,43,.14)' : 'rgba(0,0,0,.34)',
    glow: light ? 'rgba(215,185,141,.34)' : 'rgba(249,115,22,.18)',
  }
}
function color(v: string, f: string): string { const x = String(v || '').trim(); return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(x) || /^rgb(a)?\([^)]+\)$/i.test(x) ? x : f }
function readable(bg: string, pref: string, fallback: string): string { return contrast(bg, pref) >= 4.5 ? pref : contrast(bg, fallback) >= 4.5 ? fallback : contrast(bg, '#111') >= contrast(bg, '#fff') ? '#111' : '#fff' }
function contrast(a: string, b: string): number { const A = lum(a), B = lum(b), l = Math.max(A, B), d = Math.min(A, B); return (l + .05) / (d + .05) }
function lum(c: string): number { const r = rgb(c); if (!r) return 0; const a = [r.r, r.g, r.b].map((v) => { const s = v / 255; return s <= .03928 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2] }
function rgb(c: string): { r: number; g: number; b: number } | null { const x = String(c || '').trim().toLowerCase(); if (/^#[0-9a-f]{3}$/i.test(x)) return { r: parseInt(x[1] + x[1], 16), g: parseInt(x[2] + x[2], 16), b: parseInt(x[3] + x[3], 16) }; if (/^#[0-9a-f]{6}$/i.test(x)) return { r: parseInt(x.slice(1, 3), 16), g: parseInt(x.slice(3, 5), 16), b: parseInt(x.slice(5, 7), 16) }; const m = x.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? { r: +m[1], g: +m[2], b: +m[3] } : null }

async function callModel(key: string, model: string, label: string, system: string, user: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(OPENROUTER_URL, { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://emailsbotlio.lovable.app', 'X-Title': 'Botlio Freeform Site Builder V7' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: .55, max_tokens: maxTokens, response_format: { type: 'json_object' } }) })
    if (!resp.ok) throw new Error(`${model} ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
    const data = await resp.json()
    const content = data.choices?.[0]?.message?.content
    const text = Array.isArray(content) ? content.map((p: any) => p?.text || '').join('') : String(content || '')
    if (!text.trim()) throw new Error(`${model} returned empty content`)
    return text
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s on ${model}`)
    throw e
  } finally {
    clearTimeout(id)
  }
}

async function callBuildModelCascade(ctx: FreeformCtx, key: string, label: string, system: string, user: string, maxTokens: number): Promise<{ model: string; text: string }> {
  const attempts: { model: string; timeoutMs: number }[] = isEnglish(ctx)
    ? [
        { model: BUILD_FALLBACK_MODEL, timeoutMs: 40_000 },
        { model: BUILD_LAST_RESORT_MODEL, timeoutMs: 42_000 },
      ]
    : [
        { model: BUILD_MODEL, timeoutMs: 38_000 },
        { model: BUILD_FALLBACK_MODEL, timeoutMs: 42_000 },
        { model: BUILD_LAST_RESORT_MODEL, timeoutMs: 42_000 },
      ]
  const errors: string[] = []
  for (const attempt of attempts) {
    try {
      const text = await callModel(key, attempt.model, label, system, user, maxTokens, attempt.timeoutMs)
      return { model: attempt.model, text }
    } catch (error) {
      errors.push(`${attempt.model}: ${(error as Error).message}`)
    }
  }
  throw new Error(errors.join(' | '))
}
