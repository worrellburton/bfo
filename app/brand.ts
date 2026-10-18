import { useEffect, useState } from "react";
import { authFetch } from "./auth";

/**
 * The BFO logo, browser side: the 3D logo the site shows (public, cached once
 * per page load) and the studio calls that make it (owner/admin).
 */

export type Logo = { styleId: string; glbUrl: string; usdzUrl?: string | null; posterUrl: string | null; imageUrl: string; updatedAt: number };
export type SheetEntry = { imageUrl: string; imagePath: string; prompt: string; model: string; createdAt: number };
export type ModelState = {
  taskId: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
  progress: number;
  glbUrl?: string | null;
  usdzUrl?: string | null;
  posterUrl?: string | null;
  error?: string | null;
  createdAt: number;
  updatedAt: number;
};
export type Studio = {
  configured: { openai: boolean; meshy: boolean };
  styles: { id: string; name: string; blurb: string; prompt: string }[];
  sheet: { styles: Record<string, SheetEntry>; generatedAt: number };
  models: Record<string, ModelState | null>;
  logo: Logo | null;
};

let logoPromise: Promise<Logo | null> | null = null;
let logoNow: Logo | null | undefined;
const listeners = new Set<(l: Logo | null) => void>();

/** The logo in use, fetched once and shared by every component on the page. */
export function loadLogo(): Promise<Logo | null> {
  if (!logoPromise) {
    logoPromise = fetch("/api/brand")
      .then((r) => (r.ok ? r.json() : { logo: null }))
      .then((j: { logo: Logo | null }) => {
        logoNow = j.logo ?? null;
        return logoNow;
      })
      .catch(() => {
        logoNow = null;
        return null;
      });
  }
  return logoPromise;
}

/** After the studio changes the logo, every viewer on the page follows. */
export function setLogoNow(logo: Logo | null) {
  logoNow = logo;
  logoPromise = Promise.resolve(logo);
  listeners.forEach((fn) => fn(logo));
}

export function useBrandLogo(): Logo | null | undefined {
  const [logo, setLogo] = useState<Logo | null | undefined>(logoNow);
  useEffect(() => {
    let live = true;
    void loadLogo().then((l) => live && setLogo(l));
    const fn = (l: Logo | null) => setLogo(l);
    listeners.add(fn);
    return () => {
      live = false;
      listeners.delete(fn);
    };
  }, []);
  return logo;
}

export class BrandError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message);
  }
}

export async function loadStudio(): Promise<Studio> {
  const r = await authFetch("/api/brand?studio=1");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new BrandError(j?.message || `Couldn't load the logo studio (${r.status}).`, j?.error, r.status);
  return j as Studio;
}

export async function brandCall<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await authFetch("/api/brand", { method: "POST", body: JSON.stringify({ action, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new BrandError(j?.message || `Request failed (${r.status}).`, j?.error, r.status);
  return j as T;
}
