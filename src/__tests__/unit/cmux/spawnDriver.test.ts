/**
 * The register read behind an omitted `cmux spawn --driver`: an explicit flag never reads the register, an omitted
 * one reads THIS spawn's `--home`, and an unreadable register refuses rather than guessing a host.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";

import { spawnDefaultDriver } from "../../../cli/commands/cmux/spawnDriver.js";
import { EXIT_ERROR } from "../../../cli/exitCodes.js";
import { PlanRegisterErrors } from "../../../plans/errors.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import type { PlanRegisterSnapshot, RegisteredPlan } from "../../../plans/types.js";

const CODEX: RegisteredPlan = {
  alias: "codex-one",
  allowance: { kind: "weekly-window" },
  provider: "codex",
  storeDir: "/s/codex-one",
  usageLimitPercent: 100,
};

const CODEX_ONLY: PlanRegisterSnapshot = {
  diagnostics: [],
  document: { rows: [{ ...CODEX }], version: 1 },
  plans: [CODEX],
  revision: null,
  source: "registered",
  thresholds: DEFAULT_THRESHOLDS,
};

/** A port whose reads answer `answer` and record which home each read asked for; it never writes. */
const portAnswering = ({
  answer,
  homes,
}: {
  answer: Awaited<ReturnType<PlanRegisterPort["read"]>>;
  homes: string[];
}): PlanRegisterPort => ({
  read: async ({ home }) => {
    homes.push(home);
    return answer;
  },
  write: async () => err(PlanRegisterErrors.mutationConflict({ conflict: "this fake never writes" })),
});

describe("spawnDefaultDriver", () => {
  it("returns claude without reading the register when --driver was passed", async () => {
    const homes: string[] = [];
    const port = portAnswering({ answer: ok(CODEX_ONLY), homes });
    const driver = await spawnDefaultDriver({
      home: "/homes/h",
      parsed: { positionals: [], values: { driver: "codex" } },
      port,
    });
    expect({ driver, homes }).toEqual({ driver: "claude", homes: [] });
  });

  it("reads the spawn's own --home and boots codex on a Codex-only register", async () => {
    const homes: string[] = [];
    const port = portAnswering({ answer: ok(CODEX_ONLY), homes });
    const driver = await spawnDefaultDriver({ home: "/homes/h", parsed: { positionals: [], values: {} }, port });
    expect({ driver, homes }).toEqual({ driver: "codex", homes: ["/homes/h"] });
  });

  it("refuses with the error exit when the register cannot be read", async () => {
    const homes: string[] = [];
    const unreadable = err(PlanRegisterErrors.registerUnreadable({ path: "/homes/h/plans.json" }));
    const port = portAnswering({ answer: unreadable, homes });
    const driver = await spawnDefaultDriver({ home: "/homes/h", parsed: { positionals: [], values: {} }, port });
    expect({ driver, homes }).toEqual({ driver: EXIT_ERROR, homes: ["/homes/h"] });
  });
});
