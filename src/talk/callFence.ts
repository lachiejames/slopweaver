/**
 * Holding still every record a binding reader turns the owner's words into an approval from — the fence between those
 * records and the register.
 *
 * A line the page already sent can be waiting on a call's append lock as an approval is read, and the stretch or relay
 * it carries can cut the words being approved, or take them back. A landing the transcript is about to write can
 * replace the row the words are read off. So the fence takes the append lock of the call the words were said on — a
 * relay's found the way its later-relay check finds it — and, for a card landing, the landing ledger's lock too, and
 * the approval holds both from its read through its append: whatever that read saw is the whole record until the
 * approval is on the register. The lock has no queue, so a line already waiting on it could lose the race to the fence
 * and land just after the approval; every append therefore announces itself before it waits, and the fence takes the
 * call's lock only once none is waiting (`./callWriteIntent.ts`). A writer announces for its whole
 * run, from the route taking the batch to the verb's last landing (`./writerRunIntent.ts`), and a
 * relay's fence waits for every call's appends before it picks the call. A batch is admitted once the
 * route's handoff is published, and a run whose handoff lapsed writes nothing.
 *
 * Every writer announces on the ledger FIRST and withdraws there last, so every fence's last wait is on the ledger: a
 * run that had published only its ledger intent when the call's wait passed is still seen. And a batch
 * can be announced while the approval reads, after a wait passed, so the fence hands back a `recheck` the approval runs
 * under the held locks after its read and before it records anything: it refuses when any write it covers is waiting
 * What stays outside it is speech the page has not yet sent, a batch the route has taken but not
 * yet announced, and the synchronous stretch between the recheck and the register's append.
 *
 * Lock order is the register's, then the call's, then the ledger's. No writer holding a call or ledger lock takes the
 * register's, and readers take none, so the fence never waits on itself; every wait is bounded by `CALL_LOCK_WAIT_MS`.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { approvalCallId } from "./approvalRelayRead.js";
import { CALL_LOCK_WAIT_MS } from "./callLock.js";
import { callsDir } from "./callStore.js";
import {
  awaitCallsDrained,
  awaitWritesDrained,
  holdDrainedCallLock,
  pendingAnyCallWrites,
  pendingCallWrites,
} from "./callWriteIntent.js";
import { cardLandingsPath, holdCardLandingLock } from "./cardLandingStore.js";
import { type TalkError, TalkErrors } from "./errors.js";
import { parseRelayAnchor } from "./relayDraft.js";
import { processStartOf, type StartOf } from "./relayLease.js";
import { parseCallPointer } from "./unreadWords.js";

/** A `call:<callId>#<segment>` landing anchor's call. */
const LANDING_CALL = /^call:([^#]+)#/u;

/** The scheme a relay turn's anchor carries. */
const RELAY_SCHEME = "talk:";

/** The call an anchor's words are read off, whether a card landing names it, and whether a relay found it. */
type Fenced = { callId: string; landing: boolean; relay: boolean } | undefined;

/** What a fence hands the approval: what lets every lock go, and the check it runs before it records anything. */
export interface CallFence {
  /** Let go of every lock the fence took. */
  readonly release: () => void;
  /** Why the approval must not be recorded — a write it covers was announced while it read — or `undefined`. */
  readonly recheck: () => string | undefined;
}

/** How a refusal names the card landing ledger. */
const LEDGER_SUBJECT = "the card landings";

/** The real `ps`-backed start time of a pid. */
const realStartOf: StartOf = (candidate) => processStartOf({ pid: candidate });

/** A thrown value's message, for the clause a refusal carries. */
function thrownMessage({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The call an anchor's words, and the later relays that could take them back, are read off.
 *
 * @param anchor a `call:` landing anchor, a `talk-call:` stretch pointer or a `talk:` relay turn
 * @param atIso when the words were said, which bounds the calls that can hold a relay
 * @returns the call and how it was named, `undefined` for an anchor on no call, or why no one call holds it
 */
function fencedCall({ anchor, atIso, home }: { anchor: string; atIso: string; home: string }): Result<Fenced, string> {
  const landing = LANDING_CALL.exec(anchor);
  if (landing !== null) {
    return ok({ callId: landing[1]!, landing: true, relay: false });
  }
  const pointer = parseCallPointer({ text: anchor });
  if (pointer !== undefined) {
    return ok({ callId: pointer.slice("talk-call:".length, pointer.indexOf("#")), landing: false, relay: false });
  }
  const relay = parseRelayAnchor({ text: anchor });
  if (relay === undefined) {
    return ok(undefined);
  }
  const turnId = relay.slice(RELAY_SCHEME.length);
  // The relay's call is found by reading every call, so an append waiting on ANY of them could move the relay to
  // another call: every one lands before the call is chosen, and the recheck covers every call again.
  try {
    awaitCallsDrained({ dir: callsDir({ home }), startOf: realStartOf, waitMs: CALL_LOCK_WAIT_MS });
  } catch (cause) {
    return err(thrownMessage({ cause }));
  }
  const callId = approvalCallId({ anchor: { anchor, card: "", kind: "relay", stagedAtIso: atIso, turnId }, home });
  if (callId.isErr()) {
    return err(callId.error.message);
  }
  return ok({ callId: callId.value, landing: false, relay: true });
}

/**
 * The recheck for one fenced call: the call's writes — every call's for a relay — then the ledger's, LAST.
 *
 * @returns the check, reading only intents, never a lock
 */
function recheckOf({
  fenced,
  home,
  startOf,
}: {
  fenced: NonNullable<Fenced>;
  home: string;
  startOf: StartOf;
}): () => string | undefined {
  const dir = callsDir({ home });
  const callPath = join(dir, `${fenced.callId}.jsonl`);
  return () => {
    const calls = fenced.relay
      ? pendingAnyCallWrites({ dir, startOf })
      : pendingCallWrites({ path: callPath, startOf });
    const ledger = pendingCallWrites({ path: cardLandingsPath({ home }), startOf });
    if (calls + ledger === 0) {
      return undefined;
    }
    return `${String(calls + ledger)} transcript or landing write(s) were announced while the approval was read: re-run it`;
  };
}

/**
 * Take the append lock of the call an anchor's words are said on, and the landing ledger's for a card landing, waiting
 * as a writer of either would; for any other anchor, wait last for the ledger's writes too, holding no lock on it.
 *
 * @param anchor the anchor the approval binds
 * @param atIso when its words were said, as the approval's own read gave it
 * @param home the Slopweaver home the call files and the ledger live under
 * @returns what releases every lock taken and the recheck — both no-ops for an anchor on no call — or why a lock could
 *   not be taken
 */
export function fenceCallWrites({
  anchor,
  atIso,
  home,
}: {
  anchor: string;
  atIso: string;
  home: string;
}): Result<CallFence, TalkError> {
  const fenced = fencedCall({ anchor, atIso, home });
  if (fenced.isErr()) {
    return err(TalkErrors.callFenceUnheld({ subject: `the call ${anchor} was said on`, why: fenced.error }));
  }
  if (fenced.value === undefined) {
    return ok({ recheck: () => undefined, release: () => undefined });
  }
  const recheck = recheckOf({ fenced: fenced.value, home, startOf: realStartOf });
  const { callId, landing } = fenced.value;
  let releaseCall: () => void;
  try {
    const path = join(callsDir({ home }), `${callId}.jsonl`);
    releaseCall = holdDrainedCallLock({ path, pid: process.pid, startOf: realStartOf, waitMs: CALL_LOCK_WAIT_MS });
  } catch (cause) {
    return err(TalkErrors.callFenceUnheld({ subject: `the call ${callId}`, why: thrownMessage({ cause }) }));
  }
  if (!landing) {
    try {
      awaitWritesDrained({ path: cardLandingsPath({ home }), startOf: realStartOf, waitMs: CALL_LOCK_WAIT_MS });
    } catch (cause) {
      releaseCall();
      return err(TalkErrors.callFenceUnheld({ subject: LEDGER_SUBJECT, why: thrownMessage({ cause }) }));
    }
    return ok({ recheck, release: releaseCall });
  }
  const ledger = holdCardLandingLock({ home, reader: true });
  if (ledger.isErr()) {
    releaseCall();
    return err(TalkErrors.callFenceUnheld({ subject: LEDGER_SUBJECT, why: ledger.error.message }));
  }
  // Each lock is let go even when letting go of the other throws.
  const release = (): void => {
    try {
      ledger.value();
    } finally {
      releaseCall();
    }
  };
  return ok({ recheck, release });
}
