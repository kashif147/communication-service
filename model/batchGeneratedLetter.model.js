import mongoose from "mongoose";

const BatchGeneratedLetterSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    reminderBatchId: { type: String, required: true, trim: true, index: true },
    templateId: { type: String, default: null, trim: true },
    blobPath: { type: String, default: null, trim: true },
    contentType: { type: String, default: null, trim: true },
    memberCount: { type: Number, default: 0 },
    createdBy: { type: String, default: null, trim: true },
  },
  { timestamps: true, collection: "batch_generated_letters" }
);

BatchGeneratedLetterSchema.index({ tenantId: 1, reminderBatchId: 1 });

export default mongoose.model(
  "BatchGeneratedLetter",
  BatchGeneratedLetterSchema
);
