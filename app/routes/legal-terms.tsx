import { LegalPage, PrivacyEmail, type LegalSection } from "../legal-page";
import { TextLink } from "../ui";
import { OPERATOR, TERMS_EFFECTIVE, TERMS_VERSION } from "../../lib/terms";

export function meta() {
  return [{ title: "Terms of use · BFO" }, { name: "description", content: "The terms for using BFO, the Burton Family Office’s private system." }];
}

/**
 * The Terms of use. Written plainly for the app as built; the owner's counsel
 * reviews every change. A change to the text gets a new TERMS_VERSION and
 * TERMS_EFFECTIVE in lib/terms.ts, and everyone agrees again at next sign-in.
 */

const SUMMARY = [
  <>
    BFO is the private system {OPERATOR.legalName} (doing business as {OPERATOR.dba}) runs for the family office. You may use it only if the office invited you, and only for the office’s work.
  </>,
  "Keep your sign-in to yourself and what you see in BFO confidential, including after your access ends.",
  "Books and reports are the office’s working records, not audited statements. Answers and drafts made by AI can be wrong, and nothing in BFO is legal, tax or investment advice.",
  "We text sign-in codes when you ask for them, and the office may text you. Message and data rates may apply; reply STOP to stop the office’s texts.",
  "Nevada law applies. Questions go to the office’s privacy address below.",
];

const SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    title: "Who we are and this agreement",
    body: (
      <>
        <p>
          These Terms of use are an agreement between you and {OPERATOR.legalName}, a {OPERATOR.state} limited liability company doing business as {OPERATOR.dba} (“BFO”, “we”, “us”). They cover BFO’s
          website and apps (the “Service”).
        </p>
        <p>
          You agree to them when you choose Agree and continue after signing in. If you don’t agree, don’t use the Service. If you use it for a firm or other organization, such as your accounting or
          law firm, you agree for that organization too and confirm you can.
        </p>
        <p>If you have a separate written agreement with the office, such as an engagement letter, that agreement controls where it conflicts with these Terms.</p>
      </>
    ),
  },
  {
    id: "service",
    title: "What BFO does",
    body: (
      <>
        <p>BFO keeps the family office’s records and work in one place:</p>
        <ul>
          <li>Entities: the family’s companies and trusts, their documents, owners, deadlines and state filings. Some filings and state records go through Palm, a filing service.</li>
          <li>Treasury and Investments: balances, transactions and holdings from banks and brokerages, through Plaid and Mercury.</li>
          <li>Books: the office’s accounting record for each entity (section 6).</li>
          <li>Mail: email on the family domain, sent and received in BFO, including mail to shared addresses.</li>
          <li>Paper mail: mail to the office’s mailbox, scanned by Stable and read for the office.</li>
          <li>Texts: messages to and from the office’s phone number.</li>
          <li>Signatures: documents sent for electronic signature, including to people without an account.</li>
          <li>Ask BFO: an assistant that answers questions from BFO’s records, by text or by voice.</li>
          <li>Drafts: operating agreements, service agreements and tax forms prepared from templates and AI for the office to review.</li>
        </ul>
      </>
    ),
  },
  {
    id: "who",
    title: "Who may use BFO",
    body: (
      <>
        <p>BFO has three kinds of user:</p>
        <ul>
          <li>Family members and the office’s staff, each with the role a principal or admin gives them.</li>
          <li>Outside partners, such as the office’s accountants and lawyers, who see only the entities shared with them.</li>
          <li>Signers, who have no account and use a link sent to them to sign one document.</li>
        </ul>
        <p>The office decides who has access and what each role can see and change, and can change or end anyone’s access at any time.</p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account and signing in",
    body: (
      <ul>
        <li>You sign in with a code texted to your mobile number. Keep your phone and your sign-in to yourself: don’t share codes, and don’t let anyone else use your account.</li>
        <li>
          If you think someone else has used your account, or you’ve seen something you shouldn’t have, tell us at once at <PrivacyEmail />.
        </li>
        <li>You stay signed in on a device for 30 days unless you sign out. Don’t stay signed in on a shared computer. Settings › Account and privacy signs out your other devices.</li>
      </ul>
    ),
  },
  {
    id: "confidentiality",
    title: "Confidentiality, authority and acceptable use",
    body: (
      <ul>
        <li>
          What you see in BFO is the family’s and the office’s confidential information. Use it only for the work you’re there to do, and don’t copy, forward, share or export it beyond what that work
          needs. This continues after your access ends.
        </li>
        <li>Act only for the entities you’re authorized to act for. Filing, signing or sending in the name of the office or an entity needs that authority.</li>
        <li>Sharing material through BFO with the office’s lawyers, accountants and service providers isn’t meant to waive attorney-client privilege or work-product protection.</li>
        <li>
          Don’t share your sign-in, try to reach anything your role doesn’t allow, scrape, probe or reverse engineer the Service, load harmful code, or use the Service to break the law or anyone’s
          rights.
        </li>
      </ul>
    ),
  },
  {
    id: "records",
    title: "Records and reports",
    body: (
      <>
        <p>
          Books is the office’s accounting record for each entity. It is kept on the cash basis from bank, card and brokerage feeds and the changes the office makes, and each change is logged with who
          made it and when.
        </p>
        <p>
          Reports are prepared by the office from those records. They are unaudited and not prepared under generally accepted accounting principles, and the office’s CPA should review them before they
          go into a tax return or to anyone outside the office. Balances are as of the last sync, and the bank’s or custodian’s own statement governs if they differ.
        </p>
        <p>
          The books, documents and other records belong to the entities they concern. They are kept for the periods in the Privacy notice and can be exported, the ledger as a spreadsheet file and
          documents as files, for the office’s CPA or another system.
        </p>
      </>
    ),
  },
  {
    id: "ai",
    title: "AI, templates and drafts",
    body: (
      <>
        <p>
          Some features use AI: Ask BFO’s answers, reading documents and paper mail, suggestions for categories, improvements to mail you write, and drafts of agreements and forms. Others fill in
          templates.
        </p>
        <p>
          <strong className="font-semibold">Answers, readings and drafts can be wrong or incomplete. They aren’t reviewed before you see them, and they aren’t legal, tax or investment advice.</strong>{" "}
          Check the record an answer points to rather than the answer itself. Have counsel review legal documents, and your CPA anything for tax, before you rely on, sign, file or send them. The
          Privacy notice says which providers process what.
        </p>
      </>
    ),
  },
  {
    id: "electronic-records",
    title: "Electronic records and signatures",
    body: (
      <ul>
        <li>You agree to receive notices, records and documents from BFO electronically, in the Service or by email, instead of on paper.</li>
        <li>To receive and keep them you need a current web browser or the BFO app, an email address, and a way to open PDF files.</li>
        <li>
          You can ask for a paper copy of any record at <PrivacyEmail />, at no charge.
        </li>
        <li>
          You can withdraw this consent by writing to the same address. Withdrawal applies to records sent after we act on it, doesn’t undo anything already signed, and may mean your access ends.
        </li>
        <li>
          Typing or drawing your signature in BFO, or choosing to sign, is your signature and has the same effect as signing on paper, under the federal Electronic Signatures in Global and National
          Commerce Act and the Uniform Electronic Transactions Act as adopted in Nevada (NRS chapter 719) and Arizona (A.R.S. title 44, chapter 26).
        </li>
        <li>A signer without an account gives this consent for the one document on the signing page, before signing.</li>
      </ul>
    ),
  },
  {
    id: "texts",
    title: "Text messages",
    body: (
      <ul>
        <li>BFO (the Burton Family Office) texts you a sign-in code each time you ask for one, and the office’s staff may text you from the office’s number, including replies to your texts.</li>
        <li>How often varies. Message and data rates may apply.</li>
        <li>Reply STOP to stop texts from the office’s number and START to have them again, or HELP for help. Sign-in codes come only when you ask; without them you can’t sign in.</li>
        <li>Carriers aren’t liable for delayed or undelivered messages.</li>
        <li>Agreeing to texts isn’t a condition of buying anything.</li>
      </ul>
    ),
  },
  {
    id: "third-parties",
    title: "Other companies’ services",
    body: (
      <>
        <p>
          BFO relies on other companies, listed in the Privacy notice. When you connect a bank through Plaid, Plaid’s{" "}
          <TextLink inline to="https://plaid.com/legal/#end-user-privacy-policy">
            End User Privacy Policy
          </TextLink>{" "}
          applies to what Plaid collects. Mercury accounts are read with the office’s own Mercury access, under{" "}
          <TextLink inline to="https://mercury.com/legal/terms">
            Mercury’s terms
          </TextLink>
          .
        </p>
        <p>We choose these companies with care, but we aren’t responsible for their services, and their outages can affect BFO.</p>
      </>
    ),
  },
  {
    id: "privacy",
    title: "Your information",
    body: (
      <p>
        The{" "}
        <TextLink inline to="/legal/privacy">
          Privacy notice
        </TextLink>{" "}
        says what we collect, why, who receives it and how long we keep it. We don’t sell your information. We share it only with the service providers that run BFO, listed there, and with the people
        the office gives access to.
      </p>
    ),
  },
  {
    id: "ending",
    title: "Suspending or ending access",
    body: (
      <>
        <p>The office can suspend or end your access at any time, including when your work for the office ends. You can stop using BFO at any time and ask us to close your account.</p>
        <p>
          When access ends you are signed out everywhere, and mail sent to your address on the family domain goes to the office’s shared mail. Your records, and the record of what you did in BFO, stay
          for the periods in the Privacy notice. Sections 5, 6, 13 to 16 and 18 continue to apply.
        </p>
      </>
    ),
  },
  {
    id: "disclaimer",
    title: "No warranties",
    body: (
      <p>
        <strong className="font-semibold">
          The Service is provided as is and as available. To the extent the law allows, we disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose,
          accuracy and non-infringement. We don’t promise that the Service will be uninterrupted or error-free, or that data from banks and other providers is complete or current.
        </strong>
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limits on liability",
    body: (
      <>
        <p>
          <strong className="font-semibold">
            To the extent the law allows, we aren’t liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, data or goodwill, arising from the Service. Our
            total liability for any claim about the Service is limited to the greater of what you paid us for it in the 12 months before the claim and $100.
          </strong>
        </p>
        <p>These limits don’t apply to gross negligence, willful misconduct, or anything else the law doesn’t allow us to limit.</p>
      </>
    ),
  },
  {
    id: "indemnity",
    title: "If you misuse the Service",
    body: <p>If you break these Terms or misuse the Service, you’ll cover the reasonable costs, including lawyers’ fees, of claims against us that result.</p>,
  },
  {
    id: "law",
    title: "Governing law and disputes",
    body: (
      <p>
        Nevada law governs these Terms, without regard to its conflict-of-law rules. Any dispute about them or the Service goes to the state or federal courts located in Washoe County, Nevada, and you
        and we agree to those courts’ jurisdiction.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these Terms",
    body: (
      <p>
        When we make a material change, we’ll tell you in BFO and by email at least 15 days before it takes effect, and ask you to agree again when you next sign in. Smaller changes, such as
        corrections, take effect when posted with a new date. Earlier versions are available from the office on request.
      </p>
    ),
  },
  {
    id: "general",
    title: "General",
    body: (
      <ul>
        <li>These Terms, the Privacy notice and any separate written agreement with the office are the whole agreement about the Service.</li>
        <li>If a court finds part of these Terms unenforceable, the rest still applies.</li>
        <li>Not enforcing a term right away doesn’t waive it.</li>
        <li>We may transfer these Terms to an affiliate or a successor; you may not transfer them.</li>
        <li>
          We send notices to you in BFO or by email. Send notices to us at <PrivacyEmail />.
        </li>
      </ul>
    ),
  },
];

export default function TermsOfUse() {
  return <LegalPage title="Terms of use" version={TERMS_VERSION} effective={TERMS_EFFECTIVE} summary={SUMMARY} sections={SECTIONS} sibling={{ to: "/legal/privacy", label: "Privacy notice" }} />;
}
