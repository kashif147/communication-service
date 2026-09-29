import { Router } from "express";
import {
  getBookmarkFields,
  createBookmarkField,
  updateBookmarkField,
  deleteBookmarkField,
} from "../controllers/bookmark.controller.js";
import { defaultPolicyMiddleware } from "../middlewares/policy.middleware.js";
import { tenantContextWarn } from "../middlewares/tenantContext.mw.js";

const router = Router();

router.get(
  "/fields",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  getBookmarkFields
);
router.post(
  "/fields",
  defaultPolicyMiddleware.requirePermission("communication", "create"),
  tenantContextWarn,
  createBookmarkField
);
router.put(
  "/fields/:id",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  tenantContextWarn,
  updateBookmarkField
);
router.delete(
  "/fields/:id",
  defaultPolicyMiddleware.requirePermission("communication", "delete"),
  tenantContextWarn,
  deleteBookmarkField
);

export default router;
