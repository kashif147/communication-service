import mongoose from "mongoose";

const GeneratedLetterSchema = new mongoose.Schema({
  memberId: String,
  profileId: { type: String, index: true },
  templateId: String,
  templateName: String,
  fileName: String,
  blobPath: String,
  contentType: String,
  tenantId: String,
  createdBy: String,
  source: { type: String, default: null, index: true },
  sourceKey: { type: String, default: null, index: true },
  displayName: { type: String, default: null },
  subscriptionId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

GeneratedLetterSchema.index({ tenantId: 1, profileId: 1, createdAt: -1 });
GeneratedLetterSchema.index(
  { tenantId: 1, sourceKey: 1 },
  { unique: true, sparse: true }
);

export default mongoose.model("generated_letters", GeneratedLetterSchema);
