import { Router } from "express";
import {
  createCampaign,
  listCampaigns,
  getCampaign,
  patchCampaignCancel,
  postCampaignSend,
  postCampaignPreview,
  postCampaignTestEmail,
  getCampaignRecipients,
  getUnsubscribe,
  postProcessDue,
  postDraftPreview,
  postDraftTestEmail,
} from "../controllers/campaign.controller.js";
import { defaultPolicyMiddleware } from "../middlewares/policy.middleware.js";
import { tenantContextWarn } from "../middlewares/tenantContext.mw.js";
import { requireCrmUser } from "../middlewares/requireCrmUser.js";

const router = Router();

router.get("/unsubscribe", getUnsubscribe);
router.post("/system/process-due", postProcessDue);

router.post(
  "/draft/preview",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  requireCrmUser,
  postDraftPreview
);
router.post(
  "/draft/test-email",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  tenantContextWarn,
  requireCrmUser,
  postDraftTestEmail
);

router.post(
  "/",
  defaultPolicyMiddleware.requirePermission("communication", "create"),
  tenantContextWarn,
  requireCrmUser,
  createCampaign
);
router.get(
  "/",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  requireCrmUser,
  listCampaigns
);
router.get(
  "/:id/recipients",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  requireCrmUser,
  getCampaignRecipients
);
router.post(
  "/:id/preview",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  requireCrmUser,
  postCampaignPreview
);
router.post(
  "/:id/test-email",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  tenantContextWarn,
  requireCrmUser,
  postCampaignTestEmail
);
router.post(
  "/:id/send",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  tenantContextWarn,
  requireCrmUser,
  postCampaignSend
);
router.patch(
  "/:id/cancel",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  tenantContextWarn,
  requireCrmUser,
  patchCampaignCancel
);
router.get(
  "/:id",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  requireCrmUser,
  getCampaign
);

export default router;
