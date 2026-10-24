/**
 * What kind of file an attachment is, from its name and content type, so the
 * list and the reader can show a fitting icon (app/file-icon.tsx) rather than
 * a paper clip for everything.
 */

export type FileKind = "pdf" | "image" | "sheet" | "doc" | "slides" | "archive" | "audio" | "video" | "calendar" | "code" | "text" | "file";

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  pdf: "PDF",
  image: "Image",
  sheet: "Spreadsheet",
  doc: "Document",
  slides: "Presentation",
  archive: "Archive",
  audio: "Audio",
  video: "Video",
  calendar: "Calendar invite",
  code: "Code",
  text: "Text",
  file: "File",
};

const BY_EXT: Record<string, FileKind> = {
  pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", heic: "image", heif: "image", svg: "image", bmp: "image", tif: "image", tiff: "image", avif: "image",
  xls: "sheet", xlsx: "sheet", xlsm: "sheet", csv: "sheet", tsv: "sheet", numbers: "sheet", ods: "sheet",
  doc: "doc", docx: "doc", pages: "doc", odt: "doc", rtf: "doc",
  ppt: "slides", pptx: "slides", key: "slides", odp: "slides",
  zip: "archive", rar: "archive", "7z": "archive", gz: "archive", tgz: "archive", tar: "archive", bz2: "archive", dmg: "archive",
  mp3: "audio", m4a: "audio", wav: "audio", aac: "audio", flac: "audio", ogg: "audio", oga: "audio", caf: "audio",
  mp4: "video", mov: "video", m4v: "video", webm: "video", mkv: "video", avi: "video",
  ics: "calendar", ical: "calendar", vcs: "calendar",
  js: "code", ts: "code", tsx: "code", jsx: "code", json: "code", py: "code", rb: "code", go: "code", rs: "code", java: "code", c: "code", h: "code", cpp: "code", cs: "code", swift: "code", kt: "code", sh: "code", sql: "code", html: "code", css: "code", xml: "code", yml: "code", yaml: "code", toml: "code",
  txt: "text", md: "text", log: "text", eml: "text", vcf: "text",
};

export function fileKind(filename: string | null | undefined, contentType: string | null | undefined): FileKind {
  const type = (contentType ?? "").toLowerCase().split(";")[0].trim();
  const name = (filename ?? "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  // The name's extension is the better witness: senders often label everything application/octet-stream.
  if (ext && BY_EXT[ext]) return BY_EXT[ext];
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type === "text/calendar") return "calendar";
  if (type === "text/csv" || type.includes("spreadsheet") || type.includes("excel")) return "sheet";
  if (type.includes("presentation") || type.includes("powerpoint")) return "slides";
  if (type.includes("wordprocessing") || type === "application/msword" || type === "application/rtf") return "doc";
  if (type.includes("zip") || type.includes("compressed") || type.includes("tar") || type === "application/x-rar") return "archive";
  if (type === "application/json" || type === "application/xml" || type === "application/javascript" || type.startsWith("text/x-")) return "code";
  if (type.startsWith("text/")) return "text";
  return "file";
}

/** The distinct kinds among a message's attachments, in order of first appearance. */
export function fileKinds(files: { filename?: string | null; contentType?: string | null }[]): FileKind[] {
  const out: FileKind[] = [];
  for (const f of files) {
    const k = fileKind(f.filename, f.contentType);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}
