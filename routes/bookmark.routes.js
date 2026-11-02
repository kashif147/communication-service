import { Router } from "express";
import {
  getBookmarkFields,
  createBookmarkField,
  updateBookmarkField,
  deleteBookmarkField,
} from "../controllers/bookmark.controller.js";
import { defaultPolicyMiddleware } from "../middlewares/policy.middleware.js";
import { tenantContextWarn } from "../middlewares/tenantContext.mw.js";
import { requireCrmUser } from "../middlewares/requireCrmUser.js";

const router = Router();

router.get(
  "/fields",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  requireCrmUser,
  getBookmarkFields
);
router.post(
  "/fields",
  defaultPolicyMiddleware.requirePermission("communication", "create"),
  tenantContextWarn,
  requireCrmUser,
  createBookmarkField
);
router.put(
  "/fields/:id",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  tenantContextWarn,
  requireCrmUser,
  updateBookmarkField
);
router.delete(
  "/fields/:id",
  defaultPolicyMiddleware.requirePermission("communication", "delete"),
  tenantContextWarn,
  requireCrmUser,
  deleteBookmarkField
);

export default router;
