/**
 * `slopweaver hand recheck` — settle every open step whose precondition is already met, before the owner ever opens its card.
 *
 * A sign-in card the owner clicked can open straight onto the dashboard when the owner is already
 * signed in, so when the supervisor ticks, this command clears the card if its condition is
 * met. So the tick runs this ahead of the sign-in monitor (`../../../supervisor/scratch/tickCapture.ts`), and a
 * `mon-signin-*` card it settles is then HELD by that monitor rather than re-posted (`../../../monitor/
 * resyncSignedOut.ts`'s `signInAnswered`), which is also what lets `automation seat` run the stopped resync again.
 *
 * The pure half is `../../../hand/recheck.ts`; the reads are `../../../hand/recheckProbes.ts`. Every settling is ONE
 * lock-held append, a step no longer open under the lock is skipped, and only a written settling closes its note — the
 * shape `../../../hand/reconcile.ts` settles evidence in.
 */
import { appendHandSettlements } from "../../../hand/multiAppend.js";
import { dismissHandNote } from "../../../hand/note/markers.js";
import {
  type RecheckLine,
  type RecheckObservation,
  type RecheckReport,
  recheckDid,
  recheckPlan,
  recheckReport,
} from "../../../hand/recheck.js";
import { liveRecheckProbes, type RecheckProbeDeps } from "../../../hand/recheckProbes.js";
import { reconcileHandSteps } from "../../../hand/reconcile.js";
import { buildSettledRow, type SettledRow } from "../../../hand/row.js";
import { readOpenHandSteps } from "../../../hand/store.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseHandRecheckArgs, RECHECK_USAGE, VERB_ARG_OFFSET } from "./core.js";
import {
  bySession,
  type HandDeps,
  productionHandDeps,
  reportReconciled,
  reportUnparsed,
  resolvedHomeOf,
} from "./deps.js";

/** What the pass printed and settled. */
interface RecheckOutcome {
  /** Already met, and settled by this pass. */
  readonly retired: readonly RecheckLine[];
  /** Already met, but settled by someone else under the lock — nothing for this pass to write. */
  readonly alreadySettled: readonly string[];
  readonly unmet: readonly RecheckLine[];
  readonly unread: readonly RecheckLine[];
  readonly unchecked: number;
  readonly dryRun: boolean;
}

/**
 * Read each distinct precondition once.
 *
 * @param probes the plan's probes
 * @param read the two reads
 * @param home the state home
 * @returns each probe's answer, by key
 */
async function observe({
  probes,
  read,
  home,
}: {
  probes: ReturnType<typeof recheckPlan>["probes"];
  read: RecheckProbeDeps;
  home: string;
}): Promise<ReadonlyMap<string, RecheckObservation>> {
  const observations = new Map<string, RecheckObservation>();
  // One at a time, never in parallel: every sign-in visit takes the machine's one relay lease.
  for (const probe of probes) {
    try {
      const observation =
        probe.recheck.kind === "browser-session"
          ? await read.browserSession({ home, origin: probe.recheck.origin })
          : await read.slackMember({ channel: probe.recheck.channel, home });
      observations.set(probe.key, observation);
    } catch (cause) {
      // A read that threw proved nothing either way: its steps stay, and the rest of the pass still runs.
      const why = cause instanceof Error ? cause.message : String(cause);
      observations.set(probe.key, { kind: "unread", why: `${probe.key} threw: ${why}` });
    }
  }
  return observations;
}

/**
 * Settle the open steps' evidence first, as every hand verb does — skipped on a dry run, which writes nothing.
 *
 * @param dryRun whether the pass may write
 * @param by who is settling
 * @param home the state home
 * @param deps the output channels and clock
 * @returns false when the register would not reconcile, already reported
 */
function reconciledFirst({
  dryRun,
  by,
  home,
  deps,
}: {
  dryRun: boolean;
  by: string;
  home: string;
  deps: HandDeps;
}): boolean {
  if (dryRun) {
    return true;
  }
  const reconciled = reconcileHandSteps({ bySession: by, home, nowIso: deps.now() });
  if (reconciled.isErr()) {
    deps.writeDiagnostic(`hand recheck: ${reconciled.error.message}`);
    return false;
  }
  reportReconciled({ deps, outcome: reconciled.value, verb: "hand recheck" });
  return true;
}

/**
 * Settle every met step in one append and close each written one's note — or, on a dry run, name each as if written.
 *
 * @param report what the pass found
 * @param dryRun whether the pass may write
 * @param home the state home
 * @param nowIso the settling instant
 * @param by who is settling
 * @returns the ids written and the ids someone else had settled first, or the failure's message
 */
function settleMet({
  report,
  dryRun,
  home,
  nowIso,
  by,
}: {
  report: RecheckReport;
  dryRun: boolean;
  home: string;
  nowIso: string;
  by: string;
}):
  { written: ReadonlySet<string>; skipped: readonly string[]; unclosedNotes: readonly string[] } | { failure: string } {
  if (dryRun) {
    return { skipped: [], unclosedNotes: [], written: new Set(report.met.map((line) => line.id)) };
  }
  const rows: SettledRow[] = [];
  for (const line of report.met) {
    const built = buildSettledRow({
      draft: { bySession: by, did: recheckDid({ nowIso, observed: line.because }), id: line.id, settledIso: nowIso },
    });
    if (built.isErr()) {
      return { failure: `${line.id}: ${built.error.message}` };
    }
    rows.push(built.value);
  }
  const appended = appendHandSettlements({ home, nowIso, rows });
  if (appended.isErr()) {
    return { failure: appended.error.message };
  }
  const written = new Set(appended.value.ids);
  const unclosedNotes = [...written].flatMap((id) =>
    dismissHandNote({ home, id, nowIso }).match(
      () => [],
      (problem) => [`${id}'s note did not close: ${problem.message}`],
    ),
  );
  return { skipped: appended.value.skipped, unclosedNotes, written };
}

/**
 * Print the pass.
 *
 * @param outcome what it did
 * @param json one JSON document instead of lines
 * @param deps the output channels
 */
function printPass({ outcome, json, deps }: { outcome: RecheckOutcome; json: boolean; deps: HandDeps }): void {
  if (json) {
    deps.writeOut(JSON.stringify(outcome));
    return;
  }
  const verb = outcome.dryRun ? "would retire" : "retired";
  outcome.retired.forEach(({ id, because }) => {
    deps.writeOut(`hand recheck: ${verb} ${id} — already met: ${because}`);
  });
  outcome.unmet.forEach(({ id, because }) => {
    deps.writeOut(`hand recheck: still needed ${id} — ${because}`);
  });
  outcome.unread.forEach(({ id, because }) => {
    deps.writeOut(`hand recheck: unread ${id} — ${because}; it stays open and the next pass reads again`);
  });
  deps.writeOut(
    `hand recheck: ${String(outcome.retired.length)} ${verb}, ${String(outcome.unmet.length)} still needed, ` +
      `${String(outcome.unread.length)} unread, ${String(outcome.unchecked)} name no precondition the fleet reads`,
  );
}

/**
 * Run `hand recheck` against injected seams.
 *
 * @param rest the argv tail after `hand recheck`
 * @param deps the hand verbs' seams
 * @param probes the two reads
 * @returns 0 when a step named a precondition, 3 when none did, 1 when the register would not read or take the append
 */
export async function runHandRecheck({
  rest,
  deps,
  probes,
}: {
  rest: readonly string[];
  deps: HandDeps;
  probes: RecheckProbeDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECHECK_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHandRecheckArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(RECHECK_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = resolvedHomeOf({ values });
  const by = bySession({ values });
  const dryRun = values["dry-run"] === true;
  if (!reconciledFirst({ by, deps, dryRun, home })) {
    return EXIT_ERROR;
  }
  const open = readOpenHandSteps({ home });
  if (open.isErr()) {
    deps.writeDiagnostic(`hand recheck: ${open.error.message}`);
    return EXIT_ERROR;
  }
  reportUnparsed({ deps, unparsed: open.value.unparsed, verb: "hand recheck" });
  const plan = recheckPlan({ steps: open.value.steps });
  const observations = await observe({ home, probes: plan.probes, read: probes });
  const found = recheckReport({ observations, probes: plan.probes, unchecked: plan.unchecked });
  const settled = settleMet({ by, dryRun, home, nowIso: deps.now(), report: found });
  if ("failure" in settled) {
    deps.writeDiagnostic(`hand recheck: nothing was settled — ${settled.failure}`);
    return EXIT_ERROR;
  }
  settled.unclosedNotes.forEach((problem) => {
    deps.writeDiagnostic(`hand recheck: ${problem}`);
  });
  printPass({
    deps,
    json: values["json"] === true,
    outcome: {
      alreadySettled: settled.skipped,
      dryRun,
      retired: found.met.filter((line) => settled.written.has(line.id)),
      unchecked: found.unchecked.length,
      unmet: found.unmet,
      unread: found.unread,
    },
  });
  return plan.probes.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** `slopweaver hand recheck`. */
export const handRecheckCommand = defineCommand({
  run: (argv) =>
    runHandRecheck({ deps: productionHandDeps(), probes: liveRecheckProbes(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
