/**
 * The `codex-provider-unregistered` fallback ground — `codex/providerUnregistered.ts`, read through the fleet
 * verdict that carries it (`codex/fleetCap.ts`'s `codexFleetCapFrom`) and the decision `prepare` takes on it
 * (`codex/fallbackCap.ts`).
 *
 * The property: a register with no Codex row — adopted or derived alike, since a derived picture carries only the
 * Claude plans the user signed in to — licenses the fallback on its own ground, and nothing else does: not a
 * register holding a Codex row, not one whose only Codex row is paused. Each licensing case sits beside the
 * falsifier that differs from it in one input.
 */
import { describe, expect, it } from "vitest";

import { decideFallbackCap } from "../../../codex/fallbackCap.js";
import { codexFleetCapFrom } from "../../../codex/fleetCap.js";
import {
  CODEX_UNREGISTERED_WHY,
  codexProviderUnregistered,
  parseProviderUnregisteredEvidence,
  providerUnregisteredLine,
} from "../../../codex/providerUnregistered.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { derivePlanRegister, parsePlanRegister } from "../../../plans/register.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const NOW = "2026-11-05T01:00:00.000Z";
const HATCH_ENV = "SLOPWEAVER_ALLOW_FALLBACK_PLAN_UNCAPPED";
const EVIDENCE = { kind: "codex-provider-unregistered", observedAtIso: NOW, why: CODEX_UNREGISTERED_WHY } as const;

/** The fleet verdict over one register document, with no destination observed. */
function verdictOver({ rows }: { rows: readonly Record<string, unknown>[] }): ReturnType<typeof codexFleetCapFrom> {
  const register = unwrap(parsePlanRegister({ value: { rows, version: 1 } }));
  return codexFleetCapFrom({
    snapshot: { observations: [], readAtIso: NOW, register, thresholds: DEFAULT_THRESHOLDS.codex },
  });
}

describe("judging the ground from the register alone", () => {
  it("grounds on a register with zero Codex rows", () => {
    expect(codexProviderUnregistered({ codexRows: 0, readAtIso: NOW })).toEqual(EVIDENCE);
  });

  it("does not ground once one Codex row is registered", () => {
    expect(codexProviderUnregistered({ codexRows: 1, readAtIso: NOW })).toBeUndefined();
  });

  it("words its line so it can never read as a cap", () => {
    expect(providerUnregisteredLine({ evidence: EVIDENCE })).toBe(
      `No Codex plan is registered: ${CODEX_UNREGISTERED_WHY}`,
    );
  });
});

describe("the fleet verdict carries the ground beside, never inside, the capacity fields", () => {
  it("carries it for an adopted register holding no rows at all", () => {
    const verdict = verdictOver({ rows: [] });

    expect(verdict.providerUnregistered).toEqual(EVIDENCE);
    expect(verdict.capEvidence).toBeUndefined();
    expect(verdict.routingPause).toBeUndefined();
  });

  it("carries nothing when the register's only Codex row is PAUSED — that is a fleet, merely unavailable", () => {
    const verdict = verdictOver({
      rows: [
        {
          alias: "codex-one",
          paused: { reason: "out of the fleet", sinceIso: "2026-11-01T00:00:00.000Z" },
          provider: "codex",
          storeDir: "/state/codex-one/.codex",
        },
      ],
    });

    expect(verdict.providerUnregistered).toBeUndefined();
  });

  it("carries it over the derived register an unadopted install reads — a found Codex login is never a row", () => {
    const register = unwrap(derivePlanRegister({ claudeRows: [] }));

    const verdict = codexFleetCapFrom({
      snapshot: { observations: [], readAtIso: NOW, register, thresholds: DEFAULT_THRESHOLDS.codex },
    });

    expect(register.source).toBe("derived");
    expect(verdict.providerUnregistered).toEqual(EVIDENCE);
  });
});

describe("prepare's decision on the ground", () => {
  it("decides UNREGISTERED, carrying the evidence and no cap reading", () => {
    const decision = decideFallbackCap({
      fleet: verdictOver({ rows: [] }),
      hatchEnv: HATCH_ENV,
      hatchOpen: false,
      nowIso: NOW,
    });

    expect(decision).toEqual({ evidence: EVIDENCE, kind: "unregistered" });
  });

  it("decides UNREGISTERED with the hatch open too, so no request claims an override it did not need", () => {
    const decision = decideFallbackCap({
      fleet: verdictOver({ rows: [] }),
      hatchEnv: HATCH_ENV,
      hatchOpen: true,
      nowIso: NOW,
    });

    expect(decision).toEqual({ evidence: EVIDENCE, kind: "unregistered" });
  });

  it("REFUSES the paused-only register, whose verdict carries no ground of any kind", () => {
    const decision = decideFallbackCap({
      fleet: verdictOver({
        rows: [
          {
            alias: "codex-one",
            paused: { reason: "out of the fleet", sinceIso: "2026-11-01T00:00:00.000Z" },
            provider: "codex",
            storeDir: "/state/codex-one/.codex",
          },
        ],
      }),
      hatchEnv: HATCH_ENV,
      hatchOpen: false,
      nowIso: NOW,
    });

    expect(decision.kind).toBe("refused");
  });
});

describe("decoding the ground a request carries", () => {
  it("round-trips the evidence it was written from", () => {
    const parsed = parseProviderUnregisteredEvidence({ value: EVIDENCE });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual(EVIDENCE);
  });

  it("refuses a ground that names a cap kind", () => {
    const parsed = parseProviderUnregisteredEvidence({ value: { ...EVIDENCE, kind: "usage-limit" } });

    expect(unwrapErr(parsed).message).toBe("ground must carry kind codex-provider-unregistered, observedAtIso and why");
  });

  it("refuses a ground that is not an object", () => {
    const parsed = parseProviderUnregisteredEvidence({ value: "codex-provider-unregistered" });

    expect(unwrapErr(parsed).message).toBe("ground must be an object");
  });
});
