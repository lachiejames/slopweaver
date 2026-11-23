/**
 * THE `PreToolUse` hook entry point — one process for the event, where there were ten. Nothing but the
 * top-level invocation: the registry is `src/admit/preToolUseChecks.ts`, the rule that combines its
 * verdicts is `src/admit/preToolUseDispatch.ts`, and every folded guard's own logic is untouched and still
 * unit-tested where it already lived.
 *
 * An unhandled error here exits 2 (fail CLOSED). That is deliberately the STRICTER of the two policies the
 * ten entries carried, and it is not a change to any of them: a per-check failure is caught inside the
 * dispatcher and answered with THAT check's own code, so this handler can only fire for a failure of the
 * dispatcher itself — reading stdin, or the registry failing to build. Neither is a guard's verdict, and a
 * process that cannot run the gate at all must not report that the gate passed.
 *
 * One line here is not the gate: the hourly worktree prune is asked for once the verdict is decided and
 * written, because a tool call in any session is the one event this machine has every hour it is in use, and
 * the prune fires on its schedule without a supervisor pass noticing
 * (`src/worktree/pruneTrigger.ts`). It is one `stat` once the hour has launched and it backgrounds rather than
 * waits. It runs AFTER the dispatch so that it cannot change the verdict even through the clock: a check that
 * reads the time, such as the poll gate's 60-second window, sees the instant it would have seen without it.
 */

import { runPreToolUseDispatch } from "../src/admit/preToolUseDispatchRunner.js";
import { errorMessage } from "../src/lib/errorMessage.js";
import { errExact, outExact } from "../src/lib/logger.js";
import { readStdin } from "../src/lib/readStdin.js";
import { requestScheduledWorktreePrune } from "../src/worktree/pruneTriggerLaunch.js";

// Both sinks write every byte before returning, and that is load-bearing rather than tidy: the dispatcher runs a
// check's `afterEmit` commits — the `profile-held` delivery marker — once these return, and the entry exits straight
// after. `process.stderr.write` on a pipe QUEUES, and `process.exit` drops the queue (`src/lib/drainStdio.ts`), so a
// marker could otherwise vouch for a refusal the model never received whole.
runPreToolUseDispatch({
  argv: process.argv.slice(2),
  env: process.env,
  readStdin,
  writeError: (line) => {
    errExact({ text: line });
  },
  writeOut: (line) => {
    outExact({ text: line });
  },
}).then(
  (code) => {
    requestScheduledWorktreePrune({ importMetaUrl: import.meta.url });
    process.exit(code);
  },
  (error: unknown) => {
    process.stderr.write(
      `pretooluse: dispatcher failed to run (${errorMessage({ error })}) — blocking (fail closed)\n`,
    );
    // A dispatcher that could not run is still this hour's tool call.
    requestScheduledWorktreePrune({ importMetaUrl: import.meta.url });
    process.exit(2);
  },
);
