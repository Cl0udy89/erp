import type { MatchMethod } from "./finance-types"

interface EmployeeMatchCandidate {
  employeeId: string
  firstName: string | null
  lastName: string | null
  name: string
  nip: string | null
  birthDate: string | null
}

interface DocumentMatchSource {
  contractorName: string | null
  contractorTaxId: string | null
}

interface MatchResult {
  employeeId: string
  confidence: number
  matchMethod: MatchMethod
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= a.length; i++) matrix[i] = [i]
  for (let j = 0; j <= b.length; j++) matrix[0]![j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost
      )
    }
  }
  return matrix[a.length]![b.length]!
}

function nameMatchScore(contractorName: string, employeeFullName: string): number {
  const cNorm = normalize(contractorName)
  const eNorm = normalize(employeeFullName)

  if (cNorm === eNorm) return 1.0

  if (eNorm.includes(cNorm) || cNorm.includes(eNorm)) {
    const shorter = Math.min(cNorm.length, eNorm.length)
    const longer = Math.max(cNorm.length, eNorm.length)
    return 0.7 + 0.25 * (shorter / longer)
  }

  const cTokens = cNorm.split(/\s+/).filter((t) => t.length > 0)
  const eTokens = eNorm.split(/\s+/).filter((t) => t.length > 0)
  if (cTokens.length > 0 && eTokens.length > 0) {
    let matched = 0
    for (const cToken of cTokens) {
      for (const eToken of eTokens) {
        if (cToken === eToken) {
          matched++
          break
        }
        if (
          (cToken.length >= 3 && eToken.includes(cToken)) ||
          (eToken.length >= 3 && cToken.includes(eToken))
        ) {
          matched += 0.8
          break
        }
        if (cToken.length >= 4 && eToken.length >= 4) {
          const distance = levenshtein(cToken, eToken)
          const maxLen = Math.max(cToken.length, eToken.length)
          if (distance / maxLen <= 0.25) {
            matched += 0.8
            break
          }
        }
      }
    }
    const union = new Set([...cTokens, ...eTokens]).size
    const jaccard = matched / union
    if (jaccard > 0) return Math.min(0.4 + jaccard * 0.55, 0.94)
  }

  if (cNorm.length <= 30 && eNorm.length <= 30) {
    const distance = levenshtein(cNorm, eNorm)
    const maxLen = Math.max(cNorm.length, eNorm.length)
    const similarity = 1 - distance / maxLen
    if (similarity >= 0.6) return similarity * 0.65
  }

  return 0
}

const NAME_MATCH_THRESHOLD = 0.55

export function matchDocumentToEmployee(
  document: DocumentMatchSource,
  employees: EmployeeMatchCandidate[]
): MatchResult | null {
  if (!document.contractorName && !document.contractorTaxId) return null

  if (document.contractorTaxId) {
    const nipNorm = document.contractorTaxId.replace(/[\s-]/g, "")
    for (const emp of employees) {
      if (emp.nip) {
        const empNipNorm = emp.nip.replace(/[\s-]/g, "")
        if (nipNorm === empNipNorm) {
          return { employeeId: emp.employeeId, confidence: 1.0, matchMethod: "nip" }
        }
      }
    }
  }

  if (document.contractorName) {
    let bestMatch: EmployeeMatchCandidate | null = null
    let bestScore = 0

    for (const emp of employees) {
      const fullName = [emp.firstName, emp.lastName].filter(Boolean).join(" ")
      const score = Math.max(
        nameMatchScore(document.contractorName, fullName),
        emp.name ? nameMatchScore(document.contractorName, emp.name) : 0,
        nameMatchScore(document.contractorName, `${fullName} ${emp.name}`),
        nameMatchScore(document.contractorName, `${emp.name} ${fullName}`)
      )
      if (score > bestScore) {
        bestScore = score
        bestMatch = emp
      }
    }

    if (bestMatch && bestScore >= NAME_MATCH_THRESHOLD) {
      let method: MatchMethod = "name"
      if (document.contractorTaxId && bestMatch.birthDate) {
        method = "name_birthdate"
      }
      return { employeeId: bestMatch.employeeId, confidence: bestScore, matchMethod: method }
    }
  }

  return null
}
