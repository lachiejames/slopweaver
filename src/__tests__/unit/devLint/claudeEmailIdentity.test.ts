import { describe, expect, it } from "vitest";

import { CLAUDE_DIRECTORIES, scanClaudeEmailIdentity } from "../../../devLint/claudeEmailIdentity.js";

const scan = ({ content }: { content: string }): readonly number[] =>
  scanClaudeEmailIdentity({ content, path: "src/claude/probe.ts" }).map((hit) => hit.line);

describe("scanClaudeEmailIdentity", () => {
  it("catches the lookup that resolves a plan FROM an address — the shape the gate exists for", () => {
    expect(scan({ content: "const hit = accounts.find((a) => a.email === wanted);\n" })).toEqual([1]);
  });

  it("catches every equality operator, not only the strict one", () => {
    const content = [
      "const a = one.email !== two;",
      "const b = one.email == two;",
      "const c = one.email != two;",
      "const d = two === one.email;",
    ].join("\n");
    expect(scan({ content })).toEqual([1, 2, 3, 4]);
  });

  it("catches an address used as a collection key", () => {
    const content = ["seen.get(account.email);", "seen.has(account.email);", "seen.add(account.email);"].join("\n");
    expect(scan({ content })).toEqual([1, 2, 3]);
  });

  it("catches an address used as a computed member key", () => {
    expect(scan({ content: "const n = byAddress[account.email];\n" })).toEqual([1]);
  });

  it("sees through parentheses and a non-null assertion", () => {
    expect(scan({ content: "const same = (account.email!) === wanted;\n" })).toEqual([1]);
  });

  it("leaves the exactOptionalPropertyTypes presence idiom alone, in both operand orders", () => {
    const content = [
      "const spread = account.email === undefined ? {} : { email: account.email };",
      "const other = undefined !== account.email;",
      "const nulled = account.email === null;",
    ].join("\n");
    expect(scan({ content })).toEqual([]);
  });

  it("leaves rendering, passing and spreading the address alone", () => {
    const content = [
      "const label = planLabel({ alias, cell: cachedAccountCell({ cachedEmail: account.email }) });",
      "const argv = ['--email', account.email];",
      "const row = { ...base, email: account.email };",
      "const shown = `plan (${account.email})`;",
    ].join("\n");
    expect(scan({ content })).toEqual([]);
  });

  // The gate's own declared limit, pinned rather than believed: a rule whose blind spot nobody has written
  // down is a rule a reader will assume covers more than it does.
  it("does NOT see an address reached through a local, which is its stated blind spot", () => {
    const content = ["const wanted = account.email;", "const hit = other === wanted;"].join("\n");
    expect(scan({ content })).toEqual([]);
  });
});

// The SCOPE is invisible to every test above: a directory the gate never reads produces the same empty hit
// list as one it read and cleared. So the scope is asserted directly — the register carries the same `email`
// cache, for Codex rows too, and a narrowing back to the Claude trees alone must redden here rather than
// pass silently.
describe("the gate's scope covers every tree the account cache lives in", () => {
  it("names both Claude trees and both register trees, and nothing else", () => {
    expect([...CLAUDE_DIRECTORIES].toSorted()).toStrictEqual([
      "src/claude/",
      "src/cli/commands/claude/",
      "src/cli/commands/plans/",
      "src/plans/",
    ]);
  });
});
