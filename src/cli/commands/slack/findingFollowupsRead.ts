/**
 * `slack finding-followups`'s one effectful read: the findings they shared, off the draft register, and their threads,
 * off the local Slack corpus.
 *
 * The register says what was shared and whether its one follow-up card is spent (`outbound/slack/sharedFindings.ts`).
 * Only a finding still owed a card is looked for in the corpus, so a home whose findings are all spent or none shared
 * costs no scan at all. The scan is the same constant-heap line filter `slack awaiting`'s second pass runs
 * (`../sessionStart/slackRow.ts`'s `mayBelongTo`), keyed on the few `channel:threadTs` keys still owed a card.
 *
 * An unreadable register is `unavailable`, never an empty list; so is no declared owner id, or an absent or unreadable
 * Slack corpus, once a finding is owed a card. A register line passed over, a thread line that would not parse or a
 * members index that is absent or did not read cleanly is `incomplete`.
 */

import { readSlackDraftLinesOrError } from "../../../admit/slackDraftStore.js";
import { parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import { followupsSpending, type SharedFinding, sharedFindingsOf } from "../../../outbound/slack/sharedFindings.js";
import { loadProfile } from "../../../profileStore.js";
import type { FindingThreadMessage } from "../../../sessionStart/findingFollowups.js";
import { authorIsHuman, memberIndexRead } from "../sessionStart/slackPeople.js";
import { slackFiles, WINDOW_DAYS } from "../sessionStart/slackRead.js";
import { mayBelongTo, slackRowOf, threadKeyOf, unreadableWord } from "../sessionStart/slackRow.js";
import { scanFile } from "../sessionStart/slackScan.js";

/** One finding still owed its follow-up card, with every message the corpus holds in its thread. */
interface OwedFinding {
  readonly finding: SharedFinding;
  readonly messages: readonly FindingThreadMessage[];
}

/** What one read produced, and why it produced nothing when it did. */
export interface FindingFollowupsRead {
  readonly status: "complete" | "incomplete" | "unavailable";
  /** The findings shared inside the window whose one card is unspent, each with its thread. */
  readonly owed: readonly OwedFinding[];
  /** Findings shared inside the window whose card is already spent, by the rows that spent it. */
  readonly spent: readonly { readonly findingId: string; readonly by: readonly string[] }[];
  /** Findings shared before the window, which no longer come back. */
  readonly olderThanWindow: number;
  /** How many days back a finding still counts. */
  readonly windowDays: number;
  /** What the read could not see, in the words the verb prints. */
  readonly couldNotSee: readonly string[];
}

/**
 * An empty read carrying the reason it could not see.
 *
 * @param reason the sentence the residue opens with
 * @returns the unavailable read
 */
function unavailableRead({ reason }: { reason: string }): FindingFollowupsRead {
  return {
    couldNotSee: [reason],
    olderThanWindow: 0,
    owed: [],
    spent: [],
    status: "unavailable",
    windowDays: WINDOW_DAYS,
  };
}

/**
 * The message's own Slack `ts`: the last segment of its `sourceId`, a root's second and a reply's fourth.
 *
 * @param sourceId the record's own id
 * @returns the `ts` as Slack spells it
 */
function ownTsStringOf({ sourceId }: { sourceId: string }): string {
  return sourceId.split(":").at(-1)!;
}

/** Who may speak in a finding's thread, as the scan tells them apart. */
interface ThreadSpeakers {
  readonly ownerId: string;
  readonly members: ReturnType<typeof memberIndexRead>["members"];
  readonly selfIds: ReadonlySet<string>;
}

/**
 * File one corpus line under its thread when it is a message of a thread still owed a card.
 *
 * @param line the raw corpus line
 * @param keys the `channel:threadTs` keys collected, each already holding its (possibly empty) list
 * @param byThread the messages so far, keyed by thread
 * @param speakers their id, the members index and the bot's own ids
 * @returns 1 when the line plainly belonged to an owed thread and would not parse, else 0
 */
function collectThreadLine({
  byThread,
  keys,
  line,
  speakers,
}: {
  byThread: ReadonlyMap<string, FindingThreadMessage[]>;
  keys: ReadonlySet<string>;
  line: string;
  speakers: ThreadSpeakers;
}): number {
  if (!mayBelongTo({ keys, line })) {
    return 0;
  }
  const row = slackRowOf({ line });
  if (row === undefined) {
    return Number(unreadableWord({ keys, line }));
  }
  const key = threadKeyOf({ sourceId: row.sourceId });
  if (key === undefined || !keys.has(key)) {
    return 0;
  }
  let role: FindingThreadMessage["role"] = "other";
  if (row.author === speakers.ownerId) {
    role = "owner";
  } else if (authorIsHuman({ author: row.author, members: speakers.members, selfIds: speakers.selfIds })) {
    role = "person";
  }
  byThread.get(key)!.push({
    authorId: row.author,
    permalink: row.url,
    role,
    text: row.authoredText,
    ts: ownTsStringOf({ sourceId: row.sourceId }),
    tsIso: row.tsIso,
  });
  return 0;
}

/**
 * Every message the corpus holds in the given threads, keyed by thread, and how many of their lines would not parse.
 *
 * @param home the state home whose Slack bronze is read
 * @param keys the `channel:threadTs` keys to collect
 * @param ownerId their own Slack id, which marks their words
 * @param selfIds the bot's own Slack ids, off the same profile read as `ownerId`
 * @returns the messages — every key present, a thread the corpus holds nothing of as an empty list — or the reason a
 *   file could not be listed or read
 */
function threadMessages({
  home,
  keys,
  ownerId,
  selfIds,
}: {
  home: string;
  keys: ReadonlySet<string>;
  ownerId: string;
  selfIds: ReadonlySet<string>;
}):
  | {
      readonly byThread: ReadonlyMap<string, FindingThreadMessage[]>;
      readonly membersProblem: string | null;
      readonly unparsed: number;
    }
  | { readonly refusal: string } {
  const listed = slackFiles({ home });
  if ("refusal" in listed) {
    return { refusal: `the Slack corpus could not be listed: ${listed.refusal.message}` };
  }
  // An absent corpus lists as no files, and no files would read every owed finding as unanswered.
  if (listed.paths.length === 0) {
    return { refusal: "this home holds no Slack corpus, so no reply in a finding's thread can be seen" };
  }
  // A bot the index cannot name reads as a person, and a person's "fixed" is a card, so its problem is carried.
  const { members, problem: membersProblem } = memberIndexRead({ home });
  const speakers: ThreadSpeakers = { members, ownerId, selfIds };
  // A thread the corpus holds no message of is a finding nobody has answered yet, so every key starts empty.
  const byThread = new Map([...keys].map((key): [string, FindingThreadMessage[]] => [key, []]));
  let unparsed = 0;
  for (const path of listed.paths) {
    const failed = scanFile({
      onLine: ({ line }) => {
        unparsed += collectThreadLine({ byThread, keys, line, speakers });
      },
      path,
    });
    if (failed !== undefined) {
      return { refusal: `a Slack corpus file could not be read: ${failed.message}` };
    }
  }
  return { byThread, membersProblem, unparsed };
}

/**
 * The register's half of the read: which recent findings are owed a card, which are spent, and what it could not see.
 *
 * @param log the parsed draft register
 * @param nowIso the run's own instant, which the window ends at
 * @returns the owed and spent findings, how many fell outside the window, and the register's own residue
 */
function registerHalf({ log, nowIso }: { log: ReturnType<typeof parseSlackDraftLog>; nowIso: string }): {
  readonly couldNotSee: string[];
  readonly olderThanWindow: number;
  readonly owedFindings: readonly SharedFinding[];
  readonly spent: readonly { readonly findingId: string; readonly by: readonly string[] }[];
} {
  const shared = sharedFindingsOf({ events: log.events });
  const sinceIso = new Date(Date.parse(nowIso) - WINDOW_DAYS * 86_400_000).toISOString();
  const recent = shared.findings.filter((finding) => finding.postedAtIso >= sinceIso);
  const spending = recent.map((finding) => ({
    by: followupsSpending({ events: log.events, findingId: finding.draftId, supersedes: [] }),
    finding,
  }));
  const couldNotSee: string[] = [];
  if (log.skipped.length > 0) {
    couldNotSee.push(
      `${String(log.skipped.length)} draft register line(s) did not read, so a shared finding or the card that spent it may be missing`,
    );
  }
  if (shared.undated.length > 0) {
    couldNotSee.push(
      `released finding(s) ${shared.undated.join(", ")} carry a landed ts that names no instant, so they are not judged`,
    );
  }
  return {
    couldNotSee,
    olderThanWindow: shared.findings.length - recent.length,
    owedFindings: spending.filter((one) => one.by.length === 0).map((one) => one.finding),
    spent: spending.filter((one) => one.by.length > 0).map((one) => ({ by: one.by, findingId: one.finding.draftId })),
  };
}

/**
 * Read the findings they shared and the threads of those still owed a card.
 *
 * @param home the state home to read
 * @param nowIso the run's own instant, which the window ends at
 * @returns the read, `unavailable` with nothing owed whenever it could not see
 */
export function readFindingFollowups({ home, nowIso }: { home: string; nowIso: string }): FindingFollowupsRead {
  const lines = readSlackDraftLinesOrError({ home });
  if (lines.isErr()) {
    return unavailableRead({ reason: `the draft register could not be read: ${lines.error.message}` });
  }
  const { couldNotSee, olderThanWindow, owedFindings, spent } = registerHalf({
    log: parseSlackDraftLog({ lines: lines.value }),
    nowIso,
  });
  const base = { olderThanWindow, spent, windowDays: WINDOW_DAYS };
  if (owedFindings.length === 0) {
    return { ...base, couldNotSee, owed: [], status: couldNotSee.length === 0 ? "complete" : "incomplete" };
  }
  // their id only tells their word from the team's in a thread, so it is needed only once a finding is owed.
  // Read once, and the bot's own ids off the same read: a second read could miss what the first saw.
  const slackBot = loadProfile({ home })?.slackBot;
  const ownerId = slackBot?.ownerUserId;
  if (ownerId === undefined || ownerId.length === 0) {
    return unavailableRead({
      reason:
        "profile.json declares no `slackBot.ownerUserId`, so nothing can tell your word in a finding's thread from the team's",
    });
  }
  const keys = new Set(owedFindings.map((finding) => `${finding.channelId}:${finding.threadTs}`));
  const selfIds = slackBot?.selfUserIds === undefined ? new Set<string>() : new Set(slackBot.selfUserIds);
  const scanned = threadMessages({ home, keys, ownerId, selfIds });
  if ("refusal" in scanned) {
    return unavailableRead({ reason: scanned.refusal });
  }
  if (scanned.membersProblem !== null) {
    couldNotSee.push(`${scanned.membersProblem}, so a bot in a finding's thread may read as a person`);
  }
  if (scanned.unparsed > 0) {
    couldNotSee.push(
      `${String(scanned.unparsed)} corpus line(s) in a finding's thread did not parse as a message, so a reply may be missing`,
    );
  }
  return {
    ...base,
    couldNotSee,
    owed: owedFindings.map((finding) => ({
      finding,
      messages: scanned.byThread.get(`${finding.channelId}:${finding.threadTs}`)!,
    })),
    status: couldNotSee.length === 0 ? "complete" : "incomplete",
  };
}
