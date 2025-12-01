import mongoose from "mongoose";

const TemplateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  fileId: { type: String, required: true },
  tempolateType: { type: String, required: true },
  category: String,
  placeholders: { type: [String], default: [] },
  createdBy: String,
  tenantId: String,
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("templates", TemplateSchema);
