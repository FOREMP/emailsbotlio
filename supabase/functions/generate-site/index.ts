// Generates a premium, single-file HTML demo site for a lead using Claude
// Sonnet 4.5 via OpenRouter. Uses ONLY facts present in scraped_content +
// contact.custom_fields — no hallucinated address/phone/year. Includes real
// Unsplash images and multi-section anchor navigation.
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
    // Defensive: if the scrape stored an error preview, refuse
    if (!scraped.markdown || scraped.markdown.trim().length < 400) {
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

    // Only pass facts we ACTUALLY have. Missing = null, never fabricated.
    const facts = {
      business_name: (cf.company ?? contact?.company ?? scraped.title ?? '').toString().trim() || null,
      phone: (cf.phone ?? cf.telefon ?? cf.tel ?? null) as string | null,
      address: (cf.address ?? cf.adress ?? null) as string | null,
      city: (cf.city ?? cf.ort ?? null) as string | null,
      email: contact?.email ?? null,
      source_url: site.source_url,
      primary_color: branding.colors?.primary || branding.primaryColor || '#0f172a',
      accent_color: branding.colors?.secondary || '#ea580c',
      real_images: Array.isArray(scraped.images) ? scraped.images.slice(0, 8) : [],
    }

    const systemPrompt = `Du är en senior art director och webbutvecklare specialiserad på premium one-page-sajter för svenska bilverkstäder. Du levererar en KOMPLETT produktionsklar HTML-fil (från <!DOCTYPE html> till </html>) med inline CSS, mobil-först, som ser dyr och modern ut.

ABSOLUTA REGLER — bryts aldrig:
1. HITTA ALDRIG PÅ FAKTA. Om ett faktum saknas (adress, telefon, öppettider, grundningsår) — utelämna sektionen HELT eller använd en neutral CTA istället. Ingen "Verkstadsgatan 1" eller "08-123 45 67".
2. Använd alltid året ${CURRENT_YEAR} i footer/copyright. Aldrig 2024 eller äldre.
3. Om business_name är null eller ser ut som ett HTTP-fel ("400 Bad Request", "404" etc), STOPPA och returnera bara: <!-- ERROR: invalid business name --> och inget annat.
4. Använd de tillhandahållna Unsplash-bilderna direkt i <img src="..."> (hero, tjänste-kort, galleri). Använd ALDRIG placeholder.com eller via.placeholder.
5. Ingen extern JS eller CSS förutom Google Fonts. Ingen backend, inga formulär som postar någonstans.

DESIGN-KRAV:
- Sticky top-nav med ankarlänkar (Hem, Tjänster, Om oss, Kontakt)
- Hero med stor bild eller gradient + rubrik + 2 CTA-knappar (telefon om vi har den, annars bara "Boka tid")
- Tjänster: 4–6 kort i grid, varje med ikon (SVG inline) och kort text hämtad från källdatan
- Om oss: kort text baserad på källdatans summary/markdown, INGA påhittade årtal
- Galleri: 3–6 Unsplash-bilder relevanta för bilverkstad
- Kontakt: bara det vi har (telefon / adress / e-post). Om vi saknar allt: enkel CTA "Kontakta oss via din vanliga kanal"
- Footer: © ${CURRENT_YEAR} [business_name]. "Demo skapad av Botlio."
- Google Fonts: Inter eller Space Grotesk
- Använd primary_color som huvudton, accent_color för CTA-knappar
- Modernt: mycket whitespace, subtila skuggor, rundade hörn (12–16px), stora rubriker, tydlig hierarki

Svara med ENDAST HTML. Ingen markdown-inramning, ingen förklaring, ingen kommentar före <!DOCTYPE html>.`

    const unsplashPool = [
      'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=1600&q=80', // workshop
      'https://images.unsplash.com/photo-1625047509168-a7026f36de04?w=1600&q=80', // mechanic
      'https://images.unsplash.com/photo-1632823471565-1ecdf5c6d7f4?w=1200&q=80', // engine
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1600&q=80', // car
      'https://images.unsplash.com/photo-1580273916550-e323be2ae537?w=1200&q=80', // tires
      'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=1200&q=80', // brake
      'https://images.unsplash.com/photo-1493031440916-e69b7a91be16?w=1200&q=80', // diagnostic
      'https://images.unsplash.com/photo-1552930294-3af53b58f61c?w=1200&q=80', // interior detail
    ]

    const userPrompt = `Bygg en premium one-pager för denna bilverkstad.

FAKTA (använd ENDAST detta — hitta aldrig på nya siffror, adresser eller årtal):
${JSON.stringify(facts, null, 2)}

UNSPLASH-BILDER att använda i <img>-taggar (hero, tjänster, galleri):
${JSON.stringify(unsplashPool, null, 2)}

KÄLLDATA från deras nuvarande sajt (bara för att förstå deras tjänster/ton — kopiera inte påhittade siffror):
Titel: ${scraped.title || 'okänd'}
Beskrivning: ${scraped.description || ''}
Summering: ${scraped.summary || ''}

MARKDOWN (första 8000 tecknen):
${(scraped.markdown || '').slice(0, 8000)}

Returnera BARA färdig HTML.`

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
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.6,
        max_tokens: 16000,
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
    let html: string = aiData.choices?.[0]?.message?.content ?? ''
    html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    if (html.includes('<!-- ERROR:') || (!html.toLowerCase().includes('<!doctype') && !html.toLowerCase().includes('<html'))) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: 'AI refused or returned invalid HTML (likely bad source data). Re-check contact + source_url.',
      }).eq('id', generated_site_id)
      return json({ error: 'no valid html', preview: html.slice(0, 300) }, 422)
    }

    await supabase.from('generated_sites').update({
      status: 'generated',
      generated_files: { 'index.html': html },
    }).eq('id', generated_site_id)

    return json({ ok: true, bytes: html.length, model: model || MODEL })
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
