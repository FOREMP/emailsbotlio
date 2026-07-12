// Generates a premium MULTI-PAGE demo site (index + om-oss + tjänster)
// using Claude Sonnet 4.5 via OpenRouter. Multimodal: passes the lead's own
// homepage screenshot as design inspiration. Uses real brand colors + fonts
// from Firecrawl branding when available. Prioritizes real lead images
// (custom_fields.extra_images + scraped page images) over Unsplash.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'anthropic/claude-sonnet-4.5'
const CURRENT_YEAR = new Date().getFullYear()

interface Req { generated_site_id: string; model?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { generated_site_id, model }: Req = await req.json()
    if (!generated_site_id) return json({ error: 'generated_site_id required' }, 400)

    const openrouterKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!openrouterKey) return json({ error: 'OPENROUTER_API_KEY missing' }, 500)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: site, error: siteErr } = await supabase
      .from('generated_sites')
      .select('id, contact_id, source_url, scraped_content, template')
      .eq('id', generated_site_id)
      .single()
    if (siteErr || !site) return json({ error: 'site not found' }, 404)
    if (!site.scraped_content) return json({ error: 'no scraped_content — run scrape first' }, 400)

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

    await supabase.from('generated_sites').update({ status: 'generating', error_message: null }).eq('id', generated_site_id)

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
    const scrapedImages: string[] = Array.isArray(scraped.images) ? scraped.images.slice(0, 12) : []

    const facts = {
      business_name: (cf.company ?? contact?.company ?? pages.home?.title ?? scraped.title ?? '').toString().trim() || null,
      phone: (cf.phone ?? cf.telefon ?? cf.tel ?? null) as string | null,
      address: (cf.address ?? cf.adress ?? null) as string | null,
      city: (cf.city ?? cf.ort ?? null) as string | null,
      email: contact?.email ?? null,
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
    const imagePool = [...extraImages, ...scrapedImages, ...unsplashPool].slice(0, 14)

    const screenshotUrl: string | null = scraped.screenshot_url ?? null

    const systemPrompt = `Du är en senior art director och webbutvecklare för premium svenska bilverkstadssajter. Du levererar en KOMPLETT MULTI-PAGE-sajt: 3 separata HTML-filer som länkar via en delad sticky top-nav.

RETURFORMAT — kritiskt:
Svara med ETT giltigt JSON-objekt (och inget annat, ingen markdown-inramning):
{
  "index.html": "<!DOCTYPE html>...</html>",
  "om-oss.html": "<!DOCTYPE html>...</html>",
  "tjanster.html": "<!DOCTYPE html>...</html>"
}
Varje HTML fullständig från <!DOCTYPE html> till </html>, med inline <style> och samma design-system.

ABSOLUTA REGLER — bryts aldrig:
1. HITTA ALDRIG PÅ FAKTA. Om ett faktum saknas (adress, telefon, öppettider, grundningsår, priser) — utelämna det HELT.
2. Använd alltid året ${CURRENT_YEAR} i footer.
3. Om business_name saknas eller ser ut som HTTP-fel, returnera bara: {"error":"invalid business name"}
4. Använd tillhandahållna bild-URLer direkt i <img src="...">. ALDRIG placeholder.com.
5. Ingen extern JS/CSS förutom Google Fonts. Inga funktionella formulär.
6. Sticky nav på ALLA 3 sidor: Hem (index.html), Om oss (om-oss.html), Tjänster (tjanster.html), Kontakt (index.html#kontakt). Aktiv sida markeras med accent-färg.

SKÄRMDUMPS-ANVÄNDNING (om screenshot bifogas):
- Använd ENDAST som stil-inspo: färgkänsla, luftighet, ton, hur de använder bilder.
- KOPIERA INTE deras layout, texter eller struktur. Vi bygger en NYARE, BÄTTRE version.
- Om deras sajt ser gammal ut → gör vår MODERN. Vi ska visa hur mycket bättre det kan bli.

DESIGN-SYSTEM:
- Google Fonts: ${brandFonts.length > 0 ? `försök ladda "${brandFonts[0]}" (deras riktiga font), annars ` : ''}Space Grotesk (rubriker) + Inter (brödtext)
- Färgpalett (${hasRealBranding ? 'DERAS RIKTIGA färger — använd dessa' : 'ingen branding hittad — använd mörk premium-default'}):
  * primary: ${brandPalette.primary}
  * secondary: ${brandPalette.secondary}
  * accent: ${brandPalette.accent}
  * background: ${brandPalette.background}
  * surface (kort/sektioner): ${brandPalette.surface}
  * text primary: ${brandPalette.textPrimary}
  * text secondary: ${brandPalette.textSecondary}
- Rundade hörn 14px, subtila skuggor (0 10px 40px rgba(0,0,0,.3)), generös whitespace
- Hover-transitions på knappar/kort
- Mobil-först, responsiv grid

SIDA 1 — index.html (Hem):
- Sticky nav (Hem aktiv)
- Hero med full-bleed bild + gradient overlay, stor H1 med USP, sub, 2 CTA (Ring / Se tjänster)
- Trust-strip: bilmärken/certifieringar från källdata om nämnda
- "Så jobbar vi" – 4-stegs process (Boka → Lämna → Vi fixar → Hämta)
- Tjänste-preview: 3 kort med länk till tjanster.html
- Galleri: 3-4 bilder
- Kontakt-sektion id="kontakt": telefon/adress/mail om vi har dem${googleMapsUrl ? '. INKLUDERA också en Google Maps iframe med src="' + googleMapsUrl + '" (bredd 100%, höjd 320px, border 0, rundade hörn)' : ''}
- Footer: © ${CURRENT_YEAR} [business_name] — Demo skapad av Botlio

SIDA 2 — om-oss.html:
- Sticky nav (Om oss aktiv)
- Hero-header med bild-bakgrund
- Historia + värderingar baserat på ${pages.about ? 'ABOUT-sidans markdown' : "HEM-sidans markdown"} — INGA påhittade årtal
- "Vad vi står för" – 3-4 värderingar
- Team-sektion ENDAST om källdatan nämner personer
- CTA-band: "Redo att lämna in bilen?" → länk till tjanster.html
- Samma footer

SIDA 3 — tjanster.html:
- Sticky nav (Tjänster aktiv)
- Hero-header
- Detaljerat grid med tjänster baserat på ${pages.services ? 'SERVICES-sidans markdown' : "HEM-sidans markdown"} — 4-8 tjänste-kort med ikon (inline SVG), namn, beskrivning. INGA påhittade priser.
- FAQ-sektion 4-6 vanliga frågor
- CTA-band: "Boka in en tid" med telefon (tel: om vi har)
- Samma footer

Om telefonen finns → alla "Ring oss"-knappar ska vara <a href="tel:NUMMER">. Om inte → länk till #kontakt.
Ingen förklaring före eller efter JSON-objektet.`

    const userTextParts = [
      'Bygg 3-sidig premium-sajt för denna bilverkstad.',
      '',
      'FAKTA (endast detta — hitta aldrig på siffror, adresser eller årtal):',
      JSON.stringify(facts, null, 2),
      '',
      `BILD-POOL (${extraImages.length} från kunden, ${scrapedImages.length} från deras sajt, resten Unsplash-fallback — använd de riktiga först):`,
      JSON.stringify(imagePool, null, 2),
      '',
      '--- KÄLLDATA: HEM-SIDAN ---',
      `Titel: ${pages.home?.title || scraped.title || ''}`,
      `Beskrivning: ${pages.home?.description || scraped.description || ''}`,
      `Sammanfattning: ${pages.home?.summary || scraped.summary || ''}`,
      'Markdown (första 4000 tecken):',
      (pages.home?.markdown || homeMd).slice(0, 4000),
      '',
      `--- KÄLLDATA: OM-OSS-SIDAN ${pages.about ? `(${pages.about.url})` : '(hittades ej — härled från hem)'} ---`,
      pages.about
        ? `Titel: ${pages.about.title}\nMarkdown (första 4000 tecken):\n${pages.about.markdown.slice(0, 4000)}`
        : '[Ingen separat about-sida. Använd HEM-sidans markdown för kort företagsbeskrivning. Inga påhittade fakta.]',
      '',
      `--- KÄLLDATA: TJÄNSTER-SIDAN ${pages.services ? `(${pages.services.url})` : '(hittades ej — härled från hem)'} ---`,
      pages.services
        ? `Titel: ${pages.services.title}\nMarkdown (första 5000 tecken):\n${pages.services.markdown.slice(0, 5000)}`
        : '[Ingen separat tjänster-sida. Extrahera tjänster från HEM-sidans markdown. Om oklart, använd branschstandard-tjänster utan påhittade priser.]',
      '',
      screenshotUrl
        ? 'BIFOGAD BILD nedan = skärmdump av deras nuvarande hemsida. Använd som STIL-INSPO för färgkänsla/ton, men gör en NYARE, BÄTTRE version — kopiera inte deras layout.'
        : '[Ingen skärmdump av nuvarande sajt tillgänglig.]',
      '',
      'Returnera BARA JSON-objektet med de 3 HTML-filerna.',
    ].join('\n')

    // Build multimodal content parts
    const userContent: any[] = [{ type: 'text', text: userTextParts }]
    if (screenshotUrl) {
      userContent.push({ type: 'image_url', image_url: { url: screenshotUrl } })
    }

    const aiResp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://emailsbotlio.lovable.app',
        'X-Title': 'Botlio Site Generator',
      },
      body: JSON.stringify({
        model: model || MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.6,
        max_tokens: 32000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!aiResp.ok) {
      const errText = await aiResp.text()
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `OpenRouter failed (${aiResp.status}): ${errText.slice(0, 400)}`,
      }).eq('id', generated_site_id)
      return json({ error: 'ai failed', details: errText }, aiResp.status)
    }

    const aiData = await aiResp.json()
    const raw: string = aiData.choices?.[0]?.message?.content ?? ''
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    let parsed: Record<string, string> | null = null
    try { parsed = JSON.parse(cleaned) } catch (_) { parsed = null }

    if (!parsed || parsed.error || !parsed['index.html']) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `AI returned invalid multi-page JSON. Preview: ${cleaned.slice(0, 400)}`,
      }).eq('id', generated_site_id)
      return json({ error: 'invalid ai output', preview: cleaned.slice(0, 400) }, 422)
    }

    const files: Record<string, string> = {}
    for (const key of ['index.html', 'om-oss.html', 'tjanster.html']) {
      if (typeof parsed[key] === 'string' && parsed[key].toLowerCase().includes('<html')) {
        files[key] = parsed[key]
      }
    }
    if (!files['index.html']) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: 'AI output missing valid index.html',
      }).eq('id', generated_site_id)
      return json({ error: 'no index.html in output' }, 422)
    }

    await supabase.from('generated_sites').update({
      status: 'generated',
      generated_files: files,
    }).eq('id', generated_site_id)

    return json({
      ok: true,
      files: Object.keys(files),
      total_bytes: Object.values(files).reduce((s, h) => s + h.length, 0),
      used_screenshot: !!screenshotUrl,
      used_real_branding: hasRealBranding,
      extra_images: extraImages.length,
      model: model || MODEL,
    })
  } catch (err) {
    console.error('generate-site error', err)
    return json({ error: (err as Error).message }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
