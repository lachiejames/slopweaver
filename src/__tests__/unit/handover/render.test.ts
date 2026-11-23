import { describe, expect, it } from "vitest";

import { composeBoardModels } from "../../../handover/boardState.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import type { DocProbeState, HandoverDoc } from "../../../handover/doc.js";
import { renderBoard } from "../../../handover/render.js";

function doc({
  slug,
  status = "ready",
  blockedBy = [],
  artifact,
  pausedOn,
  pausedSince,
}: {
  slug: string;
  status?: HandoverDoc["status"];
  blockedBy?: readonly string[];
  artifact?: string;
  pausedOn?: string;
  pausedSince?: string;
}): HandoverDoc {
  return {
    anchor: undefined,
    askedIso: undefined,
    kind: "doc",
    priority: undefined,
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    origin: undefined,
    observedBy: undefined,
    registeredBy: undefined,
    registeredRun: undefined,
    evidence: [],
    ruling: undefined,
    rulingAnchor: undefined,
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    artifact,
    baseBranch: undefined,
    blockedBy,
    branch: undefined,
    doneWhen: [],
    notDoneReason: undefined,
    outputs: [],
    pausedOn,
    pausedSince,
    path: `/h/${slug}.md`,
    probeWaiver: undefined,
    lean: undefined,
    examples: [],
    exampleGap: undefined,
    risk: undefined,
    blastRadius: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    options: [],
    problem: undefined,
    problems: [],
    repo: "/w/repo",
    role: undefined,
    slug,
    status,
    statusSummary: undefined,
    supervisorState: undefined,
    summary: `what ${slug} does`,
  };
}

/** Compose every doc with no probe/journal evidence — the plain declared-status board. */
function modelsFor({
  docs,
  probeStates = new Map<string, DocProbeState>(),
}: {
  docs: readonly HandoverDoc[];
  probeStates?: ReadonlyMap<string, DocProbeState>;
}): readonly BoardModel[] {
  return composeBoardModels({ journals: new Map(), probeStates, resolutionDocs: docs, roots: docs });
}

describe("renderBoard", () => {
  it("leads with what can be started, and says how", () => {
    const lines = renderBoard({ models: modelsFor({ docs: [doc({ slug: "ready-one" })] }), unreadable: [] });

    expect(lines[0]).toBe("RUN NOW — 1 ready:");
    expect(lines.some((line) => line.includes("paste: /h/ready-one.md"))).toBe(true);
    expect(lines.some((line) => line.includes("repo:  /w/repo"))).toBe(true);
  });

  // the reader hands back a quoted summary's real line breaks, and one printed raw reads as a second row.
  it("prints a multi-line summary on its row's one line, so a line in it cannot pose as another row", () => {
    const multi = { ...doc({ slug: "multi" }), summary: "legit\n  forged-row — forged" };
    const lines = renderBoard({ models: modelsFor({ docs: [multi] }), unreadable: [] });

    expect(lines[2]).toBe("  multi — legit forged-row — forged");
    expect(lines.filter((line) => line.includes("forged-row"))).toEqual(["  multi — legit forged-row — forged"]);
  });

  it("prints a finding's multi-line evidence on its one origin line", () => {
    const row = {
      ...doc({ slug: "found" }),
      evidence: ["legit\nFORGED ROW"],
      kind: "ask" as const,
      observedBy: "session-40",
      origin: "finding" as const,
    };
    const lines = renderBoard({ models: modelsFor({ docs: [row] }), unreadable: [] });

    expect(lines.filter((line) => line.includes("FORGED ROW"))).toEqual([
      "      origin: a fleet finding, observed by session-40 from legit FORGED ROW",
    ]);
  });

  /** The owner reads the artifact, not the doc, days later. A missing one is worth seeing. */
  it("says outright when a runnable doc has no artifact", () => {
    const lines = renderBoard({ models: modelsFor({ docs: [doc({ slug: "bare" })] }), unreadable: [] });

    expect(lines.some((line) => line.includes("no artifact linked"))).toBe(true);
    expect(lines.filter((line) => line.includes("why:"))).toEqual([
      "      why:   (no artifact linked — you will be reading the doc itself)",
    ]);
  });

  it("shows the artifact when there is one", () => {
    const lines = renderBoard({
      models: modelsFor({ docs: [doc({ artifact: "https://example.invalid/a", slug: "linked" })] }),
      unreadable: [],
    });

    expect(lines.some((line) => line.includes("https://example.invalid/a"))).toBe(true);
    expect(lines.filter((line) => line.includes("why:"))).toEqual(["      why:   https://example.invalid/a"]);
  });

  it("names what a blocked doc is waiting on", () => {
    const docs = [doc({ slug: "first" }), doc({ blockedBy: ["first"], slug: "second" })];

    const lines = renderBoard({ models: modelsFor({ docs }), unreadable: [] });

    expect(lines.some((line) => line.includes("second") && line.includes("waiting on first"))).toBe(true);
  });

  it("distinguishes a typo'd dependency from a real one, because a typo blocks forever", () => {
    const lines = renderBoard({
      models: modelsFor({ docs: [doc({ blockedBy: ["ghost"], slug: "stuck" })] }),
      unreadable: [],
    });

    expect(lines.some((line) => line.includes("no doc on the board claims"))).toBe(true);
  });

  it("says plainly when nothing can be started, once DONE is shown with --all", () => {
    const lines = renderBoard({
      models: modelsFor({ docs: [doc({ slug: "a", status: "done" })] }),
      showAll: true,
      unreadable: [],
    });

    expect(lines[0]).toBe("Nothing is runnable right now.");
  });

  it("hides a done doc by default", () => {
    const lines = renderBoard({ models: modelsFor({ docs: [doc({ slug: "a", status: "done" })] }), unreadable: [] });

    expect(lines.join("\n")).toContain("1 terminal doc(s) hidden; use --all.");
  });

  /**
   * A doc silently missing reads as work that was never planned. Worse, an unreadable doc cannot take part
   * in duplicate or dependency resolution — so it may be exactly what should have blocked something printed
   * as runnable. Found by a review pass: the caveat has to come BEFORE the answer, not after it.
   */
  it("warns about an unreadable file before anything that looks like an answer", () => {
    const lines = renderBoard({ models: modelsFor({ docs: [doc({ slug: "a" })] }), unreadable: ["broken.md"] });

    expect(lines[0]).toBe("⚠ 1 doc(s) could not be read: broken.md");
    expect(lines[1]).toContain("may be incomplete");
  });

  it("says nothing about unreadable files when every doc parsed", () => {
    const lines = renderBoard({ models: modelsFor({ docs: [doc({ slug: "a" })] }), unreadable: [] });

    expect(lines.some((line) => line.includes("could not be read"))).toBe(false);
  });
});

describe("the board states how much of itself it can verify", () => {
  /** Without a count, a reader has to tally every doc by hand to notice most of the board is unverifiable. */
  it("names the fraction of live docs that declare conditions", () => {
    const probed: HandoverDoc = { ...doc({ slug: "probed" }), doneWhen: [{ kind: "path", path: "a" }] };
    const bare = doc({ slug: "bare" });

    const lines = renderBoard({ models: modelsFor({ docs: [probed, bare] }), unreadable: [] }).join("\n");

    expect(lines).toContain("⚠ 1 of 2 live doc(s) declare");
    expect(lines).toContain("The other 1 report the status they were TOLD");
  });

  /**
   * `outputs:` deliberately does NOT count. Measured: a decision doc declaring `outputs: [docs/constraints.md]`
   * computed `landed` and printed under LOOK SHIPPED the moment it was written, because that file already
   * existed — nothing had been decided. A judgement doc honestly has no mechanical done-signal, and saying so
   * beats inventing one.
   */
  it("does NOT count an outputs-only doc as verifiable — an existing output proves nothing", () => {
    const outputsOnly: HandoverDoc = { ...doc({ slug: "investigation" }), outputs: ["docs/decision.md"] };

    const lines = renderBoard({ models: modelsFor({ docs: [outputsOnly] }), unreadable: [] }).join("\n");

    expect(lines).toContain("⚠ 0 of 1 live doc(s) declare");
  });

  it("excludes done docs, whose status is settled", () => {
    const finished = doc({ slug: "shipped", status: "done" });
    const probed: HandoverDoc = { ...doc({ slug: "probed" }), doneWhen: [{ kind: "path", path: "a" }] };

    const lines = renderBoard({ models: modelsFor({ docs: [finished, probed] }), unreadable: [] }).join("\n");

    expect(lines).toContain("All 1 live doc(s) declare conditions");
  });
});

describe("terminal-not-shipped visibility", () => {
  const cancelled = () => doc({ slug: "shelved", status: "cancelled" });

  it("hides a cancelled doc by default", () => {
    const lines = renderBoard({ models: modelsFor({ docs: [cancelled()] }), unreadable: [] }).join("\n");

    expect(lines).not.toContain("shelved");
    expect(lines).toContain("1 terminal doc(s) hidden; use --all.");
  });

  it("shows a cancelled doc with --all, under CLOSED — NOT SHIPPED", () => {
    const lines = renderBoard({ models: modelsFor({ docs: [cancelled()] }), showAll: true, unreadable: [] }).join("\n");

    expect(lines).toContain("CLOSED — NOT SHIPPED (1):");
    expect(lines).toContain("shelved");
  });
});

describe("renderBoard — the paused section", () => {
  /** The owner's ask, rendered: the board SAYS who, and says nothing that reads as a countdown. */
  it("prints a paused row by default, naming who it waits on", () => {
    const lines = renderBoard({
      models: modelsFor({ docs: [doc({ pausedOn: "a reviewer", slug: "parked", status: "paused" })] }),
      unreadable: [],
    });

    expect(lines).toContain("PAUSED — 1 waiting on someone, with no deadline and nothing overdue:");
    expect(lines.some((line) => line.includes("parked") && line.includes("paused on a reviewer"))).toBe(true);
  });

  it("prints the recorded date verbatim, never an elapsed count", () => {
    const lines = renderBoard({
      models: modelsFor({
        docs: [
          doc({ pausedOn: "a reviewer", pausedSince: "2026-09-04T02:00:00.000Z", slug: "parked", status: "paused" }),
        ],
      }),
      unreadable: [],
    });

    expect(lines.some((line) => line.includes("since 2026-09-04T02:00:00.000Z — no deadline, never overdue"))).toBe(
      true,
    );
  });

  /** `--all` is for terminal rows. A parked row is live, so it must never need the flag to be seen. */
  it("shows a paused row without --all, and never counts it as hidden", () => {
    const lines = renderBoard({
      models: modelsFor({ docs: [doc({ pausedOn: "a reviewer", slug: "parked", status: "paused" })] }),
      unreadable: [],
    });

    expect(lines.some((line) => line.includes("terminal doc(s) hidden"))).toBe(false);
  });

  it("prints no paused heading when nothing is paused", () => {
    const lines = renderBoard({ models: modelsFor({ docs: [doc({ slug: "a" })] }), unreadable: [] });

    expect(lines.some((line) => line.startsWith("PAUSED"))).toBe(false);
  });
});

describe("renderBoard — a CONTRADICTION row says which probe", () => {
  /**
   * The board used to print one sentence for every probe-derived contradiction — *"declared done, but the
   * repository currently shows its probes failing or partial"* — across thirty-odd rows, and a reader could
   * not tell a failing probe from one nothing had looked at. Both now appear beneath the row, the second
   * spelled out as a word rather than left as its `–` glyph.
   */
  it("names each failing probe and each not-evaluated one beneath the reason", () => {
    const contradicting = doc({ slug: "a", status: "done" });
    const lines = renderBoard({
      models: modelsFor({
        docs: [contradicting],
        probeStates: new Map([
          [
            "/h/a.md",
            {
              commitsAhead: 0,
              computed: "partial" as const,
              results: [
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
              ],
            },
          ],
        ]),
      }),
      unreadable: [],
    });

    expect(lines).toContain("      ✘ fail          src/handover/probe.ts does not contain `codeBearing`");
    expect(lines).toContain("      – not evaluated command not evaluated — pass --probe to run it: yarn lint");
  });

  /**
   * A `cancelled` row whose probes all pass — the row where the passing probes ARE the contradiction
   * (`probeStatusContradiction`'s second rule). The line must therefore report what the probes observed
   * and claim no origin: an earlier draft read "the disagreement is with the authored status, not with a
   * probe", which is false here, and this test asserted it.
   */
  it("reports that every probe passes without claiming the repository is not the subject", () => {
    const lines = renderBoard({
      models: modelsFor({
        docs: [doc({ slug: "a", status: "cancelled" })],
        probeStates: new Map([
          [
            "/h/a.md",
            {
              commitsAhead: 0,
              computed: "landed" as const,
              results: [
                {
                  note: "src/live/slack/threadOracle.ts contains `threadOracle`",
                  outcome: "pass" as const,
                  probe: { file: "src/live/slack/threadOracle.ts", kind: "present" as const, symbol: "threadOracle" },
                },
              ],
            },
          ],
        ]),
      }),
      unreadable: [],
    });

    expect(lines).toContain("      every probe PASSES — read the row's reason above for what disagrees");
  });
});
