/**
 * The register's READ-ONLY verbs — `proposal list`, `show` and `feedback` — split out of `./registerRun.ts`
 * so that file stays under the file-size ratchet rather than growing past it. Every mutation verb lives in
 * `registerRun.ts` or `registerRunFeedbackWrite.ts`; nothing here appends to a journal.
 */
import { addressLabel } from "../../../outbound/proposal/address.js";
import {
  feedbackIsUnanswered,
  type RegisterEntry,
  type RegisterEvent,
  type RegisterFeedback,
  unansweredFeedback,
} from "../../../outbound/proposal/register/events.js";
import {
  listRegisterSlugs,
  loadRegisterEntry,
  readRegisterJournal,
} from "../../../outbound/proposal/register/store.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseProposalFeedbackArgs } from "./registerCoreFeedback.js";
import { parseProposalListArgs, parseProposalShowArgs } from "./registerCoreRead.js";
import { type ProposalRegisterDeps, refuse, refuseParse, VERB_ARG_OFFSET } from "./registerRunShared.js";

/** The readable, one-entry-per-line summary a human scans `proposal list` for. */
function entryLine({ entry }: { entry: RegisterEntry }): string {
  const parts = [entry.slug, `(${entry.status})`, entry.title];
  if (entry.supersededBy !== undefined) {
    parts.push(`→ superseded by ${entry.supersededBy}`);
  }
  return parts.join("  ");
}

/**
 * One folded piece of feedback, with whether it has been answered stated rather than implied.
 *
 * An item of a kind that owes nothing is never labelled UNANSWERED, however long it sits without a reply.
 * "Nobody has replied to this acknowledgement" is not a debt, and printing it as one is the manufactured work
 * `ANSWER_OWING_FEEDBACK_KINDS` exists to prevent.
 */
function feedbackLine({ feedback }: { feedback: RegisterFeedback }): string {
  const owed = feedbackIsUnanswered({ feedback }) ? "UNANSWERED" : "no answer owed";
  const answered =
    feedback.answer === undefined ? owed : `answered ${feedback.answer.answeredIso}: ${feedback.answer.how}`;
  const where = feedback.where === undefined ? "" : ` <${feedback.where}>`;
  return `feedback ${feedback.id} (${feedback.feedbackKind}) ${feedback.who}: ${feedback.what}${where} — ${answered}`;
}

/** One journal event as a single readable line — the sequence `--history` prints, never the fold. */
function historyLine({ event }: { event: RegisterEvent }): string {
  const what = ((): string => {
    switch (event.kind) {
      case "created":
        return `created (${event.source}) ${event.title}`;
      case "destination-linked":
        return `destination-linked ${addressLabel({ address: event.address })}`;
      case "status-changed":
        return `status → ${event.status}: ${event.why}`;
      case "decided":
        return `${event.outcome} by ${event.decider} on ${event.decidedIso}: ${event.decision}`;
      case "superseded":
        return `superseded by ${event.by}: ${event.why}`;
      case "slack-linked":
        return `slack ${event.permalink}`;
      case "follow-up-added":
        return `follow-up ${event.ref}${event.label === undefined ? "" : ` (${event.label})`}`;
      case "audience-set":
        return `audience ${event.audience}`;
      case "feedback-recorded":
        return `feedback ${event.id} (${event.feedbackKind}) from ${event.who}: ${event.what}`;
      case "feedback-answered":
        return `feedback ${event.id} answered: ${event.how}`;
    }
  })();
  return `${event.atIso}  ${what}`;
}

/** The readable, full detail `proposal show` prints. */
function entryLines({ entry }: { entry: RegisterEntry }): readonly string[] {
  const lines = [
    `${entry.slug}  (${entry.status})`,
    `title: ${entry.title}`,
    `published: ${addressLabel({ address: entry.address })}`,
    ...(entry.intakeId !== undefined ? [`intake: ${entry.intakeId}`] : []),
    ...(entry.audience !== undefined ? [`audience: ${entry.audience}`] : []),
    ...(entry.statusSummary !== undefined ? [`why: ${entry.statusSummary}`] : []),
  ];
  if (entry.decision !== undefined) {
    lines.push(
      `decision (${entry.decision.outcome}): ${entry.decision.text} — ${entry.decision.decider}, ` +
        entry.decision.decidedIso,
    );
  }
  if (entry.supersededBy !== undefined) {
    lines.push(`superseded by: ${entry.supersededBy}`);
  }
  for (const permalink of entry.slackPermalinks) {
    lines.push(`slack: ${permalink}`);
  }
  for (const followUp of entry.followUps) {
    lines.push(`follow-up: ${followUp.ref}${followUp.label !== undefined ? ` (${followUp.label})` : ""}`);
  }
  for (const item of entry.feedback) {
    lines.push(feedbackLine({ feedback: item }));
  }
  lines.push(`created: ${entry.createdIso}`, `updated: ${entry.updatedIso}`, `source: ${entry.source}`);
  return lines;
}

/**
 * Every registered entry, folded, WITH the slugs that could not be folded named rather than dropped.
 *
 * The previous version silently skipped an unreadable journal, so an aggregate read over a register with a
 * broken file reported a shorter list and nothing else — indistinguishable from a register that simply held
 * fewer proposals. Every caller reports `failed` to stderr.
 */
function everyEntry({ home }: { home: string }): {
  readonly entries: readonly RegisterEntry[];
  readonly failed: readonly string[];
} {
  const entries: RegisterEntry[] = [];
  const failed: string[] = [];
  for (const slug of listRegisterSlugs({ home })) {
    const loaded = loadRegisterEntry({ home, slug });
    if (loaded.isErr() || loaded.value === undefined) {
      failed.push(slug);
      continue;
    }
    entries.push(loaded.value);
  }
  return { entries, failed: failed.toSorted((a, b) => a.localeCompare(b)) };
}

/** Report every slug an aggregate read could not fold, so a short list is never mistaken for a small register. */
function reportFailed({ deps, failed }: { deps: ProposalRegisterDeps; failed: readonly string[] }): void {
  for (const slug of failed) {
    deps.err(`${slug}: journal could not be read or holds no created event — omitted from this answer`);
  }
}

/**
 * Every piece of feedback across these entries, what is OWED first — and everything else after it, so one
 * query shows both what was said and what was done about it.
 *
 * The owed half is ordered by `unansweredFeedback`, the same pure function `--unanswered` filters down to, so
 * narrowing the query can never re-order what is left. The rest is everything the owed half did not claim,
 * computed as a REMAINDER rather than as its own predicate: written as "answered", an unanswered
 * acknowledgement matched neither half and silently disappeared from the plain listing.
 */
function feedbackRows({
  entries,
}: {
  entries: readonly RegisterEntry[];
}): readonly { readonly slug: string; readonly feedback: RegisterFeedback }[] {
  const owed = unansweredFeedback({ entries }).map((item) => ({ feedback: item.feedback, slug: item.slug }));
  const owedIds = new Set(owed.map((row) => `${row.slug}\u0000${row.feedback.id}`));
  const rest = entries
    .flatMap((entry) => entry.feedback.map((feedback) => ({ feedback, slug: entry.slug })))
    .filter((row) => !owedIds.has(`${row.slug}\u0000${row.feedback.id}`));
  return [...owed, ...rest.toSorted((a, b) => a.feedback.recordedIso.localeCompare(b.feedback.recordedIso))];
}

/**
 * Run `proposal list`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runProposalList({ argv, deps }: { argv: readonly string[]; deps: ProposalRegisterDeps }): number {
  const parsed = parseProposalListArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuseParse({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  const scan = everyEntry({ home });
  reportFailed({ deps, failed: scan.failed });
  const all = scan.entries.toSorted((a, b) => a.slug.localeCompare(b.slug));
  const filtered = args.status === undefined ? all : all.filter((entry) => entry.status === args.status);
  if (args.json) {
    deps.out(JSON.stringify(filtered, null, 2));
  } else {
    for (const entry of filtered) {
      deps.out(entryLine({ entry }));
    }
  }
  return EXIT_OK;
}

/**
 * Run `proposal show`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runProposalShow({ argv, deps }: { argv: readonly string[]; deps: ProposalRegisterDeps }): number {
  const parsed = parseProposalShowArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuseParse({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  const loaded = loadRegisterEntry({ home, slug: args.slug });
  if (loaded.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [loaded.error.message] });
  }
  if (loaded.value === undefined) {
    return refuse({ code: EXIT_EXPECTED_EMPTY, deps, lines: [`no proposal registered under "${args.slug}"`] });
  }
  const entry = loaded.value;
  if (!args.history) {
    deps.out(args.json ? JSON.stringify(entry, null, 2) : entryLines({ entry }).join("\n"));
    return EXIT_OK;
  }
  // `--history` prints the SEQUENCE, which is a different question from the fold: "what is this now" versus
  // "what happened to it, in order, with the reason attached to each move". Reading the raw `.jsonl` was the
  // only way to answer the second one until this flag existed.
  const journal = readRegisterJournal({ home, slug: args.slug });
  if (journal.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [journal.error.message] });
  }
  const { events, unreadable } = journal.value;
  if (args.json) {
    deps.out(JSON.stringify({ entry, events, unreadable }, null, 2));
  } else {
    deps.out(
      [...entryLines({ entry }), "history:", ...events.map((event) => `  ${historyLine({ event })}`)].join("\n"),
    );
  }
  // Reported, never swallowed: a line this build cannot decode means the history above is INCOMPLETE, and a
  // silently short history reads exactly like a proposal nothing happened to.
  for (const line of unreadable) {
    deps.err(`journal line ${String(line)} could not be decoded by this build — the history above is incomplete`);
  }
  return EXIT_OK;
}

/**
 * Run `proposal feedback` — the read side, across every proposal unless narrowed to one.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runProposalFeedback({ argv, deps }: { argv: readonly string[]; deps: ProposalRegisterDeps }): number {
  const parsed = parseProposalFeedbackArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuseParse({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  const scan = everyEntry({ home });
  reportFailed({ deps, failed: scan.failed });
  const all = scan.entries.toSorted((a, b) => a.slug.localeCompare(b.slug));
  const scoped = args.slug === undefined ? all : all.filter((entry) => entry.slug === args.slug);
  // `--unanswered` filters by the SAME rule the ordering above uses, so the flag narrows the list rather than
  // producing a different one — a plain `answer === undefined` here would resurrect the acknowledgements.
  const items = feedbackRows({ entries: scoped })
    .filter((row) => !args.unansweredOnly || feedbackIsUnanswered({ feedback: row.feedback }))
    .filter((row) => args.feedbackKind === undefined || row.feedback.feedbackKind === args.feedbackKind);
  if (args.json) {
    deps.out(JSON.stringify(items, null, 2));
    return EXIT_OK;
  }
  for (const row of items) {
    deps.out(`${row.slug}  ${feedbackLine({ feedback: row.feedback })}`);
  }
  return EXIT_OK;
}
