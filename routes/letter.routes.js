import { Router } from "express";
import { generateLetter } from "../controllers/letter.controller.js";

const router = Router();

router.post("/generate", generateLetter);

export default router;
