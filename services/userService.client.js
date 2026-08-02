import axios from "axios";
import logger from "../config/logger.js";

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  process.env.POLICY_SERVICE_URL ||
  "http://localhost:3000";

const ROLES_CACHE_TTL_MS = 5 * 60 * 1000;
const usersByRoleCodesCache = new Map(); // "tenantId:sortedCodes" -> { users, expiry }

function base() {
  return USER_SERVICE_URL.replace(/\/$/, "");
}

/**
 * RabbitMQ-consumer-triggered calls (issues.listener.js -> issuesComms.service.js) have no
 * inbound `req` to forward gateway/JWT headers from, so this calls user-service's dedicated
 * /api/internal/role-access/* endpoints (added alongside this client -
 * controllers/internalRoleAccess.controller.js + routes/internalRoleAccess.routes.js). The
 * gateway-authenticated /api/roles and /api/roles/users/by-role routes (used by an earlier
 * version of this client) have no internal exemption and would 401 for a headless service
 * call like this one.
 *
 * Gated by a shared secret (x-service-secret / INTERNAL_ROLE_ACCESS_SECRET), not just an
 * x-internal-request header flag - mirrors services/auditClient.service.js's
 * x-service-secret/SERVICE_AUDIT_SECRET pattern exactly, since this endpoint returns user
 * PII (emails, names). Same "no-op if unconfigured" behavior as that client: if the secret
 * isn't set in this environment, skip the call rather than send a request guaranteed to 403.
 */
function isConfigured() {
  return !!process.env.INTERNAL_ROLE_ACCESS_SECRET;
}

function buildHeaders() {
  return {
    "Content-Type": "application/json",
    "x-service-secret": process.env.INTERNAL_ROLE_ACCESS_SECRET,
  };
}

/**
 * Resolve users (with email) belonging to any of the given role codes, via user-service's
 * internal role-access endpoint (one hop, server-side code match - no client-side filtering
 * needed here unlike the lookup-hierarchy "fetch all, filter client-side" pattern).
 *
 * @param {string[]} roleCodes
 * @param {string} tenantId
 * @returns {Promise<Array<{_id:string, userEmail:string, userFullName?:string}>>}
 */
export async function getUsersByRoleCodes(roleCodes, tenantId) {
  const codes = (Array.isArray(roleCodes) ? roleCodes : [roleCodes]).filter(Boolean);
  if (!codes.length || !tenantId) return [];
  if (!isConfigured()) {
    logger.warn(
      { roleCodes: codes, tenantId },
      "[userService.client] INTERNAL_ROLE_ACCESS_SECRET not configured, skipping role lookup"
    );
    return [];
  }

  const cacheKey = `${tenantId}:${codes.slice().sort().join(",")}`;
  const cached = usersByRoleCodesCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.users;

  try {
    const response = await axios.get(`${base()}/api/internal/role-access/users-by-role-codes`, {
      headers: buildHeaders(),
      params: { codes: codes.join(","), tenantId },
      timeout: 8000,
      validateStatus: (status) => status < 500,
    });
    if (response.status < 200 || response.status >= 300) {
      logger.warn(
        { status: response.status, tenantId, roleCodes: codes },
        "[userService.client] GET /api/internal/role-access/users-by-role-codes failed"
      );
      return cached?.users || [];
    }
    const users = Array.isArray(response.data?.data?.users) ? response.data.data.users : [];
    usersByRoleCodesCache.set(cacheKey, { users, expiry: Date.now() + ROLES_CACHE_TTL_MS });
    return users;
  } catch (err) {
    logger.warn(
      { err: err.message, roleCodes: codes, tenantId },
      "[userService.client] getUsersByRoleCodes failed"
    );
    return cached?.users || [];
  }
}

/**
 * Resolve a single user's display name/email by id, via user-service's internal
 * role-access endpoint.
 *
 * @param {string} userId
 * @param {string} tenantId
 * @returns {Promise<{_id:string, userEmail:string, userFullName?:string}|null>}
 */
export async function getUserById(userId, tenantId) {
  if (!userId || !tenantId) return null;
  if (!isConfigured()) {
    logger.warn(
      { userId, tenantId },
      "[userService.client] INTERNAL_ROLE_ACCESS_SECRET not configured, skipping user lookup"
    );
    return null;
  }
  try {
    const response = await axios.get(`${base()}/api/internal/role-access/users/${userId}`, {
      headers: buildHeaders(),
      params: { tenantId },
      timeout: 8000,
      validateStatus: (status) => status < 500,
    });
    if (response.status < 200 || response.status >= 300) {
      logger.warn(
        { status: response.status, tenantId, userId },
        "[userService.client] GET /api/internal/role-access/users/:userId failed"
      );
      return null;
    }
    return response.data?.data || null;
  } catch (err) {
    logger.warn(
      { err: err.message, userId, tenantId },
      "[userService.client] getUserById failed"
    );
    return null;
  }
}

export function userDisplayName(user) {
  if (!user) return null;
  return (
    user.userFullName ||
    [user.userFirstName, user.userLastName].filter(Boolean).join(" ").trim() ||
    user.userEmail ||
    null
  );
}

export function userEmail(user) {
  return user?.userEmail || null;
}
