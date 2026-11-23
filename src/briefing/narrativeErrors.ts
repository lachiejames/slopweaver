/**
 * The three ways projecting the tick ledger can refuse, as a typed union rather than as loose strings.
 *
 * `.claude/rules/error-handling.md`'s threshold is what makes this a union rather than a judgement call:
 * `src/briefing` is long past the four distinct plain shapes at which a directory declares its own
 * `<Domain>Error`, so a projection that grew the list again would be growing exactly what the gate exists to
 * stop. The three arms are genuinely distinct failures rather than one message split three ways — one is a
 * section that cannot hold what the ledger recorded, one is the ledger disagreeing with itself, and one is
 * the projection failing to account for something. A caller that only DISPLAYS them reads `message`.
 *
 * ## Why the two list-shaped arms carry their list as a field
 *
 * `conflicts` and `defects` are variable-length lists of same-shaped problems, which that same rule says
 * stay a list rather than becoming one error each — the multiplicity IS the behaviour, since a conservation
 * failure that named only its first missing atom would send a reader round the loop once per atom. So the
 * arm carries the list and `message` carries the sentence that frames it; {@link narrativeErrorLines} is how
 * a verb prints both without re-composing either.
 *
 * Pure: values in, values out. No clock, no filesystem, no I/O of any kind.
 */

/** A section asked to hold more than it can count. */
export interface TooManyLandingsError {
  readonly code: "TOO_MANY_LANDINGS";
  readonly message: string;
  /** How many landings the newest recorded pass actually saw. */
  readonly seen: number;
  /** The most the section can show without its own heading becoming false. */
  readonly cap: number;
}

/** One identity recorded twice, saying two different things. */
export interface ConflictingRecordError {
  readonly code: "CONFLICTING_RECORD";
  readonly message: string;
  /** One line per identity that disagrees with itself, each naming both atoms. */
  readonly conflicts: readonly string[];
}

/** The projection could not account for everything the window holds. */
export interface ConservationFailedError {
  readonly code: "CONSERVATION_FAILED";
  readonly message: string;
  /** One line per atom whose accounting does not come to exactly one. */
  readonly defects: readonly string[];
}

/** Every way `./narrative.ts` can refuse to project a window. */
export type NarrativeError = TooManyLandingsError | ConflictingRecordError | ConservationFailedError;

/**
 * The factory the projection calls, so a test builds a fixture the same way the real code does.
 *
 * @internal — read by `./narrative.ts` and its own tests; nothing outside the projection names it.
 */
export const NarrativeErrors = {
  /**
   * The newest pass recorded more landings than the section can show.
   *
   * @param seen how many it recorded
   * @param cap the section's own ceiling
   * @returns the typed error
   */
  tooManyLandings: ({ seen, cap }: { seen: number; cap: number }): TooManyLandingsError => ({
    cap,
    code: "TOO_MANY_LANDINGS",
    message:
      `the newest recorded pass saw ${String(seen)} landings and the page shows at most ${String(cap)}. The ` +
      "section's own heading counts what it holds, so moving or cutting an entry would make the page's own " +
      "sentence false. Record the extra landings on their own pass rather than batching them onto one.",
    seen,
  }),

  /**
   * One identity was recorded twice with different contents.
   *
   * @param conflicts one line per disagreeing identity, each naming both atoms
   * @returns the typed error
   */
  conflictingRecords: ({ conflicts }: { conflicts: readonly string[] }): ConflictingRecordError => ({
    code: "CONFLICTING_RECORD",
    conflicts,
    message:
      "the ledger disagrees with itself about what was recorded, and choosing one of the two would be this " +
      "projection deciding — re-record the pass that wrote the second one:",
  }),

  /**
   * Something the window holds was neither rendered nor explicitly represented.
   *
   * @param defects one line per atom whose accounting does not come to exactly one
   * @param ticksInLedger how many rows the whole ledger holds, for the reader's bearings
   * @returns the typed error
   */
  conservationFailed: ({
    defects,
    ticksInLedger,
  }: {
    defects: readonly string[];
    ticksInLedger: number;
  }): ConservationFailedError => ({
    code: "CONSERVATION_FAILED",
    defects,
    message:
      `the projection cannot account for every recorded thing in the window (${String(ticksInLedger)} row(s) ` +
      "in the ledger). It carries your own words, so a page is not written unless all of them are on it:",
  }),
} as const;

/**
 * One refusal as the lines a verb prints: the framing sentence, then whatever list the arm carries.
 *
 * A `switch` over every arm with a `never`-typed default, so a fourth arm fails to compile here rather than
 * printing its framing sentence and silently dropping its list.
 *
 * @param error the refusal
 * @returns the operator-facing lines, in order
 */
export function narrativeErrorLines({ error }: { error: NarrativeError }): readonly string[] {
  switch (error.code) {
    case "TOO_MANY_LANDINGS":
      return [error.message];
    case "CONFLICTING_RECORD":
      return [error.message, ...error.conflicts];
    case "CONSERVATION_FAILED":
      return [error.message, ...error.defects];
    default: {
      const unreachable: never = error;
      return [String(unreachable)];
    }
  }
}
