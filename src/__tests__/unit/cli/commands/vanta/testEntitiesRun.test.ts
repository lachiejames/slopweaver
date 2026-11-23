/**
 * `atlas vanta test-entities` at the command boundary, with an injected entity client that records every
 * test it was asked about. `--home` is a fresh temp directory, so the stored-list path reads a home that
 * holds no Vanta atlas at all.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { VantaTestEntityStatus } from "../../../../../atlas/vanta/controlEvidenceApiSchemas.js";
import { VantaCredentialErrors } from "../../../../../atlas/vanta/credentialErrors.js";
import {
  runVantaTestEntitiesWith,
  type VantaTestEntitiesDeps,
} from "../../../../../cli/commands/vanta/testEntitiesRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";

/** An entity client that answers every test with no entities, or refuses one named test. */
function recordingDeps({ refuse }: { refuse: string | null }): {
  deps: VantaTestEntitiesDeps;
  asked: { testId: string; entityStatus: VantaTestEntityStatus }[];
} {
  const asked: { testId: string; entityStatus: VantaTestEntityStatus }[] = [];
  return {
    asked,
    deps: {
      createClient: () =>
        ok({
          listTestEntities: ({ testId, entityStatus }) => {
            asked.push({ entityStatus, testId });
            return Promise.resolve(testId === refuse ? err(["returned HTTP 404"]) : ok([]));
          },
        }),
    },
  };
}

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-vanta-test-entities-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "cli", "atlas", "vanta", "test-entities", "--home", home, ...tail];
}

describe("atlas vanta test-entities", () => {
  it("reads one named test with the status asked for, and exits 0 on a measured zero", async () => {
    const { deps, asked } = recordingDeps({ refuse: null });
    const code = await runVantaTestEntitiesWith({
      argv: argv({ tail: ["--status", "DEACTIVATED", "--test", "t1"] }),
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(asked).toEqual([{ entityStatus: "DEACTIVATED", testId: "t1" }]);
  });

  it("exits 1 when the test could not be read", async () => {
    const { deps } = recordingDeps({ refuse: "t1" });
    expect(
      await runVantaTestEntitiesWith({ argv: argv({ tail: ["--status", "DEACTIVATED", "--test", "t1"] }), deps }),
    ).toBe(EXIT_ERROR);
  });

  it("exits 3 and asks Vanta nothing when there is no stored test list to sweep", async () => {
    const { deps, asked } = recordingDeps({ refuse: null });
    expect(await runVantaTestEntitiesWith({ argv: argv({ tail: ["--status", "DEACTIVATED"] }), deps })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(asked).toEqual([]);
  });

  it("exits 2 and asks Vanta nothing without a --status", async () => {
    const { deps, asked } = recordingDeps({ refuse: null });
    expect(await runVantaTestEntitiesWith({ argv: argv({ tail: ["--test", "t1"] }), deps })).toBe(EXIT_USAGE);
    expect(asked).toEqual([]);
  });

  it("exits 3 when credentials are simply not configured", async () => {
    const deps: VantaTestEntitiesDeps = {
      createClient: () =>
        err([VantaCredentialErrors.credentialUnset({ name: "VANTA_CLIENT_ID", secretName: "vanta-client-id" })]),
    };
    expect(
      await runVantaTestEntitiesWith({ argv: argv({ tail: ["--status", "FAILING", "--test", "t1"] }), deps }),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("still exits 3 when the absent credential's sentence is reworded — the exit is graded by code", async () => {
    const reworded = {
      ...VantaCredentialErrors.credentialUnset({ name: "VANTA_CLIENT_ID", secretName: "vanta-client-id" }),
      message: "VANTA_CLIENT_ID has no value yet — export it, or run: slopweaver secrets set vanta-client-id",
    };
    const deps: VantaTestEntitiesDeps = { createClient: () => err([reworded]) };
    expect(
      await runVantaTestEntitiesWith({ argv: argv({ tail: ["--status", "FAILING", "--test", "t1"] }), deps }),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("exits 1 for an unreadable credential file even when its cause happens to say 'is not set'", async () => {
    const unreadable = VantaCredentialErrors.fileUnreadable({
      cause: new Error("HOME is not set"),
      label: "--client-id-file",
      path: "/nowhere/client-id",
    });
    const deps: VantaTestEntitiesDeps = { createClient: () => err([unreadable]) };
    expect(unreadable.message).toBe("could not read --client-id-file at /nowhere/client-id: HOME is not set");
    expect(
      await runVantaTestEntitiesWith({ argv: argv({ tail: ["--status", "FAILING", "--test", "t1"] }), deps }),
    ).toBe(EXIT_ERROR);
  });
});
