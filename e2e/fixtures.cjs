// Mocked data for the browser checks: a signed-in owner, a few entities, a
// few messages. Nothing here reaches a real service; every /api/** request
// is answered from this file.
const user = { id: "u1", name: "Robert Burton", phone: "+15555550100", email: "r@x.com", role: "owner", status: "approved", mail_address: "robert@burtonfamilyoffice.com" };
const now = Date.now();
const assets = {
  "-E1": { name: "Burton Family Revocable Trust", type: "Trust", state: "Arizona" },
  "-E2": { name: "Ledger Louise, LLC", type: "LLC", state: "Nevada", ownerId: "-E1", ein: "00-0000000", formationDate: "2023-08-11", registeredAgent: "Northwest Registered Agent, LLC.", status: "Active" },
  "-E3": { name: "Sundown Investments LLC", type: "LLC", state: "Arizona", ownerId: "-E2", status: "Active" },
};
const messages = [0, 1, 2].map((i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`, folder: "inbox", direction: "in",
  from: { email: "support@earthclassmail.com", name: "Earth Class Mail" }, to: [{ email: user.mail_address }], cc: [],
  subject: `Address change ${i}`, snippet: "Thanks for reaching out.", occurredAt: new Date(now - i * 3600e3).toISOString(),
  read: i > 0, starred: false, attachmentCount: 0, status: null, other: false, attachments: [],
}));
const session = { token: "t", user, expiresAt: "2099-01-01T00:00:00Z" };

/** Answer a mocked API request. Returns [status, body] or null to pass through. */
function mock(url, method, body) {
  const u = url.replace(/^https?:\/\/[^/]+/, "");
  if (u.startsWith("/api/tree")) return [200, u.includes("path=assets") ? { value: assets } : { value: null }];
  if (u.startsWith("/api/auth/session")) return [200, { user }];
  if (u.startsWith("/api/auth/users")) return [200, { users: [user] }];
  if (u.startsWith("/api/auth/preferences")) return [200, { preferences: {} }];
  if (u.startsWith("/api/mail")) {
    if (u.includes("view=faces")) return [200, { faces: {} }];
    if (u.includes("view=list")) return [200, { messages, hasMore: false }];
    if (u.includes("view=message") || u.includes("view=thread")) return [200, { message: { ...messages[0], html: "<p>Hello there</p>", text: "Hello there" }, messages: [] }];
    return [200, { unread: 1, otherUnread: 0, canSeeOther: true, address: user.mail_address, aliases: [] }];
  }
  if (u.startsWith("/api/palm")) {
    const action = body && body.action;
    if (action === "usage") return [200, { configured: true, mode: "live", month: { cents: 0, calls: 0, testCalls: 0, byProduct: {} }, lastMonth: { cents: 0 }, recent: [], webhook: { ok: true } }];
    if (action === "entity-bundle") {
      const ok = (value) => ({ ok: true, value });
      return [200, { mode: "live", businessId: null, status: ok({ configured: true, mode: "live" }), ra: ok(null), documents: ok({ documents: [] }), inbox: ok({ events: [] }), inboxUnread: ok({ events: [] }), cases: ok({ cases: [] }), monitors: ok({ monitors: [] }) }];
    }
    return [200, { configured: true, mode: "live", events: [], documents: [], cases: [], monitors: [], status: { configured: true, mode: "live" } }];
  }
  if (u.startsWith("/api/ask")) return method === "POST" ? null : [200, { chats: [], chat: {}, messages: [] }];
  if (u.startsWith("/api/brand")) return [200, { logo: null }];
  if (u.startsWith("/api/sign")) {
    const action = body && body.action;
    const request = { id: "00000000-0000-4000-8000-00000000s001", title: "Management Services Agreement - VisionQuest", status: "sent", source: "contract", asset_id: "-E2", contract_id: "c1", created_by: user.id, created_by_name: user.name, original_path: null, current_path: null, signed_path: null, pages: [{ w: 612, h: 792 }], fields: [{ id: "f1", party: "a", type: "signature", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05 }], parties: [{ key: "a", role: "Manager", name: "Robert Burton", email: "r@x.com", status: "signed", signedAt: new Date(now).toISOString() }, { key: "b", role: "Client", name: "Vision Quest", email: "vq@x.com", status: "viewed" }], events: [{ at: new Date(now).toISOString(), kind: "sent" }], created_at: new Date(now).toISOString(), sent_at: new Date(now).toISOString(), completed_at: null, copy_sent_at: null };
    if (u.includes("id=")) return [200, { request, pdfUrl: null }];
    if (action) return [200, { request, url: "about:blank", ok: true }];
    return [200, { requests: [request, { ...request, id: "00000000-0000-4000-8000-00000000s002", title: "Lease amendment", status: "draft", source: "upload", asset_id: null, contract_id: null, parties: [], fields: [], sent_at: null }] }];
  }
  if (u.startsWith("/api/push")) return [200, { configured: true, devices: 1, prefs: {} }];
  if (u.startsWith("/api/texts")) return [200, { texts: [] }];
  if (u.startsWith("/api/documents")) return [200, { docs: [], documents: [] }];
  if (u.startsWith("/api/plaid")) return [200, { connections: [], accounts: [], holdings: [], errors: [], history: [], income: null }];
  if (u.startsWith("/api/books")) {
    if (u.includes("report=transactions")) return [200, { transactions: [], total: 0, summary: null }];
    return [200, { transactions: [], total: 0, accounts: [], vendors: [], rules: [], loans: [], settings: {}, summary: null, items: [] }];
  }
  if (u.startsWith("/api/stable")) return [200, { mail: [], items: [] }];
  if (u.startsWith("/api/health")) return [200, { ok: true }];
  return [200, {}];
}

module.exports = { user, assets, messages, session, mock };
