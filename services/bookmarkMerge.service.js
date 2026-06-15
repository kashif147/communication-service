import BookmarkField from "../model/bookmarkField.model.js";
import { fetchTenantRecord } from "./tenant.service.client.js";

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function parseBookmarkPath(path) {
  const raw = String(path || "").trim();
  const colonIdx = raw.indexOf(":");
  if (colonIdx === -1) {
    return { dataPath: raw, format: null };
  }
  return {
    dataPath: raw.slice(0, colonIdx).trim(),
    format: raw.slice(colonIdx + 1).trim() || null,
  };
}

function formatDateWithPattern(date, pattern) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return String(date ?? "");

  const tokens = {
    yyyy: String(d.getUTCFullYear()),
    yy: String(d.getUTCFullYear()).slice(-2),
    MMM: MONTH_SHORT[d.getUTCMonth()],
    MM: String(d.getUTCMonth() + 1).padStart(2, "0"),
    M: String(d.getUTCMonth() + 1),
    dd: String(d.getUTCDate()).padStart(2, "0"),
    d: String(d.getUTCDate()),
    HH: String(d.getUTCHours()).padStart(2, "0"),
    H: String(d.getUTCHours()),
    mm: String(d.getUTCMinutes()).padStart(2, "0"),
    m: String(d.getUTCMinutes()),
    ss: String(d.getUTCSeconds()).padStart(2, "0"),
    s: String(d.getUTCSeconds()),
  };

  let result = pattern;
  for (const token of [
    "yyyy",
    "yy",
    "MMM",
    "MM",
    "dd",
    "HH",
    "mm",
    "ss",
    "M",
    "d",
    "H",
    "m",
    "s",
  ]) {
    result = result.split(token).join(tokens[token]);
  }
  return result;
}

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

/** MODEL_ATTRIBUTES doc uses *.model.*; merge context exposes the runtime shape. */
function normalizeBookmarkDataPath(dataPath) {
  const raw = String(dataPath || "").trim();
  if (raw.startsWith("tenant.model.")) {
    return `tenant.${raw.slice("tenant.model.".length)}`;
  }
  if (raw.startsWith("profile.model.")) {
    return `profile.${raw.slice("profile.model.".length)}`;
  }
  if (raw.startsWith("personal.details.model.")) {
    return `profile.${raw.slice("personal.details.model.".length)}`;
  }
  if (raw.startsWith("subscription.model.")) {
    return `subscription.${raw.slice("subscription.model.".length)}`;
  }
  return raw;
}

function getSystemBookmarkContext(date = new Date()) {
  return {
    currentUtcDate: date,
  };
}

function resolveBookmarkRawValue(field, context) {
  const { dataPath } = parseBookmarkPath(field.path);
  const normalizedPath = normalizeBookmarkDataPath(dataPath);
  const fromPath = getByPath(context, normalizedPath);
  if (fromPath !== undefined) return fromPath;

  const key = String(field.key || "").toLowerCase();
  const path = String(dataPath || "").toLowerCase();
  const system = context.system || {};

  if (key === "currentutcdate" || path === "system.currentutcdate") {
    return system.currentUtcDate ?? new Date();
  }

  return undefined;
}

/** HTML: continuation lines align with the first line start (not the paragraph margin). */
export function formatMultilineValueForHtml(value) {
  const normalized = String(value ?? "");
  if (!normalized.includes("\n")) return normalized;

  const lines = normalized.split("\n");
  const first = lines[0] ?? "";
  const rest = lines
    .slice(1)
    .map((line) => `<br>${line}`)
    .join("");

  return `<span class="bookmark-multiline" style="display:inline-block;vertical-align:top;">${first}${rest}</span>`;
}

export function formatBookmarkValueForHtmlReplacement(value) {
  const raw = String(value ?? "");
  return raw.includes("\n") ? formatMultilineValueForHtml(raw) : raw;
}

function formatCommaSeparatedLines(value) {
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

const LINES_FORMATS = new Set(["lines", "commalines"]);
const ADDRESS_LINE_KEYS = new Set(["fulladdress", "fullmemberaddress"]);

function wantsLineFormat(field, format) {
  const normalizedFormat = String(format || "").trim().toLowerCase();
  if (LINES_FORMATS.has(normalizedFormat)) return true;
  return ADDRESS_LINE_KEYS.has(String(field?.key || "").toLowerCase());
}

function buildAddressLinesFromContext(context) {
  const ci = context?.profile?.contactInfo || {};
  const addr =
    ci.address && typeof ci.address === "object"
      ? { ...ci, ...ci.address }
      : ci;

  return [
    addr.buildingOrHouse,
    addr.streetOrRoad,
    addr.areaOrTown,
    addr.countyCityOrPostCode,
    addr.eircode,
    addr.country,
  ]
    .map((part) => (part != null ? String(part).trim() : ""))
    .filter(Boolean)
    .join("\n");
}

function formatBookmarkValue(
  value,
  dataType,
  formatPattern = null,
  { lineFormat = false, context = null } = {},
) {
  if (lineFormat) {
    const fromParts = context ? buildAddressLinesFromContext(context) : "";
    if (fromParts) return fromParts;
    if (value == null || value === "") return "";
    return formatCommaSeparatedLines(value);
  }
  if (value == null || value === "") return "";
  if (formatPattern) {
    return formatDateWithPattern(value, formatPattern);
  }
  if (dataType === "date") {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Build docxtemplater / {{placeholder}} map from bookmark fields + profile/subscription/tenant context.
 */
export async function buildBookmarkMergeMap({
  profile,
  subscription = {},
  tenant = {},
  tenantId,
  req,
}) {
  const fields = await BookmarkField.find({}).lean();
  const profileDoc = profile && typeof profile === "object" ? { ...profile } : {};
  if (profileDoc.professionalDetails) {
    profileDoc.professionalInfo = {
      ...profileDoc.professionalDetails,
      ...(profileDoc.professionalInfo || {}),
    };
  }
  if (profileDoc.contactInfo?.address) {
    profileDoc.contactInfo = {
      ...profileDoc.contactInfo,
      ...profileDoc.contactInfo.address,
    };
  }

  let tenantDoc = tenant && typeof tenant === "object" ? { ...tenant } : {};
  if (!Object.keys(tenantDoc).length && tenantId) {
    tenantDoc = (await fetchTenantRecord(tenantId, req)) || {};
  }

  const context = {
    profile: profileDoc,
    subscription: subscription && typeof subscription === "object" ? subscription : {},
    tenant: tenantDoc,
    system: getSystemBookmarkContext(),
  };

  const map = {};
  for (const field of fields) {
    const key = field.key;
    if (!key) continue;
    const { format } = parseBookmarkPath(field.path);
    const raw = resolveBookmarkRawValue(field, context);
    const lineFormat = wantsLineFormat(field, format);
    map[key] = formatBookmarkValue(raw, field.dataType, lineFormat ? null : format, {
      lineFormat,
      context,
    });
  }

  const pi = profileDoc.personalInfo || {};
  map.fullName =
    map.fullName ||
    pi.fullName ||
    [pi.forename, pi.surname].filter(Boolean).join(" ").trim();

  return map;
}

export {
  getByPath,
  formatBookmarkValue,
  formatMultilineValueForHtml,
  formatBookmarkValueForHtmlReplacement,
  getSystemBookmarkContext,
  resolveBookmarkRawValue,
  parseBookmarkPath,
  formatDateWithPattern,
};
