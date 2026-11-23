/*
 * `runBriefLines` for a run another session holds or released: who holds it and where, an ambiguous journal, a dead
 * holder's working takeover with the caller's routing flags, no mutating exit, and an unidentifiable reader.
 */
import { describe, expect, it } from "vitest";

import { runBriefLines } from "../../../../handover/hookGate.js";
import { MINE, OTHER_WRITER, run, THEIRS } from "./harness.js";

describe("runBriefLines", () => {
  /**
   * The read-only brief is where "someone else is driving this" belongs: a session starting in a worktree whose
   * run is held elsewhere needs to know before it touches the branch, and that is not something the channel that
   * BLOCKS a turn can usefully carry.
   */
  it("names the holding session and its worktree for a foreign run", () => {
    const runs = [run({ ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER }, slug: "held" })];
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs }).join("\n");

    expect(lines).toContain(`session ${THEIRS}`);
    expect(lines).toContain("/wt/other");
    expect(lines).toContain("pid 4242");
    expect(lines).toContain("another session is driving it");
  });

  it("states ambiguity for an undecodable journal instead of recommending a transfer that will refuse", () => {
    const runs = [
      run({
        journalAmbiguous: true,
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        slug: "held",
      }),
    ];
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs }).join("\n");

    expect(lines).toContain(`ownership is AMBIGUOUS (it last named session ${THEIRS})`);
    expect(lines).toContain("every transfer verb will refuse it");
    expect(lines).not.toContain("`handover claim`");
    expect(lines).not.toContain("`handover release`");
  });

  it("embeds the caller's routing flags in the recommended takeover, so a pasted command reads the same board", () => {
    const runs = [
      run({
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        slug: "held",
        writerLiveness: { kind: "dead" },
      }),
    ];
    const lines = runBriefLines({ flagSuffix: " --dir /custom/handovers", readerIdentified: true, runs }).join("\n");

    expect(lines).toContain('`handover claim held --dir /custom/handovers --why "…"`');
  });

  it("routes a DEAD holder's brief at the working takeover, not a release the dead session cannot perform", () => {
    const runs = [
      run({
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        slug: "held",
        writerLiveness: { kind: "dead" },
      }),
    ];
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs }).join("\n");

    expect(lines).toContain("that session is DEAD");
    expect(lines).toContain('`handover claim held --why "…"`');
    expect(lines).not.toContain("`handover release`");
  });

  it("offers no mutating exit for a foreign run and names the typed ownership transfer", () => {
    const runs = [run({ ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER }, slug: "held" })];
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs }).join("\n");

    expect(lines).not.toContain("slopweaver handover resume held");
    expect(lines).toContain("Resume is read-only");
    expect(lines).toContain("do NOT finish, abandon, ask, answer or amend it");
    expect(lines).toContain('`handover release held --why "…"`');
    expect(lines).toContain('`handover claim held --why "…"`');
  });

  it("explains itself differently when it is this session that cannot be identified", () => {
    const runs = [run({ ownership: { kind: "elsewhere", thisSession: undefined, writer: OTHER_WRITER } })];

    expect(runBriefLines({ flagSuffix: "", readerIdentified: true, runs }).join("\n")).toContain(
      "this session could not identify itself",
    );
  });

  /**
   * The brief must say the SAME actionable thing for a released run that it already says for one held
   * elsewhere — reporting rather than silence is what let the incident slip through unnoticed
   * until the fabricated question had already reached a real Slack DM.
   */
  it("names the release, the reason and the typed claim path for a released run — never silent", () => {
    const runs = [
      run({
        ownership: { kind: "released", releasedAtIso: OTHER_WRITER.atIso, why: "handing off", writer: OTHER_WRITER },
        slug: "held",
      }),
    ];
    const lines = runBriefLines({ flagSuffix: "", readerIdentified: true, runs }).join("\n");

    expect(lines).toContain(`released by session ${THEIRS}`);
    expect(lines).toContain("handing off");
    expect(lines).toContain("do NOT finish, abandon, ask, answer or amend it");
    expect(lines).toContain("`handover claim`");
    expect(lines).not.toContain("slopweaver handover resume held");
  });
});
