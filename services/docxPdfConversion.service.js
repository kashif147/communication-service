import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function sofficeBinary() {
  return process.env.LIBREOFFICE_BIN || process.env.SOFFICE_BIN || "soffice";
}

export async function convertDocxToPdf(docxBuffer, fileBaseName = "letter") {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "projectshell-docx-pdf-"));
  const safeBase = String(fileBaseName || "letter")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "letter";
  const docxPath = path.join(workDir, `${safeBase}.docx`);
  const pdfPath = path.join(workDir, `${safeBase}.pdf`);

  try {
    await fs.writeFile(docxPath, docxBuffer);
    await execFileAsync(
      sofficeBinary(),
      [
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        docxPath,
      ],
      { timeout: Number(process.env.LIBREOFFICE_CONVERT_TIMEOUT_MS || 30000) },
    );
    return await fs.readFile(pdfPath);
  } catch (error) {
    throw new Error(
      `DOCX to PDF conversion failed. Ensure LibreOffice/soffice is installed: ${error.message}`,
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
