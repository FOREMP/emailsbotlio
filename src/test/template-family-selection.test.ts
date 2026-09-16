import { describe, expect, it } from 'vitest'

import {
  selectBlockTemplateFamilyDecision,
} from '../../supabase/functions/_shared/block-templates'

const familyFor = (category: string) => selectBlockTemplateFamilyDecision({ category }).family.key

describe('template family selection', () => {
  it.each([
    'Restaurang',
    'Lunchrestaurang',
    'Pizzeria',
    'Pizza restaurant',
    'Bar & grill',
    'Snabbmat',
  ])('selects the restaurant family for %s', (category) => {
    const decision = selectBlockTemplateFamilyDecision({ category })
    expect(decision.family.key).toBe('bistro_atmospheric_landing')
    expect(decision.confidence).toBeGreaterThanOrEqual(.9)
    expect(decision.matchedBy).toBe('category')
  })

  it('does not confuse floor layers with food', () => {
    expect(familyFor('Mattläggare')).toBe('byggform_architectural_trust')
  })

  it('does not confuse building materials with food', () => {
    expect(familyFor('Byggnadsmaterial')).toBe('byggform_architectural_trust')
  })

  it('does not confuse an eyebrow bar with a restaurant bar', () => {
    expect(familyFor('Ögonbrynsbar')).toBe('salon_editorial_luxury')
  })

  it.each(['Massage therapist', 'Laser hair removal service', 'Beauty clinic'])(
    'keeps visual beauty and wellness categories on the editorial family: %s',
    (category) => {
      expect(familyFor(category)).toBe('salon_editorial_luxury')
    },
  )

  it('keeps an unknown uploaded category on the broad modern family', () => {
    const decision = selectBlockTemplateFamilyDecision({ category: 'Specialistföretag' })
    expect(decision.family.key).toBe('service_company_modern')
    expect(decision.confidence).toBeLessThan(.9)
  })
})
