/**
 * The closed list behind the console voice's `verb` tool, and the resolver that turns one request into argv.
 * The list is the security boundary, so each refusal is asserted by the reason it prints, not only that it fired.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  MAX_VERB_ARG_BYTES,
  MAX_VERB_ARGS,
  MODEL_READS,
  REFUSED_FLAGS,
  resolveModelRead,
} from "../../../talk/modelReads.js";

describe("MODEL_READS", () => {
  it("names each verb once", () => {
    expect(MODEL_READS.length).toBeGreaterThan(0);
    const names = MODEL_READS.map((read) => `${read.noun} ${read.verb}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it("carries none of the verbs traced and left off for writing or never ending", () => {
    const names = MODEL_READS.map((read) => `${read.noun} ${read.verb}`);
    const excluded = new Set(["slack read-thread", "store hits", "hand list", "github review-state", "handover list"]);
    expect(names.filter((name) => excluded.has(name))).toEqual([]);
  });
});

describe("resolveModelRead", () => {
  it("resolves a listed read to the argv after slopweaver", () => {
    const resolved = resolveModelRead({
      request: { args: ["https://github.com/o/r/pull/1", "--json"], noun: "github", verb: "read" },
    });
    expect(unwrap(resolved)).toEqual(["github", "read", "https://github.com/o/r/pull/1", "--json"]);
  });

  it("resolves automation due under either name, to the current noun", () => {
    expect(unwrap(resolveModelRead({ request: { args: [], noun: "automation", verb: "due" } }))).toEqual([
      "automation",
      "due",
    ]);
    expect(unwrap(resolveModelRead({ request: { args: [], noun: "recipe", verb: "due" } }))).toEqual([
      "automation",
      "due",
    ]);
  });

  // The whole board was not on the voice's read list, so "is there already a card for this" was answered from the
  // owner's Queue alone. `talk find-card` is that read, and `--home` stays refused on it.
  it("resolves talk find-card with the owner's words and their paraphrases, and refuses it another home", () => {
    expect(
      unwrap(resolveModelRead({ request: { args: ["voice", "tools", "browser"], noun: "talk", verb: "find-card" } })),
    ).toEqual(["talk", "find-card", "voice", "tools", "browser"]);
    const aimed = resolveModelRead({
      request: { args: ["voice", "--home", "/tmp/other"], noun: "talk", verb: "find-card" },
    });
    expect(unwrapErr(aimed)[0]).toContain("--home is refused");
  });

  // Asked what the Codex plans had left, the voice was refused the meter and
  // said it could not see it. `codex route` is that meter; `codex quota` stays off, since `quota clear` writes.
  it("resolves the Codex plan meter, refuses it another home, and keeps the quota cache off the list", () => {
    expect(unwrap(resolveModelRead({ request: { args: ["--json"], noun: "codex", verb: "route" } }))).toEqual([
      "codex",
      "route",
      "--json",
    ]);
    const aimed = resolveModelRead({ request: { args: ["--home=elsewhere"], noun: "codex", verb: "route" } });
    expect(unwrapErr(aimed)).toEqual([
      "--home is refused: it would aim the read at another home, a path, a write or a read that never ends",
    ]);
    const quota = resolveModelRead({ request: { args: [], noun: "codex", verb: "quota" } });
    expect(unwrapErr(quota)[0]).toContain("codex quota is not a verb the voice may run");
  });

  it("resolves responders list, refuses it another home, and keeps add and remove off the list", () => {
    expect(unwrap(resolveModelRead({ request: { args: ["--json"], noun: "responders", verb: "list" } }))).toEqual([
      "responders",
      "list",
      "--json",
    ]);
    const aimed = resolveModelRead({ request: { args: ["--home", "x"], noun: "responders", verb: "list" } });
    expect(unwrapErr(aimed)[0]).toContain("--home is refused");
    const add = resolveModelRead({ request: { args: [], noun: "responders", verb: "add" } });
    expect(unwrapErr(add)[0]).toContain("responders add is not a verb the voice may run");
  });

  it("refuses a verb that is not on the list", () => {
    const resolved = resolveModelRead({ request: { args: [], noun: "github", verb: "merge" } });
    expect(unwrapErr(resolved)[0]).toContain("github merge is not a verb the voice may run");
  });

  it("refuses every path, home, wait and write flag, in both spellings", () => {
    expect(REFUSED_FLAGS.length).toBeGreaterThan(0);
    for (const flag of ["--home", "--out=/tmp/x", "--follow", "--apply"]) {
      const resolved = resolveModelRead({ request: { args: ["q", flag], noun: "store", verb: "query" } });
      expect(unwrapErr(resolved)[0]).toContain(`${flag.split("=")[0]!} is refused`);
    }
  });

  it("refuses every flag that takes a directory or a file, even one this list names nowhere else", () => {
    for (const flag of [
      "--corpus",
      "--projects=x",
      "--artifact",
      "--html",
      "--client-id-file",
      "--client-secret-file",
    ]) {
      const resolved = resolveModelRead({ request: { args: ["q", flag], noun: "store", verb: "query" } });
      expect(unwrapErr(resolved)[0]).toContain(`${flag.split("=")[0]!} is refused`);
    }
  });

  it("refuses a row's own flags on that row only", () => {
    const paneRepo = resolveModelRead({ request: { args: ["--repo", "x"], noun: "pane", verb: "pr-status" } });
    expect(unwrapErr(paneRepo)).toEqual([
      "--repo is refused: it would aim the read at another home, a path, a write or a read that never ends",
    ]);
    const velocityRepo = resolveModelRead({ request: { args: ["--repo=x"], noun: "velocity", verb: "run" } });
    expect(unwrapErr(velocityRepo)[0]).toContain("--repo is refused");
    const githubRepo = resolveModelRead({
      request: { args: ["x", "--repo", "lachiejames/slopweaver"], noun: "github", verb: "search" },
    });
    expect(unwrap(githubRepo)).toEqual(["github", "search", "x", "--repo", "lachiejames/slopweaver"]);
  });

  it("reads the workstream candidates plain, refusing the page file and the JSON past the tool answer's cap", () => {
    const plain = resolveModelRead({ request: { args: [], noun: "workstreams", verb: "candidates" } });
    expect(unwrap(plain)).toEqual(["workstreams", "candidates"]);
    const fragment = resolveModelRead({
      request: { args: ["--fragment", "page.html"], noun: "workstreams", verb: "candidates" },
    });
    expect(unwrapErr(fragment)).toEqual([
      "--fragment is refused: it would aim the read at another home, a path, a write or a read that never ends",
    ]);
    const json = resolveModelRead({ request: { args: ["--json"], noun: "workstreams", verb: "candidates" } });
    expect(unwrapErr(json)).toEqual([
      "--json is refused: it would aim the read at another home, a path, a write or a read that never ends",
    ]);
    const home = resolveModelRead({ request: { args: ["--home=elsewhere"], noun: "workstreams", verb: "candidates" } });
    expect(unwrapErr(home)).toEqual([
      "--home is refused: it would aim the read at another home, a path, a write or a read that never ends",
    ]);
  });

  it("refuses an argument shaped like a filesystem path, whatever flag it follows", () => {
    const paths = ["/etc/passwd", "~/.ssh", "./x", "..", "../up", "file:///x", "a/../b"];
    const resolved = resolveModelRead({ request: { args: paths, noun: "store", verb: "query" } });
    expect(unwrapErr(resolved)).toEqual(
      paths.map(
        (_, index) => `argument ${String(index + 1)} looks like a filesystem path, and the voice never names one`,
      ),
    );
    const words = resolveModelRead({ request: { args: ["...", "a.b", "why/how"], noun: "store", verb: "query" } });
    expect(unwrap(words)).toEqual(["store", "query", "...", "a.b", "why/how"]);
  });

  it("finds a path where a verb would read one: after `=`, after a `kind:` prefix, after a short flag", () => {
    const hidden = [
      "--ref=/abs/path",
      "state:/etc/x",
      "-O/etc/hosts",
      "--x=~/y",
      "k:../up",
      "--ref=state:/etc/passwd",
      "--ref=-O/etc/hosts",
      "--ref=-pO/etc/hosts",
      "-pO/etc/hosts",
      "--ref=x:state:/etc",
    ];
    const resolved = resolveModelRead({ request: { args: hidden, noun: "store", verb: "query" } });
    expect(unwrapErr(resolved)).toEqual(
      hidden.map(
        (_, index) => `argument ${String(index + 1)} looks like a filesystem path, and the voice never names one`,
      ),
    );
    const web = ["https://github.com/o/r/pull/1", "http://app.datadoghq.com/x", "--since=7d", "-n"];
    expect(unwrap(resolveModelRead({ request: { args: web, noun: "store", verb: "query" } }))).toEqual([
      "store",
      "query",
      ...web,
    ]);
  });

  it("refuses a model-written regex on the corpus probe", () => {
    const resolved = resolveModelRead({ request: { args: ["x", "--regex", ".*"], noun: "store", verb: "probe" } });
    expect(unwrapErr(resolved)[0]).toContain("--regex is refused");
  });

  it("holds a subverb noun to the subverbs it lists", () => {
    const allowed = resolveModelRead({ request: { args: ["read"], noun: "atlas", verb: "jumpcloud" } });
    expect(unwrap(allowed)).toEqual(["atlas", "jumpcloud", "read"]);
    const sync = resolveModelRead({ request: { args: ["sync"], noun: "atlas", verb: "jumpcloud" } });
    expect(unwrapErr(sync)).toEqual(["atlas jumpcloud takes read or coverage as its first argument here"]);
    const bare = resolveModelRead({ request: { args: [], noun: "atlas", verb: "jumpcloud" } });
    expect(unwrapErr(bare)).toEqual(["atlas jumpcloud takes read or coverage as its first argument here"]);
  });

  it("refuses an empty, oversized or control-character argument, naming its position", () => {
    const big = "x".repeat(MAX_VERB_ARG_BYTES + 1);
    const resolved = resolveModelRead({ request: { args: ["", big, "a\u0000b"], noun: "store", verb: "query" } });
    expect(unwrapErr(resolved)).toEqual([
      "argument 1 is empty",
      `argument 2 is over ${String(MAX_VERB_ARG_BYTES)} bytes`,
      "argument 3 carries a control character",
    ]);
  });

  it("refuses more arguments than the ceiling", () => {
    const args = Array.from({ length: MAX_VERB_ARGS + 1 }, () => "w");
    const resolved = resolveModelRead({ request: { args, noun: "store", verb: "query" } });
    expect(unwrapErr(resolved)).toEqual([
      `at most ${String(MAX_VERB_ARGS)} arguments, got ${String(MAX_VERB_ARGS + 1)}`,
    ]);
  });

  it("checks against the list it is handed", () => {
    const resolved = resolveModelRead({
      reads: [{ for: "a test read", noun: "fake", verb: "look" }],
      request: { args: [], noun: "github", verb: "read" },
    });
    expect(unwrapErr(resolved)[0]).toContain("github read is not a verb the voice may run");
  });
});
