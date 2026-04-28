import logger from "../config/logger.js";
import { handleSesEventRecord } from "../services/sesEventHandler.service.js";

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
 */
export async function handleSesSnsWebhook(req, res) {
  const body = parseBody(req);
  if (!body) {
    return res.status(400).send("invalid body");
  }

  try {
    if (body.Type === "SubscriptionConfirmation" && body.SubscribeURL) {
      logger.info("SNS SubscriptionConfirmation received");
      return res.status(200).json({ ok: true });
    }

    if (body.Type === "UnsubscribeConfirmation") {
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
          await handleSesEventRecord(ev);
        }
      }
    }

    return res.status(200).send("OK");
  } catch (e) {
    logger.error({ err: e.message }, "SNS webhook handler error");
    return res.status(500).send("error");
  }
}
