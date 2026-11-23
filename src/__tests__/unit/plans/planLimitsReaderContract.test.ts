/*
 * The console's plans reader (`site/components/live/readPlanLimits.ts`) parses what `plans list --json` prints. Its
 * own tests feed it snapshots typed against `PlanRegisterSnapshot`; this file feeds it the register decoder's REAL
 * output, round-tripped through JSON the way the verb prints it, so a change to what the decoder fills in breaks here.
 *
 * It lives in the `src` lane, not the site's, because the site build type-checks its own tests and cannot resolve
 * what the decoder imports.
 */
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { derivePlanRegister, parsePlanRegister } from "../../../plans/register.js";
import type { PlanRegisterSnapshot } from "../../../plans/types.js";

/** The reader under test, loaded at run time: `src` cannot import `site/` statically. */
type ReadPlanLimits = (payload: unknown) => unknown;

/**
 * Load the site's plans reader.
 *
 * @returns the reader
 */
async function loadReader(): Promise<ReadPlanLimits> {
  const path = fileURLToPath(new URL("../../../../site/components/live/readPlanLimits.ts", import.meta.url));
  const site = (await import(path)) as Record<string, unknown>;
  return site["readPlanLimits"] as ReadPlanLimits;
}

/** What the verb prints for a snapshot: the snapshot, stringified whole. */
const printed = ({ snapshot }: { snapshot: PlanRegisterSnapshot }): unknown => JSON.parse(JSON.stringify(snapshot));

describe("the console reads what the plan register's decoder produces", () => {
  it("a written register: each row at its limit and allowance, 100 and the weekly window where a row names none", async () => {
    const readPlanLimits = await loadReader();
    const snapshot = unwrap(
      parsePlanRegister({
        value: {
          rows: [
            { alias: "plan-one", email: "owner@acme.example", provider: "claude", storeDir: "/acme/claude-one" },
            {
              alias: "plan-two",
              allowance: { kind: "monthly-spend" },
              provider: "claude",
              storeDir: "/acme/claude-two",
              usageLimitPercent: 50,
            },
            {
              alias: "codex-one",
              paused: { reason: "the subscription lapsed", sinceIso: "2026-11-01T00:00:00.000Z" },
              provider: "codex",
              storeDir: "/acme/codex-one",
              usageLimitPercent: 30,
            },
          ],
          version: 1,
        },
      }),
    );
    expect(readPlanLimits(printed({ snapshot }))).toEqual({
      plans: [
        {
          alias: "plan-one",
          allowance: "weekly-window",
          email: "owner@acme.example",
          percent: 100,
          provider: "claude",
        },
        { alias: "plan-two", allowance: "monthly-spend", email: undefined, percent: 50, provider: "claude" },
        { alias: "codex-one", allowance: "weekly-window", email: undefined, percent: 30, provider: "codex" },
      ],
      unadoptedWhy: undefined,
    });
  });

  it("a derived register: carries no Codex plan, with the decoder's own reason naming the adopt verb", async () => {
    const readPlanLimits = await loadReader();
    const snapshot = unwrap(derivePlanRegister({ claudeRows: [] }));
    const view = readPlanLimits(printed({ snapshot })) as { plans: unknown[]; unadoptedWhy: string };
    expect(view.plans).toEqual([]);
    expect(view.unadoptedWhy).toContain("slopweaver plans adopt");
  });

  it("an empty register: no drop-down, rather than a refused reading", async () => {
    const readPlanLimits = await loadReader();
    const snapshot = unwrap(parsePlanRegister({ value: { rows: [], version: 1 } }));
    expect(readPlanLimits(printed({ snapshot }))).toEqual({ plans: [], unadoptedWhy: undefined });
  });
});
