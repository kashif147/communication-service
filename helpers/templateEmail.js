/** Matches templates used for SES campaigns (`tempolateType` from schema). */
export function isEmailTemplateType(doc) {
  return String(doc?.tempolateType ?? "").trim().toLowerCase() === "email";
}

export function templateMailContent(template) {
  if (!isEmailTemplateType(template)) {
    const err = new Error("Template must have tempolateType Email");
    err.statusCode = 400;
    throw err;
  }
  if (!template.subject || !template.htmlBody) {
    const err = new Error("Email template is missing subject or htmlBody");
    err.statusCode = 400;
    throw err;
  }
  return {
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody || "",
  };
}

export function extractPlaceholderKeysFromText(...parts) {
  const combined = parts.filter(Boolean).join("\n");
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  const out = new Set();
  let m;
  while ((m = re.exec(combined))) {
    const key = m[1].trim();
    if (key) out.add(key);
  }
  return [...out];
}
