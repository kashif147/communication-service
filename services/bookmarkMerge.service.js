import BookmarkField from "../model/bookmarkField.model.js";

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

function formatBookmarkValue(value, dataType) {
  if (value == null || value === "") return "";
  if (dataType === "date") {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Build docxtemplater / {{placeholder}} map from bookmark fields + profile/subscription context.
 */
export async function buildBookmarkMergeMap({ profile, subscription = {} }) {
  const fields = await BookmarkField.find({}).lean();
  const profileDoc = profile && typeof profile === "object" ? { ...profile } : {};
  if (profileDoc.professionalDetails && !profileDoc.professionalInfo) {
    profileDoc.professionalInfo = profileDoc.professionalDetails;
  }
  if (profileDoc.contactInfo?.address) {
    profileDoc.contactInfo = {
      ...profileDoc.contactInfo,
      ...profileDoc.contactInfo.address,
    };
  }

  const context = {
    profile: profileDoc,
    subscription: subscription && typeof subscription === "object" ? subscription : {},
  };

  const map = {};
  for (const field of fields) {
    const key = field.key;
    if (!key) continue;
    const raw = getByPath(context, field.path);
    map[key] = formatBookmarkValue(raw, field.dataType);
  }

  const pi = profileDoc.personalInfo || {};
  map.fullName =
    map.fullName ||
    pi.fullName ||
    [pi.forename, pi.surname].filter(Boolean).join(" ").trim();

  return map;
}

export { getByPath, formatBookmarkValue };
