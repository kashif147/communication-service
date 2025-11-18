import Template from "../model/template.model.js";
import { getOneDriveFile, uploadOneDriveFile } from "../services/onedrive.service.js";
import PizZip from "pizzip";
import { extractExpressions } from "docxtemplater/expressions.js";
import { validateObjectId, sanitizeString } from "../middlewares/validateInput.js";

export async function uploadTemplate(req, res, next) {
  try {
    if (!req.file) {
      return res.fail("No file uploaded. Please upload a .docx file", 400);
    }

    const { name, description, category } = req.body;
    const file = req.file;

    // Validate file type
    if (!file.mimetype.includes("wordprocessingml") && !file.originalname.endsWith(".docx")) {
      return res.fail("Invalid file type. Only .docx files are allowed", 400);
    }

    if (!name) {
      return res.fail("name is required", 400);
    }

    const sanitizedName = sanitizeString(name, 200);
    const sanitizedDescription = description ? sanitizeString(description, 500) : undefined;
    const sanitizedCategory = category ? sanitizeString(category, 100) : undefined;

    // Upload to OneDrive
    const oneDriveFile = await uploadOneDriveFile(file.buffer, file.originalname, req.token);

    // Create template record
    const template = await Template.create({
      name: sanitizedName,
      description: sanitizedDescription,
      category: sanitizedCategory,
      fileId: oneDriveFile.fileId,
      createdBy: req.userId || req.user?.id,
      tenantId: req.tenantId || "default",
    });

    res.created({ template }, "Template uploaded successfully");
  } catch (error) {
    next(error);
  }
}

export async function getTemplates(req, res, next) {
  try {
    const { category, tenantId } = req.query;
    const filter = {};

    if (tenantId) {
      filter.tenantId = tenantId;
    } else if (req.tenantId) {
      filter.tenantId = req.tenantId;
    }

    if (category) {
      filter.category = sanitizeString(category, 100);
    }

    const templates = await Template.find(filter).sort({ createdAt: -1 });

    res.success({ templates }, "Templates retrieved successfully");
  } catch (error) {
    next(error);
  }
}

export async function getTemplate(req, res, next) {
  try {
    const { id } = req.params;

    validateObjectId(id, "id");

    const template = await Template.findById(id);
    if (!template) {
      return res.notFound("Template not found", { id });
    }

    res.success({ template }, "Template retrieved successfully");
  } catch (error) {
    next(error);
  }
}

export async function updateTemplate(req, res, next) {
  try {
    const { id } = req.params;
    const { name, description, category } = req.body;

    validateObjectId(id, "id");

    const template = await Template.findById(id);
    if (!template) {
      return res.notFound("Template not found", { id });
    }

    const updateData = {};
    if (name !== undefined) {
      const sanitizedName = sanitizeString(name, 200);
      if (!sanitizedName) {
        return res.fail("Invalid input: name cannot be empty", 400);
      }
      updateData.name = sanitizedName;
    }
    if (description !== undefined) {
      updateData.description = description ? sanitizeString(description, 500) : null;
    }
    if (category !== undefined) {
      updateData.category = category ? sanitizeString(category, 100) : null;
    }

    const updatedTemplate = await Template.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });

    res.success({ template: updatedTemplate }, "Template updated successfully");
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.fail(error.message, 400);
    }
    next(error);
  }
}

export async function deleteTemplate(req, res, next) {
  try {
    const { id } = req.params;

    validateObjectId(id, "id");

    const template = await Template.findByIdAndDelete(id);
    if (!template) {
      return res.notFound("Template not found", { id });
    }

    res.success({}, "Template deleted successfully");
  } catch (error) {
    next(error);
  }
}

export async function extractPlaceholders(req, res, next) {
  try {
    const { id } = req.params;

    validateObjectId(id, "id");

    const template = await Template.findById(id);
    if (!template) {
      return res.notFound("Template not found", { id });
    }

    const buffer = await getOneDriveFile(template.fileId, req.token);
    const zip = new PizZip(buffer);
    const placeholders = extractExpressions(zip);

    template.placeholders = placeholders;
    await template.save();

    res.success({ placeholders }, "Placeholders extracted successfully");
  } catch (error) {
    next(error);
  }
}
