import { randomUUID } from "crypto";
import Template from "../model/template.model.js";
import GeneratedLetter from "../model/generatedLetter.model.js";
import OutboundCommunication from "../model/outboundCommunication.model.js";
import { getOneDriveFile } from "./onedrive.service.js";
import { mergeTemplate } from "./mailMerge.service.js";
import { uploadLetter, generateDownloadUrl } from "./azureBlob.service.js";
import { fetchProfilesBatch } from "./profileBatch.service.js";
import { buildBookmarkMergeMap } from "./bookmarkMerge.service.js";
import {
  applyTemplate,
  pickEmail,
} from "./personalization.service.js";
import { sendSesMessage } from "./ses.service.js";
import { publisher } from "../rabbitMQ/index.js";
import { isEmailTemplateType } from "../helpers/templateEmail.js";
import {
  UGRAD_GRADUATION_TEMPLATE_CATEGORY,
  UGRAD_GRADUATION_LETTER_TEMPLATE_NAME,
  UGRAD_GRADUATION_EMAIL_TEMPLATE_NAME,
  UGRAD_GRADUATION_LETTER_SOURCE,
  DEFAULT_GRADUATION_EMAIL_SUBJECT,
  DEFAULT_GRADUATION_EMAIL_HTML,
} from "../constants/undergraduateGraduation.constants.js";
import logger from "../config/logger.js";

const MEMBER_NOTIFICATION_REQUESTED =
  "members.member.notification.requested.v1";

function logStructured(payload) {
  logger.info(
    { job: "undergraduate_graduation_comms", ...payload },
    payload.message || payload.phase || "undergraduate_graduation_comms"
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
    category: UGRAD_GRADUATION_TEMPLATE_CATEGORY,
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
    { upsert: true, new: true }
  );
}

async function publishMemberNotification({
  tenantId,
  userId,
  title,
  body,
  metadata,
  correlationId,
}) {
  if (!userId) return { success: false, skipped: true };
  return publisher.publish(
    MEMBER_NOTIFICATION_REQUESTED,
    {
      tenantId,
      userId: String(userId),
      title,
      body,
      metadata,
    },
    {
      tenantId,
      correlationId,
      exchange: "membership.events",
      routingKey: MEMBER_NOTIFICATION_REQUESTED,
      metadata: {
        service: "communication-service",
        version: "1.0",
        job: "undergraduateGraduationComms",
      },
    }
  );
}

/**
 * Process one undergraduate graduation comms message (letter + email + in-app records).
 */
export async function processUndergraduateGraduationComms(payload) {
  const data = payload?.data || payload;
  const tenantId = data?.tenantId ?? payload?.tenantId;
  const profileId = data?.profileId != null ? String(data.profileId) : null;
  const subscriptionId =
    data?.subscriptionId != null ? String(data.subscriptionId) : null;
  const userId = data?.userId != null ? String(data.userId) : null;
  const dedupeKey = data?.dedupeKey || `ugrad-grad:${subscriptionId || randomUUID()}`;
  const title = data?.title || "Congratulations on Your Graduation";
  const body =
    data?.body ||
    "Congratulations on reaching your graduation date. Your Undergraduate Student membership has now ended. We invite you to join as a full member and continue enjoying the benefits of membership.";
  const correlationId =
    payload?.correlationId || payload?.metadata?.correlationId || randomUUID();

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
    logStructured({
      phase: "skipped",
      message: "already_processed",
      profileId,
      letterId: existingLetter._id?.toString(),
    });
    return { ok: true, skipped: true, letterId: existingLetter._id?.toString() };
  }

  const letterTemplate = await resolveTemplate({
    tenantId,
    templateIdEnv: process.env.UGRAD_GRADUATION_LETTER_TEMPLATE_ID,
    name: UGRAD_GRADUATION_LETTER_TEMPLATE_NAME,
    typeFilter: "letter",
  });

  if (!letterTemplate?.fileId) {
    logStructured({
      phase: "error",
      message: "letter_template_not_found",
      tenantId,
      category: UGRAD_GRADUATION_TEMPLATE_CATEGORY,
    });
    await recordOutbound({
      tenantId,
      profileId,
      channel: "letter",
      templateKey: UGRAD_GRADUATION_LETTER_SOURCE,
      status: "failed",
      idempotencyKey: letterIdempotency,
      error: "Letter template not configured",
      sourceBatchKey: dedupeKey,
    });
    return { ok: false, reason: "letter_template_not_found" };
  }

  const profiles = await fetchProfilesBatch({
    profileIds: [profileId],
    tenantId,
  });
  const profile = profiles?.[0];
  if (!profile) {
    logStructured({ phase: "error", message: "profile_not_found", profileId });
    return { ok: false, reason: "profile_not_found" };
  }

  const subscriptionContext = {
    membershipCategory: data?.membershipCategory || null,
    subscriptionStatus: "Cancelled",
    endDate: data?.cancelledAt || null,
    cancellation: { dateCancelled: data?.cancelledAt || null, reason: "Graduated" },
  };

  const mergeMap = await buildBookmarkMergeMap({
    profile,
    subscription: subscriptionContext,
  });

  const templateBuffer = await getOneDriveFile(letterTemplate.fileId);
  const mergedDoc = mergeTemplate(templateBuffer, mergeMap);
  const fileName = `graduation-congratulations-${profile.membershipNumber || profileId}.docx`;
  const blobPath = `${tenantId}/${profileId}/${fileName}`;

  await uploadLetter(
    blobPath,
    mergedDoc,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );

  const letterRecord = await GeneratedLetter.create({
    memberId: profileId,
    profileId,
    templateId: String(letterTemplate._id),
    templateName: letterTemplate.name,
    fileName,
    blobPath,
    contentType: "docx",
    tenantId,
    createdBy: "system@undergraduate-graduation-comms",
    source: UGRAD_GRADUATION_LETTER_SOURCE,
    sourceKey: letterIdempotency,
    displayName: "Graduation Congratulations Letter",
    subscriptionId,
  });

  const letterId = String(letterRecord._id);
  const attachmentMeta = {
    filename: fileName,
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    letterId,
    blobPath,
    hasData: false,
  };

  await recordOutbound({
    tenantId,
    profileId,
    channel: "letter",
    templateKey: UGRAD_GRADUATION_LETTER_SOURCE,
    status: "sent",
    idempotencyKey: letterIdempotency,
    letterId,
    sourceBatchKey: dedupeKey,
  });

  const sharedMetadata = {
    type: "UNDERGRADUATE_GRADUATION_MEMBERSHIP_ENDED",
    subscriptionId,
    profileId,
    memberId: data?.memberId || profile.membershipNumber || null,
    dedupeKey,
    letterId,
    attachments: [attachmentMeta],
  };

  if (userId) {
    const inAppResult = await publishMemberNotification({
      tenantId,
      userId,
      title,
      body,
      correlationId: `${correlationId}-in-app`,
      metadata: {
        ...sharedMetadata,
        channel: "in_app",
        deliverPush: true,
      },
    });

    await recordOutbound({
      tenantId,
      profileId,
      channel: "in_app",
      templateKey: UGRAD_GRADUATION_LETTER_SOURCE,
      status: inAppResult?.success ? "sent" : "failed",
      idempotencyKey: `${dedupeKey}:in_app`,
      letterId,
      error: inAppResult?.success ? null : inAppResult?.error || "publish_failed",
      sourceBatchKey: dedupeKey,
    });
  }

  const toEmail = pickEmail(profile);
  let emailStatus = "skipped";
  let emailError = null;
  let providerMessageId = null;

  if (toEmail) {
    const emailTemplate = await resolveTemplate({
      tenantId,
      templateIdEnv: process.env.UGRAD_GRADUATION_EMAIL_TEMPLATE_ID,
      name: UGRAD_GRADUATION_EMAIL_TEMPLATE_NAME,
      typeFilter: "email",
    });

    let subject = DEFAULT_GRADUATION_EMAIL_SUBJECT;
    let htmlBody = DEFAULT_GRADUATION_EMAIL_HTML;
    if (emailTemplate && isEmailTemplateType(emailTemplate)) {
      const applied = applyTemplate(emailTemplate, mergeMap);
      subject = applied.subject || subject;
      htmlBody = applied.html || htmlBody;
    } else {
      const applied = applyTemplate(
        { subject, htmlBody, textBody: "" },
        mergeMap
      );
      subject = applied.subject;
      htmlBody = applied.html;
    }

    try {
      const fromAddress =
        process.env.SES_FROM_ADDRESS ||
        process.env.UGRAD_GRADUATION_EMAIL_FROM ||
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
            contentType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            contentBase64: mergedDoc.toString("base64"),
          },
        ],
        tags: {
          tenantId,
          profileId,
          source: UGRAD_GRADUATION_LETTER_SOURCE,
        },
      });
      emailStatus = "sent";
      providerMessageId = messageId;
    } catch (err) {
      emailStatus = "failed";
      emailError = err.message;
      logStructured({
        phase: "error",
        message: "email_send_failed",
        profileId,
        error: err.message,
      });
    }

    await recordOutbound({
      tenantId,
      profileId,
      channel: "email",
      templateKey: UGRAD_GRADUATION_LETTER_SOURCE,
      status: emailStatus,
      idempotencyKey: `${dedupeKey}:email`,
      letterId,
      providerMessageId,
      error: emailError,
      sourceBatchKey: dedupeKey,
    });

    if (userId) {
      await publishMemberNotification({
        tenantId,
        userId,
        title: subject,
        body,
        correlationId: `${correlationId}-email`,
        metadata: {
          ...sharedMetadata,
          channel: "email",
          deliverPush: false,
          emailTo: toEmail,
          emailStatus,
        },
      });
    }
  } else {
    logStructured({
      phase: "skipped",
      message: "no_email_on_profile",
      profileId,
    });
  }

  logStructured({
    phase: "completed",
    profileId,
    letterId,
    emailStatus,
    hasUserId: Boolean(userId),
  });

  return {
    ok: true,
    letterId,
    downloadUrl: generateDownloadUrl(blobPath),
    emailStatus,
  };
}
