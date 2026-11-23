/**
 * The whole judgement of the relay reconnect, which is deliberately the only part of it a test can reach.
 *
 * `runRelayOperation` spawns a real terminal client against the owner's real Chrome, so nothing below it is
 * unit-testable at all — `playwrightCliLease/transportLease.test.ts` only reaches the refusals that happen BEFORE the
 * client runs, by handing it a profile pin that does not exist. That is why the decision is a pure total
 * function rather than control flow inside the run: a rule settled only by a live walk is a rule nobody can
 * check before the walk that fails.
 *
 * The diagnoses here are built by the REAL `clientKill.ts` functions off the real thrown shapes, so a
 * phrase table that stops grading a drop reattachable reddens here rather than in a browser six hundred
 * pages later.
 */
import { describe, expect, it } from "vitest";

import { type ClientFailureFacts, diagnoseClientFailure, diagnoseSnippetFailure } from "../../../browser/clientKill.js";
import { relayRecovery } from "../../../browser/relayRun.js";
import {
  gradedFailures,
  MAX_SELF_CLOSED_PAGES_WITHOUT_CAPTURE,
  restoresReconnectAfterLostPage,
  selfClosedTabRecovery,
} from "../../../browser/selfClosedGrade.js";
import { snippetFailureOf } from "../../../browser/selfClosedTab.js";

const facts = (over: Partial<ClientFailureFacts> = {}): ClientFailureFacts => ({
  code: null,
  signal: null,
  status: null,
  stderr: "",
  stdout: "",
  ...over,
});

/** What the 251-page Linear walk exited on at `147/251`. */
const sessionClosed = diagnoseClientFailure({
  boundMs: 80_000,
  elapsedMs: 3_100,
  facts: facts({ status: 1, stderr: "Error: Session closed\n    at SocketConnectionClient._rejectCallbacks" }),
});

/** What the xero walk in the same sweep died with. */
const targetGone = diagnoseSnippetFailure({ failure: "Target page, context or browser has been closed" });

/** A client older than the daemon it drives — run-stopping by construction, and no attach clears it. */
const versionSkew = diagnoseClientFailure({
  boundMs: 80_000,
  elapsedMs: 1_200,
  facts: facts({
    status: 1,
    stderr: "Error: Client is v1.62.1, session 'chrome' is v1.63.0. Run\n\n  playwright-cli -s=chrome open\n",
  }),
});

/** A page that would not load. Costs one page, and always did. */
const pageTimedOut = diagnoseSnippetFailure({ failure: "TimeoutError: page.goto: Timeout 45000ms exceeded" });

describe("relayRecovery", () => {
  it("rebuilds the relay for the drop that ended the 251-page Linear walk", () => {
    expect(relayRecovery({ diagnosis: sessionClosed, reconnectSpent: false })).toBe("retry-after-reattach");
  });

  it("rebuilds the relay for the sibling drop that ended the xero walk in the same sweep", () => {
    expect(relayRecovery({ diagnosis: targetGone, reconnectSpent: false })).toBe("retry-after-reattach");
  });

  it("stops the run on a second drop with no success between, which is a relay that is not coming back", () => {
    expect(relayRecovery({ diagnosis: sessionClosed, reconnectSpent: true })).toBe("stop-the-run");
  });

  it("stops the run on a version skew rather than buying an attach per remaining page", () => {
    expect(relayRecovery({ diagnosis: versionSkew, reconnectSpent: false })).toBe("stop-the-run");
  });

  it("still stops the run on a version skew when the reconnect is unspent, so an unspent budget is not a licence", () => {
    expect(relayRecovery({ diagnosis: versionSkew, reconnectSpent: true })).toBe("stop-the-run");
  });

  it("leaves a page that would not load costing exactly one page, as it always did", () => {
    expect(relayRecovery({ diagnosis: pageTimedOut, reconnectSpent: false })).toBe("one-page");
    expect(relayRecovery({ diagnosis: pageTimedOut, reconnectSpent: true })).toBe("one-page");
  });

  // The hang class `clientKill.ts` was written for: killed at the bound, nothing printed. It is not
  // run-stopping, and spending a reconnect on it would pay a browser start for every page a slow console
  // times out on.
  it("does not rebuild the relay for a client killed at its own bound", () => {
    const hung = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 80_134,
      facts: facts({ code: "ETIMEDOUT", signal: "SIGTERM" }),
    });

    expect(hung.runStopping).toBe(false);
    expect(relayRecovery({ diagnosis: hung, reconnectSpent: false })).toBe("one-page");
  });
});

/**
 * What the Hex walk's `/login-success` reported on every walk until it was fixed — an OAuth completion
 * page calling `window.close()` on the tab the walk had navigated it in. The client exited 0 around it.
 */
const pageClosedItself = diagnoseSnippetFailure({
  failure: "page.goto: Target page, context or browser has been closed",
});

/**
 * What `/mcp-server-oauth-result` threw on a scheduled Hex resync, the route straight
 * after `/login-success` — the same self-close, with the client exiting 1 around it instead of 0.
 */
const pageClosedItselfThrown = diagnoseClientFailure({
  boundMs: 80_000,
  elapsedMs: 1_400,
  facts: facts({ status: 1, stderr: "Error: Target page, context or browser has been closed" }),
});

describe("selfClosedTabRecovery", () => {
  it("binds the bound to the two OAuth completion pages Hex declares back to back", () => {
    expect(MAX_SELF_CLOSED_PAGES_WITHOUT_CAPTURE).toBe(2);
  });

  it("rebuilds and retries the page the first time a snippet reports it gone", () => {
    expect(selfClosedTabRecovery({ diagnoses: [pageClosedItself], selfClosedPagesSinceCapture: 0 })).toBe(
      "rebuild-and-retry",
    );
  });

  it("grades the page alone once it has closed a freshly attached tab too, so the walk carries on", () => {
    expect(
      selfClosedTabRecovery({ diagnoses: [pageClosedItself, pageClosedItself], selfClosedPagesSinceCapture: 0 }),
    ).toBe("rebuild-and-lose-one-page");
  });

  it("rebuilds and retries the same self-close when the client THREW it, the scheduled-resync shape", () => {
    expect(pageClosedItselfThrown.phrases).toEqual(["browser-closed"]);
    expect(pageClosedItselfThrown.kind).toBe("exited-nonzero");
    expect(selfClosedTabRecovery({ diagnoses: [pageClosedItselfThrown], selfClosedPagesSinceCapture: 1 })).toBe(
      "rebuild-and-retry",
    );
  });

  // The scheduled-resync stop exactly: `/login-success` already lost (one page since the last capture), and the next
  // page closes a fresh tab with the client throwing. It costs itself alone rather than the walk.
  it("loses the second self-closing page alone after the first was lost, rather than stopping the walk", () => {
    expect(
      selfClosedTabRecovery({
        diagnoses: [pageClosedItselfThrown, pageClosedItselfThrown],
        selfClosedPagesSinceCapture: 1,
      }),
    ).toBe("rebuild-and-lose-one-page");
  });

  it("grades a page alone whether the second close was reported or thrown", () => {
    expect(
      selfClosedTabRecovery({ diagnoses: [pageClosedItself, pageClosedItselfThrown], selfClosedPagesSinceCapture: 0 }),
    ).toBe("rebuild-and-lose-one-page");
  });

  // The bound: a third self-closing page with nothing captured since is a browser killing every tab, not
  // three odd pages, so the run stops without another rebuild.
  it("stops the run once the bound's worth of pages have been lost with nothing captured between", () => {
    expect(
      selfClosedTabRecovery({
        diagnoses: [pageClosedItself],
        selfClosedPagesSinceCapture: MAX_SELF_CLOSED_PAGES_WITHOUT_CAPTURE,
      }),
    ).toBe("stop-the-run");
  });

  it("leaves a snippet that names the RELAY to the walk-stopping path, since that is not a page closing itself", () => {
    const relayDropped = diagnoseSnippetFailure({ failure: "Error: Session closed" });

    expect(relayDropped.runStopping).toBe(true);
    expect(selfClosedTabRecovery({ diagnoses: [relayDropped], selfClosedPagesSinceCapture: 0 })).toBe(
      "not-a-self-close",
    );
  });

  it("leaves a dropped relay followed by a closed page alone, since one of the two named the relay", () => {
    expect(
      selfClosedTabRecovery({ diagnoses: [sessionClosed, pageClosedItselfThrown], selfClosedPagesSinceCapture: 0 }),
    ).toBe("not-a-self-close");
  });

  it("leaves a client killed at its bound to the relay's verdict, even when its output names a closed browser", () => {
    const timedOut = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 80_120,
      facts: facts({ code: "ETIMEDOUT", stderr: "Target page, context or browser has been closed" }),
    });

    expect(timedOut.kind).toBe("killed-at-bound");
    expect(selfClosedTabRecovery({ diagnoses: [timedOut], selfClosedPagesSinceCapture: 0 })).toBe("not-a-self-close");
  });

  it("leaves a version-skewed client to the run-stopping path it already has", () => {
    expect(selfClosedTabRecovery({ diagnoses: [versionSkew], selfClosedPagesSinceCapture: 0 })).toBe(
      "not-a-self-close",
    );
  });

  it("leaves a page that would not load costing one page through its own error", () => {
    expect(selfClosedTabRecovery({ diagnoses: [pageTimedOut], selfClosedPagesSinceCapture: 0 })).toBe(
      "not-a-self-close",
    );
  });

  it("leaves a failure that carries no phrase at all to its own error", () => {
    const unclassified = diagnoseSnippetFailure({ failure: "something nobody has seen before" });

    expect(unclassified.phrases).toEqual([]);
    expect(selfClosedTabRecovery({ diagnoses: [unclassified], selfClosedPagesSinceCapture: 0 })).toBe(
      "not-a-self-close",
    );
  });

  it("answers not-a-self-close when the visit met no failure at all", () => {
    expect(selfClosedTabRecovery({ diagnoses: [], selfClosedPagesSinceCapture: 0 })).toBe("not-a-self-close");
  });
});

describe("gradedFailures", () => {
  it("grades the scheduled-resync shape whole: a thrown self-close the relay retried into another", () => {
    const graded = gradedFailures({ last: pageClosedItselfThrown, priorFailures: [pageClosedItselfThrown] });

    expect(graded).toEqual([pageClosedItselfThrown, pageClosedItselfThrown]);
    expect(selfClosedTabRecovery({ diagnoses: graded, selfClosedPagesSinceCapture: 1 })).toBe(
      "rebuild-and-lose-one-page",
    );
  });

  // A relay drop the relay answered, then the retried page reporting itself gone,
  // keeps the rebuild and retry main gave it rather than propagating the drop.
  it("grades a snippet's report alone after a relay drop the relay already answered", () => {
    const graded = gradedFailures({ last: pageClosedItself, priorFailures: [sessionClosed] });

    expect(graded).toEqual([pageClosedItself]);
    expect(selfClosedTabRecovery({ diagnoses: graded, selfClosedPagesSinceCapture: 0 })).toBe("rebuild-and-retry");
  });

  it("grades nothing when the client threw after a relay drop, as main did", () => {
    expect(gradedFailures({ last: pageClosedItselfThrown, priorFailures: [sessionClosed] })).toEqual([]);
  });

  it("grades a thrown self-close the relay did not retry on its own", () => {
    expect(gradedFailures({ last: pageClosedItselfThrown, priorFailures: [] })).toEqual([pageClosedItselfThrown]);
  });

  it("grades nothing when the attempt's last run met no failure", () => {
    expect(gradedFailures({ last: null, priorFailures: [pageClosedItselfThrown] })).toEqual([]);
  });
});

// The relay's own reconnect runs BEFORE the grader, so the budget is the only thing that can stop a thrown
// self-close on the page after the bound from buying one more rebuild.
describe("restoresReconnectAfterLostPage", () => {
  it("gives the next page its reconnect back after the first page lost this way", () => {
    expect(restoresReconnectAfterLostPage({ selfClosedPagesSinceCapture: 1 })).toBe(true);
  });

  it("leaves the reconnect spent once the bound's worth of pages have been lost, so nothing rebuilds again", () => {
    expect(restoresReconnectAfterLostPage({ selfClosedPagesSinceCapture: MAX_SELF_CLOSED_PAGES_WITHOUT_CAPTURE })).toBe(
      false,
    );
  });

  it("leaves a spent reconnect stopping a thrown self-close on the page after the bound", () => {
    expect(relayRecovery({ diagnosis: pageClosedItselfThrown, reconnectSpent: true })).toBe("stop-the-run");
  });
});

/** What the terminal client prints for one visit: an envelope whose `result` is the snippet's own JSON. */
function clientStdout({ snippet }: { snippet: Record<string, unknown> }): string {
  return JSON.stringify({ result: JSON.stringify(snippet) });
}

describe("snippetFailureOf", () => {
  it("reads the failure a snippet reported about its own page out of the double-encoded envelope", () => {
    const stdout = clientStdout({ snippet: { failure: "page.goto: Target page, context or browser has been closed" } });

    expect(snippetFailureOf({ stdout })).toBe("page.goto: Target page, context or browser has been closed");
  });

  it("answers null for a capture, which reported no failure", () => {
    const stdout = clientStdout({ snippet: { finalUrl: "https://app.hex.tech/home", statusCode: 200 } });

    expect(snippetFailureOf({ stdout })).toBe(null);
  });

  it("answers null for output it cannot read, which captureFrom grades on its own", () => {
    expect(snippetFailureOf({ stdout: "not json" })).toBe(null);
  });
});
