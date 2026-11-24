/**
 * The take-in's byte budget: the export ceiling or the disk's free space less the reserve, refusing a conversations
 * file past what is left, and handed to a zip's extraction as one budget for the whole export.
 */
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ChatgptArchiveDeps } from "../../../../../corpus/chatgpt/archive.js";
import { ChatgptExportErrors } from "../../../../../corpus/chatgpt/errors.js";
import { exportBudgetBytes, resolveMemberSource, stageMember } from "../../../../../corpus/chatgpt/exportSource.js";
import { importChatgptExport } from "../../../../../corpus/chatgpt/exportStore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { FUTURE, syntheticExportAt } from "../../../../chatgptFixture.js";
import { UNPROTECTED } from "../../../../noProtection.js";
import { fakeZip, NO_ZIP, tempDir, useTempDirs, ZIP_MAGIC } from "./harness.js";

/** The synthetic export, dated past every clock here so an import dates it at its own `nowIso`. */
const FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

useTempDirs();

describe("the take-in's byte budget", () => {
  it("is the export ceiling, or the disk's free space less the reserve, whichever is less, never below zero", () => {
    const gib = 1024 ** 3;
    expect(exportBudgetBytes({ freeBytes: 100 * gib })).toBe(8 * gib);
    expect(exportBudgetBytes({ freeBytes: 3 * gib })).toBe(gib);
    expect(exportBudgetBytes({ freeBytes: gib })).toBe(0);
  });

  it("refuses a conversations file past what is left of it, copying nothing", () => {
    const source = unwrap(resolveMemberSource({ archive: NO_ZIP, from: FIXTURE }));
    const toPath = join(tempDir(), "conversations-000.json");
    const refused = unwrapErr(
      stageMember({ archive: NO_ZIP, maxBytes: 100, member: source.members[0]!, source, toPath }),
    );
    expect(refused).toEqual(
      ChatgptExportErrors.exportTooLarge({ limitBytes: 100, path: join(FIXTURE, "conversations-000.json") }),
    );
    expect(existsSync(toPath)).toBe(false);
  });

  it("hands a zip's extraction the budget the disk allows, so the edge can hold it to that", () => {
    const zip = join(tempDir(), "export.zip");
    writeFileSync(zip, ZIP_MAGIC);
    const asked: number[] = [];
    const counting = fakeZip({ contents: FIXTURE, zipPath: zip });
    const archive: ChatgptArchiveDeps = {
      ...counting,
      extractZipMember: (args) => {
        asked.push(args.maxBytes);
        return counting.extractZipMember(args);
      },
    };
    const root = join(tempDir(), "exports");
    unwrap(importChatgptExport({ ...UNPROTECTED, archive, from: zip, nowIso: "2026-10-17T00:00:00.000Z", root }));
    expect(asked.length).toBe(2);
    expect(asked[0]!).toBeGreaterThan(0);
    // The second member is offered what the first left: the budget is one for the whole export.
    expect(asked[0]! - asked[1]!).toBe(statSync(join(FIXTURE, "conversations-000.json")).size);
  });
});
