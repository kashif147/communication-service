#!/usr/bin/env node

/**
 * Seeds the default Undergraduate Graduation email template (SES HTML).
 * Upload the Word letter template separately via CRM → Templates:
 *   category: "Undergraduate Graduation"
 *   name: "Graduation Congratulations Letter"
 *
 * Usage:
 *   TENANT_ID=your-tenant node scripts/seed-ugrad-graduation-email-template.js
 */
import dotenvFlow from "dotenv-flow";
dotenvFlow.config({ node_env: process.env.NODE_ENV || "staging" });

import { connectDB, disconnectDB } from "../config/db.js";
import Template from "../model/template.model.js";
import {
  UGRAD_GRADUATION_TEMPLATE_CATEGORY,
  UGRAD_GRADUATION_EMAIL_TEMPLATE_NAME,
  DEFAULT_GRADUATION_EMAIL_SUBJECT,
  DEFAULT_GRADUATION_EMAIL_HTML,
} from "../constants/undergraduateGraduation.constants.js";

const tenantId =
  process.env.TENANT_ID ||
  process.env.DEFAULT_TENANT_ID ||
  process.env.UGRAD_GRADUATION_TENANT_ID;

async function main() {
  if (!tenantId) {
    console.error("Set TENANT_ID (or DEFAULT_TENANT_ID) for the email template tenant.");
    process.exit(1);
  }

  await connectDB();

  const existing = await Template.findOne({
    tenantId,
    name: UGRAD_GRADUATION_EMAIL_TEMPLATE_NAME,
    category: UGRAD_GRADUATION_TEMPLATE_CATEGORY,
    tempolateType: "Email",
  });

  if (existing) {
    existing.subject = DEFAULT_GRADUATION_EMAIL_SUBJECT;
    existing.htmlBody = DEFAULT_GRADUATION_EMAIL_HTML;
    existing.textBody =
      "Congratulations on reaching your graduation date. Your Undergraduate Student membership has now ended. We invite you to join as a full member.";
    existing.placeholders = ["forename", "surname", "fullName", "membershipNumber", "graduationDate"];
    await existing.save();
    console.log(`Updated email template ${existing._id}`);
  } else {
    const created = await Template.create({
      tenantId,
      name: UGRAD_GRADUATION_EMAIL_TEMPLATE_NAME,
      description:
        "Transactional email sent with graduation congratulations letter attachment",
      category: UGRAD_GRADUATION_TEMPLATE_CATEGORY,
      tempolateType: "Email",
      subject: DEFAULT_GRADUATION_EMAIL_SUBJECT,
      htmlBody: DEFAULT_GRADUATION_EMAIL_HTML,
      textBody:
        "Congratulations on reaching your graduation date. Your Undergraduate Student membership has now ended. We invite you to join as a full member.",
      placeholders: ["forename", "surname", "fullName", "membershipNumber", "graduationDate"],
      createdBy: "seed-ugrad-graduation-email-template",
    });
    console.log(`Created email template ${created._id}`);
  }

  console.log("\nNext steps:");
  console.log("1. Upload Word letter template in CRM with:");
  console.log(`   category: "${UGRAD_GRADUATION_TEMPLATE_CATEGORY}"`);
  console.log(`   name: "${process.env.UGRAD_GRADUATION_LETTER_TEMPLATE_NAME || "Graduation Congratulations Letter"}"`);
  console.log("2. Optional env overrides:");
  console.log("   UGRAD_GRADUATION_LETTER_TEMPLATE_ID");
  console.log("   UGRAD_GRADUATION_EMAIL_TEMPLATE_ID");
  console.log("   SES_FROM_ADDRESS");

  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
