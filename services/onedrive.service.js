import { getGraphClient } from "../config/graph.js";
import { getGraphAccessToken } from "./graphAuth.service.js";
import logger from "../config/logger.js";

/**
 * Download a file from OneDrive/SharePoint (Word .docx template)
 * using Microsoft Graph API.
 * 
 * Files are accessed from a shared folder via admin account,
 * not from individual user accounts.
 *
 * @param {string} fileId - The OneDrive/SharePoint file ID
 * @param {string} [accessToken] - Optional access token. If not provided, will fetch one automatically
 * @returns {Buffer} - The binary content of the file
 */
export async function getOneDriveFile(fileId, accessToken) {
  try {
    // Use provided token or get a new one
    const token = accessToken || (await getGraphAccessToken());

    // Create Graph client
    const client = getGraphClient(token);

    // Get admin email for accessing shared folder (required for application permissions)
    const adminEmail = process.env.ONEDRIVE_USER_EMAIL;
    const sharePointSiteId = process.env.SHAREPOINT_SITE_ID;

    // Build download path based on configuration
    let downloadPath;
    
    if (sharePointSiteId) {
      // SharePoint site path
      downloadPath = `/sites/${sharePointSiteId}/drive/items/${fileId}/content`;
      logger.debug(
        { fileId, sharePointSiteId },
        "Downloading from SharePoint site"
      );
    } else if (adminEmail) {
      // OneDrive shared folder via admin account
      downloadPath = `/users/${adminEmail}/drive/items/${fileId}/content`;
      logger.debug(
        { fileId, adminEmail },
        "Downloading from OneDrive shared folder via admin account"
      );
    } else {
      throw new Error(
        "ONEDRIVE_USER_EMAIL or SHAREPOINT_SITE_ID must be configured for shared folder access"
      );
    }

    const fileResponse = await client
      .api(downloadPath)
      .responseType("arraybuffer")
      .get();

    // Convert ArrayBuffer to Node Buffer
    return Buffer.from(fileResponse);
  } catch (error) {
    logger.error(
      {
        error: error.message,
        fileId,
        adminEmail: process.env.ONEDRIVE_USER_EMAIL,
        sharePointSiteId: process.env.SHAREPOINT_SITE_ID,
      },
      "Failed to fetch file from shared folder"
    );
    throw error;
  }
}

/**
 * Upload a file to OneDrive/SharePoint shared folder (Word .docx template)
 * using Microsoft Graph API.
 * 
 * Files are uploaded to a shared folder accessible to all users via admin account,
 * not to individual user accounts.
 *
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {string} fileName - The name of the file
 * @param {string} [accessToken] - Optional access token. If not provided, will fetch one automatically
 * @returns {Object} - The uploaded file metadata including fileId
 */
export async function uploadOneDriveFile(fileBuffer, fileName, accessToken) {
  try {
    // Use provided token or get a new one
    let token = accessToken;
    if (!token) {
      logger.debug("No access token provided, obtaining new token");
      token = await getGraphAccessToken();
    }

    if (!token) {
      throw new Error("Failed to obtain Microsoft Graph access token");
    }

    logger.debug(
      { tokenLength: token.length, tokenPrefix: token.substring(0, 20) + "..." },
      "Using access token for Graph API"
    );

    // Create Graph client
    const client = getGraphClient(token);

    // Get configuration for shared folder access
    const folderId = process.env.ONEDRIVE_TEMPLATE_FOLDER_ID;
    const adminEmail = process.env.ONEDRIVE_USER_EMAIL; // Required: admin email with folder access
    const sharePointSiteId = process.env.SHAREPOINT_SITE_ID; // Optional: for SharePoint sites

    if (!folderId) {
      throw new Error(
        "ONEDRIVE_TEMPLATE_FOLDER_ID must be configured for shared folder upload"
      );
    }

    // Build upload path based on configuration
    // Try multiple path formats to handle different folder ID formats
    let uploadPath;
    let alternativePath;
    
    if (sharePointSiteId) {
      // SharePoint site path - upload to shared folder on SharePoint site
      uploadPath = `/sites/${sharePointSiteId}/drive/items/${folderId}:/${fileName}:/content`;
      alternativePath = `/sites/${sharePointSiteId}/drive/root:/${folderId}/${fileName}:/content`;
      logger.debug(
        { folderId, fileName, sharePointSiteId, uploadPath },
        "Uploading to SharePoint site shared folder"
      );
    } else if (adminEmail) {
      // OneDrive shared folder via admin account
      // Try path with colon syntax first (for drive item IDs)
      uploadPath = `/users/${adminEmail}/drive/items/${folderId}:/${fileName}:/content`;
      // Alternative: if folderId is a path, use root with path
      alternativePath = `/users/${adminEmail}/drive/root:/${folderId}/${fileName}:/content`;
      logger.debug(
        { folderId, fileName, adminEmail, uploadPath, alternativePath },
        "Uploading to OneDrive shared folder via admin account"
      );
    } else {
      throw new Error(
        "ONEDRIVE_USER_EMAIL (admin email) must be configured for shared folder access"
      );
    }

    logger.debug({ uploadPath, fileName, folderId }, "Attempting file upload");

    let fileResponse;
    try {
      fileResponse = await client.api(uploadPath).put(fileBuffer);
    } catch (firstError) {
      // If first path fails and we have an alternative, try it
      if (alternativePath && (firstError.statusCode === 404 || firstError.statusCode === 400)) {
        logger.warn(
          { 
            originalPath: uploadPath, 
            alternativePath, 
            error: firstError.message 
          },
          "First upload path failed, trying alternative path"
        );
        try {
          fileResponse = await client.api(alternativePath).put(fileBuffer);
          logger.info({ alternativePath }, "Upload succeeded with alternative path");
        } catch (secondError) {
          logger.error(
            { 
              originalPath: uploadPath, 
              alternativePath, 
              originalError: firstError.message,
              alternativeError: secondError.message 
            },
            "Both upload paths failed"
          );
          throw secondError; // Throw the second error as it's more recent
        }
      } else {
        throw firstError; // Re-throw if no alternative or different error
      }
    }

    logger.info(
      { fileId: fileResponse.id, fileName, webUrl: fileResponse.webUrl },
      "File uploaded successfully to shared folder"
    );

    return {
      fileId: fileResponse.id,
      name: fileResponse.name,
      webUrl: fileResponse.webUrl,
      size: fileResponse.size,
    };
  } catch (error) {
    // Extract detailed error information from Graph API
    const errorDetails = {
      message: error.message,
      fileName,
      folderId: process.env.ONEDRIVE_TEMPLATE_FOLDER_ID,
      adminEmail: process.env.ONEDRIVE_USER_EMAIL,
      sharePointSiteId: process.env.SHAREPOINT_SITE_ID,
    };

    // If it's a Graph API error, include response details
    if (error.statusCode) {
      errorDetails.statusCode = error.statusCode;
      errorDetails.statusText = error.statusText;
      if (error.body) {
        errorDetails.graphError = error.body;
      }
    }

    // If it's an axios error, include response data
    if (error.response) {
      errorDetails.statusCode = error.response.status;
      errorDetails.statusText = error.response.statusText;
      errorDetails.responseData = error.response.data;
    }

    logger.error(errorDetails, "Failed to upload file to shared folder");

    // Re-throw with more context
    const uploadError = new Error(
      `Failed to upload file to shared folder: ${error.message}`
    );
    uploadError.originalError = error;
    uploadError.details = errorDetails;
    throw uploadError;
  }
}
