import { describe, expect, it } from "vitest";
import {
  depsMode,
  parseWorktreeArgs,
  switchPair,
  targetRepoRoot,
  worktreeUsage,
} from "../../../cli/commands/worktree/core.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { type SessionItem, sessionName } from "../../../sessions/session.js";

/** Parse a create invocation the way the verb does, so every assertion runs through the REAL parser. */
function parseCreate({ rest }: { rest: readonly string[] }): ReturnType<typeof parseWorktreeArgs> {
  return parseWorktreeArgs({ rest, verb: "create" });
}

describe("switchPair", () => {
  it("takes the fallback when neither half was passed", () => {
    const parsed = unwrap(parseCreate({ rest: ["a-slug"] }));

    expect(unwrap(switchPair({ fallback: true, name: "install", parsed }))).toBe(true);
    expect(unwrap(switchPair({ fallback: false, name: "build", parsed }))).toBe(false);
  });

  it("turns a switch on and off from its two halves", () => {
    const off = unwrap(parseCreate({ rest: ["a-slug", "--no-install"] }));
    const on = unwrap(parseCreate({ rest: ["a-slug", "--build"] }));

    expect(unwrap(switchPair({ fallback: true, name: "install", parsed: off }))).toBe(false);
    expect(unwrap(switchPair({ fallback: false, name: "build", parsed: on }))).toBe(true);
  });

  it("refuses both halves at once rather than picking a silent winner", () => {
    const parsed = unwrap(parseCreate({ rest: ["a-slug", "--install", "--no-install"] }));
    const errors = unwrapErr(switchPair({ fallback: true, name: "install", parsed }));

    expect(errors).toEqual(["--install and --no-install contradict each other — pass one"]);
  });
});

describe("depsMode", () => {
  it("defaults to a worktree's own tree", () => {
    expect(unwrap(depsMode({ parsed: unwrap(parseCreate({ rest: ["a-slug"] })) }))).toBe("own");
  });

  it("accepts the two modes it advertises", () => {
    expect(unwrap(depsMode({ parsed: unwrap(parseCreate({ rest: ["a-slug", "--deps", "shared"] })) }))).toBe("shared");
    expect(unwrap(depsMode({ parsed: unwrap(parseCreate({ rest: ["a-slug", "--deps", "own"] })) }))).toBe("own");
  });

  it("refuses a value naming neither, and quotes what it got", () => {
    const errors = unwrapErr(depsMode({ parsed: unwrap(parseCreate({ rest: ["a-slug", "--deps", "borrowed"] })) }));

    expect(errors).toEqual(['--deps must be `own` or `shared`, got "borrowed"']);
  });
});

describe("parseWorktreeArgs", () => {
  it("keeps the slug as a positional", () => {
    expect(unwrap(parseCreate({ rest: ["a-slug", "--base", "main"] })).positionals).toEqual(["a-slug"]);
  });

  it("is strict about a flag it does not know", () => {
    expect(unwrapErr(parseCreate({ rest: ["a-slug", "--nope"] }))).toEqual(["unknown flag: --nope"]);
  });

  it("refuses every flag on a verb with no spec, which accepts none", () => {
    expect(unwrapErr(parseWorktreeArgs({ rest: ["--json"], verb: "no-such-verb" }))).toEqual(["unknown flag: --json"]);
  });
});

describe("targetRepoRoot", () => {
  it("takes --repo as given, without looking the checkout up from cwd", () => {
    const parsed = unwrap(parseWorktreeArgs({ rest: ["--repo", "/a/main/checkout"], verb: "list" }));
    expect(targetRepoRoot({ cwd: "/nowhere/near/a/repository", parsed })).toBe("/a/main/checkout");
  });
});

describe("worktreeUsage", () => {
  it("names the slug positional on the verbs that take one", () => {
    expect(worktreeUsage({ verb: "create" })).toContain("worktree create <slug>");
    expect(worktreeUsage({ verb: "list" })).not.toContain("<slug>");
  });

  it("renders a value flag with a placeholder and a switch without one", () => {
    const usage = worktreeUsage({ verb: "create" });

    expect(usage).toContain("[--deps <value>]");
    expect(usage).toContain("[--no-install]");
  });
});

describe("sessionName", () => {
  const base: SessionItem = {
    lastEventIso: "2026-09-01T00:00:00.000Z",
    sessionKey: "ask-C1-1700000000.000100-worker",
    status: "open",
  };

  it("names a session a handover doc opened by its slug", () => {
    expect(sessionName({ session: { ...base, slug: "a-handover-doc" } })).toBe("a-handover-doc");
  });

  it("names a session no handover doc opened by its session key", () => {
    expect(sessionName({ session: base })).toBe("ask-C1-1700000000.000100-worker");
  });
});
