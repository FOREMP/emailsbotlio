import { describe, expect, it } from "vitest";
import { auditScoreLabel, salesPotentialFromAuditScore } from "@/lib/site-audit-score";

describe("site audit score presentation", () => {
  it("turns low website quality into high sales potential", () => {
    expect(salesPotentialFromAuditScore(1)).toBe(10);
    expect(salesPotentialFromAuditScore(4)).toBe(7);
  });

  it("turns modern website quality into low sales potential", () => {
    expect(salesPotentialFromAuditScore(8)).toBe(3);
    expect(salesPotentialFromAuditScore(10)).toBe(1);
  });

  it("handles missing and out-of-range values safely", () => {
    expect(salesPotentialFromAuditScore(null)).toBeNull();
    expect(salesPotentialFromAuditScore(0)).toBe(10);
    expect(salesPotentialFromAuditScore(12)).toBe(1);
    expect(auditScoreLabel(undefined)).toBe("—");
  });
});
