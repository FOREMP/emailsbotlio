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
const MODEL = 'deepseek/deepseek-chat-v3.1'
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
    useLeadImages: false, // Skip lead-scraped images — too much risk of broken/blocked thumbnails
    stockImages: [
      // Curated Unsplash — salon interiors first (used as hero via img(0)),
      // then styling / color / product / portrait shots for gallery slots.
      // All 1600w, q=80. Ordered interior-first so hero picks look editorial.
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
      'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=1600&q=80', // barber-style cut portrait
      'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=1600&q=80', // combs / tools
      'https://images.unsplash.com/photo-1633681926035-ec1ac984418a?w=1600&q=80', // modern interior detail
    ],
    heroLine1Default: (city) => `Din frisör${city ? ' i ' + city : ''}.`,
    heroLine2Default: 'Vi lyfter håret — och känslan när du går härifrån.',
    heroEyebrowDefault: (city) => city ? `Frisörsalong i ${city}` : 'Frisörsalong',
    heroSublineDefault: 'Personlig rådgivning, hantverk och färgteknik för hår som känns lika bra som det ser ut. Från vardagsklippning till styling inför de större dagarna.',
    aboutTitleDefault: 'Håret förtjänar mer än ett snabbt besök',
    aboutEyebrow: 'Hantverk & känsla',
    pathwaysHeading: 'Vilken väg passar dig — låt oss guida dig rätt',
    scenariosHeading: 'Så jobbar vi bakom stolen',
    scenariosIntro: 'Här är typiska besök vi tar emot varje vecka — så du känner igen dig och vet vad du kan förvänta dig.',
    processHeading: 'Tre steg till hår du älskar',
    diffHeading: 'Fyra saker du märker redan vid första besöket',
    ctaTitleDefault: 'Boka tid — vi guidar dig till rätt behandling',
    ctaTextDefault: 'Berätta vad du vill åstadkomma så matchar vi dig med rätt frisör och behandling.',
    contactHeadline: 'Boka din tid',
    contactSubline: 'Ring eller mejla oss — vi hjälper dig hitta rätt behandling och tid som passar.',
    servicesPageSub: 'Varje behandling är beskriven så att du vet vad som ingår och när den passar dig bäst.',
    footerTagline: 'Demo skapad för en modernare digital salongsupplevelse.',
    fallbackServices: [
      { name: 'Klippning', description: 'Personlig klippning anpassad efter hårets form, textur och din vardag.' },
      { name: 'Färgning', description: 'Färg som håller länge och tar hand om håret — från ombyten till diskreta uppfräschningar.' },
      { name: 'Slingor & balayage', description: 'Handmålade ljuspartier för naturlig dimension och mjuka övergångar.' },
      { name: 'Styling & uppsättning', description: 'Styling inför bröllop, fest eller fotografering — professionellt och långhållbart.' },
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
      { eyebrow: 'NY LOOK', title: 'Boka klippning', description: 'När det är dags för en ny form eller en fräschare vardagsklippning.', ctaLabel: 'Boka klippning' },
      { eyebrow: 'FÄRG & TON', title: 'Boka färgning', description: 'Från fullfärg till subtila toningar som lyfter det du redan har.', ctaLabel: 'Boka färg' },
      { eyebrow: 'LJUSARE HÅR', title: 'Boka slingor eller balayage', description: 'Handmålade ljuspartier för naturlig dimension.', ctaLabel: 'Boka slingor' },
      { eyebrow: 'HÄNDELSER', title: 'Boka uppsättning eller styling', description: 'Styling som håller — även efter en lång kväll.', ctaLabel: 'Boka styling' },
    ],
    systemPrompt: `Du är en senior svensk copywriter och art director för PREMIUM frisörsalongssajter i klass med de bästa nordiska varumärkena inom hår och beauty. Ton: modernt, självsäkert, editoriellt, taktilt. Bygg förtroende via HANTVERK, PERSONLIG RÅDGIVNING och KÄNSLA — inte genom siffror eller påhittade certifikat.

VIKTIGT: Skriv INTE HTML. Returnera bara giltig JSON enligt schemat nedan. HTML byggs av systemet.

RETURFORMAT — endast JSON, ingen markdown, inga kommentarer:
{
  "businessName": "...",
  "tagline": "kort premium tagline",
  "heroEyebrow": "kort label, t.ex. 'Frisörsalong i {ort}'",
  "heroLine1": "första raden (3–6 ord, editoriell)",
  "heroLine2": "andra raden (3–7 ord, kontrast/löfte)",
  "heroSubline": "1–2 meningar som förklarar värdet konkret",
  "trustBadges": ["Personlig konsultation", "Skonsam teknik", "Hantverk hela vägen"],
  "pathwaysIntro": "1 mening om att guida kunden rätt in",
  "pathways": [
    {"eyebrow":"NY LOOK","title":"Boka klippning","description":"...","ctaLabel":"Boka klippning"},
    {"eyebrow":"FÄRG & TON","title":"Boka färgning","description":"...","ctaLabel":"Boka färg"},
    {"eyebrow":"LJUSARE HÅR","title":"Boka slingor / balayage","description":"...","ctaLabel":"Boka slingor"},
    {"eyebrow":"HÄNDELSER","title":"Boka uppsättning","description":"...","ctaLabel":"Boka styling"}
  ],
  "services": [{"name":"...","description":"vad behandlingen är","when":"'När:' — kort rad om när kunden ska välja den"}],
  "aboutTitle": "editoriell rubrik, gärna 2 rader",
  "aboutIntro": "1 stark manifest-mening",
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
  "ctaText": "1 mening som får kunden att boka"
}

ABSOLUTA REGLER:
1. Hitta ALDRIG på adresser, telefon, priser, öppettider, årtal, statistik, certifieringar, kundnamn eller citat.
2. "scenarios" = TYPISKA besök salongen tar emot — inte påhittade referenser. Skriv aldrig kundnamn.
3. Om ett fält saknar grund, utelämna det.
4. Om business_name saknas eller ser ut som HTTP-fel/domän utan namn, returnera {"error":"invalid business name"}.
5. Extrahera 4–7 verkliga behandlingar från källdatan. Vid oklarhet: standard frisör­behandlingar (klippning, färg, slingor, styling) utan pris.
6. Language = svenska. Ton = editoriell, taktil, självsäker — undvik "vi erbjuder marknadens bästa".
7. heroLine1 + heroLine2 = premium headline tillsammans.
8. Max 4500 tokens totalt.`,
    polishSystemPrompt: `Du är en senior svensk copywriter för premium frisörsalongssajter.

Skriv om ALLA textfält i det medskickade JSON-objektet till naturlig, flytande svenska av hög kvalitet. Ton: modernt, självsäkert, editoriellt, taktilt.

ABSOLUTA REGLER:
1. Behåll EXAKT samma JSON-struktur, samma nycklar, samma antal element i arrays.
2. Hitta ALDRIG på nya fakta (adresser, telefon, priser, årtal, certifieringar, kundnamn).
3. Fixa styltiga meningar, konstig ordföljd, saknad interpunktion, för långa meningar, upprepningar, klichéer.
4. Varje textblock ska ha varierad meningslängd. Undvik att alla meningar börjar med "Vi".
5. heroLine1 + heroLine2 = korta, slagkraftiga rader (3–7 ord vardera) med punkt i slutet.
6. Om ett fält är tomt — låt det vara tomt.
7. Svara med ENBART det uppdaterade JSON-objektet.`,
  },
}

function nicheFromTemplate(template: string | null | undefined): NicheConfig {
  if (template === 'hair_salon_v1') return NICHE_CONFIG.hair_salon
  return NICHE_CONFIG.auto_workshop
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
      .select('id, contact_id, source_url, scraped_content, template, attempts')
      .maybeSingle()
    if (claimErr || !claimed) return json({ ok: true, message: 'lost race, another worker claimed it' })

    const site = claimed as any
    const nc = nicheFromTemplate(site.template)

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
      .select('first_name, last_name, email, company, custom_fields')
      .eq('id', site.contact_id)
      .single()

    const branding = scraped.branding ?? {}
    const cf = (contact?.custom_fields ?? {}) as Record<string, unknown>


    // Full brand palette (fall back to premium dark when missing)
    const bc = branding.colors ?? {}
    const brandPalette = {
      primary: bc.primary || branding.primaryColor || '#f97316',
      secondary: bc.secondary || bc.accent || '#0ea5e9',
      accent: bc.accent || bc.secondary || '#f59e0b',
      background: bc.background || '#0a0e1a',
      surface: bc.surface || bc.card || '#131a2b',
      textPrimary: bc.textPrimary || bc.text || '#f1f5f9',
      textSecondary: bc.textSecondary || bc.muted || '#94a3b8',
    }
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
      business_name: (cf.company ?? contact?.company ?? pages.home?.title ?? scraped.title ?? '').toString().trim() || null,
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
      `Skapa en kompakt innehållsplan för en 3-sidig premium-sajt för denna ${nc.label.toLowerCase()}. Skriv ENDAST JSON enligt schemat.`,
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
      const timeoutId = setTimeout(() => controller.abort(), 60_000)
      try {
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
              { role: 'system', content: nc.systemPrompt },
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

        // Heartbeat between the two AI calls so the reaper doesn't false-positive
        await supabase.from('generated_sites').update({ updated_at: new Date().toISOString() }).eq('id', generated_site_id)

        const polished = await polishCopyWithClaude({
          plan: parsed,
          facts,
          openrouterKey,
          nc,
        }).catch((e) => {
          console.warn('copy polish failed, using DeepSeek plan:', (e as Error).message)
          return parsed!
        })

        const files = buildSiteFiles({
          plan: polished,
          facts,
          brandPalette,
          brandFonts,
          imagePool,
          googleMapsUrl,
          nc,
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
  const trustBadges = (plan.trustBadges || []).map(cleanText).filter(Boolean).slice(0, 3)
  const images = imagePool.filter((url) => /^https?:\/\//i.test(url)).slice(0, 10)
  const img = (i: number) => images[i % Math.max(images.length, 1)] || nc.stockImages[0]
  const hasContact = Boolean(phone || email || address)
  const primaryHref = phone ? `tel:${phone.replace(/\s+/g, '')}` : email ? `mailto:${email}` : null
  const primaryLabel = phone ? 'Ring nu' : email ? 'Mejla oss' : null
  const bookLabel = 'Boka tid'
  const displayFont = brandFonts[0] || 'Space Grotesk'

  const common = (active: 'home' | 'about' | 'services', title: string, body: string) => `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} | ${esc(businessName)}</title>
  <meta name="description" content="${esc(plan.tagline || plan.heroSubline || `${businessName} – ${nc.metaDescSuffix}`)}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(displayFont).replace(/%20/g, '+')}:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root{--primary:${cssColor(brandPalette.primary,'#f97316')};--secondary:${cssColor(brandPalette.secondary,'#0ea5e9')};--accent:${cssColor(brandPalette.accent,'#f59e0b')};--bg:${cssColor(brandPalette.background,'#0a0e1a')};--surface:${cssColor(brandPalette.surface,'#131a2b')};--surface-2:color-mix(in srgb,var(--surface) 70%,var(--bg));--text:${cssColor(brandPalette.textPrimary,'#f1f5f9')};--text-muted:${cssColor(brandPalette.textSecondary,'#94a3b8')};--border:color-mix(in srgb,var(--text) 10%,transparent);--font-display:'${cssString(displayFont)}',Space Grotesk,sans-serif;--font-body:Inter,sans-serif}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);line-height:1.6;-webkit-font-smoothing:antialiased}a{color:inherit}img{max-width:100%;display:block}
    .nav{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
    .nav-inner{max-width:1280px;margin:0 auto;padding:18px 28px;display:flex;align-items:center;justify-content:space-between;gap:24px}
    .brand{font-family:var(--font-display);font-size:20px;font-weight:800;letter-spacing:-.02em;text-decoration:none}
    .links{display:flex;gap:4px;align-items:center}
    .links a{padding:10px 14px;border-radius:10px;text-decoration:none;color:var(--text-muted);font-weight:600;font-size:14px;transition:.2s}
    .links a.active,.links a:hover{background:color-mix(in srgb,var(--primary) 14%,transparent);color:var(--text)}
    .nav-cta{background:var(--primary)!important;color:var(--bg)!important;padding:11px 18px!important;box-shadow:0 8px 28px color-mix(in srgb,var(--primary) 40%,transparent)}
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
    .btn.primary{background:var(--primary);color:var(--bg);border-color:var(--primary);box-shadow:0 16px 40px color-mix(in srgb,var(--primary) 34%,transparent)}
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
    .cta-band{background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 60%,var(--accent)));color:var(--bg);text-align:center;padding:100px 28px;border-radius:28px;margin:40px auto;max-width:1280px}
    .cta-band h2{color:var(--bg);margin:0 auto;max-width:800px}
    .cta-band .lead{color:color-mix(in srgb,var(--bg) 78%,var(--primary));margin:20px auto 0;font-size:19px}
    .cta-band .btn{border-color:var(--bg)}
    .cta-band .btn.primary{background:var(--bg);color:var(--primary);border-color:var(--bg);box-shadow:0 20px 50px rgba(0,0,0,.3)}
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
    .contact-item a{color:var(--text);font-weight:600;text-decoration:none;font-size:17px}
    .map{width:100%;height:420px;border:0;border-radius:20px}
    footer{padding:80px 28px 40px;border-top:1px solid var(--border);color:var(--text-muted);background:var(--surface-2)}
    .footer-grid{display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:56px}
    .footer-title{font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--text);margin-bottom:16px;text-transform:uppercase;letter-spacing:.12em}
    .footer-grid a{color:var(--text-muted);text-decoration:none;display:block;padding:4px 0;font-size:15px}
    .footer-grid a:hover{color:var(--primary)}
    .foot-bottom{margin-top:60px;padding-top:24px;border-top:1px solid var(--border);text-align:center;font-size:14px}
    @media(max-width:900px){.nav-inner{padding:14px 20px}.links a{padding:8px 10px;font-size:13px}.section,.section-sm{padding:70px 20px}.hero{min-height:auto;padding:100px 20px}.g-4,.g-3,.g-2,.about-split,.diff-grid,.contact-grid,.footer-grid{grid-template-columns:1fr}.service-row{grid-template-columns:1fr;gap:32px;padding:60px 0}.service-row.rev>.s-media{order:0}.service-row img,.photo{height:340px}.cta-band{padding:70px 24px;border-radius:20px}}
  </style>
</head>
<body>
  ${nav(active, businessName, primaryHref, primaryLabel, hasContact)}
  ${body}
  ${footer(businessName, plan.tagline, { phone, email, address }, nc)}
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

  const trustRow = trustBadges.length
    ? `<div class="trust-row">${trustBadges.map((b) => `<span>${esc(b)}</span>`).join('')}</div>`
    : ''

  const pathwaysSection = pathways.length
    ? `<section class="section band-tight"><div class="wrap"><div class="eyebrow">Rätt väg in</div><h2 class="h2">${esc(nc.pathwaysHeading)}</h2>${plan.pathwaysIntro ? `<p class="lead lg" style="margin-top:20px">${esc(plan.pathwaysIntro)}</p>` : ''}<div class="grid g-4" style="margin-top:52px">${pathways.map((p) => `<div class="card path-card"><div class="eyebrow" style="margin-bottom:14px">${esc(p.eyebrow)}</div><h3>${esc(p.title)}</h3><p>${esc(p.description)}</p><a class="arrow" href="tjanster.html">${esc(p.ctaLabel || 'Läs mer')}</a></div>`).join('')}</div></div></section>`
    : ''

  const aboutTeaser = (plan.aboutBefore || plan.aboutDuring || plan.aboutAfter || plan.aboutIntro) ? `
    <section class="section"><div class="wrap"><div class="about-split"><div><div class="eyebrow">${esc(nc.aboutEyebrow)}</div><h2 class="h2">${esc(plan.aboutTitle || nc.aboutTitleDefault)}</h2>${plan.aboutIntro ? `<p class="lead lg" style="margin-top:24px">${esc(plan.aboutIntro)}</p>` : ''}<div class="btns"><a class="btn" href="om-oss.html">${esc(nc.aboutPageTitle)}</a>${primaryCta}</div></div><div class="about-blocks">${plan.aboutBefore ? `<div class="about-block"><h4>Före besöket</h4><p>${esc(plan.aboutBefore)}</p></div>` : ''}${plan.aboutDuring ? `<div class="about-block"><h4>Under arbetet</h4><p>${esc(plan.aboutDuring)}</p></div>` : ''}${plan.aboutAfter ? `<div class="about-block"><h4>Efter arbetet</h4><p>${esc(plan.aboutAfter)}</p></div>` : ''}</div></div></div></section>` : ''

  const scenariosSection = scenarios.length >= 2 ? `
    <section class="section band"><div class="wrap"><div class="eyebrow">Resultat</div><h2 class="h2">${esc(nc.scenariosHeading)}</h2><p class="lead lg" style="margin-top:20px">${esc(nc.scenariosIntro)}</p><div class="grid g-3" style="margin-top:52px">${scenarios.map((s, i) => `<div class="scenario"><img src="${attr(img(i + 2))}" alt="${esc(s.title)}"><div class="scenario-body"><div class="tag">${esc(s.category)}</div><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p><div class="delivery"><strong>Leverans:</strong> ${esc(s.delivery)}</div></div></div>`).join('')}</div></div></section>` : ''

  const processSection = processSteps.length >= 3 ? `
    <section class="section"><div class="wrap"><div class="eyebrow">Så märks det i praktiken</div><h2 class="h2">${esc(nc.processHeading)}</h2><div class="grid g-3" style="margin-top:56px">${processSteps.map((s, i) => `<div><div class="num">${String(i + 1).padStart(2, '0')}</div><h3 class="h3">${esc(s.title)}</h3><p class="lead" style="font-size:16px;margin-top:12px">${esc(s.description)}</p>${s.outcome ? `<div class="step-outcome">${esc(s.outcome)}</div>` : ''}</div>`).join('')}</div></div></section>` : ''

  const diffSection = differentiators.length >= 3 ? `
    <section class="section band-tight"><div class="wrap"><div class="eyebrow">Så arbetar vi</div><h2 class="h2">${esc(nc.diffHeading)}</h2><div class="diff-grid">${differentiators.map((d) => `<div class="diff"><h3>${esc(d.title)}</h3><p>${esc(d.text)}</p></div>`).join('')}</div></div></section>` : ''

  const finalCta = `
    <section class="section-sm"><div class="cta-band"><div class="eyebrow" style="color:var(--bg);background:color-mix(in srgb,var(--bg) 20%,transparent);border-color:color-mix(in srgb,var(--bg) 30%,transparent)">Nästa steg</div><h2 class="h2">${esc(plan.ctaTitle || nc.ctaTitleDefault)}</h2><p class="lead">${esc(plan.ctaText || nc.ctaTextDefault)}</p><div class="btns">${primaryCta}${bookCta}</div></div></section>`

  const homeBody = `
    <section class="hero"><img src="${attr(img(0))}" alt="${esc(businessName)}"><div class="hero-inner"><div class="eyebrow">${esc(heroEyebrow)}</div><h1 class="h1"><span class="line">${esc(heroLine1)}</span><span class="line accent">${esc(heroLine2)}</span></h1><p class="lead lg">${esc(heroSub)}</p><div class="btns">${primaryCta}${bookCta}</div>${trustRow}</div></section>
    ${pathwaysSection}
    ${aboutTeaser}
    ${scenariosSection}
    ${processSection}
    ${diffSection}
    ${finalCta}
    ${contactSection({ phone, email, address, googleMapsUrl, nc })}`

  const aboutBody = `
    ${pageHero(nc.aboutPageTitle, plan.aboutTitle || `Möt ${businessName}`, plan.aboutIntro || plan.tagline || '', img(1))}
    ${(plan.aboutBefore || plan.aboutDuring || plan.aboutAfter) ? `<section class="section"><div class="wrap about-split"><img class="photo" src="${attr(img(2))}" alt="${esc(businessName)}"><div class="about-blocks">${plan.aboutBefore ? `<div class="about-block"><h4>Före besöket</h4><p>${esc(plan.aboutBefore)}</p></div>` : ''}${plan.aboutDuring ? `<div class="about-block"><h4>Under arbetet</h4><p>${esc(plan.aboutDuring)}</p></div>` : ''}${plan.aboutAfter ? `<div class="about-block"><h4>Efter arbetet</h4><p>${esc(plan.aboutAfter)}</p></div>` : ''}</div></div></section>` : ''}
    ${values.length ? `<section class="section band-tight"><div class="wrap"><div class="eyebrow">Vad vi står för</div><h2 class="h2">Tryggare känsla hela vägen</h2><div class="grid g-3" style="margin-top:48px">${values.map((v) => `<div class="card"><h3 class="h3">${esc(v.title)}</h3><p style="color:var(--text-muted);margin:14px 0 0">${esc(v.text)}</p></div>`).join('')}</div></div></section>` : ''}
    ${diffSection}
    ${finalCta}`

  const servicesBody = `
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
  return `<nav class="nav"><div class="nav-inner"><a class="brand" href="index.html">${esc(businessName)}</a><div class="links"><a class="${a('home')}" href="index.html">Hem</a><a class="${a('about')}" href="om-oss.html">Om oss</a><a class="${a('services')}" href="tjanster.html">Tjänster</a>${contactLink}${cta}</div></div></nav>`
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
  const wrapClass = hasValidMap ? 'wrap contact' : 'wrap'
  const map = hasValidMap
    ? `<iframe class="map" src="${attr(googleMapsUrl!)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`
    : ''
  return `<section id="kontakt" class="section band"><div class="${wrapClass}"><div><div class="eyebrow">Kontakt</div><h2 class="h2">${esc(nc.contactHeadline)}</h2><p class="lead">${esc(nc.contactSubline)}</p><div class="contact-list" style="margin-top:24px">${rows}</div></div>${map}</div></section>`
}

function footer(businessName: string, tagline: string | undefined, contact: { phone: string; email: string; address: string }, nc: NicheConfig): string {
  const contactRows = [contact.phone, contact.email, contact.address].filter(Boolean).map(esc).join('<br>')
  const hasContact = Boolean(contactRows)
  const cols = hasContact ? '1.5fr 1fr 1fr' : '1.5fr 1fr'
  const contactCol = hasContact ? `<div><div class="footer-title">Kontakt</div><p>${contactRows}</p></div>` : ''
  const navContact = hasContact ? `<br><a href="index.html#kontakt">Kontakt</a>` : ''
  return `<footer><div class="wrap"><div class="footer-grid" style="grid-template-columns:${cols}"><div><div class="footer-title">${esc(businessName)}</div><p>${esc(tagline || nc.footerTagline)}</p></div><div><div class="footer-title">Navigering</div><p><a href="index.html">Hem</a><br><a href="om-oss.html">${esc(nc.aboutPageTitle)}</a><br><a href="tjanster.html">Tjänster</a>${navContact}</p></div>${contactCol}</div><p style="margin-top:42px;border-top:1px solid color-mix(in srgb,var(--text) 8%,transparent);padding-top:24px">© ${CURRENT_YEAR} ${esc(businessName)} — Demo skapad av Botlio</p></div></footer>`
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
