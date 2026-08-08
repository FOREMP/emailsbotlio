export type BlockTemplateFamilyKey =
  | 'salon_editorial_luxury'
  | 'bistro_atmospheric_landing'
  | 'byggform_architectural_trust'
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

const RESTAURANT_RE = /(restaurang|restaurant|bistro|bar\b|pub\b|café|cafe|pizzeria|bageri|catering|mat|lunch|krog|diner|brasserie|trattoria)/i
const EDITORIAL_SERVICE_RE = /(frisör|frisor|hair|barber|salong|skönhet|beauty|nagel|nail|frans|bryn|lash|brow|spa\b|massage|klinik|clinic|hudvård|skin|wellness|terapi|terapeut|kosmetisk|makeup|stylist|studio)/i
const ARCHITECTURAL_TRUST_RE = /(bygg|renover|snick|tak|fasad|måleri|markarbete|anlägg|platt|kakel|badrum|golv|elektriker|elinstall|elfirma|vvs|rör|städ|lokalvård|flyttstäd|teknisk service|montage|installation|projekt)/i
const PRACTICAL_SERVICE_RE = /(bilverkstad|mekaniker|auto|däck|bilservice|bilrekond|billack|bilglas|allmän service|lokalt företag)/i

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
  if (ARCHITECTURAL_TRUST_RE.test(primary)) return BLOCK_TEMPLATE_FAMILIES.byggform_architectural_trust
  if (PRACTICAL_SERVICE_RE.test(primary)) return BLOCK_TEMPLATE_FAMILIES.service_clarity_default
  if (EDITORIAL_SERVICE_RE.test(primary)) return BLOCK_TEMPLATE_FAMILIES.salon_editorial_luxury

  // Source text is intentionally weaker so a random scraped word does not hijack the niche.
  if (!category && RESTAURANT_RE.test(source)) return BLOCK_TEMPLATE_FAMILIES.bistro_atmospheric_landing
  if (!category && ARCHITECTURAL_TRUST_RE.test(source)) return BLOCK_TEMPLATE_FAMILIES.byggform_architectural_trust
  if (!category && PRACTICAL_SERVICE_RE.test(source)) return BLOCK_TEMPLATE_FAMILIES.service_clarity_default
  if (!category && EDITORIAL_SERVICE_RE.test(source)) return BLOCK_TEMPLATE_FAMILIES.salon_editorial_luxury

  return BLOCK_TEMPLATE_FAMILIES.service_clarity_default
}

export function pagesForTemplate(
  family: BlockTemplateFamily,
  input: { business: string; serviceTitle: string; aboutTitle: string; includeFaqPage?: boolean },
): BlockTemplatePage[] {
  if (family.key === 'bistro_atmospheric_landing') {
    return [
      {
        slug: 'index',
        title: input.business,
        purpose: 'En stark restaurang/bar/café-landningssida som säljer stämning, mat/dryck, besök och kontakt utan extra undersidor.',
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
    return [
      {
        slug: 'index',
        title: input.business,
        purpose: 'Skapa ett premium första intryck med varm känsla, tydligt erbjudande och enkel kontakt.',
        pageKind: 'landing',
        sections: ['hero_editorial_split', 'offerings_visual_cards', 'experience_story_dual_visual', 'gallery_atmospheric_mosaic', 'contact_booking_panel'],
      },
      {
        slug: slugFor(input.serviceTitle),
        title: input.serviceTitle,
        purpose: 'Visa erbjudandet/behandlingarna tydligt utan påhittade priser eller löften.',
        pageKind: 'services',
        sections: ['offerings_visual_cards', 'experience_story_dual_visual', 'faq_practical_visit_details', 'contact_booking_panel'],
      },
      {
        slug: 'om-oss',
        title: input.aboutTitle,
        purpose: 'Bygga förtroende med berättelse, arbetssätt och känsla.',
        pageKind: 'about',
        sections: ['about_warm_brand_story', 'gallery_atmospheric_mosaic', 'contact_booking_panel'],
      },
      {
        slug: 'kontakt',
        title: 'Kontakt',
        purpose: 'Göra det enkelt att ringa, mejla, hitta och förstå nästa steg.',
        pageKind: 'contact',
        sections: ['contact_booking_panel', 'faq_practical_visit_details'],
      },
    ]
  }

  if (family.key === 'byggform_architectural_trust') {
    const pages: BlockTemplatePage[] = [
      {
        slug: 'index',
        title: input.business,
        purpose: 'Skapa ett stabilt första intryck med tydligt erbjudande, process och offertnära kontakt.',
        pageKind: 'landing',
        sections: ['hero_construction_architectural', 'construction_services_grid', 'project_process_timeline', 'trust_clarity_panel', 'cta_band_architectural'],
      },
      {
        slug: slugFor(input.serviceTitle),
        title: input.serviceTitle,
        purpose: 'Visa tjänster/uppdrag i en detaljlista med tydlig omfattning, utan påhittade garantier eller priser.',
        pageKind: 'services',
        sections: ['interior_page_hero', 'service_detail_list', 'feature_grid_practical_start', 'cta_band_architectural'],
      },
      {
        slug: 'process',
        title: 'Process',
        purpose: 'Förklara hur första kontakt, planering, omfattning och genomförande kan gå till.',
        pageKind: 'process',
        sections: ['interior_page_hero', 'project_process_timeline', 'trust_clarity_panel', 'content_split_sticky_aside'],
      },
      {
        slug: 'om-oss',
        title: input.aboutTitle,
        purpose: 'Bygga förtroende kring arbetssätt, värderingar och hur företaget tänker kring uppdrag.',
        pageKind: 'about',
        sections: ['interior_page_hero', 'content_split_sticky_aside', 'about_values_grid', 'image_split_material_detail_optional'],
      },
      {
        slug: 'kontakt',
        title: 'Kontakt',
        purpose: 'Göra offert/kontakt konkret: vad kunden ska skicka med och vad som händer sedan.',
        pageKind: 'contact',
        sections: ['interior_page_hero', 'quote_contact_panel', 'contact_requirements_cards', 'content_split_sticky_aside'],
      },
    ]
    if (input.includeFaqPage) {
      pages.splice(4, 0, {
        slug: 'fragor',
        title: 'Vanliga frågor',
        purpose: 'Samla riktiga, passande frågor i kategorier. Sidan ska bara användas när det finns nog underlag.',
        pageKind: 'faq',
        sections: ['interior_page_hero', 'faq_category_accordion_optional', 'cta_band_architectural'],
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
      slug: 'om-oss',
      title: input.aboutTitle,
      purpose: 'Bygga förtroende med arbetssätt och konkret trygghet.',
      pageKind: 'about',
      sections: ['trust_process', 'service_cards', 'contact_direct_panel'],
    },
    {
      slug: 'kontakt',
      title: 'Kontakt',
      purpose: 'Göra det lätt att ringa, mejla och hitta.',
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
