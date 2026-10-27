import { AppError } from "../errors/AppError.js";

/**
 * Phase A / A14 - temporary write freeze on still-global (shared) metadata.
 *
 * System bookmark fields (tenantId null) are shared by every tenant until the Phase E tenant cutover.
 * Until then creating, changing or deleting one answers 423 GLOBAL_DATA_FROZEN for every caller - SU/ASU
 * of any tenant included (every tenant has an SU role). Tenant-owned bookmark rows are unaffected, and
 * reads are unchanged. Necessary platform changes go through reviewed scripts below the API.
 * Ops rollback only: GLOBAL_DATA_WRITES=open (exact value) in the service environment; nothing on a
 * request (header, body flag, role, claim) can reopen writes.
 */
export const GLOBAL_DATA_FROZEN = "GLOBAL_DATA_FROZEN";
export const GLOBAL_DATA_FROZEN_MESSAGE = "Shared metadata is temporarily read-only during tenant migration";

export function isGlobalDataFrozen() {
  return process.env.GLOBAL_DATA_WRITES !== "open";
}

export function globalDataFrozenError(resource) {
  return new AppError(GLOBAL_DATA_FROZEN_MESSAGE, 423, GLOBAL_DATA_FROZEN, { resource });
}
