/**
 * `slopweaver handover steers` — every steer the owner gave on a call and whether it has been applied
 * (`../../../handover/steers.ts`). The console's Alignment page reads `--json` for its steers section.
 *
 * Reads the board, the run journals, each named repository's main and the PR ledger, and nothing else: no probe, no
 * fetch, no network, no model.
 */
import type { IngestError } from "#lib/ingestError.js";

import type { SteerEntry, SteerState } from "../../../handover/steers.js";
import { readSteersReport, type SteersReport } from "../../../handover/steersRead.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";

/** The flags `handover steers` accepts, and the ONLY place they are named. */
const STEERS_FLAG_SPEC = { boolean: ["json"], string: ["home"] } as const;

/** Where a verb's own arguments start in `process.argv`: `[node, cli, handover, steers, …]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Every flag `handover steers` advertises, derived from the spec it parses with.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const HANDOVER_STEERS_FLAG_NAMES: readonly string[] = [
  ...STEERS_FLAG_SPEC.string,
  ...STEERS_FLAG_SPEC.boolean,
].map((name) => `--${name}`);

/** What one `handover steers` invocation asked for. */
export interface HandoverSteersArgs {
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse `handover steers`'s argument tail, strictly, before anything is read.
 *
 * @param rest the argv tail, after `handover steers`
 * @returns the arguments, or every rejection at once
 */
export function parseHandoverSteersArgs({ rest }: { readonly rest: readonly string[] }): Result<HandoverSteersArgs> {
  const parsed = parseFlags({ args: rest, spec: STEERS_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  let home: string | undefined;
  if (typeof values["home"] === "string") {
    home = values["home"];
  }
  return ok({ home, json: values["json"] === true });
}

/**
 * One state as a few words, the way the human listing prints it.
 *
 * @param state where a steer stands
 * @returns the words
 */
export function steerStateWords({ state }: { state: SteerState }): string {
  switch (state.kind) {
    case "applied": {
      return `applied — #${String(state.landing.number)} landed ${state.landing.mergedIso}`;
    }
    case "landing-unknown": {
      return `landing unknown — ${state.why}`;
    }
    case "settled": {
      if (state.witnessPr !== undefined) {
        return `settled ${state.settlement} on ${state.witnessPr.repo}#${String(state.witnessPr.number)}, which is not on main as read`;
      }
      let witness = "";
      if (state.witness !== undefined) {
        witness = ` (${state.witness})`;
      }
      return `settled ${state.settlement}, nothing landed${witness}`;
    }
    case "ended": {
      return `ended ${state.status}, nothing landed`;
    }
    case "in-flight": {
      return "in flight";
    }
    case "run-closed": {
      return "a run closed on it, nothing landed";
    }
    case "waiting": {
      return "not started";
    }
    default: {
      const exhausted: never = state;
      return exhausted;
    }
  }
}

/** One steer's quote as one short line. */
function steerLine({ steer }: { steer: SteerEntry }): string {
  let text = steer.title;
  if (steer.words !== undefined) {
    text = steer.words.words;
  }
  if (text.length > 140) {
    text = `${text.slice(0, 139)}…`;
  }
  let times = "";
  if (steer.timesGiven > 1) {
    times = ` · said ${String(steer.timesGiven)} times`;
  }
  let at = "(no instant)";
  if (steer.askedIso !== undefined) {
    at = steer.askedIso;
  }
  return `${at}  ${steer.slug}${times}\n    ${steerStateWords({ state: steer.state })}\n    "${text}"`;
}

/**
 * The human reading of a report: the counts, then one entry per steer.
 *
 * @param report what was read
 * @returns the lines
 */
export function renderSteersLines({ report }: { report: SteersReport }): readonly string[] {
  const applied = report.steers.filter((steer) => steer.state.kind === "applied").length;
  const lines = [`${String(report.steers.length)} steers, ${String(applied)} applied`];
  for (const repo of report.repos) {
    if (repo.kind === "unread") {
      lines.push(`  ${repo.dir}: main would not read — ${repo.why}`);
    }
  }
  for (const steer of report.steers) {
    lines.push(steerLine({ steer }));
  }
  return lines;
}

/**
 * The `--json` document. An absent field is written as `null` rather than dropped, so the console's reader can tell
 * "the report says there is none" from "the report no longer carries that field" and refuse the second.
 *
 * @param report what was read
 * @returns one line of JSON
 */
export function steersJson({ report }: { report: SteersReport }): string {
  return JSON.stringify(report, (_key, value: unknown) => {
    if (value === undefined) {
      return null;
    }
    return value;
  });
}

/** What `handover steers` touches outside itself. */
export interface HandoverSteersDeps {
  readonly now: () => string;
  readonly defaultHome: () => string;
  readonly readReport: (request: { home: string; nowIso: string }) => Result<SteersReport, IngestError>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `handover steers` against injected seams.
 *
 * @param rest the argv tail after `handover steers`
 * @param deps the clock, the default home, the reader and the two output channels
 * @returns the process exit code
 */
export function runHandoverSteers({ rest, deps }: { rest: readonly string[]; deps: HandoverSteersDeps }): number {
  const args = parseHandoverSteersArgs({ rest });
  if (args.isErr()) {
    deps.writeDiagnostic(`handover steers: ${args.error.join("; ")}`);
    return EXIT_USAGE;
  }
  const { home = deps.defaultHome() } = args.value;
  const report = deps.readReport({ home, nowIso: deps.now() });
  if (report.isErr()) {
    deps.writeDiagnostic(`handover steers: the board would not scan: ${report.error.message}`);
    return EXIT_ERROR;
  }
  if (args.value.json) {
    deps.writeOut(steersJson({ report: report.value }));
    return EXIT_OK;
  }
  renderSteersLines({ report: report.value }).forEach((line) => {
    deps.writeOut(line);
  });
  return EXIT_OK;
}

/** `slopweaver handover steers`. */
export const handoverSteersCommand = defineCommand({
  run: (argv) =>
    runHandoverSteers({
      deps: {
        defaultHome: slopweaverHome,
        now: () => new Date().toISOString(),
        readReport: readSteersReport,
        writeDiagnostic: (line) => {
          logger.error({ msg: line });
        },
        writeOut: (line) => {
          logger.out({ line });
        },
      },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
