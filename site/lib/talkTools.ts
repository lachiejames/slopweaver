/**
 * The closed list of tools a MODEL may call from the console voice — the fourth list beside `liveVerbs.ts`,
 * `syncVerbs.ts` and `actVerbs.ts`, and the only one whose caller is not this repository.
 *
 * ## Why it is a separate list from `actVerbs.ts`, and why that is the mechanism
 *
 * The other three lists are reached by a page this repo wrote. This one is reached by a language model
 * that has just read source text out of the checkout, a board row and whatever the page is showing, so
 * anything it can call is something a file, a row or a card could ask it to call. The origin guard does not
 * separate the two — `consolePress.ts` says so in its own header — because a model-driven fetch really is
 * same-origin from the page this server served.
 *
 * What holds instead is TYPE plus ONE GATE. {@link TalkTool}'s `does` has six members, `read`, `preference`,
 * `show`, `list-write`, `relay` and `draft`, and no generic write arm, so a new writer is a change to the union in a
 * diff next to this paragraph. A `preference` tool flips one of the owner's stage switches in this browser, the same
 * as clicking it, or sets what the page's drift watch holds for them (`driftWatch.ts`), and reaches nothing past the
 * page. A `show` tool
 * draws on the owner's own screen and likewise reaches nothing past it: `focus_screen` lifts a region of the screen in
 * the desktop app on their ask (`screenFocus.ts` gates it). The one `list-write` tool, `offer_copy`, puts a message
 * the owner will paste themselves on their own running list (`talk list-add --origin voice`,
 * `src/talk/runningList.ts`), kept across calls and restarts, and reaches nothing past that list; `running_list` reads
 * it back, every item's credentials masked. The one `relay` tool, `relay_steer`, is the steer the owner talks
 * through: everything relayed lands as if the owner had given that steer directly to the supervisor. It is not
 * pressed by a button; it runs when the model calls it, so what makes it the owner's word
 * rather than the model's is `relayGate.ts`: the write goes ahead only when the owner has SPOKEN since the last
 * relay and no tool has handed the model third-party text since they last spoke. The row then carries their
 * own transcribed words first and the model's reading second.
 *
 * The two `draft` tools, `draft_edit` and `draft_restore`, rewrite the parked Slack draft on the card the owner has
 * open, or put an earlier version back, and send nothing. The page aims them, never the model: the card is the one
 * open on the owner's Queue and their quoted words come from the call's own transcript (`draftEdit.ts`), and the write is `slack draft revise|restore` through
 * `/api/talk/draft`, which keeps every version and fixes everything but the words.
 *
 * ## The two places a tool can run
 *
 * `verb` tools spawn a `slopweaver talk` verb through `/api/talk/tool/<name>`. `page` tools are answered in
 * the browser: `action_items` is the SAME `rowsOf` projection the Queue page draws, over the record read at the tool and
 * checked against the Queue on screen (`./voiceRecordQueue.ts`) — `read_page` is what the
 * page the owner is on registered through `usePageVoice`, `read_screen` is one frame of the screen they shared,
 * `read_card` resolves a key against that same projection and answers with the card and its links, opening nothing,
 * `open_card` resolves the same way and, for a card the call turns to that the owner does not already have open or one
 * they ask for, puts the card, one linked page and its Slack thread on their screen
 * (`components/voice/openCardRun.ts`, behind the `openCards` switch), `set_stage_setting` flips a
 * stage switch through `useStageToggles`, `focus_screen` lifts one region of the
 * screen through the desktop app (`components/voice/useScreenFocus.ts`), `offer_copy` adds to the owner's running list through
 * the page's `offerCopy` seam, and `relay_steer` goes through the gate to `/api/talk/relay`.
 *
 * ## The names here and the names the model is told
 *
 * `src/talk/talkToolSchemas.ts` declares the tool SCHEMAS sent to OpenAI; this file declares how each one
 * RUNS. They are two lists in two Yarn projects and nothing static can compare them — `site/` cannot
 * import `src/`. So the widget compares them at run time instead: `talk offer --json` prints the names it
 * declared and which of them write, and `VoiceProvider.tsx` refuses to start a session when either set
 * differs from this list, naming both sides.
 */

import { threadKeyOf } from "./slackLink";
import { type BuiltArgv, fillSlots, refuseSlot } from "./slots";
import { TALK_TOOLS, type TalkTool } from "./talkToolsList";

/** The names, for the start-up comparison against what `talk offer` says it declared. */
export const TALK_TOOL_NAMES: readonly string[] = TALK_TOOLS.map((tool) => tool.name);

/** The tools that write, for the same comparison against the `writers` `talk offer` prints. */
export const TALK_WRITER_NAMES: readonly string[] = TALK_TOOLS.filter(
  (tool) => tool.does === "relay" || tool.does === "draft",
).map((tool) => tool.name);

/**
 * Resolve a name off the URL to a tool, or nothing.
 *
 * @param name the tool the model asked for
 * @returns the row, or `undefined` for a name the list does not hold
 */
export function talkToolFor({ name }: { name: string }): TalkTool | undefined {
  return TALK_TOOLS.find((tool) => tool.name === name);
}

/**
 * The link one read tool call opened, for its line in the call file — what lets the next call open it again. Measured:
 * a call rolled over at its cap mid-thread, and the next one asked the owner to paste a link the voice had read off
 * their Slack reply box, because the line said only `read`. A tool reads a link when its row declares a
 * `url` slot or option, so a new one is covered without this list.
 *
 * @param name the tool the model called
 * @param args its parsed arguments, or `undefined` when they were not an object
 * @returns the link, or `undefined` when the tool reads none or the call named none
 */
export function openedLinkOf({
  name,
  args,
}: {
  name: string;
  args: Record<string, unknown> | undefined;
}): string | undefined {
  if (!readsLink({ name }) || args === undefined) {
    return undefined;
  }
  const link = args["url"];
  if (typeof link !== "string" || link.trim() === "") {
    return undefined;
  }
  return link.trim();
}

/**
 * Whether a tool is a verb read that takes a `url`, as a slot or an option — the only tools whose call-file line may
 * name a link it opened.
 *
 * @param name the tool's name
 * @returns `true` for a url-taking read
 */
export function readsLink({ name }: { name: string }): boolean {
  const tool = talkToolFor({ name });
  if (tool?.where !== "verb" || tool.does !== "read") {
    return false;
  }
  return (
    tool.argv.some((part) => typeof part !== "string" && part.slot === "url") ||
    tool.options.some((option) => option.name === "url")
  );
}

/**
 * Why the `browser` tool will not take this call: a Slack MESSAGE link is a thread, and a thread is read through
 * `slack_open`, never by inspecting the page: a voice asked to read the thread that reaches for `browser` is
 * opening it in the browser instead of using its own tools. Only the `browser` look is refused: `browser_open` putting
 * the thread in front of the owner is what "pull it
 * up" asks for, and a Slack page that is not a message link (a canvas, a file) still has only the browser.
 *
 * @param tool the resolved row
 * @param args whatever the model put in the call's `arguments`
 * @returns the sentence the model is told, or `undefined` when the call is not one
 */
function slackThreadBrowserRefusal({
  tool,
  args,
}: {
  tool: Extract<TalkTool, { where: "verb" }>;
  args: Record<string, unknown>;
}): string | undefined {
  const url = args["url"];
  if (tool.name !== "browser" || typeof url !== "string" || threadKeyOf({ link: url.trim() }) === undefined) {
    return undefined;
  }
  return "a Slack message link is a thread, read whole with slack_open, never through the browser; use browser_open only when the owner asked to see or pull it up";
}

/** The hosts a GitHub object page answers on: `www.` redirects, and a look there still attaches to the owner's Chrome. */
const GITHUB_HOSTS: ReadonlySet<string> = new Set(["github.com", "www.github.com"]);

/** The path families `parseGithubReadAddress` (`src/live/github/read.ts`) reads, each followed by a number. */
const GITHUB_READ_FAMILIES: ReadonlySet<string> = new Set(["discussions", "issues", "pull"]);

/** An owner or repository name as `parseGithubReadAddress` accepts one. */
const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/u;

/** A pull request's views `github read` does not carry, so a `browser` look at one stays a look. */
const PULL_VIEWS_NOT_READ: ReadonlySet<string> = new Set(["checks", "commits"]);

/** The largest number `github read`'s GraphQL query carries: its `number` variable is an `Int`, 32-bit signed. */
const GRAPHQL_INT_MAX = 2_147_483_647;

/**
 * One path segment percent-decoded, or left as written when its escape is malformed (`files%`): `github read`
 * still reads the pull request in front of a broken subpage, so a decoding error must not let the look through.
 * A raw owner or repository keeps its `%` and fails `GITHUB_NAME` on its own.
 *
 * @param segment one non-empty segment of the URL's path
 * @returns the decoded segment, or the raw one when it cannot be decoded
 */
function decodedSegment({ segment }: { segment: string }): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The canonical `https://github.com/<owner>/<repo>/<family>/<number>` link of a GitHub issue, pull request or
 * discussion page, its query, fragment and a pull request's `/files` included — the family `parseGithubReadAddress` reads,
 * restated because `site/` cannot import `src/`. It goes through `URL` and decodes each path segment rather than
 * matching a pattern, so a default port, a `www.`, a trailing root dot or a percent-encoded spelling of the same page is
 * the same page: four such spellings got through a pattern. The family's case is folded on purpose, failing closed: a
 * `/Pull/1` refused wrongly costs one `github read` of the real page, one let through is the loop this exists to stop.
 * The link is canonical because that reader takes only the bare host, and the refusal hands the model a link it can read.
 *
 * @param link the address the model passed
 * @returns the link `github read` reads, or `undefined` for any other page
 */
function githubReadLink({ link }: { link: string }): string | undefined {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return undefined;
  }
  // A trailing root dot (`github.com.`) is the same host in DNS.
  const host = url.hostname.replace(/\.$/u, "");
  // `URL` empties a scheme's default port, so any other port is a different origin and no GitHub page.
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !GITHUB_HOSTS.has(host) || url.port !== "") {
    return undefined;
  }
  // Typed as possibly absent per element: `site/`'s tsconfig has no `noUncheckedIndexedAccess`, and a short path
  // leaves the later segments undefined.
  const parts: readonly (string | undefined)[] = url.pathname
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => decodedSegment({ segment: part }));
  const [owner, repo, rawFamily, number, subPage, ...deeper] = parts;
  const family = rawFamily?.toLowerCase();
  // The segment's leading digits, as that reader's own pattern takes them (`1.diff` and `1x` read as 1): `0` is
  // no page, `007` reads as 7, and a number past GraphQL's `Int` is one its query cannot carry.
  const digits = number?.match(/^\d+/u)?.[0];
  const index = digits !== undefined ? digits.replace(/^0+/u, "") : "";
  // Only what that reader covers: the object page, and any one pull request subpage but a commit or checks view,
  // content it does not carry, so a look at one stays a look. `github read` reads `/pull/<n>/xyz` as pull request <n>
  // (measured: `slopweaver github read https://github.com/lachiejames/slopweaver/pull/<n>/xyz --json`),
  // and `/files` is what `--files` reads.
  const covered = subPage === undefined || (family === "pull" && !PULL_VIEWS_NOT_READ.has(subPage.toLowerCase()));
  if (
    owner === undefined ||
    repo === undefined ||
    !GITHUB_NAME.test(owner) ||
    !GITHUB_NAME.test(repo) ||
    family === undefined ||
    !GITHUB_READ_FAMILIES.has(family) ||
    index.length === 0 ||
    Number(index) > GRAPHQL_INT_MAX ||
    !covered ||
    deeper.length > 0
  ) {
    return undefined;
  }
  return `https://github.com/${owner}/${repo}/${family}/${index}`;
}

/**
 * Why the `browser` tool will not take this call: a GitHub issue, pull request or discussion is read by `verb github
 * read`, never by inspecting the page. A `browser` look attaches to the owner's own Chrome, and the attach raises the
 * window before the restore drops it back (`src/browser/keepForeground.ts`). Measured, live in front of fifteen people: the
 * owner had a teammate's pull request on screen, the frame and `github read` had already read it, and the answering
 * turn still ran `browser inspect` on it, the window going to the foreground, to the background and back until the
 * owner said to stop because the pull request was already in front of them. Only the look is refused: `browser_open` is what "pull it
 * up" asks for, and whether a page is already on the owner's screen is something this seam cannot see, so that half
 * rests on the prompts. A page `github read` cannot read (no token access) is said to be unread, never looked at in
 * the owner's Chrome.
 *
 * @param tool the resolved row
 * @param args whatever the model put in the call's `arguments`
 * @returns the sentence the model is told, or `undefined` when the call is not one
 */
function githubObjectBrowserRefusal({
  tool,
  args,
}: {
  tool: Extract<TalkTool, { where: "verb" }>;
  args: Record<string, unknown>;
}): string | undefined {
  const url = args["url"];
  if (tool.name !== "browser" || typeof url !== "string") {
    return undefined;
  }
  const readable = githubReadLink({ link: url.trim() });
  if (readable === undefined) {
    return undefined;
  }
  return `a GitHub pull request, issue or discussion is read with verb github read ${readable} --json (add --files for a pull request's changed files), never through the owner's browser, and one already on their screen is in the frame; if github read cannot read it, say it is unread; use browser_open only when they asked to see or pull it up`;
}

/**
 * Build the argv for one verb tool from the arguments the model supplied.
 *
 * A `browser` look at a Slack message link is refused first, naming `slack_open` ({@link slackThreadBrowserRefusal}),
 * and so is one at a GitHub issue, pull request or discussion, naming `github read` ({@link githubObjectBrowserRefusal}).
 *
 * The required half goes through the shared `fillSlots`, so a value that could be read as a flag is
 * refused exactly as it is on the act route. Each optional is then checked against its own shape and
 * appended — or left out entirely, which is deliberate: leaving it out means the VERB decides the default,
 * and a default written here as well would be a second copy free to drift from the one that runs.
 *
 * @param tool the resolved row
 * @param args whatever the model put in the call's `arguments`
 * @returns the argv, or the one refusal
 */
export function talkArgvFor({
  tool,
  args,
}: {
  tool: Extract<TalkTool, { where: "verb" }>;
  args: Record<string, unknown>;
}): BuiltArgv {
  for (const refusal of [slackThreadBrowserRefusal, githubObjectBrowserRefusal]) {
    const wrongTool = refusal({ args, tool });
    if (wrongTool !== undefined) {
      return { kind: "refused", why: wrongTool };
    }
  }
  const optionNames = new Set(tool.options.map((option) => option.name));
  const required: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!optionNames.has(key)) {
      required[key] = value;
    }
  }
  const built = fillSlots({ parts: tool.argv, subject: tool.name, supplied: required });
  if (built.kind === "refused") {
    return built;
  }
  const argv = [...built.argv];
  for (const option of tool.options) {
    if (!(option.name in args)) {
      continue;
    }
    const supplied = args[option.name];
    if ("kind" in option) {
      if (typeof supplied !== "boolean") {
        return { kind: "refused", why: `${option.name} must be true or false` };
      }
      if (supplied) {
        argv.push(option.flag);
      }
      continue;
    }
    // A JSON Schema `integer` arrives as a number, and every argv element is a string. Converted here
    // rather than accepted as a string, so a float or a NaN is refused by the count shape below instead of
    // reaching the verb as `1.5` or `NaN`.
    let value = "";
    if (typeof supplied === "number") {
      value = String(supplied);
    } else if (typeof supplied === "string") {
      value = supplied;
    } else {
      return { kind: "refused", why: `${option.name} must be a string or a number` };
    }
    const refused = refuseSlot({ slot: { shape: option.shape, slot: option.name }, value });
    if (refused !== undefined) {
      return { kind: "refused", why: refused };
    }
    argv.push(option.flag, value);
  }
  return { argv, kind: "argv" };
}
