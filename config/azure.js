import {
  BlobServiceClient,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";

const accountName = process.env.AZURE_STORAGE_ACCOUNT;
const accountKey = process.env.AZURE_STORAGE_KEY;
const containerName =
  process.env.AZURE_STORAGE_CONTAINER || "generated-letters";

if (!accountName || !accountKey) {
  throw new Error(
    "Azure Storage credentials missing. Please set AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_KEY"
  );
}

const sharedKeyCredential = new StorageSharedKeyCredential(
  accountName,
  accountKey
);

const blobServiceClient = new BlobServiceClient(
  `https://${accountName}.blob.core.windows.net`,
  sharedKeyCredential
);

export { blobServiceClient, sharedKeyCredential, containerName, accountName };
