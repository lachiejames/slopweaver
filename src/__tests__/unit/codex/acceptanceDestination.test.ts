/**
 * {@link acceptanceCodexDestination} — the paid Codex acceptance run spends a REGISTERED, unpaused, uncapped plan,
 * never an unregistered ambient login, and refuses rather than guessing when the register does not settle which one.
 * Every snapshot is the real decoder's output over a register document, so a row reads exactly as a stored one does.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parsePlanRegister } from "../../../plans/register.js";
import type { PlanRegisterSnapshot } from "../../../plans/types.js";
import { acceptanceCodexDestination } from "../../codexAcceptanceDestination.js";
import { AcceptancePlanErrors } from "../../codexAcceptanceDestinationErrors.js";

const PAUSE = { reason: "held for a billing decision", sinceIso: "2026-10-01T00:00:00.000Z" };

/** The snapshot the real decoder makes of a register document holding `rows`. */
function registerOf({ rows }: { rows: readonly Record<string, unknown>[] }): PlanRegisterSnapshot {
  return unwrap(parsePlanRegister({ value: { rows, version: 1 } }));
}

describe("acceptanceCodexDestination", () => {
  it("spends the named Codex row's own CODEX_HOME", () => {
    const register = registerOf({
      rows: [
        { alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" },
        { alias: "codex-two", provider: "codex", storeDir: "/stores/codex-two" },
      ],
    });

    const picked = acceptanceCodexDestination({ register, requestedAlias: "codex-two" });

    expect(picked.isOk()).toBe(true);
    expect(unwrap(picked)).toEqual({ alias: "codex-two", codexHome: "/stores/codex-two" });
  });

  it("spends the sole unpaused Codex row when none is named, skipping Claude and paused rows", () => {
    const register = registerOf({
      rows: [
        { alias: "claude-one", provider: "claude", storeDir: "/stores/claude-one" },
        { alias: "codex-held", paused: PAUSE, provider: "codex", storeDir: "/stores/codex-held" },
        { alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" },
      ],
    });

    expect(unwrap(acceptanceCodexDestination({ register, requestedAlias: undefined }))).toEqual({
      alias: "codex-one",
      codexHome: "/stores/codex-one",
    });
  });

  it("spends a row the operator REGISTERED on the ambient directory, as a production pass would", () => {
    const register = registerOf({
      rows: [{ alias: "codex-ambient", provider: "codex", storeDir: "/Users/operator/.codex" }],
    });

    expect(unwrap(acceptanceCodexDestination({ register, requestedAlias: undefined }))).toEqual({
      alias: "codex-ambient",
      codexHome: "/Users/operator/.codex",
    });
  });

  it("refuses an install with no stored register rather than spending the derived ambient row", () => {
    expect(unwrapErr(acceptanceCodexDestination({ register: undefined, requestedAlias: undefined }))).toEqual(
      AcceptancePlanErrors.notAdopted(),
    );
  });

  it("refuses a named Claude alias, naming every registered Codex alias, paused included", () => {
    const register = registerOf({
      rows: [
        { alias: "shared", provider: "claude", storeDir: "/stores/claude-shared" },
        { alias: "codex-held", paused: PAUSE, provider: "codex", storeDir: "/stores/codex-held" },
        { alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" },
      ],
    });

    expect(unwrapErr(acceptanceCodexDestination({ register, requestedAlias: "shared" }))).toEqual(
      AcceptancePlanErrors.notRegistered({ alias: "shared", registeredAliases: ["codex-held", "codex-one"] }),
    );
  });

  it("refuses an EMPTY named alias as unregistered, never as no alias at all", () => {
    const register = registerOf({ rows: [{ alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" }] });

    expect(unwrapErr(acceptanceCodexDestination({ register, requestedAlias: "" })).code).toBe("PLAN_NOT_REGISTERED");
  });

  it("refuses a named PAUSED plan, carrying its recorded reason and instant", () => {
    const register = registerOf({
      rows: [{ alias: "codex-held", paused: PAUSE, provider: "codex", storeDir: "/stores/codex-held" }],
    });

    expect(unwrapErr(acceptanceCodexDestination({ register, requestedAlias: "codex-held" }))).toEqual(
      AcceptancePlanErrors.paused({ alias: "codex-held", ...PAUSE }),
    );
  });

  it("refuses a weekly plan whose usage limit is below its whole allowance", () => {
    const register = registerOf({
      rows: [{ alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one", usageLimitPercent: 90 }],
    });

    expect(unwrapErr(acceptanceCodexDestination({ register, requestedAlias: "codex-one" }))).toEqual(
      AcceptancePlanErrors.usageLimited({ alias: "codex-one" }),
    );
  });

  it("refuses a monthly-spend plan, even the sole one and unnamed", () => {
    const register = registerOf({
      rows: [
        { alias: "codex-api", allowance: { kind: "monthly-spend" }, provider: "codex", storeDir: "/stores/codex-api" },
      ],
    });

    expect(unwrapErr(acceptanceCodexDestination({ register, requestedAlias: undefined }))).toEqual(
      AcceptancePlanErrors.usageLimited({ alias: "codex-api" }),
    );
  });

  it("refuses a relative store directory, which the door and the spawn would resolve apart", () => {
    const register = registerOf({ rows: [{ alias: "codex-one", provider: "codex", storeDir: "." }] });

    expect(unwrapErr(acceptanceCodexDestination({ register, requestedAlias: undefined }))).toEqual(
      AcceptancePlanErrors.homeRelative({ alias: "codex-one", storeDir: "." }),
    );
  });

  it("refuses when no alias is named and every Codex row is paused", () => {
    const register = registerOf({
      rows: [{ alias: "codex-held", paused: PAUSE, provider: "codex", storeDir: "/stores/codex-held" }],
    });

    expect(unwrapErr(acceptanceCodexDestination({ register, requestedAlias: undefined }))).toEqual(
      AcceptancePlanErrors.noCodexPlan({ registeredAliases: ["codex-held"] }),
    );
  });

  it("refuses a register holding only Claude rows, naming the empty Codex list", () => {
    const register = registerOf({
      rows: [{ alias: "claude-one", provider: "claude", storeDir: "/stores/claude-one" }],
    });

    const refused = unwrapErr(acceptanceCodexDestination({ register, requestedAlias: undefined }));

    expect(refused).toEqual(AcceptancePlanErrors.noCodexPlan({ registeredAliases: [] }));
    expect(refused.message).toContain("registered Codex plans: none");
  });

  it("refuses to pick between two unpaused Codex rows when none is named", () => {
    const register = registerOf({
      rows: [
        { alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" },
        { alias: "codex-two", provider: "codex", storeDir: "/stores/codex-two" },
      ],
    });

    expect(unwrapErr(acceptanceCodexDestination({ register, requestedAlias: undefined }))).toEqual(
      AcceptancePlanErrors.ambiguous({ aliases: ["codex-one", "codex-two"] }),
    );
  });

  it("refuses to pick when a second unpaused row is capped, never claiming the capped one could pay", () => {
    const register = registerOf({
      rows: [
        { alias: "codex-free", provider: "codex", storeDir: "/stores/codex-free" },
        { alias: "codex-capped", provider: "codex", storeDir: "/stores/codex-capped", usageLimitPercent: 90 },
      ],
    });

    const refused = unwrapErr(acceptanceCodexDestination({ register, requestedAlias: undefined }));

    expect(refused).toEqual(AcceptancePlanErrors.ambiguous({ aliases: ["codex-free", "codex-capped"] }));
    expect(refused.message).toContain("more than one Codex plan is unpaused (codex-free, codex-capped)");
  });
});
