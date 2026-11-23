/** `linear labels` — a pure read: what reaches the reader, and what each outcome prints and exits. */
import { describe, expect, it } from "vitest";

import { type LinearLabelsDeps, runLinearLabels } from "../../../../../cli/commands/linear/labelsRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { LinearLiveErrors } from "../../../../../live/linear/errors.js";
import type { LinearLabelsDocument } from "../../../../../live/linear/labels.js";

const DOCUMENT: LinearLabelsDocument = {
  issueLabels: [{ id: "i-1", isGroup: false, name: "Can drive", parent: undefined, scope: { kind: "workspace" } }],
  projectLabels: [],
  readAtIso: "2026-10-24T09:00:00.000Z",
  source: "linear",
  team: { id: "team-1", key: "SOPS", name: "Security" },
};

function harness({ fail }: { fail: boolean }): {
  deps: LinearLabelsDeps;
  asked: { teamKey: string; home: string | undefined }[];
  out: string[];
  diagnostics: string[];
} {
  const asked: { teamKey: string; home: string | undefined }[] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    asked,
    deps: {
      read: (args) => {
        asked.push(args);
        return Promise.resolve(fail ? err(LinearLiveErrors.readFailed({ message: "no token" })) : ok(DOCUMENT));
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
  };
}

describe("runLinearLabels", () => {
  it("reads the named team in the named home and prints every id", async () => {
    const { deps, asked, out } = harness({ fail: false });

    expect(await runLinearLabels({ deps, rest: ["--team", "SOPS", "--home", "/h"] })).toBe(EXIT_OK);
    expect(asked).toEqual([{ home: "/h", teamKey: "SOPS" }]);
    expect(out.join("\n")).toContain("  i-1  workspace  Can drive");
  });

  it("takes the team as a bare positional too", async () => {
    const { deps, asked } = harness({ fail: false });

    expect(await runLinearLabels({ deps, rest: ["SOPS"] })).toBe(EXIT_OK);
    expect(asked).toEqual([{ home: undefined, teamKey: "SOPS" }]);
  });

  it("prints ONE JSON document under --json", async () => {
    const { deps, out } = harness({ fail: false });

    await runLinearLabels({ deps, rest: ["SOPS", "--json"] });

    expect(out.length).toBe(1);
    expect(JSON.parse(out[0]!).team).toEqual({ id: "team-1", key: "SOPS", name: "Security" });
  });

  it("refuses a missing team with the usage, before any read", async () => {
    const { deps, asked, diagnostics } = harness({ fail: false });

    expect(await runLinearLabels({ deps, rest: [] })).toBe(EXIT_USAGE);
    expect(asked).toEqual([]);
    expect(diagnostics.at(-1)!).toContain("usage: slopweaver linear labels --team <team-key>");
  });

  it("exits with an error and prints nothing to stdout when the read fails", async () => {
    const { deps, out, diagnostics } = harness({ fail: true });

    expect(await runLinearLabels({ deps, rest: ["SOPS"] })).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diagnostics).toEqual(["no token"]);
  });
});
