import { describe, expect, it } from "vitest";

import { toGithubStack, toGithubStackOrDissolved } from "../../../../corpus/github/stack.js";

/** One raw `pull_requests[]` entry, shaped enough for `toGithubStack` to narrow. Unmerged, GitHub sends `null`. */
function rawEntry({
  number,
  baseRef,
  headRef,
  mergedAt = null,
}: {
  number: number;
  baseRef: string;
  headRef: string;
  mergedAt?: string | null;
}): Record<string, unknown> {
  return {
    base: { ref: baseRef },
    head: { ref: headRef },
    merged_at: mergedAt,
    number,
    state: "open",
  };
}

describe("toGithubStack", () => {
  it("narrows a real three-entry stack response", () => {
    expect(
      toGithubStack({
        value: {
          id: 248581,
          number: 15155,
          open: true,
          pull_requests: [
            rawEntry({ baseRef: "staging", headRef: "bottom", number: 15148 }),
            rawEntry({ baseRef: "bottom", headRef: "middle", number: 15154 }),
            rawEntry({ baseRef: "middle", headRef: "top", number: 15159 }),
          ],
        },
      }),
    ).toEqual({
      entries: [
        { baseRef: "staging", headRef: "bottom", mergedAtIso: undefined, number: 15148, state: "open" },
        { baseRef: "bottom", headRef: "middle", mergedAtIso: undefined, number: 15154, state: "open" },
        { baseRef: "middle", headRef: "top", mergedAtIso: undefined, number: 15159, state: "open" },
      ],
      id: 248581,
      number: 15155,
      open: true,
    });
  });

  it("narrows a fresh two-entry stack, carrying a merged entry's timestamp", () => {
    expect(
      toGithubStack({
        value: {
          id: 1,
          number: 2,
          open: true,
          pull_requests: [
            rawEntry({ baseRef: "main", headRef: "a", mergedAt: "2026-08-01T00:00:00Z", number: 10 }),
            rawEntry({ baseRef: "a", headRef: "b", number: 11 }),
          ],
        },
      }),
    ).toEqual({
      entries: [
        { baseRef: "main", headRef: "a", mergedAtIso: "2026-08-01T00:00:00Z", number: 10, state: "open" },
        { baseRef: "a", headRef: "b", mergedAtIso: undefined, number: 11, state: "open" },
      ],
      id: 1,
      number: 2,
      open: true,
    });
  });

  it("throws on a non-object response", () => {
    expect(() => toGithubStack({ value: "not a stack" })).toThrow("GitHub's stack response was not an object");
  });

  it("throws when id, number or open is missing", () => {
    expect(() => toGithubStack({ value: { number: 2, open: true, pull_requests: [] } })).toThrow(
      "GitHub's stack response is missing id, number or open",
    );
  });

  it("throws when pull_requests is missing", () => {
    expect(() => toGithubStack({ value: { id: 1, number: 2, open: true } })).toThrow(
      "GitHub's stack response is missing a pull_requests array",
    );
  });

  it("throws when a pull_requests entry has no numeric number or state", () => {
    expect(() =>
      toGithubStack({
        value: {
          id: 1,
          number: 2,
          open: true,
          pull_requests: [rawEntry({ baseRef: "main", headRef: "a", number: 10 }), {}],
        },
      }),
    ).toThrow("stack.pull_requests[1] is missing number or state");
  });

  it("throws when a pull_requests entry has no head.ref or base.ref", () => {
    expect(() =>
      toGithubStack({
        value: { id: 1, number: 2, open: true, pull_requests: [{ number: 10, state: "open" }] },
      }),
    ).toThrow("stack.pull_requests[0] is missing head.ref or base.ref");
  });
});

describe("toGithubStackOrDissolved", () => {
  it("narrows a surviving stack when unstack's 200 body reports one", () => {
    expect(
      toGithubStackOrDissolved({
        value: {
          id: 1,
          number: 2,
          open: true,
          pull_requests: [rawEntry({ baseRef: "main", headRef: "a", number: 10 })],
        },
      }),
    ).toEqual({
      entries: [{ baseRef: "main", headRef: "a", mergedAtIso: undefined, number: 10, state: "open" }],
      id: 1,
      number: 2,
      open: true,
    });
  });

  it("reports undefined for unstack's 204 — no body means the stack is fully dissolved", () => {
    expect(toGithubStackOrDissolved({ value: undefined })).toBeUndefined();
  });
});
