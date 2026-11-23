/*
 * A landed change read as a sentence: the conventional-commit prefix comes off and its scope becomes the area, the
 * first letter is a capital, and the sentence closes on a full stop exactly once.
 */
import { describe, expect, it } from "vitest";

import { changeSentence } from "../../lib/changeSentence";

describe("changeSentence", () => {
  it("drops a scoped prefix, names its area, and closes the sentence", () => {
    expect(
      changeSentence({
        title: "fix(voice): the full-screen call view drops its settings cog; its call switches live on Settings",
      }),
    ).toEqual({
      area: "Voice",
      kind: "Fix",
      sentence: "The full-screen call view drops its settings cog; its call switches live on Settings.",
    });
  });

  it("keeps a title with no prefix as the sentence, with no area", () => {
    expect(
      changeSentence({ title: "The console sidebar shows which build the page is, how many commits behind it is" }),
    ).toEqual({
      area: undefined,
      kind: undefined,
      sentence: "The console sidebar shows which build the page is, how many commits behind it is.",
    });
  });

  it("drops an unscoped and a breaking prefix, naming no area for the unscoped one", () => {
    expect(changeSentence({ title: "chore: bump the lockfile" })).toEqual({
      area: undefined,
      kind: undefined,
      sentence: "Bump the lockfile.",
    });
    expect(changeSentence({ title: "feat(desktop)!: the app updates itself in one click" })).toEqual({
      area: "Desktop",
      kind: "New",
      sentence: "The app updates itself in one click.",
    });
  });

  it("names a fix and a new thing, and nothing for any other type", () => {
    expect(changeSentence({ title: "fix(voice): the orb rests clear" }).kind).toBe("Fix");
    expect(changeSentence({ title: "feat: one-click update" }).kind).toBe("New");
    expect(changeSentence({ title: "docs(desktop): a page" }).kind).toBe(undefined);
    expect(changeSentence({ title: "constructor(x): an inherited key is no kind" }).kind).toBe(undefined);
  });

  it("never adds a second full stop, and closes after a trailing quote or bracket only when it is open", () => {
    expect(changeSentence({ title: "fix(site): the orb is inked in its own two colours." }).sentence).toBe(
      "The orb is inked in its own two colours.",
    );
    expect(changeSentence({ title: 'feat(talk): it says "I\'m back now!"' }).sentence).toBe('It says "I\'m back now!"');
    expect(changeSentence({ title: "fix(console): Queue then Pull requests (one group)" }).sentence).toBe(
      "Queue then Pull requests (one group).",
    );
  });

  it("never shows a commit hash a title carries, short, full or all letters, and leaves plain numbers and short words", () => {
    expect(changeSentence({ title: "fix(console): restore 0123456789abcdef0123456789abcdef01234567" }).sentence).toBe(
      "Restore a commit.",
    );
    expect(changeSentence({ title: "fix(ci): revert 47fb408 and pin node 24" }).sentence).toBe(
      "Revert a commit and pin node 24.",
    );
    expect(changeSentence({ title: "fix(site): revert deadbeef" }).sentence).toBe("Revert a commit.");
    expect(changeSentence({ title: "fix(deadbeef): repair the updater" })).toEqual({
      area: undefined,
      kind: "Fix",
      sentence: "Repair the updater.",
    });
    expect(changeSentence({ title: "fix(_deadbeef_): revert _47fb408_" })).toEqual({
      area: undefined,
      kind: "Fix",
      sentence: "Revert _a commit_.",
    });
    expect(changeSentence({ title: "fix(site): the faded cafe marker survives 2026100 reloads" }).sentence).toBe(
      "The faded cafe marker survives 2026100 reloads.",
    );
  });

  it("reads a hyphenated scope as words", () => {
    expect(changeSentence({ title: "fix(slack-drive): the walk resumes" }).area).toBe("Slack drive");
  });

  it("leaves a colon inside a sentence alone when it is not a prefix", () => {
    expect(changeSentence({ title: "Two fixes: the dot and the line" })).toEqual({
      area: undefined,
      kind: undefined,
      sentence: "Two fixes: the dot and the line.",
    });
  });
});
