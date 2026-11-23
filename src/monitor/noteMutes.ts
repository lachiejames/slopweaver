/**
 * "NEVER FOR THIS KIND", REMEMBERED — one `$home/hand-steps/mutes/<monitorId>.json` per monitor kind whose NOTE the owner
 * muted, from the note's More… page or `slopweaver hand mute add <kind>`.
 *
 * A mute silences that kind's floating note and nothing else. The card is still posted, still on the Queue, still in
 * `hand list` and the push banner; only the automatic raises (`./kindAnswerGate.ts`) keep it down. An explicit
 * `hand show` still draws it, because the owner asked. `hand mute remove <kind>` reverses it, and a notice kind is never
 * muted: its note is its only delivery (`./noteAnswers.ts`).
 *
 * Fail closed: a record file that stands is a mute, whether or not it reads, so a torn file never brings back a note
 * the owner asked never to see again. `hand mute list` names it as unreadable so the owner can remove it.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type KindAnswerStoreError, MonitorErrors } from "./errors.js";
import { type KindAnswerRead, kindAnswerStore } from "./kindAnswerFiles.js";
import { isMonitorId } from "./registry.js";
import type { MonitorId } from "./types.js";

/** Where a mute came from: the owner's press on one step's note, or the `hand mute add` verb. */
type MuteOrigin = { readonly kind: "note"; readonly stepId: string } | { readonly kind: "command" };

/** One mute, as the store keeps it. */
export interface NoteMute {
  readonly monitorId: MonitorId;
  /** When the owner gave the answer, ISO 8601. */
  readonly mutedIso: string;
  readonly from: MuteOrigin;
}

const MUTES = kindAnswerStore<NoteMute>({ label: "monitor note mute", name: "mutes", parse: parseNoteMute });

/**
 * The mute store's directory.
 *
 * @param home the state home
 * @returns `$home/hand-steps/mutes`
 */
export function noteMuteDir({ home }: { home: string }): string {
  return MUTES.dir({ home });
}

/**
 * Record one mute, replacing any earlier one of the same kind.
 *
 * @param home the state home
 * @param mute the mute to keep
 * @returns nothing, or why it would not write
 */
export function recordNoteMute({ home, mute }: { home: string; mute: NoteMute }): Result<void, KindAnswerStoreError> {
  return MUTES.record({ home, key: mute.monitorId, value: mute });
}

/**
 * Whether one kind's note is muted. A record that stands is a mute, read or not.
 *
 * @param home the state home
 * @param monitorId the kind
 * @returns true while its record stands
 */
export function kindMuted({ home, monitorId }: { home: string; monitorId: MonitorId }): boolean {
  return MUTES.stands({ home, key: monitorId });
}

/**
 * Remove one kind's mute — `hand mute remove`.
 *
 * @param home the state home
 * @param monitorId the kind
 * @returns whether a mute stood, or why it would not go
 */
export function forgetNoteMute({
  home,
  monitorId,
}: {
  home: string;
  monitorId: MonitorId;
}): Result<boolean, KindAnswerStoreError> {
  return MUTES.forget({ home, key: monitorId });
}

/**
 * Every mute the store holds, and every file that would not read.
 *
 * @param home the state home
 * @returns the mutes, sorted by kind
 */
export function readNoteMutes({ home }: { home: string }): KindAnswerRead<NoteMute> {
  return MUTES.read({ home });
}

/**
 * Check one mute record. A record naming a kind other than its file's is refused, never applied to either.
 *
 * @param object what the record file held
 * @param key the kind its file name says
 * @param path the record file, named in a refusal
 * @returns the mute, or why it would not read
 */
function parseNoteMute({
  object,
  key,
  path,
}: {
  object: Record<string, unknown>;
  key: string;
  path: string;
}): Result<NoteMute, KindAnswerStoreError> {
  const { monitorId, mutedIso, from } = object;
  if (typeof monitorId !== "string" || !isMonitorId(monitorId)) {
    return err(MonitorErrors.kindAnswerStore({ cause: `"${String(monitorId)}" is not a declared monitor`, path }));
  }
  if (monitorId !== key) {
    return err(MonitorErrors.kindAnswerStore({ cause: `the record names ${monitorId}, not its file's ${key}`, path }));
  }
  if (typeof mutedIso !== "string" || Number.isNaN(Date.parse(mutedIso))) {
    return err(MonitorErrors.kindAnswerStore({ cause: "the record's mute instant is not a date", path }));
  }
  const origin = muteOriginOf({ from });
  if (origin === undefined) {
    return err(MonitorErrors.kindAnswerStore({ cause: "the record says nowhere it came from", path }));
  }
  return ok({ from: origin, monitorId, mutedIso });
}

/**
 * A stored origin, checked.
 *
 * @param from the record's `from` field as parsed
 * @returns the origin, or undefined when it is neither shape
 */
function muteOriginOf({ from }: { from: unknown }): MuteOrigin | undefined {
  if (!isRecord(from)) {
    return undefined;
  }
  const { kind, stepId } = from;
  if (kind === "command") {
    return { kind: "command" };
  }
  if (kind === "note" && typeof stepId === "string" && stepId.length > 0) {
    return { kind: "note", stepId };
  }
  return undefined;
}
