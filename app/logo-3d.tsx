import { useEffect, useState, type CSSProperties } from "react";

/**
 * A 3D logo (GLB) shown with Google's <model-viewer>, loaded from its CDN the
 * first time one is on the page. Until the script is in, the poster image
 * stands in; without WebGL, it stays.
 */

const SCRIPT = "https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js";

let ready: Promise<boolean> | null = null;

function loadViewer(): Promise<boolean> {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (customElements.get("model-viewer")) return resolve(true);
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return resolve(false);
    const s = document.createElement("script");
    s.type = "module";
    s.src = SCRIPT;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return ready;
}

declare module "react" {
  // The custom element's typing has to be added inside React's JSX namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
    }
  }
}

export function Logo3D({
  src,
  poster,
  alt = "BFO",
  className = "",
  style,
  interactive = false,
  spin = true,
  exposure = 1,
}: {
  src: string;
  poster?: string | null;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  /** Lets the viewer drag it around (the landing page); off, it only turns on its own. */
  interactive?: boolean;
  spin?: boolean;
  exposure?: number;
}) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void loadViewer().then((v) => live && setOk(v));
    return () => {
      live = false;
    };
  }, []);

  if (!ok) {
    return poster ? <img src={poster} alt={alt} className={`object-contain ${className}`} style={style} draggable={false} /> : <span className={className} style={style} aria-label={alt} />;
  }
  const attrs: Record<string, string> = {
    "touch-action": "pan-y",
    "shadow-intensity": "0",
    "environment-image": "neutral",
    exposure: String(exposure),
    loading: "eager",
    reveal: "auto",
    ...(spin ? { "auto-rotate": "", "rotation-per-second": "28deg", "auto-rotate-delay": "0" } : {}),
    ...(interactive ? { "camera-controls": "", "disable-zoom": "", "disable-pan": "", "interaction-prompt": "none" } : {}),
  };
  return <model-viewer src={src} poster={poster ?? undefined} alt={alt} class={className} style={{ background: "transparent", "--poster-color": "transparent", ...style } as CSSProperties} {...attrs} />;
}
