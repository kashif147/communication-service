export const EVENT_REGISTRATION_TEMPLATE_CATEGORY = "Event Registration";

export const EVENT_REGISTRATION_CONFIRMED_EMAIL_TEMPLATE_NAME =
  process.env.EVENT_REGISTRATION_CONFIRMED_EMAIL_TEMPLATE_NAME ||
  "Event Registration Confirmed Email";

export const EVENT_REGISTRATION_CANCELLED_EMAIL_TEMPLATE_NAME =
  process.env.EVENT_REGISTRATION_CANCELLED_EMAIL_TEMPLATE_NAME ||
  "Event Registration Cancelled Email";

export const EVENT_REGISTRATION_SOURCE = "event_registration";

export const CERTIFICATE_TEMPLATE_CATEGORY = "certificate";

export const DEFAULT_EVENT_REGISTRATION_CONFIRMED_SUBJECT =
  "Your registration is confirmed";

export const DEFAULT_EVENT_REGISTRATION_CONFIRMED_HTML = `<p>Dear {{firstName}},</p>
<p>Your registration has been confirmed. We look forward to seeing you.</p>
<p>Kind regards,<br/>Events Team</p>`;

export const DEFAULT_EVENT_REGISTRATION_CANCELLED_SUBJECT =
  "Your registration has been cancelled";

export const DEFAULT_EVENT_REGISTRATION_CANCELLED_HTML = `<p>Dear {{firstName}},</p>
<p>Your registration has been cancelled. If you believe this is a mistake, please contact us.</p>
<p>Kind regards,<br/>Events Team</p>`;
