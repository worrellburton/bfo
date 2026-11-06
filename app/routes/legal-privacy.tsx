import type { ReactNode } from "react";
import { LegalPage, PrivacyEmail, type LegalSection } from "../legal-page";
import { TextLink } from "../ui";
import { OPERATOR, PRIVACY_VERSION, RETENTION, TERMS_EFFECTIVE } from "../../lib/terms";

export function meta() {
  return [{ title: "Privacy notice · BFO" }, { name: "description", content: "What BFO collects, why, who receives it, how long it’s kept, and how to ask for a copy or deletion." }];
}

/**
 * The Privacy notice, written from what the code does: what each feature
 * collects, which provider receives it, and how long it is kept. When a
 * feature, a provider or a retention period changes, this page changes with
 * it (and PRIVACY_VERSION in lib/terms.ts). The owner's counsel reviews it.
 */

/** One kind of information: where it comes from, what it's for, who receives it. */
function Kind({ title, from, use, to, children }: { title: string; from: ReactNode; use: ReactNode; to: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-body font-semibold text-ink">{title}</h3>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-reading sm:grid-cols-[120px_1fr]">
        <dt className="text-small font-medium text-ink-2 sm:pt-1">From</dt>
        <dd>{from}</dd>
        <dt className="text-small font-medium text-ink-2 sm:pt-1">Used for</dt>
        <dd>{use}</dd>
        <dt className="text-small font-medium text-ink-2 sm:pt-1">Received by</dt>
        <dd>{to}</dd>
      </dl>
      {children && <div className="mt-2 text-reading">{children}</div>}
    </div>
  );
}

const SUMMARY = [
  "We collect what BFO needs to run the family office: who you are and how you sign in, the office’s records (entities, money, mail, texts and documents), and what you ask Ask BFO.",
  "We share it only with the services that run BFO, named below, and with the people the office lets in. We don’t sell it and we don’t use it for advertising.",
  `We keep financial and legal records for at least seven years, as tax law requires, and sign-in codes for ${RETENTION.loginCodesDays} days.`,
  "You can ask for a copy, a correction or deletion by writing to the office’s privacy address below.",
];

const SECTIONS: LegalSection[] = [
  {
    id: "who",
    title: "Who we are",
    body: (
      <>
        <p>
          BFO is run by {OPERATOR.legalName}, a {OPERATOR.state} limited liability company doing business as {OPERATOR.dba} (“we”, “us”). We decide how the information in BFO is used. Write to us at{" "}
          <PrivacyEmail />.
        </p>
        <p>This notice covers BFO’s website and apps. It doesn’t cover other companies’ sites that BFO links to.</p>
      </>
    ),
  },
  {
    id: "what",
    title: "What we collect, and who receives it",
    body: (
      <>
        <p>Supabase (our database and file storage) and Vercel (our hosting) hold or carry everything below; each item names who else receives it.</p>
        <div className="flex flex-col gap-4 rounded-card border border-line bg-raised p-4 md:p-5">
          <Kind title="Your account" from="You, or the office when it adds you." use="Signing you in, showing who you are, and naming who did what in the records." to="No one else.">
            <p>Your name, mobile number, email address, role, profile photo, and which version of the Terms you agreed to and when.</p>
          </Kind>
          <Kind title="Sign-in records" from="Your device." use="Sending sign-in codes, stopping misuse, and the record of who signed in and when." to="Bird, which sends the codes by text.">
            <p>The codes you ask for, the network (IP) address and device each request and sign-in came from, and the text disclosure you saw.</p>
          </Kind>
          <Kind
            title="Entities and their documents"
            from="The office, and state records read through Palm."
            use="Running the family’s companies and trusts, their filings and deadlines."
            to="Palm (filings and state records), and Anthropic when BFO reads a document for you."
          >
            <p>
              Details of each company and trust, their owners and managers, employer identification numbers (EINs), and documents such as operating agreements, tax returns and IRS letters. EINs are
              shown only to people with access to that entity. BFO doesn’t keep Social Security numbers: when the office applies for an EIN, the responsible party’s number goes straight to Palm for
              that application and isn’t stored. Documents the office uploads, such as W-9s, K-1s and trust papers, can contain Social Security numbers; they are kept as files, encrypted where they
              are stored, and only people with access to that entity can open them.
            </p>
          </Kind>
          <Kind
            title="Bank and brokerage information"
            from="Banks and brokerages, through Plaid and Mercury."
            use="Treasury, Investments and Books: balances, transactions, holdings and the office’s accounts."
            to="Plaid and Mercury, which provide it, and Anthropic or OpenAI when you ask Ask BFO about it."
          >
            <p>
              Account names and their last four digits, balances, transactions and holdings, and the categories, notes, receipts and change history the office adds in Books. Bank connections run
              through Plaid, which may collect your bank sign-in under its{" "}
              <TextLink inline to="https://plaid.com/legal/#end-user-privacy-policy">
                End User Privacy Policy
              </TextLink>
              . BFO never sees your bank password. Mercury accounts are read with the office’s own access, which only the office can turn off.
            </p>
          </Kind>
          <Kind
            title="Mail"
            from="The people who write to addresses on the family domain, and you."
            use="Mail in BFO."
            to="Bird, which delivers and receives the mail; Anthropic when you use AI on a message; Apple, for a short preview in a phone notification if you turn notifications on."
          >
            <p>
              Every email to and from addresses on the family domain, with attachments, including mail from people outside BFO and mail to shared addresses such as this notice’s privacy address. The
              small sender icons beside messages are looked up from Google, which receives the sender’s domain and your network address.
            </p>
          </Kind>
          <Kind title="Texts" from="The people who text the office’s number, and the office." use="The office’s texts in BFO." to="Bird, which carries them.">
            <p>Messages to and from the office’s number, including codes other services send to it.</p>
          </Kind>
          <Kind title="Paper mail" from="Stable, which receives and scans mail at the office’s mailbox." use="Paper mail in BFO." to="Stable, and Anthropic, which reads each piece for the office.">
            <p>Pictures of envelopes, scans of what’s inside, and what the reading found (sender, what it asks for, by when).</p>
          </Kind>
          <Kind title="Signatures" from="Signers, and the person who sends the document." use="Electronic signatures and their evidence." to="Bird, which emails the signing links and copies.">
            <p>Signers’ names and email addresses, their typed or drawn signatures, any address they type, the network address and time of each step, and the signed documents.</p>
          </Kind>
          <Kind
            title="Ask BFO"
            from="You."
            use="Answering your questions from BFO’s records."
            to="Anthropic (Claude) for typed questions; OpenAI for voice: your recording, its transcript, and the records read aloud to you."
          >
            <p>Your questions, the answers, the records each answer used, and your conversations, which are kept with your account.</p>
          </Kind>
          <Kind title="Notifications" from="Your device." use="Telling you about new mail and texts." to="Apple, which delivers them to your iPhone.">
            <p>Your device’s notification token and, in each notification, a short preview.</p>
          </Kind>
          <Kind title="The logo studio" from="Principals and admins who use it." use="Drawing the office’s logo." to="OpenAI, which draws the pictures, and Meshy, which makes 3D models of them.">
            <p>The office’s name and any notes typed into the studio. Pictures drawn by AI can’t be registered for copyright in the US; the logo BFO uses is set in type.</p>
          </Kind>
          <Kind title="On your device" from="BFO, in your browser or app." use="Keeping you signed in and remembering your settings." to="No one; it stays on your device.">
            <p>Your session, your other signed-in accounts on that device, your settings and recent places.</p>
          </Kind>
        </div>
        <p>
          BFO uses no analytics or advertising trackers. Its own fonts are served by BFO; if the office chooses a logo typeface of its own, that one font is loaded from Google Fonts, which receives
          your network address. Some of the office’s older entity records are still read from Google Firebase while they move into BFO.
        </p>
      </>
    ),
  },
  {
    id: "providers",
    title: "The companies that run BFO",
    body: (
      <>
        <ul>
          <li>Supabase: the database and file storage.</li>
          <li>Vercel: hosting, and short-lived server logs.</li>
          <li>Bird: sign-in codes, the office’s texts, and sending and receiving mail.</li>
          <li>Plaid and Mercury: bank and brokerage information.</li>
          <li>Palm: entity filings and state records; the EIN applicant’s Social Security number, for that application only.</li>
          <li>Stable: paper mail.</li>
          <li>Anthropic: Ask BFO’s typed answers, reading documents and paper mail, and help writing mail.</li>
          <li>OpenAI: Ask BFO’s voice, and the logo studio’s pictures.</li>
          <li>Meshy: the logo studio’s 3D models.</li>
          <li>Apple: the iPhone app and its notifications.</li>
          <li>Google: sender icons in Mail, a chosen logo typeface, and older records in Firebase.</li>
        </ul>
        <p>
          Each receives only what its part needs, under a contract with us. Anthropic and OpenAI receive information through their business services, whose terms don’t let them train their models on
          it; they keep it only as long as those terms allow for running the service and checking for misuse.
        </p>
      </>
    ),
  },
  {
    id: "access",
    title: "Who in the office sees what",
    body: (
      <ul>
        <li>Principals and admins see all of BFO, including the office’s texts and the shared mail: mail to addresses no one holds, such as the privacy address.</li>
        <li>Members and viewers see the office’s records; viewers can’t change them.</li>
        <li>
          Mail to your own address is shown only to you in BFO. Because the office runs the family domain, a principal can reach any mailbox on it when the law requires it or to look into misuse.
        </li>
        <li>Outside partners, such as the office’s accountants and lawyers, see only the entities shared with them, never staff notes, contracts or verification, and no mail.</li>
        <li>Signers see only the document they are asked to sign.</li>
        <li>We may also share information when the law requires it, to protect someone’s safety, or with a successor if the office’s work moves to another company.</li>
      </ul>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <>
        <ul>
          <li>
            Books, bank and brokerage records, receipts and their change history: at least seven years after the tax return for that year is filed, and records of what property cost until seven years
            after it is sold. Disconnecting a bank stops new information from it; it doesn’t erase the books.
          </li>
          <li>Entity records and documents: for the life of the entity, and seven years after it ends.</li>
          <li>Signed documents and their signature evidence: seven years after signing.</li>
          <li>Mail: until someone with access deletes it. Deleted mail is removed at once.</li>
          <li>Texts, paper mail and Ask BFO conversations: kept with the office’s records until the office deletes them.</li>
          <li>Sign-in codes, with the network address each came from: {RETENTION.loginCodesDays} days.</li>
          <li>A request to join that no one approves: {RETENTION.waitingRequestDays} days, then the request and the number are deleted.</li>
          <li>
            The record of sign-ins and of changes to who has access: for as long as BFO runs, because it is the office’s record. When someone is removed, their account is kept without access so that
            record still names them.
          </li>
        </ul>
        <p>We keep information longer when a legal hold, an audit or a dispute requires it. Copies in our providers’ backups expire on their own schedules.</p>
      </>
    ),
  },
  {
    id: "rights",
    title: "Your choices and requests",
    body: (
      <>
        <ul>
          <li>
            A copy, a correction or deletion: write to <PrivacyEmail />, or use Settings › Account and privacy. We answer within 30 days.
          </li>
          <li>
            Deleting your account removes your sign-in and your profile. The entities’ books and documents, and the record of what you did in BFO, stay for the periods above, with your name on those
            entries.
          </li>
          <li>Texts: reply STOP to the office’s number to stop its texts, START to have them again, HELP for help.</li>
          <li>Notifications: turn them off in BFO’s notification settings, or in your phone’s settings.</li>
          <li>Do Not Track: BFO doesn’t follow you across other sites, so a Do Not Track signal has nothing to turn off, and BFO doesn’t treat it differently.</li>
          <li>Nevada residents: we don’t sell covered information as Nevada law defines it. You can still send us a request about it at the address above.</li>
        </ul>
      </>
    ),
  },
  {
    id: "mobile",
    title: "Mobile numbers and texts",
    body: (
      <p>
        We use your mobile number to send the sign-in codes you ask for and messages from the office. Mobile information will not be shared with third parties or affiliates for marketing or
        promotional purposes. Text-messaging opt-in data and consent will not be shared with any third parties.
      </p>
    ),
  },
  {
    id: "security",
    title: "Keeping it safe",
    body: (
      <>
        <p>
          Information travels encrypted, and our database provider encrypts it where it is stored. People reach only what their role allows. Sign-in is by a one-time code, a session ends after 30
          days, and every sign-in and change to someone’s access is recorded.
        </p>
        <p>
          If information about you is exposed without permission, we’ll tell you by email and in BFO as soon as we reasonably can, and as Nevada (NRS 603A.220) and Arizona (A.R.S. 18-552) law require.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: <p>BFO is for invited adults. It isn’t meant for children, children can’t have accounts, and we don’t knowingly collect information from them.</p>,
  },
  {
    id: "changes",
    title: "Changes to this notice",
    body: <p>When we change this notice in a way that matters, we’ll tell you in BFO and by email before the change takes effect. Earlier versions are available from the office on request.</p>,
  },
];

export default function PrivacyNotice() {
  return <LegalPage title="Privacy notice" version={PRIVACY_VERSION} effective={TERMS_EFFECTIVE} summary={SUMMARY} sections={SECTIONS} sibling={{ to: "/legal/terms", label: "Terms of use" }} />;
}
