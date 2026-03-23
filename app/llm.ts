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
      // Convert Anthropic content blocks to OpenAI format
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
          // OpenAI doesn't natively support PDFs in chat — send as text note
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

export async function streamChat(
  model: string,
  apiKey: string,
  messages: LLMMessage[],
  systemPrompt: string | undefined,
  callbacks: StreamCallbacks,
): Promise<void> {
  if (isOpenAI(model)) {
    await streamOpenAI(model, apiKey, messages, systemPrompt, callbacks);
  } else {
    await streamAnthropic(model, apiKey, messages, systemPrompt, callbacks);
  }
}

async function streamAnthropic(
  model: string,
  apiKey: string,
  messages: LLMMessage[],
  systemPrompt: string | undefined,
  { onToken, onDone, onError }: StreamCallbacks,
) {
  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages,
    stream: true,
  };
  if (systemPrompt) body.system = systemPrompt;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    onError(`${res.status} — ${err}`);
    return;
  }

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
        if (parsed.type === "content_block_delta" && parsed.delta?.text) {
          onToken(parsed.delta.text);
        }
      } catch { /* skip */ }
    }
  }
  onDone();
}

async function streamOpenAI(
  model: string,
  apiKey: string,
  messages: LLMMessage[],
  systemPrompt: string | undefined,
  { onToken, onDone, onError }: StreamCallbacks,
) {
  const openAIMessages = toOpenAIMessages(messages, systemPrompt);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: openAIMessages,
      stream: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    onError(`${res.status} — ${err}`);
    return;
  }

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
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          onToken(delta);
        }
      } catch { /* skip */ }
    }
  }
  onDone();
}

// Non-streaming call for meetings
export async function callLLM(
  model: string,
  apiKey: string,
  messages: LLMMessage[],
  systemPrompt: string | undefined,
): Promise<string> {
  if (isOpenAI(model)) {
    const openAIMessages = toOpenAIMessages(messages, systemPrompt);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages: openAIMessages }),
    });
    if (!res.ok) return `[Error: ${res.status}]`;
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "[No response]";
  } else {
    const body: Record<string, unknown> = {
      model,
      max_tokens: 1024,
      messages,
      stream: false,
    };
    if (systemPrompt) body.system = systemPrompt;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return `[Error: ${res.status}]`;
    const data = await res.json();
    return data.content?.[0]?.text || "[No response]";
  }
}
