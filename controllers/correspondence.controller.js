import GeneratedLetter from "../model/generatedLetter.model.js";
import OutboundCommunication from "../model/outboundCommunication.model.js";
import { generateDownloadUrl } from "../services/azureBlob.service.js";
import { blobServiceClient, containerName } from "../config/azure.js";
import { validateObjectId } from "../middlewares/validateInput.js";
import { AppError } from "../errors/AppError.js";

function requireInternal(req) {
  const ok =
    req.headers["x-internal-request"] === "true" ||
    req.headers["x-internal-request"] === "1";
  if (!ok) {
    throw AppError.forbidden("Internal endpoint: x-internal-request header required");
  }
}

export async function getLetterInternalById(req, res, next) {
  try {
    requireInternal(req);
    const tenantId = req.headers["x-tenant-id"] || req.tenantId;
    const { letterId } = req.params;
    validateObjectId(letterId, "letterId");

    const doc = await GeneratedLetter.findOne({ _id: letterId, tenantId }).lean();
    if (!doc) return res.notFoundRecord("Letter not found");

    const downloadUrl = doc.blobPath ? generateDownloadUrl(doc.blobPath) : null;
    return res.success({ letter: { ...doc, downloadUrl } });
  } catch (e) {
    return next(e);
  }
}

export async function downloadLetterBufferInternal(req, res, next) {
  try {
    requireInternal(req);
    const tenantId = req.headers["x-tenant-id"] || req.tenantId;
    const { letterId } = req.params;
    validateObjectId(letterId, "letterId");

    const doc = await GeneratedLetter.findOne({ _id: letterId, tenantId }).lean();
    if (!doc?.blobPath) return res.notFoundRecord("Letter not found");

    const container = blobServiceClient.getContainerClient(containerName);
    const blob = container.getBlockBlobClient(doc.blobPath);
    const download = await blob.download();
    const chunks = [];
    for await (const chunk of download.readableStreamBody) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    return res.success({
      letterId: doc._id,
      fileName: doc.fileName,
      contentType:
        doc.contentType === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : doc.contentType,
      dataBase64: buffer.toString("base64"),
    });
  } catch (e) {
    return next(e);
  }
}

export async function listLettersByProfile(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }
    const { profileId } = req.params;
    validateObjectId(profileId, "profileId");

    const letters = await GeneratedLetter.find({
      tenantId: req.tenantId,
      $or: [{ profileId: String(profileId) }, { memberId: String(profileId) }],
    })
      .sort({ createdAt: -1 })
      .lean();

    const rows = letters.map((l) => ({
      ...l,
      downloadUrl: l.blobPath ? generateDownloadUrl(l.blobPath) : null,
    }));

    return res.success({ letters: rows });
  } catch (e) {
    return next(e);
  }
}

export async function listCorrespondenceByProfile(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }
    const { profileId } = req.params;
    validateObjectId(profileId, "profileId");

    const rows = await OutboundCommunication.find({
      tenantId: req.tenantId,
      profileId: String(profileId),
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.success({ correspondence: rows });
  } catch (e) {
    return next(e);
  }
}
