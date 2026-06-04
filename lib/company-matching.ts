// Company matching and slug helpers for vacancy/company discovery.
// This module never creates companies by itself; callers decide based on confidence.

import { slugifyCompanyName } from "./slugify";
import { COMPANY_ALIASES, normalizeLookupText, stripLegalSuffix } from "./vacancy-parser";

export interface MatchableCompany {
  name: string;
  slug: string;
  city?: string | null;
  industry?: string | null;
}

export type CompanyMatchConfidence = "low" | "medium" | "high";

export interface CompanyMatch {
  company: MatchableCompany | null;
  score: number;
  confidence: CompanyMatchConfidence;
  reason: string;
  suggestedSlug: string;
}

const LEGAL_SUFFIX_PATTERN = /\b(тов|тзов|ооо|llc|ltd|inc|ат|пат|прат|приватне підприємство|пп|фоп|філія|представництво)\b/gi;
const SHORT_NAME_LENGTH = 4;

export function normalizeCompanyName(name: string): string {
  return normalizeLookupText(name)
    .replace(LEGAL_SUFFIX_PATTERN, " ")
    .replace(/\b(україна|украина|ukraine)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function generateCompanySlug(name: string): string {
  return slugifyCompanyName(normalizeCompanyName(name) || name);
}

function compact(value: string): string {
  return normalizeCompanyName(value).replace(/[^a-zа-яіїєґ0-9]/gi, "");
}

function isShortName(value: string): boolean {
  return compact(value).length <= SHORT_NAME_LENGTH;
}

function namesFor(company: MatchableCompany): string[] {
  return [
    company.name,
    normalizeCompanyName(company.name),
    stripLegalSuffix(company.name),
    company.slug,
    generateCompanySlug(company.name),
    ...(COMPANY_ALIASES[company.slug] ?? []),
  ].filter(Boolean);
}

export function findBestCompanyMatch(
  discoveredName: string | null | undefined,
  companies: MatchableCompany[]
): CompanyMatch {
  const rawName = discoveredName?.trim() ?? "";
  const suggestedSlug = rawName ? generateCompanySlug(rawName) : "";
  if (!rawName || !suggestedSlug) {
    return { company: null, score: 0, confidence: "low", reason: "missing-name", suggestedSlug };
  }

  const normalized = normalizeCompanyName(rawName);
  const stripped = stripLegalSuffix(rawName);
  const rawSlug = slugifyCompanyName(rawName);
  const short = isShortName(rawName);

  const scored = companies.map((company) => {
    const names = namesFor(company);
    const normalizedNames = names.map(normalizeCompanyName).filter(Boolean);
    const strippedNames = names.map(stripLegalSuffix).filter(Boolean);
    const slugNames = names.map(slugifyCompanyName).filter(Boolean);

    if (normalizedNames.includes(normalized) || strippedNames.includes(stripped)) {
      return { company, score: 1000, reason: "exact-name" };
    }
    if (rawSlug && slugNames.includes(rawSlug)) {
      return { company, score: 980, reason: "exact-slug" };
    }

    if (short) return { company, score: 0, reason: "short-name-no-fuzzy" };

    const byContains = stripped.length > 4 && strippedNames.some((name) => {
      return name.length > 4 && (stripped.includes(name) || name.includes(stripped));
    });
    if (byContains) return { company, score: 850, reason: "contains-name" };

    const rawTokens = normalized.split(" ").filter((token) => token.length > 2);
    const companyTokens = new Set(normalizedNames.flatMap((name) => name.split(" ").filter((token) => token.length > 2)));
    const tokenHits = rawTokens.filter((token) => companyTokens.has(token)).length;
    if (rawTokens.length >= 2 && tokenHits === rawTokens.length) {
      return { company, score: 720, reason: "token-match" };
    }

    return { company, score: 0, reason: "no-match" };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 700) {
    return { company: null, score: best?.score ?? 0, confidence: "low", reason: best?.reason ?? "no-match", suggestedSlug };
  }

  const confidence: CompanyMatchConfidence = best.score >= 900 ? "high" : best.score >= 800 ? "medium" : "low";
  return {
    company: best.company,
    score: best.score,
    confidence,
    reason: best.reason,
    suggestedSlug,
  };
}

export function isConfidentCompanyMatch(match: CompanyMatch): boolean {
  return Boolean(match.company && match.confidence === "high" && match.score >= 900);
}
