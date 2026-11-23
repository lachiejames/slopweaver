import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ClaudeAccount, ClaudeAccountGauge } from "../../../../../claude/contracts.js";
import { ClaudeRotationErrors } from "../../../../../claude/errors.js";
import type { ClaudeProbeResult } from "../../../../../claude/probeStore.js";
import { foldSweep, STATE_FILE } from "../../../../../cli/commands/claude/watchSweep.js";
import { err, ok } from "../../../../../lib/result.js";

const NOW = "2026-11-11T08:00:00.000Z";
const EARLIER = "2026-11-10T08:00:00.000Z";
const RESET = "2026-11-11T12:00:00.000Z";

const accountFor = ({ alias }: { alias: string }): ClaudeAccount => ({ alias, storeDir: `/stores/${alias}` });
const TWO = accountFor({ alias: "plan-two" });
const THREE = accountFor({ alias: "plan-three" });

const gauge = ({ alias }: { alias: string }): ClaudeAccountGauge => ({
  alias,
  fiveHour: { resetAtIso: RESET, status: "allowed", utilization: 0.2 },
  observedAtIso: NOW,
  sevenDay: { resetAtIso: RESET, status: "allowed", utilization: 0.3 },
});

const LIFE = { hasCredential: true, hasRefreshToken: true } as const;

const healthy = ({ alias, organizationId }: { alias: string; organizationId: string }): ClaudeProbeResult => ({
  life: { alias, ...LIFE },
  organizationId,
  outcome: { alias, gauge: gauge({ alias }) },
  reading: ok(gauge({ alias })),
});

const refused = ({ alias }: { alias: string }): ClaudeProbeResult => ({
  life: { alias, ...LIFE },
  outcome: { alias, problem: "refused" },
  reading: err(ClaudeRotationErrors.credentialRejected({ alias, status: 401 })),
});

describe("foldSweep", () => {
  let home = "";

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("records each answering store's account and carries a refused store's previous one", () => {
    home = mkdtempSync(join(tmpdir(), "watch-sweep-"));
    mkdirSync(join(home, "claude-accounts"), { recursive: true });
    writeFileSync(
      join(home, STATE_FILE),
      JSON.stringify({ identities: [{ alias: "plan-three", observedAtIso: EARLIER, organizationId: "org-three" }] }),
    );
    const read = foldSweep({
      accounts: [TWO, THREE],
      active: { organizationId: "org-two" },
      home,
      nowIso: NOW,
      results: [healthy({ alias: "plan-two", organizationId: "org-two" }), refused({ alias: "plan-three" })],
    });
    expect(read.identities.toSorted((a, b) => a.alias.localeCompare(b.alias))).toEqual([
      { alias: "plan-three", observedAtIso: EARLIER, organizationId: "org-three" },
      { alias: "plan-two", observedAtIso: NOW, organizationId: "org-two" },
    ]);
    expect(read.activeOrganizationId).toBe("org-two");
    expect(read.outcomes.map((outcome) => outcome.alias)).toEqual(["plan-two", "plan-three"]);
    expect(read.probes.map((probe) => [probe.alias, probe.storeDir, probe.reading.isOk()])).toEqual([
      ["plan-two", "/stores/plan-two", true],
      ["plan-three", "/stores/plan-three", false],
    ]);
  });

  it("reads an empty home as no previous identities and leaves the active slot's fields absent", () => {
    home = mkdtempSync(join(tmpdir(), "watch-sweep-"));
    const read = foldSweep({
      accounts: [TWO],
      active: {},
      home,
      nowIso: NOW,
      results: [refused({ alias: "plan-two" })],
    });
    expect(read.identities).toEqual([]);
    expect(read.identityAlarms).toEqual([]);
    expect(Object.keys(read).toSorted()).toEqual(["identities", "identityAlarms", "outcomes", "probes"]);
  });
});
