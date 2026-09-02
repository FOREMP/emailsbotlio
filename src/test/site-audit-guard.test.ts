import { describe, expect, it } from 'vitest'

import { guardedAuditScore } from '../../supabase/functions/_shared/site-audit'

describe('audit score safety guards', () => {
  it('allows a screenshot-backed modern site to enter the 7+ auto-park band', () => {
    expect(guardedAuditScore(8, { hasScreenshot: true, hasStructuralIssues: false })).toBe(8)
  })

  it('keeps screenshot-less results below the automatic parking threshold', () => {
    expect(guardedAuditScore(9, { hasScreenshot: false, hasStructuralIssues: false })).toBe(6)
  })

  it('does not let cosmetic issues alone push a functioning site below 5', () => {
    expect(guardedAuditScore(3, { hasScreenshot: true, hasStructuralIssues: false })).toBe(5)
  })
})
