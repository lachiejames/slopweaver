/**
 * The assignment ledger: which node belongs to which workstream, append-only, and nothing else.
 *
 * ## What this deliberately does NOT store
 *
 * Not status, not "blocked", not a summary, not a count. `AGENTS.md` states that the handover board is the
 * only register of what is in flight and that there is no workstream list; `docs/workstreams.md` says why,
 * and it is measured rather than theoretical — a saved list _"starts rotting the moment it is saved"_, and
 * a stale one already cost duplicate pastes into a conversation that had shipped and two competing pull
 * requests for the same fix. Everything a reader could check against a source is therefore RECOMPOSED on
 * every read; the only thing persisted is the one fact no source can answer, which is which pile the owner
 * put a thing in.
 *
 * That makes this a view over the board rather than a second register: sessions propose additions and
 * adjustments to a workstream over time, the owner reacts, and both mental models update.
 *
 * ## Why the id is opaque
 *
 * A workstream's TITLE is a mutable label. If identity were derived from it, re-running the proposal with
 * different wording would silently split or merge yesterday's workstreams, and the owner would see a
 * different set of things on Monday and Friday with no event explaining it — which is exactly how a view
 * stops being trusted. So an id is minted once, never derived from prose, and a retitle is an event rather
 * than a new workstream. This mirrors `../sessionStart/item.ts`, where identity is source plus native id
 * and never rank or text, and `../sessionStart/lockIn.ts`, whose append-only record is the pattern the
 * owner already answers.
 *
 * ## Why removing a node is an EVENT rather than a deleted line
 *
 * Found on first real use, seeding the owner-approved first grouping: three security-pull-request
 * direct-message nodes were assigned under placeholder thread timestamps before the real ones were looked up,
 * and the correct three were then appended. A later assignment of the same node wins, so the corrections
 * landed — but nothing could say a node belongs to NO workstream, and the workstream folded to SIX nodes of
 * which three named no real thread. Nothing RENDERED wrong, because `./scan.ts` resolves assignments by
 * `ledger.assignments.get(node.id)` over nodes that actually exist and a dead id is never queried; what was
 * wrong was the fold's own count, which is exactly the number a later reader trusts when asking how big a
 * workstream is.
 *
 * Deleting the three bad lines would have fixed the count and broken the property that makes the whole file
 * worth having: append-only is what lets the owner's correction be authoritative without a rewrite. So the
 * removal is a fourth event kind, `unassigned`, and the file still only ever grows.
 *
 * The effectful edge is small and confined to the bottom of this module: read the file, append a line.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { appendLines } from "../lib/appendSeparator.js";
import { parseJsonObject } from "../lib/jsonParse.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { stateHomePaths } from "../stateHome.js";

/** An opaque workstream id. Minted once, never derived from a label. */
export type WorkstreamId = string;

/** One append-only ledger event. */
export type AssignmentEvent =
  | {
      readonly kind: "assigned";
      readonly workstreamId: WorkstreamId;
      readonly nodeId: string;
      readonly atIso: string;
      /** `proposed` when a session suggested it, `owner` when the owner ruled. */
      readonly by: "proposed" | "owner";
    }
  | {
      readonly kind: "titled";
      readonly workstreamId: WorkstreamId;
      readonly title: string;
      readonly atIso: string;
    }
  | {
      readonly kind: "merged";
      /** The id being retired. */
      readonly workstreamId: WorkstreamId;
      /** The id that absorbs it. */
      readonly intoId: WorkstreamId;
      readonly atIso: string;
    }
  | {
      readonly kind: "unassigned";
      /** The pile the node is being taken out of, recorded as provenance — see {@link foldLedger}. */
      readonly workstreamId: WorkstreamId;
      readonly nodeId: string;
      readonly atIso: string;
    };

/** The folded current state of the ledger. */
export interface LedgerState {
  /** Node id to the workstream it currently belongs to, merges already followed. An unassigned node is ABSENT. */
  readonly assignments: ReadonlyMap<string, WorkstreamId>;
  /** Workstream id to its current title, where one has been set. */
  readonly titles: ReadonlyMap<WorkstreamId, string>;
  /** Retired ids, kept so an old pointer still resolves rather than dangling. */
  readonly mergedInto: ReadonlyMap<WorkstreamId, WorkstreamId>;
}

/**
 * Where the ledger lives under the state home.
 *
 * @param home the state home
 * @returns the absolute path of the append-only assignment ledger
 */
export function ledgerPath({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).footprint, "assignments.jsonl");
}

/**
 * Follow a chain of merges to the id that is still live.
 *
 * @param id the id to resolve
 * @param mergedInto every retirement recorded so far
 * @returns the surviving id
 */
function resolveMerges({
  id,
  mergedInto,
}: {
  id: WorkstreamId;
  mergedInto: ReadonlyMap<WorkstreamId, WorkstreamId>;
}): WorkstreamId {
  const seen = new Set<WorkstreamId>();
  let cursor = id;
  let next = mergedInto.get(cursor);
  while (next !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    cursor = next;
    next = mergedInto.get(cursor);
  }
  return cursor;
}

/**
 * Fold a sequence of events into the state they describe.
 *
 * A later assignment of the same node wins, which is what makes the owner's correction authoritative
 * without anything being rewritten. `unassigned` is the same rule carried to its end: the LAST event naming
 * a node decides where it is, and this one says nowhere.
 *
 * So an `unassigned` removes the node whatever its `workstreamId` says, and that field is provenance — which
 * pile it came out of — rather than a condition. Matching on it instead would make a stale one a silent
 * no-op, and the defect this event kind was written for was precisely a count nobody could see was wrong.
 * An over-eager removal announces itself at the next scan, where the node reappears as unassigned.
 *
 * @param events the events in the order they were appended
 * @returns the current state
 */
export function foldLedger({ events }: { events: readonly AssignmentEvent[] }): LedgerState {
  const mergedInto = new Map<WorkstreamId, WorkstreamId>();
  const titles = new Map<WorkstreamId, string>();
  const raw = new Map<string, WorkstreamId>();
  for (const event of events) {
    if (event.kind === "merged") {
      mergedInto.set(event.workstreamId, event.intoId);
    }
    if (event.kind === "titled") {
      titles.set(event.workstreamId, event.title);
    }
    if (event.kind === "assigned") {
      raw.set(event.nodeId, event.workstreamId);
    }
    if (event.kind === "unassigned") {
      raw.delete(event.nodeId);
    }
  }
  const assignments = new Map<string, WorkstreamId>();
  for (const [nodeId, workstreamId] of raw) {
    assignments.set(nodeId, resolveMerges({ id: workstreamId, mergedInto }));
  }
  return { assignments, mergedInto, titles };
}

/**
 * Read one ledger line into an event, or refuse it.
 *
 * @param line the raw JSONL line
 * @returns the event, or undefined when the line is not one
 */
export function parseAssignmentEvent({ line }: { line: string }): AssignmentEvent | undefined {
  const parsed = parseJsonObject({ text: line });
  if (parsed.isErr()) {
    return undefined;
  }
  const value = parsed.value;
  const kind = value["kind"];
  const atIso = value["atIso"];
  const workstreamId = value["workstreamId"];
  if (typeof atIso !== "string" || typeof workstreamId !== "string") {
    return undefined;
  }
  if (kind === "assigned" && typeof value["nodeId"] === "string") {
    const by = value["by"] === "owner" ? "owner" : "proposed";
    return { atIso, by, kind: "assigned", nodeId: value["nodeId"], workstreamId };
  }
  if (kind === "titled" && typeof value["title"] === "string") {
    return { atIso, kind: "titled", title: value["title"], workstreamId };
  }
  if (kind === "merged" && typeof value["intoId"] === "string") {
    return { atIso, intoId: value["intoId"], kind: "merged", workstreamId };
  }
  if (kind === "unassigned" && typeof value["nodeId"] === "string") {
    return { atIso, kind: "unassigned", nodeId: value["nodeId"], workstreamId };
  }
  return undefined;
}

/**
 * Read the whole ledger.
 *
 * An absent file is an ordinary empty state — nothing has been assigned yet. A file that exists and cannot
 * be read is a refusal carrying its reason, never an empty result that reads as "no assignments".
 *
 * @param home the state home
 * @returns every event in order, or why the file could not be read
 */
export function readLedger({ home }: { home: string }): Result<readonly AssignmentEvent[]> {
  const path = ledgerPath({ home });
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "footprint.readLedger", path });
  if (read.isErr()) {
    if (read.error.cause instanceof Error && "code" in read.error.cause && read.error.cause.code === "ENOENT") {
      return ok([]);
    }
    return err([read.error.message]);
  }
  const events: AssignmentEvent[] = [];
  for (const line of read.value.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const event = parseAssignmentEvent({ line: trimmed });
    if (event !== undefined) {
      events.push(event);
    }
  }
  return ok(events);
}

/**
 * Append events to the ledger, creating it when this is the first one.
 *
 * @param home the state home
 * @param events the events to append, in order
 * @returns how many were written, or why the append failed
 */
export function appendLedger({ home, events }: { home: string; events: readonly AssignmentEvent[] }): Result<number> {
  if (events.length === 0) {
    return ok(0);
  }
  const path = ledgerPath({ home });
  const written = safeFs({
    execute: () => {
      mkdirSync(dirname(path), { recursive: true });
      appendLines({ path, text: events.map((event) => JSON.stringify(event)).join("\n") + "\n" });
      return events.length;
    },
    operation: "footprint.appendLedger",
    path,
  });
  if (written.isErr()) {
    return err([written.error.message]);
  }
  return ok(written.value);
}
