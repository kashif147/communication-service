#!/usr/bin/env node

/**
 * Seeds the 4 Issue Management email templates (SES HTML), idempotent upsert-by-name,
 * category "issues". Consumed by services/issuesComms.service.js via
 * rabbitMQ/listeners/issues.listener.js (issues.events exchange).
 *
 * Exact subject/body wording is from docs/Issue Management Requirements.docx's "Email
 * Notification based on Third Party" / "Due Date Notification" / "Member Notification"
 * sections (see constants/issuesComms.constants.js for the source-of-truth strings and the
 * doc-typo corrections/subject-line assumptions called out there).
 *
 * Usage:
 *   TENANT_ID=your-tenant node scripts/seed-issue-management-email-templates.js
 */
import dotenvFlow from "dotenv-flow";
dotenvFlow.config({ node_env: process.env.NODE_ENV || "staging" });

import { connectDB, disconnectDB } from "../config/db.js";
import Template from "../model/template.model.js";
import {
  ISSUES_TEMPLATE_CATEGORY,
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
} from "../constants/issuesComms.constants.js";

const tenantId =
  process.env.TENANT_ID ||
  process.env.DEFAULT_TENANT_ID ||
  process.env.ISSUES_TENANT_ID;

const TEMPLATES = [
  {
    name: ISSUE_IR_REFERRED_EMAIL_TEMPLATE_NAME,
    description:
      "Sent to the Assistant Director of IR when an IR issue is referred to a third party (referredToThirdParty false -> true).",
    subject: DEFAULT_ISSUE_IR_REFERRED_SUBJECT,
    htmlBody: DEFAULT_ISSUE_IR_REFERRED_HTML,
    textBody: DEFAULT_ISSUE_IR_REFERRED_TEXT,
    placeholders: ["caseFileNumber"],
  },
  {
    name: ISSUE_IR_OUTCOME_RECEIVED_EMAIL_TEMPLATE_NAME,
    description:
      "Sent to the Assistant Director of IR, Head of Information, and Head of Industrial Relations when a third-party outcome is received (outcomeReceivedFromThirdParty false -> true).",
    subject: DEFAULT_ISSUE_IR_OUTCOME_RECEIVED_SUBJECT,
    htmlBody: DEFAULT_ISSUE_IR_OUTCOME_RECEIVED_HTML,
    textBody: DEFAULT_ISSUE_IR_OUTCOME_RECEIVED_TEXT,
    placeholders: ["caseFileNumber"],
  },
  {
    name: ISSUE_DUEDATE_APPROACHING_EMAIL_TEMPLATE_NAME,
    description:
      "Sent to the PA of the assigned IRO (falls back to the IRO/owner) one week before an issue's due date.",
    subject: DEFAULT_ISSUE_DUEDATE_APPROACHING_SUBJECT,
    htmlBody: DEFAULT_ISSUE_DUEDATE_APPROACHING_HTML,
    textBody: DEFAULT_ISSUE_DUEDATE_APPROACHING_TEXT,
    placeholders: ["userName", "caseFileNumber"],
  },
  {
    name: ISSUE_MEMBER_ACK_EMAIL_TEMPLATE_NAME,
    description:
      "Sent to the member when an issue is logged with issueSource === \"MEMBER-IS\".",
    subject: DEFAULT_ISSUE_MEMBER_ACK_SUBJECT,
    htmlBody: DEFAULT_ISSUE_MEMBER_ACK_HTML,
    textBody: DEFAULT_ISSUE_MEMBER_ACK_TEXT,
    placeholders: ["memberName"],
  },
];

async function upsertTemplate(def) {
  const existing = await Template.findOne({
    tenantId,
    name: def.name,
    category: ISSUES_TEMPLATE_CATEGORY,
  });

  if (existing) {
    existing.description = def.description;
    existing.subject = def.subject;
    existing.htmlBody = def.htmlBody;
    existing.textBody = def.textBody;
    existing.placeholders = def.placeholders;
    existing.tempolateType = "Email";
    existing.fileId = null;
    await existing.save();
    console.log(`Updated email template "${def.name}" (${existing._id})`);
    return existing;
  }

  const created = await Template.create({
    tenantId,
    name: def.name,
    description: def.description,
    category: ISSUES_TEMPLATE_CATEGORY,
    tempolateType: "Email",
    fileId: null,
    subject: def.subject,
    htmlBody: def.htmlBody,
    textBody: def.textBody,
    placeholders: def.placeholders,
    createdBy: "seed-issue-management-email-templates",
  });
  console.log(`Created email template "${def.name}" (${created._id})`);
  return created;
}

async function main() {
  if (!tenantId) {
    console.error(
      "Set TENANT_ID (or DEFAULT_TENANT_ID/ISSUES_TENANT_ID) for the email template tenant."
    );
    process.exit(1);
  }

  await connectDB();

  for (const def of TEMPLATES) {
    await upsertTemplate(def);
  }

  console.log("\nDone. 4 Issue Management email templates seeded (category: issues).");
  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
