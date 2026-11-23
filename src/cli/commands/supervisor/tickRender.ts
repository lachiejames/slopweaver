/**
 * `supervisor tick close`'s in-process page render: `briefing render` run with its form handed over and every
 * page and line it prints captured rather than written.
 *
 * Split out of {@link ./tickRun.js} (the file-size ratchet), which states the verb's four sub-actions; how the
 * chair's form becomes a page is a seam of its own, and the one a unit test replaces with its in-memory ledger.
 */
import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import {
  briefingAutonomyReader,
  productionBriefingRenderDeps,
  runBriefingRenderDetailed,
} from "../briefing/renderRun.js";
import type { TickRenderOutcome } from "./tickDeps.js";

/**
 * Render one form through `briefing render` in process: the form is handed over rather than read, and every page
 * and every line the render prints are captured rather than written.
 *
 * Pages are captured BY PATH, because a refusal writes a second one beside `--out` and prints where. One
 * variable for every write turned that refused page into the `--out` page and dropped it, so the path the chair
 * was told to read never existed (three passes).
 *
 * @returns what the render produced
 */
export async function renderInProcess({
  argv,
  formText,
}: {
  argv: readonly string[];
  formText: string;
}): Promise<TickRenderOutcome> {
  return renderInProcessOver({ argv, autonomy: autonomyLedgerPort(), formText });
}

/**
 * {@link renderInProcess} over a given autonomy ledger — the seam a unit test hands its in-memory port, so the
 * real render runs without reaching the operator's store.
 *
 * @param autonomy the ledger the page's "done for you, without asking" section reads
 * @returns what the render produced
 */
export async function renderInProcessOver({
  argv,
  autonomy,
  formText,
}: {
  argv: readonly string[];
  autonomy: AutonomyLedgerPort;
  formText: string;
}): Promise<TickRenderOutcome> {
  const diagnostics: string[] = [];
  const pages = new Map<string, string>();
  const { exitCode, refusalCode } = await runBriefingRenderDetailed({
    deps: {
      ...productionBriefingRenderDeps(),
      readAutonomy: briefingAutonomyReader({ autonomy }),
      readForm: () => formText,
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        diagnostics.push(line);
      },
      writePage: ({ html, path }) => {
        pages.set(path, html);
      },
    },
    rest: argv,
  });
  return { diagnostics, exitCode, pages, refusalCode };
}
