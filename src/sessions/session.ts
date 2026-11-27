/**
 * The session LEDGER a supervisor chat keeps of the chats it knows about — pure: the event shapes, their
 * JSONL encoding, and the fold that turns a log into each session's current state; `sessionEventDecode.ts` reads
 * one line's fields back. `sessionStore.ts` is the effectful edge over it. Same shape as `../admit/queue.ts`, which this was built from.
 *
 * ## Keyed by session KEY, not by any Claude Code session id
 *
 * There is no reliable way to learn, at spawn time, which Claude Code session identity (the one
 * `SendMessage`/`ListAgents` address) a freshly booted chat will register as — that is assigned by the
 * harness once the chat boots, not by the process that asked cmux to open the tab. Guessing it would be
 * exactly the fuzzy identity-matching this repository refuses elsewhere. So a session here is keyed by
 * whatever string the caller already knows for certain: the handover SLUG for one spawned via `cmux spawn`
 * (one doc, one spawn, one key), the DISPATCH COORDINATES for an ask worker or an answer reviewer opened by
 * `turn dispatch`/`turn review` (`cmux/planNames.ts`'s `dispatchSessionName` — one ask and one role, one key, and
 * the same string `claude --name` registered that session under, so a ledger row and a `ListAgents` row name
 * the same session), or a free-form key the supervisor itself chooses when registering a chat it
 * did not spawn — its own `ListAgents` display name is the natural choice, but this module does not assume
 * that; it is just a string.
 *
 * ## Three events, not a rewrite
 *
 * `spawned` opens an entry with what `cmux spawn` knows for certain (workspace/surface refs, worktree,
 * branch, and which model the boot line pinned). `noted` is the supervisor recording something it learned — a
 * status line, a decision, why it routed here — and is also how a chat NOT spawned via cmux gets registered in
 * the first place: its first `noted` event creates the entry. `closed` marks it done. Append-only for the same
 * reason the queue and the run journal are: a rewrite that crashed mid-write could lose an earlier note, and
 * appending cannot.
 *
 * ## Why the model is a tagged union rather than an optional string
 *
 * Measured: every one of the ledger's 297 `spawned` rows recorded NO model at all, so "which tier
 * was this session actually booted onto" was unanswerable across the whole fleet — and the question matters,
 * because `cmux spawn --model` is the only lever that right-sizes a dispatched session — see
 * `skills/supervisor/SKILL.md` § 0 — and docs asking for a cheaper tier were being spawned tierless all week.
 *
 * A bare optional `model` field would not have fixed it. Absent would then mean BOTH "this spawn pinned
 * nothing" and "this row predates the field", and those are different facts a supervisor acts on differently.
 * So {@link BootModel} is explicit: `pinned` carries the exact `--model` value, `inherited` states that the
 * spawn deliberately left the launching user's saved default in place, and an ABSENT {@link SessionItem.bootModel}
 * means only what it says — nothing recorded it, because the row is older than this field. Nothing here ever
 * infers the tier an `inherited` spawn actually got: the saved default drifts, and the honest answer lives in
 * that session's own transcript.
 */
import { pushInto } from "#lib/collections.js";
import type { SessionPlanChoice } from "./planChoice.js";
import { sessionEventOf } from "./sessionEventDecode.js";
import { rowSessionId } from "./sessionRow.js";

/**
 * Which model a spawn's boot line pinned — see this module's header for why this is a union and not an
 * optional string.
 */
export type BootModel =
  /** The boot line carried `--model <model>`, so the tier is known exactly. */
  | { readonly kind: "pinned"; readonly model: string }
  /** The boot line carried no `--model`, leaving the launching user's saved default — which drifts, and which
   * the spawner therefore cannot name. */
  | { readonly kind: "inherited" };

/**
 * The ledger's tagged boot model for one plan's `--model` — `inherited` when the spawn pinned nothing, which
 * is a fact worth recording rather than an absence. See this module's header.
 *
 * Shared by every spawner that writes a `spawned` row (`cmux spawn`, and `live/turn/sessionLedger.ts` for a
 * dispatched worker or reviewer), so the two can never disagree about what an omitted `--model` means.
 *
 * @param model the `--model` value the spawn was given, or `undefined` when it was omitted
 * @returns the boot model to record
 */
export function bootModelForSpawn({ model }: { model: string | undefined }): BootModel {
  return model === undefined ? { kind: "inherited" } : { kind: "pinned", model };
}

/**
 * Which session-harness act opened a row (`../sessionHarness/recordingHarness.ts`): `open` for a run's first seat,
 * `resume` for a seat reopened on a run already under way — a wake after a park, or a reseat.
 */
export type SessionOpenedBy = "open" | "resume";

/** One appended event against one session key. */
export type SessionEvent =
  | {
      readonly kind: "spawned";
      /**
       * The session harness's own identifier for this session — the id every later act on it addresses, and so
       * the row's identity, where {@link sessionKey} is only its label (one slug can open many sessions). cmux's
       * workspace UUID today, equal to {@link workspaceId}. Absent on a row no session harness wrote.
       */
      readonly sessionId?: string | undefined;
      /** Which harness act opened it. Absent on a row no session harness wrote. */
      readonly openedBy?: SessionOpenedBy | undefined;
      /** Which session-harness implementation hosts it (`cmux` today). Absent on a row no session harness wrote. */
      readonly harness?: string | undefined;
      readonly sessionKey: string;
      readonly tsIso: string;
      /**
       * The handover slug this spawn was for. Absent for a session that answers to no doc — an ask WORKER or
       * an answer REVIEWER, both of which are keyed by their own dispatch coordinates instead
       * (`cmux/planNames.ts`'s `dispatchSessionName`).
       */
      readonly slug?: string | undefined;
      readonly workspaceRef: string;
      /**
       * The workspace's cmux UUID. A ref is comparable only within one run of cmux — a restart renumbers refs and
       * keeps ids — so this, not the ref, is what binds the row to a live workspace across a restart
       * (`../cli/commands/handover/seatBinding.ts`). Absent on rows written before `cmux spawn` recorded it, and
       * on a dispatched worker's row, whose writer does not.
       */
      readonly workspaceId?: string | undefined;
      readonly surfaceRef: string;
      readonly cwd: string;
      readonly branch: string;
      /** Which model the boot line pinned. Absent only on rows written before this field existed. */
      readonly bootModel?: BootModel | undefined;
      /**
       * Which plan the session started on and every reading routing chose it from (`./planChoice.ts`). Absent on a
       * row written before this field existed, and on a launch whose gate concluded no plan it could name.
       */
      readonly planChoice?: SessionPlanChoice | undefined;
    }
  | { readonly kind: "noted"; readonly sessionKey: string; readonly tsIso: string; readonly note: string }
  /**
   * A session harness reopened the session a `spawned` row recorded, under that row's own id and on its own vendor
   * transcript, rather than opening a new one: the row stays the one row for it, still open, opened by `resume`.
   */
  | { readonly kind: "resumed"; readonly sessionKey: string; readonly tsIso: string; readonly sessionId: string }
  | {
      readonly kind: "closed";
      readonly sessionKey: string;
      readonly tsIso: string;
      /**
       * The harness session this close targets — matched before {@link workspaceRef}, because an id names one
       * session for its whole life while a ref is reissued by a cmux restart. Absent on a close no session harness
       * wrote.
       */
      readonly sessionId?: string | undefined;
      /**
       * The workspace this close targets. Present whenever the closer already knows it (`cmux close` resolves
       * the workspace before it ever appends the event), so the fold can close exactly the one row a duplicate
       * spawn's sibling left open rather than every row sharing the key. Absent only on a `closed` event
       * written before this field existed, or one whose closer never had a workspace to name — the fold keeps
       * the pre-existing whole-key behaviour for those, since there is nothing narrower to target.
       */
      readonly workspaceRef?: string | undefined;
      /**
       * The targeted row's own `spawnedIso`, narrowing the close past `workspaceRef`. A recorded ref is unique
       * only within one run of cmux: a restart re-issues refs, so two open rows under one key can carry the same
       * one, and a closer that already holds the exact row (`cmux takeover`'s gate (c)) names it here so its
       * close cannot reach the sibling. Absent on every closer that knows only a ref, which keeps ref matching.
       */
      readonly spawnedIso?: string | undefined;
    };

type SessionStatus = "open" | "closed";

/** One session key, folded to its current state. */
export interface SessionItem {
  readonly sessionKey: string;
  readonly status: SessionStatus;
  /** Present when this session was opened by `cmux spawn` for a handover doc. */
  readonly slug?: string | undefined;
  readonly workspaceRef?: string | undefined;
  /** The workspace's cmux UUID, when its `spawned` event recorded one — see that event's field. */
  readonly workspaceId?: string | undefined;
  /** The session harness's id for it, when a session harness opened it — see the `spawned` event's field. */
  readonly sessionId?: string | undefined;
  /** Which harness act opened it, when a session harness did. */
  readonly openedBy?: SessionOpenedBy | undefined;
  /** Which session-harness implementation hosts it, when a session harness opened it. */
  readonly harness?: string | undefined;
  readonly surfaceRef?: string | undefined;
  readonly cwd?: string | undefined;
  readonly branch?: string | undefined;
  /** When it was spawned. Absent for a session registered by a bare `noted` event. */
  readonly spawnedIso?: string | undefined;
  /**
   * Which model the boot line pinned. Absent means NOTHING RECORDED IT — a bare `noted` registration, or a
   * `spawned` row written before this field existed — never "no model was pinned", which is `inherited`.
   */
  readonly bootModel?: BootModel | undefined;
  /** Which plan the session started on, and why, when its `spawned` row recorded it — see that event's field. */
  readonly planChoice?: SessionPlanChoice | undefined;
  /** The most recent `noted` text. Absent until something has been recorded. */
  readonly latestNote?: string | undefined;
  /** The timestamp of whichever event last touched this session. */
  readonly lastEventIso: string;
}

/**
 * The name a reader knows a session by: its handover slug, or its session key for a session no handover doc
 * opened — an ask worker, an answer reviewer, or a chat registered by a bare `noted` event, for which a missing
 * slug is ordinary rather than malformed.
 *
 * @param session the folded session
 * @returns the slug, or the session key for a session with no slug
 */
export function sessionName({ session }: { session: SessionItem }): string {
  if (session.slug == null) {
    // No handover doc opened this session, so its key is the only name it has.
    return session.sessionKey;
  }
  return session.slug;
}

/**
 * Encode one event as a JSONL line.
 *
 * @param event the event to encode
 * @returns the JSON line (no trailing newline)
 */
export function sessionEventLine({ event }: { event: SessionEvent }): string {
  return JSON.stringify({ schemaVersion: 1, ...event });
}

/**
 * Parse the session log's text into events, in file order.
 *
 * Tolerant of a blank or malformed line — one corrupt line must not make the whole ledger unreadable — but
 * reports which lines it could not read rather than discarding them silently.
 *
 * @param text the raw log contents
 * @returns the parsed events and the 1-indexed line numbers that could not be read
 */
export function parseSessionLog({ text }: { text: string }): {
  readonly events: readonly SessionEvent[];
  readonly unreadable: readonly number[];
} {
  const events: SessionEvent[] = [];
  const unreadable: number[] = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      unreadable.push(index + 1);
      return;
    }
    const event = sessionEventOf({ parsed });
    if (event === undefined) {
      unreadable.push(index + 1);
      return;
    }
    events.push(event);
  });
  return { events, unreadable };
}

/** The fold's working state: every row built so far, and which row indexes belong to each session key. */
interface RowLedger {
  readonly rows: SessionItem[];
  readonly rowIndexesByKey: Map<string, number[]>;
}

/** Append a new row for a session key, recording its index against that key. */
function pushRow({ ledger, sessionKey, item }: { ledger: RowLedger; sessionKey: string; item: SessionItem }): void {
  ledger.rows.push(item);
  pushInto({ buckets: ledger.rowIndexesByKey, key: sessionKey, value: ledger.rows.length - 1 });
}

/** A `spawned` event always opens a NEW row — that is what turns a duplicate spawn into two rows, not one. */
function applySpawned({ ledger, event }: { ledger: RowLedger; event: SessionEvent & { kind: "spawned" } }): void {
  pushRow({
    item: {
      ...(event.bootModel === undefined ? {} : { bootModel: event.bootModel }),
      branch: event.branch,
      cwd: event.cwd,
      lastEventIso: event.tsIso,
      sessionKey: event.sessionKey,
      slug: event.slug,
      spawnedIso: event.tsIso,
      status: "open",
      surfaceRef: event.surfaceRef,
      workspaceRef: event.workspaceRef,
      ...(event.workspaceId === undefined ? {} : { workspaceId: event.workspaceId }),
      ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
      ...(event.openedBy === undefined ? {} : { openedBy: event.openedBy }),
      ...(event.harness === undefined ? {} : { harness: event.harness }),
      ...(event.planChoice === undefined ? {} : { planChoice: event.planChoice }),
    },
    ledger,
    sessionKey: event.sessionKey,
  });
}

/**
 * The rows under one key a `closed` event targets before any `spawnedIso` narrowing: by session id when it names
 * one that a row carries; else, for an event naming an id, by `workspaceRef` among rows that recorded NO id — a row
 * recording a different id is a different session, however a restart renumbered its ref; else by `workspaceRef`;
 * else every row still open. The same precedence `./sessionRow.ts`'s `openRowForSession` reads.
 */
function closedTargets({
  ledger,
  event,
  indexes,
}: {
  ledger: RowLedger;
  event: SessionEvent & { kind: "closed" };
  indexes: readonly number[];
}): readonly number[] {
  if (event.sessionId !== undefined) {
    const byId = indexes.filter((rowIndex) => rowSessionId({ row: ledger.rows[rowIndex]! }) === event.sessionId);
    if (byId.length > 0) {
      return byId;
    }
    return indexes.filter((rowIndex) => {
      const row = ledger.rows[rowIndex]!;
      return rowSessionId({ row }) === undefined && row.workspaceRef === event.workspaceRef;
    });
  }
  if (event.workspaceRef === undefined) {
    return indexes.filter((rowIndex) => ledger.rows[rowIndex]!.status === "open");
  }
  return indexes.filter((rowIndex) => ledger.rows[rowIndex]!.workspaceRef === event.workspaceRef);
}

/**
 * A `noted` event carries no `workspaceRef` of its own, so it always lands on the most recently spawned row for
 * its key (open or not) — the same single row a ledger with no duplicate rows would have updated. A key never
 * seen before registers a brand-new open row, exactly as a bare `noted` always has.
 */
function applyNoted({ ledger, event }: { ledger: RowLedger; event: SessionEvent & { kind: "noted" } }): void {
  const indexes = ledger.rowIndexesByKey.get(event.sessionKey);
  if (indexes === undefined) {
    pushRow({
      item: { lastEventIso: event.tsIso, latestNote: event.note, sessionKey: event.sessionKey, status: "open" },
      ledger,
      sessionKey: event.sessionKey,
    });
    return;
  }
  const rowIndex = indexes[indexes.length - 1]!;
  ledger.rows[rowIndex] = { ...ledger.rows[rowIndex]!, lastEventIso: event.tsIso, latestNote: event.note };
}

/**
 * A `resumed` event moves ONE row: the most recently spawned row under its key carrying its session id, marked open
 * and opened by `resume`. Two `spawned` lines can share an id (a duplicate spawn), and reopening both would make one
 * resume read as two live sessions. One naming a session no row under its key carries changes nothing: a fresh row
 * would carry that id with none of a spawn's refs, so a later `closed` naming the id would close the phantom by id
 * and strand a legacy row that recorded no id, still open, where the `workspaceRef` fallback would otherwise have
 * reached it.
 */
function applyResumed({ ledger, event }: { ledger: RowLedger; event: SessionEvent & { kind: "resumed" } }): void {
  const indexes = ledger.rowIndexesByKey.get(event.sessionKey);
  if (indexes === undefined) {
    return;
  }
  const rowIndex = indexes.findLast((index) => rowSessionId({ row: ledger.rows[index]! }) === event.sessionId);
  if (rowIndex === undefined) {
    return;
  }
  ledger.rows[rowIndex] = { ...ledger.rows[rowIndex]!, lastEventIso: event.tsIso, openedBy: "resume", status: "open" };
}

/**
 * A `closed` event naming a workspace closes only the row it identifies. One naming none — written before this
 * field existed, or whose closer had no workspace to name — keeps the pre-existing whole-key behaviour and
 * closes every row still open under this key. A key never seen before still registers a closed row, exactly as
 * a bare `closed` always has. One also naming a `spawnedIso` closes only the row spawned at that instant, so a
 * ref cmux re-issued after a restart cannot carry the close to a sibling row recorded under the same ref.
 */
function applyClosed({ ledger, event }: { ledger: RowLedger; event: SessionEvent & { kind: "closed" } }): void {
  const indexes = ledger.rowIndexesByKey.get(event.sessionKey);
  if (indexes === undefined) {
    pushRow({
      item: { lastEventIso: event.tsIso, sessionKey: event.sessionKey, status: "closed" },
      ledger,
      sessionKey: event.sessionKey,
    });
    return;
  }
  const refTargets = closedTargets({ event, indexes, ledger });
  const targets =
    event.spawnedIso === undefined
      ? refTargets
      : refTargets.filter((rowIndex) => ledger.rows[rowIndex]!.spawnedIso === event.spawnedIso);
  targets.forEach((rowIndex) => {
    ledger.rows[rowIndex] = { ...ledger.rows[rowIndex]!, lastEventIso: event.tsIso, status: "closed" };
  });
}

/**
 * Fold events into one item per session ROW, most recently opened row first.
 *
 * A row, not a key: two `spawned` events sharing one `sessionKey` — a duplicate spawn against the same
 * handover slug is the real-world case — now fold to two rows rather than the second silently overwriting the
 * first (see {@link applySpawned}). `closed` targets a row by its `workspaceRef` when the event carries one, so
 * a duplicate spawn's own close cannot collapse its sibling's still-open row (measured: exactly
 * that collapse read a live loop session as closed while it kept running — see {@link applyClosed}).
 *
 * A `noted` or `closed` event for a key never before `spawned` still produces a row — that is how a session the
 * supervisor did not spawn gets registered — rather than being ignored the way the queue ignores a resolution
 * with nothing to resolve.
 *
 * @param events the parsed events, in file order
 * @returns one item per session row, most recently opened first
 */
export function foldSessions({ events }: { events: readonly SessionEvent[] }): readonly SessionItem[] {
  const ledger: RowLedger = { rowIndexesByKey: new Map(), rows: [] };
  for (const event of events) {
    if (event.kind === "spawned") {
      applySpawned({ event, ledger });
    } else if (event.kind === "noted") {
      applyNoted({ event, ledger });
    } else if (event.kind === "resumed") {
      applyResumed({ event, ledger });
    } else {
      applyClosed({ event, ledger });
    }
  }
  return ledger.rows.toReversed();
}
