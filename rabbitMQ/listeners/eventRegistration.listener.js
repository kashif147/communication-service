import {
  handleEventRegistrationConfirmedComms,
  handleEventRegistrationCancelledComms,
} from "../../services/eventRegistrationComms.service.js";
import logger from "../../config/logger.js";

const ROUTING_KEYS = {
  REGISTRATION_CONFIRMED: "events.registration.confirmed.v1",
  REGISTRATION_CANCELLED: "events.registration.cancelled.v1",
};

export async function handleEventRegistrationConfirmed(payload) {
  try {
    await handleEventRegistrationConfirmedComms(payload?.data || payload);
  } catch (err) {
    logger.error(
      { err: err.message, routingKey: ROUTING_KEYS.REGISTRATION_CONFIRMED },
      "eventRegistration listener (confirmed) failed",
    );
    throw err;
  }
}

export async function handleEventRegistrationCancelled(payload) {
  try {
    await handleEventRegistrationCancelledComms(payload?.data || payload);
  } catch (err) {
    logger.error(
      { err: err.message, routingKey: ROUTING_KEYS.REGISTRATION_CANCELLED },
      "eventRegistration listener (cancelled) failed",
    );
    throw err;
  }
}

export { ROUTING_KEYS };
