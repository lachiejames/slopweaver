/*
 * `foreignRunLine` where the board or the journal decides the line: an ambiguous journal, a duplicate or unread slug
 * claim and a closed cycle recommend no takeover, a released run names its typed claim path, a run this session may
 * act on prints nothing, and an unsafe slug still quotes as one shell word. It moved here when `runOwner.test.ts`
 * was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { foreignRunLine } from "../../../../handover/runOwner.js";
import { AT, elsewhere, THEIRS, writer } from "./harness.js";

describe("foreignRunLine", () => {
  it("recommends NOTHING over an ambiguous journal — every transfer verb refuses one", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "one",
      phase: "open",
      journalAmbiguous: true,
      liveness: { kind: "dead" },
      ownership: elsewhere,
      slug: "held",
    })!;

    expect(line).toContain(`ownership is AMBIGUOUS (it last named session ${THEIRS})`);
    expect(line).toContain("every transfer verb will refuse it");
    expect(line).not.toContain("handover claim");
    expect(line).not.toContain("handover release");
    expect(line).not.toContain("DEAD");
  });

  it("recommends NOTHING over an ambiguous journal even for a RELEASED run — claim refuses it too", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "one",
      phase: "open",
      journalAmbiguous: true,
      liveness: undefined,
      ownership: { kind: "released", releasedAtIso: AT, why: "handing off", writer },
      slug: "held",
    })!;

    expect(line).toContain("ownership is AMBIGUOUS");
    expect(line).not.toContain("handover claim");
    expect(line).not.toContain("take it over");
  });

  it("states the duplicate-slug defect instead of any command — every verb refuses a duplicate", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "duplicate",
      phase: "open",
      journalAmbiguous: false,
      liveness: { kind: "dead" },
      ownership: elsewhere,
      slug: "held",
    })!;

    expect(line).toContain("MORE THAN ONE doc on the board claims this slug");
    expect(line).not.toContain("handover claim");
    expect(line).not.toContain("handover abandon");
    expect(line).not.toContain("handover release");
  });

  it("recommends NO command at all over an unknown doc-claim — even release resolves the board doc first", () => {
    const live = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "unknown",
      phase: "open",
      journalAmbiguous: false,
      liveness: { kind: "live" },
      ownership: elsewhere,
      slug: "held",
    })!;
    const dead = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "unknown",
      phase: "open",
      journalAmbiguous: false,
      liveness: { kind: "dead" },
      ownership: elsewhere,
      slug: "held",
    })!;
    const released = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "unknown",
      phase: "open",
      journalAmbiguous: false,
      liveness: undefined,
      ownership: { kind: "released", releasedAtIso: AT, why: "handing off", writer },
      slug: "held",
    })!;

    for (const line of [live, dead, released]) {
      expect(line).toContain("The board could not be fully read");
      expect(line).not.toContain("handover release");
      expect(line).not.toContain("handover claim");
      expect(line).not.toContain("handover abandon");
    }
  });

  it("offers a fresh start, never a takeover, for a CLOSED cycle — claim's phase guard refuses one", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "one",
      journalAmbiguous: false,
      liveness: { kind: "dead" },
      ownership: elsewhere,
      phase: "closed",
      slug: "held",
    })!;

    expect(line).toContain("its current cycle is CLOSED — there is nothing to take over");
    expect(line).toContain(
      "`handover start held` opens a fresh cycle if the doc has remaining work, and states its own refusal",
    );
    expect(line).not.toContain("handover claim");
    expect(line).not.toContain("handover release");
  });

  it("defence-in-depth: a slug outside the run store's SAFE_SLUG domain still renders as one shell word", () => {
    // Unreachable from a real journal — runStore.ts's SAFE_SLUG forbids spaces, and it is a strict subset of
    // shellValue's safe alphabet, so quoting never fires for a representable run. Kept as a guard on that
    // invariant: if either alphabet drifts, this pins the renderer's half.
    const line = foreignRunLine({
      readerIdentified: true,
      docClaim: "one",
      flagSuffix: "",
      journalAmbiguous: false,
      liveness: { kind: "dead" },
      ownership: elsewhere,
      phase: "open",
      slug: "held run",
    })!;

    expect(line).toContain("`handover claim 'held run' --why \"…\"`");
  });

  it("says nothing for a run this session may act on", () => {
    expect(
      foreignRunLine({
        readerIdentified: true,
        flagSuffix: "",
        docClaim: "one",
        phase: "open",
        journalAmbiguous: false,
        liveness: undefined,
        ownership: { kind: "unowned" },
        slug: "held",
      }),
    ).toBeUndefined();
  });

  it("sends a released ORPHAN to the orphan abandon — claim needs a doc no board doc provides", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "none",
      phase: "open",
      journalAmbiguous: false,
      liveness: undefined,
      ownership: { kind: "released", releasedAtIso: AT, why: "handing off", writer },
      slug: "held",
    })!;

    expect(line).toContain('close the orphaned run with `handover abandon held --why "…"`');
    expect(line).not.toContain("handover claim");
  });

  it("caveats a released-run takeover for an unidentified reader with non-default routing", () => {
    const line = foreignRunLine({
      docClaim: "one",
      flagSuffix: " --dir /tmp/board",
      journalAmbiguous: false,
      liveness: undefined,
      ownership: { kind: "released", releasedAtIso: AT, why: "handing off", writer },
      phase: "open",
      readerIdentified: false,
      slug: "held",
    })!;

    expect(line).toContain('`handover claim held --dir /tmp/board --why "…"` here to take it over.');
    expect(line).toContain("Run it from an identified visible session");
  });

  it("names the release, the reason and the typed claim path for a released run — never silent", () => {
    const line = foreignRunLine({
      readerIdentified: true,
      flagSuffix: "",
      docClaim: "one",
      phase: "open",
      journalAmbiguous: false,
      liveness: undefined,
      ownership: { kind: "released", releasedAtIso: AT, why: "handing off to a fresh session", writer },
      slug: "held",
    })!;

    expect(line).toBe(
      `⊘ The run "held" was released by session ${THEIRS} at ${AT} ("handing off to a fresh session") and has ` +
        "not been claimed since. Resume is read-only; do NOT finish, abandon, ask, answer or amend it. " +
        "`handover claim` here to take it over.",
    );
  });
});
