export const GAP_LETTER_TEMPLATE_CATEGORY = "GAP Letter";

export const GAP_LETTER_TEMPLATE_NAME =
  process.env.GAP_LETTER_TEMPLATE_NAME || "GAP Letter";

export const GAP_LETTER_EMAIL_TEMPLATE_NAME =
  process.env.GAP_LETTER_EMAIL_TEMPLATE_NAME || "GAP Letter Email";

export const GAP_LETTER_SOURCE = "gap_letter";

export const DEFAULT_GAP_LETTER_EMAIL_SUBJECT =
  "Your GAP Letter";

export const DEFAULT_GAP_LETTER_EMAIL_HTML = `<p>Dear {{forename}},</p>
<p>Your GAP Letter is attached to this email.</p>
<p>Kind regards,<br/>INMO Membership Team</p>`;
