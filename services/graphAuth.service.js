import axios from "axios";
import qs from "qs";
import logger from "../config/logger.js";

/**
 * App-only Microsoft Graph access for document storage (OneDrive templates).
 *
 * Uses ONLY the dedicated document-storage application (single tenant, Graph application
 * permission Files.ReadWrite.All): GRAPH_DOCUMENT_CLIENT_ID / GRAPH_DOCUMENT_TENANT_ID /
 * GRAPH_DOCUMENT_CLIENT_SECRET. There is deliberately no fallback to the old GRAPH_CLIENT_ID /
 * GRAPH_TENANT_ID / GRAPH_CLIENT_SECRET (the shared CRM sign-in application): a missing value
 * fails closed.
 *
 * Never logged, returned or attached to an error: the token (or any fragment or length), the
 * credential, the client id, and Microsoft's error_description / response body. Failures log only
 * the HTTP status, Microsoft's structured `error` value and its numeric `error_codes`.
 */
const REQUIRED_CONFIG = ["GRAPH_DOCUMENT_TENANT_ID", "GRAPH_DOCUMENT_CLIENT_ID", "GRAPH_DOCUMENT_CLIENT_SECRET"];

// In-memory token cache
let cachedToken = null;
let tokenExpiry = null;

/** Safe fields of a failed token request: status, structured error and numeric codes only. */
function safeFailure(error) {
  const data = error.response?.data;
  return {
    statusCode: error.response?.status ?? null,
    graphError: typeof data?.error === "string" ? data.error : null,
    errorCodes: Array.isArray(data?.error_codes) ? data.error_codes.filter((c) => Number.isInteger(c)) : [],
    networkCode: error.response ? null : typeof error.code === "string" ? error.code : null,
  };
}

/**
 * Get Microsoft Graph access token using OAuth2 client credentials flow
 * Uses token caching to avoid unnecessary requests (cached for 50-55 minutes)
 *
 * @returns {Promise<string>} - The access token
 * @throws {Error} - If configuration is missing or token acquisition fails
 */
export async function getGraphToken() {
  // Check if we have a valid cached token
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    logger.debug("Using cached Graph access token");
    return cachedToken;
  }

  const missing = REQUIRED_CONFIG.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    logger.error({ missing }, "Microsoft Graph document-storage configuration missing");
    throw new Error(`${missing.join(", ")} is not configured`);
  }
  const tenantId = process.env.GRAPH_DOCUMENT_TENANT_ID;
  const clientId = process.env.GRAPH_DOCUMENT_CLIENT_ID;
  const clientSecret = process.env.GRAPH_DOCUMENT_CLIENT_SECRET;

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = qs.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });

  logger.info("Requesting Microsoft Graph access token");

  let response;
  try {
    response = await axios.post(url, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch (error) {
    // The axios error carries the request (with the credential) and Microsoft's response: neither
    // is logged nor passed on.
    const details = safeFailure(error);
    logger.error(details, "Failed to obtain Microsoft Graph access token");
    const authError = new Error("Microsoft Graph authentication failed");
    authError.details = details;
    throw authError;
  }

  const accessToken = response?.data?.access_token;
  if (typeof accessToken !== "string" || accessToken === "") {
    logger.error({ statusCode: response?.status ?? null }, "No access token in response from Microsoft Graph");
    throw new Error("No access token received from Microsoft Graph");
  }
  const expiresIn = response.data.expires_in || 3600; // Default to 1 hour if not provided

  // Cache token for 50-55 minutes (3000-3300 seconds)
  // Use expires_in - 5 minutes if less than 55 minutes, otherwise use 50-55 minutes range
  const minCacheSeconds = 3000; // 50 minutes
  const maxCacheSeconds = 3300; // 55 minutes
  const safeCacheSeconds = Math.min(expiresIn - 300, maxCacheSeconds); // Ensure we refresh before expiry
  const cacheDurationSeconds = Math.max(minCacheSeconds, safeCacheSeconds); // At least 50 minutes
  const cacheDuration = cacheDurationSeconds * 1000; // Convert to milliseconds

  cachedToken = accessToken;
  tokenExpiry = Date.now() + cacheDuration;

  logger.info(
    { expiresIn, cacheDurationMinutes: Math.floor(cacheDuration / 60000) },
    "Successfully obtained Microsoft Graph access token"
  );

  return accessToken;
}

/** Test hook: clears the in-memory token cache. */
export function _resetGraphTokenCacheForTests() {
  cachedToken = null;
  tokenExpiry = null;
}

// Export alias for backward compatibility
export const getGraphAccessToken = getGraphToken;
