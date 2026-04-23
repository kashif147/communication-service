import mongoose from "mongoose";

const OUTBOUND_CHANNELS = ["email", "sms", "letter", "in_app"];

const OutboundCommunicationSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    reminderBatchId: { type: String, required: true, trim: true, index: true },
    profileId: { type: String, required: true, trim: true, index: true },
    channel: {
      type: String,
      enum: OUTBOUND_CHANNELS,
      required: true,
    },
    templateKey: { type: String, default: null, trim: true },
    status: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
      index: true,
    },
    providerMessageId: { type: String, default: null, trim: true },
    error: { type: String, default: null, trim: true },
    idempotencyKey: { type: String, default: null, trim: true, index: true },
  },
  { timestamps: true, collection: "outbound_communications" }
);

OutboundCommunicationSchema.index(
  { tenantId: 1, reminderBatchId: 1, profileId: 1, channel: 1 },
  { unique: false }
);
OutboundCommunicationSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true }
);

export default mongoose.model(
  "OutboundCommunication",
  OutboundCommunicationSchema
);
