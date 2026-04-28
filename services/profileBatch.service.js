import axios from "axios";
import logger from "../config/logger.js";

function toBatchUrl(base) {
  const u = String(base || "").trim().replace(/\/$/, "");
  if (!u) return null;
  if (u.endsWith("/api")) return `${u}/profile/batch`;
  return `${u}/api/profile/batch`;
}

function profileServiceBatchUrls() {
  const explicit = process.env.PROFILE_SERVICE_URLS
    ? process.env.PROFILE_SERVICE_URLS.split(",").map((s) => s.trim())
    : [];

  const candidates = [
    process.env.PROFILE_SERVICE_URL,
    process.env.REACT_APP_PROFILE_SERVICE_URL,
    process.env.PROFILE_SERVICE_INTERNAL_URL,
    process.env.PROFILE_SERVICE_PUBLIC_URL,
    ...explicit,
    "http://profile-service:4002",
    "https://projectshell-vm.northeurope.cloudapp.azure.com/profile-service/api",
  ]
    .filter(Boolean)
    .map(toBatchUrl)
    .filter(Boolean);

  return [...new Set(candidates)];
}

/**
 * Fetch profiles by IDs (HTTP to profile-service only — no shared DB).
 */
export async function fetchProfilesBatch({
  profileIds,
  tenantId,
  authorizationHeader,
}) {
  const urls = profileServiceBatchUrls();

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

  let lastNetworkError = null;
  for (const url of urls) {
    try {
      const res = await axios.post(
        url,
        { profileIds },
        { headers, timeout: 25000, validateStatus: () => true }
      );

      if (res.status >= 400) {
        logger.warn(
          { status: res.status, data: res.data, url },
          "profile batch request failed"
        );
        if (res.status >= 500) {
          // try next URL candidate on upstream server errors
          continue;
        }
        throw new Error(
          res.data?.message || `Profile service returned ${res.status}`
        );
      }

      const list = res.data?.data;
      return Array.isArray(list) ? list : [];
    } catch (err) {
      lastNetworkError = err;
      logger.warn(
        { url, err: err.message },
        "profile batch request network failure, trying next candidate"
      );
    }
  }

  throw new Error(
    lastNetworkError?.message ||
      "Unable to reach profile service for batch lookup"
  );
}
