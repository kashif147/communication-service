import { AppError } from "../errors/AppError.js";
import { isCrmUser } from "./internalCaller.js";

/**
 * Staff-only gate (P5 portal object-authorization remediation).
 *
 * Every administrative communication route (campaigns, templates, bookmark
 * fields, letter generation for an arbitrary profile, per-profile letter /
 * correspondence listing) is CRM-staff only. A portal member's token can carry
 * `communication:*`, so the PDP permission alone does not separate staff from
 * members; this gate does, from the PDP-verified identity only (`req.user`,
 * set by `defaultPolicyMiddleware.requirePermission` after a PERMIT).
 *
 * MUST be mounted AFTER requirePermission (+ tenantContextWarn): this service
 * has no standalone auth middleware, so before the PDP call `req.user` does not
 * exist and the gate would deny everyone.
 *
 *   requirePermission(...) -> tenantContextWarn -> requireCrmUser -> handler
 *
 * Fails closed: missing identity, PORTAL, or any other/unknown userType -> 403
 * CRM_ONLY. No header, body, query or param is consulted.
 */
export function requireCrmUser(req, res, next) {
  if (req.user && isCrmUser(req)) return next();
  return next(new AppError("This endpoint is available to CRM staff only", 403, "CRM_ONLY"));
}

export default requireCrmUser;
