/**
 * Plan registers the chair's successor target is judged over (`src/supervisor/chairSuccessor.ts`), built through
 * the REAL parser and deriver so a fixture cannot drift from what a read produces.
 */
import { ok, type Result, unwrap } from "#lib/result.js";

import type { PlanRegisterError } from "../plans/errors.js";
import { derivePlanRegister, parsePlanRegister } from "../plans/register.js";
import type { PlanRegisterSnapshot } from "../plans/types.js";

/**
 * A registered register over the given rows.
 *
 * @param rows the raw register rows
 * @returns the parsed snapshot
 */
export function registeredPlans({
  rows,
}: {
  rows: readonly Readonly<Record<string, unknown>>[];
}): PlanRegisterSnapshot {
  return unwrap(parsePlanRegister({ value: { rows, version: 1 } }));
}

/** A paused row's pause, as `plans pause` writes it. */
export const PAUSED = { reason: "out for the week", sinceIso: "2026-11-01T00:00:00.000Z" } as const;

/** One registered Claude plan — the one-plan install. */
export const ONE_CLAUDE = registeredPlans({ rows: [{ alias: "plan-one", provider: "claude", storeDir: "/s/one" }] });

/** The five-plan Claude fleet the tick gauges measure, so a route picking any of them names a registered plan. */
export const CLAUDE_FLEET = registeredPlans({
  rows: ["one", "two", "three", "four", "five"].map((name) => ({
    alias: `plan-${name}`,
    provider: "claude",
    storeDir: `/s/${name}`,
  })),
});

/** A registered install whose fleet is entirely Codex. */
export const CODEX_ONLY = registeredPlans({ rows: [{ alias: "codex-work", provider: "codex", storeDir: "/c/work" }] });

/** A registered install carrying both providers. */
export const MIXED = registeredPlans({
  rows: [
    { alias: "plan-one", provider: "claude", storeDir: "/s/one" },
    { alias: "codex-work", provider: "codex", storeDir: "/c/work" },
  ],
});

/**
 * An unadopted install's derived picture, over the given legacy Claude rows.
 *
 * @param claudeRows the legacy accounts file's rows, empty for a fresh install
 * @returns the derived snapshot, which always carries `codex-ambient`
 */
export function derivedPlans({
  claudeRows,
}: {
  claudeRows: readonly Readonly<Record<string, unknown>>[];
}): PlanRegisterSnapshot {
  return unwrap(derivePlanRegister({ claudeRows }));
}

/**
 * A register-read seam answering one snapshot, and counting how often it was asked.
 *
 * @param snapshot what every read answers
 * @returns the seam and the list of homes it was asked for
 */
export function countedRegisterRead({ snapshot }: { snapshot: PlanRegisterSnapshot }): {
  readonly read: (args: { home: string }) => Promise<Result<PlanRegisterSnapshot, PlanRegisterError>>;
  readonly asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    read: ({ home }) => {
      asked.push(home);
      return Promise.resolve(ok(snapshot));
    },
  };
}
