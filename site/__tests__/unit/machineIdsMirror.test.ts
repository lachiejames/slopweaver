/*
 * The page publish gate and the queue card form agree on what a machine id looks like.
 *
 * `site/lib/machineIds.ts` restates `src/pages/machineIds.ts`'s patterns because `site/` never imports `src/`; this
 * file, in the lane that reaches both roots, is what binds the copy — a shape added to one alone would let a card
 * draw an id a page refuses, or the reverse.
 */

import { describe, expect, it } from "vitest";

import { MACHINE_ID_PATTERNS as PAGE_PATTERNS, carriesMachineId as pageCarries } from "../../../src/pages/machineIds";
import { MACHINE_ID_PATTERNS as CARD_PATTERNS, carriesMachineId as cardCarries } from "../../lib/machineIds";

/** Prose a card draws: an id bare, an id behind a link, and none. */
const SAMPLES: readonly string[] = [
  "Send the recut from call efe7b241?",
  "Send the recut from https://example.test/call/efe7b241?",
  "Send the recut from the owner's call this morning?",
  "from session 61445570",
  "commit 76ff05a31d is the anchor",
];

describe("the page gate's and the card form's machine-id patterns agree", () => {
  it("on every pattern's source and flags, in order", () => {
    expect(PAGE_PATTERNS.length).toBeGreaterThan(0);
    expect(CARD_PATTERNS.map((pattern) => `/${pattern.source}/${pattern.flags}`)).toEqual(
      PAGE_PATTERNS.map((pattern) => `/${pattern.source}/${pattern.flags}`),
    );
  });

  it("on whether a line carries one, an id behind a link not counted", () => {
    expect(SAMPLES.map((text) => pageCarries({ text }))).toEqual([true, false, false, true, false]);
    expect(SAMPLES.map((text) => cardCarries({ text }))).toEqual(SAMPLES.map((text) => pageCarries({ text })));
  });
});
