/**
 * Which observations of one JumpCloud kind's walk become which gap — `src/atlas/jumpcloud/gaps.ts`.
 *
 * The judgement is the module: an empty family is not a covered one, a short page is an unstable order, and a
 * planned-but-unrun operation carries the condition naming what would let it run.
 */
import { describe, expect, it } from "vitest";

import { jumpcloudGapSchema } from "../../../../atlas/jumpcloud/entities.js";
import { type JumpcloudReadError, JumpcloudReadErrors } from "../../../../atlas/jumpcloud/errors.js";
import { jumpcloudKindGaps } from "../../../../atlas/jumpcloud/gaps.js";
import { JUMPCLOUD_SURFACES } from "../../../../atlas/jumpcloud/generated/surfaces.js";
import type { JumpcloudGapCondition } from "../../../../atlas/jumpcloud/model.js";
import type { JumpcloudKindPlan, JumpcloudUnrunnableReason } from "../../../../atlas/jumpcloud/plan.js";
import { stableGapId } from "../../../../atlas/kit/identity.js";

/**
 * The walk the function under test takes, derived from its signature rather than imported from the sync engine:
 * a type-only import would count that module as test-reached while nothing here exercises it.
 */
type JumpcloudKindWalk = Parameters<typeof jumpcloudKindGaps>[0]["walk"];

const AT = "2026-09-30T01:00:00.000Z";
const SURFACE = "v2-gcep-device-state";

/**
 * One kind's walk, defaulted to a walk that read nothing, emptied nothing and failed nowhere.
 *
 * @param failures the typed failures the walk recorded
 * @param emptyOperations operations that answered with no records
 * @param incompleteOperations operations that stopped short of the provider's declared total
 * @returns the walk
 */
function walk({
  failures = [],
  emptyOperations = [],
  incompleteOperations = [],
}: {
  failures?: readonly JumpcloudReadError[];
  emptyOperations?: readonly string[];
  incompleteOperations?: readonly string[];
}): JumpcloudKindWalk {
  return {
    clearableIncomplete: [],
    declaredTotal: null,
    emptyOperations,
    entities: [],
    failures: failures.map((error) => ({ error, surface: error.surface })),
    firstAt: null,
    incompleteOperations,
    journalledDrops: [],
    kind: "gcep",
    lastAt: null,
    pagesExhausted: true,
    projections: [],
    providerIds: [],
    providerIdsBySurface: {},
    resumed: 0,
  };
}

/** A real admitted row, so an unrunnable operation's scope is a name the registry actually carries. */
const ROW = JUMPCLOUD_SURFACES[0]!;

/**
 * One kind's plan, defaulted to a plan that runs nothing and refuses nothing.
 *
 * @param unrunnable reasons for operations the plan will not run, each against {@link ROW}
 * @returns the plan
 */
function plan({ unrunnable = [] }: { unrunnable?: readonly JumpcloudUnrunnableReason[] }): JumpcloudKindPlan {
  return {
    excluded: [],
    fanouts: [],
    kind: "gcep",
    roots: [],
    unrunnable: unrunnable.map((reason) => ({
      detail: `not run: ${reason}`,
      operation: { kind: "gcep", parameters: [], row: ROW },
      reason,
    })),
  };
}

describe("jumpcloudKindGaps", () => {
  it("raises nothing for a walk that read everything it planned", () => {
    expect(jumpcloudKindGaps({ at: AT, plan: plan({}), walk: walk({}) })).toEqual([]);
  });

  it("calls an empty family reachable-but-empty rather than covered, as an open gap the stored schema admits", () => {
    const gaps = jumpcloudKindGaps({ at: AT, plan: plan({}), walk: walk({ emptyOperations: [SURFACE] }) });

    expect(gaps.length).toBe(1);
    expect(gaps[0]!.condition).toBe("reachable-but-empty");
    expect(gaps[0]!.scope).toBe(SURFACE);
    expect(gaps[0]!.kind).toBe("gcep");
    expect(gaps[0]!.surfaces).toEqual(["directory-api"]);
    expect(gaps[0]!.status).toBe("open");
    expect(gaps[0]!.id).toBe(stableGapId({ condition: "reachable-but-empty", scope: SURFACE }));
    expect(gaps[0]!.reason).toContain("derived from zero observations");
    expect(jumpcloudGapSchema.parse(gaps[0]!)).toEqual(gaps[0]!);
  });

  it("calls a family that stopped short of its declared total an unstable page order", () => {
    const gaps = jumpcloudKindGaps({ at: AT, plan: plan({}), walk: walk({ incompleteOperations: [SURFACE] }) });

    expect(gaps.map((gap) => [gap.condition, gap.scope])).toEqual([["unstable-page-order", SURFACE]]);
  });

  const FAILURES: readonly {
    readonly code: JumpcloudReadError["code"];
    readonly error: JumpcloudReadError;
    readonly condition: JumpcloudGapCondition;
  }[] = [
    {
      code: "PATH_UNBOUND",
      condition: "path-unbound",
      error: JumpcloudReadErrors.pathUnbound({ parameters: ["system_id"], surface: SURFACE }),
    },
    {
      code: "CREDENTIAL_REJECTED",
      condition: "auth-refused",
      error: JumpcloudReadErrors.credentialRejected({ status: 401, surface: SURFACE }),
    },
    {
      code: "PERMISSION_REFUSED",
      condition: "auth-refused",
      error: JumpcloudReadErrors.permissionRefused({ status: 403, surface: SURFACE }),
    },
    {
      code: "REDIRECT_REFUSED",
      condition: "redirect-refused",
      error: JumpcloudReadErrors.redirectRefused({ status: 302, surface: SURFACE }),
    },
    {
      code: "OPERATION_UNUSABLE",
      condition: "request-contract-unknown",
      error: JumpcloudReadErrors.operationUnusable({ detail: "HTTP 400", surface: SURFACE }),
    },
    {
      code: "UNEXPECTED_SHAPE",
      condition: "schema-drift",
      error: JumpcloudReadErrors.unexpectedShape({ detail: "not an array", surface: SURFACE }),
    },
    {
      code: "BODY_SHAPE_CHANGED",
      condition: "schema-drift",
      error: JumpcloudReadErrors.bodyShapeChanged({
        drift: [{ detail: 'new field "[0].id"', kind: "new", path: "[0].id" }],
        surface: SURFACE,
      }),
    },
    {
      code: "TRANSPORT_FAILED",
      condition: "incomplete-read",
      error: JumpcloudReadErrors.transportFailed({ cause: new Error("socket hang up"), surface: SURFACE }),
    },
  ];

  // Three codes are deliberately unpinned, because the source disagrees with itself about each and a test would
  // freeze one side of an open question. A 404 and a 501 fall through to `incomplete-read`, while their own
  // factories in `errors.ts` call each "an answer … not a failed read" and `coverage.ts` grades them as answers.
  // A refused surface maps to `schema-drift`, while `coverage.ts` grades it `invalid-configuration` — "a defect
  // in this repository rather than a provider condition".
  const UNPINNED_CODES: readonly JumpcloudReadError["code"][] = ["NOT_IMPLEMENTED", "ROUTE_ABSENT", "SURFACE_REFUSED"];

  /** Typed as a full record over the union, so a new failure code fails to compile until it is added here. */
  const EVERY_CODE: Readonly<Record<JumpcloudReadError["code"], true>> = {
    BODY_SHAPE_CHANGED: true,
    CREDENTIAL_REJECTED: true,
    NOT_IMPLEMENTED: true,
    OPERATION_UNUSABLE: true,
    PATH_UNBOUND: true,
    PERMISSION_REFUSED: true,
    REDIRECT_REFUSED: true,
    ROUTE_ABSENT: true,
    SURFACE_REFUSED: true,
    TRANSPORT_FAILED: true,
    UNEXPECTED_SHAPE: true,
  };

  it("names every read-failure code the union declares, pinned or deliberately not, each built by its own factory", () => {
    expect(FAILURES.length).toBeGreaterThan(0);
    expect(FAILURES.map((entry) => entry.error.code)).toEqual(FAILURES.map((entry) => entry.code));
    expect([...FAILURES.map((entry) => entry.code), ...UNPINNED_CODES].toSorted()).toEqual(
      Object.keys(EVERY_CODE).toSorted(),
    );
  });

  it.each(FAILURES)(
    "records a $code failure as $condition, carrying the failure's own message",
    ({ error, condition }) => {
      const gaps = jumpcloudKindGaps({ at: AT, plan: plan({}), walk: walk({ failures: [error] }) });

      expect(gaps.length).toBe(1);
      expect(gaps[0]!.condition).toBe(condition);
      expect(gaps[0]!.scope).toBe(SURFACE);
      expect(gaps[0]!.reason).toBe(error.message);
    },
  );

  const UNRUNNABLE: readonly {
    readonly reason: JumpcloudUnrunnableReason;
    readonly condition: JumpcloudGapCondition;
  }[] = [
    { condition: "path-unbound", reason: "nested-parameter" },
    { condition: "request-contract-unknown", reason: "query-unbindable" },
    { condition: "schema-drift", reason: "schema-unprojectable" },
  ];

  // Two reasons are deliberately unpinned, because the source disagrees with itself about each. `shape-indexed`
  // maps to schema-drift, while plan.ts calls it a settled decision rather than a gap. `request-body-unpinned`
  // maps to schema-drift too, while plan.ts says "pin its body contract and it runs" — a request contract,
  // which gaps.ts's own doc files under `request-contract-unknown`, "rather than a claim about the schema".
  const UNPINNED_REASONS: readonly JumpcloudUnrunnableReason[] = ["request-body-unpinned", "shape-indexed"];

  /** Typed as a full record over the union, so a new unrunnable reason fails to compile until it is added here. */
  const EVERY_REASON: Readonly<Record<JumpcloudUnrunnableReason, true>> = {
    "nested-parameter": true,
    "query-unbindable": true,
    "request-body-unpinned": true,
    "schema-unprojectable": true,
    "shape-indexed": true,
  };

  it("names every unrunnable reason the union declares, pinned or deliberately not", () => {
    expect([...UNRUNNABLE.map((entry) => entry.reason), ...UNPINNED_REASONS].toSorted()).toEqual(
      Object.keys(EVERY_REASON).toSorted(),
    );
  });

  it.each(UNRUNNABLE)(
    "records an operation unrun for $reason as $condition, scoped to its row",
    ({ reason, condition }) => {
      const gaps = jumpcloudKindGaps({ at: AT, plan: plan({ unrunnable: [reason] }), walk: walk({}) });

      expect(gaps.length).toBe(1);
      expect(gaps[0]!.condition).toBe(condition);
      expect(gaps[0]!.scope).toBe(ROW.name);
      expect(gaps[0]!.reason).toBe(`not run: ${reason}`);
    },
  );

  it("returns every gap the walk and the plan earned, sorted by id", () => {
    const gaps = jumpcloudKindGaps({
      at: AT,
      plan: plan({ unrunnable: ["nested-parameter"] }),
      walk: walk({
        emptyOperations: ["v2-empty"],
        failures: [JumpcloudReadErrors.permissionRefused({ status: 403, surface: "v2-refused" })],
        incompleteOperations: ["v2-short"],
      }),
    });
    const ids = gaps.map((gap) => gap.id);

    expect(gaps.length).toBe(4);
    expect(ids).toEqual(ids.toSorted((left, right) => left.localeCompare(right)));
  });
});
