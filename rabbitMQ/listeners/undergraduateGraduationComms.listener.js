import { processUndergraduateGraduationComms } from "../../services/undergraduateGraduationComms.service.js";
import logger from "../../config/logger.js";

const ROUTING_KEY = "members.undergraduate.graduation.comms.requested.v1";

export async function handleUndergraduateGraduationCommsRequested(payload) {
  try {
    await processUndergraduateGraduationComms(payload);
  } catch (err) {
    logger.error(
      { err: err.message, routingKey: ROUTING_KEY },
      "undergraduateGraduationComms listener failed"
    );
    throw err;
  }
}

export { ROUTING_KEY };
