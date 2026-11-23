/**
 * An absolute `path:`/`present:`/`absent:` target is a PARSE problem, not a probe.
 *
 * `insideRepo` (`src/handover/evaluate.ts`) declines an absolute target before any read happens, so the board
 * has always printed such a row as an ordinary unmet probe — indistinguishable from a file that is genuinely
 * not there. Three of them stood on the real board, every one reading as silently false.
 *
 * There is no waiver here on purpose: this is doc rot with a mechanical fix, in the same family as the four
 * other things `parseProbes` already refuses to read.
 */
import { describe, expect, it } from "vitest";

import { parseProbes } from "../../../handover/probe.js";

// register-class: probe-missing-or-malformed-at-write-time (docs/recurring-failure-register/bindings.md)

describe("parseProbes on an absolute target", () => {
  it("refuses an absolute `path:` target rather than reading it as a probe", () => {
    const parsed = parseProbes({ value: [{ path: "/abs/repo/package.json" }] });
    expect(parsed.probes).toStrictEqual([]);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toContain("doneWhen[0] declares `path` with the ABSOLUTE path");
    expect(parsed.problems[0]).toContain("/abs/repo/package.json");
  });

  it("names both remedies, so the author is not left to discover the command form", () => {
    const parsed = parseProbes({ value: [{ path: "/abs/thing.ts" }] });
    expect(parsed.problems[0]).toContain("Make it repo-relative");
    expect(parsed.problems[0]).toContain("`command:` probe");
  });

  it("refuses an absolute `present:` target, symbol and all", () => {
    const parsed = parseProbes({ value: [{ present: "/abs/src/poster.ts#renderCard" }] });
    expect(parsed.probes).toStrictEqual([]);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toContain("the ABSOLUTE path `/abs/src/poster.ts`");
  });

  it("refuses an absolute `absent:` target", () => {
    const parsed = parseProbes({ value: [{ absent: "/abs/src/legacy.ts#LegacyThing" }] });
    expect(parsed.probes).toStrictEqual([]);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toContain("the ABSOLUTE path");
  });

  it("accepts the repo-relative spelling of a `present:` target with its symbol", () => {
    const parsed = parseProbes({ value: [{ present: "src/poster.ts#renderCard" }] });
    expect(parsed.problems).toStrictEqual([]);
    expect(parsed.probes).toStrictEqual([{ file: "src/poster.ts", kind: "present", symbol: "renderCard" }]);
  });

  it("accepts the repo-relative spelling of the same target", () => {
    const parsed = parseProbes({ value: [{ path: "package.json" }] });
    expect(parsed.problems).toStrictEqual([]);
    expect(parsed.probes).toStrictEqual([{ kind: "path", path: "package.json" }]);
  });

  it("leaves a `command:` probe alone, absolute paths and all — a command is not resolved against the repo", () => {
    const parsed = parseProbes({ value: [{ command: "test -f /abs/notes/TRIAGE.md" }] });
    expect(parsed.problems).toStrictEqual([]);
    expect(parsed.probes).toStrictEqual([{ command: "test -f /abs/notes/TRIAGE.md", kind: "command" }]);
  });

  it("reports one problem per offending entry and keeps every readable probe beside them", () => {
    const parsed = parseProbes({
      value: [{ path: "/abs/one" }, { path: "src/two.ts" }, { absent: "/abs/three#Sym" }],
    });
    expect(parsed.problems).toHaveLength(2);
    expect(parsed.probes).toStrictEqual([{ kind: "path", path: "src/two.ts" }]);
  });
});
