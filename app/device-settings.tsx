import { useState } from "react";
import { authFetch, getUser } from "./auth";
import { useAppLockSetting } from "./app-lock";
import { enablePush, usePushState } from "./push";
import { useInstall } from "./pwa";
import { canPreviewGame } from "./sign/preview";
import { Button, Card, Row, Rows, Switch, TextLink } from "./ui";

/**
 * What moved out of the account menu (docs/DESIGN.md §9.4), ready for
 * Settings to show:
 *
 * - <ThisDeviceSettings />: installing the app, notifications on this device
 *   (with what they show on the lock screen, and a test), and the iPhone
 *   app's lock (turning it off takes Face ID; some roles can't).
 * - <LabsSettings />: the owner's previews, Games and the front-door
 *   gallery. Renders nothing for anyone else.
 *
 * Each is a Card and hides the rows this device can't use.
 */

export function ThisDeviceSettings() {
  const user = getUser();
  const { canInstall, install } = useInstall();
  const [push, setPush] = usePushState();
  const [note, setNote] = useState<string | null>(null);
  const lock = useAppLockSetting(user?.role);
  const [lockNote, setLockNote] = useState<string | null>(null);
  if (!canInstall && push === "unsupported" && !lock.kind) return null;

  async function test() {
    const r = (await authFetch("/api/push", { method: "POST", body: JSON.stringify({ action: "test" }) })
      .then((x) => x.json())
      .catch(() => null)) as { sent?: boolean; devices?: number; error?: string } | null;
    setNote(
      !r ? "Couldn’t reach BFO. Try again." : r.sent ? "Sent. Check your lock screen." : r.devices ? "Apple didn’t deliver it. Try again later." : "This device isn’t set up for notifications yet.",
    );
  }

  return (
    <Card title="This device">
      <Rows>
        {canInstall && (
          <Row
            label="App"
            hint="Opens BFO in its own window, from your dock or home screen."
            action={
              <Button size="sm" onClick={() => void install()}>
                Install BFO
              </Button>
            }
          >
            Not installed
          </Row>
        )}
        {push !== "unsupported" && (
          <Row
            label="Notifications"
            hint={
              push === "denied"
                ? "Turned off for BFO in this device’s settings. Turn them on there."
                : (note ?? "New mail and texts to the office show who they’re from and how they begin, on the lock screen, even while BFO is locked.")
            }
            action={
              push === "granted" ? (
                <Button size="sm" variant="quiet" onClick={() => void test()}>
                  Send a test
                </Button>
              ) : push === "prompt" ? (
                <Button size="sm" onClick={async () => setPush(await enablePush())}>
                  Turn on
                </Button>
              ) : undefined
            }
          >
            {push === "granted" ? "On" : "Off"}
          </Row>
        )}
        {lock.kind && (
          <div className="py-3">
            <Switch
              checked={lock.on}
              disabled={lock.required}
              label={`${lock.kind} lock`}
              hint={
                lockNote ??
                (lock.required
                  ? `Always on for your role: you can see the office’s codes or change the books.`
                  : `Asks for ${lock.kind} when BFO opens and after a minute away. Turning it off asks for ${lock.kind} first.`)
              }
              onChange={async (v) => {
                const ok = await lock.set(v);
                setLockNote(ok ? null : `Still on: ${lock.kind} didn’t confirm it’s you.`);
              }}
            />
          </div>
        )}
      </Rows>
    </Card>
  );
}

export function LabsSettings() {
  if (!canPreviewGame(getUser())) return null;
  return (
    <Card title="Labs">
      <Rows>
        <Row label="Games" hint="What a signer sees in game mode, on a sample document." action={<TextLink to="/games">Open</TextLink>}>
          Signing previews
        </Row>
        <Row label="Front door" hint="Choose the backdrop the landing page shows." action={<TextLink to="/home-animations">Open</TextLink>}>
          Backdrop gallery
        </Row>
      </Rows>
    </Card>
  );
}
