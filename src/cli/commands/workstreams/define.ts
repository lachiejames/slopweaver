/**
 * `slopweaver workstreams define` — record what DONE means for a mined candidate: an offered option or their words.
 *
 * The console sends it before the yes it goes with, so the yes carries it onto the tile; a definition picked after
 * the yes is carried there by this call. Every rule is in `../../../workstreams/definitions.ts` and the write is
 * one critical section in `../../../workstreams/definitionStore.ts`.
 */
import { randomUUID } from "node:crypto";

import { logger } from "#lib/logger.js";
import type { CandidatesError } from "../../../workstreams/candidateErrors.js";
import { type DefinitionReceipt, recordDefinition } from "../../../workstreams/definitionStore.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import { productionWorkstreamRegister } from "../../../workstreams/store/register.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseWorkstreamsDefineArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { sessionNamed, viaOf } from "./react.js";
import { WORKSTREAMS_DEFINE_USAGE } from "./usage.js";

/** Everything `workstreams define` touches outside itself, injected so a test drives the whole verb. */
export interface WorkstreamsDefineDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The instant it was picked. */
  readonly now: () => string;
  /** The workstream register the accepted candidate's workstream is in. */
  readonly store: WorkstreamStore;
  /** A fresh canonical UUID for the note it writes. */
  readonly mintId: () => string;
}

/**
 * The exit code a failed definition maps to: a pick that does not resolve is a caller mistake, anything else an error.
 * There is no "no candidates yet": an empty catalog names no candidate, so its pick is refused like any unknown id.
 *
 * @returns the exit code
 */
function defineExit({ error }: { error: CandidatesError }): number {
  if (error.code === "DEFINITION_REFUSED") {
    return EXIT_USAGE;
  }
  return EXIT_ERROR;
}

/** Print what was written: the receipt whole under `--json`, else one line saying what stands and where it landed. */
function printReceipt({
  json,
  receipt,
  writeOut,
}: {
  json: boolean;
  receipt: DefinitionReceipt;
  writeOut: (line: string) => void;
}): void {
  if (json) {
    writeOut(JSON.stringify(receipt));
    return;
  }
  const { row } = receipt;
  const verb = receipt.appended ? "recorded" : "already stood";
  writeOut(`${row.candidate}  done means "${row.selection.text}" (${verb})`);
  if (receipt.appliedTo === null) {
    writeOut(`${row.candidate} is not an accepted workstream yet; its yes will carry this onto the tile`);
    return;
  }
  writeOut(`${row.candidate}'s tile ${receipt.appliedTo} says it as its outcome`);
}

/**
 * Run `workstreams define` against injected seams.
 *
 * @param rest the argv tail after `workstreams define`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runWorkstreamsDefine({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: WorkstreamsDefineDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(WORKSTREAMS_DEFINE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseWorkstreamsDefineArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(WORKSTREAMS_DEFINE_USAGE);
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const candidateId = stringFlag({ name: "candidate", values });
  if (candidateId === undefined) {
    deps.writeDiagnostic("workstreams define: --candidate <id> names which candidate — nothing recorded");
    deps.writeDiagnostic(WORKSTREAMS_DEFINE_USAGE);
    return EXIT_USAGE;
  }
  const via = viaOf({ viaFlag: stringFlag({ name: "via", values }) });
  if (via.isErr()) {
    deps.writeDiagnostic(`workstreams define: ${via.error.line}`);
    return via.error.exit;
  }
  const home = stringFlag({ name: "home", values });
  const by = stringFlag({ name: "by-session", values });
  const recorded = await recordDefinition({
    ...(home === undefined ? {} : { home }),
    all: values["all"] === true,
    bySession: sessionNamed({ by }),
    candidateId,
    mintId: deps.mintId,
    first: stringFlag({ name: "first", values }),
    stretch: stringFlag({ name: "stretch", values }),
    nowIso: deps.now(),
    store: deps.store,
    optionId: stringFlag({ name: "option", values }),
    via: via.value,
    words: stringFlag({ name: "text", values }),
  });
  if (recorded.isErr()) {
    deps.writeDiagnostic(`workstreams define: ${recorded.error.message}`);
    return defineExit({ error: recorded.error });
  }
  printReceipt({ json: values["json"] === true, receipt: recorded.value, writeOut: deps.writeOut });
  return EXIT_OK;
}

/**
 * The real seams: the two output channels, the clock, the register and the id minter.
 *
 * @returns the production dependencies for {@link runWorkstreamsDefine}
 */
export function productionWorkstreamsDefineDeps(): WorkstreamsDefineDeps {
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

/** `slopweaver workstreams define`. */
export const workstreamsDefineCommand = defineCommand({
  run: (argv) => runWorkstreamsDefine({ deps: productionWorkstreamsDefineDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
