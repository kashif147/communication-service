import { AppError } from "../errors/AppError.js";

/**
 * Validates MongoDB ObjectId format
 */
export function validateObjectId(id, fieldName = "id") {
  if (!id || typeof id !== "string") {
    throw AppError.badRequest(`Invalid ${fieldName}: must be a string`);
  }
  
  // MongoDB ObjectId is 24 hex characters
  const objectIdRegex = /^[0-9a-fA-F]{24}$/;
  if (!objectIdRegex.test(id)) {
    throw AppError.badRequest(`Invalid ${fieldName}: must be a valid ObjectId`);
  }
  
  return true;
}

/**
 * Validates and sanitizes string input
 */
export function sanitizeString(input, maxLength = 1000) {
  if (typeof input !== "string") {
    return "";
  }
  
  // Remove null bytes and trim
  let sanitized = input.replace(/\0/g, "").trim();
  
  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

/**
 * Validates URL to prevent SSRF
 */
export function validateUrl(url, allowedHosts = []) {
  try {
    const parsedUrl = new URL(url);
    
    // Only allow http/https
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Invalid protocol");
    }
    
    // If allowedHosts specified, check hostname
    if (allowedHosts.length > 0) {
      const hostname = parsedUrl.hostname.toLowerCase();
      const isAllowed = allowedHosts.some((allowed) => {
        const allowedHost = allowed.toLowerCase();
        return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
      });
      
      if (!isAllowed) {
        throw new Error("Host not allowed");
      }
    }
    
    // Block private/internal IPs
    const hostname = parsedUrl.hostname;
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("172.16.") ||
      hostname.startsWith("172.17.") ||
      hostname.startsWith("172.18.") ||
      hostname.startsWith("172.19.") ||
      hostname.startsWith("172.20.") ||
      hostname.startsWith("172.21.") ||
      hostname.startsWith("172.22.") ||
      hostname.startsWith("172.23.") ||
      hostname.startsWith("172.24.") ||
      hostname.startsWith("172.25.") ||
      hostname.startsWith("172.26.") ||
      hostname.startsWith("172.27.") ||
      hostname.startsWith("172.28.") ||
      hostname.startsWith("172.29.") ||
      hostname.startsWith("172.30.") ||
      hostname.startsWith("172.31.")
    ) {
      throw new Error("Private IP addresses not allowed");
    }
    
    return parsedUrl;
  } catch (error) {
    throw AppError.badRequest(`Invalid URL: ${error.message}`);
  }
}

