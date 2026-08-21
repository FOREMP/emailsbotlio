// Sets up (or re-checks) a tiny Vercel proxy project that serves the open
// tracking pixel from t.<sending domain>, so the pixel host matches the From
// domain. Idempotent — safe to call repeatedly.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROJECT_NAME = 'foremp-tracking'
const CNAME_TARGET = 'cname.vercel-dns.com'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function withTeam(url: string, teamId: string | null) {
  if (!teamId) return url
  const parsed = new URL(url)
  parsed.searchParams.set('teamId', teamId)
  return parsed.toString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Auth: must be a signed-in user of this project.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401)
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await authClient.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401)

  const vercelToken = Deno.env.get('VERCEL_API_TOKEN')?.trim()
  if (!vercelToken) return json({ error: 'VERCEL_API_TOKEN missing' }, 500)
  const teamId = Deno.env.get('VERCEL_TEAM_ID')?.trim() || null

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: domainRows, error: domainErr } = await supabase
    .from('sending_domains')
    .select('id, domain, tracking_host, is_active, is_verified')
    .eq('is_active', true)
    .eq('is_verified', true)
    .order('domain')

  if (domainErr) return json({ error: 'could not load domains', detail: domainErr.message }, 500)
  if (!domainRows?.length) return json({ error: 'no active verified sending domains' }, 400)

  const trackOpenUrl = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/track-open`

  const vercelFetch = (path: string, init: RequestInit = {}) =>
    fetch(withTeam(`https://api.vercel.com${path}`, teamId), {
      ...init,
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })

  // 1. Ensure the proxy project exists and has a deployment with the rewrites.
  let projectId: string | null = null
  const projectResp = await vercelFetch(`/v9/projects/${PROJECT_NAME}`)
  if (projectResp.ok) {
    const p = await projectResp.json()
    projectId = p?.id ?? null
  }

  let deployed = false
  if (!projectId) {
    const vercelConfig = {
      rewrites: [
        { source: '/o/:file', destination: `${trackOpenUrl}/o/:file` },
        { source: '/(.*)', destination: trackOpenUrl },
      ],
    }
    const deployResp = await vercelFetch('/v13/deployments', {
      method: 'POST',
      body: JSON.stringify({
        name: PROJECT_NAME,
        project: PROJECT_NAME,
        target: 'production',
        files: [
          { file: 'vercel.json', data: JSON.stringify(vercelConfig, null, 2) },
          { file: 'index.html', data: '<!doctype html><title>ok</title>' },
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
    const deployData = await deployResp.json().catch(() => ({}))
    if (!deployResp.ok) {
      return json({ error: 'vercel deploy failed', detail: deployData }, 502)
    }
    projectId = deployData?.projectId ?? null
    deployed = true

    // Make sure the proxy is publicly reachable (no SSO / password gate).
    if (projectId) {
      await vercelFetch(`/v9/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ ssoProtection: null, passwordProtection: null }),
      }).catch(() => undefined)
    }
  }

  // 2. Attach t.<domain> to the project and check verification.
  const results: any[] = []
  for (const row of domainRows) {
    const host = `t.${row.domain}`
    let verified = false
    let detail = ''

    const addResp = await vercelFetch(`/v10/projects/${PROJECT_NAME}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: host }),
    })
    const addData = await addResp.json().catch(() => ({}))
    if (addResp.ok) {
      verified = addData?.verified === true
    } else if (addData?.error?.code === 'domain_already_in_use' || addResp.status === 409) {
      detail = 'already attached'
    } else {
      detail = addData?.error?.message ?? `HTTP ${addResp.status}`
    }

    // Always re-read current state (also covers "already attached").
    const getResp = await vercelFetch(`/v9/projects/${PROJECT_NAME}/domains/${host}`)
    if (getResp.ok) {
      const d = await getResp.json().catch(() => ({}))
      verified = d?.verified === true
    }

    if (!verified) {
      // Nudge Vercel to re-check DNS.
      const verifyResp = await vercelFetch(`/v9/projects/${PROJECT_NAME}/domains/${host}/verify`, {
        method: 'POST',
      })
      if (verifyResp.ok) {
        const v = await verifyResp.json().catch(() => ({}))
        verified = v?.verified === true
      }
    }

    const trackingHost = `https://${host}`
    if (verified && row.tracking_host !== trackingHost) {
      await supabase
        .from('sending_domains')
        .update({ tracking_host: trackingHost })
        .eq('id', row.id)
    }

    results.push({
      domain: row.domain,
      tracking_host: trackingHost,
      verified,
      saved: verified,
      detail,
      dns: { type: 'CNAME', name: 't', value: CNAME_TARGET },
    })
  }

  return json({
    success: true,
    project: PROJECT_NAME,
    project_id: projectId,
    deployed_now: deployed,
    track_open_url: trackOpenUrl,
    results,
  })
})
