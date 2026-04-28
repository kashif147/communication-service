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

const router = Router();

router.get("/unsubscribe", getUnsubscribe);
router.post("/system/process-due", postProcessDue);

router.post(
  "/draft/preview",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  postDraftPreview
);
router.post(
  "/draft/test-email",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  postDraftTestEmail
);

router.post(
  "/",
  defaultPolicyMiddleware.requirePermission("communication", "create"),
  createCampaign
);
router.get(
  "/",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  listCampaigns
);
router.get(
  "/:id/recipients",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  getCampaignRecipients
);
router.post(
  "/:id/preview",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  postCampaignPreview
);
router.post(
  "/:id/test-email",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  postCampaignTestEmail
);
router.post(
  "/:id/send",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  postCampaignSend
);
router.patch(
  "/:id/cancel",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  patchCampaignCancel
);
router.get(
  "/:id",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  getCampaign
);

export default router;
