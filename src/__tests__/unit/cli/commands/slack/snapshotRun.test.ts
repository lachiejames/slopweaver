import { describe, expect, it } from "vitest";

import {
  runSlackSnapshot,
  type SlackSnapshot,
  type SlackSnapshotDeps,
} from "../../../../../cli/commands/slack/snapshotRun.js";
import { toIngestError } from "../../../../../lib/ingestError.js";
import { err, ok } from "../../../../../lib/result.js";

const USAGE = "usage: slopweaver slack example [--json] [--write] [--home <dir>] [--now <iso>]";

/** Plain fakes for every edge, recording what was written and which instant and home the snapshot was asked for. */
function fakes(): { deps: SlackSnapshotDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      clockIso: () => "2026-09-29T01:00:00.000Z",
      defaultHome: () => "/nonexistent/slopweaver-snapshot-default",
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

/**
 * A snapshot whose every answer is fixed.
 *
 * @param complete whether the read saw everything
 * @param writeFails true to have the write refuse
 * @returns the snapshot
 */
function fixed({ complete, writeFails = false }: { complete: boolean; writeFails?: boolean }): SlackSnapshot {
  return {
    complete,
    json: '{"a":1}',
    text: ["header", "row"],
    write: () =>
      writeFails
        ? err(toIngestError({ defaultKind: "io", error: new Error("disk full"), operation: "write", path: "/x" }))
        : ok({ path: "/written/doc.json" }),
  };
}

describe("runSlackSnapshot", () => {
  it("hands the snapshot the default home and the clock's instant when neither flag is given", () => {
    const edges = fakes();
    const asked: string[] = [];
    const code = runSlackSnapshot({
      deps: edges.deps,
      rest: [],
      snapshot: ({ home, nowIso }) => {
        asked.push(home, nowIso);
        return fixed({ complete: true });
      },
      usage: USAGE,
      verb: "slack example",
    });
    expect(code).toBe(0);
    expect(asked).toStrictEqual(["/nonexistent/slopweaver-snapshot-default", "2026-09-29T01:00:00.000Z"]);
    expect(edges.out).toStrictEqual(["header", "row"]);
  });

  it("exits 1 on an incomplete read even though it printed the document", () => {
    const edges = fakes();
    const code = runSlackSnapshot({
      deps: edges.deps,
      rest: ["--json"],
      snapshot: () => fixed({ complete: false }),
      usage: USAGE,
      verb: "slack example",
    });
    expect([code, edges.out]).toStrictEqual([1, ['{"a":1}']]);
  });

  it("exits 1 naming the verb when the write refuses, and prints nothing as though it had written", () => {
    const edges = fakes();
    const code = runSlackSnapshot({
      deps: edges.deps,
      rest: ["--write"],
      snapshot: () => fixed({ complete: true, writeFails: true }),
      usage: USAGE,
      verb: "slack example",
    });
    expect(code).toBe(1);
    expect(edges.out).toStrictEqual([]);
    expect(edges.diagnostics[0]).toContain("slack example: could not write the document, the previous one stands:");
  });

  it("prefixes a parse refusal with the verb, then prints the usage, exiting 2", () => {
    const edges = fakes();
    const code = runSlackSnapshot({
      deps: edges.deps,
      rest: ["--now", "yesterday"],
      snapshot: () => fixed({ complete: true }),
      usage: USAGE,
      verb: "slack example",
    });
    expect(code).toBe(2);
    expect(edges.diagnostics).toStrictEqual([
      'slack example: --now must be an ISO 8601 instant, got "yesterday"',
      USAGE,
    ]);
  });
});
