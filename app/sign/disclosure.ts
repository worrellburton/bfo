// The Electronic Records and Signatures Disclosure a signer agrees to before
// signing (ESIGN §101(c), UETA §5), and the short privacy notice for signers.
// Shown on the signing page (the consent dialog, the footer, and /sign/<token>#disclosure
// from the email). Plain words, written for the owner's counsel to review.
//
// The version is what the server records with each consent (lib/sign.ts
// ESIGN_DISCLOSURE_VERSION must match; tests/sign-disclosure.test.ts checks).
// Change the words, change the version, in both places.

export const DISCLOSURE_VERSION = "2026-11-06";

/** "Effective Nov 6, 2026", from the version. */
export const DISCLOSURE_EFFECTIVE = "November 6, 2026";

/** The four points the consent dialog shows in place (§11.4); the full text is one link away. */
export function consentPoints(sender: string): string[] {
  return [
    "You agree to receive this document, and its signed copy, electronically, and to sign it electronically. Your electronic signature counts as your handwritten one.",
    `You can ask ${sender} for a paper copy at any time, at no charge.`,
    "Until you sign, you can withdraw by declining instead. The request then closes and nobody signs it.",
    "You need a current web browser, a way to open PDF files, and access to your email.",
  ];
}

export type DisclosureSection = { heading: string; paragraphs: string[] };

/** The whole disclosure, with the sender named ("Burton Family Office", or the entity a request is sent under). */
export function disclosureSections(sender: string): DisclosureSection[] {
  return [
    {
      heading: "What you're agreeing to",
      paragraphs: [
        `${sender} has sent you a document to sign electronically. Before you sign, we ask you to agree to use electronic records and signatures for this document. That means you receive the document, any notices about it, and the signed copy electronically (on this page and by email), and that you sign it electronically. An electronic signature has the same legal effect as one in ink.`,
        "Your agreement covers this document only: its signing, its signed copy, and notices about it. It doesn't cover anything else.",
      ],
    },
    {
      heading: "A paper copy",
      paragraphs: [
        `You can ask for a paper copy of the document or of the signed copy at any time, at no charge. Reply to the email that brought you here, or write to ${sender}, and say which document you want and where to send it.`,
      ],
    },
    {
      heading: "Withdrawing your agreement",
      paragraphs: [
        "You can withdraw before you sign by choosing “I’d rather not sign” on the signing page. The request then closes for everyone and the sender is told. There's no fee and no other consequence from us; the sender may contact you about another way to sign.",
        "Withdrawing doesn't undo a signature already given. If you've signed and want to withdraw from the agreement itself, that is a matter between you and the other parties.",
      ],
    },
    {
      heading: "What you need",
      paragraphs: [
        "A current web browser (Safari, Chrome, Edge or Firefox) on a computer, tablet or phone; a way to open PDF files, which those browsers include; and access to the email address the request was sent to, so you receive the signed copy. Some requests offer a short film or game before the signing page on a computer. It's optional: on any device you can go straight to the document and sign.",
        "To keep a copy, use “Download as PDF” on the signing page, or the link in the email that brings you the signed copy.",
      ],
    },
    {
      heading: "If your email address changes",
      paragraphs: [`Tell ${sender} your new address by replying to the email. The signed copy and any notices go to the address the request was sent to until then.`],
    },
    {
      heading: "What we keep, and why",
      paragraphs: [
        "To show who signed and how, we keep with the document: your name, your email address, the name you type and your signature as drawn or typed, your address if the document asks for it, the times you opened the document, agreed, signed or declined, the network (IP) address and the browser and device each came from, and any reason you give for declining.",
        "It is kept as long as the office keeps the document's records, which for agreements is usually for as long as they matter and then the time the law requires records to be kept. It is stored with Supabase (our database and file storage) and emailed through Bird (our email service). When you sign or decline, the office is told by email and by a notification on its own devices. Nothing is sold or used for advertising.",
        `To ask what we hold about you, to correct it, or about deleting it (where the law doesn't require us to keep it), write to ${sender} by replying to the email that brought you here.`,
      ],
    },
  ];
}
