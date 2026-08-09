import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, fail, guard, handleError, isAdmin } from "../../lib/auth.js";

/**
 * Diagnostics for the Bird credentials. Admin-only, and it never returns the
 * key itself — just its shape and how each endpoint responds, so a failing
 * setup can be identified without pasting secrets around.
 */

type Probe = { name: string; status: number | string; body: string };

async function probe(name: string, url: string, auth: string): Promise<Probe> {
  try {
    const res = await fetch(url, { headers: { Authorization: auth } });
    const text = await res.text();
    return { name, status: res.status, body: text.slice(0, 220) };
  } catch (err) {
    return { name, status: "network_error", body: err instanceof Error ? err.message : String(err) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET"])) return;

  try {
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    if (!isAdmin(me)) return fail(res, 403, "forbidden");

    const rawKey = process.env.BIRD_ACCESS_KEY ?? "";
    const rawWs = process.env.BIRD_WORKSPACE_ID ?? "";
    const key = rawKey.trim().replace(/^["']|["']$/g, "");
    const ws = rawWs.trim().replace(/^["']|["']$/g, "");

    if (!key || !ws) {
      return res.status(200).json({
        key: { present: !!key },
        workspace: { present: !!ws },
        probes: [],
      });
    }

    const probes = await Promise.all([
      probe("api.bird.com /workspaces (AccessKey)", "https://api.bird.com/workspaces", `AccessKey ${key}`),
      probe("api.bird.com /workspaces (Bearer)", "https://api.bird.com/workspaces", `Bearer ${key}`),
      probe(
        "api.bird.com /channels (AccessKey)",
        `https://api.bird.com/workspaces/${ws}/channels?limit=100`,
        `AccessKey ${key}`
      ),
      probe(
        "api.bird.com /channels (Bearer)",
        `https://api.bird.com/workspaces/${ws}/channels?limit=100`,
        `Bearer ${key}`
      ),
      // If this one is the only 200, the key is a legacy MessageBird key and
      // belongs on rest.messagebird.com rather than the Bird API.
      probe("rest.messagebird.com /balance (legacy)", "https://rest.messagebird.com/balance", `AccessKey ${key}`),
    ]);

    return res.status(200).json({
      key: {
        present: true,
        length: key.length,
        prefix: key.slice(0, 4),
        suffix: key.slice(-4),
        hadWhitespace: rawKey !== rawKey.trim(),
        hadQuotes: /^["']|["']$/.test(rawKey.trim()),
      },
      workspace: {
        present: true,
        value: ws,
        hadWhitespace: rawWs !== rawWs.trim(),
        looksLikeBirdId: /^ws_[a-z0-9]+$/i.test(ws),
      },
      probes,
    });
  } catch (err) {
    return handleError(res, err);
  }
}
