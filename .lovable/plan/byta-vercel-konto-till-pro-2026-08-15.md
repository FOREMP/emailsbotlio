# Byta Vercel-konto (till Pro)

## Kan koden hantera det? Ja — med två små justeringar

Verifierat i koden:

- All Vercel-kommunikation sker i `supabase/functions/deploy-site/index.ts` och använder en enda hemlighet: `VERCEL_API_TOKEN`. Ingen kontonyckel, team-id eller projekt-id är hårdkodad.
- Deploy sker via `POST https://api.vercel.com/v13/deployments` med filerna inline, plus en `PATCH /v9/projects/<id>` för att stänga av deployment protection. Båda funkar identiskt mot ett nytt konto.
- URL:en byggs som `https://demo-<företag>-<8 tecken av site-id>.vercel.app` och verifieras med riktiga HTTP-anrop innan status sätts till `live`, så fel konto/URL upptäcks direkt istället för att skicka en död länk.

Två saker som behöver ändras för ett nytt konto:

1. **Team-scope.** Pro-konton är ofta ett Team. Om token är en personlig token måste anropen skicka med `?teamId=<id>` (eller `?slug=<team>`), annars hamnar deployen i fel scope eller nekas. Enklast: skapa token direkt under teamet — då behövs ingen kodändring. Vi lägger ändå in valfri `VERCEL_TEAM_ID` som stöd så det inte kan bli fel.
2. **Slug-filtret `-foremp.vercel.app`.** Tre ställen (`send-cold-email`, `process-site-leads`, `SiteApprovals.tsx`) avvisar URL:er som slutar på `-foremp.vercel.app` (gamla team-scopade adresser). Med nytt konto blir suffixet ett annat. Filtret generaliseras till "avvisa URL:er som inte matchar vårt `demo-...`-mönster" istället för ett hårdkodat kontonamn.

## Fungerar gamla hemsidor kvar?

Ja — men bara så länge gamla kontot finns kvar och projekten inte raderas. Deployerna ligger fysiskt i det gamla kontot; länkarna i redan skickade mail pekar dit och påverkas inte av att vi byter token. Byt alltså token, men radera inte det gamla kontot/projekten (annars 404:ar allt utskickat).

Notera: en site som redan är deployad i gamla kontot kan inte redeployas till samma `.vercel.app`-namn från nya kontot (namnet är globalt upptaget). Nya siter är opåverkade eftersom namnet innehåller site-id.

## Så byter du API-nyckel

Kontot behöver inte vara Pro idag — uppgradering senare (vid ~200 sajter) inom samma team kräver ingen kodändring alls, bara högre gräns.

1. Logga in på det nya Vercel-kontot/teamet.
2. **Account Settings → Tokens** (eller **Team Settings → Tokens**). Skapa token med scope satt till det team som ska äga sajterna, giltighet "No expiration".
3. Kopiera värdet — det visas bara en gång.
4. Jag öppnar det säkra formuläret direkt efter implementationen där du klistrar in `VERCEL_API_TOKEN` (ersätter det gamla) och valfritt `VERCEL_TEAM_ID`. Nyckeln lagras krypterat, aldrig i koden.
5. Jag kör en testdeploy på en ny site och bekräftar att den blir `live` och svarar 200.

## Teknisk sammanfattning

- `supabase/functions/deploy-site/index.ts`: läs valfri `VERCEL_TEAM_ID` och lägg på som query-param på båda Vercel-anropen.
- `supabase/functions/send-cold-email/index.ts`, `supabase/functions/process-site-leads/index.ts`, `src/pages/SiteApprovals.tsx`: byt hårdkodad `-foremp.vercel.app`-koll mot generellt mönster.
- Hemligheten `VERCEL_API_TOKEN` uppdateras (och ev. `VERCEL_TEAM_ID` läggs till). Ingen databasändring, inget mailinnehåll rörs.
