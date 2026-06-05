const DEFAULT_MODEL = "gpt-4o-mini";
const RETRIES = 1;
const ATTEMPT_TIMEOUT_MS = 10000;

interface PromptInput {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
}

interface ProviderConfig {
  provider: "openai_compatible";
  apiUrl: string;
  apiKey: string;
  model: string;
}

function trimEnv(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function getProviderConfig(): ProviderConfig | null {
  const provider = trimEnv(process.env.AI_PROVIDER);
  const apiKey = trimEnv(process.env.AI_API_KEY) || trimEnv(process.env.OPENAI_API_KEY);
  const apiUrl = trimEnv(process.env.AI_API_URL);

  if (!provider || !apiKey) return null;
  if (provider !== "openai_compatible") return null;
  if (!apiUrl) return null;

  return {
    provider,
    apiUrl,
    apiKey,
    model: trimEnv(process.env.AI_MODEL) || trimEnv(process.env.OPENAI_MODEL) || DEFAULT_MODEL,
  };
}

export function getEmployerAiProviderName(): string | null {
  return getProviderConfig()?.provider ?? null;
}

function buildRequestBody(config: ProviderConfig, input: PromptInput): Record<string, unknown> {
  if (config.apiUrl.includes("/responses")) {
    return {
      model: config.model,
      input: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
      temperature: 0.1,
      text: { format: { type: "json_object" } },
    };
  }

  return {
    model: config.model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
  };
}

function previewText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 700 ? `${compact.slice(0, 700)}…` : compact;
}

function readErrorDetails(payload: unknown): {
  type: string | null;
  code: string | null;
  param: string | null;
  message: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return { type: null, code: null, param: null, message: null };
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;
  const source = error && typeof error === "object" ? (error as Record<string, unknown>) : record;

  const readString = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  return {
    type: readString(source.type),
    code: readString(source.code),
    param: readString(source.param),
    message: readString(source.message) ?? readString(record.message),
  };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function extractTextFromResponse(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }

  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const text = content
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          const node = item as Record<string, unknown>;
          return typeof node.text === "string" ? node.text : "";
        })
        .join("")
        .trim();
      if (text) return text;
    }
  }

  const output = record.output;
  if (Array.isArray(output) && output.length > 0) {
    const parts = output
      .flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const node = item as Record<string, unknown>;
        const content = node.content;
        if (!Array.isArray(content)) return [];
        return content.flatMap((part) => {
          if (!part || typeof part !== "object") return [];
          const partRecord = part as Record<string, unknown>;
          if (typeof partRecord.text === "string") return [partRecord.text];
          if (typeof partRecord.content === "string") return [partRecord.content];
          return [];
        });
      })
      .join("")
      .trim();
    if (parts) return parts;
  }

  if (typeof record.content === "string" && record.content.trim()) {
    return record.content.trim();
  }

  return null;
}

async function requestOnce(config: ProviderConfig, input: PromptInput): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const response = await fetch(config.apiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(config, input)),
    });

    const rawText = await response.text().catch(() => "");
    const rawPreview = rawText ? previewText(rawText) : null;
    const payload = rawText ? (() => {
      try {
        return JSON.parse(rawText) as unknown;
      } catch {
        return null;
      }
    })() : null;
    if (!response.ok) {
      const status = response.status;
      const details = readErrorDetails(payload);
      console.warn(`[ai-provider] OpenAI error ${status}`);
      if (details.type) console.warn(`type: ${details.type}`);
      if (details.code) console.warn(`code: ${details.code}`);
      if (details.param) console.warn(`param: ${details.param}`);
      if (details.message) console.warn(`message: ${details.message}`);
      if (rawPreview) console.warn(`raw response preview: ${rawPreview}`);
      return null;
    }

    const text = extractTextFromResponse(payload);
    if (!text) {
      console.warn(`[ai-provider] ${config.provider} returned empty content for ${input.schemaName}`);
      return null;
    }

    try {
      const parsed = JSON.parse(stripCodeFence(text));
      return parsed;
    } catch {
      console.warn(`[ai-provider] ${config.provider} returned invalid JSON for ${input.schemaName}`);
      return null;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.name || error.message : "unknown error";
    console.warn(`[ai-provider] ${config.provider} request failed for ${input.schemaName}: ${reason}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runEmployerAiAnalysisPrompt(input: PromptInput): Promise<unknown> {
  const config = getProviderConfig();
  if (!config) return null;

  let lastResult: unknown = null;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    lastResult = await requestOnce(config, input);
    if (lastResult !== null) return lastResult;
  }

  return null;
}
