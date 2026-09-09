// Shared website audit: scrape a lead's existing site with Firecrawl
// (markdown + screenshot) and score it 1-10 with a vision model.
//
// Why the screenshot matters: the old audit judged design from markdown only.
// Modern, well-designed sites have very little text, so the "thin content"
// rule pushed almost everything to 4 or below regardless of how good the site
// actually looked. Scoring now leads with the rendered screenshot; text is a
// secondary signal only.

import { callRoutedChat } from './ai-provider.ts'
import { scrapeUrl, type ScrapeProvider, type ScraperPayload } from './scraper-client.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface AuditResult {
  score: number
  reason: string
  /** Whether the lead has an owned website, not merely a booking/profile page. */
  websitePresence: WebsitePresence
  /** structural + cosmetic concatenated — kept for existing consumers. */
  weaknesses: string[]
  /** Real deficiencies that make an owner want a new site. */
  structural: string[]
  /** Polish nits that alone never justify a rebuild. */
  cosmetic: string[]
  /** true when we could not read the site at all (blocked / down / parked). */
  unreadable: boolean
  /** true when Firecrawl was blocked — score is a guess, not a verdict. */
  uncertain: boolean
  url: string
  title: string
  markdown: string
  screenshot: string | null
  /** Confidence after the optional second opinion has been reconciled. */
  confidence: 'high' | 'medium' | 'low'
  /** The second vision model is used only for uncertain/borderline results. */
  secondOpinionUsed: boolean
  firstScore: number
  secondScore: number | null
  scoreDisagreement: number | null
  providerUsed: string
  modelUsed: string
  secondProviderUsed: string | null
  secondModelUsed: string | null
  secondOpinionError: string | null
  /** Short-lived compact scrape reused by generation to avoid a second homepage capture. */
  scrapeCache: Record<string, unknown> | null
}

export type WebsitePresence =
  | 'owned_site'
  | 'third_party_booking_or_profile'
  | 'no_functional_website'
  | 'uncertain'


export interface ScrapeResult {
  markdown: string
  title: string
  description: string
  screenshot: string | null
  blocked: boolean
  providerUsed: string
  fallbackFrom: string | null
  cachePayload: Record<string, unknown> | null
}

export function guardedAuditScore(
  rawScore: unknown,
  options: { hasScreenshot: boolean; hasStructuralIssues: boolean },
): number {
  let score = Math.max(1, Math.min(10, Math.round(Number(rawScore) || 5)))
  if (!options.hasScreenshot) score = Math.min(6, Math.max(4, score))
  if (!options.hasStructuralIssues) score = Math.max(5, score)
  return score
}

export function shouldRequestSecondOpinion(
  score: number,
  confidence: 'high' | 'medium' | 'low',
  hasScreenshot: boolean,
): boolean {
  if (!hasScreenshot) return false
  return (score >= 4 && score <= 6) || confidence === 'low'
}

export function normaliseUrl(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s.replace(/^\/+/, '')}`
}

/** Scrape once through the configured provider boundary, requesting a screenshot. */
export async function scrapeForAudit(url: string, provider: ScrapeProvider): Promise<ScrapeResult> {
  const empty: ScrapeResult = {
    markdown: '', title: '', description: '', screenshot: null, blocked: true,
    providerUsed: provider, fallbackFrom: null,
    cachePayload: null,
  }
  if (!url) return empty
  const payload: ScraperPayload = await scrapeUrl(provider, url, { screenshot: true })
  return {
    markdown: String(payload.markdown ?? ''),
    title: String(payload.metadata?.title ?? ''),
    description: String(payload.metadata?.description ?? ''),
    screenshot: typeof payload.screenshot === 'string' && payload.screenshot.trim()
      ? payload.screenshot
      : null,
    blocked: false,
    providerUsed: payload.provider_used ?? provider,
    fallbackFrom: payload.fallback_from ?? null,
    cachePayload: {
      markdown: String(payload.markdown ?? '').slice(0, 12_000),
      summary: String(payload.summary ?? '').slice(0, 2_000),
      screenshot: typeof payload.screenshot === 'string' ? payload.screenshot.slice(0, 2_000) : null,
      metadata: {
        title: String(payload.metadata?.title ?? '').slice(0, 500),
        description: String(payload.metadata?.description ?? '').slice(0, 1_000),
        statusCode: payload.metadata?.statusCode ?? 200,
      },
      links: Array.isArray(payload.links) ? payload.links.filter((x): x is string => typeof x === 'string').slice(0, 60) : [],
      branding: payload.branding ?? null,
      provider_used: payload.provider_used ?? provider,
      fallback_from: payload.fallback_from ?? null,
    },
  }
}



const SYSTEM_PROMPT = [
  'Du bedömer KVALITETEN på små företags befintliga hemsidor inför en säljpipeline för nya hemsidor.',
  'Poängen avser NUVARANDE WEBBPLATSKVALITET, inte personens köpvilja.',
  'Låg poäng = gammal, trasig eller svag hemsida och därmed stark säljmöjlighet.',
  'Hög poäng = modern, trovärdig hemsida som sannolikt inte behöver ersättas.',
  'Var KONSEKVENT och DETERMINISTISK — samma input MÅSTE ge samma svar.',
  '',
  'Du får två beviskällor som måste vägas samman:',
  '1. SKÄRMBILDEN visar visuell ålder, layout, hierarki, bildkvalitet, läsbarhet och första intryck.',
  '2. SCRAPAD TEXT visar faktiska tjänster, kontaktvägar, företagsidentitet och om innehållet är komplett.',
  'Påstå aldrig att hela sajten saknar innehåll bara för att textutdraget är kort eller blockerat av cookie-banner.',
  '',
  'Klassificera också "website_presence" strikt utifrån bevisen:',
  '- "owned_site" = företaget har en egen, faktisk hemsida, även om den är dålig eller gammal.',
  '- "third_party_booking_or_profile" = länken är bara en bokningssida, katalog/profil, social profil eller marknadsplats och inte företagets egen hemsida.',
  '- "no_functional_website" = det finns ingen fungerande företagshemsida alls.',
  '- "uncertain" = underlaget räcker inte för att avgöra. Gissa aldrig.',
  'En egen sajt med en bokningswidget är fortfarande "owned_site".',
  '',
  'Webbplatskvalitet 1-10:',
  '  1    = ingen riktig sajt: parkerad domän, trasig sida eller bara tredjepartsprofil.',
  '  2-3  = mycket gammal eller vanskött: trasiga bilder/länkar, fel företagsnamn,',
  '         platshållartext eller tydligt pre-2015-utseende.',
  '  4    = synligt föråldrad men fungerande; flera verkliga problem gör en ny sajt lätt att motivera.',
  '  5    = fungerande men tydligt daterad småföretagssajt; blandad kvalitet och ett mänskligt gränsfall.',
  '  6    = acceptabel och relativt aktuell, men med märkbara förbättringsmöjligheter.',
  '  7    = modern nog, tydlig och fungerande; en total ombyggnad är svår att motivera.',
  '  8    = modern, sammanhållen, mobilvänlig och förtroendeingivande.',
  '  9-10 = mycket professionell, aktuell och utan meningsfulla brister.',
  '',
  'Dela svagheterna i två listor:',
  '- "structural" = riktiga brister: föråldrat utseende, ingen mobilanpassning, platshållartext',
  '  eller fel företagsnamn, trasiga länkar/bilder, ingen egen webbdomän,',
  '  bara tredjepartsprofil, saknar helt tjänster eller kontaktuppgifter.',
  '- "cosmetic" = putsdetaljer: saknad CTA-knapp, svag hierarki, generisk mall, tunn copy,',
  '  saknade priser, cookie-banner, steril känsla, tråkig typografi.',
  '',
  'ABSOLUT REGEL: enbart kosmetiska brister får ALDRIG ge webbplatskvalitet under 5.',
  'En sajt som fungerar men saknar CTA-knapp eller känns generisk är fortfarande en fungerande sajt.',
  'Bara synliga eller verifierbara "structural"-brister får dra ner betyget under 5.',
  '',
  'Regler som ofta missförstås — följ dem exakt:',
  '- LITE TEXT ÄR INTE ETT FEL. Moderna sajter har ofta kort copy. Sänk ALDRIG betyget bara för att textutdraget är kort.',
  '- Att sajten är byggd i Wix / Squarespace / Wordpress / One.com / Webflow / Shopify är INTE i sig negativt. Döm på resultatet, inte verktyget.',
  '- Om skärmbilden saknas: du kan inte bedöma modernitet säkert. Döm försiktigt runt 5 och markera bara verifierade textproblem.',
  '- Om textutdraget är tunt men skärmbilden ser komplett och modern ut: lita på skärmbilden för designen och sänk inte automatiskt.',
  '- Om skärmbilden ser gammal eller trasig ut men texten är rik: den visuella bristen är fortfarande verklig.',
  '- Sätt bara 1-2 om du faktiskt SER att sidan är trasig, tom eller bara en tredjepartsprofil.',
  '- Bedöm ENDAST det du faktiskt ser eller läser. Spekulera inte.',
  '',
  'Svara ENDAST med strikt JSON:',
  '{"score": <heltal 1-10>, "confidence": "high|medium|low", "website_presence": "owned_site|third_party_booking_or_profile|no_functional_website|uncertain", "reason": "<max 200 tecken, konkret evidens på svenska>", "structural": ["<riktig brist>"], "cosmetic": ["<putsdetalj>"]}',
  'Båda listorna får vara tomma. Punkterna ska vara på svenska, konkreta och användbara som argument i ett kallmail.',
].join('\n')

type AuditJudgment = {
  score: number
  confidence: 'high' | 'medium' | 'low'
  websitePresence: WebsitePresence
  reason: string
  structural: string[]
  cosmetic: string[]
  provider: string
  model: string
}

function messageText(data: unknown): string {
  const shaped = data as { choices?: Array<{ message?: { content?: unknown } }> }
  const content = shaped.choices?.[0]?.message?.content
  return Array.isArray(content)
    ? content.map((part: unknown) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: unknown }).text ?? '')
      }
      return ''
    }).join('')
    : String(content ?? '')
}

function parseJudgment(data: unknown, provider: string, model: string, hasScreenshot: boolean): AuditJudgment {
  let parsed: {
    score?: unknown
    confidence?: unknown
    website_presence?: unknown
    reason?: unknown
    weaknesses?: unknown
    structural?: unknown
    cosmetic?: unknown
  } = {}
  try {
    const cleaned = messageText(data)
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()
    parsed = JSON.parse(cleaned || '{}')
  } catch { /* validated by callRoutedChat; safe defaults below */ }

  const clean = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 5)
      : []
  const structural = clean(parsed.structural)
  const explicitCosmetic = clean(parsed.cosmetic)
  const cosmetic = explicitCosmetic.length || structural.length
    ? explicitCosmetic
    : clean(parsed.weaknesses)
  const score = guardedAuditScore(parsed.score, {
    hasScreenshot,
    hasStructuralIssues: structural.length > 0,
  })
  const rawConfidence = String(parsed.confidence ?? '').toLowerCase()
  const confidence: AuditJudgment['confidence'] = !hasScreenshot
    ? 'low'
    : rawConfidence === 'high' || rawConfidence === 'low'
      ? rawConfidence
      : 'medium'
  const rawPresence = String(parsed.website_presence ?? '').toLowerCase()
  const websitePresence: WebsitePresence = rawPresence === 'owned_site'
    || rawPresence === 'third_party_booking_or_profile'
    || rawPresence === 'no_functional_website'
    || rawPresence === 'uncertain'
    ? rawPresence
    : 'uncertain'

  return {
    score,
    confidence,
    websitePresence,
    reason: String(parsed.reason ?? '').slice(0, 500),
    structural,
    cosmetic,
    provider,
    model,
  }
}

function auditUserContent(
  url: string,
  companyName: string,
  scraped: ScrapeResult,
): unknown[] {
  const content: unknown[] = [{
    type: 'text',
    text: [
      `URL: ${url}`,
      `Företag: ${companyName}`,
      `Titel: ${scraped.title}`,
      `Metabeskrivning: ${scraped.description}`,
      scraped.screenshot
        ? 'Skärmbild av startsidan bifogas — den är ditt viktigaste underlag.'
        : 'Ingen skärmbild tillgänglig — modernitet kan inte bedömas säkert.',
      '',
      'Textinnehåll (utdrag):',
      scraped.markdown.slice(0, 4000) || '(inget textutdrag)',
    ].join('\n'),
  }]
  if (scraped.screenshot) {
    content.push({ type: 'image_url', image_url: { url: scraped.screenshot } })
  }
  return content
}

async function scoreAudit(
  supabase: SupabaseClient,
  userContent: unknown[],
  language: 'sv' | 'en',
  options: { secondOpinion?: boolean } = {},
): Promise<AuditJudgment> {
  const outputLanguageRule = language === 'en'
    ? 'Return reason, structural and cosmetic in natural English. Keep the JSON keys unchanged.'
    : 'Skriv reason, structural och cosmetic på naturlig svenska. Behåll JSON-nycklarna oförändrade.'
  const independentRule = options.secondOpinion
    ? '\nThis is an independent second opinion. Judge the supplied evidence yourself; do not assume another reviewer was correct.'
    : ''
  const routed = await callRoutedChat({
    supabase,
    // The previous Qwen vision route was retired by NVIDIA in July 2026.
    // Kimi K2.5 is an active NVIDIA-hosted multimodal model, so it can still
    // judge the homepage screenshot as well as the scraped text.
    nvidiaModel: 'moonshotai/kimi-k2.5',
    openrouterModel: options.secondOpinion ? 'openai/gpt-4.1-mini' : 'google/gemini-2.5-flash',
    preferredProvider: options.secondOpinion ? 'openrouter' : undefined,
    title: options.secondOpinion ? 'Botlio Site Audit Second Opinion' : 'Botlio Site Audit',
    timeoutMs: 60_000,
    requireJsonObject: true,
    body: {
      temperature: 0,
      top_p: 1,
      seed: 42,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\n${outputLanguageRule}${independentRule}` },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
    },
  })
  const hasScreenshot = userContent.some((part: unknown) =>
    Boolean(part && typeof part === 'object' && 'type' in part && (part as { type?: unknown }).type === 'image_url')
  )
  return parseJudgment(routed.data, routed.provider, routed.model, hasScreenshot)
}


/** Score a scraped site. Returns a fair, screenshot-first verdict. */
export async function auditWebsite(
  rawUrl: string,
  companyName: string,
  language: 'sv' | 'en',
  supabase: SupabaseClient,
  scrapeProvider: ScrapeProvider,
): Promise<AuditResult> {
  const url = normaliseUrl(rawUrl)
  const scraped = await scrapeForAudit(url, scrapeProvider)
  const hasText = scraped.markdown.replace(/\s+/g, ' ').trim().length > 40

  if (!scraped.screenshot && !hasText) {
    // The provider returned a successful but empty response. This remains a
    // human-review result; callers never auto-build or auto-park from it.
    const noSiteIssues = scraped.blocked
      ? [language === 'en' ? 'Could not be read automatically — check manually.' : 'Kunde inte läsas automatiskt — kontrollera manuellt.']
      : [language === 'en' ? 'No readable website content was returned.' : 'Ingen läsbar hemsida returnerades.']
    return {
      score: scraped.blocked ? 5 : 1,
      reason: language === 'en'
        ? 'The site returned no reliable visual or text evidence and requires manual review.'
        : 'Sajten gav inget tillförlitligt visuellt eller textbaserat underlag och kräver manuell kontroll.',
      websitePresence: 'uncertain',
      weaknesses: noSiteIssues,
      structural: noSiteIssues,
      cosmetic: [],
      unreadable: true,
      uncertain: true,
      url,
      title: '',
      markdown: '',
      screenshot: null,
      confidence: 'low',
      secondOpinionUsed: false,
      firstScore: scraped.blocked ? 5 : 1,
      secondScore: null,
      scoreDisagreement: null,
      providerUsed: scraped.providerUsed,
      modelUsed: 'none',
      secondProviderUsed: null,
      secondModelUsed: null,
      secondOpinionError: null,
      scrapeCache: scraped.cachePayload,
    }
  }

  const userContent = auditUserContent(url, companyName, scraped)
  const first = await scoreAudit(supabase, userContent, language)

  // A second model sees the same visual evidence only when the first verdict
  // is genuinely uncertain. Clear extremes stay one-call audits.
  const needsSecondOpinion = shouldRequestSecondOpinion(
    first.score,
    first.confidence,
    Boolean(scraped.screenshot),
  )
  let second: AuditJudgment | null = null
  let secondOpinionError: string | null = null
  if (needsSecondOpinion) {
    try {
      second = await scoreAudit(supabase, userContent, language, { secondOpinion: true })
    } catch (error) {
      // The first visual verdict is still useful. A second-opinion outage must
      // not stall the entire audit queue; mark the result low-confidence so it
      // stays visibly uncertain for the operator.
      secondOpinionError = (error instanceof Error ? error.message : String(error)).slice(0, 400)
      console.warn(`audit second opinion unavailable for ${url}: ${secondOpinionError}`)
    }
  }
  const disagreement = second ? Math.abs(first.score - second.score) : null

  // The independent OpenRouter judge is the tie-breaker in the manual-review
  // band. We still retain both scores so later calibration can measure it.
  const chosen = second ?? first
  const confidence: AuditResult['confidence'] = !scraped.screenshot
    ? 'low'
    : Boolean(secondOpinionError) || (disagreement != null && disagreement >= 2)
      ? 'low'
      : second
        ? (first.confidence === 'high' && second.confidence === 'high' ? 'high' : 'medium')
        : first.confidence

  return {
    score: chosen.score,
    reason: chosen.reason,
    websitePresence: chosen.websitePresence,
    weaknesses: [...chosen.structural, ...chosen.cosmetic].slice(0, 6),
    structural: chosen.structural,
    cosmetic: chosen.cosmetic,
    unreadable: false,
    uncertain: !scraped.screenshot || confidence === 'low',
    url,
    title: scraped.title,
    markdown: scraped.markdown,
    screenshot: scraped.screenshot,
    confidence,
    secondOpinionUsed: Boolean(second),
    firstScore: first.score,
    secondScore: second?.score ?? null,
    scoreDisagreement: disagreement,
    providerUsed: scraped.providerUsed,
    modelUsed: first.model,
    secondProviderUsed: second?.provider ?? null,
    secondModelUsed: second?.model ?? null,
    secondOpinionError,
    scrapeCache: scraped.cachePayload,
  }
}
