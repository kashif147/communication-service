import axios from "axios";
import logger from "../config/logger.js";

/**
 * Writes one row to audit-service (optional; no-op if not configured).
 */
export async function logCampaignAudit(payload) {
  const base = process.env.AUDIT_SERVICE_URL;
  const secret = process.env.SERVICE_AUDIT_SECRET;
  if (!base || !secret) {
    logger.debug("AUDIT_SERVICE_URL or SERVICE_AUDIT_SECRET unset; skipping remote audit");
    return;
  }
  let root = base.replace(/\/$/, "");
  if (root.endsWith("/api")) {
    root = root.slice(0, -4);
  }
  const url = `${root}/internal/audit-logs`;
  try {
    await axios.post(
      url,
      {
        tenantId: payload.tenantId,
        action: payload.action,
        resourceType: payload.resourceType || "campaign",
        resourceId: payload.resourceId,
        actorId: payload.actorId,
        metadata: payload.metadata,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-service-secret": secret,
        },
        timeout: 8000,
        validateStatus: (s) => s < 500,
      }
    );
  } catch (e) {
    logger.warn({ err: e.message }, "audit-service log failed");
  }
}
