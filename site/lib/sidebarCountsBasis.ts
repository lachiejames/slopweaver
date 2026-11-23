/**
 * The judgement every sidebar count sits on: the shapes a count takes, and whether the readings it is made from have
 * read, are on their way, were handed over or failed. Split out of `./sidebarCounts.ts`, which decides each badge.
 */
import { type LiveState, latestReadOf } from "./liveState";
import type { QuotedRead, ReasonWords } from "./quotedReason";
import type { StalenessFact } from "./stalenessLabel";

/**
 * The facts a count the console WITHHOLDS draws on its mark: its own words as they are, and each read reason it quotes
 * kept apart from its lead, so the hover says "This count is not shown: <why>." and a quoted read is still said plainly
 * with its raw folded. A withheld count is never "could not be read" — calling an aged reading "a technical error" reads as broken and is false.
 *
 * @param reason why the count is withheld: the console's own words, or the read reasons it quotes
 * @param next what the console is doing about it, in its own words, said after the last reason's lead
 * @returns one fact per reason, in order
 */
export function withheldCountFactsOf({
  reason,
  next,
}: {
  reason: ReasonWords;
  next: string;
}): readonly StalenessFact[] {
  if (typeof reason === "string") {
    return [{ subject: "this count", why: "", withheld: `${reason}; ${next}` }];
  }
  return reason.map((quoted, at) => {
    let withheld = quoted.lead;
    if (at === reason.length - 1) {
      withheld = `${quoted.lead}; ${next}`;
    }
    return { subject: "this count", why: quoted.why, withheld };
  });
}

/** A count the sidebar prints, and what it means in words derived from the same number. */
export interface SidebarCount {
  readonly count: number;
  readonly title: string;
}

/**
 * Why a count made from several readings prints no number yet: one is on its way, the count's own reason in its own
 * words (`why`), or reads that failed, each quoted apart from the console's words (`failures`) so its raw reason is said
 * plainly rather than wrapped in a sentence `plainReasonOf` cannot read.
 */
export type Unmeasured =
  | { readonly phase: "loading" }
  | { readonly phase: "not-measured"; readonly why: string }
  | { readonly phase: "not-measured"; readonly failures: readonly QuotedRead[] };

/** An {@link Unmeasured} whose reason is ONE sentence: the shape a single stand-in mark draws. Failed reads draw their own mark. */
export type UnmeasuredStandIn = Exclude<Unmeasured, { readonly failures: unknown }>;

/**
 * Why a measured count is not current, and the instant it is true as of: printed, never hidden, and never drawn as a
 * spinner, because the number is real — only older than the page's other readings.
 *
 * Two kinds, because only one of them is a failure. `updating`: nothing failed — the count is off a saved copy, or a
 * reading handed over from the page before, while the current one is on its way; `notes` are the console's own words.
 * `failed`: a read failed, each quoted apart in `failures`, its raw reason byte for byte. A count merely being updated
 * drawn as "It failed with a technical error" reads as broken and is false.
 */
export type StaleCount =
  | { readonly kind: "updating"; readonly observedAtIso: string; readonly notes: readonly string[] }
  | {
      readonly kind: "failed";
      readonly observedAtIso: string;
      readonly notes: readonly string[];
      readonly failures: readonly QuotedRead[];
    };

/** A count over several readings, or why it prints none. A count made from an older reading says so in `stale`. */
export type SidebarReading =
  { readonly phase: "measured"; readonly count: SidebarCount; readonly stale?: StaleCount } | Unmeasured;

/**
 * A number and its noun, singular at one: `1 session`, `3 sessions`, `no session`.
 *
 * @returns the number and its noun as one phrase
 */
export function counted({ count, one, many }: { count: number; one: string; many: string }): string {
  if (count === 0) {
    return `no ${one}`;
  }
  if (count === 1) {
    return `1 ${one}`;
  }
  return `${String(count)} ${many}`;
}

/**
 * One reading's latest read as a sidebar count judges it: {@link latestReadOf}, and a reading handed over on mount
 * (`refreshing`, kept from an earlier page while the read that replaces it is on its way) is still loading, since
 * the number it would print may already be gone. The pages draw such a reading, with its stamp; a count
 * in the sidebar sits nowhere near that stamp.
 *
 * @param state the reading as the page draws it
 * @returns the latest read's phase, and its reason when it failed
 */
export function sidebarReadOf({
  state,
}: {
  state: LiveState<unknown>;
}): { readonly phase: "loading" | "ready" } | { readonly phase: "not-measured"; readonly why: string } {
  if (state.phase === "ready" && state.refreshing === true) {
    return { phase: "loading" };
  }
  return latestReadOf({ state });
}

/**
 * What a sidebar count draws in a number's place when it has none to print: the reading's own failure, the stale mark
 * for a reading drawn over a failed read (with its stamp, so the hover says how old it is), and the spinner for one on
 * its way or not yet placed. A stale reading is never a spinner: that would say a number is coming when the read that
 * would bring it failed.
 *
 * @param state the reading, or the reason a count made of several has no number
 * @returns the stand-in to draw
 */
export function countStandInOf({
  state,
}: {
  state: LiveState<unknown> | UnmeasuredStandIn;
}): UnmeasuredStandIn | { readonly phase: "stale"; readonly why: string; readonly observedAtIso: string } {
  if (state.phase !== "ready") {
    return state;
  }
  if (state.stale !== undefined) {
    return { observedAtIso: state.observedAtIso, phase: "stale", why: state.stale.why };
  }
  return { phase: "loading" };
}

/**
 * The warning a printed sidebar count draws beside its number when a read it is made from FAILED, or none — a current
 * count, and one merely being updated, which draws the quiet mark instead ({@link updatingCountLabelOf}). A count taken
 * off an older reading still prints, and says so where it can be seen: a hover title alone draws the number as current,
 * and the sidebar sits nowhere near the page's own mark.
 *
 * @param reading the count as its badge receives it
 * @param next what the console is doing about it, in its own words, said once after the last failure
 * @returns one fact per failed read, its raw reason kept whole for the fold; empty for anything that did not fail
 */
export function staleCountFactsOf({
  reading,
  next,
}: {
  reading: SidebarReading;
  next: string;
}): readonly StalenessFact[] {
  if (reading.phase !== "measured" || reading.stale?.kind !== "failed") {
    return [];
  }
  const { observedAtIso, failures } = reading.stale;
  return failures.map((failure, at) => {
    const fact = { observedAtIso, subject: failure.subject, why: failure.why };
    if (at === failures.length - 1) {
      return { ...fact, after: next };
    }
    return fact;
  });
}

/**
 * The warning a count with no number draws when the reads it is made from failed: one fact per read, its raw reason
 * kept whole, and what the console is doing about it said once after the last.
 *
 * @param failures each read that failed, quoted apart from the console's words
 * @param next what the console is doing about it, in its own words
 * @returns the facts the mark names
 */
export function failedCountFactsOf({
  failures,
  next,
}: {
  failures: readonly QuotedRead[];
  next: string;
}): readonly StalenessFact[] {
  return failures.map((failure, at) => {
    const fact = { subject: failure.subject, why: failure.why };
    if (at === failures.length - 1) {
      return { ...fact, after: next };
    }
    return fact;
  });
}

/**
 * What the quiet mark beside a count being updated says, on hover and to a screen reader: how old the number is and
 * what the console is doing, never "could not be read", since nothing failed.
 *
 * @param stale the count's mark, of the updating kind
 * @param age how long ago an instant was, in the page's own words
 * @returns the sentence
 */
export function updatingCountLabelOf({
  stale,
  age,
}: {
  stale: Extract<StaleCount, { readonly kind: "updating" }>;
  age: (iso: string) => string;
}): string {
  return `This count is from ${age(stale.observedAtIso)}: ${stale.notes.join("; ")}.`;
}

/**
 * What the readings a count is made from add up to, judged together: every one current; every one with a reading, some
 * of them handed over on mount and being read again (`provisional`); or no number at all — one failed its latest read,
 * or one has no reading yet.
 */
export type CountBasis =
  { readonly phase: "current" } | { readonly phase: "provisional"; readonly stale: StaleCount } | Unmeasured;

/** Several names as one phrase: `a`, `a and b`, `a, b and c`. */
function listed({ names }: { names: readonly string[] }): string {
  if (names.length < 2) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
}

/**
 * The earliest of several stale marks, with every note and every failure: what a count over all of them is true as of,
 * and why. One failure among them makes the whole mark a failure; updates alone never do.
 *
 * @param marks each reading's stale mark
 * @returns the combined mark, or `undefined` when there is none
 */
export function earliestStaleOf({ marks }: { marks: readonly StaleCount[] }): StaleCount | undefined {
  const observedAtIso = earliestIsoOf({ isos: marks.map((mark) => mark.observedAtIso) });
  if (observedAtIso === undefined) {
    return undefined;
  }
  const notes = marks.flatMap((mark) => mark.notes);
  const failures = marks.flatMap((mark) => {
    if (mark.kind === "failed") {
      return mark.failures;
    }
    return [];
  });
  if (failures.length > 0) {
    return { failures, kind: "failed", notes, observedAtIso };
  }
  return { kind: "updating", notes, observedAtIso };
}

/** The earliest of several instants, as written; `undefined` for none. */
function earliestIsoOf({ isos }: { isos: readonly string[] }): string | undefined {
  let earliest: string | undefined;
  for (const iso of isos) {
    if (earliest === undefined || Date.parse(iso) < Date.parse(earliest)) {
      earliest = iso;
    }
  }
  return earliest;
}

/**
 * Judge the readings a count is made from together. A failed latest read names itself, ahead of one with no reading
 * yet. A reading handed over on mount (`refreshing`: kept from the page before while the read replacing it waits its
 * turn for a slot) is a real reading, so it does not hold the count back, but it is never current: it makes the basis
 * `provisional`, stale as of the oldest such reading and naming each. A press drops a handed-over reading back to
 * loading (`../components/live/useLive.ts`), so a reading from before a write never reaches here as provisional.
 *
 * @param inputs every reading the count is made from, each named for the reason its mark or failure gives
 * @returns current, provisional with its mark, or why there is no number
 */
export function countBasisOf({
  inputs,
}: {
  inputs: readonly { readonly subject: string; readonly state: LiveState<unknown> }[];
}): CountBasis {
  let loading = false;
  const failures: QuotedRead[] = [];
  const rereading: { readonly subject: string; readonly observedAtIso: string }[] = [];
  for (const { subject, state } of inputs) {
    // Handed over wins over the failure it may be drawn over, as in `sidebarReadOf`: the read that replaces it is
    // already on its way.
    if (state.phase === "ready" && state.refreshing === true) {
      rereading.push({ observedAtIso: state.observedAtIso, subject });
      continue;
    }
    const latest = latestReadOf({ state });
    if (latest.phase === "not-measured") {
      // Quoted apart, never "<subject> did not read: <raw>": a composed sentence is what `plainReasonOf` cannot read.
      // Every failed read is named, never only the first.
      failures.push({ lead: `${subject} did not read`, subject, why: latest.why });
      continue;
    }
    if (state.phase !== "ready") {
      loading = true;
    }
  }
  if (failures.length > 0) {
    return { failures, phase: "not-measured" };
  }
  if (loading) {
    return { phase: "loading" };
  }
  const oldest = earliestIsoOf({ isos: rereading.map(({ observedAtIso }) => observedAtIso) });
  if (oldest === undefined) {
    return { phase: "current" };
  }
  const names = listed({ names: rereading.map(({ subject }) => subject) });
  const verb = rereading.length === 1 ? "is" : "are";
  return {
    phase: "provisional",
    stale: { kind: "updating", notes: [`${names} ${verb} being read again now`], observedAtIso: oldest },
  };
}

/**
 * Whether a count over several readings may be printed: never while any of them is on its way, provisional or failed
 * its latest read, because a total over the readings that did arrive is a number no reading said.
 *
 * @param inputs every reading the count is made from, each named for the reason a failed one gives
 * @returns `undefined` when every reading is current; otherwise the first failure's reason, or loading
 */
export function unmeasuredOf({
  inputs,
}: {
  inputs: readonly { readonly subject: string; readonly state: LiveState<unknown> }[];
}): Unmeasured | undefined {
  const basis = countBasisOf({ inputs });
  if (basis.phase === "current") {
    return undefined;
  }
  if (basis.phase === "provisional") {
    return { phase: "loading" };
  }
  return basis;
}

/**
 * A reading {@link countBasisOf} has already found to have read; anything else is a defect in the caller.
 *
 * @returns the reading's value
 */
export function currentValueOf<T>({ state }: { state: LiveState<T> }): T {
  if (state.phase !== "ready") {
    throw new Error(`a count read a reading that is ${state.phase}, after every reading was found to have read`);
  }
  return state.value;
}
