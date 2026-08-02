// Worker: claims one queued generated_sites row and generates HTML.
// Invoked by pg_cron every minute and fired-and-forgotten by generate-site
// after enqueue. Conditional UPDATE claims a row atomically — safe against
// concurrent invocations. Retries capped at MAX_ATTEMPTS via `attempts`.
// Stuck-row reaper: also flips 'processing' rows older than 10 min back to 'failed'.
//
// Niche-aware: `generated_sites.template` decides which industry copy/labels/
// stock images/fallbacks are used. Adding a niche = extend NICHE_CONFIG.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
// Fast model for the content plan. DeepSeek V3.1 was frequently queued on
// OpenRouter for 60s+, which is what killed most generations.
const MODEL = 'openai/gpt-4.1-mini'
const POLISH_MODEL = 'openai/gpt-4.1-mini'
// When plan + polish use the same model we merge them into ONE call — the
// second round-trip roughly doubled wall time for no measurable gain.
const SKIP_POLISH = MODEL === POLISH_MODEL
const MAX_ATTEMPTS = 3
const STUCK_MINUTES = 10

const CURRENT_YEAR = new Date().getFullYear()

interface ServiceItem { name: string; description: string; when?: string }
interface ValueItem { title: string; text: string }
interface FaqItem { question: string; answer: string }
interface PathwayItem { eyebrow: string; title: string; description: string; ctaLabel?: string }
interface DifferentiatorItem { title: string; text: string }
interface ScenarioItem { category: string; title: string; description: string; delivery: string }
interface ProcessStep { title: string; description: string; outcome?: string }
interface SitePlan {
  businessName?: string
  // Business profile: what the AI concluded the company ACTUALLY does, used to
  // re-label the niche template so a nail studio/spa under the salon tag doesn't
  // get hair-specific wording.
  businessType?: string        // "Nagelsalong", "Hudvårdsklinik", "Frisörsalong"
  venueNoun?: string           // definite form: "studion", "kliniken", "salongen"
  serviceNoun?: string         // "behandling"
  serviceNounPlural?: string   // "behandlingar"
  staffNoun?: string           // "nageltekniker", "frisörer", "terapeuter"
  tagline?: string
  heroEyebrow?: string
  heroLine1?: string
  heroLine2?: string
  heroSubline?: string
  trustBadges?: string[]
  pathwaysIntro?: string
  pathways?: PathwayItem[]
  services?: ServiceItem[]
  aboutTitle?: string
  aboutIntro?: string
  aboutBefore?: string
  aboutDuring?: string
  aboutAfter?: string
  differentiators?: DifferentiatorItem[]
  scenarios?: ScenarioItem[]
  processSteps?: ProcessStep[]
  values?: ValueItem[]
  faqs?: FaqItem[]
  ctaTitle?: string
  ctaText?: string
}

// ---------------------------------------------------------------------------
// Niche config: switches copy, labels, fallbacks and image source per template.
// Add a new niche by adding another key here and mapping its template in
// nicheFromTemplate() below.
// ---------------------------------------------------------------------------
interface NicheConfig {
  key: 'auto_workshop' | 'hair_salon'
  label: string                        // "Bilverkstad" | "Frisörsalong"
  aboutPageTitle: string               // "Om verkstaden" | "Om salongen"
  aboutShort: string                   // "verkstaden" | "salongen"
  metaDescSuffix: string
  systemPromptTopic: string
  serviceLabel: string                 // "Tjänst" | "Behandling"
  serviceLabelPlural: string           // "Tjänster" | "Behandlingar"
  useLeadImages: boolean               // false → only curated Unsplash
  stockImages: string[]
  heroLine1Default: (city: string) => string
  heroLine2Default: string
  heroEyebrowDefault: (city: string) => string
  heroSublineDefault: string
  aboutTitleDefault: string
  aboutEyebrow: string
  pathwaysHeading: string
  scenariosHeading: string
  scenariosIntro: string
  processHeading: string
  diffHeading: string
  ctaTitleDefault: string
  ctaTextDefault: string
  contactHeadline: string
  contactSubline: string
  servicesPageSub: string
  footerTagline: string
  fallbackServices: ServiceItem[]
  fallbackValues: ValueItem[]
  fallbackFaqs: FaqItem[]
  fallbackPathways: PathwayItem[]
  systemPrompt: string
  polishSystemPrompt: string
}

const NICHE_CONFIG: Record<'auto_workshop' | 'hair_salon', NicheConfig> = {
  auto_workshop: {
    key: 'auto_workshop',
    label: 'Bilverkstad',
    aboutPageTitle: 'Om verkstaden',
    aboutShort: 'verkstaden',
    metaDescSuffix: 'bilverkstad',
    systemPromptTopic: 'bilverkstadssajter',
    serviceLabel: 'Tjänst',
    serviceLabelPlural: 'Tjänster',
    useLeadImages: true,
    stockImages: [
      'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=1600&q=80',
      'https://images.unsplash.com/photo-1625047509168-a7026f36de04?w=1600&q=80',
      'https://images.unsplash.com/photo-1632823471565-1ecdf5c6d7f4?w=1200&q=80',
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1600&q=80',
      'https://images.unsplash.com/photo-1580273916550-e323be2ae537?w=1200&q=80',
      'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=1200&q=80',
      'https://images.unsplash.com/photo-1493031440916-e69b7a91be16?w=1200&q=80',
      'https://images.unsplash.com/photo-1552930294-3af53b58f61c?w=1200&q=80',
    ],
    heroLine1Default: (city) => `Din bilverkstad${city ? ' i ' + city : ''}.`,
    heroLine2Default: 'Vi bygger trygghet, inte gissningar.',
    heroEyebrowDefault: (city) => city ? `Bilverkstad i ${city}` : 'Bilverkstad',
    heroSublineDefault: 'Auktoriserad kunskap kring service, felsökning, bromsar och däck. Raka beslutsunderlag och en smidig upplevelse från första kontakt till färdig bil.',
    aboutTitleDefault: 'Förtroende byggs i verkstaden — inte med en checklista',
    aboutEyebrow: 'Yrkesstolthet',
    pathwaysHeading: 'Rätt hjälp från start — så att du slipper gissa',
    scenariosHeading: 'Verkliga exempel på hur vi löser problem',
    scenariosIntro: 'Så här jobbar vi bakom kulisserna. Se vad vi granskar, hur vi resonerar och varför yrkesstolthet lönar sig.',
    processHeading: 'Tre steg mot ett tryggare bilägande',
    diffHeading: 'Fyra saker du känner innan bilen ens rullar in',
    ctaTitleDefault: 'Välj rätt väg för din bil — boka direkt eller läs mer',
    ctaTextDefault: 'Oavsett vad din bil behöver guidar vi dig till rätt tjänst och säkerställer ett professionellt omhändertagande.',
    contactHeadline: 'Ta nästa steg',
    contactSubline: 'Boka service, fråga om felsökning eller beskriv vad bilen behöver hjälp med.',
    servicesPageSub: 'Varje tjänst är tydligt beskriven för att hjälpa dig förstå när den passar och vad som ingår.',
    footerTagline: 'Demo skapad för en modernare digital kundupplevelse.',
    fallbackServices: [
      { name: 'Service och underhåll', description: 'Regelbunden service och kontroll för att bilen ska kännas trygg i vardagen.' },
      { name: 'Felsökning', description: 'Systematisk genomgång när bilen varnar, låter annorlunda eller inte fungerar som den ska.' },
      { name: 'Reparationer', description: 'Åtgärder och reparationer med fokus på tydlig kommunikation genom hela arbetet.' },
      { name: 'Bromsar och säkerhet', description: 'Kontroll och åtgärd av viktiga slitdelar för säkrare körning.' },
    ],
    fallbackValues: [
      { title: 'Tydlighet', text: 'Kunden ska förstå vad som görs och varför.' },
      { title: 'Noggrannhet', text: 'Varje uppdrag behandlas metodiskt och professionellt.' },
      { title: 'Trygg service', text: 'Målet är en enklare verkstadsupplevelse från första kontakt.' },
    ],
    fallbackFaqs: [
      { question: 'Hur bokar jag tid?', answer: 'Kontakta verkstaden via telefon eller kontaktuppgifterna på sidan.' },
      { question: 'Kan ni felsöka bilen först?', answer: 'Ja, felsökning är ofta första steget när problemet inte är helt tydligt.' },
      { question: 'Får jag veta vad som behöver göras?', answer: 'En bra verkstadsupplevelse bygger på tydlig information innan arbetet går vidare.' },
      { question: 'Arbetar ni med vanliga servicejobb?', answer: 'Ja, sidan presenterar både service, felsökning och reparationer utan att ange påhittade priser.' },
    ],
    fallbackPathways: [
      { eyebrow: 'PLANERAT BESÖK', title: 'Starta med bilservice', description: 'När det är dags för ordinarie service eller kontroll inför en längre resa.', ctaLabel: 'Starta med service' },
      { eyebrow: 'OSÄKER FELBILD', title: 'Boka felsökning', description: 'När bilen varnar, låter annorlunda eller beter sig konstigt utan att du vet varför.', ctaLabel: 'Boka felsökning' },
      { eyebrow: 'SÄKERHET FÖRST', title: 'Boka bromskontroll', description: 'När bromsarna känns ojämna, låter eller helt enkelt behöver en säkerhetsgenomgång.', ctaLabel: 'Boka bromskontroll' },
      { eyebrow: 'SÄSONG & KOMFORT', title: 'Boka klimatsystem', description: 'När AC:n tappat effekt eller inför säsongsbyte då komfort och sikt blir avgörande.', ctaLabel: 'Boka klimat' },
    ],
    systemPrompt: `Du är en senior svensk copywriter och art director för PREMIUM bilverkstadssajter i klass med de bästa nordiska SaaS- och bilmärkessajter. Ton: modernt, självsäkert, editoriellt. Bygg förtroende via TYDLIGHET och YRKESSTOLTHET — inte genom siffror eller påhittade certifikat.

VIKTIGT: Skriv INTE HTML. Returnera bara giltig JSON enligt schemat nedan. HTML byggs av systemet.

RETURFORMAT — endast JSON, ingen markdown, inga kommentarer:
{
  "businessName": "...",
  "tagline": "kort premium tagline",
  "heroEyebrow": "kort label, t.ex. 'Bilverkstad i {ort}' eller kategori",
  "heroLine1": "första raden av rubriken (3–6 ord, editoriell känsla)",
  "heroLine2": "andra raden (3–7 ord, kontrast/löfte, t.ex. 'Vi bygger trygghet, inte gissningar.')",
  "heroSubline": "1–2 meningar som förklarar värdet konkret",
  "trustBadges": ["Garanti på allt arbete", "Tydliga underlag", "Personlig service"],
  "pathwaysIntro": "1 mening om att guida kunden rätt in",
  "pathways": [
    {"eyebrow":"PLANERAT BESÖK","title":"Starta med bilservice","description":"...","ctaLabel":"Starta med service"},
    {"eyebrow":"OSÄKER FELBILD","title":"Boka felsökning","description":"...","ctaLabel":"Boka felsökning"},
    {"eyebrow":"SÄKERHET FÖRST","title":"Boka bromskontroll","description":"...","ctaLabel":"Boka bromskontroll"},
    {"eyebrow":"SÄSONG & KOMFORT","title":"Boka klimatsystem","description":"...","ctaLabel":"Boka klimat"}
  ],
  "services": [{"name":"...","description":"...","when":"'När:' — kort rad om när kunden ska välja den"}],
  "aboutTitle": "editoriell rubrik, gärna 2 rader",
  "aboutIntro": "1 stark manifest-mening",
  "aboutBefore": "stycke om FÖRE besöket",
  "aboutDuring": "stycke om UNDER arbetet",
  "aboutAfter": "stycke om EFTER",
  "differentiators": [
    {"title":"Tydlig offert innan större beslut","text":"..."},
    {"title":"All expertis samlad under ett tak","text":"..."},
    {"title":"Smidig kontakt på dina villkor","text":"..."},
    {"title":"Verklig kvalitet, inte bara ord","text":"..."}
  ],
  "scenarios": [
    {"category":"Service","title":"Servicegenomgång inför längre körning","description":"...","delivery":"..."},
    {"category":"Diagnostik","title":"När varningslampan tänds men felet inte är självklart","description":"...","delivery":"..."},
    {"category":"Bromsar","title":"Bromsar som känns ojämna eller låter","description":"...","delivery":"..."}
  ],
  "processSteps": [
    {"title":"Beskriv behovet","description":"...","outcome":"..."},
    {"title":"Vi ger dig en tydlig plan","description":"...","outcome":"..."},
    {"title":"Raka rör, inga överraskningar","description":"...","outcome":"..."}
  ],
  "values": [{"title":"...","text":"..."}],
  "faqs": [{"question":"...","answer":"..."}],
  "ctaTitle": "kort rubrik för sista CTA-bandet",
  "ctaText": "1 mening som får kunden att ta nästa steg"
}

ABSOLUTA REGLER:
1. Hitta ALDRIG på adresser, telefon, priser, öppettider, årtal, statistik, certifieringar, kundnamn eller citat.
2. "scenarios" = TYPISKA situationer — inte påhittade referensuppdrag. Skriv aldrig kundnamn.
3. Om ett fält saknar grund, utelämna det.
4. Om business_name saknas eller ser ut som HTTP-fel/domän utan namn, returnera {"error":"invalid business name"}.
5. Extrahera 4–7 verkliga tjänster. Vid oklarhet: standard bilverkstadskategorier utan pris.
6. Language = svenska. Ton = editoriell, konkret, självsäker.
7. heroLine1 + heroLine2 = premium headline tillsammans.
8. Max 4500 tokens totalt.`,
    polishSystemPrompt: `Du är en senior svensk copywriter för premium bilverkstadssajter.

Skriv om ALLA textfält i det medskickade JSON-objektet till naturlig, flytande svenska av hög kvalitet. Ton: modernt, självsäkert, editoriellt.

ABSOLUTA REGLER:
1. Behåll EXAKT samma JSON-struktur, samma nycklar, samma antal element i arrays.
2. Hitta ALDRIG på nya fakta (adresser, telefon, priser, årtal, certifieringar, kundnamn).
3. Fixa styltiga meningar, konstig ordföljd, saknad interpunktion, för långa meningar, upprepningar, klichéer.
4. Varje textblock ska ha varierad meningslängd. Undvik att alla meningar börjar med "Vi".
5. heroLine1 + heroLine2 = korta, slagkraftiga rader (3–7 ord vardera) med punkt i slutet.
6. Om ett fält är tomt — låt det vara tomt.
7. Svara med ENBART det uppdaterade JSON-objektet.`,
  },
  hair_salon: {
    key: 'hair_salon',
    label: 'Frisörsalong',
    aboutPageTitle: 'Om salongen',
    aboutShort: 'salongen',
    metaDescSuffix: 'frisörsalong',
    systemPromptTopic: 'frisörsalongssajter',
    serviceLabel: 'Behandling',
    serviceLabelPlural: 'Behandlingar',
    useLeadImages: false, // Skip lead-scraped images — too much risk of broken/blocked thumbnails
    stockImages: [
      // Curated Unsplash — premium salon interiors first (used as hero via img(0)),
      // then styling / color / editorial beauty shots for gallery slots.
      // Deliberately avoid barber / workshop-coded imagery.
      'https://images.unsplash.com/photo-1633681926022-84c23e8cb2d6?w=1600&q=80', // wide bright salon interior
      'https://images.unsplash.com/photo-1521490878406-b748d926a1d3?w=1600&q=80', // modern salon chairs
      'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=1600&q=80',    // stylist at chair
      'https://images.unsplash.com/photo-1610384104075-e05c8cf200c3?w=1600&q=80', // salon washing station
      'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1600&q=80', // color / balayage
      'https://images.unsplash.com/photo-1580618672591-eb180b1a973f?w=1600&q=80', // scissors + hands
      'https://images.unsplash.com/photo-1595475207225-428b62bda831?w=1600&q=80', // hairdresser detail
      'https://images.unsplash.com/photo-1519415943484-9fa1873496d4?w=1600&q=80', // blow-dry
      'https://images.unsplash.com/photo-1562322140-8baeececf3df?w=1600&q=80',    // product flatlay
      'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=1600&q=80', // styled portrait
      'https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?w=1600&q=80', // hair color close-up
      'https://images.unsplash.com/photo-1515377905703-c4788e51af15?w=1600&q=80', // soft beauty portrait
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=1600&q=80', // premium editorial portrait
      'https://images.unsplash.com/photo-1633681926035-ec1ac984418a?w=1600&q=80', // modern interior detail
    ],
    heroLine1Default: (city) => `Personligt hårhantverk${city ? ' i ' + city : ''}.`,
    heroLine2Default: 'Form, färg och känsla i balans.',
    heroEyebrowDefault: (city) => city ? `Frisörsalong i ${city}` : 'Frisörsalong',
    heroSublineDefault: 'För dig som vill känna dig lika rätt i spegeln veckan efter som när du lämnar stolen. Klippning, färg och styling med lugn rådgivning och ett säkert handlag.',
    aboutTitleDefault: 'Ett salongsbesök ska kännas genomtänkt',
    aboutEyebrow: 'Hantverk & känsla',
    pathwaysHeading: 'Välj din väg in i salongen',
    scenariosHeading: 'Tre typer av besök vi formar varje vecka',
    scenariosIntro: 'Här ser du hur vi tänker kring form, färg och helhetskänsla när olika behov möter stolen.',
    processHeading: 'Så blir känslan rätt hela vägen',
    diffHeading: 'Det som gör upplevelsen mer genomarbetad',
    ctaTitleDefault: 'Boka en tid som känns värd att längta till',
    ctaTextDefault: 'Berätta vad du vill förändra, förfina eller förstärka så leder vi dig till rätt behandling från start.',
    contactHeadline: 'Boka din tid',
    contactSubline: 'Ring eller mejla oss — vi hjälper dig hitta rätt behandling och tid som passar.',
    servicesPageSub: 'Varje behandling presenteras med en tydlig känsla för när den passar, vad som ingår och vilket resultat du kan sikta mot.',
    footerTagline: 'Demo skapad för en mer premium salongsupplevelse.',
    fallbackServices: [
      { name: 'Klippning', description: 'En klippning som tar hänsyn till hårets fall, din vardag och hur formen ska kännas även mellan besöken.' },
      { name: 'Färgning', description: 'Färg med djup, glans och balans — anpassad för att lyfta helheten utan att kompromissa med hårets kvalitet.' },
      { name: 'Slingor & balayage', description: 'Mjukare ljusspel och mer dimension genom handmålade partier som känns levande snarare än hårda.' },
      { name: 'Styling & uppsättning', description: 'Genomarbetad styling inför fest, fotografering eller en dag då allt behöver sitta precis rätt.' },
    ],
    fallbackValues: [
      { title: 'Personlig konsultation', text: 'Vi lyssnar innan vi klipper — varje behandling börjar med en dialog.' },
      { title: 'Skonsam teknik', text: 'Vi väljer produkter och metoder som tar hand om håret på lång sikt.' },
      { title: 'Hantverk hela vägen', text: 'Varje detalj görs på riktigt, inte på autopilot.' },
    ],
    fallbackFaqs: [
      { question: 'Hur bokar jag tid?', answer: 'Kontakta salongen via telefon eller kontaktuppgifterna på sidan.' },
      { question: 'Får jag en konsultation innan?', answer: 'Ja, varje behandling börjar med en kort dialog så att resultatet blir det du önskar.' },
      { question: 'Passar era färgtekniker även skört hår?', answer: 'Absolut. Vi väljer skonsammare produkter och tekniker efter hårets skick.' },
      { question: 'Kan jag boka styling inför en händelse?', answer: 'Ja, vi tar gärna hand om styling och uppsättning inför bröllop, fest och fotografering.' },
    ],
    fallbackPathways: [
      { eyebrow: 'NY FORM', title: 'Boka klippning', description: 'När du vill att håret ska falla bättre, kännas lättare att bära och hålla formen längre.', ctaLabel: 'Boka klippning' },
      { eyebrow: 'FÄRG & TON', title: 'Boka färgning', description: 'För dig som vill fördjupa tonen, bli mjukare i uttrycket eller ge håret ny lyster.', ctaLabel: 'Boka färg' },
      { eyebrow: 'LJUS & DIMENSION', title: 'Boka slingor eller balayage', description: 'När du söker mer rörelse, mjukare övergångar och ett resultat som känns naturligt levande.', ctaLabel: 'Boka slingor' },
      { eyebrow: 'INFÖR NÅGOT VIKTIGT', title: 'Boka uppsättning eller styling', description: 'När håret behöver kännas lika genomarbetat som resten av dagen du gör dig i ordning för.', ctaLabel: 'Boka styling' },
    ],
    systemPrompt: `Du är en senior svensk copywriter och art director för PREMIUM frisörsalongssajter i klass med de bästa nordiska varumärkena inom hår och beauty. Ton: modernt, självsäkert, editoriellt, taktilt och diskret exklusivt. Bygg förtroende via HANTVERK, PERSONLIG RÅDGIVNING och KÄNSLA — inte genom siffror eller påhittade certifikat.

Sajten ska kännas dyr, personlig och genomarbetad även när underlaget är tunt. När fakta är få ska du skriva med selektiv skärpa och värme, aldrig med generiskt fluff eller tomma påståenden.

VIKTIGT: Skriv INTE HTML. Returnera bara giltig JSON enligt schemat nedan. HTML byggs av systemet.

RETURFORMAT — endast JSON, ingen markdown, inga kommentarer:
{
  "businessName": "...",
  "businessType": "vad verksamheten FAKTISKT är, ett svenskt substantiv, t.ex. 'Frisörsalong', 'Nagelsalong', 'Hudvårdsklinik', 'Massage & spa', 'Barbershop'",
  "venueNoun": "bestämd form av lokalen, t.ex. 'salongen', 'studion', 'kliniken'",
  "serviceNoun": "vad ett besök kallas i singular, t.ex. 'behandling', 'klippning', 'tid'",
  "serviceNounPlural": "plural av ovanstående, t.ex. 'behandlingar'",
  "staffNoun": "vad personalen kallas i plural, t.ex. 'frisörer', 'nageltekniker', 'hudterapeuter'",
  "tagline": "kort premium tagline, 3–7 ord",
  "heroEyebrow": "kort label, t.ex. '{businessType} i {ort}'",
  "heroLine1": "första raden (3–6 ord, editoriell)",
  "heroLine2": "andra raden (3–7 ord, kontrast/löfte)",
  "heroSubline": "2 meningar som förklarar värdet konkret och känns skrivna för just salongen",
  "trustBadges": ["Personlig konsultation", "Skonsam teknik", "Hantverk hela vägen"],
  "pathwaysIntro": "1 mening om att guida kunden rätt in, varm och tydlig",
  "pathways": [
    {"eyebrow":"NY LOOK","title":"Boka klippning","description":"...","ctaLabel":"Boka klippning"},
    {"eyebrow":"FÄRG & TON","title":"Boka färgning","description":"...","ctaLabel":"Boka färg"},
    {"eyebrow":"LJUSARE HÅR","title":"Boka slingor / balayage","description":"...","ctaLabel":"Boka slingor"},
    {"eyebrow":"HÄNDELSER","title":"Boka uppsättning","description":"...","ctaLabel":"Boka styling"}
  ],
  "services": [{"name":"...","description":"1–2 meningar om vad behandlingen är och varför den känns värd att boka","when":"'När:' — kort rad om när kunden ska välja den"}],
  "aboutTitle": "editoriell rubrik, gärna 2 rader",
  "aboutIntro": "1–2 meningar med tydlig hållning och känsla",
  "aboutBefore": "stycke om FÖRE besöket (konsultation, förväntningar)",
  "aboutDuring": "stycke om UNDER behandlingen (hantverk, teknik, känsla)",
  "aboutAfter": "stycke om EFTER (hemvård, resultat som håller)",
  "differentiators": [
    {"title":"Personlig konsultation innan varje behandling","text":"..."},
    {"title":"Skonsamma produkter och tekniker","text":"..."},
    {"title":"Hantverk från erfarna frisörer","text":"..."},
    {"title":"Resultat som håller mellan besöken","text":"..."}
  ],
  "scenarios": [
    {"category":"Klippning","title":"Klippning som håller formen till nästa besök","description":"...","delivery":"..."},
    {"category":"Färg","title":"Ny färg inför en viktig händelse — utan att skada håret","description":"...","delivery":"..."},
    {"category":"Rådgivning","title":"Råd för hår som känns tunt eller livlöst","description":"...","delivery":"..."}
  ],
  "processSteps": [
    {"title":"Konsultation","description":"...","outcome":"..."},
    {"title":"Behandling med hantverk","description":"...","outcome":"..."},
    {"title":"Styling och hemvård","description":"...","outcome":"..."}
  ],
  "values": [{"title":"...","text":"..."}],
  "faqs": [{"question":"...","answer":"..."}],
  "ctaTitle": "kort rubrik för sista CTA-bandet",
  "ctaText": "1–2 meningar som får kunden att boka utan att låta säljig"
}

STEG 0 — AVGÖR VERKSAMHETEN INNAN DU SKRIVER:
Läs källdatan (titel, beskrivning, kategori, tjänster, om-text) och avgör vad företaget FAKTISKT gör. Alla leads i den här mallen är inte frisörsalonger — det kan lika gärna vara nagelsalong, hudvård, massage, spa, fransar/bryn, barbershop eller en kombination. Sätt businessType/venueNoun/serviceNoun/staffNoun efter det du faktiskt ser, och skriv sedan ALL copy för DEN verksamheten. Använd aldrig hår-, klipp- eller färgspråk om företaget inte gör hår. Om källdatan är tvetydig: välj den bredare formuleringen ("behandling", "besök") i stället för att gissa hårspecifikt.

ABSOLUTA REGLER:
1. Hitta ALDRIG på adresser, telefon, priser, öppettider, årtal, statistik, certifieringar, kundnamn eller citat.
2. "scenarios" = TYPISKA besök verksamheten tar emot — inte påhittade referenser. Skriv aldrig kundnamn.
3. Om ett fält saknar grund, utelämna det.
4. Om business_name saknas eller ser ut som HTTP-fel/domän utan namn, returnera {"error":"invalid business name"}.
5. Extrahera 4–7 verkliga tjänster/behandlingar från källdatan. Vid oklarhet: branschstandard för DEN verksamhetstyp du identifierat i steg 0, utan pris.
6. Language = svenska. Ton = editoriell, taktil, självsäker — undvik "vi erbjuder marknadens bästa".
7. heroLine1 + heroLine2 = premium headline tillsammans.
8. Undvik generiska ord som "professionell", "hög kvalitet" och "marknadsledande" om de inte följs av konkret mening.
9. Skriv hellre tät, egen copy än långa stycken som bara fyller ut.
10. Undvik barber-, barbershop- och maskulint clipper-språk om inte källdatan tydligt visar att det är just den typen av salong.
11. Alla rubriker, pathways, tjänster, FAQ och CTA måste matcha businessType — inga hårrelaterade ord för en verksamhet som inte gör hår.
11. Max 4500 tokens totalt.`,
    polishSystemPrompt: `Du är en senior svensk copywriter för premium frisörsalongssajter.

Skriv om ALLA textfält i det medskickade JSON-objektet till naturlig, flytande svenska av hög kvalitet. Ton: modernt, självsäkert, editoriellt, taktilt.

ABSOLUTA REGLER:
1. Behåll EXAKT samma JSON-struktur, samma nycklar, samma antal element i arrays.
2. Hitta ALDRIG på nya fakta (adresser, telefon, priser, årtal, certifieringar, kundnamn).
3. Fixa styltiga meningar, konstig ordföljd, saknad interpunktion, för långa meningar, upprepningar, klichéer.
4. Varje textblock ska ha varierad meningslängd. Undvik att alla meningar börjar med "Vi".
5. heroLine1 + heroLine2 = korta, slagkraftiga rader (3–7 ord vardera) med punkt i slutet.
6. Byt ut generiska fraser som "professionell", "hög kvalitet" och "vi erbjuder" mot mer konkret, egen och taktil svenska när fakta tillåter det.
7. Om ett fält är tomt — låt det vara tomt.
8. Svara med ENBART det uppdaterade JSON-objektet.`,
  },
}

function nicheFromTemplate(template: string | null | undefined, hints: Array<unknown> = []): NicheConfig {
  const joined = hints
    .filter((v) => v != null)
    .map((v) => String(v).toLowerCase())
    .join(' ')
  const looksSalon = /hair|hairdresser|hair\s*salon|fris[öo]r|frisörsalong|salong|barber|barbershop|fade|klipp|beauty|sk[öo]nhet|nail|hudv[åa]rd|spa|lashes|brow|laser hair/.test(joined)

  if (template === 'hair_salon_v1' || looksSalon) return NICHE_CONFIG.hair_salon
  return NICHE_CONFIG.auto_workshop
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/**
 * Re-label a niche config using the business profile the AI derived from the
 * source data. Keeps the same visual template but swaps hair-salon vocabulary
 * for whatever the company actually is (nail studio, skin clinic, spa, ...).
 */
function adaptNicheConfig(nc: NicheConfig, plan: SitePlan): NicheConfig {
  if (nc.key !== 'hair_salon') return nc
  const type = (plan.businessType || '').trim()
  const venue = (plan.venueNoun || '').trim().toLowerCase()
  const service = (plan.serviceNoun || '').trim().toLowerCase()
  const servicePl = (plan.serviceNounPlural || '').trim().toLowerCase()
  const staff = (plan.staffNoun || '').trim().toLowerCase()
  if (!type && !venue && !service) return nc
  const isHair = /fris[öo]r|hair|barber/i.test(type)
  if (isHair && !venue && !service) return nc

  const pairs: Array<[RegExp, string]> = []
  if (type) {
    pairs.push([/Frisörsalong/g, cap(type)], [/frisörsalong/g, type.toLowerCase()])
  }
  if (venue) {
    pairs.push([/salongsbesök/g, `besök hos ${venue}`], [/Salongsbesök/g, `Besök hos ${venue}`])
    pairs.push([/salongen/g, venue], [/Salongen/g, cap(venue)])
    pairs.push([/salongs/g, venue.replace(/(en|n)$/, '') + 's'])
  }
  if (servicePl) {
    pairs.push([/behandlingar/g, servicePl], [/Behandlingar/g, cap(servicePl)])
  }
  if (service) {
    pairs.push([/behandlingen/g, service + 'en'], [/behandling/g, service], [/Behandling/g, cap(service)])
  }
  if (staff) {
    pairs.push([/frisörer/g, staff], [/Frisörer/g, cap(staff)])
  }

  const t = (v: string): string => {
    let out = v
    for (const [re, rep] of pairs) out = out.replace(re, rep)
    return out
  }
  const tItems = <T extends Record<string, any>>(items: T[]): T[] =>
    items.map((it) => {
      const copy: any = { ...it }
      for (const k of Object.keys(copy)) if (typeof copy[k] === 'string') copy[k] = t(copy[k])
      return copy as T
    })

  return {
    ...nc,
    label: type ? cap(type) : nc.label,
    metaDescSuffix: type ? type.toLowerCase() : nc.metaDescSuffix,
    aboutPageTitle: venue ? `Om ${venue}` : nc.aboutPageTitle,
    aboutShort: venue || nc.aboutShort,
    serviceLabel: service ? cap(service) : nc.serviceLabel,
    serviceLabelPlural: servicePl ? cap(servicePl) : t(nc.serviceLabelPlural),
    heroLine1Default: (city: string) => t(nc.heroLine1Default(city)),
    heroLine2Default: t(nc.heroLine2Default),
    heroEyebrowDefault: (city: string) =>
      type ? (city ? `${cap(type)} i ${city}` : cap(type)) : nc.heroEyebrowDefault(city),
    heroSublineDefault: t(nc.heroSublineDefault),
    aboutTitleDefault: t(nc.aboutTitleDefault),
    aboutEyebrow: t(nc.aboutEyebrow),
    pathwaysHeading: t(nc.pathwaysHeading),
    scenariosHeading: t(nc.scenariosHeading),
    scenariosIntro: t(nc.scenariosIntro),
    processHeading: t(nc.processHeading),
    diffHeading: t(nc.diffHeading),
    ctaTitleDefault: t(nc.ctaTitleDefault),
    ctaTextDefault: t(nc.ctaTextDefault),
    contactHeadline: t(nc.contactHeadline),
    contactSubline: t(nc.contactSubline),
    servicesPageSub: t(nc.servicesPageSub),
    footerTagline: t(nc.footerTagline),
    fallbackServices: tItems(nc.fallbackServices),
    fallbackValues: tItems(nc.fallbackValues),
    fallbackFaqs: tItems(nc.fallbackFaqs),
    fallbackPathways: tItems(nc.fallbackPathways),
    polishSystemPrompt: type
      ? nc.polishSystemPrompt.replace(
          /premium frisörsalongssajter/,
          `premium ${type.toLowerCase()}-sajter`,
        ) + `\n9. Verksamheten är en ${type.toLowerCase()}. All text måste passa den verksamheten — inga hårrelaterade ord om det inte är en frisörverksamhet.`
      : nc.polishSystemPrompt,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const openrouterKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!openrouterKey) return json({ error: 'OPENROUTER_API_KEY missing' }, 500)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Reap 'processing' rows older than STUCK_MINUTES (worker died mid-run)
    const stuckCutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString()
    await supabase
      .from('generated_sites')
      .update({
        status: 'failed',
        error_message: `Worker died mid-generation (>${STUCK_MINUTES} min in processing). Click Generate to retry.`,
      })
      .eq('status', 'processing')
      .lt('updated_at', stuckCutoff)

    // 2. Optional targeted id from generate-site kick, else oldest queued
    let targetId: string | null = null
    try {
      if (req.method === 'POST') {
        const body = await req.json().catch(() => ({}))
        if (typeof body?.generated_site_id === 'string') targetId = body.generated_site_id
      }
    } catch (_) { /* ignore */ }

    // 3. Find one queued row
    const findQuery = supabase
      .from('generated_sites')
      .select('id')
      .eq('status', 'queued')
      .order('queued_at', { ascending: true })
      .limit(1)
    if (targetId) findQuery.eq('id', targetId)
    const { data: candidates, error: findErr } = await findQuery
    if (findErr) return json({ error: `find failed: ${findErr.message}` }, 500)
    if (!candidates?.length) return json({ ok: true, message: 'no queued jobs' })

    const generated_site_id = candidates[0].id

    // 4. Atomically claim: only succeeds if row is still 'queued' (race-safe)
    const { data: claimed, error: claimErr } = await supabase
      .from('generated_sites')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', generated_site_id)
      .eq('status', 'queued')
      .select('id, contact_id, site_lead_id, source_url, scraped_content, template, attempts')
      .maybeSingle()
    if (claimErr || !claimed) return json({ ok: true, message: 'lost race, another worker claimed it' })

    const site = claimed as any

    const nextAttempts = (site.attempts ?? 0) + 1
    await supabase.from('generated_sites').update({ attempts: nextAttempts }).eq('id', generated_site_id)

    if (!site.scraped_content) {
      const msg = 'no scraped_content — run scrape first'
      await supabase.from('generated_sites').update({ status: 'failed', error_message: msg }).eq('id', generated_site_id)
      return json({ error: msg }, 400)
    }

    const scraped = site.scraped_content as any
    const pages = scraped.pages ?? {}
    const homeMd: string = pages.home?.markdown ?? scraped.markdown ?? ''
    if (!homeMd || homeMd.trim().length < 300) {
      const msg = 'scraped_content is empty or too short — re-run scrape on a working source_url'
      await supabase.from('generated_sites').update({ status: 'failed', error_message: msg }).eq('id', generated_site_id)
      return json({ error: msg }, 422)
    }

    const { data: contact } = await supabase
      .from('contacts')
      .select('first_name, last_name, email, custom_fields')
      .eq('id', site.contact_id)
      .single()

    const cf = (contact?.custom_fields ?? {}) as Record<string, unknown>
    const siteLeadId = typeof site.site_lead_id === 'string'
      ? site.site_lead_id
      : typeof cf.__site_lead_id === 'string'
        ? cf.__site_lead_id
        : null
    const { data: siteLead } = siteLeadId
      ? await supabase
        .from('site_leads')
        .select('niche, category, company_name')
        .eq('id', siteLeadId)
        .maybeSingle()
      : { data: null }

    const nc = nicheFromTemplate(site.template, [
      siteLead?.niche,
      siteLead?.category,
      siteLead?.company_name,
      cf.niche,
      cf.category,
      cf.company,
    ])

    if (site.template !== `${nc.key === 'hair_salon' ? 'hair_salon' : 'auto_workshop'}_v1`) {
      await supabase
        .from('generated_sites')
        .update({ template: `${nc.key === 'hair_salon' ? 'hair_salon' : 'auto_workshop'}_v1` })
        .eq('id', generated_site_id)
    }

    const branding = scraped.branding ?? {}


    // Niche-specific visual defaults. Preserve scraped brand colors when present,
    // but never let a salon with incomplete branding inherit the auto-shop palette.
    const bc = branding.colors ?? {}
    const paletteDefaults = nc.key === 'hair_salon'
      ? {
          primary: '#9a5f6a',
          secondary: '#c7a78a',
          accent: '#d6b98c',
          background: '#f7f2ed',
          surface: '#fffaf6',
          textPrimary: '#2d2525',
          textSecondary: '#766a67',
        }
      : {
          primary: '#f97316',
          secondary: '#0ea5e9',
          accent: '#f59e0b',
          background: '#0a0e1a',
          surface: '#131a2b',
          textPrimary: '#f1f5f9',
          textSecondary: '#94a3b8',
        }
    // Derive the real brand hue from everything Firecrawl saw (button fills,
    // primary/accent/link, pale brand tints) instead of trusting bc.primary,
    // which is often the browser default link blue.
    const derived = deriveBrandColors(branding, paletteDefaults)
    const brandPalette = buildAccessiblePalette({
      primary: derived.primary || bc.primary || paletteDefaults.primary,
      secondary: derived.secondary || paletteDefaults.secondary,
      accent: derived.accent || paletteDefaults.accent,
      background: derived.background || paletteDefaults.background,
      surface: derived.surface || paletteDefaults.surface,
      textPrimary: derived.textPrimary || paletteDefaults.textPrimary,
      textSecondary: derived.textSecondary || paletteDefaults.textSecondary,
    }, paletteDefaults)

    const brandFonts = Array.isArray(branding.fonts)
      ? branding.fonts.map((f: any) => (typeof f === 'string' ? f : f?.family)).filter(Boolean).slice(0, 4)
      : []
    const hasRealBranding = !!branding.colors

    // Extra manual assets from user
    const extraImages: string[] = Array.isArray(cf.extra_images) ? (cf.extra_images as string[]).filter(Boolean) : []
    const googleMapsUrl: string | null = typeof cf.google_maps_url === 'string' ? cf.google_maps_url : null

    // Real images from the lead's own site (their domain)
    const scrapedImages: string[] = Array.isArray(scraped.images) ? scraped.images.slice(0, 8) : []

    // Case-insensitive lookup across all custom_fields keys
    const cfLookup = (patterns: RegExp[]): string | null => {
      for (const [k, v] of Object.entries(cf)) {
        if (v == null || v === '') continue
        const key = k.toLowerCase().replace(/[\s_-]/g, '')
        if (patterns.some((p) => p.test(key))) {
          const s = String(v).trim()
          if (s && !/^(null|undefined|n\/a|-)$/i.test(s)) return s
        }
      }
      return null
    }

    const phoneFromCf = cfLookup([/^phone/, /^tel/, /telefon/, /mobil/, /number/])
    const addressFromCf = cfLookup([/address/, /adress/, /gata/, /street/])
    const cityFromCf = cfLookup([/^city$/, /^ort$/, /stad/, /kommun/, /postort/])
    const emailFromCf = cfLookup([/^email/, /epost/, /^mail/])

    const facts = {
      business_name: (cf.company ?? siteLead?.company_name ?? pages.home?.title ?? scraped.title ?? '').toString().trim() || null,
      phone: phoneFromCf,
      address: addressFromCf,
      city: cityFromCf,
      email: contact?.email ?? emailFromCf ?? null,
      source_url: site.source_url,
      has_real_branding: hasRealBranding,
      google_maps_url: googleMapsUrl,
      niche: nc.key,
    }

    // Image pool priority depends on niche:
    //   auto_workshop → user extras > scraped from own site > curated Unsplash
    //   hair_salon    → curated Unsplash ONLY (avoid broken/blocked thumbs)
    const imagePool = nc.useLeadImages
      ? [...extraImages, ...scrapedImages, ...nc.stockImages].slice(0, 12)
      : [...nc.stockImages].slice(0, 12)

    // Only include screenshot when lead images are allowed for this niche.
    // For hair salons we skip design-inspo from screenshots too (their sites are
    // typically low quality and just confuse the plan).
    const screenshotUrl: string | null = nc.useLeadImages ? (scraped.screenshot_url ?? null) : null

    // Regen feedback: injected when the user clicks "Regenerera" on /site-approvals
    const regenFeedback = typeof cf.regen_feedback === 'string' && cf.regen_feedback.trim()
      ? String(cf.regen_feedback).trim()
      : null

    const userTextParts = [
      `Skapa en kompakt innehållsplan för en 3-sidig premium-sajt. Utgångspunkt: ${nc.label.toLowerCase()}, men LÄS källdatan först och skriv för det verksamheten FAKTISKT gör. Skriv ENDAST JSON enligt schemat.`,
      siteLead?.category ? `Kategori enligt lead-datan: ${siteLead.category}` : '',
      '',
      regenFeedback
        ? `--- ANVÄNDARENS FEEDBACK FÖR REGENERERING (HÖGSTA PRIORITET) ---\n${regenFeedback}\n`
        : '',
      'FAKTA (endast detta — hitta aldrig på siffror, adresser eller årtal):',
      JSON.stringify(facts, null, 2),
      '',
      '--- KÄLLDATA: HEM-SIDAN ---',
      `Titel: ${pages.home?.title || scraped.title || ''}`,
      `Beskrivning: ${pages.home?.description || scraped.description || ''}`,
      `Sammanfattning: ${pages.home?.summary || scraped.summary || ''}`,
      'Markdown (första 1800 tecken):',
      (pages.home?.markdown || homeMd).slice(0, 1800),
      '',
      `--- KÄLLDATA: OM-OSS-SIDAN ${pages.about ? `(${pages.about.url})` : '(hittades ej)'} ---`,
      pages.about
        ? `Titel: ${pages.about.title}\nMarkdown (första 1400 tecken):\n${pages.about.markdown.slice(0, 1400)}`
        : '[Ingen separat about-sida. Använd HEM-sidans markdown. Inga påhittade fakta.]',
      '',
      `--- KÄLLDATA: TJÄNSTER-SIDAN ${pages.services ? `(${pages.services.url})` : '(hittades ej)'} ---`,
      pages.services
        ? `Titel: ${pages.services.title}\nMarkdown (första 1800 tecken):\n${pages.services.markdown.slice(0, 1800)}`
        : '[Ingen separat tjänster-sida. Extrahera från HEM-sidans markdown. Om oklart, använd branschstandard utan påhittade priser.]',
      '',
      screenshotUrl
        ? 'BIFOGAD BILD nedan = skärmdump av deras nuvarande hemsida. Använd som STIL-INSPO för färgkänsla, men gör en NYARE, BÄTTRE version.'
        : '[Ingen skärmdump används.]',
      '',
      'Returnera BARA JSON-objektet med innehållsplanen, inte HTML.',
    ].filter(Boolean).join('\n')

    // Multimodal: DeepSeek V3.1 is text-only, so we don't attach images at all today.
    const chosenModel = MODEL
    const supportsVision = /claude|gpt-4|gpt-5|gemini|llama-.*vision|qwen.*vl/i.test(chosenModel)
    const userContent: any[] = [{ type: 'text', text: userTextParts }]
    if (screenshotUrl && supportsVision) {
      userContent.push({ type: 'image_url', image_url: { url: screenshotUrl } })
    }

    // Run AI work synchronously. Background waitUntil has proven unreliable for
    // this long-running job in Supabase Edge.
    const runGeneration = async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 75_000)
      // Heartbeat while the model is thinking, so the reaper never marks a
      // still-running job as "worker died".
      const heartbeat = setInterval(() => {
        supabase.from('generated_sites')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', generated_site_id)
          .then(() => {}, () => {})
      }, 60_000)
      try {
        const systemPrompt = SKIP_POLISH
          ? `${nc.systemPrompt}\n\n--- SPRÅKKRAV (skriv färdig, publicerbar copy direkt) ---\n${nc.polishSystemPrompt}`
          : nc.systemPrompt
        const aiResp = await fetch(OPENROUTER_URL, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${openrouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://emailsbotlio.lovable.app',
            'X-Title': 'Botlio Site Generator',
          },
          body: JSON.stringify({
            model: chosenModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            temperature: 0.6,
            max_tokens: 5000,
            response_format: { type: 'json_object' },
          }),
        })
        clearTimeout(timeoutId)

        if (!aiResp.ok) {
          const errText = await aiResp.text()
          const msg = `OpenRouter failed (${aiResp.status}): ${errText.slice(0, 400)}`
          await failOrRetry(supabase, generated_site_id, nextAttempts, msg)
          return
        }

        const aiData = await aiResp.json()
        const raw: string = aiData.choices?.[0]?.message?.content ?? ''
        const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim()

        let parsed: (SitePlan & { error?: string }) | null = null
        try { parsed = JSON.parse(cleaned) } catch (_) { parsed = null }

        if (!parsed || parsed.error) {
          const msg = parsed?.error === 'invalid business name'
            ? 'AI rejected this row: invalid business name. Re-run audit/scrape with a working URL.'
            : `AI returned invalid content JSON. Preview: ${cleaned.slice(0, 400)}`
          if (parsed?.error === 'invalid business name') {
            await supabase.from('generated_sites').update({ status: 'failed', error_message: msg }).eq('id', generated_site_id)
          } else {
            await failOrRetry(supabase, generated_site_id, nextAttempts, msg)
          }
          return
        }

        // Re-label the template with the business profile the model derived, so a
        // non-hair business under the salon tag gets matching wording everywhere.
        const ncFinal = adaptNicheConfig(nc, parsed)

        const polished = SKIP_POLISH
          ? parsed
          : await polishCopyWithClaude({
              plan: parsed,
              facts,
              openrouterKey,
              nc: ncFinal,
            }).catch((e) => {
              console.warn('copy polish failed, using plan as-is:', (e as Error).message)
              return parsed!
            })


        const files = buildSiteFiles({
          plan: polished,
          facts,
          brandPalette,
          brandFonts,
          imagePool,
          googleMapsUrl,
          nc: ncFinal,
        })

        await supabase.from('generated_sites').update({
          status: 'generated',
          error_message: null,
          generated_files: files,
          updated_at: new Date().toISOString(),
        }).eq('id', generated_site_id)
      } catch (err) {
        clearTimeout(timeoutId)
        const msg = (err as Error).name === 'AbortError'
          ? 'Timed out after 60s — model took too long.'
          : `Error: ${(err as Error).message}`
        console.error('generate error', err)
        await failOrRetry(supabase, generated_site_id, nextAttempts, msg)
      }
    }

    await runGeneration()
    return json({ ok: true, status: 'generated', model: chosenModel, niche: nc.key })

  } catch (err) {
    console.error('generate-site error', err)
    return json({ error: (err as Error).message }, 500)
  }
})

// ---------------------------------------------------------------------------
// Copy polish: rewrites the plan in natural Swedish. Structure preserved.
// ---------------------------------------------------------------------------
async function polishCopyWithClaude(args: {
  plan: SitePlan
  facts: Record<string, unknown>
  openrouterKey: string
  nc: NicheConfig
}): Promise<SitePlan> {
  const { plan, facts, openrouterKey, nc } = args

  const user = `FAKTA (påhittad information är förbjuden — håll dig till dessa):
${JSON.stringify(facts, null, 2)}

INNEHÅLLSPLAN ATT SKRIVA OM (behåll struktur, förbättra bara språket):
${JSON.stringify(plan, null, 2)}

Returnera samma JSON med förbättrad svensk copy.`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 45_000)
  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://emailsbotlio.lovable.app',
        'X-Title': 'Botlio Site Copy Polish',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4.1-mini',
        messages: [
          { role: 'system', content: nc.polishSystemPrompt },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    })
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`polish ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
    const data = await resp.json()
    const raw: string = data.choices?.[0]?.message?.content ?? ''
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const polished = JSON.parse(cleaned) as SitePlan
    return { ...plan, ...polished }
  } finally {
    clearTimeout(timeoutId)
  }
}

function buildSiteFiles({
  plan,
  facts,
  brandPalette,
  brandFonts,
  imagePool,
  googleMapsUrl,
  nc,
}: {
  plan: SitePlan
  facts: Record<string, unknown>
  brandPalette: Record<string, string>
  brandFonts: string[]
  imagePool: string[]
  googleMapsUrl: string | null
  nc: NicheConfig
}): Record<string, string> {
  const businessName = cleanText(plan.businessName || String(facts.business_name || '')) || nc.label
  const phone = cleanText(String(facts.phone || ''))
  const email = cleanText(String(facts.email || ''))
  const address = [facts.address, facts.city].map((v) => cleanText(String(v || ''))).filter(Boolean).join(', ')
  const city = cleanText(String(facts.city || ''))
  const services = normalizeServices(plan.services, nc)
  const values = normalizeValues(plan.values, nc)
  const faqs = normalizeFaqs(plan.faqs, nc)
  const pathways = normalizePathways(plan.pathways, nc)
  const differentiators = normalizeDifferentiators(plan.differentiators)
  const scenarios = normalizeScenarios(plan.scenarios)
  const processSteps = normalizeProcess(plan.processSteps)
  const isSalon = nc.key === 'hair_salon'
  const trustBadgeSource = (plan.trustBadges || []).map(cleanText).filter(Boolean)
  const trustBadges = (trustBadgeSource.length
    ? trustBadgeSource
    : values.map((v) => cleanText(v.title)).filter(Boolean)
  ).slice(0, 3)
  const images = imagePool.filter((url) => /^https?:\/\//i.test(url)).slice(0, 10)
  const img = (i: number) => images[i % Math.max(images.length, 1)] || nc.stockImages[0]
  const hasContact = Boolean(phone || email || address)
  const primaryHref = phone ? `tel:${phone.replace(/\s+/g, '')}` : email ? `mailto:${email}` : null
  const primaryLabel = phone ? 'Ring nu' : email ? 'Mejla oss' : null
  const bookLabel = 'Boka tid'
  const displayFont = brandFonts[0] || (isSalon ? 'Cormorant Garamond' : 'Space Grotesk')
  const bodyFont = isSalon ? 'Manrope' : 'Inter'
  const nicheStyles = isSalon ? `
    .theme-salon{--font-body:Manrope,sans-serif}
    .theme-salon{background:
      radial-gradient(circle at top right,color-mix(in srgb,var(--accent) 18%,transparent),transparent 34%),
      linear-gradient(180deg,#fbf4ee 0%,var(--bg) 24%,var(--bg) 100%)}
    .theme-salon .nav{background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(18px);border-bottom-color:color-mix(in srgb,var(--primary) 12%,transparent)}
    .theme-salon .brand{font-family:var(--font-display);font-size:28px;font-weight:600;letter-spacing:.01em}
    .theme-salon .links a{border-radius:999px;font-weight:600}
    .theme-salon .links a.active,.theme-salon .links a:hover{background:color-mix(in srgb,var(--primary) 10%,transparent)}
    .theme-salon .nav-cta{color:var(--on-primary)!important;border-radius:999px;box-shadow:0 14px 38px color-mix(in srgb,var(--primary) 24%,transparent)}
    .theme-salon .section{padding:84px 28px}
    .theme-salon .section-sm{padding:64px 28px}
    .theme-salon .eyebrow{border:0;background:transparent;padding:0;border-radius:0;letter-spacing:.28em;margin-bottom:18px}
    .theme-salon .h1,.theme-salon .h2,.theme-salon .h3{letter-spacing:-.01em}
    .theme-salon .h1{font-size:clamp(44px,6.3vw,82px);font-weight:600;line-height:.96}
    .theme-salon .h1 .accent{font-style:italic;font-weight:500;color:var(--primary)}
    .theme-salon .h2{font-size:clamp(30px,4vw,56px);max-width:14ch}
    .theme-salon .lead{font-size:17px;line-height:1.8;max-width:60ch}
    .theme-salon .lead.lg{font-size:18px}
    .theme-salon .btn{border-radius:999px;padding:15px 27px}
    .theme-salon .btn.primary{color:var(--on-primary);box-shadow:0 14px 34px color-mix(in srgb,var(--primary) 22%,transparent)}
    .theme-salon .hero{min-height:72vh;padding:74px 28px 48px}
    .theme-salon .hero>img{filter:brightness(.84) saturate(.74)}
    .theme-salon .hero:after{background:linear-gradient(90deg,color-mix(in srgb,var(--bg) 96%,transparent) 0%,color-mix(in srgb,var(--bg) 84%,transparent) 42%,color-mix(in srgb,var(--bg) 18%,transparent) 100%)}
    .theme-salon .hero-inner{display:grid;grid-template-columns:minmax(0,1.15fr) 360px;gap:42px;align-items:end}
    .theme-salon .trust-row{gap:12px;margin-top:28px}
    .theme-salon .trust-row span{padding:10px 14px;border-radius:999px;background:color-mix(in srgb,var(--surface) 86%,transparent);border:1px solid color-mix(in srgb,var(--primary) 16%,transparent);color:var(--text)}
    .theme-salon .trust-row span:before{display:none}
    .theme-salon .card{border-radius:28px;box-shadow:0 18px 55px color-mix(in srgb,var(--text) 8%,transparent);background:color-mix(in srgb,var(--surface) 92%,var(--bg))}
    .theme-salon .card:hover{transform:translateY(-2px)}
    .theme-salon .path-card{border-top:0}
    .theme-salon .band{background:linear-gradient(145deg,color-mix(in srgb,var(--surface) 95%,var(--bg)),color-mix(in srgb,var(--accent) 10%,var(--bg)))}
    .theme-salon .band-tight{background:linear-gradient(180deg,color-mix(in srgb,var(--surface) 88%,var(--bg)),color-mix(in srgb,var(--surface) 96%,var(--bg)))}
    .theme-salon .page-hero{text-align:left;padding:116px 28px 70px}
    .theme-salon .page-hero .h1{margin:0!important;max-width:12ch}
    .theme-salon .page-hero .lead{margin:22px 0 0!important}
    .theme-salon .page-hero>img{opacity:.2}
    .theme-salon .photo,.theme-salon .service-row img{border-radius:28px;box-shadow:0 24px 70px color-mix(in srgb,var(--text) 12%,transparent)}
    .theme-salon .service-row{gap:40px;padding:56px 0}
    .theme-salon .service-row img{height:420px}
    .theme-salon .service-row h2{font-size:clamp(28px,3.4vw,44px)}
    .theme-salon .service-row .when{border-radius:20px;background:color-mix(in srgb,var(--primary) 8%,var(--surface));border-color:color-mix(in srgb,var(--primary) 18%,transparent)}
    .theme-salon .scenario{border-radius:28px;box-shadow:0 16px 45px color-mix(in srgb,var(--text) 8%,transparent);background:color-mix(in srgb,var(--surface) 94%,var(--bg))}
    .theme-salon .scenario img{height:250px}
    .theme-salon .scenario .tag{margin-bottom:12px}
    .theme-salon .diff{border-left:0;border-top:2px solid var(--primary);border-radius:28px;background:color-mix(in srgb,var(--surface) 92%,var(--bg))}
    .theme-salon .cta-band{background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 70%,var(--accent)));color:var(--on-primary);border-radius:32px}
    .theme-salon .cta-band h2{color:var(--on-primary)}
    .theme-salon .cta-band .lead{color:var(--on-primary-muted);max-width:none}
    .theme-salon .cta-band .btn.primary{background:var(--surface);color:var(--text);border-color:var(--surface)}
    .theme-salon .footer-title{text-transform:none;letter-spacing:.06em}
    .theme-salon footer{background:color-mix(in srgb,var(--surface) 94%,var(--bg))}
    .theme-salon .salon-panel-label{font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--primary)}
    .theme-salon .salon-panel-copy{margin:14px 0 0;color:var(--text);font-size:16px;line-height:1.75}
    .theme-salon .salon-pill-list{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
    .theme-salon .salon-pill{padding:9px 12px;border-radius:999px;background:color-mix(in srgb,var(--primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--primary) 18%,transparent);font-size:13px;font-weight:700;color:var(--text)}
    .theme-salon .salon-hero-panel{padding:28px;border-radius:30px;background:color-mix(in srgb,var(--surface) 88%,transparent);border:1px solid color-mix(in srgb,var(--primary) 14%,transparent);box-shadow:0 20px 65px color-mix(in srgb,var(--text) 8%,transparent)}
    .theme-salon .salon-contact-quick{display:grid;gap:12px;margin-top:24px}
    .theme-salon .salon-contact-line{display:grid;gap:4px;padding-top:12px;border-top:1px solid color-mix(in srgb,var(--primary) 12%,transparent);text-decoration:none;color:inherit}
    .theme-salon .salon-contact-line span{font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--text-muted)}
    .theme-salon .salon-contact-line strong{font-size:16px;font-weight:700;color:var(--text)}
    .theme-salon .salon-gallery-shell{padding-top:0}
    .theme-salon .salon-gallery{display:grid;grid-template-columns:1.1fr .9fr .9fr;gap:18px;margin-top:-18px}
    .theme-salon .salon-gallery img{width:100%;height:240px;object-fit:cover;border-radius:28px;box-shadow:0 22px 65px color-mix(in srgb,var(--text) 10%,transparent)}
    .theme-salon .salon-gallery .tall{height:300px}
    .theme-salon .salon-section-intro{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:26px;align-items:end;margin-bottom:38px}
    .theme-salon .salon-side-note{padding:22px 24px;border-radius:24px;background:color-mix(in srgb,var(--surface) 88%,var(--bg));border:1px solid color-mix(in srgb,var(--primary) 12%,transparent);color:var(--text);font-size:15px;line-height:1.7}
    .theme-salon .salon-path-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    .theme-salon .salon-path-card{padding:28px 28px 26px}
    .theme-salon .salon-path-number{display:block;font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--text-muted);margin-bottom:14px}
    .theme-salon .salon-manifesto-grid{display:grid;grid-template-columns:.92fr 1.08fr;gap:52px;align-items:center}
    .theme-salon .salon-image-stack{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    .theme-salon .salon-image-stack img{width:100%;object-fit:cover;border-radius:28px;box-shadow:0 22px 65px color-mix(in srgb,var(--text) 10%,transparent)}
    .theme-salon .salon-image-stack .tall{grid-row:span 2;height:100%}
    .theme-salon .salon-image-stack img:not(.tall){height:240px}
    .theme-salon .salon-copy-stack{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:28px}
    .theme-salon .salon-copy-card{padding:20px 20px 18px;border-radius:22px;background:color-mix(in srgb,var(--surface) 92%,var(--bg));border:1px solid color-mix(in srgb,var(--primary) 10%,transparent)}
    .theme-salon .salon-copy-card span{display:block;font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--primary);margin-bottom:10px}
    .theme-salon .salon-copy-card p{margin:0;color:var(--text-muted);font-size:15px;line-height:1.7}
    .theme-salon .salon-value-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:18px}
    .theme-salon .salon-value{padding:18px 20px;border-radius:22px;background:color-mix(in srgb,var(--surface) 92%,var(--bg));border:1px solid color-mix(in srgb,var(--primary) 10%,transparent)}
    .theme-salon .salon-value h3{margin:0 0 10px;font-family:var(--font-display);font-size:20px;font-weight:600}
    .theme-salon .salon-value p{margin:0;color:var(--text-muted);font-size:15px;line-height:1.7}
    .theme-salon .salon-step-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:48px}
    .theme-salon .salon-step{padding:28px;border-radius:26px;background:color-mix(in srgb,var(--surface) 94%,var(--bg));border:1px solid color-mix(in srgb,var(--primary) 12%,transparent)}
    .theme-salon .salon-step-index{display:block;font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--primary);margin-bottom:14px}
    .theme-salon .salon-step h3{margin:0;font-family:var(--font-display);font-size:26px;font-weight:600}
    .theme-salon .salon-step p{margin:14px 0 0;color:var(--text-muted);font-size:15px;line-height:1.72}
    .theme-salon .salon-step .step-outcome{margin-top:18px;padding-top:14px}
    .theme-salon .salon-diff-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:40px}
    .theme-salon .salon-cta-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:stretch;text-align:left}
    .theme-salon .salon-cta-grid .btns{justify-content:flex-start}
    .theme-salon .salon-cta-card{padding:24px;border-radius:24px;background:color-mix(in srgb,var(--on-primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--on-primary) 18%,transparent)}
    .theme-salon .salon-cta-card .salon-contact-line{border-top-color:color-mix(in srgb,var(--on-primary) 16%,transparent)}
    .theme-salon .salon-cta-card .salon-contact-line span{color:var(--on-primary-muted)}
    .theme-salon .salon-cta-card .salon-contact-line strong{color:var(--on-primary)}
    @media(max-width:1100px){
      .theme-salon .hero-inner,.theme-salon .salon-manifesto-grid,.theme-salon .salon-section-intro,.theme-salon .salon-cta-grid{grid-template-columns:1fr}
      .theme-salon .salon-gallery,.theme-salon .salon-copy-stack,.theme-salon .salon-value-grid,.theme-salon .salon-path-grid,.theme-salon .salon-step-grid,.theme-salon .salon-diff-grid{grid-template-columns:1fr 1fr}
      .theme-salon .salon-gallery .tall{height:240px}
    }
    @media(max-width:760px){
      .theme-salon .section,.theme-salon .section-sm{padding:64px 20px}
      .theme-salon .hero{padding:112px 20px 40px}
      .theme-salon .page-hero{padding:108px 20px 56px}
      .theme-salon .brand{font-size:22px}
      .theme-salon .salon-hero-panel,.theme-salon .salon-side-note,.theme-salon .salon-step,.theme-salon .salon-path-card,.theme-salon .salon-copy-card,.theme-salon .salon-value,.theme-salon .salon-cta-card{padding:20px}
      .theme-salon .h1{font-size:clamp(36px,11vw,56px)}
      .theme-salon .lead,.theme-salon .lead.lg{font-size:16px;line-height:1.7}
      .theme-salon .salon-gallery,.theme-salon .salon-copy-stack,.theme-salon .salon-value-grid,.theme-salon .salon-path-grid,.theme-salon .salon-step-grid,.theme-salon .salon-diff-grid{grid-template-columns:1fr}
      .theme-salon .service-row{padding:44px 0}
      .theme-salon .service-row img,.theme-salon .photo{height:320px}
    }
  ` : ''

  const common = (active: 'home' | 'about' | 'services', title: string, body: string) => `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} | ${esc(businessName)}</title>
  <meta name="description" content="${esc(plan.tagline || plan.heroSubline || `${businessName} – ${nc.metaDescSuffix}`)}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(displayFont).replace(/%20/g, '+')}:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root{--primary:${cssColor(brandPalette.primary,'#f97316')};--secondary:${cssColor(brandPalette.secondary,'#0ea5e9')};--accent:${cssColor(brandPalette.accent,'#f59e0b')};--bg:${cssColor(brandPalette.background,'#0a0e1a')};--surface:${cssColor(brandPalette.surface,'#131a2b')};--surface-2:color-mix(in srgb,var(--surface) 70%,var(--bg));--text:${cssColor(brandPalette.textPrimary,'#f1f5f9')};--text-muted:${cssColor(brandPalette.textSecondary,'#94a3b8')};--on-primary:${cssColor(brandPalette.onPrimary,'#ffffff')};--on-primary-muted:${cssColor(brandPalette.onPrimaryMuted,'rgba(255,255,255,.84)')};--border:color-mix(in srgb,var(--text) 10%,transparent);--font-display:'${cssString(displayFont)}',Space Grotesk,sans-serif;--font-body:${cssString(bodyFont)},Inter,sans-serif}
    *{box-sizing:border-box}html{scroll-behavior:smooth;overflow-x:hidden}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}body.menu-open{overflow:hidden}a{color:inherit}img{max-width:100%;display:block}
    .nav{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
    .nav-inner{max-width:1280px;margin:0 auto;padding:18px 28px;display:flex;align-items:center;justify-content:space-between;gap:24px;position:relative}
    .brand{font-family:var(--font-display);font-size:20px;font-weight:800;letter-spacing:-.02em;text-decoration:none}
    .nav-toggle{display:none;align-items:center;justify-content:center;gap:4px;width:46px;height:46px;border:1px solid var(--border);border-radius:999px;background:color-mix(in srgb,var(--surface) 88%,transparent);color:var(--text);cursor:pointer;flex-direction:column}
    .nav-toggle span{display:block;width:18px;height:2px;border-radius:999px;background:currentColor;transition:transform .2s ease,opacity .2s ease}
    .nav-menu{display:flex;align-items:center;gap:16px;min-width:0}
    .links{display:flex;gap:4px;align-items:center;min-width:0;flex-wrap:wrap}
    .links a{padding:10px 14px;border-radius:10px;text-decoration:none;color:var(--text-muted);font-weight:600;font-size:14px;transition:.2s}
    .links a.active,.links a:hover{background:color-mix(in srgb,var(--primary) 14%,transparent);color:var(--text)}
    .nav-cta{background:var(--primary)!important;color:var(--on-primary)!important;padding:11px 18px!important;box-shadow:0 8px 28px color-mix(in srgb,var(--primary) 40%,transparent);text-decoration:none;border-radius:14px;font-weight:700;white-space:nowrap}
    .section{padding:110px 28px;position:relative}
    .section-sm{padding:80px 28px}
    .wrap{max-width:1280px;margin:0 auto}
    .eyebrow{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:var(--primary);margin-bottom:20px;padding:6px 12px;border:1px solid color-mix(in srgb,var(--primary) 30%,transparent);border-radius:999px;background:color-mix(in srgb,var(--primary) 10%,transparent)}
    .h1,.h2,.h3{font-family:var(--font-display);line-height:1.02;margin:0;color:var(--text);letter-spacing:-.02em}
    .h1{font-size:clamp(46px,7.5vw,96px);font-weight:800}
    .h1 .line{display:block}
    .h1 .accent{color:var(--primary)}
    .h2{font-size:clamp(34px,4.4vw,60px);font-weight:800;max-width:900px}
    .h3{font-size:24px;font-weight:700}
    .lead{font-size:18px;color:var(--text-muted);max-width:640px;line-height:1.7}
    .lead.lg{font-size:20px;max-width:720px}
    .btns{display:flex;gap:14px;flex-wrap:wrap;margin-top:36px}
    .btn{display:inline-flex;align-items:center;gap:10px;padding:16px 26px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;border:1px solid var(--border);background:color-mix(in srgb,var(--text) 6%,transparent);transition:.2s}
    .btn:hover{transform:translateY(-1px)}
    .btn.primary{background:var(--primary);color:var(--on-primary);border-color:var(--primary);box-shadow:0 16px 40px color-mix(in srgb,var(--primary) 34%,transparent)}
    .btn.ghost{background:transparent}
    .arrow{display:inline-flex;align-items:center;gap:8px;color:var(--primary);font-weight:700;text-decoration:none;font-size:15px;margin-top:16px}
    .arrow:after{content:"→";transition:.2s}
    .arrow:hover:after{transform:translateX(4px)}
    .hero{position:relative;min-height:88vh;display:flex;align-items:center;overflow:hidden;isolation:isolate;padding:80px 28px}
    .hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;filter:brightness(.55)}
    .hero:after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,var(--bg) 12%,color-mix(in srgb,var(--bg) 78%,transparent) 55%,color-mix(in srgb,var(--bg) 40%,transparent));z-index:-1}
    .hero-inner{max-width:1280px;width:100%;margin:0 auto}
    .hero .lead{margin-top:26px;max-width:600px}
    .trust-row{display:flex;flex-wrap:wrap;gap:22px;margin-top:40px;color:var(--text-muted);font-size:14px;font-weight:600}
    .trust-row span{display:inline-flex;align-items:center;gap:8px}
    .trust-row span:before{content:"✓";color:var(--primary);font-weight:800}
    .grid{display:grid;gap:24px}
    .g-4{grid-template-columns:repeat(4,1fr)}
    .g-3{grid-template-columns:repeat(3,1fr)}
    .g-2{grid-template-columns:1fr 1fr}
    .card{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:34px;box-shadow:0 20px 60px rgba(0,0,0,.25);position:relative;transition:.25s}
    .card:hover{transform:translateY(-4px);border-color:color-mix(in srgb,var(--primary) 40%,var(--border))}
    .path-card{display:flex;flex-direction:column;height:100%}
    .path-card .eyebrow{margin-bottom:16px}
    .path-card h3{margin:0 0 12px;font-family:var(--font-display);font-size:22px;font-weight:700;line-height:1.15}
    .path-card p{color:var(--text-muted);margin:0 0 auto;font-size:15px;line-height:1.6}
    .band{background:linear-gradient(135deg,var(--surface-2),color-mix(in srgb,var(--primary) 10%,var(--surface)))}
    .band-tight{background:var(--surface-2);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
    .num{font-family:var(--font-display);font-weight:900;font-size:72px;line-height:1;color:var(--primary);opacity:.9;margin-bottom:18px;letter-spacing:-.04em}
    .step-outcome{margin-top:18px;padding-top:16px;border-top:1px solid var(--border);font-weight:600;color:var(--text)}
    .about-split{display:grid;grid-template-columns:1fr 1fr;gap:60px;align-items:start}
    .about-blocks{display:grid;gap:32px;margin-top:32px}
    .about-block h4{font-family:var(--font-display);font-size:18px;margin:0 0 10px;color:var(--primary);text-transform:uppercase;letter-spacing:.14em}
    .about-block p{color:var(--text-muted);margin:0;font-size:16px;line-height:1.7}
    .photo{width:100%;height:600px;object-fit:cover;border-radius:24px;box-shadow:0 30px 90px rgba(0,0,0,.35)}
    .service-row{display:grid;grid-template-columns:1fr 1fr;gap:60px;align-items:center;padding:80px 0;border-top:1px solid var(--border)}
    .service-row:first-child{border-top:0;padding-top:20px}
    .service-row.rev>.s-media{order:2}
    .service-row img{width:100%;height:500px;object-fit:cover;border-radius:22px;box-shadow:0 24px 70px rgba(0,0,0,.3)}
    .service-row h2{font-family:var(--font-display);font-size:clamp(32px,3.5vw,48px);font-weight:800;margin:16px 0 18px;letter-spacing:-.02em}
    .service-row .when{background:color-mix(in srgb,var(--primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--primary) 25%,transparent);border-radius:14px;padding:18px 22px;margin-top:22px}
    .service-row .when strong{color:var(--primary);display:block;margin-bottom:4px;font-size:13px;letter-spacing:.16em;text-transform:uppercase}
    .service-row .when p{margin:0;color:var(--text);font-size:16px}
    .scenario{background:var(--surface);border:1px solid var(--border);border-radius:22px;overflow:hidden;display:flex;flex-direction:column;transition:.25s}
    .scenario:hover{transform:translateY(-4px);border-color:color-mix(in srgb,var(--primary) 30%,var(--border))}
    .scenario img{width:100%;height:220px;object-fit:cover}
    .scenario-body{padding:28px;display:flex;flex-direction:column;flex:1}
    .scenario .tag{font-size:11px;letter-spacing:.18em;font-weight:800;color:var(--primary);text-transform:uppercase;margin-bottom:10px}
    .scenario h3{font-family:var(--font-display);font-size:20px;font-weight:700;margin:0 0 12px;line-height:1.25}
    .scenario p{color:var(--text-muted);font-size:15px;margin:0 0 16px;line-height:1.6}
    .scenario .delivery{margin-top:auto;padding-top:16px;border-top:1px solid var(--border);font-size:14px;color:var(--text)}
    .scenario .delivery strong{color:var(--primary)}
    .diff-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:32px;margin-top:44px}
    .diff{padding:32px;border-left:3px solid var(--primary);background:color-mix(in srgb,var(--surface) 60%,transparent);border-radius:0 16px 16px 0}
    .diff h3{font-family:var(--font-display);font-size:20px;font-weight:700;margin:0 0 12px}
    .diff p{margin:0;color:var(--text-muted);font-size:15px;line-height:1.65}
    .cta-band{background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 60%,var(--accent)));color:var(--on-primary);text-align:center;padding:100px 28px;border-radius:28px;margin:40px auto;max-width:1280px}
    .cta-band h2{color:var(--on-primary);margin:0 auto;max-width:800px}
    .cta-band .lead{color:var(--on-primary-muted);margin:20px auto 0;font-size:19px}
    .cta-band .btn{border-color:color-mix(in srgb,var(--on-primary) 26%,transparent)}
    .cta-band .btn.primary{background:var(--bg);color:var(--text);border-color:var(--bg);box-shadow:0 20px 50px rgba(0,0,0,.3)}
    .cta-band .btns{justify-content:center;margin-top:36px}
    .faq{border-top:1px solid var(--border);padding:28px 0}
    .faq summary{cursor:pointer;list-style:none;font-family:var(--font-display);font-size:20px;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:20px}
    .faq summary::-webkit-details-marker{display:none}
    .faq summary:after{content:"+";color:var(--primary);font-size:28px;font-weight:400;transition:.2s;line-height:1}
    .faq[open] summary:after{transform:rotate(45deg)}
    .faq p{color:var(--text-muted);margin:16px 0 0;font-size:16px;line-height:1.7;max-width:820px}
    .page-hero{position:relative;padding:140px 28px 100px;text-align:center;overflow:hidden;isolation:isolate}
    .page-hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;opacity:.22}
    .page-hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 70%,transparent),var(--bg));z-index:-1}
    .page-hero .h1{margin:0 auto;max-width:900px}
    .page-hero .lead{margin:26px auto 0}
    .contact-grid{display:grid;grid-template-columns:1fr 1.1fr;gap:44px;align-items:start}
    .contact-list{display:grid;gap:14px;margin-top:28px}
    .contact-item{padding:22px 24px;background:var(--surface);border:1px solid var(--border);border-radius:16px}
    .contact-item strong{display:block;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--primary);margin-bottom:6px}
    .contact-item a{color:var(--text);font-weight:600;text-decoration:none;font-size:17px;overflow-wrap:anywhere}
    .map{width:100%;height:420px;border:0;border-radius:20px}
    footer{padding:80px 28px 40px;border-top:1px solid var(--border);color:var(--text-muted);background:var(--surface-2)}
    .footer-grid{display:grid;gap:56px}
    .footer-grid.cols-2{grid-template-columns:1.5fr 1fr}
    .footer-grid.cols-3{grid-template-columns:1.5fr 1fr 1fr}
    .footer-title{font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--text);margin-bottom:16px;text-transform:uppercase;letter-spacing:.12em}
    .footer-grid p,.footer-grid a{overflow-wrap:anywhere}
    .footer-grid a{color:var(--text-muted);text-decoration:none;display:block;padding:4px 0;font-size:15px}
    .footer-grid a:hover{color:var(--primary)}
    .foot-bottom{margin-top:60px;padding-top:24px;border-top:1px solid var(--border);text-align:center;font-size:14px}
    @media(max-width:900px){.nav-inner{padding:14px 20px}.nav-toggle{display:inline-flex}.nav-menu{display:none;position:absolute;top:calc(100% + 10px);left:20px;right:20px;z-index:60;flex-direction:column;align-items:stretch;padding:16px;border-radius:22px;border:1px solid var(--border);background:color-mix(in srgb,var(--surface) 94%,var(--bg));box-shadow:0 24px 60px rgba(0,0,0,.22)}.nav.open .nav-menu{display:flex}.nav.open .nav-toggle span:nth-child(1){transform:translateY(6px) rotate(45deg)}.nav.open .nav-toggle span:nth-child(2){opacity:0}.nav.open .nav-toggle span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}.links{flex-direction:column;align-items:stretch;gap:8px}.links a,.nav-cta{width:100%;justify-content:center}.links a{padding:12px 14px;font-size:15px}.section,.section-sm{padding:70px 20px}.hero{min-height:auto;padding:100px 20px}.g-4,.g-3,.g-2,.about-split,.diff-grid,.contact-grid,.footer-grid{grid-template-columns:1fr}.service-row{grid-template-columns:1fr;gap:32px;padding:60px 0}.service-row.rev>.s-media{order:0}.service-row img,.photo{height:340px}.cta-band{padding:70px 24px;border-radius:20px}footer{padding:64px 20px 34px}}
  </style>
</head>
<body class="${nc.key === 'hair_salon' ? 'theme-salon' : 'theme-auto'}">
  <style>${nicheStyles}</style>
  ${nav(active, businessName, primaryHref, primaryLabel, hasContact)}
  ${body}
  ${footer(businessName, plan.tagline, { phone, email, address }, nc)}
  <script>
    (() => {
      const nav = document.querySelector('.nav')
      const button = document.querySelector('.nav-toggle')
      const menu = document.querySelector('.nav-menu')
      if (!nav || !button || !menu) return
      const setOpen = (open) => {
        nav.classList.toggle('open', open)
        button.setAttribute('aria-expanded', open ? 'true' : 'false')
        document.body.classList.toggle('menu-open', open)
      }
      button.addEventListener('click', () => setOpen(!nav.classList.contains('open')))
      menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setOpen(false)))
      document.addEventListener('click', (event) => {
        if (!nav.contains(event.target)) setOpen(false)
      })
      window.addEventListener('resize', () => {
        if (window.innerWidth > 900) setOpen(false)
      })
    })()
  </script>
</body>
</html>`

  const primaryCta = primaryHref && primaryLabel
    ? `<a class="btn primary" href="${attr(primaryHref)}">${esc(primaryLabel)}</a>`
    : ''
  const bookCta = `<a class="btn ghost" href="tjanster.html">${esc(bookLabel)}</a>`

  const heroLine1 = cleanText(plan.heroLine1 || nc.heroLine1Default(city))
  const heroLine2 = cleanText(plan.heroLine2 || nc.heroLine2Default)
  const heroEyebrow = cleanText(plan.heroEyebrow || nc.heroEyebrowDefault(city))
  const heroSub = cleanText(plan.heroSubline || nc.heroSublineDefault)
  const aboutTitle = cleanText(plan.aboutTitle || nc.aboutTitleDefault)
  const aboutIntro = cleanText(plan.aboutIntro || plan.tagline || heroSub)
  const tagline = cleanText(plan.tagline || '')
  const pathwaysIntro = cleanText(plan.pathwaysIntro || (isSalon ? 'Välj det som ligger närmast det du vill förstärka, förnya eller få hjälp att landa rätt i.' : ''))
  const sectionNote = cleanText(plan.tagline || 'Klippning, färg och styling med tydlig känsla för helheten.')

  const trustRow = trustBadges.length
    ? `<div class="trust-row">${trustBadges.map((b) => `<span>${esc(b)}</span>`).join('')}</div>`
    : ''

  const aboutItems = [
    { title: 'Före besöket', text: cleanText(plan.aboutBefore || '') },
    { title: `Under ${nc.serviceLabel.toLowerCase()}en`, text: cleanText(plan.aboutDuring || '') },
    { title: 'Efter besöket', text: cleanText(plan.aboutAfter || '') },
  ].filter((item) => item.text)

  const aboutBlocks = aboutItems.map((item) => `<div class="about-block"><h4>${esc(item.title)}</h4><p>${esc(item.text)}</p></div>`).join('')
  const salonAboutBlocks = aboutItems.map((item) => `<article class="salon-copy-card"><span>${esc(item.title)}</span><p>${esc(item.text)}</p></article>`).join('')
  const salonValues = values.length
    ? `<div class="salon-value-grid">${values.slice(0, 3).map((v) => `<article class="salon-value"><h3>${esc(v.title)}</h3><p>${esc(v.text)}</p></article>`).join('')}</div>`
    : ''

  const salonQuickContactRows = [
    phone ? `<a class="salon-contact-line" href="tel:${attr(phone.replace(/\s+/g, ''))}"><span>Telefon</span><strong>${esc(phone)}</strong></a>` : '',
    email ? `<a class="salon-contact-line" href="mailto:${attr(email)}"><span>E-post</span><strong>${esc(email)}</strong></a>` : '',
    address ? `<div class="salon-contact-line"><span>Adress</span><strong>${esc(address)}</strong></div>` : '',
  ].filter(Boolean).join('')
  const salonQuickContact = salonQuickContactRows ? `<div class="salon-contact-quick">${salonQuickContactRows}</div>` : ''
  const salonHeroPanel = isSalon ? `
    <aside class="salon-hero-panel">
      <div class="salon-panel-label">Känslan på plats</div>
      <p class="salon-panel-copy">${esc(tagline || aboutIntro || 'Lugn rådgivning, formkänsla och resultat som håller ihop med hela uttrycket.')}</p>
      <div class="salon-pill-list">${trustBadges.map((b) => `<span class="salon-pill">${esc(b)}</span>`).join('')}</div>
      ${salonQuickContact}
    </aside>` : ''
  const salonGallery = isSalon ? `
    <section class="section-sm salon-gallery-shell">
      <div class="wrap">
        <div class="salon-gallery">
          <img class="tall" src="${attr(img(1))}" alt="${esc(businessName)}">
          <img src="${attr(img(2))}" alt="${esc(businessName)}">
          <img src="${attr(img(3))}" alt="${esc(businessName)}">
        </div>
      </div>
    </section>` : ''

  const pathwaysSection = pathways.length
    ? isSalon
      ? `<section class="section band-tight"><div class="wrap"><div class="salon-section-intro"><div><div class="eyebrow">Din väg in</div><h2 class="h2">${esc(nc.pathwaysHeading)}</h2>${pathwaysIntro ? `<p class="lead lg" style="margin-top:20px">${esc(pathwaysIntro)}</p>` : ''}</div><div class="salon-side-note">${esc(sectionNote)}</div></div><div class="grid salon-path-grid">${pathways.map((p, i) => `<div class="card path-card salon-path-card"><span class="salon-path-number">Väg ${String(i + 1).padStart(2, '0')}</span><div class="eyebrow" style="margin-bottom:12px">${esc(p.eyebrow)}</div><h3>${esc(p.title)}</h3><p>${esc(p.description)}</p><a class="arrow" href="tjanster.html">${esc(p.ctaLabel || 'Läs mer')}</a></div>`).join('')}</div></div></section>`
      : `<section class="section band-tight"><div class="wrap"><div class="eyebrow">Rätt väg in</div><h2 class="h2">${esc(nc.pathwaysHeading)}</h2>${pathwaysIntro ? `<p class="lead lg" style="margin-top:20px">${esc(pathwaysIntro)}</p>` : ''}<div class="grid g-4" style="margin-top:52px">${pathways.map((p) => `<div class="card path-card"><div class="eyebrow" style="margin-bottom:14px">${esc(p.eyebrow)}</div><h3>${esc(p.title)}</h3><p>${esc(p.description)}</p><a class="arrow" href="tjanster.html">${esc(p.ctaLabel || 'Läs mer')}</a></div>`).join('')}</div></div></section>`
    : ''

  const aboutTeaser = (aboutItems.length || aboutIntro) ? (
    isSalon
      ? `<section class="section"><div class="wrap salon-manifesto-grid"><div class="salon-image-stack"><img class="tall" src="${attr(img(4))}" alt="${esc(businessName)}"><img src="${attr(img(5))}" alt="${esc(businessName)}"><img src="${attr(img(6))}" alt="${esc(businessName)}"></div><div><div class="eyebrow">${esc(nc.aboutEyebrow)}</div><h2 class="h2">${esc(aboutTitle)}</h2>${aboutIntro ? `<p class="lead lg" style="margin-top:22px">${esc(aboutIntro)}</p>` : ''}${salonAboutBlocks ? `<div class="salon-copy-stack">${salonAboutBlocks}</div>` : ''}${salonValues}</div></div></section>`
      : `<section class="section"><div class="wrap"><div class="about-split"><div><div class="eyebrow">${esc(nc.aboutEyebrow)}</div><h2 class="h2">${esc(aboutTitle)}</h2>${aboutIntro ? `<p class="lead lg" style="margin-top:24px">${esc(aboutIntro)}</p>` : ''}<div class="btns"><a class="btn" href="om-oss.html">${esc(nc.aboutPageTitle)}</a>${primaryCta}</div></div><div class="about-blocks">${aboutBlocks}</div></div></div></section>`
  ) : ''

  const scenariosSection = scenarios.length >= 2 ? (
    isSalon
      ? `<section class="section band"><div class="wrap"><div class="salon-section-intro"><div><div class="eyebrow">Form & resultat</div><h2 class="h2">${esc(nc.scenariosHeading)}</h2><p class="lead lg" style="margin-top:20px">${esc(nc.scenariosIntro)}</p></div><div class="salon-side-note">${esc(tagline || heroSub)}</div></div><div class="grid g-3">${scenarios.map((s, i) => `<div class="scenario"><img src="${attr(img(i + 2))}" alt="${esc(s.title)}"><div class="scenario-body"><div class="tag">${esc(s.category)}</div><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p><div class="delivery"><strong>Leverans:</strong> ${esc(s.delivery)}</div></div></div>`).join('')}</div></div></section>`
      : `<section class="section band"><div class="wrap"><div class="eyebrow">Resultat</div><h2 class="h2">${esc(nc.scenariosHeading)}</h2><p class="lead lg" style="margin-top:20px">${esc(nc.scenariosIntro)}</p><div class="grid g-3" style="margin-top:52px">${scenarios.map((s, i) => `<div class="scenario"><img src="${attr(img(i + 2))}" alt="${esc(s.title)}"><div class="scenario-body"><div class="tag">${esc(s.category)}</div><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p><div class="delivery"><strong>Leverans:</strong> ${esc(s.delivery)}</div></div></div>`).join('')}</div></div></section>`
  ) : ''

  const processSection = processSteps.length >= 3 ? (
    isSalon
      ? `<section class="section"><div class="wrap"><div class="eyebrow">Så landar upplevelsen</div><h2 class="h2">${esc(nc.processHeading)}</h2><div class="salon-step-grid">${processSteps.map((s, i) => `<article class="salon-step"><span class="salon-step-index">Steg ${String(i + 1).padStart(2, '0')}</span><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p>${s.outcome ? `<div class="step-outcome">${esc(s.outcome)}</div>` : ''}</article>`).join('')}</div></div></section>`
      : `<section class="section"><div class="wrap"><div class="eyebrow">Så märks det i praktiken</div><h2 class="h2">${esc(nc.processHeading)}</h2><div class="grid g-3" style="margin-top:56px">${processSteps.map((s, i) => `<div><div class="num">${String(i + 1).padStart(2, '0')}</div><h3 class="h3">${esc(s.title)}</h3><p class="lead" style="font-size:16px;margin-top:12px">${esc(s.description)}</p>${s.outcome ? `<div class="step-outcome">${esc(s.outcome)}</div>` : ''}</div>`).join('')}</div></div></section>`
  ) : ''

  const diffSection = differentiators.length >= 3 ? (
    isSalon
      ? `<section class="section band-tight"><div class="wrap"><div class="eyebrow">Det du märker</div><h2 class="h2">${esc(nc.diffHeading)}</h2><div class="salon-diff-grid">${differentiators.map((d) => `<div class="diff salon-diff"><h3>${esc(d.title)}</h3><p>${esc(d.text)}</p></div>`).join('')}</div></div></section>`
      : `<section class="section band-tight"><div class="wrap"><div class="eyebrow">Så arbetar vi</div><h2 class="h2">${esc(nc.diffHeading)}</h2><div class="diff-grid">${differentiators.map((d) => `<div class="diff"><h3>${esc(d.title)}</h3><p>${esc(d.text)}</p></div>`).join('')}</div></div></section>`
  ) : ''

  const finalCta = isSalon
    ? `<section class="section-sm"><div class="wrap"><div class="cta-band salon-cta-grid"><div><div class="eyebrow" style="color:var(--on-primary-muted);background:transparent;border:0;padding:0">Nästa steg</div><h2 class="h2">${esc(plan.ctaTitle || nc.ctaTitleDefault)}</h2><p class="lead">${esc(plan.ctaText || nc.ctaTextDefault)}</p><div class="btns">${primaryCta}${bookCta}</div></div><div class="salon-cta-card"><div class="salon-panel-label" style="color:var(--on-primary-muted)">Direktkontakt</div>${salonQuickContactRows || trustBadges.map((b) => `<div class="salon-contact-line"><span>Det du får</span><strong>${esc(b)}</strong></div>`).join('')}</div></div></div></section>`
    : `<section class="section-sm"><div class="cta-band"><div class="eyebrow" style="color:var(--bg);background:color-mix(in srgb,var(--bg) 20%,transparent);border-color:color-mix(in srgb,var(--bg) 30%,transparent)">Nästa steg</div><h2 class="h2">${esc(plan.ctaTitle || nc.ctaTitleDefault)}</h2><p class="lead">${esc(plan.ctaText || nc.ctaTextDefault)}</p><div class="btns">${primaryCta}${bookCta}</div></div></section>`

  const homeBody = isSalon
    ? `
    <section class="hero"><img src="${attr(img(0))}" alt="${esc(businessName)}"><div class="hero-inner salon-hero-grid"><div class="salon-hero-copy"><div class="eyebrow">${esc(heroEyebrow)}</div><h1 class="h1"><span class="line">${esc(heroLine1)}</span><span class="line accent">${esc(heroLine2)}</span></h1><p class="lead lg">${esc(heroSub)}</p><div class="btns">${primaryCta}${bookCta}</div>${trustRow}</div>${salonHeroPanel}</div></section>
    ${salonGallery}
    ${pathwaysSection}
    ${aboutTeaser}
    ${scenariosSection}
    ${processSection}
    ${diffSection}
    ${finalCta}
    ${contactSection({ phone, email, address, googleMapsUrl, nc })}`
    : `
    <section class="hero"><img src="${attr(img(0))}" alt="${esc(businessName)}"><div class="hero-inner"><div class="eyebrow">${esc(heroEyebrow)}</div><h1 class="h1"><span class="line">${esc(heroLine1)}</span><span class="line accent">${esc(heroLine2)}</span></h1><p class="lead lg">${esc(heroSub)}</p><div class="btns">${primaryCta}${bookCta}</div>${trustRow}</div></section>
    ${pathwaysSection}
    ${aboutTeaser}
    ${scenariosSection}
    ${processSection}
    ${diffSection}
    ${finalCta}
    ${contactSection({ phone, email, address, googleMapsUrl, nc })}`

  const aboutBody = isSalon
    ? `
    ${pageHero(nc.aboutPageTitle, aboutTitle || `Möt ${businessName}`, aboutIntro || tagline || '', img(1))}
    ${(aboutItems.length || aboutIntro || values.length) ? `<section class="section"><div class="wrap salon-manifesto-grid"><div class="salon-image-stack"><img class="tall" src="${attr(img(2))}" alt="${esc(businessName)}"><img src="${attr(img(7))}" alt="${esc(businessName)}"><img src="${attr(img(8))}" alt="${esc(businessName)}"></div><div><div class="eyebrow">${esc(nc.aboutPageTitle)}</div><h2 class="h2">${esc(aboutTitle)}</h2>${aboutIntro ? `<p class="lead lg" style="margin-top:22px">${esc(aboutIntro)}</p>` : ''}${salonAboutBlocks ? `<div class="salon-copy-stack">${salonAboutBlocks}</div>` : ''}${salonValues}</div></div></section>` : ''}
    ${diffSection}
    ${finalCta}`
    : `
    ${pageHero(nc.aboutPageTitle, aboutTitle || `Möt ${businessName}`, aboutIntro || tagline || '', img(1))}
    ${(aboutItems.length || aboutIntro) ? `<section class="section"><div class="wrap about-split"><img class="photo" src="${attr(img(2))}" alt="${esc(businessName)}"><div class="about-blocks">${aboutBlocks}</div></div></section>` : ''}
    ${values.length ? `<section class="section band-tight"><div class="wrap"><div class="eyebrow">Vad vi står för</div><h2 class="h2">Tryggare känsla hela vägen</h2><div class="grid g-3" style="margin-top:48px">${values.map((v) => `<div class="card"><h3 class="h3">${esc(v.title)}</h3><p style="color:var(--text-muted);margin:14px 0 0">${esc(v.text)}</p></div>`).join('')}</div></div></section>` : ''}
    ${diffSection}
    ${finalCta}`

  const servicesBody = isSalon
    ? `
    ${pageHero(nc.serviceLabelPlural, `Våra ${nc.serviceLabelPlural.toLowerCase()}`, nc.servicesPageSub, img(0))}
    <section class="section"><div class="wrap"><div class="salon-section-intro"><div><div class="eyebrow">${esc(nc.serviceLabelPlural)}</div><h2 class="h2">${esc(`Välj det som passar dig och din vardag`)}</h2><p class="lead lg" style="margin-top:20px">${esc(nc.servicesPageSub)}</p></div><div class="salon-side-note">${esc(tagline || `Varje ${nc.serviceLabel.toLowerCase()} ska kännas genomtänkt både på plats och när du bär resultatet vidare ut genom dörren.`)}</div></div>${services.map((s, i) => `<div class="service-row ${i % 2 === 1 ? 'rev' : ''}"><div class="s-media"><img src="${attr(img(i + 1))}" alt="${esc(s.name)}"></div><div><div class="eyebrow">${esc(nc.serviceLabel)} ${String(i + 1).padStart(2, '0')}</div><h2>${esc(s.name)}</h2><p class="lead">${esc(s.description)}</p>${s.when ? `<div class="when"><strong>När passar det?</strong><p>${esc(s.when)}</p></div>` : ''}<div class="btns">${primaryCta}${bookCta}</div></div></div>`).join('')}</div></section>
    ${faqs.length ? `<section class="section band-tight"><div class="wrap"><div class="eyebrow">Vanliga frågor</div><h2 class="h2">Bra att veta före ditt besök</h2><div style="margin-top:36px;max-width:900px">${faqs.map((f) => `<details class="faq"><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('')}</div></div></section>` : ''}
    ${finalCta}`
    : `
    ${pageHero('Tjänster', plan.aboutTitle && plan.aboutTitle.length < 60 ? plan.aboutTitle : 'Våra tjänster', nc.servicesPageSub, img(0))}
    <section class="section"><div class="wrap">${services.map((s, i) => `<div class="service-row ${i % 2 === 1 ? 'rev' : ''}"><div class="s-media"><img src="${attr(img(i + 1))}" alt="${esc(s.name)}"></div><div><div class="eyebrow">${esc(nc.serviceLabel)} 0${i + 1}</div><h2>${esc(s.name)}</h2><p class="lead">${esc(s.description)}</p>${s.when ? `<div class="when"><strong>När passar det?</strong><p>${esc(s.when)}</p></div>` : ''}<div class="btns">${primaryCta}</div></div></div>`).join('')}</div></section>
    ${faqs.length ? `<section class="section band-tight"><div class="wrap"><div class="eyebrow">Vanliga frågor</div><h2 class="h2">Bra att veta inför ditt besök</h2><div style="margin-top:40px;max-width:900px">${faqs.map((f) => `<details class="faq"><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('')}</div></div></section>` : ''}
    ${finalCta}`

  return {
    'index.html': common('home', 'Hem', homeBody),
    'om-oss.html': common('about', nc.aboutPageTitle, aboutBody),
    'tjanster.html': common('services', 'Tjänster', servicesBody),
  }
}

function normalizeServices(items: ServiceItem[] | undefined, nc: NicheConfig): ServiceItem[] {
  const cleaned = (items || [])
    .map((s) => ({ name: cleanText(s?.name || ''), description: cleanText(s?.description || ''), when: cleanText(s?.when || '') }))
    .filter((s) => s.name && s.description)
    .slice(0, 7)
  return cleaned.length >= 3 ? cleaned : nc.fallbackServices
}

function normalizeValues(items: ValueItem[] | undefined, nc: NicheConfig): ValueItem[] {
  const cleaned = (items || [])
    .map((v) => ({ title: cleanText(v?.title || ''), text: cleanText(v?.text || '') }))
    .filter((v) => v.title && v.text)
    .slice(0, 4)
  return cleaned.length >= 3 ? cleaned : nc.fallbackValues
}

function normalizeFaqs(items: FaqItem[] | undefined, nc: NicheConfig): FaqItem[] {
  const cleaned = (items || [])
    .map((f) => ({ question: cleanText(f?.question || ''), answer: cleanText(f?.answer || '') }))
    .filter((f) => f.question && f.answer)
    .slice(0, 6)
  return cleaned.length >= 3 ? cleaned : nc.fallbackFaqs
}

function normalizePathways(items: PathwayItem[] | undefined, nc: NicheConfig): PathwayItem[] {
  const cleaned = (items || [])
    .map((p) => ({ eyebrow: cleanText(p?.eyebrow || ''), title: cleanText(p?.title || ''), description: cleanText(p?.description || ''), ctaLabel: cleanText(p?.ctaLabel || 'Läs mer') }))
    .filter((p) => p.title && p.description)
    .slice(0, 4)
  return cleaned.length >= 3 ? cleaned : nc.fallbackPathways
}

function normalizeDifferentiators(items?: DifferentiatorItem[]): DifferentiatorItem[] {
  return (items || [])
    .map((d) => ({ title: cleanText(d?.title || ''), text: cleanText(d?.text || '') }))
    .filter((d) => d.title && d.text)
    .slice(0, 4)
}

function normalizeScenarios(items?: ScenarioItem[]): ScenarioItem[] {
  return (items || [])
    .map((s) => ({ category: cleanText(s?.category || 'Verkstad'), title: cleanText(s?.title || ''), description: cleanText(s?.description || ''), delivery: cleanText(s?.delivery || '') }))
    .filter((s) => s.title && s.description && s.delivery)
    .slice(0, 3)
}

function normalizeProcess(items?: ProcessStep[]): ProcessStep[] {
  return (items || [])
    .map((s) => ({ title: cleanText(s?.title || ''), description: cleanText(s?.description || ''), outcome: cleanText(s?.outcome || '') }))
    .filter((s) => s.title && s.description)
    .slice(0, 3)
}

function nav(active: 'home' | 'about' | 'services', businessName: string, primaryHref: string | null, primaryLabel: string | null, hasContact: boolean): string {
  const a = (key: string) => active === key ? ' active' : ''
  const contactLink = hasContact ? `<a href="index.html#kontakt">Kontakt</a>` : ''
  const cta = primaryHref && primaryLabel
    ? `<a class="nav-cta" href="${attr(primaryHref)}">${esc(primaryLabel)}</a>`
    : ''
  return `<nav class="nav"><div class="nav-inner"><a class="brand" href="index.html">${esc(businessName)}</a><button class="nav-toggle" type="button" aria-label="Öppna meny" aria-controls="site-menu" aria-expanded="false"><span></span><span></span><span></span></button><div class="nav-menu" id="site-menu"><div class="links"><a class="${a('home')}" href="index.html">Hem</a><a class="${a('about')}" href="om-oss.html">Om oss</a><a class="${a('services')}" href="tjanster.html">Tjänster</a>${contactLink}</div>${cta}</div></div></nav>`
}

function pageHero(eyebrow: string, title: string, sub: string, image: string): string {
  return `<section class="page-hero"><img src="${attr(image)}" alt=""><div class="wrap"><div class="eyebrow">${esc(eyebrow)}</div><h1 class="h1" style="margin:0 auto">${esc(title)}</h1>${sub ? `<p class="lead" style="margin:24px auto 0">${esc(sub)}</p>` : ''}</div></section>`
}

function contactSection({ phone, email, address, googleMapsUrl, nc }: { phone: string; email: string; address: string; googleMapsUrl: string | null; nc: NicheConfig }): string {
  if (!phone && !email && !address) return ''
  const rows = [
    phone ? `<div class="contact-item"><strong>Telefon</strong><br><a href="tel:${attr(phone.replace(/\s+/g, ''))}">${esc(phone)}</a></div>` : '',
    email ? `<div class="contact-item"><strong>E-post</strong><br><a href="mailto:${attr(email)}">${esc(email)}</a></div>` : '',
    address ? `<div class="contact-item"><strong>Adress</strong><br>${esc(address)}</div>` : '',
  ].filter(Boolean).join('')
  const hasValidMap = googleMapsUrl && /^https:\/\/www\.google\.[^\s"']+\/maps\/embed/i.test(googleMapsUrl)
  const wrapClass = hasValidMap ? 'wrap contact-grid' : 'wrap'
  const map = hasValidMap
    ? `<iframe class="map" src="${attr(googleMapsUrl!)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`
    : ''
  return `<section id="kontakt" class="section band"><div class="${wrapClass}"><div><div class="eyebrow">Kontakt</div><h2 class="h2">${esc(nc.contactHeadline)}</h2><p class="lead">${esc(nc.contactSubline)}</p><div class="contact-list" style="margin-top:24px">${rows}</div></div>${map}</div></section>`
}

function footer(businessName: string, tagline: string | undefined, contact: { phone: string; email: string; address: string }, nc: NicheConfig): string {
  const contactRows = [contact.phone, contact.email, contact.address].filter(Boolean).map(esc).join('<br>')
  const hasContact = Boolean(contactRows)
  const colsClass = hasContact ? 'cols-3' : 'cols-2'
  const contactCol = hasContact ? `<div><div class="footer-title">Kontakt</div><p>${contactRows}</p></div>` : ''
  const navContact = hasContact ? `<br><a href="index.html#kontakt">Kontakt</a>` : ''
  return `<footer><div class="wrap"><div class="footer-grid ${colsClass}"><div><div class="footer-title">${esc(businessName)}</div><p>${esc(tagline || nc.footerTagline)}</p></div><div><div class="footer-title">Navigering</div><p><a href="index.html">Hem</a><br><a href="om-oss.html">${esc(nc.aboutPageTitle)}</a><br><a href="tjanster.html">Tjänster</a>${navContact}</p></div>${contactCol}</div><p class="foot-bottom">© ${CURRENT_YEAR} ${esc(businessName)} — Demo skapad av Botlio</p></div></footer>`
}

function cleanText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
}

function esc(value: string): string {
  return cleanText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function attr(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function cssString(value: string): string {
  return value.replace(/[^a-zA-Z0-9 åäöÅÄÖ_-]/g, '').slice(0, 80)
}

function cssColor(value: string, fallback: string): string {
  const v = String(value || '').trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || /^rgb(a)?\([^)]+\)$/i.test(v) || /^[a-z]+$/i.test(v) ? v : fallback
}

// ---- Brand colour extraction from Firecrawl branding ----------------------
// Firecrawl frequently reports junk as "primary": the default browser link blue
// (#0000EE), a Tailwind slate, pure black/white, or a near-white background
// tint. Feeding that straight into the CSS vars is why a pink salon site came
// out blue. We instead score every colour Firecrawl saw and pick the real
// brand hue, then build the whole theme around that hue.

const JUNK_COLORS = new Set([
  '#0000ee', '#0000ff', '#551a8b', '#ee0000', '#1a0dab', '#0d6efd', '#007bff',
  '#334155', '#000000', '#ffffff', '#0066cc', '#0645ad', '#2563eb',
])

function toHex(color: string): string | null {
  const rgb = parseCssColor(color)
  if (!rgb) return null
  return `#${[rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function rgbToHsl(color: string): { h: number; s: number; l: number } | null {
  const rgb = parseCssColor(color)
  if (!rgb) return null
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s, l }
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360
  const ss = Math.max(0, Math.min(1, s))
  const ll = Math.max(0, Math.min(1, l))
  const c = (1 - Math.abs(2 * ll - 1)) * ss
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = ll - c / 2
  const seg = Math.floor(hh / 60) % 6
  const rgb = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg]
  return `#${rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`
}

// A usable brand colour: saturated enough to read as a choice, not too pale,
// not a browser/framework default.
function isBrandish(color: string): boolean {
  const hex = toHex(color)
  if (!hex || JUNK_COLORS.has(hex)) return false
  const hsl = rgbToHsl(hex)
  if (!hsl) return false
  return hsl.s >= 0.16 && hsl.l >= 0.12 && hsl.l <= 0.82
}

// Pale but tinted (e.g. #F5EAE2) — not a primary, but it tells us the brand hue.
function isTinted(color: string): boolean {
  const hsl = rgbToHsl(color)
  return !!hsl && hsl.s >= 0.06 && hsl.l > 0.8
}

function deriveBrandColors(
  branding: Record<string, any>,
  defaults: Record<string, string>,
): Record<string, string> {
  const bc = (branding?.colors ?? {}) as Record<string, string>
  const comp = (branding?.components ?? {}) as Record<string, any>

  const raw = [
    comp?.buttonPrimary?.background,
    bc.primary,
    bc.accent,
    bc.link,
    bc.secondary,
    comp?.buttonSecondary?.background,
    bc.brand,
  ].filter((c): c is string => typeof c === 'string' && !!toHex(c)).map((c) => toHex(c)!)

  // Distinct brand-worthy colours, deduped by hue
  const brandish: string[] = []
  for (const c of raw) {
    if (!isBrandish(c)) continue
    const hsl = rgbToHsl(c)!
    const dup = brandish.some((b) => {
      const o = rgbToHsl(b)!
      const dh = Math.abs(o.h - hsl.h)
      return Math.min(dh, 360 - dh) < 14
    })
    if (!dup) brandish.push(c)
  }

  // No strong colour? Fall back to the hue of a pale brand tint (beige salons).
  let primary = brandish[0]
  if (!primary) {
    const tint = raw.find(isTinted)
    if (tint) {
      const h = rgbToHsl(tint)!
      primary = hslToHex(h.h, Math.max(0.34, h.s), 0.42)
    }
  }
  if (!primary) return { ...defaults }

  const ph = rgbToHsl(primary)!
  const secondary = brandish[1] ?? hslToHex(ph.h + 24, Math.max(0.22, ph.s * 0.85), Math.min(0.62, ph.l + 0.14))
  const accent = brandish[2] ?? brandish[1] ?? hslToHex(ph.h - 18, Math.max(0.3, ph.s * 0.9), Math.min(0.7, ph.l + 0.2))

  // Theme mode: follow the source site, defaulting to the niche default's mode.
  const scrapedBg = toHex(bc.background || '')
  const defaultsLight = isLightColor(defaults.background)
  const dark = branding?.colorScheme === 'dark'
    ? true
    : scrapedBg
      ? !isLightColor(scrapedBg)
      : !defaultsLight

  const background = dark ? hslToHex(ph.h, 0.20, 0.07) : hslToHex(ph.h, Math.min(0.32, ph.s * 0.5 + 0.06), 0.968)
  const surface = dark ? hslToHex(ph.h, 0.18, 0.12) : hslToHex(ph.h, Math.min(0.22, ph.s * 0.35 + 0.03), 0.995)
  const textPrimary = dark ? hslToHex(ph.h, 0.10, 0.96) : hslToHex(ph.h, 0.14, 0.14)
  const textSecondary = dark ? hslToHex(ph.h, 0.10, 0.76) : hslToHex(ph.h, 0.09, 0.42)

  // Keep the primary usable as a button fill: nudge very light/dark hues.
  const usablePrimary = ph.l > 0.78 || ph.l < 0.14
    ? hslToHex(ph.h, Math.max(0.32, ph.s), dark ? 0.58 : 0.42)
    : primary

  return { primary: usablePrimary, secondary, accent, background, surface, textPrimary, textSecondary }
}

function buildAccessiblePalette(

  raw: Record<string, string>,
  defaults: {
    primary: string
    secondary: string
    accent: string
    background: string
    surface: string
    textPrimary: string
    textSecondary: string
  },
): Record<string, string> {
  const background = cssColor(raw.background, defaults.background)
  const surface = cssColor(raw.surface, defaults.surface)
  const primary = cssColor(raw.primary, defaults.primary)
  const secondary = cssColor(raw.secondary, defaults.secondary)
  const accent = cssColor(raw.accent, defaults.accent)
  const lightTheme = isLightColor(background)
  const safePrimaryText = lightTheme ? '#2a1f1f' : '#ffffff'
  const safeMutedText = lightTheme ? '#5f5350' : '#d8d0ca'

  return {
    primary,
    secondary,
    accent,
    background,
    surface,
    textPrimary: ensureReadableText([background, surface], cssColor(raw.textPrimary, defaults.textPrimary), defaults.textPrimary, 6.2),
    textSecondary: ensureReadableText([background, surface], cssColor(raw.textSecondary, defaults.textSecondary), safeMutedText, 4.5),
    onPrimary: pickBestContrast(primary, '#ffffff', safePrimaryText),
    onPrimaryMuted: pickBestContrast(primary, lightTheme ? '#f8efea' : '#f5ede8', lightTheme ? '#4d403d' : '#f5ede8'),
  }
}

function ensureReadableText(backgrounds: string[], preferred: string, fallback: string, minRatio: number): string {
  const valid = backgrounds.filter((color) => !!parseCssColor(color))
  if (valid.length && valid.every((bg) => contrastRatio(bg, preferred) >= minRatio)) return preferred
  if (valid.length && valid.every((bg) => contrastRatio(bg, fallback) >= minRatio)) return fallback
  return pickBestContrast(valid[0] || '#ffffff', '#111111', '#ffffff')
}

function pickBestContrast(background: string, optionA: string, optionB: string): string {
  return contrastRatio(background, optionA) >= contrastRatio(background, optionB) ? optionA : optionB
}

function isLightColor(color: string): boolean {
  return relativeLuminance(color) > 0.56
}

function contrastRatio(a: string, b: string): number {
  const lumA = relativeLuminance(a)
  const lumB = relativeLuminance(b)
  const light = Math.max(lumA, lumB)
  const dark = Math.min(lumA, lumB)
  return (light + 0.05) / (dark + 0.05)
}

function relativeLuminance(color: string): number {
  const rgb = parseCssColor(color)
  if (!rgb) return 0
  const channels = [rgb.r, rgb.g, rgb.b].map((value) => {
    const srgb = value / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function parseCssColor(color: string): { r: number; g: number; b: number } | null {
  const value = String(color || '').trim().toLowerCase()
  if (/^#([0-9a-f]{3})$/i.test(value)) {
    const hex = value.slice(1)
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    }
  }
  if (/^#([0-9a-f]{6})$/i.test(value)) {
    return {
      r: parseInt(value.slice(1, 3), 16),
      g: parseInt(value.slice(3, 5), 16),
      b: parseInt(value.slice(5, 7), 16),
    }
  }
  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (rgb) {
    return {
      r: Math.max(0, Math.min(255, Number(rgb[1]))),
      g: Math.max(0, Math.min(255, Number(rgb[2]))),
      b: Math.max(0, Math.min(255, Number(rgb[3]))),
    }
  }
  return null
}

async function failOrRetry(supabase: any, id: string, attempts: number, msg: string) {
  if (attempts >= MAX_ATTEMPTS) {
    await supabase.from('generated_sites').update({
      status: 'failed',
      error_message: `${msg} (max ${MAX_ATTEMPTS} attempts reached)`,
    }).eq('id', id)
  } else {
    await supabase.from('generated_sites').update({
      status: 'queued',
      queued_at: new Date().toISOString(),
      error_message: `Retrying (attempt ${attempts}/${MAX_ATTEMPTS}): ${msg}`,
    }).eq('id', id)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
