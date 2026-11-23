import { describe, expect, it } from "vitest";
import type { LintCheck } from "../../../devLint/devLint.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { ProfileSubjectErrors } from "../../../perf/errors.js";
import {
  DEFAULT_TOP,
  PROFILE_LANES,
  parseInterval,
  parseTop,
  profileBase,
  profileEnv,
  profileRequest,
  resolveSubject,
  subjectFromFlags,
} from "../../../perf/subject.js";

const CHECKS: readonly LintCheck[] = [
  {
    args: ["--expose-gc", "--max-old-space-size=8192", "src/devLint/namedObjectParams.entry.ts"],
    cmd: "/repo/node_modules/.bin/tsx",
    name: "named-object-params",
  },
  { args: ["src/devLint/jsdocTags.entry.ts"], cmd: "/repo/node_modules/.bin/tsx", name: "jsdoc-tags" },
  { args: ["--deny-warnings", "."], cmd: "/repo/node_modules/.bin/oxlint", env: { GOMAXPROCS: "4" }, name: "oxlint" },
];

const BIN = "/repo/node_modules/.bin";
const BASE = "b".repeat(40);
const GATE = { kind: "gate", name: "host-wording" } as const;
const resolvedBase = () => ok({ baseSha: BASE });
const unresolvedBase = () => err({ detail: "refs/remotes/origin/main does not resolve" });

describe("profileBase", () => {
  it("keeps a full base the caller exported, never resolving another", () => {
    expect(unwrap(profileBase({ inherited: "C".repeat(40), resolve: unresolvedBase, subject: GATE }))).toEqual({
      env: {},
      line: `dev profile: base ${"c".repeat(40)}, from SLOPWEAVER_COVERAGE_BASE_SHA in the environment`,
    });
  });

  it("refuses a gate under a short exported base, which the gate would refuse rather than compare", () => {
    expect(unwrapErr(profileBase({ inherited: "abc1234", resolve: resolvedBase, subject: GATE }))).toBe(
      "dev profile: cannot profile gate:host-wording against the exported base — SLOPWEAVER_COVERAGE_BASE_SHA " +
        "is not a full 40-character commit SHA: abc1234 — expand it with `export SLOPWEAVER_COVERAGE_BASE_SHA=" +
        "$(git rev-parse abc1234)`; unset SLOPWEAVER_COVERAGE_BASE_SHA to have the merge-base handed over, or " +
        "export a full 40-character SHA",
    );
  });

  it("refuses a gate under an all-zeroes base, which skips the comparison", () => {
    expect(unwrapErr(profileBase({ inherited: "0".repeat(40), resolve: resolvedBase, subject: GATE }))).toContain(
      "all zeroes",
    );
  });

  it("lets a verb proceed under an unusable exported base, saying a diff gate inside it will refuse", () => {
    const verb = { argv: ["catalog"], kind: "verb" } as const;
    expect(unwrap(profileBase({ inherited: "", resolve: resolvedBase, subject: verb })).env).toEqual({});
  });

  it("hands an unset gate the merge-base, so a diff gate is measured comparing", () => {
    expect(unwrap(profileBase({ inherited: undefined, resolve: resolvedBase, subject: GATE }))).toEqual({
      env: { SLOPWEAVER_COVERAGE_BASE_SHA: BASE },
      line: `dev profile: base ${BASE} (merge-base of HEAD and origin/main), handed over as SLOPWEAVER_COVERAGE_BASE_SHA`,
    });
  });

  it("refuses a gate whose base cannot be resolved, naming the fix, rather than measuring its refusal", () => {
    expect(unwrapErr(profileBase({ inherited: undefined, resolve: unresolvedBase, subject: GATE }))).toBe(
      "dev profile: cannot hand gate:host-wording a base (refs/remotes/origin/main does not resolve), so a diff " +
        "gate would be measured refusing rather than comparing — run `git fetch origin main`, or put " +
        "`SLOPWEAVER_COVERAGE_BASE_SHA=$(git merge-base origin/main HEAD)` in front of the command",
    );
  });

  it("lets a lane proceed with no base, saying a diff gate inside it will refuse", () => {
    expect(
      unwrap(profileBase({ inherited: undefined, resolve: unresolvedBase, subject: { kind: "lane", name: "unit" } })),
    ).toEqual({
      env: {},
      line: "dev profile: no base resolved (refs/remotes/origin/main does not resolve), so a diff gate this lane runs refuses rather than compares",
    });
  });
});

describe("resolveSubject", () => {
  it("carries a gate row's own environment, as `dev lint` lays it over the caller's", () => {
    expect(unwrap(resolveSubject({ binDir: BIN, checks: CHECKS, subject: { kind: "gate", name: "oxlint" } }))).toEqual({
      args: ["--deny-warnings", "."],
      cmd: "/repo/node_modules/.bin/oxlint",
      env: { GOMAXPROCS: "4" },
      label: "gate:oxlint",
    });
  });

  it("takes a gate's command from the registry verbatim, flags included", () => {
    const plan = unwrap(
      resolveSubject({ binDir: BIN, checks: CHECKS, subject: { kind: "gate", name: "named-object-params" } }),
    );
    expect(plan).toEqual({
      args: ["--expose-gc", "--max-old-space-size=8192", "src/devLint/namedObjectParams.entry.ts"],
      cmd: "/repo/node_modules/.bin/tsx",
      label: "gate:named-object-params",
    });
  });

  it("names every known gate when the one asked for is not one", () => {
    const errors = unwrapErr(
      resolveSubject({ binDir: BIN, checks: CHECKS, subject: { kind: "gate", name: "no-such-gate" } }),
    );
    expect(errors).toEqual(
      ProfileSubjectErrors.unknownSubject({
        asked: "no-such-gate",
        kind: "gate",
        known: ["jsdoc-tags", "named-object-params", "oxlint"],
      }),
    );
    expect(errors.message).toBe("no gate named no-such-gate; known gates: jsdoc-tags, named-object-params, oxlint");
  });

  it("resolves a lane to its own vitest config", () => {
    const plan = unwrap(resolveSubject({ binDir: BIN, checks: CHECKS, subject: { kind: "lane", name: "unit" } }));
    expect(plan).toEqual({
      args: ["run", "--config", "config/vitest/unit.ts"],
      cmd: "/repo/node_modules/.bin/vitest",
      label: "lane:unit",
    });
  });

  it("names every known lane when the one asked for is not one", () => {
    const errors = unwrapErr(resolveSubject({ binDir: BIN, checks: CHECKS, subject: { kind: "lane", name: "e2e" } }));
    expect(errors).toEqual(ProfileSubjectErrors.unknownSubject({ asked: "e2e", kind: "lane", known: PROFILE_LANES }));
  });

  it("resolves a verb through the CLI entry, keeping its own flags in order", () => {
    const plan = unwrap(
      resolveSubject({ binDir: BIN, checks: CHECKS, subject: { argv: ["catalog", "trees"], kind: "verb" } }),
    );
    expect(plan).toEqual({
      args: ["src/cli/index.ts", "catalog", "trees"],
      cmd: "/repo/node_modules/.bin/tsx",
      label: "verb:catalog trees",
    });
  });

  it("refuses an empty verb argv rather than profiling the bare CLI", () => {
    const errors = unwrapErr(resolveSubject({ binDir: BIN, checks: CHECKS, subject: { argv: [], kind: "verb" } }));
    expect(errors).toEqual(ProfileSubjectErrors.emptyVerb());
  });

  it("declares the three lanes the repository actually has", () => {
    expect(PROFILE_LANES).toEqual(["unit", "subprocess", "integration"]);
  });
});

describe("profileEnv", () => {
  it("switches the phase report on and exposes gc with no profiler asked for", () => {
    expect(
      profileEnv({
        cpu: false,
        heapProfile: false,
        inherited: undefined,
        intervalMicros: undefined,
        profileDir: "/tmp/p",
      }),
    ).toEqual({
      NODE_OPTIONS: "--expose-gc",
      SLOPWEAVER_HEAP_PHASES: "1",
    });
  });

  it("adds both V8 profilers, each pointed at the throwaway directory", () => {
    expect(
      profileEnv({
        cpu: true,
        heapProfile: true,
        inherited: undefined,
        intervalMicros: undefined,
        profileDir: "/tmp/p",
      }),
    ).toEqual({
      NODE_OPTIONS: "--expose-gc --cpu-prof --cpu-prof-dir /tmp/p --heap-prof --heap-prof-dir /tmp/p",
      SLOPWEAVER_HEAP_PHASES: "1",
    });
  });

  it("keeps a ceiling the caller already had, so measuring a lane does not starve it", () => {
    const env = profileEnv({
      cpu: false,
      heapProfile: false,
      inherited: "--max-old-space-size=8192",
      intervalMicros: undefined,
      profileDir: "/tmp/p",
    });
    expect(env["NODE_OPTIONS"]).toBe("--max-old-space-size=8192 --expose-gc");
  });

  it("treats an empty inherited value as none rather than emitting a leading space", () => {
    const env = profileEnv({
      cpu: false,
      heapProfile: false,
      inherited: "",
      intervalMicros: undefined,
      profileDir: "/tmp/p",
    });
    expect(env["NODE_OPTIONS"]).toBe("--expose-gc");
  });
});

describe("profileEnv --interval", () => {
  it("passes the sampling interval to V8 when one was asked for", () => {
    const env = profileEnv({
      cpu: true,
      heapProfile: false,
      inherited: undefined,
      intervalMicros: 5000,
      profileDir: "/tmp/p",
    });
    expect(env["NODE_OPTIONS"]).toBe("--expose-gc --cpu-prof --cpu-prof-dir /tmp/p --cpu-prof-interval 5000");
  });

  it("leaves V8 on its own default when no interval was asked for", () => {
    const env = profileEnv({
      cpu: true,
      heapProfile: false,
      inherited: undefined,
      intervalMicros: undefined,
      profileDir: "/tmp/p",
    });
    expect(env["NODE_OPTIONS"]).toBe("--expose-gc --cpu-prof --cpu-prof-dir /tmp/p");
  });

  it("does not pass an interval when no CPU profile was asked for", () => {
    const env = profileEnv({
      cpu: false,
      heapProfile: true,
      inherited: undefined,
      intervalMicros: 5000,
      profileDir: "/tmp/p",
    });
    expect(env["NODE_OPTIONS"]).toBe("--expose-gc --heap-prof --heap-prof-dir /tmp/p");
  });
});

describe("subjectFromFlags", () => {
  it("reads a gate", () => {
    expect(unwrap(subjectFromFlags({ tail: [], values: { gate: "jsdoc-tags" } }))).toEqual({
      kind: "gate",
      name: "jsdoc-tags",
    });
  });

  it("reads a lane", () => {
    expect(unwrap(subjectFromFlags({ tail: [], values: { lane: "unit" } }))).toEqual({ kind: "lane", name: "unit" });
  });

  it("reads a verb and keeps its argv in order", () => {
    expect(unwrap(subjectFromFlags({ tail: ["catalog", "trees"], values: { verb: true } }))).toEqual({
      argv: ["catalog", "trees"],
      kind: "verb",
    });
  });

  it("refuses naming no subject at all", () => {
    expect(unwrapErr(subjectFromFlags({ tail: [], values: {} }))).toEqual(ProfileSubjectErrors.noSubject());
  });

  it("refuses two subjects rather than silently preferring one", () => {
    expect(unwrapErr(subjectFromFlags({ tail: [], values: { gate: "a", lane: "unit" } }))).toEqual(
      ProfileSubjectErrors.ambiguousSubject(),
    );
  });
});

describe("parseTop", () => {
  it("defaults when the flag is absent", () => {
    expect(unwrap(parseTop({ value: undefined }))).toBe(DEFAULT_TOP);
  });

  it("reads a positive integer", () => {
    expect(unwrap(parseTop({ value: "3" }))).toBe(3);
  });

  it("refuses zero", () => {
    expect(unwrapErr(parseTop({ value: "0" })).message).toBe("--top must be a positive integer, got 0");
  });

  it("refuses a non-number", () => {
    expect(unwrapErr(parseTop({ value: "lots" })).code).toBe("BAD_NUMERIC_FLAG");
  });

  it("refuses a fraction", () => {
    expect(unwrapErr(parseTop({ value: "2.5" }))).toEqual(
      ProfileSubjectErrors.badNumericFlag({ flag: "--top", must: "a positive integer", value: "2.5" }),
    );
  });
});

describe("parseInterval", () => {
  it("leaves V8 on its own default when the flag is absent", () => {
    expect(unwrap(parseInterval({ value: undefined }))).toBeUndefined();
  });

  it("reads a microsecond figure", () => {
    expect(unwrap(parseInterval({ value: "5000" }))).toBe(5000);
  });

  it("refuses an interval finer than the sampler can honour", () => {
    expect(unwrapErr(parseInterval({ value: "10" })).message).toBe(
      "--interval must be an integer of at least 100 microseconds, got 10",
    );
  });

  it("refuses a non-number", () => {
    expect(unwrapErr(parseInterval({ value: "fine" }))).toEqual(
      ProfileSubjectErrors.badNumericFlag({
        flag: "--interval",
        must: "an integer of at least 100 microseconds",
        value: "fine",
      }),
    );
  });
});

describe("profileRequest", () => {
  it("reads the subject, the top count and the interval together", () => {
    const request = unwrap(profileRequest({ tail: [], values: { gate: "jsdoc-tags", interval: "4000", top: "3" } }));

    expect(request).toEqual({ intervalMicros: 4000, subject: { kind: "gate", name: "jsdoc-tags" }, top: 3 });
  });

  it("defaults the two numeric flags when only a subject is named", () => {
    const request = unwrap(profileRequest({ tail: ["catalog"], values: { verb: true } }));

    expect(request).toEqual({
      intervalMicros: undefined,
      subject: { argv: ["catalog"], kind: "verb" },
      top: DEFAULT_TOP,
    });
  });

  it("refuses on the subject first, so one mistake prints one complaint", () => {
    expect(unwrapErr(profileRequest({ tail: [], values: { top: "0" } })).code).toBe("NO_SUBJECT");
  });

  it("reports a bad --top even when the subject is fine", () => {
    expect(unwrapErr(profileRequest({ tail: [], values: { gate: "x", top: "0" } })).message).toBe(
      "--top must be a positive integer, got 0",
    );
  });

  it("reports a bad --interval last, after the subject and --top both pass", () => {
    expect(unwrapErr(profileRequest({ tail: [], values: { gate: "x", interval: "1", top: "2" } })).message).toBe(
      "--interval must be an integer of at least 100 microseconds, got 1",
    );
  });
});
