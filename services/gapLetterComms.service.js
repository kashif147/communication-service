import { randomUUID } from "crypto";
import Template from "../model/template.model.js";
import GeneratedLetter from "../model/generatedLetter.model.js";
import OutboundCommunication from "../model/outboundCommunication.model.js";
import { getOneDriveFile } from "./onedrive.service.js";
import { mergeTemplate } from "./mailMerge.service.js";
import { uploadLetter, generateDownloadUrl } from "./azureBlob.service.js";
import { fetchProfilesBatch } from "./profileBatch.service.js";
import { buildBookmarkMergeMap } from "./bookmarkMerge.service.js";
import { applyTemplate } from "./personalization.service.js";
import { sendSesMessage } from "./ses.service.js";
import { isEmailTemplateType } from "../helpers/templateEmail.js";
import { convertDocxToPdf } from "./docxPdfConversion.service.js";
import {
  GAP_LETTER_TEMPLATE_CATEGORY,
  GAP_LETTER_TEMPLATE_NAME,
  GAP_LETTER_EMAIL_TEMPLATE_NAME,
  GAP_LETTER_SOURCE,
  DEFAULT_GAP_LETTER_EMAIL_SUBJECT,
  DEFAULT_GAP_LETTER_EMAIL_HTML,
} from "../constants/gapLetter.constants.js";
import logger from "../config/logger.js";

function logStructured(payload) {
  logger.info(
    { job: "gap_letter_comms", ...payload },
    payload.message || payload.phase || "gap_letter_comms",
  );
}

async function resolveTemplate({ tenantId, templateIdEnv, name, typeFilter }) {
  if (templateIdEnv && String(templateIdEnv).trim()) {
    const byId = await Template.findOne({
      _id: String(templateIdEnv).trim(),
      tenantId,
    }).lean();
    if (byId) return byId;
  }

  const filter = {
    tenantId,
    name,
    category: GAP_LETTER_TEMPLATE_CATEGORY,
  };
  if (typeFilter === "email") {
    filter.tempolateType = { $regex: /^email$/i };
  } else {
    filter.tempolateType = { $not: { $regex: /^email$/i } };
  }

  return Template.findOne(filter).sort({ updatedAt: -1 }).lean();
}

async function recordOutbound({
  tenantId,
  profileId,
  channel,
  templateKey,
  status,
  idempotencyKey,
  letterId,
  providerMessageId,
  error,
  sourceBatchKey,
}) {
  return OutboundCommunication.findOneAndUpdate(
    { tenantId, idempotencyKey },
    {
      $setOnInsert: {
        tenantId,
        profileId,
        channel,
        templateKey,
        sourceBatchKey: sourceBatchKey || null,
        letterId: letterId || null,
      },
      $set: {
        status: status || "pending",
        providerMessageId: providerMessageId || null,
        error: error || null,
      },
    },
    { upsert: true, new: true },
  );
}

function profileFromPayload(data) {
  const effective = data?.effective || {};
  return {
    _id: data?.profileId || null,
    membershipNumber: data?.memberId || null,
    personalInfo: effective.personalInfo || {},
    contactInfo: effective.contactInfo || {},
    professionalDetails: effective.professionalDetails || {},
  };
}

function pickApplicantEmail(data, profile) {
  const contact = profile?.contactInfo || {};
  const effectiveContact = data?.effective?.contactInfo || {};
  const preferred = effectiveContact.preferredEmail || contact.preferredEmail;
  if (preferred === "personal") {
    return effectiveContact.personalEmail || contact.personalEmail || data?.userEmail || null;
  }
  if (preferred === "work") {
    return effectiveContact.workEmail || contact.workEmail || data?.userEmail || null;
  }
  return (
    data?.userEmail ||
    effectiveContact.personalEmail ||
    contact.personalEmail ||
    effectiveContact.workEmail ||
    contact.workEmail ||
    null
  );
}

export async function processGapLetterComms(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const profileId = data?.profileId != null ? String(data.profileId) : null;
  const applicationId =
    data?.applicationId != null ? String(data.applicationId) : null;
  const correlationId =
    payload?.correlationId || payload?.metadata?.correlationId || randomUUID();
  const dedupeKey =
    data?.gapLetter?.dedupeKey ||
    `gap-letter:${tenantId || "tenant"}:${applicationId || profileId || randomUUID()}`;

  if (!data?.gapLetter?.sendGapLetter) {
    return { ok: true, skipped: true, reason: "send_gap_letter_false" };
  }
  if (!tenantId || !profileId) {
    logStructured({ phase: "error", message: "missing_tenant_or_profile" });
    return { ok: false, reason: "missing_tenant_or_profile" };
  }

  const letterIdempotency = `${dedupeKey}:letter`;
  const existingLetter = await GeneratedLetter.findOne({
    tenantId,
    sourceKey: letterIdempotency,
  }).lean();
  if (existingLetter) {
    return { ok: true, skipped: true, letterId: existingLetter._id?.toString() };
  }

  const letterTemplate = await resolveTemplate({
    tenantId,
    templateIdEnv: process.env.GAP_LETTER_TEMPLATE_ID,
    name: GAP_LETTER_TEMPLATE_NAME,
    typeFilter: "letter",
  });

  if (!letterTemplate?.fileId) {
    await recordOutbound({
      tenantId,
      profileId,
      channel: "letter",
      templateKey: GAP_LETTER_SOURCE,
      status: "failed",
      idempotencyKey: letterIdempotency,
      error: "GAP Letter template not configured",
      sourceBatchKey: dedupeKey,
    });
    return { ok: false, reason: "letter_template_not_found" };
  }

  let profile = null;
  try {
    const profiles = await fetchProfilesBatch({ profileIds: [profileId], tenantId });
    profile = profiles?.[0] || null;
  } catch (error) {
    logStructured({
      phase: "warn",
      message: "profile_fetch_failed_using_payload",
      profileId,
      error: error.message,
    });
  }
  profile = profile || profileFromPayload(data);

  const subscriptionContext = {
    ...(data?.effective?.subscriptionDetails || {}),
    membershipCategory:
      data?.gapLetter?.categoryForDecision ||
      data?.effective?.subscriptionDetails?.membershipCategory ||
      null,
    membershipMovement: data?.gapLetter?.predictedMovement || null,
    previousMembershipStatus: data?.gapLetter?.previousMembershipStatus || null,
  };

  const mergeMap = await buildBookmarkMergeMap({
    profile,
    subscription: subscriptionContext,
    tenantId,
  });

  const templateBuffer = await getOneDriveFile(letterTemplate.fileId);
  const mergedDoc = mergeTemplate(templateBuffer, mergeMap);
  let pdfBuffer;
  try {
    pdfBuffer = await convertDocxToPdf(
      mergedDoc,
      `gap-letter-${data?.memberId || profileId}`,
    );
  } catch (error) {
    await recordOutbound({
      tenantId,
      profileId,
      channel: "letter",
      templateKey: GAP_LETTER_SOURCE,
      status: "failed",
      idempotencyKey: letterIdempotency,
      error: error.message,
      sourceBatchKey: dedupeKey,
    });
    throw error;
  }

  const fileName = `gap-letter-${data?.memberId || profileId}.pdf`;
  const blobPath = `${tenantId}/${profileId}/${fileName}`;
  await uploadLetter(blobPath, pdfBuffer, "application/pdf");

  const letterRecord = await GeneratedLetter.create({
    memberId: data?.memberId || profileId,
    profileId,
    templateId: String(letterTemplate._id),
    templateName: letterTemplate.name,
    fileName,
    blobPath,
    contentType: "pdf",
    tenantId,
    createdBy: data?.reviewerId || "system@gap-letter-comms",
    source: GAP_LETTER_SOURCE,
    sourceKey: letterIdempotency,
    displayName: "GAP Letter",
  });

  const letterId = String(letterRecord._id);
  await recordOutbound({
    tenantId,
    profileId,
    channel: "letter",
    templateKey: GAP_LETTER_SOURCE,
    status: "sent",
    idempotencyKey: letterIdempotency,
    letterId,
    sourceBatchKey: dedupeKey,
  });

  const toEmail = pickApplicantEmail(data, profile);
  if (!toEmail) {
    await recordOutbound({
      tenantId,
      profileId,
      channel: "email",
      templateKey: GAP_LETTER_SOURCE,
      status: "skipped",
      idempotencyKey: `${dedupeKey}:email`,
      letterId,
      error: "No applicant email available",
      sourceBatchKey: dedupeKey,
    });
    return { ok: true, letterId, emailStatus: "skipped" };
  }

  const emailTemplate = await resolveTemplate({
    tenantId,
    templateIdEnv: process.env.GAP_LETTER_EMAIL_TEMPLATE_ID,
    name: GAP_LETTER_EMAIL_TEMPLATE_NAME,
    typeFilter: "email",
  });

  let subject = DEFAULT_GAP_LETTER_EMAIL_SUBJECT;
  let htmlBody = DEFAULT_GAP_LETTER_EMAIL_HTML;
  if (emailTemplate && isEmailTemplateType(emailTemplate)) {
    const applied = applyTemplate(emailTemplate, mergeMap);
    subject = applied.subject || subject;
    htmlBody = applied.html || htmlBody;
  } else {
    const applied = applyTemplate({ subject, htmlBody, textBody: "" }, mergeMap);
    subject = applied.subject;
    htmlBody = applied.html;
  }

  let emailStatus = "sent";
  let providerMessageId = null;
  let emailError = null;
  try {
    const fromAddress =
      process.env.SES_FROM_ADDRESS ||
      process.env.GAP_LETTER_EMAIL_FROM ||
      process.env.EMAIL_FROM ||
      "no-reply@inmo.ie";
    const { messageId } = await sendSesMessage({
      fromAddress,
      toAddress: toEmail,
      subject,
      htmlBody,
      textBody: undefined,
      attachments: [
        {
          filename: fileName,
          contentType: "application/pdf",
          contentBase64: pdfBuffer.toString("base64"),
        },
      ],
      tags: {
        tenantId,
        profileId,
        applicationId,
        source: GAP_LETTER_SOURCE,
        correlationId,
      },
    });
    providerMessageId = messageId;
  } catch (error) {
    emailStatus = "failed";
    emailError = error.message;
  }

  await recordOutbound({
    tenantId,
    profileId,
    channel: "email",
    templateKey: GAP_LETTER_SOURCE,
    status: emailStatus,
    idempotencyKey: `${dedupeKey}:email`,
    letterId,
    providerMessageId,
    error: emailError,
    sourceBatchKey: dedupeKey,
  });

  return {
    ok: emailStatus === "sent",
    letterId,
    downloadUrl: generateDownloadUrl(blobPath),
    emailStatus,
  };
}
