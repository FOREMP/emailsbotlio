import {
  normaliseUrl,
  scrapeForAudit,
  type AuditResult,
  type WebsitePresence,
} from './site-audit.ts'
import type { ScrapeProvider } from './scraper-client.ts'

type SupabaseClient = any

type LeadContext = {
  url: string
  companyName: string
  language: 'sv' | 'en'
  category?: string | null
  email?: string | null
  phone?: string | null
  supabase: SupabaseClient
  scrapeProvider: ScrapeProvider
}

type JevDecision = {
  decision: 'needs_site' | 'site_good_enough' | 'needs_review' | 'skip_ecommerce'
  confidence: number
  score: number
  hasOwnedWebsite: number
  isEcommerce: number
  isThirdPartyOnly: number
  raw: Record<string, unknown>
}

const JEV_MODEL = 'typesafe/jev-1.13'
const JEV_CONFIDENT_THRESHOLD = 0.60

export async function auditWebsiteWithJev(ctx: LeadContext): Promise<AuditResult> {
  const url = normaliseUrl(ctx.url)
  const scraped = await scrapeForAudit(url, ctx.scrapeProvider, { screenshot: false })
  const hasText = scraped.markdown.replace(/\s+/g, ' ').trim().length > 40

  if (!hasText && !scraped.title && !scraped.description && scraped.links.length === 0) {
    return emptyManualResult(ctx.language, url, scraped)
  }

  const decision = await decideWithJev({
    business_name: ctx.companyName,
    language: ctx.language,
    category: ctx.category ?? null,
    email_present: Boolean(ctx.email),
    phone_present: Boolean(ctx.phone),
    url,
    title: scraped.title,
    description: scraped.description,
    markdown_excerpt: compactText(scraped.markdown, 7_000),
    links: scraped.links.slice(0, 40),
    provider_used: scraped.providerUsed,
    rules: [
      'Botlio sells simple premium presentation websites for local service businesses.',
      'True e-commerce with cart/checkout is outside the offer and should be skipped as good enough.',
      'A third-party booking/profile page only, no owned website, parked domain, empty site, broken site, or very weak site is a needs_site result.',
      'A normal owned website that is modern enough, complete, or mainly has cosmetic issues is site_good_enough.',
      'If evidence is weak, contradictory, or too incomplete, choose needs_review.',
      'Do not punish small sites only because they have little text. Decide from usefulness for customers.',
    ].join(' '),
  })

  const confident = decision.confidence >= JEV_CONFIDENT_THRESHOLD && decision.decision !== 'needs_review'
  const isEcommerce = decision.decision === 'skip_ecommerce' || decision.isEcommerce >= 0.82
  const websitePresence = inferWebsitePresence(decision)
  const score = normalizeScore(decision, confident)
  const reason = buildReason(ctx.language, decision, confident)
  const structural = buildStructuralEvidence(ctx.language, decision, confident, scraped.markdown)
  const cosmetic = decision.decision === 'site_good_enough'
    ? [ctx.language === 'en'
      ? 'The existing website appears usable enough for customers.'
      : 'Den befintliga hemsidan verkar tillräckligt användbar för kunder.']
    : []

  return {
    score,
    reason,
    websitePresence,
    isEcommerce,
    weaknesses: [...structural, ...cosmetic],
    structural,
    cosmetic,
    unreadable: false,
    uncertain: !confident,
    url,
    title: scraped.title,
    markdown: scraped.markdown,
    screenshot: null,
    screenshotReliable: false,
    screenshotQuality: scraped.screenshotQuality,
    confidence: confident ? 'high' : decision.confidence >= 0.45 ? 'medium' : 'low',
    decisionConfidence: decision.confidence,
    decisionLabel: decision.decision,
    secondOpinionUsed: false,
    firstScore: score,
    secondScore: null,
    scoreDisagreement: null,
    providerUsed: scraped.providerUsed,
    modelUsed: JEV_MODEL,
    secondProviderUsed: null,
    secondModelUsed: null,
    secondOpinionError: null,
    supplementaryPageUrl: null,
    supplementaryPageScreenshotReliable: null,
    supplementaryPageProviderUsed: null,
    scrapeCache: {
      ...(scraped.cachePayload ?? {}),
      audit_engine: 'jev',
      jev_decision: {
        decision: decision.decision,
        confidence: decision.confidence,
        has_owned_website: decision.hasOwnedWebsite,
        is_ecommerce: decision.isEcommerce,
        third_party_only: decision.isThirdPartyOnly,
      },
    },
  }
}

async function decideWithJev(state: Record<string, unknown>): Promise<JevDecision> {
  const payload = {
    model: JEV_MODEL,
    state,
    questions: {
      decision: {
        type: 'choice',
        instructions: 'Choose the operational audit decision. Be conservative: if the evidence is unclear, choose needs_review.',
        choices: {
          needs_site: 'The business should get a new Botlio demo website. Evidence shows no owned functional website, a third-party profile only, a broken/empty/parked website, or a clearly weak website that blocks customer action.',
          site_good_enough: 'The business has an owned website that is functional enough, modern enough, or only has cosmetic issues.',
          needs_review: 'The evidence is incomplete, contradictory, blocked, or too uncertain for automation.',
          skip_ecommerce: 'The website is a true online shop/e-commerce site with cart or checkout. This is outside Botlio’s current fixed-price offer.',
        },
      },
      quality_score: {
        type: 'score',
        instructions: 'Rate the current website quality from 1 to 10 for whether it needs replacement by a simple local business website. 1 means no usable owned website. 10 means excellent and clearly not worth replacing.',
        min: 1,
        max: 10,
      },
      has_owned_website: {
        type: 'noul',
        instructions: 'Does the evidence show a real owned business website, not only a third-party booking/profile/social page?',
      },
      is_ecommerce: {
        type: 'noul',
        instructions: 'Is this a true e-commerce site with cart/checkout as a core function, not just booking, menu, prices, or enquiry forms?',
      },
      third_party_only: {
        type: 'noul',
        instructions: 'Does the business appear to rely only on a third-party profile/booking page instead of its own website?',
      },
    },
  }

  const raw = await callOpenRouterDecisions(payload)
  return parseJevResponse(raw)
}

async function callOpenRouterDecisions(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing for JEV audit')

  const attempts = [
    { url: 'https://openrouter.ai/api/alpha/decisions', body: payload },
    { url: 'https://openrouter.ai/api/alpha/decisions', body: { decisionsRequest: payload } },
    { url: 'https://openrouter.ai/api/v1/systemone', body: payload },
  ]

  let lastError = ''
  for (const attempt of attempts) {
    let response: Response
    try {
      response = await fetchWithTimeout(attempt.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://botlio.app',
          'X-Title': 'Botlio JEV Audit',
        },
        body: JSON.stringify(attempt.body),
      }, 12_000)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      continue
    }

    const text = await response.text()
    if (response.ok) {
      try {
        return JSON.parse(text || '{}')
      } catch {
        throw new Error(`JEV returned invalid JSON: ${text.slice(0, 300)}`)
      }
    }
    lastError = `${response.status}: ${text.slice(0, 500)}`
    if (response.status === 401 || response.status === 403) break
  }

  throw new Error(`JEV decision request failed: ${lastError}`)
}

function parseJevResponse(raw: Record<string, unknown>): JevDecision {
  const root = (raw as any)?.data ?? raw
  const answers = (root as any)?.answers ?? (root as any)?.decisions ?? (root as any)?.result ?? root
  const decisionAnswer = pickAnswer(answers, 'decision')
  const scoreAnswer = pickAnswer(answers, 'quality_score')
  const ownedAnswer = pickAnswer(answers, 'has_owned_website')
  const ecommerceAnswer = pickAnswer(answers, 'is_ecommerce')
  const thirdPartyAnswer = pickAnswer(answers, 'third_party_only')

  const decision = normalizeDecision(readChoice(decisionAnswer))
  const probabilities = readProbabilities(decisionAnswer)
  const probability = probabilities[decision] ?? readConfidence(decisionAnswer)
  return {
    decision,
    confidence: clamp01(probability || 0.5),
    score: clampScore(readNumber(scoreAnswer, 5)),
    hasOwnedWebsite: clamp01(readNoul(ownedAnswer)),
    isEcommerce: clamp01(readNoul(ecommerceAnswer)),
    isThirdPartyOnly: clamp01(readNoul(thirdPartyAnswer)),
    raw,
  }
}

function pickAnswer(answers: any, key: string): any {
  if (!answers) return null
  if (answers[key] != null) return answers[key]
  if (Array.isArray(answers)) return answers.find((item) => item?.id === key || item?.key === key || item?.name === key)
  return null
}

function readChoice(answer: any): string {
  if (!answer) return ''
  return String(answer.choice ?? answer.value ?? answer.answer ?? answer.decision ?? '').trim()
}

function readProbabilities(answer: any): Record<string, number> {
  const raw = answer?.probabilities ?? answer?.probs ?? answer?.scores ?? {}
  const out: Record<string, number> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) out[String(key)] = clamp01(Number(value))
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const key = String(item?.choice ?? item?.label ?? item?.key ?? '')
      if (key) out[key] = clamp01(Number(item?.probability ?? item?.score ?? item?.value))
    }
  }
  return out
}

function readConfidence(answer: any): number {
  return clamp01(Number(answer?.confidence ?? answer?.probability ?? answer?.score ?? answer?.p ?? 0))
}

function readNoul(answer: any): number {
  if (!answer) return 0.5
  const value = answer.value ?? answer.answer ?? answer.probability ?? answer.confidence ?? answer.score
  if (typeof value === 'boolean') return value ? 1 : 0
  return Number.isFinite(Number(value)) ? Number(value) : 0.5
}

function readNumber(answer: any, fallback: number): number {
  const value = answer?.value ?? answer?.answer ?? answer?.score ?? answer?.number
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function normalizeDecision(value: string): JevDecision['decision'] {
  const normalized = value.toLowerCase().replace(/[^a-z_]/g, '_')
  if (normalized.includes('ecommerce') || normalized.includes('skip')) return 'skip_ecommerce'
  if (normalized.includes('good')) return 'site_good_enough'
  if (normalized.includes('review') || normalized.includes('manual') || normalized.includes('uncertain')) return 'needs_review'
  if (normalized.includes('need')) return 'needs_site'
  return 'needs_review'
}

function inferWebsitePresence(decision: JevDecision): WebsitePresence {
  if (decision.isThirdPartyOnly >= 0.78) return 'third_party_booking_or_profile'
  if (decision.hasOwnedWebsite <= 0.25) return 'no_functional_website'
  if (decision.hasOwnedWebsite >= 0.7) return 'owned_site'
  return 'uncertain'
}

function normalizeScore(decision: JevDecision, confident: boolean): number {
  if (!confident) return Math.min(6, Math.max(5, clampScore(decision.score)))
  if (decision.decision === 'needs_site') return Math.min(4, clampScore(decision.score))
  if (decision.decision === 'skip_ecommerce' || decision.decision === 'site_good_enough') return Math.max(7, clampScore(decision.score))
  return clampScore(decision.score)
}

function buildReason(language: 'sv' | 'en', decision: JevDecision, confident: boolean): string {
  if (!confident || decision.decision === 'needs_review') {
    return language === 'en'
      ? 'JEV could not make a confident automatic audit decision from the available website evidence.'
      : 'JEV kunde inte ta ett säkert automatiskt audit-beslut från det tillgängliga underlaget.'
  }
  if (decision.decision === 'skip_ecommerce') {
    return language === 'en'
      ? 'The site appears to be e-commerce, which is outside this website offer.'
      : 'Sajten verkar vara e-handel, vilket ligger utanför detta hemsideerbjudande.'
  }
  if (decision.decision === 'site_good_enough') {
    return language === 'en'
      ? 'The existing website appears good enough to avoid a new demo website.'
      : 'Den befintliga hemsidan verkar tillräckligt bra för att inte behöva en ny demosida.'
  }
  return language === 'en'
    ? 'The website evidence strongly suggests this business should receive a new demo website.'
    : 'Webbplatsunderlaget visar med hög säkerhet att företaget bör få en ny demosida.'
}

function buildStructuralEvidence(language: 'sv' | 'en', decision: JevDecision, confident: boolean, markdown: string): string[] {
  if (!confident) {
    return [language === 'en'
      ? 'The evidence was not clear enough for an automatic decision.'
      : 'Underlaget var inte tydligt nog för ett automatiskt beslut.']
  }
  if (decision.decision === 'needs_site') {
    const base = language === 'en'
      ? 'JEV classified the site as a strong replacement candidate from text, links and structure.'
      : 'JEV klassade sajten som en tydlig kandidat för ny hemsida utifrån text, länkar och struktur.'
    const third = decision.isThirdPartyOnly >= 0.78
      ? (language === 'en' ? 'The evidence suggests a third-party booking/profile page rather than an owned website.' : 'Underlaget tyder på tredjepartsbokning/profil snarare än en egen hemsida.')
      : null
    const empty = markdown.replace(/\s+/g, ' ').trim().length < 250
      ? (language === 'en' ? 'The readable website content is very limited.' : 'Det läsbara hemsideinnehållet är mycket begränsat.')
      : null
    return [base, third, empty].filter((x): x is string => Boolean(x))
  }
  if (decision.decision === 'skip_ecommerce') {
    return [language === 'en'
      ? 'The site appears to include e-commerce/cart/checkout functionality.'
      : 'Sajten verkar innehålla e-handel, varukorg eller checkout.']
  }
  return []
}

function emptyManualResult(language: 'sv' | 'en', url: string, scraped: Awaited<ReturnType<typeof scrapeForAudit>>): AuditResult {
  const message = language === 'en'
    ? 'No readable website evidence was returned for JEV, so this requires manual review.'
    : 'Inget läsbart webbplatsunderlag returnerades för JEV, så detta behöver manuell granskning.'
  return {
    score: 5,
    reason: message,
    websitePresence: 'uncertain',
    isEcommerce: false,
    weaknesses: [message],
    structural: [message],
    cosmetic: [],
    unreadable: true,
    uncertain: true,
    url,
    title: scraped.title,
    markdown: scraped.markdown,
    screenshot: null,
    screenshotReliable: false,
    screenshotQuality: scraped.screenshotQuality,
    confidence: 'low',
    decisionConfidence: 0,
    decisionLabel: 'needs_review',
    secondOpinionUsed: false,
    firstScore: 5,
    secondScore: null,
    scoreDisagreement: null,
    providerUsed: scraped.providerUsed,
    modelUsed: JEV_MODEL,
    secondProviderUsed: null,
    secondModelUsed: null,
    secondOpinionError: null,
    supplementaryPageUrl: null,
    supplementaryPageScreenshotReliable: null,
    supplementaryPageProviderUsed: null,
    scrapeCache: scraped.cachePayload,
  }
}

function compactText(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value > 1 && value <= 100) return Math.max(0, Math.min(1, value / 100))
  return Math.max(0, Math.min(1, value))
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 5
  return Math.max(1, Math.min(10, Math.round(value)))
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}
