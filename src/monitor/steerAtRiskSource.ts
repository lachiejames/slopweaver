/**
 * The read behind `steer-at-risk`: every run journal carrying an explicit-steer ruling, each judged against its own
 * row document by `../handover/steerRisk.ts`.
 *
 * It walks `runs/` rather than scanning the board, the way `../handover/rulingGateStore.ts` rebuilds the gates: a
 * steer lives on a `ruling` line, the documents cost seconds to scan, and a cheap substring test keeps every journal
 * that carries no steer out of the decoder. Only a steered row's own document is then read, by its exact slug.
 *
 * Not having looked is never `clear`. A `runs/` that will not list is `unmeasurable`. A steered journal with a line
 * this build cannot decode, or whose document will not read, is a blind spot: a partly read ruling can neither
 * establish the exception nor end it, so that row is named rather than judged — on a firing reading, or as the
 * reason the pass is `unmeasurable` when nothing else fired.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseLedger } from "../handover/ledger.js";
import { judgeSteerRisk } from "../handover/steerRisk.js";
import { readExactDoc } from "../handover/store.js";
import { errorMessage } from "../lib/errorMessage.js";
import { stateHomePaths } from "../stateHome.js";

import { readHeldKeys } from "./heldKeys.js";
import { evaluateSteerAtRisk, STEER_AT_RISK, type SteerAtRiskRow } from "./steerAtRisk.js";
import type { MonitorReading } from "./types.js";

/** The `.jsonl` suffix a run journal carries. */
const JOURNAL_SUFFIX = ".jsonl";

/** A journal that MAY carry a steer, whatever whitespace its writer put around the colon. */
const STEER_FIELD = /"explicitSteer"\s*:/;

/** What the read found: every steered row judged, and every steered row it could not judge. */
interface SteeredRows {
  readonly rows: readonly SteerAtRiskRow[];
  readonly blind: readonly string[];
}

/**
 * Every steered row under the home, judged at one instant.
 *
 * @param home the Slopweaver home
 * @param nowIso the instant to judge at
 * @returns the rows and the blind spots, or why `runs/` would not list
 */
function steeredRows({ home, nowIso }: { home: string; nowIso: string }): SteeredRows | string {
  const paths = stateHomePaths({ home });
  let names: readonly string[];
  try {
    names = readdirSync(paths.runs).filter((name) => name.endsWith(JOURNAL_SUFFIX));
  } catch (error) {
    return `the run journals directory could not be listed: ${errorMessage({ error })}`;
  }
  const rows: SteerAtRiskRow[] = [];
  const blind: string[] = [];
  for (const name of names.toSorted()) {
    const slug = name.slice(0, -JOURNAL_SUFFIX.length);
    let text: string;
    try {
      text = readFileSync(join(paths.runs, name), "utf8");
    } catch (error) {
      blind.push(`${slug}: its journal would not read (${errorMessage({ error })})`);
      continue;
    }
    if (!STEER_FIELD.test(text)) {
      continue;
    }
    const journal = parseLedger({ text });
    if (journal.unreadable.length > 0) {
      blind.push(`${slug}: ${String(journal.unreadable.length)} journal line(s) this build cannot decode`);
      continue;
    }
    const doc = readExactDoc({ handoverDir: paths.handovers, slug });
    if (doc.isErr()) {
      blind.push(`${slug}: its document would not read (${doc.error.why})`);
      continue;
    }
    if (doc.value === undefined) {
      blind.push(`${slug}: no document is filed under that slug`);
      continue;
    }
    rows.push({ slug, verdict: judgeSteerRisk({ doc: doc.value.doc, events: journal.events, nowIso }) });
  }
  return { blind, rows };
}

/**
 * Read every steered row and judge which are at risk.
 *
 * @param home the Slopweaver home
 * @param nowIso the instant to judge at — `monitor check --now` in a replay
 * @returns the reading — firing, clear or unmeasurable, never a quiet clear over a read that failed
 */
export function readSteerAtRisk({ home, nowIso }: { home: string; nowIso: string }): MonitorReading {
  const held = readHeldKeys({ definition: STEER_AT_RISK, home });
  if (held.isErr()) {
    return { because: held.error, monitorId: "steer-at-risk", state: "unmeasurable" };
  }
  const read = steeredRows({ home, nowIso });
  if (typeof read === "string") {
    return { because: read, monitorId: "steer-at-risk", state: "unmeasurable" };
  }
  const reading = evaluateSteerAtRisk({ dismissed: held.value.dismissed, rows: read.rows, shown: held.value.shown });
  if (read.blind.length === 0) {
    return reading;
  }
  const because = `a steered row could not be judged, so its risk may be invisible — ${read.blind.join("; ")}`;
  if (reading.state === "firing") {
    return { ...reading, blindSpot: because };
  }
  return { because, monitorId: "steer-at-risk", state: "unmeasurable" };
}
