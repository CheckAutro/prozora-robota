import { getServiceClient } from "@/lib/supabase/server";
import type {
  AiConfidenceLevel,
  ExternalSourceCandidate,
  ExternalSourceSignalType,
} from "./types";

interface FinderInput {
  companyName?: string | null;
  companySlug?: string | null;
  vacancyUrl?: string | null;
  vacancyText?: string | null;
}

interface FinderResult {
  sources: ExternalSourceCandidate[];
  warnings: string[];
}

const SEARCH_ALLOWED_HOSTS = [
  "dou.ua",
  "djinni.co",
  "robota.ua",
  "work.ua",
  "grc.ua",
];
const SEARCH_UNAVAILABLE_MESSAGE =
  "Зовнішній пошук джерел поки не активний. Аналіз виконано на основі доступних даних сайту.";

function cleanText(value: unknown, limit = 500): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sourceNameFromUrl(value: string): string {
  const host = hostFromUrl(value);
  if (host.includes("work.ua")) return "Work.ua";
  if (host.includes("robota.ua")) return "Robota.ua";
  if (host.includes("dou.ua")) return "DOU";
  if (host.includes("djinni.co")) return "Djinni";
  if (host.includes("grc.ua")) return "GRC.ua";
  return host || "Зовнішнє джерело";
}

function allowedSearchUrl(value: string): boolean {
  const host = hostFromUrl(value);
  return SEARCH_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function uniqueSources(sources: ExternalSourceCandidate[]): ExternalSourceCandidate[] {
  const seen = new Set<string>();
  const result: ExternalSourceCandidate[] = [];
  for (const source of sources) {
    const key = `${source.source_url}|${source.title}|${source.snippet}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result.slice(0, 12);
}

function inferSignalType(title: string, snippet: string, url: string): ExternalSourceSignalType {
  const text = `${title} ${snippet} ${url}`.toLowerCase();
  if (/відгук|відгуки|reviews?|отзыв|отзывы/.test(text)) return "review";
  if (/rating|рейтинг|оцінк|оценк|stars?/.test(text)) return "rating";
  if (/ваканс|job|vacancy|робота/.test(text)) return "vacancy";
  if (/forum|обговор|discussion|коментар/.test(text)) return "discussion";
  if (/company|компан|роботодав/.test(text)) return "company_page";
  return "unknown";
}

function inferConfidence(sourceName: string, title: string, snippet: string): AiConfidenceLevel {
  const text = `${title} ${snippet}`.toLowerCase();
  if (/відгук|відгуки|оцінк|рейтинг|reviews?|rating/.test(text)) return "high";
  if (["DOU", "Djinni", "Work.ua", "Robota.ua"].includes(sourceName)) return "medium";
  return "low";
}

async function loadControlledSources(input: FinderInput): Promise<ExternalSourceCandidate[]> {
  if (!input.companySlug) return [];

  const client = getServiceClient();
  const sources: ExternalSourceCandidate[] = [];

  const [reviews, openFacts, ratings, signals] = await Promise.all([
    client
      .from("reviews")
      .select("id, role_category, city, year")
      .eq("company_slug", input.companySlug)
      .eq("status", "published")
      .limit(5),
    client
      .from("company_open_facts")
      .select("source_name, source_url, vacancy_title, raw_excerpt")
      .eq("company_slug", input.companySlug)
      .eq("status", "verified")
      .eq("is_public", true)
      .limit(8),
    client
      .from("external_ratings")
      .select("source_name, source_url, rating_value, rating_scale, reviews_count")
      .eq("company_slug", input.companySlug)
      .eq("status", "verified")
      .eq("is_public", true)
      .limit(8),
    client
      .from("external_review_signals")
      .select("source_name, source_url, topic, summary, confidence")
      .eq("company_slug", input.companySlug)
      .eq("status", "verified")
      .eq("is_public", true)
      .limit(8),
  ]);

  if (reviews.data && reviews.data.length > 0) {
    sources.push({
      source_name: "Прозора робота",
      source_url: `https://prozora-robota.vercel.app/companies/${input.companySlug}`,
      title: "Опубліковані відгуки на Прозора робота",
      snippet: `Є ${reviews.data.length} прикладів опублікованих відгуків у контрольованій базі.`,
      signal_type: "review",
      confidence: "high",
    });
  }

  for (const row of (openFacts.data ?? []) as Record<string, unknown>[]) {
    const sourceUrl = cleanText(row.source_url, 500);
    sources.push({
      source_name: cleanText(row.source_name, 80) || sourceNameFromUrl(sourceUrl),
      source_url: sourceUrl,
      title: cleanText(row.vacancy_title, 180) || "Дані з відкритої вакансії",
      snippet: cleanText(row.raw_excerpt, 260) || "Є підтверджений відкритий факт з вакансії.",
      signal_type: "vacancy",
      confidence: "high",
    });
  }

  for (const row of (ratings.data ?? []) as Record<string, unknown>[]) {
    const sourceUrl = cleanText(row.source_url, 500);
    const rating = typeof row.rating_value === "number"
      ? `${row.rating_value} / ${typeof row.rating_scale === "number" ? row.rating_scale : 5}`
      : "оцінка не вказана";
    sources.push({
      source_name: cleanText(row.source_name, 80) || sourceNameFromUrl(sourceUrl),
      source_url: sourceUrl,
      title: "Підтверджена зовнішня оцінка",
      snippet: `Оцінка: ${rating}; кількість оцінок: ${Number(row.reviews_count ?? 0)}.`,
      signal_type: "rating",
      confidence: "high",
    });
  }

  for (const row of (signals.data ?? []) as Record<string, unknown>[]) {
    const sourceUrl = cleanText(row.source_url, 500);
    sources.push({
      source_name: cleanText(row.source_name, 80) || sourceNameFromUrl(sourceUrl),
      source_url: sourceUrl,
      title: `Підтверджений зовнішній сигнал: ${cleanText(row.topic, 80) || "other"}`,
      snippet: cleanText(row.summary, 260),
      signal_type: "review",
      confidence: row.confidence === "high" || row.confidence === "low" ? row.confidence : "medium",
    });
  }

  return sources.filter((source) => source.source_url || source.source_name === "Прозора робота");
}

function parseSearchItems(payload: unknown): Array<{ title: string; url: string; snippet: string }> {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.organic,
    record.organic_results,
    record.results,
    record.items,
  ].find(Array.isArray) as unknown[] | undefined;
  if (!candidates) return [];

  return candidates
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        title: cleanText(row.title, 180),
        url: cleanText(row.link ?? row.url, 500),
        snippet: cleanText(row.snippet ?? row.description, 320),
      };
    })
    .filter((item) => item.title && item.url && allowedSearchUrl(item.url));
}

async function searchExternalSources(input: FinderInput): Promise<{ sources: ExternalSourceCandidate[]; warnings: string[] }> {
  const apiKey = process.env.SEARCH_API_KEY ?? "";
  const apiUrl = process.env.SEARCH_API_URL ?? "";
  const warnings: string[] = [];

  if (!apiKey || !apiUrl) {
    return {
      sources: [],
      warnings: [SEARCH_UNAVAILABLE_MESSAGE],
    };
  }

  const companyName = input.companyName?.trim();
  if (!companyName) {
    return { sources: [], warnings: ["Назву компанії не визначено, зовнішній пошук пропущено."] };
  }

  const query = `${companyName} відгуки роботодавець OR reviews site:dou.ua OR site:djinni.co OR site:work.ua OR site:robota.ua`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ q: query, query, num: 8 }),
    });

    if (!response.ok) {
      return { sources: [], warnings: [SEARCH_UNAVAILABLE_MESSAGE] };
    }

    const payload = await response.json();
    const sources = parseSearchItems(payload).map((item) => {
      const sourceName = sourceNameFromUrl(item.url);
      return {
        source_name: sourceName,
        source_url: item.url,
        title: item.title,
        snippet: item.snippet,
        signal_type: inferSignalType(item.title, item.snippet, item.url),
        confidence: inferConfidence(sourceName, item.title, item.snippet),
      };
    });
    return { sources, warnings };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      sources: [],
      warnings: [SEARCH_UNAVAILABLE_MESSAGE],
    };
  } finally {
    clearTimeout(timeout);
  }
}

function inferTopic(source: ExternalSourceCandidate): string {
  const text = `${source.title} ${source.snippet}`.toLowerCase();
  if (/зарплат|salary|оплат|виплат/.test(text)) return "salary";
  if (/графік|schedule|навантаж|workload|понаднорм/.test(text)) return "workload";
  if (/оформлен|договір|employment/.test(text)) return "employment";
  if (/керівниц|management|manager/.test(text)) return "management";
  if (/співбесід|interview/.test(text)) return "interview";
  if (/бронюван|відстроч/.test(text)) return "booking";
  if (/бонус|benefit|переваг/.test(text)) return "benefits";
  return "other";
}

function inferSentiment(source: ExternalSourceCandidate): string {
  const text = `${source.title} ${source.snippet}`.toLowerCase();
  if (/затрим|штраф|негатив|скарг|низьк|поган|bad|negative/.test(text)) return "negative";
  if (/змішан|mixed|частково|але/.test(text)) return "mixed";
  if (/позитив|добре|висок|positive|good/.test(text)) return "positive";
  return "neutral";
}

function signalSummary(source: ExternalSourceCandidate): string {
  const snippet = source.snippet || source.title;
  const summary = `Знайдено потенційний зовнішній сигнал: ${snippet}`;
  return summary.slice(0, 300);
}

async function saveUnverifiedSignals(
  input: FinderInput,
  sources: ExternalSourceCandidate[]
): Promise<void> {
  if (!input.companySlug || !input.companyName) return;

  const externalCandidates = sources.filter(
    (source) =>
      source.source_name !== "Прозора робота" &&
      ["review", "rating", "discussion", "unknown"].includes(source.signal_type) &&
      source.source_url
  );
  if (externalCandidates.length === 0) return;

  const client = getServiceClient();
  for (const source of externalCandidates.slice(0, 8)) {
    const summary = signalSummary(source);
    if (summary.length < 20) continue;
    const { error } = await client.from("external_review_signals").insert({
      company_slug: input.companySlug,
      company_name: input.companyName,
      source_name: source.source_name,
      source_url: source.source_url,
      topic: inferTopic(source),
      sentiment: inferSentiment(source),
      summary,
      mentions_count: 1,
      confidence: source.confidence,
      status: "needs_verification",
      is_public: false,
      admin_note: `AI external search candidate. signal_type=${source.signal_type}; title=${source.title}; snippet=${source.snippet}`,
    });
    if (error && error.code !== "23505" && process.env.NODE_ENV === "development") {
      console.warn("[external-source-finder] signal save skipped:", error.message);
    }
  }
}

export async function findEmployerExternalSources(input: FinderInput): Promise<FinderResult> {
  const warnings: string[] = [];
  const controlled = await loadControlledSources(input);
  const searched = await searchExternalSources(input);
  warnings.push(...searched.warnings);

  const sources = uniqueSources([...controlled, ...searched.sources]);
  await saveUnverifiedSignals(input, searched.sources);

  return { sources, warnings };
}
