import { describe, expect, it } from "vitest";

import { type StackLink, soloPlace, stackKey, stackPlaces } from "../../../review/stack.js";

const REPO = "acme/acme-admin";

/** One link in the fleet, in the shape the live read carries. */
const link = (over: Partial<StackLink> = {}): StackLink => ({
  baseRefName: "staging",
  defaultBranch: "staging",
  headRefName: "feature/alone",
  number: 1,
  repoSlug: REPO,
  ...over,
});

/**
 * The stack under test — six of the owner's pull requests, each targeting the one below, in the order the
 * fleet happens to return them (which is not stack order).
 */
const SIX: readonly StackLink[] = [
  link({ baseRefName: "stack/5", headRefName: "stack/6", number: 16355 }),
  link({ baseRefName: "staging", headRefName: "stack/1", number: 16415 }),
  link({ baseRefName: "stack/2", headRefName: "stack/3", number: 16378 }),
  link({ baseRefName: "stack/1", headRefName: "stack/2", number: 16341 }),
  link({ baseRefName: "stack/4", headRefName: "stack/5", number: 16339 }),
  link({ baseRefName: "stack/3", headRefName: "stack/4", number: 16338 }),
];

const CHAIN = [16415, 16341, 16378, 16338, 16339, 16355];

describe("stackPlaces", () => {
  it("places the sixth pull request of the stack as PR 6 of 6, stacked, with the whole chain bottom-up", () => {
    const place = stackPlaces({ pullRequests: SIX }).get(stackKey({ number: 16355, repoSlug: REPO }))!;
    expect(place).toEqual({
      baseRefName: "stack/5",
      chain: CHAIN,
      defaultBranch: "staging",
      grounded: true,
      position: 6,
      size: 6,
      stacked: true,
    });
  });

  it("places the bottom pull request as PR 1 of 6, NOT stacked, so it alone can carry the ask", () => {
    const place = stackPlaces({ pullRequests: SIX }).get(stackKey({ number: 16415, repoSlug: REPO }))!;
    expect(place.stacked).toBe(false);
    expect(place.position).toBe(1);
    expect(place.size).toBe(6);
    expect(place.chain).toEqual(CHAIN);
  });

  it("places a middle pull request by its own position, with the same chain", () => {
    const place = stackPlaces({ pullRequests: SIX }).get(stackKey({ number: 16378, repoSlug: REPO }))!;
    expect(place.position).toBe(3);
    expect(place.stacked).toBe(true);
    expect(place.chain).toEqual(CHAIN);
  });

  it("places a pull request alone on the default branch as a chain of one, not stacked", () => {
    const place = stackPlaces({ pullRequests: [link()] }).get(stackKey({ number: 1, repoSlug: REPO }))!;
    expect(place).toEqual({
      baseRefName: "staging",
      chain: [1],
      defaultBranch: "staging",
      grounded: true,
      position: 1,
      size: 1,
      stacked: false,
    });
  });

  it("calls a pull request off the default branch stacked even when its base is nobody's head, and says the chain is not grounded", () => {
    const orphan = link({ baseRefName: "release/2026-09", headRefName: "hotfix/one", number: 9 });
    const place = stackPlaces({ pullRequests: [orphan] }).get(stackKey({ number: 9, repoSlug: REPO }))!;
    expect(place.stacked).toBe(true);
    expect(place.grounded).toBe(false);
    expect(place.position).toBe(1);
    expect(place.chain).toEqual([9]);
  });

  it("refuses to call anything stacked when the default branch could not be read", () => {
    const unread = link({ baseRefName: "stack/1", defaultBranch: "", number: 2 });
    const place = stackPlaces({ pullRequests: [unread] }).get(stackKey({ number: 2, repoSlug: REPO }))!;
    expect(place.stacked).toBe(false);
    expect(place.grounded).toBe(false);
  });

  it("never follows a chain across repositories, even when the branch names collide", () => {
    const other = link({ baseRefName: "staging", headRefName: "stack/5", number: 500, repoSlug: "acme/widgets" });
    const top = link({ baseRefName: "stack/5", headRefName: "stack/6", number: 6 });
    const place = stackPlaces({ pullRequests: [other, top] }).get(stackKey({ number: 6, repoSlug: REPO }))!;
    expect(place.chain).toEqual([6]);
    expect(place.grounded).toBe(false);
  });

  it("stops on a cycle rather than walking forever", () => {
    const a = link({ baseRefName: "loop/b", headRefName: "loop/a", number: 1 });
    const b = link({ baseRefName: "loop/a", headRefName: "loop/b", number: 2 });
    const place = stackPlaces({ pullRequests: [a, b] }).get(stackKey({ number: 1, repoSlug: REPO }))!;
    expect(place.chain).toEqual([2, 1, 2]);
    expect(place.grounded).toBe(false);
  });
});

describe("soloPlace", () => {
  it("answers what stackPlaces would for a fleet of one", () => {
    const pr = link({ baseRefName: "stack/1", headRefName: "stack/2", number: 3 });
    expect(soloPlace({ pr })).toEqual(stackPlaces({ pullRequests: [pr] }).get(stackKey({ number: 3, repoSlug: REPO })));
  });
});

describe("stackKey", () => {
  it("files a place under owner/name#number", () => {
    expect(stackKey({ number: 16355, repoSlug: REPO })).toBe("acme/acme-admin#16355");
  });
});
