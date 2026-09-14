import { describe, expect, it } from 'vitest'

import {
  guardedAuditScore,
  isRenderContradiction,
  shouldRequestSecondOpinion,
} from '../../supabase/functions/_shared/site-audit'

describe('audit score safety guards', () => {
  it('preserves a screenshot-backed modern-site score', () => {
    expect(guardedAuditScore(8, { hasScreenshot: true, hasStructuralIssues: false })).toBe(8)
  })

  it('keeps screenshot-less results below the automatic parking threshold', () => {
    expect(guardedAuditScore(9, { hasScreenshot: false, hasStructuralIssues: false })).toBe(6)
  })

  it('does not let cosmetic issues alone push a functioning site below 5', () => {
    expect(guardedAuditScore(3, { hasScreenshot: true, hasStructuralIssues: false })).toBe(5)
  })

  it('uses a second opinion only for screenshot-backed borderline results', () => {
    expect(shouldRequestSecondOpinion(5, 'medium', true)).toBe(true)
    expect(shouldRequestSecondOpinion(8, 'high', true)).toBe(false)
    expect(shouldRequestSecondOpinion(2, 'high', true)).toBe(false)
    expect(shouldRequestSecondOpinion(5, 'low', false)).toBe(false)
  })

  it('checks a low-confidence visual result even outside the borderline band', () => {
    expect(shouldRequestSecondOpinion(7, 'low', true)).toBe(true)
  })

  it('rejects a blank-screen verdict when the scrape contains real site content', () => {
    expect(isRenderContradiction(
      'Skärmbilden visar en helt tom sida med endast en logotyp.',
      ['Helt tom sida utan innehåll'],
      'Tjänster kontakt om oss '.repeat(45),
      true,
      6,
    )).toBe(true)
  })

  it('allows a genuinely empty screenshot verdict when there is no contradictory evidence', () => {
    expect(isRenderContradiction(
      'The page is empty and does not load.',
      ['No content is visible'],
      'Website',
      true,
      0,
    )).toBe(false)
  })
})
