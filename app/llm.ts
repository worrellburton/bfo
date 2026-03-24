// Shared LLM API utilities for multi-provider support

export function isOpenAI(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.startsWith("o4");
}

interface LLMMessage {
  role: string;
  content: unknown;
}

// Convert Anthropic-style messages to OpenAI format
function toOpenAIMessages(messages: LLMMessage[], systemPrompt?: string): unknown[] {
  const out: unknown[] = [];
  if (systemPrompt) {
    out.push({ role: "system", content: systemPrompt });
  }
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      const parts: unknown[] = [];
      for (const block of m.content as Record<string, unknown>[]) {
        if (block.type === "text") {
          parts.push({ type: "text", text: block.text });
        } else if (block.type === "image") {
          const src = block.source as Record<string, string>;
          parts.push({
            type: "image_url",
            image_url: { url: `data:${src.media_type};base64,${src.data}` },
          });
        } else if (block.type === "document") {
          parts.push({ type: "text", text: "[PDF document attached — PDF content analysis not available with this model]" });
        }
      }
      out.push({ role: m.role, content: parts });
    }
  }
  return out;
}

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

// Shared SSE stream reader — extracts text deltas from an SSE response
async function readSSEStream(
  res: Response,
  extractToken: (parsed: Record<string, unknown>) => string | undefined,
  { onToken, onDone, onError }: StreamCallbacks,
) {
  const reader = res.body?.getReader();
  if (!reader) { onError("No reader"); return; }
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const token = extractToken(parsed);
        if (token) onToken(token);
      } catch { /* skip */ }
    }
  }
  onDone();
}

// Build request config for each provider
function anthropicRequest(model: string, apiKey: string, messages: LLMMessage[], systemPrompt: string | undefined, stream: boolean) {
  const body: Record<string, unknown> = { model, max_tokens: stream ? 4096 : 1024, messages, stream };
  if (systemPrompt) body.system = systemPrompt;
  return {
    url: "https://api.anthropic.com/v1/messages",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    },
  };
}

function openAIRequest(model: string, apiKey: string, messages: LLMMessage[], systemPrompt: string | undefined, stream: boolean) {
  const openAIMessages = toOpenAIMessages(messages, systemPrompt);
  return {
    url: "https://api.openai.com/v1/chat/completions",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages: openAIMessages, ...(stream ? { stream: true } : {}) }),
    },
  };
}

// Token extractors for each provider's SSE format
const anthropicExtract = (parsed: Record<string, unknown>) =>
  parsed.type === "content_block_delta" ? (parsed.delta as Record<string, string>)?.text : undefined;

const openAIExtract = (parsed: Record<string, unknown>) =>
  ((parsed.choices as Record<string, unknown>[])?.[0]?.delta as Record<string, string>)?.content;

export async function streamChat(
  model: string,
  apiKey: string,
  messages: LLMMessage[],
  systemPrompt: string | undefined,
  callbacks: StreamCallbacks,
): Promise<void> {
  const useOpenAI = isOpenAI(model);
  const { url, init } = useOpenAI
    ? openAIRequest(model, apiKey, messages, systemPrompt, true)
    : anthropicRequest(model, apiKey, messages, systemPrompt, true);

  const res = await fetch(url, init);
  if (!res.ok) {
    const err = await res.text();
    callbacks.onError(`${res.status} — ${err}`);
    return;
  }

  await readSSEStream(res, useOpenAI ? openAIExtract : anthropicExtract, callbacks);
}

// Non-streaming call for meetings
export async function callLLM(
  model: string,
  apiKey: string,
  messages: LLMMessage[],
  systemPrompt: string | undefined,
): Promise<string> {
  const useOpenAI = isOpenAI(model);
  const { url, init } = useOpenAI
    ? openAIRequest(model, apiKey, messages, systemPrompt, false)
    : anthropicRequest(model, apiKey, messages, systemPrompt, false);

  const res = await fetch(url, init);
  if (!res.ok) return `[Error: ${res.status}]`;
  const data = await res.json();

  return useOpenAI
    ? data.choices?.[0]?.message?.content || "[No response]"
    : data.content?.[0]?.text || "[No response]";
}
