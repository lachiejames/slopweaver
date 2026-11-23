/**
 * The `checkout console --json` report the sidebar's build status reads: its shape, the reader that refuses a payload
 * off that shape, and where a build sits in the upstream history it carries. Split out of `./buildStanding.ts`, which
 * decides the standing from it.
 */
import { type Bag, isBag, num, str } from "./bag";
import { type ShellStamp, stampOf } from "./desktopShellWire";

/** One upstream commit, as `checkout console --json` carries it. */
export interface ConsoleCommit {
  readonly sha: string;
  readonly title: string;
  readonly committedIso: string;
  readonly pullRequest: { readonly number: number; readonly url: string | undefined } | undefined;
  /** Whether it changes what the desktop app is built from; `undefined` when the reading could not say. */
  readonly changesShell: boolean | undefined;
  /** Whether it changes the console page or its voice — "in the app"; `undefined` when the reading could not say. */
  readonly changesConsole: boolean | undefined;
}

/** The server the run record names. */
export type ServedConsole =
  | { readonly kind: "none" }
  | { readonly kind: "dev"; readonly startedIso: string; readonly live: boolean }
  | {
      readonly kind: "production";
      readonly sha: string;
      readonly startedIso: string;
      readonly live: boolean;
    };

/**
 * The installed desktop app as the verb compared it with the upstream (`src/checkouts/installedApp.ts`). A page joins
 * it to the app's own reading by the whole stamp, because the two are read at different instants.
 */
export type InstalledAppReading =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly why: string }
  | {
      readonly kind: "read";
      readonly stamp: ShellStamp;
      /** Whether the app's source differs from the upstream tip's; `undefined` when it was not compared. */
      readonly shellDiffers: boolean | undefined;
      /** Where the build forked from the upstream, carried when its source differs. */
      readonly forkSha: string | undefined;
    };

/** The fields of `checkout console --json` the page reads. */
export interface ConsoleBuildReport {
  readonly observedAtIso: string;
  readonly root: string;
  readonly served: ServedConsole;
  readonly head: { readonly sha: string } | undefined;
  /** The installed app; `undefined` only from a verb older than the field. */
  readonly installedApp: InstalledAppReading | undefined;
  readonly upstream:
    | {
        readonly ref: string;
        readonly sha: string;
        readonly fetchedAtIso: string | undefined;
        readonly behind: number;
        readonly ahead: number;
      }
    | undefined;
  readonly mainline: {
    readonly limit: number;
    readonly truncated: boolean;
    readonly commits: readonly ConsoleCommit[];
  };
  readonly rebuild: {
    readonly running: boolean;
    readonly waiting: { readonly sha: string } | undefined;
    readonly logPath: string;
  };
  readonly problems: readonly string[];
}

/** A full commit sha. */
const SHA = /^[0-9a-f]{40}$/u;

/** One commit out of the payload, or `undefined` when any field is off-shape. */
function commitOf({ bag }: { bag: Bag }): ConsoleCommit | undefined {
  const sha = str({ bag, key: "sha" });
  const title = str({ bag, key: "title" });
  const committedIso = str({ bag, key: "committedIso" });
  if (sha === undefined || !SHA.test(sha) || title === undefined || committedIso === undefined) {
    return undefined;
  }
  // Absent from a reading that could not say, or from a verb older than the field: unknown, never "no".
  const changesShell = bag["changesShell"];
  if (changesShell !== undefined && typeof changesShell !== "boolean") {
    return undefined;
  }
  const changesConsole = bag["changesConsole"];
  if (changesConsole !== undefined && typeof changesConsole !== "boolean") {
    return undefined;
  }
  const flags = { changesConsole, changesShell };
  const pr = bag["pullRequest"];
  if (pr === undefined || pr === null) {
    return { ...flags, committedIso, pullRequest: undefined, sha, title };
  }
  if (!isBag(pr)) {
    return undefined;
  }
  const number = num({ bag: pr, key: "number" });
  if (number === undefined) {
    return undefined;
  }
  return { ...flags, committedIso, pullRequest: { number, url: str({ bag: pr, key: "url" }) }, sha, title };
}

/** The served console out of the payload. */
function servedOfBag({ bag }: { bag: Bag }): ServedConsole | undefined {
  const kind = bag["kind"];
  if (kind === "none") {
    return { kind };
  }
  const startedIso = str({ bag, key: "startedIso" });
  const live = bag["live"];
  if (startedIso === undefined || typeof live !== "boolean") {
    return undefined;
  }
  if (kind === "dev") {
    return { kind, live, startedIso };
  }
  const sha = str({ bag, key: "sha" });
  if (kind !== "production" || sha === undefined || !SHA.test(sha)) {
    return undefined;
  }
  return { kind, live, sha, startedIso };
}

/** The upstream out of the payload; `null` for an absent one, `undefined` for a malformed one. */
function upstreamOfBag({ value }: { value: unknown }): ConsoleBuildReport["upstream"] | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isBag(value)) {
    return null;
  }
  const ref = str({ bag: value, key: "ref" });
  const sha = str({ bag: value, key: "sha" });
  const behind = num({ bag: value, key: "behind" });
  const ahead = num({ bag: value, key: "ahead" });
  if (ref === undefined || sha === undefined || behind === undefined || ahead === undefined) {
    return null;
  }
  return { ahead, behind, fetchedAtIso: str({ bag: value, key: "fetchedAtIso" }), ref, sha };
}

/**
 * The installed app out of the payload. `JSON.stringify` drops an `undefined` field, so an absent `installedApp` is a
 * verb older than it, and an absent `shellDiffers` or `forkSha` is one not established (no upstream among them).
 *
 * @returns the reading, `undefined` for an absent field, or `null` for a malformed one
 */
function installedAppOfBag({ value }: { value: unknown }): InstalledAppReading | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isBag(value)) {
    return null;
  }
  const { kind } = value;
  if (kind === "absent") {
    return { kind };
  }
  if (kind === "unreadable") {
    const why = str({ bag: value, key: "why" });
    return why === undefined ? null : { kind, why };
  }
  const stamp = stampOf({ value: value["stamp"] });
  const differs = value["shellDiffers"];
  const forkSha = value["forkSha"];
  if (kind !== "read" || stamp === undefined || stamp === null) {
    return null;
  }
  if ((differs !== undefined && typeof differs !== "boolean") || (forkSha !== undefined && !isSha(forkSha))) {
    return null;
  }
  // The verb reads a fork only for a source that differs, so a fork beside any other verdict contradicts it.
  if (forkSha !== undefined && differs !== true) {
    return null;
  }
  return { forkSha, kind, shellDiffers: differs, stamp };
}

/** Whether a value is a full commit sha. */
function isSha(value: unknown): value is string {
  return typeof value === "string" && SHA.test(value);
}

/**
 * Read `checkout console --json`'s payload.
 *
 * @param payload the parsed document
 * @returns the report, or `undefined` when it is not one — a tile then says the verb's shape changed
 */
export function readConsoleBuildReport({ payload }: { payload: unknown }): ConsoleBuildReport | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const observedAtIso = str({ bag: payload, key: "observedAtIso" });
  const root = str({ bag: payload, key: "root" });
  const { served, head, upstream, mainline, rebuild, problems } = payload;
  if (observedAtIso === undefined || root === undefined || !isBag(served) || !isBag(mainline) || !isBag(rebuild)) {
    return undefined;
  }
  const servedValue = servedOfBag({ bag: served });
  const upstreamValue = upstreamOfBag({ value: upstream });
  const installedApp = installedAppOfBag({ value: payload["installedApp"] });
  if (installedApp === null) {
    return undefined;
  }
  const limit = num({ bag: mainline, key: "limit" });
  const truncated = mainline["truncated"];
  const rawCommits = mainline["commits"];
  const running = rebuild["running"];
  const logPath = str({ bag: rebuild, key: "logPath" });
  if (servedValue === undefined || upstreamValue === null || limit === undefined || typeof truncated !== "boolean") {
    return undefined;
  }
  if (!Array.isArray(rawCommits) || typeof running !== "boolean" || logPath === undefined || !Array.isArray(problems)) {
    return undefined;
  }
  const commits = rawCommits.map((raw: unknown) => (isBag(raw) ? commitOf({ bag: raw }) : undefined));
  const headSha = isBag(head) ? str({ bag: head, key: "sha" }) : undefined;
  const waitingSha = isBag(rebuild["waiting"]) ? str({ bag: rebuild["waiting"], key: "sha" }) : undefined;
  if (commits.some((commit) => commit === undefined) || problems.some((line) => typeof line !== "string")) {
    return undefined;
  }
  // A first-parent history never repeats a commit, and every count the sidebar says is of this list's entries.
  if (new Set(commits.map((commit) => commit?.sha)).size !== commits.length) {
    return undefined;
  }
  return {
    head: headSha === undefined ? undefined : { sha: headSha },
    installedApp,
    mainline: { commits: commits.filter((commit): commit is ConsoleCommit => commit !== undefined), limit, truncated },
    observedAtIso,
    problems: problems.filter((line): line is string => typeof line === "string"),
    rebuild: { logPath, running, waiting: waitingSha === undefined ? undefined : { sha: waitingSha } },
    root,
    served: servedValue,
    upstream: upstreamValue,
  };
}

/** Where a sha sits in the upstream's first-parent history, newest first — 0 is the latest. */
function placeOf({ report, sha }: { report: ConsoleBuildReport; sha: string }): number | undefined {
  const at = report.mainline.commits.findIndex((commit) => commit.sha === sha);
  return at === -1 ? undefined : at;
}

/**
 * Whether loading `sha` moves a page built from `than` forward: `sha` is on the upstream's line inside the window,
 * and `than` is older in it or outside a cut window (where loading `sha` is the only way onto the line). A build
 * absent from the window is never newer, so a stale held or served build never earns a hard refresh.
 *
 * @returns true when loading `sha` moves the page forward
 */
export function newerOnLine({ report, sha, than }: { report: ConsoleBuildReport; sha: string; than: string }): boolean {
  const at = placeOf({ report, sha });
  const thanAt = placeOf({ report, sha: than });
  return at !== undefined && (thanAt === undefined || at < thanAt);
}

/**
 * A count of commits in words.
 *
 * @returns "3 commits" or "1 commit"
 */
export function commitsWord({ count }: { count: number }): string {
  return count === 1 ? "1 commit" : `${String(count)} commits`;
}

/**
 * How far a build is behind the latest, from its place in the history.
 *
 * A build absent from a CUT history is only known to be outside the window: older than it, or off the upstream's
 * line altogether, and the reading cannot tell which — so it says what it knows, never "more than N behind"
 *
 *
 * @param report the reading whose mainline places the build
 * @param sha the build's commit
 * @returns the lag as words, the same in the fewest words the sidebar's one line can hold, whether it is a count, and
 *   the commits missing — `undefined` when the build is not on a whole history at all
 */
export function behindOf({ report, sha }: { report: ConsoleBuildReport; sha: string }):
  | {
      readonly lag: string;
      readonly short: string;
      readonly counted: boolean;
      readonly missing: readonly ConsoleCommit[];
    }
  | undefined {
  const at = placeOf({ report, sha });
  if (at !== undefined) {
    return {
      counted: true,
      lag: `${commitsWord({ count: at })} behind`,
      missing: report.mainline.commits.slice(0, at),
      short: `${String(at)} behind`,
    };
  }
  if (report.mainline.truncated) {
    const ref = report.upstream === undefined ? "the upstream" : report.upstream.ref;
    return {
      counted: false,
      lag: `not in ${ref}'s last ${String(report.mainline.limit)}`,
      missing: report.mainline.commits,
      short: `not in last ${String(report.mainline.limit)}`,
    };
  }
  return undefined;
}
