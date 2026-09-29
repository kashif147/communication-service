import { tenantContextMiddleware } from "@membership/policy-middleware";

/**
 * Phase 1A canonical tenant-context guard — WARN MODE ONLY (non-blocking).
 *
 * communication-service has NO local authenticate middleware: identity and
 * req.tenantId are established inside the shared
 * `defaultPolicyMiddleware.requirePermission("communication", <action>)`, and
 * only AFTER a PERMIT decision (req.tenantId = result.user.tenantId).
 *
 * This guard must therefore be mounted per-route AFTER requirePermission and
 * BEFORE the controller/validators:
 *   requirePermission(...) -> tenantContextWarn -> handler
 *
 * It observes the trusted tenant already on req.tenantId/req.ctx/req.user,
 * re-pins req.tenantId to it, and LOGS any caller-supplied (body/query/params)
 * tenantId that disagrees as a non-blocking TenantContextMismatch event. It
 * never returns 403.
 */
export const tenantContextWarn = tenantContextMiddleware({ mode: "warn" });
