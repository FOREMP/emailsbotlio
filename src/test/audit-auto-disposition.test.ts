import { describe, expect, it } from 'vitest'

import { shouldAutoBuildAudit } from '../../supabase/functions/_shared/site-audit'

describe('automatic audit disposition', () => {
  it('auto-builds reliable screenshot-backed scores from 1 through 4', () => {
    expect(shouldAutoBuildAudit({ score: 1, screenshotReliable: true, unreadable: false, isEcommerce: false })).toBe(true)
    expect(shouldAutoBuildAudit({ score: 4, screenshotReliable: true, unreadable: false, isEcommerce: false })).toBe(true)
  })

  it('keeps borderline scores in manual review', () => {
    expect(shouldAutoBuildAudit({ score: 5, screenshotReliable: true, unreadable: false, isEcommerce: false })).toBe(false)
  })

  it('never auto-builds when scrape or screenshot evidence is unreliable', () => {
    expect(shouldAutoBuildAudit({ score: 2, screenshotReliable: false, unreadable: false, isEcommerce: false })).toBe(false)
    expect(shouldAutoBuildAudit({ score: 2, screenshotReliable: true, unreadable: true, isEcommerce: false })).toBe(false)
  })

  it('keeps excluded e-commerce sites out of generation regardless of score', () => {
    expect(shouldAutoBuildAudit({ score: 2, screenshotReliable: true, unreadable: false, isEcommerce: true })).toBe(false)
  })
})
