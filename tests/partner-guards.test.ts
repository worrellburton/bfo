import { describe, expect, it, vi } from "vitest";

// currentUser refuses a partner by throwing; every endpoint must turn that
// into a 403 (lib/auth.ts handleError), not let it escape as a crashed
// function (Vercel's own 500).
vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    currentUser: async () => {
      throw new actual.PartnerRefused("Not available to entity owners.");
    },
  };
});

import booksData from "../api/books/data";
import importCsv from "../api/books/import-csv";
import uploadReceipt from "../api/books/upload-receipt";
import classify from "../api/documents/classify";
import deleteDoc from "../api/documents/delete";
import profile from "../api/documents/profile";
import uploadUrl from "../api/documents/upload-url";
import verify from "../api/documents/verify";
import renameDoc from "../api/rename-doc";
import backfill from "../api/mercury/backfill";
import palm from "../api/palm";
import ask from "../api/ask";
import brand from "../api/brand";
import booksSync from "../api/cron/books-sync";

type Handler = (req: any, res: any) => unknown;

async function call(handler: Handler, method: string, query: Record<string, string> = {}) {
  const out: { status: number; json?: unknown } = { status: 0 };
  const res: any = {
    status: (c: number) => ((out.status = c), res),
    json: (j: unknown) => ((out.json = j), res),
    end: () => res,
    setHeader() {},
  };
  await handler({ method, body: { action: "status" }, query, headers: {} }, res);
  return out;
}

describe("endpoints refuse a partner with 403", () => {
  const cases: Array<[string, Handler, string, Record<string, string>?]> = [
    ["books/data", booksData, "GET"],
    ["books/import-csv", importCsv, "POST"],
    ["books/upload-receipt", uploadReceipt, "POST"],
    ["documents/classify", classify, "POST"],
    ["documents/delete", deleteDoc, "POST"],
    ["documents/profile", profile, "POST"],
    ["documents/upload-url", uploadUrl, "POST"],
    ["documents/verify", verify, "POST"],
    ["rename-doc", renameDoc, "POST"],
    ["mercury/backfill", backfill, "POST"],
    ["palm", palm, "POST"],
    ["ask", ask, "GET"],
    ["brand (studio)", brand, "GET", { studio: "1" }],
    ["brand", brand, "POST"],
    ["cron/books-sync", booksSync, "POST"],
  ];
  for (const [name, handler, method, query] of cases) {
    it(name, async () => {
      expect(await call(handler, method, query)).toEqual({
        status: 403,
        json: { error: "forbidden", message: "Not available to entity owners." },
      });
    });
  }
});
