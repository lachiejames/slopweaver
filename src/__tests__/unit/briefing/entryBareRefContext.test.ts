/** The entry-local rule the page check and the form writer share: the nearest link in the entry names the repo. */
import { describe, expect, it } from "vitest";

import { bareRefContextAt, type EntryRepoAnchor } from "../../../briefing/entryBareRefContext.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";

const WIDGET = { owner: "acme", repo: "widget" };
const GADGET = { owner: "acme", repo: "gadget" };
const PAGE: BareRefContext = { attested: [{ number: 7, owner: "acme", repo: "page" }], repos: [WIDGET, GADGET] };

/** An anchor at `at` naming `repo`, attesting one number. */
function anchor({ at, repo, number }: { at: number; repo: typeof WIDGET; number: number }): EntryRepoAnchor {
  return { at, attested: [{ number, ...repo }], repo };
}

describe("bareRefContextAt", () => {
  it("falls back to the page context unchanged when the entry links nothing", () => {
    expect(bareRefContextAt({ anchors: [], end: 15, fallback: PAGE, start: 10 })).toBe(PAGE);
  });

  it("narrows to the nearest link's repository, keeping every attestation", () => {
    const anchors = [anchor({ at: 0, number: 120, repo: WIDGET }), anchor({ at: 40, number: 19343, repo: GADGET })];

    expect(bareRefContextAt({ anchors, end: 15, fallback: PAGE, start: 10 })).toEqual({
      attested: [
        { number: 7, owner: "acme", repo: "page" },
        { number: 120, owner: "acme", repo: "widget" },
        { number: 19343, owner: "acme", repo: "gadget" },
      ],
      repos: [WIDGET],
    });
  });

  it("names no repository on an exact tie between two different repositories", () => {
    const anchors = [anchor({ at: 5, number: 120, repo: WIDGET }), anchor({ at: 20, number: 19343, repo: GADGET })];

    expect(bareRefContextAt({ anchors, end: 15, fallback: PAGE, start: 10 }).repos).toEqual([]);
  });

  it("resolves a tie between two links to the same repository, and a page with no attestations", () => {
    const anchors = [anchor({ at: 5, number: 120, repo: WIDGET }), anchor({ at: 20, number: 121, repo: WIDGET })];

    expect(bareRefContextAt({ anchors, end: 15, fallback: { repos: [] }, start: 10 })).toEqual({
      attested: [
        { number: 120, owner: "acme", repo: "widget" },
        { number: 121, owner: "acme", repo: "widget" },
      ],
      repos: [WIDGET],
    });
  });
});
