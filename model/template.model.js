import mongoose from "mongoose";

const TemplateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  /** OneDrive file id for Word templates; null for Email (SES) templates. */
  fileId: { type: String, default: null },
  tempolateType: { type: String, required: true },
  category: String,
  placeholders: { type: [String], default: [] },
  /** SES / bulk email when tempolateType is "Email" */
  subject: { type: String, default: null },
  htmlBody: { type: String, default: null },
  textBody: { type: String, default: null },
  createdBy: String,
  tenantId: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

TemplateSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("templates", TemplateSchema);
