import Template from "../model/template.model.js";
import GeneratedLetter from "../model/generatedLetter.model.js";
import { getOneDriveFile } from "../services/onedrive.service.js";
import { mergeTemplate } from "../services/mailMerge.service.js";
import {
  uploadLetter,
  generateDownloadUrl,
} from "../services/azureBlob.service.js";
import { collectMemberData } from "../services/memberData.service.js";
import { randomUUID } from "crypto";
import {
  validateObjectId,
  sanitizeString,
} from "../middlewares/validateInput.js";

export async function generateLetter(req, res, next) {
  try {
    const { memberId, templateId } = req.body;

    if (!memberId || !templateId) {
      return res.fail("memberId and templateId are required", 400);
    }

    // Validate ObjectId format to prevent NoSQL injection
    validateObjectId(templateId, "templateId");
    validateObjectId(memberId, "memberId");

    const template = await Template.findById(templateId);
    if (!template) {
      return res.notFound("Template not found", { templateId });
    }

    const templateBuffer = await getOneDriveFile(template.fileId, req.token);
    const memberData = await collectMemberData(memberId);
    const mergedDoc = mergeTemplate(templateBuffer, memberData);

    const fileName = `letter-${randomUUID()}.docx`;
    const blobPath = `${req.tenantId || "default"}/${memberId}/${fileName}`;

    await uploadLetter(
      blobPath,
      mergedDoc,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    const record = await GeneratedLetter.create({
      memberId,
      templateId,
      fileName,
      blobPath,
      contentType: "docx",
      tenantId: req.tenantId || "default",
    });

    const downloadUrl = generateDownloadUrl(blobPath);

    res.created(
      {
        downloadUrl,
        letterId: record._id,
        fileName,
      },
      "Letter generated successfully"
    );
  } catch (error) {
    next(error);
  }
}
