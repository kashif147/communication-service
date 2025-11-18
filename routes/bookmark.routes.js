import { Router } from "express";
import {
  getBookmarkFields,
  createBookmarkField,
  updateBookmarkField,
  deleteBookmarkField,
} from "../controllers/bookmark.controller.js";

const router = Router();

router.get("/fields", getBookmarkFields);
router.post("/fields", createBookmarkField);
router.put("/fields/:id", updateBookmarkField);
router.delete("/fields/:id", deleteBookmarkField);

export default router;
