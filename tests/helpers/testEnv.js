// Import FIRST (before any service module): sets the env the service modules
// read at import time, so tests run offline with no real Azure/PDP/DB.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "comm-tests-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.AZURE_STORAGE_ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT || "testacct";
process.env.AZURE_STORAGE_KEY =
  process.env.AZURE_STORAGE_KEY || Buffer.from("k".repeat(32)).toString("base64");
process.env.POLICY_SERVICE_URL = process.env.POLICY_SERVICE_URL || "http://policy.invalid";
