/**
 * The typed failures `src/briefing` authors itself — reading the `--open-artifacts` document, projecting its
 * open pages into cards, reading a `session-start --json` run, and applying one sweep's edit to a form.
 *
 * A union of its own per `.claude/rules/error-handling.md`, beside `narrativeErrors.ts`, `openPageRowErrors.ts`
 * and `openPageDropErrors.ts` rather than inside them: none shares a caller with this one, and each keeps the
 * shape its verb already prints. A variant carrying `reasons` keeps one line per problem, and
 * {@link briefingErrorLines} is how a caller prints them without re-composing the joined `message`.
 *
 * Pure: values in, values out.
 */
import { markdownSubjectRefusal } from "./markdownSubject.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** One `--open-artifacts` entry that could not be read, named by its position. */
interface OpenArtifactEntryError<C extends string> extends Plain<C> {
  readonly index: number;
}

/** One open page that cannot become a card, named as a reader would recognise it. */
interface OpenPageError<C extends string> extends Plain<C> {
  readonly label: string;
}

/** Every failure `src/briefing` authors outside its three narrower domains. */
export type BriefingError =
  | Plain<"OPEN_ARTIFACT_DOCUMENT_NOT_ARRAY">
  | OpenArtifactEntryError<"OPEN_ARTIFACT_ENTRY_NOT_OBJECT">
  | OpenArtifactEntryError<"OPEN_ARTIFACT_FIELDS_MISSING">
  | (OpenArtifactEntryError<"OPEN_ARTIFACT_SUBJECT_REFUSED"> & { readonly url: string })
  | Listed<"OPEN_ARTIFACTS_REFUSED">
  | OpenPageError<"OPEN_PAGE_OPTIONS_MISSING">
  | (OpenPageError<"OPEN_PAGE_OPTIONS_OVER_CAP"> & { readonly count: number; readonly cap: number })
  | OpenPageError<"OPEN_PAGE_OPTION_INVALID">
  | (OpenPageError<"OPEN_PAGE_DETAIL_INVALID"> & { readonly issues: readonly string[] })
  | (Plain<"OPEN_PAGE_ENTRY_NOT_OBJECT"> & { readonly url: string })
  | (OpenPageError<"OPEN_PAGE_FIELDS_MISSING"> & { readonly missing: readonly string[] })
  | (OpenPageError<"OPEN_PAGE_MARKS_INVALID"> & { readonly problems: readonly string[] })
  | (OpenPageError<"OPEN_PAGE_TYPES_PAGE_FIELDS"> & { readonly keys: readonly string[] })
  | (OpenPageError<"OPEN_PAGE_UNMARKED"> & { readonly url: string; readonly why: string })
  | Listed<"OPEN_PAGE_CARDS_REFUSED">
  | Listed<"SESSION_START_DOCUMENT_INVALID">
  | Plain<"FORM_NOT_OBJECT">
  | Plain<"FORM_HEADER_MISSING">
  | (Plain<"FORM_HEADER_FIELDS_REFUSED"> & { readonly fields: readonly string[] })
  | Plain<"CARDS_MISSING">
  | Listed<"CARD_DROP_REFUSED">
  | Plain<"ALIGNMENT_DETAIL_MISSING">
  | Plain<"RECENT_SECTION_MISSING">
  | Plain<"RECENT_BLOCK_DUPLICATE">
  | (Plain<"RECENT_ROLL_OVER_CAP"> & {
      readonly rolling: number;
      readonly notes: number;
      readonly cap: number;
      readonly keep: number;
    })
  | Plain<"EARLIER_SUMMARY_MISSING">
  | Plain<"EARLIER_SECTION_INVALID">
  | Listed<"SWEEP_REFUSED">;

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const BriefingErrors = {
  alignmentDetailMissing: (): Plain<"ALIGNMENT_DETAIL_MISSING"> => ({
    code: "ALIGNMENT_DETAIL_MISSING",
    message: "the form's alignment carries no detail fold to keep a summary from; pass --alignment-summary <text>",
  }),
  cardDropRefused: ({ reasons }: { reasons: readonly string[] }): Listed<"CARD_DROP_REFUSED"> =>
    listed({ code: "CARD_DROP_REFUSED", reasons }),
  cardsMissing: (): Plain<"CARDS_MISSING"> => ({
    code: "CARDS_MISSING",
    message: "--drop-card-prefix was given, but the form has no `reactNow.meFacing` cards",
  }),
  earlierSectionInvalid: (): Plain<"EARLIER_SECTION_INVALID"> => ({
    code: "EARLIER_SECTION_INVALID",
    message: "the form's `earlierToday` is not a section with a `notes` array",
  }),
  earlierSummaryMissing: (): Plain<"EARLIER_SUMMARY_MISSING"> => ({
    code: "EARLIER_SUMMARY_MISSING",
    message: "a recent block has to roll into earlierToday and the form has none; pass --earlier-summary <text>",
  }),
  formHeaderFieldsRefused: ({ fields }: { fields: readonly string[] }): BriefingError => ({
    code: "FORM_HEADER_FIELDS_REFUSED",
    fields,
    message:
      `the header carries ${fields.map((key) => `\`${key}\``).join(", ")}, which a sweep does not set. ` +
      "Remove it from the form: the render injects the two instants itself and refuses a form that writes them.",
  }),
  formHeaderMissing: (): Plain<"FORM_HEADER_MISSING"> => ({
    code: "FORM_HEADER_MISSING",
    message: "the form has no `header` object to take over",
  }),
  formNotObject: (): Plain<"FORM_NOT_OBJECT"> => ({
    code: "FORM_NOT_OBJECT",
    message: "the form is not a JSON object",
  }),
  openArtifactDocumentNotArray: (): Plain<"OPEN_ARTIFACT_DOCUMENT_NOT_ARRAY"> => ({
    code: "OPEN_ARTIFACT_DOCUMENT_NOT_ARRAY",
    message: "the --open-artifacts document is a JSON array of open pages, one object each",
  }),
  openArtifactEntryNotObject: ({ index }: { index: number }): BriefingError => ({
    code: "OPEN_ARTIFACT_ENTRY_NOT_OBJECT",
    index,
    message: `--open-artifacts entry ${String(index)} is not an object`,
  }),
  openArtifactFieldsMissing: ({ index }: { index: number }): BriefingError => ({
    code: "OPEN_ARTIFACT_FIELDS_MISSING",
    index,
    message: `--open-artifacts entry ${String(index)} needs a label, url, ask and landedIso, all strings`,
  }),
  openArtifactsRefused: ({ reasons }: { reasons: readonly string[] }): Listed<"OPEN_ARTIFACTS_REFUSED"> =>
    listed({ code: "OPEN_ARTIFACTS_REFUSED", reasons }),
  openArtifactSubjectRefused: ({ index, url }: { index: number; url: string }): BriefingError => ({
    code: "OPEN_ARTIFACT_SUBJECT_REFUSED",
    index,
    message: `--open-artifacts entry ${String(index)} (${url}) ${markdownSubjectRefusal()}`,
    url,
  }),
  openPageCardsRefused: ({ reasons }: { reasons: readonly string[] }): Listed<"OPEN_PAGE_CARDS_REFUSED"> =>
    listed({ code: "OPEN_PAGE_CARDS_REFUSED", reasons }),
  openPageDetailInvalid: ({ issues, label }: { issues: readonly string[]; label: string }): BriefingError => ({
    code: "OPEN_PAGE_DETAIL_INVALID",
    issues,
    label,
    message:
      `open page "${label}" carries a \`detail\` that is not a fold, so it would render as nothing at all: ` +
      '`detail` is `{ "summary": "<what a reader clicks>", "blocks": [ … ] }`, never a string, and an ' +
      "image block here carries a resolved `data:` URI rather than a `path`. " +
      issues.join("; "),
  }),
  openPageEntryNotObject: ({ url }: { url: string }): BriefingError => ({
    code: "OPEN_PAGE_ENTRY_NOT_OBJECT",
    message: `the --open-artifacts entry for ${url} is not an object`,
    url,
  }),
  openPageFieldsMissing: ({ label, missing }: { label: string; missing: readonly string[] }): BriefingError => ({
    code: "OPEN_PAGE_FIELDS_MISSING",
    label,
    message:
      `open page "${label}" cannot become a card: it is missing ${missing.join(", ")}. ` +
      "Every open page must carry the same six fields the authored cards do, so the " +
      "projection refuses rather than synthesising prose from the page's own `ask`.",
    missing,
  }),
  openPageMarksInvalid: ({ label, problems }: { label: string; problems: readonly string[] }): BriefingError => ({
    code: "OPEN_PAGE_MARKS_INVALID",
    label,
    message:
      `open page "${label}" cannot become a card: its card marks are wrong. Mark exactly one element ` +
      '`data-card="question"` and one `data-card="lean"` on the page, then republish it. ' +
      problems.join("; "),
    problems,
  }),
  openPageOptionInvalid: ({ label }: { label: string }): BriefingError => ({
    code: "OPEN_PAGE_OPTION_INVALID",
    label,
    message: `open page "${label}" has an option that is not \`{ letter, text }\` with both non-empty`,
  }),
  openPageOptionsMissing: ({ label }: { label: string }): BriefingError => ({
    code: "OPEN_PAGE_OPTIONS_MISSING",
    label,
    message: `open page "${label}" needs an \`options\` array of at least one { letter, text }`,
  }),
  openPageOptionsOverCap: ({ cap, count, label }: { cap: number; count: number; label: string }): BriefingError => ({
    cap,
    code: "OPEN_PAGE_OPTIONS_OVER_CAP",
    count,
    label,
    message: `open page "${label}" carries ${String(count)} options, over the cap of ${String(cap)}`,
  }),
  openPageTypesPageFields: ({ keys, label }: { keys: readonly string[]; label: string }): BriefingError => ({
    code: "OPEN_PAGE_TYPES_PAGE_FIELDS",
    keys,
    label,
    message:
      `open page "${label}" types ${keys.map((key) => `\`${key}\``).join(" and ")} on its entry while the page ` +
      "marks its own: the card reads those from the page, so a typed copy can only drift from it. Delete " +
      `${keys.length === 1 ? "that key" : "those keys"} from the entry.`,
  }),
  openPageUnmarked: ({ label, url, why }: { label: string; url: string; why: string }): BriefingError => ({
    code: "OPEN_PAGE_UNMARKED",
    label,
    message:
      `open page "${label}" cannot become a card: ${why}. A card reads its question and lean from the page ` +
      '(one element `data-card="question"`, one `data-card="lean"`) rather than from the entry, so mark them ' +
      `on the page and republish it with \`slopweaver page publish <slug> --page <fragment>.html --review <id>\`. (${url})`,
    url,
    why,
  }),
  recentBlockDuplicate: (): Plain<"RECENT_BLOCK_DUPLICATE"> => ({
    code: "RECENT_BLOCK_DUPLICATE",
    message: "the newest recent block already carries this headline — this sweep block was already applied",
  }),
  recentRollOverCap: ({ cap, notes, rolling }: { cap: number; notes: number; rolling: number }): BriefingError => {
    const keep = cap - rolling;
    return {
      cap,
      code: "RECENT_ROLL_OVER_CAP",
      keep,
      message:
        `rolling ${String(rolling)} block(s) would put ${String(notes)} notes in earlierToday, over the cap of ` +
        `${String(cap)}. Nothing was written. Archive first, keeping the newest: ` +
        `slopweaver briefing archive --form <path> --keep-notes ${String(keep)}`,
      notes,
      rolling,
    };
  },
  recentSectionMissing: (): Plain<"RECENT_SECTION_MISSING"> => ({
    code: "RECENT_SECTION_MISSING",
    message: "the form has no `recent` array to add a block to",
  }),
  sessionStartDocumentInvalid: ({ issues }: { issues: readonly string[] }): Listed<"SESSION_START_DOCUMENT_INVALID"> =>
    listed({
      code: "SESSION_START_DOCUMENT_INVALID",
      reasons: ["the document is not a `slopweaver session-start --json` run:", ...issues],
    }),
  sweepRefused: ({ reasons }: { reasons: readonly string[] }): Listed<"SWEEP_REFUSED"> =>
    listed({ code: "SWEEP_REFUSED", reasons }),
} as const;

/**
 * The lines a {@link BriefingError} prints, one per problem. A list-carrying variant gives each entry its own
 * line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function briefingErrorLines({ error }: { error: BriefingError }): readonly string[] {
  if (
    error.code === "OPEN_ARTIFACTS_REFUSED" ||
    error.code === "OPEN_PAGE_CARDS_REFUSED" ||
    error.code === "SESSION_START_DOCUMENT_INVALID" ||
    error.code === "CARD_DROP_REFUSED" ||
    error.code === "SWEEP_REFUSED"
  ) {
    return error.reasons;
  }
  return [error.message];
}
