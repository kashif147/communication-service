import Template from "../model/template.model.js";
import GeneratedLetter from "../model/generatedLetter.model.js";
import OutboundCommunication from "../model/outboundCommunication.model.js";
import { getOneDriveFile } from "../services/onedrive.service.js";
import { mergeTemplate } from "../services/mailMerge.service.js";
import {
  uploadLetter,
  generateDownloadUrl,
} from "../services/azureBlob.service.js";
import { collectMemberData } from "../services/memberData.service.js";
import { sendSesMessage } from "../services/ses.service.js";
import { convertDocxToPdf } from "../services/docxPdfConversion.service.js";
import { randomUUID } from "crypto";
import {
  validateObjectId,
  sanitizeString,
} from "../middlewares/validateInput.js";
import { AppError } from "../errors/AppError.js";
import bizLogger from "../config/bizLogger.js";

function requireInternal(req) {
  const ok = req.headers["x-internal-request"] === "true" || req.headers["x-internal-request"] === "1";
  if (!ok) {
    throw AppError.forbidden("Internal endpoint: x-internal-request header required");
  }
}

export async function generateLetter(req, res, next) {
  try {
    // Validate userId and tenantId are available from token
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { memberId, templateId, registrationId, mergeFields } = req.body;

    if (!memberId || !templateId) {
      return res.fail("memberId and templateId are required", 400);
    }

    // Validate ObjectId format to prevent NoSQL injection
    validateObjectId(templateId, "templateId");
    validateObjectId(memberId, "memberId");

    // Find template and ensure it belongs to user's tenant
    const template = await Template.findOne({
      _id: templateId,
      tenantId: req.tenantId, // Tenant isolation - only templates from user's tenant
    });

    if (!template) {
      return res.notFoundRecord("Template not found or access denied");
    }

    const templateBuffer = await getOneDriveFile(template.fileId);
    const memberData = await collectMemberData(memberId);
    // Optional caller-supplied placeholders (e.g. events-service passes
    // EventTitle/EventDate/CpdCredits/AccreditationBody/CertificationType for
    // a certificate) merged on top of the member data - collectMemberData
    // only ever knows about profile/subscription/account fields, never
    // anything about the caller's own domain.
    const mergedDoc = mergeTemplate(templateBuffer, { ...memberData, ...(mergeFields || {}) });
    // Same docx->PDF step gap/graduation letters already use
    // (services/docxPdfConversion.service.js, LibreOffice via execFile) -
    // requires soffice/LibreOffice installed on this machine, see
    // dev-commands.md.
    const pdfBuffer = await convertDocxToPdf(mergedDoc, `letter-${memberId}`);

    const fileName = `letter-${randomUUID()}.pdf`;
    const blobPath = `${req.tenantId}/${memberId}/${fileName}`;

    await uploadLetter(blobPath, pdfBuffer, "application/pdf");

    const record = await GeneratedLetter.create({
      memberId,
      templateId,
      fileName,
      blobPath,
      contentType: "pdf",
      tenantId: req.tenantId, // From token
      createdBy: req.userId, // From token
      registrationId: registrationId || null,
    });

    const downloadUrl = generateDownloadUrl(blobPath);

    bizLogger.business("Communication letter generated and stored", {
      eventType: "LetterGenerated",
      membershipId: memberId,
      tenantId: req.tenantId,
      profileId: null,
      applicationId: null,
    }, req);

    res.created(
      {
        downloadUrl,
        letterId: record._id,
        fileName,
      },
      "Letter generated successfully"
    );
  } catch (error) {
    next(error);
  }
}

/**
 * System-triggered equivalent of generateLetter, for callers with no
 * originating user request (e.g. events-service's completion sweep job
 * auto-issuing a certificate - see its services/autoCertificate.service.js).
 * Guarded by requireInternal() (x-internal-request) instead of
 * requirePermission, the same pattern correspondence.controller.js's
 * internal routes already use - reads tenantId from the x-tenant-id header
 * rather than a gateway-verified JWT, since there is no user in this call at
 * all.
 *
 * Optional `deliver: {email, toAddress}` also emails the generated document
 * as an attachment (idempotent - findOneAndUpdate upsert on a deterministic
 * key derived from registrationId, so a retried/redelivered issuance never
 * sends twice).
 */
export async function generateLetterInternal(req, res, next) {
  try {
    requireInternal(req);
    const tenantId = req.headers["x-tenant-id"];
    if (!tenantId) return res.fail("x-tenant-id header is required", 400);

    const { memberId, templateId, registrationId, deliver, mergeFields } = req.body;
    if (!memberId || !templateId) {
      return res.fail("memberId and templateId are required", 400);
    }

    validateObjectId(templateId, "templateId");
    validateObjectId(memberId, "memberId");

    const template = await Template.findOne({ _id: templateId, tenantId });
    if (!template) {
      return res.notFoundRecord("Template not found or access denied");
    }

    const templateBuffer = await getOneDriveFile(template.fileId);
    const memberData = await collectMemberData(memberId);
    const mergedDoc = mergeTemplate(templateBuffer, { ...memberData, ...(mergeFields || {}) });
    const pdfBuffer = await convertDocxToPdf(mergedDoc, `letter-${memberId}`);

    const fileName = `letter-${randomUUID()}.pdf`;
    const blobPath = `${tenantId}/${memberId}/${fileName}`;

    await uploadLetter(blobPath, pdfBuffer, "application/pdf");

    const record = await GeneratedLetter.create({
      memberId,
      templateId,
      fileName,
      blobPath,
      contentType: "pdf",
      tenantId,
      createdBy: "system",
      registrationId: registrationId || null,
    });

    const downloadUrl = generateDownloadUrl(blobPath);

    bizLogger.business("Communication letter generated and stored (internal/system)", {
      eventType: "LetterGenerated",
      membershipId: memberId,
      tenantId,
      profileId: null,
      applicationId: null,
    }, req);

    let emailWarning = null;
    if (deliver?.email && deliver?.toAddress) {
      const idempotencyKey = `certificate-issuance:${registrationId || record._id}`;
      try {
        const result = await sendSesMessage({
          toAddress: deliver.toAddress,
          subject: "Your certificate",
          htmlBody: "<p>Please find your certificate attached.</p>",
          attachments: [
            {
              filename: fileName,
              contentType: "application/pdf",
              contentBase64: pdfBuffer.toString("base64"),
            },
          ],
          tags: { source: "certificate-issuance", registrationId: registrationId || "" },
        });
        await OutboundCommunication.findOneAndUpdate(
          { tenantId, idempotencyKey },
          {
            $setOnInsert: { tenantId, profileId: memberId, channel: "email", templateKey: "certificate", letterId: String(record._id) },
            $set: { status: "sent", providerMessageId: result?.MessageId || null, error: null },
          },
          { upsert: true, new: true },
        );
      } catch (err) {
        // The letter/certificate itself was already generated and stored
        // successfully above - a failed delivery email must not undo that,
        // just surface as a warning on the response.
        emailWarning = `Certificate generated but email delivery failed: ${err.message}`;
        await OutboundCommunication.findOneAndUpdate(
          { tenantId, idempotencyKey },
          {
            $setOnInsert: { tenantId, profileId: memberId, channel: "email", templateKey: "certificate", letterId: String(record._id) },
            $set: { status: "failed", error: err.message },
          },
          { upsert: true, new: true },
        ).catch(() => {});
      }
    }

    res.created(
      { downloadUrl, letterId: record._id, fileName, ...(emailWarning ? { warning: emailWarning } : {}) },
      "Letter generated successfully"
    );
  } catch (error) {
    next(error);
  }
}
