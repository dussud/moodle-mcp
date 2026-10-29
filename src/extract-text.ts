// Text extraction for binary course files. Claude clients refuse PDF/DOCX
// embedded resources, so the download tool returns their text instead.
import { getDocumentProxy, extractText as extractPdfText } from "unpdf";
import mammoth from "mammoth";
import { htmlToText } from "./html-to-text.js";

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Large handbooks can run to hundreds of pages; keep a single response bounded.
const MAX_CHARS = 200_000;

export type ExtractableKind = "pdf" | "docx";

/** Moodle often serves files as application/octet-stream, so fall back to the extension. */
export function extractableKind(mime: string, filename: string): ExtractableKind | null {
  const ext = filename.toLowerCase().split(".").pop();
  if (mime === PDF_MIME || ext === "pdf") return "pdf";
  if (mime === DOCX_MIME || ext === "docx") return "docx";
  return null;
}

function cap(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return `${text.slice(0, MAX_CHARS)}\n\n_[Truncated: showing the first ${MAX_CHARS.toLocaleString("en")} of ${text.length.toLocaleString("en")} characters.]_`;
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  // pdf.js may detach the buffer it is given; hand it a copy.
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractPdfText(pdf, { mergePages: false });
  return text
    .map((page, i) => {
      const body = page.replace(/[ \t]+\n/g, "\n").trim();
      return body ? `--- Page ${i + 1} ---\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

async function docxToText(bytes: Uint8Array): Promise<string> {
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return htmlToText(value);
}

/** Returns extracted text, or "" when the file has none (e.g. a scanned PDF). */
export async function extractText(kind: ExtractableKind, bytes: Uint8Array): Promise<string> {
  const text = kind === "pdf" ? await pdfToText(bytes) : await docxToText(bytes);
  return cap(text.trim());
}
