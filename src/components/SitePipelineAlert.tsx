import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Play } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

type Provider = 'firecrawl' | 'openrouter' | 'vercel'
type Breaker = {
  provider: Provider
  error_code: string | null
  error_message: string | null
  error_count: number
  paused_at: string | null
}

const PROVIDERS: Record<Provider, { label: string; purpose: string }> = {
  firecrawl: { label: 'Firecrawl', purpose: 'hämtning av företagets nuvarande webbplats' },
  openrouter: { label: 'OpenRouter', purpose: 'AI-generering av webbplatsen' },
  vercel: { label: 'Vercel', purpose: 'publicering av den färdiga webbplatsen' },
}

function reason(row: Breaker) {
  if (row.error_code === 'credits_exhausted') return `Krediter eller saldo saknas hos ${PROVIDERS[row.provider].label}.`
  if (row.error_code === 'invalid_credentials') return `API-nyckeln för ${PROVIDERS[row.provider].label} saknas eller accepteras inte.`
  if (row.error_code === 'permission_denied') return `${PROVIDERS[row.provider].label} nekade åtkomst för den anslutna nyckeln.`
  if (row.error_code === 'rate_limited') return `${PROVIDERS[row.provider].label} har nått sin tillfälliga hastighetsgräns.`
  if (row.error_code === 'deployment_not_found') return 'Vercel kunde inte hitta den skapade deploymenten.'
  if (row.error_code === 'timeout') return `${PROVIDERS[row.provider].label} svarade för långsamt flera gånger.`
  return `${PROVIDERS[row.provider].label} gav samma fel flera gånger.`
}

export default function SitePipelineAlert() {
  const query = useQuery({
    queryKey: ['site-pipeline-breakers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('site_pipeline_breakers')
        .select('provider,error_code,error_message,error_count,paused_at')
        .eq('is_paused', true)
        .order('paused_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Breaker[]
    },
    refetchInterval: 30_000,
  })

  const resume = async (provider: Provider) => {
    const { error } = await supabase.functions.invoke('resume-site-pipeline', { body: { provider } })
    if (error) {
      toast.error(`Kunde inte starta igen: ${error.message}`)
      return
    }
    toast.success('Webbplatskön har startats igen')
    await query.refetch()
  }

  if (!query.data?.length) return null

  return (
    <div className="container mx-auto px-4 pt-4 space-y-3" role="alert" aria-live="assertive">
      {query.data.map((row) => (
        <div key={row.provider} className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3 min-w-0">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold">Webbplatsbygget är pausat – {PROVIDERS[row.provider].label}</p>
              <p className="text-sm text-muted-foreground">
                {reason(row)} Systemet stoppade efter {row.error_count} likadana fel inom två timmar under {PROVIDERS[row.provider].purpose}.
              </p>
              {row.error_message && <p className="text-xs text-muted-foreground mt-1 break-words">Senaste fel: {row.error_message}</p>}
            </div>
          </div>
          <Button variant="outline" className="shrink-0" disabled={query.isFetching} onClick={() => resume(row.provider)}>
            {query.isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Ignorera och starta igen
          </Button>
        </div>
      ))}
    </div>
  )
}

