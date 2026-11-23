/**
 * The service-access credentials — the keys and tokens for the live services a verb reads, and in places
 * writes, on demand: Datadog, Cloudflare, 1Password, Hex, KnowBe4, Twilio and Knock. Several carry write
 * scope (Datadog submits, Cloudflare provisions Email Routing), so the category says nothing about scope;
 * each row's `mintScope` does.
 */
import { API_KEY_SHAPE, APP_KEY_SHAPE } from "../../datadog/config.js";
import { KNOCK_API_KEY_SHAPE } from "../../live/knock/credential.js";
import type { CredentialSpec } from "./spec.js";

/** The service-access rows, in register order, Datadog's pair first and Knock's key last. */
export const SERVICE_ACCESS_CREDENTIALS = [
  {
    expiry: "none",
    lifecycle: "live",
    // An org-level API key: beyond authenticating reads it can SUBMIT metrics and events, which
    // `slopweaver datadog submit` does — so it is a write credential whatever the application key allows.
    mintScope: "read-write",
    name: "datadog-api-key",
    platform: "Datadog",
    reader: "src/datadog/source.ts",
    readVerbs: "slopweaver datadog *, slopweaver atlas datadog sync, slopweaver connect datadog --check",
    settable: true,
    shape: "line",
    usedFor:
      "authenticating every Datadog API call, beside the application key. Each person mints their own on their org's site; the SITE is not stored here but in `profile.json`'s `datadog.site`, because it is config rather than a secret",
    valueShape: { describe: "32 lowercase hex characters", pattern: API_KEY_SHAPE },
    what: "an organisation API key",
    writtenBy: "slopweaver secrets set datadog-api-key",
  },
  {
    expiry: "none",
    lifecycle: "live",
    // An application key carries ITS CREATOR's own Datadog permissions (and whatever scopes were picked at
    // mint), which only the console shows — so two colleagues' installs legitimately read different data.
    mintScope: "unverified",
    name: "datadog-app-key",
    platform: "Datadog",
    reader: "src/datadog/source.ts",
    readVerbs: "slopweaver datadog *, slopweaver atlas datadog sync, slopweaver connect datadog --check",
    settable: true,
    shape: "line",
    usedFor:
      "authorising the queries — logs, metrics, monitors, the atlas — as the person who minted it, with exactly their own Datadog permissions",
    valueShape: { describe: "40 letters, digits, underscores or dashes", pattern: APP_KEY_SHAPE },
    what: "a personal application key",
    writtenBy: "slopweaver secrets set datadog-app-key",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "unverified",
    name: "cloudflare-token",
    platform: "Cloudflare",
    reader: "src/config.ts",
    readVerbs: "slopweaver atlas cloudflare *, slopweaver alias *",
    settable: true,
    shape: "line",
    usedFor:
      "reading one account's Access/Gateway Lists/Pages/Workers/notifications/audit logs/certificates/settings, plus DNS/firewall/SSL/analytics/API Gateway for one explicitly configured deep zone; and WRITING Email Routing rules on a zone named per call, through `slopweaver alias provision` and `alias catch-all`, which need the token to carry Zone · Email Routing Rules · Edit",
    what: "a scoped account API token",
    writtenBy: "slopweaver secrets set cloudflare-token",
  },
  {
    expiry: "at-mint",
    lifecycle: "live",
    mintScope: "read-only",
    name: "onepassword-events-token",
    platform: "1Password",
    reader: "src/config.ts",
    readVerbs: "slopweaver atlas onepassword *",
    settable: true,
    shape: "line",
    usedFor:
      "reading the 1Password Events API's audit-event feed — **read-only, and no endpoint behind it returns an item's contents.** Scoped at mint time to a chosen subset of event families and given an expiry. The 1Password atlas's OTHER half is an `op` CLI session, signed in from `onepassword-atlas-password`",
    what: "an Events API bearer token",
    writtenBy: "slopweaver secrets set onepassword-events-token",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "unverified",
    name: "onepassword-atlas-password",
    platform: "1Password",
    reader: "src/config.ts",
    readVerbs: "slopweaver onepassword sync",
    settable: true,
    shape: "line",
    usedFor:
      "signing the dedicated atlas account into the `op` CLI with nobody at a terminal, so the scheduled roster resync gets a session of its own. **The account is CLI-only**, never the desktop app. A password rather than a session token because a session idles out long before the next resync. A password carries everything its account can do, so what keeps its use read-only is the closed `op` allowlist in `src/atlas/onepassword/inventory.ts`, never the credential",
    what: "the dedicated atlas account's 1Password password",
    writtenBy: "slopweaver secrets set onepassword-atlas-password",
  },
  {
    expiry: "at-mint",
    lifecycle: "live",
    mintScope: "unverified",
    name: "hex-api-token",
    platform: "Hex",
    reader: "src/config.ts",
    readVerbs: "slopweaver hex *, slopweaver atlas hex sync",
    settable: true,
    shape: "line",
    usedFor:
      "READING Hex — the masked, access-controlled view over the warehouse: the workspace's projects, data connections, cells, run history and a SQL cell's bounded output preview, printed to the session and never stored. Every call is a GET — `src/hex/client.ts` admits no other method — so nothing behind this token can change Hex. **`unverified` because Hex offers no read-only scope at mint**: a personal token carries the minting user's own role, so what makes it read-only is the client, not the token",
    what: "a personal API token, minted at app.hex.tech → Settings → API keys",
    writtenBy: "slopweaver secrets set hex-api-token",
  },
  {
    expiry: "at-mint",
    lifecycle: "live",
    mintScope: "read-only",
    name: "knowbe4-api-token",
    platform: "KnowBe4",
    reader: "src/live/knowbe4/credential.ts",
    readVerbs: "slopweaver atlas knowbe4 sync",
    settable: true,
    shape: "line",
    usedFor:
      "READING the KnowBe4 security-awareness account: its users, groups and members, training campaigns, enrolments and completion status, store purchases, policies, and phishing campaigns, tests and per-person results. The Reporting API publishes GETs only, and `src/live/knowbe4/transport.ts` sends a GET to `us.api.knowbe4.com` on eleven closed-list paths and nothing else. Mint a NEW token rather than regenerating the existing one, which Vanta's KnowBe4 connector reads",
    what: "a Reporting API token, minted at training.knowbe4.com → Account Settings → Account Integrations → API → Reporting API → Create New API Token",
    writtenBy: "slopweaver secrets set knowbe4-api-token",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "not-a-credential",
    name: "twilio-account-sid",
    platform: "Twilio",
    reader: "src/live/twilio/credential.ts",
    readVerbs: "slopweaver twilio *",
    settable: true,
    shape: "line",
    usedFor:
      "naming the Twilio account the read door's two message paths are built on — `src/live/twilio/transport.ts` refuses a URL naming any other account",
    valueShape: { describe: "AC followed by 32 lower-case hex characters", pattern: /^AC[0-9a-f]{32}$/ },
    what: "the account SID, shown at console.twilio.com → Account Info",
    writtenBy: "slopweaver secrets set twilio-account-sid",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "not-a-credential",
    name: "twilio-api-key-sid",
    platform: "Twilio",
    reader: "src/live/twilio/credential.ts",
    readVerbs: "slopweaver twilio *",
    settable: true,
    shape: "line",
    usedFor:
      "the HTTP Basic username half of the restricted API key; it identifies the key and authenticates nothing without `twilio-api-key-secret`",
    valueShape: { describe: "SK followed by 32 lower-case hex characters", pattern: /^SK[0-9a-f]{32}$/ },
    what: "a restricted API key's SID, shown once beside its secret at mint",
    writtenBy: "slopweaver secrets set twilio-api-key-sid",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "unverified",
    name: "twilio-api-key-secret",
    platform: "Twilio",
    reader: "src/live/twilio/credential.ts",
    readVerbs: "slopweaver twilio *",
    settable: true,
    shape: "line",
    usedFor:
      "READING SMS delivery records for an investigation: which messages went to a number in a window, each one's status, Twilio error code and send time — never a body, numbers masked, stored nowhere. `src/live/twilio/transport.ts` sends a GET to `api.twilio.com` on the account's Messages list and single-message paths and nothing else. **`unverified` until the owner mints it**: the step asks for a RESTRICTED key granting only Messaging → Messages → Read, and only the owner's console can say that is what was minted",
    what: "a restricted API key's secret, minted at console.twilio.com → Account → API keys & tokens",
    writtenBy: "slopweaver secrets set twilio-api-key-secret",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "unverified",
    name: "knock-api-key",
    platform: "Knock",
    reader: "src/live/knock/credential.ts",
    readVerbs: "slopweaver knock *",
    settable: true,
    shape: "line",
    usedFor:
      "READING notification delivery records for an investigation: which messages Knock sent a user, each one's status and event trail, and what its provider answered — never a recipient, payload or body, stored nowhere. `src/live/knock/transport.ts` sends a GET to `api.knock.app` on five message read routes and nothing else. **`unverified` for good**: Knock mints no read-only key, so this is the environment's full secret key and the GET-only transport is the whole wall",
    valueShape: { describe: "`sk_` followed by letters, digits, `_` or `-`", pattern: KNOCK_API_KEY_SHAPE },
    what: "the production environment's secret API key, at dashboard.knock.app → Developers → API keys",
    writtenBy: "slopweaver secrets set knock-api-key",
  },
] as const satisfies readonly CredentialSpec[];
