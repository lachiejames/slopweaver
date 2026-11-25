/**
 * The live halves of a successor pick: the two questions the plan register alone cannot answer about whether
 * `cmux spawn` would accept the line the hand-off prints, each asked of the SPAWN'S OWN read rather than a second
 * copy of it.
 *
 * - **Codex**: the register says "an unpaused, non-monthly Codex row exists", while the spawn also ranks each row's
 *   live usage, sign-in and cached cap. A Codex-only install whose one row sits at its usage limit would be handed a
 *   spawn line the spawn then refuses. Asking `decideCodexSeat` makes the two answers one answer by construction.
 * - **Ambient Claude**: an unadopted install with no Claude row boots
 *   on the ambient credential only when the spawn reads its Claude side as UNCONFIGURED — a legacy accounts file
 *   that is present but empty is not that, and the spawn refuses it. `readClaudeFleet` is the read that decides.
 *
 * Each is read only once a hand-off is due AND the register picked the branch it confirms, so a staying chair starts
 * no Codex app-server. Neither spends a billed request: the Codex read is the spawn's own fleet read, which files
 * its conclusion to the fleet-cap and sign-in stores exactly as a spawn does; the Claude read is the register plus
 * one file's existence, before any probe.
 *
 * The chair's own boot plans sit here too, read against the same port: the plan each chair session spends is what
 * the cadence weighs before any successor is picked.
 */
import { chairPlanVerdict } from "../../../claude/seatBoot.js";
import { readChairPlansForPids } from "../../../claude/seatBootRead.js";
import { readClaudeFleet, readSpawnAccounts } from "../../../claude/spawnAccounts.js";
import { readCodexAccountsLive } from "../../../codex/accountLive.js";
import { codexFleetCapPort } from "../../../codex/fleetCapPort.js";
import { decideCodexSeat } from "../../../codex/seatDecision.js";
import { codexSignInPort } from "../../../codex/signInPort.js";
import { slopweaverHome } from "../../../config.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import type {
  ChairBootPlanRead,
  ChairSuccessorClaudeSideRead,
  ChairSuccessorCodexSeatRead,
} from "./tickRecordCadence.js";

/**
 * Which plan each chair session is spending, off its boot credential, against EVERY configured plan — a chair
 * booted on a paused plan is still on it. A register that cannot be read, or holds no Claude plan, is named as the
 * reason every session's plan is UNMEASURED; the cadence is advice, so neither fails the tick. The chair's pids are
 * looked up in the session registry again for the process start each records, which binds every credential read to
 * the session's own process — a pid that exited and was reused since lends its session nothing.
 *
 * @param port where the plan register is read, the same port the tick's register read uses
 * @returns the read the cadence names each chair session's plan through
 */
export function liveChairBootPlanRead({ port }: { port: PlanRegisterPort }): ChairBootPlanRead {
  return async ({ chair }) => {
    const accounts = await readSpawnAccounts({ home: slopweaverHome(), port });
    if (accounts.isErr()) {
      return chairPlanVerdict({
        sessions: [],
        unread: `the plan register could not be read: ${accounts.error.message}`,
      });
    }
    if (accounts.value === undefined) {
      return chairPlanVerdict({
        sessions: [],
        unread: "no Claude plan is configured, so no boot credential names one",
      });
    }
    return readChairPlansForPids({
      accounts: accounts.value,
      claudeHome: claudeHomeDir(),
      // An app-hosted chair has no pid to bind a boot credential to, so its plan stays unread rather than guessed.
      pids: chair.sessions.flatMap(({ pid }) => (pid === undefined ? [] : [pid])),
    });
  };
}

/**
 * The production Codex seat read, against the plan register port the tick already holds.
 *
 * @param port where the plan register is read, the same port the tick's register read uses
 * @returns the read the cadence confirms a Codex successor through
 */
export function liveChairCodexSeatRead({ port }: { port: PlanRegisterPort }): ChairSuccessorCodexSeatRead {
  return async ({ home }) => {
    const decided = await decideCodexSeat({
      allowRefusing: false,
      fleetCap: codexFleetCapPort(),
      home,
      nowIso: new Date().toISOString(),
      port,
      readLive: readCodexAccountsLive,
      requestedAlias: undefined,
      signInPort: codexSignInPort(),
    });
    return decided.mapErr((error) => error.message);
  };
}

/**
 * The production Claude-side read: whether `cmux spawn --driver claude` reads this home's Claude side as
 * unconfigured, and so boots on the ambient credential.
 *
 * @param port where the plan register is read, the same port the tick's register read uses
 * @returns the read the cadence confirms an ambient Claude successor through
 */
export function liveChairClaudeSideRead({ port }: { port: PlanRegisterPort }): ChairSuccessorClaudeSideRead {
  return async ({ home }) => {
    const fleet = await readClaudeFleet({ home, port });
    return fleet
      .map(({ accounts }) => (accounts === undefined ? ("unconfigured" as const) : ("configured" as const)))
      .mapErr((error) => error.message);
  };
}
