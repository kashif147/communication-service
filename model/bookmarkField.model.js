import mongoose from "mongoose";

/**
 * Mail-merge field definitions (Phase 2B Stream 3C, audit H-23/C3).
 *
 * Two ownership scopes:
 *  - "system": platform-global row, tenantId null. Readable by every tenant,
 *    platform-managed: no tenant role may write it (Phase B / Z9: the legacy SU
 *    that could is retired; A14 keeps it frozen).
 *  - "tenant": owned by exactly one tenant (tenantId set). Readable/writable
 *    only inside that tenant; overrides a system row with the same `key` for
 *    that tenant at merge time.
 *
 * Uniqueness is per owner: {tenantId, key}. System rows all have tenantId null,
 * so keys stay unique among system rows too. The old global `key_1` unique
 * index must be dropped by scripts/migrate-bookmark-fields-tenant-scope.js
 * (after it builds tenantId_1_key_1) before a tenant can override a system key.
 */
export const BOOKMARK_SCOPES = ["system", "tenant"];

const BookmarkFieldSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String },
  path: { type: String },
  dataType: { type: String, enum: ["string", "date", "number"] },
  tenantId: { type: String, default: null },
  scope: { type: String, enum: BOOKMARK_SCOPES, default: "tenant" },
});

BookmarkFieldSchema.pre("validate", function (next) {
  if (this.scope === "system" && this.tenantId != null) {
    return next(new Error("system bookmark fields must not have a tenantId"));
  }
  if (this.scope === "tenant" && !this.tenantId) {
    return next(new Error("tenant bookmark fields require a tenantId"));
  }
  return next();
});

BookmarkFieldSchema.index(
  { tenantId: 1, key: 1 },
  { unique: true, name: "tenantId_1_key_1" }
);

export default mongoose.model("bookmark_fields", BookmarkFieldSchema);
