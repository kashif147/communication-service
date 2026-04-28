import mongoose from "mongoose";

const CampaignRecipientSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    tenantId: { type: String, required: true, index: true },
    memberId: { type: String, required: true },
    email: { type: String, required: true },
    status: {
      type: String,
      enum: [
        "pending",
        "queued",
        "sent",
        "failed",
        "delivered",
        "bounced",
        "complained",
        "suppressed",
      ],
      default: "pending",
      index: true,
    },
    sentAt: { type: Date, default: null },
    deliveryStatus: { type: String, default: null },
    sesMessageId: { type: String, default: null, index: true },
    errorMessage: { type: String, default: null },
    retryCount: { type: Number, default: 0 },
    suppressed: { type: Boolean, default: false },
    suppressedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "campaign_recipients" }
);

CampaignRecipientSchema.index(
  { campaignId: 1, memberId: 1 },
  { unique: true }
);

CampaignRecipientSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("CampaignRecipient", CampaignRecipientSchema);
