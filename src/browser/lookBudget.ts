/**
 * Every cap one console look runs under, and the worst case they add up to — a leaf, importing nothing that reaches a
 * package, because the console (`site/lib/talkToolsList.ts`) holds its own browser budget against
 * {@link BUDGETED_LOOK_WORST_CASE_MS} and the site's build cannot resolve this tree's dependencies.
 */
import { PAGE_SETTLE_BUDGET_MS } from "./pageSettle.js";

/**
 * How long one macOS foreground probe or restore command may block.
 *
 * Measured: `lsappinfo` answers in ~15ms, Chrome's window query in ~0.35s and a window raise
 * in ~0.8s. Three seconds is an order of magnitude past the slowest, and it is a BOUND: an `osascript`
 * waiting on a Chrome that is showing a modal dialog would otherwise hold the walk with it.
 */
export const FOREGROUND_COMMAND_TIMEOUT_MS = 3_000;

/**
 * The attach's own cap for a caller that holds every other command to a tight one — `browser inspect` and
 * `browser present`, which run inside the console voice's browser budget (`site/lib/talkToolsList.ts`).
 *
 * `playwright-core`'s own 30 s wait for the extension (`extensionConnectionTimeout`, `lib/coreBundle.js`) plus
 * 10 s for the daemon and Chrome to start before that wait begins — two and a half times the whole first attach
 * measured in `./terminalClient.ts`. A bound, not a guarantee: a startup slower than 10 s is still killed
 * mid-connect, and an unbounded attach would hold the voice's tool open forever. `commandTimeoutFor`
 * (`./terminalClient.ts`) says why a kill mid-connect matters: it is what strands "Failed to connect to MCP relay"
 * on the owner's screen.
 */
export const ATTACH_TIMEOUT_MS = 40_000;

/*
 * How long an attach can outlive its own kill. While the daemon is still starting, the client catches SIGTERM,
 * forwards it to the daemon and waits for it to exit (`playwright-core` `lib/tools/cli-client/session.js`), and the
 * daemon's exit watchdog allows a graceful close 15 s before it exits anyway (`setupExitWatchdog`,
 * `lib/coreBundle.js`). Only the attach starts a daemon, so no other client command carries this.
 */
const ATTACH_SHUTDOWN_GRACE_MS = 15_000;

/**
 * How long one client command other than the attach may take in `browser inspect`. MEASURED
 * (`./terminalClient.ts`): about a second once attached and four for the first attach.
 */
export const INSPECT_COMMAND_TIMEOUT_MS = 6_000;

/**
 * How long `browser present` may wait on the Slack read token's `auth.test` before it opens a Slack message link in
 * Chrome instead of the owner's Slack desktop app. A BOUND, not a measurement: the call's retrying path honours a 429's whole
 * `Retry-After`, which unbounded would hold the present until the console's browser budget killed it before Chrome
 * was ever tried.
 */
export const SLACK_WORKSPACE_LOOKUP_TIMEOUT_MS = 5_000;

/**
 * The most foreground commands `attachInBackground` (`./keepForeground.ts`) runs around one attach: two readings of
 * up to three commands each, two window listings, a restore, and a listing and a raise behind the agent's window.
 * `keepForeground.test.ts` holds the real count under it.
 */
export const ATTACH_FOREGROUND_COMMANDS_MAX = 11;

/**
 * The most foreground commands `releaseInBackground` (`./keepForeground.ts`) runs around one close: two readings of
 * up to three commands each, a window listing and a restore.
 */
export const RELEASE_FOREGROUND_COMMANDS_MAX = 8;

/*
 * The most foreground probes and restores one background `browser inspect` can run: an attach's worth around the
 * attach and another around the screenshot's tab activation, and a close's worth around the close. `browser present`
 * attaches in the foreground and runs only the close's.
 */
const BACKGROUND_LOOK_FOREGROUND_COMMANDS = 2 * ATTACH_FOREGROUND_COMMANDS_MAX + RELEASE_FOREGROUND_COMMANDS_MAX;

/**
 * Every capped command a `browser inspect` or `browser present` can run, each at its own kill cap: the attach and its
 * daemon's shutdown grace, then nine client commands at {@link INSPECT_COMMAND_TIMEOUT_MS} — goto, the settle's last
 * pulse, snapshot, a screenshot retried once through a tab activation (`./viewportCapture.ts`, three commands), and
 * the three closing commands — the settle's own budget, and thirty foreground probes; and ahead of all of it, the
 * Slack desktop-app attempt `browser present` makes on a Slack message link, which falls through to Chrome when it
 * fails: the workspace lookup at {@link SLACK_WORKSPACE_LOOKUP_TIMEOUT_MS} and one `open` at its foreground cap. The console's browser budget (`site/lib/talkToolsList.ts`) sits
 * above this, so its kill never cuts the closing commands off; `site/__tests__/unit/talkTools.test.ts` holds that. A
 * foreground probe is killed with SIGKILL (`realForegroundRun`, `./foreground.ts`), so its cap is hard; a client
 * command keeps SIGTERM, because the Playwright client's own handler is what takes its daemon down with it.
 *
 * It is a sum of caps, not a bound on the whole run. The verb's own local work — process start, the session
 * record's durable write — carries no cap; it takes milliseconds, and the console's ten seconds over this sum are
 * for it. A filesystem that stalls past those, or a process the OS stops or starves, can still be killed before its
 * tab closes, and no budget could bound either.
 */
export const BUDGETED_LOOK_WORST_CASE_MS =
  ATTACH_TIMEOUT_MS +
  ATTACH_SHUTDOWN_GRACE_MS +
  9 * INSPECT_COMMAND_TIMEOUT_MS +
  PAGE_SETTLE_BUDGET_MS +
  BACKGROUND_LOOK_FOREGROUND_COMMANDS * FOREGROUND_COMMAND_TIMEOUT_MS +
  SLACK_WORKSPACE_LOOKUP_TIMEOUT_MS +
  FOREGROUND_COMMAND_TIMEOUT_MS;
