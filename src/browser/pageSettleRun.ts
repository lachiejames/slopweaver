/**
 * The loop that waits for a page to stop drawing — the effectful half of `./pageSettle.ts`.
 *
 * One copy, shared by every caller that is about to photograph a page: the look
 * (`src/cli/commands/browser/sessionShell.ts`) and the after-picture (`./actionExecutor.ts`). Two copies of a
 * settle would be two budgets and two definitions of "ready", which is the drift
 * `.claude/rules/error-handling.md`'s dedup-regenerates-the-shape finding is about.
 */
import type { Result } from "../lib/result.js";
import type { BrowserActionError } from "./actionErrors.js";
import type { PagePulse } from "./pageSettle.js";
import {
  PAGE_PULSE_INTERVAL_MS,
  PAGE_PULSE_SOURCE,
  PAGE_SETTLE_BUDGET_MS,
  parsePagePulse,
  pulsesAgree,
} from "./pageSettle.js";
import { runClientCommand, type TerminalClientDeps, type TerminalReply } from "./terminalClient.js";

/**
 * Wait for the page to stop drawing, or for the budget to run out.
 *
 * It reports nothing and refuses nothing, deliberately: a page that never settles is photographed anyway,
 * because a picture of a page still drawing is strictly better than an error where evidence should be, and
 * the caller can simply look again. A client command that fails here is left for the command immediately
 * after it to report properly — that one is the caller's real errand, and its failure is the one that
 * matters.
 *
 * The whole loop takes at most its budget plus one pulse at its cap, which `browser inspect`'s worst case
 * (`BUDGETED_LOOK_WORST_CASE_MS`, `./lookBudget.ts`) counts on so the console's kill never lands before its tab is closed. So the
 * deadline is read off the monotonic clock, never the wall clock — one set back mid-loop would hold it open — and no
 * sleep runs past it.
 *
 * @param deps the client and the session it runs under
 * @param sleep how the loop waits, injected so a caller already carrying a clock keeps using its own
 * @param runCommand runs one client command; the real terminal client unless a test scripts the replies
 * @param monotonicMs reads the monotonic clock the deadline is kept on; `performance.now()` by default
 */
export function settlePage({
  deps,
  sleep,
  runCommand = runClientCommand,
  monotonicMs = () => performance.now(),
}: {
  deps: TerminalClientDeps;
  sleep: (ms: number) => void;
  runCommand?: (args: {
    args: readonly string[];
    deps: TerminalClientDeps;
  }) => Result<TerminalReply, BrowserActionError>;
  monotonicMs?: () => number;
}): void {
  const deadline = monotonicMs() + PAGE_SETTLE_BUDGET_MS;
  let earlier: PagePulse | null = null;
  while (monotonicMs() < deadline) {
    const reply = runCommand({ args: ["eval", PAGE_PULSE_SOURCE], deps });
    if (reply.isErr()) {
      return;
    }
    const later = parsePagePulse({ stdout: reply.value.stdout });
    if (later === null) {
      return;
    }
    if (earlier !== null && pulsesAgree({ earlier, later })) {
      return;
    }
    earlier = later;
    // Never past the deadline: a pulse that ran to its cap across it is followed by no sleep at all.
    const remaining = deadline - monotonicMs();
    if (remaining <= 0) {
      return;
    }
    sleep(Math.min(PAGE_PULSE_INTERVAL_MS, remaining));
  }
}
