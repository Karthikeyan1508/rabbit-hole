import { extractText, getDocumentProxy } from "unpdf";

/** Selectable text of a PDF, pages merged. Scanned (image-only) PDFs have none and come back empty; OCR is not supported. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Not a PDF file");
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  return text;
}
