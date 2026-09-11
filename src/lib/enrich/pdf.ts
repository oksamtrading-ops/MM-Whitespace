/**
 * PDF text, extracted server-side.
 *
 * Annual information forms, financial statements and management information
 * circulars are almost all PDFs, and the fetcher refuses a PDF with no
 * extractor rather than guess at one. unpdf is Mozilla's pdf.js packaged for
 * serverless runtimes: no native code, no worker thread, no dependencies.
 *
 * Pages are joined with a form feed, so a page boundary survives into the
 * stored text and an anchor offset can be traced back to a page.
 */
import type { Extracted } from "./fetch.ts";

export const PDF_EXTRACTOR = "unpdf";
export const PDF_EXTRACTOR_VERSION = "1.8.1";

export async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  // Imported here rather than at the top so the module costs nothing to load
  // on the paths -- replay, the test suite, every page -- that never see a PDF.
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return {
    text: (text as string[]).join("\n\f\n"),
    pageCount: totalPages,
    extractor: PDF_EXTRACTOR,
    extractorVersion: PDF_EXTRACTOR_VERSION,
  };
}
