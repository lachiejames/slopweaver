/**
 * A parked draft that raises a finding brings its proof — a screenshot, a link and the impact in people — or it never
 * reaches the owner's Queue.
 *
 * ## The rule
 *
 * A finding without the receipts — the screenshots, the links, the proof of user impact — is sent back unseen: the
 * owner's time is the cost of a card that lacks them.
 *
 * `./draftReceipts.ts` takes any one link as a receipt, which let through a thread reply (where `--kind` may be
 * omitted) declaring `problem: possible, affects many`, carrying one Linear ticket link, no file, and no count of
 * the people it reached. So this rule is narrower than receipts and stricter inside it:
 *
 * - **What raises a finding** is a declaration, never a prose scan: `--kind finding`, or a form declaring
 *   `problem: {"kind":"possible"}` (`../artifact/problemReach.ts`), which every composed draft must declare. `--kind
 *   message` does not neutralise a `possible` declaration — that would reopen the thread-reply hole. A bump
 *   (`--act bump`) re-surfaces an earlier message and owes nothing for its form, as receipts already reasons, but one
 *   declaring `--kind finding` re-raises it and owes the proof.
 * - **The proof bar** is all three: at least one file (`--media`), at least one link in the rendered message, and an
 *   impact declaration (`--impact "<count> <who> <what happened>"`) whose count appears in the message's FIRST line,
 *   so the reader meets the people before the mechanism.
 * - **No way past it.** `--self-evident` and `--tried` answer the general receipts gate and are not inputs here: a
 *   finding without the receipts is not worth the owner's time, so a session that cannot get the proof does not park
 *   the card. There is deliberately no escape hatch; every missing piece is something a recorder can bring.
 *
 * The same predicate is the Queue's backstop: `slack draft list` lists a HELD row that raises a finding and fails it
 * as sent back, never as a card (`../../cli/commands/slack/draftListDocument.ts`), so a row parked before this rule
 * is sent back unseen too.
 *
 * ## Residue, stated rather than discovered
 *
 * - A file is counted, never classified: the register stores a file's name, digest and size, so "screenshot" here
 *   proves "a file the reader can open". The bot `finding` card is stronger, three distinct decoded images
 *   (`../../cli/commands/slack/findingMedia.ts`), and its MEASURED `blastRadius` stands in for `--impact`.
 * - That a link PROVES the claim is not decidable; that the reader has something to open is.
 * - The impact parser proves a leading count and words after it, and a person noun after it (a fixed list, so a person
 *   it does not name is refused, and a count of something else beside a named person passes), never that the words
 *   are true. The declaration sits on the row where the owner can attack it.
 * - A `--thanks-instead` release (`../../cli/commands/slack/releaseThanks.ts`) posts one line of
 *   thanks IN PLACE of the finding, after the owner approved the proved row's digest, and closes the row. It retracts the
 *   finding rather than raising it, so it owes no proof; that the one line could itself carry a claim is not checked.
 *
 * Pure: no network, no clock, no filesystem.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { FINDING_KIND as FINDING_FORM_KIND, measuredBlastRadiusSchema } from "../artifact/finding.js";
import type { ParkedDraftAct, ParkedDraftKind, ParkedSlackDraft } from "./draftRegister.js";
import { findingFirstLine } from "./findingFirstLine.js";
import { asMeChannelFinding } from "./findingIdentity.js";
import { FindingProofErrors } from "./findingProofErrors.js";
import type { FindingProofMissing } from "./findingProofPieces.js";
import { renderedReceiptLinks } from "./visibleLinks.js";

/** A finding's impact declaration: the words as given, and the count they lead with. */
export interface FindingImpact {
  readonly text: string;
  readonly count: string;
}

/** The number words a count may be spelled in: units, teens, tens, and the scale words a person says. */
const NUMBER_WORDS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
  "dozen",
  "dozens",
  "hundreds",
  "thousands",
] as const;

/** A digit count, with comma thousands separators only where they are well formed: `20`, `2480`, `2,480`. */
const DIGIT_COUNT = /^(?:\d{1,3}(?:,\d{3})+|\d+)$/u;

/** A spelled count: one number word, or two joined by a hyphen (`twenty-five`). */
const WORD_COUNT = new RegExp(`^(?:${NUMBER_WORDS.join("|")})(?:-(?:${NUMBER_WORDS.join("|")}))?$`, "iu");

/**
 * The words that name PEOPLE, singular or plural: the "who" an impact counts. A count of requests, errors or calls is
 * not one, so the words after the count must name a person (the impact is in people). The
 * noun is a whole word: never the start of `usernames`, `users123`, `user_ids`, or a word a combining mark continues.
 */
const PERSON_NOUN =
  /(?<![\p{L}\p{M}\p{N}_])(?:people|persons?|members?|users?|customers?|clients?|staff|coach(?:es)?|admins?|employees?|colleagues?|teammates?|famil(?:y|ies)|parents?|children|kids?|callers?|visitors?|bookers?)(?![\p{L}\p{M}\p{N}_])/iu;

/** How many words must follow the count: at least who, and what happened to them. */
const WORDS_AFTER_COUNT = 2;

/** Default-ignorable code points — a zero-width space, a joiner, a direction mark — which draw nothing. */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;

/**
 * The impact `--impact` declares, or why it does not read as one: it must lead with a count, name the people it
 * counts, and say what happened to them.
 *
 * @param value `--impact`'s value, absent when not given
 * @returns the declaration (`undefined` when the flag is absent), or the refusal lines
 */
export function findingImpactOf({ value }: { value: string | undefined }): Result<FindingImpact | undefined> {
  if (value === undefined) {
    return ok(undefined);
  }
  // Judged on what a reader sees: a zero-width character inside `usernames` is no word boundary.
  const text = value.replace(INVISIBLE, "").trim();
  const [first, ...rest] = text.split(/\s+/u);
  const count = first === undefined ? "" : first.replace(/[.,;:]+$/u, "");
  const leadsWithCount = DIGIT_COUNT.test(count) || WORD_COUNT.test(count);
  if (!leadsWithCount || rest.length < WORDS_AFTER_COUNT || !PERSON_NOUN.test(rest.join(" "))) {
    return err([FindingProofErrors.impactUncounted({ value }).message]);
  }
  return ok({ count, text });
}

/**
 * Whether a draft raises a finding: declared `--kind finding`, whatever its act, or a form declaring a possible
 * problem on anything but a bump. A bump declaring `--kind finding` re-raises it, and a released row of that kind is a
 * shared finding whatever its act (`./sharedFindings.ts`); a chase bump's form re-surfaces the finding it
 * follows and asserts nothing new.
 *
 * @param act the row's `--act`, absent when not given
 * @param form the row's `--form` JSON, as recorded
 * @param kind the row's effective kind (a bot `finding` form is `finding` whatever `--kind` said)
 * @returns true when the proof bar applies
 */
export function raisesFinding({
  act,
  form,
  kind,
}: {
  act: ParkedDraftAct | undefined;
  form: string;
  kind: ParkedDraftKind | undefined;
}): boolean {
  if (kind === "finding") {
    return true;
  }
  return act !== "bump" && declaresPossibleProblem({ form });
}

/** Whether a recorded form declares `problem.kind === "possible"`; a form that does not parse declares nothing. */
function declaresPossibleProblem({ form }: { form: string }): boolean {
  const parsed = formRecordOf({ form });
  if (parsed === undefined) {
    return false;
  }
  const { problem } = parsed;
  return isRecord(problem) && problem["kind"] === "possible";
}

/**
 * A recorded form as an object, or `undefined` when it does not parse as one. A new recording's form always parses —
 * it rendered — so only an old or hand-edited row reaches the `undefined`, and it then declares nothing here.
 */
function formRecordOf({ form }: { form: string }): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "a parked draft form", text: form });
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}

/**
 * Whether a form is a bot `finding` card carrying a MEASURED blast radius, unique users counted, which stands in for
 * `--impact`. An unmeasured one names only a proxy and says it is "not counted", so it is no proof of user impact
 * and owes `--impact` like any other finding; measured means it passes the finding form's own schema,
 * so a malformed count such as `users: 0` is none.
 *
 * @param form the row's `--form` JSON
 * @returns true when the form counts the people it reached
 */
export function formCountsImpact({ form }: { form: string }): boolean {
  const parsed = formRecordOf({ form });
  if (parsed?.["kind"] !== FINDING_FORM_KIND) {
    return false;
  }
  return measuredBlastRadiusSchema.safeParse(parsed["blastRadius"]).success;
}

/**
 * Every piece of proof a STORED row raising a finding lacks — the Queue's backstop, so a row parked before the
 * record gate existed is sent back too. Its impact is re-read from the stored words, never from a stored count, and a
 * bot `finding` card's own MEASURED `blastRadius` stands in for `--impact` exactly as it does at recording. A
 * top-level channel row as the owner that declares no kind is held as a finding here as everywhere else.
 *
 * @param draft the stored row
 * @returns the missing pieces, empty when it brings them all or raises no finding
 */
export function storedFindingProofMissing({
  draft,
}: {
  draft: Pick<
    ParkedSlackDraft,
    "act" | "actor" | "channel" | "form" | "impact" | "kind" | "media" | "payload" | "threadTs"
  >;
}): readonly FindingProofMissing[] {
  // The register reader does not judge `impact` (an unknown field never hides a row), so a stored one that is not text
  // is read here as none: a finding goes back for it, a row raising none is untouched.
  const words: unknown = draft.impact;
  const impact = findingImpactOf({ value: typeof words === "string" ? words : undefined });
  const countedInForm = draft.actor === "bot" && formCountsImpact({ form: draft.form });
  return missingFindingProof({
    act: draft.act,
    form: draft.form,
    impact: impact.isOk() ? impact.value : undefined,
    impactInForm: countedInForm,
    kind: heldAsFinding({ draft }) ? "finding" : draft.kind,
    media: draft.media === undefined ? 0 : draft.media.length,
    payload: draft.payload,
  });
}

/**
 * Whether a stored row is held as a finding whatever its `kind` says. A bot `finding` form is one, exactly as the bot
 * recording lane reads it, so a form given at release cannot carry a finding past a row stamped `message`.
 * And a top-level channel row as the owner that declares no kind is one, which `findingIdentity.ts` already holds because
 * only a recorder older than its kind refusal can have parked it; whether the bot could post it is that
 * module's question, never this one's, so it is not read here.
 */
function heldAsFinding({
  draft,
}: {
  draft: Pick<ParkedSlackDraft, "actor" | "channel" | "form" | "kind" | "threadTs">;
}): boolean {
  if (formRecordOf({ form: draft.form })?.["kind"] === FINDING_FORM_KIND) {
    return true;
  }
  return draft.kind === undefined && asMeChannelFinding({ draft: { ...draft, botCannotPost: undefined } });
}

/**
 * What a reader SEES of one line: a labelled link shows its label, in mrkdwn (`<url|label>`) or as the preview renderer
 * draws a rich text one (`[label](url)`), and any other `<…>` token (a bare address, a mention, a channel, a date
 * whose `|` text is only the fallback a client shows when it cannot format the date) shows no count of people, so a
 * number inside an address or a fallback never passes for one. An emoji shortcode (`:name:`, how the
 * preview renderer draws a rich text emoji and how mrkdwn spells one) is drawn as a picture, so a custom emoji named
 * `twenty` is no count either.
 */
function visibleTextOf({ line }: { line: string }): string {
  return line
    .replace(INVISIBLE, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/<https?:\/\/[^<>|]*\|([^<>]*)>/giu, "$1")
    .replace(/<[^<>]*>/gu, " ")
    .replace(/:[\p{L}\p{N}_+'-]+:/gu, " ");
}

/**
 * Whether `line` carries `count` as a whole token, in any case — `12` is not inside `2012`, and a `.` or `,` between
 * digits joins one number, so `12` is not the count in `12.5`, `1.12` or `12,000`; a dash between two words or numbers joins one compound, so
 * `twenty` is not the count in `twenty-five` nor `12` in `12–30`, and `a 12-member team` fails closed.
 */
function carriesCount({ line, count }: { line: string; count: string }): boolean {
  const escaped = count.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])(?<!\\p{N}[.,])(?<![\\p{L}\\p{M}\\p{N}]\\p{Pd})${escaped}(?![\\p{L}\\p{M}\\p{N}])(?![.,]\\p{N})(?!\\p{Pd}[\\p{L}\\p{M}\\p{N}])`,
    "iu",
  ).test(line);
}

/**
 * Every piece of proof a finding draft is missing, in {@link FINDING_PROOF_MISSING}'s order — empty when it brings
 * them all or raises no finding.
 *
 * @param act the row's `--act`
 * @param form the row's `--form` JSON
 * @param impact the row's impact declaration, absent when it made none
 * @param impactInForm whether the form counts its own impact (a bot `finding` card's MEASURED `blastRadius`)
 * @param kind the row's effective kind
 * @param media how many files go under the message
 * @param payload the exact bytes a release would post
 * @returns the missing pieces
 */
export function missingFindingProof({
  act,
  form,
  impact,
  impactInForm,
  kind,
  media,
  payload,
}: {
  act: ParkedDraftAct | undefined;
  form: string;
  impact: FindingImpact | undefined;
  impactInForm: boolean;
  kind: ParkedDraftKind | undefined;
  media: number;
  payload: unknown;
}): readonly FindingProofMissing[] {
  if (!raisesFinding({ act, form, kind })) {
    return [];
  }
  const missing: FindingProofMissing[] = [];
  if (media === 0) {
    missing.push("screenshot");
  }
  if (renderedReceiptLinks({ payload }).length === 0) {
    missing.push("link");
  }
  if (impactInForm) {
    return missing;
  }
  if (impact === undefined) {
    missing.push("impact");
    return missing;
  }
  const line = findingFirstLine({ payload });
  if (line === undefined || !carriesCount({ count: impact.count, line: visibleTextOf({ line }) })) {
    missing.push("impact-count-first");
  }
  return missing;
}

/** What each missing piece asks the recorder to bring. */
const BRING: Readonly<Record<FindingProofMissing, string>> = {
  impact:
    'the impact in people: --impact "<count> <who> <what happened>", with that count in the message\'s first line',
  "impact-count-first":
    "the impact count in the message's FIRST line, where the reader meets it before the mechanism: --impact " +
    "declares a count the first line does not carry",
  link: "a link to where the reader can see it for themselves (a Datadog view, a Hex query, the record itself)",
  screenshot: "a screenshot of the evidence: --media <file,…>",
};

/**
 * The refusal for a finding draft missing proof, every missing piece named, or nothing when none is missing.
 *
 * @param missing what {@link missingFindingProof} found missing
 * @returns the refusal lines
 */
export function findingProofRefusal({ missing }: { missing: readonly FindingProofMissing[] }): readonly string[] {
  if (missing.length === 0) {
    return [];
  }
  return [
    `this draft raises a finding (--kind finding, or a form declaring a possible problem) and is missing ` +
      `${missing.join(", ")}. A finding without screenshots, links and the proof of user impact ` +
      "is sent back unseen.",
    ...missing.map((piece) => `bring ${BRING[piece]}`),
    "--self-evident and --tried do not answer this: a finding that cannot get its proof does not park. There is " +
      "deliberately NO escape hatch here.",
  ];
}

/**
 * Why a held row raising a finding without its proof is not released: the Queue hides it, so no send may go round
 * the Queue either. It names the re-cut that brings the proof and the drop that ends it.
 *
 * @param id the row the release names
 * @param missing what {@link storedFindingProofMissing} found missing, non-empty
 * @returns the refusal reason
 */
export function findingProofReleaseRefusal({
  id,
  missing,
}: {
  id: string;
  missing: readonly FindingProofMissing[];
}): string {
  return (
    `${id} raises a finding and is missing ${missing.join(", ")}, so it is not sent: the owner sends such a card back ` +
    `unseen. Re-cut it with its proof (\`slopweaver slack draft record … --supersedes ${id}\`) ` +
    `or drop it (\`slopweaver slack draft drop ${id} --note "no proof"\`).`
  );
}
