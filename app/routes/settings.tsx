import { useEffect, useState } from "react";
import { authFetch, getUser, isAdmin, type User } from "../auth";
import { BrandStudio } from "../brand-studio";
import { THEME_LABEL } from "../shell-model";
import { useTheme, type ThemeSetting } from "../theme";
import { Button, Card, CardSection, Page, PageHeader, Row, Rows, Segmented, TextLink, format, toast, useDocumentTitle } from "../ui";
import { roleLabel } from "../../lib/people";
import { PRIVACY_EMAIL, TERMS_VERSION } from "../../lib/terms";

export function meta() {
  return [{ title: "Settings · BFO" }];
}

/**
 * Settings: how BFO looks on this device, your account and privacy (every
 * role, partners and Email-only members included), and, for principals and
 * admins, the office's accounting basis and period lock, its data
 * connections, and the logo.
 */

type Period = { entity_name: string | null; closed_through: string; closed_by_name: string | null; closed_at: string };

const mailto = (subject: string) => `mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent(subject)}`;

function Appearance() {
  const { setting, setSetting } = useTheme();
  const options = (["auto", "light", "dark"] as const).map((v) => ({ value: v, label: THEME_LABEL[v] }));
  return (
    <Card title="Appearance">
      <div className="flex flex-col gap-2">
        <Segmented<ThemeSetting> label="Theme" value={setting} onChange={setSetting} options={options} />
        <p className="text-small text-ink-2">
          {setting === "auto" ? "Follows your device’s light or dark setting." : `Always ${THEME_LABEL[setting].toLowerCase()}, whatever your device uses.`} Saved on this device.
        </p>
      </div>
    </Card>
  );
}

function AccountAndPrivacy({ user }: { user: User }) {
  const [devices, setDevices] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const agreed = (user as User & { termsVersion?: string | null }).termsVersion;

  useEffect(() => {
    let live = true;
    authFetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && typeof d?.devices === "number" && setDevices(d.devices))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function signOutOthers() {
    setBusy(true);
    try {
      const res = await authFetch("/api/auth/session?scope=others", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      const n = typeof data.signedOut === "number" ? data.signedOut : 0;
      setDevices(1);
      toast({ message: n === 0 ? "No other devices were signed in" : `Signed out ${format.count(n, "other device")}` });
    } catch {
      toast({ message: "Couldn’t sign out your other devices. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Account and privacy">
      <Rows>
        <Row label="Name" hint="To change it, ask a principal or admin.">
          {user.name}
        </Row>
        <Row label="Signs in with">{user.phoneFormatted || user.phone}</Row>
        <Row label="Email">{user.email}</Row>
        {user.mailAddress && <Row label="Mailbox">{user.mailAddress}</Row>}
        <Row label="Role">{roleLabel(user.role)}</Row>
        <Row
          label="Devices"
          hint="Each device stays signed in for 30 days unless you sign out."
          action={
            <Button size="sm" onClick={() => void signOutOthers()} busy={busy} busyLabel="Signing out…" disabled={devices === 1}>
              Sign out other devices
            </Button>
          }
        >
          {devices === null ? "Signed in here" : devices <= 1 ? "Signed in on this device only" : `Signed in on ${format.count(devices, "device")}`}
        </Row>
        {"termsVersion" in user && (
          <Row label="Terms of use">
            {agreed === TERMS_VERSION ? `You agreed to the current version (${TERMS_VERSION})` : agreed ? `You agreed to the version of ${agreed}` : "You’ll be asked at your next sign-in"}
          </Row>
        )}
      </Rows>
      <CardSection title="Your information">
        <p className="max-w-[68ch] text-body text-ink-2">
          You can ask for a copy of what BFO holds about you, a correction, or for your account to be deleted. Deleting removes your sign-in and profile; the entities’ books and documents, and the
          record of what you did in BFO, stay for the periods in the Privacy notice.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-6">
          <TextLink to={mailto("A copy of my information in BFO")}>Ask for a copy</TextLink>
          <TextLink to={mailto("A correction to my information in BFO")}>Ask for a correction</TextLink>
          <TextLink to={mailto("Please delete my BFO account")}>Ask to delete my account</TextLink>
        </div>
        <p className="mt-2 text-small text-ink-2">These open an email to {PRIVACY_EMAIL}. The office answers within 30 days.</p>
      </CardSection>
      <CardSection title="About and legal">
        <div className="flex flex-wrap gap-x-6">
          <TextLink to="/legal/terms">Terms of use</TextLink>
          <TextLink to="/legal/privacy">Privacy notice</TextLink>
        </div>
      </CardSection>
    </Card>
  );
}

function Accounting() {
  const [periods, setPeriods] = useState<Period[] | null>(null);
  useEffect(() => {
    let live = true;
    authFetch("/api/books/ledger?report=periods")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setPeriods(d?.available && Array.isArray(d.periods) ? (d.periods as Period[]) : null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const latest = periods?.[0];
  return (
    <Card title="Accounting">
      <Rows>
        <Row label="Basis" hint="Income and expenses count when money moves; Books doesn’t track what’s owed.">
          Cash
        </Row>
        <Row label="Year">Calendar year, January to December, for every entity</Row>
        <Row label="Dates" hint="Times and “as of” stamps show in this device’s time zone.">
          Transactions carry the date the bank posted them
        </Row>
        {periods && (
          <Row
            label="Books closed through"
            hint={latest ? `Closed by ${latest.closed_by_name ?? "an admin"} on ${format.date(latest.closed_at, "medium")}` : "Close a period in Books to stop changes to it."}
          >
            {latest ? `${format.date(latest.closed_through, "long")}${latest.entity_name ? `, ${latest.entity_name}` : ", every entity"}` : "No period closed yet"}
          </Row>
        )}
      </Rows>
    </Card>
  );
}

function Connections() {
  return (
    <Card title="Data connections">
      <p className="max-w-[68ch] text-body text-ink-2">Banks and brokerages, and how each feed last synced, are on Treasury. Failed syncs and other alerts are on Notifications.</p>
      <div className="mt-2 flex flex-wrap gap-x-6">
        <TextLink to="/treasury">Treasury</TextLink>
        <TextLink to="/notifications">Notifications</TextLink>
      </div>
    </Card>
  );
}

export default function Settings() {
  useDocumentTitle("Settings");
  const [user] = useState(() => getUser());
  const admin = isAdmin(user);

  return (
    <Page width="reading" header={<PageHeader title="Settings" context={admin ? "How BFO looks, your account, and the office’s records and logo." : "How BFO looks, and your account."} />}>
      <Appearance />
      {user && <AccountAndPrivacy user={user} />}
      {admin && (
        <>
          <Accounting />
          <Connections />
        </>
      )}
      {admin && <BrandStudio />}
    </Page>
  );
}
