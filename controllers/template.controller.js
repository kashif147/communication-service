import Template from "../model/template.model.js";
import BookmarkField from "../model/bookmarkField.model.js";
import {
  getOneDriveFile,
  uploadOneDriveFile,
  updateOneDriveFile,
} from "../services/onedrive.service.js";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import {
  validateObjectId,
  sanitizeString,
} from "../middlewares/validateInput.js";
import logger from "../config/logger.js";
import { getGraphToken } from "../services/graphAuth.service.js";

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

    const { name, description, category, tempolateType, placeholders } =
      req.body;
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

    // Get bookmark field keys for validation (placeholders should match bookmark keys)
    const bookmarkFields = await BookmarkField.find({}, { key: 1 });
    const validBookmarkKeys = bookmarkFields.map((f) => f.key);

    // Process placeholders - accept from body or extract from file
    // Placeholders should match bookmark field keys
    let templatePlaceholders = [];

    // If placeholders are provided in request body, use them
    if (placeholders) {
      let rawPlaceholders = [];

      if (Array.isArray(placeholders)) {
        rawPlaceholders = placeholders.filter(
          (p) => typeof p === "string" && p.trim().length > 0
        );
      } else if (typeof placeholders === "string") {
        // Try to parse as JSON array first
        try {
          const parsed = JSON.parse(placeholders);
          if (Array.isArray(parsed)) {
            rawPlaceholders = parsed.filter(
              (p) => typeof p === "string" && p.trim().length > 0
            );
          } else {
            // If not JSON array, treat as comma-separated string
            rawPlaceholders = placeholders
              .split(",")
              .map((p) => p.trim())
              .filter((p) => p.length > 0);
          }
        } catch (parseError) {
          // If JSON parse fails, treat as comma-separated string
          rawPlaceholders = placeholders
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
        }
      }

      // Validate placeholders against bookmark field keys
      const invalidPlaceholders = rawPlaceholders.filter(
        (p) => !validBookmarkKeys.includes(p)
      );

      if (invalidPlaceholders.length > 0) {
        logger.warn(
          {
            invalidPlaceholders,
            validBookmarkKeys: validBookmarkKeys.slice(0, 10),
            fileName: file.originalname,
          },
          "Some placeholders do not match bookmark field keys"
        );
      }

      templatePlaceholders = rawPlaceholders;
    } else {
      // If no placeholders provided, automatically extract from file during upload
      try {
        logger.debug(
          { fileName: file.originalname, fileSize: file.buffer.length },
          "Starting placeholder extraction from file"
        );

        const zip = new PizZip(file.buffer);

        // Extract placeholders by parsing document XML
        // Get the main document XML from the zip
        const documentXml = zip.files["word/document.xml"];
        if (!documentXml) {
          throw new Error("Invalid .docx file: word/document.xml not found");
        }

        const xmlContent = documentXml.asText();

        // Extract all {{placeholder}} patterns from the XML
        const placeholderRegex = /\{\{([^}]+)\}\}/g;
        const matches = xmlContent.match(placeholderRegex) || [];
        const extractedPlaceholders = [
          ...new Set(
            matches
              .map((match) => match.replace(/\{\{|\}\}/g, "").trim())
              .filter((p) => p.length > 0)
          ),
        ];

        logger.debug(
          {
            extractedRaw: extractedPlaceholders,
            extractedType: typeof extractedPlaceholders,
            isArray: Array.isArray(extractedPlaceholders),
          },
          "Raw extraction result from extractExpressions"
        );

        // extractExpressions returns an array of placeholder names (without curly braces)
        // e.g., {{forname}} becomes "forname"
        if (Array.isArray(extractedPlaceholders)) {
          templatePlaceholders = extractedPlaceholders.filter(
            (p) => p && typeof p === "string" && p.trim().length > 0
          );
        } else if (
          extractedPlaceholders &&
          typeof extractedPlaceholders === "object"
        ) {
          // Handle case where it might return an object with expressions
          const expressions =
            extractedPlaceholders.expressions || extractedPlaceholders;
          templatePlaceholders = Array.isArray(expressions)
            ? expressions.filter(
                (p) => p && typeof p === "string" && p.trim().length > 0
              )
            : [];
        } else {
          templatePlaceholders = [];
        }

        if (templatePlaceholders.length > 0) {
          // Validate placeholders against bookmark field keys
          const invalidPlaceholders = templatePlaceholders.filter(
            (p) => !validBookmarkKeys.includes(p)
          );

          if (invalidPlaceholders.length > 0) {
            logger.warn(
              {
                invalidPlaceholders,
                validBookmarkKeys: validBookmarkKeys.slice(0, 10), // Log first 10 for reference
                fileName: file.originalname,
              },
              "Some placeholders do not match bookmark field keys"
            );
          }

          logger.info(
            {
              placeholderCount: templatePlaceholders.length,
              placeholders: templatePlaceholders,
              invalidPlaceholders:
                invalidPlaceholders.length > 0
                  ? invalidPlaceholders
                  : undefined,
              fileName: file.originalname,
            },
            "Placeholders automatically extracted from file during upload"
          );
        } else {
          logger.warn(
            { fileName: file.originalname },
            "No placeholders found in file during upload. Ensure placeholders are in {{placeholder}} format and match bookmark field keys."
          );
        }
      } catch (extractError) {
        // If extraction fails, log but don't fail the upload
        logger.error(
          {
            error: extractError.message,
            stack: extractError.stack,
            fileName: file.originalname,
          },
          "Failed to extract placeholders from file during upload"
        );
        templatePlaceholders = [];
      }
    }

    // Log final placeholders before saving
    logger.info(
      {
        placeholderCount: templatePlaceholders.length,
        placeholders: templatePlaceholders,
        fileName: file.originalname,
      },
      "Final placeholders to be saved with template"
    );

    // Upload to OneDrive
    const folderId = process.env.ONEDRIVE_TEMPLATE_FOLDER_ID || "root";
    const oneDriveFile = await uploadOneDriveFile(
      folderId,
      file.originalname,
      file.buffer,
      file.mimetype
    );

    // Create template record
    const template = await Template.create({
      name: sanitizedName,
      description: sanitizedDescription,
      category: sanitizedCategory,
      tempolateType: sanitizedTempolateType,
      fileId: oneDriveFile.fileId,
      placeholders: templatePlaceholders, // Ensure this is saved
      createdBy: req.userId, // From token
      tenantId: req.tenantId, // From token
    });

    // Verify placeholders were saved
    logger.info(
      {
        templateId: template._id,
        savedPlaceholders: template.placeholders,
        placeholderCount: template.placeholders?.length || 0,
      },
      "Template created with placeholders"
    );

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
      return res.notFoundRecord("Template not found");
    }

    const responseData = { template };

    // Always fetch and include file content as base64
    try {
      const fileBuffer = await getOneDriveFile(template.fileId);
      const fileBase64 = fileBuffer.toString("base64");
      responseData.fileContent = fileBase64;
      responseData.fileContentType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } catch (fileError) {
      // Log error but don't fail the request - template metadata is still returned
      logger.error(
        { error: fileError.message, fileId: template.fileId },
        "Failed to fetch file content for template"
      );
      responseData.fileContentError = "Failed to fetch file content";
    }

    res.success(responseData, "Template retrieved successfully");
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
    const { name, description, category, tempolateType, placeholders } =
      req.body;
    const file = req.file; // Optional file upload

    validateObjectId(id, "id");

    // Ensure template belongs to user's tenant
    const template = await Template.findOne({
      _id: id,
      tenantId: req.tenantId, // Tenant isolation
    });

    if (!template) {
      return res.notFoundRecord("Template not found");
    }

    const updateData = {};

    // Handle file upload if provided
    if (file) {
      // Validate file type
      if (
        !file.mimetype.includes("wordprocessingml") &&
        !file.originalname.endsWith(".docx")
      ) {
        return res.fail("Invalid file type. Only .docx files are allowed", 400);
      }

      // Get bookmark field keys for validation
      const bookmarkFields = await BookmarkField.find({}, { key: 1 });
      const validBookmarkKeys = bookmarkFields.map((f) => f.key);

      // Process placeholders - accept from body or extract from file
      let templatePlaceholders = [];

      // If placeholders are provided in request body, use them
      if (placeholders) {
        let rawPlaceholders = [];

        if (Array.isArray(placeholders)) {
          rawPlaceholders = placeholders.filter(
            (p) => typeof p === "string" && p.trim().length > 0
          );
        } else if (typeof placeholders === "string") {
          try {
            const parsed = JSON.parse(placeholders);
            if (Array.isArray(parsed)) {
              rawPlaceholders = parsed.filter(
                (p) => typeof p === "string" && p.trim().length > 0
              );
            } else {
              rawPlaceholders = placeholders
                .split(",")
                .map((p) => p.trim())
                .filter((p) => p.length > 0);
            }
          } catch (parseError) {
            rawPlaceholders = placeholders
              .split(",")
              .map((p) => p.trim())
              .filter((p) => p.length > 0);
          }
        }

        // Validate placeholders against bookmark field keys
        const invalidPlaceholders = rawPlaceholders.filter(
          (p) => !validBookmarkKeys.includes(p)
        );

        if (invalidPlaceholders.length > 0) {
          logger.warn(
            {
              invalidPlaceholders,
              validBookmarkKeys: validBookmarkKeys.slice(0, 10),
              fileName: file.originalname,
            },
            "Some placeholders do not match bookmark field keys"
          );
        }

        templatePlaceholders = rawPlaceholders;
      } else {
        // Extract placeholders from file
        try {
          logger.debug(
            { fileName: file.originalname, fileSize: file.buffer.length },
            "Starting placeholder extraction from updated file"
          );

          const zip = new PizZip(file.buffer);
          const documentXml = zip.files["word/document.xml"];
          if (!documentXml) {
            throw new Error("Invalid .docx file: word/document.xml not found");
          }

          const xmlContent = documentXml.asText();
          const placeholderRegex = /\{\{([^}]+)\}\}/g;
          const matches = xmlContent.match(placeholderRegex) || [];
          const extractedPlaceholders = [
            ...new Set(
              matches
                .map((match) => match.replace(/\{\{|\}\}/g, "").trim())
                .filter((p) => p.length > 0)
            ),
          ];

          if (Array.isArray(extractedPlaceholders)) {
            templatePlaceholders = extractedPlaceholders.filter(
              (p) => p && typeof p === "string" && p.trim().length > 0
            );
          }

          if (templatePlaceholders.length > 0) {
            const invalidPlaceholders = templatePlaceholders.filter(
              (p) => !validBookmarkKeys.includes(p)
            );

            if (invalidPlaceholders.length > 0) {
              logger.warn(
                {
                  invalidPlaceholders,
                  validBookmarkKeys: validBookmarkKeys.slice(0, 10),
                  fileName: file.originalname,
                },
                "Some placeholders do not match bookmark field keys"
              );
            }

            logger.info(
              {
                placeholderCount: templatePlaceholders.length,
                placeholders: templatePlaceholders,
                fileName: file.originalname,
              },
              "Placeholders extracted from updated file"
            );
          } else {
            logger.warn(
              { fileName: file.originalname },
              "No placeholders found in updated file"
            );
          }
        } catch (extractError) {
          logger.error(
            {
              error: extractError.message,
              stack: extractError.stack,
              fileName: file.originalname,
            },
            "Failed to extract placeholders from updated file"
          );
          templatePlaceholders = [];
        }
      }

      // Update existing file in OneDrive (replaces content, keeps same fileId)
      const oneDriveFile = await updateOneDriveFile(
        template.fileId,
        file.buffer,
        file.mimetype
      );

      // Update placeholders (fileId stays the same)
      updateData.placeholders = templatePlaceholders;

      logger.info(
        {
          templateId: id,
          fileId: oneDriveFile.fileId,
          placeholderCount: templatePlaceholders.length,
        },
        "Template file updated in OneDrive (existing file replaced)"
      );
    }

    // Update metadata fields
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

    // Only update if there's something to update
    if (Object.keys(updateData).length === 0) {
      return res.fail("No fields to update", 400);
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
      return res.notFoundRecord("Template not found");
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
      return res.notFoundRecord("Template not found");
    }

    const buffer = await getOneDriveFile(template.fileId);
    const zip = new PizZip(buffer);

    // Extract placeholders by parsing document XML
    const documentXml = zip.files["word/document.xml"];
    if (!documentXml) {
      throw new Error("Invalid .docx file: word/document.xml not found");
    }

    const xmlContent = documentXml.asText();

    // Extract all {{placeholder}} patterns from the XML
    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    const matches = xmlContent.match(placeholderRegex) || [];
    const extractedPlaceholders = [
      ...new Set(
        matches
          .map((match) => match.replace(/\{\{|\}\}/g, "").trim())
          .filter((p) => p.length > 0)
      ),
    ];

    // Ensure placeholders is an array and filter valid strings
    let placeholders = [];
    if (Array.isArray(extractedPlaceholders)) {
      placeholders = extractedPlaceholders.filter(
        (p) => p && typeof p === "string" && p.trim().length > 0
      );
    } else if (
      extractedPlaceholders &&
      typeof extractedPlaceholders === "object"
    ) {
      const expressions =
        extractedPlaceholders.expressions || extractedPlaceholders;
      placeholders = Array.isArray(expressions)
        ? expressions.filter(
            (p) => p && typeof p === "string" && p.trim().length > 0
          )
        : [];
    }

    template.placeholders = placeholders;
    await template.save();

    logger.info(
      {
        templateId: template._id,
        placeholderCount: placeholders.length,
        placeholders: placeholders,
      },
      "Placeholders extracted and saved to template"
    );

    res.success({ placeholders }, "Placeholders extracted successfully");
  } catch (error) {
    next(error);
  }
}

export async function testGraphToken(req, res, next) {
  try {
    // Validate userId and tenantId are available from token
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    try {
      const token = await getGraphToken();
      res.success(
        {
          tokenExists: !!token,
          tokenLength: token?.length || 0,
          tokenPrefix: token ? `${token.substring(0, 20)}...` : null,
        },
        "Graph token test successful"
      );
    } catch (tokenError) {
      res.fail(`Failed to get Graph token: ${tokenError.message}`, 500, {
        error: tokenError.message,
      });
    }
  } catch (error) {
    next(error);
  }
}
