/**
 * The secrets-store read behind the disconnected-integration hold: a row needing an integration is held while the
 * store lacks its credential, freed once it is stored, and never held when the store will not list.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readDisconnected } from "../../../cli/commands/handover/disconnectedRead.js";
import { tokenFromEnvOrHomeFile } from "../../../config.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "disconnected-read-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const nowIso = "2026-11-04T12:00:00.000Z";

/** One ready doc declaring `needs=fathom`, on a board of its own. */
function needsFathomBoard(): readonly BoardModel[] {
  const text = ["---", "slug: meeting-notes", "kind: doc", "status: ready", "summary: notes", "---", "", "# notes"];
  const docs = [parseHandoverDoc({ path: "/h/meeting-notes.md", text: text.join("\n") })];
  const tagged: RunEvent = {
    atIso: "2026-11-04T07:00:00.000Z",
    drop: [],
    kind: "tagged",
    set: [{ key: "needs", value: "fathom" }],
    why: "its first read is a recorded call",
  };
  const journals = new Map([["meeting-notes", { events: [tagged], unreadableLines: [] }]]);
  return composeBoardModels({ journals, probeStates: new Map(), resolutionDocs: docs, roots: docs });
}

describe("readDisconnected", () => {
  it("holds the row while the store lacks the credential, and frees it once the credential is stored", () => {
    mkdirSync(join(home, "secrets"));
    const before = readDisconnected({ home, models: needsFathomBoard(), nowIso });
    writeFileSync(join(home, "secrets", "fathom-api-key"), "x", { mode: 0o600 });
    const after = readDisconnected({ home, models: needsFathomBoard(), nowIso });

    expect([[...before.held.keys()], before.unread, after.held.size, after.unread]).toEqual([
      ["/h/meeting-notes.md"],
      undefined,
      0,
      undefined,
    ]);
  });

  it("keeps holding the row while the credential file stands blank, as the credential reader reads it", () => {
    mkdirSync(join(home, "secrets"));
    writeFileSync(join(home, "secrets", "fathom-api-key"), "", { mode: 0o600 });
    const empty = readDisconnected({ home, models: needsFathomBoard(), nowIso });
    writeFileSync(join(home, "secrets", "fathom-api-key"), "  \n", { mode: 0o600 });
    const whitespace = readDisconnected({ home, models: needsFathomBoard(), nowIso });

    expect([[...empty.held.keys()], empty.unread, [...whitespace.held.keys()], whitespace.unread]).toEqual([
      ["/h/meeting-notes.md"],
      undefined,
      ["/h/meeting-notes.md"],
      undefined,
    ]);
  });

  // On a case-insensitive volume (the owner's Mac) the reader opens `fathom-api-key` through a file spelled
  // `FATHOM-API-KEY` and the row must be free; on a case-sensitive one (CI) neither finds it and the row is held.
  // Either way the hold has to agree with the reader, which is the property.
  it("agrees with the credential reader on a credential file spelled in another case", () => {
    mkdirSync(join(home, "secrets"));
    writeFileSync(join(home, "secrets", "FATHOM-API-KEY"), "x", { mode: 0o600 });
    const read = readDisconnected({ home, models: needsFathomBoard(), nowIso });
    const token = tokenFromEnvOrHomeFile({ env: {}, envNames: [], home, secretName: "fathom-api-key" });

    expect([read.held.size === 0, read.unread]).toEqual([token !== undefined, undefined]);
  });

  it("holds nothing and says why when the store will not list", () => {
    writeFileSync(join(home, "secrets"), "not a directory");
    const read = readDisconnected({ home, models: needsFathomBoard(), nowIso });

    expect(read.held.size).toBe(0);
    expect(read.unread).toContain("could not list the secrets store at");
  });
});
