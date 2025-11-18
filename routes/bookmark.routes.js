import { Router } from "express";
import {
  getBookmarkFields,
  createBookmarkField,
  updateBookmarkField,
  deleteBookmarkField,
} from "../controllers/bookmark.controller.js";
import { defaultPolicyMiddleware } from "../middlewares/policy.middleware.js";

const router = Router();

router.get(
  "/fields",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  getBookmarkFields
);
router.post(
  "/fields",
  defaultPolicyMiddleware.requirePermission("communication", "create"),
  createBookmarkField
);
router.put(
  "/fields/:id",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  updateBookmarkField
);
router.delete(
  "/fields/:id",
  defaultPolicyMiddleware.requirePermission("communication", "delete"),
  deleteBookmarkField
);

export default router;
