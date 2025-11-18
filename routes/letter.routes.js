import { Router } from "express";
import { generateLetter } from "../controllers/letter.controller.js";
import { defaultPolicyMiddleware } from "../middlewares/policy.middleware.js";

const router = Router();

router.post(
  "/generate",
  defaultPolicyMiddleware.requirePermission("communication", "create"),
  generateLetter
);

export default router;
