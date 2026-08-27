# Varför du får AI-notisen — och hur vi byter ut det

## Kort svar
Systemet använder faktiskt Lovables inbyggda AI-gateway på flera ställen, inte bara OpenRouter/OpenAI. Det är därför notisen kommer. Firecrawl har inget med det att göra — den ligger på din egen nyckel.

## Vad som körs var idag (verifierat i koden)

Lovable AI-gateway (`ai.gateway.lovable.dev`, nyckel `LOVABLE_API_KEY`) — dessa drar Lovable-credits:
- `_shared/site-audit.ts` — bildbaserad hemsidesbedömning (Gemini 3 Flash Preview). Anropas av `audit-site` och `process-site-leads`.
- `process-site-leads/index.ts` — AI-klassificering av bransch/nisch.
- `process-site-jobs/index.ts` — mallväljare (`gpt-4o-mini`) samt ytterligare ett `gpt-4o-mini`-anrop.

Egna nycklar (inga Lovable-credits):
- `OPENROUTER_API_KEY` — själva sajtbygget (`process-site-jobs/freeform.ts`, `import-site-leads`).
- `OPENAI_API_KEY` — `generate-email`.
- `FIRECRAWL_API_KEY` — all scraping/screenshots (`scrape-lead-data`, `site-audit`).

Separat sak: `LOVABLE_API_KEY` används också för **utskick av mail** (`send-cold-email`) och webhooks (`handle-email-suppression`, `auth-email-hook`). Det är e-postleveransen, inte AI, och den ska inte röras.

## Firecrawl-nyckeln
Ja — den läses vid varje anrop via `Deno.env.get('FIRECRAWL_API_KEY')`. Byter du värdet i Supabase → Edge Functions → Secrets används den nya nyckeln direkt vid nästa körning. Ingen kodändring behövs.

## Förslag: flytta de fyra AI-anropen till OpenRouter
1. `_shared/site-audit.ts`: byt endpoint till OpenRouter, nyckel `OPENROUTER_API_KEY`, modell med bildstöd (t.ex. `google/gemini-2.5-flash`). Prompt, betygsskala och JSON-format oförändrade.
2. `process-site-leads`: klassificeringsanropet flyttas till OpenRouter med en billig textmodell.
3. `process-site-jobs`: mallväljaren och det andra `gpt-4o-mini`-anropet flyttas till OpenRouter (`openai/gpt-4o-mini` finns där).
4. Behåll `LOVABLE_API_KEY` för mailutskick och webhooks — rör inte den koden.
5. Deploya berörda funktioner och kör ett riktigt audit + en riktig sajtgenerering för att verifiera svar och betyg.

Resultat: noll AI-credits mot Lovable, all AI på din OpenRouter-faktura, mailutskicken fungerar som förut.

## Alternativ
Vill du hellre behålla Lovable-gatewayen för bildbedömningen (den är enkel och billig) kan vi flytta bara punkt 2 och 3. Säg till vilket du vill.
