import { PDFDocument } from "pdf-lib";

export async function generatePdfFromHtml(_html: string) {
  // TODO: Implement consistent PDF generation using pdf-lib
  const doc = await PDFDocument.create();
  doc.addPage();
  return await doc.save();
}
