/**
 * The ask-lifecycle VOCABULARY — the two derived readings every consumer of the log shares.
 *
 * The point of these cases is that both are DERIVED from one list. `../../../../live/listen/recover.ts` and
 * `../../../../cli/commands/turn/watch.ts` each carried their own hand-written subset of the terminal kinds,
 * and when `satisfied-elsewhere` was added the two disagreed for as long as it took to remember the second
 * file. So the falsifiable assertion here is exhaustiveness in both directions: every terminal kind is
 * classified terminal, and every NON-terminal one is not.
 */
import { describe, expect, it } from "vitest";

import type { AskIdentity } from "../../../../live/ask/identity.js";
import type { AskLifecycleEvent } from "../../../../live/ask/lifecycleEvents.js";
import { RESOLVED_WITHOUT_ANSWER, terminalAskLifecycleEvent } from "../../../../live/ask/lifecycleEvents.js";

const IDENTITY: AskIdentity = {
  channel: "C0SYN000012",
  messageTs: "1787540579.950269",
  threadTs: "1787539401.542749",
};

/** One event of each kind that CLOSES an ask, and the `kind` each must be classified as. */
const TERMINALS: readonly AskLifecycleEvent[] = [
  { ...IDENTITY, answerTs: "1787558807.222889", kind: "answered", tsIso: "2026-08-24T08:06:47.000Z" },
  { ...IDENTITY, kind: "triaged-no-response", reason: "no answer owed", tsIso: "2026-08-24T08:10:00.000Z" },
  { ...IDENTITY, kind: "left-for-a-human", reason: "a person should answer", tsIso: "2026-08-24T08:12:00.000Z" },
  {
    ...IDENTITY,
    code: "HELD",
    kind: "withheld",
    queueId: "q-1",
    reason: "held for review",
    tsIso: "2026-08-24T08:20:00.000Z",
  },
  {
    ...IDENTITY,
    answeredByTs: "1787558807.222889",
    kind: "satisfied-elsewhere",
    reason: "answered above in this thread",
    tsIso: "2026-08-24T08:58:40.000Z",
  },
];

/** Events that look like endings and are not — each one's own doc says why. */
const NON_TERMINALS: readonly AskLifecycleEvent[] = [
  { ...IDENTITY, kind: "failed", reason: "ANSWER_CLAIM_UNRESOLVED", tsIso: "2026-08-24T04:01:59.000Z" },
  { ...IDENTITY, kind: "answer-lost", reason: "post returned no ts", tsIso: "2026-08-24T04:05:00.000Z" },
  { ...IDENTITY, kind: "lease-expired", tsIso: "2026-08-24T05:00:00.000Z" },
  { ...IDENTITY, kind: "dispatch-failed", reason: "spawn refused", tsIso: "2026-08-24T05:10:00.000Z" },
  { ...IDENTITY, kind: "captured", surface: "channel", tsIso: "2026-08-24T03:31:39.000Z", userId: "U_OWNER" },
];

describe("terminalAskLifecycleEvent", () => {
  it("classifies every kind that closes an ask, narrowing to the event itself", () => {
    expect(TERMINALS.map((event) => terminalAskLifecycleEvent({ event })?.kind)).toEqual([
      "answered",
      "triaged-no-response",
      "left-for-a-human",
      "withheld",
      "satisfied-elsewhere",
    ]);
  });

  it("classifies a candidate, a broken turn and a capture as NOT terminal", () => {
    expect(NON_TERMINALS.map((event) => terminalAskLifecycleEvent({ event }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("RESOLVED_WITHOUT_ANSWER", () => {
  it("is exactly the terminal kinds minus the one that posted an answer message", () => {
    expect([...RESOLVED_WITHOUT_ANSWER].toSorted()).toEqual([
      "left-for-a-human",
      "satisfied-elsewhere",
      "triaged-no-response",
      "withheld",
    ]);
  });

  it("excludes `answered`, so a reader holding the answer names it rather than reporting a bare resolution", () => {
    expect(RESOLVED_WITHOUT_ANSWER.has("answered")).toBe(false);
  });

  it("holds every terminal kind it does not exclude, so a new ending is resolved without editing a consumer", () => {
    const terminalKinds = TERMINALS.map((event) => event.kind).filter((kind) => kind !== "answered");

    expect(terminalKinds.length).toBeGreaterThan(0);
    expect(terminalKinds.filter((kind) => !RESOLVED_WITHOUT_ANSWER.has(kind))).toEqual([]);
  });
});
