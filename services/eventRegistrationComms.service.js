import Template from "../model/template.model.js";
import OutboundCommunication from "../model/outboundCommunication.model.js";
import { sendSesMessage } from "./ses.service.js";
import { applyTemplate } from "./personalization.service.js";
import {
  EVENT_REGISTRATION_TEMPLATE_CATEGORY,
  EVENT_REGISTRATION_CONFIRMED_EMAIL_TEMPLATE_NAME,
  EVENT_REGISTRATION_CANCELLED_EMAIL_TEMPLATE_NAME,
  EVENT_REGISTRATION_SOURCE,
  DEFAULT_EVENT_REGISTRATION_CONFIRMED_SUBJECT,
  DEFAULT_EVENT_REGISTRATION_CONFIRMED_HTML,
  DEFAULT_EVENT_REGISTRATION_CANCELLED_SUBJECT,
  DEFAULT_EVENT_REGISTRATION_CANCELLED_HTML,
} from "../constants/eventRegistration.constants.js";
import logger from "../config/logger.js";

async function resolveEmailTemplate({ tenantId, name }) {
  return Template.findOne({
    tenantId,
    name,
    category: EVENT_REGISTRATION_TEMPLATE_CATEGORY,
    tempolateType: { $regex: /^email$/i },
  })
    .sort({ updatedAt: -1 })
    .lean();
}

async function recordOutbound({ tenantId, profileId, templateKey, idempotencyKey, status, providerMessageId, error }) {
  return OutboundCommunication.findOneAndUpdate(
    { tenantId, idempotencyKey },
    {
      $setOnInsert: {
        tenantId,
        profileId,
        channel: "email",
        templateKey,
        sourceBatchKey: EVENT_REGISTRATION_SOURCE,
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

async function sendEventRegistrationEmail({ data, templateName, defaultSubject, defaultHtml }) {
  const { tenantId, registrationId, profileId, attendeeSnapshot } = data;
  const email = attendeeSnapshot?.email;
  const idempotencyKey = `${EVENT_REGISTRATION_SOURCE}:${templateName}:${registrationId}`;

  if (!email) {
    logger.warn({ registrationId, tenantId }, "Event registration comms: no attendee email, skipping");
    return;
  }

  const template = await resolveEmailTemplate({ tenantId, name: templateName });
  const mergeMap = {
    firstName: attendeeSnapshot?.firstName || "",
    lastName: attendeeSnapshot?.lastName || "",
  };
  const { subject, html: htmlBody } = applyTemplate(
    {
      subject: template?.subject || defaultSubject,
      htmlBody: template?.htmlBody || defaultHtml,
    },
    mergeMap,
  );

  try {
    const result = await sendSesMessage({
      toAddress: email,
      subject,
      htmlBody,
      tags: { source: EVENT_REGISTRATION_SOURCE, registrationId },
    });
    await recordOutbound({
      tenantId,
      profileId,
      templateKey: templateName,
      idempotencyKey,
      status: "sent",
      providerMessageId: result?.MessageId || null,
    });
  } catch (err) {
    logger.error({ err: err.message, registrationId, tenantId }, "Failed to send event registration email");
    await recordOutbound({
      tenantId,
      profileId,
      templateKey: templateName,
      idempotencyKey,
      status: "failed",
      error: err.message,
    });
    throw err;
  }
}

export async function handleEventRegistrationConfirmedComms(data) {
  await sendEventRegistrationEmail({
    data,
    templateName: EVENT_REGISTRATION_CONFIRMED_EMAIL_TEMPLATE_NAME,
    defaultSubject: DEFAULT_EVENT_REGISTRATION_CONFIRMED_SUBJECT,
    defaultHtml: DEFAULT_EVENT_REGISTRATION_CONFIRMED_HTML,
  });
}

export async function handleEventRegistrationCancelledComms(data) {
  await sendEventRegistrationEmail({
    data,
    templateName: EVENT_REGISTRATION_CANCELLED_EMAIL_TEMPLATE_NAME,
    defaultSubject: DEFAULT_EVENT_REGISTRATION_CANCELLED_SUBJECT,
    defaultHtml: DEFAULT_EVENT_REGISTRATION_CANCELLED_HTML,
  });
}
