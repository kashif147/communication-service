import axios from "axios";
import { validateObjectId, validateUrl } from "../middlewares/validateInput.js";
import { AppError } from "../errors/AppError.js";

export async function collectMemberData(memberId) {
  // Validate memberId to prevent injection
  validateObjectId(memberId, "memberId");

  // Get service URLs from environment
  const profileServiceUrl = process.env.PROFILE_SERVICE_URL || "http://profile-service";
  const subscriptionServiceUrl = process.env.SUBSCRIPTION_SERVICE_URL || "http://subscription-service";
  const accountServiceUrl = process.env.ACCOUNT_SERVICE_URL || "http://account-service";

  // Validate URLs to prevent SSRF
  const allowedHosts = [
    ...(process.env.ALLOWED_SERVICE_HOSTS?.split(",") || []),
    "profile-service",
    "subscription-service",
    "account-service",
  ];

  // Validate URLs to prevent SSRF (will throw AppError if invalid)
  try {
    validateUrl(`${profileServiceUrl}/profiles/${memberId}`, allowedHosts);
    validateUrl(`${subscriptionServiceUrl}/subscriptions/${memberId}`, allowedHosts);
    validateUrl(`${accountServiceUrl}/accounts/${memberId}`, allowedHosts);
  } catch (error) {
    throw error; // Re-throw AppError from validateUrl
  }

  // Sanitize memberId in URL to prevent path traversal
  const sanitizedMemberId = memberId.replace(/[^a-fA-F0-9]/g, "");
  
  if (sanitizedMemberId.length !== 24) {
    throw AppError.badRequest("Invalid memberId format");
  }

  const profile = await axios.get(`${profileServiceUrl}/profiles/${sanitizedMemberId}`, {
    timeout: 10000, // 10 second timeout
    validateStatus: (status) => status < 500, // Don't throw on 4xx
  });
  
  const subscription = await axios.get(`${subscriptionServiceUrl}/subscriptions/${sanitizedMemberId}`, {
    timeout: 10000,
    validateStatus: (status) => status < 500,
  });
  
  const account = await axios.get(`${accountServiceUrl}/accounts/${sanitizedMemberId}`, {
    timeout: 10000,
    validateStatus: (status) => status < 500,
  });

  return {
    MemberName: profile.data.fullName,
    MembershipNumber: profile.data.membershipNumber,
    DOB: profile.data.dob,
    AddressLine1: profile.data.address?.line1,
    MembershipStatus: subscription.data.status,
    ExpiryDate: subscription.data.expiryDate,
    OutstandingBalance: account.data.balance,
  };
}
