# Rensa 90 leads som fastnat i "auditing"

## Läget
90 leads står i status `auditing` och rör sig inte:

- 58 svenska, äldsta sedan 2 augusti
- 32 engelska, alla från 27 augusti
- Alla 90 har en `website` — de går alltså att auditera, de har bara aldrig blivit klara

Samtidigt finns **noll** leads i `pending_audit`, `needs_site` eller `needs_triage`. Pipelinen har inget att jobba med, och de här 90 är det enda som finns kvar innan du skrapar nytt.

Orsaken är att `auditOne` sätter status till `auditing` innan Firecrawl/AI-anropet. Om anropet timar ut eller funktionen slår i sin resursgräns skrivs status aldrig vidare, och inget i pipelinen plockar upp rader som blivit hängande — `process-site-leads` letar bara efter `pending_audit`.

## Vad som görs

**1. Återställ de fastnade raderna**
Engångsuppdatering: alla leads med status `auditing` som inte rörts på över 30 minuter sätts tillbaka till `pending_audit`. De hamnar då sist i audit-kön och plockas upp av nästa tick (3 per tick, var 10:e minut).

**2. Gör det självläkande**
Lägg till en återställning i reconcile-fasen i `process-site-leads`, samma ställe som redan städar döda bygg-jobb: varje tick sätts `auditing`-rader äldre än `STALE_AUDIT_MINUTES` (30 min) tillbaka till `pending_audit`. Då kan det aldrig byggas upp en hög igen.

**3. Räkna försök så inget loopar för evigt**
Om samma lead återställs upprepade gånger utan att bli klar markeras den `failed` efter tredje försöket, så en trasig sajt inte äter audit-kapacitet varje tick. Räknaren sparas i `audit_details`.

**4. Snabbare tömning av kön**
90 leads i 3 per tick tar ~5 timmar. Under upprensningen höjs `AUDIT_PER_TICK` från 3 till 6 — audits är billigare än bygg och detta ligger i en egen fas före generering, så bygg-budgeten påverkas inte.

## Teknisk detalj
- Engångs-SQL mot `site_leads` (status + `updated_at`-filter), ingen schemaändring
- `supabase/functions/process-site-leads/index.ts`: ny `recoverStuckAudits()` som anropas från reconcile-blocket, `STALE_AUDIT_MINUTES = 30`, `AUDIT_PER_TICK` 3 → 6, samt en försöksräknare i `audit_details.audit_attempts`
- Rapportobjektet får ett `audits_recovered`-fält så du ser i pipeline-svaret hur många som återställdes

## Inte med här
Lead-lagerpanel i UI, importfilter för rader utan e-post och ny nisch — separata plan när du vill ha dem. Notera att du fortfarande behöver skrapa nya leads: efter den här upprensningen är 90 stycken allt du har.
