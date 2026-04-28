import Campaign from "../model/campaign.model.js";
import CampaignRecipient from "../model/campaignRecipient.model.js";
import Template from "../model/template.model.js";
import {
  isEmailTemplateType,
  templateMailContent,
} from "../helpers/templateEmail.js";
import { fetchProfilesBatch } from "./profileBatch.service.js";
import {
  applyTemplate,
  buildPersonalizationMap,
  hasEmailMarketingConsent,
  pickEmail,
} from "./personalization.service.js";
import { sendSesMessage } from "./ses.service.js";
import { logCampaignAudit } from "./auditClient.service.js";
import logger from "../config/logger.js";

const MAX_RETRY = 3;
const PROFILE_BATCH = 100;

async function audit(tenantId, action, resourceId, actorId, metadata) {
  await logCampaignAudit({
    tenantId,
    action,
    resourceType: "campaign",
    resourceId,
    actorId: actorId || null,
    metadata: metadata || {},
  });
}

async function loadProfileMap(profileIds, tenantId, authorizationHeader) {
  const map = new Map();
  const ids = [...new Set(profileIds.map(String))];
  for (let i = 0; i < ids.length; i += PROFILE_BATCH) {
    const slice = ids.slice(i, i + PROFILE_BATCH);
    const profiles = await fetchProfilesBatch({
      profileIds: slice,
      tenantId,
      authorizationHeader,
    });
    for (const p of profiles) {
      map.set(String(p._id || p.id), p);
    }
  }
  return map;
}

export async function expandRecipientsForCampaign(
  campaign,
  authorizationHeader
) {
  const tenantId = campaign.tenantId;
  const campaignId = campaign._id;
  const ids = campaign.audienceProfileIds || [];
  if (!ids.length) {
    await Campaign.updateOne(
      { _id: campaignId },
      { $set: { "stats.totalRecipients": 0, "stats.skippedOptOut": 0 } }
    );
    return { created: 0, skippedOptOut: 0, skippedNoEmail: 0 };
  }

  const profiles = await fetchProfilesBatch({
    profileIds: ids,
    tenantId,
    authorizationHeader,
  });

  let skippedOptOut = 0;
  let skippedNoEmail = 0;
  let eligible = 0;

  for (const p of profiles) {
    const memberId = String(p._id || p.id);
    const email = pickEmail(p);
    if (!email) {
      skippedNoEmail += 1;
      continue;
    }
    if (!hasEmailMarketingConsent(p)) {
      skippedOptOut += 1;
      continue;
    }

    await CampaignRecipient.findOneAndUpdate(
      { campaignId, memberId },
      {
        $setOnInsert: {
          campaignId,
          tenantId,
          memberId,
          email,
          status: "pending",
        },
      },
      { upsert: true }
    );
    eligible += 1;
  }

  await Campaign.updateOne(
    { _id: campaignId },
    {
      $set: {
        "stats.skippedOptOut": skippedOptOut,
        "stats.totalRecipients": eligible,
      },
    }
  );

  return { created: eligible, skippedOptOut, skippedNoEmail };
}

export async function runCampaignSend(campaignId, authorizationHeader, actorId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || campaign.status === "cancelled") return;

  const templateDoc = await Template.findOne({
    _id: campaign.emailTemplateId,
    tenantId: campaign.tenantId,
  });
  if (!templateDoc || !isEmailTemplateType(templateDoc)) {
    await Campaign.updateOne(
      { _id: campaignId },
      {
        $set: {
          status: "failed",
          lastError: "Template not found or tempolateType is not Email",
        },
      }
    );
    return;
  }
  let mailSource;
  try {
    mailSource = templateMailContent(templateDoc);
  } catch (e) {
    await Campaign.updateOne(
      { _id: campaignId },
      { $set: { status: "failed", lastError: e.message } }
    );
    return;
  }

  await Campaign.updateOne(
    { _id: campaignId },
    { $set: { status: "processing", startedAt: new Date(), lastError: null } }
  );

  await audit(campaign.tenantId, "CAMPAIGN_SEND_STARTED", String(campaignId), actorId, {
    name: campaign.name,
  });

  try {
    await expandRecipientsForCampaign(campaign, authorizationHeader);
  } catch (e) {
    logger.error({ err: e.message, campaignId }, "expand recipients failed");
    await Campaign.updateOne(
      { _id: campaignId },
      { $set: { status: "failed", lastError: e.message } }
    );
    await audit(campaign.tenantId, "CAMPAIGN_SEND_FAILED", String(campaignId), actorId, {
      error: e.message,
    });
    return;
  }

  const batchSize = Math.min(Math.max(campaign.batchSize || 14, 1), 50);

  while (true) {
    const batch = await CampaignRecipient.find({
      campaignId,
      suppressed: { $ne: true },
      $or: [
        { status: "pending" },
        { status: "queued" },
        { status: "failed", retryCount: { $lt: MAX_RETRY } },
      ],
    })
      .limit(batchSize)
      .lean();

    if (!batch.length) break;

    const profileMap = await loadProfileMap(
      batch.map((r) => r.memberId),
      campaign.tenantId,
      authorizationHeader
    );

    for (const rec of batch) {
      const profile = profileMap.get(String(rec.memberId));
      if (!profile) {
        await CampaignRecipient.updateOne(
          { _id: rec._id },
          { $set: { status: "failed", errorMessage: "Profile not found" } }
        );
        await Campaign.updateOne({ _id: campaignId }, { $inc: { "stats.failed": 1 } });
        continue;
      }

      if (profile.preferences?.emailConsent !== true) {
        await CampaignRecipient.updateOne(
          { _id: rec._id },
          { $set: { status: "suppressed", errorMessage: "emailConsent" } }
        );
        continue;
      }

      const map = buildPersonalizationMap(profile, String(campaignId));
      const rendered = applyTemplate(mailSource, map);
      const emailTo = pickEmail(profile) || rec.email;

      try {
        const { messageId } = await sendSesMessage({
          fromAddress: campaign.fromEmail || undefined,
          toAddress: emailTo,
          subject: rendered.subject,
          htmlBody: rendered.html,
          textBody: rendered.text,
          attachments: campaign.attachments || [],
          configurationSetName: campaign.configurationSetName || undefined,
          tags: {
            campaignId: String(campaignId),
            memberId: rec.memberId,
          },
        });

        await CampaignRecipient.updateOne(
          { _id: rec._id },
          {
            $set: {
              status: "sent",
              sentAt: new Date(),
              sesMessageId: messageId || null,
              errorMessage: null,
            },
          }
        );
        await Campaign.updateOne({ _id: campaignId }, { $inc: { "stats.sent": 1 } });
      } catch (err) {
        const nextRetry = (rec.retryCount || 0) + 1;
        const terminal = nextRetry >= MAX_RETRY;
        await CampaignRecipient.updateOne(
          { _id: rec._id },
          {
            $set: {
              status: "failed",
              errorMessage: err.message,
              retryCount: nextRetry,
            },
          }
        );
        if (terminal) {
          await Campaign.updateOne({ _id: campaignId }, { $inc: { "stats.failed": 1 } });
        }
      }
    }
  }

  const still = await CampaignRecipient.countDocuments({
    campaignId,
    suppressed: { $ne: true },
    $or: [
      { status: "pending" },
      { status: "queued" },
      { status: "failed", retryCount: { $lt: MAX_RETRY } },
    ],
  });

  if (still === 0) {
    await Campaign.updateOne(
      { _id: campaignId },
      {
        $set: {
          status: "sent",
          completedAt: new Date(),
          lastError: null,
        },
      }
    );
    await audit(campaign.tenantId, "CAMPAIGN_SEND_COMPLETED", String(campaignId), actorId, {});
  } else {
    await Campaign.updateOne(
      { _id: campaignId },
      {
        $set: {
          status: "failed",
          lastError: `${still} recipients could not be sent after retries`,
          completedAt: new Date(),
        },
      }
    );
    await audit(campaign.tenantId, "CAMPAIGN_SEND_PARTIAL_FAIL", String(campaignId), actorId, {
      remaining: still,
    });
  }
}

export async function processScheduledCampaigns(authorizationHeader) {
  const now = new Date();
  const due = await Campaign.find({
    status: "scheduled",
    scheduledAt: { $lte: now },
  }).limit(20);

  for (const c of due) {
    setImmediate(() =>
      runCampaignSend(c._id, authorizationHeader, c.createdBy).catch((e) =>
        logger.error({ e: e.message, id: c._id }, "scheduled campaign send error")
      )
    );
  }
  return { queued: due.length };
}
