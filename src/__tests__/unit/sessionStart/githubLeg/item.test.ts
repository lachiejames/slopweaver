/*
 * What a row shows: the `prBackground` sentence, on its own and on a stack, the `prState` it reads, and the
 * `prItem` it carries — key, who, title, repository, link and head branch.
 */
import { describe, expect, it } from "vitest";

import { prBackground, prItem, prState, SELF_ORIGIN } from "../../../../sessionStart/githubLeg.js";
import { bottomOfSix, sixthOfSix, state } from "./fixtures.js";

describe("prBackground", () => {
  it("says what the pull request is and where it lands", () => {
    expect(prBackground({ state: state() })).toBe(
      "A pull request you opened in acme/widgets. Its title is the line above.",
    );
  });

  it("never repeats the title, which the renderer already prints directly above it", () => {
    expect(prBackground({ state: state({ title: "a distinctive title" }) })).not.toContain("a distinctive title");
  });
});

describe("prBackground on a stack", () => {
  it("shows the bottom row the whole stack queued behind it, since that row carries the only ask", () => {
    expect(prBackground({ state: bottomOfSix() })).toBe(
      "A pull request you opened in acme/widgets. Its title is the line above. " +
        "It is the bottom of a stack of 6 and carries the stack's only review ask; " +
        "acme/widgets#16341, acme/widgets#16378, acme/widgets#16338, acme/widgets#16339, acme/widgets#16355 " +
        "wait behind it until it lands.",
    );
  });

  it("shows a stacked row its position and the bottom it waits on", () => {
    expect(prBackground({ state: sixthOfSix() })).toBe(
      "A pull request you opened in acme/widgets. Its title is the line above. " +
        "It targets stack/5 rather than staging, as PR 6 of 6 in a stack whose bottom is acme/widgets#16415; " +
        "it gets no review ask until acme/widgets#16415 lands.",
    );
  });

  it("says a chain it could not ground is off the default branch, without naming a bottom", () => {
    const orphan = sixthOfSix({
      stack: {
        baseRefName: "release/2026-09",
        chain: [16355],
        defaultBranch: "staging",
        grounded: false,
        position: 1,
        size: 1,
        stacked: true,
      },
    });
    expect(prBackground({ state: orphan })).toBe(
      "A pull request you opened in acme/widgets. Its title is the line above. " +
        "It targets release/2026-09 rather than staging, and this read could not follow its stack down to staging; " +
        "it gets no review ask until it does.",
    );
  });

  it("says nothing about a stack on a pull request alone on the default branch", () => {
    expect(prBackground({ state: state() })).toBe(
      "A pull request you opened in acme/widgets. Its title is the line above.",
    );
  });
});

describe("prState", () => {
  it("is the recommendation on an ordinary pull request", () => {
    expect(prState({ state: state() })).toBe("already-asked");
  });

  it("says a stale CodeRabbit green is for an earlier push", () => {
    expect(prState({ state: state({ codeRabbit: "stale" }) })).toBe(
      "already-asked, and CodeRabbit's green is for an earlier push",
    );
  });
});

describe("prItem", () => {
  it("keys on the repository and number, which no state change moves", () => {
    expect(prItem({ state: state(), whose: { party: "owner" } })!.nativeId).toBe("acme/widgets#7");
  });

  it("names the reviewer as who, when there is one", () => {
    expect(prItem({ state: state(), whose: { party: "other", who: "A Colleague" } })!.who).toBe("A Colleague");
  });

  it("says the work is the owner's own when nobody asked the owner", () => {
    expect(prItem({ state: state(), whose: { party: "owner" } })!.who).toBe(SELF_ORIGIN);
  });

  it("carries the pull request's own title and repository", () => {
    const item = prItem({ state: state(), whose: { party: "owner" } })!;
    expect(item.title).toBe("a pull request title");
    expect(item.repo).toBe("acme/widgets");
  });

  it("links the pull request itself, so one click lands on it", () => {
    expect(prItem({ state: state(), whose: { party: "owner" } })!.where).toBe("https://github.com/acme/widgets/pull/7");
  });
});

describe("prItem carries the head branch", () => {
  it("names the head branch, so a run journal can be joined to it", () => {
    const item = prItem({ state: state(), whose: { party: "owner" } })!;
    expect(item.branch).toBe("feature/widget-7");
  });

  it("omits a blank head branch rather than recording an empty one", () => {
    const item = prItem({ state: state({ headRefName: "" }), whose: { party: "owner" } })!;
    expect("branch" in item).toBe(false);
  });
});
