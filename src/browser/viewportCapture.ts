/**
 * Every screenshot the interactive lane takes — `open`, `read`, `scroll`, `aim` and the pictures around an
 * `act` — and the one recovery a capture that never returns gets.
 *
 * ## A capture of a tab Chrome is not rendering never returns, so the remedy is activation, not time
 *
 * The client's `screenshot` command carries no timeout of its own: `playwright-core` bounds it with the session
 * daemon's `timeouts.action`, 5000ms unless configured, the same bound every click and fill gets. MEASURED
 * on a Datadog Cost report, every capture of two sessions failed `TimeoutError: Timeout 5000ms exceeded …
 * taking page screenshot`, the silent ones in `open` and `read` included, while `browser shot --raw` of the same
 * page landed — and that shot's own first 8s attempt had run out too (`pmset -g log`: Chrome's "Capturing"
 * assertion was held the full 8s), so what saved it was the `page.bringToFront()` the relay lane makes before every
 * capture (`./snippetParts.ts`), not its longer bound. `./pageVisitSnippet.ts` carries the measurement
 * of the same shape: three 8s attempts on a deactivated tab all ran to the bound, and one activation cured it
 * in 656ms. Reproduce the incident's record: the two sessions' workspaces hold observations and no `look-*.png`.
 *
 * So the first attempt keeps the client's own bound, because a tab that renders is photographed in well under
 * a second and a longer wait buys a tab that does not nothing but latency. A capture that times out is retried
 * ONCE after the session's own tab is activated, with the owner's foreground given straight back
 * (`./keepForeground.ts`). Any other failure is returned as it was: activating raises a window, and that is
 * only worth doing for the failure it cures.
 */
import { err, type Result } from "../lib/result.js";
import { type BrowserActionError, BrowserActionErrors } from "./actionErrors.js";
import { activateTabInBackground } from "./keepForeground.js";
import { runClientCommand, type TerminalClientDeps, type TerminalReply } from "./terminalClient.js";

/** What the client prints when a screenshot ran out its bound waiting for a frame. */
const CAPTURE_TIMED_OUT = /Timeout \d+ms exceeded/u;

/** The call-log line naming the step that ran out, so a click's own timeout is never mistaken for one. */
const CAPTURE_STEP = /taking page screenshot/u;

/** The two effects a capture is made of, injected so a unit test drives them with plain fakes. */
export interface CaptureSeams {
  /** Run one client command against the session. */
  readonly client: (request: { args: readonly string[] }) => Result<TerminalReply, BrowserActionError>;
  /** Bring the session's own tab to the front and give the foreground back. */
  readonly activate: () => Result<null, BrowserActionError>;
}

/**
 * Whether a failure is a screenshot that timed out waiting for a frame. Pure.
 *
 * @param error what the screenshot command failed with
 * @returns true only for the client's screenshot timeout
 */
export function isUnrenderedCapture({ error }: { error: BrowserActionError }): boolean {
  return error.code === "CLIENT_FAILED" && CAPTURE_TIMED_OUT.test(error.detail) && CAPTURE_STEP.test(error.detail);
}

/**
 * Take one screenshot of the session's page, activating its tab and trying once more when the first attempt
 * timed out.
 *
 * @param args the `screenshot` command and its arguments, each already one argv element
 * @param deps the client and the session it runs under
 * @param seams the client and the activation; the real ones unless a test supplies fakes
 * @returns what the client said, or the typed failure — the first one's own words when the activation is
 *   what failed, so the caller still learns the capture timed out
 */
export function captureScreenshot({
  args,
  deps,
  seams = realCaptureSeams({ deps }),
}: {
  args: readonly string[];
  deps: TerminalClientDeps;
  seams?: CaptureSeams;
}): Result<TerminalReply, BrowserActionError> {
  const first = seams.client({ args });
  if (first.isOk() || !isUnrenderedCapture({ error: first.error })) {
    return first;
  }
  const activated = seams.activate();
  if (activated.isErr()) {
    return err(
      BrowserActionErrors.clientFailed({
        detail: `${first.error.message}\n\nthe session's tab could not be activated to try again: ${activated.error.message}`,
      }),
    );
  }
  return seams.client({ args });
}

/**
 * The production seams: the real client, and the real activation with its foreground restore.
 *
 * @param deps the client and the session it runs under
 * @returns the seams {@link captureScreenshot} runs through
 */
function realCaptureSeams({ deps }: { deps: TerminalClientDeps }): CaptureSeams {
  return {
    activate: () => activateTabInBackground({ deps }),
    client: ({ args }) => runClientCommand({ args, deps }),
  };
}
