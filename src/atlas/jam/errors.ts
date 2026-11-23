/**
 * The failure kinds a Jam atlas can genuinely produce, as a typed union: a publish of the committed table or
 * of a walk, and the refusals a walk of the application authors before it publishes anything.
 *
 * Per `.claude/rules/error-handling.md` this domain earns a union rather than `readonly string[]`, because
 * callers BRANCH on these: a `REGISTRY_INVALID` is a defect in the committed table that must stop the
 * publish and is fixed by regenerating it, while a `STORE_UNWRITABLE` is a filesystem fault with a
 * completely different remedy.
 *
 * The walk's refusals leave this directory through a `readonly string[]` seam — the page-walk kit's root
 * probe, and the walk verb that prints one line each — so they are built here and turned into lines by
 * {@link jamAtlasErrorLines} at the `err(...)` that authors them. None carries the team root id: the probe
 * asks for the bare origin, and the control verdict is regrade prose.
 *
 * ## There is deliberately no error for a moved document
 *
 * Nothing this atlas ships at runtime fetches anything: `sync` publishes a committed table with no request
 * at all. Drift against what Jam serves is caught by `yarn tsx tools/generateJamSurfaces.ts --verify`, whose
 * census refuses a table whose operation, scope or route counts have moved — a check that belongs in CI
 * rather than in a verb, because the reviewed boundary is the TABLE rather than the vendor's bytes.
 * `kit/pinnedSpec.ts` carries why a moved digest is a finding rather than a failure in the first place.
 */

/**
 * The committed table declares something the model does not.
 * @internal
 */
export interface JamRegistryInvalidError {
  readonly code: "REGISTRY_INVALID";
  readonly message: string;
  readonly detail: string;
}

/**
 * The generation could not be written.
 * @internal
 */
export interface JamStoreUnwritableError {
  readonly code: "STORE_UNWRITABLE";
  readonly message: string;
  readonly reasons: readonly string[];
}

/**
 * The generation already on disk could not be READ, so a publish cannot say what it would replace.
 *
 * Separate from { JamStoreUnwritableError} because the remedies are opposite: an unwritable store is a
 * permissions or disk fault, while an unreadable generation is one a NEWER build published or a hand-edit
 * broke, where the answer is `atlas jam restore` or a newer binary rather than a retry.
 * @internal
 */
export interface JamStoreUnreadableError {
  readonly code: "STORE_UNREADABLE";
  readonly message: string;
  readonly reasons: readonly string[];
}

/**
 * The root probe could not reach the application at all, so no team root was learned.
 * @internal
 */
export interface JamRootUnreachableError {
  readonly code: "ROOT_UNREACHABLE";
  readonly message: string;
  /** The transport's own reason for the bare-origin probe, which names no team. */
  readonly detail: string;
}

/**
 * The application answered its own root with its sign-in page, so no page could be walked.
 * @internal
 */
export interface JamSignedOutError {
  readonly code: "SIGNED_OUT";
  readonly message: string;
  readonly reasons: readonly string[];
}

/**
 * WHICH way the walk's not-found controls were unusable, because the remedy depends on it.
 *
 * Only `band` — both controls photographed, and the declared `/404` outside the invented route's band — is
 * evidence Jam changed its not-found page, so only `band` prescribes re-measuring the band. The other three
 * are this run's own fault (no page under a control surface, a control the transport did not reach, a
 * control reached with no screenshot), and their remedy is to run the walk again. MEASURED: a
 * resync refused with the band remedy alone, and a fresh walk the next day showed the band still
 * separating real pages from the not-found (`notFoundControl.ts` carries how to re-read them).
 * @internal
 */
export type JamNotFoundControlCause = "band" | "control-missing" | "control-unreachable" | "control-unphotographed";

/**
 * Why a walk's not-found controls cannot be trusted this run: the typed cause a remedy is chosen by, and the
 * sentence that names it.
 * @internal
 */
export interface JamNotFoundControlFailure {
  readonly cause: JamNotFoundControlCause;
  /** The walk's own sentence, which never carries the team root id: both controls hang off the bare origin. */
  readonly because: string;
}

/**
 * The walk's not-found controls were unusable, so no page grading from it can be trusted and nothing was
 * published.
 * @internal
 */
export interface JamControlUncorroboratedError {
  readonly code: "CONTROL_UNCORROBORATED";
  readonly message: string;
  readonly reasons: readonly string[];
  readonly cause: JamNotFoundControlCause;
  readonly because: string;
}

/**
 * The walk learned no team root, so no application page was addressed and nothing was published.
 *
 * Separate from { JamControlUncorroboratedError} because both controls hang off the bare origin: a rootless
 * walk still photographs them, and they can agree with each other — on a marketing 404 as easily as on the
 * application's own — while every page the atlas exists to map went unvisited. Its remedy is the session,
 * not the band.
 * @internal
 */
export interface JamRootMissingError {
  readonly code: "ROOT_MISSING";
  readonly message: string;
  readonly reasons: readonly string[];
}

/**
 * Every way a Jam atlas publish or walk can fail.
 * @internal
 */
export type JamAtlasError =
  | JamRegistryInvalidError
  | JamStoreUnwritableError
  | JamStoreUnreadableError
  | JamRootUnreachableError
  | JamSignedOutError
  | JamControlUncorroboratedError
  | JamRootMissingError;

/**
 * What to do about an unusable control, chosen by its cause: re-measuring the band only when the band itself
 * disagreed, and walking again when this run merely failed to observe a control.
 *
 * Two halves, because the refusal's last line is cut: `short` LEADS that line, ahead of the cause, so a
 * reader that keeps only the line's first 240 characters (`live/automation/verbFailureWhy.ts`) keeps the
 * whole remedy; `why` is the explanation, on the line before it.
 *
 * @param cause which way the controls were unusable
 * @returns the short remedy the last line opens with, and the line explaining it
 */
function controlRemedy({ cause }: { cause: JamNotFoundControlCause }): {
  readonly short: string;
  readonly why: string;
} {
  switch (cause) {
    case "band":
      return {
        short: "re-measure the band in `notFoundControl.ts`",
        why:
          "the two controls were photographed and disagreed, so Jam may have changed its not-found page: re-measure " +
          "the band in `notFoundControl.ts` against a fresh walk before trusting a page grading again",
      };
    case "control-missing":
    case "control-unreachable":
    case "control-unphotographed":
      return {
        short: "run the walk again",
        why:
          "this run failed to observe a control, which says nothing about Jam's not-found page: run the walk " +
          "again rather than re-measuring the band",
      };
    default: {
      const unhandled: never = cause;
      return unhandled;
    }
  }
}

/**
 * A cause sentence as ONE line: a newline inside it would split the refusal's last line in two, and a reader
 * keeping only the closing line would lose the remedy that opens it.
 *
 * @param because the walk's own sentence, from whatever transport or store reason it quoted
 * @returns the sentence with every run of line breaks, and the whitespace around it, collapsed to one space
 */
function oneLine({ because }: { because: string }): string {
  return because.replace(/\s*[\r\n]+\s*/g, " ");
}

/**
 * Construct each failure the same way the real code does, so a test built from these catches a factory that
 * stops matching its own type.
 */
export const JamAtlasErrors = {
  registryInvalid: ({ detail }: { detail: string }): JamRegistryInvalidError => ({
    code: "REGISTRY_INVALID",
    detail,
    message: `the committed Jam surface table cannot be published: ${detail}`,
  }),
  rootMissing: (): JamRootMissingError => {
    const reasons = [
      "the walk learned no team root — jam.dev did not settle on an address under /s/ — so no application page " +
        "was addressed, and the two not-found controls, which hang off the bare origin, prove nothing about one",
      "nothing was published. Open jam.dev in your own Chrome, check it settles under /s/, and run the walk again",
    ];
    return { code: "ROOT_MISSING", message: reasons.join("; "), reasons };
  },
  rootUnreachable: ({ detail }: { detail: string }): JamRootUnreachableError => ({
    code: "ROOT_UNREACHABLE",
    detail,
    message: `could not reach the Jam application to learn its team root: ${detail}`,
  }),
  signedOut: (): JamSignedOutError => {
    const reasons = [
      "the Jam application answered its own root with its sign-in page, so no page could be walked",
      "sign in to Jam in your own Chrome and run the walk again",
    ];
    return { code: "SIGNED_OUT", message: reasons.join("; "), reasons };
  },
  storeUnreadable: ({ reasons }: { reasons: readonly string[] }): JamStoreUnreadableError => ({
    code: "STORE_UNREADABLE",
    message: `the Jam atlas generation on disk could not be read: `,
    reasons,
  }),
  storeUnwritable: ({ reasons }: { reasons: readonly string[] }): JamStoreUnwritableError => ({
    code: "STORE_UNWRITABLE",
    message: `the Jam atlas generation could not be written: ${reasons.join("; ")}`,
    reasons,
  }),
  // The remedy and cause ride the LAST line, because a scheduled recipe's failure finding keeps only a
  // refusal's closing stderr line, cut at 240 characters: a cause on the first line
  // is lost. The SHORT remedy leads, so a cut can only shorten the tail of the cause.
  uncorroborated: ({ cause, because }: JamNotFoundControlFailure): JamControlUncorroboratedError => {
    const sentence = oneLine({ because });
    const remedy = controlRemedy({ cause });
    const reasons = [
      "the walk's not-found controls were unusable, so this run cannot tell a real page from one Jam rendered " +
        "for a route it does not have — and nine such pages were published as reached before any control " +
        "existed (`notFoundControl.ts`).",
      remedy.why,
      `nothing was published — remedy: ${remedy.short}; cause: ${sentence}`,
    ];
    return { because: sentence, cause, code: "CONTROL_UNCORROBORATED", message: reasons.join("; "), reasons };
  },
} as const;

/**
 * The lines a {@link JamAtlasError} prints: a list-carrying failure's reasons one per line, as the
 * `readonly string[]` it replaced did, and a one-sentence failure as its message.
 *
 * @param error the Jam publish or walk failure being printed
 * @returns one line per reason, in the order they are read
 */
export function jamAtlasErrorLines({ error }: { error: JamAtlasError }): readonly string[] {
  if (error.code === "REGISTRY_INVALID" || error.code === "ROOT_UNREACHABLE") {
    return [error.message];
  }
  return error.reasons;
}
