import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { lifecycleProbeSeams, parseProbedTree } from "../../../../../cli/commands/handover/lifecycleProbeSeams.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import type { Probe } from "../../../../../handover/probe.js";

const PROBE: Probe = { file: "a.ts", kind: "present", symbol: "x" };

/** A doc parsed from front matter that declares no `repo:`. */
const NO_REPO = parseHandoverDoc({
  path: "/board/a-doc.md",
  text: "---\nslug: a-doc\nstatus: ready\nblockedBy: []\ndoneWhen: []\n---\n# body\n",
});

describe("lifecycleProbeSeams", () => {
  it("reports every probe of a doc with no repo as not evaluated, never as an empty set", () => {
    const results = lifecycleProbeSeams({ runCommands: false })({ doc: { ...NO_REPO, doneWhen: [PROBE] } });
    expect(results).toEqual([
      {
        note: "the doc declares no `repo:`, so nothing could be resolved against it",
        outcome: "not-evaluated",
        probe: PROBE,
      },
    ]);
  });

  it("returns no results for a doc with no repo and no probe", () => {
    expect(lifecycleProbeSeams({ runCommands: true })({ doc: NO_REPO })).toEqual([]);
  });
});

describe("parseProbedTree", () => {
  it("reads either tree kind, absence as unbound, and refuses anything else by name", () => {
    expect([
      unwrap(parseProbedTree({ text: "session-worktree" })),
      unwrap(parseProbedTree({ text: "doc-repo" })),
      unwrap(parseProbedTree({ text: undefined })),
      unwrapErr(parseProbedTree({ text: "elsewhere" })),
    ]).toEqual([
      "session-worktree",
      "doc-repo",
      undefined,
      '--probed-tree must be session-worktree or doc-repo, not "elsewhere"',
    ]);
  });
});
