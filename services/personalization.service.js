import crypto from "crypto";
import { formatBookmarkValueForHtmlReplacement } from "./bookmarkMerge.service.js";

function pickEmail(profile) {
  const c = profile?.contactInfo || {};
  return (
    c.preferredEmail ||
    c.personalEmail ||
    c.workEmail ||
    null
  );
}

function hasEmailMarketingConsent(profile) {
  const v = profile?.preferences?.emailConsent;
  return v === true;
}

/**
 * Flat bookmark-style map for {{placeholder}} replacement in subject/body.
 */
export function buildPersonalizationMap(profile, campaignId) {
  const pi = profile?.personalInfo || {};
  const prof = profile?.professionalDetails || {};
  const add = profile?.additionalInformation || {};
  const memberId = String(profile._id || profile.id || "");
  const token = signUnsubscribeToken(memberId, campaignId);
  const portal =
    (process.env.PORTAL_PUBLIC_URL || "http://localhost:3000").replace(
      /\/$/,
      ""
    );
  const unsubscribeUrl = `${portal}/Summary?campaignUnsubscribe=1&p=${encodeURIComponent(memberId)}&c=${encodeURIComponent(campaignId)}&t=${encodeURIComponent(token)}`;

  return {
    firstName: pi.forename || "",
    surname: pi.surname || "",
    fullName: pi.fullName || "",
    membershipNumber: profile.membershipNumber || "",
    membershipCategory: add.membershipStatus || prof.grade || "",
    email: pickEmail(profile) || "",
    unsubscribeUrl,
  };
}

export function signUnsubscribeToken(memberId, campaignId) {
  const secret =
    process.env.CAMPAIGN_UNSUBSCRIBE_SECRET ||
    process.env.JWT_SECRET ||
    "dev-unsubscribe-secret";
  return crypto
    .createHmac("sha256", secret)
    .update(`${memberId}:${campaignId}`)
    .digest("hex");
}

export function verifyUnsubscribeToken(memberId, campaignId, token) {
  if (!token || !memberId || !campaignId) return false;
  const expected = signUnsubscribeToken(memberId, campaignId);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(token, "utf8")
    );
  } catch {
    return false;
  }
}

export function applyTemplate(template, map) {
  let subject = template.subject || "";
  let html = template.htmlBody || "";
  let text = template.textBody || "";
  const keys = Object.keys(map);
  for (const k of keys) {
    const re = new RegExp(`\\{\\{\\s*${escapeReg(k)}\\s*\\}\\}`, "gi");
    const val = String(map[k] ?? "");
    subject = subject.replace(re, val);
    html = html.replace(re, formatBookmarkValueForHtmlReplacement(val));
    text = text.replace(re, val);
  }
  return { subject, html, text };
}

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export { pickEmail, hasEmailMarketingConsent };
