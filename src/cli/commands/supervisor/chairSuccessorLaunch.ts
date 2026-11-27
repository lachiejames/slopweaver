/**
 * Seating a supervisor successor in a visible app card, from a doc already written: the one spawn both a Recovery press
 * (`../fleet/recoverChair.ts`) and the control plane's chair hand-off (`./chairHandOffRun.ts`) run.
 *
 * `cmux spawn --harness app` opens it with an explicit `--driver`, `--model` and `--plan`, as a chair's own hand-off
 * spells it (`../../../supervisor/chairSuccessor.ts`'s `successorSpawnLine`): Fable on a Claude plan, the fleet's
 * Codex model on a Codex one. No model is asked whether to seat it, and the card is the owner's to watch (rule 2).
 *
 * The spawn is a seam so a test counts calls and writes the ledger row itself; production runs `cmux spawn`
 * in-process, its output collected so the caller's own lines stay the only ones printed.
 */
import { CODEX_MODEL } from "../../../codex/profiles.js";
import { boundedReason } from "../../../fleet/recoveryCheck.js";
import type { RecoveryChairOpenFailure } from "../../../fleet/recoveryPassDeps.js";
import { collectOutput } from "../../../lib/outputCollect.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { foldSessions, parseSessionLog, type SessionItem } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { runCmuxSpawn, spawnExitWhy } from "../cmux/run.js";

/** How much of a nested verb's stderr a reason keeps. */
const KEPT_ERR_CHARS = 2_000;

/** The vendor a successor boots on. */
export type SuccessorVendor = "claude" | "codex";

/** Runs `cmux spawn` with the successor's arguments (everything after `spawn`), answering its exit code. */
export type SuccessorSpawn = (input: { argv: readonly string[] }) => Promise<number>;

/**
 * The model a successor on a vendor boots on: Fable on Claude, the fleet's Codex pin on Codex.
 *
 * @param vendor the vendor the plan belongs to
 * @returns the `--model` value
 */
export function successorModelOf({ vendor }: { vendor: SuccessorVendor }): string {
  if (vendor === "claude") {
    return "fable";
  }
  return CODEX_MODEL;
}

/**
 * The spawn's arguments for one plan, as a chair's own hand-off spells them.
 *
 * @param slug the successor doc's slug
 * @param vendor the plan's vendor, named as `--driver` so the omitted-driver default never picks the host
 * @param alias the plan the successor starts on
 * @param home the state home the spawn reads and records under
 * @returns everything after `cmux spawn`
 */
export function chairSuccessorSpawnArgv({
  slug,
  vendor,
  alias,
  home,
}: {
  slug: string;
  vendor: SuccessorVendor;
  alias: string;
  home: string;
}): string[] {
  return [
    slug,
    "--harness",
    "app",
    "--driver",
    vendor,
    "--model",
    successorModelOf({ vendor }),
    "--plan",
    alias,
    "--home",
    home,
  ];
}

/**
 * The app session the spawn recorded for a slug: its newest open app row.
 *
 * @param home the state home whose session ledger is read
 * @param slug the successor doc's slug
 * @returns the session id, or undefined when no open app row names the slug
 */
export function spawnedSessionId({ home, slug }: { home: string; slug: string }): string | undefined {
  const rows = foldSessions(parseSessionLog({ text: readSessionLogText({ home }) }));
  const row: SessionItem | undefined = rows.findLast(
    (one) => one.slug === slug && one.harness === "app" && one.status === "open",
  );
  return row?.sessionId;
}

/** The last line a nested verb wrote to stderr, for a reason. */
function lastLine({ text }: { text: string }): string {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const last = lines.at(-1);
  if (last === undefined) {
    return "it printed nothing";
  }
  return last;
}

/**
 * What a finished spawn opened. A spawn whose pickup was not proven submitted leaves its seat OPEN and exits non-zero
 * (`cmux/spawn.ts`'s `spawnFailureKeepsWorkspaceOpen`), so an open app row the ledger names is a chair to watch
 * whatever the exit code: calling it refused would close its row and open a second chair beside it. No row is not
 * proof of no chair, since the ledger append is best-effort, so a failure carries the slug and the caller asks the
 * app for a running session under it before counting the spawn refused (`../../../fleet/recoveryRestart.ts`).
 *
 * @param exitCode the spawn's exit code
 * @param sessionId the open app session the ledger names for the doc, when it names one
 * @param failure why the spawn exited non-zero, as its own output said
 * @returns the doc's slug and the new chair's app session, or why no chair opened
 */
export function spawnedChairOf({
  exitCode,
  failure,
  sessionId,
  slug,
}: {
  exitCode: number;
  failure: string;
  sessionId: string | undefined;
  slug: string;
}): Result<{ readonly slug: string; readonly sessionId: string }, RecoveryChairOpenFailure> {
  if (sessionId !== undefined) {
    return ok({ sessionId, slug });
  }
  if (exitCode !== 0) {
    return err({ reason: boundedReason({ text: failure }), slug });
  }
  return err({ reason: `the spawn exited 0 and the ledger names no open app session for ${slug}`, slug });
}

/**
 * Seat a supervisor from a written doc in a visible app card, and read back which session the ledger recorded.
 *
 * @param home the state home the spawn and ledger live under
 * @param slug the successor doc's slug, already written
 * @param vendor the plan's vendor
 * @param alias the plan the successor starts on
 * @param runSpawn runs `cmux spawn` in-process with the successor's arguments
 * @returns the doc's slug and the app's id for the new chair, or why it did not open
 */
export async function launchChairSuccessor({
  home,
  slug,
  vendor,
  alias,
  runSpawn,
}: {
  home: string;
  slug: string;
  vendor: SuccessorVendor;
  alias: string;
  runSpawn: SuccessorSpawn;
}): Promise<Result<{ readonly slug: string; readonly sessionId: string }, RecoveryChairOpenFailure>> {
  const argv = chairSuccessorSpawnArgv({ alias, home, slug, vendor });
  const ran = await collectOutput({ keepErrChars: KEPT_ERR_CHARS, run: async () => runSpawn({ argv }) });
  return spawnedChairOf({
    exitCode: ran.value,
    failure: `${spawnExitWhy({ exitCode: ran.value })}: ${lastLine({ text: ran.err })}`,
    sessionId: spawnedSessionId({ home, slug }),
    slug,
  });
}

/**
 * The real spawn: `cmux spawn`, run in-process.
 *
 * @param argv everything after `cmux spawn`
 * @returns the spawn's exit code
 */
export async function realSuccessorSpawn({ argv }: { argv: readonly string[] }): Promise<number> {
  return runCmuxSpawn(["node", "slopweaver", "cmux", "spawn", ...argv]);
}
