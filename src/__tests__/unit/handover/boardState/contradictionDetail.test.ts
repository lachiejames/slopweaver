/*
 * `contradictionDetail` — what a CONTRADICTION row prints under itself: every probe passing, none declared, each
 * outcome spelled out, and nothing failed while something went unevaluated. It moved here when
 * `boardState.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { contradictionDetail } from "../../../../handover/boardState.js";
import { compose, doc, journal, NOW, probe } from "./harness.js";

describe("contradictionDetail", () => {
  /**
   * The measured case that started this, stated as a test: a row contradicting on its RUN JOURNAL while
   * every probe it declares passes. The board reported `slack-reply-count-oracle-implementation`
   * contradicting; both symbols were present by hand against the main checkout; and nothing
   * in the tool reconciled the two readings. The last line is that reconciliation.
   */
  it("reports that every probe passes and points at the reason, claiming no origin of its own", () => {
    const model = compose({
      journals: new Map([["a", journal({ events: [{ atIso: NOW, branch: "a", docHash: "h", kind: "started" }] })]]),
      probeStates: new Map([
        [
          "/h/a.md",
          probe({
            computed: "landed",
            results: [
              {
                note: "src/live/slack/threadOracle.ts contains `threadOracle`",
                outcome: "pass",
                probe: { file: "src/live/slack/threadOracle.ts", kind: "present", symbol: "threadOracle" },
              },
            ],
          }),
        ],
      ]),
      roots: [
        doc({
          doneWhen: [{ file: "src/live/slack/threadOracle.ts", kind: "present", symbol: "threadOracle" }],
          slug: "a",
          status: "done",
        }),
      ],
    });

    expect(model[0]!.section).toBe("CONTRADICTION");
    expect(contradictionDetail({ model: model[0]! })).toEqual([
      "      ✔ pass          src/live/slack/threadOracle.ts contains `threadOracle`",
      "      every probe PASSES — read the row's reason above for what disagrees",
    ]);
  });

  /** A row with no probes at all: silence here read as "the tool has no answer". */
  it("says nothing was checked when the row declares no probes", () => {
    const model = compose({
      journals: new Map([["a", journal({ events: [{ atIso: NOW, branch: "a", docHash: "h", kind: "started" }] })]]),
      roots: [doc({ slug: "a", status: "done" })],
    });

    expect(model[0]!.section).toBe("CONTRADICTION");
    expect(contradictionDetail({ model: model[0]! })).toEqual([
      "      no probe was evaluated for this row — nothing in the repository was checked either way",
    ]);
  });

  /**
   * The three outcomes side by side. `not evaluated` is spelled as a WORD rather than left as the `–`
   * glyph: the glyph is exactly what made "nothing looked" indistinguishable from a failure, which is the
   * defect. The trailing reconciliation line is absent here, because a probe really did fail.
   */
  it("spells every outcome out, not-evaluated included, and adds no reconciliation line once one failed", () => {
    const results = [
      {
        note: "src/handover/probe.ts does not contain `codeBearing`",
        outcome: "fail" as const,
        probe: { file: "src/handover/probe.ts", kind: "present" as const, symbol: "codeBearing" },
      },
      {
        note: "command not evaluated — pass --probe to run it: yarn lint",
        outcome: "not-evaluated" as const,
        probe: { command: "yarn lint", kind: "command" as const },
      },
      {
        note: "docs/x.md exists",
        outcome: "pass" as const,
        probe: { kind: "path" as const, path: "docs/x.md" },
      },
    ];
    const model = compose({
      probeStates: new Map([["/h/a.md", probe({ computed: "partial", results })]]),
      roots: [
        doc({
          doneWhen: [{ kind: "path", path: "docs/x.md" }],
          slug: "a",
          status: "done",
        }),
      ],
    });

    expect(model[0]!.section).toBe("CONTRADICTION");
    expect(contradictionDetail({ model: model[0]! })).toEqual([
      "      ✘ fail          src/handover/probe.ts does not contain `codeBearing`",
      "      – not evaluated command not evaluated — pass --probe to run it: yarn lint",
      "      ✔ pass          docs/x.md exists",
    ]);
  });
});

describe("contradictionDetail — nothing failed but something was never looked at", () => {
  /**
   * The third arm, and the one the generic sentence hid hardest: a row contradicting on its journal while
   * one of its probes was never run at all. "Failing or partial" said neither of those things.
   */
  it("counts the unevaluated probes rather than implying every probe passed", () => {
    const model = compose({
      journals: new Map([["a", journal({ events: [{ atIso: NOW, branch: "a", docHash: "h", kind: "started" }] })]]),
      probeStates: new Map([
        [
          "/h/a.md",
          probe({
            computed: "unevaluated",
            results: [
              {
                note: "docs/x.md exists",
                outcome: "pass",
                probe: { kind: "path", path: "docs/x.md" },
              },
              {
                note: "command not evaluated — pass --probe to run it: yarn lint",
                outcome: "not-evaluated",
                probe: { command: "yarn lint", kind: "command" },
              },
            ],
          }),
        ],
      ]),
      roots: [doc({ doneWhen: [{ kind: "path", path: "docs/x.md" }], slug: "a", status: "done" })],
    });

    expect(model[0]!.section).toBe("CONTRADICTION");
    expect(contradictionDetail({ model: model[0]! })).toEqual([
      "      ✔ pass          docs/x.md exists",
      "      – not evaluated command not evaluated — pass --probe to run it: yarn lint",
      "      no probe FAILED; 1 not evaluated — read the row's reason above",
    ]);
  });
});
