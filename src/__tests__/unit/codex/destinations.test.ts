/**
 * {@link codexDestinations}/{@link codexDestinationFor} — the Codex-shaped reader of the one register, over the
 * real store-backed port with an in-memory row (`src/__tests__/planRegisterFixture.ts`) and a real temp
 * `$SLOPWEAVER_HOME` whose legacy `plans.json` the first read imports.
 *
 * What these hold down is the substitution `src/codex/destinations.ts` refuses: an alias no row carries
 * resolving to the ambient home would read one account's rollout log under another account's name — and its
 * store-era twin, an unreachable store answering an empty list or `undefined` instead of the outage.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { codexDestinationFor, codexDestinations } from "../../../codex/destinations.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { RegisteredPlan } from "../../../plans/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../planRegisterFixture.js";

const homes: string[] = [];

/** A temp home whose legacy `plans.json` carries exactly `rows`. */
function homeWith({ rows }: { rows: readonly Omit<RegisteredPlan, "allowance" | "usageLimitPercent">[] }): string {
  const home = mkdtempSync(join(tmpdir(), "codex-destinations-"));
  homes.push(home);
  const path = stateHomePaths({ home }).plansJson;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ rows, version: 1 }), "utf8");
  return home;
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("codex destinations", () => {
  it("reads every Codex row, paired with its own CODEX_HOME, and ignores the Claude ones", async () => {
    const home = homeWith({
      rows: [
        { alias: "claude-one", provider: "claude", storeDir: "/stores/claude-one" },
        { alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" },
        { alias: "codex-two", provider: "codex", storeDir: "/stores/codex-two" },
      ],
    });

    expect(unwrap(await codexDestinations({ home, port: memoryPlanRegisterPort() }))).toEqual([
      { alias: "codex-one", codexHome: "/stores/codex-one" },
      { alias: "codex-two", codexHome: "/stores/codex-two" },
    ]);
  });

  it("keeps a PAUSED destination in the list, because this answers which exist", async () => {
    const home = homeWith({
      rows: [
        {
          alias: "codex-one",
          paused: { reason: "waiting on a billing decision", sinceIso: "2026-09-20T00:00:00.000Z" },
          provider: "codex",
          storeDir: "/stores/codex-one",
        },
      ],
    });

    expect(unwrap(await codexDestinations({ home, port: memoryPlanRegisterPort() }))).toEqual([
      { alias: "codex-one", codexHome: "/stores/codex-one" },
    ]);
  });

  it("resolves an alias to its own store directory", async () => {
    const home = homeWith({
      rows: [
        { alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" },
        { alias: "codex-two", provider: "codex", storeDir: "/stores/codex-two" },
      ],
    });

    expect(unwrap(await codexDestinationFor({ alias: "codex-two", home, port: memoryPlanRegisterPort() }))).toEqual({
      alias: "codex-two",
      codexHome: "/stores/codex-two",
    });
  });

  it("answers ok(undefined) for an alias no Codex row carries, never a substitute", async () => {
    const home = homeWith({ rows: [{ alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" }] });

    const resolved = await codexDestinationFor({ alias: "codex-nine", home, port: memoryPlanRegisterPort() });

    expect(unwrap(resolved)).toBeUndefined();
  });

  it("answers ok(undefined) for a CLAUDE alias, because a provider is part of the address", async () => {
    const home = homeWith({
      rows: [
        { alias: "claude-one", provider: "claude", storeDir: "/stores/claude-one" },
        { alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" },
      ],
    });

    expect(unwrap(await codexDestinationFor({ alias: "claude-one", home, port: memoryPlanRegisterPort() }))).toBe(
      undefined,
    );
  });

  it("finds no Codex destination on an install that has registered none, whatever login $CODEX_HOME holds", async () => {
    const home = mkdtempSync(join(tmpdir(), "codex-destinations-bare-"));
    homes.push(home);
    const port = memoryPlanRegisterPort();

    expect(unwrap(await codexDestinations({ home, port }))).toStrictEqual([]);
    expect(unwrap(await codexDestinationFor({ alias: "codex-ambient", home, port }))).toBe(undefined);
  });

  it("refuses with the store outage rather than an empty list when the register cannot be read", async () => {
    const home = homeWith({ rows: [{ alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" }] });

    const listed = await codexDestinations({ home, port: unavailablePlanRegisterPort() });
    const named = await codexDestinationFor({ alias: "codex-one", home, port: unavailablePlanRegisterPort() });

    expect(unwrapErr(listed).code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(unwrapErr(named).code).toBe("REGISTER_STORE_UNAVAILABLE");
  });
});
