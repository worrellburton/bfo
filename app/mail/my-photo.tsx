import { useContext, useEffect, useRef, useState } from "react";
import { Icon, useTone } from "../entity/ui";
import { removeMailPhoto, setMailPhoto, type MailFaces } from "../mail-client";
import { Avatar, FacesContext } from "./avatar";

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
    if (!ctx) throw new Error("This browser can't prepare pictures.");
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
 * My face beside the title: the picture shown with my mail in everyone's
 * inbox here. Click it to choose one, or to go back to initials.
 */
export function MyPhoto({ address, name, onFaces }: { address: string; name: string | null; onFaces: (faces: MailFaces) => void }) {
  const t = useTone();
  const has = !!useContext(FacesContext)[address.toLowerCase()];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function save(work: () => Promise<{ faces: MailFaces }>) {
    setBusy(true);
    setError(null);
    try {
      onFaces((await work()).faces);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const item = `flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12.5px] disabled:cursor-default disabled:opacity-50 max-sm:min-h-[44px] ${t.dark ? "text-gray-200 hover:bg-white/[0.05]" : "text-gray-800 hover:bg-gray-50"}`;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label="Your picture for mail"
        title="Your picture for mail"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setError(null);
        }}
        className={`group/photo relative block cursor-pointer rounded-full transition-shadow focus-visible:outline-none ${t.dark ? "focus-visible:ring-2 focus-visible:ring-white/40" : "focus-visible:ring-2 focus-visible:ring-gray-400"}`}
      >
        <Avatar a={{ email: address, name }} size="h-11 w-11 text-[14px]" />
        <span
          aria-hidden="true"
          className={`absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white transition-opacity ${busy ? "opacity-100" : "opacity-0 group-hover/photo:opacity-100"}`}
        >
          {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Icon name="upload" className="h-4 w-4" strokeWidth={2} />}
        </span>
      </button>
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
      {open && (
        <div
          className={`absolute left-0 top-full z-30 mt-2 w-[240px] overflow-hidden rounded-xl border py-1 shadow-lg ${t.dark ? "border-white/10 bg-[#111114]" : "border-gray-200 bg-white"}`}
        >
          <p className={`px-3 pb-1.5 pt-2 text-[11.5px] leading-[1.45] ${t.muted}`}>Shown beside your mail in everyone's inbox here.</p>
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={item}>
            <Icon name="upload" />
            {busy ? "Saving…" : has ? "Choose a new picture" : "Choose a picture"}
          </button>
          {has && (
            <button type="button" disabled={busy} onClick={() => void save(removeMailPhoto)} className={item}>
              <Icon name="trash" />
              Use my initials
            </button>
          )}
          {error && <p className={`px-3 pb-2 pt-1 text-[12px] ${t.dark ? "text-red-400" : "text-red-600"}`}>{error}</p>}
        </div>
      )}
    </div>
  );
}

