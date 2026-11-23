/**
 * What each integration's page in Settings says: the one-line pitch its card carries, the numbered Configure steps,
 * and the facts beside them. Pure data.
 *
 * Each integration shows good steps for how to set it up, modelled on Datadog's Configure tab. That tab is prerequisites first, then numbered steps naming the page
 * to make the key on, then a field to put it in; these follow that shape, with the paste field drawn under the step
 * that makes the key.
 *
 * The steps restate what the onboarding guide already says (`skills/onboard/reference/capturing-tokens.md`,
 * `creating-the-apps.md`, and each door's own skill), because `site/` cannot read `skills/`. A card's pitch says
 * what you get rather than what the tool is, the one thing the archived Integrations page did that the owner kept.
 * `site/__tests__/unit/integrationCatalog.test.ts` binds every integration to a guide and every paste field and
 * consent verb to a step, so a credential the registry adds cannot go unexplained.
 */

/** One numbered Configure step. */
export interface GuideStep {
  /** What the step does, as a short heading. */
  readonly title: string;
  /** How, in the provider's own menu names. */
  readonly detail: string;
  /** The provider page the step happens on, when one address serves every install. */
  readonly link?: { readonly href: string; readonly label: string };
  /** The store files this step's paste fields write (`SecretFields`), in the order they are made. */
  readonly paste?: readonly string[];
  /** The browser-consent verb this step runs. */
  readonly verb?: string;
}

/** One integration's page: its pitch, its steps and the facts column. */
export interface IntegrationGuide {
  /** The id in `INTEGRATIONS` (`./integrations.ts`). */
  readonly id: string;
  /** What connecting it gets you, in a line short enough for a card. */
  readonly pitch: string;
  /** The longer line under the integration's name once opened. */
  readonly overview: string;
  readonly steps: readonly GuideStep[];
  /** Where what you paste is kept. */
  readonly storedAs: string;
  /** What in Slopweaver reads through it. */
  readonly usedBy: string;
  /** What the credential can reach. */
  readonly reach: string;
  /** How to take it away again. */
  readonly disconnect: string;
}

/** The owner-only file every paste lands in, said once. */
const ONE_FILE = "An owner-only file on this machine. Never shown again, never in a chat.";

/** The Google client the three Google doors share, made once. */
const GOOGLE_CLIENT: GuideStep = {
  detail:
    "In Google Cloud: pick or create a project, then Credentials → Create credentials → OAuth client ID → Desktop app. It must be a Desktop app: a Web application client fails consent with redirect_uri_mismatch. The secret is shown once, so save it before closing that dialog. Gmail, Drive and Calendar share this one client: paste it once.",
  link: { href: "https://console.cloud.google.com/apis/credentials", label: "Open Google Cloud credentials" },
  paste: ["google-client-id", "google-client-secret"],
  title: "Make a Google OAuth client, once",
};

/** Every integration's guide, in the registry's order. */
export const INTEGRATION_GUIDES: readonly IntegrationGuide[] = [
  {
    disconnect: "Delete the token here, or remove the app from your workspace in Slack.",
    id: "slack",
    overview: "Threads you're tagged in and the channels you read, so the Queue knows what is waiting on you.",
    pitch: "Threads you're tagged in",
    reach:
      "What the app's scopes allow. A user token reads as you and can post as you; a bot token alone only sees channels it is invited to.",
    steps: [
      {
        detail:
          "Slack apps → Create New App → From an app manifest → your workspace, then paste the manifest `slopweaver onboard` prints for the access level you pick, Create, and Install to Workspace. Already run an app with these scopes? Reuse its token instead. Never paste a manifest over an app you already run: it renames the app and revokes every scope it leaves out.",
        link: { href: "https://api.slack.com/apps", label: "Open Slack apps" },
        title: "Create the Slack app",
      },
      {
        detail:
          "From the app's OAuth & Permissions page. Either one connects Slack; the user token reads and posts as you, the bot token only sees channels the bot is in. The bot's own answers need the bot token.",
        paste: ["slack-user-token", "slack-bot-token"],
        title: "Paste its tokens",
      },
      {
        detail:
          "Optional, for the bot to hear tags live (`slopweaver listen`): the app's Basic Information → App-Level Tokens → Generate, with `connections:write`, and Socket Mode switched on. Slack reads and posts without it.",
        paste: ["slack-app-token"],
        title: "Let the bot hear tags",
      },
    ],
    storedAs: ONE_FILE,
    usedBy: "The Queue, the bot's answers, Slack drafts and the Slack corpus.",
  },
  {
    disconnect: "Delete the token here, or revoke it under Developer settings in GitHub.",
    id: "github",
    overview: "Pull requests, reviews and CI, read for the Pull requests page and raised when you ask for one.",
    pitch: "PRs, reviews, CI",
    reach: "What your GitHub account can reach. A token reaches only its own scopes.",
    steps: [
      {
        detail:
          "Usually nothing to do: with no token stored, every GitHub verb uses your `gh` sign-in. No sign-in yet? Run `gh auth login` in a terminal.",
        title: "Use your gh sign-in",
      },
      {
        detail:
          "Only to act as a different account: GitHub → your picture → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic), with repo and read:org. A stored token wins over the sign-in for every GitHub verb.",
        link: { href: "https://github.com/settings/tokens", label: "Open GitHub tokens" },
        paste: ["github-token"],
        title: "Or paste a token",
      },
    ],
    storedAs: "Your gh sign-in stays in the system credential store. A pasted token is an owner-only file here.",
    usedBy: "The Pull requests page, the landing read, reviews and the GitHub corpus.",
  },
  {
    disconnect: "Delete the key here, or revoke it in Linear's settings.",
    id: "linear",
    overview:
      "Issues and projects, including archived work and customer requests in their own words. All of it stays here.",
    pitch: "Issues and projects",
    reach: "Everything your Linear account can read, and writing issues when you ask for one.",
    steps: [
      {
        detail:
          "Linear → Settings → API → Personal API keys → New key. If another assistant already holds one, reuse it.",
        paste: ["linear-token"],
        title: "Create a personal API key",
      },
    ],
    storedAs: ONE_FILE,
    usedBy: "Linear reads and writes, and the Linear corpus.",
  },
  {
    disconnect: "Delete the token here, or remove the connection in Notion.",
    id: "notion",
    overview: "The pages and databases you share with it, read into the corpus.",
    pitch: "Pages and docs",
    reach: "Only the pages and databases shared with the connection.",
    steps: [
      {
        detail:
          "Notion's developer portal → a new internal connection on your workspace (a workspace owner makes it), with the read user information, including email capability. Copy its token from the Configuration tab.",
        link: { href: "https://app.notion.com/developers/connections", label: "Open Notion connections" },
        paste: ["notion-token"],
        title: "Create an internal connection",
      },
      {
        detail: "Notion only shows what is shared with it: on each page, ••• → Add connections → pick it.",
        title: "Share pages with it",
      },
    ],
    storedAs: ONE_FILE,
    usedBy: "Notion reads and the Notion corpus.",
  },
  {
    disconnect: "Delete the key here, or revoke it in Fathom's settings.",
    id: "fathom",
    overview: "The calls you recorded, transcripts and all.",
    pitch: "Call recordings",
    reach: "The meetings your Fathom account recorded.",
    steps: [
      {
        detail: "Fathom → User Settings → API Access → generate an API key.",
        link: { href: "https://fathom.video/customize#api-access-header", label: "Open Fathom API access" },
        paste: ["fathom-api-key"],
        title: "Generate an API key",
      },
    ],
    storedAs: ONE_FILE,
    usedBy: "Fathom reads and the Fathom corpus.",
  },
  {
    disconnect: "Delete the two keys here, or revoke them in Datadog.",
    id: "datadog",
    overview: "Logs, traces and monitors, read live when an investigation needs them. Nothing is copied in.",
    pitch: "Logs, traces, monitors",
    reach:
      "Exactly what your own Datadog role allows: the application key carries your role, so it is as narrow as that role and no narrower.",
    steps: [
      {
        detail:
          "The key pages are on your own site, so this comes first: set `datadog.site` in your profile (datadoghq.com, us3.datadoghq.com, …). `slopweaver connect datadog --check` then prints your two key pages.",
        title: "Your Datadog site",
      },
      {
        detail: "Organization Settings → API Keys → New Key. It is the organisation's key.",
        paste: ["datadog-api-key"],
        title: "Create an API key",
      },
      {
        detail:
          "Organization Settings → Application Keys → New Key. It is personal: Slopweaver reads exactly what your own Datadog role can.",
        paste: ["datadog-app-key"],
        title: "Create an application key",
      },
    ],
    storedAs: "Two owner-only files on this machine. Never shown again, never in a chat.",
    usedBy: "Investigations, incident notes and the Datadog atlas.",
  },
  {
    disconnect: "Delete the token here, or roll it in Cloudflare.",
    id: "cloudflare",
    overview: "Zones, routes, Access and Workers, read for the Cloudflare atlas.",
    pitch: "Zones and routes",
    reach:
      "What the token's permissions allow. The Read All Resources template reads more than the atlas needs; narrow it and an area you leave out shows as a named permission-refused gap.",
    steps: [
      {
        detail:
          "API Tokens → Create Token → the Read All Resources template → set its accounts and zones to yours → Create Token. For email aliases add Zone · Email Routing Rules · Edit, the one write. The token is shown once.",
        link: { href: "https://dash.cloudflare.com/profile/api-tokens", label: "Open Cloudflare API tokens" },
        paste: ["cloudflare-token"],
        title: "Create an API token",
      },
    ],
    storedAs: ONE_FILE,
    usedBy: "The Cloudflare atlas and email aliases.",
  },
  {
    disconnect: "Delete the token here, or revoke it in Hex.",
    id: "hex",
    overview: "Which notebook already asks a question, and the rows it last produced. Read live, never ingested.",
    pitch: "Warehouse notebooks",
    reach: "Your own Hex role: Hex has no read-only token.",
    steps: [
      {
        detail: "Hex → Settings → API keys → a personal API token.",
        paste: ["hex-api-token"],
        title: "Create a personal token",
      },
    ],
    storedAs: ONE_FILE,
    usedBy: "Hex reads during investigations.",
  },
  {
    disconnect: "Delete the grant here, or remove the app from your Google account's third-party access.",
    id: "gmail",
    overview: "Your mail and the meeting notes it links, read into the corpus; drafts and sends only on your approval.",
    pitch: "Mail and meeting notes",
    reach: "The grant you pick: read (the default), manage (labels, archive, read state) or full (drafts and sending).",
    steps: [
      GOOGLE_CLIENT,
      {
        detail: "On the same project, enable the Gmail API and the Google Docs API.",
        title: "Enable the APIs",
      },
      {
        detail:
          "Opens Google's consent in your browser and keeps the one redirect. It also asks to read Google Docs so it can follow meeting notes; saying no is fine.",
        title: "Approve the consent",
        verb: "slopweaver gmail connect",
      },
    ],
    storedAs: "The grant, an owner-only file on this machine. The client is two more.",
    usedBy: "Gmail reads, mail cards and the Gmail corpus.",
  },
  {
    disconnect: "Delete the grant here, or remove the app from your Google account's third-party access.",
    id: "drive",
    overview: "Docs and files, by name and details unless you grant their contents.",
    pitch: "Docs and files",
    reach:
      "Metadata (the default: names and details, not contents), read (contents too) or write. No verb writes today.",
    steps: [
      GOOGLE_CLIENT,
      { detail: "On the same project, enable the Google Drive API.", title: "Enable the API" },
      {
        detail: "Opens Google's consent in your browser.",
        title: "Approve the consent",
        verb: "slopweaver drive connect",
      },
    ],
    storedAs: "The grant, an owner-only file on this machine.",
    usedBy: "Drive reads.",
  },
  {
    disconnect: "Delete the grant here, or remove the app from your Google account's third-party access.",
    id: "calendar",
    overview: "Meetings to prep for and your free time.",
    pitch: "Meetings to prep for",
    reach: "Read (the default, which also answers free time), events, or meetings on calendars you own.",
    steps: [
      GOOGLE_CLIENT,
      {
        detail:
          "On the same project, enable the Google Calendar API. Skip it and the first read fails with a 403 naming the API.",
        title: "Enable the API",
      },
      {
        detail: "Opens Google's consent in your browser.",
        title: "Approve the consent",
        verb: "slopweaver calendar connect",
      },
    ],
    storedAs: "The grant, an owner-only file on this machine.",
    usedBy: "Meeting prep and calendar reads.",
  },
  {
    disconnect: "Delete the grant here, or remove the app under your Microsoft account's permissions.",
    id: "outlook",
    overview: "Your Outlook mail, read and organised the way Gmail is.",
    pitch: "Mail",
    reach: "Read, manage or full, with manage the default.",
    steps: [
      {
        detail:
          "entra.microsoft.com → App registrations → New registration; personal accounts (or work and personal); redirect Public client/native, http://localhost; no client secret. Reusing one? It needs the Mobile and desktop applications platform with that redirect. The Application (client) ID is not a secret.",
        link: { href: "https://entra.microsoft.com", label: "Open Microsoft Entra" },
        paste: ["outlook-client-id"],
        title: "Register the app",
      },
      {
        detail: "Opens Microsoft's consent in your browser and keeps the one redirect.",
        title: "Approve the consent",
        verb: "slopweaver outlook connect",
      },
    ],
    storedAs: "The grant, an owner-only file on this machine.",
    usedBy: "Outlook reads.",
  },
];

/**
 * One integration's guide.
 *
 * @returns the guide
 */
export function guideOf({ id }: { id: string }): IntegrationGuide {
  const found = INTEGRATION_GUIDES.find((guide) => guide.id === id);
  if (found === undefined) {
    throw new Error(`no integration guide for ${id}`);
  }
  return found;
}
