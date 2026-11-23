/**
 * `slack draft record`'s closed-choice flags — `--as`, `--kind`, `--act`, `--reviewer` — and `--row`. `--act` and
 * `--row` are the two fields a parked draft carries for its Queue card rather than for their approval: the badge, and
 * the board row the card files under, neither in the digest. Their own file so `./draftCore.ts` stays under the
 * file-size ratchet.
 */
import { isSafeSlug } from "../../../handover/runStore.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { PARKED_DRAFT_ACTS, type ParkedDraftAct, type ParkedDraftKind } from "../../../outbound/slack/draftRegister.js";
import { REVIEWER_CONTEXTS, type ReviewerContext } from "../../../outbound/slack/reviewAskShape.js";

/**
 * The four closed-choice flags a record takes, `--as`, `--kind`, `--act` and `--reviewer`, each read against its own
 * set.
 *
 * @param values the parsed string flags
 * @returns the choices, or one refusal per flag outside its set
 */
export function recordChoicesOf({ values }: { values: Readonly<Record<string, string>> }): Result<{
  act: ParkedDraftAct | undefined;
  actor: "me" | "bot";
  kind: ParkedDraftKind | undefined;
  reviewer: ReviewerContext | undefined;
}> {
  const actor = recordActorOf({ value: values["as"] });
  const kind = recordKindOf({ value: values["kind"] });
  const act = recordActOf({ value: values["act"] });
  const reviewer = recordReviewerOf({ value: values["reviewer"] });
  const problems: string[] = [];
  if (actor === "invalid") {
    problems.push(`slack draft record --as must be bot or me, got ${String(values["as"])}`);
  }
  if (kind === "invalid") {
    problems.push(`slack draft record --kind must be finding or message, got ${String(values["kind"])}`);
  }
  if (act === "invalid") {
    problems.push(actProblem({ value: String(values["act"]) }));
  }
  if (reviewer === "invalid") {
    problems.push(
      `slack draft record --reviewer must be new, in-thread or not-an-ask, got ${String(values["reviewer"])}`,
    );
  }
  if (actor === "invalid" || kind === "invalid" || act === "invalid" || reviewer === "invalid") {
    return err(problems);
  }
  return ok({ act, actor, kind, reviewer });
}

/**
 * The reviewer a record declares: absent stays undeclared, which a DM review ask refuses.
 *
 * @param value the `--reviewer` value as typed, if any
 * @returns the declaration, nothing when absent, or `invalid` for a value that is neither
 */
function recordReviewerOf({ value }: { value: string | undefined }): ReviewerContext | undefined | "invalid" {
  if (value === undefined) {
    return undefined;
  }
  const declared = REVIEWER_CONTEXTS.find((context) => context === value);
  if (declared === undefined) {
    return "invalid";
  }
  return declared;
}

/**
 * The identity a record names: `--as` absent is `me` — the register's contract before the flag existed.
 *
 * @param value the `--as` value as typed, if any
 * @returns the actor, or `invalid` for a value that is neither
 */
function recordActorOf({ value }: { value: string | undefined }): "me" | "bot" | "invalid" {
  if (value === undefined || value === "me") {
    return "me";
  }
  if (value === "bot") {
    return "bot";
  }
  return "invalid";
}

/**
 * The kind a record declares: absent stays undeclared, which a top-level row as them outside a DM refuses.
 *
 * @param value the `--kind` value as typed, if any
 * @returns the kind, nothing when undeclared, or `invalid` for a value that is neither
 */
function recordKindOf({ value }: { value: string | undefined }): ParkedDraftKind | undefined | "invalid" {
  if (value === undefined) {
    return undefined;
  }
  if (value === "finding" || value === "message") {
    return value;
  }
  return "invalid";
}

/**
 * The act a record declares: absent stays undeclared, and the card draws no badge.
 *
 * @param value the `--act` value as typed, if any
 * @returns the act, nothing when undeclared, or `invalid` for a value outside {@link PARKED_DRAFT_ACTS}
 */
export function recordActOf({ value }: { value: string | undefined }): ParkedDraftAct | undefined | "invalid" {
  if (value === undefined) {
    return undefined;
  }
  const declared = PARKED_DRAFT_ACTS.find((act) => act === value);
  if (declared === undefined) {
    return "invalid";
  }
  return declared;
}

/**
 * The refusal for an `--act` outside the set — naming why `question` in particular is not one.
 *
 * @param value the `--act` value as typed
 * @returns the sentence
 */
export function actProblem({ value }: { value: string }): string {
  const line = `slack draft record --act must be ${PARKED_DRAFT_ACTS.join(", ")}, got ${value}`;
  if (value === "question") {
    return `${line}: a question is the badge of a board ask row, where they are the one asked — a draft asking somebody is a reply or a bump`;
  }
  return line;
}

/**
 * Every way a `--row` is wrong by its shape alone: empty, or not a plain slug. Whether a doc holds it is the
 * shell's read, `./draftRun.ts`.
 *
 * @param row the `--row` value as typed, if any
 * @returns one refusal, or none
 */
export function rowProblems({ row }: { row: string | undefined }): readonly string[] {
  if (row === undefined || isSafeSlug({ slug: row })) {
    return [];
  }
  return [`slack draft record --row must be a board row's slug, got ${JSON.stringify(row)}`];
}

/** A parked row's id, as `--followup-of` names one: `sd-` and its hex tail. */
const DRAFT_ID = /^sd-[0-9a-f]+$/;

/**
 * Why a `--followup-of` value refuses before anything is read: it does not name a draft row at all. Whether that row
 * is a released finding is the register's question, asked under its lock.
 *
 * @param followupOf the value given, absent when the flag was not
 * @returns the refusal, empty when the flag is absent or well-formed
 */
export function followupOfProblems({ followupOf }: { followupOf: string | undefined }): readonly string[] {
  if (followupOf === undefined || DRAFT_ID.test(followupOf)) {
    return [];
  }
  return [
    `slack draft record --followup-of must name a released finding's draft id (sd-…), got ${JSON.stringify(followupOf)}`,
  ];
}
