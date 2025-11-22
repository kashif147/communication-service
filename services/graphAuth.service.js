import axios from "axios";
import qs from "qs";
import { graphConfig } from "../config/graph.js";
import logger from "../config/logger.js";

export async function getGraphAccessToken() {
  try {
    const url = `${graphConfig.authority}/oauth2/v2.0/token`;

    // Validate configuration
    if (!graphConfig.clientId) {
      throw new Error("GRAPH_CLIENT_ID is not configured");
    }
    if (!graphConfig.clientSecret) {
      throw new Error("GRAPH_CLIENT_SECRET is not configured");
    }
    if (!graphConfig.tenantId) {
      throw new Error("GRAPH_TENANT_ID is not configured");
    }

    const body = qs.stringify({
      client_id: graphConfig.clientId,
      client_secret: graphConfig.clientSecret,
      scope: graphConfig.scopes.join(" "),
      grant_type: "client_credentials",
    });

    logger.debug(
      {
        authority: graphConfig.authority,
        clientId: graphConfig.clientId ? `${graphConfig.clientId.substring(0, 8)}...` : "missing",
        tenantId: graphConfig.tenantId,
        scopes: graphConfig.scopes,
      },
      "Requesting Microsoft Graph access token"
    );

    const response = await axios.post(url, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (!response.data || !response.data.access_token) {
      throw new Error("No access token received from Microsoft Graph");
    }

    logger.debug(
      { tokenLength: response.data.access_token.length },
      "Successfully obtained Microsoft Graph access token"
    );

    return response.data.access_token;
  } catch (error) {
    const errorDetails = {
      message: error.message,
      authority: graphConfig.authority,
      tenantId: graphConfig.tenantId,
      clientId: graphConfig.clientId ? `${graphConfig.clientId.substring(0, 8)}...` : "missing",
      hasClientSecret: !!graphConfig.clientSecret,
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
