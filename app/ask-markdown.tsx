import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";

/**
 * The assistant's answers, from the little markdown it writes: paragraphs,
 * headings, bulleted and numbered lists, simple tables, bold, italic, inline
 * code and links. Links into BFO (/assets/…, /inbox?m=…) are client-side
 * routes; anything else opens in a new tab. No HTML is ever interpreted.
 */

type Block = { kind: "p"; text: string } | { kind: "h"; level: number; text: string } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] } | { kind: "table"; rows: string[][] } | { kind: "code"; text: string };

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  const flushPara = (buf: string[]) => {
    if (buf.length) out.push({ kind: "p", text: buf.join(" ") });
    buf.length = 0;
  };
  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flushPara(para);
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      flushPara(para);
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(para);
      out.push({ kind: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      flushPara(para);
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*[-*•]\s+/, "");
        i++;
        // A wrapped item continues on indented lines.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*•]\s+/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(item);
      }
      out.push({ kind: "ul", items });
      continue;
    }
    if (/^\s*\d{1,3}[.)]\s+/.test(line)) {
      flushPara(para);
      const items: string[] = [];
      while (i < lines.length && /^\s*\d{1,3}[.)]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*\d{1,3}[.)]\s+/, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*\d{1,3}[.)]\s+/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(item);
      }
      out.push({ kind: "ol", items });
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flushPara(para);
      const rows: string[][] = [];
      const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      rows.push(cells(line));
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      out.push({ kind: "table", rows });
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flushPara(para);
  return out;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) return <em key={i}>{part.slice(1, -1)}</em>;
        if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-black/[0.06] px-1 py-px font-mono text-[0.92em] dark:bg-white/10">{part.slice(1, -1)}</code>;
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
        if (link) {
          const [, label, href] = link;
          if (href.startsWith("/")) return <Link key={i} to={href} className="ask-link">{label}</Link>;
          if (/^https?:\/\//i.test(href)) return <a key={i} href={href} target="_blank" rel="noreferrer" className="ask-link">{label}</a>;
          return <Fragment key={i}>{label}</Fragment>;
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

export function Markdown({ text }: { text: string }): ReactNode {
  const blocks = parseBlocks(text);
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h": {
            const Tag = (b.level <= 2 ? "h3" : "h4") as "h3" | "h4";
            return (
              <Tag key={i} className={`ask-h ${b.level <= 2 ? "text-[14.5px]" : "text-[13.5px]"}`}>
                <Inline text={b.text} />
              </Tag>
            );
          }
          case "ul":
            return (
              <ul key={i} className="ask-list list-disc">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="ask-list list-decimal">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} />
                  </li>
                ))}
              </ol>
            );
          case "table":
            return (
              <div key={i} className="ask-table-wrap">
                <table className="ask-table">
                  <thead>
                    <tr>
                      {b.rows[0].map((c, j) => (
                        <th key={j}>
                          <Inline text={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.slice(1).map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k} className={/^[-–]?\$?[\d,.]+%?$/.test(c.trim()) ? "text-right tabular-nums" : ""}>
                            <Inline text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "code":
            return (
              <pre key={i} className="ask-code">
                {b.text}
              </pre>
            );
          default:
            return (
              <p key={i} className="ask-p">
                <Inline text={b.text} />
              </p>
            );
        }
      })}
    </>
  );
}
