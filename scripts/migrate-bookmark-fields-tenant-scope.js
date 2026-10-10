#!/usr/bin/env node
/**
 * Phase 2B Stream 3C (audit H-23/C3) — BookmarkField tenant/system scope migration.
 *
 * NOT run automatically. Dry-run by default; pass --apply to write.
 *   node scripts/migrate-bookmark-fields-tenant-scope.js            # dry run (reads only)
 *   node scripts/migrate-bookmark-fields-tenant-scope.js --apply    # performs steps 2-5
 *
 * Connects ONLY to this service's own MongoDB (config/db.js: MONGODB_URI/MONGO_URI).
 *
 * Exact order (each step is idempotent; re-running after a partial run is safe):
 *   1. Preflight (read-only): list indexes, count rows, count legacy rows (no
 *      tenantId), and abort if any key appears on more than one would-be system
 *      row (cannot happen while key_1 exists, checked anyway).
 *   2. Mark every row with no tenantId (missing or null) as a SYSTEM row:
 *      $set { tenantId: null, scope: "system" }. Existing data was global, so
 *      this preserves current merge output for every tenant exactly.
 *   3. Build the new unique index { tenantId: 1, key: 1 } named "tenantId_1_key_1"
 *      (skipped if already present — in non-production the app's autoIndex may
 *      have built it already; that is harmless while key_1 still exists).
 *   4. Verify "tenantId_1_key_1" exists and is unique. Abort if not.
 *   5. ONLY THEN drop the legacy global unique index "key_1". Until this step
 *      a tenant cannot create a row whose key matches a system key (E11000 ->
 *      409), which is safe but restrictive; nothing else depends on key_1.
 *   6. Post-check: no row left without a scope; report counts.
 *
 * Deploy order: the new code reads legacy rows (no tenantId/scope) as system
 * rows, so it may be deployed before or after this migration with identical
 * merge output. Run this migration after deploying, then (optionally) re-run
 * scripts/create-bookmark-fields.js which now upserts system rows only.
 *
 * Rollback: recreating key_1 { key: 1 } unique is only possible while no
 * tenant row shares a key with a system row or another tenant's row; the
 * tenantId/scope fields can be left in place (old code ignores them).
 */
import dotenvFlow from "dotenv-flow";
dotenvFlow.config();

import { connectDB, disconnectDB } from "../config/db.js";
import BookmarkField from "../model/bookmarkField.model.js";

const APPLY = process.argv.includes("--apply");
const NEW_INDEX = "tenantId_1_key_1";
const LEGACY_INDEX = "key_1";
const LEGACY_FILTER = { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] };

async function indexNames(coll) {
  const list = await coll.indexes();
  return Object.fromEntries(list.map((i) => [i.name, i]));
}

async function main() {
  await connectDB();
  const coll = BookmarkField.collection;
  try {
    // 1. Preflight
    const before = await indexNames(coll);
    const total = await coll.countDocuments({});
    const legacy = await coll.countDocuments(LEGACY_FILTER);
    const dupes = await coll
      .aggregate([
        { $match: LEGACY_FILTER },
        { $group: { _id: "$key", n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
      ])
      .toArray();
    console.log(`[1] mode=${APPLY ? "APPLY" : "DRY-RUN"} rows=${total} rowsWithoutTenant=${legacy}`);
    console.log(`[1] indexes: ${Object.keys(before).join(", ")}`);
    if (dupes.length) {
      console.error(`[1] ABORT: duplicate keys among would-be system rows: ${dupes.map((d) => d._id).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    if (!APPLY) {
      console.log(`[2] would mark ${legacy} row(s) as { tenantId: null, scope: "system" }`);
      console.log(`[3] would ${before[NEW_INDEX] ? "keep existing" : "create"} unique index ${NEW_INDEX}`);
      console.log(`[5] would ${before[LEGACY_INDEX] ? "drop" : "skip (absent)"} index ${LEGACY_INDEX}`);
      return;
    }

    // 2. Mark legacy rows as system
    const r = await coll.updateMany(LEGACY_FILTER, { $set: { tenantId: null, scope: "system" } });
    console.log(`[2] marked system: matched=${r.matchedCount} modified=${r.modifiedCount}`);

    // 3. Build the new compound unique index
    if (!before[NEW_INDEX]) {
      await coll.createIndex({ tenantId: 1, key: 1 }, { unique: true, name: NEW_INDEX });
      console.log(`[3] created ${NEW_INDEX}`);
    } else {
      console.log(`[3] ${NEW_INDEX} already present`);
    }

    // 4. Verify before dropping anything
    const mid = await indexNames(coll);
    if (!mid[NEW_INDEX] || !mid[NEW_INDEX].unique) {
      console.error(`[4] ABORT: ${NEW_INDEX} missing or not unique; ${LEGACY_INDEX} left in place`);
      process.exitCode = 1;
      return;
    }
    console.log(`[4] verified ${NEW_INDEX} (unique)`);

    // 5. Drop the legacy global unique index
    if (mid[LEGACY_INDEX]) {
      await coll.dropIndex(LEGACY_INDEX);
      console.log(`[5] dropped ${LEGACY_INDEX}`);
    } else {
      console.log(`[5] ${LEGACY_INDEX} not present`);
    }

    // 6. Post-check
    const unscoped = await coll.countDocuments({ scope: { $exists: false } });
    const system = await coll.countDocuments({ tenantId: null, scope: "system" });
    console.log(`[6] systemRows=${system} rowsWithoutScope=${unscoped}`);
    if (unscoped) process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
