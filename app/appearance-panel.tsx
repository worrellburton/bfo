import { useMemo, useRef } from "react";
import { Button, Dialog, Segmented } from "./ui";
import { useTheme, type ThemeSetting } from "./theme";
import { THEME_LABEL } from "./shell-model";

/**
 * Appearance (docs/DESIGN.md §9.4): one choice, the theme, as Automatic,
 * Light or Dark. It applies as it's chosen and is kept on this device
 * (app/theme.tsx). A Dialog, so it's a bottom sheet on a phone, takes focus
 * on the current choice and gives it back to the account row on close.
 */
export function AppearancePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setting, setSetting } = useTheme();
  const options = (["auto", "light", "dark"] as const).map((v) => ({ value: v, label: THEME_LABEL[v] }));
  // Focus opens on the current choice (the arrow keys then move it).
  const wrap = useRef<HTMLDivElement>(null);
  const checked = useMemo(
    () => ({
      get current() {
        return wrap.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? null;
      },
    }),
    [],
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Appearance"
      description="Saved on this device."
      size="sm"
      initialFocus={checked}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div ref={wrap} className="flex flex-col gap-2">
        <span className="text-small font-medium text-ink-2" aria-hidden="true">
          Theme
        </span>
        <Segmented<ThemeSetting> label="Theme" value={setting} onChange={setSetting} options={options} full />
        <p className="text-small text-ink-2">{setting === "auto" ? "Follows your device’s light or dark setting." : `Always ${THEME_LABEL[setting].toLowerCase()}, whatever your device uses.`}</p>
      </div>
    </Dialog>
  );
}
