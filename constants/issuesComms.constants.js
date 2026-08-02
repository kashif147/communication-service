// Issue Management email templates — communication-service side of the RabbitMQ contract
// published by issue-service's rabbitMQ/publishers/issue.events.publisher.js on the
// "issues.events" exchange (see docs/Issue Management Requirements.docx, "Email
// Notification based on Third Party" / "Due Date Notification" / "Member Notification"
// sections, and we-need-to-implement-hidden-ocean.md §3.5).
//
// Template docs are seeded via scripts/seed-issue-management-email-templates.js, category
// "issues", tempolateType "Email" (keep the schema's typo'd field name as-is).

export const ISSUES_TEMPLATE_CATEGORY = "issues";

export const ISSUES_SOURCE = "issue_management";

export const ISSUE_IR_REFERRED_EMAIL_TEMPLATE_NAME =
  process.env.ISSUE_IR_REFERRED_EMAIL_TEMPLATE_NAME ||
  "Issue IR Referred To Third Party Email";

export const ISSUE_IR_OUTCOME_RECEIVED_EMAIL_TEMPLATE_NAME =
  process.env.ISSUE_IR_OUTCOME_RECEIVED_EMAIL_TEMPLATE_NAME ||
  "Issue IR Outcome Received Email";

export const ISSUE_DUEDATE_APPROACHING_EMAIL_TEMPLATE_NAME =
  process.env.ISSUE_DUEDATE_APPROACHING_EMAIL_TEMPLATE_NAME ||
  "Issue Due Date Approaching Email";

export const ISSUE_MEMBER_ACK_EMAIL_TEMPLATE_NAME =
  process.env.ISSUE_MEMBER_ACK_EMAIL_TEMPLATE_NAME ||
  "Issue Member Acknowledgement Email";

// Exact subject/body wording from the requirements doc (typos "Datbase"/"Dar User"
// corrected to "Database"/"Dear User" per the approved plan). Doc gives no explicit subject
// line for the due-date or member-acknowledgement emails — the two "reasonable" subjects
// below are an authoring assumption, not doc text; flagged in the implementation report.

export const DEFAULT_ISSUE_IR_REFERRED_SUBJECT =
  "Case Referral regarding current issue record";
export const DEFAULT_ISSUE_IR_REFERRED_HTML =
  "<p>Dear User,</p>" +
  "<p>Please note that the following case has been referred to third party, case file number: {{caseFileNumber}}</p>" +
  "<p>Kind regards,<br/>Database Administrator</p>";
export const DEFAULT_ISSUE_IR_REFERRED_TEXT =
  "Dear User,\n\n" +
  "Please note that the following case has been referred to third party, case file number: {{caseFileNumber}}\n\n" +
  "Kind regards,\nDatabase Administrator";

export const DEFAULT_ISSUE_IR_OUTCOME_RECEIVED_SUBJECT =
  "Outcome received from third party regarding current issue record";
export const DEFAULT_ISSUE_IR_OUTCOME_RECEIVED_HTML =
  "<p>Dear User,</p>" +
  "<p>Please note that an outcome has been received from a third party in respect of the following case. Case file number: {{caseFileNumber}}</p>" +
  "<p>Kind regards,<br/>Database Administrator</p>";
export const DEFAULT_ISSUE_IR_OUTCOME_RECEIVED_TEXT =
  "Dear User,\n\n" +
  "Please note that an outcome has been received from a third party in respect of the following case. Case file number: {{caseFileNumber}}\n\n" +
  "Kind regards,\nDatabase Administrator";

export const DEFAULT_ISSUE_DUEDATE_APPROACHING_SUBJECT = "Deadline Approaching";
export const DEFAULT_ISSUE_DUEDATE_APPROACHING_HTML =
  "<p>Dear {{userName}},</p>" +
  "<p>Please note that the deadline that you have set in respect of {{caseFileNumber}} expires in one week.</p>" +
  "<p>Regards,<br/>INMO team</p>";
export const DEFAULT_ISSUE_DUEDATE_APPROACHING_TEXT =
  "Dear {{userName}},\n\n" +
  "Please note that the deadline that you have set in respect of {{caseFileNumber}} expires in one week.\n\n" +
  "Regards,\nINMO team";

export const DEFAULT_ISSUE_MEMBER_ACK_SUBJECT = "We've received your query";
export const DEFAULT_ISSUE_MEMBER_ACK_HTML =
  "<p>Dear {{memberName}},</p>" +
  "<p>We acknowledge receipt of your query. This will be forwarded to the appropriate INMO department for a response.</p>" +
  "<p>Kind regards,<br/>INMO team</p>";
export const DEFAULT_ISSUE_MEMBER_ACK_TEXT =
  "Dear {{memberName}},\n\n" +
  "We acknowledge receipt of your query. This will be forwarded to the appropriate INMO department for a response.\n\n" +
  "Kind regards,\nINMO team";

// Role codes used for #1/#2 recipient resolution (Assistant Director of IR / Head of
// Information / Head of Industrial Relations). Per user-service/scripts/
// grant-issues-permissions-to-roles.js's own live-catalog inspection: only ADIR
// ("Assistant Director of IR") is an exact match. DIR and IO are the closest-but-inexact
// stand-ins for "Head of Information" and "Head of Industrial Relations" — no roles with
// those literal titles exist in the seeded catalog. This mapping is a data/config
// assumption, not a verified 1:1 business mapping — see the implementation report.
export const ROLE_CODES_ASSISTANT_DIRECTOR_IR = ["ADIR"];
export const ROLE_CODES_HEAD_OF_INFORMATION = ["IO"];
export const ROLE_CODES_HEAD_OF_INDUSTRIAL_RELATIONS = ["DIR"];
