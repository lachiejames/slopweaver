/*
 * `composeBoardModels` precedence for a row paused on a person — PAUSED and its reason, what outranks a pause and
 * what a pause outranks, a nameless pause, and a pause never satisfying a dependency. It moved here when
 * `boardState.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { isClosedBoardSection } from "../../../../handover/boardRefusal.js";
import { compose, doc, journal, NOW, probe } from "./harness.js";

describe("composeBoardModels — precedence", () => {
  it("places a row paused on a person in PAUSED, saying who", () => {
    const models = compose({
      roots: [doc({ pausedOn: "a reviewer", pausedSince: "2026-09-04T02:00:00.000Z", slug: "a", status: "paused" })],
    });

    expect(models[0]?.section).toBe("PAUSED");
    expect(models[0]?.reason).toBe("paused on a reviewer, since 2026-09-04T02:00:00.000Z — no deadline, never overdue");
  });

  /** The whole ask: parked work stays LIVE, so nothing hides it the way `done` would. */
  it("keeps a paused row out of the sections the board hides by default", () => {
    expect(isClosedBoardSection({ section: "PAUSED" })).toBe(false);
  });

  it("appends the statusSummary so the row says what is being waited for", () => {
    const models = compose({
      roots: [doc({ pausedOn: "a reviewer", slug: "a", status: "paused", statusSummary: "sample sent, no reply yet" })],
    });

    expect(models[0]?.reason).toBe("paused on a reviewer — no deadline, never overdue — sample sent, no reply yet");
  });

  /** A pause is not a verdict on the code: probes that all pass still mean the work may have landed. */
  it("lets LOOKS SHIPPED outrank a pause when every probe passes", () => {
    const models = compose({
      probeStates: new Map([["/h/a.md", probe({ computed: "landed" })]]),
      roots: [
        doc({
          doneWhen: [{ kind: "path", path: "x.ts" }],
          pausedOn: "a reviewer",
          slug: "a",
          status: "paused",
        }),
      ],
    });

    expect(models[0]?.section).toBe("LOOKS SHIPPED");
  });

  /**
   * MEASURED on the live board: the first real paused row printed under AWAITING SHIP, because
   * a `finished` run was read before the pause could speak. Recording a pause is the last thing a run does.
   */
  it("keeps a paused row in PAUSED when its run finished, rather than AWAITING SHIP", () => {
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
      roots: [doc({ pausedOn: "a reviewer", slug: "a", status: "paused" })],
    });

    expect(models[0]?.section).toBe("PAUSED");
  });

  /** The same journal with no pause still reads AWAITING SHIP — the rule above weakened nothing. */
  it("still places an unpaused finished run in AWAITING SHIP", () => {
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
      roots: [doc({ slug: "a" })],
    });

    expect(models[0]?.section).toBe("AWAITING SHIP");
  });

  /** Somebody is inside the work right now, which outranks an authored pause. */
  it("lets an open run outrank a pause", () => {
    const models = compose({
      journals: new Map([["a", journal({ events: [{ atIso: NOW, branch: "a", docHash: "h", kind: "started" }] })]]),
      roots: [doc({ pausedOn: "a reviewer", slug: "a", status: "paused" })],
    });

    expect(models[0]?.section).toBe("IN FLIGHT");
  });

  /** The owner's own move never files behind somebody else's silence. */
  it("lets a recorded question outrank a pause", () => {
    const models = compose({
      journals: new Map([
        [
          "a",
          journal({
            events: [
              { atIso: NOW, branch: "a", docHash: "h", kind: "started" },
              { atIso: NOW, kind: "question", question: "which base?" },
            ],
          }),
        ],
      ]),
      roots: [doc({ pausedOn: "a reviewer", slug: "a", status: "paused" })],
    });

    expect(models[0]?.section).toBe("WAITING ON OWNER");
  });

  /** A pause nobody can act on is worse than none, so a nameless one is loud rather than parked. */
  it("places a paused row that names nobody in CONTRADICTION", () => {
    const models = compose({
      roots: [
        doc({
          problems: [
            "a paused row declares no pausedOn — `paused` with nobody named is the unfalsifiable parking this state replaced",
          ],
          slug: "a",
          status: "paused",
        }),
      ],
    });

    expect(models[0]?.section).toBe("CONTRADICTION");
  });

  it("never lets a paused row satisfy another doc's blockedBy", () => {
    const models = compose({
      roots: [doc({ pausedOn: "a reviewer", slug: "a", status: "paused" }), doc({ blockedBy: ["a"], slug: "b" })],
    });

    expect(models[0]?.satisfiesDependency).toBe(false);
    expect(models[1]?.section).toBe("NOT YET");
  });
});
