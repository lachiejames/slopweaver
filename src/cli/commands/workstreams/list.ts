/**
 * `slopweaver workstreams list` — their workstreams register, read from the store, each workstream's progress derived
 * against its own milestones.
 *
 * Reads the store behind the retired file's tombstone (`../../../workstreams/store/register.ts`) and nothing else.
 * `--json` prints ONE schema-version-2 document (`../../../workstreams/store/projection.ts`), the shape the console's
 * Workstreams page reads (`site/lib/workstreamTiles.ts`) and `workstreams put --file` takes back: the register is a
 * bounded document, not a growing ledger, so one object is the honest shape rather than a `whole-file-json` exception.
 *
 * An empty store — no workstream and no register document — exits 3, "no workstreams yet"; every refusal of the store
 * exits 1, so the console never reads an outage as an empty register.
 */
import { logger } from "#lib/logger.js";
import { readOrgChart } from "../../../corpus/members/orgChartStore.js";
import { type SlackPerson, slackPeopleFor } from "../../../corpus/members/slackPeople.js";
import { readAllMembers } from "../../../corpus/members/store.js";
import { slopweaverHome } from "../../../homeDir.js";
import { typedWorkstreamDetail } from "../../../workstreams/store/decode.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import { memberIds, type ProjectedWorkstream, projectRegister } from "../../../workstreams/store/projection.js";
import { isEmptyRegister, productionWorkstreamRegister } from "../../../workstreams/store/register.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseWorkstreamsListArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { WORKSTREAMS_LIST_USAGE } from "./usage.js";

/** Everything `workstreams list` touches outside itself, injected so a test drives the whole verb. */
export interface WorkstreamsListDeps {
  /** The register: production's is the store behind the tombstone. */
  readonly store: WorkstreamStore;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** Who each Slack member id is, off member bronze and the org chart; an id it does not hold is left out. */
  readonly peopleFor: (args: {
    readonly home: string | undefined;
    readonly ids: readonly string[];
  }) => readonly SlackPerson[];
}

/**
 * A closing workstream's line: its ending, or when it closed, how much story it kept and what state it is in.
 *
 * @returns the line
 */
function closingLineOf({
  detail,
  one,
}: {
  detail: { closedOn: string | null; ending: { on: string; reason: string } | null; state: string };
  one: ProjectedWorkstream;
}): string {
  if (detail.ending !== null) {
    return `${one.name}  abandoned ${detail.ending.on}: ${detail.ending.reason}`;
  }
  const closed = detail.closedOn === null ? "closed date not recorded" : `closed ${detail.closedOn}`;
  let evidence = `${String(one.entries.length)} dated entries`;
  if (one.entries.length === 0) {
    evidence = "no cited timeline";
  } else if (one.entries.length === 1) {
    evidence = "1 dated entry";
  }
  return `${one.name}  ${one.derived.lane}  ${closed}  ${evidence}  ${detail.state}`;
}

/**
 * One line a reader scans for a workstream, in the page's order: at risk first.
 *
 * @returns the line
 */
function lineOf({ one }: { one: ProjectedWorkstream }): string {
  const { derived } = one;
  const typed = typedWorkstreamDetail({ aggregate: one });
  if (typed.kind === "local") {
    return `${one.name}  kept here only`;
  }
  if (typed.kind === "closing") {
    return closingLineOf({ detail: typed.detail, one });
  }
  let moved = "no dated entry yet";
  if (derived.lastMovedOn !== null) {
    moved = `last moved ${derived.lastMovedOn}`;
  }
  const waitingOn = typed.detail.waitingOn;
  let waiting = "";
  if (waitingOn !== null) {
    waiting = `  waiting on ${waitingOn.on === "you" ? "you" : waitingOn.who}: ${waitingOn.what}`;
  }
  if (typed.kind === "linked") {
    const { gauge } = typed.detail;
    const short = derived.gauge === null ? 0 : derived.gauge.short;
    return `${one.name}  ${derived.lane}  ${typed.detail.leads}  ${String(gauge.value)} of ${String(gauge.of)}, ${String(short)} short of ${gauge.gateLabel}  ${moved}${waiting}`;
  }
  return `${one.name}  ${derived.lane}  ${typed.detail.statusNote}  ${String(derived.progressLine)}  ${moved}${waiting}`;
}

/**
 * Run `workstreams list` against injected seams.
 *
 * @param rest the argv tail after `workstreams list`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runWorkstreamsList({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: WorkstreamsListDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(WORKSTREAMS_LIST_USAGE);
    return EXIT_OK;
  }
  const parsed = parseWorkstreamsListArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(WORKSTREAMS_LIST_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = stringFlag({ name: "home", values });
  const read = await deps.store.read({ home: rootOf({ home }) });
  if (read.isErr()) {
    deps.writeDiagnostic(`workstreams list: ${read.error.code}: ${read.error.message}`);
    return EXIT_ERROR;
  }
  if (isEmptyRegister({ snapshot: read.value })) {
    deps.writeDiagnostic("workstreams list: no workstreams yet — the store holds none and no register document");
    return EXIT_EXPECTED_EMPTY;
  }
  const document = projectRegister({ snapshot: read.value });
  if (values["json"] === true) {
    // The roster is joined only for the document the page reads: the plain listing names nobody.
    const people = deps.peopleFor({ home, ids: memberIds({ workstreams: document.workstreams }) });
    deps.writeOut(JSON.stringify({ ...document, people }));
    return EXIT_OK;
  }
  for (const one of document.workstreams) {
    deps.writeOut(lineOf({ one }));
  }
  return EXIT_OK;
}

/**
 * The home a roster read lands under: the one `--home` named, else their own.
 *
 * @returns the directory
 */
function rootOf({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}

/**
 * The real seams: the two output channels, and the member roster read only when the register names somebody.
 *
 * @returns the production dependencies for {@link runWorkstreamsList}
 */
export function productionWorkstreamsListDeps(): WorkstreamsListDeps {
  return {
    store: productionWorkstreamRegister(),
    peopleFor: ({ home, ids }) => {
      if (ids.length === 0) {
        return [];
      }
      const root = rootOf({ home });
      const members = readAllMembers({ home: root });
      const org = readOrgChart({ home: root });
      for (const warning of [...members.warnings, ...org.warnings]) {
        logger.warn({ msg: warning });
      }
      return slackPeopleFor({ ids, orgChart: org.chart, rows: members.rows });
    },
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver workstreams list`. */
export const workstreamsListCommand = defineCommand({
  run: (argv) => runWorkstreamsList({ deps: productionWorkstreamsListDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
