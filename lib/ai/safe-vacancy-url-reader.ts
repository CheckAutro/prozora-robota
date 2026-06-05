import {
  detectVacancyInput,
  parseRobotaUaVacancy,
  parseWorkUaVacancy,
} from "@/lib/vacancy-parser";
import type { SafeVacancyReadResult } from "./types";

const ALLOWED_HOSTS = [
  "work.ua",
  "robota.ua",
  "jobs.dou.ua",
  "djinni.co",
  "grc.ua",
];

const MAX_BODY_BYTES = 1024 * 1024;
const TIMEOUT_MS = 8000;

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (!isIpAddress(host)) return false;
  if (host === "0.0.0.0" || host === "127.0.0.1" || host === "::1") return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

function allowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function detectBlocked(html: string, status: number): boolean {
  if ([401, 403, 429].includes(status)) return true;
  return /captcha|cloudflare|access denied|robot check|перевірте, що ви не робот|захист від роботів/i.test(html);
}

async function readLimitedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw new Error("response body too large");
  }

  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      throw new Error("response body too large");
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

function sourceNameFromHost(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host.includes("work.ua")) return "Work.ua";
  if (host.includes("robota.ua")) return "Robota.ua";
  if (host.includes("dou.ua")) return "DOU";
  if (host.includes("djinni.co")) return "Djinni";
  if (host.includes("grc.ua")) return "GRC.ua";
  return "URL";
}

export async function readVacancyUrl(urlInput: string): Promise<SafeVacancyReadResult> {
  let url: URL;
  try {
    url = new URL(urlInput);
  } catch {
    return { status: "unsupported", reason: "Некоректний URL." };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { status: "unsupported", reason: "Підтримуються тільки http/https URL." };
  }

  if (isPrivateHostname(url.hostname) || !allowedHost(url.hostname)) {
    return { status: "unsupported", reason: "Цей домен не входить до allowlist для безпечного читання." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "WorkRadar AI vacancy analyzer (+https://prozora-robota.vercel.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await readLimitedText(response);

    if (!response.ok || detectBlocked(html, response.status)) {
      return {
        status: "blocked",
        sourceName: sourceNameFromHost(url.hostname),
        reason: "Джерело не віддало сторінку звичайним fetch або показало захист.",
      };
    }

    const detected = detectVacancyInput(url.toString());
    if (detected.inputType === "work.ua URL") {
      const parsed = parseWorkUaVacancy(html, url.toString()).parsed;
      return {
        status: "success",
        sourceName: "Work.ua",
        title: parsed.title ?? undefined,
        companyName: parsed.companyName ?? undefined,
        city: parsed.city ?? undefined,
        salaryText: parsed.salaryText ?? undefined,
        text: parsed.descriptionText || stripHtml(html).slice(0, 12000),
      };
    }
    if (detected.inputType === "robota.ua URL") {
      const parsed = parseRobotaUaVacancy(html, url.toString()).parsed;
      return {
        status: "success",
        sourceName: "Robota.ua",
        title: parsed.title ?? undefined,
        companyName: parsed.companyName ?? undefined,
        city: parsed.city ?? undefined,
        salaryText: parsed.salaryText ?? undefined,
        text: parsed.descriptionText || stripHtml(html).slice(0, 12000),
      };
    }

    return {
      status: "success",
      sourceName: sourceNameFromHost(url.hostname),
      title: stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 180),
      text: stripHtml(html).slice(0, 12000),
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      status: aborted ? "timeout" : "failed",
      sourceName: sourceNameFromHost(url.hostname),
      reason: aborted ? "Час очікування вичерпано." : "Не вдалося прочитати URL звичайним fetch.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
