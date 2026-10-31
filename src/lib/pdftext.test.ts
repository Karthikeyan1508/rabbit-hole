import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfText } from "./pdftext.ts";

/** Smallest valid one-page PDF with a single line of text. */
export function tinyPdf(line: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

test("extracts text from a PDF and rejects non-PDFs", async () => {
  const text = await pdfText(tinyPdf("TinyFish partners with Quillworks Labs"));
  assert.match(text, /TinyFish partners with Quillworks Labs/);
  await assert.rejects(() => pdfText(new TextEncoder().encode("plain text, not a pdf")), /Not a PDF/);
});
