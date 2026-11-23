/**
 * `proposal list`, `show`, `status`, `decide`, `supersede`, `record-slack`, `follow-up`, `record-feedback`,
 * `answer-feedback` and `feedback` — the register's own read and mutation verbs. Every mutation is one typed
 * event appended through `../../../outbound/proposal/register/store.ts`; none of them touch Notion or Slack,
 * so none of them is `external-write` or door-routed. `proposal drift` is the one register verb that reads
 * the network, and it lives in `./driftRun.ts` for exactly that reason.
 */
import { logger } from "../../../lib/logger.js";
import { appendRegisterEvent } from "../../../outbound/proposal/register/store.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  parseProposalAudienceArgs,
  parseProposalDecideArgs,
  parseProposalFollowUpArgs,
  parseProposalRecordSlackArgs,
  parseProposalStatusArgs,
  parseProposalSupersedeArgs,
} from "./registerCore.js";
import { runProposalAnswerFeedback, runProposalRecordFeedback } from "./registerRunFeedbackWrite.js";
import { runProposalFeedback, runProposalList, runProposalShow } from "./registerRunRead.js";
import {
  announce,
  type ProposalRegisterDeps,
  refuse,
  refuseParse,
  resolveEntry,
  VERB_ARG_OFFSET,
} from "./registerRunShared.js";

export { type ProposalRegisterDeps, refuse, runProposalFeedback, runProposalList, runProposalShow, VERB_ARG_OFFSET };

/** When a decision was made: `--date` as given, or — not given — the moment it is being recorded. */
function decidedAt({ given, now }: { given: string | undefined; now: Date }): string {
  if (given === undefined) {
    return now.toISOString();
  }
  return given;
}

/**
 * Run `proposal status`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runProposalStatus({ argv, deps }: { argv: readonly string[]; deps: ProposalRegisterDeps }): number {
  const parsed = parseProposalStatusArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuseParse({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (resolveEntry({ deps, home, slug: args.slug }) === undefined) {
    return EXIT_EXPECTED_EMPTY;
  }
  const appended = appendRegisterEvent({
    event: {
      atIso: deps.now().toISOString(),
      kind: "status-changed",
      occurredIso: args.occurredIso,
      status: args.status,
      why: args.why,
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
    line: `${args.slug} → ${args.status}`,
    payload: { occurredIso: args.occurredIso, slug: args.slug, status: args.status },
  });
}

/**
 * Run `proposal decide`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runProposalDecide({ argv, deps }: { argv: readonly string[]; deps: ProposalRegisterDeps }): number {
  const parsed = parseProposalDecideArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuseParse({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (resolveEntry({ deps, home, slug: args.slug }) === undefined) {
    return EXIT_EXPECTED_EMPTY;
  }
  const now = deps.now();
  const decidedIso = decidedAt({ given: args.decidedIso, now });
  const appended = appendRegisterEvent({
    event: {
      atIso: now.toISOString(),
      decidedIso,
      decider: args.decider,
      decision: args.decision,
      kind: "decided",
      outcome: args.outcome,
      why: args.why,
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
    line: `${args.slug} → ${args.outcome === "rejected" ? "rejected" : "decided"}: ${args.decision}`,
    payload: {
      decidedIso,
      decider: args.decider,
      decision: args.decision,
      outcome: args.outcome,
      slug: args.slug,
    },
  });
}

/**
 * Run `proposal supersede`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runProposalSupersede({ argv, deps }: { argv: readonly string[]; deps: ProposalRegisterDeps }): number {
  const parsed = parseProposalSupersedeArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuseParse({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (resolveEntry({ deps, home, slug: args.slug }) === undefined) {
    return EXIT_EXPECTED_EMPTY;
  }
  if (args.by === args.slug) {
    return refuse({ code: EXIT_USAGE, deps, lines: [`a proposal cannot supersede itself (${args.slug})`] });
  }
  const appended = appendRegisterEvent({
    event: {
      atIso: deps.now().toISOString(),
      by: args.by,
      kind: "superseded",
      occurredIso: args.occurredIso,
      why: args.why,
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
    line: `${args.slug} → superseded by ${args.by}`,
    payload: { by: args.by, occurredIso: args.occurredIso, slug: args.slug, status: "superseded" },
  });
}

/**
 * Run `proposal record-slack`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runProposalRecordSlack({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ProposalRegisterDeps;
}): number {
  const parsed = parseProposalRecordSlackArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuseParse({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (resolveEntry({ deps, home, slug: args.slug }) === undefined) {
    return EXIT_EXPECTED_EMPTY;
  }
  const appended = appendRegisterEvent({
    event: { atIso: deps.now().toISOString(), kind: "slack-linked", permalink: args.permalink },
    home,
    slug: args.slug,
  });
  if (appended.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [appended.error.message] });
  }
  return announce({
    deps,
    json: args.json,
    line: `${args.slug} ← ${args.permalink}`,
    payload: { permalink: args.permalink, slug: args.slug },
  });
}

/**
 * Run `proposal follow-up`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runProposalFollowUp({ argv, deps }: { argv: readonly string[]; deps: ProposalRegisterDeps }): number {
  const parsed = parseProposalFollowUpArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuseParse({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (resolveEntry({ deps, home, slug: args.slug }) === undefined) {
    return EXIT_EXPECTED_EMPTY;
  }
  const appended = appendRegisterEvent({
    event: {
      atIso: deps.now().toISOString(),
      kind: "follow-up-added",
      label: args.label,
      occurredIso: args.occurredIso,
      ref: args.ref,
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
    line: `${args.slug} ← follow-up ${args.ref}`,
    payload: { label: args.label, occurredIso: args.occurredIso, ref: args.ref, slug: args.slug },
  });
}

/**
 * Run `proposal audience`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runProposalAudience({ argv, deps }: { argv: readonly string[]; deps: ProposalRegisterDeps }): number {
  const parsed = parseProposalAudienceArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuseParse({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (resolveEntry({ deps, home, slug: args.slug }) === undefined) {
    return EXIT_EXPECTED_EMPTY;
  }
  const appended = appendRegisterEvent({
    event: { atIso: deps.now().toISOString(), audience: args.audience, kind: "audience-set" },
    home,
    slug: args.slug,
  });
  if (appended.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [appended.error.message] });
  }
  return announce({
    deps,
    json: args.json,
    line: `${args.slug} → audience: ${args.audience}`,
    payload: { audience: args.audience, slug: args.slug },
  });
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionProposalRegisterDeps(): ProposalRegisterDeps {
  return {
    err: (line) => process.stderr.write(`proposal: ${line}\n`),
    now: () => new Date(),
    out: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver proposal list` — every proposal, optionally filtered by status. */
export const proposalListCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalList({ argv, deps: productionProposalRegisterDeps() }),
});

/** `slopweaver proposal show` — one proposal's full register entry. */
export const proposalShowCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalShow({ argv, deps: productionProposalRegisterDeps() }),
});

/** `slopweaver proposal status` — a non-terminal status change, with its reason. */
export const proposalStatusCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalStatus({ argv, deps: productionProposalRegisterDeps() }),
});

/** `slopweaver proposal decide` — records a decision atomically, setting status to `decided`. */
export const proposalDecideCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalDecide({ argv, deps: productionProposalRegisterDeps() }),
});

/** `slopweaver proposal supersede` — records a supersession atomically, setting status to `superseded`. */
export const proposalSupersedeCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalSupersede({ argv, deps: productionProposalRegisterDeps() }),
});

/** `slopweaver proposal record-slack` — records a Slack announce permalink against a proposal. */
export const proposalRecordSlackCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalRecordSlack({ argv, deps: productionProposalRegisterDeps() }),
});

/** `slopweaver proposal follow-up` — records a follow-up this proposal spawned. */
export const proposalFollowUpCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalFollowUp({ argv, deps: productionProposalRegisterDeps() }),
});

/** `slopweaver proposal record-feedback` — record what somebody said about a proposal, and what kind of thing it was. */
export const proposalRecordFeedbackCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalRecordFeedback({ argv, deps: productionProposalRegisterDeps() }),
});

/** `slopweaver proposal answer-feedback` — close one recorded piece of feedback with what was done about it. */
export const proposalAnswerFeedbackCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalAnswerFeedback({ argv, deps: productionProposalRegisterDeps() }),
});

/** `slopweaver proposal feedback` — every recorded piece of feedback, pushback first, filterable to the unanswered. */
export const proposalFeedbackCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalFeedback({ argv, deps: productionProposalRegisterDeps() }),
});

/** `slopweaver proposal audience` — record who a proposal is addressed to; the missing writer for `audience-set`. */
export const proposalAudienceCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalAudience({ argv, deps: productionProposalRegisterDeps() }),
});
