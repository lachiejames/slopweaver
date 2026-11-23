/**
 * The release notes: the landed changes an update would bring, grouped so the ones the owner asked for and the ones in the
 * app stand out, each group showing two and the rest behind its fold, each change read as a sentence in the
 * release-notes modal (`ReleaseNotesModal.tsx`). Pure.
 *
 * The modal uses progressive disclosure: fifty landed pull requests are never listed as fifty things, only the top two
 * the owner most likely cares about, ranked by what they said earlier, with the rest behind an expand.
 *
 * "What the owner said earlier" is the exact join `fleet landed` already makes (`src/fleet/landed.ts`): a landing whose
 * words are `asked` or `ruling` has the owner's own words behind it, read from their records. Nothing else ranks — not
 * the standing rule a change merged under (a licence, never the owner's words), not a title or a PR number that merely
 * resembles one. A change the landed window does not reach keeps its place, unranked, and is never dropped.
 */
import type { BoardRowQuote } from "../components/live/readHisWords";
import type { LandedView } from "../components/live/readLanded";
import type { ConsoleCommit } from "./buildStandingReport";
import { type FoldedList, foldList } from "./sidebarFold";

/** How many notes each section shows when the modal opens: the "top two". */
export const RELEASE_NOTES_SHOWN = 2;

/** One change an update would bring, with the owner's words when they stand behind it. */
export interface ReleaseNote {
  readonly commit: ConsoleCommit;
  /** The owner's words that asked for it, or `undefined` when none were read. */
  readonly quote: BoardRowQuote | undefined;
}

/** Which of the four groups a change is read in. */
export type ReleaseNoteGroup = "asked" | "app" | "unknown" | "behind";

/** The group's heading, in the order the modal draws them. */
export const RELEASE_NOTE_HEADINGS: Readonly<Record<ReleaseNoteGroup, string>> = {
  app: "In the app",
  asked: "You asked for these",
  behind: "Behind the scenes",
  unknown: "Couldn’t tell where",
};

/** The groups in drawing order. */
const GROUP_ORDER: readonly ReleaseNoteGroup[] = ["asked", "app", "unknown", "behind"];

/** One heading's worth of changes, folded after the first two. */
export interface ReleaseNoteSection {
  readonly group: ReleaseNoteGroup;
  readonly heading: string;
  readonly notes: FoldedList<ReleaseNote>;
}

/** The "N more" fold's name for what it holds. */
const CHANGE_NOUN = { many: "changes", one: "change" };

/**
 * Whether a change reaches what the owner sees: the desktop app around the console, or the console and its voice inside it.
 *
 * @returns `true` when either flag says so, `false` only when both say no, `undefined` when neither says yes and one
 *   could not be read — never "no" over an unread flag
 */
export function inTheApp({ commit }: { commit: ConsoleCommit }): boolean | undefined {
  if (commit.changesShell === true || commit.changesConsole === true) {
    return true;
  }
  if (commit.changesShell === false && commit.changesConsole === false) {
    return false;
  }
  return undefined;
}

/**
 * Which group a change is read in: the owner's asks first whatever they touched, then whether it is in the app.
 *
 * @returns the group
 */
function groupOf({ note }: { note: ReleaseNote }): ReleaseNoteGroup {
  if (note.quote !== undefined) {
    return "asked";
  }
  const seen = inTheApp({ commit: note.commit });
  if (seen === true) {
    return "app";
  }
  if (seen === false) {
    return "behind";
  }
  return "unknown";
}

/**
 * Group the changes an update would bring, so the ones the owner would notice stand out: the ones they asked for, then the ones
 * in the app (the desktop shell, the console, its voice), then any whose place could not be read, then the ones behind
 * the scenes. Each group is newest first and shows two, the rest behind its own fold; an empty group is not drawn.
 *
 * Ten commits behind does not matter to the owner when none of them touch what they are doing, and does when they
 * concern the desktop, the UI or bug fixes; the grouping lets that read at a glance.
 *
 * @param changing the commits an update would bring (`experienceChanges`, `./updateStanding.ts`), newest first
 * @param landings `fleet landed`'s reading, joined by full sha — empty while it is not read
 * @returns the non-empty groups in drawing order, every change in exactly one
 */
export function releaseNotes({
  changing,
  landings,
}: {
  changing: readonly ConsoleCommit[];
  landings: readonly LandedView[];
}): readonly ReleaseNoteSection[] {
  const bySha = new Map(landings.map((landing) => [landing.sha, landing]));
  const notes = changing.map((commit): ReleaseNote => {
    const words = bySha.get(commit.sha)?.words;
    if (words !== undefined && (words.kind === "asked" || words.kind === "ruling")) {
      const { anchor, atIso, cut, where } = words;
      return { commit, quote: { anchor, atIso, cut, where, words: words.words } };
    }
    return { commit, quote: undefined };
  });
  return GROUP_ORDER.flatMap((group): ReleaseNoteSection[] => {
    const items = notes.filter((note) => groupOf({ note }) === group);
    if (items.length === 0) {
      return [];
    }
    const folded = foldList({ items, noun: CHANGE_NOUN, shown: RELEASE_NOTES_SHOWN });
    return [{ group, heading: RELEASE_NOTE_HEADINGS[group], notes: folded }];
  });
}

/**
 * How many changes an update brings and how many of those are in the app, in words — the one count the sidebar's
 * line and the modal both say, so the two can never disagree. A change whose place could not be read is never
 * counted in the app.
 *
 * @param changing the commits an update would bring
 * @returns "1 change", "7 changes, 3 in the app", or "" for none
 */
export function releaseChangeSummary({ changing }: { changing: readonly ConsoleCommit[] }): string {
  if (changing.length === 0) {
    return "";
  }
  const total = `${String(changing.length)} ${changing.length === 1 ? CHANGE_NOUN.one : CHANGE_NOUN.many}`;
  const seen = changing.filter((commit) => inTheApp({ commit }) === true).length;
  if (seen === 0) {
    return total;
  }
  return `${total}, ${String(seen)} in the app`;
}

/**
 * Why some of an update's changes could not be checked against the owner's asks: a landing whose words would not read, or
 * whose ledger row could not be reached — an unreadable ledger directory reads that way on every landing while naming
 * no record. Ranked without them, the order would otherwise read as complete.
 *
 * @param changing the commits an update would bring
 * @param landings `fleet landed`'s reading, joined by full sha
 * @returns one sentence naming how many and the first reason, or `undefined` when every change was checked
 */
export function releaseNotesUnchecked({
  changing,
  landings,
}: {
  changing: readonly ConsoleCommit[];
  landings: readonly LandedView[];
}): string | undefined {
  const shas = new Set(changing.map((commit) => commit.sha));
  const whys = landings
    .filter((landing) => shas.has(landing.sha))
    .flatMap((landing) => {
      if (landing.words.kind === "unread" || landing.words.kind === "not-joined") {
        return [landing.words.why];
      }
      return [];
    });
  const first = whys.at(0);
  if (first === undefined) {
    return undefined;
  }
  const noun = whys.length === 1 ? CHANGE_NOUN.one : CHANGE_NOUN.many;
  return `${String(whys.length)} ${noun} could not be checked against your asks: ${first}`;
}

/**
 * The owner's words behind a change as the release notes quote them, with an ellipsis where the record is known to be short.
 *
 * @returns the words, marked where they were cut
 */
export function quotedWords({ quote }: { quote: BoardRowQuote }): string {
  if (quote.cut === "start") {
    return `…${quote.words}`;
  }
  if (quote.cut === "end") {
    return `${quote.words}…`;
  }
  return quote.words;
}
