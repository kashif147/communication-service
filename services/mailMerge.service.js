import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import logger from "../config/logger.js";

export function mergeTemplate(templateBuffer, data) {
  const zip = new PizZip(templateBuffer);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  doc.setData(data);

  try {
    doc.render();
  } catch (error) {
    logger.error(
      { error: error.message, stack: error.stack },
      "Error rendering docx template"
    );
    throw error;
  }

  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}
