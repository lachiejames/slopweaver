/**
 * The control plane's chair hand-off as an EPISODE: the journal of one replacement of the pinned chair, folded into
 * the one thing to do next. The transaction (`../cli/commands/supervisor/chairHandOffRun.ts`) appends an event before
 * or after each act and asks {@link nextStep} where it stands, so a run that crashed anywhere continues exactly where
 * it stopped instead of starting a second successor beside the first.
 *
 * The owner's rule is the shape: the watch (`./chairWatch.ts`) decides WHETHER to hand off, the model supplies only
 * WHAT to hand over (its note, `supervisor hand-off note`), and every move carries its reason and an override.
 *
 * ## The order, and what each event proves
 *
 * `started` (reasons, successor plan, basis) → `note-asked` → `note-arrived` | `note-missing` → `row-closed` →
 * `slug-reserved` → `doc-written` → `successor-opening` → `successor-opened` | `failed`.
 *
 * - The first of `note-arrived` and `note-missing` after `note-asked` wins; a later one is inert, so a note racing
 *   the deadline cannot change a doc already decided.
 * - The LAST `slug-reserved` is the slug: a number another writer took first is re-reserved, never overwritten.
 * - `successor-opening` without `successor-opened` means a spawn may have run: the next step RECONCILES against the
 *   ledger before it spawns again.
 * - `failed` carries `resumable`: a spawn that failed leaves the episode open (the predecessor's run is already
 *   closed, so stopping would leave no chair), while a chair that is no longer the one pinned ends it.
 * - `stopped` (a hold, a moved pin before the row closed) records why a run stopped and folds to nothing: the next
 *   run re-checks and continues from the same step.
 *
 * Pure: events in, state and next step out, plus the sentences the transaction prints and sends.
 */
import { withoutAddresses } from "./chairWatch.js";

/** Why the hand-off ran: the watch's own verdict, or the owner's `--now` with its reason. */
export type ChairHandOffBasis = { readonly kind: "auto" } | { readonly kind: "now"; readonly reason: string };

/** The vendor a successor boots on. */
export type ChairHandOffVendor = "claude" | "codex";

/** One event in an episode's journal. */
export type ChairHandOffEvent =
  | {
      readonly kind: "started";
      readonly atIso: string;
      readonly episodeId: string;
      /** The outgoing chair's app session id. */
      readonly predecessor: string;
      /** The outgoing chair's handover slug, the run the control plane closes. */
      readonly predecessorSlug: string;
      readonly reasons: readonly string[];
      readonly alias: string;
      readonly vendor: ChairHandOffVendor;
      readonly basis: ChairHandOffBasis;
      /** The owner's `--plan` override of the watch's successor plan, and the alias the watch had chosen, if any. */
      readonly planOverride?:
        { readonly alias: string; readonly watchAlias?: string | undefined; readonly reason: string } | undefined;
      readonly noteWaitSeconds: number;
    }
  | { readonly kind: "note-asked"; readonly atIso: string; readonly notePath: string; readonly deadlineIso: string }
  | { readonly kind: "note-arrived"; readonly atIso: string; readonly note: string }
  | { readonly kind: "note-missing"; readonly atIso: string; readonly why: string }
  | { readonly kind: "stopped"; readonly atIso: string; readonly why: string }
  | { readonly kind: "row-closed"; readonly atIso: string; readonly slug: string; readonly alreadyClosed: boolean }
  | { readonly kind: "slug-reserved"; readonly atIso: string; readonly slug: string }
  | { readonly kind: "doc-written"; readonly atIso: string; readonly slug: string; readonly path: string }
  | { readonly kind: "successor-opening"; readonly atIso: string; readonly slug: string }
  | { readonly kind: "successor-opened"; readonly atIso: string; readonly slug: string; readonly sessionId: string }
  | { readonly kind: "failed"; readonly atIso: string; readonly why: string; readonly resumable: boolean };

/** The `started` event. */
export type ChairHandOffStarted = Extract<ChairHandOffEvent, { kind: "started" }>;

/** What an episode's journal folds to. */
interface ChairHandOffState {
  readonly started: ChairHandOffStarted | undefined;
  readonly noteAsked: Extract<ChairHandOffEvent, { kind: "note-asked" }> | undefined;
  /** The note's outcome: its text, or why none arrived. */
  readonly note:
    | { readonly kind: "arrived"; readonly text: string }
    | { readonly kind: "missing"; readonly why: string }
    | undefined;
  readonly rowClosed: boolean;
  /** The last slug reserved. */
  readonly slug: string | undefined;
  /** Whether the doc for {@link slug} is written. */
  readonly docWritten: boolean;
  /** Whether a spawn for {@link slug} was started. */
  readonly opening: boolean;
  readonly opened: { readonly slug: string; readonly sessionId: string } | undefined;
  /** Why the episode ended without a successor, when it did. */
  readonly abandoned: string | undefined;
}

/** What the transaction does next. */
export type ChairHandOffStep =
  | { readonly kind: "start" }
  | { readonly kind: "ask-note"; readonly started: ChairHandOffStarted }
  | { readonly kind: "await-note"; readonly started: ChairHandOffStarted; readonly deadlineIso: string }
  | { readonly kind: "close-row"; readonly started: ChairHandOffStarted }
  | { readonly kind: "reserve-slug"; readonly started: ChairHandOffStarted }
  | { readonly kind: "write-doc"; readonly started: ChairHandOffStarted; readonly slug: string }
  | { readonly kind: "open-successor"; readonly started: ChairHandOffStarted; readonly slug: string }
  | { readonly kind: "reconcile"; readonly started: ChairHandOffStarted; readonly slug: string }
  | { readonly kind: "done"; readonly slug: string; readonly sessionId: string }
  | { readonly kind: "abandoned"; readonly why: string };

/**
 * An event with every free-text field passed through {@link withoutAddresses}: the watch's reasons, the owner's
 * `--now` and `--plan` reasons, the outgoing chair's note and every `why`. The journal is the one source the note
 * request and the successor doc are rendered from, so scrubbing what enters it scrubs both; ids, slugs, paths and
 * instants are left as they are, since a spawn and a resume read them back exactly.
 *
 * @param event the event about to be journalled
 * @returns the same event, its free text without addresses
 */
export function episodeEventWithoutAddresses({ event }: { event: ChairHandOffEvent }): ChairHandOffEvent {
  const scrub = (text: string): string => withoutAddresses({ text });
  switch (event.kind) {
    case "started": {
      const { planOverride } = event;
      let basis: ChairHandOffBasis = event.basis;
      if (basis.kind === "now") {
        basis = { kind: "now", reason: scrub(basis.reason) };
      }
      return {
        ...event,
        basis,
        reasons: event.reasons.map(scrub),
        ...(planOverride === undefined
          ? {}
          : { planOverride: { ...planOverride, reason: scrub(planOverride.reason) } }),
      };
    }
    case "note-arrived":
      return { ...event, note: scrub(event.note) };
    case "note-missing":
    case "stopped":
    case "failed":
      return { ...event, why: scrub(event.why) };
    case "note-asked":
    case "row-closed":
    case "slug-reserved":
    case "doc-written":
    case "successor-opening":
    case "successor-opened":
      return event;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/** The prefix every episode id carries. */
const EPISODE_PREFIX = "chair-hand-off:";

/**
 * The episode id for one outgoing chair: one episode per chair, so a second run over the same chair finds it.
 *
 * @param appSessionId the outgoing chair's app session id
 * @returns `chair-hand-off:<id>`
 */
export function episodeIdOf({ appSessionId }: { appSessionId: string }): string {
  return `${EPISODE_PREFIX}${appSessionId}`;
}

/** The state before any event. */
const EMPTY: ChairHandOffState = {
  abandoned: undefined,
  docWritten: false,
  note: undefined,
  noteAsked: undefined,
  opened: undefined,
  opening: false,
  rowClosed: false,
  slug: undefined,
  started: undefined,
};

/** The first `started` begins the episode; a later one is inert. */
function foldStarted({ state, event }: { state: ChairHandOffState; event: ChairHandOffStarted }): ChairHandOffState {
  if (state.started !== undefined) {
    return state;
  }
  return { ...state, started: event };
}

/** `note-asked` counts once, and only after `started`. */
function foldNoteAsked({
  state,
  event,
}: {
  state: ChairHandOffState;
  event: Extract<ChairHandOffEvent, { kind: "note-asked" }>;
}): ChairHandOffState {
  const askable = state.started !== undefined && state.noteAsked === undefined;
  if (!askable) {
    return state;
  }
  return { ...state, noteAsked: event };
}

/** The first note outcome after `note-asked` wins, so a note racing the deadline cannot change it. */
function foldNote({
  state,
  note,
}: {
  state: ChairHandOffState;
  note: NonNullable<ChairHandOffState["note"]>;
}): ChairHandOffState {
  const unsettled = state.noteAsked !== undefined && state.note === undefined;
  if (!unsettled) {
    return state;
  }
  return { ...state, note };
}

/** The row closes only once the note is settled. */
function foldRowClosed({ state }: { state: ChairHandOffState }): ChairHandOffState {
  if (state.note === undefined) {
    return state;
  }
  return { ...state, rowClosed: true };
}

/** A reservation after the row closed replaces the slug, and its doc and spawn start over. */
function foldSlugReserved({ state, slug }: { state: ChairHandOffState; slug: string }): ChairHandOffState {
  if (!state.rowClosed) {
    return state;
  }
  return { ...state, docWritten: false, opening: false, slug };
}

/** A doc counts only for the slug reserved last. */
function foldDocWritten({ state, slug }: { state: ChairHandOffState; slug: string }): ChairHandOffState {
  if (slug !== state.slug) {
    return state;
  }
  return { ...state, docWritten: true };
}

/** A spawn counts only for the slug reserved last, once its doc is written. */
function foldOpening({ state, slug }: { state: ChairHandOffState; slug: string }): ChairHandOffState {
  const openable = slug === state.slug && state.docWritten;
  if (!openable) {
    return state;
  }
  return { ...state, opening: true };
}

/** A resumable failure leaves the episode open; any other ends it. */
function foldFailed({
  state,
  event,
}: {
  state: ChairHandOffState;
  event: Extract<ChairHandOffEvent, { kind: "failed" }>;
}): ChairHandOffState {
  if (event.resumable) {
    return state;
  }
  return { ...state, abandoned: event.why };
}

/** One event folded onto the state; an event out of order is inert. */
function foldOne({ state, event }: { state: ChairHandOffState; event: ChairHandOffEvent }): ChairHandOffState {
  switch (event.kind) {
    case "started":
      return foldStarted({ event, state });
    case "note-asked":
      return foldNoteAsked({ event, state });
    case "note-arrived":
      return foldNote({ note: { kind: "arrived", text: event.note }, state });
    case "note-missing":
      return foldNote({ note: { kind: "missing", why: event.why }, state });
    case "row-closed":
      return foldRowClosed({ state });
    case "slug-reserved":
      return foldSlugReserved({ slug: event.slug, state });
    case "doc-written":
      return foldDocWritten({ slug: event.slug, state });
    case "successor-opening":
      return foldOpening({ slug: event.slug, state });
    case "successor-opened":
      return { ...state, opened: { sessionId: event.sessionId, slug: event.slug } };
    case "failed":
      return foldFailed({ event, state });
    case "stopped":
      return state;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/** Fold an episode's journal, in file order. */
function episodeStateOf({ events }: { events: readonly ChairHandOffEvent[] }): ChairHandOffState {
  let state = EMPTY;
  for (const event of events) {
    state = foldOne({ event, state });
  }
  return state;
}

/**
 * What to do next, from the journal alone — so a resumed run continues exactly where a crash left it.
 *
 * @param events the journal, in file order
 * @returns the next step
 */
export function nextStep({ events }: { events: readonly ChairHandOffEvent[] }): ChairHandOffStep {
  const state = episodeStateOf({ events });
  if (state.opened !== undefined) {
    return { kind: "done", sessionId: state.opened.sessionId, slug: state.opened.slug };
  }
  if (state.abandoned !== undefined) {
    return { kind: "abandoned", why: state.abandoned };
  }
  const { started } = state;
  if (started === undefined) {
    return { kind: "start" };
  }
  if (state.noteAsked === undefined) {
    return { kind: "ask-note", started };
  }
  if (state.note === undefined) {
    return { deadlineIso: state.noteAsked.deadlineIso, kind: "await-note", started };
  }
  if (!state.rowClosed) {
    return { kind: "close-row", started };
  }
  if (state.slug === undefined) {
    return { kind: "reserve-slug", started };
  }
  if (!state.docWritten) {
    return { kind: "write-doc", slug: state.slug, started };
  }
  if (state.opening) {
    return { kind: "reconcile", slug: state.slug, started };
  }
  return { kind: "open-successor", slug: state.slug, started };
}

/**
 * Whether an episode is still open: begun, and neither seated nor abandoned.
 *
 * @param events the journal
 * @returns true while a run has something left to do
 */
export function episodeIsOpen({ events }: { events: readonly ChairHandOffEvent[] }): boolean {
  const step = nextStep({ events }).kind;
  return step !== "start" && step !== "done" && step !== "abandoned";
}

/**
 * Why `supervisor hand-off note` must not record a note now, or undefined when it may: only an episode waiting on
 * its note takes one.
 *
 * @param events the episode's journal
 * @param episodeId the episode the note names
 * @returns the refusal, or undefined
 */
export function noteRefusal({
  events,
  episodeId,
}: {
  events: readonly ChairHandOffEvent[];
  episodeId: string;
}): string | undefined {
  const state = episodeStateOf({ events });
  if (state.started === undefined) {
    return `no chair hand-off ${episodeId} is journalled, so there is nothing to attach a note to`;
  }
  if (state.noteAsked === undefined) {
    return `${episodeId} has not asked for a note yet`;
  }
  if (state.note?.kind === "arrived") {
    return `${episodeId} already has its note; a second one would not reach the successor`;
  }
  if (state.note?.kind === "missing" || state.rowClosed) {
    return `${episodeId} stopped waiting for a note at its deadline and the successor rebuilds from files; this note is too late`;
  }
  return undefined;
}

/**
 * The message the outgoing chair receives once its turn ends: why it is being replaced, the one command that
 * records its note, and that it must neither seat a successor nor finish its run.
 *
 * @param episodeId the id the note command names
 * @param reasons the watch's reasons, already without addresses
 * @param notePath where the chair writes its note
 * @param waitSeconds how long the control plane waits for it
 * @param homeFlag `--home <dir>` when the run named one, so the chair records into the same home
 * @returns the message text
 */
export function noteRequestText({
  episodeId,
  reasons,
  notePath,
  waitSeconds,
  homeFlag,
}: {
  episodeId: string;
  reasons: readonly string[];
  notePath: string;
  waitSeconds: number;
  homeFlag: string;
}): string {
  return [
    `The control plane is handing the supervisor chair off (${episodeId}) because:`,
    ...reasons.map((reason) => `  - ${reason}`),
    "",
    `Write your hand-off note for the successor to ${notePath} — what is in flight, what you were about to do, and ` +
      "anything the board and state files do not already say — then run:",
    `  slopweaver supervisor hand-off note --episode ${episodeId} --file ${notePath}${homeFlag}`,
    "",
    "Do NOT spawn a successor and do NOT finish or close your run: the control plane does both. It waits " +
      `${String(waitSeconds)}s for the note; without one, the successor rebuilds the picture from files.`,
  ].join("\n");
}
