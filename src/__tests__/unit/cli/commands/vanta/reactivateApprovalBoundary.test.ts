/**
 * `write vanta reactivate` at the REAL command boundary, with an injected client that records every batch
 * it was handed — so "Vanta was not reached" is asserted through a value that moves when it is. The
 * approved run is what proves the witness can fire.
 *
 * `--home` is a fresh temp directory on every run, because the door records its decision in that home.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { vantaReactivateDigest } from "../../../../../atlas/vanta/reactivateApproval.js";
import type {
  VantaReactivateUpdate,
  VantaVulnerabilityBulkResult,
} from "../../../../../atlas/vanta/vulnerabilityApiSchemas.js";
import { resolveVantaWriteRequest } from "../../../../../atlas/vanta/writePreview.js";
import {
  runVantaReactivateWith,
  VANTA_REACTIVATE_USAGE,
  type VantaReactivateDeps,
} from "../../../../../cli/commands/vanta/reactivateRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { ok } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

/** The provider effect, and the record of whether it ran. A plain fake function, not a mock. */
function recordingDeps({
  answer,
}: {
  answer: (input: { updates: readonly VantaReactivateUpdate[] }) => readonly VantaVulnerabilityBulkResult[];
}): { deps: VantaReactivateDeps; sent: VantaReactivateUpdate[][] } {
  const sent: VantaReactivateUpdate[][] = [];
  return {
    deps: {
      doorLedger: memoryDoorLedger().port,
      createClient: () =>
        ok({
          deactivateVulnerabilities: () => Promise.resolve(ok({ results: [] })),
          reactivateVulnerabilities: ({ updates }) => {
            sent.push([...updates]);
            return Promise.resolve(ok({ results: [...answer({ updates })] }));
          },
        }),
    },
    sent,
  };
}

const allSucceed = ({
  updates,
}: {
  updates: readonly VantaReactivateUpdate[];
}): readonly VantaVulnerabilityBulkResult[] => updates.map((update) => ({ id: update.id, status: "SUCCESS" as const }));

const DIGEST = vantaReactivateDigest({
  request: resolveVantaWriteRequest({ input: { updates: [{ id: "v_1" }] }, kind: "reactivate-vulnerabilities" }),
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-vanta-reactivate-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function argv({ ids, extra }: { ids: string; extra: readonly string[] }): readonly string[] {
  return ["node", "cli", "write", "vanta", "reactivate", "--ids", ids, "--home", home, ...extra];
}

describe("write vanta reactivate, with no approval evidence", () => {
  it("never reaches Vanta, and exits 1", async () => {
    const { deps, sent } = recordingDeps({ answer: allSucceed });
    expect(await runVantaReactivateWith({ argv: argv({ extra: [], ids: "v_1" }), deps })).toBe(EXIT_ERROR);
    expect(sent).toEqual([]);
  });

  it("never reaches Vanta with an approval for a different batch", async () => {
    const { deps, sent } = recordingDeps({ answer: allSucceed });
    const code = await runVantaReactivateWith({ argv: argv({ extra: ["--approve", DIGEST], ids: "v_1,v_2" }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(sent).toEqual([]);
  });

  it("is not waivable by the per-action override token", async () => {
    const { deps, sent } = recordingDeps({ answer: allSucceed });
    process.env["SLOPWEAVER_DOOR_OVERRIDE"] = "vanta.reactivate-unapproved,door.approval-unbacked";
    try {
      expect(await runVantaReactivateWith({ argv: argv({ extra: [], ids: "v_1" }), deps })).toBe(EXIT_ERROR);
    } finally {
      delete process.env["SLOPWEAVER_DOOR_OVERRIDE"];
    }
    expect(sent).toEqual([]);
  });
});

describe("write vanta reactivate, with the digest that covers this exact batch", () => {
  it("reaches Vanta with exactly the approved ids — the witness fires", async () => {
    const { deps, sent } = recordingDeps({ answer: allSucceed });
    const code = await runVantaReactivateWith({ argv: argv({ extra: ["--approve", DIGEST], ids: "v_1" }), deps });
    expect(code).toBe(EXIT_OK);
    expect(sent).toEqual([[{ id: "v_1" }]]);
  });

  it("exits 1 when Vanta refuses the one finding, even though the batch was accepted", async () => {
    const { deps } = recordingDeps({
      answer: ({ updates }) =>
        updates.map((update) => ({ id: update.id, message: "not found", status: "ERROR" as const })),
    });
    const code = await runVantaReactivateWith({ argv: argv({ extra: ["--approve", DIGEST], ids: "v_1" }), deps });
    expect(code).toBe(EXIT_ERROR);
  });

  it("exits 1 when Vanta's answer names no finding that was sent", async () => {
    const { deps } = recordingDeps({ answer: () => [] });
    const code = await runVantaReactivateWith({ argv: argv({ extra: ["--approve", DIGEST], ids: "v_1" }), deps });
    expect(code).toBe(EXIT_ERROR);
  });
});

describe("the parts that stop before the door", () => {
  it("--dry-run exits 0 and reaches Vanta not at all", async () => {
    const { deps, sent } = recordingDeps({ answer: allSucceed });
    expect(await runVantaReactivateWith({ argv: argv({ extra: ["--dry-run"], ids: "v_1" }), deps })).toBe(EXIT_OK);
    expect(sent).toEqual([]);
  });

  it("refuses a duplicated id as a usage error, before any client is built", async () => {
    const { deps, sent } = recordingDeps({ answer: allSucceed });
    expect(await runVantaReactivateWith({ argv: argv({ extra: ["--dry-run"], ids: "v_1,v_1" }), deps })).toBe(
      EXIT_USAGE,
    );
    expect(sent).toEqual([]);
  });

  it("opens its usage on the exact invocation the write manifest advertises", () => {
    expect(VANTA_REACTIVATE_USAGE.startsWith("usage: slopweaver write vanta reactivate --ids <id[,id...]>")).toBe(true);
  });
});
