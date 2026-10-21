import { sb, type AppUser } from "./auth.js";

/**
 * Which entities an invited owner (a "partner") may see: one entity_access
 * row per person and entity. Staff see everything and need no rows; a row
 * for a staff member only records that they were invited from that entity.
 */

export type AccessRow = { user_id: string; asset_id: string; member_name: string | null; invited_by: string | null; invited_at: string };

/** The entity ids a user has been given. */
export async function accessibleAssetIds(userId: string): Promise<string[]> {
  const rows = await sb<Pick<AccessRow, "asset_id">[]>(`entity_access?user_id=eq.${userId}&select=asset_id`);
  return (rows ?? []).map((r) => r.asset_id);
}

/** Everyone given an entity, with their account. */
export async function accessFor(assetId: string): Promise<(AccessRow & { user: AppUser })[]> {
  const rows = await sb<AccessRow[]>(`entity_access?asset_id=eq.${encodeURIComponent(assetId)}&select=*&order=invited_at.asc`);
  if (!rows?.length) return [];
  const users = await sb<AppUser[]>(`app_users?id=in.(${rows.map((r) => r.user_id).join(",")})&select=*`);
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.filter((r) => byId.has(r.user_id)).map((r) => ({ ...r, user: byId.get(r.user_id)! }));
}

export async function grantAccess(userId: string, assetId: string, memberName: string | null, invitedBy: string): Promise<void> {
  await sb("entity_access?on_conflict=user_id,asset_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: [{ user_id: userId, asset_id: assetId, member_name: memberName, invited_by: invitedBy, invited_at: new Date().toISOString() }],
  });
}

export async function revokeAccess(userId: string, assetId: string): Promise<void> {
  await sb(`entity_access?user_id=eq.${userId}&asset_id=eq.${encodeURIComponent(assetId)}`, { method: "DELETE" });
}
