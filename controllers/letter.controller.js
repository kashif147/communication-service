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
    // Validate userId and tenantId are available from token
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { memberId, templateId } = req.body;

    if (!memberId || !templateId) {
      return res.fail("memberId and templateId are required", 400);
    }

    // Validate ObjectId format to prevent NoSQL injection
    validateObjectId(templateId, "templateId");
    validateObjectId(memberId, "memberId");

    // Find template and ensure it belongs to user's tenant
    const template = await Template.findOne({
      _id: templateId,
      tenantId: req.tenantId, // Tenant isolation - only templates from user's tenant
    });

    if (!template) {
      return res.notFound("Template not found or access denied", { templateId });
    }

    const templateBuffer = await getOneDriveFile(template.fileId, req.token);
    const memberData = await collectMemberData(memberId);
    const mergedDoc = mergeTemplate(templateBuffer, memberData);

    const fileName = `letter-${randomUUID()}.docx`;
    const blobPath = `${req.tenantId}/${memberId}/${fileName}`;

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
      tenantId: req.tenantId, // From token
      createdBy: req.userId, // From token
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
