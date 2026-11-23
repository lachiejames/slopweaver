import { describe, expect, it } from "vitest";

import {
  CLIENT_PHRASES,
  type ClientFailureFacts,
  diagnoseClientFailure,
  diagnoseSnippetFailure,
  matchClientPhrases,
  readClientFailureFacts,
} from "../../../browser/clientKill.js";
import type { RelayOperation } from "../../../browser/relayOperation.js";
import { clientBoundMs, clientFailure, VISIT_TIMEOUT_MS } from "../../../browser/relaySession.js";

const TENANT_URL = "https://app.vanta.com/o/private-tenant-slug-9f3a/controls";

const facts = (over: Partial<ClientFailureFacts> = {}): ClientFailureFacts => ({
  code: null,
  signal: null,
  status: null,
  stderr: "",
  stdout: "",
  ...over,
});

/**
 * What `playwright-core` itself throws on a version skew, byte for byte.
 *
 * Composed by `Session.run` in `playwright-core/lib/tools/cli-client/session.js` and reaching this process
 * as a non-zero child's stderr. Written out rather than paraphrased so this case reddens if the vendor
 * rewords it and `CLIENT_PHRASES`'s `client is v` stops firing — a paraphrase would keep passing while the
 * real refusal went back to costing one page each.
 */
const VERSION_SKEW_STDERR =
  "Error: Client is v1.62.1, session 'chrome' is v1.63.0. Run\n\n  playwright-cli -s=chrome open\n\n" +
  "to restart the browser session.";

/** The sentence a version skew is allowed to put in a record — `clientKill.ts`'s own literal. */
const VERSION_SKEW_SAYS =
  "the client is older than the relay daemon it was asked to drive, which that daemon refuses for every " +
  "call until the session is restarted";

describe("diagnoseClientFailure", () => {
  it("names the hang: killed at the bound having printed nothing, so no snippet result came back", () => {
    const diagnosis = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 80_134,
      facts: facts({ code: "ETIMEDOUT", signal: "SIGTERM" }),
    });

    expect(diagnosis.kind).toBe("killed-at-bound");
    expect(diagnosis.runStopping).toBe(false);
    expect(diagnosis.phrases).toEqual([]);
    expect(diagnosis.because).toBe(
      "the browser client was killed at its own 80.0s process bound after 80.1s (SIGTERM), having printed " +
        "nothing at all — so no page snippet result came back, and this is the client waiting on the relay " +
        "rather than a page that would not load",
    );
  });

  it("distinguishes a kill that HAD printed from one that printed nothing", () => {
    const diagnosis = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 80_010,
      facts: facts({ code: "ETIMEDOUT", signal: "SIGTERM", stdout: "0123456789" }),
    });

    expect(diagnosis.kind).toBe("killed-at-bound");
    expect(diagnosis.because).toBe(
      "the browser client was killed at its own 80.0s process bound after 80.0s (SIGTERM), after printing 10 byte(s)",
    );
  });

  it("grades a lost relay off the client's own phrase, and says what it means", () => {
    const diagnosis = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 6_400,
      facts: facts({ status: 1, stderr: "Error: Session closed\n    at Session.run" }),
    });

    expect(diagnosis.kind).toBe("exited-nonzero");
    expect(diagnosis.runStopping).toBe(true);
    expect(diagnosis.phrases).toEqual(["session-closed"]);
    expect(diagnosis.because).toBe(
      "the browser client exited with status 1 after 6.4s, after printing 40 byte(s); it said the relay " +
        "dropped the call while it was in flight",
    );
  });

  it("grades a version skew run-stopping, because the daemon refuses every remaining page the same way", () => {
    const diagnosis = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 1_200,
      facts: facts({ status: 1, stderr: VERSION_SKEW_STDERR }),
    });

    expect(diagnosis.kind).toBe("exited-nonzero");
    expect(diagnosis.phrases).toEqual(["version-skew"]);
    expect(diagnosis.runStopping).toBe(true);
    expect(diagnosis.because).toBe(
      `the browser client exited with status 1 after 1.2s, after printing 124 byte(s); it said ${VERSION_SKEW_SAYS}`,
    );
  });

  it("names a relay that never came up, which used to read as a page that would not load", () => {
    const diagnosis = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 900,
      facts: facts({ status: 1, stderr: "Daemon pid=4471: Daemon process exited with code 1" }),
    });

    expect(diagnosis.runStopping).toBe(false);
    expect(diagnosis.phrases).toEqual(["daemon-exited", "daemon-pid"]);
    expect(diagnosis.because).toBe(
      "the browser client exited with status 1 after 0.9s, after printing 50 byte(s); it said the relay " +
        "daemon exited while it was starting up; the relay daemon failed to come up",
    );
  });

  it("refuses to print a code that is not token-shaped, even when the URL is fed in as one", () => {
    const diagnosis = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 3_000,
      facts: facts({ code: TENANT_URL, stdout: "x" }),
    });

    // The witness is falsifiable: the slug IS in the input, so this reddens if the guard is ever dropped.
    expect(TENANT_URL).toContain("private-tenant-slug-9f3a");
    expect(diagnosis.because).not.toContain("private-tenant-slug-9f3a");
    expect(diagnosis.because).toBe(
      "the browser client failed after 3.0s with an unnamed code, after printing 1 byte(s)",
    );
  });

  it("carries no byte of the client's own output into the sentence, even when the output is the URL", () => {
    const diagnosis = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 80_000,
      facts: facts({ code: "ETIMEDOUT", signal: "SIGTERM", stderr: `failed on ${TENANT_URL}` }),
    });

    expect(diagnosis.because).not.toContain("private-tenant-slug-9f3a");
    expect(diagnosis.because).not.toContain("vanta.com");
    expect(diagnosis.because).toBe(
      "the browser client was killed at its own 80.0s process bound after 80.0s (SIGTERM), after printing 67 byte(s)",
    );
  });

  it("says a client that could not be started at all", () => {
    const diagnosis = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 12,
      facts: facts({ code: "ENOENT" }),
    });

    expect(diagnosis.kind).toBe("never-started");
    expect(diagnosis.because).toBe("the browser client could not be started at all (ENOENT)");
  });

  it("says a client that printed more than one invocation buffers", () => {
    const diagnosis = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 41_200,
      facts: facts({ code: "ENOBUFS", signal: "SIGTERM" }),
    });

    expect(diagnosis.kind).toBe("output-overflowed");
    expect(diagnosis.because).toBe("the browser client printed more than one invocation will buffer, after 41.2s");
  });

  it("does not claim a class the facts do not carry", () => {
    const diagnosis = diagnoseClientFailure({ boundMs: 80_000, elapsedMs: 5_000, facts: facts({ status: 0 }) });

    expect(diagnosis.kind).toBe("unclassified");
    expect(diagnosis.because).toBe(
      "the browser client failed after 5.0s with an unnamed code, having printed nothing at all — so no " +
        "page snippet result came back, and this is the client waiting on the relay rather than a page that " +
        "would not load",
    );
  });
});

describe("diagnoseSnippetFailure", () => {
  it("says the snippet RAN, which is the half the flat sentence could not distinguish", () => {
    const diagnosis = diagnoseSnippetFailure({ failure: `TimeoutError: page.goto: Timeout 45000ms ${TENANT_URL}` });

    expect(diagnosis.kind).toBe("snippet-reported");
    expect(diagnosis.runStopping).toBe(false);
    expect(diagnosis.because).not.toContain("private-tenant-slug-9f3a");
    expect(diagnosis.because).toBe(
      "the page snippet ran in the browser and reported its own failure, so the page was addressed but did " +
        "not give the walk what it asked for",
    );
  });

  it("still grades a snippet failure that lost the relay as a run-stopper", () => {
    const diagnosis = diagnoseSnippetFailure({ failure: "Error: Target closed" });

    expect(diagnosis.runStopping).toBe(true);
    expect(diagnosis.phrases).toEqual(["target-closed"]);
  });
});

describe("readClientFailureFacts", () => {
  it("reads what node threw, exactly as node threw it", () => {
    const read = readClientFailureFacts({
      error: { code: "ETIMEDOUT", signal: "SIGTERM", status: null, stdout: "out", stderr: "err" },
    });

    expect(read).toEqual({ code: "ETIMEDOUT", signal: "SIGTERM", status: null, stderr: "err", stdout: "out" });
  });

  it("reads a thrown value that is not a record at all as no facts", () => {
    expect(readClientFailureFacts({ error: "boom" })).toEqual({
      code: null,
      signal: null,
      status: null,
      stderr: "",
      stdout: "",
    });
  });

  it("reads a field of the wrong type as absent rather than trusting it", () => {
    expect(readClientFailureFacts({ error: { code: 7, signal: {}, status: "1", stdout: [], stderr: null } })).toEqual({
      code: null,
      signal: null,
      status: null,
      stderr: "",
      stdout: "",
    });
  });
});

describe("CLIENT_PHRASES", () => {
  it("is not empty, and every row renders a sentence of its own", () => {
    expect(CLIENT_PHRASES.length).toBeGreaterThan(0);
    expect(CLIENT_PHRASES.filter((phrase) => phrase.says.length === 0)).toEqual([]);
    expect(CLIENT_PHRASES.filter((phrase) => phrase.match !== phrase.match.toLowerCase())).toEqual([]);
  });

  // The run-stopping set is the thing a resync attempt is GRADED on (`browser/walkStops.ts` ->
  // `live/resync/outcome.ts`), so it is pinned rather than counted: a row joining or leaving it changes what
  // a scheduled pass reports about an atlas, and that has to show up in a diff. `version-skew` joined the set
  // because it had been costing one page each, which is what let a linear resync land 21 of 251
  // declared pages and still grade SUCCEEDED.
  it("keeps the run-stopping set at exactly the five that mean the rest of the walk is already lost", () => {
    const stopping = CLIENT_PHRASES.filter((phrase) => phrase.runStopping).map((phrase) => phrase.match);

    expect(stopping).toEqual(["session closed", "target closed", "browser has been closed", "detached", "client is v"]);
  });

  // Pinned for the same reason and against a different failure: this set is what `relaySession.ts` spends a
  // reconnect on, so a row joining it buys an attach per drop and a row leaving it gives up a walk that
  // would have finished. `client is v` is the one run-stopping row deliberately outside it — `Session.run`
  // compares two constants for the life of the client binary, so the same client attaching again is refused
  // identically.
  it("keeps the reattachable set at exactly the four a fresh attach rebuilds", () => {
    const clearable = CLIENT_PHRASES.filter((phrase) => phrase.clearedByReattach).map((phrase) => phrase.match);

    expect(clearable).toEqual(["session closed", "target closed", "browser has been closed", "detached"]);
  });

  it("never marks a phrase reattachable that does not stop the run, which would be a retry of nothing", () => {
    expect(CLIENT_PHRASES.filter((phrase) => phrase.clearedByReattach && !phrase.runStopping)).toEqual([]);
  });

  it("matches case-insensitively, in declaration order", () => {
    expect(matchClientPhrases({ text: "DETACHED and then Session Closed" })).toEqual(["session-closed", "detached"]);
  });

  it("matches nothing in output that carries none of them", () => {
    expect(matchClientPhrases({ text: "everything was fine" })).toEqual([]);
  });
});

describe("clientFailure", () => {
  it("costs one page when the relay is still there, carrying the URL-free sentence", () => {
    const graded = clientFailure({
      diagnosis: diagnoseClientFailure({
        boundMs: 80_000,
        elapsedMs: 80_000,
        facts: facts({ code: "ETIMEDOUT", signal: "SIGTERM" }),
      }),
      reason: `spawnSync node ETIMEDOUT on ${TENANT_URL}`,
      url: TENANT_URL,
    });

    expect(graded.code).toBe("NAVIGATION_FAILED");
    expect(graded).toEqual({
      because:
        "the browser client was killed at its own 80.0s process bound after 80.0s (SIGTERM), having printed " +
        "nothing at all — so no page snippet result came back, and this is the client waiting on the relay " +
        "rather than a page that would not load",
      code: "NAVIGATION_FAILED",
      message: `could not navigate to ${TENANT_URL}: spawnSync node ETIMEDOUT on ${TENANT_URL}`,
      url: TENANT_URL,
    });
  });

  it("stops the run when the diagnosis says the rest of the walk is already lost", () => {
    const graded = clientFailure({
      diagnosis: diagnoseClientFailure({
        boundMs: 80_000,
        elapsedMs: 1_000,
        facts: facts({ status: 1, stderr: "Error: Session closed" }),
      }),
      reason: "Error: Session closed",
      url: TENANT_URL,
    });

    expect(graded).toEqual({
      code: "SESSION_LOST",
      message:
        "the browser session driving this walk is no longer usable: the browser client exited with status 1 " +
        "after 1.0s, after printing 21 byte(s); it said the relay dropped the call while it was in flight",
    });
  });

  // `SESSION_LOST` has no `because` field, so the run-stopping arm has one place to say anything, and what
  // the throw itself says is `Command failed: node …/client.cjs run-code --filename …`. That string is what
  // `walkStops.ts` notes and `live/resync/outcome.ts` records as the reason a resync failed — so the
  // diagnosis is what goes in the message, not the thrown text.
  it("puts the version skew itself in the message, not the thrown `Command failed` line", () => {
    const graded = clientFailure({
      diagnosis: diagnoseClientFailure({
        boundMs: 80_000,
        elapsedMs: 1_200,
        facts: facts({ status: 1, stderr: VERSION_SKEW_STDERR }),
      }),
      reason: `Command failed: node /var/folders/2g/T/slopweaver-page-walk-xk3f/client.cjs -s=chrome run-code`,
      url: TENANT_URL,
    });

    expect(graded).toEqual({
      code: "SESSION_LOST",
      message:
        "the browser session driving this walk is no longer usable: the browser client exited with status 1 " +
        `after 1.2s, after printing 124 byte(s); it said ${VERSION_SKEW_SAYS}`,
    });
    expect(graded.message).not.toContain("Command failed");
    expect(graded.message).not.toContain("private-tenant-slug-9f3a");
  });
});

/**
 * Every arm of the relay's capability union, so the derived bound is asserted per arm rather than once.
 *
 * A forgotten arm cannot slip past this silently: `inPageWaitMs` reads `operation.settleMs` off the whole
 * union, so an arm added without a declared wait fails to COMPILE. This list is what pins the arithmetic.
 */
const OPERATIONS: readonly RelayOperation[] = [
  { kind: "page-visit", photograph: true, screenshotPath: "/tmp/a.png", settleMs: 4_000, url: "https://x.test/" },
  {
    kind: "page-evidence-capture",
    readinessTimeoutMs: 30_000,
    screenshotPath: "/tmp/a.png",
    target: { adapterId: "datadog-logs-v1", targetId: "timeseries" },
    url: "https://x.test/",
  },
  { kind: "notion-settings-observe", screenshotPath: "/tmp/a.png", settleMs: 6_000, url: "https://x.test/" },
  {
    kind: "notion-settings-tab",
    screenshotPath: "/tmp/a.png",
    settleMs: 6_000,
    tabNames: ["Identity"],
    url: "https://x.test/",
  },
  { kind: "datadog-nav-observe", settleMs: 4_000, url: "https://x.test/" },
  { kind: "datadog-palette-observe", screenshotPath: "/tmp/a.png", settleMs: 4_000, url: "https://x.test/" },
  {
    kind: "datadog-monitor-backtest",
    readinessTimeoutMs: 60_000,
    screenshotPath: "/tmp/a.png",
    url: "https://x.test/",
  },
  { kind: "vanta-draft-observe", screenshotPath: "/tmp/a.png", settleMs: 6_000, url: "https://x.test/" },
  {
    kind: "vanta-draft-edit",
    expectedText: "after",
    find: "before",
    replace: "after",
    screenshotPath: "/tmp/a.png",
    settleMs: 6_000,
    url: "https://x.test/",
  },
  { kind: "vanta-policy-version-observe", screenshotPath: "/tmp/a.png", settleMs: 6_000, url: "https://x.test/" },
  {
    kind: "vanta-policy-version-upload",
    beforeScreenshotPath: "/tmp/b.png",
    pdfPath: null,
    screenshotPath: "/tmp/a.png",
    settleMs: 6_000,
    url: "https://x.test/",
  },
];

describe("clientBoundMs", () => {
  it("bounds every declared arm, and never at the old flat number", () => {
    expect(OPERATIONS.length).toBeGreaterThan(0);
    expect(new Set(OPERATIONS.map((operation) => operation.kind)).size).toBe(OPERATIONS.length);
    expect(OPERATIONS.filter((operation) => clientBoundMs({ operation }) === VISIT_TIMEOUT_MS)).toEqual([]);
  });

  it("bounds a Vanta walk page at 80s, against the 120s every hang used to cost", () => {
    const walkPage = OPERATIONS[0]!;

    expect(walkPage.kind).toBe("page-visit");
    expect(clientBoundMs({ operation: walkPage })).toBe(80_000);
    expect(VISIT_TIMEOUT_MS).toBe(120_000);
  });

  it("gives a 60-second-settle shot MORE than the old flat bound, which a flat shorten would have broken", () => {
    const longSettle: RelayOperation = {
      kind: "page-visit",
      photograph: true,
      screenshotPath: "/tmp/a.png",
      settleMs: 60_000,
      url: "https://x.test/",
    };

    expect(clientBoundMs({ operation: longSettle })).toBe(136_000);
  });

  it("takes the readiness wait for the one arm that has no settle", () => {
    const evidence = OPERATIONS[1]!;

    expect(evidence.kind).toBe("page-evidence-capture");
    expect(clientBoundMs({ operation: evidence })).toBe(106_000);
  });
});

/**
 * The two messages the original finding actually carried, written out rather than paraphrased.
 *
 * `Error: Session closed` is what the 251-page Linear walk exited on at `147/251`, raised in
 * `playwright-core/lib/tools/cli-client/session.js`'s `_rejectCallbacks` off `_connection.onclose`. The
 * xero walk in the same sweep carried Playwright's own generic `Target page, context or browser has been
 * closed`. Both are fed in verbatim, because the whole reconnect turns on each one being graded
 * reattachable — a vendor reword that stops `CLIENT_PHRASES` firing would otherwise send both walks back to
 * discarding every completed page in silence.
 */
describe("reattachMayClear, on the two messages the finding measured", () => {
  it("grades the Linear walk's own `Error: Session closed` as worth rebuilding the relay for", () => {
    const diagnosis = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 3_100,
      facts: facts({
        status: 1,
        stderr:
          "Error: Session closed\n    at SocketConnectionClient._rejectCallbacks " +
          "(/x/playwright-core/lib/tools/cli-client/session.js:252:24)",
      }),
    });

    expect(diagnosis.runStopping).toBe(true);
    expect(diagnosis.reattachMayClear).toBe(true);
    expect(diagnosis.phrases).toEqual(["session-closed"]);
  });

  it("grades the xero walk's `Target page, context or browser has been closed` the same way", () => {
    const diagnosis = diagnoseSnippetFailure({
      failure: "Target page, context or browser has been closed",
    });

    expect(diagnosis.runStopping).toBe(true);
    expect(diagnosis.reattachMayClear).toBe(true);
    // The substring that fires is `browser has been closed`; `target closed` is NOT in that sentence.
    expect(diagnosis.phrases).toEqual(["browser-closed"]);
  });

  it("refuses to spend a reconnect on a version-skewed client, which every attach is refused the same way", () => {
    const diagnosis = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 1_200,
      facts: facts({ status: 1, stderr: VERSION_SKEW_STDERR }),
    });

    expect(diagnosis.runStopping).toBe(true);
    expect(diagnosis.reattachMayClear).toBe(false);
  });

  it("asks nothing of a failure that costs one page", () => {
    const diagnosis = diagnoseClientFailure({
      boundMs: 80_000,
      elapsedMs: 45_100,
      facts: facts({ code: "ETIMEDOUT", signal: "SIGTERM" }),
    });

    expect(diagnosis.runStopping).toBe(false);
    expect(diagnosis.reattachMayClear).toBe(false);
  });
});
