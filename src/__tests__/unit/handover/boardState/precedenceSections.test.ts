/*
 * `composeBoardModels` precedence — which section an unpaused row lands in: RUN NOW, IN FLIGHT, a draft, DONE, a
 * closed or contradicting terminal row, WAITING ON OWNER and AWAITING SHIP, plus the closed-section predicate. It
 * moved here when `boardState.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { publishedParkedOf } from "../../../../cli/commands/handover/listJsonWait.js";
import { isClosedBoardSection } from "../../../../handover/boardRefusal.js";
import type { RunEvent } from "../../../../handover/ledger.js";
import { compose, doc, journal, NOW, probe } from "./harness.js";

describe("composeBoardModels — precedence", () => {
  it("places an untouched ready doc with no dependencies in RUN NOW", () => {
    const models = compose({ roots: [doc({ slug: "a" })] });
    expect(models[0]?.section).toBe("RUN NOW");
  });

  it("keeps a seat parked on CI between turns IN FLIGHT, naming the pull request and that the tick reseats it", () => {
    const events: readonly RunEvent[] = [
      { atIso: NOW, branch: "a", docHash: "h", kind: "started" },
      { atIso: NOW, kind: "launched", pid: 7, sessionId: "s-1", worktree: "/wt/a" },
      {
        atIso: "2026-08-20T01:00:00.000Z",
        branch: "a",
        kind: "parked",
        screenTail: "❯ ",
        sessionId: "s-1",
        wake: { kind: "checks", number: 9877, repo: "acme/acme-admin" },
        workspaceRef: "workspace:238",
        worktree: "/wt/a",
      },
    ];
    const models = compose({ journals: new Map([["a", journal({ events })]]), roots: [doc({ slug: "a" })] });
    expect([models[0]?.section, models[0]?.reason]).toEqual([
      "IN FLIGHT",
      "parked on CI for acme/acme-admin#9877, seat closed (workspace:238; /wt/a on a) between turns — " +
        "`handover wake` reseats it once due",
    ]);
    expect(publishedParkedOf({ model: models[0]! })!.wake).toEqual({
      kind: "checks",
      number: 9877,
      repo: "acme/acme-admin",
    });
  });

  it("places a declared draft in NOT YET", () => {
    const models = compose({ roots: [doc({ slug: "a", status: "draft" })] });
    expect(models[0]?.section).toBe("NOT YET");
  });

  it("places an authored done doc in DONE", () => {
    const models = compose({ roots: [doc({ slug: "a", status: "done" })] });
    expect(models[0]?.section).toBe("DONE");
  });

  it("flags a done doc whose probes now show partial as CONTRADICTION, not silently DONE", () => {
    const models = compose({
      probeStates: new Map([["/h/a.md", probe({ computed: "partial" })]]),
      roots: [doc({ slug: "a", status: "done" })],
    });
    expect(models[0]?.section).toBe("CONTRADICTION");
  });

  /**
   * Measured: `handover list` (no `--probe`) declines every `command:` probe, and a done doc
   * declaring one alongside an already-passing `path:` probe used to compute `partial` — which
   * `probeStatusContradiction` reads as "the repository shows probes failing", so a doc whose command probe
   * simply had not run yet read as CONTRADICTION before anyone had looked. `unevaluated` fixes it: a bare
   * `list`'s declined probe must never contradict a done doc.
   */
  it("keeps a done doc whose only gap is an unevaluated probe in DONE, not CONTRADICTION", () => {
    const models = compose({
      probeStates: new Map([["/h/a.md", probe({ computed: "unevaluated" })]]),
      roots: [doc({ slug: "a", status: "done" })],
    });
    expect(models[0]?.section).toBe("DONE");
  });

  it("flags a cancelled doc whose probes now land as CONTRADICTION", () => {
    const models = compose({
      probeStates: new Map([["/h/a.md", probe({ computed: "landed" })]]),
      roots: [doc({ slug: "a", status: "cancelled", statusSummary: "abandoned the approach" })],
    });
    expect(models[0]?.section).toBe("CONTRADICTION");
  });

  it("places a consistent cancelled doc in CLOSED — NOT SHIPPED", () => {
    const models = compose({ roots: [doc({ slug: "a", status: "cancelled", statusSummary: "not worth it" })] });
    expect(models[0]?.section).toBe("CLOSED — NOT SHIPPED");
  });

  it("places a consistent rejected doc in CLOSED — NOT SHIPPED", () => {
    const models = compose({ roots: [doc({ slug: "a", status: "rejected", statusSummary: "owner declined" })] });
    expect(models[0]?.section).toBe("CLOSED — NOT SHIPPED");
  });

  it("places a terminal doc with an active run in CONTRADICTION", () => {
    const models = compose({
      journals: new Map([["a", journal({ events: [{ atIso: NOW, branch: "a", docHash: "h", kind: "started" }] })]]),
      roots: [doc({ slug: "a", status: "cancelled", statusSummary: "closed" })],
    });
    expect(models[0]?.section).toBe("CONTRADICTION");
  });

  it("places a waiting-on-owner run in WAITING ON OWNER", () => {
    const models = compose({
      journals: new Map([
        [
          "a",
          journal({
            events: [
              { atIso: NOW, branch: "a", docHash: "h", kind: "started" },
              { atIso: NOW, kind: "question", question: "which repo?" },
            ],
          }),
        ],
      ]),
      roots: [doc({ slug: "a", status: "ready" })],
    });
    expect(models[0]?.section).toBe("WAITING ON OWNER");
  });

  it("prints an ordinary waiting-on-owner question as the reason, unlabelled", () => {
    const models = compose({
      journals: new Map([
        [
          "a",
          journal({
            events: [
              { atIso: NOW, branch: "a", docHash: "h", kind: "started" },
              { atIso: NOW, kind: "question", question: "which repo?" },
            ],
          }),
        ],
      ]),
      roots: [doc({ slug: "a", status: "ready" })],
    });
    expect(models[0]?.reason).toBe("waiting on the owner: which repo?");
  });

  it("labels a row parked on a pre-approved cassette recording as a doctrine violation, question still shown", () => {
    const models = compose({
      journals: new Map([
        [
          "a",
          journal({
            events: [
              { atIso: NOW, branch: "a", docHash: "h", kind: "started" },
              { atIso: NOW, kind: "question", question: "Ok to record the integration cassette? It posts for real." },
            ],
          }),
        ],
      ]),
      roots: [doc({ slug: "a", status: "ready" })],
    });
    expect(models[0]?.section).toBe("WAITING ON OWNER");
    expect(models[0]?.reason).toContain("DOCTRINE VIOLATION");
    expect(models[0]?.reason).toContain(
      "The recorded question: Ok to record the integration cassette? It posts for real.",
    );
  });

  it("places an open run in IN FLIGHT", () => {
    const models = compose({
      journals: new Map([["a", journal({ events: [{ atIso: NOW, branch: "a", docHash: "h", kind: "started" }] })]]),
      roots: [doc({ slug: "a", status: "ready" })],
    });
    expect(models[0]?.section).toBe("IN FLIGHT");
  });

  it("places a not-yet-started doc with an unevaluated probe in IN FLIGHT, naming the gap", () => {
    const models = compose({
      probeStates: new Map([
        [
          "/h/a.md",
          probe({
            computed: "unevaluated",
            results: [
              { note: "docs/x.md exists", outcome: "pass", probe: { kind: "path", path: "docs/x.md" } },
              {
                note: "command probe not evaluated — pass --probe to run it",
                outcome: "not-evaluated",
                probe: { command: "yarn test", kind: "command" },
              },
            ],
          }),
        ],
      ]),
      roots: [doc({ slug: "a", status: "ready" })],
    });
    expect(models[0]?.section).toBe("IN FLIGHT");
    expect(models[0]?.reason).toBe("1 of 2 probes pass, 1 not evaluated — pass --probe to check the rest");
  });

  it("places a finished run without landed probes in AWAITING SHIP, not DONE", () => {
    const models = compose({
      journals: new Map([
        [
          "a",
          journal({
            events: [
              { atIso: NOW, branch: "a", docHash: "h", kind: "started" },
              { atIso: NOW, kind: "finished", residue: [] },
            ],
          }),
        ],
      ]),
      probeStates: new Map([["/h/a.md", probe({ computed: "partial" })]]),
      roots: [doc({ slug: "a", status: "ready" })],
    });
    expect(models[0]?.section).toBe("AWAITING SHIP");
  });

  it("has a closed-section predicate true only for DONE and CLOSED — NOT SHIPPED", () => {
    expect(isClosedBoardSection({ section: "DONE" })).toBe(true);
    expect(isClosedBoardSection({ section: "CLOSED — NOT SHIPPED" })).toBe(true);
    expect(isClosedBoardSection({ section: "RUN NOW" })).toBe(false);
    expect(isClosedBoardSection({ section: "CONTRADICTION" })).toBe(false);
  });
});
