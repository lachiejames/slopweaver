/**
 * `slopweaver workstreams who-first` — record who the first conversation about a candidate is with, as people, apart
 * from the team that owns it. The rules are in `../../../workstreams/whoFirst.ts` and the write in
 * `../../../workstreams/whoFirstStore.ts`. Nothing is sent.
 */
import { logger } from "#lib/logger.js";
import { peopleFrom } from "../../../workstreams/whoFirst.js";
import { recordWhoFirst, type WhoFirstReceipt } from "../../../workstreams/whoFirstStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseWorkstreamsWhoFirstArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { sessionNamed, viaOf } from "./react.js";
import { amendmentExit } from "./retitle.js";
import { WORKSTREAMS_WHO_FIRST_USAGE } from "./usage.js";

/** Everything `workstreams who-first` touches outside itself, injected so a test drives the whole verb. */
export interface WorkstreamsWhoFirstDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The instant they said it. */
  readonly now: () => string;
}

/**
 * Run `workstreams who-first` against injected seams.
 *
 * @param rest the argv tail after `workstreams who-first`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runWorkstreamsWhoFirst({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: WorkstreamsWhoFirstDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(WORKSTREAMS_WHO_FIRST_USAGE);
    return EXIT_OK;
  }
  const parsed = parseWorkstreamsWhoFirstArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(WORKSTREAMS_WHO_FIRST_USAGE);
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const candidateId = stringFlag({ name: "candidate", values });
  const said = stringFlag({ name: "people", values });
  const team = stringFlag({ name: "team", values });
  if (candidateId === undefined || (said === undefined && team === undefined)) {
    deps.writeDiagnostic("workstreams who-first: --candidate <id> and --people <names> or --team <team> are needed");
    deps.writeDiagnostic(WORKSTREAMS_WHO_FIRST_USAGE);
    return EXIT_USAGE;
  }
  const via = viaOf({ viaFlag: stringFlag({ name: "via", values }) });
  if (via.isErr()) {
    deps.writeDiagnostic(`workstreams who-first: ${via.error.line}`);
    return via.error.exit;
  }
  const home = stringFlag({ name: "home", values });
  const by = stringFlag({ name: "by-session", values });
  const recorded = await recordWhoFirst({
    ...(home === undefined ? {} : { home }),
    bySession: sessionNamed({ by }),
    candidateId,
    nowIso: deps.now(),
    people: said === undefined ? [] : peopleFrom({ said }),
    // oxlint-disable-next-line prefer-nullish-coalescing -- no-silent-fallback bans `?? null`; no team is by design
    team: team === undefined ? null : team,
    via: via.value,
  });
  if (recorded.isErr()) {
    deps.writeDiagnostic(`workstreams who-first: ${recorded.error.message}`);
    return amendmentExit({ error: recorded.error });
  }
  if (values["json"] === true) {
    deps.writeOut(JSON.stringify(recorded.value));
    return EXIT_OK;
  }
  deps.writeOut(whoFirstLine(recorded.value));
  return EXIT_OK;
}

/**
 * The one line a recorded who-first prints.
 *
 * @param appended false when the same people and team already stood
 * @param row the row as recorded
 * @returns the line
 */
function whoFirstLine({ appended, row }: WhoFirstReceipt): string {
  const people = row.people.length === 0 ? "nobody named" : row.people.join(", ");
  // oxlint-disable-next-line prefer-nullish-coalescing -- no-silent-fallback bans `?? "…"`; this ternary is the honest form
  const owning = row.team === null ? "no team named" : row.team;
  return `${row.candidate}  first: ${people}; owning team: ${owning} (${appended ? "recorded" : "already stood"})`;
}

/**
 * The real seams: the two output channels and the clock.
 *
 * @returns the production dependencies for {@link runWorkstreamsWhoFirst}
 */
export function productionWorkstreamsWhoFirstDeps(): WorkstreamsWhoFirstDeps {
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

/** `slopweaver workstreams who-first`. */
export const workstreamsWhoFirstCommand = defineCommand({
  run: (argv) =>
    runWorkstreamsWhoFirst({ deps: productionWorkstreamsWhoFirstDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
