import Template from "../model/template.model.js";
import {
  getOneDriveFile,
  uploadOneDriveFile,
} from "../services/onedrive.service.js";
import PizZip from "pizzip";
import pkg from "docxtemplater/expressions.js";
const { extractExpressions } = pkg;
import {
  validateObjectId,
  sanitizeString,
} from "../middlewares/validateInput.js";

export async function uploadTemplate(req, res, next) {
  try {
    // Validate userId and tenantId are available from token
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    if (!req.file) {
      return res.fail("No file uploaded. Please upload a .docx file", 400);
    }

    // Remove 'id' from body if present (not used for upload endpoint, causes validation errors)
    if (req.body.id) {
      delete req.body.id;
    }

    const { name, description, category, tempolateType } = req.body;
    const file = req.file;

    // Validate file type
    if (
      !file.mimetype.includes("wordprocessingml") &&
      !file.originalname.endsWith(".docx")
    ) {
      return res.fail("Invalid file type. Only .docx files are allowed", 400);
    }

    if (!name) {
      return res.fail("name is required", 400);
    }

    if (!tempolateType) {
      return res.fail("tempolateType is required", 400);
    }

    const sanitizedName = sanitizeString(name, 200);
    const sanitizedDescription = description
      ? sanitizeString(description, 500)
      : undefined;
    const sanitizedCategory = category
      ? sanitizeString(category, 100)
      : undefined;
    const sanitizedTempolateType = sanitizeString(tempolateType, 100);

    // Upload to OneDrive
    const oneDriveFile = await uploadOneDriveFile(
      file.buffer,
      file.originalname,
      req.token
    );

    // Create template record
    const template = await Template.create({
      name: sanitizedName,
      description: sanitizedDescription,
      category: sanitizedCategory,
      tempolateType: sanitizedTempolateType,
      fileId: oneDriveFile.fileId,
      placeholders: [], // Initialize as empty array
      createdBy: req.userId, // From token
      tenantId: req.tenantId, // From token
    });

    res.created({ template }, "Template uploaded successfully");
  } catch (error) {
    next(error);
  }
}

export async function getTemplates(req, res, next) {
  try {
    // Validate userId and tenantId are available from token
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { category, tempolateType } = req.query;
    const filter = {
      tenantId: req.tenantId, // Always filter by tenant from token
    };

    if (category) {
      filter.category = sanitizeString(category, 100);
    }

    if (tempolateType) {
      filter.tempolateType = sanitizeString(tempolateType, 100);
    }

    const templates = await Template.find(filter).sort({ createdAt: -1 });

    res.success({ templates }, "Templates retrieved successfully");
  } catch (error) {
    next(error);
  }
}

export async function getTemplate(req, res, next) {
  try {
    // Validate userId and tenantId are available from token
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { id } = req.params;

    validateObjectId(id, "id");

    // Ensure template belongs to user's tenant
    const template = await Template.findOne({
      _id: id,
      tenantId: req.tenantId, // Tenant isolation
    });

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
    // Validate userId and tenantId are available from token
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { id } = req.params;
    const { name, description, category, tempolateType } = req.body;

    validateObjectId(id, "id");

    // Ensure template belongs to user's tenant
    const template = await Template.findOne({
      _id: id,
      tenantId: req.tenantId, // Tenant isolation
    });

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
      updateData.description = description
        ? sanitizeString(description, 500)
        : null;
    }
    if (category !== undefined) {
      updateData.category = category ? sanitizeString(category, 100) : null;
    }
    if (tempolateType !== undefined) {
      const sanitizedTempolateType = sanitizeString(tempolateType, 100);
      if (!sanitizedTempolateType) {
        return res.fail("Invalid input: tempolateType cannot be empty", 400);
      }
      updateData.tempolateType = sanitizedTempolateType;
    }

    const updatedTemplate = await Template.findOneAndUpdate(
      { _id: id, tenantId: req.tenantId }, // Tenant isolation
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedTemplate) {
      return res.notFound("Template not found", { id });
    }

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
    // Validate userId and tenantId are available from token
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { id } = req.params;

    validateObjectId(id, "id");

    // Ensure template belongs to user's tenant
    const template = await Template.findOneAndDelete({
      _id: id,
      tenantId: req.tenantId, // Tenant isolation
    });

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
    // Validate userId and tenantId are available from token
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { id } = req.params;

    validateObjectId(id, "id");

    // Ensure template belongs to user's tenant
    const template = await Template.findOne({
      _id: id,
      tenantId: req.tenantId, // Tenant isolation
    });

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
