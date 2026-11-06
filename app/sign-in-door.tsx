/**
 * The door's form parts, shared by sign-in (routes/login.tsx) and finishing
 * setup (routes/complete-profile.tsx), and the footer the landing page shares
 * with them (docs/DESIGN.md §2.7, §11.4, §11.7, §13).
 *
 * The door is always night: its own palette (the door-* tokens), the brand
 * serif for the one heading and for what's typed, an ivory pill for the one
 * button. The owner's backdrop sits behind as a still frame, dimmed, with
 * static grain and the vignette: one continuous place from the landing page
 * in. Nothing moves behind a form, nothing animates per keystroke, and no
 * entrance animation sits on a control (so a disabled button always looks
 * disabled). On phones the column is top-anchored so the field and its
 * button stay above the keyboard; from 768px up it is centred.
 */

import { useId, useState, type ReactNode } from "react";
import { lockupOf, useBrandLogo, useHomeAnimation } from "./brand";
import { BrandLockup } from "./brand-lockup";
import { DoorSky } from "./door";
import { LegalLinks, Spinner, cx } from "./ui";
import { OPERATOR_LINE, PRIVACY_EMAIL } from "../lib/terms";
import { DOOR_FOCUS, useDoorChrome } from "./sign-in-style";

/** The owner's backdrop as a still frame behind a form, dimmed, with static grain and the vignette. */
export function DoorBackdrop({ dim = true }: { dim?: boolean }) {
  const backdrop = useHomeAnimation();
  return (
    <>
      {backdrop !== undefined && <DoorSky id={backdrop} still />}
      {/* The grain holds still: the landing page's moving grain is motion with nothing to say behind a form. */}
      <div aria-hidden className="door-grain" style={{ animation: "none" }} />
      <div aria-hidden className="door-vignette" />
      {dim && <div aria-hidden className="pointer-events-none fixed inset-0 bg-door opacity-40" />}
    </>
  );
}

/**
 * A door screen with a form: the lockup as the page's heading, the step,
 * and the footer. `step` is the small line above the title ("Sign in",
 * "Finish setup · 2 of 3").
 */
export function DoorScreen({
  children,
  footer = true,
  legalInFooter = true,
}: {
  children: ReactNode;
  footer?: boolean;
  /** False where the form already carries Terms and Privacy beside the field. */ legalInFooter?: boolean;
}) {
  useDoorChrome();
  const lockup = lockupOf(useBrandLogo());
  return (
    <div data-theme="dark" className="ds relative min-h-dvh bg-door font-sans text-door-ink">
      <DoorBackdrop />
      <div className="relative mx-auto flex min-h-dvh w-[min(100%-48px,360px)] flex-col pt-[max(calc(env(safe-area-inset-top)+8vh),48px)] pb-[max(calc(env(safe-area-inset-bottom)+16px),24px)] md:pt-12">
        <main className="flex flex-1 flex-col md:justify-center">
          <h1 className="m-0 text-center select-none">
            <span className="sr-only">Burton Family Office</span>
            <span aria-hidden>
              <BrandLockup font={lockup.font} finish={lockup.finish} size="compact" />
            </span>
          </h1>
          <div className="mt-10 text-center">{children}</div>
        </main>
        {footer && <DoorFooter className="mt-12 md:w-[560px] md:self-center" legal={legalInFooter} />}
      </div>
    </div>
  );
}

/** The step line, the serif title and its hint: the top of every door form. */
export function DoorHeading({ step, title, children }: { step: string; title: string; children?: ReactNode }) {
  return (
    <>
      <p className="text-small text-door-ink-2">{step}</p>
      <h2 className="mt-2 font-brand text-heading font-medium text-balance text-door-ink md:text-display md:font-medium">{title}</h2>
      {children && <div className="mt-3 text-small text-pretty text-door-ink-2">{children}</div>}
    </>
  );
}

/** The underline field, type in the brand serif (numbers) or the sans (words, `words`). */
export function DoorField({
  label,
  invalid,
  words,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; invalid?: boolean; words?: boolean; ref?: React.Ref<HTMLInputElement> }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={rest.id ?? id} className="sr-only">
        {label}
      </label>
      <input
        id={rest.id ?? id}
        aria-invalid={invalid || undefined}
        className={cx(
          "block w-full rounded-none border-0 border-b bg-transparent px-0 py-2 text-center text-door-ink caret-door-ink placeholder:text-door-ink-3",
          words ? "font-sans text-title font-normal" : "font-brand text-display font-medium tabular-nums",
          invalid ? "border-door-error" : "border-door-edge focus:border-door-ink",
          "transition-colors duration-(--dur-1)",
          DOOR_FOCUS,
          className,
        )}
        {...rest}
      />
    </div>
  );
}

/** The door's one button: the ivory pill, 48px. Disabled is drawn, not faded: an outline and the tertiary ink. */
export function DoorButton({
  busy,
  busyLabel,
  success,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyLabel?: string; success?: string | false }) {
  return (
    <button
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-door-ink bg-door-ink px-6 text-body font-medium text-door transition-colors duration-(--dur-1)",
        "enabled:hover:bg-door-ink-2 enabled:hover:border-door-ink-2",
        "disabled:cursor-not-allowed disabled:border-door-edge disabled:bg-transparent disabled:text-door-ink-3",
        success && "border-door-success! bg-door-success! text-door!",
        busy && "cursor-progress",
        DOOR_FOCUS,
        className,
      )}
      {...rest}
      onClick={busy ? (e) => e.preventDefault() : rest.onClick}
    >
      {success ? (
        success
      ) : busy ? (
        <>
          <Spinner />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** A text link or action on the door: 14px, door ink 2, ivory on hover, 44px tall. */
export function DoorLink({ className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex min-h-[44px] cursor-pointer items-center text-body text-door-ink-2 tabular-nums transition-colors duration-(--dur-1) enabled:hover:text-door-ink disabled:cursor-default",
        DOOR_FOCUS,
        className,
      )}
      {...rest}
    />
  );
}

/** One line under the button for what went wrong. */
export function DoorError({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="mt-4 text-small text-pretty text-door-error">
      {children}
    </p>
  ) : null;
}

/**
 * Six digits on six rules. A hidden input keeps typing, paste and iOS
 * code-autofill working; the rules only draw what it holds. `onComplete`
 * runs when the sixth digit lands.
 */
export function CodeEntry({
  value,
  onChange,
  onComplete,
  state,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  state: "idle" | "error" | "success";
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const cells = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
  const active = Math.min(value.length, 5);
  // Focus shows on the cell that takes the next digit: a heavier ivory rule.
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative" onClick={() => inputRef.current?.focus()}>
      <input
        ref={inputRef}
        id="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, "").slice(0, 6);
          onChange(next);
          if (next.length === 6) onComplete(next);
        }}
        aria-invalid={state === "error" || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="absolute inset-0 cursor-pointer opacity-0 outline-none!"
        aria-label="6-digit code"
      />
      <div className="flex justify-between gap-3" aria-hidden>
        {cells.map((ch, i) => (
          <div
            key={i}
            className={cx(
              "flex h-[52px] flex-1 items-center justify-center border-b font-brand text-display font-medium tabular-nums transition-colors duration-(--dur-1)",
              state === "success"
                ? "border-door-success text-door-success"
                : state === "error"
                  ? "border-door-error"
                  : focused && i === active && value.length < 6
                    ? "border-b-2 border-door-ink"
                    : ch
                      ? "border-door-ink-2"
                      : "border-door-edge",
            )}
          >
            {ch}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The door's footer, on every public screen: Terms, Privacy and a way to
 * reach the office, then who runs BFO and that it is private and recorded
 * (§11.7). Door ink 2, caption size, 44px tall links on touch.
 */
export function DoorFooter({ className, legal = true }: { className?: string; legal?: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer className={cx("text-center text-caption text-door-ink-2", className)}>
      <div>
        {legal && (
          <>
            <LegalLinks tone="door" className="inline text-door-ink-2 touch:[&_a]:inline-flex touch:[&_a]:min-h-[44px] touch:[&_a]:items-center" />
            <span aria-hidden="true"> · </span>
          </>
        )}
        <a href={`mailto:${PRIVACY_EMAIL}`} className={cx("underline-offset-[3px] hover:text-door-ink hover:underline touch:inline-flex touch:min-h-[44px] touch:items-center", DOOR_FOCUS)}>
          Contact
        </a>
      </div>
      <p className="mt-1 text-balance">A private system for people the office has invited. Sign-ins are recorded.</p>
      <p className="text-balance">
        © {year} {OPERATOR_LINE}
      </p>
    </footer>
  );
}
