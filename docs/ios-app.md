# BFO for iPhone

The iPhone app is a native shell around the live site, built with
[Capacitor](https://capacitorjs.com) 8. It opens
`https://www.burtonfamilyoffice.com/home` in a WKWebView with Capacitor's
bridge, so:

- **Every web deploy reaches the app at once.** No App Store update is needed
  for changes to pages, Mail, or the API.
- **A new build is needed only for native changes**: `capacitor.config.ts`,
  anything in `ios/`, the icon or splash, or adding a Capacitor plugin.

Inside the app the site uses native features through `app/native.ts`: real
haptics (Safari on iPhone ignores web vibration), a status bar that turns light
or dark with the page, and no service worker. If the site can't be reached the
shell shows its own offline page (`native/www/offline.html`) with Try again.
Links to other sites open in Safari.

| What | Where |
| --- | --- |
| App ID (bundle identifier) | `com.burtonfamilyoffice.app` |
| Name on the home screen | BFO |
| Devices | iPhone, portrait (iOS 15 and later) |
| Xcode project | `ios/App/App.xcodeproj` (Swift Package Manager, no CocoaPods) |
| Icon and splash sources | `resources/` |
| App Store screenshots | `appstore/screenshots/iphone-6.9/` (1320 × 2868) |
| Cloud build and upload | `.github/workflows/ios-testflight.yml` |

## Getting it into App Store Connect

This is a one-time setup. After it, a new TestFlight build is one click.

### 1. Apple Developer Program

Enroll at [developer.apple.com/programs](https://developer.apple.com/programs/)
as an **organization** (the family office's legal entity), so the App Store
shows the entity rather than a person. Organization enrollment needs a D-U-N-S
number and can take a few days. Note the **Team ID** from
developer.apple.com → Account → Membership details.

### 2. Create the app record

In [App Store Connect](https://appstoreconnect.apple.com) → Apps → **+** → New App:

| Field | Value |
| --- | --- |
| Platform | iOS |
| Name | **Burton Family Office** (App Store names are unique, and "BFO" is very likely taken; the home screen still says BFO) |
| Primary language | English (U.S.) |
| Bundle ID | `com.burtonfamilyoffice.app` (if it isn't in the list yet, register it under Certificates, Identifiers & Profiles → Identifiers → **+** → App IDs) |
| SKU | `bfo-ios` |
| User access | Full access |

### 3. An App Store Connect API key for the cloud build

App Store Connect → Users and Access → **Integrations** → App Store Connect API
→ Team Keys → **+**:

- Name it "GitHub builds" and give it the **Admin** role. Admin is needed so
  Xcode's automatic signing can create the distribution certificate and
  provisioning profile on the build machine.
- Download the `.p8` file. Apple lets you download it **once**.
- Note the **Key ID** and the **Issuer ID** shown on that page.

### 4. GitHub secrets

GitHub → the repository → Settings → Secrets and variables → Actions → New
repository secret, four times:

| Secret | Value |
| --- | --- |
| `APPLE_TEAM_ID` | the Team ID from step 1 |
| `ASC_KEY_ID` | the key's Key ID |
| `ASC_ISSUER_ID` | the Issuer ID |
| `ASC_KEY_P8` | the whole text of the `.p8` file, from `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----` |

### 5. Build and upload

GitHub → Actions → **iOS → TestFlight** → Run workflow. It runs on a cloud Mac
with the current Xcode, signs the app, and uploads it. The build appears in App
Store Connect → TestFlight after Apple processes it, usually 5 to 15 minutes.
Each run gets the next build number automatically. Enter a version (such as
`1.0.1`) only when you want the App Store version to change.

### 6. TestFlight

App Store Connect → the app → TestFlight → Internal Testing → **+** to create
a group (for example "Family"), and add people. They must be users on your App
Store Connect team; any role works. They get an email, install **TestFlight**
from the App Store, and install BFO from there.

**Internal testing needs no App Review**, no demo account and no listing.
For a private family office app this is the simplest way to put BFO on
everyone's phone, for up to 100 people. TestFlight builds expire after 90
days, so run the workflow again before then (any web deploy in between still
reaches the app).

## The App Store listing

Only needed for the App Store itself, or for TestFlight testers outside your
team. Everything below is ready to paste.

| Field | Value |
| --- | --- |
| Subtitle (30) | Your family office, in hand |
| Category | Finance (secondary: Business) |
| Support URL | https://www.burtonfamilyoffice.com |
| Marketing URL | https://www.burtonfamilyoffice.com/mission |
| Privacy Policy URL | https://www.burtonfamilyoffice.com/legal/privacy |
| Copyright | 2026 Burton Family Office |
| Age rating | 4+ (answer "None" to every content question) |
| Screenshots | the five files in `appstore/screenshots/iphone-6.9/`, in order |

**Promotional text (170)**

> Mail, entities, accounts and documents for the Burton family office, in one
> place and in your pocket.

**Description**

> BFO is the Burton Family Office's private workspace, built for the family
> and the people who work with it.
>
> MAIL
> Every family office address in one inbox. Read conversations, star what
> matters, filter to unread and starred in any combination, and reply from
> the right address. Attachments show what they are at a glance, and wide
> emails fit your screen.
>
> THE OFFICE
> Entities, compliance, accounts, investments and the books, with the
> documents behind them, kept current in one place.
>
> PRIVATE BY DESIGN
> BFO is for invited members only. Access is by phone verification, and each
> person sees what their role allows.

**Keywords (100)**

> family office,wealth,entities,trust,mail,inbox,documents,compliance,accounts,finance

**Review notes** (App Review only; see the decisions below first)

> BFO is a private workspace for members of the Burton Family Office. Sign-in
> is by a code sent to a member's phone. Use the demo account below; it sees
> sample data only.

## App Privacy answers

App Store Connect → the app → App Privacy. Nothing is used for tracking or
advertising, and nothing is shared with data brokers.

| Data type | Collected | Linked to the person | Used for |
| --- | --- | --- | --- |
| Contact info: name, email address, phone number | Yes | Yes | App functionality (accounts and sign-in) |
| User content: emails or text messages | Yes | Yes | App functionality (Mail) |
| User content: photos or videos | Yes | Yes | App functionality (attachments, profile photo) |
| User content: other (documents) | Yes | Yes | App functionality |
| Financial info: other financial info | Yes | Yes | App functionality (accounts, books, investments) |
| Identifiers: user ID | Yes | Yes | App functionality |
| Usage data, diagnostics, location, contacts, health | No | | |

Answer **No** to "Do you or your third-party partners use data for tracking
purposes?"

Export compliance is already answered in the build (`ITSAppUsesNonExemptEncryption`
is false: the app only uses standard HTTPS), so App Store Connect won't ask on
each upload.

## Decisions before App Review

Internal TestFlight needs none of these. Submitting to the App Store, or to
external TestFlight testers, does.

1. **A demo account for Apple.** Sign-in is by a code sent to a member's phone,
   which App Review can't receive. Apple requires working credentials, and
   anyone holding them sees whatever that account can see. The safe way is a
   dedicated reviewer account that can only ever see sample data, with a fixed
   code that works for that one number only. It isn't built yet, because it
   touches sign-in and should be your call.
2. **How it's distributed.** "Public" lists BFO in the App Store for anyone to
   find. **Unlisted** (request it from Apple after approval) installs only from
   a direct link and suits a private office better. A **Custom app** through
   Apple Business Manager limits it to your organization.
3. **Guideline 4.2 (minimum functionality).** Apple can reject apps that are
   mostly a website. BFO has real native touches (haptics, its own offline
   screen, a theme-aware status bar), and members-only business apps are
   reviewed more leniently. Native push notifications for new mail and Face ID
   unlock would make approval much more likely and are the natural next native
   features.
4. **The privacy policy** at `/legal/privacy` describes "BFO Finance" and bank
   connections. Before a public submission it should also cover Mail, photos,
   and the iPhone app.

## Developing on a Mac

You need Xcode (current version) and Node 22.

```bash
npm ci
npx cap sync ios        # copies native/www and the plugins into ios/
npx cap open ios        # opens the project in Xcode
```

In Xcode, select the **App** target → Signing & Capabilities → choose your
team, pick an iPhone or a simulator, and Run. To try local site changes in the
app, point `server.url` in `capacitor.config.ts` at your Mac's dev server for
that run (don't commit it).

After changing `capacitor.config.ts` or adding a plugin, run
`npx cap sync ios` again. To regenerate the App Store screenshots, start the
dev server and run `node scripts/appstore-screenshots.mjs`; it uses fictional
sample mail only.
