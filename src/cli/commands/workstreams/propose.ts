/**
 * `slopweaver workstreams propose` — record a workstream the person proposes in their own words, beside a mined
 * candidate or outright. The rules are in `../../../workstreams/proposals.ts` and the write is one critical section in
 * `../../../workstreams/proposalStore.ts`.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { recordProposal } from "../../../workstreams/proposalStore.js";
import { PROPOSAL_RELATIONS, type ProposalRow } from "../../../workstreams/proposals.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseWorkstreamsProposeArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { sessionNamed, viaOf } from "./react.js";
import { amendmentExit } from "./retitle.js";
import { WORKSTREAMS_PROPOSE_USAGE } from "./usage.js";

/** Everything `workstreams propose` touches outside itself, injected so a test drives the whole verb. */
export interface WorkstreamsProposeDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The instant it was proposed. */
  readonly now: () => string;
}

/** The relations a proposal said beside a candidate may take — every one but `own`, which is the absence of `--from`. */
const BESIDE = PROPOSAL_RELATIONS.filter((one) => one !== "own");

/**
 * How the proposal stands to the candidate it was said beside: `--from` and `--relation` together, or neither for one
 * proposed outright.
 *
 * @param from the `--from` value, when given
 * @param relation the `--relation` value, when given
 * @returns the relation and the candidate, or the usage line
 */
function relationOf({
  from,
  relation,
}: {
  from: string | undefined;
  relation: string | undefined;
}): Result<Pick<ProposalRow, "from" | "relation">, string> {
  if (from === undefined && relation === undefined) {
    return ok({ from: null, relation: "own" });
  }
  if (from === undefined || relation === undefined) {
    return err("--from <candidate id> and --relation split|instead|sibling go together; give neither for one outright");
  }
  const known = BESIDE.find((one) => one === relation);
  if (known === undefined) {
    return err(`--relation is one of ${BESIDE.join(", ")}, not ${relation}`);
  }
  return ok({ from, relation: known });
}

/**
 * A free-text flag as the row records it: its value, or `null` when it was not given.
 *
 * @returns the value, or `null`
 */
function textOrNull({ name, values }: { name: string; values: Readonly<Record<string, unknown>> }): string | null {
  const value = stringFlag({ name, values });
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * Run `workstreams propose` against injected seams.
 *
 * @param rest the argv tail after `workstreams propose`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runWorkstreamsPropose({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: WorkstreamsProposeDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(WORKSTREAMS_PROPOSE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseWorkstreamsProposeArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(WORKSTREAMS_PROPOSE_USAGE);
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const title = stringFlag({ name: "title", values });
  if (title === undefined) {
    deps.writeDiagnostic("workstreams propose: --title <their words> names the workstream — nothing recorded");
    deps.writeDiagnostic(WORKSTREAMS_PROPOSE_USAGE);
    return EXIT_USAGE;
  }
  const relation = relationOf({
    from: stringFlag({ name: "from", values }),
    relation: stringFlag({ name: "relation", values }),
  });
  if (relation.isErr()) {
    deps.writeDiagnostic(`workstreams propose: ${relation.error}`);
    return EXIT_USAGE;
  }
  const via = viaOf({ viaFlag: stringFlag({ name: "via", values }) });
  if (via.isErr()) {
    deps.writeDiagnostic(`workstreams propose: ${via.error.line}`);
    return via.error.exit;
  }
  const home = stringFlag({ name: "home", values });
  const by = stringFlag({ name: "by-session", values });
  const recorded = await recordProposal({
    ...(home === undefined ? {} : { home }),
    asked: {
      ...relation.value,
      anchor: textOrNull({ name: "anchor", values }),
      bySession: sessionNamed({ by }),
      title,
      via: via.value,
      why: textOrNull({ name: "why", values }),
    },
    nowIso: deps.now(),
  });
  if (recorded.isErr()) {
    deps.writeDiagnostic(`workstreams propose: ${recorded.error.message}`);
    return amendmentExit({ error: recorded.error });
  }
  reportProposal({ deps, json: values["json"] === true, row: recorded.value });
  return EXIT_OK;
}

/**
 * Print the row recorded: the row itself under `--json`, else one line naming it and what the next mine owes.
 *
 * @param json whether `--json` was given
 */
function reportProposal({ deps, json, row }: { deps: WorkstreamsProposeDeps; json: boolean; row: ProposalRow }): void {
  if (json) {
    deps.writeOut(JSON.stringify(row));
    return;
  }
  const beside = row.from === null ? "outright" : `${row.relation} ${row.from}`;
  deps.writeOut(`${row.id}  "${row.title}" proposed ${beside}; the next mine owes it a candidate`);
}

/**
 * The real seams: the two output channels and the clock.
 *
 * @returns the production dependencies for {@link runWorkstreamsPropose}
 */
export function productionWorkstreamsProposeDeps(): WorkstreamsProposeDeps {
  return {
    now: () => new Date().toISOString(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver workstreams propose`. */
export const workstreamsProposeCommand = defineCommand({
  run: (argv) => runWorkstreamsPropose({ deps: productionWorkstreamsProposeDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
