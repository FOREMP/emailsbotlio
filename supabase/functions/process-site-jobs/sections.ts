// Section registry for the freeform renderer.
//
// Every template family in `_shared/block-templates.ts` declares a list of
// section keys per page. Before this module those keys were thrown away and
// every site was rendered from the same eight hard-coded blocks in the same
// order, which is why all generated sites looked alike.
//
// Here each section key is mapped to a renderer kind, and each family gets
// 2-3 layout variants that are picked deterministically from the site id so
// two salons built the same week do not come out identical.
import type { BlockTemplateFamilyKey } from '../_shared/block-templates.ts'

export type SectionKind =
  | 'hero'
  | 'intro'
  | 'services'
  | 'sections'
  | 'process'
  | 'gallery'
  | 'trust'
  | 'faq'
  | 'contact'
  | 'cta'
  | 'skip'

export const SECTION_KIND: Record<string, SectionKind> = {
  // shared / navigation / footer
  header_private_care_nav: 'skip',
  header_precision_workshop_nav: 'skip',
  header_sticky_editorial_nav: 'skip',
  header_fixed_architectural_nav: 'skip',
  header_clean_conversion_nav: 'skip',
  header_mobile_safe_nav: 'skip',
  footer_private_care: 'skip',
  footer_workshop_structured: 'skip',
  footer_minimal_brand: 'skip',
  footer_restaurant_minimal: 'skip',
  footer_structured_links: 'skip',
  footer_structured_service: 'skip',
  footer_simple: 'skip',

  // clinic
  hero_private_clinic_statement: 'hero',
  care_paths_editorial_rows: 'services',
  people_and_approach_split: 'intro',
  trust_band_confidential: 'trust',
  visit_panel_calm: 'contact',
  faq_private_visit_optional: 'faq',
  cta_soft_conversion: 'cta',

  // mechanic
  hero_mechanic_confidence: 'hero',
  service_cards_workshop: 'services',
  process_diagnostics_band: 'process',
  workshop_standard_story: 'intro',
  visit_route_panel: 'contact',
  faq_workshop_optional: 'faq',
  cta_book_service_band: 'cta',

  // salon / editorial
  hero_editorial_split: 'hero',
  offerings_visual_cards: 'services',
  experience_story_dual_visual: 'intro',
  gallery_atmospheric_mosaic: 'gallery',
  about_warm_brand_story: 'sections',
  faq_practical_visit_details: 'faq',
  contact_booking_panel: 'contact',

  // restaurant
  hero_restaurant_atmospheric: 'hero',
  menu_highlight_cards: 'services',
  restaurant_story: 'intro',
  gallery_food_mosaic: 'gallery',
  visit_info_panel: 'contact',
  faq_visit_details: 'faq',
  reserve_panel: 'cta',

  // construction / architectural
  hero_construction_architectural: 'hero',
  construction_services_grid: 'services',
  project_process_timeline: 'process',
  trust_clarity_panel: 'trust',
  interior_page_hero: 'hero',
  service_detail_list: 'sections',
  content_split_sticky_aside: 'intro',
  feature_grid_practical_start: 'sections',
  about_values_grid: 'sections',
  image_split_material_detail_optional: 'gallery',
  quote_contact_panel: 'contact',
  contact_requirements_cards: 'sections',
  faq_category_accordion_optional: 'faq',
  cta_band_architectural: 'cta',

  // modern service company
  hero_confident_service_statement: 'hero',
  trust_badges_premium: 'trust',
  service_groups_clear_cards: 'services',
  about_trust_story_split: 'intro',
  contact_options_modern: 'contact',
  faq_layered_optional: 'faq',
  cta_direct_action_band: 'cta',

  // default clarity
  hero_clear_value_prop: 'hero',
  service_cards: 'services',
  trust_process: 'process',
  faq_practical_service: 'faq',
  contact_direct_panel: 'contact',
}

export type HeroLayout = 'overlay' | 'editorial_split' | 'calm_panel' | 'industrial' | 'typographic'
export type ServiceStyle = 'cards' | 'rows'
export type GalleryStyle = 'mosaic' | 'strip'

export interface FamilyVariant {
  id: string
  heroLayout: HeroLayout
  pageHeroLayout: HeroLayout
  serviceStyle: ServiceStyle
  galleryStyle: GalleryStyle
}

const V = (
  id: string,
  heroLayout: HeroLayout,
  pageHeroLayout: HeroLayout,
  serviceStyle: ServiceStyle,
  galleryStyle: GalleryStyle,
): FamilyVariant => ({ id, heroLayout, pageHeroLayout, serviceStyle, galleryStyle })

export const FAMILY_VARIANTS: Record<BlockTemplateFamilyKey, FamilyVariant[]> = {
  salon_editorial_luxury: [
    V('a', 'editorial_split', 'calm_panel', 'rows', 'mosaic'),
    V('b', 'overlay', 'overlay', 'cards', 'strip'),
    V('c', 'typographic', 'calm_panel', 'rows', 'strip'),
  ],
  clinic_private_care: [
    V('a', 'calm_panel', 'calm_panel', 'rows', 'strip'),
    V('b', 'overlay', 'overlay', 'rows', 'mosaic'),
  ],
  mechanic_precision_workshop: [
    V('a', 'industrial', 'overlay', 'cards', 'strip'),
    V('b', 'overlay', 'calm_panel', 'rows', 'strip'),
  ],
  byggform_architectural_trust: [
    V('a', 'overlay', 'overlay', 'cards', 'strip'),
    V('b', 'typographic', 'calm_panel', 'rows', 'strip'),
  ],
  bistro_atmospheric_landing: [
    V('a', 'overlay', 'overlay', 'cards', 'mosaic'),
    V('b', 'editorial_split', 'overlay', 'rows', 'mosaic'),
  ],
  service_company_modern: [
    V('a', 'overlay', 'overlay', 'cards', 'strip'),
    V('b', 'editorial_split', 'calm_panel', 'cards', 'strip'),
    V('c', 'calm_panel', 'calm_panel', 'rows', 'strip'),
  ],
  service_clarity_default: [
    V('a', 'overlay', 'overlay', 'cards', 'mosaic'),
    V('b', 'editorial_split', 'calm_panel', 'cards', 'strip'),
  ],
}

/** Stable 32-bit hash so the same lead always renders the same variant. */
export function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export function pickVariant(family: BlockTemplateFamilyKey | undefined, seed: string): FamilyVariant {
  const list = FAMILY_VARIANTS[family ?? 'service_clarity_default'] ?? FAMILY_VARIANTS.service_clarity_default
  return list[hashSeed(seed || 'seed') % list.length]
}

export function variantById(family: BlockTemplateFamilyKey | undefined, id: string | undefined): FamilyVariant | null {
  const list = FAMILY_VARIANTS[family ?? 'service_clarity_default'] ?? FAMILY_VARIANTS.service_clarity_default
  return list.find((v) => v.id === id) ?? null
}

/**
 * Turn a page's declared section keys into an ordered, de-duplicated list of
 * renderer kinds. Unknown keys are ignored; a hero is always guaranteed first.
 */
export function kindsForSections(sections: string[] | undefined): SectionKind[] {
  const out: SectionKind[] = []
  for (const key of sections ?? []) {
    const kind = SECTION_KIND[key]
    if (!kind || kind === 'skip') continue
    if (kind !== 'hero' && out.includes(kind)) continue
    if (kind === 'hero' && out.includes('hero')) continue
    out.push(kind)
  }
  if (!out.includes('hero')) out.unshift('hero')
  return out
}
