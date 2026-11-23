/**
 * Every monitor's condition, as a pure function over an already-read source.
 *
 * Every function here takes a value and returns a {@link MonitorReading}. Nothing reads a file, a socket or a
 * clock — `nowMs` arrives as an argument — so each condition is a unit test rather than an integration one,
 * and a `--now` on the verb replays a past pass exactly.
 *
 * ## The input shapes are NARROW on purpose
 *
 * A `LandingRow` carries thirty-odd fields and a heartbeat is a whole process's self-report. An evaluator
 * taking one whole would make its test a thirty-field fixture, and a fixture that big stops being read. So
 * `./sources.ts` PROJECTS each source onto the two or three fields the condition actually turns on, and the
 * projection is the seam a fake is injected at. The field TYPES are still imported from the real source, so
 * a rename upstream fails the compile here rather than silently reading `undefined`.
 *
 * ## `unmeasurable` is a first-class answer
 *
 * Read `./types.ts` § Three states first. A condition that cannot see its source says so; it never reports
 * `clear`, because "nothing is wrong" and "I could not look" are the two answers a status surface must never
 * conflate.
 */

import { createHash } from "node:crypto";

import { isFableModel } from "../cmux/modelPin.js";
import { type CodexAuthStamp, type CodexSignInRecord, sameCodexAuthStamp } from "../codex/signInRecord.js";
import type { ListenerHeartbeat } from "../live/listen/supervise/heartbeat.js";
import { isHeartbeatStale, SOCKET_DOWN_AFTER_MS, socketStateAgeMs } from "../live/listen/supervise/heartbeat.js";
import { codexLoginCommand } from "../plans/login.js";
import type { LandingAction, LandingQueueState } from "../review/landing.js";
import type { BootModel } from "../sessions/session.js";

import type { MonitorReading, MonitorSubject } from "./types.js";

/** How much of a readable name survives into a step id before the digest takes over. */
const KEY_STEM = 20;

/** How many hex characters of the digest disambiguate two stems that collide. */
const KEY_DIGEST = 6;

/**
 * A short, id-safe, stable key for one subject: a readable stem plus a digest of the WHOLE name.
 *
 * Neither half alone works. A truncated slug is readable and collides — this repository's own run slugs share
 * long prefixes by construction, because they are sentences. A bare digest never collides and is unsayable,
 * and the owner types this back at `hand done`. So the stem is what they read and the digest is what makes it
 * unique, and the digest is taken over the full name so two subjects sharing a stem never share a key.
 *
 * @param name the subject's full, reader-facing name
 * @param digestLength hex characters of digest kept, six unless the caller's names collide more readily
 * @returns the key, lowercase and hyphen-separated
 */
export function subjectKey({ digestLength = KEY_DIGEST, name }: { digestLength?: number; name: string }): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, KEY_STEM)
    .replace(/-+$/, "");
  const digest = createHash("sha256").update(name).digest("hex").slice(0, digestLength);
  if (stem.length === 0) {
    return digest;
  }
  return `${stem}-${digest}`;
}

/** One registered Codex store, projected onto what `codex-plan-signed-out` turns on. */
export interface CodexStoreInput {
  readonly alias: string;
  /** The address the register caches for the plan — what the owner signs in with, so what the card names. */
  readonly email: string | undefined;
  readonly codexHome: string;
  /** The owner's own pause reason, when the row is paused — a paused store still costs the owner a plan. */
  readonly pausedReason: string | undefined;
  readonly storeExists: boolean;
  /**
   * What `auth.json` holds, by SHAPE only (`../codex/auth.ts`): no file, a file that does not parse, one that
   * parses with no tokens and no API key, or one carrying a sign-in.
   */
  readonly authFile: "absent" | "unreadable" | "no-sign-in" | "signed-in";
  /** Which version of `auth.json` is on disk now, compared with the one the live read refused. */
  readonly authStamp: CodexAuthStamp;
  /** What the fleet's live read last filed about the store (`../codex/signInRecord.ts`), when it filed anything. */
  readonly record: CodexSignInRecord | undefined;
  /** Why the filed record could not be read, when it could not — the store is then unmeasurable, never clear. */
  readonly recordUnreadable: string | undefined;
}

/**
 * What is wrong with one store, in words for the card, or undefined when it is usable.
 *
 * The local checks run first, most certain first. A live-read refusal counts only while `auth.json` is still
 * the VERSION that read judged (`../codex/signInRecord.ts` § Why the record carries the auth file's STAMP): a
 * sign-in the owner makes afterwards changes the file, so the card clears on it, and the next live read either confirms
 * it or files a fresh refusal — which re-posts the card. A record filed against a different directory is
 * ignored, so an alias re-pointed at a new store never inherits the old one's failure.
 *
 * @param store the projected store
 * @returns the failure, or undefined
 */
function codexStoreFailure({ store }: { store: CodexStoreInput }): string | undefined {
  if (!store.storeExists) {
    return "its store directory does not exist";
  }
  if (store.authFile === "absent") {
    return "no auth.json is in its store";
  }
  if (store.authFile === "unreadable") {
    return "its auth.json does not parse";
  }
  if (store.authFile === "no-sign-in") {
    return "its auth.json carries no sign-in";
  }
  const { record } = store;
  if (record?.failingSinceIso === undefined || record.codexHome !== store.codexHome) {
    return undefined;
  }
  if (!sameCodexAuthStamp({ left: record.authStamp, right: store.authStamp })) {
    return undefined;
  }
  return `the live read has refused its sign-in since ${record.failingSinceIso}`;
}

/**
 * `codex-plan-signed-out` — a registered Codex plan nothing usable is signed into.
 *
 * Falling back to a signed-in plan is right, and the owner still wants a very high priority, top-of-queue card
 * saying the plan could not be signed into and which commands to run: every paid plan must be accessible locally,
 * or routing cannot span all of them.
 *
 * ONE SUBJECT PER STORE: each is its own sign-in command, so each is a separate act of the owner's, the criterion
 * `perSubject` names. A paused store is included — the pause is how routing kept working, and the plan is still
 * paid for. A store whose record cannot be read, and that no other check condemns, makes the reading
 * unmeasurable rather than clear.
 *
 * @param stores every registered Codex store, projected
 * @returns firing over the unusable stores, unmeasurable, or clear
 */
export function evaluateCodexPlanSignedOut({ stores }: { stores: readonly CodexStoreInput[] }): MonitorReading {
  const subjects: MonitorSubject[] = [];
  const unreadable: string[] = [];
  for (const store of stores) {
    const failure = codexStoreFailure({ store });
    if (failure !== undefined) {
      const paused = store.pausedReason === undefined ? "" : `; paused meanwhile: ${store.pausedReason}`;
      subjects.push({
        email: store.email,
        id: store.alias,
        key: store.alias,
        label: `${failure}${paused}`,
        literal: codexLoginCommand({ codexHome: store.codexHome }),
      });
    } else if (store.recordUnreadable !== undefined) {
      unreadable.push(`${store.alias}: ${store.recordUnreadable}`);
    }
  }
  const blindSpot = unreadable.length === 0 ? undefined : `sign-in record unreadable — ${unreadable.join("; ")}`;
  if (subjects.length > 0) {
    return { blindSpot, monitorId: "codex-plan-signed-out", state: "firing", subjects };
  }
  if (blindSpot !== undefined) {
    return { because: blindSpot, monitorId: "codex-plan-signed-out", state: "unmeasurable" };
  }
  return { monitorId: "codex-plan-signed-out", state: "clear" };
}

/**
 * The landing verdict this monitor fires on, and the one line of reasoning behind the choice.
 *
 * `blocked-on` is GitHub still holding a code-owner requirement open. That is the ONLY landing verdict whose
 * remaining step is the owner's: rule 1 says `--admin` REFUSES a review-gated base, and rule 10 says a session that
 * can clear a thing clears it — so red CI, CodeRabbit changes, a conflict, a restack and the press itself are
 * all the fleet's, carded by nobody. Firing on every green-and-unqueued row instead would put the fleet's own
 * backlog on the owner's screen, which is the flood this lane exists to end rather than a monitor.
 */
const OWNER_LANDING_ACTION: LandingAction = "blocked-on";

/**
 * The queue state that means nobody has pressed it.
 *
 * Both constants are ANNOTATED with the upstream type rather than inferred, which is the whole compile-time
 * link between this condition and `../review/landing.ts`. A verdict renamed there fails the build here,
 * while the projected row's own field stays a plain string — so a document written by an older `github
 * landing` is data this module validates, never a type it has to trust.
 */
const NOT_QUEUED: LandingQueueState["kind"] = "not-queued";

/** The two or three fields `prs-backed-up` turns on, projected off a `LandingRow`. */
export interface LandingSubjectInput {
  readonly repoSlug: string;
  readonly number: number;
  readonly title: string;
  /** The row's `action` verdict, as the document spells it. Compared against {@link OWNER_LANDING_ACTION}. */
  readonly action: string;
  /** The row's `queue.kind`, as the document spells it. Compared against {@link NOT_QUEUED}. */
  readonly queueKind: string;
  /** Who GitHub says is holding it, `@`-prefixed. Empty when the requirement names nobody yet. */
  readonly blockedOn: readonly string[];
  /**
   * Whether the row's CI is red, advisory-only included (`./sources.ts`). A `blocked-on` row can carry an
   * advisory-only red, because that red holds no landing (`../review/landingTests.ts`) and the row reads its
   * real hold, most often the code owner — but this monitor keeps it off the owner's screen. MEASURED on one reading: nine rows of that shape, which would otherwise have arrived as nine cards at once.
   */
  readonly ciRed: boolean;
}

/**
 * `prs-backed-up` — a pull request that passes every test the fleet can pass and is waiting on a code owner.
 *
 * @param rows every open pull request the landing read produced, projected
 * @returns firing over the rows waiting on the owner, or clear
 */
export function evaluatePrsBackedUp({ rows }: { rows: readonly LandingSubjectInput[] }): MonitorReading {
  const waiting = rows.filter(
    (row) => row.action === OWNER_LANDING_ACTION && row.queueKind === NOT_QUEUED && !row.ciRed,
  );
  if (waiting.length === 0) {
    return { monitorId: "prs-backed-up", state: "clear" };
  }
  return {
    monitorId: "prs-backed-up",
    state: "firing",
    subjects: waiting.map((row): MonitorSubject => {
      const name = `${row.repoSlug}#${String(row.number)}`;
      return { id: name, key: subjectKey({ name }), label: row.title };
    }),
  };
}

/**
 * `bot-off-the-air` — the Slack listener's socket is down, or its heartbeat stopped.
 *
 * Both halves matter and they fail differently. A socket reported down is the listener TELLING you it is
 * disconnected, and `SOCKET_DOWN_AFTER_MS` is already measured as the tolerance that clears a normal
 * reconnect backoff — reusing it rather than inventing a second number is deliberate. A STALE beat is the
 * listener not telling you anything, which the beat's own writer can never report about itself.
 *
 * An absent beat is UNMEASURABLE rather than firing: an install that has never armed a listener is not one
 * whose listener fell over, and a card telling the owner to seat a session they never asked for is noise.
 *
 * @param heartbeat the newest beat, or `undefined` when none was ever written
 * @param nowMs the instant to judge at, epoch milliseconds
 * @returns firing with the reason in the subject label, clear, or unmeasurable
 */
export function evaluateBotOffTheAir({
  heartbeat,
  nowMs,
}: {
  heartbeat: ListenerHeartbeat | undefined;
  nowMs: number;
}): MonitorReading {
  if (heartbeat === undefined) {
    return {
      because: "no listener heartbeat has ever been written on this install",
      monitorId: "bot-off-the-air",
      state: "unmeasurable",
    };
  }
  if (isHeartbeatStale({ heartbeat, nowMs })) {
    return {
      monitorId: "bot-off-the-air",
      state: "firing",
      subjects: [
        {
          id: "listener-stale",
          key: "stale",
          label: `the listener stopped beating at ${heartbeat.writtenAtIso}`,
        },
      ],
    };
  }
  if (heartbeat.socketState === "connected") {
    return { monitorId: "bot-off-the-air", state: "clear" };
  }
  if (socketStateAgeMs({ heartbeat, nowMs }) <= SOCKET_DOWN_AFTER_MS) {
    // A reconnect in progress, not a fault: `heartbeat.ts` § SOCKET_DOWN_AFTER_MS measured the backoff.
    return { monitorId: "bot-off-the-air", state: "clear" };
  }
  return {
    monitorId: "bot-off-the-air",
    state: "firing",
    subjects: [
      {
        id: "listener-socket",
        key: "socket",
        label: `the Slack socket has been ${heartbeat.socketState} since ${heartbeat.socketStateSinceIso}`,
      },
    ],
  };
}

/** The pinned chair, and what the ledger recorded about how it booted. */
export interface ChairInput {
  /** The pinned workspace's addressable ref, or `undefined` when nothing is pinned. */
  readonly workspaceRef: string | undefined;
  /** What the session ledger recorded, or `undefined` when no row named this workspace. */
  readonly bootModel: BootModel | undefined;
}

/**
 * `chair-off-fable` — the one chat the owner talks to is not on the model rule 5 names for it.
 *
 * Nothing pinned FIRES, because rule 5's supervisor chat is the fleet's whole intake and its absence is the
 * one condition here that makes every other monitor pointless — a card nobody can relay is a card nobody
 * reads. An `inherited` boot is UNMEASURABLE, quoting the ledger's own reasoning: the launching user's saved
 * default drifts, so `inherited` names no tier and guessing one would report a chair off Fable that is on it.
 *
 * @param chair the pin and the ledger's record of it
 * @returns firing, clear, or unmeasurable
 */
export function evaluateChairOffFable({ chair }: { chair: ChairInput }): MonitorReading {
  const { workspaceRef, bootModel } = chair;
  if (workspaceRef === undefined) {
    return {
      monitorId: "chair-off-fable",
      state: "firing",
      subjects: [{ id: "chair-unpinned", key: "unpinned", label: "no workspace holds the supervisor pin" }],
    };
  }
  if (bootModel === undefined) {
    return {
      because: `the session ledger has no spawned row for ${workspaceRef}, so nothing recorded how it booted`,
      monitorId: "chair-off-fable",
      state: "unmeasurable",
    };
  }
  if (bootModel.kind === "inherited") {
    return {
      because: `${workspaceRef} booted with no --model, and the saved default it inherited names no tier`,
      monitorId: "chair-off-fable",
      state: "unmeasurable",
    };
  }
  if (isFableModel({ model: bootModel.model })) {
    return { monitorId: "chair-off-fable", state: "clear" };
  }
  return {
    monitorId: "chair-off-fable",
    state: "firing",
    subjects: [{ id: "chair-model", key: "model", label: `${workspaceRef} booted on ${bootModel.model}, not Fable` }],
  };
}
