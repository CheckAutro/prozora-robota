import { hostFromUrl, isAllowedExternalHost, isPrivateHost, normalizeExternalUrl, sourceNameFromUrl } from "./source-normalizer";

export type SafeSourceFetchStatus = "success" | "blocked" | "unsupported" | "failed" | "timeout";

export interface SafeSourceFetchResult {
  status: SafeSourceFetchStatus;
  url: string;
  sourceName?: string;
  title?: string | null;
  description?: string | null;
  text?: string | null;
  reason?: string;
  statusCode?: number | null;
}

export interface SafeSourceFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  allowAnyPublicHost?: boolean;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function extractTitle(html: string): string | null {
  const meta = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i.exec(html)
    ?? /<meta[^>]+name=["']title["'][^>]*content=["']([^"']+)["'][^>]*>/i.exec(html);
  if (meta?.[1]) return decodeHtmlEntities(meta[1]).replace(/\s+/g, " ").trim().slice(0, 180);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (title) return decodeHtmlEntities(title).replace(/\s+/g, " ").trim().slice(0, 180);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (h1) return stripHtml(h1).slice(0, 180);
  return null;
}

function extractDescription(html: string): string | null {
  const meta = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i.exec(html)
    ?? /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i.exec(html);
  if (meta?.[1]) return decodeHtmlEntities(meta[1]).replace(/\s+/g, " ").trim().slice(0, 300);
  return null;
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const decoder = new TextDecoder("utf-8");
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(merged);
}

function isBlockedHtml(status: number, html: string): boolean {
  if ([401, 403, 429].includes(status)) return true;
  return /captcha|cloudflare|access denied|robot check|перевірте що ви не робот|доступ обмежено/i.test(html);
}

function isUnsupportedUrl(url: string, allowAnyPublicHost: boolean): boolean {
  try {
    const parsed = new URL(url);
    const host = hostFromUrl(parsed.toString());
    if (!parsed.protocol.startsWith("http")) return true;
    if (isPrivateHost(host)) return true;
    if (allowAnyPublicHost) return false;
    return !isAllowedExternalHost(parsed.toString());
  } catch {
    return true;
  }
}

export async function readExternalSourceUrl(
  inputUrl: string,
  options: SafeSourceFetchOptions = {}
): Promise<SafeSourceFetchResult> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const allowAnyPublicHost = options.allowAnyPublicHost ?? false;
  const normalized = normalizeExternalUrl(inputUrl, false);
  if (!normalized) {
    return { status: "unsupported", url: inputUrl, reason: "invalid url" };
  }
  if (isUnsupportedUrl(normalized, allowAnyPublicHost)) {
    return { status: "unsupported", url: normalized, reason: "unsupported host" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(normalized, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "WorkRadar external source collector (+https://prozora-robota.vercel.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const body = await readBodyWithLimit(response, maxBytes);
    if (isBlockedHtml(response.status, body)) {
      return {
        status: "blocked",
        url: normalized,
        sourceName: sourceNameFromUrl(normalized),
        reason: "blocked or captcha-like response",
        statusCode: response.status,
      };
    }
    if (!response.ok || !body) {
      return {
        status: "failed",
        url: normalized,
        sourceName: sourceNameFromUrl(normalized),
        reason: `non-ok response ${response.status}`,
        statusCode: response.status,
      };
    }

    const title = extractTitle(body);
    const description = extractDescription(body);
    return {
      status: "success",
      url: normalized,
      sourceName: sourceNameFromUrl(normalized),
      title,
      description,
      text: stripHtml(body).slice(0, maxBytes),
      statusCode: response.status,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return {
      status: isTimeout ? "timeout" : "failed",
      url: normalized,
      sourceName: sourceNameFromUrl(normalized),
      reason: isTimeout ? "timeout" : error instanceof Error ? error.message : "fetch failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

