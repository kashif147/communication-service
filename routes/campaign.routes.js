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

const router = Router();

router.get("/unsubscribe", getUnsubscribe);
router.post("/system/process-due", postProcessDue);

router.post(
  "/draft/preview",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  postDraftPreview
);
router.post(
  "/draft/test-email",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  tenantContextWarn,
  postDraftTestEmail
);

router.post(
  "/",
  defaultPolicyMiddleware.requirePermission("communication", "create"),
  tenantContextWarn,
  createCampaign
);
router.get(
  "/",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  listCampaigns
);
router.get(
  "/:id/recipients",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  getCampaignRecipients
);
router.post(
  "/:id/preview",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  postCampaignPreview
);
router.post(
  "/:id/test-email",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  tenantContextWarn,
  postCampaignTestEmail
);
router.post(
  "/:id/send",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  tenantContextWarn,
  postCampaignSend
);
router.patch(
  "/:id/cancel",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  tenantContextWarn,
  patchCampaignCancel
);
router.get(
  "/:id",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  getCampaign
);

export default router;
