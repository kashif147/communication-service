import { getGraphClient } from "../config/graph.js";
import { getGraphAccessToken } from "./graphAuth.service.js";
import logger from "../config/logger.js";

/**
 * Download a file from OneDrive (Word .docx template)
 * using Microsoft Graph API.
 *
 * @param {string} fileId - The OneDrive file ID
 * @param {string} [accessToken] - Optional access token. If not provided, will fetch one automatically
 * @returns {Buffer} - The binary content of the file
 */
export async function getOneDriveFile(fileId, accessToken) {
  try {
    // Use provided token or get a new one
    const token = accessToken || (await getGraphAccessToken());

    // Create Graph client
    const client = getGraphClient(token);

    // Get user email for application permissions (if needed)
    const userEmail = process.env.ONEDRIVE_USER_EMAIL;

    // Download the file using Graph API
    // For application permissions, use user-specific path
    let downloadPath;
    if (userEmail) {
      downloadPath = `/users/${userEmail}/drive/items/${fileId}/content`;
    } else {
      downloadPath = `/me/drive/items/${fileId}/content`;
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
        userEmail: process.env.ONEDRIVE_USER_EMAIL,
      },
      "Failed to fetch OneDrive file"
    );
    throw error;
  }
}

/**
 * Upload a file to OneDrive (Word .docx template)
 * using Microsoft Graph API.
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

    // Get the target folder ID from environment variable
    // If not set, upload to root folder
    const folderId = process.env.ONEDRIVE_TEMPLATE_FOLDER_ID;
    const userEmail = process.env.ONEDRIVE_USER_EMAIL; // Optional: for application permissions

    let uploadPath;
    if (folderId) {
      // For application permissions (client credentials), we may need user context
      // Try direct folder access first, fallback to user-specific path if needed
      if (userEmail) {
        // Use user-specific path for application permissions
        // Format: /users/{email}/drive/items/{folder-id}:/{filename}:/content
        uploadPath = `/users/${userEmail}/drive/items/${folderId}:/${fileName}:/content`;
        logger.debug(
          { folderId, fileName, userEmail },
          "Uploading to specific OneDrive folder (application permissions)"
        );
      } else {
        // Try direct folder access (works for delegated permissions or if folder is accessible)
        // Format: /me/drive/items/{folder-id}:/{filename}:/content
        uploadPath = `/me/drive/items/${folderId}:/${fileName}:/content`;
        logger.debug(
          { folderId, fileName },
          "Uploading to specific OneDrive folder (delegated permissions)"
        );
      }
    } else {
      // Fallback to root folder
      if (userEmail) {
        uploadPath = `/users/${userEmail}/drive/root:/${fileName}:/content`;
      } else {
        uploadPath = `/me/drive/root:/${fileName}:/content`;
      }
      logger.warn(
        "ONEDRIVE_TEMPLATE_FOLDER_ID not set, uploading to root folder"
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
        userEmail: process.env.ONEDRIVE_USER_EMAIL,
      },
      "Failed to upload OneDrive file"
    );
    throw error;
  }
}
