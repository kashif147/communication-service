import mongoose from "mongoose";

const BookmarkFieldSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  label: { type: String },
  path: { type: String },
  dataType: { type: String, enum: ["string", "date", "number"] },
});

export default mongoose.model("bookmark_fields", BookmarkFieldSchema);
