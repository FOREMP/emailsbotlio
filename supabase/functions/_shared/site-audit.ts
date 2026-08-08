// Shared website audit: scrape a lead's existing site with Firecrawl
// (markdown + screenshot) and score it 1-10 with a vision model.
//
// Why the screenshot matters: the old audit judged design from markdown only.
// Modern, well-designed sites have very little text, so the "thin content"
// rule pushed almost everything to 4 or below regardless of how good the site
// actually looked. Scoring now leads with the rendered screenshot; text is a
// secondary signal only.

const FIRECRAWL_V2 = 'https://api.firecrawl.dev/v2'
const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1'

export interface AuditResult {
  score: number
  reason: string
  weaknesses: string[]
  /** true when we could not read the site at all (blocked / down / parked). */
  unreadable: boolean
  /** true when Firecrawl was blocked — score is a guess, not a verdict. */
  uncertain: boolean
  url: string
  title: string
  markdown: string
  screenshot: string | null
}

export interface ScrapeResult {
  markdown: string
  title: string
  description: string
  screenshot: string | null
  blocked: boolean
}

export function normaliseUrl(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s.replace(/^\/+/, '')}`
}

/** Scrape once, asking for both markdown and a desktop screenshot. */
export async function scrapeForAudit(url: string, fcKey: string): Promise<ScrapeResult> {
  const empty: ScrapeResult = { markdown: '', title: '', description: '', screenshot: null, blocked: true }
  if (!url) return empty

  const attempt = async (withScreenshot: boolean) => {
    const formats: unknown[] = ['markdown']
    if (withScreenshot) formats.push({ type: 'screenshot', fullPage: false, viewport: { width: 1280, height: 900 } })
    const resp = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        formats,
        // Full page, not just "main content" — nav, hero and footer are exactly
        // the parts that reveal whether a site looks modern.
        onlyMainContent: false,
        waitFor: 2500,
        timeout: 45000,
      }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) return null
    const d = data.data ?? data
    return {
      markdown: (d.markdown ?? '') as string,
      title: (d.metadata?.title ?? '') as string,
      description: (d.metadata?.description ?? '') as string,
      screenshot: (d.screenshot ?? d.screenshotUrl ?? null) as string | null,
      blocked: false,
    }
  }

  try {
    const withShot = await attempt(true)
    if (withShot && (withShot.markdown || withShot.screenshot)) return withShot
  } catch (_) { /* fall through */ }

  try {
    const textOnly = await attempt(false)
    if (textOnly) return textOnly
  } catch (_) { /* fall through */ }

  return empty
}

const SYSTEM_PROMPT = [
  'Du auditerar små företags hemsidor och sätter betyg 1-10 på hur moderna, förtroendeingivande och konverterande de ser ut.',
  'Var STRIKT, KONSEKVENT och DETERMINISTISK — samma input MÅSTE ge samma svar.',
  '',
  'VIKTIGAST: du får oftast en SKÄRMBILD av startsidan. Döm i första hand på hur sajten SER UT',
  '(layout, typografi, bildkvalitet, whitespace, färgharmoni, hierarki, tydliga CTA:er, känsla av årtal).',
  'Texten är bara ett stödjande signal.',
  '',
  'Betygsskala:',
  '  1  = trasig, tom sida, parkerad domän eller felmeddelande',
  '  2  = extremt föråldrad (pre-2010-känsla): tabelllayout, splash-sida, clipart, ingen mobilanpassning',
  '  3  = tydligt daterad (2010-2014-mall), rörig navigering, låg bildkvalitet',
  '  4  = daterad men fungerande; grundinfo finns men ful typografi/layout',
  '  5  = genomsnittlig småföretagssajt: fungerar, ser okej ut, men generisk mall och svag hero',
  '  6  = hyfsat modern mall, tydliga tjänster och kontaktvägar, acceptabel design',
  '  7  = klart modern och responsiv, bra hierarki, snygga bilder, tydliga CTA:er',
  '  8  = polerad och on-brand, stark copy, trust signals (omdömen, case, priser)',
  '  9-10 = förstklassig, i nivå med bra byråarbete — inget väsentligt att förbättra',
  '',
  'Regler som ofta missförstås — följ dem exakt:',
  '- LITE TEXT ÄR INTE ETT FEL. Moderna sajter har ofta kort copy. Sänk ALDRIG betyget bara för att markdown-utdraget är kort.',
  '- Att sajten är byggd i Wix / Squarespace / Wordpress / One.com / Webflow / Shopify är INTE i sig negativt. Döm på resultatet, inte verktyget.',
  '- Om skärmbilden saknas: döm försiktigt på text och metadata och lägg dig runt 5 om inget tydligt talar emot. Gissa inte lågt.',
  '- Sätt bara 1-2 om du faktiskt SER att sidan är trasig, tom eller pre-2010.',
  '- En tredjepartsprofil (Bokadirekt, Facebook, en bokningsportal) i stället för egen sajt: max 4.',
  '- Bedöm ENDAST det du faktiskt ser eller läser. Spekulera inte.',
  '',
  'Svara ENDAST med strikt JSON:',
  '{"score": <heltal 1-10>, "reason": "<max 200 tecken, konkret evidens på svenska>", "weaknesses": ["<konkret svaghet 1>", "<konkret svaghet 2>", "<konkret svaghet 3>"]}',
  'Svagheterna ska vara på svenska, konkreta (t.ex. "hero utan tydlig CTA", "lågupplösta bilder", "ingen mobilmeny", "saknar priser") och användbara som argument i ett kallmail.',
].join('\n')

/** Score a scraped site. Returns a fair, screenshot-first verdict. */
export async function auditWebsite(
  rawUrl: string,
  companyName: string,
  fcKey: string,
  lovableKey: string,
): Promise<AuditResult> {
  const url = normaliseUrl(rawUrl)
  const scraped = await scrapeForAudit(url, fcKey)
  const hasText = scraped.markdown.replace(/\s+/g, ' ').trim().length > 40

  if (!scraped.screenshot && !hasText) {
    // Nothing readable at all. If Firecrawl was blocked we must NOT pretend we
    // saw a bad site — flag it as uncertain instead of scoring it a 1.
    return {
      score: scraped.blocked ? 5 : 1,
      reason: scraped.blocked
        ? 'Sajten kunde inte läsas automatiskt (blockerad eller timeout) — betyget är en platshållare, kräver manuell koll.'
        : 'Sajten returnerar tomt innehåll — parkerad domän eller trasig sida.',
      weaknesses: scraped.blocked
        ? ['Kunde inte läsas automatiskt — kontrollera manuellt.']
        : ['Ingen läsbar hemsida idag.'],
      unreadable: true,
      uncertain: scraped.blocked,
      url,
      title: '',
      markdown: '',
      screenshot: null,
    }
  }

  const userContent: unknown[] = [
    {
      type: 'text',
      text: [
        `URL: ${url}`,
        `Företag: ${companyName}`,
        `Titel: ${scraped.title}`,
        `Metabeskrivning: ${scraped.description}`,
        scraped.screenshot
          ? 'Skärmbild av startsidan bifogas — den är ditt viktigaste underlag.'
          : 'Ingen skärmbild tillgänglig — döm försiktigt på texten och lägg dig runt 5 om inget tydligt talar emot.',
        '',
        'Textinnehåll (utdrag):',
        scraped.markdown.slice(0, 4000) || '(inget textutdrag)',
      ].join('\n'),
    },
  ]
  if (scraped.screenshot) {
    userContent.push({ type: 'image_url', image_url: { url: scraped.screenshot } })
  }

  const aiResp = await fetch(`${AI_GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { 'Lovable-API-Key': lovableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      temperature: 0,
      top_p: 1,
      seed: 42,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
    }),
  })
  const aiData = await aiResp.json().catch(() => ({}))
  if (!aiResp.ok) throw new Error(`AI audit ${aiResp.status}: ${JSON.stringify(aiData).slice(0, 200)}`)

  let parsed: { score?: number; reason?: string; weaknesses?: string[] } = {}
  try { parsed = JSON.parse(aiData.choices?.[0]?.message?.content ?? '{}') } catch (_) { /* keep default */ }

  let score = Math.max(1, Math.min(10, Math.round(Number(parsed.score) || 5)))
  // Without a screenshot the model has no design signal — never let it bottom
  // out on text alone.
  if (!scraped.screenshot) score = Math.max(4, score)

  return {
    score,
    reason: (parsed.reason ?? '').slice(0, 500),
    weaknesses: (parsed.weaknesses ?? []).slice(0, 5),
    unreadable: false,
    uncertain: !scraped.screenshot,
    url,
    title: scraped.title,
    markdown: scraped.markdown,
    screenshot: scraped.screenshot,
  }
}
