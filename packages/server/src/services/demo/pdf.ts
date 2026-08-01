import PDFDocument from "pdfkit";

/** Deterministic PDF writer for local fixtures using PDFKit. */
export async function buildSimplePdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 50,
      compress: false,
      info: {
        Title: "ApplyReady Fixture",
        Author: "ApplyReady",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica").fontSize(11);
    if (lines.length === 0) {
      // Intentionally blank page — no extractable prose for image-only simulation.
      doc.text(" ");
    } else {
      for (const line of lines) {
        doc.text(line || " ", { paragraphGap: 2 });
      }
    }
    doc.end();
  });
}

export function wrapWords(text: string, width = 90): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}
