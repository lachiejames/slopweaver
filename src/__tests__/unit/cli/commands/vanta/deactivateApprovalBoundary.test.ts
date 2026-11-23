/**
 * The falsifiable check the finding asked for, at the REAL command boundary: run `write vanta deactivate`
 * with an injected provider effect and no approval evidence, and assert the effect is NOT called.
 *
 * The witness is the injected client itself, which records every batch it was handed — so "Vanta was not
 * reached" is asserted through a value that MOVES when it is, rather than through silence. The last test in
 * each block is what proves the witness can fire: the same run with `--approve <digest>` reaches it.
 *
 * `--home` is a fresh temp directory on every run, because the door records its decision — including the
 * refusal — in that home's ledger.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { vantaDeactivateDigest } from "../../../../../atlas/vanta/deactivateApproval.js";
import type { VantaDeactivateUpdate } from "../../../../../atlas/vanta/vulnerabilityApiSchemas.js";
import { runVantaDeactivateWith, type VantaDeactivateDeps } from "../../../../../cli/commands/vanta/deactivateRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { ok } from "../../../../../lib/result.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const REASON = "not reachable in our usage";

/** The batch the argv below assembles — what the digest an operator would type covers. */
const BATCH: readonly VantaDeactivateUpdate[] = [
  { deactivateReason: REASON, id: "v_1", shouldReactivateWhenFixable: false },
];

/** The provider effect, and the record of whether it ran. A plain fake function, not a mock. */
function recordingDeps({ doorLedger = memoryDoorLedger().port }: { doorLedger?: DoorLedgerPort } = {}): {
  deps: VantaDeactivateDeps;
  sent: VantaDeactivateUpdate[][];
} {
  const sent: VantaDeactivateUpdate[][] = [];
  return {
    deps: {
      doorLedger,
      createClient: () =>
        ok({
          deactivateVulnerabilities: ({ updates }) => {
            sent.push([...updates]);
            return Promise.resolve(ok({ results: updates.map((u) => ({ id: u.id, status: "SUCCESS" as const })) }));
          },
          reactivateVulnerabilities: () => Promise.resolve(ok({ results: [] })),
        }),
    },
    sent,
  };
}

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-vanta-approval-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function argv({ approve }: { approve: string | null }): readonly string[] {
  return [
    "node",
    "cli",
    "write",
    "vanta",
    "deactivate",
    "--ids",
    "v_1",
    "--reason",
    REASON,
    "--home",
    home,
    ...(approve === null ? [] : ["--approve", approve]),
  ];
}

describe("write vanta deactivate, with no approval evidence", () => {
  it("never reaches Vanta", async () => {
    const { deps, sent } = recordingDeps();
    await runVantaDeactivateWith({ argv: argv({ approve: null }), deps });
    expect(sent).toEqual([]);
  });

  it("exits 1, the door-refused code, rather than reporting a batch that never happened", async () => {
    const { deps } = recordingDeps();
    expect(await runVantaDeactivateWith({ argv: argv({ approve: null }), deps })).toBe(EXIT_ERROR);
  });

  it("never reaches Vanta with an approval for a DIFFERENT batch either", async () => {
    const { deps, sent } = recordingDeps();
    const other = vantaDeactivateDigest({ updates: [{ ...BATCH[0]!, deactivateReason: "wontfix" }] });
    expect(await runVantaDeactivateWith({ argv: argv({ approve: other }), deps })).toBe(EXIT_ERROR);
    expect(sent).toEqual([]);
  });

  it("is not waivable by the per-action override token", async () => {
    const { deps, sent } = recordingDeps();
    process.env["SLOPWEAVER_DOOR_OVERRIDE"] = "vanta.deactivate-unapproved,door.approval-unbacked";
    try {
      expect(await runVantaDeactivateWith({ argv: argv({ approve: null }), deps })).toBe(EXIT_ERROR);
    } finally {
      delete process.env["SLOPWEAVER_DOOR_OVERRIDE"];
    }
    expect(sent).toEqual([]);
  });
});

describe("write vanta deactivate, with the digest that covers this exact batch", () => {
  it("reaches Vanta with exactly the batch that was approved — the witness fires", async () => {
    const { deps, sent } = recordingDeps();
    const code = await runVantaDeactivateWith({
      argv: argv({ approve: vantaDeactivateDigest({ updates: BATCH }) }),
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(sent).toEqual([[{ deactivateReason: REASON, id: "v_1", shouldReactivateWhenFixable: false }]]);
  });

  it("never reaches Vanta, and exits 1, when the store cannot record the door decision", async () => {
    const { deps, sent } = recordingDeps({ doorLedger: unreachableDoorLedger() });
    const code = await runVantaDeactivateWith({
      argv: argv({ approve: vantaDeactivateDigest({ updates: BATCH }) }),
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(sent).toEqual([]);
  });
});

describe("--dry-run stops before the door, so it needs no approval and records nothing", () => {
  it("exits 0 and reaches Vanta not at all", async () => {
    const { deps, sent } = recordingDeps();
    const code = await runVantaDeactivateWith({ argv: [...argv({ approve: null }), "--dry-run"], deps });
    expect(code).toBe(EXIT_OK);
    expect(sent).toEqual([]);
  });
});
