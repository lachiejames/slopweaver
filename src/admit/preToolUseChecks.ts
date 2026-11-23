/**
 * The registry: the guards that used to be ten separate `PreToolUse` entries, in the order they were
 * registered, each carrying the `matcher` and the failure policy its own entry carried. The array has grown
 * since the fold — `disk-scan-guard` is the first row that was never one of the ten — so a new row
 * joins it here rather than becoming an eleventh process.
 *
 * The pure rule for combining them is `./preToolUseDispatch.ts`; this file is the effectful shell that
 * hands each runner its real seams. Nothing here decides anything — a row that decided something would be
 * a second copy of a guard, and the whole point of the fold is that each guard's logic stays exactly where
 * it already is and is still unit-tested there.
 *
 * ## The order is the old registration order, and it is load-bearing
 *
 * The dispatcher stops at the first refusal, so which check runs first decides which refusal a caller sees
 * when two would both refuse. Keeping the old order means the answer is unchanged from ten processes, where
 * the harness reported whichever exited 2 — with `pretooluse-admit` first, because it is the boundary
 * rather than a workflow tripwire.
 *
 * ## The matchers are copied, never re-derived — and EVALUATED the way the harness evaluated them
 *
 * Each `appliesTo` below spells the matcher its `hooks.json` entry spelled, and runs it through
 * `./hookMatcher.ts`, which is Claude Code's own three-mode rule rather than `new RegExp(matcher)`. That
 * distinction is the whole correctness of the fold: `Edit|Write` is an EXACT-name list to the harness, so it
 * never matched `TodoWrite`, and reading it as a regex here would have widened three guards on the quiet.
 * Re-deriving a "better" matcher is a guard change wearing a refactor's clothes; so is re-deriving how one
 * is read.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { slopweaverHomeOf } from "../homeDir.js";
import { readCanonSections } from "../memory/canonReader.js";
import { readMemoryCorpus } from "../memory/store.js";
import { runAgentToolBanGuard } from "./agentToolBanGuardRunner.js";
import { runBotLiveWriteGuard } from "./botLiveWriteGuardRunner.js";
import { runBrowserDoorPreToolUse } from "./browserDoorGuardRunner.js";
import { runCallStateGuard } from "./callStateGuardRunner.js";
import { runCmuxSendSupervisorGuard } from "./cmuxSendSupervisorGuardRunner.js";
import { runDiskScanGuard } from "./diskScanGuardRunner.js";
import { runHomeGitGuard } from "./homeGitGuardRunner.js";
import { hookMatcherSelects } from "./hookMatcher.js";
import { runMainCheckoutBranchGuard } from "./mainCheckoutBranchGuardRunner.js";
import { runMainCheckoutDirtyGuard } from "./mainCheckoutDirtyGuardRunner.js";
import { runMainCheckoutEditGuard } from "./mainCheckoutEditGuardRunner.js";
import { runMemoryWriteGuard } from "./memoryWriteGuardRunner.js";
import { runPollGate } from "./pollGateRunner.js";
import { EXIT_ALLOW, EXIT_BLOCK, type PreToolUseCheck } from "./preToolUseDispatch.js";
import { runPreToolUseAdmit } from "./pretooluseAdmit.js";
import { machineDefaultHomes } from "./profileFirstBoot.js";
import { runProfileHeld } from "./profileHeldRunner.js";
import { runProtectedPathGuard } from "./protectedPathGuardRunner.js";
import { runRawBashGuard } from "./rawBashGuardRunner.js";
import { runRelayWordsGuard } from "./relayWordsGuardRunner.js";
import { relayWordsSeams } from "./relayWordsSeams.js";
import { runRunDueDeadlineGuard } from "./runDueDeadlineGuardRunner.js";
import { runSessionDepthWarning } from "./sessionDepthWarningRunner.js";
import { runWholeTreeCheckGuard } from "./wholeTreeCheckGuardRunner.js";

/**
 * Build the `appliesTo` predicate for one old `matcher` string.
 *
 * @param matcher the matcher the old `hooks.json` entry carried, verbatim
 * @returns the predicate the folded check carries
 */
function matching({ matcher }: { matcher: string }): (input: { toolName: string }) => boolean {
  return ({ toolName }) => hookMatcherSelects({ matcher, toolName });
}

/**
 * Every tool name at least one folded check applies to, so `hooks.json`'s two disjoint registrations together
 * carry exactly the union of the ten entries they replaced — and no wider. A dispatcher registered with no matcher would fire on
 * `Read`, `Grep` and `Glob`, which pay nothing today, and hand back part of the win.
 *
 * Each name is ANCHORED, which it has to be and which the obvious spelling gets wrong. The moment one
 * alternative needs `.` or `*` — `mcp__claude-in-chrome__` does — the harness stops reading the string as a
 * list of exact names and reads the WHOLE thing as an unanchored regex (`./hookMatcher.ts`). A bare
 * `Bash|…|Edit|Write|Agent|Task` would then also select `BashOutput`, `NotebookEdit`, `TodoWrite` and
 * `TaskOutput`, none of which any of the ten entries ever saw — paying the dispatcher's cost on calls that
 * pay nothing, which is the thing this whole change exists to stop.
 */
export const PRE_TOOL_USE_MATCHER =
  "^(?:Bash|Monitor|Artifact|TaskOutput|Edit|Write|Agent|Task)$|^mcp__claude-in-chrome__";

/**
 * The half of {@link PRE_TOOL_USE_MATCHER} a door gate covers — the one-door, poll and script gates and the
 * browser door — registered behind `SLOPWEAVER_HOOK_GIVE_UP=2`, so a call the `scripts/hook.sh` envelope has to end
 * is REFUSED rather than run past those gates. The same split `give_up_code` in `scripts/pretooluse.sh`
 * applies to a spent inner budget, made static here because a kill cannot read the payload.
 *
 * Two registrations, still ONE dispatcher process per call: the two matchers are disjoint, so no tool is
 * handed to both. MEASURED, why the envelope's ending had to differ by row:
 * `docs/hooks/mirrors-and-failure-policy.md` § "The three that fail closed".
 */
export const PRE_TOOL_USE_DOOR_GATED_MATCHER = "^(?:Bash|Monitor|Artifact|TaskOutput)$|^mcp__claude-in-chrome__";

/**
 * The other half: tools only workflow TRIPWIRES and the `profile-held` hold cover. It refuses at the envelope too,
 * because the hold is a gate a kill cannot judge — a kill reads no payload, so it cannot tell a context holding the
 * owner's profile from one that lacks it, and doing nothing beats acting misaligned (a starved dispatcher on this row released an `Edit` from a context with no profile). The inner budget still
 * releases these tools to a context that holds its marker (`give_up_code`, `scripts/pretooluse.sh`). An exact-name
 * list, so the harness never reads it as a regex (`./hookMatcher.ts`).
 */
export const PRE_TOOL_USE_TRIPWIRE_MATCHER = "Edit|Write|Agent|Task";

/**
 * The protected-path guard's own matcher: every tool that can reach a file by path. `Read`, `Grep`, `Glob` and
 * `NotebookEdit` reach the dispatcher only through the third `hooks.json` registration, which runs this row alone
 * (`--only protected-path-guard`) and only when a registry exists (`scripts/pretooluse-protected-paths.sh`), so no
 * other check ever sees a read. An exact-name list, so the harness never reads it as a regex (`./hookMatcher.ts`).
 */
const PROTECTED_PATH_MATCHER = "Bash|Edit|Write|NotebookEdit|Read|Grep|Glob";

/** The tools only the protected-path guard covers, registered on their own so they reach no other check. */
export const PRE_TOOL_USE_READ_MATCHER = "Read|Grep|Glob|NotebookEdit";

/**
 * One row, spelled the way the ten `hooks.json` entries were: a matcher, a failure policy, and the runner
 * whose logic is unchanged and still unit-tested where it already lived.
 *
 * @param matcher the matcher that entry carried, verbatim
 * @param id the check's stable id
 * @param onUnhandledError the exit code a throw from `run` means for THIS check alone
 * @param run the folded guard's own runner, handed the shared payload
 * @returns the registry row
 */
function row({
  matcher,
  id,
  onUnhandledError,
  run,
}: {
  matcher: string;
  id: string;
  onUnhandledError: number;
  run: PreToolUseCheck["run"];
}): PreToolUseCheck {
  return { appliesTo: matching({ matcher }), id, onUnhandledError, run };
}

/**
 * The memory-write gate's row, apart from the rest only because it is the one guard whose runner declares
 * filesystem seams — three of them — and inlining those made the registry longer than a reader can hold.
 *
 * @param env the process environment, which the gate's hatch is read from
 * @returns the registry row
 */
function memoryWriteRow({ env }: { env: Record<string, string | undefined> }): PreToolUseCheck {
  return row({
    id: "memory-write-guard",
    matcher: "Edit|Write",
    onUnhandledError: EXIT_ALLOW,
    run: ({ raw, writeError }) =>
      runMemoryWriteGuard({
        env,
        holdsRootIndex: ({ dir }) => existsSync(join(dir, "MEMORY.md")),
        readLeaf: ({ path }) => {
          try {
            return readFileSync(path, "utf8");
          } catch {
            return null;
          }
        },
        readCanon: readCanonSections,
        readSiblings: ({ dir }) => {
          const corpus = readMemoryCorpus({ dir });
          return corpus.isOk() ? corpus.value.leaves : [];
        },
        readStdin: () => Promise.resolve(raw),
        userHome: homedir(),
        writeError,
      }),
  });
}

/**
 * The `profile-held` hold's row: every tool the dispatcher sees, failing closed like the doors, reading the resolved
 * home and the machine's default homes so a first boot is told apart from a home that lost the owner's profile
 * (`./profileHeldRunner.ts`).
 *
 * @param env the process environment, which the home and the store selection are read from
 * @param nowIso the instant a load and its ledger row are stamped at
 * @returns the registry row
 */
function profileHeldRow({ env, nowIso }: { env: Record<string, string | undefined>; nowIso: string }): PreToolUseCheck {
  return row({
    id: "profile-held",
    matcher: PRE_TOOL_USE_MATCHER,
    onUnhandledError: EXIT_BLOCK,
    run: ({ afterEmit, raw, writeError }) =>
      runProfileHeld({
        afterEmit,
        defaultHomes: machineDefaultHomes(),
        env,
        home: slopweaverHomeOf({ env }),
        nowIso,
        readStdin: () => Promise.resolve(raw),
        writeError,
      }),
  });
}

/**
 * The two `Edit|Write` tripwires, in their registration order: the main-checkout edit guard, then the relay-words
 * guard. Both fail OPEN and neither is a door — each refuses the shape of a file write on this machine.
 *
 * @param env the process environment, which each hatch is read from
 * @param stdin replays the one payload this process read, per check
 * @returns the two rows, in registry order
 */
function editWriteRows({
  env,
  stdin,
}: {
  env: Record<string, string | undefined>;
  stdin: (replay: { raw: string }) => () => Promise<string>;
}): readonly PreToolUseCheck[] {
  return [
    row({
      id: "main-checkout-edit-guard",
      matcher: "Edit|Write",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) => runMainCheckoutEditGuard({ env, readStdin: stdin({ raw }), writeError }),
    }),
    // Beside the other `Edit|Write` tripwire: a talk relay row keeps the owner's words (`./relayWordsJudge.ts`).
    row({
      id: "relay-words-guard",
      matcher: "Edit|Write",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) =>
        runRelayWordsGuard({ env, readStdin: stdin({ raw }), readers: relayWordsSeams({ env }), writeError }),
    }),
  ];
}

/**
 * The six `Bash`-only workflow tripwires, in their registration order.
 *
 * One group by construction rather than by convenience: all six carry the same matcher and the same
 * fail-OPEN policy, and none of them is a door — a refusal from any of them is about the SHAPE of the work
 * (a main checkout, the state home's own repository, its console-voice call state, a session's depth, a message
 * into the supervisor), never about admitting a side effect.
 *
 * @param env the process environment, which each hatch is read from
 * @param stdin replays the one payload this process read, per check
 * @returns the six rows, positions two through seven of the registry
 */
function bashWorkflowRows({
  env,
  stdin,
}: {
  env: Record<string, string | undefined>;
  stdin: (replay: { raw: string }) => () => Promise<string>;
}): readonly PreToolUseCheck[] {
  return [
    row({
      id: "main-checkout-guard",
      matcher: "Bash",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) => runMainCheckoutBranchGuard({ env, readStdin: stdin({ raw }), writeError }),
    }),
    row({
      id: "main-checkout-dirty-guard",
      matcher: "Bash",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) => runMainCheckoutDirtyGuard({ env, readStdin: stdin({ raw }), writeError }),
    }),
    // Beside the two main-checkout guards because it asks the same question — which repository does this git
    // land in — and before the poll gate, so a refused call is never recorded as a poll that happened.
    row({
      id: "home-git-guard",
      matcher: "Bash",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) => runHomeGitGuard({ env, readStdin: stdin({ raw }), writeError }),
    }),
    // Beside the home-git guard because it too protects the state home, and before the poll gate for the same reason.
    row({
      id: "call-state-guard",
      matcher: "Bash",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) => runCallStateGuard({ env, readStdin: stdin({ raw }), writeError }),
    }),
    row({
      id: "session-depth-warning",
      matcher: "Bash",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeOut }) => runSessionDepthWarning({ readStdin: stdin({ raw }), writeOut }),
    }),
    row({
      id: "cmux-send-supervisor-guard",
      matcher: "Bash",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) => runCmuxSendSupervisorGuard({ readStdin: stdin({ raw }), writeError }),
    }),
  ];
}

/**
 * The protected-path guard's row: after the call-state guard, which protects the state home's own files, and before
 * the poll gate, so a refused call is never recorded as a poll. The one row that also judges `Read`, `Grep` and
 * `Glob`: an owner-protected path is the one reason a READ is ever refused (`./protectedPathGuard.ts`). Fails open,
 * like every tripwire.
 *
 * @param env the process environment, which the registry's homes and the hatch are read from
 * @param stdin replays the one payload this process read
 * @returns the registry row
 */
function protectedPathRow({
  env,
  stdin,
}: {
  env: Record<string, string | undefined>;
  stdin: (replay: { raw: string }) => () => Promise<string>;
}): PreToolUseCheck {
  return row({
    id: "protected-path-guard",
    matcher: PROTECTED_PATH_MATCHER,
    onUnhandledError: EXIT_ALLOW,
    run: ({ raw, writeError }) => runProtectedPathGuard({ env, readStdin: stdin({ raw }), writeError }),
  });
}

/**
 * The four `Bash`-only guards that judge what the command itself would cost or run — a disk scan, a
 * whole-tree lap, a `run-due` past its deadline, a script — in their registration order, after the poll gate.
 *
 * @param env the process environment, which each hatch is read from
 * @param stdin replays the one payload this process read, per check
 * @returns the four rows, in registration order
 */
function bashCommandShapeRows({
  env,
  stdin,
}: {
  env: Record<string, string | undefined>;
  stdin: (replay: { raw: string }) => () => Promise<string>;
}): readonly PreToolUseCheck[] {
  return [
    row({
      id: "disk-scan-guard",
      matcher: "Bash",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) => runDiskScanGuard({ env, readStdin: stdin({ raw }), writeError }),
    }),
    row({
      id: "whole-tree-check-guard",
      matcher: "Bash",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) => runWholeTreeCheckGuard({ env, readStdin: stdin({ raw }), writeError }),
    }),
    row({
      id: "run-due-deadline-guard",
      matcher: "Bash",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) => runRunDueDeadlineGuard({ env, readStdin: stdin({ raw }), writeError }),
    }),
    // After every narrower `Bash` check, so a main-checkout, poll, disk-scan or whole-tree refusal — each naming
    // the one thing wrong — is seen before this one, which only says the call is a script.
    row({
      id: "raw-bash-gate",
      matcher: "Bash|Monitor",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) => runRawBashGuard({ env, readStdin: stdin({ raw }), writeError }),
    }),
  ];
}

/**
 * Every folded check, in registration order — the original ten, plus each row added since.
 *
 * @param env the process environment, which every hatch is read from
 * @returns the registry the dispatcher walks
 */
export function preToolUseChecks({ env }: { env: Record<string, string | undefined> }): readonly PreToolUseCheck[] {
  const nowIso = new Date().toISOString();
  const stdin =
    ({ raw }: { raw: string }) =>
    () =>
      Promise.resolve(raw);
  return [
    // FIRST, and on every tool the dispatcher sees: a session whose context lacks the owner's profile acts on nothing until
    // it holds it, and this refusal is what delivers it (`./profileHeld.ts`). Fails closed, like the doors.
    profileHeldRow({ env, nowIso }),
    // Ahead of `admit` on purpose: a bot turn's migration or live write must meet the owner's rule, not the generic
    // raw-tool refusal that would offer `SLOPWEAVER_ALLOW_RAW` or a reach grant first. Fails closed, like
    // `admit`: it guards an external side effect. A non-bot session passes it after one pure classification.
    row({
      id: "bot-live-write-guard",
      matcher: "Bash|Monitor",
      onUnhandledError: EXIT_BLOCK,
      run: ({ raw, writeError }) => runBotLiveWriteGuard({ env, readStdin: stdin({ raw }), writeError }),
    }),
    row({
      id: "admit",
      matcher: "Bash|Monitor|Artifact",
      onUnhandledError: EXIT_BLOCK,
      run: ({ raw, writeError }) => runPreToolUseAdmit({ env, readStdin: stdin({ raw }), writeError }),
    }),
    ...bashWorkflowRows({ env, stdin }),
    protectedPathRow({ env, stdin }),
    row({
      id: "poll-gate",
      matcher: "Bash|TaskOutput",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) => runPollGate({ env, nowMs: Date.now(), readStdin: stdin({ raw }), writeError }),
    }),
    ...bashCommandShapeRows({ env, stdin }),
    ...editWriteRows({ env, stdin }),
    row({
      id: "browser-door-guard",
      matcher: "mcp__claude-in-chrome__.*",
      onUnhandledError: EXIT_BLOCK,
      run: ({ raw, writeError }) => runBrowserDoorPreToolUse({ readStdin: stdin({ raw }), writeError }),
    }),
    row({
      id: "agent-tool-ban",
      matcher: "Agent|Task",
      onUnhandledError: EXIT_ALLOW,
      run: ({ raw, writeError }) => runAgentToolBanGuard({ env, nowIso, readStdin: stdin({ raw }), writeError }),
    }),
    memoryWriteRow({ env }),
  ];
}
