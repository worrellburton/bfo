import { useRef, useState } from "react";
import { removeMailPhoto, setMailPhoto, type MailFaces } from "../mail-client";

// ── My picture ───────────────────────────────────────────────────────────

/** The side of the square picture we keep: sharp at every size the inbox shows. */
const PHOTO_PX = 256;

/**
 * A picture file as a small square JPEG (a data: URL): cropped from the middle,
 * or a little above it on a portrait, where a face usually is.
 */
async function squarePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That picture couldn't be read. Try a JPEG or PNG."));
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error("That picture couldn't be read. Try a JPEG or PNG.");
    const side = Math.min(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = PHOTO_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't prepare pictures. Try another browser.");
    ctx.imageSmoothingQuality = "high";
    // A transparent PNG goes on white, not black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, PHOTO_PX, PHOTO_PX);
    ctx.drawImage(img, (w - side) / 2, h > w ? (h - side) * 0.25 : (h - side) / 2, side, side, 0, 0, PHOTO_PX, PHOTO_PX);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * My picture for my mail: the one shown beside my mail in everyone's inbox
 * here. `input` is a hidden file field to render once; `choose` opens it;
 * `remove` goes back to initials.
 */
export function usePhotoPicker(onFaces: (faces: MailFaces) => void, onError: (message: string) => void) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function save(work: () => Promise<{ faces: MailFaces }>) {
    setBusy(true);
    try {
      onFaces((await work()).faces);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void save(async () => setMailPhoto(await squarePhoto(f)));
      }}
    />
  );
  return { input, busy, choose: () => fileRef.current?.click(), remove: () => void save(removeMailPhoto) };
}
