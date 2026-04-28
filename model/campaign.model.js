import mongoose from "mongoose";

const AttachmentSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    contentType: { type: String, default: "application/octet-stream" },
    contentBase64: { type: String, required: true },
  },
  { _id: false }
);

const CampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    audienceProfileIds: [{ type: String }],
    emailTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "templates",
      required: true,
      index: true,
    },
    attachments: { type: [AttachmentSchema], default: [] },
    scheduledAt: { type: Date, default: null },
    createdBy: { type: String, default: null },
    tenantId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["draft", "scheduled", "processing", "sent", "failed", "cancelled"],
      default: "draft",
      index: true,
    },
    fromEmail: { type: String, default: null },
    configurationSetName: { type: String, default: null },
    batchSize: { type: Number, default: 14 },
    stats: {
      totalRecipients: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      bounced: { type: Number, default: 0 },
      complaints: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skippedOptOut: { type: Number, default: 0 },
    },
    lastError: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "campaigns" }
);

CampaignSchema.index({ tenantId: 1, status: 1, scheduledAt: 1 });

CampaignSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("Campaign", CampaignSchema);
