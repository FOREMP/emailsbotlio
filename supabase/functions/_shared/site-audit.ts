// Shared website audit: scrape a lead's existing site with Firecrawl
// (markdown + screenshot) and score it 1-10 with a vision model.
//
// Why the screenshot matters: the old audit judged design from markdown only.
// Modern, well-designed sites have very little text, so the "thin content"
// rule pushed almost everything to 4 or below regardless of how good the site
// actually looked. Scoring now leads with the rendered screenshot; text is a
// secondary signal only.

const FIRECRAWL_V2 = 'https://api.firecrawl.dev/v2'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface AuditResult {
  score: number
  reason: string
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
  'Du bedömer små företags hemsidor för en säljpipeline som säljer NYA hemsidor.',
  'Din enda fråga är: HUR TROLIGT ÄR DET ATT ÄGAREN VILL KÖPA EN NY HEMSIDA?',
  'Du sätter INTE designbetyg. En snygg sajt och en ful sajt kan båda vara "vill inte köpa" —',
  'det avgörande är om sajten har RIKTIGA BRISTER som gör ägaren missnöjd.',
  'Var KONSEKVENT och DETERMINISTISK — samma input MÅSTE ge samma svar.',
  '',
  'VIKTIGAST: du får oftast en SKÄRMBILD av startsidan. Döm i första hand på den. Texten är stödjande signal.',
  '',
  'Köpviljeskala 1-10 (lågt = stark köpare, högt = kommer inte köpa):',
  '  1-2  = ingen riktig sajt: parkerad domän, trasig sida, felmeddelande, eller bara en',
  '         tredjepartsprofil (Facebook, Bokadirekt, bokningsportal). Starkast möjliga köpare.',
  '  3-4  = riktig sajt men synligt föråldrad eller vanskött: pre-2015-känsla, ingen',
  '         mobilanpassning, platshållartext eller fel företagsnamn, trasiga bilder,',
  '         gratis mailadress (gmail/hotmail) som kontakt. Tydlig köpare.',
  '  5-6  = vanlig fungerande småföretagssajt. Daterad men inte pinsam. Kan köpa, kan låta bli — mänskligt beslut.',
  '  7-8  = modern, sammanhållen och tydligt underhållen. Kommer inte köpa.',
  '  9-10 = professionellt designad och helt aktuell. Kommer inte köpa.',
  '',
  'Dela svagheterna i två listor:',
  '- "structural" = riktiga brister: föråldrat utseende, ingen mobilanpassning, platshållartext',
  '  eller fel företagsnamn, trasiga länkar/bilder, ingen egen domän, gratis mailadress,',
  '  bara tredjepartsprofil, saknar helt tjänster eller kontaktuppgifter.',
  '- "cosmetic" = putsdetaljer: saknad CTA-knapp, svag hierarki, generisk mall, tunn copy,',
  '  saknade priser, cookie-banner, steril känsla, tråkig typografi.',
  '',
  'ABSOLUT REGEL: enbart kosmetiska brister får ALDRIG ge betyg under 5.',
  'En sajt som fungerar men saknar CTA-knapp eller känns generisk är en fungerande sajt,',
  'och den ägaren är inte en köpare. Bara "structural"-brister drar ner betyget under 5.',
  '',
  'Regler som ofta missförstås — följ dem exakt:',
  '- LITE TEXT ÄR INTE ETT FEL. Moderna sajter har ofta kort copy. Sänk ALDRIG betyget bara för att textutdraget är kort.',
  '- Att sajten är byggd i Wix / Squarespace / Wordpress / One.com / Webflow / Shopify är INTE i sig negativt. Döm på resultatet, inte verktyget.',
  '- Om skärmbilden saknas: döm försiktigt och lägg dig runt 5 om inget tydligt talar emot. Gissa inte lågt.',
  '- Sätt bara 1-2 om du faktiskt SER att sidan är trasig, tom eller bara en tredjepartsprofil.',
  '- Bedöm ENDAST det du faktiskt ser eller läser. Spekulera inte.',
  '',
  'Svara ENDAST med strikt JSON:',
  '{"score": <heltal 1-10>, "reason": "<max 200 tecken, konkret evidens på svenska>", "structural": ["<riktig brist>"], "cosmetic": ["<putsdetalj>"]}',
  'Båda listorna får vara tomma. Punkterna ska vara på svenska, konkreta och användbara som argument i ett kallmail.',
].join('\n')


/** Score a scraped site. Returns a fair, screenshot-first verdict. */
export async function auditWebsite(
  rawUrl: string,
  companyName: string,
  fcKey: string,
  openrouterKey: string,
): Promise<AuditResult> {
  const url = normaliseUrl(rawUrl)
  const scraped = await scrapeForAudit(url, fcKey)
  const hasText = scraped.markdown.replace(/\s+/g, ' ').trim().length > 40

  if (!scraped.screenshot && !hasText) {
    // Nothing readable at all. If Firecrawl was blocked we must NOT pretend we
    // saw a bad site — flag it as uncertain instead of scoring it a 1.
    const noSiteIssues = scraped.blocked
      ? ['Kunde inte läsas automatiskt — kontrollera manuellt.']
      : ['Ingen läsbar hemsida idag.']
    return {
      score: scraped.blocked ? 5 : 1,
      reason: scraped.blocked
        ? 'Sajten kunde inte läsas automatiskt (blockerad eller timeout) — betyget är en platshållare, kräver manuell koll.'
        : 'Sajten returnerar tomt innehåll — parkerad domän eller trasig sida.',
      weaknesses: noSiteIssues,
      structural: noSiteIssues,
      cosmetic: [],
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

  const aiResp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://emailsbotlio.lovable.app',
      'X-Title': 'Botlio Site Audit',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
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
