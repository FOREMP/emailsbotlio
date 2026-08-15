// Deploys the generated HTML to Vercel as a static site.
// Uses Vercel's v13 deployments API with inline files — no GitHub repo needed.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Req { generated_site_id: string }

function slug(input: string) {
  return input
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o')
    .replace(/\b(ab|hb|kb)\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function stableProjectName(companyName: string, generatedSiteId: string) {
  const companySlug = slug(companyName) || 'site'
  const uniqueSuffix = generatedSiteId.replace(/-/g, '').slice(0, 8)
  const base = companySlug.slice(0, 36).replace(/-+$/g, '') || 'site'
  return `demo-${base}-${uniqueSuffix}`.slice(0, 60).replace(/-+$/g, '')
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Om token är personlig men projekten ska ägas av ett team måste teamId följa med.
// Är token skapad direkt i teamet behövs ingen VERCEL_TEAM_ID — då är detta en no-op.
function withTeam(url: string) {
  const teamId = Deno.env.get('VERCEL_TEAM_ID')
  if (!teamId) return url
  return url + (url.includes('?') ? '&' : '?') + `teamId=${encodeURIComponent(teamId)}`
}

async function verifyPublicDemoUrl(url: string) {
  // Vercel behöver upp till ~1 min innan produktionsaliaset svarar på ett nytt projekt.
  const attempts = [0, 2000, 3000, 5000, 7000, 10000, 10000, 12000, 15000]
  let lastStatus: number | null = null
  let lastBody = ''
  for (const waitMs of attempts) {
    if (waitMs > 0) await delay(waitMs)
    try {
      const resp = await fetch(url, { method: 'GET', redirect: 'follow' })
      lastStatus = resp.status
      lastBody = (await resp.text().catch(() => '')).slice(0, 400).toLowerCase()
      if (resp.ok && !/deployment not found|not found/i.test(lastBody)) {
        return { ok: true as const, status: resp.status }
      }
    } catch (err) {
      lastBody = err instanceof Error ? err.message : String(err)
    }
  }
  return { ok: false as const, status: lastStatus, detail: lastBody }
}

// Vänta tills deployen är byggd (READY) innan vi verifierar den publika URL:en.
async function waitForReady(deploymentId: string, token: string) {
  const attempts = [0, 3000, 5000, 7000, 10000, 10000, 12000]
  let state = 'UNKNOWN'
  for (const waitMs of attempts) {
    if (waitMs > 0) await delay(waitMs)
    try {
      const resp = await fetch(withTeam(`https://api.vercel.com/v13/deployments/${deploymentId}`), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) continue
      const data = await resp.json()
      state = data.readyState ?? data.status ?? state
      if (state === 'READY') return { ready: true as const, state }
      if (state === 'ERROR' || state === 'CANCELED') return { ready: false as const, state }
    } catch (_e) {
      // ignorera, försök igen
    }
  }
  return { ready: false as const, state }
}

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
      .select('id, contact_id, site_lead_id, generated_files, vercel_project_id')
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

    const projectName = stableProjectName(companyName, site.id)

    await supabase.from('generated_sites').update({ status: 'deploying', error_message: null }).eq('id', generated_site_id)

    const deployResp = await fetch(withTeam('https://api.vercel.com/v13/deployments'), {
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
    const deployData = await deployResp.json()

    if (!deployResp.ok) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `Vercel deploy failed (${deployResp.status}): ${JSON.stringify(deployData).slice(0, 500)}`,
      }).eq('id', generated_site_id)
      return json({ error: 'vercel failed', details: deployData }, deployResp.status)
    }

    const url = deployData.url ? `https://${deployData.url}` : null
    const publicUrl = `https://${projectName}.vercel.app`


    // Disable Vercel deployment protection (SSO/password) so the demo is publicly viewable.
    // Safe to call every deploy — idempotent.
    if (deployData.projectId) {
      try {
        const patchResp = await fetch(withTeam(`https://api.vercel.com/v9/projects/${deployData.projectId}`), {
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

    if (deployData.id) {
      const ready = await waitForReady(deployData.id, vercelToken)
      if (!ready.ready) console.warn('deployment not READY before verify:', ready.state)
    }

    const verify = await verifyPublicDemoUrl(publicUrl)
    if (!verify.ok) {
      const detail = `Stable demo URL did not become public (${verify.status ?? 'no-status'}): ${String(verify.detail ?? '').slice(0, 240)}`
      await supabase.from('generated_sites').update({
        status: 'failed',
        vercel_project_id: deployData.projectId ?? site.vercel_project_id ?? null,
        vercel_deployment_url: url,
        demo_site_url: null,
        error_message: detail,
      }).eq('id', generated_site_id)
      return json({ error: detail, deployment: url, public_url: publicUrl }, 502)
    }

    await supabase.from('generated_sites').update({
      status: 'live',
      vercel_project_id: deployData.projectId ?? null,
      vercel_deployment_url: url,
      demo_site_url: publicUrl,
    }).eq('id', generated_site_id)

    return json({ ok: true, url: publicUrl, deployment: url })
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
