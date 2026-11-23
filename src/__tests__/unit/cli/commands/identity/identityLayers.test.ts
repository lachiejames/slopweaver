/**
 * The `identity` verb family's LAYERING, asserted over the shipped source rather than described in prose.
 *
 * `src/cli/commands/identity/run.ts` held all four verbs in one 551-line file, so "`org-domains` has no
 * business reaching any person-emitting code" was a fact about which functions it happened to call — true
 * on the day it was written and unfalsifiable afterwards. Split, it is a property of the import graph, and
 * these cases are what make it stay one.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emitLookup } from "../../../../../cli/commands/identity/identityResolve.js";
import type { IdentityDeps } from "../../../../../cli/commands/identity/identityShared.js";
import { homeFor, strFlag, verbTail } from "../../../../../cli/commands/identity/identityShared.js";
import {
  identityAvatarsCommand,
  identityNarrowCommand,
  identityOrgDomainsCommand,
  identityResolveCommand,
  identityShowCommand,
  runIdentityAvatars,
  runIdentityNarrow,
  runIdentityOrgDomains,
  runIdentityResolve,
  runIdentityShow,
} from "../../../../../cli/commands/identity/run.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { MentionPerson } from "../../../../../silver/mentionResolver.js";
import { parseOwnJson } from "../../../../parseOwnJson.js";

/** The family, deepest LAST — the order every import edge in it must respect. */
const LADDER = [
  "identityShared.ts",
  "identityAvatars.ts",
  "identityOrgDomains.ts",
  "identityShow.ts",
  "identityResolve.ts",
  "identityNarrow.ts",
  "run.ts",
] as const;

/** Every name in the family that puts a person, a group or a roster on the caller's terminal. */
const EMITTERS = [
  "emitPerson",
  "emitLookup",
  "emitGroupIfNamed",
  "emitExactMiss",
  "emitNoExactMatch",
  "emitRosterBrief",
  "emitRosterAnswer",
  "emitVerifiedPick",
  "resolveFor",
] as const;

const sourceOf = ({ file }: { file: string }): string =>
  readFileSync(new URL(`../../../../../cli/commands/identity/${file}`, import.meta.url), "utf8");

/** The source with every comment line dropped — a module's overview may NAME what its body must not use. */
const bodyOf = ({ file }: { file: string }): string =>
  sourceOf({ file })
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/u.test(line))
    .join("\n");

/** Which family modules `file` imports, by bare name. */
const familyImportsOf = ({ file }: { file: string }): readonly string[] =>
  [...sourceOf({ file }).matchAll(/^import[^;]*? from "\.\/(\w+)\.js";$/gmu)]
    .map((m) => `${m[1]!}.ts`)
    .filter((name) => LADDER.includes(name as (typeof LADDER)[number]));

/** One colleague, enough to exercise every arm `emitLookup` branches on. */
const ADA: MentionPerson = {
  active: true,
  bot: false,
  displayName: "Ada Lovelace",
  identities: [],
  key: "ada@acme.com",
  orgStatus: "org",
};

/** Fake seams: every read throws, every written line is recorded. A test that reaches one says so. */
const recordingDeps = ({ lines }: { lines: string[] }): IdentityDeps => ({
  home: () => "/fake/home",
  loadCandidates: () => {
    throw new Error("loadCandidates is not reachable from this test");
  },
  loadDirectory: () => {
    throw new Error("loadDirectory is not reachable from this test");
  },
  loadGroups: () => {
    throw new Error("loadGroups is not reachable from this test");
  },
  loadMembers: () => {
    throw new Error("loadMembers is not reachable from this test");
  },
  loadRoster: () => {
    throw new Error("loadRoster is not reachable from this test");
  },
  logger: {
    error: ({ msg }) => lines.push(msg),
    out: ({ line }) => lines.push(line),
    warn: ({ msg }) => lines.push(msg),
  },
});

describe("the identity family's layering", () => {
  it("declares a ladder with every module on it", () => {
    expect(LADDER.length).toBe(7);
    expect([...LADDER]).toEqual([
      "identityShared.ts",
      "identityAvatars.ts",
      "identityOrgDomains.ts",
      "identityShow.ts",
      "identityResolve.ts",
      "identityNarrow.ts",
      "run.ts",
    ]);
  });

  it("only ever imports UP the ladder, so the family is a DAG rather than a cycle", () => {
    const backwards = LADDER.flatMap((file, depth) =>
      familyImportsOf({ file })
        .filter((target) => LADDER.indexOf(target as (typeof LADDER)[number]) >= depth)
        .map((target) => `${file} -> ${target}`),
    );
    expect(backwards).toEqual([]);
  });

  it("keeps avatars off every module that can emit a person, exactly as org-domains is", () => {
    expect(familyImportsOf({ file: "identityAvatars.ts" })).toEqual(["identityShared.ts"]);
    const reached = EMITTERS.filter((name) => bodyOf({ file: "identityAvatars.ts" }).includes(name));
    expect(reached).toEqual([]);
  });

  it("keeps org-domains off every module that can emit a person", () => {
    expect(familyImportsOf({ file: "identityOrgDomains.ts" })).toEqual(["identityShared.ts"]);
    const reached = EMITTERS.filter((name) => bodyOf({ file: "identityOrgDomains.ts" }).includes(name));
    expect(reached).toEqual([]);
  });

  it("keeps the shared vocabulary free of output, which is what makes the previous case hold", () => {
    expect(familyImportsOf({ file: "identityShared.ts" })).toEqual([]);
    const reached = EMITTERS.filter((name) => bodyOf({ file: "identityShared.ts" }).includes(name));
    expect(reached).toEqual([]);
  });

  it("names the emitters in the shared module's OVERVIEW while its body uses none of them", () => {
    expect(sourceOf({ file: "identityShared.ts" })).toContain("no import edge to any code that can emit a person");
    expect(bodyOf({ file: "identityShared.ts" })).not.toContain("emit a person");
  });

  it("reaches the show vocabulary from resolve, and the resolve vocabulary from narrow", () => {
    expect(familyImportsOf({ file: "identityResolve.ts" })).toEqual(["identityShared.ts", "identityShow.ts"]);
    expect(familyImportsOf({ file: "identityNarrow.ts" })).toEqual(["identityResolve.ts", "identityShared.ts"]);
  });
});

describe("the five commands the shell declares", () => {
  it("wires each command to its OWN runner, so a split cannot transpose two of them", () => {
    expect(identityShowCommand).toBe(runIdentityShow);
    expect(identityResolveCommand).toBe(runIdentityResolve);
    expect(identityNarrowCommand).toBe(runIdentityNarrow);
    expect(identityOrgDomainsCommand).toBe(runIdentityOrgDomains);
    expect(identityAvatarsCommand).toBe(runIdentityAvatars);
  });
});

describe("the helpers the split had to export", () => {
  it("reads a string flag and reports a value-less one as absent rather than as `true`", () => {
    expect(strFlag({ key: "home", values: { home: "/tmp/store" } })).toBe("/tmp/store");
    expect(strFlag({ key: "home", values: { home: true } })).toBe(undefined);
    expect(strFlag({ key: "home", values: {} })).toBe(undefined);
  });

  it("takes the named home when there is one and the process default when there is not", () => {
    const deps = recordingDeps({ lines: [] });
    expect(homeFor({ deps, values: { home: "/named" } })).toBe("/named");
    expect(homeFor({ deps, values: {} })).toBe("/fake/home");
    expect(homeFor({ deps, values: { home: true } })).toBe("/fake/home");
  });

  it("drops a leading verb word so bare `identity` and explicit `identity show` parse the same tail", () => {
    const argv = ["node", "slopweaver", "identity", "show", "@ada"];
    expect([...verbTail({ argv, verb: "show" })]).toEqual(["@ada"]);
    expect([...verbTail({ argv: ["node", "slopweaver", "identity", "@ada"], verb: "show" })]).toEqual(["@ada"]);
    expect([...verbTail({ argv: ["node", "slopweaver", "identity"], verb: "show" })]).toEqual([]);
  });

  it("emits an unknown lookup as a non-zero JSON refusal naming the token, with no lines the index cannot back", () => {
    const lines: string[] = [];
    const code = emitLookup({
      deps: recordingDeps({ lines }),
      json: true,
      lookup: { kind: "unknown" },
      raw: "nobody-here",
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.length).toBe(1);
    const doc = parseOwnJson<{ raw: string; reason: string; refusals: readonly string[] }>({ text: lines[0]! });
    expect(doc.raw).toBe("nobody-here");
    expect(doc.reason).toBe("unknown");
    expect([...doc.refusals]).toEqual([]);
  });

  it("carries the member index’s own refusal lines through, so the previous case’s empty list is a finding", () => {
    const lines: string[] = [];
    const code = emitLookup({
      deps: recordingDeps({ lines }),
      json: false,
      lookup: { kind: "ambiguous", matches: [{ person: ADA, tier: "email" }], tier: "email" },
      raw: "ada",
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toEqual([
      'cannot resolve "ada": 1 colleagues answer to it at the same strength, and picking one is not this layer\'s call:',
      "    Ada Lovelace — no slack account",
      "  address one of them by their id or handle, or pin the intended person in the identity roster (slopweaver identity roster replace).",
    ]);
  });

  it("reports a colleague with no account on this surface as an IDENTIFICATION, not as a refusal", () => {
    const lines: string[] = [];
    const code = emitLookup({
      deps: recordingDeps({ lines }),
      json: false,
      lookup: { kind: "no-account", match: { person: ADA, tier: "email" }, source: "slack" },
      raw: "ada",
    });
    expect(code).toBe(EXIT_OK);
    expect(lines).toEqual(["ada@acme.com  [email]  Ada Lovelace", "  matched-by: email, org-status: org"]);
  });
});
