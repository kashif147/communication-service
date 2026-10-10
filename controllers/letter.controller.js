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
import { fetchProfilesBatch } from "../services/profileBatch.service.js";
import { resolveLetterRecipient } from "../services/letterRecipient.service.js";
import { classifyCaller } from "../middlewares/internalCaller.js";
import { randomUUID } from "crypto";
import {
  validateObjectId,
  sanitizeString,
} from "../middlewares/validateInput.js";
import { AppError } from "../errors/AppError.js";
import bizLogger from "../config/bizLogger.js";
import logger from "../config/logger.js";

/**
 * External collaborators, collected on one object so tests can substitute
 * them (OneDrive/Graph, LibreOffice, Azure Blob, SES and profile-service are
 * all network/process side effects). Production code never reassigns these.
 */
export const letterDeps = {
  getOneDriveFile,
  collectMemberData,
  mergeTemplate,
  convertDocxToPdf,
  uploadLetter,
  generateDownloadUrl,
  sendSesMessage,
  fetchProfilesBatch,
};

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

    const templateBuffer = await letterDeps.getOneDriveFile(template.fileId);
    const memberData = await letterDeps.collectMemberData(memberId);
    // Optional caller-supplied placeholders (e.g. events-service passes
    // EventTitle/EventDate/CpdCredits/AccreditationBody/CertificationType for
    // a certificate) merged on top of the member data - collectMemberData
    // only ever knows about profile/subscription/account fields, never
    // anything about the caller's own domain.
    const mergedDoc = letterDeps.mergeTemplate(templateBuffer, { ...memberData, ...(mergeFields || {}) });
    // Same docx->PDF step gap/graduation letters already use
    // (services/docxPdfConversion.service.js, LibreOffice via execFile) -
    // requires soffice/LibreOffice installed on this machine, see
    // dev-commands.md.
    const pdfBuffer = await letterDeps.convertDocxToPdf(mergedDoc, `letter-${memberId}`);

    const fileName = `letter-${randomUUID()}.pdf`;
    const blobPath = `${req.tenantId}/${memberId}/${fileName}`;

    await letterDeps.uploadLetter(blobPath, pdfBuffer, "application/pdf");

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

    const downloadUrl = letterDeps.generateDownloadUrl(blobPath);

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
 *
 * Caller rules (Phase 2B Stream 3C, audit H-03/T-10/C1):
 *  - Internal-only: `x-internal-request` with NO user identity (the DEV gateway
 *    strips client-supplied x-internal-request). Tenant = the caller's
 *    `x-tenant-id` header; any body/query tenantId is ignored.
 *  - A request carrying user identity (gateway headers or a bearer token) is
 *    rejected: the internal flag grants a user nothing, and users already have
 *    the permission-checked /api/letters/generate.
 *
 * Optional `deliver: {email, toAddress}` emails the generated PDF. The
 * destination is ALWAYS the member's on-record email, resolved for this tenant
 * via profile-service (fetchProfilesBatch + pickEmail, the same way campaigns /
 * graduation comms resolve recipients). A caller `toAddress` is honoured only
 * when it is one of that member's own on-record emails; otherwise it is
 * ignored. No on-record email (or member not in this tenant) => not sent.
 * Idempotent on (tenantId, `certificate-issuance:<registrationId|letterId>`):
 * an already-"sent" record is never re-sent (audit C7).
 */
export async function generateLetterInternal(req, res, next) {
  try {
    const caller = classifyCaller(req);
    if (caller.kind === "user") {
      return res.fail(
        "Internal endpoint is not available to user sessions; use /api/letters/generate",
        403
      );
    }
    if (caller.kind !== "internal") {
      throw AppError.forbidden("Internal endpoint: x-internal-request header required");
    }
    const tenantId = caller.tenantId;
    if (!tenantId) return res.fail("x-tenant-id header is required", 400);

    const { memberId, templateId, registrationId, deliver, mergeFields } = req.body || {};
    if (!memberId || !templateId) {
      return res.fail("memberId and templateId are required", 400);
    }

    validateObjectId(templateId, "templateId");
    validateObjectId(memberId, "memberId");

    const template = await Template.findOne({ _id: templateId, tenantId });
    if (!template) {
      return res.notFoundRecord("Template not found or access denied");
    }

    const templateBuffer = await letterDeps.getOneDriveFile(template.fileId);
    const memberData = await letterDeps.collectMemberData(memberId);
    const mergedDoc = letterDeps.mergeTemplate(templateBuffer, { ...memberData, ...(mergeFields || {}) });
    const pdfBuffer = await letterDeps.convertDocxToPdf(mergedDoc, `letter-${memberId}`);

    const fileName = `letter-${randomUUID()}.pdf`;
    const blobPath = `${tenantId}/${memberId}/${fileName}`;

    await letterDeps.uploadLetter(blobPath, pdfBuffer, "application/pdf");

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

    const downloadUrl = letterDeps.generateDownloadUrl(blobPath);

    bizLogger.business("Communication letter generated and stored (internal/system)", {
      eventType: "LetterGenerated",
      membershipId: memberId,
      tenantId,
      profileId: null,
      applicationId: null,
    }, req);

    let emailWarning = null;
    if (deliver?.email) {
      const idempotencyKey = `certificate-issuance:${registrationId || record._id}`;
      const outboundBase = {
        tenantId,
        profileId: memberId,
        channel: "email",
        templateKey: "certificate",
        letterId: String(record._id),
      };
      const recordOutcome = (set) =>
        OutboundCommunication.findOneAndUpdate(
          { tenantId, idempotencyKey },
          { $setOnInsert: outboundBase, $set: set },
          { upsert: true, new: true },
        );

      const alreadySent = await OutboundCommunication.findOne({
        tenantId,
        idempotencyKey,
        status: "sent",
      }).lean();

      if (alreadySent) {
        logger.info({ tenantId, idempotencyKey }, "Certificate email already sent; skipping re-send");
      } else {
        let recipient;
        try {
          recipient = await resolveLetterRecipient({
            tenantId,
            memberId,
            requestedAddress: deliver.toAddress,
            fetchProfiles: letterDeps.fetchProfilesBatch,
          });
        } catch (err) {
          logger.warn({ tenantId, memberId, err: err.message }, "Certificate recipient lookup failed");
          recipient = { ok: false, reason: "recipient_lookup_failed" };
        }

        if (!recipient.ok) {
          emailWarning = "Certificate generated but not emailed: no recipient on record for this member";
          await recordOutcome({ status: "failed", error: recipient.reason }).catch(() => {});
        } else {
          if (recipient.requestedAddressIgnored) {
            logger.warn(
              { tenantId, memberId, registrationId: registrationId || null },
              "Caller-supplied toAddress is not on record for this member; delivering to the on-record address"
            );
          }
          try {
            const result = await letterDeps.sendSesMessage({
              toAddress: recipient.address,
              subject: "Your certificate",
              htmlBody: "<p>Please find your certificate attached.</p>",
              attachments: [
                {
                  filename: fileName,
                  contentType: "application/pdf",
                  contentBase64: pdfBuffer.toString("base64"),
                },
              ],
              tags: { source: "certificate-issuance", registrationId: registrationId || "", tenantId: String(tenantId) },
            });
            await recordOutcome({ status: "sent", providerMessageId: result?.MessageId || null, error: null });
          } catch (err) {
            // The letter/certificate itself was already generated and stored
            // successfully above - a failed delivery email must not undo that,
            // just surface as a warning on the response.
            logger.warn({ tenantId, memberId, err: err.message }, "Certificate email delivery failed");
            emailWarning = "Certificate generated but email delivery failed";
            await recordOutcome({ status: "failed", error: "send_failed" }).catch(() => {});
          }
        }
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
