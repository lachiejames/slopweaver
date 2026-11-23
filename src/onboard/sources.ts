/**
 * The FIVE sources `slopweaver onboard` connects, declared once, as data.
 *
 * ## Why this file exists at all
 *
 * `onboard` was built around the one source that needs an app manifest, so for four releases its whole
 * output was Slack — and the other connectors were reachable only through prose in a skill, which is to say
 * through a document nothing checks. When Gmail landed as a corpus source that gap became a defect a user
 * could feel: mail was ingestible, citable and answerable, and the setup flow did not mention it, so the
 * only way to discover it was to read the code. Declaring every source here, with the exact credential it
 * needs and the exact page it comes from, is what makes "first-class" a property of the program rather than
 * a claim in a README.
 *
 * ## Gmail is the odd one, and the difference is the SECRET, not the consent
 *
 * The other four are a token a user copies out of a settings page and can copy again tomorrow. Gmail needs
 * a Google Cloud OAuth **client**, and Google shows that client's SECRET exactly once, at the moment it is
 * created. A flow that says "paste your client secret" without saying that first has already lost it for
 * some fraction of its users — the page is closed, and the only recovery is to delete the client and make
 * another. So {@link GMAIL_SECRET_WARNING} is not a footnote in this file: it is a field of the source, it
 * renders at the point of creation, and it names the password manager as the place the secret goes BEFORE
 * the browser tab is closed.
 *
 * The consent step itself is the ordinary one and needs no warning — `gmail connect` can be re-run any time
 * to widen or refresh a grant, because it is the CLIENT that is unrecoverable, not the grant.
 *
 * Pure: no I/O, no clock. Nothing here can emit an account, a workspace or a token.
 */

import type { ConnectSource } from "../connect/types.js";
import { CONNECT_SOURCES } from "../integrations/corpusSources.js";
import { outlookConnectorLines } from "./outlook.js";

/**
 * The sources `onboard` connects, in the order it presents them: every integration that ingests and has a
 * preflight, in corpus ordinal order ({@link CONNECT_SOURCES}). A new one fails to compile at
 * {@link SOURCE_SPECS} until it has its onboarding row.
 */
export const ONBOARD_SOURCES: readonly ConnectSource[] = CONNECT_SOURCES;

/**
 * One credential a source needs, and where the user gets it.
 *
 * @internal — a field of {@link OnboardSourceSpec}; every reader goes through the rendered lines.
 */
export interface CredentialStep {
  /** The `slopweaver secrets set <name>` name, or undefined when the step is not a stored secret. */
  readonly secret: string | undefined;
  /** The page it comes from, as a URL the user can open. */
  readonly page: string;
  /** What to do on that page, in one line. */
  readonly action: string;
  /** A warning that must be read BEFORE the action, when the step has one that cannot be recovered from. */
  readonly warning: string | undefined;
  /**
   * Whether this step only applies when the chosen Slack tier provisions a BOT.
   *
   * The `restricted` tier's manifest has no bot user at all, so naming its token would tell a user to copy
   * a credential their install page never shows. Every other step is tier-independent.
   */
  readonly botOnly?: boolean;
}

/**
 * Everything `onboard` says about one source.
 *
 * @internal — the element type of {@link SOURCE_SPECS}, which the render and the `--json` document read.
 */
export interface OnboardSourceSpec {
  readonly source: ConnectSource;
  /** The one-line description of what connecting it buys. */
  readonly buys: string;
  /** The credential steps, in the order they have to happen. */
  readonly credentials: readonly CredentialStep[];
  /** The preflight that proves the credential before anything crawls. */
  readonly preflight: string;
  /** The refresh invocation, as the argv tail after the executable. */
  readonly refreshArgv: readonly string[];
  /**
   * Whether `refresh --all-sources` reaches it. Gmail is the one that answers false, and that is policy
   * rather than an oversight — see {@link ../integrations/corpusSources.CORPUS_SOURCES}.
   */
  readonly inAllSources: boolean;
  /** What the source cannot do, or costs, said at the point of choice rather than discovered later. */
  readonly caveats: readonly string[];
}

/**
 * The warning that has to be read before a Google OAuth client is created, not after.
 *
 * Google shows a Desktop-app client's secret ONCE, in a dialog at creation time. There is no page that
 * shows it again — the recovery is to delete the client and create another, which invalidates any grant
 * already issued against it. So direct them to the page,
 * tell them the secret is shown once, and tell them to put it in their password manager before they leave.
 */
export const GMAIL_SECRET_WARNING =
  "Google shows the client secret ONCE, in the dialog that appears the moment the client is created. There " +
  "is no page that will show it to you again. Before you close that dialog: save both the client ID and the " +
  "client secret into your password manager, then capture them below. Lose the secret and the " +
  "only fix is to delete the client and create a new one.";

/**
 * Why the OAuth client must be a **Desktop app** and not a Web application.
 *
 * `gmail connect` binds `127.0.0.1:0` — an EPHEMERAL port — and sends Google that loopback address as the
 * redirect URI (`src/live/google/consent.ts`). Google accepts any loopback port for a Desktop-app client and
 * accepts only pre-registered redirect URIs for a Web application client, and a port that is chosen at
 * runtime cannot be pre-registered. So the client type is not a preference: the wrong one fails at consent
 * with `redirect_uri_mismatch`, which explains nothing to the person reading it.
 */
export const GMAIL_CLIENT_TYPE_REASON =
  "Choose application type DESKTOP APP. `gmail connect` listens on a loopback port chosen at run time, and " +
  "Google accepts an arbitrary 127.0.0.1 port only for a Desktop-app client — a Web application client " +
  "would need that port pre-registered, which is impossible, and fails consent with redirect_uri_mismatch.";

/** The Google APIs that must be ENABLED on the project before any of this works. */
export const GMAIL_REQUIRED_APIS: readonly { readonly name: string; readonly page: string; readonly why: string }[] = [
  {
    name: "Gmail API",
    page: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
    why: "every `gmail` verb and the whole `refresh --source gmail` crawl",
  },
  {
    name: "Google Docs API",
    page: "https://console.cloud.google.com/apis/library/docs.googleapis.com",
    why: "reading the meeting transcript a Gemini notes email links to, rather than only its inline summary",
  },
];

/** The five source specifications, in presentation order. */
export const SOURCE_SPECS: Readonly<Record<ConnectSource, OnboardSourceSpec>> = {
  github: {
    buys: "pull requests, issues, reviews, discussions and releases — the record of what was built and why",
    caveats: ["a SAML-protected org needs the token authorised for it, which `connect github --check` reports"],
    credentials: [
      {
        action: "usually nothing to capture — GitHub uses your existing `gh auth login`",
        page: "https://cli.github.com",
        secret: undefined,
        warning: undefined,
      },
      {
        action:
          "only if `connect github --check` reports auth missing: a personal access token with repo + read:org " +
          "(once stored, it wins over the gh login)",
        page: "https://github.com/settings/tokens",
        secret: "github-token",
        warning: undefined,
      },
    ],
    inAllSources: true,
    preflight: "slopweaver connect github --check --json --repo <owner/repo>",
    refreshArgv: ["refresh", "--source", "github"],
    source: "github",
  },
  gmail: {
    buys:
      "the owner's own mailbox — correspondence, and the Gemini meeting notes Google Meet emails after a " +
      "call, whose linked transcript becomes its own record",
    caveats: [
      "every mail record is PRIVATE by source and can never be served to a non-owner",
      "`refresh --all-sources` does NOT include it — a mailbox is reached by naming `--source gmail`",
      "it is the only source that needs a browser, once, for Google's consent screen",
    ],
    credentials: [
      {
        action:
          "create an OAuth client: APIs & Services → Credentials → Create credentials → OAuth client ID → " +
          "Desktop app. Save the ID and the SECRET to your password manager before closing the dialog",
        page: "https://console.cloud.google.com/apis/credentials",
        secret: "google-client-id",
        warning: GMAIL_SECRET_WARNING,
      },
      {
        action: "the client secret from the same dialog, captured no-echo like every other credential here",
        page: "https://console.cloud.google.com/apis/credentials",
        secret: "google-client-secret",
        warning: undefined,
      },
      {
        action:
          "`slopweaver gmail connect --grant read` — opens Google's consent screen once, listens on " +
          "127.0.0.1 for the single redirect, and stores the grant 0600. Nothing is pasted into a chat",
        page: "https://myaccount.google.com/permissions",
        secret: undefined,
        warning: undefined,
      },
    ],
    inAllSources: false,
    preflight: "slopweaver connect gmail --check --json",
    refreshArgv: ["refresh", "--source", "gmail"],
    source: "gmail",
  },
  linear: {
    buys: "issues, projects, documents, updates and customer needs — the record of what is planned and owned",
    caveats: [
      "the widest of the five within its window: archived work, verbatim customer prose, external commenters " +
        "and their emails, and the per-issue activity history. All of it stays local",
    ],
    credentials: [
      {
        action: "Settings → API → Personal API keys → create one",
        page: "https://linear.app/settings/api",
        secret: "linear-token",
        warning: undefined,
      },
    ],
    inAllSources: true,
    preflight: "slopweaver connect linear --check --json",
    refreshArgv: ["refresh", "--source", "linear"],
    source: "linear",
  },
  notion: {
    buys: "pages, databases and comments — the documents a team writes down rather than argues out",
    caveats: [
      "the integration only sees pages that have been SHARED with it, so a connected token with nothing " +
        "shared reads as an empty workspace rather than as an error",
    ],
    credentials: [
      {
        action:
          "create an internal integration with the read-user-information (including email) capability, then " +
          "share the pages and databases with it",
        page: "https://www.notion.so/my-integrations",
        secret: "notion-token",
        warning: undefined,
      },
    ],
    inAllSources: true,
    preflight: "slopweaver connect notion --check --json",
    refreshArgv: ["refresh", "--source", "notion"],
    source: "notion",
  },
  slack: {
    buys: "channel and thread history, canvases, pins and bookmarks — the record of what was actually said",
    caveats: [
      "the only source that needs an APP, which is what the manifest below is for",
      "a bot token sees only the channels it was invited to; prefer the user token",
    ],
    credentials: [
      {
        action: "the User OAuth Token from the install page (prefer it over the bot token — full read breadth)",
        page: "https://api.slack.com/apps",
        secret: "slack-user-token",
        warning: undefined,
      },
      {
        action: "the Bot User OAuth Token from the same page, on the agent and standard tiers",
        botOnly: true,
        page: "https://api.slack.com/apps",
        secret: "slack-bot-token",
        warning: undefined,
      },
    ],
    inAllSources: true,
    preflight: "slopweaver connect slack --check --json",
    refreshArgv: ["refresh", "--source", "slack"],
    source: "slack",
  },
};

/**
 * The onboarding lines for one source: what it buys, what to capture and from where, and what it costs.
 *
 * @param source the source to describe
 * @param hasBot whether the chosen Slack tier provisions a bot user, which decides one Slack step
 * @returns the lines to print, in order
 */
export function sourceLines({ source, hasBot }: { source: ConnectSource; hasBot: boolean }): readonly string[] {
  const spec = SOURCE_SPECS[source];
  return [
    `  ${source}${spec.inAllSources ? "" : "  (opt-in by NAMING — `refresh --all-sources` skips it)"}`,
    `    ${spec.buys}`,
    // This block NAMES each credential and never spells a COMMAND — not `secrets set`, and not the
    // preflight either, which is why {@link OnboardSourceSpec.preflight} is carried in the `--json`
    // document and not printed here. The ordered command list at the end of the session is the single
    // command authority, and two places printing the same command is how a flow starts contradicting
    // itself the first time one of them is edited.
    ...spec.credentials.flatMap((step) => {
      if (!hasBot && step.botOnly === true) {
        return [];
      }
      return [
        ...(step.warning === undefined ? [] : [`    ⚠ ${step.warning}`]),
        `    ${step.page}`,
        `      ${step.action}`,
        ...(step.secret === undefined ? [] : [`      capture as: ${step.secret}`]),
      ];
    }),
    ...spec.caveats.map((caveat) => `    · ${caveat}`),
    "",
  ];
}

/**
 * The whole "connect your sources" block — every corpus source, the live Outlook connector, plus the
 * Google-project steps Gmail alone needs.
 *
 * @param hasBot whether the chosen Slack tier provisions a bot user
 * @returns the lines to print, in order
 */
export function connectSourceLines({ hasBot }: { hasBot: boolean }): readonly string[] {
  return [
    "The five corpus sources plus the live Outlook mailbox, and the credential each one needs",
    "  Connect the ones you use. Every one is optional and every one can be added later; `store read` answers from",
    "  whatever is connected. No credential is ever pasted into a chat — `secrets set` reads it with echo off",
    "  and stores it 0600 under $SLOPWEAVER_HOME/secrets.",
    "",
    ...ONBOARD_SOURCES.flatMap((source) => sourceLines({ hasBot, source })),
    ...outlookConnectorLines(),
    ...gmailProjectLines(),
  ];
}

/**
 * The Google Cloud project steps, which happen BEFORE the credential Gmail's own block asks for.
 *
 * @internal — exported for its own unit test; the session render reaches it through {@link connectSourceLines}.
 *
 * @returns the lines to print, in order
 */
export function gmailProjectLines(): readonly string[] {
  return [
    "Gmail needs a Google Cloud project first — three steps, once",
    "  1. Pick or create a project: https://console.cloud.google.com/projectcreate",
    "  2. ENABLE these APIs on it (a disabled API fails at the first call with a 403 that names it):",
    ...GMAIL_REQUIRED_APIS.map(
      (api) => `       ${api.name.padEnd(16)}${api.page}\n       ${" ".repeat(16)}↳ ${api.why}`,
    ),
    "  3. Create the OAuth client. " + GMAIL_CLIENT_TYPE_REASON,
    "",
    `  ⚠ ${GMAIL_SECRET_WARNING}`,
    "",
  ];
}
