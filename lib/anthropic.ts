import Anthropic from "@anthropic-ai/sdk";
import { ConfigError, sb } from "./auth.js";
import { log } from "./log.js";

/**
 * Claude, for the server: one client with a timeout and a retry budget, and
 * every call written down in public.ai_usage (model, tokens in and out, how
 * long it took, who asked and for which entity) so spend on Ask BFO and
 * document reading is visible, not a surprise on the invoice.
 *
 *   const message = await askModel("documents:classify", params, { actorId: user.id, assetId });
 *
 * Streaming calls (Ask BFO) keep using the client from `anthropic()` and
 * record their usage with `recordAiUsage` when the stream ends.
 *
 * Env: ANTHROPIC_API_KEY.
 */

/** Longer than a document read ever takes; shorter than a Vercel function's limit, so the caller can still answer. */
export const AI_TIMEOUT_MS = 90_000;

export function anthropic(opts: { timeoutMs?: number } = {}): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new ConfigError("ANTHROPIC_API_KEY is not set.");
  return new Anthropic({ apiKey, timeout: opts.timeoutMs ?? AI_TIMEOUT_MS, maxRetries: 2 });
}

export type AiUsageContext = {
  /** Which feature asked ("ask", "documents:classify", "mail:improve"). */
  area: string;
  actorId?: string | null;
  assetId?: string | null;
};

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

/** One row in ai_usage. Never throws: a call that can't be written down still answers. */
export async function recordAiUsage(ctx: AiUsageContext, model: string, usage: Usage | null | undefined, ms: number, error?: unknown): Promise<void> {
  const row = {
    area: ctx.area.slice(0, 60),
    model: model.slice(0, 80),
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
    cache_write_tokens: usage?.cache_creation_input_tokens ?? 0,
    ms: Math.max(0, Math.round(ms)),
    actor_id: ctx.actorId ?? null,
    asset_id: ctx.assetId ?? null,
    ok: !error,
    error: error ? String(error instanceof Error ? error.message : error).slice(0, 300) : null,
  };
  await sb("ai_usage", { method: "POST", body: row, prefer: "return=minimal" }).catch((err) => log.error("ai", "couldn't record usage", { error: err, area: ctx.area }));
}

/**
 * One non-streaming call, timed and recorded. `headers` carry a beta flag
 * when a call needs one; a request the API refuses still records the
 * attempt (ok=false) so a bad prompt shows up next to its cost.
 */
export async function askModel(
  ctx: AiUsageContext,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Anthropic.Messages.Message> {
  const client = anthropic({ timeoutMs: opts.timeoutMs });
  const started = Date.now();
  try {
    const message = await client.messages.create(params, opts.headers ? { headers: opts.headers } : undefined);
    void recordAiUsage(ctx, message.model ?? params.model, message.usage, Date.now() - started);
    return message;
  } catch (err) {
    void recordAiUsage(ctx, params.model, null, Date.now() - started, err);
    throw err;
  }
}

/** True when Anthropic refused for lack of credit; the user gets a plain message instead of a stack. */
export function outOfCredit(err: unknown): boolean {
  return err instanceof Anthropic.APIError && (err.status === 402 || /credit balance|billing/i.test(err.message));
}

export { Anthropic };
