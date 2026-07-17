import { processGapLetterComms } from "../../services/gapLetterComms.service.js";
import logger from "../../config/logger.js";

const ROUTING_KEY = "members.gap-letter.requested.v1";

export async function handleGapLetterRequested(payload) {
  try {
    await processGapLetterComms(payload);
  } catch (err) {
    logger.error(
      { err: err.message, routingKey: ROUTING_KEY },
      "gapLetterComms listener failed",
    );
    throw err;
  }
}

export { ROUTING_KEY };
