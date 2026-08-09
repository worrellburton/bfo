import type { VercelRequest, VercelResponse } from "@vercel/node";
import { birdChannels, birdWorkspace, currentUser, fail, guard, handleError, isAdmin } from "../../lib/auth.js";

/**
 * Diagnostics for the Bird setup. Admin-only, and it never returns the access
 * key — only its shape, plus what the API says when we use it.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET"])) return;

  try {
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "unauthorized");
    if (!isAdmin(me)) return fail(res, 403, "forbidden");

    const rawKey = process.env.BIRD_ACCESS_KEY ?? "";
    const key = rawKey.trim().replace(/^["']|["']$/g, "");
    const rawWs = (process.env.BIRD_WORKSPACE_ID ?? "").trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawWs);

    const report: Record<string, unknown> = {
      key: {
        present: !!key,
        length: key.length,
        dashboardSuffix: key.slice(-6),
        hadWhitespace: rawKey !== rawKey.trim(),
      },
      configuredWorkspace: {
        value: rawWs || null,
        // Bird's API takes a UUID; a ws_… value is the dashboard identifier
        // and is ignored in favour of discovery.
        isUuid,
        used: isUuid,
      },
    };

    try {
      report.workspace = await birdWorkspace();
    } catch (err) {
      report.workspaceError = err instanceof Error ? err.message : String(err);
      return res.status(200).json(report);
    }

    try {
      const channels = await birdChannels();
      report.channels = channels.map((c) => ({
        id: c.id,
        name: c.name,
        platformId: c.platformId,
        status: c.status,
      }));
    } catch (err) {
      report.channelsError = err instanceof Error ? err.message : String(err);
    }

    return res.status(200).json(report);
  } catch (err) {
    return handleError(res, err);
  }
}
