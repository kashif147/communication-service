import BookmarkField from "../model/bookmarkField.model.js";
import { sanitizeString, validateObjectId } from "../middlewares/validateInput.js";

export async function getBookmarkFields(req, res, next) {
  try {
    // Validate userId and tenantId are available from token (for audit/logging)
    // Bookmark fields are typically global configuration, but we track who accessed them
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    // Bookmark fields are typically global, but can be filtered by tenant if needed
    // For now, return all fields (they're configuration data)
    const fields = await BookmarkField.find().sort({ key: 1 });
    res.success({ fields }, "Bookmark fields retrieved successfully");
  } catch (error) {
    next(error);
  }
}

export async function createBookmarkField(req, res, next) {
  try {
    // Validate userId and tenantId are available from token
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { key, label, path, dataType } = req.body;

    if (!key || !label || !path) {
      return res.fail("key, label, and path are required", 400);
    }

    // Sanitize input to prevent injection
    const sanitizedKey = sanitizeString(key, 100);
    const sanitizedLabel = sanitizeString(label, 200);
    const sanitizedPath = sanitizeString(path, 500);
    const validDataTypes = ["string", "date", "number"];
    const sanitizedDataType = validDataTypes.includes(dataType) ? dataType : "string";

    if (!sanitizedKey || !sanitizedLabel || !sanitizedPath) {
      return res.fail("Invalid input: key, label, and path cannot be empty", 400);
    }

    const field = await BookmarkField.create({
      key: sanitizedKey,
      label: sanitizedLabel,
      path: sanitizedPath,
      dataType: sanitizedDataType,
    });

    res.created({ field }, "Bookmark field created successfully");
  } catch (error) {
    next(error);
  }
}

export async function updateBookmarkField(req, res, next) {
  try {
    // Validate userId and tenantId are available from token
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { id } = req.params;
    const { key, label, path, dataType } = req.body;

    validateObjectId(id, "id");

    const field = await BookmarkField.findById(id);
    if (!field) {
      return res.notFoundRecord("Bookmark field not found");
    }

    const updateData = {};
    if (key !== undefined) {
      const sanitizedKey = sanitizeString(key, 100);
      if (!sanitizedKey) {
        return res.fail("Invalid input: key cannot be empty", 400);
      }
      updateData.key = sanitizedKey;
    }
    if (label !== undefined) {
      const sanitizedLabel = sanitizeString(label, 200);
      if (!sanitizedLabel) {
        return res.fail("Invalid input: label cannot be empty", 400);
      }
      updateData.label = sanitizedLabel;
    }
    if (path !== undefined) {
      const sanitizedPath = sanitizeString(path, 500);
      if (!sanitizedPath) {
        return res.fail("Invalid input: path cannot be empty", 400);
      }
      updateData.path = sanitizedPath;
    }
    if (dataType !== undefined) {
      const validDataTypes = ["string", "date", "number"];
      const sanitizedDataType = validDataTypes.includes(dataType) ? dataType : "string";
      updateData.dataType = sanitizedDataType;
    }

    const updatedField = await BookmarkField.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });

    res.success({ field: updatedField }, "Bookmark field updated successfully");
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.fail(error.message, 400);
    }
    next(error);
  }
}

export async function deleteBookmarkField(req, res, next) {
  try {
    // Validate userId and tenantId are available from token
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { id } = req.params;

    validateObjectId(id, "id");

    const field = await BookmarkField.findByIdAndDelete(id);
    if (!field) {
      return res.notFoundRecord("Bookmark field not found");
    }

    res.success({}, "Bookmark field deleted successfully");
  } catch (error) {
    next(error);
  }
}
