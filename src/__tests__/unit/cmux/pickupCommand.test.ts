/**
 * {@link resolvePickupCommand} — the template is the only pickup, and the doc's text is not an input.
 *
 * The first describe block is a past incident frozen as a fixture: the successor doc's real findings
 * heading and the real witness-table row that was typed at a booted session as its pickup. It is kept in the
 * exact shape that fired, so a future "smarter" heading match cannot quietly re-open the class.
 */
import { describe, expect, it } from "vitest";

import {
  launchOperationForPhase,
  launchOperationForRun,
  resolvePickupCommand,
  resolveSpawnPickupCommand,
  WAIT_RULE_INSTRUCTION,
} from "../../../cmux/pickupCommand.js";

const DOC_PATH = "/repo/handovers/a-doc.md";

/** The self-executing instruction {@link resolvePickupCommand} composes for one lifecycle verb. */
function lifecycleInstruction({ verb, slug }: { verb: "start" | "resume"; slug: string }): string {
  return (
    `Read ${DOC_PATH} end to end, then run: slopweaver handover ${verb} ${slug}, then execute the doc. ` +
    `It is complete; do not re-plan or ask what it covers. ${WAIT_RULE_INSTRUCTION}`
  );
}

/**
 * The exact row `session respawn loop --successor <the 31aug-d loop doc>` sent to a successor
 * — the first fenced line under the first heading in that doc containing the word "pickup".
 */
const WITNESS_TABLE_ROW =
  "<channel>  dispatch-unwitnessed 05:04:29.565Z  ->  dispatch-witnessed 05:15:40.801Z  ->  answered";

describe("the incident shape — a findings heading that mentions pickups, followed by a fenced table", () => {
  it("never reaches the session: the pickup is the template whatever the doc says", () => {
    const docText = [
      "# Wednesday loop, fifty-sixth cut",
      "",
      "## ★★ THE PICKUP WITNESS IS 0-FOR-3 IN-BAND, AND RECONCILIATION IS 3-FOR-3",
      "",
      "```",
      WITNESS_TABLE_ROW,
      "<channel>  dispatch-unwitnessed 05:20:11.001Z  ->  answered",
      "```",
      "",
      "## Pick up in a fresh visible session",
      "",
      "```text",
      "/slopweaver:pickup live-loop-31aug-d",
      "```",
    ].join("\n");
    const slug = "live-loop-31aug-d";

    const command = resolvePickupCommand({ docPath: DOC_PATH, location: {}, runPhase: "closed", slug });

    expect(command).toBe(lifecycleInstruction({ slug, verb: "start" }));
    expect(command.includes(WITNESS_TABLE_ROW)).toBe(false);
    expect(docText.includes(WITNESS_TABLE_ROW)).toBe(true);
  });
});

describe("resolvePickupCommand", () => {
  it("starts a never-run handover with a self-executing instruction naming the doc path", () => {
    expect(resolvePickupCommand({ docPath: DOC_PATH, location: {}, runPhase: "closed", slug: "a-doc" })).toBe(
      lifecycleInstruction({ slug: "a-doc", verb: "start" }),
    );
  });

  it("resumes a handover whose run is open or waiting on the owner", () => {
    expect(resolvePickupCommand({ docPath: DOC_PATH, location: {}, runPhase: "open", slug: "a-doc" })).toBe(
      lifecycleInstruction({ slug: "a-doc", verb: "resume" }),
    );
    expect(resolvePickupCommand({ docPath: DOC_PATH, location: {}, runPhase: "waiting-on-owner", slug: "a-doc" })).toBe(
      lifecycleInstruction({ slug: "a-doc", verb: "resume" }),
    );
  });

  it("names the slug it was given, never one read from anywhere else", () => {
    expect(resolvePickupCommand({ docPath: DOC_PATH, location: {}, runPhase: "open", slug: "another-doc" })).toBe(
      lifecycleInstruction({ slug: "another-doc", verb: "resume" }),
    );
  });

  it("carries no slash command, so the same line serves a codex session that registers none", () => {
    expect(
      resolvePickupCommand({ docPath: DOC_PATH, location: {}, runPhase: "closed", slug: "a-doc" }).includes(
        "/slopweaver:",
      ),
    ).toBe(false);
  });
});

describe("a located spawn", () => {
  it("carries the --dir and --home the spawn was given onto the lifecycle verb, in that order", () => {
    expect(
      resolveSpawnPickupCommand({
        docPath: DOC_PATH,
        location: { dir: "/scratch/docs", home: "/scratch/home" },
        runEvents: [],
        slug: "a-doc",
      }),
    ).toBe(
      `Read ${DOC_PATH} end to end, then run: slopweaver handover start a-doc --dir /scratch/docs --home /scratch/home, ` +
        `then execute the doc. It is complete; do not re-plan or ask what it covers. ${WAIT_RULE_INSTRUCTION}`,
    );
  });

  it("quotes a location holding a space, so the seat's shell reads it as one word", () => {
    expect(
      resolvePickupCommand({
        docPath: DOC_PATH,
        location: { home: "/scratch/my home" },
        runPhase: "open",
        slug: "a-doc",
      }),
    ).toContain("then run: slopweaver handover resume a-doc --home '/scratch/my home', then execute the doc.");
  });
});

describe("no sidebar publishing", () => {
  it("never tells a spawned session to publish a cmux checklist or status lane", () => {
    const command = resolvePickupCommand({ docPath: DOC_PATH, location: {}, runPhase: "closed", slug: "a-doc" });

    expect(command.includes("cmux todo")).toBe(false);
    expect(command.includes("cmux status")).toBe(false);
    expect(command.includes("Publish progress")).toBe(false);
  });
});

describe("the wait-rule sentence", () => {
  it("tells a spawned session never to sleep-poll, to keep its seat through its own landing, and to park only on a clock or another branch", () => {
    expect(WAIT_RULE_INSTRUCTION).toBe(
      "Never sleep-poll in the foreground. A short wait inside active work (a test, a push, a Codex pass) runs as a " +
        "bounded background job whose completion resumes you. Your own pull request's CI, a rebase, a red-CI fix and " +
        "landing it are the work, so keep your seat through them: wait with slopweaver github checks --number N " +
        "--repo owner/repo --wait as a background job, or --until merge once it is queued, and never park on your own " +
        "pull request. Only a clock, or another branch's pull request, you would sit idle through closes your seat: " +
        "slopweaver handover park <slug> --wake-at <UTC instant ending in Z>, or --wake-on-checks owner/repo#N, and " +
        "the supervisor reseats you once it is due. A second read of the same log, pid or task within 60s is refused " +
        "by the poll gate.",
    );
  });

  // Waiting for CI, rebasing, fixing red CI and landing are part of the work.
  it("no longer tells a seat its own CI wait closes the seat", () => {
    expect(WAIT_RULE_INSTRUCTION.includes("A CI or clock wait you would sit idle through closes")).toBe(false);
  });

  it("carries no backtick, because the line is pasted into a live surface", () => {
    expect(WAIT_RULE_INSTRUCTION.includes("`")).toBe(false);
  });

  it("rides the self-executing lifecycle instruction, last", () => {
    const command = resolvePickupCommand({ docPath: DOC_PATH, location: {}, runPhase: "closed", slug: "a-doc" });

    expect(command.endsWith(WAIT_RULE_INSTRUCTION)).toBe(true);
  });
});

describe("resolveSpawnPickupCommand", () => {
  const started = {
    atIso: "2026-08-14T00:00:00.000Z",
    branch: "a-doc",
    docHash: "abc123",
    kind: "started" as const,
  };

  it("folds waiting, closed, and restarted journal cycles into the right lifecycle instruction", () => {
    expect(resolveSpawnPickupCommand({ docPath: DOC_PATH, location: {}, runEvents: [], slug: "a-doc" })).toBe(
      lifecycleInstruction({ slug: "a-doc", verb: "start" }),
    );
    expect(resolveSpawnPickupCommand({ docPath: DOC_PATH, location: {}, runEvents: [started], slug: "a-doc" })).toBe(
      lifecycleInstruction({ slug: "a-doc", verb: "resume" }),
    );
    expect(
      resolveSpawnPickupCommand({
        docPath: DOC_PATH,
        location: {},
        runEvents: [started, { atIso: "2026-08-14T00:01:00.000Z", kind: "question", question: "Proceed?" }],
        slug: "a-doc",
      }),
    ).toBe(lifecycleInstruction({ slug: "a-doc", verb: "resume" }));
    expect(
      resolveSpawnPickupCommand({
        docPath: DOC_PATH,
        location: {},
        runEvents: [started, { atIso: "2026-08-14T00:01:00.000Z", kind: "finished", residue: [] }],
        slug: "a-doc",
      }),
    ).toBe(lifecycleInstruction({ slug: "a-doc", verb: "start" }));
    expect(
      resolveSpawnPickupCommand({
        docPath: DOC_PATH,
        location: {},
        runEvents: [started, { atIso: "2026-08-14T00:01:00.000Z", kind: "abandoned", why: "superseded" }],
        slug: "a-doc",
      }),
    ).toBe(lifecycleInstruction({ slug: "a-doc", verb: "start" }));
    expect(
      resolveSpawnPickupCommand({
        docPath: DOC_PATH,
        location: {},
        runEvents: [
          started,
          { atIso: "2026-08-14T00:01:00.000Z", kind: "finished", residue: [] },
          { ...started, atIso: "2026-08-14T00:02:00.000Z" },
        ],
        slug: "a-doc",
      }),
    ).toBe(lifecycleInstruction({ slug: "a-doc", verb: "resume" }));
  });
});

describe("launchOperationForRun — the ledger row's act agrees with the pickup line", () => {
  const started = {
    atIso: "2026-08-14T00:00:00.000Z",
    branch: "a-doc",
    docHash: "abc123",
    kind: "started" as const,
  };
  const finished = { atIso: "2026-08-14T00:01:00.000Z", kind: "finished" as const, residue: [] };
  const question = { atIso: "2026-08-14T00:01:00.000Z", kind: "question" as const, question: "Proceed?" };

  it("is `open` exactly where the pickup line says start, and `resume` where it says resume", () => {
    const journals = [[], [started], [started, question], [started, finished], [started, finished, started]];
    expect(journals.map((runEvents) => launchOperationForRun({ runEvents }))).toEqual([
      "open",
      "resume",
      "resume",
      "open",
      "resume",
    ]);
  });

  it("maps every run phase", () => {
    expect(
      (["closed", "open", "waiting-on-owner"] as const).map((runPhase) => launchOperationForPhase({ runPhase })),
    ).toEqual(["open", "resume", "resume"]);
  });
});
