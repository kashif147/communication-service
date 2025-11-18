import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

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
    console.error("Error rendering docx", error);
    throw error;
  }

  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}
