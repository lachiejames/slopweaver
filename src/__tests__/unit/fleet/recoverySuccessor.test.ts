/**
 * The doc a Recovery press seats a supervisor from: the chain's next number, and how the successor takes the pin.
 */
import { describe, expect, it } from "vitest";

import {
  nextSuccessorSlug,
  recoverySuccessorDoc,
  SUCCESSOR_SLUG_PREFIX,
  successorNumberOf,
} from "../../../fleet/recoverySuccessor.js";

describe("nextSuccessorSlug", () => {
  it("is one past the highest number any doc or journal holds, ignoring slugs outside the chain", () => {
    expect(
      nextSuccessorSlug({
        occupied: [
          "fresh-supervisor-handoff-9009",
          "fresh-supervisor-handoff-9528",
          "other-work",
          "fresh-supervisor-handoff-x",
        ],
      }),
    ).toBe("fresh-supervisor-handoff-9529");
  });

  it("starts the chain at 1 in a home with none", () => {
    expect(nextSuccessorSlug({ occupied: [] })).toBe(`${SUCCESSOR_SLUG_PREFIX}1`);
  });
});

describe("successorNumberOf", () => {
  it("reads the number, and nothing from a slug that only starts like one", () => {
    expect(
      ["fresh-supervisor-handoff-9041", "fresh-supervisor-handoff-9041-b", "seat"].map((slug) =>
        successorNumberOf({ slug }),
      ),
    ).toEqual([9041, undefined, undefined]);
  });
});

describe("recoverySuccessorDoc", () => {
  const common = {
    handoversDir: "/home/handovers",
    repo: "/repo",
    slug: "fresh-supervisor-handoff-9041",
    writtenAtIso: "2026-11-25T10:01:00.000Z",
  };

  it("takes over from a pinned chair, pointing at its doc rather than copying it", () => {
    const doc = recoverySuccessorDoc({
      ...common,
      predecessor: { label: "app:old-chair", slug: "fresh-supervisor-handoff-9040" },
    });
    expect(doc).toContain("slug: fresh-supervisor-handoff-9041\nrole: supervisor\n");
    expect(doc).toContain("replacing the chair on app:old-chair, which was down");
    expect(doc).toContain(
      "2. Run `slopweaver supervisor owner-turns` until it reports nothing left, then `slopweaver cmux takeover`.",
    );
    expect(doc).toContain("booted from `/home/handovers/fresh-supervisor-handoff-9040.md`");
  });

  it("is Recovery's doc byte for byte when no hand-off is passed", () => {
    const doc = recoverySuccessorDoc({
      ...common,
      predecessor: { label: "app:old-chair", slug: "fresh-supervisor-handoff-9040" },
    });
    expect(doc).toBe(
      [
        "---",
        "slug: fresh-supervisor-handoff-9041",
        "role: supervisor",
        "priority: p1",
        "status: ready",
        "blockedBy: []",
        "repo: /repo",
        "artifact: null",
        "doneWhen: []",
        'probeWaiver: "The outcome is the supervisor pin on this session, which `cmux takeover` itself checks; no repo-local command re-asserts a live pin."',
        'summary: "Fresh /slopweaver:supervisor seated by a Recovery press in the desktop app at 2026-11-25T10:01:00.000Z, replacing the chair on app:old-chair, which was down."',
        "workspace: self",
        'workspaceBecause: "the supervisor chair runs in the main checkout"',
        "---",
        "",
        "# Fresh supervisor, seated by Recovery",
        "",
        "You INVOKE `/slopweaver:supervisor` through the `Skill` tool as your first act (reading it is not running it).",
        "",
        "The owner pressed Recovery in the desktop app because the supervisor was down. Nobody wrote you a hand-off: this doc was written mechanically, and it is waiting for you to take the pin.",
        "",
        "1. Arm the sweep, as `skills/supervisor/reference/briefing-contract.md` § 7 says.",
        "2. Run `slopweaver supervisor owner-turns` until it reports nothing left, then `slopweaver cmux takeover`. Do this before reading anything else: the press reads the pin moving to you as the chair restarted. If it refuses, read its reason: run what it names when that is a read it wants first, and otherwise say why in this card and stop. Never move the pin around a refusal, and never close another session to clear one.",
        "3. The chair before you was app:old-chair, booted from `/home/handovers/fresh-supervisor-handoff-9040.md`. Read that doc whole, and every state file and older doc it points you at, then the board (`slopweaver handover list`): rows written since it was written win over it.",
        "4. Once the picture is read, run `slopweaver supervisor reoriented` once, with no `--attempt`.",
        "",
      ].join("\n"),
    );
  });

  it("carries a hand-off note verbatim under its heading, with the watch's reasons, and still boots a supervisor", () => {
    const doc = recoverySuccessorDoc({
      ...common,
      handOff: {
        episodeId: "chair-hand-off:app-old",
        note: "Landing #12 is mid-queue; do not re-press it.\n",
        noteWaitSeconds: 600,
        reasons: ["plan-one Fable week 97%"],
      },
      predecessor: { label: "app:old-chair", slug: "fresh-supervisor-handoff-9040" },
    });
    expect(doc).toContain("slug: fresh-supervisor-handoff-9041\nrole: supervisor\n");
    expect(doc).toContain("You INVOKE `/slopweaver:supervisor` through the `Skill` tool as your first act");
    expect(doc).toContain("1. Arm the sweep, as `skills/supervisor/reference/briefing-contract.md` § 7 says.");
    expect(doc).toContain("then `slopweaver cmux takeover`. Do this before reading anything else: the control plane");
    expect(doc).toContain("(`chair-hand-off:app-old`) because its watch said so:\n\n- plan-one Fable week 97%\n");
    expect(
      doc.endsWith("## Hand-off note from the outgoing chair\n\nLanding #12 is mid-queue; do not re-press it.\n"),
    ).toBe(true);
  });

  it("tells the successor to rebuild from files when no note arrived", () => {
    const doc = recoverySuccessorDoc({
      ...common,
      handOff: { episodeId: "chair-hand-off:app-old", note: undefined, noteWaitSeconds: 600, reasons: [] },
      predecessor: { label: "app:old-chair", slug: "fresh-supervisor-handoff-9040" },
    });
    expect(
      doc.endsWith(
        "## No hand-off note\n\nNo hand-off note arrived within 600s; rebuild the picture from files as a fresh chair does (skills/pickup).\n",
      ),
    ).toBe(true);
  });

  it("pins with no takeover where no chair was pinned, since a takeover with no predecessor refuses", () => {
    const doc = recoverySuccessorDoc({ ...common, predecessor: undefined });
    expect(doc).toContain("2. Run `slopweaver cmux pin`, with no `--workspace`, so the pin records this app session.");
    expect(doc).not.toContain("cmux takeover`.");
    expect(doc).toContain("No supervisor was pinned, so there is no predecessor doc");
  });
});
