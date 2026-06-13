export const UGRAD_GRADUATION_TEMPLATE_CATEGORY = "Undergraduate Graduation";

export const UGRAD_GRADUATION_LETTER_TEMPLATE_NAME =
  process.env.UGRAD_GRADUATION_LETTER_TEMPLATE_NAME ||
  "Graduation Congratulations Letter";

export const UGRAD_GRADUATION_EMAIL_TEMPLATE_NAME =
  process.env.UGRAD_GRADUATION_EMAIL_TEMPLATE_NAME ||
  "Graduation Congratulations Email";

export const UGRAD_GRADUATION_LETTER_SOURCE = "undergraduate_graduation";

export const DEFAULT_GRADUATION_EMAIL_SUBJECT =
  "Congratulations on Your Graduation";

export const DEFAULT_GRADUATION_EMAIL_HTML = `<p>Dear {{forename}},</p>
<p>Congratulations on reaching your graduation date.</p>
<p>Your Undergraduate Student membership has now ended. We invite you to join as a full member and continue enjoying the benefits of membership.</p>
<p>Your congratulation letter is attached to this email.</p>
<p>Kind regards,<br/>INMO Membership Team</p>`;
