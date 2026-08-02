import {
  handleIrReferred,
  handleIrOutcomeReceived,
  handleDueDateApproaching,
  handleIssueCreated,
} from "../../services/issuesComms.service.js";
import logger from "../../config/logger.js";

// Mirrors issue-service's rabbitMQ/publishers/issue.events.publisher.js ROUTING_KEYS —
// all 9 keys are already mapped to "issues.events" in rabbitmq-middleware's exchangeMapping
// (backend/rabbitmq-middleware/src/publisher.js), but this consumer only subscribes to the
// 4 that drive an email (plan §3.5).
const ROUTING_KEYS = {
  IR_REFERRED: "issues.ir.referred.v1",
  IR_OUTCOME_RECEIVED: "issues.ir.outcome.received.v1",
  DUEDATE_APPROACHING: "issues.duedate.approaching.v1",
  ISSUE_CREATED: "issues.issue.created.v1",
};

function wrap(routingKey, handler) {
  return async (payload) => {
    try {
      return await handler(payload);
    } catch (err) {
      logger.error({ err: err.message, routingKey }, "issues listener failed");
      throw err;
    }
  };
}

export const handleIssuesIrReferred = wrap(ROUTING_KEYS.IR_REFERRED, handleIrReferred);
export const handleIssuesIrOutcomeReceived = wrap(
  ROUTING_KEYS.IR_OUTCOME_RECEIVED,
  handleIrOutcomeReceived,
);
export const handleIssuesDueDateApproaching = wrap(
  ROUTING_KEYS.DUEDATE_APPROACHING,
  handleDueDateApproaching,
);
// issues.issue.created.v1 fires for every issue creation - the MEMBER-source filter lives
// inside handleIssueCreated itself, not here.
export const handleIssuesIssueCreated = wrap(ROUTING_KEYS.ISSUE_CREATED, handleIssueCreated);

export { ROUTING_KEYS };
