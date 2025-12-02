import { Router } from "express";
import {
  uploadTemplate,
  getTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  extractPlaceholders,
  testGraphToken,
} from "../controllers/template.controller.js";
import { upload } from "../middlewares/upload.mw.js";
import { defaultPolicyMiddleware } from "../middlewares/policy.middleware.js";

const router = Router();

router.post(
  "/upload",
  defaultPolicyMiddleware.requirePermission("communication", "create"),
  upload.single("file"),
  uploadTemplate
);
router.get(
  "/",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  getTemplates
);
router.get(
  "/:id",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  getTemplate
);
router.put(
  "/:id",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  upload.single("file"),
  updateTemplate
);
router.delete(
  "/:id",
  defaultPolicyMiddleware.requirePermission("communication", "delete"),
  deleteTemplate
);
router.post(
  "/:id/extract-placeholders",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  extractPlaceholders
);
router.get(
  "/test-graph-token",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  testGraphToken
);

export default router;
