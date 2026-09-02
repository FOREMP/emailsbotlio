export type BlockTemplateFamilyKey =
  | 'clinic_private_care'
  | 'mechanic_precision_workshop'
  | 'salon_editorial_luxury'
  | 'bistro_atmospheric_landing'
  | 'byggform_architectural_trust'
  | 'service_company_modern'
  | 'service_clarity_default'

export interface BlockTemplatePage {
  slug: string
  title: string
  purpose: string
  sections: string[]
  pageKind: 'landing' | 'services' | 'process' | 'about' | 'faq' | 'contact'
}

export interface BlockTemplateFamily {
  key: BlockTemplateFamilyKey
  label: string
  mode: 'full_site' | 'landing_page'
  bestFor: string[]
  avoidFor: string[]
  sourcePrototype: string
  notesFromEric: string[]
  aiDecisionNotes: string[]
  blocks: string[]
}

export const BLOCK_TEMPLATE_FAMILIES: Record<BlockTemplateFamilyKey, BlockTemplateFamily> = {
  clinic_private_care: {
    key: 'clinic_private_care',
    label: 'Private clinic and therapeutic care site',
    mode: 'full_site',
    sourcePrototype: 'clinic_private_v1/*.html',
    bestFor: [
      'privata kliniker, tandläkare, terapi, psykolog, fysioterapi, naprapat, kiropraktor, hälsoklinik och liknande vård-/samtalsnära verksamheter',
      'företag där sidan ska kännas lugn, professionell, diskret och mänsklig snarare än glamorös eller säljig',
      'verksamheter där förtroende, tydlig första kontakt och ett privat första steg väger tyngre än stora bildytor eller hård kampanjkänsla',
    ],
    avoidFor: [
      'frisör/skönhet/naglar/fransar där salon_editorial_luxury passar bättre',
      'restaurang/bar/bistro där bistro_atmospheric_landing passar bättre',
      'bygg/projektbolag eller breda serviceföretag där andra familjer säljer tydligare',
    ],
    notesFromEric: [
      'Headern ska vara ren med bara företagsnamnet till vänster, inget märke eller box.',
      'Den här mallen ska kunna användas för många kliniktyper, inte bara exakt den visade exempelkliniken.',
      'Känslan ska vara trygg, modern och genomtänkt — inte kall, plastig eller som en skönhetssalong.',
    ],
    aiDecisionNotes: [
      'Använd lugn och förtroendeskapande copy. Skriv som en privat klinik eller terapeutisk mottagning, inte som en reklamsida.',
      'Hitta aldrig på legitimationer, behandlingsresultat, priser, betyg, grundarår, personalnamn, tillgänglighet eller specialiteter om de inte finns i källan.',
      'Om kategorin är tandläkare, terapi, fysioterapi eller liknande ska språket följa just den vårdformen. Undvik skönhetsspråk om kategorin inte stödjer det.',
      'FAQ ska fokusera på första kontakt, besök, integritet, bokning och hur processen går till. Använd bara frågor som passar kategori och källa.',
    ],
    blocks: [
      'header_private_care_nav',
      'hero_private_clinic_statement',
      'care_paths_editorial_rows',
      'people_and_approach_split',
      'trust_band_confidential',
      'gallery_industry_relevant',
      'visit_panel_calm',
      'faq_private_visit_optional',
      'cta_soft_conversion',
      'footer_private_care',
    ],
  },
  mechanic_precision_workshop: {
    key: 'mechanic_precision_workshop',
    label: 'Precision mechanic and workshop site',
    mode: 'full_site',
    sourcePrototype: 'mechanic_precision_v1/*.html',
    bestFor: [
      'bilverkstad, mekaniker, auto service, däck, bromsar, felsökning, rekond-nära verkstadstjänster och andra tydligt fordonsnära verkstäder',
      'företag där sidan ska kännas teknisk, trygg, metodisk och premium utan att se ut som en generisk verkstadsmall',
      'verkstäder där process, förklaring, diagnos och tydlig inlämning är centralt för konvertering',
    ],
    avoidFor: [
      'serviceföretag utanför fordonsvärlden',
      'bygg/service/klinik/salong/restaurang där andra mallfamiljer passar bättre',
    ],
    notesFromEric: [
      'Den här mallen ska vara mechanic-only.',
      'Headern ska vara ren med bara företagsnamnet till vänster, inget märke eller box.',
      'Känslan ska vara tydlig, modern och seriös — inte billig, rörig eller för bred för andra nischer.',
    ],
    aiDecisionNotes: [
      'Skriv för en riktig verkstad. Fokusera på service, felsökning, reparation, inlämning, godkännande och tydlig kommunikation.',
      'Hitta aldrig på garantier, betyg, års erfarenhet, tillgänglighet samma dag, specialverktyg, märkesexpertis eller verkstadsstorlek om källan inte stödjer det.',
      'Behåll tonen praktisk och kunnig. Undvik salongs-, klinik- eller byggspråk helt.',
      'FAQ ska handla om bokning, diagnos, uppskattning, inlämning, reparationstid och hur verkstadsbesöket går till.',
    ],
    blocks: [
      'header_precision_workshop_nav',
      'hero_mechanic_confidence',
      'service_cards_workshop',
      'process_diagnostics_band',
      'workshop_standard_story',
      'gallery_industry_relevant',
      'visit_route_panel',
      'faq_workshop_optional',
      'cta_book_service_band',
      'footer_workshop_structured',
    ],
  },
  salon_editorial_luxury: {
    key: 'salon_editorial_luxury',
    label: 'Editorial premium service site',
    mode: 'full_site',
    sourcePrototype: 'hairsalons.html',
    bestFor: [
      'frisör, barberare, skönhet, naglar, fransar, bryn, spa, massage, klinik, wellness',
      'visuella och personliga lokala serviceföretag där känsla, förtroende och bildytor säljer',
      'premiumpositionering där sidan ska kännas värd 5000 SEK+ och inte som en billig AI-sida',
    ],
    avoidFor: [
      'restaurang/bar/bistro när bistro_atmospheric_landing passar bättre',
      'el, VVS, bygg, bilverkstad och andra praktiska yrken där tydlighet/process/trust bör väga tyngre än editorial känsla',
    ],
    notesFromEric: [
      'Hairsalon-sidan känns bra och ska sparas som en flexibel stil, inte bara för hårsalonger.',
      'Den ska kunna återanvändas för många företag där en varm, modern och personlig känsla hjälper konvertering.',
      'Undvik delar som låter som en intern demo eller en webbyråpresentation; texten ska kännas som företagets egen röst.',
    ],
    aiDecisionNotes: [
      'Använd stora bildytor, varm editorial rytm, tydlig mobil kontakt och flera sektioner som känns handgjorda.',
      'Variera ordningen och tyngden mellan sidorna utifrån underlaget: om det finns många tjänster, gör tjänstesidan starkare; om underlaget är tunt, gör startsidan mer atmosfärisk men saklig.',
      'Använd företagets uppladdade kategori som sanning. Skriv inte salong/klinik/behandling om kategorin inte stödjer det.',
      'FAQ ska handla om riktiga frågor kunder har före bokning/kontakt, aldrig om webbplatsen.',
    ],
    blocks: [
      'header_sticky_editorial_nav',
      'hero_editorial_split',
      'offerings_visual_cards',
      'experience_story_dual_visual',
      'gallery_atmospheric_mosaic',
      'about_warm_brand_story',
      'faq_practical_visit_details',
      'contact_booking_panel',
      'footer_minimal_brand',
    ],
  },
  bistro_atmospheric_landing: {
    key: 'bistro_atmospheric_landing',
    label: 'Atmospheric restaurant landing page',
    mode: 'landing_page',
    sourcePrototype: 'bistro-norr.html',
    bestFor: [
      'restaurang, bistro, bar, café, pizzeria, catering, bageri och mat/dryck nära restaurang',
      'företag där en enda stark landningssida ofta räcker: känsla, meny/rätter, besök, kontakt och bokning',
    ],
    avoidFor: [
      'hår, skönhet, klinik, massage och andra serviceföretag',
      'yrken som el, VVS, bygg, bilverkstad och städ där restaurangbilder/menyspråk skulle kännas fel',
    ],
    notesFromEric: [
      'Bistro-sidan är bra men ska vara landingpage only för restaurang och nära nischer som bar och bistro.',
      'Den ska inte användas för breda lokala serviceföretag.',
    ],
    aiDecisionNotes: [
      'Bygg en enda index.html med tydlig intern navigation till sektioner, inte flera undersidor.',
      'Fokusera på stämning, mat/dryck, besök, bokning och praktisk kontakt.',
      'Hitta inte på meny, öppettider, priser, recensioner eller bokningspolicy. Om sådant saknas: skriv försiktigt och be kunden kontakta företaget.',
      'Bilder ska kännas restaurang/bar/café: mat, dukning, interiör, kvällsljus, dryck.',
    ],
    blocks: [
      'hero_restaurant_atmospheric',
      'menu_highlight_cards',
      'restaurant_story',
      'gallery_food_mosaic',
      'visit_info_panel',
      'faq_visit_details',
      'reserve_panel',
      'footer_restaurant_minimal',
    ],
  },
  byggform_architectural_trust: {
    key: 'byggform_architectural_trust',
    label: 'Architectural trust and process site',
    mode: 'full_site',
    sourcePrototype: 'byggform-syd/*.html',
    bestFor: [
      'bygg, renovering, snickeri, tak, måleri, markarbete, VVS, el, städ, tekniska tjänster och andra projektbaserade lokala företag',
      'nischer där bilder kan vara färre och sidan i stället ska sälja tydlighet, process, offert, frågor och förtroende',
      'företag där kunden behöver förstå omfattning, nästa steg, underlag och hur kontakten går till innan köp',
    ],
    avoidFor: [
      'restaurang/bar/bistro där mat, atmosfär och besök ska bära sidan',
      'hår/skönhet/wellness där varma bildytor och känsla ofta säljer bättre',
      'företag där källan saknar nog frågor/process/serviceunderlag och en kortare default-sida blir tryggare',
    ],
    notesFromEric: [
      'Byggform Syd-sidorna är bra och ska sparas innan publicering.',
      'Sidorna kan användas i många olika nischer, men passar bäst där det inte behövs många bilder.',
      'FAQ-sidan ska bara läggas till när systemet har tillräckligt med riktiga, passande frågor att fylla den med.',
      'FAQ ska byggas i sektioner så AI kan välja hur mycket som behövs och inte fylla med random frågor.',
    ],
    aiDecisionNotes: [
      'Använd en nordisk, arkitektonisk, låg-bild och textstark känsla: mycket luft, serif-rubriker, tydliga nummer, process och offertnära kontakt.',
      'Block från prototypen: fast header, stor hero, service-grid, process-timeline, trust/principles, content split med sticky aside, detail list, contact/quote panel, FAQ-kategorier och stark CTA.',
      'Anpassa språket till nischen. För elektriker/VVS/städ/bygg används ord som uppdrag, offert, service, planering och genomförande — inte salong/behandling/restaurang.',
      'FAQ-sidan ska delas i grupper, exempelvis Första kontakt, Planering/omfattning och Plats/genomförande. Ta bort grupper som saknar stöd i kategori eller källtext.',
      'Hitta inte på garantier, certifikat, ROT-avdrag, behörigheter, priser, geografiskt område eller tider om de inte finns i fakta/källa.',
    ],
    blocks: [
      'header_fixed_architectural_nav',
      'hero_construction_architectural',
      'construction_services_grid',
      'project_process_timeline',
      'trust_clarity_panel',
      'interior_page_hero',
      'service_detail_list',
      'content_split_sticky_aside',
      'feature_grid_practical_start',
      'about_values_grid',
      'image_split_material_detail_optional',
      'quote_contact_panel',
      'contact_requirements_cards',
      'faq_category_accordion_optional',
      'cta_band_architectural',
      'footer_structured_links',
    ],
  },
  service_company_modern: {
    key: 'service_company_modern',
    label: 'Confident premium service company site',
    mode: 'full_site',
    sourcePrototype: 'service_company_v1/*.html',
    bestFor: [
      'lokala serviceföretag med tydliga tjänster och kontaktvägar: el, VVS, städ, ventilation, lås, fastighetsservice, trädgård, montage, flytt, sanering och liknande',
      'företag där sidan ska kännas modern, trygg och premium utan att vara tung som ett bygg/offert-upplägg',
      'nischer där stark startsida, tydliga tjänstekort, bra kontaktsektion och valfri FAQ ger bättre konvertering än generisk AI-layout',
    ],
    avoidFor: [
      'restaurang/bar/bistro där bistro_atmospheric_landing passar bättre',
      'hår/skönhet/klinik/wellness där salon_editorial_luxury eller framtida klinikmall är bättre',
      'ren bygg/renovering/projektbolag där Byggform-familjen säljer bättre genom process, offert och FAQ-struktur',
    ],
    notesFromEric: [
      'Den här mallen ska fungera brett för servicebolag, inte bara en enda nisch.',
      'Headern ska vara ren: bara företagsnamnet i vänstra hörnet, ingen ikon/box.',
      'Before/after ska inte användas eftersom systemet sällan har rätt underlag för det.',
      'FAQ-sidan ska bara läggas till när det finns nog riktiga frågor och den ska kunna fyllas i sektioner.',
    ],
    aiDecisionNotes: [
      'Använd en tydlig men premium känsla: stark hero, förtroendeskapande kort, tydliga tjänster och rak kontakt utan billig mallkänsla.',
      'Startsidan ska kännas komplett, inte som en kort kampanjsida: kombinera erbjudande, företagets arbetssätt, relevanta bildytor, nästa steg och tydlig kontakt.',
      'Bildvalet ska följa den uppladdade kategorin. Takföretag ska visa tak/fastigheter, markföretag arbetsplats/markarbete, städföretag rena miljöer och så vidare.',
      'Håll copy företagsnära och kategoristyrd. Använd uppladdad kategori som sanning och skriv aldrig in HVAC, el, VVS eller andra specifika fackord om kategorin inte stödjer det.',
      'Sidan får gärna kännas modern och självsäker, men inte påhittad. Hitta aldrig på certifikat, jour, garantier, serviceområden, omdömen eller årtal.',
      'FAQ ska vara praktisk och relevant för köpbeslut, kontakt, besök eller utförande — aldrig om själva webbsidan.',
    ],
    blocks: [
      'header_clean_conversion_nav',
      'hero_confident_service_statement',
      'trust_badges_premium',
      'service_groups_clear_cards',
      'about_trust_story_split',
      'process_clear_next_steps',
      'gallery_industry_relevant',
      'contact_options_modern',
      'faq_layered_optional',
      'cta_direct_action_band',
      'footer_structured_service',
    ],
  },
  service_clarity_default: {
    key: 'service_clarity_default',
    label: 'Clear premium local service site',
    mode: 'full_site',
    sourcePrototype: 'current-v5-renderer',
    bestFor: [
      'el, VVS, bygg, bilverkstad, städ och andra praktiska lokala serviceföretag',
      'fall där kategori är oklar och vi behöver en säker struktur utan fel branschvinkel',
    ],
    avoidFor: [
      'restaurang/bar/bistro där en stark landingpage passar bättre',
      'hår/skönhet/wellness där editorial premium oftast ger mer wow',
    ],
    notesFromEric: [
      'Behåll den gamla säkra strukturen som fallback så fungerande nischer inte förstörs.',
    ],
    aiDecisionNotes: [
      'Prioritera tydlig service, trovärdighet, process, kontakt och mobil snabbhet.',
      'Använd inte salongs-, klinik- eller restaurangord om kategorin inte kräver det.',
      'Undvik stämningscopy som inte hjälper kunden förstå uppdraget.',
    ],
    blocks: [
      'header_mobile_safe_nav',
      'hero_clear_value_prop',
      'service_cards',
      'trust_process',
      'faq_practical_service',
      'contact_direct_panel',
      'footer_simple',
    ],
  },
}

export function blockTemplateFamilyCatalog(): Array<{
  key: BlockTemplateFamilyKey
  label: string
  mode: 'full_site' | 'landing_page'
  bestFor: string[]
  avoidFor: string[]
  notes: string[]
}> {
  return Object.values(BLOCK_TEMPLATE_FAMILIES).map((family) => ({
    key: family.key,
    label: family.label,
    mode: family.mode,
    bestFor: family.bestFor,
    avoidFor: family.avoidFor,
    notes: [...family.notesFromEric, ...family.aiDecisionNotes].slice(0, 8),
  }))
}

const RESTAURANT_RE = /(restaurang|restaurant|bistro|bar\b|pub\b|café|cafe|pizzeria|bageri|catering|mat|lunch|krog|diner|brasserie|trattoria)/i
const STRONG_BEAUTY_RE = /(frisör|frisor|hairdress|hair salon|hair studio|barber|salong|salon\b|nagel|nail|frans|lash|bryn|brow|makeup|smink|hudvård|skin care|skönhet|beauty|spa\b|stylist)/i
const CLINIC_PRIVATE_RE = /(klinik|clinic|tandläkare|dentist|dental|terapi|therapy|psykolog|counselling|counseling|fysioterap|physio|naprapat|kiropraktor|hälsa|halsa|wellbeing|wellness clinic|medical|medicinsk|vård|vard|rehab|rehabilitering)/i
const EDITORIAL_SERVICE_RE = /(frisör|frisor|hair|barber|salong|skönhet|beauty|nagel|nail|frans|bryn|lash|brow|spa\b|massage|klinik|clinic|hudvård|skin|wellness|terapi|terapeut|kosmetisk|makeup|stylist|studio)/i
const AUTOMOTIVE_RE = /(bilverkstad|mekaniker|auto|däck|bilservice|bilrekond|billack|bilglas|car repair|auto shop|tyre|motorverkstad)/i
const ARCHITECTURAL_TRUST_RE = /(bygg|renover|snick|tak|fasad|måleri|markarbete|anlägg|platt|kakel|badrum|golv|elektriker|elinstall|elfirma|vvs|rör|städ|lokalvård|flyttstäd|teknisk service|montage|installation|projekt|serviceföretag|entreprenad|underhåll|offert|förfrågan|planering|konsultation|företagstjänst|fastighet|lokal|hemservice)/i
const SERVICE_COMPANY_RE = /(service|installation|reparation|underhåll|jour|fastighetsservice|trädgård|flytt|sanering|lås|ventilation|solskydd|glas|målning|transport|bemanning|verkstadstjänst|städ|lokalvård|el|vvs|rör|montage|teknik|företagstjänst|hemtjänst|konsultation)/i

export function selectBlockTemplateFamily(input: {
  category?: string | null
  niche?: string | null
  nicheLabel?: string | null
  businessName?: string | null
  source?: string | null
}): BlockTemplateFamily {
  const category = normalize(input.category)
  const niche = normalize(input.niche)
  const nicheLabel = normalize(input.nicheLabel)
  const businessName = normalize(input.businessName)
  const source = normalize(input.source).slice(0, 1200)

  // The uploaded category is the strongest signal. It is what Eric maps from the scraper.
  const primary = [category, niche, nicheLabel, businessName].filter(Boolean).join(' ')
  if (RESTAURANT_RE.test(primary)) return BLOCK_TEMPLATE_FAMILIES.bistro_atmospheric_landing
  // Beauty wins over the clinic family: a salon that mentions "terapi" or "hälsa"
  // must not end up on the medical layout.
  if (STRONG_BEAUTY_RE.test(primary)) return BLOCK_TEMPLATE_FAMILIES.salon_editorial_luxury
  if (CLINIC_PRIVATE_RE.test(primary)) return BLOCK_TEMPLATE_FAMILIES.clinic_private_care
  if (EDITORIAL_SERVICE_RE.test(primary)) return BLOCK_TEMPLATE_FAMILIES.salon_editorial_luxury
  if (AUTOMOTIVE_RE.test(primary)) return BLOCK_TEMPLATE_FAMILIES.mechanic_precision_workshop
  if (ARCHITECTURAL_TRUST_RE.test(primary)) return BLOCK_TEMPLATE_FAMILIES.byggform_architectural_trust
  if (SERVICE_COMPANY_RE.test(primary)) return BLOCK_TEMPLATE_FAMILIES.service_company_modern

  // If the lead already has a category and it is not a known restaurant/beauty/auto/build case,
  // prefer the broad premium service-company family instead of the old generic fallback.
  if (category) return BLOCK_TEMPLATE_FAMILIES.service_company_modern

  // Source text is intentionally weaker so a random scraped word does not hijack the niche.
  if (!category && RESTAURANT_RE.test(source)) return BLOCK_TEMPLATE_FAMILIES.bistro_atmospheric_landing
  if (!category && CLINIC_PRIVATE_RE.test(source)) return BLOCK_TEMPLATE_FAMILIES.clinic_private_care
  if (!category && EDITORIAL_SERVICE_RE.test(source)) return BLOCK_TEMPLATE_FAMILIES.salon_editorial_luxury
  if (!category && AUTOMOTIVE_RE.test(source)) return BLOCK_TEMPLATE_FAMILIES.mechanic_precision_workshop
  if (!category && ARCHITECTURAL_TRUST_RE.test(source)) return BLOCK_TEMPLATE_FAMILIES.byggform_architectural_trust
  if (!category && SERVICE_COMPANY_RE.test(source)) return BLOCK_TEMPLATE_FAMILIES.service_company_modern

  return BLOCK_TEMPLATE_FAMILIES.service_company_modern
}

export function pagesForTemplate(
  family: BlockTemplateFamily,
  input: { business: string; serviceTitle: string; aboutTitle: string; includeFaqPage?: boolean; language?: 'sv' | 'en' },
): BlockTemplatePage[] {
  const en = input.language === 'en'
  const pageSlug = {
    about: en ? 'about' : 'om-oss',
    contact: en ? 'contact' : 'kontakt',
    faq: en ? 'faq' : 'fragor',
    process: en ? 'process' : 'process',
  }
  const pageTitle = {
    contact: en ? 'Contact' : 'Kontakt',
    faq: en ? 'FAQ' : 'Vanliga frågor',
  }
  if (family.key === 'clinic_private_care') {
    const pages: BlockTemplatePage[] = [
      {
        slug: 'index',
        title: input.business,
        purpose: en
          ? 'Create a calm, premium first impression where the visitor quickly feels trust and understands the first step.'
          : 'Skapa ett lugnt och premium första intryck där besökaren snabbt känner förtroende och förstår första steget.',
        pageKind: 'landing',
        sections: ['hero_private_clinic_statement', 'care_paths_editorial_rows', 'people_and_approach_split', 'trust_band_confidential', 'gallery_industry_relevant', 'visit_panel_calm', 'cta_soft_conversion'],
      },
      {
        slug: slugFor(input.serviceTitle),
        title: input.serviceTitle,
        purpose: en
          ? 'Show care types or treatment areas clearly without invented promises, prices or specialist claims.'
          : 'Visa vårdformer eller behandlingsområden tydligt utan påhittade löften, priser eller specialistpåståenden.',
        pageKind: 'services',
        sections: ['care_paths_editorial_rows', 'trust_band_confidential', 'cta_soft_conversion'],
      },
      {
        slug: pageSlug.about,
        title: input.aboutTitle,
        purpose: en
          ? 'Build trust around the way of working, patient care, privacy and how the clinic approaches good care.'
          : 'Bygga förtroende kring arbetssätt, bemötande, integritet och hur kliniken tänker kring god vård.',
        pageKind: 'about',
        sections: ['people_and_approach_split', 'trust_band_confidential', 'visit_panel_calm'],
      },
      {
        slug: pageSlug.contact,
        title: pageTitle.contact,
        purpose: en
          ? 'Make the first contact feel simple and calm, with clear guidance on how booking or a first conversation can work.'
          : 'Göra första kontakt enkel och lugn, med tydlig information om hur bokning eller första samtal kan gå till.',
        pageKind: 'contact',
        sections: ['visit_panel_calm', 'trust_band_confidential'],
      },
    ]
    if (input.includeFaqPage) {
      pages.splice(3, 0, {
        slug: pageSlug.faq,
        title: pageTitle.faq,
        purpose: en
          ? 'Collect relevant questions before first contact and the first visit when the source material supports it.'
          : 'Samla relevanta frågor inför första kontakt och första besök när underlaget räcker.',
        pageKind: 'faq',
        sections: ['faq_private_visit_optional', 'cta_soft_conversion'],
      })
    }
    return pages
  }

  if (family.key === 'mechanic_precision_workshop') {
    const pages: BlockTemplatePage[] = [
      {
        slug: 'index',
        title: input.business,
        purpose: en
          ? 'Create a strong first impression for the workshop with clear trust signals, workshop services and easy booking.'
          : 'Skapa ett starkt första intryck för verkstaden med tydligt förtroende, verkstadstjänster och enkel bokning.',
        pageKind: 'landing',
        sections: ['hero_mechanic_confidence', 'service_cards_workshop', 'workshop_standard_story', 'process_diagnostics_band', 'gallery_industry_relevant', 'visit_route_panel', 'cta_book_service_band'],
      },
      {
        slug: slugFor(input.serviceTitle),
        title: input.serviceTitle,
        purpose: en
          ? 'Show the workshop’s main services clearly without invented promises, brand expertise or pricing.'
          : 'Visa verkstadens huvudsakliga tjänster tydligt utan påhittade löften, märkesexpertis eller priser.',
        pageKind: 'services',
        sections: ['service_cards_workshop', 'process_diagnostics_band', 'cta_book_service_band'],
      },
      {
        slug: pageSlug.about,
        title: input.aboutTitle,
        purpose: en
          ? 'Build trust around process, standards, documentation and how the workshop works with customers and vehicles.'
          : 'Bygga förtroende kring arbetssätt, standard, dokumentation och hur verkstaden arbetar med kunder och fordon.',
        pageKind: 'about',
        sections: ['workshop_standard_story', 'process_diagnostics_band', 'visit_route_panel'],
      },
      {
        slug: pageSlug.contact,
        title: pageTitle.contact,
        purpose: en
          ? 'Make it easy to call, email or find the workshop and understand how a drop-off can work.'
          : 'Göra det enkelt att ringa, mejla eller hitta verkstaden och förstå hur inlämning kan gå till.',
        pageKind: 'contact',
        sections: ['visit_route_panel', 'process_diagnostics_band'],
      },
    ]
    if (input.includeFaqPage) {
      pages.splice(3, 0, {
        slug: pageSlug.faq,
        title: pageTitle.faq,
        purpose: en
          ? 'Collect workshop-relevant questions about booking, diagnostics, estimates and drop-off when enough source material exists.'
          : 'Samla verkstadsrelevanta frågor om bokning, felsökning, uppskattning och inlämning när det finns nog underlag.',
        pageKind: 'faq',
        sections: ['faq_workshop_optional', 'cta_book_service_band'],
      })
    }
    return pages
  }

  if (family.key === 'bistro_atmospheric_landing') {
    return [
      {
        slug: 'index',
        title: input.business,
        purpose: en
          ? 'A strong restaurant, bar or café landing page that sells atmosphere, food or drink, visits and contact without extra subpages.'
          : 'En stark restaurang/bar/café-landningssida som säljer stämning, mat/dryck, besök och kontakt utan extra undersidor.',
        pageKind: 'landing',
        sections: [
          'hero_restaurant_atmospheric',
          'menu_highlight_cards',
          'restaurant_story',
          'gallery_food_mosaic',
          'visit_info_panel',
          'faq_visit_details',
          'reserve_panel',
        ],
      },
    ]
  }

  if (family.key === 'salon_editorial_luxury') {
    const pages: BlockTemplatePage[] = [
      {
        slug: 'index',
        title: input.business,
        purpose: en
          ? 'Create a complete premium homepage with warmth, a clear offer, a factual company story, strong relevant imagery and easy contact.'
          : 'Skapa en komplett premium-startsida med varm känsla, tydligt erbjudande, saklig företagsberättelse, starka relevanta bilder och enkel kontakt.',
        pageKind: 'landing',
        sections: ['hero_editorial_split', 'offerings_visual_cards', 'experience_story_dual_visual', 'gallery_atmospheric_mosaic', 'about_warm_brand_story', 'trust_badges_premium', 'contact_booking_panel', 'cta_direct_action_band'],
      },
      {
        slug: slugFor(input.serviceTitle),
        title: input.serviceTitle,
        purpose: en
          ? 'Present the offer or treatments clearly without invented prices or promises.'
          : 'Visa erbjudandet/behandlingarna tydligt utan påhittade priser eller löften.',
        pageKind: 'services',
        sections: ['offerings_visual_cards', 'experience_story_dual_visual', 'faq_practical_visit_details', 'contact_booking_panel'],
      },
      {
        slug: pageSlug.about,
        title: input.aboutTitle,
        purpose: en
          ? 'Build trust through story, working style and overall feeling.'
          : 'Bygga förtroende med berättelse, arbetssätt och känsla.',
        pageKind: 'about',
        sections: ['about_warm_brand_story', 'gallery_atmospheric_mosaic', 'contact_booking_panel'],
      },
      {
        slug: 'process',
        title: en ? 'Your visit' : 'Ditt besök',
        purpose: en
          ? 'Explain the booking flow, what the first visit can feel like and how guidance works without inventing promises.'
          : 'Förklara bokningsflödet, hur ett första besök kan kännas och hur vägledning går till utan att hitta på löften.',
        pageKind: 'process',
        sections: ['experience_story_dual_visual', 'faq_practical_visit_details', 'contact_booking_panel'],
      },
      {
        slug: pageSlug.contact,
        title: pageTitle.contact,
        purpose: en
          ? 'Make it easy to call, email, find the business and understand the next step.'
          : 'Göra det enkelt att ringa, mejla, hitta och förstå nästa steg.',
        pageKind: 'contact',
        sections: ['contact_booking_panel', 'faq_practical_visit_details'],
      },
    ]
    if (input.includeFaqPage) {
      pages.splice(4, 0, {
        slug: pageSlug.faq,
        title: pageTitle.faq,
        purpose: en
          ? 'Collect real pre-booking questions and practical answers when the source material is strong enough.'
          : 'Samla riktiga frågor inför bokning och praktiska svar när underlaget är tillräckligt starkt.',
        pageKind: 'faq',
        sections: ['faq_practical_visit_details', 'contact_booking_panel'],
      })
    }
    return pages
  }

  if (family.key === 'byggform_architectural_trust') {
    const pages: BlockTemplatePage[] = [
      {
        slug: 'index',
        title: input.business,
        purpose: en
          ? 'Create a complete, image-supported first impression with a clear offer, factual company context, clear process and quote-ready contact.'
          : 'Skapa ett komplett och bildstött första intryck med tydligt erbjudande, saklig företagsinformation, process och offertnära kontakt.',
        pageKind: 'landing',
        sections: ['hero_construction_architectural', 'construction_services_grid', 'content_split_sticky_aside', 'project_process_timeline', 'image_split_material_detail_optional', 'trust_clarity_panel', 'quote_contact_panel', 'cta_band_architectural'],
      },
      {
        slug: slugFor(input.serviceTitle),
        title: input.serviceTitle,
        purpose: en
          ? 'Show services or project types in a detailed list with clear scope, without invented guarantees or pricing.'
          : 'Visa tjänster/uppdrag i en detaljlista med tydlig omfattning, utan påhittade garantier eller priser.',
        pageKind: 'services',
        sections: ['interior_page_hero', 'service_detail_list', 'feature_grid_practical_start', 'cta_band_architectural'],
      },
      {
        slug: 'process',
        title: en ? 'Process' : 'Process',
        purpose: en
          ? 'Explain how first contact, planning, scope and delivery can work.'
          : 'Förklara hur första kontakt, planering, omfattning och genomförande kan gå till.',
        pageKind: 'process',
        sections: ['interior_page_hero', 'project_process_timeline', 'trust_clarity_panel', 'content_split_sticky_aside'],
      },
      {
        slug: pageSlug.about,
        title: input.aboutTitle,
        purpose: en
          ? 'Build trust around working methods, values and how the company approaches projects.'
          : 'Bygga förtroende kring arbetssätt, värderingar och hur företaget tänker kring uppdrag.',
        pageKind: 'about',
        sections: ['interior_page_hero', 'content_split_sticky_aside', 'about_values_grid', 'image_split_material_detail_optional'],
      },
      {
        slug: pageSlug.contact,
        title: pageTitle.contact,
        purpose: en
          ? 'Make quotes and first contact concrete: what the customer should send and what happens next.'
          : 'Göra offert/kontakt konkret: vad kunden ska skicka med och vad som händer sedan.',
        pageKind: 'contact',
        sections: ['interior_page_hero', 'quote_contact_panel', 'contact_requirements_cards', 'content_split_sticky_aside'],
      },
    ]
    if (input.includeFaqPage) {
        pages.splice(4, 0, {
          slug: pageSlug.faq,
          title: pageTitle.faq,
          purpose: en
            ? 'Collect real, relevant questions in categories. Only use this page when the source material is strong enough.'
            : 'Samla riktiga, passande frågor i kategorier. Sidan ska bara användas när det finns nog underlag.',
          pageKind: 'faq',
          sections: ['interior_page_hero', 'faq_category_accordion_optional', 'cta_band_architectural'],
        })
    }
    return pages
  }

  if (family.key === 'service_company_modern') {
    const pages: BlockTemplatePage[] = [
      {
        slug: 'index',
        title: input.business,
        purpose: en
          ? 'Create a complete premium homepage: clear offer, factual company story, useful next steps, industry-relevant imagery, trust and easy contact. It must feel like a real full homepage, not a short campaign page.'
          : 'Skapa en komplett premium-startsida: tydligt erbjudande, saklig företagsberättelse, användbara nästa steg, branschrelevanta bilder, förtroende och enkel kontakt. Den ska kännas som en riktig full startsida, inte en kort kampanjsida.',
        pageKind: 'landing',
        sections: ['hero_confident_service_statement', 'trust_badges_premium', 'service_groups_clear_cards', 'about_trust_story_split', 'process_clear_next_steps', 'gallery_industry_relevant', 'contact_options_modern', 'cta_direct_action_band'],
      },
      {
        slug: slugFor(input.serviceTitle),
        title: input.serviceTitle,
        purpose: en
          ? 'Present the services clearly and convincingly without invented pricing, emergency promises or certifications.'
          : 'Visa tjänsterna tydligt och säljande utan påhittade priser, jourlöften eller certifieringar.',
        pageKind: 'services',
        sections: ['service_groups_clear_cards', 'about_trust_story_split', 'cta_direct_action_band'],
      },
      {
        slug: 'process',
        title: en ? 'Process' : 'Process',
        purpose: en
          ? 'Explain how first contact, planning, scope and delivery usually work so the visitor understands the next step.'
          : 'Förklara hur första kontakt, planering, omfattning och leverans brukar fungera så att besökaren förstår nästa steg.',
        pageKind: 'process',
        sections: ['trust_badges_premium', 'about_trust_story_split', 'contact_options_modern'],
      },
      {
        slug: pageSlug.about,
        title: input.aboutTitle,
        purpose: en
          ? 'Build trust through working style, tone, local credibility and what customers can expect.'
          : 'Bygga förtroende genom arbetssätt, ton, lokalkännedom och vad kunder kan förvänta sig.',
        pageKind: 'about',
        sections: ['about_trust_story_split', 'trust_badges_premium', 'contact_options_modern'],
      },
      {
        slug: pageSlug.contact,
        title: pageTitle.contact,
        purpose: en
          ? 'Make it easy to call, email and understand what is most useful to include in a first enquiry.'
          : 'Göra det lätt att ringa, mejla och förstå vad som är bäst att skicka med i första kontakt.',
        pageKind: 'contact',
        sections: ['contact_options_modern', 'about_trust_story_split'],
      },
    ]
    if (input.includeFaqPage) {
        pages.splice(4, 0, {
          slug: pageSlug.faq,
          title: pageTitle.faq,
          purpose: en
            ? 'Collect relevant questions in clear groups, but only when there is enough real source material.'
            : 'Samla passande frågor i tydliga grupper, men bara när det finns tillräckligt med verkligt underlag.',
          pageKind: 'faq',
          sections: ['faq_layered_optional', 'cta_direct_action_band'],
        })
    }
    return pages
  }

  return [
    {
      slug: 'index',
      title: input.business,
      purpose: 'Skapa starkt första intryck och leda till kontakt.',
      pageKind: 'landing',
      sections: ['hero_clear_value_prop', 'service_cards', 'trust_process', 'contact_direct_panel'],
    },
    {
      slug: slugFor(input.serviceTitle),
      title: input.serviceTitle,
      purpose: 'Visa erbjudandet utan påhittade priser.',
      pageKind: 'services',
      sections: ['service_cards', 'trust_process', 'contact_direct_panel'],
    },
      {
        slug: pageSlug.about,
        title: input.aboutTitle,
        purpose: en
          ? 'Build trust through working methods and practical reassurance.'
          : 'Bygga förtroende med arbetssätt och konkret trygghet.',
        pageKind: 'about',
        sections: ['trust_process', 'service_cards', 'contact_direct_panel'],
      },
      {
        slug: pageSlug.contact,
        title: pageTitle.contact,
        purpose: en
          ? 'Make it easy to call, email and find the business.'
          : 'Göra det lätt att ringa, mejla och hitta.',
        pageKind: 'contact',
        sections: ['contact_direct_panel', 'faq_practical_service'],
      },
  ]
}

export function templateDirective(family: BlockTemplateFamily): string {
  return [
    `Vald templatefamilj: ${family.label} (${family.key}).`,
    `Prototype: ${family.sourcePrototype}.`,
    `Mode: ${family.mode === 'landing_page' ? 'endast landingpage/index.html' : 'flera sidor när underlaget stödjer det'}.`,
    `Blockordning/inspiration: ${family.blocks.join(' -> ')}.`,
    `Eric-notes: ${family.notesFromEric.join(' ')}`,
    `AI-notes: ${family.aiDecisionNotes.join(' ')}`,
  ].join('\n')
}

export function templatePromptNotes(family: BlockTemplateFamily, page?: { sections?: string[]; pageKind?: string }): string {
  return [
    templateDirective(family),
    page?.pageKind ? `Denna sida är av typen: ${page.pageKind}.` : '',
    page?.sections?.length ? `Sidan ska fylla dessa block: ${page.sections.join(', ')}.` : '',
    `Passar bäst för: ${family.bestFor.join(' | ')}.`,
    `Undvik för: ${family.avoidFor.join(' | ')}.`,
  ].filter(Boolean).join('\n')
}

function normalize(value?: string | null): string {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function slugFor(value: string): string {
  const x = String(value || '')
    .toLowerCase()
    .replace(/\.html?$/, '')
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return !x ? 'tjanster' : x
}
