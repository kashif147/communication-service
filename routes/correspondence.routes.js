import { Router } from "express";
import {
  getLetterInternalById,
  downloadLetterBufferInternal,
  listLettersByProfile,
  listCorrespondenceByProfile,
} from "../controllers/correspondence.controller.js";
import { defaultPolicyMiddleware } from "../middlewares/policy.middleware.js";
import { tenantContextWarn } from "../middlewares/tenantContext.mw.js";
import { internalOrUserRead } from "../middlewares/internalCaller.js";

const router = Router();

// Internal (service-to-service) letter fetch. internalOrUserRead: an
// internal-only caller (x-internal-request, no user identity) is scoped to its
// x-tenant-id header; a user session goes through requirePermission +
// the tenant guard and then needs CRM or ownership (see controller).
router.get(
  "/internal/letters/:letterId",
  internalOrUserRead,
  getLetterInternalById
);
router.get(
  "/internal/letters/:letterId/content",
  internalOrUserRead,
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
