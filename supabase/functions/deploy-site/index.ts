// Deploys the generated HTML to Vercel as a static site.
// Uses Vercel's v13 deployments API with inline files — no GitHub repo needed.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Req { generated_site_id: string }
type VerifyResult = {
  ok: boolean
  status: number | null
  detail: string
  publicUrl?: string | null
}

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

async function verifyPublicDemoUrl(url: string) {
  try {
    const resp = await fetch(url, { method: 'GET', redirect: 'follow' })
    const body = (await resp.text().catch(() => '')).slice(0, 400).toLowerCase()
    if (resp.ok && !/deployment not found|not found/i.test(body)) {
      return { ok: true as const, status: resp.status, detail: body, publicUrl: url }
    }
    return { ok: false as const, status: resp.status, detail: body }
  } catch (err) {
    return { ok: false as const, status: null, detail: err instanceof Error ? err.message : String(err) }
  }
}

function withTeamScope(url: string, teamId?: string | null) {
  if (!teamId) return url
  const parsed = new URL(url)
  parsed.searchParams.set('teamId', teamId)
  return parsed.toString()
}

function deploymentApiUrl(path: string, teamId?: string | null) {
  return withTeamScope(`https://api.vercel.com${path}`, teamId)
}

function extractAliasStrings(payload: any): string[] {
  const out = new Set<string>()
  const push = (value: unknown) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed) return
    out.add(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
  }

  const lists = [
    payload?.alias,
    payload?.aliases,
    payload?.domains,
    payload?.data?.alias,
    payload?.data?.aliases,
    payload?.data?.domains,
  ]

  for (const list of lists) {
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item === 'string') push(item)
        else if (item && typeof item === 'object') {
          push((item as any).alias)
          push((item as any).domain)
          push((item as any).name)
        }
      }
    } else if (typeof list === 'string') {
      push(list)
    }
  }

  return Array.from(out)
}

async function resolvePublicDemoUrl(args: {
  vercelToken: string
  teamId?: string | null
  projectName: string
  deploymentId?: string | null
  deploymentUrl?: string | null
}): Promise<VerifyResult> {
  const { vercelToken, teamId, projectName, deploymentId, deploymentUrl } = args
  const attempts = [0, 2000, 5000, 10000, 15000, 25000]
  let lastStatus: number | null = null
  let lastDetail = ''
  let readyState = ''

  for (const waitMs of attempts) {
    if (waitMs > 0) await delay(waitMs)

    const candidates = new Set<string>([`https://${projectName}.vercel.app`])
    if (deploymentUrl) candidates.add(deploymentUrl)

    if (deploymentId) {
      try {
        const deploymentResp = await fetch(deploymentApiUrl(`/v13/deployments/${deploymentId}`, teamId), {
          headers: { Authorization: `Bearer ${vercelToken}` },
        })
        const deploymentData = await deploymentResp.json().catch(() => ({}))
        readyState = String(
          deploymentData?.readyState
          ?? deploymentData?.ready?.state
          ?? deploymentData?.state
          ?? '',
        )
        extractAliasStrings(deploymentData).forEach((alias) => candidates.add(alias))
      } catch (err) {
        lastDetail = err instanceof Error ? err.message : String(err)
      }

      try {
        const aliasResp = await fetch(deploymentApiUrl(`/v2/deployments/${deploymentId}/aliases`, teamId), {
          headers: { Authorization: `Bearer ${vercelToken}` },
        })
        const aliasData = await aliasResp.json().catch(() => ({}))
        extractAliasStrings(aliasData).forEach((alias) => candidates.add(alias))
      } catch (err) {
        lastDetail = err instanceof Error ? err.message : String(err)
      }
    }

    for (const candidate of candidates) {
      const verify = await verifyPublicDemoUrl(candidate)
      if (verify.ok) return verify
      lastStatus = verify.status
      lastDetail = verify.detail || lastDetail
    }
  }

  return {
    ok: false,
    status: lastStatus,
    detail: readyState
      ? `readyState=${readyState}; ${lastDetail}`.slice(0, 400)
      : lastDetail.slice(0, 400),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { generated_site_id }: Req = await req.json()
    if (!generated_site_id) return json({ error: 'generated_site_id required' }, 400)

    const vercelToken = Deno.env.get('VERCEL_API_TOKEN')
    if (!vercelToken) return json({ error: 'VERCEL_API_TOKEN missing' }, 500)
    const vercelTeamId = Deno.env.get('VERCEL_TEAM_ID')?.trim() || null

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: site, error: siteErr } = await supabase
      .from('generated_sites')
      .select('id, contact_id, site_lead_id, generated_files, vercel_project_id, vercel_deployment_url, status')
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
    const previousDeploymentUrl = typeof site.vercel_deployment_url === 'string' ? site.vercel_deployment_url : null

    let deployData: any = null
    let deploymentId: string | null = null
    let deploymentUrl: string | null = previousDeploymentUrl
    let projectId: string | null = site.vercel_project_id ?? null

    if (site.status !== 'deploying' || !previousDeploymentUrl) {
      await supabase.from('generated_sites').update({ status: 'deploying', error_message: null }).eq('id', generated_site_id)

      const deployResp = await fetch(deploymentApiUrl('/v13/deployments', vercelTeamId), {
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
      deployData = await deployResp.json()

      if (!deployResp.ok) {
        await supabase.from('generated_sites').update({
          status: 'failed',
          error_message: `Vercel deploy failed (${deployResp.status}): ${JSON.stringify(deployData).slice(0, 500)}`,
        }).eq('id', generated_site_id)
        return json({ error: 'vercel failed', details: deployData }, deployResp.status)
      }

      deploymentId = typeof deployData?.id === 'string' ? deployData.id : null
      deploymentUrl = deployData?.url ? `https://${deployData.url}` : null
      projectId = deployData?.projectId ?? projectId

      await supabase.from('generated_sites').update({
        status: 'deploying',
        vercel_project_id: projectId,
        vercel_deployment_url: deploymentUrl,
        error_message: null,
      }).eq('id', generated_site_id)
    } else {
      deploymentId = null
    }


    // Disable Vercel deployment protection (SSO/password) so the demo is publicly viewable.
    // Safe to call every deploy — idempotent.
    if (projectId) {
      try {
        const patchResp = await fetch(deploymentApiUrl(`/v9/projects/${projectId}`, vercelTeamId), {
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

    const verify = await resolvePublicDemoUrl({
      vercelToken,
      teamId: vercelTeamId,
      projectName,
      deploymentId,
      deploymentUrl,
    })
    if (!verify.ok) {
      const detail = `Public demo URL not ready yet (${verify.status ?? 'no-status'}): ${String(verify.detail ?? '').slice(0, 240)}`
      await supabase.from('generated_sites').update({
        status: 'deploying',
        vercel_project_id: projectId ?? site.vercel_project_id ?? null,
        vercel_deployment_url: deploymentUrl,
        demo_site_url: null,
        error_message: detail,
      }).eq('id', generated_site_id)
      return json({ ok: false, pending: true, error: detail, deployment: deploymentUrl }, 202)
    }

    await supabase.from('generated_sites').update({
      status: 'live',
      vercel_project_id: projectId ?? null,
      vercel_deployment_url: deploymentUrl,
      demo_site_url: verify.publicUrl ?? deploymentUrl,
      error_message: null,
    }).eq('id', generated_site_id)

    return json({ ok: true, url: verify.publicUrl ?? deploymentUrl, deployment: deploymentUrl })
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
