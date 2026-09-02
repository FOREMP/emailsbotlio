import { describe, expect, it } from 'vitest'

import {
  BLOCK_TEMPLATE_FAMILIES,
  pagesForTemplate,
  type BlockTemplateFamilyKey,
} from '../../supabase/functions/_shared/block-templates'
import { kindsForSections } from '../../supabase/functions/process-site-jobs/sections'

const landingFor = (key: BlockTemplateFamilyKey) => {
  const pages = pagesForTemplate(BLOCK_TEMPLATE_FAMILIES[key], {
    business: 'Example Company',
    serviceTitle: 'Services',
    aboutTitle: 'About us',
    language: 'en',
  })
  return pages.find((page) => page.pageKind === 'landing')!
}

describe('premium template landing pages', () => {
  it('gives the common service homepage a full, non-duplicated block flow', () => {
    const kinds = kindsForSections(landingFor('service_company_modern').sections)

    expect(kinds).toEqual([
      'hero',
      'trust',
      'services',
      'intro',
      'process',
      'gallery',
      'contact',
      'cta',
    ])
  })

  it.each([
    'clinic_private_care',
    'mechanic_precision_workshop',
    'salon_editorial_luxury',
    'byggform_architectural_trust',
  ] as BlockTemplateFamilyKey[])('adds useful depth and imagery to %s', (key) => {
    const kinds = kindsForSections(landingFor(key).sections)

    expect(kinds).toContain('gallery')
    expect(kinds.length).toBeGreaterThanOrEqual(7)
  })
})
