/**
 * The `hygiene-sweep` kind's executor: read the owner's open pull requests into the day's landing packet, publish it,
 * and hand it to the seated session that asked for it.
 *
 * A `hygiene-sweep` row is SPAWN-shaped (`../../../live/automation/definitionShape.ts`), so this runs only inside
 * the ONE visible session `automation seat` opened for it, under `automation run-due --recipe <id> --claim-id <token>`.
 * That session is the consumer: it reads the packet this prints and works it by the procedure in
 * `skills/automation/SKILL.md` § A hygiene-sweep row. Nothing here launches a model, sends to Slack,
 * comments on or closes a pull request, or changes Linear — the landing read is a read, and its one local
 * side effect is the readings ledger `--record-reading` appends to.
 *
 * ## Publish, then print, then settle
 *
 * The packet is validated, written whole to `$SLOPWEAVER_HOME/live/hygiene/github-landing.json`, and only then
 * printed for the session. Any failure before the write leaves yesterday's packet standing and answers a
 * non-zero exit, and `./slotSettle.ts`'s `settleSlot` stamps a firing SUCCEEDED only on 0 or 3 — so every failure here is
 * graded {@link EXIT_ERROR}, whatever the landing verb exited, and a failed read is never stamped a success: a read that
 * answered 3 published nothing, and passing its 3 through would stamp the morning as done.
 */
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { landingPacketOf, planHygieneSweep } from "../../../live/automation/hygieneSweep.js";
import { appendVerbFailureWhy } from "../../../live/automation/verbFailureWhy.js";
import { writeHygieneDocument } from "../../../live/hygiene/reportStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { productionGithubLandingDeps, runGithubLanding } from "../github/landingRun.js";
import { type CollectedLeg, collectLeg } from "./collectLeg.js";
import type { RecipeRunDueDeps, RowOutcome } from "./rowRunners.js";

/** Where the seated session reads what to do with the packet this row prints. */
const PROCEDURE = "skills/automation/SKILL.md § A hygiene-sweep row";

/**
 * Run `github landing` with its stdout collected rather than printed — the production
 * `RecipeRunDueDeps.runGithubLandingRead`.
 *
 * @param rest the argv past `github landing`
 * @returns the landing verb's exit code, every line it wrote to stdout and the tail of its stderr
 */
export async function productionGithubLandingRead({
  rest,
}: {
  readonly rest: readonly string[];
}): Promise<CollectedLeg> {
  return collectLeg({
    run: ({ writeOut }) => runGithubLanding({ deps: { ...productionGithubLandingDeps(), writeOut }, rest }),
  });
}

/**
 * Run one `hygiene-sweep` row: read the landing packet, publish it, and print it for the seated session.
 *
 * `--dry-run` reads nothing and writes nothing: it prints the exact read the row would make. The landing read
 * costs GitHub and Slack search calls, and a dry tick is how a supervisor checks a seat will do what it says.
 *
 * @param definition the due row, known to select the `hygiene-sweep` kind
 * @param deps the injected edges; `runGithubLandingRead` is the read and `writeOut` the session's transcript
 * @param dryRun whether to print the planned read and stop
 * @param home the state home the read runs over and the packet is published under
 * @param base the shared not-yet-run outcome fields
 * @returns what happened, ready to print
 */
export async function runHygieneSweepRow({
  base,
  definition,
  deps,
  dryRun,
  home,
}: {
  readonly base: Omit<RowOutcome, "line">;
  readonly definition: RecipeDefinition;
  readonly deps: RecipeRunDueDeps;
  readonly dryRun: boolean;
  readonly home: string;
}): Promise<RowOutcome> {
  const { recipeId } = definition;
  const plan = planHygieneSweep({ definition, home });
  if (plan.isErr()) {
    return { ...base, failed: true, line: `recipe ${recipeId} · REFUSED · ${plan.error.message}` };
  }
  const read = `github landing ${plan.value.rest.join(" ")}`;
  if (dryRun) {
    return { ...base, line: `recipe ${recipeId} · would run · slopweaver ${read}` };
  }
  const path = stateHomePaths({ home }).live.hygiene.githubLanding;
  const landed = await deps.runGithubLandingRead({ rest: plan.value.rest });
  const kept = `${path} is unchanged`;
  if (landed.exitCode !== EXIT_OK) {
    return failedAfterRead({
      base,
      line: appendVerbFailureWhy({
        diagnostics: landed.diagnostics,
        line: `recipe ${recipeId} · READ FAILED · slopweaver ${read} · exit ${String(landed.exitCode)} · ${kept}`,
      }),
    });
  }
  const packet = landingPacketOf({ lines: landed.lines, recipeId });
  if (packet.isErr()) {
    // A zero exit with no packet is still the read's failure, so its stderr is still the cause.
    return failedAfterRead({
      base,
      line: appendVerbFailureWhy({
        diagnostics: landed.diagnostics,
        line: `recipe ${recipeId} · NO PACKET · ${packet.error.message} · ${kept}`,
      }),
    });
  }
  const written = writeHygieneDocument({ chunks: [packet.value, "\n"], path });
  if (written.isErr()) {
    return failedAfterRead({ base, line: `recipe ${recipeId} · NOT PUBLISHED · ${written.error.join("; ")}` });
  }
  deps.writeOut(packet.value);
  return {
    ...base,
    exitCode: EXIT_OK,
    line: `recipe ${recipeId} · ran · landing packet published to ${path} · work it by ${PROCEDURE}`,
    ran: true,
  };
}

/**
 * The outcome for a read that published nothing — graded {@link EXIT_ERROR} whatever the landing verb exited,
 * so the slot is not stamped.
 *
 * @param base the shared not-yet-run outcome fields
 * @param line the one line naming what went wrong
 * @returns the failed outcome
 */
function failedAfterRead({ base, line }: { base: Omit<RowOutcome, "line">; line: string }): RowOutcome {
  return { ...base, exitCode: EXIT_ERROR, failed: true, line, ran: true };
}
