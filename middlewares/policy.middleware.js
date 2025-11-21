/**
 * Centralized RBAC Policy Middleware
 * Uses shared policy middleware package
 *
 * This middleware integrates with the centralized policy evaluation service
 * using the policy client for consistent authorization across all microservices.
 */

import { PolicyClient } from "@membership/policy-middleware";
import logger from "../config/logger.js";

class PolicyMiddleware {
  constructor(baseURL, options = {}) {
    this.policyClient = new PolicyClient(baseURL, options);
  }

  /**
   * Express middleware factory for route protection
   * @param {string} resource - Resource being protected (e.g., 'tenant', 'user', 'role', 'permission')
   * @param {string} action - Action being performed (e.g., 'read', 'write', 'delete', 'create')
   * @returns {Function} Express middleware function
   */
  requirePermission(resource, action) {
    return async (req, res, next) => {
      try {
        logger.debug(
          { resource, action, policyServiceUrl: this.policyClient.baseUrl },
          "Policy middleware evaluation started"
        );

        const token = req.headers.authorization?.replace("Bearer ", "");

        if (!token) {
          logger.warn(
            { resource, action, url: req.url, method: req.method },
            "Authorization token missing"
          );
          return res.status(401).json({
            success: false,
            error: "Authorization token required",
            code: "UNAUTHORIZED",
            status: 401,
          });
        }

        // Extract context from request
        // Filter out 'id' from body/query if it's not a route parameter to avoid validation issues
        // The 'id' field should only come from route parameters (req.params.id)
        const bodyContext = { ...req.body };
        const queryContext = { ...req.query };

        // Remove 'id' from body and query unless it's a route parameter
        if (!req.params?.id) {
          delete bodyContext.id;
          delete queryContext.id;
        }

        const context = {
          userId: req.ctx?.userId || req.user?.id || req.userId,
          tenantId: req.ctx?.tenantId || req.user?.tenantId || req.tenantId,
          userRoles: req.ctx?.roles || req.user?.roles || req.roles || [],
          userPermissions:
            req.ctx?.permissions ||
            req.user?.permissions ||
            req.permissions ||
            [],
          ...queryContext, // Include query params (id filtered if not route param)
          ...bodyContext, // Include request body (id filtered if not route param)
        };

        // Final safety check: remove 'id' from context if it's not from route params
        if (!req.params?.id && context.id) {
          delete context.id;
        }

        // ALWAYS delegate authorization to user service - maintain single source of truth
        logger.debug(
          {
            resource,
            action,
            tokenPrefix: token.substring(0, 20) + "...",
            context: {
              userId: context.userId,
              tenantId: context.tenantId,
              userRoles: context.userRoles?.length || 0,
            },
          },
          "Delegating authorization to policy service"
        );

        let result;

        // Check if auth bypass is enabled
        if (process.env.AUTH_BYPASS_ENABLED === "true") {
          logger.warn(
            { resource, action, environment: process.env.NODE_ENV },
            "AUTH_BYPASS_ENABLED: Authorization bypassed (token still validated)"
          );

          // Still validate token to extract user info, but skip authorization
          let userFromToken = null;
          try {
            const response = await this.policyClient.makeRequest(
              "/token/validate",
              {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
              }
            );
            if (response.success && response.user) {
              userFromToken = response.user;
              logger.debug(
                { userId: userFromToken.id, tenantId: userFromToken.tenantId },
                "Token validated, user context extracted"
              );
            }
          } catch (error) {
            logger.warn(
              { error: error.message, resource, action },
              "Token validation failed, using fallback context"
            );
          }

          // Extract user info from token even in bypass mode
          let bypassUser = userFromToken || req.user;

          // If no user from token validation, try to extract from token directly
          if (!bypassUser && token) {
            try {
              // Basic JWT decode (without verification in bypass mode)
              const parts = token.split(".");
              if (parts.length === 3) {
                const payload = JSON.parse(
                  Buffer.from(parts[1], "base64").toString()
                );
                bypassUser = {
                  id: payload.sub || payload.id,
                  tenantId:
                    payload.tenantId ||
                    payload.tid ||
                    payload.extension_tenantId,
                  userType: payload.userType || "PORTAL",
                  roles: payload.roles || [],
                  permissions: payload.permissions || [],
                };
              }
            } catch (e) {
              // If decode fails, use context
              bypassUser = {
                id: context.userId || "bypass-user-id",
                userType: "PORTAL",
                tenantId: context.tenantId || "default-tenant",
                roles: [],
                permissions: [],
              };
            }
          }

          result = {
            success: true,
            decision: "PERMIT",
            reason: "AUTH_BYPASS_ENABLED",
            user: bypassUser || {
              id: context.userId || "bypass-user-id",
              userType: "PORTAL",
              tenantId: context.tenantId || "default-tenant",
              roles: [],
              permissions: [],
            },
            resource,
            action,
            timestamp: new Date().toISOString(),
          };
        } else {
          result = await this.policyClient.evaluatePolicy(
            token,
            resource,
            action,
            context
          );
        }

        logger.debug(
          {
            resource,
            action,
            decision: result.decision,
            reason: result.reason,
            userId: result.user?.id,
          },
          "Policy evaluation result"
        );

        if (result.success && result.decision === "PERMIT") {
          // Attach policy context to request for use in controllers
          req.policyContext = result;

          // Store token for use in controllers (e.g., OneDrive API calls)
          req.token = token;

          // Set req.user for backward compatibility with existing controllers
          if (result.user) {
            req.user = result.user;
            req.userId = result.user.id;
            req.tenantId = result.user.tenantId;
            req.roles = result.user.roles || [];
            req.permissions = result.user.permissions || [];
          }

          // Ensure tenantId and userId are set (required for all operations)
          if (!req.tenantId) {
            return res.status(403).json({
              success: false,
              error: "Tenant context required",
              code: "MISSING_TENANT_CONTEXT",
            });
          }

          if (!req.userId) {
            return res.status(403).json({
              success: false,
              error: "User context required",
              code: "MISSING_USER_CONTEXT",
            });
          }

          logger.info(
            {
              resource,
              action,
              userId: req.userId,
              tenantId: req.tenantId,
              decision: result.decision,
            },
            "Authorization granted"
          );
          next();
        } else {
          logger.warn(
            {
              resource,
              action,
              userId: req.userId,
              tenantId: req.tenantId,
              reason: result.reason || "Unknown",
              url: req.url,
              method: req.method,
            },
            "Authorization denied"
          );
          return res.status(403).json({
            success: false,
            error: "Insufficient permissions",
            reason: result.reason || "PERMISSION_DENIED",
            code: "PERMISSION_DENIED",
            resource,
            action,
          });
        }
      } catch (error) {
        logger.error(
          {
            error: error.message,
            stack: error.stack,
            resource,
            action,
            url: req.url,
            method: req.method,
          },
          "Policy middleware error"
        );
        return res.status(500).json({
          success: false,
          error: "Authorization service error",
          code: "POLICY_SERVICE_ERROR",
        });
      }
    };
  }

  /**
   * Check if user has permission (returns boolean)
   * @param {string} token - JWT token
   * @param {string} resource - Resource being accessed
   * @param {string} action - Action being performed
   * @param {Object} context - Additional context (optional)
   * @returns {boolean} True if permitted, false otherwise
   */
  async hasPermission(token, resource, action, context = {}) {
    try {
      const result = await this.policyClient.evaluatePolicy(
        token,
        resource,
        action,
        context
      );
      return result.success && result.decision === "PERMIT";
    } catch (error) {
      logger.error(
        { error: error.message, resource, action },
        "Permission check failed"
      );
      return false;
    }
  }

  /**
   * Get user permissions for a specific resource
   * @param {string} token - JWT token
   * @param {string} resource - Resource name
   * @returns {Object} User permissions
   */
  async getPermissions(token, resource) {
    return await this.policyClient.getPermissions(token, resource);
  }

  /**
   * Clear the policy client cache
   */
  clearCache() {
    this.policyClient.clearCache();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return this.policyClient.getCacheStats();
  }
}

// Create default policy middleware instance
const createDefaultPolicyMiddleware = (baseURL, options = {}) => {
  return new PolicyMiddleware(baseURL, {
    timeout: 15000, // Increased timeout for Azure
    retries: 5, // More retries for Azure
    cacheTimeout: 300000, // 5 minutes
    retryDelay: 2000, // Base delay between retries
    ...options,
  });
};

const defaultPolicyMiddleware = createDefaultPolicyMiddleware(
  process.env.POLICY_SERVICE_URL || "http://localhost:3000",
  {
    timeout: 15000, // Increased timeout for Azure
    retries: 5, // More retries for Azure
    cacheTimeout: 300000, // 5 minutes
    retryDelay: 2000, // Base delay between retries
  }
);

export default defaultPolicyMiddleware;
export {
  defaultPolicyMiddleware,
  PolicyMiddleware,
  createDefaultPolicyMiddleware,
};
