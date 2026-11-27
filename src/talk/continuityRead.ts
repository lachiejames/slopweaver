/**
 * The effectful half of `./continuity.ts`: read the voice's recent relays with what became of each, the rulings
 * journalled since and — when asked — the lessons recorded since.
 *
 * Fast on purpose, because `talk offer` takes it at mint while a call is connecting: each relay's row is read by
 * its exact slug (two single-file reads, `lookupDocBySlug`) rather than by composing the board, which is the
 * 15-second read `../cli/commands/talk/packRun.ts` measured; the rulings walk stats every run journal and
 * decodes only the ones touched inside the window, and the calls half does the same over the call files
 * (`./callStore.ts`). The knowledge half opens the store, which costs seconds, so
 * the mint skips it and takes the stored pack's instead (`withStoredKnowledge`). The owner's typed turns come from the
 * current supervisor chat, which a caller reads (`supervisorForContinuity`) and hands in.
 */
import { readdirSync, statSync } from "node:fs";

import type { RunEvent } from "../handover/ledger.js";
import { readRunJournal } from "../handover/runStore.js";
import { lookupDocBySlug } from "../handover/store.js";
import { readLessonRows } from "../knowledge/memoryStore.js";
import { withTimeout } from "../lib/resilience.js";
import { stateHomePaths } from "../stateHome.js";
import { connectStore } from "../store/client.js";
import { readIntakeMarks } from "../supervisor/intakeStore.js";
import { readCalls } from "./callStore.js";
import {
  type ContinuityKnowledge,
  type ContinuityUnread,
  knowledgeSince,
  rulingsSince,
  type SteerRowEvidence,
  steersOf,
  type TalkContinuity,
  unreadContinuity,
} from "./continuity.js";
import { callsForMint, callsSince, testCallsSince } from "./continuityCalls.js";
import { typedTurnsOf } from "./continuityTyped.js";
import { readTurn } from "./relayStore.js";
import type { SupervisorWindow } from "./supervisorWindow.js";
import { readTurnFiles, steerTurnsOf } from "./turnFiles.js";

/** How long the knowledge half may wait on the local store. */
const KNOWLEDGE_DEADLINE_MS = 12_000;

/** The run journal's file suffix. */
const JOURNAL_SUFFIX = ".jsonl";

/**
 * The steers half: every relay registered since the floor, each with its row's evidence and the intake marks.
 *
 * @param home the state home
 * @param handoverDir the board directory the relays' rows live in
 * @param sinceIso the window's floor
 * @returns the steers and any unread note
 */
function readSteers({ home, handoverDir, sinceIso }: { home: string; handoverDir: string; sinceIso: string }): {
  steers: TalkContinuity["steers"];
  unread: readonly ContinuityUnread[];
} {
  const files = readTurnFiles({ home, readTurn });
  if (files.isErr()) {
    return { steers: [], unread: [{ section: "steers", why: files.error.message }] };
  }
  const { records, unread } = steerTurnsOf({ sinceIso, turns: files.value });
  const marks = readIntakeMarks({ home });
  if (marks.isErr()) {
    unread.push({
      section: "steers",
      why: `the intake marks could not be read (${marks.error.message}), so what the supervisor did may be missing`,
    });
  }
  const runsDir = stateHomePaths({ home }).runs;
  const rows: SteerRowEvidence[] = [];
  for (const slug of new Set(records.map((record) => record.slug))) {
    const doc = lookupDocBySlug({ handoverDir, slug });
    if (doc === undefined) {
      continue;
    }
    const journal = readRunJournal({ runsDir, slug });
    if (journal.isErr()) {
      unread.push({
        section: "steers",
        why: `the journal of ${slug} could not be read, so its outcome may be missing`,
      });
    }
    rows.push({
      anchor: doc.anchor,
      events: journal.isOk() ? journal.value.events : [],
      settlement: doc.settlement,
      settlementWitness: doc.settlementWitness,
      slug,
    });
  }
  return {
    steers: steersOf({ marks: marks.isOk() ? marks.value : [], records, rows }),
    unread,
  };
}

/**
 * The rulings half: every journal touched inside the window, decoded for its `ruling` events.
 *
 * @param home the state home
 * @param sinceIso the window's floor
 * @returns the rulings and any unread note
 */
function readRulings({ home, sinceIso }: { home: string; sinceIso: string }): {
  rulings: TalkContinuity["rulings"];
  unread: readonly ContinuityUnread[];
} {
  const runsDir = stateHomePaths({ home }).runs;
  let names: readonly string[];
  try {
    names = readdirSync(runsDir).filter((name) => name.endsWith(JOURNAL_SUFFIX));
  } catch (cause) {
    return { rulings: [], unread: [{ section: "rulings", why: `could not list ${runsDir}: ${String(cause)}` }] };
  }
  const floor = Date.parse(sinceIso);
  const journals: { slug: string; events: readonly RunEvent[] }[] = [];
  const failed: string[] = [];
  for (const name of names) {
    const slug = name.slice(0, -JOURNAL_SUFFIX.length);
    let touchedMs: number;
    try {
      touchedMs = statSync(`${runsDir}/${name}`).mtimeMs;
    } catch {
      failed.push(slug);
      continue;
    }
    // A journal is append-only, so one not written since the floor holds no event from inside the window.
    if (touchedMs < floor) {
      continue;
    }
    const read = readRunJournal({ runsDir, slug });
    if (read.isErr()) {
      failed.push(slug);
      continue;
    }
    journals.push({ events: read.value.events, slug });
  }
  const unread: ContinuityUnread[] = [];
  if (failed.length > 0) {
    unread.push({
      section: "rulings",
      why: `${String(failed.length)} run journal(s) could not be read (${failed.slice(0, 5).join(", ")}), so a ruling may be missing`,
    });
  }
  return { rulings: rulingsSince({ journals, sinceIso }), unread };
}

/**
 * The calls half: every call file written inside the window, folded.
 *
 * @param home the state home
 * @param sinceIso the window's floor
 * @param typedCalls whether conversations typed into the messenger are read (`callsForMint`)
 * @returns the calls and any unread note
 */
function readCallsHalf({
  home,
  sinceIso,
  typedCalls,
}: {
  home: string;
  sinceIso: string;
  typedCalls: "keep" | "drop";
}): {
  calls: TalkContinuity["calls"];
  unread: readonly ContinuityUnread[];
} {
  const read = readCalls({ home, keep: { sinceIso } });
  if (read.isErr()) {
    return { calls: [], unread: [{ section: "calls", why: read.error.message }] };
  }
  const unread: ContinuityUnread[] = [];
  if (read.value.unreadable.length > 0) {
    unread.push({
      section: "calls",
      why: `${String(read.value.unreadable.length)} call file(s) could not be read, so a call may be missing`,
    });
  }
  return { calls: callsSince({ calls: callsForMint({ calls: read.value.calls, typedCalls }), sinceIso }), unread };
}

/**
 * The desktop test instance's own calls inside the window, newest first — read only for an offer the test instance
 * placed (`talk offer --test-instance e2e`), and never part of the owner's continuity. A failed listing or any unreadable
 * call file sets `unread`, since the file not read may be the newer call; the reminder then stays off.
 *
 * @param home the state home
 * @param sinceIso the window's floor
 * @returns the test calls, and whether any call file went unread
 */
export function readTestCalls({ home, sinceIso }: { home: string; sinceIso: string }): {
  calls: TalkContinuity["calls"];
  unread: boolean;
} {
  const read = readCalls({ home, keep: { sinceIso } });
  if (read.isErr()) {
    return { calls: [], unread: true };
  }
  return {
    calls: testCallsSince({ calls: read.value.calls, sinceIso }),
    unread: read.value.unreadable.length > 0,
  };
}

/**
 * The knowledge half: the lessons recorded since the floor, from the LOCAL store inside a deadline.
 *
 * @param sinceIso the window's floor
 * @returns the lessons, or why they could not be read
 */
async function readKnowledge({
  sinceIso,
}: {
  sinceIso: string;
}): Promise<{ knowledge: TalkContinuity["knowledge"]; unread: readonly ContinuityUnread[] }> {
  // The voice reads this machine and nothing else: `connectStore` selects through `storeUrl`, which refuses a
  // remote host with no hatch, so that refusal arrives below as the unread reason.
  const read = async (): Promise<readonly ContinuityKnowledge[] | string> => {
    const opened = await connectStore();
    if (opened.isErr()) {
      return opened.error.message;
    }
    try {
      const rows = await readLessonRows({ client: opened.value });
      if (rows.isErr()) {
        return rows.error.message;
      }
      return rows.value.map((row) => ({
        claim: row.claim,
        domain: row.domain,
        id: row.id,
        recordedAtIso: row.recordedAtIso,
        verdict: row.verdict,
      }));
    } finally {
      await opened.value.close();
    }
  };
  let rows: readonly ContinuityKnowledge[] | string;
  try {
    rows = await withTimeout({ task: read, timeoutMs: KNOWLEDGE_DEADLINE_MS });
  } catch {
    rows = `the local store did not answer within ${String(KNOWLEDGE_DEADLINE_MS / 1000)} s`;
  }
  if (typeof rows === "string") {
    return { knowledge: [], unread: [{ section: "knowledge", why: rows }] };
  }
  return { knowledge: knowledgeSince({ rows, sinceIso }), unread: [] };
}

/**
 * Read where the last call left off. It never rejects: `talk offer` awaits it while a call connects, and a read
 * that threw would fail the mint, so a throw becomes a read with every half named unread.
 *
 * @param home the state home
 * @param handoverDir the board directory
 * @param nowIso the end of the window
 * @param lookbackMs how far back the window reaches
 * @param knowledge whether to open the store for the lessons half; `skip` names it unread instead
 * @param supervisor the current supervisor chat the owner's typed turns are read from, or why it could not be read
 * @param typedCalls `drop` for a desktop test instance's mint, which never reads a conversation typed into the
 *   messenger; `keep` for every other read
 * @returns the whole read, every half that failed named in `unread`
 */
export async function readContinuity({
  home,
  handoverDir,
  nowIso,
  lookbackMs,
  knowledge,
  supervisor,
  typedCalls,
}: {
  home: string;
  handoverDir: string;
  nowIso: string;
  lookbackMs: number;
  knowledge: "read" | "skip";
  supervisor: SupervisorWindow | string;
  typedCalls: "keep" | "drop";
}): Promise<TalkContinuity> {
  const sinceIso = new Date(Date.parse(nowIso) - lookbackMs).toISOString();
  try {
    return await readWhole({ handoverDir, home, knowledge, nowIso, sinceIso, supervisor, typedCalls });
  } catch (cause) {
    return unreadContinuity({ builtIso: nowIso, sinceIso, why: `the read threw: ${String(cause)}` });
  }
}

/**
 * Every half of the read, each failure it can name already in `unread`.
 *
 * @param home the state home
 * @param handoverDir the board directory
 * @param nowIso the end of the window
 * @param sinceIso the window's floor
 * @param knowledge whether to open the store for the lessons half
 * @param supervisor the current supervisor chat, or why it could not be read
 * @param typedCalls whether conversations typed into the messenger are read
 * @returns the read
 */
async function readWhole({
  home,
  handoverDir,
  nowIso,
  sinceIso,
  knowledge,
  supervisor,
  typedCalls,
}: {
  home: string;
  handoverDir: string;
  nowIso: string;
  sinceIso: string;
  knowledge: "read" | "skip";
  supervisor: SupervisorWindow | string;
  typedCalls: "keep" | "drop";
}): Promise<TalkContinuity> {
  const steers = readSteers({ handoverDir, home, sinceIso });
  const rulings = readRulings({ home, sinceIso });
  const calls = readCallsHalf({ home, sinceIso, typedCalls });
  let lessons: { knowledge: TalkContinuity["knowledge"]; unread: readonly ContinuityUnread[] } = {
    knowledge: [],
    unread: [{ section: "knowledge", why: "not read at mint — call knowledge or recent_steers for the lessons" }],
  };
  if (knowledge === "read") {
    lessons = await readKnowledge({ sinceIso });
  }
  let typed: { typed: TalkContinuity["typed"]; unread: readonly ContinuityUnread[] };
  if (typeof supervisor === "string") {
    typed = { typed: [], unread: [{ section: "typed", why: supervisor }] };
  } else {
    typed = typedTurnsOf({ sinceIso, window: supervisor });
  }
  return {
    builtIso: nowIso,
    calls: calls.calls,
    knowledge: lessons.knowledge,
    rulings: rulings.rulings,
    sinceIso,
    steers: steers.steers,
    typed: typed.typed,
    unread: [...steers.unread, ...typed.unread, ...calls.unread, ...rulings.unread, ...lessons.unread],
  };
}
