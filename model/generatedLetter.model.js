import mongoose from "mongoose";

const GeneratedLetterSchema = new mongoose.Schema({
  memberId: String,
  templateId: String,
  fileName: String,
  blobPath: String,
  contentType: String,
  tenantId: String,
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("generated_letters", GeneratedLetterSchema);
