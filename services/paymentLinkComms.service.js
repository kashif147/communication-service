import Template from "../model/template.model.js";
import OutboundCommunication from "../model/outboundCommunication.model.js";
import { sendSesMessage } from "./ses.service.js";
import { applyTemplate } from "./personalization.service.js";
import {
  PAYMENT_LINK_TEMPLATE_CODE,
  PAYMENT_LINK_TEMPLATE_CATEGORY,
  PAYMENT_LINK_SOURCE,
  PAYMENT_LINK_EMAIL_TEMPLATE_NAME,
  PAYMENT_LINK_ALLOWED_HOSTS,
  PAYMENT_LINK_TIMEZONE,
  PAYMENT_OPTION_LABELS,
  DEFAULT_PAYMENT_LINK_SUBJECT,
  DEFAULT_PAYMENT_LINK_HTML,
  DEFAULT_PAYMENT_LINK_TEXT,
} from "../constants/paymentLinkComms.constants.js";
import logger from "../config/logger.js";

let sendFn = null;
/** Test seam: replace the SES sender. */
export function setPaymentLinkMailer(fn) {
  sendFn = fn;
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A checkout URL must be https on an allowed (Stripe) host; anything else is never mailed. */
export function isAllowedCheckoutUrl(raw, allowedHosts = PAYMENT_LINK_ALLOWED_HOSTS) {
  if (typeof raw !== "string" || !raw) return false;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    allowedHosts.includes(u.hostname.toLowerCase())
  );
}

/** Minor units -> "€299.00". */
export function formatAmount(amount, currency) {
  const n = Number(amount);
  const cur = String(currency || "eur").toUpperCase();
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: cur }).format(n / 100);
  } catch {
    return `${(n / 100).toFixed(2)} ${cur}`;
  }
}

export function formatExpiry(expiresAt, timeZone = PAYMENT_LINK_TIMEZONE) {
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return "";
  const opts = { dateStyle: "long", timeStyle: "short" };
  try {
    return new Intl.DateTimeFormat("en-IE", { ...opts, timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-IE", { ...opts, timeZone: "Europe/Dublin" }).format(d);
  }
}

/**
 * Pure render: subject/text get raw values, the HTML body gets HTML-escaped values
 * (applyTemplate itself does not escape).
 */
export function renderPaymentLinkEmail(template, data) {
  const map = {
    recipientName: (data?.recipient?.name || "").trim() || "Applicant",
    amount: formatAmount(data?.amount, data?.currency),
    paymentDescription:
      PAYMENT_OPTION_LABELS[data?.paymentOption] || PAYMENT_OPTION_LABELS.FULL,
    checkoutUrl: data?.checkoutUrl || "",
    expiresAt: formatExpiry(data?.expiresAt),
  };
  const htmlMap = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, escapeHtml(v)]));
  const src = {
    subject: template?.subject || DEFAULT_PAYMENT_LINK_SUBJECT,
    htmlBody: template?.htmlBody || DEFAULT_PAYMENT_LINK_HTML,
    textBody: template?.textBody || DEFAULT_PAYMENT_LINK_TEXT,
  };
  const { subject, text } = applyTemplate({ subject: src.subject, textBody: src.textBody }, map);
  const { html } = applyTemplate({ htmlBody: src.htmlBody }, htmlMap);
  return { subject: subject.replace(/[\r\n]+/g, " ").trim(), html, text };
}

async function resolveTemplate(tenantId) {
  return Template.findOne({
    tenantId,
    name: PAYMENT_LINK_EMAIL_TEMPLATE_NAME,
    category: PAYMENT_LINK_TEMPLATE_CATEGORY,
    tempolateType: { $regex: /^email$/i },
  })
    .sort({ updatedAt: -1 })
    .lean();
}

async function recordOutbound({ tenantId, applicationId, idempotencyKey, status, providerMessageId, error }) {
  return OutboundCommunication.findOneAndUpdate(
    { tenantId, idempotencyKey },
    {
      $setOnInsert: {
        tenantId,
        profileId: `application:${applicationId}`,
        channel: "email",
        templateKey: PAYMENT_LINK_EMAIL_TEMPLATE_NAME,
        sourceBatchKey: PAYMENT_LINK_SOURCE,
      },
      $set: {
        status,
        providerMessageId: providerMessageId || null,
        error: error || null,
      },
    },
    { upsert: true, new: true }
  );
}

/**
 * applications.payment-link.email.requested.v1 -> one email to the recipient profile-service
 * resolved (it owns the contact data). Tenant comes from the event envelope only; a tenant in
 * `data` is never used. Deduped per event on data.dedupeKey (each RESEND carries a new
 * `:email:{seq}` key, so a resend is a new email while a redelivery is not).
 *
 * Permanent problems (bad payload, unsafe URL, expired link, no address) are recorded and
 * acknowledged; an SES failure is recorded and rethrown so the consumer retries.
 * Never logs the checkout URL or the recipient address.
 */
export async function processPaymentLinkEmail(payload, { now = new Date() } = {}) {
  const tenantId = typeof payload?.tenantId === "string" ? payload.tenantId.trim() : "";
  const data = payload?.data || {};
  const { applicationId, linkVersion, dedupeKey, templateCode } = data;
  const logCtx = { applicationId, linkVersion, dedupeKey, eventId: payload?.eventId };

  if (!tenantId) {
    logger.warn(logCtx, "paymentLinkComms: no envelope tenant; skipping");
    return { ok: false, reason: "missing_tenant" };
  }
  if (!applicationId || !dedupeKey) {
    logger.warn(logCtx, "paymentLinkComms: missing applicationId/dedupeKey; skipping");
    return { ok: false, reason: "invalid_payload" };
  }

  const idempotencyKey = `${PAYMENT_LINK_SOURCE}:${dedupeKey}`;
  const existing = await OutboundCommunication.findOne({ tenantId, idempotencyKey }).lean();
  if (existing && (existing.status === "sent" || existing.status === "skipped")) {
    logger.info({ ...logCtx, status: existing.status }, "paymentLinkComms: duplicate event; already handled");
    return { ok: true, duplicate: true, status: existing.status };
  }

  const skip = async (reason) => {
    logger.warn({ ...logCtx, reason }, "paymentLinkComms: email skipped");
    await recordOutbound({ tenantId, applicationId, idempotencyKey, status: "skipped", error: reason });
    return { ok: false, status: "skipped", reason };
  };

  if (templateCode && templateCode !== PAYMENT_LINK_TEMPLATE_CODE) return skip("unsupported_template_code");
  if (!isAllowedCheckoutUrl(data.checkoutUrl)) return skip("checkout_url_not_allowed");
  const expires = new Date(data.expiresAt);
  if (Number.isNaN(expires.getTime())) return skip("invalid_expiry");
  if (expires <= now) return skip("link_expired");
  const toAddress = typeof data.recipient?.email === "string" ? data.recipient.email.trim() : "";
  if (!EMAIL_RE.test(toAddress)) return skip("no_recipient_email");

  const template = await resolveTemplate(tenantId);
  const { subject, html, text } = renderPaymentLinkEmail(template, data);

  try {
    const send = sendFn || sendSesMessage;
    const result = await send({
      toAddress,
      subject,
      htmlBody: html,
      textBody: text,
      tags: { source: PAYMENT_LINK_SOURCE, event: "payment_link", linkVersion: String(linkVersion ?? "") },
    });
    await recordOutbound({
      tenantId,
      applicationId,
      idempotencyKey,
      status: "sent",
      providerMessageId: result?.messageId || null,
    });
    logger.info(logCtx, "paymentLinkComms: payment link email sent");
    return { ok: true, status: "sent" };
  } catch (err) {
    logger.error({ ...logCtx, err: err.message }, "paymentLinkComms: send failed");
    await recordOutbound({ tenantId, applicationId, idempotencyKey, status: "failed", error: err.message });
    throw err;
  }
}
