/**
 * `store slack-asks`: its flags, the fold of a stored ask ledger into answered and stranded asks, and the verb
 * driven end to end over an in-memory store — a plain fake passed as the seam, so the disk is never in reach.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { type AuthoredVerbDeps } from "../../../../cli/commands/store/authoredDeps.js";
import { authoredHomeOf, refuseAuthoredUsage } from "../../../../cli/commands/store/authoredShell.js";
import { SLACK_ASKS_USAGE } from "../../../../cli/commands/store/authoredUsage.js";
import {
  parseSlackAsksArgs,
  SLACK_ASKS_RELATIVE_PATH,
  slackAskLine,
  slackAsksReport,
  slackAsksSummaryLines,
} from "../../../../cli/commands/store/slackAsksCore.js";
import { runStoreSlackAsks } from "../../../../cli/commands/store/slackAsksRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { askLifecycleEventLine } from "../../../../live/ask/lifecycle.js";

const ANSWERED = { channel: "C1", messageTs: "1.000001", threadTs: "1.000001" };
const STRANDED = { channel: "C1", messageTs: "2.000002", threadTs: "2.000002" };

/** A two-ask ledger: one answered, one that failed — plus a line the live parser cannot read. */
const LEDGER = [
  askLifecycleEventLine({
    event: { ...ANSWERED, kind: "captured", surface: "channel", tsIso: "2026-09-01T00:00:00.000Z", userId: "U1" },
  }),
  askLifecycleEventLine({
    event: { ...ANSWERED, answerTs: "1.5", kind: "answered", tsIso: "2026-09-01T00:05:00.000Z" },
  }),
  "not json",
  askLifecycleEventLine({
    event: { ...STRANDED, kind: "captured", surface: "dm", tsIso: "2026-09-02T00:00:00.000Z", userId: "U1" },
  }),
  askLifecycleEventLine({ event: { ...STRANDED, kind: "failed", reason: "r", tsIso: "2026-09-02T00:09:00.000Z" } }),
].join("\n");

/** An in-memory store holding the ledger at its home path (or nothing), plus every line the verb printed. */
function harness({ ledger }: { ledger: string | undefined }): {
  deps: AuthoredVerbDeps;
  out: string[];
  diag: string[];
  closed: string[];
} {
  const out: string[] = [];
  const diag: string[] = [];
  const closed: string[] = [];
  let bytes = Buffer.alloc(0);
  if (ledger !== undefined) {
    bytes = Buffer.from(ledger, "utf8");
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  const versions =
    ledger === undefined
      ? []
      : [
          {
            bodySha256: sha,
            byteLength: bytes.length,
            fileModifiedAt: new Date(0),
            relativePath: SLACK_ASKS_RELATIVE_PATH,
          },
        ];
  const deps: AuthoredVerbDeps = {
    claudeProjectsFor: () => {
      throw new Error("slack-asks never reads Claude Code's projects");
    },
    createFile: () => {
      throw new Error("slack-asks never writes the home");
    },
    createUnderRoot: () => {
      throw new Error("slack-asks never writes Claude Code's projects");
    },
    defaultHome: () => "/h/.slopweaver",
    fileSha256: () => {
      throw new Error("slack-asks never reads the disk");
    },
    openStore: () =>
      Promise.resolve(
        ok({
          kind: "open" as const,
          session: {
            absent: () => Promise.resolve(ok(new Set<string>())),
            body: ({ bodySha256 }) => Promise.resolve(ok(bodySha256 === sha ? bytes : undefined)),
            close: () => {
              closed.push("closed");
              return Promise.resolve();
            },
            versions: ({ relativePath }) =>
              Promise.resolve(ok(versions.filter((version) => version.relativePath === relativePath))),
          },
        }),
      ),
    writeDiagnostic: (line) => {
      diag.push(line);
    },
    writeFile: () => {
      throw new Error("slack-asks never writes a file");
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { closed, deps, diag, out };
}

describe("parseSlackAsksArgs", () => {
  it("reads its flags, and refuses one it does not take", () => {
    expect(unwrap(parseSlackAsksArgs({ rest: ["--stranded", "--json", "--home", "/x"] }))).toEqual({
      home: "/x",
      json: true,
      stranded: true,
    });
    expect(unwrapErr(parseSlackAsksArgs({ rest: ["--all"] })).join("\n")).toContain("--all");
  });
});

describe("slackAsksReport", () => {
  it("folds each ask to where it ended, newest capture first, and names the line it could not read", () => {
    const report = slackAsksReport({ text: LEDGER });

    expect(report.asks.map((ask) => [ask.messageTs, ask.state, ask.stranded])).toEqual([
      ["2.000002", "failed", true],
      ["1.000001", "answered", false],
    ]);
    expect(report.byState).toEqual([
      { count: 1, state: "answered" },
      { count: 1, state: "failed" },
    ]);
    expect(report.unreadableLines).toEqual([3]);
  });

  it("reports an empty ledger as no asks rather than failing", () => {
    expect(slackAsksReport({ text: "" })).toEqual({ asks: [], byState: [], unreadableLines: [] });
  });

  it("prints a line per ask and a summary counting the stranded", () => {
    const report = slackAsksReport({ text: LEDGER });

    expect(slackAskLine({ row: report.asks[0]! })).toBe(
      "C1/2.000002\tfailed\tstranded\t2026-09-02T00:00:00.000Z\t2026-09-02T00:09:00.000Z",
    );
    expect(slackAsksSummaryLines({ report })).toEqual([
      "store slack-asks: 2 ask(s) in the stored ledger, 1 stranded",
      "  by state: answered 1, failed 1",
      "  1 ledger line(s) would not read: 3",
    ]);
  });
});

describe("runStoreSlackAsks", () => {
  it("reads the ledger from the store only, and --stranded keeps only the stranded asks", async () => {
    const run = harness({ ledger: LEDGER });

    const code = await runStoreSlackAsks({ deps: run.deps, rest: ["--stranded"] });

    expect(code).toBe(EXIT_OK);
    expect(run.out).toEqual(["C1/2.000002\tfailed\tstranded\t2026-09-02T00:00:00.000Z\t2026-09-02T00:09:00.000Z"]);
    expect(run.diag[0]).toBe("store slack-asks: 2 ask(s) in the stored ledger, 1 stranded");
    expect(run.closed).toEqual(["closed"]);
  });

  it("says the store holds no ledger and exits non-zero, never falling back to the disk", async () => {
    const run = harness({ ledger: undefined });

    const code = await runStoreSlackAsks({ deps: run.deps, rest: [] });

    expect(code).toBe(EXIT_ERROR);
    expect(run.diag.join("\n")).toContain(SLACK_ASKS_RELATIVE_PATH);
    expect(run.out).toEqual([]);
  });

  it("refuses a flag it does not take with its own usage", async () => {
    const run = harness({ ledger: LEDGER });

    const code = await runStoreSlackAsks({ deps: run.deps, rest: ["--all"] });

    expect(code).toBe(EXIT_USAGE);
    expect(run.diag.at(-1)).toBe(SLACK_ASKS_USAGE);
  });
});

describe("authoredShell", () => {
  it("resolves the home from --home, else from the default", () => {
    const run = harness({ ledger: undefined });

    expect(authoredHomeOf({ deps: run.deps, named: "/x" })).toBe("/x");
    expect(authoredHomeOf({ deps: run.deps, named: undefined })).toBe("/h/.slopweaver");
  });

  it("prints each problem under the verb's name, then the usage, and exits with the usage code", () => {
    const run = harness({ ledger: undefined });

    const code = refuseAuthoredUsage({ deps: run.deps, problems: ["a", "b"], usage: "usage: x", verb: "v" });

    expect(code).toBe(EXIT_USAGE);
    expect(run.diag).toEqual(["store v: a", "store v: b", "usage: x"]);
  });
});
