import html2canvas from "html2canvas-pro";
import { jsPDF } from "jspdf";
import { createLogger } from "./debug/logger";

const log = createLogger("pdf-export");

export interface PdfExportOptions {
  title?: string;
}

/**
 * Export a DOM element to PDF using html2canvas + jsPDF.
 * Captures the element as images and assembles them into pages.
 * Returns the PDF as a Uint8Array for the caller to save.
 */
export async function exportElementToPdf(
  element: HTMLElement,
  options?: PdfExportOptions,
): Promise<Uint8Array> {
  const { title } = options ?? {};

  log.info("Starting PDF export", {
    elementSize: element.getBoundingClientRect(),
  });

  try {
    // Capture the element as canvas
    const canvas = await html2canvas(element, {
      scale: 2, // Higher resolution for better quality
      useCORS: true, // Allow cross-origin images
      logging: false,
      backgroundColor: "#ffffff",
      // Ensure all content is rendered including overflow
      windowWidth: element.scrollWidth,
      windowHeight: element.scrollHeight,
    });

    log.info("Canvas captured", { width: canvas.width, height: canvas.height });

    // Calculate dimensions
    const imgWidth = 210; // A4 width in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const pageHeight = 297; // A4 height in mm

    // Create PDF
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    // Set document properties
    if (title) {
      pdf.setProperties({
        title,
        creator: "ClaudePrism",
      });
    }

    // If content fits on one page
    if (imgHeight <= pageHeight) {
      const imgData = canvas.toDataURL("image/png");
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
    } else {
      // Split across multiple pages
      let heightLeft = imgHeight;
      let position = 0;
      const imgData = canvas.toDataURL("image/png");

      // First page
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Additional pages
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
    }

    log.info("PDF generated, getting bytes...", {
      pageCount: pdf.getNumberOfPages(),
    });

    // Return PDF as Uint8Array
    const pdfBytes = pdf.output("arraybuffer");
    log.info("PDF bytes generated", { size: pdfBytes.byteLength });

    return new Uint8Array(pdfBytes);
  } catch (error) {
    log.error("PDF export failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Failed to export PDF: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Export markdown content to PDF by rendering it first.
 * Creates a hidden container, renders the markdown, captures it, then cleans up.
 *
 * TODO: This function is intentionally a stub. The PDF export workflow is designed
 * to use exportElementToPdf directly on the rendered preview container element,
 * which is managed by the MarkdownPreview component. This avoids duplicate
 * rendering logic and ensures the exported PDF matches the preview exactly.
 * Implementing this function would require re-rendering markdown content in an
 * isolated context, which could lead to styling inconsistencies.
 */
export async function exportMarkdownToPdf(
  _content: string,
  _options?: PdfExportOptions,
): Promise<Uint8Array> {
  // This will be called from the preview component which already has rendered content
  // We'll use exportElementToPdf directly on the preview container
  throw new Error(
    "Use exportElementToPdf directly on the preview container element",
  );
}
