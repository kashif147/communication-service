import mongoose from "mongoose";
import Campaign from "../model/campaign.model.js";
import CampaignRecipient from "../model/campaignRecipient.model.js";
import Template from "../model/template.model.js";
import {
  isEmailTemplateType,
  templateMailContent,
} from "../helpers/templateEmail.js";
import {
  validateObjectId,
  sanitizeString,
} from "../middlewares/validateInput.js";
import { fetchProfilesBatch } from "../services/profileBatch.service.js";
import {
  applyTemplate,
  buildPersonalizationMap,
  verifyUnsubscribeToken,
} from "../services/personalization.service.js";
import { sendSesMessage } from "../services/ses.service.js";
import {
  runCampaignSend,
  processScheduledCampaigns,
} from "../services/campaignEngine.service.js";
import { logCampaignAudit } from "../services/auditClient.service.js";
import logger from "../config/logger.js";

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

async function loadEmailTemplateOrFail(templateId, tenantId) {
  const t = await Template.findOne({ _id: templateId, tenantId });
  if (!t) {
    const err = new Error("Template not found");
    err.statusCode = 404;
    throw err;
  }
  if (!isEmailTemplateType(t)) {
    const err = new Error("Campaign requires a template with tempolateType Email");
    err.statusCode = 400;
    throw err;
  }
  return templateMailContent(t);
}

function normalizeAttachments(raw) {
  if (!raw || !Array.isArray(raw)) return [];
  if (raw.length > MAX_ATTACHMENTS) {
    throw new Error(`At most ${MAX_ATTACHMENTS} attachments`);
  }
  return raw.map((a) => {
    if (!a.filename || !a.contentBase64) {
      throw new Error("Each attachment needs filename and contentBase64");
    }
    const buf = Buffer.from(a.contentBase64, "base64");
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachment too large");
    }
    return {
      filename: String(a.filename).slice(0, 255),
      contentType: a.contentType || "application/octet-stream",
      contentBase64: a.contentBase64,
    };
  });
}

export async function createCampaign(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }
    const {
      name,
      description,
      audienceProfileIds,
      emailTemplateId,
      attachments,
      scheduledAt,
      sendImmediately,
      fromEmail,
      batchSize,
    } = req.body;

    if (!name || !emailTemplateId) {
      return res.fail("name and emailTemplateId are required", 400);
    }
    validateObjectId(String(emailTemplateId), "emailTemplateId");

    try {
      await loadEmailTemplateOrFail(emailTemplateId, req.tenantId);
    } catch (e) {
      return res.fail(e.message, e.statusCode || 400);
    }

    const ids = [
      ...new Set(
        (Array.isArray(audienceProfileIds) ? audienceProfileIds : []).map(String)
      ),
    ];
    let att = [];
    try {
      att = normalizeAttachments(attachments);
    } catch (e) {
      return res.fail(e.message, 400);
    }

    const when = scheduledAt ? new Date(scheduledAt) : null;
    const now = new Date();
    let status = "draft";
    if (when && when > now) {
      status = "scheduled";
    } else if (sendImmediately) {
      status = "processing";
    }

    const campaign = await Campaign.create({
      name: sanitizeString(name, 200),
      description: sanitizeString(description || "", 5000),
      audienceProfileIds: ids,
      emailTemplateId,
      attachments: att,
      scheduledAt: when && when > now ? when : null,
      createdBy: req.userId,
      tenantId: req.tenantId,
      fromEmail: fromEmail ? sanitizeString(fromEmail, 320) : null,
      batchSize: batchSize || 14,
      status,
    });

    await logCampaignAudit({
      tenantId: req.tenantId,
      action: "CAMPAIGN_CREATED",
      resourceId: String(campaign._id),
      actorId: req.userId,
      metadata: { name: campaign.name, status: campaign.status },
    });

    const auth = req.headers.authorization || req.headers.Authorization;

    if (sendImmediately && status !== "scheduled") {
      setImmediate(() =>
        runCampaignSend(campaign._id, auth, req.userId).catch((e) =>
          logger.error({ e: e.message, id: campaign._id }, "campaign send async")
        )
      );
    }

    res.created({ campaign }, "Campaign created");
  } catch (e) {
    next(e);
  }
}

export async function listCampaigns(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }
    const list = await Campaign.find({ tenantId: req.tenantId })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.success({ campaigns: list }, "OK");
  } catch (e) {
    next(e);
  }
}

export async function getCampaign(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }
    const { id } = req.params;
    validateObjectId(id, "id");
    const c = await Campaign.findOne({ _id: id, tenantId: req.tenantId }).lean();
    if (!c) return res.notFoundRecord("Campaign not found");
    res.success({ campaign: c }, "OK");
  } catch (e) {
    next(e);
  }
}

export async function patchCampaignCancel(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }
    const { id } = req.params;
    validateObjectId(id, "id");
    const c = await Campaign.findOneAndUpdate(
      { _id: id, tenantId: req.tenantId, status: { $in: ["draft", "scheduled"] } },
      { $set: { status: "cancelled" } },
      { new: true }
    );
    if (!c) return res.fail("Campaign not found or cannot be cancelled", 400);
    res.success({ campaign: c }, "Cancelled");
  } catch (e) {
    next(e);
  }
}

export async function postCampaignSend(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }
    const { id } = req.params;
    validateObjectId(id, "id");
    const c = await Campaign.findOne({ _id: id, tenantId: req.tenantId });
    if (!c) return res.notFoundRecord("Campaign not found");
    if (["sent", "cancelled", "processing"].includes(c.status)) {
      return res.fail("Campaign cannot be sent in current status", 400);
    }

    await Campaign.updateOne(
      { _id: id },
      { $set: { status: "processing", scheduledAt: null } }
    );

    const auth = req.headers.authorization || req.headers.Authorization;
    setImmediate(() =>
      runCampaignSend(c._id, auth, req.userId).catch((e) =>
        logger.error({ e: e.message, id: c._id }, "campaign send async")
      )
    );

    res.status(202).json({
      status: "success",
      message: "Send started",
      data: { campaignId: String(c._id) },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
}

export async function postCampaignPreview(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }
    const { id } = req.params;
    validateObjectId(id, "id");
    const { profileId } = req.body || {};
    const c = await Campaign.findOne({ _id: id, tenantId: req.tenantId });
    if (!c) return res.notFoundRecord("Campaign not found");

    let mailTpl;
    try {
      mailTpl = await loadEmailTemplateOrFail(c.emailTemplateId, req.tenantId);
    } catch (e) {
      return res.fail(e.message, e.statusCode || 400);
    }

    const sampleId =
      profileId ||
      (c.audienceProfileIds && c.audienceProfileIds[0]) ||
      null;
    if (!sampleId) {
      return res.fail("Provide profileId or audience on campaign", 400);
    }
    validateObjectId(String(sampleId), "profileId");

    const auth = req.headers.authorization || req.headers.Authorization;
    const profiles = await fetchProfilesBatch({
      profileIds: [String(sampleId)],
      tenantId: req.tenantId,
      authorizationHeader: auth,
    });
    const profile = profiles[0];
    if (!profile) return res.fail("Profile not found", 404);

    const map = buildPersonalizationMap(profile, String(c._id));
    const rendered = applyTemplate(mailTpl, map);
    res.success(
      {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        placeholdersUsed: Object.keys(map),
      },
      "OK"
    );
  } catch (e) {
    next(e);
  }
}

export async function postCampaignTestEmail(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }
    const { id } = req.params;
    validateObjectId(id, "id");
    const { toEmail, profileId } = req.body || {};
    if (!toEmail || typeof toEmail !== "string") {
      return res.fail("toEmail is required", 400);
    }

    const c = await Campaign.findOne({ _id: id, tenantId: req.tenantId });
    if (!c) return res.notFoundRecord("Campaign not found");

    let mailTpl;
    try {
      mailTpl = await loadEmailTemplateOrFail(c.emailTemplateId, req.tenantId);
    } catch (e) {
      return res.fail(e.message, e.statusCode || 400);
    }

    const sampleId =
      profileId ||
      (c.audienceProfileIds && c.audienceProfileIds[0]) ||
      null;
    if (!sampleId) {
      return res.fail("Provide profileId or audience on campaign", 400);
    }

    const auth = req.headers.authorization || req.headers.Authorization;
    const profiles = await fetchProfilesBatch({
      profileIds: [String(sampleId)],
      tenantId: req.tenantId,
      authorizationHeader: auth,
    });
    const profile = profiles[0];
    if (!profile) return res.fail("Profile not found", 404);

    const map = buildPersonalizationMap(profile, String(c._id));
    const rendered = applyTemplate(mailTpl, map);

    await sendSesMessage({
      fromAddress: c.fromEmail || undefined,
      toAddress: toEmail.trim(),
      subject: `[TEST] ${rendered.subject}`,
      htmlBody: rendered.html,
      textBody: rendered.text,
      attachments: c.attachments || [],
      configurationSetName: c.configurationSetName || undefined,
      tags: { campaignId: String(c._id), memberId: String(sampleId) },
    });

    res.success({}, "Test email queued");
  } catch (e) {
    next(e);
  }
}

export async function getCampaignRecipients(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }
    const { id } = req.params;
    validateObjectId(id, "id");
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const exists = await Campaign.exists({ _id: id, tenantId: req.tenantId });
    if (!exists) return res.notFoundRecord("Campaign not found");

    const cid = new mongoose.Types.ObjectId(String(id));
    const [items, total] = await Promise.all([
      CampaignRecipient.find({ campaignId: cid })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CampaignRecipient.countDocuments({ campaignId: cid }),
    ]);

    res.success({ recipients: items, page, limit, total }, "OK");
  } catch (e) {
    next(e);
  }
}

export async function getUnsubscribe(req, res, next) {
  try {
    const { p, c, t } = req.query;
    if (!p || !c || !t) {
      return res.fail("Missing parameters", 400);
    }
    validateObjectId(String(p), "p");
    validateObjectId(String(c), "c");
    if (!verifyUnsubscribeToken(String(p), String(c), String(t))) {
      return res.fail("Invalid or expired link", 400);
    }

    await CampaignRecipient.updateMany(
      { campaignId: new mongoose.Types.ObjectId(String(c)), memberId: String(p) },
      { $set: { suppressed: true, suppressedAt: new Date() } }
    );

    res.success(
      { ok: true, message: "You have been unsubscribed from this campaign." },
      "OK"
    );
  } catch (e) {
    next(e);
  }
}

export async function postDraftPreview(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }
    const { emailTemplateId, profileId } = req.body || {};
    if (!emailTemplateId || !profileId) {
      return res.fail("emailTemplateId and profileId are required", 400);
    }
    validateObjectId(String(emailTemplateId), "emailTemplateId");
    validateObjectId(String(profileId), "profileId");

    let mailTpl;
    try {
      mailTpl = await loadEmailTemplateOrFail(emailTemplateId, req.tenantId);
    } catch (e) {
      return res.fail(e.message, e.statusCode || 400);
    }

    const auth = req.headers.authorization || req.headers.Authorization;
    const profiles = await fetchProfilesBatch({
      profileIds: [String(profileId)],
      tenantId: req.tenantId,
      authorizationHeader: auth,
    });
    const profile = profiles[0];
    if (!profile) return res.fail("Profile not found", 404);

    const map = buildPersonalizationMap(profile, "preview");
    const rendered = applyTemplate(mailTpl, map);
    res.success(
      {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      },
      "OK"
    );
  } catch (e) {
    next(e);
  }
}

export async function postDraftTestEmail(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }
    const { emailTemplateId, profileId, toEmail } = req.body || {};
    if (!emailTemplateId || !profileId || !toEmail) {
      return res.fail("emailTemplateId, profileId, and toEmail are required", 400);
    }
    validateObjectId(String(emailTemplateId), "emailTemplateId");
    validateObjectId(String(profileId), "profileId");

    let mailTpl;
    try {
      mailTpl = await loadEmailTemplateOrFail(emailTemplateId, req.tenantId);
    } catch (e) {
      return res.fail(e.message, e.statusCode || 400);
    }

    const auth = req.headers.authorization || req.headers.Authorization;
    const profiles = await fetchProfilesBatch({
      profileIds: [String(profileId)],
      tenantId: req.tenantId,
      authorizationHeader: auth,
    });
    const profile = profiles[0];
    if (!profile) return res.fail("Profile not found", 404);

    const map = buildPersonalizationMap(profile, "preview");
    const rendered = applyTemplate(mailTpl, map);

    await sendSesMessage({
      toAddress: String(toEmail).trim(),
      subject: `[TEST] ${rendered.subject}`,
      htmlBody: rendered.html,
      textBody: rendered.text,
      tags: { campaignId: "preview", memberId: String(profileId) },
    });

    res.success({}, "Test email sent");
  } catch (e) {
    next(e);
  }
}

export async function postProcessDue(req, res, next) {
  try {
    const secret = process.env.PROCESS_CAMPAIGN_SECRET;
    if (!secret || req.headers["x-process-secret"] !== secret) {
      return res.status(403).json({
        status: "fail",
        message: "Forbidden",
        timestamp: new Date().toISOString(),
      });
    }
    const n = await processScheduledCampaigns(null);
    res.success(n, "OK");
  } catch (e) {
    next(e);
  }
}
