import { describe, expect, it } from "vitest";

import {
  isInScopeDoc,
  namesTheMechanism,
  OWN_TAB_DIRECTIVES,
  scanOwnHandResidue,
} from "../../../devLint/ownHandResidue.js";

describe("isInScopeDoc", () => {
  it("reads the always-on instruction files", () => {
    expect(isInScopeDoc({ path: "AGENTS.md" })).toBe(true);
    expect(isInScopeDoc({ path: "CLAUDE.md" })).toBe(true);
  });

  it("reads the agent-facing trees", () => {
    expect(isInScopeDoc({ path: ".claude/rules/cross-session-messages.md" })).toBe(true);
    expect(isInScopeDoc({ path: "skills/supervisor/reference/routing.md" })).toBe(true);
    expect(isInScopeDoc({ path: "docs/doctrine-rationale.md" })).toBe(true);
  });

  it("ignores source and fixtures", () => {
    expect(isInScopeDoc({ path: "src/grants/grant.ts" })).toBe(false);
    expect(isInScopeDoc({ path: "src/__tests__/fixtures/replay/x/manifest.json" })).toBe(false);
  });
});

describe("scanOwnHandResidue", () => {
  it("flags a doc that points a session at the owner's keystrokes in its own tab", () => {
    const content = "the session held the merge until the owner typed `merge it` into its own tab.";

    expect(scanOwnHandResidue({ content, path: "docs/x.md" })).toEqual([
      { directive: "into its own tab", line: 1, path: "docs/x.md" },
    ]);
  });

  it("reports the line number of a hit further down the file", () => {
    const content = ["intro", "", "wait for a line the owner typed in your session."].join("\n");

    expect(scanOwnHandResidue({ content, path: "docs/x.md" })[0]!.line).toBe(3);
  });

  it("clears the same sentence once the doc names the mechanism", () => {
    const content = [
      "the session held the merge until the owner typed `merge it` into its own tab.",
      "that is what the journalled grant replaced — `slopweaver grant show <id>`.",
    ].join("\n");

    expect(scanOwnHandResidue({ content, path: "docs/x.md" })).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const content = "A USER TURN IN YOUR OWN SESSION is attributable.";

    expect(scanOwnHandResidue({ content, path: "docs/x.md" }).length).toBe(1);
  });

  it("leaves the tier-3 set alone — the scope is the keystroke, never the authority", () => {
    const content = [
      "**What still needs the owner's own hand** — new access, a new audience, egress, spend,",
      "an irreversible unasked-for act. Route it to the owner.",
    ].join("\n");

    expect(scanOwnHandResidue({ content, path: "docs/x.md" })).toEqual([]);
  });

  it("finds nothing in a doc with no directive at all", () => {
    expect(scanOwnHandResidue({ content: "how the corpus is compacted.", path: "docs/x.md" })).toEqual([]);
  });

  it("flags every directive it publishes", () => {
    const missed = OWN_TAB_DIRECTIVES.filter(
      (phrase) => scanOwnHandResidue({ content: `text ${phrase} text`, path: "docs/x.md" }).length === 0,
    );

    expect(missed).toEqual([]);
  });
});

describe("namesTheMechanism", () => {
  it("recognises the verb", () => {
    expect(namesTheMechanism({ content: "run `slopweaver grant record`" })).toBe(true);
  });

  it("recognises the rules file", () => {
    expect(namesTheMechanism({ content: "see .claude/rules/journalled-grants.md" })).toBe(true);
  });

  it("recognises the prose name", () => {
    expect(namesTheMechanism({ content: "a journalled grant carries the owner's ruling" })).toBe(true);
  });

  it("does not accept an unrelated mention of a grant", () => {
    expect(namesTheMechanism({ content: "store the OAuth grant under this home" })).toBe(false);
  });
});
