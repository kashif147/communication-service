import axios from "axios";
import logger from "../config/logger.js";

function profileServiceBatchUrl() {
  let u = (process.env.PROFILE_SERVICE_URL || "http://localhost:4002").replace(
    /\/$/,
    ""
  );
  if (u.endsWith("/api")) {
    return `${u}/profile/batch`;
  }
  return `${u}/api/profile/batch`;
}

/**
 * Fetch profiles by IDs (HTTP to profile-service only — no shared DB).
 */
export async function fetchProfilesBatch({
  profileIds,
  tenantId,
  authorizationHeader,
}) {
  const url = profileServiceBatchUrl();

  const headers = {
    "Content-Type": "application/json",
    "x-tenant-id": tenantId || "",
  };
  if (authorizationHeader) {
    headers.Authorization = authorizationHeader;
  } else {
    headers["x-internal-request"] = "true";
    headers["x-tenant-id"] = tenantId;
  }

  const res = await axios.post(
    url,
    { profileIds },
    { headers, timeout: 60000, validateStatus: () => true }
  );

  if (res.status >= 400) {
    logger.warn(
      { status: res.status, data: res.data },
      "profile batch request failed"
    );
    throw new Error(
      res.data?.message || `Profile service returned ${res.status}`
    );
  }

  const list = res.data?.data;
  return Array.isArray(list) ? list : [];
}
