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
 *
 * Read one page at a time, which is what lets a long document be refused
 * before any of it is read and a slow one be stopped: the page count is known
 * once the document is opened, and the deadline is looked at between pages.
 * Each page's text is exactly what unpdf's extractText gives it -- its items'
 * strings, each followed by a newline where the item ends a line -- so a file
 * read here and the same file read before this was written are the same text.
 */
import type { Extracted } from "./fetch.ts";

export const PDF_EXTRACTOR = "unpdf";
export const PDF_EXTRACTOR_VERSION = "1.8.1";

/** A PDF refused before or while it was read. `code` is the fetch refusal it becomes. */
export class PdfRefused extends Error {
  code: "too_many_pages" | "extract_timeout";
  constructor(code: PdfRefused["code"], detail: string) {
    super(detail);
    this.name = "PdfRefused";
    this.code = code;
  }
}

export type PdfLimits = {
  /** Refused, unread, above this many pages. */
  maxPages?: number;
  /** Stopped, and refused, once this many milliseconds have passed. */
  timeoutMs?: number;
};

export async function extractPdf(bytes: Uint8Array, limits: PdfLimits = {}): Promise<Extracted> {
  // Imported here rather than at the top so the module costs nothing to load
  // on the paths -- replay, the test suite, every page -- that never see a PDF.
  const { getDocumentProxy } = await import("unpdf");
  const started = Date.now();
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const totalPages = pdf.numPages;
    if (limits.maxPages !== undefined && totalPages > limits.maxPages) {
      throw new PdfRefused("too_many_pages", `${totalPages} pages exceeds ${limits.maxPages}`);
    }
    const pages: string[] = [];
    for (let n = 1; n <= totalPages; n++) {
      if (limits.timeoutMs !== undefined && Date.now() - started > limits.timeoutMs) {
        throw new PdfRefused("extract_timeout", `still reading after ${limits.timeoutMs} ms, at page ${n} of ${totalPages}`);
      }
      const content = await (await pdf.getPage(n)).getTextContent();
      pages.push((content.items as Array<{ str?: string | null; hasEOL?: boolean }>)
        .filter((item) => item.str != null)
        .map((item) => item.str + (item.hasEOL ? "\n" : ""))
        .join(""));
    }
    return {
      text: pages.join("\n\f\n"),
      pageCount: totalPages,
      extractor: PDF_EXTRACTOR,
      extractorVersion: PDF_EXTRACTOR_VERSION,
    };
  } finally {
    // Whatever pdf.js still holds for this document goes, refused or not.
    // (This pdf.js build keeps destroy on the loading task, not the document.)
    await pdf.loadingTask.destroy().catch(() => { /* already gone */ });
  }
}
