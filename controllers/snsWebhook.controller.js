import logger from "../config/logger.js";
import { handleSesEventRecord } from "../services/sesEventHandler.service.js";
import {
  verifySnsMessage,
  defaultCertificateFetcher,
  allowedTopicArns,
  isValidSnsHostUrl,
  httpsGetText,
} from "../services/snsSignature.service.js";

/**
 * Collaborators with side effects (cert fetch, subscription confirm, DB
 * updates), on one object so tests can substitute them. Production code never
 * reassigns these.
 */
export const snsWebhookDeps = {
  getCertificate: defaultCertificateFetcher,
  confirmSubscription: (subscribeUrl) => httpsGetText(subscribeUrl),
  handleSesEventRecord,
};

function parseBody(req) {
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      logger.warn({ err: e.message }, "SNS webhook invalid JSON");
      return null;
    }
  }
  if (typeof req.body === "object" && req.body !== null) return req.body;
  return null;
}

/**
 * Amazon SNS → SES event notifications (HTTP subscription).
 *
 * Every message must carry a valid SNS signature (SignatureVersion 1/2, cert
 * from an SNS host) AND come from a TopicArn in SES_SNS_ALLOWED_TOPIC_ARNS.
 * Anything else is rejected with 403 before any processing — including
 * SubscriptionConfirmation, which is only confirmed for allowlisted topics.
 */
export async function handleSesSnsWebhook(req, res) {
  const body = parseBody(req);
  if (!body || typeof body !== "object") {
    return res.status(400).send("invalid body");
  }

  const headerType = req.headers?.["x-amz-sns-message-type"];
  if (headerType && headerType !== body.Type) {
    logger.warn({ headerType, type: body.Type }, "SNS webhook message type mismatch");
    return res.status(403).send("forbidden");
  }

  const verdict = await verifySnsMessage(body, { getCertificate: snsWebhookDeps.getCertificate });
  if (!verdict.ok) {
    logger.warn({ reason: verdict.reason, type: body.Type }, "SNS webhook signature rejected");
    return res.status(403).send("forbidden");
  }

  const allowed = allowedTopicArns();
  if (!allowed.length || !allowed.includes(body.TopicArn)) {
    logger.warn(
      { topicArn: body.TopicArn, allowlistConfigured: allowed.length > 0 },
      "SNS webhook TopicArn not allowlisted"
    );
    return res.status(403).send("forbidden");
  }

  try {
    if (body.Type === "SubscriptionConfirmation") {
      if (!isValidSnsHostUrl(body.SubscribeURL)) {
        logger.warn({ topicArn: body.TopicArn }, "SNS SubscribeURL is not an SNS host; not confirming");
        return res.status(403).send("forbidden");
      }
      await snsWebhookDeps.confirmSubscription(body.SubscribeURL);
      logger.info({ topicArn: body.TopicArn }, "SNS subscription confirmed");
      return res.status(200).json({ ok: true });
    }

    if (body.Type === "UnsubscribeConfirmation") {
      logger.info({ topicArn: body.TopicArn }, "SNS UnsubscribeConfirmation received");
      return res.status(200).json({ ok: true });
    }

    if (body.Type === "Notification" && body.Message) {
      let inner;
      try {
        inner = JSON.parse(body.Message);
      } catch (e) {
        logger.warn({ err: e.message }, "SNS Message not JSON");
        return res.status(200).send("OK");
      }

      const list = Array.isArray(inner) ? inner : [inner];
      for (const ev of list) {
        if (ev && (ev.eventType || ev.notificationType)) {
          await snsWebhookDeps.handleSesEventRecord(ev);
        }
      }
    }

    return res.status(200).send("OK");
  } catch (e) {
    logger.error({ err: e.message }, "SNS webhook handler error");
    return res.status(500).send("error");
  }
}
