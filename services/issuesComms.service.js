import Template from "../model/template.model.js";
import OutboundCommunication from "../model/outboundCommunication.model.js";
import { sendSesMessage } from "./ses.service.js";
import { applyTemplate, pickEmail } from "./personalization.service.js";
import { fetchProfilesBatch } from "./profileBatch.service.js";
import {
  getUsersByRoleCodes,
  getUserById,
  userDisplayName,
  userEmail,
} from "./userService.client.js";
import {
  ISSUES_TEMPLATE_CATEGORY,
  ISSUES_SOURCE,
  ISSUE_IR_REFERRED_EMAIL_TEMPLATE_NAME,
  ISSUE_IR_OUTCOME_RECEIVED_EMAIL_TEMPLATE_NAME,
  ISSUE_DUEDATE_APPROACHING_EMAIL_TEMPLATE_NAME,
  ISSUE_MEMBER_ACK_EMAIL_TEMPLATE_NAME,
  DEFAULT_ISSUE_IR_REFERRED_SUBJECT,
  DEFAULT_ISSUE_IR_REFERRED_HTML,
  DEFAULT_ISSUE_IR_REFERRED_TEXT,
  DEFAULT_ISSUE_IR_OUTCOME_RECEIVED_SUBJECT,
  DEFAULT_ISSUE_IR_OUTCOME_RECEIVED_HTML,
  DEFAULT_ISSUE_IR_OUTCOME_RECEIVED_TEXT,
  DEFAULT_ISSUE_DUEDATE_APPROACHING_SUBJECT,
  DEFAULT_ISSUE_DUEDATE_APPROACHING_HTML,
  DEFAULT_ISSUE_DUEDATE_APPROACHING_TEXT,
  DEFAULT_ISSUE_MEMBER_ACK_SUBJECT,
  DEFAULT_ISSUE_MEMBER_ACK_HTML,
  DEFAULT_ISSUE_MEMBER_ACK_TEXT,
  ROLE_CODES_ASSISTANT_DIRECTOR_IR,
  ROLE_CODES_HEAD_OF_INFORMATION,
  ROLE_CODES_HEAD_OF_INDUSTRIAL_RELATIONS,
} from "../constants/issuesComms.constants.js";
import logger from "../config/logger.js";

async function resolveTemplate({ tenantId, name }) {
  return Template.findOne({
    tenantId,
    name,
    category: ISSUES_TEMPLATE_CATEGORY,
    tempolateType: { $regex: /^email$/i },
  })
    .sort({ updatedAt: -1 })
    .lean();
}

async function recordOutbound({
  tenantId,
  profileId,
  templateKey,
  idempotencyKey,
  status,
  providerMessageId,
  error,
}) {
  return OutboundCommunication.findOneAndUpdate(
    { tenantId, idempotencyKey },
    {
      $setOnInsert: {
        tenantId,
        profileId,
        channel: "email",
        templateKey,
        sourceBatchKey: ISSUES_SOURCE,
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

/**
 * Sends one email and records it in OutboundCommunication, deduped by idempotencyKey (so
 * RabbitMQ redelivery of the same event doesn't double-send - same convention as
 * gapLetterComms.service.js / eventRegistrationComms.service.js). `profileId` is the
 * OutboundCommunication schema's required tracking field; for these recipients (officials,
 * not necessarily linked members) it's set to the resolved recipient's userId, not a
 * profile-service Profile id.
 */
async function sendIssueEmailToRecipient({
  tenantId,
  toEmail,
  subject,
  htmlBody,
  textBody,
  templateKey,
  idempotencyKey,
  profileId,
  tags,
}) {
  if (!toEmail) {
    await recordOutbound({
      tenantId,
      profileId,
      templateKey,
      idempotencyKey,
      status: "skipped",
      error: "No recipient email available",
    });
    return { ok: true, status: "skipped" };
  }

  try {
    const result = await sendSesMessage({ toAddress: toEmail, subject, htmlBody, textBody, tags });
    await recordOutbound({
      tenantId,
      profileId,
      templateKey,
      idempotencyKey,
      status: "sent",
      providerMessageId: result?.messageId || null,
    });
    return { ok: true, status: "sent" };
  } catch (err) {
    logger.error(
      { err: err.message, toEmail, templateKey, idempotencyKey },
      "issuesComms: send failed",
    );
    await recordOutbound({
      tenantId,
      profileId,
      templateKey,
      idempotencyKey,
      status: "failed",
      error: err.message,
    });
    return { ok: false, status: "failed", error: err.message };
  }
}

/**
 * #1 - issues.ir.referred.v1: IR issue's referredToThirdParty flips false -> true.
 * Recipient: Assistant Director of IR for the owning team (role code ADIR).
 */
export async function handleIrReferred(payload) {
  const data = payload?.data || payload;
  const { tenantId, issueId, caseFileNumber } = data || {};
  if (!tenantId || !issueId) {
    logger.warn({ data }, "issuesComms: ir-referred missing tenantId/issueId, skipping");
    return { ok: false, reason: "missing_tenant_or_issue" };
  }

  const recipients = await getUsersByRoleCodes(ROLE_CODES_ASSISTANT_DIRECTOR_IR, tenantId);
  const template = await resolveTemplate({ tenantId, name: ISSUE_IR_REFERRED_EMAIL_TEMPLATE_NAME });
  const mergeMap = { caseFileNumber: caseFileNumber || issueId };
  const { subject, html: htmlBody, text: textBody } = applyTemplate(
    {
      subject: template?.subject || DEFAULT_ISSUE_IR_REFERRED_SUBJECT,
      htmlBody: template?.htmlBody || DEFAULT_ISSUE_IR_REFERRED_HTML,
      textBody: template?.textBody || DEFAULT_ISSUE_IR_REFERRED_TEXT,
    },
    mergeMap,
  );

  if (!recipients.length) {
    logger.warn(
      { tenantId, issueId },
      "issuesComms: ir-referred - no Assistant Director of IR recipients resolved",
    );
    await recordOutbound({
      tenantId,
      profileId: `issue:${issueId}`,
      templateKey: ISSUE_IR_REFERRED_EMAIL_TEMPLATE_NAME,
      idempotencyKey: `${ISSUES_SOURCE}:ir-referred:${issueId}:no-recipient`,
      status: "skipped",
      error: "No Assistant Director of IR recipients resolved",
    });
    return { ok: true, recipientCount: 0 };
  }

  const results = [];
  for (const user of recipients) {
    results.push(
      await sendIssueEmailToRecipient({
        tenantId,
        toEmail: userEmail(user),
        subject,
        htmlBody,
        textBody,
        templateKey: ISSUE_IR_REFERRED_EMAIL_TEMPLATE_NAME,
        idempotencyKey: `${ISSUES_SOURCE}:ir-referred:${issueId}:${user._id}`,
        profileId: String(user._id),
        tags: { source: ISSUES_SOURCE, issueId, event: "ir_referred" },
      }),
    );
  }
  return { ok: true, recipientCount: recipients.length, results };
}

/**
 * #2 - issues.ir.outcome.received.v1: outcomeReceivedFromThirdParty flips false -> true.
 * Recipients: Assistant Director of IR (ADIR) + Head of Information (IO, closest-but-inexact
 * match) + Head of Industrial Relations (DIR, closest-but-inexact match) — see
 * constants/issuesComms.constants.js for the role-code mapping caveat.
 */
export async function handleIrOutcomeReceived(payload) {
  const data = payload?.data || payload;
  const { tenantId, issueId, caseFileNumber } = data || {};
  if (!tenantId || !issueId) {
    logger.warn({ data }, "issuesComms: ir-outcome-received missing tenantId/issueId, skipping");
    return { ok: false, reason: "missing_tenant_or_issue" };
  }

  const roleCodes = [
    ...ROLE_CODES_ASSISTANT_DIRECTOR_IR,
    ...ROLE_CODES_HEAD_OF_INFORMATION,
    ...ROLE_CODES_HEAD_OF_INDUSTRIAL_RELATIONS,
  ];
  const recipients = await getUsersByRoleCodes(roleCodes, tenantId);
  const template = await resolveTemplate({
    tenantId,
    name: ISSUE_IR_OUTCOME_RECEIVED_EMAIL_TEMPLATE_NAME,
  });
  const mergeMap = { caseFileNumber: caseFileNumber || issueId };
  const { subject, html: htmlBody, text: textBody } = applyTemplate(
    {
      subject: template?.subject || DEFAULT_ISSUE_IR_OUTCOME_RECEIVED_SUBJECT,
      htmlBody: template?.htmlBody || DEFAULT_ISSUE_IR_OUTCOME_RECEIVED_HTML,
      textBody: template?.textBody || DEFAULT_ISSUE_IR_OUTCOME_RECEIVED_TEXT,
    },
    mergeMap,
  );

  if (!recipients.length) {
    logger.warn(
      { tenantId, issueId },
      "issuesComms: ir-outcome-received - no recipients resolved (ADIR/IO/DIR)",
    );
    await recordOutbound({
      tenantId,
      profileId: `issue:${issueId}`,
      templateKey: ISSUE_IR_OUTCOME_RECEIVED_EMAIL_TEMPLATE_NAME,
      idempotencyKey: `${ISSUES_SOURCE}:ir-outcome:${issueId}:no-recipient`,
      status: "skipped",
      error: "No ADIR/IO/DIR recipients resolved",
    });
    return { ok: true, recipientCount: 0 };
  }

  const results = [];
  for (const user of recipients) {
    results.push(
      await sendIssueEmailToRecipient({
        tenantId,
        toEmail: userEmail(user),
        subject,
        htmlBody,
        textBody,
        templateKey: ISSUE_IR_OUTCOME_RECEIVED_EMAIL_TEMPLATE_NAME,
        idempotencyKey: `${ISSUES_SOURCE}:ir-outcome:${issueId}:${user._id}`,
        profileId: String(user._id),
        tags: { source: ISSUES_SOURCE, issueId, event: "ir_outcome_received" },
      }),
    );
  }
  return { ok: true, recipientCount: recipients.length, results };
}

/**
 * #3 - issues.duedate.approaching.v1. Recipient: PA of the assigned IRO (`iroPaUserId`),
 * falling back to the IRO/owner (`ownerUserId`) — issue-service's own scheduler already
 * resolves that fallback before publishing (plan §1.4), so this just prefers
 * `iroPaUserId` when present.
 */
export async function handleDueDateApproaching(payload) {
  const data = payload?.data || payload;
  const { tenantId, issueId, ownerUserId, iroPaUserId } = data || {};
  if (!tenantId || !issueId) {
    logger.warn({ data }, "issuesComms: duedate-approaching missing tenantId/issueId, skipping");
    return { ok: false, reason: "missing_tenant_or_issue" };
  }

  const recipientUserId = iroPaUserId || ownerUserId;
  if (!recipientUserId) {
    logger.warn(
      { tenantId, issueId },
      "issuesComms: duedate-approaching - no iroPaUserId/ownerUserId on payload, skipping",
    );
    await recordOutbound({
      tenantId,
      profileId: `issue:${issueId}`,
      templateKey: ISSUE_DUEDATE_APPROACHING_EMAIL_TEMPLATE_NAME,
      idempotencyKey: `${ISSUES_SOURCE}:duedate:${issueId}:no-recipient`,
      status: "skipped",
      error: "No iroPaUserId/ownerUserId on payload",
    });
    return { ok: false, reason: "no_recipient" };
  }

  const user = await getUserById(recipientUserId, tenantId);
  const template = await resolveTemplate({
    tenantId,
    name: ISSUE_DUEDATE_APPROACHING_EMAIL_TEMPLATE_NAME,
  });
  // GAP: issues.duedate.approaching.v1's payload (issue-service's
  // rabbitMQ/publishers/issue.events.publisher.js) carries issueId/dueDate/ownerUserId/
  // iroPaUserId only — no caseFileNumber/internalReferenceNumber, even though the doc's
  // wording ("...in respect of (case number)...") implies one. Falling back to the raw
  // issueId for {{caseFileNumber}} here; the doc-accurate fix is adding the case/reference
  // number to that publisher's payload on the issue-service side (different repo, out of
  // scope for this task) — flagged in the implementation report.
  const mergeMap = {
    userName: userDisplayName(user) || recipientUserId,
    caseFileNumber: issueId,
  };
  const { subject, html: htmlBody, text: textBody } = applyTemplate(
    {
      subject: template?.subject || DEFAULT_ISSUE_DUEDATE_APPROACHING_SUBJECT,
      htmlBody: template?.htmlBody || DEFAULT_ISSUE_DUEDATE_APPROACHING_HTML,
      textBody: template?.textBody || DEFAULT_ISSUE_DUEDATE_APPROACHING_TEXT,
    },
    mergeMap,
  );

  const result = await sendIssueEmailToRecipient({
    tenantId,
    toEmail: userEmail(user),
    subject,
    htmlBody,
    textBody,
    templateKey: ISSUE_DUEDATE_APPROACHING_EMAIL_TEMPLATE_NAME,
    idempotencyKey: `${ISSUES_SOURCE}:duedate:${issueId}:${recipientUserId}`,
    profileId: String(recipientUserId),
    tags: { source: ISSUES_SOURCE, issueId, event: "duedate_approaching" },
  });
  return { ok: result.ok, recipientUserId, ...result };
}

/**
 * #4 - issues.issue.created.v1, filtered to issueSource === "MEMBER" (this event fires for
 * every issue creation, not just member-sourced ones - filter lives here, not upstream).
 * Recipient: the member, resolved via memberIds[0] -> profile-service.
 */
export async function handleIssueCreated(payload) {
  const data = payload?.data || payload;
  const { tenantId, issueId, issueSource, memberIds } = data || {};

  if (String(issueSource || "").toUpperCase() !== "MEMBER") {
    return { ok: true, skipped: true, reason: "issueSource_not_member" };
  }
  if (!tenantId || !issueId) {
    logger.warn({ data }, "issuesComms: issue-created(member) missing tenantId/issueId, skipping");
    return { ok: false, reason: "missing_tenant_or_issue" };
  }

  const memberId = Array.isArray(memberIds) ? memberIds[0] : null;
  if (!memberId) {
    logger.warn(
      { tenantId, issueId },
      "issuesComms: issue-created(member) - no memberIds on payload, skipping",
    );
    await recordOutbound({
      tenantId,
      profileId: `issue:${issueId}`,
      templateKey: ISSUE_MEMBER_ACK_EMAIL_TEMPLATE_NAME,
      idempotencyKey: `${ISSUES_SOURCE}:member-ack:${issueId}:no-member`,
      status: "skipped",
      error: "No memberIds on payload",
    });
    return { ok: false, reason: "no_member" };
  }

  let profile = null;
  try {
    const profiles = await fetchProfilesBatch({ profileIds: [memberId], tenantId });
    profile = profiles?.[0] || null;
  } catch (err) {
    logger.warn(
      { err: err.message, memberId, tenantId },
      "issuesComms: profile fetch failed for member acknowledgement email",
    );
  }

  const toEmail = pickEmail(profile) || null;
  const pi = profile?.personalInfo || {};
  const memberName =
    pi.fullName || [pi.forename, pi.surname].filter(Boolean).join(" ").trim() || null;

  const template = await resolveTemplate({ tenantId, name: ISSUE_MEMBER_ACK_EMAIL_TEMPLATE_NAME });
  const mergeMap = { memberName: memberName || "Member" };
  const { subject, html: htmlBody, text: textBody } = applyTemplate(
    {
      subject: template?.subject || DEFAULT_ISSUE_MEMBER_ACK_SUBJECT,
      htmlBody: template?.htmlBody || DEFAULT_ISSUE_MEMBER_ACK_HTML,
      textBody: template?.textBody || DEFAULT_ISSUE_MEMBER_ACK_TEXT,
    },
    mergeMap,
  );

  const result = await sendIssueEmailToRecipient({
    tenantId,
    toEmail,
    subject,
    htmlBody,
    textBody,
    templateKey: ISSUE_MEMBER_ACK_EMAIL_TEMPLATE_NAME,
    idempotencyKey: `${ISSUES_SOURCE}:member-ack:${issueId}`,
    profileId: String(memberId),
    tags: { source: ISSUES_SOURCE, issueId, event: "member_ack" },
  });
  return { ok: result.ok, memberId, ...result };
}
