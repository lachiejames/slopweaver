/**
 * `slopweaver private-terms add | narrow | remove | confirm` — THE HANDS-FREE LIST's edit verbs; `list` is `./list.ts`.
 *
 * The owner says or types a rule to the supervisor and never edits `$SLOPWEAVER_HOME/hygiene/private-terms.tsv`.
 * `add`, `narrow` and `remove` PROPOSE an edit and print its read-back; nothing is written until `confirm` names that
 * proposal, after the read-back has gone back to the owner. The pure halves are
 * `../../../hygiene/privateTermsEdit.ts` and `./core.ts`; the store is `../../../hygiene/privateTermsStore.ts`.
 */
import { readFileSync } from "node:fs";

import { applyPrivateTermsEdit, type PrivateTermsEdit, privateTermClassOf } from "../../../hygiene/privateTermsEdit.js";
import {
  confirmPrivateTermsProposal,
  mintPrivateTermId,
  mintPrivateTermsProposalId,
  privateTermsBaseSha256,
  processPidAlive,
  readCurrentPrivateTerms,
  writePrivateTermsProposal,
} from "../../../hygiene/privateTermsStore.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  type PatternInput,
  type PrivateTermProbes,
  type PrivateTermsVerb,
  parsePrivateTermsAddArgs,
  parsePrivateTermsNarrowArgs,
  parsePrivateTermsTargetArgs,
  privateTermsUsage,
  VERB_ARG_OFFSET,
} from "./core.js";
import { printEdgesUnderArgvHomes } from "./printGuard.js";
import { probeOutcomeOf, probesHeld, readBackLines } from "./readBack.js";

/** The edges the edit verbs run over, injected so a test passes plain values and no mocks. */
export interface PrivateTermsEditDeps {
  readonly out: (args: { line: string }) => void;
  readonly writeDiagnostic: (args: { line: string }) => void;
  readonly nowIso: () => string;
  readonly mintTermId: () => string;
  readonly mintProposalId: () => string;
  readonly readPatternFile: (args: { path: string }) => Result<string, string>;
}

/**
 * Production edges: the logger, the wall clock, random ids and the filesystem.
 *
 * @returns the deps
 */
export function productionPrivateTermsEditDeps(): PrivateTermsEditDeps {
  return {
    mintProposalId: mintPrivateTermsProposalId,
    mintTermId: mintPrivateTermId,
    nowIso: () => new Date().toISOString(),
    out: logger.out,
    readPatternFile: ({ path }) => {
      try {
        return ok(readFileSync(path, "utf8"));
      } catch (error: unknown) {
        return err(`--pattern-file ${path} could not be read: ${errorMessage({ error })}`);
      }
    },
    writeDiagnostic: ({ line }) => {
      logger.error({ msg: line });
    },
  };
}

/**
 * Print usage problems and the usage line, answering the usage exit code.
 *
 * @param problems every reason the argv was refused
 * @param verb whose usage line follows them
 * @returns the usage exit code
 */
export function failUsage({
  deps,
  problems,
  verb,
}: {
  deps: PrivateTermsEditDeps;
  problems: readonly string[];
  verb: PrivateTermsVerb;
}): number {
  for (const problem of problems) {
    deps.writeDiagnostic({ line: problem });
  }
  deps.writeDiagnostic({ line: privateTermsUsage({ verb }) });
  return EXIT_USAGE;
}

/**
 * Whether the argv asks for help.
 *
 * @param rest the argv after the noun and verb
 * @returns true for `--help` or `-h` anywhere in it
 */
export function asksHelp({ rest }: { rest: readonly string[] }): boolean {
  return rest.includes("--help") || rest.includes("-h");
}

/** The pattern text a verb was given, read from its file when it came as one. */
function patternText({ deps, pattern }: { deps: PrivateTermsEditDeps; pattern: PatternInput }): Result<string, string> {
  if (pattern.kind === "inline") {
    return ok(pattern.text);
  }
  // One line: a single trailing line break is the file's, not the pattern's.
  return deps.readPatternFile({ path: pattern.path }).map((text) => text.replace(/\r?\n$/u, ""));
}

/** Decide one edit, check its probes, keep it as a proposal and print its read-back. */
function propose({
  deps,
  edit,
  home,
  json,
  probes,
}: {
  deps: PrivateTermsEditDeps;
  edit: PrivateTermsEdit;
  home: string;
  json: boolean;
  probes: PrivateTermProbes;
}): number {
  const current = readCurrentPrivateTerms({ home });
  if (current.isErr()) {
    deps.writeDiagnostic({ line: current.error.message });
    return EXIT_ERROR;
  }
  const edited = applyPrivateTermsEdit({ current: current.value, edit, mintId: deps.mintTermId });
  if (edited.isErr()) {
    deps.writeDiagnostic({ line: edited.error.message });
    return edited.error.code === "TERM_NOT_FOUND" || edited.error.code === "NOTHING_TO_CHANGE"
      ? EXIT_USAGE
      : EXIT_ERROR;
  }
  const proposalId = deps.mintProposalId();
  const lines = readBackLines({ action: edit.kind, edited: edited.value, home, probes, proposalId });
  const row = edited.value.edited;
  if (row !== undefined && !probesHeld({ outcome: probeOutcomeOf({ probes, term: row }) })) {
    return refuseFailedProbes({ deps, lines });
  }
  const baseSha256 = privateTermsBaseSha256({ state: current.value });
  const kept = writePrivateTermsProposal({
    home,
    proposal: {
      action: edit.kind,
      baseSha256,
      createdAtIso: deps.nowIso(),
      proposalId,
      schemaVersion: 1,
      termId: edited.value.termId,
      text: edited.value.text,
    },
  });
  if (kept.isErr()) {
    deps.writeDiagnostic({ line: kept.error.message });
    return EXIT_ERROR;
  }
  const printed = json ? [JSON.stringify({ action: edit.kind, proposalId, termId: edited.value.termId })] : lines;
  for (const line of printed) {
    deps.out({ line });
  }
  return EXIT_OK;
}

/** Print a read-back whose probes came out the other way as diagnostics, without its confirm step, and refuse it. */
function refuseFailedProbes({ deps, lines }: { deps: PrivateTermsEditDeps; lines: readonly string[] }): number {
  for (const line of lines.slice(0, -1)) {
    deps.writeDiagnostic({ line });
  }
  deps.writeDiagnostic({
    line: "  a probe came out the other way, so the row does not mean what it was said to; nothing was proposed",
  });
  return EXIT_ERROR;
}

/**
 * Run `private-terms add`: propose one new row carrying the owner's meaning.
 *
 * @param argv the full process argv
 * @param deps the injected edges
 * @returns the exit code
 */
export function runPrivateTermsAdd({
  argv,
  deps: given,
}: {
  argv: readonly string[];
  deps: PrivateTermsEditDeps;
}): number {
  const deps = printEdgesUnderArgvHomes({ argv, deps: given });
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (asksHelp({ rest })) {
    deps.out({ line: privateTermsUsage({ verb: "add" }) });
    return EXIT_OK;
  }
  const parsed = parsePrivateTermsAddArgs({ rest });
  if (parsed.isErr()) {
    return failUsage({ deps, problems: parsed.error, verb: "add" });
  }
  const options = parsed.value;
  const className = privateTermClassOf({ text: options.className });
  if (className.isErr()) {
    return failUsage({ deps, problems: [className.error.message], verb: "add" });
  }
  const pattern = patternText({ deps, pattern: options.pattern });
  if (pattern.isErr()) {
    deps.writeDiagnostic({ line: pattern.error });
    return EXIT_ERROR;
  }
  const edit: PrivateTermsEdit = {
    kind: "add",
    row: {
      allowedWhere: options.allowedWhere,
      caseInsensitive: options.caseInsensitive,
      className: className.value,
      meaning: options.meaning,
      pattern: pattern.value,
      source: options.source,
    },
  };
  return propose({
    deps,
    edit,
    home: resolveHome({ named: options.home }),
    json: options.json,
    probes: options.probes,
  });
}

/**
 * Run `private-terms narrow <term-id>`: propose a changed pattern, case, meaning or allowed place for one row.
 *
 * @param argv the full process argv
 * @param deps the injected edges
 * @returns the exit code
 */
export function runPrivateTermsNarrow({
  argv,
  deps: given,
}: {
  argv: readonly string[];
  deps: PrivateTermsEditDeps;
}): number {
  const deps = printEdgesUnderArgvHomes({ argv, deps: given });
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (asksHelp({ rest })) {
    deps.out({ line: privateTermsUsage({ verb: "narrow" }) });
    return EXIT_OK;
  }
  const parsed = parsePrivateTermsNarrowArgs({ rest });
  if (parsed.isErr()) {
    return failUsage({ deps, problems: parsed.error, verb: "narrow" });
  }
  const options = parsed.value;
  let pattern: string | undefined;
  if (options.pattern !== undefined) {
    const read = patternText({ deps, pattern: options.pattern });
    if (read.isErr()) {
      deps.writeDiagnostic({ line: read.error });
      return EXIT_ERROR;
    }
    pattern = read.value;
  }
  const edit: PrivateTermsEdit = {
    kind: "narrow",
    narrowing: {
      allowedWhere: options.allowedWhere,
      caseInsensitive: options.caseInsensitive,
      meaning: options.meaning,
      pattern,
    },
    termId: options.termId,
  };
  return propose({
    deps,
    edit,
    home: resolveHome({ named: options.home }),
    json: options.json,
    probes: options.probes,
  });
}

/**
 * Run `private-terms remove <term-id>`: propose taking one row out.
 *
 * @param argv the full process argv
 * @param deps the injected edges
 * @returns the exit code
 */
export function runPrivateTermsRemove({
  argv,
  deps: given,
}: {
  argv: readonly string[];
  deps: PrivateTermsEditDeps;
}): number {
  const deps = printEdgesUnderArgvHomes({ argv, deps: given });
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (asksHelp({ rest })) {
    deps.out({ line: privateTermsUsage({ verb: "remove" }) });
    return EXIT_OK;
  }
  const parsed = parsePrivateTermsTargetArgs({ rest, verb: "remove" });
  if (parsed.isErr()) {
    return failUsage({ deps, problems: parsed.error, verb: "remove" });
  }
  const { home, json, target } = parsed.value;
  const edit: PrivateTermsEdit = { kind: "remove", termId: target };
  return propose({ deps, edit, home: resolveHome({ named: home }), json, probes: { matches: [], misses: [] } });
}

/**
 * Run `private-terms confirm <proposal-id>`: land one proposal whose read-back the owner said yes to.
 *
 * @param argv the full process argv
 * @param deps the injected edges
 * @returns the exit code
 */
export function runPrivateTermsConfirm({
  argv,
  deps: given,
}: {
  argv: readonly string[];
  deps: PrivateTermsEditDeps;
}): number {
  const deps = printEdgesUnderArgvHomes({ argv, deps: given });
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (asksHelp({ rest })) {
    deps.out({ line: privateTermsUsage({ verb: "confirm" }) });
    return EXIT_OK;
  }
  const parsed = parsePrivateTermsTargetArgs({ rest, verb: "confirm" });
  if (parsed.isErr()) {
    return failUsage({ deps, problems: parsed.error, verb: "confirm" });
  }
  const { home: named, json, target } = parsed.value;
  const home = resolveHome({ named });
  const landed = confirmPrivateTermsProposal({ home, pidAlive: processPidAlive, proposalId: target });
  if (landed.isErr()) {
    deps.writeDiagnostic({ line: landed.error.message });
    return landed.error.code === "PROPOSAL_UNUSABLE" ? EXIT_USAGE : EXIT_ERROR;
  }
  if (json) {
    deps.out({ line: JSON.stringify(landed.value) });
    return EXIT_OK;
  }
  const { action, path, rows, termId } = landed.value;
  deps.out({ line: `landed: ${action} ${termId}; ${path} holds ${String(rows)} row(s), mode 0600` });
  return EXIT_OK;
}

export const privateTermsAddCommand = defineCommand({
  run: (argv) => runPrivateTermsAdd({ argv, deps: productionPrivateTermsEditDeps() }),
});
export const privateTermsNarrowCommand = defineCommand({
  run: (argv) => runPrivateTermsNarrow({ argv, deps: productionPrivateTermsEditDeps() }),
});
export const privateTermsRemoveCommand = defineCommand({
  run: (argv) => runPrivateTermsRemove({ argv, deps: productionPrivateTermsEditDeps() }),
});
export const privateTermsConfirmCommand = defineCommand({
  run: (argv) => runPrivateTermsConfirm({ argv, deps: productionPrivateTermsEditDeps() }),
});
