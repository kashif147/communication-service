import CampaignRecipient from "../model/campaignRecipient.model.js";
import Campaign from "../model/campaign.model.js";
import logger from "../config/logger.js";

function tagValue(tags, key) {
  if (!tags || !tags[key]) return null;
  const v = tags[key];
  return Array.isArray(v) ? v[0] : v;
}

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * Match an SES event back to exactly one CampaignRecipient, within ONE tenant
 * (Phase 2B Stream 3C, audit H-24/C4). The tenant is derived from the matched
 * record (recipient row, or the campaign row for the tag fallback) and every
 * later query/update carries it. A `tenantId` email tag (stamped at send time
 * by campaignEngine) must agree with the derived tenant when present.
 *
 * @returns {Promise<{rec: object, tenantId: string} | null>}
 */
async function resolveRecipient({ messageId, tags }) {
  const tenantTag = tagValue(tags, "tenantId");

  // 1) By SES message id. Message ids are globally unique in SES; if more than
  //    one row claims it (corrupt/forged data) refuse rather than guess.
  const byMessage = await CampaignRecipient.find({ sesMessageId: messageId }).limit(2);
  if (byMessage.length > 1) {
    logger.warn({ messageId }, "SES event matches more than one campaign recipient; ignoring");
    return null;
  }
  if (byMessage.length === 1) {
    const rec = byMessage[0];
    const tenantId = rec.tenantId ? String(rec.tenantId) : null;
    if (!tenantId) return null;
    if (tenantTag && String(tenantTag) !== tenantId) {
      logger.warn({ messageId }, "SES event tenant tag does not match recipient tenant; ignoring");
      return null;
    }
    return { rec, tenantId };
  }

  // 2) Fallback: campaignId + memberId tags. The tenant comes from the
  //    Campaign record, never from the tags alone.
  const campaignId = tagValue(tags, "campaignId");
  const memberId = tagValue(tags, "memberId");
  if (!campaignId || !memberId || !OBJECT_ID_RE.test(String(campaignId))) return null;

  const campaign = await Campaign.findOne({ _id: String(campaignId) });
  const tenantId = campaign?.tenantId ? String(campaign.tenantId) : null;
  if (!tenantId) return null;
  if (tenantTag && String(tenantTag) !== tenantId) {
    logger.warn({ messageId }, "SES event tenant tag does not match campaign tenant; ignoring");
    return null;
  }
  const rec = await CampaignRecipient.findOne({
    campaignId: String(campaignId),
    memberId: String(memberId),
    tenantId,
  });
  return rec ? { rec, tenantId } : null;
}

export async function handleSesEventRecord(ev) {
  const eventType = ev.eventType || ev.notificationType;
  const mail = ev.mail || {};
  const messageId = mail.messageId;
  if (!messageId) {
    logger.warn("SES event without messageId");
    return;
  }

  const tags = mail.tags || {};
  const resolved = await resolveRecipient({ messageId: String(messageId), tags });

  if (!resolved) {
    logger.debug({ messageId }, "No campaign recipient for SES event");
    return;
  }

  const { rec, tenantId } = resolved;
  const campaignId = rec.campaignId;

  if (eventType === "Delivery") {
    const r = await CampaignRecipient.updateOne(
      { _id: rec._id, tenantId, status: "sent" },
      {
        $set: {
          status: "delivered",
          deliveryStatus: "Delivery",
        },
      }
    );
    if (r.modifiedCount) {
      await Campaign.updateOne(
        { _id: campaignId, tenantId },
        { $inc: { "stats.delivered": 1 } }
      );
    }
    return;
  }

  if (eventType === "Bounce") {
    const r = await CampaignRecipient.updateOne(
      { _id: rec._id, tenantId, status: { $nin: ["bounced", "complained"] } },
      {
        $set: {
          status: "bounced",
          deliveryStatus: JSON.stringify(ev.bounce || ev).slice(0, 4000),
        },
      }
    );
    if (r.modifiedCount) {
      await Campaign.updateOne(
        { _id: campaignId, tenantId },
        { $inc: { "stats.bounced": 1 } }
      );
    }
    return;
  }

  if (eventType === "Complaint") {
    const r = await CampaignRecipient.updateOne(
      { _id: rec._id, tenantId, status: { $nin: ["complained"] } },
      {
        $set: {
          status: "complained",
          deliveryStatus: JSON.stringify(ev.complaint || ev).slice(0, 4000),
        },
      }
    );
    if (r.modifiedCount) {
      await Campaign.updateOne(
        { _id: campaignId, tenantId },
        { $inc: { "stats.complaints": 1 } }
      );
    }
  }
}
