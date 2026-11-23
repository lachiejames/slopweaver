/**
 * `slopweaver workstreams retitle` — give a mined candidate the title the person wants, keeping the mined name as its
 * identity. Every rule is in `../../../workstreams/titles.ts` and the write is one critical section in
 * `../../../workstreams/titleStore.ts`.
 */
import { randomUUID } from "node:crypto";

import { logger } from "#lib/logger.js";
import type { CandidatesError } from "../../../workstreams/candidateErrors.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import { productionWorkstreamRegister } from "../../../workstreams/store/register.js";
import { recordTitle, type TitleReceipt } from "../../../workstreams/titleStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseWorkstreamsRetitleArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { sessionNamed, viaOf } from "./react.js";
import { WORKSTREAMS_RETITLE_USAGE } from "./usage.js";

/** Everything `workstreams retitle` touches outside itself, injected so a test drives the whole verb. */
export interface WorkstreamsRetitleDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The instant it was given. */
  readonly now: () => string;
  /** The workstream register the accepted candidate's workstream is in. */
  readonly store: WorkstreamStore;
  /** A fresh canonical UUID for the note it writes. */
  readonly mintId: () => string;
}

/**
 * The exit code a failed amendment maps to: a refused amendment is a caller mistake, anything else an error. Shared by
 * every verb that amends a candidate in their words.
 *
 * @returns the exit code
 */
export function amendmentExit({ error }: { error: CandidatesError }): number {
  if (error.code === "AMENDMENT_REFUSED") {
    return EXIT_USAGE;
  }
  return EXIT_ERROR;
}

/** Print what was written: the receipt whole under `--json`, else what stands and where it landed. */
function printReceipt({
  json,
  receipt,
  writeOut,
}: {
  json: boolean;
  receipt: TitleReceipt;
  writeOut: (line: string) => void;
}): void {
  if (json) {
    writeOut(JSON.stringify(receipt));
    return;
  }
  const { row } = receipt;
  const verb = receipt.appended ? "recorded" : "already stood";
  writeOut(`${row.candidate}  titled "${row.title}" (mined as "${row.name}"; ${verb})`);
  if (receipt.appliedTo !== null) {
    writeOut(`${row.candidate}'s register entry ${receipt.appliedTo} carries the title`);
  }
}

/**
 * Run `workstreams retitle` against injected seams.
 *
 * @param rest the argv tail after `workstreams retitle`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runWorkstreamsRetitle({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: WorkstreamsRetitleDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(WORKSTREAMS_RETITLE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseWorkstreamsRetitleArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(WORKSTREAMS_RETITLE_USAGE);
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const candidateId = stringFlag({ name: "candidate", values });
  const title = stringFlag({ name: "title", values });
  if (candidateId === undefined || title === undefined) {
    deps.writeDiagnostic("workstreams retitle: --candidate <id> and --title <their title> are both needed");
    deps.writeDiagnostic(WORKSTREAMS_RETITLE_USAGE);
    return EXIT_USAGE;
  }
  const via = viaOf({ viaFlag: stringFlag({ name: "via", values }) });
  if (via.isErr()) {
    deps.writeDiagnostic(`workstreams retitle: ${via.error.line}`);
    return via.error.exit;
  }
  const home = stringFlag({ name: "home", values });
  const by = stringFlag({ name: "by-session", values });
  const recorded = await recordTitle({
    ...(home === undefined ? {} : { home }),
    bySession: sessionNamed({ by }),
    candidateId,
    mintId: deps.mintId,
    nowIso: deps.now(),
    store: deps.store,
    title,
    via: via.value,
  });
  if (recorded.isErr()) {
    deps.writeDiagnostic(`workstreams retitle: ${recorded.error.message}`);
    return amendmentExit({ error: recorded.error });
  }
  printReceipt({ json: values["json"] === true, receipt: recorded.value, writeOut: deps.writeOut });
  return EXIT_OK;
}

/**
 * The real seams: the two output channels, the clock, the register and the id minter.
 *
 * @returns the production dependencies for {@link runWorkstreamsRetitle}
 */
export function productionWorkstreamsRetitleDeps(): WorkstreamsRetitleDeps {
  return {
    mintId: () => randomUUID(),
    now: () => new Date().toISOString(),
    store: productionWorkstreamRegister(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver workstreams retitle`. */
export const workstreamsRetitleCommand = defineCommand({
  run: (argv) => runWorkstreamsRetitle({ deps: productionWorkstreamsRetitleDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
