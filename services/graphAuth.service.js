import axios from "axios";
import qs from "qs";
import logger from "../config/logger.js";

// In-memory token cache
let cachedToken = null;
let tokenExpiry = null;

/**
 * Get Microsoft Graph access token using OAuth2 client credentials flow
 * Uses token caching to avoid unnecessary requests (cached for 50-55 minutes)
 * 
 * @returns {Promise<string>} - The access token
 * @throws {Error} - If token acquisition fails
 */
export async function getGraphToken() {
  try {
    // Check if we have a valid cached token
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
      logger.debug("Using cached Graph access token");
      return cachedToken;
    }

    // Validate environment variables
    const tenantId = process.env.GRAPH_TENANT_ID;
    const clientId = process.env.GRAPH_CLIENT_ID;
    const clientSecret = process.env.GRAPH_CLIENT_SECRET;

    if (!tenantId) {
      throw new Error("GRAPH_TENANT_ID is not configured");
    }
    if (!clientId) {
      throw new Error("GRAPH_CLIENT_ID is not configured");
    }
    if (!clientSecret) {
      throw new Error("GRAPH_CLIENT_SECRET is not configured");
    }

    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const body = qs.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });

    logger.info(
      {
        tenantId,
        clientId: `${clientId.substring(0, 8)}...`,
        hasClientSecret: !!clientSecret,
      },
      "Requesting Microsoft Graph access token"
    );

    const response = await axios.post(url, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (!response.data || !response.data.access_token) {
      logger.error(
        { responseData: response.data },
        "No access token in response from Microsoft Graph"
      );
      throw new Error("No access token received from Microsoft Graph");
    }

    const accessToken = response.data.access_token;
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
      { 
        tokenLength: accessToken.length,
        tokenType: response.data.token_type,
        expiresIn,
        cacheDurationMinutes: Math.floor(cacheDuration / 60000),
        tokenPrefix: accessToken.substring(0, 20) + "..."
      },
      "Successfully obtained Microsoft Graph access token"
    );

    return accessToken;
  } catch (error) {
    const errorDetails = {
      message: error.message,
      tenantId: process.env.GRAPH_TENANT_ID,
      clientId: process.env.GRAPH_CLIENT_ID ? `${process.env.GRAPH_CLIENT_ID.substring(0, 8)}...` : "missing",
      hasClientSecret: !!process.env.GRAPH_CLIENT_SECRET,
    };

    // Extract detailed error from response
    if (error.response) {
      errorDetails.statusCode = error.response.status;
      errorDetails.statusText = error.response.statusText;
      errorDetails.responseData = error.response.data;
      
      // Common Graph API errors
      if (error.response.data?.error) {
        errorDetails.graphError = error.response.data.error;
        errorDetails.graphErrorDescription = error.response.data.error_description;
      }
    }

    logger.error(errorDetails, "Failed to obtain Microsoft Graph access token");

    const authError = new Error(
      `Microsoft Graph authentication failed: ${error.message}`
    );
    authError.originalError = error;
    authError.details = errorDetails;
    throw authError;
  }
}

// Export alias for backward compatibility
export const getGraphAccessToken = getGraphToken;
