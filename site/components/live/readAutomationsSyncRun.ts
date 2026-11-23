/**
 * The sync-run view — one corpus sync run as the ledger folds it, with its containers, progress and rates — and its
 * reader, which onboarding's sync wait reuses. A sibling of `./readAutomations.ts`, under every rule its module doc
 * states.
 */

import { type Bag, bags, bool, every, isBag, nullableNum, nullableStr, num, str, strings, sub } from "../../lib/bag";

/** A count of new rows a run wrote, by record kind. */
export type KindCounts = Readonly<Record<string, number>>;

/** One container a run read: what it was offered and what was new. */
export interface SyncContainer {
  readonly container: string;
  readonly label: string;
  readonly offered: number;
  readonly written: number;
  readonly kinds: Readonly<Record<string, { readonly offered: number; readonly written: number }>>;
}

/** A rate the verb measured between two of a run's own rows. */
export interface MeasuredRate {
  readonly amount: number;
  readonly unit: string;
  readonly overMs: number;
}

/** One sync run, as the ledger folds it. */
export interface SyncRun {
  readonly runId: string;
  readonly source: string;
  readonly state: string;
  readonly why: string;
  readonly startedAtIso: string | undefined;
  readonly finishedAtIso: string | undefined;
  readonly elapsedMs: number | undefined;
  readonly lastActivityIso: string | undefined;
  readonly quietForMs: number | undefined;
  readonly stalled: boolean;
  readonly progress:
    | {
        readonly phase: string;
        readonly done: number | undefined;
        readonly total: number | undefined;
        readonly item: string | undefined;
      }
    | undefined;
  readonly progressRate: MeasuredRate | undefined;
  readonly writtenRate: MeasuredRate | undefined;
  readonly containers: readonly SyncContainer[];
  readonly quietContainers: readonly SyncContainer[];
  readonly newByKind: KindCounts;
  readonly committedWritten: number;
  readonly errors: readonly string[];
  readonly gaps: number;
  readonly ledgerFailures: number;
  readonly malformedLines: number;
}

/** A card's sync run: the run, and its first error in plain words — absent when it said nothing in words. */
export type CardSyncRun = SyncRun & { readonly said: string | undefined };

/** A record of non-negative counts. */
function counts({ bag }: { bag: Bag | undefined }): Record<string, number> | undefined {
  if (bag === undefined) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(bag)) {
    if (typeof value !== "number") {
      return undefined;
    }
    out[key] = value;
  }
  return out;
}

/** A measured rate, `null` meaning none was measured. */
function rate({ bag, key }: { bag: Bag; key: string }): MeasuredRate | undefined | false {
  if (bag[key] === null) {
    return undefined;
  }
  const inner = sub({ bag, key });
  if (inner === undefined) {
    return false;
  }
  const amount = num({ bag: inner, key: "amount" });
  const unit = str({ bag: inner, key: "unit" });
  const overMs = num({ bag: inner, key: "overMs" });
  if (amount === undefined || unit === undefined || overMs === undefined) {
    return false;
  }
  return { amount, overMs, unit };
}

/** One container. */
function container(bag: Bag): SyncContainer | undefined {
  const name = str({ bag, key: "container" });
  const label = str({ bag, key: "label" });
  const offered = num({ bag, key: "offered" });
  const written = num({ bag, key: "written" });
  const kinds = sub({ bag, key: "kinds" });
  if (
    name === undefined ||
    label === undefined ||
    offered === undefined ||
    written === undefined ||
    kinds === undefined
  ) {
    return undefined;
  }
  const byKind: Record<string, { offered: number; written: number }> = {};
  for (const [kind, value] of Object.entries(kinds)) {
    if (!isBag(value)) {
      return undefined;
    }
    const kindOffered = num({ bag: value, key: "offered" });
    const kindWritten = num({ bag: value, key: "written" });
    if (kindOffered === undefined || kindWritten === undefined) {
      return undefined;
    }
    byKind[kind] = { offered: kindOffered, written: kindWritten };
  }
  return { container: name, kinds: byKind, label, offered, written };
}

/** The newest progress checkpoint, `null` meaning none was written. */
function progressOf({ bag }: { bag: Bag }): SyncRun["progress"] | false {
  if (bag["progress"] === null) {
    return undefined;
  }
  const inner = sub({ bag, key: "progress" });
  if (inner === undefined) {
    return false;
  }
  const phase = str({ bag: inner, key: "phase" });
  if (phase === undefined) {
    return false;
  }
  return {
    done: num({ bag: inner, key: "done" }),
    item: str({ bag: inner, key: "item" }),
    phase,
    total: num({ bag: inner, key: "total" }),
  };
}

/**
 * One sync run — exported because onboarding's sync wait reads the same view.
 *
 * @param bag one run object from the payload
 * @returns the run, or `undefined` when its shape moved
 */
export function readSyncRun(bag: Bag): SyncRun | undefined {
  const identity = runIdentity({ bag });
  const yieldOf = runYield({ bag });
  const timing = runTiming({ bag });
  if (identity === undefined || yieldOf === undefined || timing === undefined) {
    return undefined;
  }
  return { ...identity, ...yieldOf, ...timing };
}

/** A run's identity and its sentence. */
function runIdentity({
  bag,
}: {
  bag: Bag;
}): Pick<SyncRun, "runId" | "source" | "state" | "why" | "stalled"> | undefined {
  const runId = str({ bag, key: "runId" });
  const source = str({ bag, key: "source" });
  const state = str({ bag, key: "state" });
  const why = str({ bag, key: "why" });
  const stalled = bool({ bag, key: "stalled" });
  if (
    runId === undefined ||
    source === undefined ||
    state === undefined ||
    why === undefined ||
    stalled === undefined
  ) {
    return undefined;
  }
  return { runId, source, stalled, state, why };
}

/** What a run wrote, and what went wrong with it. */
function runYield({
  bag,
}: {
  bag: Bag;
}):
  | Pick<
      SyncRun,
      | "committedWritten"
      | "containers"
      | "quietContainers"
      | "newByKind"
      | "errors"
      | "gaps"
      | "ledgerFailures"
      | "malformedLines"
    >
  | undefined {
  const committedWritten = num({ bag, key: "committedWritten" });
  const errors = strings({ bag, key: "errors" });
  const gaps = num({ bag, key: "gaps" });
  const ledgerFailures = num({ bag, key: "ledgerFailures" });
  const malformedLines = num({ bag, key: "malformedLines" });
  const newByKind = counts({ bag: sub({ bag, key: "newByKind" }) });
  const containers = every({ list: bags({ bag, key: "containers" }), read: container });
  const quietContainers = every({ list: bags({ bag, key: "quietContainers" }), read: container });
  if (committedWritten === undefined || errors === undefined || gaps === undefined || ledgerFailures === undefined) {
    return undefined;
  }
  if (
    malformedLines === undefined ||
    newByKind === undefined ||
    containers === undefined ||
    quietContainers === undefined
  ) {
    return undefined;
  }
  return { committedWritten, containers, errors, gaps, ledgerFailures, malformedLines, newByKind, quietContainers };
}

/** A run's instants, spans, progress and rates — each `null` on the wire read as absent. */
function runTiming({
  bag,
}: {
  bag: Bag;
}):
  | Pick<
      SyncRun,
      | "startedAtIso"
      | "finishedAtIso"
      | "lastActivityIso"
      | "elapsedMs"
      | "quietForMs"
      | "progress"
      | "progressRate"
      | "writtenRate"
    >
  | undefined {
  const startedAtIso = nullableStr({ bag, key: "startedAtIso" });
  const finishedAtIso = nullableStr({ bag, key: "finishedAtIso" });
  const lastActivityIso = nullableStr({ bag, key: "lastActivityIso" });
  const elapsedMs = nullableNum({ bag, key: "elapsedMs" });
  const quietForMs = nullableNum({ bag, key: "quietForMs" });
  const progress = progressOf({ bag });
  const progressRate = rate({ bag, key: "progressRate" });
  const writtenRate = rate({ bag, key: "writtenRate" });
  if (startedAtIso === false || finishedAtIso === false || lastActivityIso === false || elapsedMs === false) {
    return undefined;
  }
  if (quietForMs === false || progress === false || progressRate === false || writtenRate === false) {
    return undefined;
  }
  return { elapsedMs, finishedAtIso, lastActivityIso, progress, progressRate, quietForMs, startedAtIso, writtenRate };
}
