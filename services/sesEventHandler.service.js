import CampaignRecipient from "../model/campaignRecipient.model.js";
import Campaign from "../model/campaign.model.js";
import logger from "../config/logger.js";

function tagValue(tags, key) {
  if (!tags || !tags[key]) return null;
  const v = tags[key];
  return Array.isArray(v) ? v[0] : v;
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
  const campaignIdFromTag = tagValue(tags, "campaignId");

  let rec = await CampaignRecipient.findOne({ sesMessageId: messageId });
  if (!rec && campaignIdFromTag) {
    const memberId = tagValue(tags, "memberId");
    if (memberId) {
      rec = await CampaignRecipient.findOne({
        campaignId: campaignIdFromTag,
        memberId,
      });
    }
  }

  if (!rec) {
    logger.debug({ messageId }, "No campaign recipient for SES event");
    return;
  }

  const campaignId = rec.campaignId;

  if (eventType === "Delivery") {
    const r = await CampaignRecipient.updateOne(
      { _id: rec._id, status: "sent" },
      {
        $set: {
          status: "delivered",
          deliveryStatus: "Delivery",
        },
      }
    );
    if (r.modifiedCount) {
      await Campaign.updateOne(
        { _id: campaignId },
        { $inc: { "stats.delivered": 1 } }
      );
    }
    return;
  }

  if (eventType === "Bounce") {
    const r = await CampaignRecipient.updateOne(
      { _id: rec._id, status: { $nin: ["bounced", "complained"] } },
      {
        $set: {
          status: "bounced",
          deliveryStatus: JSON.stringify(ev.bounce || ev).slice(0, 4000),
        },
      }
    );
    if (r.modifiedCount) {
      await Campaign.updateOne(
        { _id: campaignId },
        { $inc: { "stats.bounced": 1 } }
      );
    }
    return;
  }

  if (eventType === "Complaint") {
    const r = await CampaignRecipient.updateOne(
      { _id: rec._id, status: { $nin: ["complained"] } },
      {
        $set: {
          status: "complained",
          deliveryStatus: JSON.stringify(ev.complaint || ev).slice(0, 4000),
        },
      }
    );
    if (r.modifiedCount) {
      await Campaign.updateOne(
        { _id: campaignId },
        { $inc: { "stats.complaints": 1 } }
      );
    }
  }
}
