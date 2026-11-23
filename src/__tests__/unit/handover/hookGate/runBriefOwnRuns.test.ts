/*
 * `runBriefLines` for runs this session may act on: silence when nothing is open, a waiting run first, resume from
 * the journal, a vanished branch mentioned, and the re-checked tally rather than a journal snapshot.
 */
import { describe, expect, it } from "vitest";

import { runBriefLines } from "../../../../handover/hookGate.js";
import { run } from "./harness.js";

describe("runBriefLines", () => {
  it("says nothing when there is nothing to say", () => {
    expect(runBriefLines({ flagSuffix: "", readerIdentified: true, runs: [] })).toEqual([]);
    expect(runBriefLines({ flagSuffix: "", readerIdentified: true, runs: [run({ phase: "closed" })] })).toEqual([]);
  });

  /** The case an abandoned run most needs to announce, so it comes first. */
  it("states a waiting run before an open one", () => {
    const lines = runBriefLines({
      flagSuffix: "",
      readerIdentified: true,
      runs: [run({ slug: "open-one" }), run({ phase: "waiting-on-owner", slug: "paused" })],
    });

    expect(lines[0]).toContain("paused");
    expect(lines[0]).toContain("WAITING ON THE OWNER");
    expect(lines.join("\n")).toContain("open-one");
  });

  it("tells an open run to resume from the journal rather than from memory", () => {
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs: [run({ slug: "my-doc" })] });

    expect(lines.join("\n")).toContain("slopweaver handover resume my-doc");
    expect(lines.join("\n")).toContain("not from memory");
  });

  it("mentions a vanished branch without treating it as a reason to stop working", () => {
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs: [run({ branchResolves: false })] });

    expect(lines.join("\n")).toContain("its branch no longer exists");
  });

  it("reports the re-checked tally rather than a journal snapshot", () => {
    const lines = runBriefLines({
      flagSuffix: "",
      readerIdentified: true,
      runs: [run({ tally: { failed: 1, notEvaluated: 1, passed: 4 } })],
    }).join("\n");

    expect(lines).toContain("2 of 6 probe(s) unmet, re-checked just now");
    expect(lines).not.toContain("unverified");
  });
});
