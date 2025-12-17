#!/usr/bin/env node

/**
 * Code validation script to verify template endpoints are properly structured
 * This checks code structure without requiring a running server
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const results = {
  passed: [],
  failed: [],
};

function logResult(testName, passed, error = null) {
  if (passed) {
    results.passed.push(testName);
    console.log(`✅ ${testName}`);
  } else {
    results.failed.push({ test: testName, error: error || "Unknown error" });
    console.log(`❌ ${testName}: ${error || "Unknown error"}`);
  }
}

function validateExports() {
  console.log("\n📋 Validating Exports\n");

  try {
    const controllerPath = join(__dirname, "../controllers/template.controller.js");
    const controllerContent = readFileSync(controllerPath, "utf-8");

    const routesPath = join(__dirname, "../routes/template.routes.js");
    const routesContent = readFileSync(routesPath, "utf-8");

    // Extract imports from routes
    const importMatch = routesContent.match(/import\s*\{([^}]+)\}\s*from\s*["'].*template\.controller/);
    if (!importMatch) {
      logResult("Routes import statement", false, "Could not find import statement");
      return;
    }

    const importedFunctions = importMatch[1]
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f);

    // Extract exports from controller
    const exportedFunctions = [];
    const exportRegex = /export\s+(async\s+)?function\s+(\w+)/g;
    let match;
    while ((match = exportRegex.exec(controllerContent)) !== null) {
      exportedFunctions.push(match[2]);
    }

    // Check all imports are exported
    for (const imported of importedFunctions) {
      if (exportedFunctions.includes(imported)) {
        logResult(`Export: ${imported}`, true);
      } else {
        logResult(`Export: ${imported}`, false, "Function not exported from controller");
      }
    }

    // Check all exports are imported
    for (const exported of exportedFunctions) {
      if (importedFunctions.includes(exported)) {
        logResult(`Import: ${exported}`, true);
      } else {
        logResult(`Import: ${exported}`, false, "Function exported but not imported in routes");
      }
    }
  } catch (error) {
    logResult("Export validation", false, error.message);
  }
}

function validateControllerStructure() {
  console.log("\n🔍 Validating Controller Structure\n");

  try {
    const controllerPath = join(__dirname, "../controllers/template.controller.js");
    const controllerContent = readFileSync(controllerPath, "utf-8");

    // Check uploadTemplate
    if (controllerContent.includes("tempolateType")) {
      logResult("uploadTemplate: tempolateType field", true);
    } else {
      logResult("uploadTemplate: tempolateType field", false, "tempolateType not found");
    }

    if (controllerContent.includes("placeholders: []")) {
      logResult("uploadTemplate: placeholders initialization", true);
    } else {
      logResult("uploadTemplate: placeholders initialization", false, "placeholders not initialized");
    }

    // Check getTemplates
    if (controllerContent.includes("filter.tempolateType")) {
      logResult("getTemplates: tempolateType filter", true);
    } else {
      logResult("getTemplates: tempolateType filter", false, "tempolateType filter not found");
    }

    // Check getTemplate
    if (controllerContent.includes("fileContent") && controllerContent.includes("getOneDriveFile")) {
      logResult("getTemplate: fileContent inclusion", true);
    } else {
      logResult("getTemplate: fileContent inclusion", false, "fileContent not included");
    }

    // Check updateTemplate
    if (controllerContent.includes("updateData.tempolateType")) {
      logResult("updateTemplate: tempolateType update", true);
    } else {
      logResult("updateTemplate: tempolateType update", false, "tempolateType update not found");
    }

    // Check all required functions exist
    const requiredFunctions = [
      "uploadTemplate",
      "getTemplates",
      "getTemplate",
      "updateTemplate",
      "deleteTemplate",
      "extractPlaceholders",
      "testGraphToken",
    ];

    for (const func of requiredFunctions) {
      const regex = new RegExp(`export\\s+(async\\s+)?function\\s+${func}`);
      if (regex.test(controllerContent)) {
        logResult(`Function exists: ${func}`, true);
      } else {
        logResult(`Function exists: ${func}`, false, "Function not found");
      }
    }
  } catch (error) {
    logResult("Controller structure validation", false, error.message);
  }
}

function validateModelStructure() {
  console.log("\n📦 Validating Model Structure\n");

  try {
    const modelPath = join(__dirname, "../model/template.model.js");
    const modelContent = readFileSync(modelPath, "utf-8");

    if (modelContent.includes("tempolateType")) {
      logResult("Model: tempolateType field", true);
    } else {
      logResult("Model: tempolateType field", false, "tempolateType not in model");
    }

    if (modelContent.includes("placeholders: { type: [String], default: [] }")) {
      logResult("Model: placeholders default", true);
    } else if (modelContent.includes("placeholders: [String]")) {
      logResult("Model: placeholders default", false, "placeholders missing default value");
    } else {
      logResult("Model: placeholders field", false, "placeholders not found");
    }

    if (modelContent.includes("required: true") && modelContent.includes("tempolateType")) {
      logResult("Model: tempolateType required", true);
    } else {
      logResult("Model: tempolateType required", false, "tempolateType not marked as required");
    }
  } catch (error) {
    logResult("Model structure validation", false, error.message);
  }
}

function validateRoutesStructure() {
  console.log("\n🛣️  Validating Routes Structure\n");

  try {
    const routesPath = join(__dirname, "../routes/template.routes.js");
    const routesContent = readFileSync(routesPath, "utf-8");

    const requiredRoutes = [
      { method: "POST", path: "/upload", handler: "uploadTemplate" },
      { method: "GET", path: "/", handler: "getTemplates" },
      { method: "GET", path: "/:id", handler: "getTemplate" },
      { method: "PUT", path: "/:id", handler: "updateTemplate" },
      { method: "DELETE", path: "/:id", handler: "deleteTemplate" },
      { method: "POST", path: "/:id/extract-placeholders", handler: "extractPlaceholders" },
      { method: "GET", path: "/test-graph-token", handler: "testGraphToken" },
    ];

    for (const route of requiredRoutes) {
      const methodRegex = new RegExp(`router\\.${route.method.toLowerCase()}`);
      const pathRegex = new RegExp(route.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const handlerRegex = new RegExp(route.handler);

      if (methodRegex.test(routesContent) && pathRegex.test(routesContent) && handlerRegex.test(routesContent)) {
        logResult(`Route: ${route.method} ${route.path}`, true);
      } else {
        logResult(`Route: ${route.method} ${route.path}`, false, "Route not found or handler mismatch");
      }
    }
  } catch (error) {
    logResult("Routes structure validation", false, error.message);
  }
}

async function runValidation() {
  console.log("🚀 Starting Template Endpoints Code Validation\n");

  validateExports();
  validateControllerStructure();
  validateModelStructure();
  validateRoutesStructure();

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Validation Summary");
  console.log("=".repeat(60));
  console.log(`✅ Passed: ${results.passed.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);
  console.log(`📈 Success Rate: ${((results.passed.length / (results.passed.length + results.failed.length)) * 100).toFixed(1)}%`);

  if (results.failed.length > 0) {
    console.log("\n❌ Failed Validations:");
    results.failed.forEach(({ test, error }) => {
      console.log(`   - ${test}: ${error}`);
    });
    process.exit(1);
  } else {
    console.log("\n✅ All validations passed!");
    process.exit(0);
  }
}

runValidation().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});




