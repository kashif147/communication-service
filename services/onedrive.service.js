import { getGraphClient } from "../config/graph.js";
import { getGraphToken } from "./graphAuth.service.js";
import axios from "axios";
import logger from "../config/logger.js";

/**
 * Download a file from OneDrive/SharePoint (Word .docx template)
 * using Microsoft Graph API.
 * 
 * Files are accessed from a shared folder via admin account,
 * not from individual user accounts.
 *
 * @param {string} fileId - The OneDrive/SharePoint file ID
 * @returns {Buffer} - The binary content of the file
 */
export async function getOneDriveFile(fileId) {
  try {
    // Get Graph access token using client credentials
    const token = await getGraphToken();

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
 * @param {string} folderId - The folder ID or path where the file should be uploaded
 * @param {string} fileName - The name of the file
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {string} mimeType - The MIME type of the file
 * @returns {Object} - The uploaded file metadata including fileId
 */
export async function uploadFileToSharedFolder(folderId, fileName, fileBuffer, mimeType) {
  try {
    // Get Graph access token using client credentials
    const graphToken = await getGraphToken();

    // Get configuration for shared folder access
    const driveId = process.env.GRAPH_DRIVE_ID;
    const adminEmail = process.env.ONEDRIVE_USER_EMAIL;
    const sharePointSiteId = process.env.SHAREPOINT_SITE_ID;

    // Build upload URL based on configuration
    let uploadUrl;
    let alternativeUrl;
    
    if (sharePointSiteId) {
      // SharePoint site path
      uploadUrl = `https://graph.microsoft.com/v1.0/sites/${sharePointSiteId}/drive/items/${folderId}:/${encodeURIComponent(fileName)}:/content`;
      alternativeUrl = `https://graph.microsoft.com/v1.0/sites/${sharePointSiteId}/drive/root:/${folderId}/${encodeURIComponent(fileName)}:/content`;
      logger.debug(
        { folderId, fileName, sharePointSiteId, uploadUrl },
        "Uploading to SharePoint site shared folder"
      );
    } else if (driveId) {
      // Use drive ID directly
      uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/content`;
      alternativeUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${folderId}/${encodeURIComponent(fileName)}:/content`;
      logger.debug(
        { folderId, fileName, driveId, uploadUrl },
        "Uploading to OneDrive using drive ID"
      );
    } else if (adminEmail) {
      // OneDrive shared folder via admin account
      uploadUrl = `https://graph.microsoft.com/v1.0/users/${adminEmail}/drive/items/${folderId}:/${encodeURIComponent(fileName)}:/content`;
      alternativeUrl = `https://graph.microsoft.com/v1.0/users/${adminEmail}/drive/root:/${folderId}/${encodeURIComponent(fileName)}:/content`;
      logger.debug(
        { folderId, fileName, adminEmail, uploadUrl },
        "Uploading to OneDrive shared folder via admin account"
      );
    } else {
      throw new Error(
        "GRAPH_DRIVE_ID, ONEDRIVE_USER_EMAIL, or SHAREPOINT_SITE_ID must be configured for shared folder upload"
      );
    }

    logger.debug({ uploadUrl, fileName, folderId }, "Attempting file upload");

    let fileResponse;
    try {
      fileResponse = await axios.put(uploadUrl, fileBuffer, {
        headers: {
          Authorization: `Bearer ${graphToken}`,
          "Content-Type": mimeType || "application/octet-stream",
        },
      });
    } catch (firstError) {
      // If first path fails and we have an alternative, try it
      if (alternativeUrl && (firstError.response?.status === 404 || firstError.response?.status === 400)) {
        logger.warn(
          { 
            originalUrl: uploadUrl, 
            alternativeUrl, 
            error: firstError.message 
          },
          "First upload path failed, trying alternative path"
        );
        try {
          fileResponse = await axios.put(alternativeUrl, fileBuffer, {
            headers: {
              Authorization: `Bearer ${graphToken}`,
              "Content-Type": mimeType || "application/octet-stream",
            },
          });
          logger.info({ alternativeUrl }, "Upload succeeded with alternative path");
        } catch (secondError) {
          logger.error(
            { 
              originalUrl: uploadUrl, 
              alternativeUrl, 
              originalError: firstError.message,
              alternativeError: secondError.message 
            },
            "Both upload paths failed"
          );
          throw secondError;
        }
      } else {
        throw firstError;
      }
    }

    const fileData = fileResponse.data;

    logger.info(
      { fileId: fileData.id, fileName, webUrl: fileData.webUrl },
      "File uploaded successfully to shared folder"
    );

    return {
      fileId: fileData.id,
      name: fileData.name,
      webUrl: fileData.webUrl,
      size: fileData.size,
    };
  } catch (error) {
    // Extract detailed error information from Graph API
    const errorDetails = {
      message: error.message,
      fileName,
      folderId,
      driveId: process.env.GRAPH_DRIVE_ID,
      adminEmail: process.env.ONEDRIVE_USER_EMAIL,
      sharePointSiteId: process.env.SHAREPOINT_SITE_ID,
    };

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

/**
 * Update/replace an existing file in OneDrive/SharePoint using its fileId
 * This replaces the file content while keeping the same fileId
 *
 * @param {string} fileId - The OneDrive/SharePoint file ID to update
 * @param {Buffer} fileBuffer - The new file buffer to upload
 * @param {string} mimeType - The MIME type of the file
 * @returns {Object} - The updated file metadata including fileId
 */
export async function updateOneDriveFile(fileId, fileBuffer, mimeType) {
  try {
    // Get Graph access token using client credentials
    const graphToken = await getGraphToken();

    // Get configuration for shared folder access
    const driveId = process.env.GRAPH_DRIVE_ID;
    const adminEmail = process.env.ONEDRIVE_USER_EMAIL;
    const sharePointSiteId = process.env.SHAREPOINT_SITE_ID;

    // Build update URL based on configuration
    let updateUrl;

    if (sharePointSiteId) {
      // SharePoint site path
      updateUrl = `https://graph.microsoft.com/v1.0/sites/${sharePointSiteId}/drive/items/${fileId}/content`;
      logger.debug(
        { fileId, sharePointSiteId },
        "Updating file in SharePoint site"
      );
    } else if (driveId) {
      // Use drive ID directly
      updateUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${fileId}/content`;
      logger.debug(
        { fileId, driveId },
        "Updating file in OneDrive using drive ID"
      );
    } else if (adminEmail) {
      // OneDrive shared folder via admin account
      updateUrl = `https://graph.microsoft.com/v1.0/users/${adminEmail}/drive/items/${fileId}/content`;
      logger.debug(
        { fileId, adminEmail },
        "Updating file in OneDrive shared folder via admin account"
      );
    } else {
      throw new Error(
        "GRAPH_DRIVE_ID, ONEDRIVE_USER_EMAIL, or SHAREPOINT_SITE_ID must be configured for file update"
      );
    }

    logger.debug({ updateUrl, fileId }, "Attempting file update");

    const fileResponse = await axios.put(updateUrl, fileBuffer, {
      headers: {
        Authorization: `Bearer ${graphToken}`,
        "Content-Type": mimeType || "application/octet-stream",
      },
    });

    const fileData = fileResponse.data;

    logger.info(
      { fileId: fileData.id, webUrl: fileData.webUrl },
      "File updated successfully in OneDrive"
    );

    return {
      fileId: fileData.id,
      name: fileData.name,
      webUrl: fileData.webUrl,
      size: fileData.size,
    };
  } catch (error) {
    // Extract detailed error information from Graph API
    const errorDetails = {
      message: error.message,
      fileId,
      adminEmail: process.env.ONEDRIVE_USER_EMAIL,
      sharePointSiteId: process.env.SHAREPOINT_SITE_ID,
    };

    // If it's an axios error, include response data
    if (error.response) {
      errorDetails.statusCode = error.response.status;
      errorDetails.statusText = error.response.statusText;
      errorDetails.responseData = error.response.data;
    }

    logger.error(errorDetails, "Failed to update file in OneDrive");

    // Re-throw with more context
    const updateError = new Error(
      `Failed to update file in OneDrive: ${error.message}`
    );
    updateError.originalError = error;
    updateError.details = errorDetails;
    throw updateError;
  }
}

// Backward compatibility alias
export const uploadOneDriveFile = uploadFileToSharedFolder;
