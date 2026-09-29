import { Router } from "express";
import {
  getLetterInternalById,
  downloadLetterBufferInternal,
  listLettersByProfile,
  listCorrespondenceByProfile,
} from "../controllers/correspondence.controller.js";
import { defaultPolicyMiddleware } from "../middlewares/policy.middleware.js";
import { tenantContextWarn } from "../middlewares/tenantContext.mw.js";

const router = Router();

router.get(
  "/internal/letters/:letterId",
  getLetterInternalById
);
router.get(
  "/internal/letters/:letterId/content",
  downloadLetterBufferInternal
);

router.get(
  "/letters/profile/:profileId",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  listLettersByProfile
);

router.get(
  "/correspondence/profile/:profileId",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  listCorrespondenceByProfile
);

export default router;
