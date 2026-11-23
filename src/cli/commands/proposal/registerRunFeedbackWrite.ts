/**
 * The register's two feedback MUTATION verbs — `proposal record-feedback` and `answer-feedback` — split out of
 * `./registerRun.ts` so that file sits under the size cap. Each appends one typed event through
 * `../../../outbound/proposal/register/store.ts`, exactly like the other mutations; the read-only `proposal
 * feedback` lives in `./registerRunRead.ts`.
 */
import {
  nextFeedbackId,
  type RegisterEntry,
  type RegisterFeedback,
} from "../../../outbound/proposal/register/events.js";
import { appendRegisterEvent, readRegisterJournal } from "../../../outbound/proposal/register/store.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseProposalAnswerFeedbackArgs, parseProposalRecordFeedbackArgs } from "./registerCoreFeedback.js";
import {
  announce,
  type ProposalRegisterDeps,
  refuse,
  refuseParse,
  resolveEntry,
  VERB_ARG_OFFSET,
} from "./registerRunShared.js";

/**
 * Run `proposal record-feedback`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runProposalRecordFeedback({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ProposalRegisterDeps;
}): number {
  const parsed = parseProposalRecordFeedbackArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuseParse({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (resolveEntry({ deps, home, slug: args.slug }) === undefined) {
    return EXIT_EXPECTED_EMPTY;
  }
  const journal = readRegisterJournal({ home, slug: args.slug });
  if (journal.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [journal.error.message] });
  }
  // Allocated from the RAW journal, and REFUSED outright while any line is undecodable. `loadRegisterEntry`
  // throws away the unreadable-line residue, so allocating from a fold would cheerfully reissue an id already
  // taken by a line this build cannot read — defeating the exact forward-compatibility a stored id exists for.
  if (journal.value.unreadable.length > 0) {
    return refuse({
      code: EXIT_ERROR,
      deps,
      lines: [
        `${args.slug}: line(s) ${journal.value.unreadable.join(", ")} cannot be decoded by this build, so a ` +
          "feedback id cannot be allocated without risking one already taken — fix or upgrade before recording",
      ],
    });
  }
  const id = nextFeedbackId({ events: journal.value.events });
  const appended = appendRegisterEvent({
    event: {
      atIso: deps.now().toISOString(),
      feedbackKind: args.feedbackKind,
      id,
      kind: "feedback-recorded",
      occurredIso: args.occurredIso,
      what: args.what,
      where: args.where,
      who: args.who,
    },
    home,
    slug: args.slug,
  });
  if (appended.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [appended.error.message] });
  }
  return announce({
    deps,
    json: args.json,
    line: `${args.slug} ← ${id} (${args.feedbackKind}) from ${args.who}`,
    payload: { feedbackKind: args.feedbackKind, id, slug: args.slug, who: args.who },
  });
}

/**
 * Run `proposal answer-feedback`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runProposalAnswerFeedback({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ProposalRegisterDeps;
}): number {
  const parsed = parseProposalAnswerFeedbackArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuseParse({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  const entry = resolveEntry({ deps, home, slug: args.slug });
  if (entry === undefined) {
    return EXIT_EXPECTED_EMPTY;
  }
  const resolved = resolveFeedbackId({ entry, id: args.id });
  if ("errors" in resolved) {
    return refuse({ code: resolved.code, deps, lines: resolved.errors });
  }
  const appended = appendRegisterEvent({
    event: { atIso: deps.now().toISOString(), how: args.how, id: args.id, kind: "feedback-answered" },
    home,
    slug: args.slug,
  });
  if (appended.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [appended.error.message] });
  }
  // Answering an already-answered item is ALLOWED and replaces the answer on the fold, while both events stay
  // in the journal. A better answer landing later is a real thing that happens; losing the first one is not.
  return announce({
    deps,
    json: args.json,
    line: `${args.slug} ${args.id} answered`,
    payload: { how: args.how, id: args.id, slug: args.slug },
  });
}

/**
 * Find the one piece of feedback an answer names, or the refusal that stops it.
 *
 * Two refusals, and neither is decoration. An id matching NOTHING would otherwise append an answer that folds
 * into a journal looking complete while the objection it was meant to close still reads unanswered. An id
 * matching TWO is the one residual race in the allocator — read-count-append with no lock, so two writers
 * hitting the same proposal at the same instant could mint the same id — and answering would silently close
 * both; refusing makes that race loud instead of wrong.
 */
function resolveFeedbackId({
  entry,
  id,
}: {
  entry: RegisterEntry;
  id: string;
}): { readonly feedback: RegisterFeedback } | { readonly errors: readonly string[]; readonly code: number } {
  const matches = entry.feedback.filter((feedback) => feedback.id === id);
  const first = matches[0];
  if (first === undefined) {
    const known = entry.feedback.map((feedback) => feedback.id).join(", ");
    return {
      code: EXIT_USAGE,
      errors: [
        `no feedback "${id}" on ${entry.slug}` +
          (known.length === 0 ? " — nothing has been recorded against it yet" : ` — it has ${known}`),
      ],
    };
  }
  return matches.length > 1
    ? {
        code: EXIT_ERROR,
        errors: [
          `${entry.slug} has ${String(matches.length)} pieces of feedback filed under "${id}" — answering ` +
            "would close all of them, so this refuses; separate them in the journal first",
        ],
      }
    : { feedback: first };
}
