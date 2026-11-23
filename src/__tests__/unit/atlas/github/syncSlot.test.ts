/*
 * A kind's per-run accumulator: what a failed call folds into it, graded against the call's own declared
 * refusals, and what the compiled `rest-openapi` surface seeds into it with no network call.
 */
import { describe, expect, it } from "vitest";

import { GithubAtlasErrors } from "../../../../atlas/github/errors.js";
import { GITHUB_CALLS } from "../../../../atlas/github/inventory.js";
import { foldFailure, type KindSlot, seedCompiledOperations } from "../../../../atlas/github/syncSlot.js";
import { ENTITIES } from "./readAdapter/entities.js";

const AT = "2026-11-06T00:00:00.000Z";

/** A fresh accumulator, as the first call for a kind opens it. */
function emptySlot(): KindSlot {
  return { cells: [], entities: [], everyReadSucceeded: true, gaps: [] };
}

describe("foldFailure", () => {
  it("keeps an expected 404 at its natural grade and opens no gap", () => {
    const call = GITHUB_CALLS.find((entry) => entry.id === "org-code-security-configurations")!;
    const route = "/orgs/acme/code-security/configurations";
    const error = GithubAtlasErrors.routeAbsent({ route });
    const slot = emptySlot();
    const failure = foldFailure({
      at: AT,
      error,
      outcome: { call, error, outcome: null, route, scopeRef: "acme" },
      scope: "acme/code-security-configuration/org-code-security-configurations",
      slot,
    });
    expect(failure.expected).toBe(true);
    expect(failure.code).toBe("ROUTE_ABSENT");
    expect(failure.kind).toBe("code-security-configuration");
    expect(failure.route).toBe(route);
    expect(slot.everyReadSucceeded).toBe(false);
    expect(slot.cells.map((cell) => cell.state)).toEqual(["unavailable"]);
    expect(slot.gaps).toEqual([]);
  });

  it("forces an unexpected 404 to `unreadable` and opens a gap for it", () => {
    const call = GITHUB_CALLS.find((entry) => entry.id === "org-webhooks")!;
    const route = "/orgs/acme/hooks";
    const error = GithubAtlasErrors.routeAbsent({ route });
    const slot = emptySlot();
    const failure = foldFailure({
      at: AT,
      error,
      outcome: { call, error, outcome: null, route, scopeRef: "acme" },
      scope: "acme/webhook/org-webhooks",
      slot,
    });
    expect(failure.expected).toBe(false);
    expect(failure.kind).toBe("webhook");
    expect(slot.everyReadSucceeded).toBe(false);
    expect(slot.cells.map((cell) => cell.state)).toEqual(["unreadable"]);
    expect(slot.gaps.map((gap) => gap.kind)).toEqual(["webhook"]);
    expect(slot.gaps.map((gap) => gap.reason)).toEqual([error.message]);
  });
});

describe("seedCompiledOperations", () => {
  it("appends the compiled operations under one synced rest-openapi cell", () => {
    const slot = emptySlot();
    seedCompiledOperations({ at: AT, restOperations: [ENTITIES["rest-operation"]], slot });
    expect(slot.entities).toEqual([ENTITIES["rest-operation"]]);
    expect(slot.everyReadSucceeded).toBe(true);
    expect(slot.gaps).toEqual([]);
    expect(slot.cells.length).toBe(1);
    const cell = slot.cells[0]!;
    expect(cell.surface).toBe("rest-openapi");
    expect(cell.state).toBe("synced");
    expect(cell.scope).toBe("github/rest-operation");
    expect(cell.reason).toBe(
      "1 operation(s) read from GitHub's own published OpenAPI description, with no network call",
    );
  });
});
