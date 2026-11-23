/**
 * `ownerHeldFailures` over a real slot ledger in a throwaway home: a failure settled beneath the owner's standing
 * hold is read back with the finding its row derives, and nothing else is — not one settled before the hold, not one
 * on a row the owner does not hold, not a success, and nothing at all while no owner hold stands.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  RECIPE_DEFINITION_SCHEMA_VERSION,
  type RecipeDefinition,
  type RecipeHold,
} from "../../../../live/automation/definition.js";
import { failureFindingSlug } from "../../../../live/automation/failureHold.js";
import { ownerHeldFailures } from "../../../../live/automation/ownerHeldFailures.js";
import type { RecipeSlotOutcome } from "../../../../live/automation/slotAttempt.js";
import { beginSlotAttempt } from "../../../../live/automation/slotLedger.js";
import { settleSlotAttempt } from "../../../../live/automation/slotSettlement.js";
import { stateHomePaths } from "../../../../stateHome.js";

const HELD_AT = "2026-10-13T03:00:00.000Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "owner-held-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A row, carrying `hold` when given. */
function row({ recipeId, hold }: { recipeId: string; hold?: RecipeHold }): RecipeDefinition {
  return {
    cadence: "0 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    ...(hold === undefined ? {} : { hold }),
    kind: "verb-run",
    onMissed: "skip",
    params: { argv: ["atlas", "vanta", "sync"] },
    recipeId,
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  };
}

/** The owner's own hold, placed at {@link HELD_AT}. */
const OWNER_HOLD: RecipeHold = { askedIso: HELD_AT, clearedBy: null, reason: "paused while the owner looks" };

/** Take and settle one attempt at `slotIso`, settled at `settledAtIso` with `kind`. */
function settled({
  recipeId,
  slotIso,
  settledAtIso,
  kind = "dead",
}: {
  recipeId: string;
  slotIso: string;
  settledAtIso: string;
  kind?: "dead" | "succeeded";
}): void {
  unwrap(
    beginSlotAttempt({
      holder: "recipe run-due",
      holderPid: null,
      holderToken: "tok",
      home,
      leaseExpiresIso: "2026-10-14T00:00:00.000Z",
      nowIso: slotIso,
      processAlive: () => true,
      recipeId,
      slotIso,
    }),
  );
  const outcome: RecipeSlotOutcome =
    kind === "dead"
      ? { detail: "exit 1", kind: "dead", reason: "ATTEMPTS_EXHAUSTED", settledAtIso }
      : { exitCode: 0, kind: "succeeded", settledAtIso };
  unwrap(settleSlotAttempt({ holderToken: "tok", home, nowIso: settledAtIso, outcome, recipeId, slotIso }));
}

describe("ownerHeldFailures", () => {
  it("reads back a failure settled after the owner hold, with the finding its row derives", () => {
    settled({ recipeId: "vanta", settledAtIso: "2026-10-13T03:05:00.000Z", slotIso: "2026-10-13T02:00:00.000Z" });

    expect(ownerHeldFailures({ definitions: [row({ hold: OWNER_HOLD, recipeId: "vanta" })], home })).toEqual({
      failures: [
        {
          attempt: 1,
          finding: failureFindingSlug({ attempt: 1, recipeId: "vanta", slotIso: "2026-10-13T02:00:00.000Z" }),
          recipeId: "vanta",
          slotIso: "2026-10-13T02:00:00.000Z",
        },
      ],
      unread: [],
    });
  });

  it("ignores a failure before the owner hold, a success, and a row the owner does not hold", () => {
    settled({ recipeId: "vanta", settledAtIso: "2026-10-13T02:30:00.000Z", slotIso: "2026-10-13T01:00:00.000Z" });
    settled({
      kind: "succeeded",
      recipeId: "vanta",
      settledAtIso: "2026-10-13T03:05:00.000Z",
      slotIso: "2026-10-13T02:00:00.000Z",
    });
    settled({ recipeId: "notion", settledAtIso: "2026-10-13T03:05:00.000Z", slotIso: "2026-10-13T02:00:00.000Z" });
    const failureHold: RecipeHold = { ...OWNER_HOLD, finding: "recipe-failing-notion-a1" };

    const read = ownerHeldFailures({
      definitions: [row({ hold: OWNER_HOLD, recipeId: "vanta" }), row({ hold: failureHold, recipeId: "notion" })],
      home,
    });

    expect(read).toEqual({ failures: [], unread: [] });
  });

  it("orders against the EARLIEST of two rows sharing a recipeId, whichever is parsed last", () => {
    settled({ recipeId: "vanta", settledAtIso: "2026-10-13T04:00:00.000Z", slotIso: "2026-10-13T02:00:00.000Z" });
    const later: RecipeHold = { ...OWNER_HOLD, askedIso: "2026-10-13T05:00:00.000Z" };

    const read = ownerHeldFailures({
      definitions: [row({ hold: OWNER_HOLD, recipeId: "vanta" }), row({ hold: later, recipeId: "vanta" })],
      home,
    });

    expect(read.failures.map(({ slotIso }) => slotIso)).toEqual(["2026-10-13T02:00:00.000Z"]);
  });

  it("reads nothing, and names nothing unread, while no owner hold stands", () => {
    settled({ recipeId: "vanta", settledAtIso: "2026-10-13T03:05:00.000Z", slotIso: "2026-10-13T02:00:00.000Z" });
    writeFileSync(join(stateHomePaths({ home }).live.recipe.slotAttemptsDir, "torn.json"), "{", "utf8");
    const cleared: RecipeHold = {
      ...OWNER_HOLD,
      clearedBy: { atIso: "2026-10-13T04:00:00.000Z", runSlug: "owner-answer" },
    };

    expect(ownerHeldFailures({ definitions: [row({ hold: cleared, recipeId: "vanta" })], home })).toEqual({
      failures: [],
      unread: [],
    });
  });

  it("names a ledger file that will not read while an owner hold stands", () => {
    mkdirSync(stateHomePaths({ home }).live.recipe.slotAttemptsDir, { recursive: true });
    writeFileSync(join(stateHomePaths({ home }).live.recipe.slotAttemptsDir, "torn.json"), "{", "utf8");

    expect(ownerHeldFailures({ definitions: [row({ hold: OWNER_HOLD, recipeId: "vanta" })], home })).toEqual({
      failures: [],
      unread: ["slot row torn.json"],
    });
  });

  it("names a hold or a settlement whose instant is no datetime, never ordering a failure against NaN", () => {
    settled({ recipeId: "vanta", settledAtIso: "2026-10-13T02:30:00.000Z", slotIso: "2026-10-13T01:00:00.000Z" });
    settled({ recipeId: "notion", settledAtIso: "not-a-date", slotIso: "2026-10-13T02:00:00.000Z" });

    const read = ownerHeldFailures({
      definitions: [
        row({ hold: { ...OWNER_HOLD, askedIso: "not-a-date" }, recipeId: "vanta" }),
        row({ hold: OWNER_HOLD, recipeId: "notion" }),
      ],
      home,
    });

    expect(read.failures).toEqual([]);
    expect(read.unread).toHaveLength(2);
    expect(read.unread[0]).toBe('the owner hold on vanta, whose askedIso "not-a-date" is no datetime');
    expect(read.unread[1]).toContain('whose settledAtIso "not-a-date" is no datetime');
  });

  it("names a hold on a calendar impossibility, never rolling an impossible February date into March", () => {
    const read = ownerHeldFailures({
      definitions: [row({ hold: { ...OWNER_HOLD, askedIso: "2026-02-30T00:00:00.000Z" }, recipeId: "vanta" })],
      home,
    });

    expect(read.unread).toEqual(['the owner hold on vanta, whose askedIso "2026-02-30T00:00:00.000Z" is no datetime']);
  });

  it("names a ledger row carrying an invalid UTF-8 byte rather than repairing it", () => {
    settled({
      kind: "succeeded",
      recipeId: "vanta",
      settledAtIso: "2026-10-13T03:05:00.000Z",
      slotIso: "2026-10-13T02:00:00.000Z",
    });
    const dir = stateHomePaths({ home }).live.recipe.slotAttemptsDir;
    const name = readdirSync(dir).find((file) => file.endsWith(".json"))!;
    const [before, after] = readFileSync(join(dir, name), "utf8").split("recipe run-due");
    writeFileSync(
      join(dir, name),
      Buffer.concat([Buffer.from(`${before!}recipe`), Buffer.from([0x80]), Buffer.from(after!)]),
    );

    expect(ownerHeldFailures({ definitions: [row({ hold: OWNER_HOLD, recipeId: "vanta" })], home })).toEqual({
      failures: [],
      unread: [`slot row ${name}`],
    });
  });

  it("names a ledger row that is a FIFO rather than hanging on it", () => {
    mkdirSync(stateHomePaths({ home }).live.recipe.slotAttemptsDir, { recursive: true });
    execFileSync("mkfifo", [join(stateHomePaths({ home }).live.recipe.slotAttemptsDir, "blocked.json")]);

    expect(ownerHeldFailures({ definitions: [row({ hold: OWNER_HOLD, recipeId: "vanta" })], home })).toEqual({
      failures: [],
      unread: ["slot row blocked.json"],
    });
  });
});
