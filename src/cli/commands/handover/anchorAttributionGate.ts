/**
 * `handover register` refuses a Slack-anchored row whose prose says someone other than the anchored message's
 * author asked, tagged or posted it — a card that credits one person over a link to another person's own review
 * ask is wrong (`../../../handover/anchorAttribution.ts` carries the incident and the rule).
 *
 * Who posted is read from the LOCAL corpus: the Slack bronze window files whose window covers the message's date,
 * never `compact.jsonl` (17 GB on the operator's home —`du -h "$SLOPWEAVER_HOME/corpus/bronze/slack"`),
 * and the derived roster beside them. A message the corpus cannot place is UNCHECKED, said in one line, and never
 * refused: a gate that cannot see its subject has nothing to say about it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bronzeSourceDir, silverIdentitiesPath } from "../../../corpus/corpusPaths.js";
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import {
  attributionMismatches,
  givenNamesOf,
  posterWordsOf,
  slackHumans,
} from "../../../handover/anchorAttribution.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { parseJsonObject } from "../../../lib/jsonParse.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { slackTsToIso } from "../../../lib/slackTs.js";
import { parseSlackThreadPermalink } from "../../../live/slack/permalink.js";
import { type DerivedPerson, parseDerivedRoster } from "../../../silver/derivedRoster.js";

/** A bronze window file's name: the first and last day it covers. */
const WINDOW_FILE = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.jsonl$/u;

/** Who posted an anchored Slack message, as far as the local corpus can say. */
export type AnchorAuthorRead =
  /** The anchor is no Slack message permalink, so there is no author to check against. */
  | { readonly kind: "not-slack" }
  /** The corpus cannot place the message or its author; the row is registered unchecked. */
  | { readonly kind: "unchecked"; readonly why: string }
  /** The author, and every person on the roster. */
  | {
      readonly kind: "found";
      readonly userId: string;
      readonly author: DerivedPerson;
      readonly people: readonly DerivedPerson[];
    };

/**
 * The bronze window files whose window covers one day — never the compacted file.
 *
 * @param entries the Slack bronze directory's file names
 * @param day the `YYYY-MM-DD` the message was posted on, in UTC
 * @returns the covering window file names
 */
export function coveringWindows({ entries, day }: { entries: readonly string[]; day: string }): readonly string[] {
  return entries.filter((entry) => {
    const window = WINDOW_FILE.exec(entry);
    return window !== null && window[1]! <= day && day <= window[2]!;
  });
}

/**
 * The Slack user id that posted one message, read off the window files that cover its day.
 *
 * @param dir the Slack bronze directory
 * @param windows the covering window file names
 * @param sourceId the record's id: `<channel>:<ts>` for a parent, `<channel>:<threadTs>:reply:<ts>` for a reply
 * @returns the author's raw Slack user id, `absent` when no covering window holds the message, or the window file
 *   that would not read — a file `corpus compact` removed between the listing and the open, one a permission bars
 */
function authorInWindows({
  dir,
  windows,
  sourceId,
}: {
  dir: string;
  windows: readonly string[];
  sourceId: string;
}):
  | { readonly kind: "author"; readonly userId: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly path: string } {
  const needle = `"sourceId":"${sourceId}"`;
  let author: string | undefined;
  for (const window of windows) {
    const path = join(dir, window);
    const read = safeFs({
      execute: () => {
        readJsonlLines({
          onLine: ({ line }) => {
            if (author !== undefined || !line.includes(needle)) {
              return;
            }
            const record = parseJsonObject({ text: line });
            if (record.isOk() && record.value["sourceId"] === sourceId && typeof record.value["author"] === "string") {
              author = record.value["author"];
            }
          },
          path,
        });
      },
      operation: "readSlackBronzeWindow",
      path,
    });
    if (read.isErr()) {
      return { kind: "unreadable", path };
    }
    if (author !== undefined) {
      return { kind: "author", userId: author };
    }
  }
  return { kind: "absent" };
}

/**
 * Who posted the message a row's anchor links, from the local corpus.
 *
 * @param home the state home whose corpus is read
 * @param anchor the row's `--anchor`, when it has one
 * @returns the author and roster, `not-slack`, or why the corpus could not say
 */
export function anchorAuthor({ home, anchor }: { home: string; anchor: string | undefined }): AnchorAuthorRead {
  if (anchor === undefined) {
    return { kind: "not-slack" };
  }
  const target = parseSlackThreadPermalink({ permalink: anchor });
  if (target.isErr()) {
    return { kind: "not-slack" };
  }
  const { addressedReply, addressedTs, channel, threadTs } = target.value;
  // A reply is stored under its thread (`src/corpus/slack/project.ts`), so a reply link names that id, not its own.
  let sourceId = `${channel}:${addressedTs}`;
  if (addressedReply) {
    sourceId = `${channel}:${threadTs}:reply:${addressedTs}`;
  }
  const iso = slackTsToIso({ ts: addressedTs });
  if (iso === undefined) {
    return { kind: "unchecked", why: `${addressedTs} is not a Slack timestamp` };
  }
  const dir = bronzeSourceDir({ home, source: "slack" });
  const listed = safeFs({ execute: () => readdirSync(dir), operation: "listSlackBronze", path: dir });
  if (listed.isErr()) {
    return { kind: "unchecked", why: `the Slack corpus at ${dir} does not read` };
  }
  const day = iso.slice(0, 10);
  const windows = coveringWindows({ day, entries: listed.value });
  const found = authorInWindows({ dir, sourceId, windows });
  if (found.kind === "unreadable") {
    return { kind: "unchecked", why: `the Slack bronze window ${found.path} does not read` };
  }
  if (found.kind === "absent") {
    return {
      kind: "unchecked",
      why: `no Slack bronze window covering ${day} holds the message (${String(windows.length)} window file(s) read; the compacted file is never scanned here)`,
    };
  }
  const userId = found.userId;
  const path = silverIdentitiesPath({ home });
  const roster = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readDerivedRoster", path });
  if (roster.isErr()) {
    return { kind: "unchecked", why: `the derived roster at ${path} does not read, so ${userId} has no name` };
  }
  const people = parseDerivedRoster({ content: roster.value }).people;
  const author = people.find((person) =>
    person.identities.some((identity) => identity.source === "slack" && identity.nativeId === userId),
  );
  if (author === undefined) {
    return { kind: "unchecked", why: `the derived roster names nobody for Slack user ${userId}` };
  }
  return { author, kind: "found", people, userId };
}

/**
 * A person's name as a refusal prints it: a display name off any identity, else their handle, else their id.
 *
 * @param person the roster person
 * @returns the name
 */
function displayName({ person }: { person: DerivedPerson }): string {
  const named = person.identities.find((identity) => identity.name !== undefined);
  if (named?.name !== undefined) {
    return named.name;
  }
  const handled = person.identities.find((identity) => identity.handle !== undefined);
  if (handled?.handle !== undefined) {
    return handled.handle;
  }
  return person.id;
}

/**
 * Whether `handover register` must refuse a row whose prose attributes its anchored Slack message to someone who did
 * not post it, printing why — or, when the corpus cannot say who posted it, one line saying it went unchecked.
 *
 * @param home the state home whose corpus is read
 * @param anchor the row's `--anchor`
 * @param texts the row's summary and example scenes
 * @param env the environment to read the hatch key from
 * @param out where each line goes
 * @returns `true` when the caller must refuse, `false` when it may write the row
 */
export function anchorAttributionRefused({
  home,
  anchor,
  texts,
  env,
  out,
}: {
  home: string;
  anchor: string | undefined;
  texts: readonly string[];
  env: NodeJS.ProcessEnv;
  out: (args: { line: string }) => void;
}): boolean {
  const read = anchorAuthor({ anchor, home });
  if (read.kind === "not-slack") {
    return false;
  }
  if (read.kind === "unchecked") {
    out({ line: `anchor-attribution: who the row says posted ${anchor!} was not checked — ${read.why}` });
    return false;
  }
  const people = new Set(
    slackHumans({ people: read.people }).flatMap((person) => [...givenNamesOf({ identities: person.identities })]),
  );
  const mismatches = attributionMismatches({
    author: posterWordsOf({ identities: read.author.identities }),
    people,
    texts,
  });
  if (mismatches.length === 0) {
    return false;
  }
  const claims = mismatches.map((one) => `"${one.name} ${one.verb}"`).join(", ");
  const poster = displayName({ person: read.author });
  // Spelled as the LITERAL variable, because `src/devLint/escapeHatch.ts` finds a row's reader by this exact string.
  const open = env["SLOPWEAVER_ALLOW_ANCHOR_ATTRIBUTION"];
  if (open !== undefined && open.length > 0) {
    out({ line: `anchor-attribution: override in force — the row says ${claims}, and ${poster} posted ${anchor!}` });
    return false;
  }
  const detail = `the row says ${claims}, but ${anchor!} was posted by ${poster} (${read.userId}); name ${poster} as the one who asked, or anchor the message the person you named posted`;
  for (const line of hatchRefusalLines({ detail, hatch: hatchFor({ id: "anchor-attribution" }) })) {
    out({ line });
  }
  return true;
}
