// Worker: claims one queued generated_sites row and generates HTML.
// Invoked by pg_cron every minute and fired-and-forgotten by generate-site
// after enqueue. Conditional UPDATE claims a row atomically — safe against
// concurrent invocations. Retries capped at MAX_ATTEMPTS via `attempts`.
// Stuck-row reaper: also flips 'processing' rows older than 10 min back to 'failed'.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'deepseek/deepseek-chat-v3.1'
const MAX_ATTEMPTS = 3
const STUCK_MINUTES = 10
const CURRENT_YEAR = new Date().getFullYear()

interface ServiceItem { name: string; description: string; when?: string }
interface ValueItem { title: string; text: string }
interface FaqItem { question: string; answer: string }
interface PathwayItem { eyebrow: string; title: string; description: string; ctaLabel?: string }
interface DifferentiatorItem { title: string; text: string }
interface ScenarioItem { category: string; title: string; description: string; delivery: string }
interface ProcessStep { title: string; description: string; outcome?: string }
interface SitePlan {
  businessName?: string
  tagline?: string
  heroEyebrow?: string
  heroLine1?: string
  heroLine2?: string
  heroSubline?: string
  trustBadges?: string[]
  pathwaysIntro?: string
  pathways?: PathwayItem[]
  services?: ServiceItem[]
  aboutTitle?: string
  aboutIntro?: string
  aboutBefore?: string
  aboutDuring?: string
  aboutAfter?: string
  differentiators?: DifferentiatorItem[]
  scenarios?: ScenarioItem[]
  processSteps?: ProcessStep[]
  values?: ValueItem[]
  faqs?: FaqItem[]
  ctaTitle?: string
  ctaText?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const openrouterKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!openrouterKey) return json({ error: 'OPENROUTER_API_KEY missing' }, 500)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Reap 'processing' rows older than STUCK_MINUTES (worker died mid-run)
    const stuckCutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString()
    await supabase
      .from('generated_sites')
      .update({
        status: 'failed',
        error_message: `Worker died mid-generation (>${STUCK_MINUTES} min in processing). Click Generate to retry.`,
      })
      .eq('status', 'processing')
      .lt('updated_at', stuckCutoff)

    // 2. Optional targeted id from generate-site kick, else oldest queued
    let targetId: string | null = null
    try {
      if (req.method === 'POST') {
        const body = await req.json().catch(() => ({}))
        if (typeof body?.generated_site_id === 'string') targetId = body.generated_site_id
      }
    } catch (_) { /* ignore */ }

    // 3. Find one queued row
    const findQuery = supabase
      .from('generated_sites')
      .select('id')
      .eq('status', 'queued')
      .order('queued_at', { ascending: true })
      .limit(1)
    if (targetId) findQuery.eq('id', targetId)
    const { data: candidates, error: findErr } = await findQuery
    if (findErr) return json({ error: `find failed: ${findErr.message}` }, 500)
    if (!candidates?.length) return json({ ok: true, message: 'no queued jobs' })

    const generated_site_id = candidates[0].id

    // 4. Atomically claim: only succeeds if row is still 'queued' (race-safe)
    const { data: claimed, error: claimErr } = await supabase
      .from('generated_sites')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', generated_site_id)
      .eq('status', 'queued')
      .select('id, contact_id, source_url, scraped_content, template, attempts')
      .maybeSingle()
    if (claimErr || !claimed) return json({ ok: true, message: 'lost race, another worker claimed it' })

    const site = claimed as any

    const nextAttempts = (site.attempts ?? 0) + 1
    await supabase.from('generated_sites').update({ attempts: nextAttempts }).eq('id', generated_site_id)

    if (!site.scraped_content) {
      const msg = 'no scraped_content — run scrape first'
      await supabase.from('generated_sites').update({ status: 'failed', error_message: msg }).eq('id', generated_site_id)
      return json({ error: msg }, 400)
    }

    const scraped = site.scraped_content as any
    const pages = scraped.pages ?? {}
    const homeMd: string = pages.home?.markdown ?? scraped.markdown ?? ''
    if (!homeMd || homeMd.trim().length < 300) {
      const msg = 'scraped_content is empty or too short — re-run scrape on a working source_url'
      await supabase.from('generated_sites').update({ status: 'failed', error_message: msg }).eq('id', generated_site_id)
      return json({ error: msg }, 422)
    }

    const { data: contact } = await supabase
      .from('contacts')
      .select('first_name, last_name, email, company, custom_fields')
      .eq('id', site.contact_id)
      .single()

    const branding = scraped.branding ?? {}
    const cf = (contact?.custom_fields ?? {}) as Record<string, unknown>


    // Full brand palette (fall back to premium dark when missing)
    const bc = branding.colors ?? {}
    const brandPalette = {
      primary: bc.primary || branding.primaryColor || '#f97316',
      secondary: bc.secondary || bc.accent || '#0ea5e9',
      accent: bc.accent || bc.secondary || '#f59e0b',
      background: bc.background || '#0a0e1a',
      surface: bc.surface || bc.card || '#131a2b',
      textPrimary: bc.textPrimary || bc.text || '#f1f5f9',
      textSecondary: bc.textSecondary || bc.muted || '#94a3b8',
    }
    const brandFonts = Array.isArray(branding.fonts)
      ? branding.fonts.map((f: any) => (typeof f === 'string' ? f : f?.family)).filter(Boolean).slice(0, 4)
      : []
    const hasRealBranding = !!branding.colors

    // Extra manual assets from user
    const extraImages: string[] = Array.isArray(cf.extra_images) ? (cf.extra_images as string[]).filter(Boolean) : []
    const googleMapsUrl: string | null = typeof cf.google_maps_url === 'string' ? cf.google_maps_url : null

    // Real images from the lead's own site (their domain)
    const scrapedImages: string[] = Array.isArray(scraped.images) ? scraped.images.slice(0, 8) : []

    // Case-insensitive lookup across all custom_fields keys (handles Phone,
    // TELEFON, Mobil, phone_number, "Telefonnummer" etc.)
    const cfLookup = (patterns: RegExp[]): string | null => {
      for (const [k, v] of Object.entries(cf)) {
        if (v == null || v === '') continue
        const key = k.toLowerCase().replace(/[\s_-]/g, '')
        if (patterns.some((p) => p.test(key))) {
          const s = String(v).trim()
          if (s && !/^(null|undefined|n\/a|-)$/i.test(s)) return s
        }
      }
      return null
    }

    const phoneFromCf = cfLookup([/^phone/, /^tel/, /telefon/, /mobil/, /number/])
    const addressFromCf = cfLookup([/address/, /adress/, /gata/, /street/])
    const cityFromCf = cfLookup([/^city$/, /^ort$/, /stad/, /kommun/, /postort/])
    const emailFromCf = cfLookup([/^email/, /epost/, /^mail/])

    const facts = {
      business_name: (cf.company ?? contact?.company ?? pages.home?.title ?? scraped.title ?? '').toString().trim() || null,
      phone: phoneFromCf,
      address: addressFromCf,
      city: cityFromCf,
      email: contact?.email ?? emailFromCf ?? null,
      source_url: site.source_url,
      has_real_branding: hasRealBranding,
      google_maps_url: googleMapsUrl,
    }

    // Image pool priority: user extras → scraped from their own site → Unsplash fallback
    const unsplashPool = [
      'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=1600&q=80',
      'https://images.unsplash.com/photo-1625047509168-a7026f36de04?w=1600&q=80',
      'https://images.unsplash.com/photo-1632823471565-1ecdf5c6d7f4?w=1200&q=80',
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1600&q=80',
      'https://images.unsplash.com/photo-1580273916550-e323be2ae537?w=1200&q=80',
      'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=1200&q=80',
      'https://images.unsplash.com/photo-1493031440916-e69b7a91be16?w=1200&q=80',
      'https://images.unsplash.com/photo-1552930294-3af53b58f61c?w=1200&q=80',
    ]
    const imagePool = [...extraImages, ...scrapedImages, ...unsplashPool].slice(0, 10)

    const screenshotUrl: string | null = scraped.screenshot_url ?? null

    const systemPrompt = `Du är en senior svensk copywriter och art director för PREMIUM bilverkstadssajter i klass med de bästa nordiska SaaS- och bilmärkessajter. Ton: modernt, självsäkert, editoriellt. Bygg förtroende via TYDLIGHET och YRKESSTOLTHET — inte genom siffror eller påhittade certifikat.

VIKTIGT: Skriv INTE HTML. Returnera bara giltig JSON enligt schemat nedan. HTML byggs av systemet.

RETURFORMAT — endast JSON, ingen markdown, inga kommentarer:
{
  "businessName": "...",
  "tagline": "kort premium tagline",
  "heroEyebrow": "kort label, t.ex. 'Bilverkstad i {ort}' eller kategori",
  "heroLine1": "första raden av rubriken (3–6 ord, editoriell känsla)",
  "heroLine2": "andra raden (3–7 ord, kontrast/löfte, t.ex. 'Vi bygger trygghet, inte gissningar.')",
  "heroSubline": "1–2 meningar som förklarar värdet konkret",
  "trustBadges": ["Garanti på allt arbete", "Tydliga underlag", "Personlig service"],
  "pathwaysIntro": "1 mening om att guida kunden rätt in",
  "pathways": [
    {"eyebrow":"PLANERAT BESÖK","title":"Starta med bilservice","description":"Kort scenario när det passar (1–2 meningar)","ctaLabel":"Starta med service"},
    {"eyebrow":"OSÄKER FELBILD","title":"Boka felsökning","description":"...","ctaLabel":"Boka felsökning"},
    {"eyebrow":"SÄKERHET FÖRST","title":"Boka bromskontroll","description":"...","ctaLabel":"Boka bromskontroll"},
    {"eyebrow":"SÄSONG & KOMFORT","title":"Boka klimatsystem","description":"...","ctaLabel":"Boka klimat"}
  ],
  "services": [{"name":"...","description":"vad tjänsten är","when":"'När:' — kort rad om när kunden ska välja den"}],
  "aboutTitle": "editoriell rubrik, gärna 2 rader",
  "aboutIntro": "1 stark manifest-mening",
  "aboutBefore": "stycke om FÖRE besöket (transparens, planering)",
  "aboutDuring": "stycke om UNDER arbetet (expertis, träffsäkerhet)",
  "aboutAfter": "stycke om EFTER (rak återkoppling, begripligt underlag)",
  "differentiators": [
    {"title":"Tydlig offert innan större beslut","text":"..."},
    {"title":"All expertis samlad under ett tak","text":"..."},
    {"title":"Smidig kontakt på dina villkor","text":"..."},
    {"title":"Verklig kvalitet, inte bara ord","text":"..."}
  ],
  "scenarios": [
    {"category":"Service","title":"Servicegenomgång inför längre körning","description":"Beskriv typiskt scenario (inte påhittad kund)","delivery":"Vad kunden får som resultat"},
    {"category":"Diagnostik","title":"När varningslampan tänds men felet inte är självklart","description":"...","delivery":"..."},
    {"category":"Bromsar","title":"Bromsar som känns ojämna eller låter","description":"...","delivery":"..."}
  ],
  "processSteps": [
    {"title":"Beskriv behovet","description":"...","outcome":"Smidigare planering och inga missförstånd."},
    {"title":"Vi ger dig en tydlig plan","description":"...","outcome":"Högsta kvalitet redan från första steget."},
    {"title":"Raka rör, inga överraskningar","description":"...","outcome":"Trygghet och full transparens hela vägen."}
  ],
  "values": [{"title":"...","text":"..."}],
  "faqs": [{"question":"...","answer":"..."}],
  "ctaTitle": "kort rubrik för sista CTA-bandet",
  "ctaText": "1 mening som får kunden att ta nästa steg"
}

ABSOLUTA REGLER:
1. Hitta ALDRIG på adresser, telefonnummer, priser, öppettider, årtal, statistik, certifieringar, kundnamn eller citat.
2. "scenarios" är TYPISKA situationer verkstaden hanterar — inte påhittade referensuppdrag. Skriv aldrig kundnamn.
3. Om ett fält saknar grund, utelämna det. Bättre kortare än fejkat.
4. Om business_name saknas eller ser ut som HTTP-fel/domän utan namn, returnera {"error":"invalid business name"}.
5. Extrahera 4–7 verkliga tjänster från källdatan. Vid oklarhet: standard bilverkstadskategorier utan pris eller falska löften.
6. Language = svenska. Ton = editoriell, konkret, självsäker — inga "vi erbjuder marknadens bästa"-klichéer.
7. heroLine1 + heroLine2 ska tillsammans kännas som en HEADLINE värdig en premium-sajt (t.ex. "Din bilverkstad i Lund. / Vi bygger trygghet, inte gissningar.").
8. Max 4500 tokens totalt.`

    const userTextParts = [
      'Skapa en kompakt innehållsplan för en 3-sidig premium-sajt för denna bilverkstad. Skriv ENDAST JSON enligt schemat.',
      '',
      'FAKTA (endast detta — hitta aldrig på siffror, adresser eller årtal):',
      JSON.stringify(facts, null, 2),
      '',
      '--- KÄLLDATA: HEM-SIDAN ---',
      `Titel: ${pages.home?.title || scraped.title || ''}`,
      `Beskrivning: ${pages.home?.description || scraped.description || ''}`,
      `Sammanfattning: ${pages.home?.summary || scraped.summary || ''}`,
      'Markdown (första 1800 tecken):',
      (pages.home?.markdown || homeMd).slice(0, 1800),
      '',
      `--- KÄLLDATA: OM-OSS-SIDAN ${pages.about ? `(${pages.about.url})` : '(hittades ej — härled från hem)'} ---`,
      pages.about
        ? `Titel: ${pages.about.title}\nMarkdown (första 1400 tecken):\n${pages.about.markdown.slice(0, 1400)}`
        : '[Ingen separat about-sida. Använd HEM-sidans markdown för kort företagsbeskrivning. Inga påhittade fakta.]',
      '',
      `--- KÄLLDATA: TJÄNSTER-SIDAN ${pages.services ? `(${pages.services.url})` : '(hittades ej — härled från hem)'} ---`,
      pages.services
        ? `Titel: ${pages.services.title}\nMarkdown (första 1800 tecken):\n${pages.services.markdown.slice(0, 1800)}`
        : '[Ingen separat tjänster-sida. Extrahera tjänster från HEM-sidans markdown. Om oklart, använd branschstandard-tjänster utan påhittade priser.]',
      '',
      screenshotUrl
        ? 'BIFOGAD BILD nedan = skärmdump av deras nuvarande hemsida. Använd som STIL-INSPO för färgkänsla/ton, men gör en NYARE, BÄTTRE version — kopiera inte deras layout.'
        : '[Ingen skärmdump av nuvarande sajt tillgänglig.]',
      '',
      'Returnera BARA JSON-objektet med innehållsplanen, inte HTML.',
    ].join('\n')

    // Multimodal content — only include the screenshot on models that support vision.
    // DeepSeek V3.1 is text-only; sending an image_url would 400.
    const chosenModel = MODEL
    const supportsVision = /claude|gpt-4|gpt-5|gemini|llama-.*vision|qwen.*vl/i.test(chosenModel)
    const userContent: any[] = [{ type: 'text', text: userTextParts }]
    if (screenshotUrl && supportsVision) {
      userContent.push({ type: 'image_url', image_url: { url: screenshotUrl } })
    }


    // Run synchronously but keep the AI output small. The Edge platform can
    // recycle long-running isolates; the safe fix is reducing output tokens,
    // not only increasing timeout. HTML is generated locally below.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 70_000)
    try {
      const aiResp = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://emailsbotlio.lovable.app',
          'X-Title': 'Botlio Site Generator',
        },
        body: JSON.stringify({
          model: chosenModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 0.6,
          max_tokens: 6000,
          response_format: { type: 'json_object' },
        }),
      })
      clearTimeout(timeoutId)

      if (!aiResp.ok) {
        const errText = await aiResp.text()
        const msg = `OpenRouter failed (${aiResp.status}): ${errText.slice(0, 400)}`
        await failOrRetry(supabase, generated_site_id, nextAttempts, msg)
        return json({ error: msg }, 502)
      }

      const aiData = await aiResp.json()
      const raw: string = aiData.choices?.[0]?.message?.content ?? ''
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim()

      let parsed: (SitePlan & { error?: string }) | null = null
      try { parsed = JSON.parse(cleaned) } catch (_) { parsed = null }

      if (!parsed || parsed.error) {
        const msg = parsed?.error === 'invalid business name'
          ? 'AI rejected this row because the business name/source data is invalid. Re-run audit/scrape with a working company URL.'
          : `AI returned invalid content JSON. Preview: ${cleaned.slice(0, 400)}`
        // "invalid business name" is permanent — don't retry
        if (parsed?.error === 'invalid business name') {
          await supabase.from('generated_sites').update({ status: 'failed', error_message: msg }).eq('id', generated_site_id)
        } else {
          await failOrRetry(supabase, generated_site_id, nextAttempts, msg)
        }
        return json({ error: msg }, 422)
      }

      const files = buildSiteFiles({
        plan: parsed,
        facts,
        brandPalette,
        brandFonts,
        imagePool,
        googleMapsUrl,
      })

      await supabase.from('generated_sites').update({
        status: 'generated',
        error_message: null,
        generated_files: files,
      }).eq('id', generated_site_id)

      return json({ ok: true, status: 'generated', model: chosenModel })
    } catch (err) {
      clearTimeout(timeoutId)
      const msg = (err as Error).name === 'AbortError'
        ? 'Timed out after 70s — model took too long.'
        : `Error: ${(err as Error).message}`
      console.error('generate error', err)
      await failOrRetry(supabase, generated_site_id, nextAttempts, msg)
      return json({ error: msg }, 500)
    }

  } catch (err) {
    console.error('generate-site error', err)
    return json({ error: (err as Error).message }, 500)
  }
})

function buildSiteFiles({
  plan,
  facts,
  brandPalette,
  brandFonts,
  imagePool,
  googleMapsUrl,
}: {
  plan: SitePlan
  facts: Record<string, unknown>
  brandPalette: Record<string, string>
  brandFonts: string[]
  imagePool: string[]
  googleMapsUrl: string | null
}): Record<string, string> {
  const businessName = cleanText(plan.businessName || String(facts.business_name || '')) || 'Bilverkstad'
  const phone = cleanText(String(facts.phone || ''))
  const email = cleanText(String(facts.email || ''))
  const address = [facts.address, facts.city].map((v) => cleanText(String(v || ''))).filter(Boolean).join(', ')
  const services = normalizeServices(plan.services)
  const values = normalizeValues(plan.values)
  const faqs = normalizeFaqs(plan.faqs)
  const images = imagePool.filter((url) => /^https?:\/\//i.test(url)).slice(0, 8)
  const img = (i: number) => images[i % Math.max(images.length, 1)] || 'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=1600&q=80'
  const hasContact = Boolean(phone || email || address)
  const primaryHref = phone ? `tel:${phone.replace(/\s+/g, '')}` : email ? `mailto:${email}` : null
  const primaryLabel = phone ? 'Ring oss' : email ? 'Mejla oss' : null
  const displayFont = brandFonts[0] || 'Space Grotesk'

  const common = (active: 'home' | 'about' | 'services', title: string, body: string) => `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} | ${esc(businessName)}</title>
  <meta name="description" content="${esc(plan.tagline || plan.heroSubline || `Modern demo för ${businessName}`)}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(displayFont).replace(/%20/g, '+')}:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root{--primary:${cssColor(brandPalette.primary,'#f97316')};--secondary:${cssColor(brandPalette.secondary,'#0ea5e9')};--accent:${cssColor(brandPalette.accent,'#f59e0b')};--bg:${cssColor(brandPalette.background,'#0a0e1a')};--surface:${cssColor(brandPalette.surface,'#131a2b')};--text:${cssColor(brandPalette.textPrimary,'#f1f5f9')};--text-muted:${cssColor(brandPalette.textSecondary,'#94a3b8')};--font-display:'${cssString(displayFont)}',Space Grotesk,sans-serif;--font-body:Inter,sans-serif}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);line-height:1.55}a{color:inherit}img{max-width:100%;display:block}.nav{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(18px);border-bottom:1px solid color-mix(in srgb,var(--text) 10%,transparent)}.nav-inner{max-width:1240px;margin:0 auto;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-family:var(--font-display);font-size:21px;font-weight:800;text-decoration:none}.links{display:flex;gap:6px;align-items:center}.links a{padding:10px 14px;border-radius:10px;text-decoration:none;color:var(--text-muted);font-weight:600;font-size:14px}.links a.active,.links a:hover{background:color-mix(in srgb,var(--primary) 16%,transparent);color:var(--text)}.nav-cta{background:var(--primary)!important;color:var(--bg)!important;box-shadow:0 8px 30px color-mix(in srgb,var(--primary) 35%,transparent)}.section{padding:88px 24px}.wrap{max-width:1240px;margin:0 auto}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--primary);margin-bottom:16px}.h1,.h2{font-family:var(--font-display);line-height:1.04;margin:0;color:var(--text);letter-spacing:0}.h1{font-size:clamp(42px,7vw,82px);max-width:820px}.h2{font-size:clamp(32px,4vw,52px)}.lead{font-size:18px;color:var(--text-muted);max-width:650px}.btns{display:flex;gap:14px;flex-wrap:wrap;margin-top:34px}.btn{display:inline-flex;align-items:center;justify-content:center;padding:15px 24px;border-radius:12px;text-decoration:none;font-weight:800;border:1px solid color-mix(in srgb,var(--text) 14%,transparent);background:color-mix(in srgb,var(--text) 8%,transparent)}.btn.primary{background:var(--primary);color:var(--bg);border-color:var(--primary);box-shadow:0 16px 45px color-mix(in srgb,var(--primary) 32%,transparent)}.hero{position:relative;min-height:82vh;display:flex;align-items:center;overflow:hidden;isolation:isolate}.hero>img,.page-hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,var(--bg) 8%,color-mix(in srgb,var(--bg) 86%,transparent) 44%,color-mix(in srgb,var(--bg) 28%,transparent));z-index:-1}.hero-content{max-width:1240px;width:100%;margin:0 auto;padding:96px 24px}.pill{display:inline-flex;gap:9px;align-items:center;background:color-mix(in srgb,var(--primary) 16%,transparent);border:1px solid color-mix(in srgb,var(--primary) 34%,transparent);color:var(--primary);padding:9px 15px;border-radius:999px;font-size:13px;font-weight:800;margin-bottom:26px}.pill:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--primary);box-shadow:0 0 16px var(--primary)}.grid{display:grid;gap:24px}.cards{grid-template-columns:repeat(3,1fr)}.card{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 9%,transparent);border-radius:18px;padding:30px;box-shadow:0 18px 55px rgba(0,0,0,.22)}.card h3{font-family:var(--font-display);font-size:22px;margin:0 0 10px}.card p{color:var(--text-muted);margin:0}.icon{width:50px;height:50px;border-radius:14px;background:color-mix(in srgb,var(--primary) 16%,transparent);color:var(--primary);display:grid;place-items:center;margin-bottom:22px}.band{background:linear-gradient(135deg,var(--surface),color-mix(in srgb,var(--primary) 12%,var(--surface)))}.process{grid-template-columns:repeat(4,1fr)}.step{position:relative}.num{font-family:var(--font-display);font-weight:800;font-size:32px;color:var(--primary);margin-bottom:14px}.split{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}.photo{height:520px;object-fit:cover;border-radius:22px;box-shadow:0 26px 80px rgba(0,0,0,.32)}.gallery{grid-template-columns:1.2fr .8fr .8fr}.gallery img{height:320px;object-fit:cover;border-radius:18px}.gallery img:first-child{height:664px;grid-row:span 2}.contact{display:grid;grid-template-columns:1fr 1.1fr;gap:36px}.contact-list{display:grid;gap:14px}.contact-item{padding:18px 20px;background:color-mix(in srgb,var(--text) 6%,transparent);border-radius:14px;color:var(--text-muted)}.map{width:100%;height:320px;border:0;border-radius:18px}.page-hero{position:relative;padding:118px 24px 92px;text-align:center;overflow:hidden;isolation:isolate}.page-hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 80%,transparent),var(--bg));z-index:-1}.page-hero img{opacity:.3}.service-row{display:grid;grid-template-columns:72px 1fr auto;gap:26px;padding:28px 0;border-top:1px solid color-mix(in srgb,var(--text) 10%,transparent)}.faq{border-top:1px solid color-mix(in srgb,var(--text) 10%,transparent);padding:24px 0}.faq h3{margin:0 0 8px;font-family:var(--font-display)}footer{padding:58px 24px 32px;border-top:1px solid color-mix(in srgb,var(--text) 10%,transparent);color:var(--text-muted)}.footer-grid{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:44px}.footer-title{font-family:var(--font-display);font-size:21px;font-weight:800;color:var(--text);margin-bottom:10px}@media(max-width:850px){.nav-inner{align-items:flex-start}.links{flex-wrap:wrap;justify-content:flex-end}.hero{min-height:760px}.cards,.process,.split,.gallery,.contact,.footer-grid{grid-template-columns:1fr}.gallery img,.gallery img:first-child,.photo{height:320px;grid-row:auto}.service-row{grid-template-columns:1fr}.section{padding:68px 18px}}
  </style>
</head>
<body>
  ${nav(active, businessName, primaryHref, primaryLabel, hasContact)}
  ${body}
  ${footer(businessName, plan.tagline, { phone, email, address })}
</body>
</html>`

  const primaryCta = primaryHref && primaryLabel
    ? `<a class="btn primary" href="${attr(primaryHref)}">${esc(primaryLabel)}</a>`
    : ''
  const secondaryServicesCta = `<a class="btn" href="tjanster.html">Se tjänster</a>`
  const bookCta = primaryHref && primaryLabel
    ? `<a class="btn" href="${attr(primaryHref)}">Boka</a>`
    : ''

  const homeBody = `
    <section class="hero"><img src="${attr(img(0))}" alt="${esc(businessName)} verkstad"><div class="hero-content"><div class="pill">${esc(plan.trustTagline || plan.tagline || 'Noggrant arbete, tydlig service')}</div><h1 class="h1">${esc(plan.heroHeadline || `En modernare verkstad för ${businessName}`)}</h1><p class="lead">${esc(plan.heroSubline || plan.tagline || 'En tydlig, förtroendeingivande upplevelse för kunder som vill boka service och reparation.')}</p><div class="btns">${primaryCta}${secondaryServicesCta}</div></div></section>
    <section class="section"><div class="wrap"><div class="eyebrow">Tjänster</div><h2 class="h2">Det kunderna behöver — tydligt presenterat</h2><p class="lead">${esc(plan.ctaText || 'Från felsökning till löpande service, med fokus på ett enkelt och tryggt kundflöde.')}</p><div class="grid cards" style="margin-top:38px">${services.slice(0, 3).map(serviceCard).join('')}</div></div></section>
    <section class="section band"><div class="wrap"><div class="eyebrow">Så jobbar vi</div><h2 class="h2">Från bokning till färdig bil</h2><div class="grid process" style="margin-top:38px">${['Boka','Lämna bilen','Vi går igenom arbetet','Hämta tryggt'].map((t, i) => `<div class="step"><div class="num">0${i + 1}</div><h3>${esc(t)}</h3><p class="lead" style="font-size:15px">${esc(['Välj en tid som passar.','Bilen tas emot och behovet gås igenom.','Arbetet utförs med tydlig kommunikation.','Du får tillbaka bilen när allt är klart.'][i])}</p></div>`).join('')}</div></div></section>
    <section class="section"><div class="wrap split"><div><div class="eyebrow">Om verkstaden</div><h2 class="h2">${esc(plan.aboutTitle || businessName)}</h2><p class="lead">${esc(plan.aboutText || 'En lokal bilverkstad med fokus på service, reparation och ett smidigt kundmöte.')}</p><div class="btns"><a class="btn" href="om-oss.html">Läs mer</a></div></div><img class="photo" src="${attr(img(1))}" alt="Verkstadsbild"></div></section>
    <section class="section"><div class="wrap"><div class="grid gallery"><img src="${attr(img(2))}" alt="Bilservice"><img src="${attr(img(3))}" alt="Verkstad"><img src="${attr(img(4))}" alt="Reparation"></div></div></section>
    ${contactSection({ phone, email, address, googleMapsUrl })}`

  const aboutBody = `
    ${pageHero('Om oss', plan.aboutTitle || businessName, plan.aboutText || plan.tagline || '', img(1))}
    <section class="section"><div class="wrap split"><img class="photo" src="${attr(img(2))}" alt="Om ${esc(businessName)}"><div><div class="eyebrow">Verkstaden</div><h2 class="h2">${esc(plan.aboutTitle || `Möt ${businessName}`)}</h2><p class="lead">${esc(plan.aboutText || 'En verkstad byggd för tydlig service, bra kommunikation och noggrant utfört arbete.')}</p></div></div></section>
    <section class="section band"><div class="wrap"><div class="eyebrow">Vad vi står för</div><h2 class="h2">Tryggare känsla hela vägen</h2><div class="grid cards" style="margin-top:38px">${values.map((v) => `<div class="card"><h3>${esc(v.title)}</h3><p>${esc(v.text)}</p></div>`).join('')}</div></div></section>
    ${hasContact ? `<section class="section"><div class="wrap split"><div><h2 class="h2">Redo att lämna in bilen?</h2><p class="lead">${esc(plan.ctaText || 'Gör det enkelt för kunden att ta nästa steg.')}</p><div class="btns">${primaryCta}${secondaryServicesCta}</div></div><img class="photo" src="${attr(img(3))}" alt="Boka verkstad"></div></section>` : ''}`

  const servicesBody = `
    ${pageHero('Tjänster', 'Service och reparationer', plan.heroSubline || plan.tagline || '', img(0))}
    <section class="section"><div class="wrap"><div class="eyebrow">Tjänsteutbud</div><h2 class="h2">Tydligt, professionellt och lätt att boka</h2><div style="margin-top:36px">${services.map((s, i) => `<div class="service-row"><div class="num">${String(i + 1).padStart(2, '0')}</div><div><h3>${esc(s.name)}</h3><p class="lead" style="font-size:16px">${esc(s.description)}</p></div>${bookCta}</div>`).join('')}</div></div></section>
    <section class="section band"><div class="wrap"><div class="eyebrow">Vanliga frågor</div><h2 class="h2">Snabba svar före bokning</h2><div style="margin-top:34px">${faqs.map((f) => `<div class="faq"><h3>${esc(f.question)}</h3><p class="lead" style="font-size:16px">${esc(f.answer)}</p></div>`).join('')}</div></div></section>
    ${hasContact ? `<section class="section"><div class="wrap split"><img class="photo" src="${attr(img(4))}" alt="Bilverkstad tjänster"><div><h2 class="h2">Boka in en tid</h2><p class="lead">${esc(plan.ctaText || 'Ta kontakt för att hitta rätt service eller reparation för bilen.')}</p><div class="btns">${primaryCta}</div></div></div></section>` : ''}`

  return {
    'index.html': common('home', 'Hem', homeBody),
    'om-oss.html': common('about', 'Om oss', aboutBody),
    'tjanster.html': common('services', 'Tjänster', servicesBody),
  }
}

function normalizeServices(items?: ServiceItem[]): ServiceItem[] {
  const fallback = [
    { name: 'Service och underhåll', description: 'Regelbunden service och kontroll för att bilen ska kännas trygg i vardagen.' },
    { name: 'Felsökning', description: 'Systematisk genomgång när bilen varnar, låter annorlunda eller inte fungerar som den ska.' },
    { name: 'Reparationer', description: 'Åtgärder och reparationer med fokus på tydlig kommunikation genom hela arbetet.' },
    { name: 'Bromsar och säkerhet', description: 'Kontroll och åtgärd av viktiga slitdelar för säkrare körning.' },
  ]
  const cleaned = (items || [])
    .map((s) => ({ name: cleanText(s?.name || ''), description: cleanText(s?.description || '') }))
    .filter((s) => s.name && s.description)
    .slice(0, 7)
  return cleaned.length >= 3 ? cleaned : fallback
}

function normalizeValues(items?: ValueItem[]): ValueItem[] {
  const fallback = [
    { title: 'Tydlighet', text: 'Kunden ska förstå vad som görs och varför.' },
    { title: 'Noggrannhet', text: 'Varje uppdrag behandlas metodiskt och professionellt.' },
    { title: 'Trygg service', text: 'Målet är en enklare verkstadsupplevelse från första kontakt.' },
  ]
  const cleaned = (items || [])
    .map((v) => ({ title: cleanText(v?.title || ''), text: cleanText(v?.text || '') }))
    .filter((v) => v.title && v.text)
    .slice(0, 4)
  return cleaned.length >= 3 ? cleaned : fallback
}

function normalizeFaqs(items?: FaqItem[]): FaqItem[] {
  const fallback = [
    { question: 'Hur bokar jag tid?', answer: 'Kontakta verkstaden via telefon eller kontaktuppgifterna på sidan.' },
    { question: 'Kan ni felsöka bilen först?', answer: 'Ja, felsökning är ofta första steget när problemet inte är helt tydligt.' },
    { question: 'Får jag veta vad som behöver göras?', answer: 'En bra verkstadsupplevelse bygger på tydlig information innan arbetet går vidare.' },
    { question: 'Arbetar ni med vanliga servicejobb?', answer: 'Ja, sidan presenterar både service, felsökning och reparationer utan att ange påhittade priser.' },
  ]
  const cleaned = (items || [])
    .map((f) => ({ question: cleanText(f?.question || ''), answer: cleanText(f?.answer || '') }))
    .filter((f) => f.question && f.answer)
    .slice(0, 6)
  return cleaned.length >= 3 ? cleaned : fallback
}

function nav(active: 'home' | 'about' | 'services', businessName: string, primaryHref: string | null, primaryLabel: string | null, hasContact: boolean): string {
  const a = (key: string) => active === key ? ' active' : ''
  const contactLink = hasContact ? `<a href="index.html#kontakt">Kontakt</a>` : ''
  const cta = primaryHref && primaryLabel
    ? `<a class="nav-cta" href="${attr(primaryHref)}">${esc(primaryLabel)}</a>`
    : ''
  return `<nav class="nav"><div class="nav-inner"><a class="brand" href="index.html">${esc(businessName)}</a><div class="links"><a class="${a('home')}" href="index.html">Hem</a><a class="${a('about')}" href="om-oss.html">Om oss</a><a class="${a('services')}" href="tjanster.html">Tjänster</a>${contactLink}${cta}</div></div></nav>`
}

function pageHero(eyebrow: string, title: string, sub: string, image: string): string {
  return `<section class="page-hero"><img src="${attr(image)}" alt=""><div class="wrap"><div class="eyebrow">${esc(eyebrow)}</div><h1 class="h1" style="margin:0 auto">${esc(title)}</h1>${sub ? `<p class="lead" style="margin:24px auto 0">${esc(sub)}</p>` : ''}</div></section>`
}

function serviceCard(s: ServiceItem): string {
  return `<div class="card"><div class="icon"><svg width="25" height="25" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-5.8 5.8a2.1 2.1 0 1 0 3 3l5.8-5.8a4 4 0 0 0 5.4-5.4l-2.4 2.4-3-3 2.4-2.4Z"/></svg></div><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p></div>`
}

function contactSection({ phone, email, address, googleMapsUrl }: { phone: string; email: string; address: string; googleMapsUrl: string | null }): string {
  // Only render if there is real contact data — never fabricate a "kontakt saknas" placeholder.
  if (!phone && !email && !address) return ''
  const rows = [
    phone ? `<div class="contact-item"><strong>Telefon</strong><br><a href="tel:${attr(phone.replace(/\s+/g, ''))}">${esc(phone)}</a></div>` : '',
    email ? `<div class="contact-item"><strong>E-post</strong><br><a href="mailto:${attr(email)}">${esc(email)}</a></div>` : '',
    address ? `<div class="contact-item"><strong>Adress</strong><br>${esc(address)}</div>` : '',
  ].filter(Boolean).join('')
  const hasValidMap = googleMapsUrl && /^https:\/\/www\.google\.[^\s"']+\/maps\/embed/i.test(googleMapsUrl)
  // No map, no fake placeholder — use a single-column layout so nothing looks empty.
  const wrapClass = hasValidMap ? 'wrap contact' : 'wrap'
  const map = hasValidMap
    ? `<iframe class="map" src="${attr(googleMapsUrl!)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`
    : ''
  return `<section id="kontakt" class="section band"><div class="${wrapClass}"><div><div class="eyebrow">Kontakt</div><h2 class="h2">Ta nästa steg</h2><p class="lead">Boka service, fråga om felsökning eller beskriv vad bilen behöver hjälp med.</p><div class="contact-list" style="margin-top:24px">${rows}</div></div>${map}</div></section>`
}

function footer(businessName: string, tagline: string | undefined, contact: { phone: string; email: string; address: string }): string {
  const contactRows = [contact.phone, contact.email, contact.address].filter(Boolean).map(esc).join('<br>')
  const hasContact = Boolean(contactRows)
  const cols = hasContact ? '1.5fr 1fr 1fr' : '1.5fr 1fr'
  const contactCol = hasContact ? `<div><div class="footer-title">Kontakt</div><p>${contactRows}</p></div>` : ''
  const navContact = hasContact ? `<br><a href="index.html#kontakt">Kontakt</a>` : ''
  return `<footer><div class="wrap"><div class="footer-grid" style="grid-template-columns:${cols}"><div><div class="footer-title">${esc(businessName)}</div><p>${esc(tagline || 'Demo skapad för en modernare digital kundupplevelse.')}</p></div><div><div class="footer-title">Navigering</div><p><a href="index.html">Hem</a><br><a href="om-oss.html">Om oss</a><br><a href="tjanster.html">Tjänster</a>${navContact}</p></div>${contactCol}</div><p style="margin-top:42px;border-top:1px solid color-mix(in srgb,var(--text) 8%,transparent);padding-top:24px">© ${CURRENT_YEAR} ${esc(businessName)} — Demo skapad av Botlio</p></div></footer>`
}

function cleanText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
}

function esc(value: string): string {
  return cleanText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function attr(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function cssString(value: string): string {
  return value.replace(/[^a-zA-Z0-9 åäöÅÄÖ_-]/g, '').slice(0, 80)
}

function cssColor(value: string, fallback: string): string {
  const v = String(value || '').trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || /^rgb(a)?\([^)]+\)$/i.test(v) || /^[a-z]+$/i.test(v) ? v : fallback
}

async function failOrRetry(supabase: any, id: string, attempts: number, msg: string) {
  if (attempts >= MAX_ATTEMPTS) {
    await supabase.from('generated_sites').update({
      status: 'failed',
      error_message: `${msg} (max ${MAX_ATTEMPTS} attempts reached)`,
    }).eq('id', id)
  } else {
    await supabase.from('generated_sites').update({
      status: 'queued',
      queued_at: new Date().toISOString(),
      error_message: `Retrying (attempt ${attempts}/${MAX_ATTEMPTS}): ${msg}`,
    }).eq('id', id)
  }
}


function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
