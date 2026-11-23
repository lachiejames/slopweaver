/**
 * The production archive edge (`corpus/chatgpt/archive.ts#unzipArchiveDeps`) against the real `/usr/bin/unzip`: a
 * member that inflates past the bytes allowed it is stopped by the kernel WHILE it is written, and the take-in that
 * asked for it leaves nothing behind. The zip is built here, byte by byte, so no fixture binary is committed: one
 * `conversations.json` of 3 MiB of spaces deflates to a few kilobytes — a small zip bomb.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { type ChatgptArchiveDeps, unzipArchiveDeps } from "../../../corpus/chatgpt/archive.js";
import { ChatgptExportErrors } from "../../../corpus/chatgpt/errors.js";
import { importChatgptExport } from "../../../corpus/chatgpt/exportStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** What the one member inflates to. */
const INFLATED_BYTES = 3 * 1024 * 1024;

/** The budget the bounded extractions are held to — a third of what the member inflates to. */
const BUDGET_BYTES = 1024 * 1024;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp directory, removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-unzip-"));
  dirs.push(dir);
  return dir;
}

/** A one-member deflated zip: local header, data, central directory, end record — made on Unix with `mode` when given. */
function oneMemberZip({ name, contents, mode }: { name: string; contents: Buffer; mode?: number }): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const data = deflateRawSync(contents);
  const checksum = crc32(contents);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(contents.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(contents.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  if (mode !== undefined) {
    // Version made by: Unix (3) in the high byte, so `unzip` reads the external attributes' high half as a mode.
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt32LE(mode * 0x10000, 38);
  }
  const centralOffset = local.length + nameBytes.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
}

/** A zip on disk whose one `conversations.json` inflates to {@link INFLATED_BYTES} of spaces. */
function bombZip(): string {
  const path = join(tempDir(), "chatgpt-export.zip");
  writeFileSync(path, oneMemberZip({ contents: Buffer.alloc(INFLATED_BYTES, " "), name: "conversations.json" }));
  return path;
}

describe("unzipArchiveDeps.extractZipMember", () => {
  it("writes a member whole when it fits the bytes allowed it, exactly at the limit included", () => {
    const zipPath = bombZip();
    expect(statSync(zipPath).size).toBeLessThan(BUDGET_BYTES);
    const toPath = join(tempDir(), "conversations.json");
    unwrap(
      unzipArchiveDeps.extractZipMember({ maxBytes: INFLATED_BYTES, member: "conversations.json", toPath, zipPath }),
    );
    expect(statSync(toPath).size).toBe(INFLATED_BYTES);
  });

  it("reports an archive unzip cannot read as unreadable, never as too large", () => {
    const zipPath = join(tempDir(), "chatgpt-export.zip");
    writeFileSync(zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]));
    const toPath = join(tempDir(), "conversations.json");
    const refused = unwrapErr(
      unzipArchiveDeps.extractZipMember({ maxBytes: BUDGET_BYTES, member: "conversations.json", toPath, zipPath }),
    );
    expect(refused.code).toBe("ARCHIVE_UNREADABLE");
  });

  it("stops a member at the bytes allowed it, never writing past them", () => {
    const zipPath = bombZip();
    const toPath = join(tempDir(), "conversations.json");
    const refused = unwrapErr(
      unzipArchiveDeps.extractZipMember({ maxBytes: BUDGET_BYTES, member: "conversations.json", toPath, zipPath }),
    );
    expect(refused.code).toBe("EXPORT_TOO_LARGE");
    expect(refused.message).toContain(`past the ${String(BUDGET_BYTES)} bytes allowed them`);
    // One byte past the budget is how an over-long member is told from one exactly at it, and all that is written.
    expect(statSync(toPath).size).toBe(BUDGET_BYTES + 1);
  });

  it("refuses a member stored as a symbolic link, whose target `unzip -p` would write as its contents", () => {
    const zipFor = ({ mode }: { mode: number }): string => {
      const path = join(tempDir(), "chatgpt-export.zip");
      writeFileSync(path, oneMemberZip({ contents: Buffer.from("[]"), mode, name: "conversations.json" }));
      return path;
    };
    const linkTo = join(tempDir(), "conversations.json");
    const refused = unwrapErr(
      unzipArchiveDeps.extractZipMember({
        maxBytes: BUDGET_BYTES,
        member: "conversations.json",
        toPath: linkTo,
        zipPath: zipFor({ mode: 0o120777 }),
      }),
    );
    expect(refused).toEqual(ChatgptExportErrors.unsafeMember({ member: "conversations.json", why: "a symbolic link" }));
    expect(existsSync(linkTo)).toBe(false);
    const fileTo = join(tempDir(), "conversations.json");
    unwrap(
      unzipArchiveDeps.extractZipMember({
        maxBytes: BUDGET_BYTES,
        member: "conversations.json",
        toPath: fileTo,
        zipPath: zipFor({ mode: 0o100644 }),
      }),
    );
    expect(readFileSync(fileTo, "utf8")).toBe("[]");
  });
});

describe("importChatgptExport over the bounded edge", () => {
  it("refuses the export and leaves no staging directory and no held export behind", () => {
    const root = join(tempDir(), "exports");
    // The real edge, its budget lowered to one this disk can show being enforced.
    const bounded: ChatgptArchiveDeps = {
      ...unzipArchiveDeps,
      extractZipMember: (args) => unzipArchiveDeps.extractZipMember({ ...args, maxBytes: BUDGET_BYTES }),
    };
    const refused = unwrapErr(
      importChatgptExport({ archive: bounded, from: bombZip(), nowIso: "2026-10-17T00:00:00.000Z", root }),
    );
    expect(refused.code).toBe("EXPORT_TOO_LARGE");
    expect(readdirSync(root)).toEqual([]);
  });
});
