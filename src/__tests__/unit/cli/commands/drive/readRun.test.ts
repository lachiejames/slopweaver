/**
 * Unit: the three `drive` read shells over injected seams. What is under test is the dispatch — the exit
 * codes, the human-vs-`--json` choice, and the two refusals that happen BEFORE any seam is reached.
 */
import { describe, expect, it } from "vitest";
import {
  type DriveReadDeps,
  runDriveDrives,
  runDriveList,
  runDriveRead,
} from "../../../../../cli/commands/drive/readRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { DriveErrors } from "../../../../../live/drive/errors.js";
import type { DriveFile } from "../../../../../live/drive/files.js";
import type { ProviderReadDocument } from "../../../../../live/providerRead.js";

const FILE: DriveFile = {
  createdAtIso: "2026-08-01T09:00:00.000Z",
  driveId: undefined,
  id: "1Pdf",
  mimeType: "application/pdf",
  modifiedAtIso: "2026-09-01T09:00:00.000Z",
  name: "Budget.pdf",
  owners: ["me@example.test"],
  parents: [],
  shared: false,
  sizeBytes: 2048,
  trashed: false,
  webViewLink: undefined,
};

const DOCUMENT: ProviderReadDocument = {
  coverage: { detail: "detail", kind: "bounded", residue: [] },
  data: { marker: "payload" },
  readAtIso: "2026-09-05T12:00:00.000Z",
  source: "drive",
  target: { address: "a", identity: "me@example.test", kind: "search" },
};

/** Captured shell output plus the exact arguments each seam saw. */
interface Captured {
  readonly deps: DriveReadDeps;
  readonly out: string[];
  readonly diagnostics: string[];
  readonly calls: string[];
}

function fakeDeps({ fails = false }: { fails?: boolean } = {}): Captured {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const calls: string[] = [];
  return {
    calls,
    deps: {
      drives: async ({ home }) => {
        calls.push(`drives:${String(home)}`);
        return fails
          ? err(DriveErrors.notConnected())
          : ok({ document: DOCUMENT, vocabulary: { account: "me@example.test", drives: [] } });
      },
      list: async ({ home, query, driveId, limit }) => {
        calls.push(`list:${String(query)}:${String(driveId)}:${String(limit)}:${String(home)}`);
        return fails
          ? err(DriveErrors.notConnected())
          : ok({
              document: DOCUMENT,
              listing: { account: "me@example.test", driveId, files: [FILE], more: false, query },
            });
      },
      read: async ({ home, fileId, withText }) => {
        calls.push(`read:${fileId}:${String(withText)}:${String(home)}`);
        return fails
          ? err(DriveErrors.notConnected())
          : ok({ document: DOCUMENT, payload: { account: "me@example.test", file: FILE, text: undefined } });
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
  };
}

describe("runDriveList", () => {
  it("builds the Drive query from the flags and passes the built expression down", async () => {
    const captured = fakeDeps();
    const code = await runDriveList({ deps: captured.deps, rest: ["--folder", "1F", "--home", "/tmp/h"] });
    expect(code).toBe(EXIT_OK);
    expect(captured.calls).toStrictEqual(["list:trashed = false and '1F' in parents:undefined:25:/tmp/h"]);
  });

  it("emits the shared JSON document under --json, not the human rendering", async () => {
    const captured = fakeDeps();
    await runDriveList({ deps: captured.deps, rest: ["--json"] });
    expect(JSON.parse(captured.out[0]!)).toStrictEqual(DOCUMENT);
  });

  it("renders the human listing without --json", async () => {
    const captured = fakeDeps();
    await runDriveList({ deps: captured.deps, rest: [] });
    expect(captured.out[0]!).toContain("Budget.pdf");
  });

  it("refuses a bad limit WITHOUT reaching the seam", async () => {
    const captured = fakeDeps();
    const code = await runDriveList({ deps: captured.deps, rest: ["--limit", "0"] });
    expect(code).toBe(EXIT_USAGE);
    expect(captured.calls).toStrictEqual([]);
  });

  it("reports a seam failure on the error exit code", async () => {
    const captured = fakeDeps({ fails: true });
    const code = await runDriveList({ deps: captured.deps, rest: [] });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.diagnostics[0]).toContain("slopweaver drive connect");
  });
});

describe("runDriveRead", () => {
  it("extracts the file id out of a browser URL before the seam is reached", async () => {
    const captured = fakeDeps();
    const code = await runDriveRead({
      deps: captured.deps,
      rest: ["https://docs.google.com/document/d/1AbCdEfGhIjK/edit"],
    });
    expect(code).toBe(EXIT_OK);
    expect(captured.calls).toStrictEqual(["read:1AbCdEfGhIjK:true:undefined"]);
  });

  it("REFUSES an unparseable address as a usage fault, reaching no seam", async () => {
    const captured = fakeDeps();
    const code = await runDriveRead({ deps: captured.deps, rest: ["budget"] });
    expect(code).toBe(EXIT_USAGE);
    expect(captured.calls).toStrictEqual([]);
    expect(captured.diagnostics[0]).toContain("not a Drive file id");
  });

  it("passes --metadata-only through as a request for no text", async () => {
    const captured = fakeDeps();
    await runDriveRead({ deps: captured.deps, rest: ["1AbCdEfGhIjK", "--metadata-only"] });
    expect(captured.calls).toStrictEqual(["read:1AbCdEfGhIjK:false:undefined"]);
  });
});

describe("runDriveDrives", () => {
  it("renders the shared-drive vocabulary", async () => {
    const captured = fakeDeps();
    const code = await runDriveDrives({ deps: captured.deps, rest: [] });
    expect(code).toBe(EXIT_OK);
    expect(captured.out[0]!).toContain("no shared drives");
  });

  it("refuses an unknown flag without reaching the seam", async () => {
    const captured = fakeDeps();
    const code = await runDriveDrives({ deps: captured.deps, rest: ["--all"] });
    expect(code).toBe(EXIT_USAGE);
    expect(captured.calls).toStrictEqual([]);
  });
});
