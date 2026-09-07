const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export type AiProvider = 'nvidia' | 'openrouter'

export type RoutedAiResult = {
  data: any
  provider: AiProvider
  model: string
}

type RoutedAiArgs = {
  supabase: any
  nvidiaModel: string
  openrouterModel: string
  body: Record<string, unknown>
  timeoutMs?: number
  title?: string
  requireJsonObject?: boolean
  /** Used by deterministic callers/tests that must bypass the dashboard choice. */
  preferredProvider?: AiProvider
}

export async function resolveAiProvider(supabase: any): Promise<AiProvider> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'ai_primary_provider')
    .maybeSingle()
  if (error) console.warn('AI provider setting lookup failed; using OpenRouter:', error.message)
  return (data?.value as any)?.provider === 'nvidia' ? 'nvidia' : 'openrouter'
}

/**
 * Calls the dashboard-selected provider. NVIDIA is allowed to fail safely:
 * missing credentials, timeouts, 429s and provider errors fall back to the
 * existing OpenRouter model. OpenRouter mode deliberately stays OpenRouter-only.
 */
export async function callRoutedChat(args: RoutedAiArgs): Promise<RoutedAiResult> {
  const preferred = args.preferredProvider ?? await resolveAiProvider(args.supabase)
  const order: AiProvider[] = preferred === 'nvidia' ? ['nvidia', 'openrouter'] : ['openrouter']
  const errors: string[] = []

  for (const provider of order) {
    const key = provider === 'nvidia'
      ? Deno.env.get('NVIDIA_API_KEY')
      : Deno.env.get('OPENROUTER_API_KEY')
    if (!key) {
      errors.push(`${provider}: API key missing`)
      continue
    }

    const model = provider === 'nvidia' ? args.nvidiaModel : args.openrouterModel
    try {
      if (provider === 'nvidia') await claimNvidiaSlot(args.supabase)
      const data = await request(provider, key, model, args.body, args.timeoutMs ?? 60_000, args.title)
      if (args.requireJsonObject && !hasJsonObject(data)) {
        throw new Error('model returned invalid or empty JSON content')
      }
      return { data, provider, model }
    } catch (error) {
      const message = (error as Error).message
      errors.push(`${provider}/${model}: ${message}`)
      console.warn(`AI provider attempt failed (${provider}/${model}); ${provider === 'nvidia' ? 'trying fallback' : 'no further provider'}: ${message}`)
    }
  }

  throw new Error(`AI request failed: ${errors.join(' | ')}`)
}

function hasJsonObject(data: any): boolean {
  const content = data?.choices?.[0]?.message?.content
  const text = Array.isArray(content)
    ? content.map((part: any) => part?.text || '').join('')
    : String(content || '')
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  if (!cleaned) return false
  try {
    const parsed = JSON.parse(cleaned)
    return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed)
  } catch {
    return false
  }
}

async function claimNvidiaSlot(supabase: any): Promise<void> {
  // The database claim is shared by every Edge Function and every runtime
  // instance. An in-memory counter would allow each instance to send 40 rpm.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.rpc('claim_nvidia_api_slot', { p_limit: 40 })
    if (error) throw new Error(`NVIDIA limiter unavailable: ${error.message}`)
    const waitMs = Math.max(0, Number(data ?? 0))
    if (waitMs === 0) return
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs + 75, 61_000)))
  }
  throw new Error('NVIDIA limiter could not obtain a request slot')
}

async function request(
  provider: AiProvider,
  key: string,
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  title = 'Botlio AI',
): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const requestBody: Record<string, unknown> = { ...body, model }
    if (provider === 'nvidia') {
      // NVIDIA NIM's current hosted schemas do not advertise OpenAI's
      // response_format field. The prompts already require strict JSON, so
      // remove it instead of turning every NVIDIA call into a 422 + fallback.
      delete requestBody.response_format
      if (model.startsWith('deepseek-ai/')) requestBody.reasoning_effort = 'none'
      if (model.startsWith('qwen/')) requestBody.chat_template_kwargs = { enable_thinking: false }
    }
    const response = await fetch(provider === 'nvidia' ? NVIDIA_URL : OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: provider === 'nvidia'
        ? { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
        : {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://emailsbotlio.lovable.app',
            'X-Title': title,
          },
      body: JSON.stringify(requestBody),
    })
    const raw = await response.text()
    if (!response.ok) throw new Error(`${response.status}: ${raw.slice(0, 400)}`)
    // Some NIMs may acknowledge a long-running request with 202. Our current
    // Edge jobs are synchronous, so fall back rather than treating a requestId
    // as empty model output and saving a false audit/generation result.
    if (response.status !== 200) throw new Error(`${response.status}: asynchronous result not available in this worker`)
    try { return JSON.parse(raw) } catch { throw new Error(`invalid JSON response: ${raw.slice(0, 240)}`) }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
