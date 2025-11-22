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
    const token = accessToken || (await getGraphAccessToken());

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
    let uploadPath;
    
    if (sharePointSiteId) {
      // SharePoint site path - upload to shared folder on SharePoint site
      uploadPath = `/sites/${sharePointSiteId}/drive/items/${folderId}:/${fileName}:/content`;
      logger.debug(
        { folderId, fileName, sharePointSiteId },
        "Uploading to SharePoint site shared folder"
      );
    } else if (adminEmail) {
      // OneDrive shared folder via admin account
      uploadPath = `/users/${adminEmail}/drive/items/${folderId}:/${fileName}:/content`;
      logger.debug(
        { folderId, fileName, adminEmail },
        "Uploading to OneDrive shared folder via admin account"
      );
    } else {
      throw new Error(
        "ONEDRIVE_USER_EMAIL (admin email) must be configured for shared folder access"
      );
    }

    const fileResponse = await client.api(uploadPath).put(fileBuffer);

    return {
      fileId: fileResponse.id,
      name: fileResponse.name,
      webUrl: fileResponse.webUrl,
      size: fileResponse.size,
    };
  } catch (error) {
    logger.error(
      {
        error: error.message,
        fileName,
        folderId: process.env.ONEDRIVE_TEMPLATE_FOLDER_ID,
        adminEmail: process.env.ONEDRIVE_USER_EMAIL,
        sharePointSiteId: process.env.SHAREPOINT_SITE_ID,
      },
      "Failed to upload file to shared folder"
    );
    throw error;
  }
}
