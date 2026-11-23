/**
 * The Claude-side read a successor pick confirms an ambient Claude target through — the spawn's own
 * `readClaudeFleet`, so the hand-off and `cmux spawn --driver claude` cannot disagree about whether this home boots
 * on the ambient credential. Real register snapshots and a temp home; the
 * register port is a plain seam.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import { liveChairClaudeSideRead } from "../../../../../cli/commands/supervisor/chairSuccessorReads.js";
import { PlanRegisterErrors } from "../../../../../plans/errors.js";
import type { PlanRegisterPort } from "../../../../../plans/port.js";
import type { PlanRegisterSnapshot } from "../../../../../plans/types.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { CODEX_ONLY, derivedPlans } from "../../../../chairSuccessorFixture.js";
import { unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh state home. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "chair-claude-side-"));
  homes.push(dir);
  return dir;
}

/** A port answering one snapshot. */
function portOver({ snapshot }: { snapshot: PlanRegisterSnapshot }): PlanRegisterPort {
  return {
    read: () => Promise.resolve(ok(snapshot)),
    write: () =>
      Promise.resolve(
        err(PlanRegisterErrors.registerStoreUnavailable({ doing: "be written", reason: "read-only seam" })),
      ),
  };
}

describe("liveChairClaudeSideRead", () => {
  it("reads a registered register with no Claude row as unconfigured, so the ambient boot stands", async () => {
    const read = liveChairClaudeSideRead({ port: portOver({ snapshot: CODEX_ONLY }) });
    expect(unwrap(await read({ home: home() }))).toBe("unconfigured");
  });

  it("reads an unadopted install with no accounts file as unconfigured", async () => {
    const read = liveChairClaudeSideRead({ port: portOver({ snapshot: derivedPlans({ claudeRows: [] }) }) });
    expect(unwrap(await read({ home: home() }))).toBe("unconfigured");
  });

  // The r6 case: present-but-empty is not unconfigured, so the spawn refuses rather than booting ambient — and the
  // read carries the spawn's own refusal, which the verdict prints as the reason no successor is seated.
  it("refuses an unadopted install whose accounts file is present but empty, with the spawn's own reason", async () => {
    const dir = home();
    const path = stateHomePaths({ home: dir }).claudeAccountsJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "[]\n");
    const read = liveChairClaudeSideRead({ port: portOver({ snapshot: derivedPlans({ claudeRows: [] }) }) });
    expect(unwrapErr(await read({ home: dir }))).toBe(
      "the configured Claude accounts are not usable: the Claude accounts file claude-accounts/accounts.json is present and lists no plan — delete it for an install with no Claude plans, or register one with `slopweaver plans add --provider claude`",
    );
  });

  it("answers the fleet read's own message when the register cannot be read", async () => {
    const read = liveChairClaudeSideRead({ port: unavailablePlanRegisterPort() });
    expect(unwrapErr(await read({ home: home() }))).toBe(
      "the plan register lives in the store, and the store could not be opened, so which plans this install has is UNKNOWN — refusing rather than seating a session on whatever credential is ambient (`slopweaver store status` says what the store is doing). The store said: connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)",
    );
  });
});
