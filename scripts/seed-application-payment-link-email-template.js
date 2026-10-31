#!/usr/bin/env node

/**
 * Seeds the application payment-link email template (SES HTML), idempotent upsert-by-name,
 * category "applications". Consumed by services/paymentLinkComms.service.js via
 * rabbitMQ/listeners/paymentLinkComms.listener.js (applications.payment-link.email.requested.v1).
 * Optional: without it the service falls back to the defaults in
 * constants/paymentLinkComms.constants.js.
 *
 * Usage:
 *   TENANT_ID=your-tenant node scripts/seed-application-payment-link-email-template.js
 */
import dotenvFlow from "dotenv-flow";
dotenvFlow.config({ node_env: process.env.NODE_ENV || "staging" });

import { connectDB, disconnectDB } from "../config/db.js";
import Template from "../model/template.model.js";
import {
  PAYMENT_LINK_TEMPLATE_CATEGORY,
  PAYMENT_LINK_EMAIL_TEMPLATE_NAME,
  DEFAULT_PAYMENT_LINK_SUBJECT,
  DEFAULT_PAYMENT_LINK_HTML,
  DEFAULT_PAYMENT_LINK_TEXT,
} from "../constants/paymentLinkComms.constants.js";

const tenantId = process.env.TENANT_ID || process.env.DEFAULT_TENANT_ID;

const DEF = {
  name: PAYMENT_LINK_EMAIL_TEMPLATE_NAME,
  description:
    "Sent to an applicant with the Stripe Checkout link for their membership payment (payment link ISSUE/REPLACE/RESEND).",
  subject: DEFAULT_PAYMENT_LINK_SUBJECT,
  htmlBody: DEFAULT_PAYMENT_LINK_HTML,
  textBody: DEFAULT_PAYMENT_LINK_TEXT,
  placeholders: ["recipientName", "amount", "paymentDescription", "checkoutUrl", "expiresAt"],
};

async function main() {
  if (!tenantId) {
    console.error("Set TENANT_ID (or DEFAULT_TENANT_ID) for the email template tenant.");
    process.exit(1);
  }

  await connectDB();

  const existing = await Template.findOne({
    tenantId,
    name: DEF.name,
    category: PAYMENT_LINK_TEMPLATE_CATEGORY,
  });

  if (existing) {
    existing.description = DEF.description;
    existing.subject = DEF.subject;
    existing.htmlBody = DEF.htmlBody;
    existing.textBody = DEF.textBody;
    existing.placeholders = DEF.placeholders;
    existing.tempolateType = "Email";
    existing.fileId = null;
    await existing.save();
    console.log(`Updated email template "${DEF.name}" (${existing._id})`);
  } else {
    const created = await Template.create({
      tenantId,
      ...DEF,
      category: PAYMENT_LINK_TEMPLATE_CATEGORY,
      tempolateType: "Email",
      fileId: null,
      createdBy: "seed-application-payment-link-email-template",
    });
    console.log(`Created email template "${DEF.name}" (${created._id})`);
  }

  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
