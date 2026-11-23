import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { alreadyInEnding, certifiedEnding } from "../../../../../cli/commands/chatgpt/syncEnding.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { ChatgptExportErrors } from "../../../../../corpus/chatgpt/errors.js";
import { readCertifiedAsOf } from "../../../../../corpus/chatgpt/exportAsOf.js";
import { heldExports, importChatgptExport, type StoredExport } from "../../../../../corpus/chatgpt/exportStore.js";
import { err, unwrap } from "../../../../../lib/result.js";
import { FUTURE, syntheticExportAt } from "../../../../chatgptFixture.js";

/** The synthetic export, dated past every clock here so an import dates it at its own `nowIso`. */
const FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** An export root holding the synthetic export, taken in at a fixed instant. */
function held(): { root: string; newest: StoredExport } {
  const root = mkdtempSync(join(tmpdir(), "chatgpt-ending-"));
  dirs.push(root);
  const archive = {
    extractZipMember: ({ zipPath }: { zipPath: string }) =>
      err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
    listZip: ({ zipPath }: { zipPath: string }) =>
      err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
  };
  unwrap(importChatgptExport({ archive, from: FIXTURE, nowIso: "2026-10-16T03:00:00.000Z", root }));
  return { newest: heldExports({ root }).exports[0]!, root };
}

describe("alreadyInEnding", () => {
  it("answers 3 inside the day and certifies the export's own instant", () => {
    const { root, newest } = held();
    const asOfIso = "2026-10-16T03:00:00.000Z";
    expect(alreadyInEnding({ asOfIso, newest, nowIso: "2026-10-17T02:59:59.000Z", root })).toBe(EXIT_EXPECTED_EMPTY);
    expect(unwrap(readCertifiedAsOf({ root }))).toBe(asOfIso);
  });

  it("defers past the day and certifies nothing", () => {
    const { root, newest } = held();
    const asOfIso = "2026-10-16T03:00:00.000Z";
    expect(alreadyInEnding({ asOfIso, newest, nowIso: "2026-10-17T03:00:00.000Z", root })).toBe(EXIT_DEFERRED);
    expect(existsSync(join(root, "as-of.json"))).toBe(false);
  });
});

describe("certifiedEnding", () => {
  it("answers the code it was given once the instant is recorded", () => {
    const { root, newest } = held();
    expect(certifiedEnding({ asOfIso: "2026-10-16T03:00:00.000Z", code: EXIT_OK, newest, root })).toBe(EXIT_OK);
    expect(unwrap(readCertifiedAsOf({ root }))).toBe("2026-10-16T03:00:00.000Z");
  });

  it("fails a sync whose instant cannot be recorded, never answering the code it earned", () => {
    const { root, newest } = held();
    mkdirSync(join(root, "as-of.json"));
    expect(certifiedEnding({ asOfIso: "2026-10-16T03:00:00.000Z", code: EXIT_OK, newest, root })).toBe(EXIT_ERROR);
  });
});
