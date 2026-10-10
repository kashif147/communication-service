import { fetchProfilesBatch } from "./profileBatch.service.js";
import { pickEmail } from "./personalization.service.js";

const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/**
 * Resolve where a generated letter may be emailed (audit H-03 open-relay fix).
 *
 * The member is looked up in profile-service FOR THIS TENANT (HTTP only, same
 * client campaigns and graduation comms use). The destination is always one of
 * that member's on-record emails — never an arbitrary caller-supplied address:
 *  - requestedAddress matching one of the member's on-record emails
 *    (preferred/personal/work, case-insensitive) is used as-is;
 *  - otherwise the default on-record email (pickEmail) is used and the request
 *    is flagged `requestedAddressIgnored`;
 *  - no member in this tenant / no on-record email => { ok:false }.
 *
 * @returns {Promise<{ok:true,address:string,requestedAddressIgnored:boolean}|{ok:false,reason:string}>}
 */
export async function resolveLetterRecipient({
  tenantId,
  memberId,
  requestedAddress,
  fetchProfiles = fetchProfilesBatch,
}) {
  if (!tenantId || !memberId) return { ok: false, reason: "missing_tenant_or_member" };

  const profiles = await fetchProfiles({ profileIds: [String(memberId)], tenantId });
  const profile = (Array.isArray(profiles) ? profiles : []).find(
    (p) => String(p?._id ?? p?.id ?? "") === String(memberId)
  );
  if (!profile) return { ok: false, reason: "member_not_found_in_tenant" };
  // Defensive: if profile-service ever returns a tenant-stamped row for another tenant, refuse it.
  if (profile.tenantId != null && String(profile.tenantId) !== String(tenantId)) {
    return { ok: false, reason: "member_not_found_in_tenant" };
  }

  const c = profile.contactInfo || {};
  const onRecord = [c.preferredEmail, c.personalEmail, c.workEmail].map(norm).filter(Boolean);
  const fallback = norm(pickEmail(profile));
  if (!fallback) return { ok: false, reason: "no_email_on_record" };

  const requested = norm(requestedAddress);
  if (requested && onRecord.includes(requested)) {
    return { ok: true, address: requested, requestedAddressIgnored: false };
  }
  return { ok: true, address: fallback, requestedAddressIgnored: Boolean(requested) };
}
