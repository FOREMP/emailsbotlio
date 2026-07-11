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
      .select('id, contact_id, generated_files')
      .eq('id', generated_site_id)
      .single()
    if (siteErr || !site) return json({ error: 'site not found' }, 404)
    const files = site.generated_files as Record<string, string> | null
    const html = files?.['index.html']
    if (!html) return json({ error: 'no generated_files.index.html — run generate first' }, 400)

    // Get contact for a nice project name
    const { data: contact } = await supabase
      .from('contacts')
      .select('company, email')
      .eq('id', site.contact_id)
      .single()

    const slugBase = (contact?.company || contact?.email?.split('@')[0] || 'demo')
      .toString()
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'demo'
    const projectName = `${slugBase}-${site.id.slice(0, 6)}`

    await supabase.from('generated_sites').update({ status: 'deploying', error_message: null }).eq('id', generated_site_id)

    // Vercel v13 deployments with inline file contents
    const deployResp = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: projectName,
        project: projectName,
        target: 'production',
        files: [
          { file: 'index.html', data: html },
        ],
        projectSettings: {
          framework: null,
          buildCommand: null,
          outputDirectory: null,
          installCommand: null,
          devCommand: null,
        },
      }),
    })

    const deployData = await deployResp.json()
    if (!deployResp.ok) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `Vercel deploy failed (${deployResp.status}): ${JSON.stringify(deployData).slice(0, 500)}`,
      }).eq('id', generated_site_id)
      return json({ error: 'vercel failed', details: deployData }, deployResp.status)
    }

    const url = deployData.url ? `https://${deployData.url}` : null
    const aliasUrl = deployData.alias?.[0] ? `https://${deployData.alias[0]}` : url

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
