// Single source of truth for turning a lead's *category* (the column that
// comes from the uploaded lead file) into a niche key + template.
// The category drives everything; the manual niche tag is only a fallback.

export type NicheKey = 'auto_workshop' | 'hair_salon' | 'construction'

export const TEMPLATE_BY_NICHE: Record<NicheKey, string> = {
  auto_workshop: 'auto_workshop_v1',
  hair_salon: 'hair_salon_v1',
  construction: 'construction_v1',
}

const SALON_RE =
  /hair|hairdresser|hair\s*salon|fris[öo]r|frisörsalong|salong|barber|barbershop|fade|klipp|beauty|sk[öo]nhet|nail|nagel|hudv[åa]rd|spa|lash|brow|makeup|massage/i

const BUILD_RE =
  /bygg|byggfirma|byggföretag|byggservice|entreprenad|snicker|snickare|murar|mureri|plattsätt|kakel|badrumsrenover|renover|takläggar|takarbete|fasad|m[åa]lare|m[åa]leri|mark(?:arbete|entrepren)|anläggning|grundarbet|betong|husbygg|construction|builder|contractor|roofing|plumb|rörmokar|elektriker|electrician/i

const AUTO_RE =
  /bilverkstad|verkstad|mekanik|bilservice|bilrekond|d[äa]ckverkstad|d[äa]ckhotell|bilv[åa]rd|billack|bilplåt|bilglas|mot?orverkstad|auto\s*repair|auto\s*shop|car\s*repair|mechanic|garage|tyre|tire|mot\b|bilfirma/i

/**
 * Classify from the lead's category (and optional extra hints such as the
 * company name). Returns null when no supported template matches — callers
 * must then use the freeform (AI-built) engine.
 */
export function classifyNiche(...hints: Array<unknown>): NicheKey | null {
  const text = hints
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map((v) => String(v))
    .join(' ')
  if (!text.trim()) return null
  if (SALON_RE.test(text)) return 'hair_salon'
  if (BUILD_RE.test(text)) return 'construction'
  if (AUTO_RE.test(text)) return 'auto_workshop'
  return null
}

export function templateForNiche(niche: NicheKey | null): string | null {
  return niche ? TEMPLATE_BY_NICHE[niche] : null
}
