import { getGraphClient } from "../config/graph.js";
import { getGraphAccessToken } from "./graphAuth.service.js";

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

    // Download the file using Graph API
    const fileResponse = await client
      .api(`/me/drive/items/${fileId}/content`)
      .responseType("arraybuffer")
      .get();

    // Convert ArrayBuffer to Node Buffer
    return Buffer.from(fileResponse);
  } catch (error) {
    console.error("Failed to fetch OneDrive file:", error.message);
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

    // Upload the file to OneDrive root or a specific folder
    const uploadPath = `/me/drive/root:/${fileName}:/content`;
    const fileResponse = await client
      .api(uploadPath)
      .put(fileBuffer);

    return {
      fileId: fileResponse.id,
      name: fileResponse.name,
      webUrl: fileResponse.webUrl,
      size: fileResponse.size,
    };
  } catch (error) {
    console.error("Failed to upload OneDrive file:", error.message);
    throw error;
  }
}
