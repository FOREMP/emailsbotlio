/**
 * `audit_score` is the quality of the lead's current website:
 *   1 = broken/very outdated, 10 = excellent/modern.
 *
 * The sales UI should show the inverse so the intuitive direction is kept:
 *   10 = strongest redesign opportunity, 1 = weakest opportunity.
 */
export function salesPotentialFromAuditScore(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  const quality = Math.max(1, Math.min(10, Math.round(score)));
  return 11 - quality;
}

export function auditScoreLabel(score: number | null | undefined): string {
  const potential = salesPotentialFromAuditScore(score);
  return potential == null ? "—" : `${potential}/10`;
}
