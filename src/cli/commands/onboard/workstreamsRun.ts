/**
 * `slopweaver onboard workstreams` — where onboarding's workstreams step stands: pull, mine, react or answered, and
 * whether the main screen has anything real on it yet.
 *
 * Reads local files and nothing else: the bronze each onboard source holds (a readdir and a stat, never a corpus
 * load) and the candidates document `workstreams candidates` joins. The verdict is `src/onboard/workstreams.ts`'s.
 */
import { logger } from "#lib/logger.js";
import { listBronzeFiles } from "../../../corpus/bronzeStorage.js";
import { ONBOARD_SOURCES } from "../../../onboard/sources.js";
import { type MinedState, onboardWorkstreamsState, type SourceHeld } from "../../../onboard/workstreams.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import { productionWorkstreamRegister } from "../../../workstreams/store/register.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { documentAt } from "../workstreams/candidates.js";
import { parseOnboardWorkstreamsArgs, stringFlag } from "../workstreams/core.js";

import { ONBOARD_WORKSTREAMS_USAGE } from "./usage.js";

const VERB_ARG_OFFSET = 4;

/** Bytes in a mebibyte, the unit the human line prints a source's bronze in. */
const MIB = 1024 * 1024;

/** Everything the verb touches outside itself, injected so a test drives the whole verb. */
export interface OnboardWorkstreamsDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The store-backed register the candidates document joins. */
  readonly store: WorkstreamStore;
}

/**
 * What the last mine wrote, or `null` when nothing has been mined yet — the stated built-ins alone are not a mine; any
 * failure to read the candidates stops the verb.
 *
 * @returns the mined state, `null`, or the line saying why it will not read
 */
async function minedAt({
  home,
  store,
}: {
  home: string;
  store: WorkstreamStore;
}): Promise<{ mined: MinedState | null } | { refused: string }> {
  const document = await documentAt({ home, store });
  if (document.isErr()) {
    return { refused: document.error.line };
  }
  const { candidates, counts, mined, proposalOwed } = document.value;
  if (mined === null) {
    return { mined: null };
  }
  return {
    mined: {
      candidates: candidates.length,
      minedIso: mined.minedIso,
      minedSources: mined.minedSources.map((one) => one.source),
      proposalOwed: proposalOwed.length,
      unanswered: counts.unanswered,
    },
  };
}

/**
 * Run `onboard workstreams` against injected seams.
 *
 * @param rest the argv tail after `onboard workstreams`
 * @returns the process exit code: the human form exits 3 at `pull`, while no source holds anything and nothing has
 *   been mined; `--json` exits 0 on every state it prints
 */
export async function runOnboardWorkstreams({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OnboardWorkstreamsDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(ONBOARD_WORKSTREAMS_USAGE);
    return EXIT_OK;
  }
  const parsed = parseOnboardWorkstreamsArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of [...parsed.error, ONBOARD_WORKSTREAMS_USAGE]) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = resolveHome({ named: stringFlag({ name: "home", values }) });
  const read = await minedAt({ home, store: deps.store });
  if ("refused" in read) {
    deps.writeDiagnostic(`onboard workstreams: ${read.refused}`);
    return EXIT_ERROR;
  }
  const measured = everySourceHeld({ home });
  if ("refused" in measured) {
    deps.writeDiagnostic(`onboard workstreams: ${measured.refused}`);
    return EXIT_ERROR;
  }
  const { held } = measured;
  const state = onboardWorkstreamsState({ held, mined: read.mined });
  if (values["json"] === true) {
    // Exit 0 on every state, `pull` included: a machine reader treats a non-zero exit as a failed read, and the fresh
    // install is a real state to report, never a failure.
    deps.writeOut(JSON.stringify({ ...state, held }));
    return EXIT_OK;
  }
  const holding = held
    .filter((one) => one.bytes > 0)
    .map((one) => `${one.source} ${String(Math.ceil(one.bytes / MIB))} MiB`);
  deps.writeOut(`step: ${state.step}${state.reveal ? " — the console has candidates to show" : ""}`);
  deps.writeOut(`pulled: ${holding.length === 0 ? "nothing yet" : holding.join(" · ")}`);
  deps.writeOut(`next: ${state.next}`);
  return state.step === "pull" ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * Every onboard source in `ONBOARD_SOURCES` order with the bronze bytes it holds, zero for one never pulled — so a
 * reader sees the whole set without keeping a second list of the sources.
 *
 * Listed strictly: a source directory that exists and cannot be listed refuses the whole reading rather than counting
 * as zero, because an unlistable history is not an absent one. Files are sized by `stat` and never opened.
 *
 * @returns one row per onboard source, or the line saying which source could not be listed
 */
function everySourceHeld({ home }: { home: string }): { held: SourceHeld[] } | { refused: string } {
  const held: SourceHeld[] = [];
  for (const source of ONBOARD_SOURCES) {
    const files = listBronzeFiles({ home, source, strict: true });
    if (files.isErr()) {
      if (files.error.code === "BRONZE_LIST_PROTECTED") {
        return { refused: files.error.message };
      }
      return { refused: `${source}'s local history directory exists but cannot be listed: ${files.error.message}` };
    }
    held.push({ bytes: files.value.reduce((total, file) => total + file.bytes, 0), source });
  }
  return { held };
}

/** `slopweaver onboard workstreams`. */
export const onboardWorkstreamsCommand = defineCommand({
  run: (argv) =>
    runOnboardWorkstreams({
      deps: {
        store: productionWorkstreamRegister(),
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
