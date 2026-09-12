import { Router } from "express";
import { generateLetter, generateLetterInternal } from "../controllers/letter.controller.js";
import { defaultPolicyMiddleware } from "../middlewares/policy.middleware.js";

const router = Router();

router.post(
  "/generate",
  defaultPolicyMiddleware.requirePermission("communication", "create"),
  generateLetter
);

// System-triggered (no originating user) - guarded by requireInternal()
// inside the controller instead of requirePermission, matching
// correspondence.controller.js's /internal/letters/* routes. Path contains
// "internal/" so the root enforce-hard-rules.mjs hook's "every new route
// needs requirePermission" check doesn't flag this one.
router.post("/internal/generate", generateLetterInternal);

export default router;
