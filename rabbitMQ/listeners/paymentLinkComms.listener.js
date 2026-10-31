import { processPaymentLinkEmail } from "../../services/paymentLinkComms.service.js";
import { PAYMENT_LINK_EMAIL_ROUTING_KEY } from "../../constants/paymentLinkComms.constants.js";
import logger from "../../config/logger.js";

const ROUTING_KEY = PAYMENT_LINK_EMAIL_ROUTING_KEY;

export async function handlePaymentLinkEmailRequested(payload) {
  try {
    return await processPaymentLinkEmail(payload);
  } catch (err) {
    logger.error(
      { err: err.message, routingKey: ROUTING_KEY, eventId: payload?.eventId },
      "paymentLinkComms listener failed",
    );
    throw err;
  }
}

export { ROUTING_KEY };
