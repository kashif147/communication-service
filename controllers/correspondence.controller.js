import GeneratedLetter from "../model/generatedLetter.model.js";
import OutboundCommunication from "../model/outboundCommunication.model.js";
import { generateDownloadUrl } from "../services/azureBlob.service.js";
import { blobServiceClient, containerName } from "../config/azure.js";
import { validateObjectId } from "../middlewares/validateInput.js";
import {
  isCrmUser,
  getTrustedOwnProfileId,
} from "../middlewares/internalCaller.js";

/**
 * Resolve the GeneratedLetter for an /internal/letters/* request, scoped to
 * the caller. Route middleware (internalOrUserRead) has already classified the
 * caller and pinned the tenant:
 *  - internal-only caller: tenant = its x-tenant-id header (req.internalTenantId).
 *  - user session: tenant = trusted user tenant (req.tenantId after
 *    requirePermission + tenantContextWarn). CRM staff read any letter in their
 *    tenant; anyone else (portal member) only a letter whose profileId is
 *    their own trusted profile id. Otherwise null (-> 404, no existence leak).
 * Body/query/params tenantId are never consulted.
 */
async function findLetterForCaller(req, letterId) {
  if (req.callerKind === "internal") {
    if (!req.internalTenantId) return null;
    return GeneratedLetter.findOne({ _id: letterId, tenantId: req.internalTenantId }).lean();
  }
  if (req.callerKind === "user") {
    const tenantId = req.tenantId;
    if (!tenantId || !req.userId) return null;
    if (isCrmUser(req)) {
      return GeneratedLetter.findOne({ _id: letterId, tenantId }).lean();
    }
    const ownProfileId = getTrustedOwnProfileId(req);
    if (!ownProfileId) return null;
    return GeneratedLetter.findOne({
      _id: letterId,
      tenantId,
      $or: [{ profileId: ownProfileId }, { memberId: ownProfileId }],
    }).lean();
  }
  return null;
}

// Internal callers keep the historical "not found" envelope (200 + data:null,
// which notification-service's communicationLetterClient already handles);
// user sessions get a real 404 for both "absent" and "not yours".
function letterNotFound(req, res) {
  if (req.callerKind === "user") return res.notFound("Letter not found");
  return res.notFoundRecord("Letter not found");
}

export async function getLetterInternalById(req, res, next) {
  try {
    const { letterId } = req.params;
    validateObjectId(letterId, "letterId");

    const doc = await findLetterForCaller(req, letterId);
    if (!doc) return letterNotFound(req, res);

    const downloadUrl = doc.blobPath ? generateDownloadUrl(doc.blobPath) : null;
    return res.success({ letter: { ...doc, downloadUrl } });
  } catch (e) {
    return next(e);
  }
}

export async function downloadLetterBufferInternal(req, res, next) {
  try {
    const { letterId } = req.params;
    validateObjectId(letterId, "letterId");

    const doc = await findLetterForCaller(req, letterId);
    if (!doc?.blobPath) return letterNotFound(req, res);

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
