import axios from "axios";

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  process.env.POLICY_SERVICE_URL ||
  "http://localhost:3000";

function buildHeaders(req, tenantId) {
  const headers = {
    "Content-Type": "application/json",
    "x-tenant-id": tenantId || "",
    "x-internal-request": "true",
  };
  if (req?.headers?.authorization) {
    headers.authorization = req.headers.authorization;
  }
  if (req?.headers?.["x-jwt-verified"]) {
    headers["x-jwt-verified"] = req.headers["x-jwt-verified"];
  }
  if (req?.headers?.["x-auth-source"]) {
    headers["x-auth-source"] = req.headers["x-auth-source"];
  }
  return headers;
}

export async function fetchTenantRecord(tenantId, req = null) {
  if (!tenantId) return null;

  const base = USER_SERVICE_URL.replace(/\/$/, "");
  try {
    const response = await axios.get(`${base}/api/tenants/${tenantId}`, {
      headers: buildHeaders(req, tenantId),
      timeout: 8000,
      validateStatus: (status) => status < 500,
    });
    if (response.status < 200 || response.status >= 300) {
      return null;
    }
    return response.data?.data || response.data || null;
  } catch {
    return null;
  }
}
