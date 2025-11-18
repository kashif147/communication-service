import {
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} from "@azure/storage-blob";
import {
  blobServiceClient,
  sharedKeyCredential,
  containerName,
  accountName,
} from "../config/azure.js";

export async function uploadLetter(blobPath, buffer, contentType) {
  const container = blobServiceClient.getContainerClient(containerName);
  const blockBlob = container.getBlockBlobClient(blobPath);

  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  return blockBlob.url;
}

export function generateDownloadUrl(blobPath) {
  const now = new Date();
  const expiry = new Date(now.getTime() + 60 * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("r"),
      startsOn: now,
      expiresOn: expiry,
    },
    sharedKeyCredential
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobPath}?${sas}`;
}
