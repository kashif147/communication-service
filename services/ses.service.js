import {
  SESv2Client,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import logger from "../config/logger.js";

let client;

function getClient() {
  if (!client) {
    client = new SESv2Client({
      region:
        process.env.AWS_REGION ||
        process.env.AWS_DEFAULT_REGION ||
        "eu-west-1",
    });
  }
  return client;
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function buildRawMime({
  from,
  to,
  subject,
  htmlBody,
  textBody,
  attachments,
}) {
  const mixed = `mixed_${Date.now()}`;
  const alt = `alt_${Date.now()}`;
  const plain = textBody || stripHtml(htmlBody || "");
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(plain, "utf8").toString("base64"),
    "",
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(htmlBody || "", "utf8").toString("base64"),
    "",
    `--${alt}--`,
    "",
  ];

  for (const a of attachments) {
    const raw = Buffer.from(a.contentBase64, "base64");
    lines.push(
      `--${mixed}`,
      `Content-Type: ${a.contentType || "application/octet-stream"}; name="${a.filename.replace(/"/g, "")}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${a.filename.replace(/"/g, "")}"`,
      "",
      raw.toString("base64"),
      ""
    );
  }
  lines.push(`--${mixed}--`);
  return lines.join("\r\n");
}

/**
 * @param {object} opts
 * @param {string} opts.fromAddress
 * @param {string} opts.toAddress
 * @param {string} opts.subject
 * @param {string} opts.htmlBody
 * @param {string} [opts.textBody]
 * @param {Array<{filename:string,contentType?:string,contentBase64:string}>} [opts.attachments]
 * @param {string} [opts.configurationSetName]
 * @param {Record<string,string>} [opts.tags]
 */
export async function sendSesMessage(opts) {
  const {
    fromAddress,
    toAddress,
    subject,
    htmlBody,
    textBody,
    attachments = [],
    configurationSetName,
    tags,
  } = opts;

  const from =
    fromAddress ||
    process.env.SES_FROM_ADDRESS ||
    process.env.SES_FROM ||
    process.env.EMAIL_FROM_ADDRESS ||
    process.env.DEFAULT_FROM_EMAIL ||
    process.env.MAIL_FROM ||
    process.env.REACT_APP_EMAIL_FROM_ADDRESS;
  if (!from) {
    throw new Error(
      "SES from address is not configured. Set SES_FROM_ADDRESS (preferred), SES_FROM, EMAIL_FROM_ADDRESS, or pass fromAddress."
    );
  }

  const emailTags = [];
  if (tags && typeof tags === "object") {
    for (const [Name, Value] of Object.entries(tags)) {
      if (Value != null && String(Value).length > 0) {
        emailTags.push({
          Name: String(Name).slice(0, 64),
          Value: String(Value).slice(0, 256),
        });
      }
    }
  }

  let input;
  if (attachments.length === 0) {
    input = {
      FromEmailAddress: from,
      Destination: { ToAddresses: [toAddress] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Html: htmlBody
              ? { Data: htmlBody, Charset: "UTF-8" }
              : undefined,
            Text: {
              Data: textBody || stripHtml(htmlBody || ""),
              Charset: "UTF-8",
            },
          },
        },
      },
      EmailTags: emailTags.length ? emailTags : undefined,
      ConfigurationSetName: configurationSetName || undefined,
    };
  } else {
    const raw = buildRawMime({
      from,
      to: toAddress,
      subject,
      htmlBody,
      textBody,
      attachments,
    });
    input = {
      FromEmailAddress: from,
      Destination: { ToAddresses: [toAddress] },
      Content: { Raw: { Data: Buffer.from(raw, "utf8") } },
      EmailTags: emailTags.length ? emailTags : undefined,
      ConfigurationSetName: configurationSetName || undefined,
    };
  }

  try {
    const out = await getClient().send(new SendEmailCommand(input));
    return { messageId: out.MessageId };
  } catch (e) {
    logger.error({ err: e.message }, "SES send failed");
    throw e;
  }
}
