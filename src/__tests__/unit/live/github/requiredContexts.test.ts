/**
 * The required-context gate — the one false green `statusCheckRollup` cannot report.
 *
 * Every case here is a plain value comparison over inline fixtures: the module is pure, so the fixture IS
 * the failure. The central one is `rollup SUCCESS with a required name absent`, which is the shape measured
 * on this repository's own `main` (it requires `build` and `integration`; a CONFLICTING pull request runs
 * neither while `CodeQL` still passes and carries the rollup).
 */
import { describe, expect, it } from "vitest";
import type { GithubCheck } from "../../../../live/github/checksDedupe.js";
import {
  absentRequiredContexts,
  type RequiredContextGate,
  requiredContextClause,
  requiredContextGate,
  requiredContextRefusal,
  withRequiredContextClause,
} from "../../../../live/github/requiredContexts.js";

/** One passing check run, named. */
function passed({ name }: { name: string }): GithubCheck {
  return { kind: "check-run", name, state: "passed", url: undefined };
}

/** The measured shape: `main` requires build + integration, and only CodeQL ever ran. */
const CONFLICTING_HEAD: readonly GithubCheck[] = [
  passed({ name: "CodeQL" }),
  passed({ name: "Analyze (actions)" }),
  passed({ name: "Analyze (javascript-typescript)" }),
];

const REQUIRED = ["build", "integration"] as const;

describe("absentRequiredContexts", () => {
  it("names every required context absent from the head, sorted", () => {
    expect(absentRequiredContexts({ checks: CONFLICTING_HEAD, required: REQUIRED })).toEqual(["build", "integration"]);
  });

  it("is empty when every required context is on the head, extra checks and all", () => {
    const checks = [...CONFLICTING_HEAD, passed({ name: "build" }), passed({ name: "integration" })];
    expect(absentRequiredContexts({ checks, required: REQUIRED })).toEqual([]);
  });

  it("counts a required context PRESENT but still running as present, never as missing", () => {
    const checks = [{ kind: "check-run" as const, name: "build", state: "running" as const, url: undefined }];
    expect(absentRequiredContexts({ checks, required: ["build"] })).toEqual([]);
  });

  it("counts a required context PRESENT and failing as present — the count already names it", () => {
    const checks = [{ kind: "check-run" as const, name: "build", state: "failed" as const, url: undefined }];
    expect(absentRequiredContexts({ checks, required: ["build"] })).toEqual([]);
  });

  it("matches a legacy commit status by the same name namespace GitHub's own setting uses", () => {
    const checks = [{ kind: "status" as const, name: "build", state: "passed" as const, url: undefined }];
    expect(absentRequiredContexts({ checks, required: ["build"] })).toEqual([]);
  });

  it("is empty when the base requires nothing at all", () => {
    expect(absentRequiredContexts({ checks: [], required: [] })).toEqual([]);
  });

  it("reports every required name when the head carries no checks whatsoever", () => {
    expect(absentRequiredContexts({ checks: [], required: REQUIRED })).toEqual(["build", "integration"]);
  });

  it("dedupes a required name listed twice", () => {
    expect(absentRequiredContexts({ checks: [], required: ["build", "build"] })).toEqual(["build"]);
  });
});

describe("requiredContextGate", () => {
  it("carries the branch, the required set and the missing names", () => {
    expect(
      requiredContextGate({
        branch: "main",
        checks: CONFLICTING_HEAD,
        mergeable: "CONFLICTING",
        required: REQUIRED,
        truncated: false,
      }),
    ).toEqual({
      branch: "main",
      kind: "read",
      mergeable: "CONFLICTING",
      missing: ["build", "integration"],
      required: ["build", "integration"],
      unproven: [],
    });
  });

  it("carries `undefined` mergeability through unchanged, so 'not measured' never becomes 'clean'", () => {
    const gate = requiredContextGate({
      branch: "main",
      checks: CONFLICTING_HEAD,
      mergeable: undefined,
      required: REQUIRED,
      truncated: false,
    });
    expect(gate).toEqual({
      branch: "main",
      kind: "read",
      mergeable: undefined,
      missing: ["build", "integration"],
      required: ["build", "integration"],
      unproven: [],
    });
  });
});

describe("requiredContextRefusal", () => {
  it("refuses a rollup-SUCCESS head by naming every required context that never ran", () => {
    const gate = requiredContextGate({
      branch: "main",
      checks: CONFLICTING_HEAD,
      mergeable: "CONFLICTING",
      required: REQUIRED,
      truncated: false,
    });
    const refusal = requiredContextRefusal({ gate });
    expect(refusal).toContain("main requires build, integration");
    expect(refusal).toContain("not on this head at all");
  });

  it("raises nothing when every required context is on the head", () => {
    const checks = [passed({ name: "build" }), passed({ name: "integration" })];
    const gate = requiredContextGate({
      branch: "main",
      checks,
      mergeable: "MERGEABLE",
      required: REQUIRED,
      truncated: false,
    });
    expect(requiredContextRefusal({ gate })).toBe(undefined);
  });

  it("raises nothing when the required set could not be read — that is a note, not a verdict", () => {
    expect(requiredContextRefusal({ gate: { kind: "unreadable", reason: "403" } })).toBe(undefined);
  });

  it("says 'it is' for one missing context and 'they are' for two", () => {
    const one = requiredContextGate({
      branch: "main",
      checks: [],
      mergeable: "CONFLICTING",
      required: ["build"],
      truncated: false,
    });
    const two = requiredContextGate({
      branch: "main",
      checks: [],
      mergeable: "CONFLICTING",
      required: REQUIRED,
      truncated: false,
    });
    expect(requiredContextRefusal({ gate: one })).toContain("it is not on this head");
    expect(requiredContextRefusal({ gate: two })).toContain("they are not on this head");
  });
});

/**
 * The half that closes the finding: the refusal names the CAUSE from what the read measured.
 *
 * Each case asserts BOTH what is said and what is no longer said, because the defect was not a missing
 * sentence — it was a reader picking the wrong member of a three-item list and applying the wrong remedy.
 * A refusal that added the right cause while keeping the list would reproduce it exactly.
 */
describe("requiredContextRefusal names the cause from the measurement", () => {
  /** One gate over the measured shape, at a given mergeability. */
  function gateAt({ mergeable }: { mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | undefined }): string {
    const gate = requiredContextGate({
      branch: "main",
      checks: CONFLICTING_HEAD,
      mergeable,
      required: REQUIRED,
      truncated: false,
    });
    return requiredContextRefusal({ gate })!;
  }

  it("says CONFLICTING is the cause, and that re-triggering cannot fix it", () => {
    const refusal = gateAt({ mergeable: "CONFLICTING" });
    expect(refusal).toContain("GitHub reports this pull request CONFLICTING");
    expect(refusal).toContain("creates NO run for any `pull_request`-triggered workflow at all");
    expect(refusal).toContain("Re-triggering cannot fix this: rebase onto the base's CURRENT tip and force-push");
  });

  it("warns that a local rebase proves nothing against a stale fetch — the exact wrong turn a session took", () => {
    expect(gateAt({ mergeable: "CONFLICTING" })).toContain("fetched after the last landing");
  });

  it("rules a conflict OUT by measurement when GitHub says MERGEABLE, and names the other causes instead", () => {
    const refusal = gateAt({ mergeable: "MERGEABLE" });
    expect(refusal).toContain("GitHub reports this pull request MERGEABLE");
    expect(refusal).toContain("a paths filter");
    expect(refusal).toContain("A rebase is not the remedy here");
  });

  it("tells a reader to re-read rather than conclude, when GitHub has not computed mergeability", () => {
    const refusal = gateAt({ mergeable: "UNKNOWN" });
    expect(refusal).toContain("has not finished computing this pull request's mergeability");
    expect(refusal).toContain("re-read before concluding anything about the cause");
  });

  it("says the cause is NOT established when nothing measured it, rather than implying one", () => {
    const refusal = gateAt({ mergeable: undefined });
    expect(refusal).toContain("this read did not measure mergeability");
    expect(refusal).toContain("the cause is NOT established here");
  });

  it("keeps the candidate list ONLY in the unmeasured case — a measured refusal never offers a choice", () => {
    expect(gateAt({ mergeable: undefined })).toContain("look identical from the rollup alone");
    expect(gateAt({ mergeable: "CONFLICTING" })).not.toContain("look identical from the rollup alone");
    expect(gateAt({ mergeable: "MERGEABLE" })).not.toContain("look identical from the rollup alone");
    expect(gateAt({ mergeable: "UNKNOWN" })).not.toContain("look identical from the rollup alone");
  });

  it("names a rebase as the remedy for a conflict and refuses it for a clean one — opposite advice", () => {
    expect(gateAt({ mergeable: "CONFLICTING" })).toContain("rebase onto the base's CURRENT tip");
    expect(gateAt({ mergeable: "MERGEABLE" })).toContain("A rebase is not the remedy here");
  });

  it("still opens with the missing names whatever the cause, so the clause and the refusal agree", () => {
    expect(gateAt({ mergeable: "CONFLICTING" })).toContain("main requires build, integration");
    expect(gateAt({ mergeable: "MERGEABLE" })).toContain("main requires build, integration");
    expect(gateAt({ mergeable: "UNKNOWN" })).toContain("main requires build, integration");
    expect(gateAt({ mergeable: undefined })).toContain("main requires build, integration");
  });
});

describe("requiredContextClause", () => {
  it("names the count when every required context is present", () => {
    const checks = [passed({ name: "build" }), passed({ name: "integration" })];
    const gate = requiredContextGate({
      branch: "main",
      checks,
      mergeable: "MERGEABLE",
      required: REQUIRED,
      truncated: false,
    });
    expect(requiredContextClause({ gate })).toBe("2/2 required present");
  });

  it("shouts the missing names, singular", () => {
    const gate = requiredContextGate({
      branch: "main",
      checks: [passed({ name: "build" })],
      mergeable: "CONFLICTING",
      required: REQUIRED,
      truncated: false,
    });
    expect(requiredContextClause({ gate })).toBe("1 REQUIRED CONTEXT NEVER RAN: integration");
  });

  it("shouts the missing names, plural", () => {
    const gate = requiredContextGate({
      branch: "main",
      checks: CONFLICTING_HEAD,
      mergeable: "CONFLICTING",
      required: REQUIRED,
      truncated: false,
    });
    expect(requiredContextClause({ gate })).toBe("2 REQUIRED CONTEXTS NEVER RAN: build, integration");
  });

  it("says so explicitly when the base requires nothing, rather than reading as satisfied", () => {
    const gate = requiredContextGate({
      branch: "main",
      checks: [],
      mergeable: "MERGEABLE",
      required: [],
      truncated: false,
    });
    expect(requiredContextClause({ gate })).toBe("main requires no status-check contexts");
  });

  it("says the gate was never read when the read failed", () => {
    const gate: RequiredContextGate = { kind: "unreadable", reason: "github graphql failed" };
    expect(requiredContextClause({ gate })).toBe(
      "required contexts UNREAD (github graphql failed) — a required gate that never ran cannot be ruled out here",
    );
  });
});

describe("withRequiredContextClause", () => {
  it("appends the clause to a status line", () => {
    const gate = requiredContextGate({
      branch: "main",
      checks: CONFLICTING_HEAD,
      mergeable: "CONFLICTING",
      required: REQUIRED,
      truncated: false,
    });
    expect(withRequiredContextClause({ gate, line: "3/3 checks passed (rollup SUCCESS)" })).toBe(
      "3/3 checks passed (rollup SUCCESS), 2 REQUIRED CONTEXTS NEVER RAN: build, integration",
    );
  });

  it("appends the UNREAD clause, so a run that never looked cannot read as satisfied", () => {
    const gate: RequiredContextGate = { kind: "unreadable", reason: "403" };
    expect(withRequiredContextClause({ gate, line: "3/3 checks passed (rollup SUCCESS)" })).toBe(
      "3/3 checks passed (rollup SUCCESS), required contexts UNREAD (403) — a required gate that never ran " +
        "cannot be ruled out here",
    );
  });
});

/**
 * The half that closes the finding: absence from a TRUNCATED page is not absence from the head.
 *
 * The fixture is the measured one. an `acme/acme-admin` head carries 93 contexts and the default
 * read asked for 50, so `Required CI` — which had run and PASSED — was absent from the page, and the gate
 * called it a context that never ran and named three causes, none of which existed. Every case here asserts
 * both what a truncated read now says and what it must no longer say, because the defect was a confident
 * wrong answer rather than a missing one: a softer refusal that still named a cause would reproduce it.
 */
describe("a truncated read never reports a context as never having run", () => {
  /** The measured shape: the required name is off the end of the page this read asked for. */
  const SEEN: readonly GithubCheck[] = [passed({ name: "CodeQL" }), passed({ name: "Post PR comments" })];

  /** One gate over that shape, at a given truncation. */
  function gateOn({ truncated }: { truncated: boolean }): RequiredContextGate {
    return requiredContextGate({
      branch: "staging",
      checks: SEEN,
      mergeable: "MERGEABLE",
      required: ["Required CI"],
      truncated,
    });
  }

  it("puts an absent name in `unproven` and leaves `missing` empty when the page was truncated", () => {
    expect(gateOn({ truncated: true })).toEqual({
      branch: "staging",
      kind: "read",
      mergeable: "MERGEABLE",
      missing: [],
      required: ["Required CI"],
      unproven: ["Required CI"],
    });
  });

  it("puts the same name in `missing` and leaves `unproven` empty when the read saw the whole head", () => {
    expect(gateOn({ truncated: false })).toEqual({
      branch: "staging",
      kind: "read",
      mergeable: "MERGEABLE",
      missing: ["Required CI"],
      required: ["Required CI"],
      unproven: [],
    });
  });

  it("never populates both, because the same absent set goes to one field or the other", () => {
    for (const truncated of [true, false]) {
      const gate = gateOn({ truncated });
      expect(gate.kind === "read" && gate.missing.length > 0 && gate.unproven.length > 0).toBe(false);
    }
  });

  it("leaves both empty when the required name IS on the truncated page — truncation alone is not doubt", () => {
    const gate = requiredContextGate({
      branch: "staging",
      checks: [...SEEN, passed({ name: "Required CI" })],
      mergeable: "MERGEABLE",
      required: ["Required CI"],
      truncated: true,
    });
    expect(gate).toEqual({
      branch: "staging",
      kind: "read",
      mergeable: "MERGEABLE",
      missing: [],
      required: ["Required CI"],
      unproven: [],
    });
  });

  it("says UNPROVEN in the clause, never NEVER RAN", () => {
    const clause = requiredContextClause({ gate: gateOn({ truncated: true }) });
    expect(clause).toBe("1 REQUIRED CONTEXT UNPROVEN: Required CI");
    expect(clause).not.toContain("NEVER RAN");
  });

  it("does not read as satisfied either — an unseen gate is not a passing one", () => {
    expect(requiredContextClause({ gate: gateOn({ truncated: true }) })).not.toContain("required present");
  });

  it("names the re-read as the remedy and refuses to name a cause at all", () => {
    const refusal = requiredContextRefusal({ gate: gateOn({ truncated: true }) })!;
    expect(refusal).toContain("more contexts than the requested `--limit` returned");
    expect(refusal).toContain("Absence here is NOT a measurement");
    expect(refusal).toContain("re-read with a larger `--limit`");
  });

  it("withholds every cause the MERGEABLE branch would otherwise have offered — the exact wrong turn", () => {
    const refusal = requiredContextRefusal({ gate: gateOn({ truncated: true }) })!;
    expect(refusal).not.toContain("A rebase is not the remedy here");
    expect(refusal).toContain("Do not go looking for a paths filter");
    expect(refusal).not.toContain("not on this head at all");
  });

  it("still names the cause on an untruncated read, so this change costs the measured refusal nothing", () => {
    const refusal = requiredContextRefusal({ gate: gateOn({ truncated: false }) })!;
    expect(refusal).toContain("not on this head at all");
    expect(refusal).toContain("GitHub reports this pull request MERGEABLE");
  });
});
