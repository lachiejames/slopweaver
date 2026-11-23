/*
 * Where inside an integration an address points, read off its path alone — `owner/repo #N`,
 * `control ac-12`, `monitor N` — the words a citation's hover card leads with.
 *
 * Apart from `./citationDisplay.ts`, which decides WHICH integration an address is (by its host, through
 * `./citationKinds.ts`), because each integration spells its places its own way and one parser per integration
 * keeps each small. Nothing here is fetched: a place the path does not carry is said as the integration's name,
 * never guessed. Pure.
 */

/** The parts of an address a place parser reads. */
export interface AddressParts {
  readonly host: string;
  readonly path: readonly string[];
  readonly hash: string;
}

/**
 * A pull request or issue number as GitHub spells one in a path — at most nine digits, so `Number` keeps it
 * exactly: an unbounded run of digits read as `Infinity` and was handed to a verb as `pull/Infinity`.
 */
const GITHUB_NUMBER = /^[1-9][0-9]{0,8}$/u;

/** A Linear issue key: the team's key, a dash, the number (at most nine digits, as above) — `SUP-9811`. */
const LINEAR_KEY = /^([A-Z][A-Z0-9]{0,9})-([1-9][0-9]{0,8})$/u;

/**
 * The pull request a GitHub path names — `owner/repo/pull/N`, with or without a tab after it. The ONE grammar both
 * the hover card's place and its live detail (`./citedRecord.ts`) read a pull request by.
 *
 * @param path the address's path segments
 * @returns the repository, the number and the tab, or `undefined` when the path is not a pull request
 */
export function githubPullOf({
  path,
}: {
  path: readonly string[];
}): { readonly repoSlug: string; readonly number: number; readonly tab: string } | undefined {
  const [owner = "", repo = "", section = "", number = "", tab = ""] = path;
  if (owner === "" || repo === "" || section !== "pull" || !GITHUB_NUMBER.test(number)) {
    return undefined;
  }
  return { number: Number(number), repoSlug: `${owner}/${repo}`, tab };
}

/**
 * The issue key a Linear path names — `<workspace>/issue/KEY-N/<slug>`. The ONE grammar both the hover card's place
 * and its live detail (`./citedRecord.ts`) read a ticket by.
 *
 * @param path the address's path segments
 * @returns the key and its team's key, or `undefined` when the path names no issue
 */
export function linearIssueOf({
  path,
}: {
  path: readonly string[];
}): { readonly key: string; readonly team: string } | undefined {
  const issue = path.indexOf("issue");
  if (issue === -1) {
    return undefined;
  }
  const key = path.at(issue + 1);
  const matched = key === undefined ? null : LINEAR_KEY.exec(key);
  if (key === undefined || matched === null) {
    return undefined;
  }
  const [, team = ""] = matched;
  return { key, team };
}

/** A GitHub address's place: the repository, then the pull request, issue, commit or file under it. */
function githubPlace({ path }: AddressParts): string {
  // Defaults rather than `undefined` checks: the root program compiles this under `noUncheckedIndexedAccess` and
  // `site/` does not, so an empty string is the one absence both read the same. A segment is never empty.
  const [owner = "", repo = "", section = "", number = ""] = path;
  if (owner === "" || repo === "") {
    return "github.com";
  }
  const repository = `${owner}/${repo}`;
  const pull = githubPullOf({ path });
  if (pull?.tab === "files") {
    return `${repository} #${String(pull.number)} · its diff`;
  }
  if (pull !== undefined) {
    return `${repository} #${String(pull.number)}`;
  }
  if (section === "issues" && number !== "") {
    return `${repository} #${number}`;
  }
  if (section === "commit" && number !== "") {
    return `${repository} @ ${number.slice(0, 7)}`;
  }
  if (section === "blob" && path.length > 4) {
    return `${repository} · ${path.slice(4).join("/")}`;
  }
  return repository;
}

/**
 * A Slack address's place: whether an archive link is one message or a whole channel. Never the channel's id: a channel id is not
 * shown anywhere in the UI, because the owner knows channels only by name. An address carries no name, so a caller that knows it says it through {@link namedSlackPlace}.
 */
function slackPlace({ path }: AddressParts): string {
  const [section = "", channel = "", message = ""] = path;
  if (section !== "archives" || channel === "") {
    return "Slack";
  }
  if (message === "") {
    return "a channel";
  }
  return "a message";
}

/** A Slack archive address: the workspace host, the conversation id, and whether a message follows it. */
const SLACK_ARCHIVE = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.slack\.com)\/archives\/([A-Z0-9]+)(\/p\d+)?/iu;

/**
 * The conversation a Slack archive address lives in, the workspace it is in, and whether it names one message there
 * rather than the whole channel. The ONE grammar both a chip's place and its channel window read a Slack link by. The
 * workspace travels with the id because an id is only an id within one workspace.
 *
 * @param href the address
 * @returns the lowercase workspace host, the conversation id and whether a message follows it, or `undefined` for
 *   any other address
 */
export function slackArchiveOf({
  href,
}: {
  href: string;
}): { readonly workspace: string; readonly channel: string; readonly message: boolean } | undefined {
  const matched = SLACK_ARCHIVE.exec(href);
  if (matched === null) {
    return undefined;
  }
  const [, workspace = "", channel = "", message = ""] = matched;
  if (!/^[A-Z0-9]+$/u.test(channel)) {
    return undefined;
  }
  return { channel, message: message !== "", workspace: workspace.toLowerCase() };
}

/**
 * A Slack address's place with its conversation's name, when the caller holds one: `a message in #platform-squad`,
 * `a message in your DM with Tobias`.
 *
 * @param href the address
 * @param channels the words each conversation is known by — `#platform-squad` — keyed by its id, as the reading
 *   carried them
 * @returns the place, or `undefined` when the address is not a Slack archive link or its channel is not named
 */
export function namedSlackPlace({
  href,
  channels,
}: {
  href: string;
  channels: ReadonlyMap<string, string>;
}): string | undefined {
  const archive = slackArchiveOf({ href });
  if (archive === undefined) {
    return undefined;
  }
  const name = channels.get(archive.channel);
  if (name === undefined) {
    return undefined;
  }
  if (!archive.message) {
    return name;
  }
  return `a message in ${name}`;
}

/** A Linear address's place: the issue key it carries. */
function linearPlace({ path }: AddressParts): string {
  const issue = linearIssueOf({ path });
  if (issue !== undefined) {
    return issue.key;
  }
  return "linear.app";
}

/** The segment after `section` in a path, when there is one: `controls/ac-12` gives `ac-12`. */
function after({ path, section }: { path: readonly string[]; section: string }): string | undefined {
  const at = path.indexOf(section);
  if (at === -1) {
    return undefined;
  }
  return path.at(at + 1);
}

/** A Vanta address's place: the control, test or policy it names. */
function vantaPlace({ path }: AddressParts): string {
  const nouns = [
    ["controls", "control"],
    ["tests", "test"],
    ["policies", "policy"],
    ["documents", "document"],
    ["vendors", "vendor"],
  ] as const;
  for (const [section, noun] of nouns) {
    const id = after({ path, section });
    if (id !== undefined) {
      return `${noun} ${id}`;
    }
  }
  return "Vanta";
}

/** A Datadog address's place: the monitor or dashboard it names, else the view it opens. */
function datadogPlace({ path }: AddressParts): string {
  const monitor = after({ path, section: "monitors" });
  if (monitor !== undefined && /^\d+$/u.test(monitor)) {
    return `monitor ${monitor}`;
  }
  const dashboard = after({ path, section: "dashboard" });
  if (dashboard !== undefined) {
    return `dashboard ${dashboard}`;
  }
  const [section = ""] = path;
  if (section === "") {
    return "Datadog";
  }
  return `the ${section} view`;
}

/** A JumpCloud console address's place: its `#/<section>/<id>` route, when the address carries one. */
function jumpcloudPlace({ hash }: AddressParts): string {
  const [section = "", id = ""] = hash
    .replace(/^#\/?/u, "")
    .split("/")
    .filter((segment) => segment !== "");
  if (section === "") {
    return "the JumpCloud console";
  }
  if (id === "") {
    return section;
  }
  return `${section} ${id}`;
}

/** A Google Docs or Drive address's place: which kind of file it is. */
function drivePlace({ path }: AddressParts): string {
  const [section = ""] = path;
  const files = new Map<string, string>(
    Object.entries({
      document: "a Google Doc",
      file: "a Drive file",
      folders: "a Drive folder",
      forms: "a Google Form",
      presentation: "a Google Slides deck",
      spreadsheets: "a Google Sheet",
    }),
  );
  const file = files.get(section);
  if (file === undefined) {
    return "Google Drive";
  }
  return file;
}

/** A Fathom address's place: a shared call. */
function fathomPlace({ path }: AddressParts): string {
  if (path[0] === "share" || path[0] === "calls") {
    return "a recorded call";
  }
  return "Fathom";
}

/** Each integration whose places are spelled out; any other names itself by its host. */
const PLACES = new Map<string, (parts: AddressParts) => string>(
  Object.entries({
    calendar: () => "a calendar event",
    datadog: datadogPlace,
    drive: drivePlace,
    fathom: fathomPlace,
    github: githubPlace,
    gmail: () => "a mail thread",
    jumpcloud: jumpcloudPlace,
    linear: linearPlace,
    notion: () => "a Notion page",
    slack: slackPlace,
    vanta: vantaPlace,
  }),
);

/**
 * Where inside the integration `kind` an address points.
 *
 * @param kind the integration's registry key, already decided by the address's host
 * @param parts the address's host, path segments and fragment
 * @returns the place, as specific as the address allows — the host when this integration spells no places
 */
export function integrationPlace({ kind, parts }: { kind: string; parts: AddressParts }): string {
  const placeOf = PLACES.get(kind);
  if (placeOf === undefined) {
    return parts.host;
  }
  return placeOf(parts);
}
