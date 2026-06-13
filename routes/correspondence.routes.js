import { Router } from "express";
import {
  getLetterInternalById,
  downloadLetterBufferInternal,
  listLettersByProfile,
  listCorrespondenceByProfile,
} from "../controllers/correspondence.controller.js";
import { defaultPolicyMiddleware } from "../middlewares/policy.middleware.js";

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
  listLettersByProfile
);

router.get(
  "/correspondence/profile/:profileId",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  listCorrespondenceByProfile
);

export default router;
