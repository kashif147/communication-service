// Application payment-link email — communication-service side of the contract
// `applications.payment-link.email.requested.v1` (application.events), published by
// profile-service's applicationPaymentLink.service.js via its outbox after a payment link is
// issued (ISSUE/REPLACE) or re-sent (RESEND). Design: account-service
// docs/design/IMPLEMENTATION_PLAN.md s.1.4 / s.3 (step 7).
//
// The template doc is seeded via scripts/seed-application-payment-link-email-template.js,
// category "applications", tempolateType "Email" (keep the schema's typo'd field name as-is).

export const PAYMENT_LINK_EMAIL_ROUTING_KEY = "applications.payment-link.email.requested.v1";

/** The only templateCode this consumer renders (event data.templateCode). */
export const PAYMENT_LINK_TEMPLATE_CODE = "APPLICATION_PAYMENT_LINK";

export const PAYMENT_LINK_TEMPLATE_CATEGORY = "applications";

export const PAYMENT_LINK_SOURCE = "application_payment_link";

export const PAYMENT_LINK_EMAIL_TEMPLATE_NAME =
  process.env.APPLICATION_PAYMENT_LINK_EMAIL_TEMPLATE_NAME || "Application Payment Link Email";

/** Hosts a checkoutUrl may point at (Stripe-hosted Checkout). Comma-separated override. */
export const PAYMENT_LINK_ALLOWED_HOSTS = (
  process.env.PAYMENT_LINK_ALLOWED_HOSTS || "checkout.stripe.com"
)
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/** Org timezone for the expiry time; Dublin until user-service regional settings exist. */
export const PAYMENT_LINK_TIMEZONE = process.env.PAYMENT_LINK_EMAIL_TIMEZONE || "Europe/Dublin";

export const PAYMENT_OPTION_LABELS = {
  FULL: "annual membership fee",
  FIRST_INSTALMENT: "first three months' membership fee",
};

// Authoring assumption (no wording in the design doc): plain, neutral copy. Placeholders:
// recipientName, amount, paymentDescription, checkoutUrl, expiresAt.
export const DEFAULT_PAYMENT_LINK_SUBJECT = "Complete your membership payment";
export const DEFAULT_PAYMENT_LINK_HTML =
  "<p>Dear {{recipientName}},</p>" +
  "<p>Thank you for your membership application. To complete it, please pay your " +
  "{{paymentDescription}} of <strong>{{amount}}</strong> using the secure link below.</p>" +
  '<p><a href="{{checkoutUrl}}">Pay securely by card</a></p>' +
  "<p>This link expires on {{expiresAt}}. Your card is authorised now and charged only when " +
  "your application is approved.</p>" +
  "<p>If you did not apply for membership, please ignore this email.</p>" +
  "<p>Kind regards,<br/>INMO team</p>";
export const DEFAULT_PAYMENT_LINK_TEXT =
  "Dear {{recipientName}},\n\n" +
  "Thank you for your membership application. To complete it, please pay your " +
  "{{paymentDescription}} of {{amount}} using the secure link below.\n\n" +
  "{{checkoutUrl}}\n\n" +
  "This link expires on {{expiresAt}}. Your card is authorised now and charged only when " +
  "your application is approved.\n\n" +
  "If you did not apply for membership, please ignore this email.\n\n" +
  "Kind regards,\nINMO team";
