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

  it("pins with no takeover where no chair was pinned, since a takeover with no predecessor refuses", () => {
    const doc = recoverySuccessorDoc({ ...common, predecessor: undefined });
    expect(doc).toContain("2. Run `slopweaver cmux pin`, with no `--workspace`, so the pin records this app session.");
    expect(doc).not.toContain("cmux takeover`.");
    expect(doc).toContain("No supervisor was pinned, so there is no predecessor doc");
  });
});
