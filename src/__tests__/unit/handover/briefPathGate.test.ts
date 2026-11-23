/**
 * The writer gate's shell: the refusal text the two brief-writing doors print, and the two reasons it
 * prints nothing — the brief roots what it names, or the hatch is open.
 *
 * The directory listing is an injected plain function, so no case here touches a disk.
 */
import { describe, expect, it } from "vitest";

import { unrootedBriefPathRefusal, unrootedDocBriefRefusal } from "../../../handover/briefPathGate.js";

const STATE_HOME = "/Users/someone/.slopweaver";
const REPO_ROOT = "/Users/someone/dev/slopweaver";

/** The two top levels, keyed by directory, as this install measures them. */
function readEntries({ dir }: { dir: string }): readonly string[] {
  if (dir === STATE_HOME) {
    return ["supervisor-scratch", "pages", "ledgers", "bin"];
  }
  return ["src", "docs", "bin"];
}

/** Ask the gate with both listings injected. */
function refusalFor({
  text,
  env = {},
}: {
  text: string;
  env?: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  return unrootedBriefPathRefusal({
    command: "slopweaver handover register",
    env,
    home: STATE_HOME,
    readEntries,
    repoRoot: REPO_ROOT,
    text,
  });
}

const INCIDENT = "logo image in supervisor-scratch/handoff-9291/owner-turn-291-18-images)";

describe("unrootedBriefPathRefusal", () => {
  it("names the door, the offending token and both rewrites", () => {
    const refusal = refusalFor({ text: INCIDENT })!;
    expect(refusal).toContain("slopweaver handover register blocked because");
    expect(refusal).toContain("supervisor-scratch/handoff-9291/owner-turn-291-18-images");
    expect(refusal).toContain("→ state:supervisor-scratch/handoff-9291/owner-turn-291-18-images");
    expect(refusal).toContain(
      `(or absolutely: ${STATE_HOME}/supervisor-scratch/handoff-9291/owner-turn-291-18-images)`,
    );
  });

  it("prints the hatch and the judgement line, like every refusal in this repo", () => {
    const refusal = refusalFor({ text: INCIDENT })!;
    expect(refusal).toContain("SLOPWEAVER_ALLOW_UNROOTED_BRIEF_PATH=1");
    expect(refusal).toContain("Use good judgement");
  });

  it("counts the offenders it found", () => {
    const refusal = refusalFor({ text: "pages/a.html and ledgers/b.jsonl" })!;
    expect(refusal).toContain("the brief names 2 path(s) relative to the state home");
  });

  it("says nothing when the brief roots what it names", () => {
    expect(refusalFor({ text: `read ${STATE_HOME}/pages/a.html and src/lib/result.ts and bin/slopweaver` })).toBe(
      undefined,
    );
  });

  it("says nothing when the hatch is open", () => {
    expect(refusalFor({ env: { SLOPWEAVER_ALLOW_UNROOTED_BRIEF_PATH: "1" }, text: INCIDENT })).toBe(undefined);
  });
});

describe("unrootedDocBriefRefusal", () => {
  const DOC = [
    "---",
    'summary: "put it in pages/x.html"',
    "---",
    "",
    "## What the owner asked for",
    "",
    "put it in pages/x.html",
    "",
    "## Notes",
    "",
    "a session later wrote ledgers/only-in-the-body.jsonl here",
  ].join("\n");

  it("refuses on the brief", () => {
    expect(
      unrootedDocBriefRefusal({
        command: "slopweaver cmux spawn",
        docText: DOC,
        env: {},
        home: STATE_HOME,
        readEntries,
        repoRoot: REPO_ROOT,
      }),
    ).toContain("pages/x.html");
  });

  it("does not refuse on the doc body alone", () => {
    const body = ["---", "status: ready", "---", "", "## Notes", "", "ledgers/only-in-the-body.jsonl"].join("\n");
    expect(
      unrootedDocBriefRefusal({
        command: "slopweaver cmux spawn",
        docText: body,
        env: {},
        home: STATE_HOME,
        readEntries,
        repoRoot: REPO_ROOT,
      }),
    ).toBe(undefined);
  });
});
