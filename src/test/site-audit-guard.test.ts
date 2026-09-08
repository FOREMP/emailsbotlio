import { describe, expect, it } from 'vitest'

import {
  guardedAuditScore,
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
})
