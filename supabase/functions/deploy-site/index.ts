// Deploys the generated HTML to Vercel as a static site.
// Uses Vercel's v13 deployments API with inline files — no GitHub repo needed.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Req { generated_site_id: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { generated_site_id }: Req = await req.json()
    if (!generated_site_id) return json({ error: 'generated_site_id required' }, 400)

    const vercelToken = Deno.env.get('VERCEL_API_TOKEN')
    if (!vercelToken) return json({ error: 'VERCEL_API_TOKEN missing' }, 500)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: site, error: siteErr } = await supabase
      .from('generated_sites')
      .select('id, contact_id, site_lead_id, generated_files')
      .eq('id', generated_site_id)
      .single()
    if (siteErr || !site) return json({ error: 'site not found' }, 404)
    const files = site.generated_files as Record<string, string> | null
    if (!files || !files['index.html']) return json({ error: 'no generated_files.index.html — run generate first' }, 400)
    const filesArray = Object.entries(files)
      .filter(([, data]) => typeof data === 'string' && data.length > 0)
      .map(([file, data]) => ({ file, data }))

    // Prefer the real company name for a human-readable URL: demo-<company>.vercel.app
    let companyName = ''
    if (site.site_lead_id) {
      const { data: lead } = await supabase
        .from('site_leads')
        .select('company_name')
        .eq('id', site.site_lead_id)
        .maybeSingle()
      companyName = (lead?.company_name ?? '').toString()
    }
    if (!companyName && site.contact_id) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('first_name, last_name, custom_fields, email')
        .eq('id', site.contact_id)
        .maybeSingle()
      const cf = (contact?.custom_fields ?? {}) as Record<string, unknown>
      companyName = String(
        cf.company ?? cf.company_name ?? cf.företag ?? cf.foretag ?? contact?.email?.split('@')[0] ?? '',
      )
    }

    const slug = (input: string) =>
      input
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[åä]/g, 'a').replace(/ö/g, 'o')
        .replace(/\b(ab|hb|kb)\b/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 45)
        .replace(/-+$/g, '')

    const companySlug = slug(companyName) || 'site'
    const primaryName = `demo-${companySlug}`.slice(0, 52).replace(/-+$/g, '')
    const fallbackName = `${primaryName}-${site.id.slice(0, 4)}`.slice(0, 60)

    await supabase.from('generated_sites').update({ status: 'deploying', error_message: null }).eq('id', generated_site_id)

    const deploy = async (projectName: string) => {
      const resp = await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: projectName,
          project: projectName,
          target: 'production',
          files: filesArray,
          projectSettings: {
            framework: null,
            buildCommand: null,
            outputDirectory: null,
            installCommand: null,
            devCommand: null,
          },
        }),
      })
      return { resp, data: await resp.json(), projectName }
    }

    let out = await deploy(primaryName)
    if (!out.resp.ok && (out.resp.status === 409 || out.resp.status === 403)) {
      // Name already taken by another project → add a short unique suffix.
      out = await deploy(fallbackName)
    }

    const { resp: deployResp, data: deployData, projectName } = out
    if (!deployResp.ok) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `Vercel deploy failed (${deployResp.status}): ${JSON.stringify(deployData).slice(0, 500)}`,
      }).eq('id', generated_site_id)
      return json({ error: 'vercel failed', details: deployData }, deployResp.status)
    }

    const url = deployData.url ? `https://${deployData.url}` : null
    // Production deployments get the clean project alias: demo-<company>.vercel.app
    const cleanAlias = `https://${projectName}.vercel.app`
    const namedAlias = (deployData.alias as string[] | undefined)?.find((a) => a === `${projectName}.vercel.app`)
    const aliasUrl = namedAlias ? `https://${namedAlias}` : (cleanAlias || url)


    // Disable Vercel deployment protection (SSO/password) so the demo is publicly viewable.
    // Safe to call every deploy — idempotent.
    if (deployData.projectId) {
      try {
        const patchResp = await fetch(`https://api.vercel.com/v9/projects/${deployData.projectId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${vercelToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ssoProtection: null,
            passwordProtection: null,
          }),
        })
        if (!patchResp.ok) {
          console.warn('Could not disable protection:', patchResp.status, await patchResp.text())
        }
      } catch (e) {
        console.warn('protection patch failed', e)
      }
    }

    await supabase.from('generated_sites').update({
      status: 'live',
      vercel_project_id: deployData.projectId ?? null,
      vercel_deployment_url: url,
      demo_site_url: aliasUrl,
    }).eq('id', generated_site_id)

    return json({ ok: true, url: aliasUrl, deployment: url })
  } catch (err) {
    console.error('deploy-site error', err)
    return json({ error: (err as Error).message }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
