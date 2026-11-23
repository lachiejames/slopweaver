/**
 * How current the Queue's cards are, drawn as one mark beside the filter bar. Pure.
 *
 * A freshness indicator implies that what is on screen is up to date, and says why when it is not; a text stand-in
 * at the top of the Queue reads as broken where a progress indicator does not. So the line is the quiet age when
 * everything is current, a spinner while a read is in flight, and a staleness mark whose hover names every register
 * whose cards are older than its latest read, with the reason and the age of what is drawn — never a sentence.
 */
import type { StalenessFact } from "./stalenessLabel";

/** One register as the line reads it: what the page draws from it, and what its latest read came to. */
export interface RegisterFreshness {
  /** The register in the page's own words. */
  readonly label: string;
  /** What the page draws: a reading (with its age, and whether a read is replacing it), or nothing yet. */
  readonly drawn:
    | { readonly phase: "ready"; readonly observedAtIso: string; readonly refreshing: boolean }
    | { readonly phase: "loading" | "not-measured" };
  /** The latest read, which may have failed where the drawn reading is an earlier one. */
  readonly read: { readonly phase: "loading" | "ready" | "not-measured"; readonly why?: string };
}

/** One register named with the reason its cards are not the latest. */
export interface FreshnessGap {
  readonly label: string;
  readonly why: string;
}

/** A register drawing an earlier reading, with when that reading was true. */
export interface StaleGap extends FreshnessGap {
  readonly observedAtIso: string;
}

/** What the line has to say. */
export interface QueueFreshness {
  /** Registers with nothing drawn yet, still being read. */
  readonly reading: readonly string[];
  /** Registers with nothing drawn and a read that failed. */
  readonly failed: readonly FreshnessGap[];
  /** Registers drawing an earlier reading because the latest read failed. */
  readonly stale: readonly StaleGap[];
  /** Registers drawing a reading handed over from earlier on this page while a read replaces it. */
  readonly rereading: readonly string[];
  /** The oldest instant any drawn reading was taken, or `undefined` when nothing is drawn. */
  readonly oldestIso: string | undefined;
}

/**
 * The reason a read gave, or the words for one that gave none.
 *
 * @returns the reason
 */
function reasonOf({ read }: { read: RegisterFreshness["read"] }): string {
  if (read.why === undefined) {
    return "its latest read did not answer";
  }
  return read.why;
}

/**
 * Sort the registers into what the freshness line says about each.
 *
 * @param registers every register the page draws from
 * @returns the line's facts
 */
export function queueFreshness({ registers }: { registers: readonly RegisterFreshness[] }): QueueFreshness {
  const reading: string[] = [];
  const failed: FreshnessGap[] = [];
  const stale: StaleGap[] = [];
  const rereading: string[] = [];
  let oldestIso: string | undefined;
  for (const register of registers) {
    const { drawn, label, read } = register;
    if (drawn.phase !== "ready") {
      if (drawn.phase === "loading") {
        reading.push(label);
      } else {
        failed.push({ label, why: reasonOf({ read }) });
      }
      continue;
    }
    if (oldestIso === undefined || Date.parse(drawn.observedAtIso) < Date.parse(oldestIso)) {
      oldestIso = drawn.observedAtIso;
    }
    if (read.phase === "not-measured") {
      stale.push({ label, observedAtIso: drawn.observedAtIso, why: reasonOf({ read }) });
    } else if (drawn.refreshing) {
      rereading.push(label);
    }
  }
  return { failed, oldestIso, reading, rereading, stale };
}

/**
 * A register held to its own route timeout for a FIRST answer on this page. A first read has no way to fail on the page
 * until it answers, so past the bound the register is named unread rather than left in flight: one with nothing drawn
 * reads as failed, one drawing a reading handed over from earlier reads as stale. It is never read as answered, so an
 * empty list it holds up still draws no measured zero. One that answered is untouched, as is one inside its bound.
 *
 * @param register the register as the page reads it
 * @param waitedMs how long this page has waited since it opened
 * @param boundMs the register's route timeout, the longest its read can take to answer
 * @returns the register, named unread when its first answer is overdue
 */
export function boundedFirstRead({
  register,
  waitedMs,
  boundMs,
}: {
  register: RegisterFreshness;
  waitedMs: number;
  boundMs: number;
}): RegisterFreshness {
  if (waitedMs < boundMs) {
    return register;
  }
  const why = `its first read had not answered ${String(Math.round(boundMs / 1000))}s after the page opened`;
  const { drawn, label } = register;
  if (drawn.phase === "loading") {
    return { drawn: { phase: "not-measured" }, label, read: { phase: "not-measured", why } };
  }
  if (drawn.phase === "ready" && drawn.refreshing) {
    return { drawn: { ...drawn, refreshing: false }, label, read: { phase: "not-measured", why } };
  }
  return register;
}

/**
 * Every failed and stale register as a staleness fact, failed first.
 *
 * @param freshness the facts ({@link queueFreshness})
 * @returns the facts a staleness mark's hover names
 */
function gapFacts({ freshness }: { freshness: QueueFreshness }): StalenessFact[] {
  return [
    ...freshness.failed.map((gap) => ({ subject: gap.label, why: gap.why })),
    ...freshness.stale.map((gap) => ({ observedAtIso: gap.observedAtIso, subject: gap.label, why: gap.why })),
  ];
}

/**
 * What a list with no card in it draws: the measured-zero line only when every register's LATEST read answered and
 * none is still replacing a reading handed over from earlier, else a spinner naming every register in flight, else
 * the staleness mark naming every register that could not be read.
 */
export type EmptyListDraw =
  | { readonly kind: "measured-zero" }
  | { readonly kind: "reading"; readonly label: string }
  | { readonly kind: "stale"; readonly facts: readonly StalenessFact[] };

/**
 * Decide what an empty list draws. A reading handed over from earlier on the page (or saved by an earlier console
 * process) answers nothing about now while its replacement is in flight, so it is never called a measured zero:
 * measured, the Queue drew "A measured zero" under its own spinner for 30s on a first boot, while the
 * `desktop e2e` walk — reading the same fact — said it was not yet proven empty.
 *
 * It fails CLOSED. An overlay that can take a card off the list (a reviewer pick, a spoken steer) and draws an earlier
 * reading — kept over a failed read, or handed over and being replaced — could be what emptied it, so it blocks the
 * zero; an overlay with no reading at all removes nothing and does not. And a register count short of the page's own
 * number is said rather than read as nothing missing. What it cannot see: a periodic poll of a register already
 * drawn, which `useLive` does not expose while it is in flight — a card that poll brings is a later state.
 *
 * A DECIDER is stricter than an overlay: it acts with no reading at all — a held steer hides its card until its
 * reading confirms it, an urgent workstream shows a card in this context — so one on its first read, or failed
 * outright, blocks the zero too.
 *
 * @param freshness the registers' facts ({@link queueFreshness})
 * @param overlays the row-removing overlays' facts, read the same way
 * @param deciders the readings that move a card on or off the list even unread, read the same way
 * @param answered how many registers' latest read answered
 * @param expected how many registers the list is built from
 * @returns what to draw
 */
export function emptyListDraw({
  freshness,
  overlays,
  deciders,
  answered,
  expected,
}: {
  freshness: QueueFreshness;
  overlays: QueueFreshness;
  deciders: QueueFreshness;
  answered: number;
  expected: number;
}): EmptyListDraw {
  const inFlight = [
    ...freshness.reading,
    ...freshness.rereading,
    ...overlays.rereading,
    ...deciders.reading,
    ...deciders.rereading,
  ];
  if (inFlight.length > 0) {
    return { kind: "reading", label: `Reading ${inFlight.join(", ")}` };
  }
  const facts = [
    ...gapFacts({ freshness }),
    ...gapFacts({ freshness: { ...overlays, failed: [] } }).map((fact) => ({
      ...fact,
      why: `${fact.why}, and an earlier reading of it can take a card off this list`,
    })),
    ...gapFacts({ freshness: deciders }).map((fact) => ({
      ...fact,
      why: `${fact.why}, and it can move a card onto or off this list`,
    })),
  ];
  if (facts.length > 0) {
    return { facts, kind: "stale" };
  }
  if (answered !== expected) {
    const why = `${String(answered)} of the ${String(expected)} registers it is built from answered`;
    return { facts: [{ subject: "the Queue's registers", why }], kind: "stale" };
  }
  return { kind: "measured-zero" };
}

/**
 * The line as drawn, shared by every page that says how current its cards are: a spinner while a read is in
 * flight, a staleness mark when one failed, or plain words — the quiet age, or a page's own warning such as a
 * frozen fixture. `words` beside a mark is the age of the cards still drawn, and is empty when there is none.
 */
export type FreshnessLine =
  | { readonly kind: "reading"; readonly label: string; readonly words: string }
  | { readonly kind: "stale"; readonly facts: readonly StalenessFact[]; readonly words: string }
  | { readonly kind: "text"; readonly words: string; readonly title: string; readonly tone: "quiet" | "warn" };

/**
 * The one line the bar draws. A failure leads, because it is the "why" the owner needs to be told — every failed and stale
 * register in the mark's hover; then a read in flight; otherwise only the age of the oldest reading on screen.
 *
 * @param freshness the facts ({@link queueFreshness})
 * @param age how long ago an instant was, in the page's own words
 * @returns the line
 */
export function freshnessLine({
  freshness,
  age,
}: {
  freshness: QueueFreshness;
  age: (iso: string) => string;
}): FreshnessLine {
  const facts = gapFacts({ freshness });
  if (facts.length > 0) {
    return { facts, kind: "stale", words: "" };
  }
  if (freshness.reading.length > 0 || freshness.rereading.length > 0) {
    const names = [...freshness.reading, ...freshness.rereading];
    return { kind: "reading", label: `Reading ${names.join(", ")}`, words: "" };
  }
  if (freshness.oldestIso === undefined) {
    return { kind: "text", title: "", tone: "quiet", words: "" };
  }
  return {
    kind: "text",
    title: `the oldest reading on screen was taken ${age(freshness.oldestIso)}`,
    tone: "quiet",
    words: `updated ${age(freshness.oldestIso)}`,
  };
}
