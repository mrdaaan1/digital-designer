// Клиент OpenRouter. Поддерживает текстовые и мультимодальные (vision)
// сообщения, а также структурированный JSON-вывод через response_format.

export type TextContentPart = { type: 'text'; text: string };
export type ImageContentPart = { type: 'image_url'; image_url: { url: string } };
export type ContentPart = TextContentPart | ImageContentPart;

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
};

// Модели по умолчанию — переопределяются через env, чтобы не быть привязанными
// к конкретному провайдеру на случай изменения доступности бесплатных моделей.
export const ANALYSIS_VISION_MODEL =
  process.env.OPENROUTER_VISION_MODEL ?? 'google/gemini-2.5-flash-lite';
export const CONTENT_MODEL =
  process.env.OPENROUTER_CONTENT_MODEL ?? 'google/gemini-2.5-flash-lite';

const CALL_MAX_ATTEMPTS = 3;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://digital-designer-39i1.vercel.app';

export function imagePart(base64Png: string): ImageContentPart {
  return { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Png}` } };
}

export function textPart(text: string): TextContentPart {
  return { type: 'text', text };
}

type CallOptions = {
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  temperature?: number;
  maxTokens?: number;
};

// Дефолт модели часто недостаточен для развёрнутых JSON-ответов (анализ
// дизайн-системы с 7+ паттернами по 10+ ролей каждый) — без явного max_tokens
// ответ обрезается на середине и JSON.parse падает.
const DEFAULT_MAX_TOKENS = 8000;

export async function callOpenRouter(
  model: string,
  messages: ChatMessage[],
  options?: CallOptions,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const responseFormat = options?.jsonSchema
    ? {
        type: 'json_schema' as const,
        json_schema: {
          name: options.jsonSchema.name,
          strict: true,
          schema: options.jsonSchema.schema,
        },
      }
    : undefined;

  let lastError: unknown;
  for (let attempt = 1; attempt <= CALL_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': APP_URL,
          'X-Title': 'Digital Designer',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options?.temperature ?? 0.4,
          max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 800)}`);
      }

      const data = await res.json();
      const text: string | undefined = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('OpenRouter returned empty response');
      return text.trim();
    } catch (e) {
      lastError = e;
      if (attempt < CALL_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastError;
}

export async function callOpenRouterJson<T>(
  model: string,
  messages: ChatMessage[],
  jsonSchema: { name: string; schema: Record<string, unknown> },
  temperature?: number,
  maxTokens?: number,
): Promise<T> {
  const raw = await callOpenRouter(model, messages, { jsonSchema, temperature, maxTokens });
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `Модель вернула некорректный JSON (возможно, ответ обрезан по длине): ${raw.slice(0, 300)}`,
    );
  }
}
