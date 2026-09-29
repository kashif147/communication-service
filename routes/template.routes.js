import { Router } from "express";
import {
  uploadTemplate,
  getTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  extractPlaceholders,
  testGraphToken,
  createEmailTemplateRecord,
} from "../controllers/template.controller.js";
import { upload } from "../middlewares/upload.mw.js";
import { defaultPolicyMiddleware } from "../middlewares/policy.middleware.js";
import { tenantContextWarn } from "../middlewares/tenantContext.mw.js";

const router = Router();

function optionalDocxUpload(req, res, next) {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) {
    return upload.single("file")(req, res, next);
  }
  return next();
}

router.post(
  "/upload",
  defaultPolicyMiddleware.requirePermission("communication", "create"),
  tenantContextWarn,
  upload.single("file"),
  uploadTemplate
);
router.get(
  "/",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  getTemplates
);
router.post(
  "/email",
  defaultPolicyMiddleware.requirePermission("communication", "create"),
  tenantContextWarn,
  createEmailTemplateRecord
);
router.get(
  "/:id",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  getTemplate
);
router.put(
  "/:id",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  tenantContextWarn,
  optionalDocxUpload,
  updateTemplate
);
router.delete(
  "/:id",
  defaultPolicyMiddleware.requirePermission("communication", "delete"),
  tenantContextWarn,
  deleteTemplate
);
router.post(
  "/:id/extract-placeholders",
  defaultPolicyMiddleware.requirePermission("communication", "write"),
  tenantContextWarn,
  extractPlaceholders
);
router.get(
  "/test-graph-token",
  defaultPolicyMiddleware.requirePermission("communication", "read"),
  tenantContextWarn,
  testGraphToken
);

export default router;
