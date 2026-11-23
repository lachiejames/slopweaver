/**
 * `slopweaver proposal draft` and `slopweaver proposal lint` — the effectful shells.
 *
 * Neither touches the network and neither runs a model. `draft` renders a validated form into the golden
 * markdown with pure code and writes it; `lint` reads a file and reports. The one piece of state either
 * consults is the operator's private voice-rule list from `profile.json`.
 *
 * `draft` self-lints what it just wrote and prints the findings. That is not ceremony: the renderer
 * guarantees the SHAPE, and the lint gate judges the WORDS, which are the session's rather than the
 * renderer's. A freshly drafted proposal can and does come back with real findings.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Result } from "#lib/result.js";
import { logger } from "../../../lib/logger.js";
import { lintProposal, proposalFindingLines } from "../../../outbound/proposal/lint/lintProposal.js";
import { proposalEmoji, proposalTitle, renderProposal } from "../../../outbound/proposal/render.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";
import { type ProfileReadError, readExactVoiceRules } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseProposalDraftArgs, parseProposalForm, parseProposalLintArgs } from "./core.js";
import { proposalErrorLines } from "./errors.js";
import { PROPOSAL_FORM_EXAMPLE } from "./formExample.js";

/** Where a verb's own arguments start in `process.argv`: after node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface ProposalDeps {
  readonly readText: (args: { source: string }) => string;
  readonly writeText: (args: { path: string; text: string }) => void;
  /** The operator's exact voice rules, or why `profile.json` is there but cannot be trusted. */
  readonly voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionProposalDeps(): ProposalDeps {
  return {
    err: (line) => process.stderr.write(`proposal: ${line}\n`),
    out: (line) => {
      logger.out({ line });
    },
    readText: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8")),
    voiceRules: ({ home }) => readExactVoiceRules({ home }),
    writeText: ({ path, text }) => {
      writeFileSync(path, text);
    },
  };
}

/** Print each line to stderr and return the code. */
function refuse({ deps, lines, code }: { deps: ProposalDeps; lines: readonly string[]; code: number }): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/**
 * Refuse a verb whose voice rules could not be read. A corrupt `profile.json` is a fact about the install,
 * not a lint finding, so it exits with the error code: read as no rules, every phrase the owner bans would pass.
 */
function unreadableProfile({
  deps,
  error,
  nothingHappened,
}: {
  deps: ProposalDeps;
  error: ProfileReadError;
  nothingHappened: string;
}): number {
  return refuse({ code: EXIT_ERROR, deps, lines: [`refused: ${error.message}. ${nothingHappened}`] });
}

/**
 * Run `proposal draft`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runProposalDraft({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ProposalDeps;
}): Promise<number> {
  const parsed = parseProposalDraftArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: proposalErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  if (args.kind === "example") {
    deps.out(JSON.stringify(PROPOSAL_FORM_EXAMPLE, null, 2));
    return EXIT_OK;
  }
  const form = parseProposalForm({ raw: deps.readText({ source: args.formSource }) });
  if (form.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: proposalErrorLines({ error: form.error }) });
  }
  // Read before anything is written: a draft its own self-lint could not judge is refused whole, rather than
  // handed over reading "lint: clean" against no voice rules.
  const voiceRules = deps.voiceRules({ home: resolveHome({ named: args.home }) });
  if (voiceRules.isErr()) {
    return unreadableProfile({ deps, error: voiceRules.error, nothingHappened: "nothing was written." });
  }
  const markdown = renderProposal({ form: form.value });
  if (args.out !== undefined) {
    deps.writeText({ path: args.out, text: markdown });
    deps.err(`draft written: ${args.out}`);
    deps.err(`title: ${proposalTitle({ form: form.value })}   icon: ${proposalEmoji({ form: form.value })}`);
  } else {
    deps.out(markdown.trimEnd());
  }
  const { findings, blocked } = lintProposal({ markdown, voiceRules: voiceRules.value });
  for (const line of proposalFindingLines({ findings })) {
    deps.err(line);
  }
  // The DRAFT verb never fails on its own lint. The renderer owns the shape and got it right; the findings
  // are about words the session wrote, and reporting them while still handing over the file is what lets the
  // session fix them. `proposal publish` is the gate that actually refuses.
  deps.err(blocked ? "lint: fix the blocking findings above before publishing." : "lint: clean");
  return EXIT_OK;
}

/**
 * Run `proposal lint`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns 0 when nothing blocks, 2 when something does, or a usage code
 */
export async function runProposalLint({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ProposalDeps;
}): Promise<number> {
  const parsed = parseProposalLintArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: proposalErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  let markdown: string;
  try {
    markdown = deps.readText({ source: args.path });
  } catch {
    return refuse({ code: EXIT_ERROR, deps, lines: [`cannot read ${args.path}`] });
  }
  const voiceRules = deps.voiceRules({ home: resolveHome({ named: args.home }) });
  if (voiceRules.isErr()) {
    return unreadableProfile({ deps, error: voiceRules.error, nothingHappened: "the document was not judged." });
  }
  const { findings, blocked } = lintProposal({ markdown, voiceRules: voiceRules.value });
  // A blocking finding exits `EXPECTED_EMPTY`, never `USAGE`. The linter ran perfectly and found something,
  // which is the diagnostic channel; `USAGE` would say the command itself was typed wrong.
  const code = blocked ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  if (args.json) {
    deps.out(JSON.stringify({ blocked, findings }, null, 2));
    return code;
  }
  for (const line of proposalFindingLines({ findings })) {
    deps.err(line);
  }
  if (!blocked) {
    deps.out(`golden: ${String(findings.length)} warning(s), 0 blocking — ready to publish`);
    return EXIT_OK;
  }
  deps.err("not ready: fix the blocking findings above, then re-run.");
  return code;
}

/** `slopweaver proposal draft` — render the golden markdown from a typed form, then self-lint it. */
export const proposalDraftCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalDraft({ argv, deps: productionProposalDeps() }),
});

/** `slopweaver proposal lint` — the golden gate over one drafted document. */
export const proposalLintCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalLint({ argv, deps: productionProposalDeps() }),
});
