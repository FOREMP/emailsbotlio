// Deploys the generated HTML to Vercel as a static site.
// Uses Vercel's v13 deployments API with inline files — no GitHub repo involved.
//
// Two modes:
//   POST { generated_site_id }  → deploy one site, alias it, VERIFY the URL
//   POST { repair: true }       → scan existing 'live' sites and fix dead URLs
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VERCEL = 'https://api.vercel.com'
// All demos deploy through one reusable Vercel project. Creating one project
// per lead eventually hits Vercel's project-count limit and blocks the whole
// outreach pipeline. Each deployment still receives its own readable alias.
const SHARED_PROJECT = 'foremp-site-demos'

interface Req {
  generated_site_id?: string
  repair?: boolean
  limit?: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body: Req = await req.json().catch(() => ({}))

    const vercelToken = Deno.env.get('VERCEL_API_TOKEN')
    if (!vercelToken) return json({ error: 'VERCEL_API_TOKEN missing' }, 500)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    if (body.repair) return await repair(supabase, vercelToken, body.limit ?? 40)

    const generated_site_id = body.generated_site_id
    if (!generated_site_id) return json({ error: 'generated_site_id required' }, 400)

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

    // Reuse any existing demo project immediately, including accounts that
    // have already reached their Vercel project limit.
    const { data: reusable } = await supabase
      .from('generated_sites')
      .select('vercel_project_id')
      .not('vercel_project_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const projectTarget = reusable?.vercel_project_id || SHARED_PROJECT

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

    // Short names avoid global name collisions and over-long hostnames.
    const companySlug = slug(companyName, 30) || 'site'
    const primaryAlias = `${trimName(`demo-${companySlug}`)}.vercel.app`
    const fallbackAlias = `${trimName(`demo-${companySlug}-${site.id.slice(0, 4)}`)}.vercel.app`

    await supabase.from('generated_sites').update({ status: 'deploying', error_message: null }).eq('id', generated_site_id)

    const deploy = async () => {
      const resp = await fetch(`${VERCEL}/v13/deployments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: SHARED_PROJECT,
          project: projectTarget,
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
      return { resp, data: await resp.json() }
    }

    const { resp: deployResp, data: deployData } = await deploy()
    if (!deployResp.ok) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `Vercel deploy failed (${deployResp.status}): ${JSON.stringify(deployData).slice(0, 500)}`,
      }).eq('id', generated_site_id)
      return json({ error: 'vercel failed', details: deployData }, deployResp.status)
    }

    const deploymentUrl = deployData.url ? `https://${deployData.url}` : null
    const deploymentId: string | null = deployData.id ?? null

    // Disable Vercel deployment protection (SSO/password) so the demo is publicly viewable.
    if (deployData.projectId) await disableProtection(vercelToken, deployData.projectId)

    // Claim a company-readable alias. If that alias is already attached to a
    // different demo, use the stable site-id suffix instead.
    let assignedAlias: string | null = null
    if (deploymentId) {
      if (await assignAlias(vercelToken, deploymentId, primaryAlias)) assignedAlias = primaryAlias
      else if (await assignAlias(vercelToken, deploymentId, fallbackAlias)) assignedAlias = fallbackAlias
    }

    // Build the candidate list from what Vercel really reported, then verify.
    const candidates = uniq([
      ...(assignedAlias ? [`https://${assignedAlias}`] : []),
      ...((deployData.alias as string[] | undefined) ?? []).map((a) => `https://${a}`),
      ...(deployData.projectId ? await projectDomains(vercelToken, deployData.projectId) : []),
      deploymentUrl,
    ].filter(Boolean) as string[])

    const workingUrl = await firstWorking(candidates, 10)

    if (!workingUrl) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        vercel_project_id: deployData.projectId ?? null,
        vercel_deployment_url: deploymentUrl,
        error_message: `Deploy klar men ingen URL svarade 200. Testade: ${candidates.join(', ').slice(0, 400)}`,
      }).eq('id', generated_site_id)
      return json({ error: 'no reachable url', candidates }, 502)
    }

    await supabase.from('generated_sites').update({
      status: 'live',
      vercel_project_id: deployData.projectId ?? null,
      vercel_deployment_url: deploymentUrl,
      demo_site_url: workingUrl,
    }).eq('id', generated_site_id)

    if (site.site_lead_id) {
      await supabase.from('site_leads').update({ demo_url: workingUrl }).eq('id', site.site_lead_id)
    }

    return json({ ok: true, url: workingUrl, deployment: deploymentUrl, candidates })
  } catch (err) {
    console.error('deploy-site error', err)
    return json({ error: (err as Error).message }, 500)
  }
})

// ---------------------------------------------------------------------------
// REPAIR — find 'live' sites whose stored URL is dead and point them at a
// working Vercel URL (project alias or the raw deployment URL).
// ---------------------------------------------------------------------------
async function repair(
  supabase: ReturnType<typeof createClient>,
  vercelToken: string,
  limit: number,
): Promise<Response> {
  const { data: sites } = await supabase
    .from('generated_sites')
    .select('id, site_lead_id, demo_site_url, vercel_deployment_url, vercel_project_id')
    .eq('status', 'live')
    .not('demo_site_url', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit)

  const result = { checked: 0, ok: 0, fixed: 0, broken: [] as string[] }

  for (const s of (sites ?? []) as any[]) {
    result.checked++
    if (await isUp(s.demo_site_url)) { result.ok++; continue }

    const candidates = uniq([
      ...(s.vercel_project_id ? await projectDomains(vercelToken, s.vercel_project_id) : []),
      s.vercel_deployment_url,
    ].filter(Boolean) as string[])

    const working = await firstWorking(candidates, 1)
    if (working) {
      await supabase.from('generated_sites').update({ demo_site_url: working }).eq('id', s.id)
      if (s.site_lead_id) {
        await supabase.from('site_leads').update({ demo_url: working }).eq('id', s.site_lead_id)
      }
      result.fixed++
    } else {
      await supabase.from('generated_sites').update({
        status: 'generated',
        error_message: 'Demo-URL svarade inte — behöver ny deploy.',
      }).eq('id', s.id)
      result.broken.push(s.id)
    }
  }

  return json({ ok: true, ...result })
}

// ---------------------------------------------------------------------------
// Vercel helpers
// ---------------------------------------------------------------------------
async function assignAlias(token: string, deploymentId: string, alias: string): Promise<boolean> {
  try {
    const resp = await fetch(`${VERCEL}/v2/deployments/${deploymentId}/aliases`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias }),
    })
    if (!resp.ok) console.warn('alias failed', alias, resp.status, (await resp.text()).slice(0, 200))
    return resp.ok
  } catch (e) {
    console.warn('alias error', e)
    return false
  }
}

async function projectDomains(token: string, projectId: string): Promise<string[]> {
  try {
    const resp = await fetch(`${VERCEL}/v9/projects/${projectId}/domains?limit=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) return []
    const data = await resp.json()
    const names: string[] = (data?.domains ?? [])
      .map((d: any) => d?.name)
      .filter((n: unknown): n is string => typeof n === 'string')
    // Shortest .vercel.app first — that's the pretty one.
    return names
      .filter((n) => n.endsWith('.vercel.app'))
      .sort((a, b) => a.length - b.length)
      .map((n) => `https://${n}`)
  } catch {
    return []
  }
}

async function disableProtection(token: string, projectId: string): Promise<void> {
  try {
    const resp = await fetch(`${VERCEL}/v9/projects/${projectId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ssoProtection: null, passwordProtection: null }),
    })
    if (!resp.ok) console.warn('Could not disable protection:', resp.status, (await resp.text()).slice(0, 200))
  } catch (e) {
    console.warn('protection patch failed', e)
  }
}

// ---------------------------------------------------------------------------
// URL verification
// ---------------------------------------------------------------------------
async function isUp(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { redirect: 'follow' })
    if (!resp.ok) { await resp.body?.cancel(); return false }
    const text = (await resp.text()).slice(0, 800)
    // Vercel serves its own 404/protection pages with a 200 in some edge cases.
    if (text.includes('DEPLOYMENT_NOT_FOUND') || text.includes('Authentication Required')) return false
    return true
  } catch {
    return false
  }
}

async function firstWorking(candidates: string[], attemptsPerUrl: number): Promise<string | null> {
  for (let attempt = 0; attempt < attemptsPerUrl; attempt++) {
    for (const url of candidates) {
      if (await isUp(url)) return url
    }
    if (attempt < attemptsPerUrl - 1) await new Promise((r) => setTimeout(r, 2000))
  }
  return null
}

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------
function slug(input: string, max: number): string {
  return input
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o')
    .replace(/\b(ab|hb|kb)\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
}

function trimName(name: string): string {
  return name.slice(0, 40).replace(/-+$/g, '')
}

function uniq(list: string[]): string[] {
  return [...new Set(list)]
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
