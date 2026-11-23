/**
 * The typed failures the `briefing` verb directory authors itself — its argument parsers, the documents a render
 * reads, the sections it projects, the form it injects into and checks, and the form files the editing verbs
 * read and write.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory. What another module
 * refused — `parseFlags`, `src/briefing`'s projections, the narrative, an injected reader — is not re-authored
 * here: it rides in `UPSTREAM_REFUSED` as the lines it came as. A variant carrying `reasons` keeps one line per
 * problem, and {@link briefingCommandErrorLines} is how a caller prints them without re-composing the joined
 * `message`.
 */
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchIncantation } from "../../../hatch/types.js";
import { STALE_CARDS_HATCH } from "../../prPremiseDoor.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of lines, printed one each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/**
 * A refusal of a page this verb could still render, carrying the refused bytes.
 *
 * `undefined` when there is no page to show: a form whose own fields are malformed never reaches the renderer.
 * Pass 670 lost forty minutes to a refusal that wrote nothing, so the chair could not see what was counted.
 */
interface WithRefusedPage {
  readonly refusedPage: string | undefined;
}

/** A failure naming a file and the error that reading or writing it threw. */
interface AtPath<C extends string> extends Plain<C> {
  readonly path: string;
}

/** The documents a render parses as JSON. */
type JsonDocument = "form" | "--your-list" | "--open-artifacts";

/** Every failure the `briefing` verb directory authors. */
export type BriefingCommandError =
  | Listed<"UPSTREAM_REFUSED">
  | (Plain<"SOURCES_CONFLICT"> & { readonly reason: string })
  | (Plain<"FLAG_VALUE_MISSING"> & { readonly flag: string })
  | (Plain<"FLAG_OUT_OF_RANGE"> & { readonly flag: string; readonly min: number; readonly max: number })
  | (Plain<"FORM_FLAG_MISSING"> & { readonly verb: "archive" | "render" })
  | (Plain<"DOCUMENT_NOT_JSON"> & { readonly document: JsonDocument })
  | Listed<"PREMISE_CHECK_FAILED">
  | (Plain<"QUIZ_MISSING"> & { readonly sweep: string })
  | AtPath<"FILE_NOT_FOUND">
  | (Plain<"PREVIOUS_VERSION_MISSING"> & { readonly usage: string })
  | AtPath<"FORM_UNREADABLE">
  | Plain<"FORM_NOT_SERIALISABLE">
  | AtPath<"FORM_EDIT_FAILED">
  | AtPath<"FORM_WRITE_FAILED">
  | (Plain<"COMPOSED_PROJECTION_REFUSED"> & { readonly field: string })
  | (Plain<"STAMPS_COMPOSED"> & { readonly fields: readonly string[] })
  | AtPath<"IMAGE_EXTENSION_UNSUPPORTED">
  | AtPath<"FILE_UNREADABLE">
  | (Listed<"FORM_REJECTED"> & WithRefusedPage)
  | (Listed<"RENDER_CHECK_FAILED"> & WithRefusedPage)
  | (Plain<"RENDER_TOO_LARGE"> & WithRefusedPage & { readonly bytes: number; readonly cap: number })
  | (Plain<"AUTONOMY_UNREADABLE"> & { readonly stage: "read" | "fold" });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** What a thrown value says, or the placeholder the refusal printed when it was not an `Error`. */
function causeText({ cause, placeholder }: { cause: unknown; placeholder: string }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return placeholder;
}

/**
 * What to do about a page that is too heavy, which depends entirely on who wrote what is on it.
 *
 * `briefing archive` trims the FORM's own `earlierToday` and `history`, so naming it under `--ticks` would
 * be telling the operator to edit fields the run is about to overwrite — advice that cannot work. With the
 * narrative projected, the only lever that does not require cutting a record is how far back the page
 * reaches: `../../../supervisor/tickStore.ts`'s `TICK_WINDOW_PRIOR_DAYS` carries the 932,162-byte
 * measurement that made this a real path rather than a defensive branch.
 *
 * @param projected whether the three narrative sections came from the tick ledger rather than the form
 * @returns the sentence that follows the measurement
 */
function oversizedAdvice({ projected }: { projected: boolean }): string {
  if (!projected) {
    return "Run `slopweaver briefing archive --form <path>` and render again.";
  }
  return (
    "The narrative is projected from the tick ledger, so `briefing archive` cannot help — it trims fields " +
    "this run overwrites. Cutting what was recorded is not an option either. Reach back fewer days instead: " +
    "re-run with `--ticks-days <n>`, down to 0 for today alone. The page states how many days it is not " +
    "showing, so a shorter window stays honest about what it left out."
  );
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const BriefingCommandErrors = {
  autonomyUnreadable: ({ cause, stage }: { cause: string; stage: "read" | "fold" }): BriefingCommandError => ({
    code: "AUTONOMY_UNREADABLE",
    message: `the autonomy register could not be ${stage === "read" ? "read" : "folded"}: ${cause}`,
    stage,
  }),
  composedProjection: ({ field, why }: { field: string; why: string }): BriefingCommandError => ({
    code: "COMPOSED_PROJECTION_REFUSED",
    field,
    message: `the form writes \`${field}\` itself. ${why}`,
  }),
  documentNotJson: ({ cause, document }: { cause: unknown; document: JsonDocument }): BriefingCommandError => {
    const subject = document === "form" ? "the form" : `the ${document} document`;
    return {
      code: "DOCUMENT_NOT_JSON",
      document,
      message: `${subject} is not valid JSON: ${causeText({ cause, placeholder: "unknown" })}`,
    };
  },
  fileNotFound: ({ path }: { path: string }): BriefingCommandError => ({
    code: "FILE_NOT_FOUND",
    message: `briefing corrections: no such file: ${path}`,
    path,
  }),
  fileUnreadable: ({
    cause,
    path,
    what,
  }: {
    cause: unknown;
    path: string;
    what: "file" | "open-artifact document" | "session-start document";
  }): BriefingCommandError => ({
    code: "FILE_UNREADABLE",
    message: `${path}: could not read the ${what} — ${causeText({ cause, placeholder: "unknown error" })}`,
    path,
  }),
  flagValueMissing: ({ flag }: { flag: string }): BriefingCommandError => ({
    code: "FLAG_VALUE_MISSING",
    flag,
    message: `${flag} takes a value`,
  }),
  formEditFailed: ({ cause, path }: { cause: unknown; path: string }): BriefingCommandError => ({
    code: "FORM_EDIT_FAILED",
    message: `${path}: could not be edited — ${causeText({ cause, placeholder: "unknown error" })}`,
    path,
  }),
  formFlagMissing: ({ verb }: { verb: "archive" | "render" }): BriefingCommandError => ({
    code: "FORM_FLAG_MISSING",
    message:
      verb === "archive"
        ? "--form <path> is required: the form file to trim in place"
        : "--form <json|-> is required (use `-` to read the form from stdin)",
    verb,
  }),
  formNotSerialisable: ({ cause }: { cause: unknown }): BriefingCommandError => ({
    code: "FORM_NOT_SERIALISABLE",
    message: `the edited form could not be written as JSON — ${causeText({ cause, placeholder: "unknown error" })}`,
  }),
  formRejected: ({
    reasons,
    refusedPage,
  }: {
    reasons: readonly string[];
    refusedPage?: string | undefined;
  }): BriefingCommandError => ({ ...listed({ code: "FORM_REJECTED", reasons }), refusedPage }),
  formUnreadable: ({ cause, path }: { cause: unknown; path: string }): BriefingCommandError => ({
    code: "FORM_UNREADABLE",
    message: `${path}: could not read the form — ${causeText({ cause, placeholder: "unknown error" })}`,
    path,
  }),
  formWriteFailed: ({ cause, path }: { cause: unknown; path: string }): BriefingCommandError => ({
    code: "FORM_WRITE_FAILED",
    message:
      `${path}: the write did not complete — ${causeText({ cause, placeholder: "unknown error" })}. ` +
      "The replacement is atomic, so the file holds either its old bytes or the whole new form; read it before retrying.",
    path,
  }),
  imageExtensionUnsupported: ({ path }: { path: string }): BriefingCommandError => ({
    code: "IMAGE_EXTENSION_UNSUPPORTED",
    message: `${path}: not a supported image extension — use .png, .jpg, .jpeg, .gif or .webp`,
    path,
  }),
  keepOutOfRange: ({ cap, flag }: { cap: number; flag: string }): BriefingCommandError => ({
    code: "FLAG_OUT_OF_RANGE",
    flag,
    max: cap,
    message: `${flag} takes a whole number between 1 and ${String(cap)} (the schema's own cap)`,
    min: 1,
  }),
  premiseReadFailed: ({ cause, verb }: { cause: string; verb: "render" | "check" }): BriefingCommandError =>
    listed({
      code: "PREMISE_CHECK_FAILED",
      reasons: [
        verb === "render"
          ? `the rendered page's cards could not be checked against GitHub: ${cause}`
          : `briefing check: ${cause}`,
        `For one deliberate exception run ${hatchIncantation({ hatch: hatchFor({ id: STALE_CARDS_HATCH }) })}; ` +
          "the grant skips the live pull-request read entirely.",
      ],
    }),
  previousVersionMissing: ({ usage }: { usage: string }): BriefingCommandError => ({
    code: "PREVIOUS_VERSION_MISSING",
    message:
      "briefing corrections needs the version the owner already read: --artifact <url|id> to take it from the " +
      "freeze, or --previous <html> to name the file directly.",
    usage,
  }),
  quizQuestionMissing: ({ sweep }: { sweep: string }): BriefingCommandError => ({
    code: "QUIZ_MISSING",
    message:
      `the quiz ledger holds no question for sweep ${sweep}. Cut it first with ` +
      "`slopweaver knowledge quiz --sweep <tick-id>` — the render reads that row rather than selecting, so " +
      "the id on the page keeps meaning what it meant when the page was written.",
    sweep,
  }),
  renderCheckFailed: ({
    lines,
    refusedPage,
  }: {
    lines: readonly string[];
    refusedPage: string;
  }): BriefingCommandError => ({
    ...listed({
      code: "RENDER_CHECK_FAILED",
      reasons: ["the rendered page does not pass `briefing check`, so it was not written:", ...lines],
    }),
    refusedPage,
  }),
  renderTooLarge: ({
    bytes,
    cap,
    projected,
    refusedPage,
  }: {
    bytes: number;
    cap: number;
    projected: boolean;
    refusedPage: string;
  }): BriefingCommandError => ({
    bytes,
    cap,
    code: "RENDER_TOO_LARGE",
    message:
      `the rendered page weighs ${String(bytes)} bytes with its images stripped, over the cap of ` +
      `${String(cap)}; a page that size costs every fresh supervisor a chunked read before ` +
      `it can publish. ${oversizedAdvice({ projected })}`,
    refusedPage,
  }),
  sourcesConflict: ({ reason }: { reason: string }): BriefingCommandError => ({
    code: "SOURCES_CONFLICT",
    message: reason,
    reason,
  }),
  stampsComposed: ({ fields }: { fields: readonly string[] }): BriefingCommandError => ({
    code: "STAMPS_COMPOSED",
    fields,
    message:
      `the form writes ${fields.join(" and ")} itself. The instants come off the machine clock and the ` +
      "session-start run behind the page, and how stale a half of the page is comes off the same two — " +
      "never from a composer. Drop them; the verb stamps them.",
  }),
  ticksDaysOutOfRange: ({ max }: { max: number }): BriefingCommandError => ({
    code: "FLAG_OUT_OF_RANGE",
    flag: "--ticks-days",
    max,
    message:
      `--ticks-days takes a whole number between 0 and ${String(max)} — how many days ` +
      "BEFORE today the projected narrative reaches back. 0 is today alone.",
    min: 0,
  }),
  topOutOfRange: ({ max }: { max: number }): BriefingCommandError => ({
    code: "FLAG_OUT_OF_RANGE",
    flag: "--top",
    max,
    message: `--top takes a whole number between 1 and ${String(max)}`,
    min: 1,
  }),
  upstreamRefused: ({ reasons }: { reasons: readonly string[] }): BriefingCommandError =>
    listed({ code: "UPSTREAM_REFUSED", reasons }),
} as const;

/**
 * The lines a {@link BriefingCommandError} prints, one per problem. A list-carrying variant gives each entry its
 * own line, as the `readonly string[]` it replaced did; a missing previous version is followed by the verb's
 * usage, as it always was.
 *
 * @returns one line per problem, in the order they were found
 */
export function briefingCommandErrorLines({ error }: { error: BriefingCommandError }): readonly string[] {
  if (
    error.code === "UPSTREAM_REFUSED" ||
    error.code === "PREMISE_CHECK_FAILED" ||
    error.code === "FORM_REJECTED" ||
    error.code === "RENDER_CHECK_FAILED"
  ) {
    return error.reasons;
  }
  if (error.code === "PREVIOUS_VERSION_MISSING") {
    return [error.message, error.usage];
  }
  return [error.message];
}
