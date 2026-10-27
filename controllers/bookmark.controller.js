import BookmarkField from "../model/bookmarkField.model.js";
import { sanitizeString, validateObjectId } from "../middlewares/validateInput.js";
import { isSuperUser } from "../middlewares/internalCaller.js";
import { globalDataFrozenError, isGlobalDataFrozen } from "../middlewares/globalDataFreeze.js";
import {
  getEffectiveBookmarkFields,
  isSystemBookmarkRow,
  systemBookmarkFilter,
} from "../services/bookmarkFieldScope.service.js";

const VALID_DATA_TYPES = ["string", "date", "number"];

function normalizeDataType(dataType) {
  const normalized = String(dataType || "").toLowerCase();
  return VALID_DATA_TYPES.includes(normalized) ? normalized : "string";
}

/**
 * Find a row the caller may act on: its own tenant's row, or a system row.
 * Another tenant's row is indistinguishable from "not found".
 */
async function findVisibleRow(id, tenantId) {
  return BookmarkField.findOne({
    _id: id,
    $or: [{ tenantId: String(tenantId) }, systemBookmarkFilter()],
  }).lean();
}

/** Owner-scoped filter for a write on `row` (never a bare _id). */
function ownerFilter(id, row) {
  return isSystemBookmarkRow(row)
    ? { _id: id, ...systemBookmarkFilter() }
    : { _id: id, tenantId: String(row.tenantId) };
}

export async function getBookmarkFields(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    // System rows + this tenant's own rows, tenant row winning per key.
    const fields = await getEffectiveBookmarkFields(req.tenantId);
    const shaped = fields.map((f) => ({
      ...f,
      scope: isSystemBookmarkRow(f) ? "system" : "tenant",
    }));
    res.success({ fields: shaped }, "Bookmark fields retrieved successfully");
  } catch (error) {
    next(error);
  }
}

export async function createBookmarkField(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { key, label, path, dataType, scope } = req.body;

    if (!key || !label || !path) {
      return res.fail("key, label, and path are required", 400);
    }

    const sanitizedKey = sanitizeString(key, 100);
    const sanitizedLabel = sanitizeString(label, 200);
    const sanitizedPath = sanitizeString(path, 500);

    if (!sanitizedKey || !sanitizedLabel || !sanitizedPath) {
      return res.fail("Invalid input: key, label, and path cannot be empty", 400);
    }

    // Owner comes only from the trusted context; body tenantId is ignored.
    const wantsSystem = String(scope || "").toLowerCase() === "system";
    // Phase A / A14: system rows are shared by every tenant - frozen for every caller, SU included.
    if (wantsSystem && isGlobalDataFrozen()) {
      return next(globalDataFrozenError("bookmarkField"));
    }
    if (wantsSystem && !isSuperUser(req)) {
      return res.fail("Only a platform administrator can create system bookmark fields", 403);
    }

    const field = await BookmarkField.create({
      key: sanitizedKey,
      label: sanitizedLabel,
      path: sanitizedPath,
      dataType: normalizeDataType(dataType),
      tenantId: wantsSystem ? null : String(req.tenantId),
      scope: wantsSystem ? "system" : "tenant",
    });

    res.created({ field }, "Bookmark field created successfully");
  } catch (error) {
    if (error?.code === 11000) {
      return res.fail("A bookmark field with this key already exists", 409);
    }
    next(error);
  }
}

export async function updateBookmarkField(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { id } = req.params;
    const { key, label, path, dataType } = req.body;

    validateObjectId(id, "id");

    const field = await findVisibleRow(id, req.tenantId);
    if (!field) {
      return res.notFound("Bookmark field not found");
    }
    if (isSystemBookmarkRow(field) && isGlobalDataFrozen()) {
      return next(globalDataFrozenError("bookmarkField"));
    }
    if (isSystemBookmarkRow(field) && !isSuperUser(req)) {
      return res.fail("System bookmark fields can only be modified by a platform administrator", 403);
    }

    // tenantId/scope are never taken from the body: a row cannot be moved
    // between tenants or promoted to system through an update.
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
      updateData.dataType = normalizeDataType(dataType);
    }

    const updatedField = await BookmarkField.findOneAndUpdate(
      ownerFilter(id, field),
      { $set: updateData },
      { new: true, runValidators: true }
    );
    if (!updatedField) {
      return res.notFound("Bookmark field not found");
    }

    res.success({ field: updatedField }, "Bookmark field updated successfully");
  } catch (error) {
    if (error?.code === 11000) {
      return res.fail("A bookmark field with this key already exists", 409);
    }
    if (error.name === "ValidationError") {
      return res.fail("Invalid bookmark field", 400);
    }
    next(error);
  }
}

export async function deleteBookmarkField(req, res, next) {
  try {
    if (!req.userId || !req.tenantId) {
      return res.fail("User authentication required", 401);
    }

    const { id } = req.params;

    validateObjectId(id, "id");

    const field = await findVisibleRow(id, req.tenantId);
    if (!field) {
      return res.notFound("Bookmark field not found");
    }
    if (isSystemBookmarkRow(field) && isGlobalDataFrozen()) {
      return next(globalDataFrozenError("bookmarkField"));
    }
    if (isSystemBookmarkRow(field) && !isSuperUser(req)) {
      return res.fail("System bookmark fields can only be deleted by a platform administrator", 403);
    }

    const deleted = await BookmarkField.findOneAndDelete(ownerFilter(id, field));
    if (!deleted) {
      return res.notFound("Bookmark field not found");
    }

    res.success({}, "Bookmark field deleted successfully");
  } catch (error) {
    next(error);
  }
}
