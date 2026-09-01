export type PipelineProvider = 'firecrawl' | 'openrouter' | 'vercel'

export type PipelineBreaker = {
  provider: PipelineProvider
  is_paused: boolean
  error_code: string | null
  error_message: string | null
  error_count: number
  window_started_at: string | null
  last_error_at: string | null
  paused_at: string | null
}

export type PipelineFailure = {
  provider: PipelineProvider
  sourceFunction: string
  message: string
  httpStatus?: number | null
  siteLeadId?: string | null
  generatedSiteId?: string | null
  errorCode?: string
}

export function pipelineErrorCode(provider: PipelineProvider, status: number | null | undefined, message: string): string {
  const text = String(message || '').toLowerCase()
  if (status === 402 || /credit|credits|quota exceeded|insufficient balance|payment required/.test(text)) return 'credits_exhausted'
  if (status === 401 || /invalid api key|unauthorized|authentication failed|api key missing/.test(text)) return 'invalid_credentials'
  if (status === 403 || /forbidden|not authorized|permission/.test(text)) return 'permission_denied'
  if (status === 429 || /rate.?limit|too many requests/.test(text)) return 'rate_limited'
  if (/timed? out|timeout|aborterror/.test(text)) return 'timeout'
  if (/empty content|empty response/.test(text)) return 'empty_response'
  if (/invalid content json|invalid json|parse/.test(text)) return 'invalid_response'
  if (provider === 'vercel' && /deployment.*not found|deployment_not_found/.test(text)) return 'deployment_not_found'
  if ((status ?? 0) >= 500 || /unavailable|bad gateway|connection closed|network/.test(text)) return 'provider_unavailable'
  return 'request_failed'
}

export async function activePipelineBreakers(supabase: any): Promise<PipelineBreaker[]> {
  const { data, error } = await supabase
    .from('site_pipeline_breakers')
    .select('provider,is_paused,error_code,error_message,error_count,window_started_at,last_error_at,paused_at')
    .eq('is_paused', true)
  if (error) {
    console.error('pipeline breaker read failed', error)
    return []
  }
  return (data ?? []) as PipelineBreaker[]
}

export async function recordPipelineFailure(supabase: any, failure: PipelineFailure): Promise<{ errorCount: number; isPaused: boolean }> {
  const code = failure.errorCode || pipelineErrorCode(failure.provider, failure.httpStatus, failure.message)
  const { data, error } = await supabase.rpc('record_site_pipeline_failure', {
    p_provider: failure.provider,
    p_error_code: code,
    p_error_message: String(failure.message || 'Unknown provider error').slice(0, 1000),
    p_source_function: failure.sourceFunction,
    p_http_status: failure.httpStatus ?? null,
    p_site_lead_id: failure.siteLeadId ?? null,
    p_generated_site_id: failure.generatedSiteId ?? null,
  })
  if (error) {
    console.error('pipeline failure recording failed', error)
    return { errorCount: 0, isPaused: false }
  }
  const row = Array.isArray(data) ? data[0] : data
  return { errorCount: Number(row?.error_count ?? 0), isPaused: Boolean(row?.is_paused) }
}

export function pipelinePausedPayload(breakers: PipelineBreaker[]) {
  return {
    ok: false,
    paused: true,
    error: 'Website creation is paused after repeated provider failures.',
    providers: breakers.map((row) => ({
      provider: row.provider,
      error_code: row.error_code,
      error_count: row.error_count,
      paused_at: row.paused_at,
    })),
  }
}

