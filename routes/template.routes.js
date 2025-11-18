import { Router } from "express";
import {
  uploadTemplate,
  getTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  extractPlaceholders,
} from "../controllers/template.controller.js";
import { upload } from "../middlewares/upload.mw.js";

const router = Router();

router.post("/upload", upload.single("file"), uploadTemplate);
router.get("/", getTemplates);
router.get("/:id", getTemplate);
router.put("/:id", updateTemplate);
router.delete("/:id", deleteTemplate);
router.post("/:id/extract-placeholders", extractPlaceholders);

export default router;
