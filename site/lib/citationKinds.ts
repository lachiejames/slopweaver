/*
 * Every kind of thing a console citation can point at — each integration and each place in this console — as ONE
 * registry row carrying its name, its colour, its app icon and the hosts that identify it.
 *
 * Citations are colour coded and carry an app icon for the integration, for every integration (a Vanta citation
 * with a Vanta logo and colour, say) and for workstreams and other internal places.
 *
 * The archive did this with one platform registry whose `brandColor` every chip style was derived from
 * (`slopweaver-archive/packages/ui/src/foundations/platform-styles.ts`) rather than a per-chip style table, and
 * this is that design: a kind is looked up by the ADDRESS's host (`./citationDisplay.ts`), never by a word in the
 * prose around it. Every atlas platform has a row — `src/__tests__/unit/citationKindsMirror.test.ts` fails when
 * `src/atlas/registry.ts` gains one this file does not name. Pure: data and lookups, no React.
 */

/** One kind of cited record. */
export interface CitationKind {
  /** The registry key: `github`, `vanta`, `board`. */
  readonly id: string;
  /** The name the hover card leads with: `GitHub`, `Vanta`, `the board`. */
  readonly source: string;
  /** The integration's colour, `#rrggbb` — the chip's tint, border and header strip are all mixed from it. */
  readonly colour: string;
  /**
   * Which mark `CitationMark` draws: a drawn mark, a simple-icons brand mark or an internal glyph, by name. Empty
   * draws the neutral link glyph — never letters (the site's favicon, never letters like CF).
   */
  readonly mark: string;
  /** The hosts that identify it, each matching itself and its subdomains. Empty for a place in this console. */
  readonly hosts: readonly string[];
  /** The atlas platform (`src/atlas/registry.ts`) this row covers, when it is one. */
  readonly atlas: string | undefined;
  /** Whether following it stays on this machine. */
  readonly internal: boolean;
}

/** An integration's row, spelled compactly: every external kind leaves the machine. */
function external({
  id,
  source,
  colour,
  hosts,
  mark = "",
  atlas,
}: {
  id: string;
  source: string;
  colour: string;
  hosts: readonly string[];
  mark?: string;
  atlas?: string;
}): CitationKind {
  return { atlas, colour, hosts, id, internal: false, mark, source };
}

/** A place in this console, drawn with its own glyph in its own colour. */
function place({ id, source, colour }: { id: string; source: string; colour: string }): CitationKind {
  return { atlas: undefined, colour, hosts: [], id, internal: true, mark: id, source };
}

/**
 * Every integration, most-cited first. A row's `mark` names its real mark in `CitationMark.tsx` — drawn there, or a
 * simple-icons brand mark, both bundled so nothing is fetched on render (`./markdownSafety.ts`); a row with no mark
 * draws the neutral link glyph in its colour.
 */
export const INTEGRATION_KINDS: readonly CitationKind[] = [
  external({
    atlas: "github",
    colour: "#8B949E",
    hosts: ["github.com"],
    id: "github",
    mark: "github",
    source: "GitHub",
  }),
  external({ atlas: "slack", colour: "#E01E5A", hosts: ["slack.com"], id: "slack", mark: "slack", source: "Slack" }),
  external({
    atlas: "linear",
    colour: "#5E6AD2",
    hosts: ["linear.app"],
    id: "linear",
    mark: "linear",
    source: "Linear",
  }),
  external({ atlas: "vanta", colour: "#7B5CFF", hosts: ["vanta.com"], id: "vanta", source: "Vanta" }),
  external({ atlas: "jumpcloud", colour: "#1FB9A7", hosts: ["jumpcloud.com"], id: "jumpcloud", source: "JumpCloud" }),
  external({
    atlas: "datadog",
    colour: "#8A4FD8",
    hosts: ["datadoghq.com", "datadoghq.eu"],
    id: "datadog",
    mark: "datadog",
    source: "Datadog",
  }),
  external({
    atlas: "notion",
    colour: "#A5A29C",
    hosts: ["notion.so", "notion.site"],
    id: "notion",
    mark: "notion",
    source: "Notion",
  }),
  external({ colour: "#EA4335", hosts: ["mail.google.com"], id: "gmail", mark: "gmail", source: "Gmail" }),
  external({
    colour: "#2684FC",
    hosts: ["docs.google.com", "drive.google.com"],
    id: "drive",
    mark: "googleDrive",
    source: "Google Drive",
  }),
  external({
    colour: "#4285F4",
    hosts: ["calendar.google.com"],
    id: "calendar",
    mark: "googlecalendar",
    source: "Google Calendar",
  }),
  external({
    atlas: "google-admin",
    colour: "#4285F4",
    hosts: ["admin.google.com"],
    id: "googleAdmin",
    mark: "google",
    source: "Google Admin",
  }),
  external({
    atlas: "google-secops",
    colour: "#4285F4",
    hosts: ["chronicle.security"],
    id: "googleSecops",
    mark: "googlechronicle",
    source: "Google SecOps",
  }),
  external({
    atlas: "gemini-ai-studio",
    colour: "#1A73E8",
    hosts: ["aistudio.google.com"],
    id: "geminiAiStudio",
    mark: "googlegemini",
    source: "Google AI Studio",
  }),
  external({ atlas: "hex", colour: "#F5A3B5", hosts: ["hex.tech"], id: "hex", source: "Hex" }),
  external({ colour: "#00B2FF", hosts: ["fathom.video"], id: "fathom", mark: "fathom", source: "Fathom" }),
  external({ atlas: "inngest", colour: "#6E7BF2", hosts: ["inngest.com"], id: "inngest", source: "Inngest" }),
  external({
    atlas: "cloudflare",
    colour: "#F38020",
    hosts: ["cloudflare.com"],
    id: "cloudflare",
    mark: "cloudflare",
    source: "Cloudflare",
  }),
  external({
    atlas: "onepassword",
    colour: "#3B82F6",
    hosts: ["1password.com"],
    id: "onepassword",
    mark: "1password",
    source: "1Password",
  }),
  external({ atlas: "figma", colour: "#F24E1E", hosts: ["figma.com"], id: "figma", mark: "figma", source: "Figma" }),
  external({ atlas: "aether", colour: "#64748B", hosts: [], id: "aether", source: "Aether" }),
  external({
    atlas: "airtable",
    colour: "#18BFFF",
    hosts: ["airtable.com"],
    id: "airtable",
    mark: "airtable",
    source: "Airtable",
  }),
  external({ atlas: "braze", colour: "#FF6A4D", hosts: ["braze.com"], id: "braze", source: "Braze" }),
  external({ atlas: "canva", colour: "#00C4CC", hosts: ["canva.com"], id: "canva", source: "Canva" }),
  external({ atlas: "clerk", colour: "#6C47FF", hosts: ["clerk.com"], id: "clerk", mark: "clerk", source: "Clerk" }),
  external({
    atlas: "crowdstrike",
    colour: "#FC3D39",
    hosts: ["crowdstrike.com"],
    id: "crowdstrike",
    source: "CrowdStrike",
  }),
  external({
    atlas: "graphql-hive",
    colour: "#E10098",
    hosts: ["graphql-hive.com"],
    id: "graphqlHive",
    source: "GraphQL Hive",
  }),
  external({ atlas: "jam", colour: "#FF4F8B", hosts: ["jam.dev"], id: "jam", source: "Jam" }),
  external({ atlas: "knock", colour: "#E95744", hosts: ["knock.app"], id: "knock", source: "Knock" }),
  external({ atlas: "knowbe4", colour: "#5C2D91", hosts: ["knowbe4.com"], id: "knowbe4", source: "KnowBe4" }),
  external({ atlas: "make", colour: "#6D00CC", hosts: ["make.com", "make.celonis.com"], id: "make", source: "Make" }),
  external({
    atlas: "microsoft365",
    colour: "#D83B01",
    hosts: ["microsoft.com", "office.com", "microsoft365.com"],
    id: "microsoft365",
    mark: "microsoft",
    source: "Microsoft 365",
  }),
  external({ atlas: "nightfall", colour: "#2F54EB", hosts: ["nightfall.ai"], id: "nightfall", source: "Nightfall" }),
  external({ atlas: "nx-cloud", colour: "#4C8BF5", hosts: ["nx.app"], id: "nxCloud", mark: "nx", source: "Nx Cloud" }),
  external({
    atlas: "prisma-data-platform",
    colour: "#5A67D8",
    hosts: ["prisma.io"],
    id: "prismaDataPlatform",
    mark: "prisma",
    source: "Prisma",
  }),
  external({
    atlas: "trelica",
    colour: "#00A3E0",
    hosts: ["trelica.app", "trelica.com"],
    id: "trelica",
    source: "Trelica",
  }),
  external({ atlas: "twilio", colour: "#F22F46", hosts: ["twilio.com"], id: "twilio", source: "Twilio" }),
  external({ atlas: "workos", colour: "#6363F1", hosts: ["workos.com"], id: "workos", source: "WorkOS" }),
  external({ atlas: "xero", colour: "#13B5EA", hosts: ["xero.com"], id: "xero", mark: "xero", source: "Xero" }),
];

/** Every place in this console a citation can point at. */
export const PLACE_KINDS = {
  board: place({ colour: "#22D3EE", id: "board", source: "the board" }),
  console: place({ colour: "#94A3B8", id: "console", source: "this console" }),
  page: place({ colour: "#A3E635", id: "page", source: "a local page" }),
  queue: place({ colour: "#FBBF24", id: "queue", source: "the queue" }),
  talk: place({ colour: "#34D399", id: "talk", source: "a talk turn" }),
  workstream: place({ colour: "#38BDF8", id: "workstream", source: "a workstream" }),
} as const satisfies Readonly<Record<string, CitationKind>>;

/** An address no row claims: named by its host, in a neutral colour. */
export const WEB_KIND: CitationKind = place({ colour: "#94A3B8", id: "web", source: "the web" });

/**
 * Whether `host` is `domain` itself or one of its subdomains — never a lookalike that merely ends in it.
 *
 * @returns true when `host` is `domain` or sits under it
 */
export function isHostOf({ host, domain }: { host: string; domain: string }): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * The integration an external address belongs to, by its host alone.
 *
 * @param host the address's hostname, lowercased, without `www.`
 * @returns the row whose hosts claim it, or `undefined` when none does
 */
export function integrationKindOf({ host }: { host: string }): CitationKind | undefined {
  return INTEGRATION_KINDS.find((kind) => kind.hosts.some((domain) => isHostOf({ domain, host })));
}

/** Every row by its id — integrations, places and the web. */
const BY_ID: ReadonlyMap<string, CitationKind> = new Map(
  [...INTEGRATION_KINDS, ...Object.values(PLACE_KINDS), WEB_KIND].map((kind) => [kind.id, kind]),
);

/**
 * One row by its id, as `citedSource` hands it back.
 *
 * @param id a kind's registry key
 * @returns that row, or the web's when no row has the id — a citation still draws, in the neutral colour
 */
export function citationKind({ id }: { id: string }): CitationKind {
  const found = BY_ID.get(id);
  if (found === undefined) {
    return WEB_KIND;
  }
  return found;
}

/**
 * The atlas platforms this registry covers, one per row that names one — what the mirror test holds against
 * `src/atlas/registry.ts`.
 *
 * @returns the platform names, in registry order
 */
export function atlasCitationPlatforms(): readonly string[] {
  return INTEGRATION_KINDS.flatMap((kind) => {
    if (kind.atlas === undefined) {
      return [];
    }
    return [kind.atlas];
  });
}
