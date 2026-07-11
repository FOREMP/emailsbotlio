// Generates a single-file HTML demo site for a lead using their scraped
// content + contact info. Stores the HTML in generated_sites.generated_files.
// Next step: deploy-site pushes it to Vercel.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1'
const MODEL = 'google/gemini-2.5-pro' // higher fidelity for full HTML generation

interface Req { generated_site_id: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { generated_site_id }: Req = await req.json()
    if (!generated_site_id) return json({ error: 'generated_site_id required' }, 400)

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

    const { data: contact } = await supabase
      .from('contacts')
      .select('first_name, last_name, email, company, custom_fields')
      .eq('id', site.contact_id)
      .single()

    await supabase.from('generated_sites').update({ status: 'generating', error_message: null }).eq('id', generated_site_id)

    const lovableKey = Deno.env.get('LOVABLE_API_KEY')
    if (!lovableKey) return json({ error: 'LOVABLE_API_KEY missing' }, 500)

    const scraped = site.scraped_content as any
    const branding = scraped.branding ?? {}
    const cf = (contact?.custom_fields ?? {}) as Record<string, unknown>

    const businessName = (cf.company ?? contact?.company ?? scraped.title ?? 'Din verkstad') as string
    const primaryColor = branding.colors?.primary || branding.primaryColor || '#1a56db'

    const systemPrompt = `Du är en expert på att designa moderna, konverterande one-page-hemsidor för svenska bilverkstäder. Du skriver komplett, produktionsklar HTML med inline CSS (ingen extern JS/CSS förutom Google Fonts). Sajten ska vara mobil-först, snabb, och känns dyr.

Krav:
- En enda <!DOCTYPE html> fil, komplett från <html> till </html>
- Google Fonts (Inter eller Space Grotesk)
- Sektioner: Hero med CTA, Tjänster (4-6 kort), Om oss, Varför oss (3-4 fördelar), Kontakt/CTA med telefon+adress
- Använd verkstadens riktiga namn, adress, tjänster, öppettider från det scrapade innehållet
- Primärfärg: ${primaryColor}
- Modern, ren, gott om whitespace, subtila skuggor, rundade hörn
- CTA-knappar: "Boka tid" och "Ring oss"
- Sticky top-nav
- Footer med copyright + "Demo skapad av Botlio"
- Ingen lorem ipsum — bara riktigt innehåll baserat på källdatan`

    const userPrompt = `Bygg en ny hemsida för verkstaden "${businessName}".

KÄLLDATA (deras nuvarande sajt):
Titel: ${scraped.title || 'okänd'}
Beskrivning: ${scraped.description || ''}
Summering: ${scraped.summary || ''}

INNEHÅLL (markdown):
${(scraped.markdown || '').slice(0, 8000)}

Skapa en betydligt bättre version. Returnera BARA HTML-koden, inget annat, ingen markdown-inramning, ingen förklaring.`

    const aiResp = await fetch(`${AI_GATEWAY}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Lovable-API-Key': lovableKey },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
      }),
    })

    if (!aiResp.ok) {
      const errText = await aiResp.text()
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `AI failed (${aiResp.status}): ${errText.slice(0, 400)}`,
      }).eq('id', generated_site_id)
      return json({ error: 'ai failed', details: errText }, aiResp.status)
    }

    const aiData = await aiResp.json()
    let html: string = aiData.choices?.[0]?.message?.content ?? ''
    // Strip markdown fences if the model added them
    html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    if (!html.toLowerCase().includes('<!doctype') && !html.toLowerCase().includes('<html')) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: 'AI returned no valid HTML',
      }).eq('id', generated_site_id)
      return json({ error: 'no html in AI response' }, 500)
    }

    await supabase.from('generated_sites').update({
      status: 'generated',
      generated_files: { 'index.html': html },
    }).eq('id', generated_site_id)

    return json({ ok: true, bytes: html.length })
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
