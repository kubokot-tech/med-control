/**
 * The brand on PDFs people hand to a doctor: the mark in the header band and a line with the site in the footer.
 * The mark's tile has the color of the band (C.accent in the report and the labs export), so only the stones show.
 */
import { fileURLToPath } from 'node:url';

const MARK = fileURLToPath(new URL('../assets/pdf-mark.png', import.meta.url));
const SITE = 'med-control.app';
export const MARK_SIZE = 52;

/** The mark at the right edge of the band; `right` is the page margin. */
export function pdfMark(doc, right, top = 6) {
  doc.image(MARK, doc.page.width - right - MARK_SIZE + 6, top, { width: MARK_SIZE, height: MARK_SIZE });
}

/** «Report prepared in MedControl · med-control.app», a link to the site. text(site) gives the line in the document's language. */
export function pdfBrandLine(doc, text, x, y, width, color) {
  doc.font('Inter-SemiBold').fontSize(8).fillColor(color).text(text(SITE), x, y, { width, align: 'center', lineBreak: false, link: `https://${SITE}`, underline: false });
}
