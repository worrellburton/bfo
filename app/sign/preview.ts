// The office's preview of the signing game (/sign/preview, from the account
// menu): who may open it, and the sample document it signs nothing on.
import type { User } from "../auth";
import type { SignField } from "./api";

/** The accounts whose menu offers "Preview the signing game". */
const PREVIEW_ACCOUNTS = new Set(["worrellburton@gmail.com"]);

export function canPreviewGame(user: User | null): boolean {
  return !!user?.email && PREVIEW_ACCOUNTS.has(user.email.trim().toLowerCase());
}

export const PREVIEW_TITLE = "Sample Agreement (preview)";

/** A one-page sample agreement as a blob URL, and where its signature goes. */
export async function samplePdf(signer: string): Promise<{ url: string; pages: Array<{ w: number; h: number }>; fields: SignField[] }> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const ink = rgb(0.08, 0.08, 0.1);
  page.drawText("BFO", { x: 56, y: 720, size: 14, font: bold, color: ink });
  page.drawText("SAMPLE AGREEMENT", { x: 56, y: 686, size: 20, font: bold, color: ink });
  const lines = [
    "This is the document a signer sees after the Anything Is Possible game.",
    "Nothing here is binding: the preview never saves a signature.",
    "",
    "1. The parties agree that anything is possible.",
    "2. The signer has crossed the hall of blocks, found the seat with",
    "   their name on it, and watched the film to the end.",
    "3. The door opened. They walked through it and found this desk.",
    "",
    `Signer: ${signer}`,
  ];
  let y = 650;
  for (const line of lines) {
    page.drawText(line, { x: 56, y, size: 11.5, font: serif, color: ink });
    y -= 18;
  }
  page.drawLine({ start: { x: 56, y: 150 }, end: { x: 300, y: 150 }, thickness: 0.8, color: ink });
  page.drawText("Signature", { x: 56, y: 136, size: 9, font: serif, color: rgb(0.45, 0.45, 0.47) });
  const bytes = await doc.save();
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  return { url, pages: [{ w: 612, h: 792 }], fields: [{ id: "preview-sig", party: "a", type: "signature", page: 1, x: 56 / 612, y: 1 - 200 / 792, w: 244 / 612, h: 48 / 792 }] };
}
