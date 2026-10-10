import BookmarkField from "../model/bookmarkField.model.js";

/**
 * Tenant-aware BookmarkField reads (Phase 2B Stream 3C, audit H-23/C3).
 *
 * A row is a SYSTEM row when it has no tenantId and is not explicitly
 * tenant-scoped. That deliberately includes pre-migration legacy rows (no
 * tenantId and no scope field) so the merge output is unchanged before and
 * after scripts/migrate-bookmark-fields-tenant-scope.js runs.
 */
export function systemBookmarkFilter() {
  return { tenantId: null, scope: { $ne: "tenant" } };
}

export function isSystemBookmarkRow(row) {
  return row != null && row.tenantId == null && row.scope !== "tenant";
}

/** Rows visible to one tenant: system rows + that tenant's own rows. */
export function visibleBookmarkFilter(tenantId) {
  if (!tenantId) throw new Error("tenantId is required to read bookmark fields");
  return { $or: [systemBookmarkFilter(), { tenantId: String(tenantId) }] };
}

/**
 * Effective field set for a tenant: one row per key, the tenant's own row
 * winning over the system row. Sorted by key.
 */
export async function getEffectiveBookmarkFields(tenantId) {
  const rows = await BookmarkField.find(visibleBookmarkFilter(tenantId)).lean();
  const byKey = new Map();
  for (const row of rows || []) {
    if (!row?.key) continue;
    const current = byKey.get(row.key);
    if (!current || (isSystemBookmarkRow(current) && !isSystemBookmarkRow(row))) {
      byKey.set(row.key, row);
    }
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
