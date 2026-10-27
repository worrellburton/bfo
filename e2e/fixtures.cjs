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
function mock(url, method) {
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
  if (u.startsWith("/api/palm")) return [200, { configured: true, mode: "live", events: [], documents: [], status: { configured: true, mode: "live" } }];
  if (u.startsWith("/api/ask")) return method === "POST" ? null : [200, { chats: [], chat: {}, messages: [] }];
  if (u.startsWith("/api/brand")) return [200, { logo: null }];
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
