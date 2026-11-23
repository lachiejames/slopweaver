/*
 * The guidance verb and the page's reader agree on the wire.
 *
 * `site/lib/alignmentGuidance.ts` restates `src/profile/guidanceWire.ts`'s source ids because `site/` never imports
 * `src/`; this file, in the lane that reaches both roots, binds the copy. It imports that leaf and never
 * `src/profile/guidance.ts`, whose type imports would pull process-spawning `src/` modules into the site's Next type
 * check, where `ProcessEnv` requires `NODE_ENV` and every one of them fails. A source added to the verb alone would make the reader
 * refuse every reading, and one dropped from it alone would make the reader refuse too — loud either way, never a
 * source silently missing from a card.
 */

import { describe, expect, it } from "vitest";

import { doctrineState, GUIDANCE_SOURCES, guidanceWire } from "../../../src/profile/guidanceWire";
import { readGuidance } from "../../components/live/readGuidance";
import { GUIDANCE_SOURCE_IDS } from "../../lib/alignmentGuidance";

describe("the guidance wire", () => {
  it("names the same sources in the verb and the reader, in the same order", () => {
    expect(GUIDANCE_SOURCES.length).toBeGreaterThan(0);
    expect(GUIDANCE_SOURCES.map((source) => source.id)).toEqual(GUIDANCE_SOURCE_IDS);
  });

  it("is read whole by the page, as the verb writes it", () => {
    const empty = { entries: [], gaps: [], kind: "read" } as const;
    const wire = guidanceWire({
      readAtIso: "2026-11-13T00:00:00.000Z",
      states: {
        "class-steers": empty,
        doctrine: doctrineState({ text: "## Operating doctrine\n\n**1 · Land your own work.** Once green.\n" }),
        "general-rulings": empty,
        memories: empty,
        "owner-profile": { kind: "unreadable", why: "timed out" },
        "ruling-gates": empty,
        "standing-asks": empty,
      },
    });

    const read = readGuidance(JSON.parse(JSON.stringify(wire)));

    expect(read!.sources.map((source) => source.id)).toEqual(GUIDANCE_SOURCE_IDS);
  });
});
