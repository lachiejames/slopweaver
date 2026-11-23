/**
 * Which members of an export are its conversations files, refused when the set is unsafe or is two exports, and
 * which zip in a folder is the newest export. The process edges are a plain fake: no test launches `unzip`.
 */
import { chmodSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type ChatgptArchiveDeps,
  findExportArchives,
  isZipFile,
  selectConversationMembers,
} from "../../../../corpus/chatgpt/archive.js";
import { type ChatgptExportError, ChatgptExportErrors } from "../../../../corpus/chatgpt/errors.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

/** The four bytes every zip with members opens with. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp directory, removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-archive-"));
  dirs.push(dir);
  return dir;
}

/** Archive edges that list each zip from a table and refuse one the table lacks. */
function listingDeps({ listings }: { listings: Readonly<Record<string, readonly string[]>> }): ChatgptArchiveDeps {
  return {
    extractZipMember: ({ zipPath }) =>
      err(ChatgptExportErrors.archiveUnreadable({ detail: "not in this test", path: zipPath })),
    listZip: ({ zipPath }) => {
      const names = listings[zipPath];
      if (names === undefined) {
        return err(
          ChatgptExportErrors.archiveUnreadable({
            detail: "End-of-central-directory signature not found",
            path: zipPath,
          }),
        );
      }
      return ok(names);
    },
  };
}

describe("selectConversationMembers", () => {
  it("takes the single file at the top level and ignores everything else in the export", () => {
    const members = unwrap(
      selectConversationMembers({
        names: ["chat.html", "user.json", "conversations.json", "file-abc.png"],
        path: "e.zip",
      }),
    );
    expect(members).toEqual([{ member: "conversations.json", name: "conversations.json" }]);
  });

  it("orders a numbered run by number, with either separator", () => {
    const members = unwrap(
      selectConversationMembers({
        names: ["conversations-002.json", "conversations_001.json", "conversations-000.json"],
        path: "e.zip",
      }),
    );
    expect(members.map((member) => member.name)).toEqual([
      "conversations-000.json",
      "conversations_001.json",
      "conversations-002.json",
    ]);
  });

  it("refuses a numbered run with a number missing, so a whole file is never read short behind a receipt", () => {
    const refusals = [
      ["conversations-000.json", "conversations-002.json"],
      ["conversations-001.json", "conversations-002.json"],
      ["conversations-001.json"],
    ].map((names) => unwrapErr(selectConversationMembers({ names, path: "e.zip" })).message);
    expect(refusals).toEqual(
      [
        ["conversations-000.json", 1],
        ["conversations-001.json", 0],
        ["conversations-001.json", 0],
      ].map(
        ([member, missing]) =>
          ChatgptExportErrors.unsafeMember({
            member: String(member),
            why: `a numbered run with no file numbered ${String(missing)}, so a whole file of the owner's history would go unread`,
          }).message,
      ),
    );
  });

  it("accepts one folder down — a re-zipped export folder", () => {
    const members = unwrap(
      selectConversationMembers({ names: ["export/conversations.json", "export/chat.html"], path: "e.zip" }),
    );
    expect(members).toEqual([{ member: "export/conversations.json", name: "conversations.json" }]);
  });

  it("refuses a conversations file it would otherwise skip, so no history goes unread behind a receipt", () => {
    const refusals = [
      ["export/conversations.json", "export/deep/conversations-001.json"],
      ["conversations.json", "conversations-000.json"],
      ["conversations-1.json", "conversations-001.json"],
    ].map((names) => unwrapErr(selectConversationMembers({ names, path: "e.zip" })));
    expect(refusals).toEqual([
      ChatgptExportErrors.unsafeMember({
        member: "export/deep/conversations-001.json",
        why: "a conversations file deeper than one folder down",
      }),
      ChatgptExportErrors.unsafeMember({
        member: "conversations.json",
        why: "a single conversations file beside a numbered run",
      }),
      ChatgptExportErrors.unsafeMember({
        member: "conversations-001.json",
        why: "a second conversations file with the same number",
      }),
    ]);
  });

  it("refuses a candidate that climbs out of the archive or is absolute", () => {
    expect(unwrapErr(selectConversationMembers({ names: ["../conversations.json"], path: "e.zip" })).code).toBe(
      "UNSAFE_MEMBER",
    );
    expect(unwrapErr(selectConversationMembers({ names: ["/conversations.json"], path: "e.zip" })).code).toBe(
      "UNSAFE_MEMBER",
    );
    expect(unwrapErr(selectConversationMembers({ names: ["a\\conversations.json"], path: "e.zip" })).code).toBe(
      "UNSAFE_MEMBER",
    );
  });

  it("refuses two exports in one archive rather than merging them", () => {
    expect(
      unwrapErr(
        selectConversationMembers({ names: ["a/conversations.json", "b/conversations-001.json"], path: "e.zip" }),
      ).message,
    ).toContain("conversations files under two folders");
    expect(
      unwrapErr(selectConversationMembers({ names: ["conversations.json", "a/conversations.json"], path: "e.zip" }))
        .message,
    ).toContain("a second member with the same file name");
  });

  it("refuses an archive with no conversations file as not an export", () => {
    expect(
      unwrapErr(
        selectConversationMembers({ names: ["notes.json", "chat.css", "shared_conversations.json"], path: "e.zip" }),
      ),
    ).toEqual(ChatgptExportErrors.notAnExport({ path: "e.zip" }));
  });

  it("refuses an export whose conversations it does not know by name, never passing it over as not an export", () => {
    const refusals = [
      ["chat.html", "user.json", "conversations-part-000.json"],
      ["Conversations.JSON"],
      ["export/chat.html", "export/user.json"],
      ["CHAT.HTML"],
    ].map((names) => unwrapErr(selectConversationMembers({ names, path: "e.zip" })));
    const unknownName =
      "a conversations file named in a shape this reader does not know, so its history would go unread";
    const pageOnly =
      "a ChatGPT export's page with no conversations file this reader knows beside it, so its history would go unread";
    expect(refusals).toEqual([
      ChatgptExportErrors.unsafeMember({ member: "conversations-part-000.json", why: unknownName }),
      ChatgptExportErrors.unsafeMember({ member: "Conversations.JSON", why: unknownName }),
      ChatgptExportErrors.unsafeMember({ member: "export/chat.html", why: pageOnly }),
      ChatgptExportErrors.unsafeMember({ member: "CHAT.HTML", why: pageOnly }),
    ]);
  });
});

describe("isZipFile", () => {
  it("knows a zip by its first bytes, whatever it is called", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "export.bin"), Buffer.concat([ZIP_MAGIC, Buffer.from("rest")]));
    writeFileSync(join(dir, "fake.zip"), "[]");
    expect(isZipFile({ path: join(dir, "export.bin") })).toBe(true);
    expect(isZipFile({ path: join(dir, "fake.zip") })).toBe(false);
  });
});

describe("findExportArchives", () => {
  it("answers every zip that holds an export, newest first, passing over one that is not", () => {
    const dir = tempDir();
    const older = join(dir, "older-export.zip");
    const exportZip = join(dir, "export.zip");
    const photos = join(dir, "photos.zip");
    for (const [path, seconds] of [
      [older, 1_000],
      [exportZip, 2_000],
      [photos, 3_000],
    ] as const) {
      writeFileSync(path, ZIP_MAGIC);
      utimesSync(path, seconds, seconds);
    }
    const archive = listingDeps({
      listings: { [exportZip]: ["conversations.json"], [older]: ["conversations.json"], [photos]: ["a.jpg"] },
    });
    expect(unwrap(findExportArchives({ archive, dir }))).toEqual([exportZip, older]);
  });

  it("answers none when no zip there is an export", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "photos.zip"), ZIP_MAGIC);
    writeFileSync(join(dir, "notes.txt"), "x");
    const archive = listingDeps({ listings: { [join(dir, "photos.zip")]: ["a.jpg"] } });
    expect(unwrap(findExportArchives({ archive, dir }))).toEqual([]);
  });

  it("refuses a zip that will not list, naming it, rather than answering the readable export beside it", () => {
    const dir = tempDir();
    const exportZip = join(dir, "export.zip");
    const broken = join(dir, "newer-export.zip");
    writeFileSync(exportZip, ZIP_MAGIC);
    writeFileSync(broken, ZIP_MAGIC);
    utimesSync(exportZip, 1_000, 1_000);
    utimesSync(broken, 2_000, 2_000);
    const archive = listingDeps({ listings: { [exportZip]: ["conversations.json"] } });
    const refused = unwrapErr(findExportArchives({ archive, dir }));
    expect([refused.code, refused.message]).toEqual([
      "UNLISTABLE_ZIP",
      `could not read the archive ${broken}: End-of-central-directory signature not found — so whether that zip ` +
        "is a newer export cannot be told, and nothing is called current while it sits unread; download the " +
        "export again, or move this zip out of the folder",
    ]);
  });

  it("refuses a zip that will not list however many newer zips sit in front of it", () => {
    const dir = tempDir();
    const broken = join(dir, "chatgpt-export.zip");
    writeFileSync(broken, ZIP_MAGIC);
    utimesSync(broken, 1_000, 1_000);
    const listings: Record<string, readonly string[]> = {};
    for (let index = 0; index < 25; index += 1) {
      const path = join(dir, `photos-${String(index)}.zip`);
      writeFileSync(path, ZIP_MAGIC);
      utimesSync(path, 2_000 + index, 2_000 + index);
      listings[path] = ["a.jpg"];
    }
    const refused = unwrapErr(findExportArchives({ archive: listingDeps({ listings }), dir }));
    expect([refused.code, refused.message]).toEqual([
      "UNLISTABLE_ZIP",
      `could not read the archive ${broken}: End-of-central-directory signature not found — so whether that zip ` +
        "is a newer export cannot be told, and nothing is called current while it sits unread; download the " +
        "export again, or move this zip out of the folder",
    ]);
  });

  it("refuses a zip it can see but cannot stat, rather than answering no export at all", () => {
    // A folder readable but not searchable lists its names and refuses every stat under it.
    const dir = tempDir();
    writeFileSync(join(dir, "newer-export.zip"), ZIP_MAGIC);
    chmodSync(dir, 0o400);
    let refused: ChatgptExportError;
    try {
      refused = unwrapErr(findExportArchives({ archive: listingDeps({ listings: {} }), dir }));
    } finally {
      chmodSync(dir, 0o700);
    }
    expect([refused.code, refused.message]).toEqual([
      "UNLISTABLE_ZIP",
      `could not read the archive ${join(dir, "newer-export.zip")}: EACCES: permission denied, stat ` +
        `'${join(dir, "newer-export.zip")}' — so whether that zip is a newer export cannot be told, and nothing is ` +
        "called current while it sits unread; download the export again, or move this zip out of the folder",
    ]);
  });

  it("refuses a zip that lists conversations files but not as one export, rather than passing it over", () => {
    // Passed over, a sync would call the older corpus current while the export the owner just downloaded sat unread.
    const dir = tempDir();
    const good = join(dir, "export.zip");
    const short = join(dir, "export-missing-a-file.zip");
    for (const [path, seconds] of [
      [good, 1_000],
      [short, 2_000],
    ] as const) {
      writeFileSync(path, ZIP_MAGIC);
      utimesSync(path, seconds, seconds);
    }
    const archive = listingDeps({
      listings: { [good]: ["conversations.json"], [short]: ["conversations-000.json", "conversations-002.json"] },
    });
    const why = "a numbered run with no file numbered 1, so a whole file of the owner's history would go unread";
    expect(unwrapErr(findExportArchives({ archive, dir }))).toEqual(
      ChatgptExportErrors.malformedExport({
        detail: ChatgptExportErrors.unsafeMember({ member: "conversations-000.json", why }).message,
        path: short,
      }),
    );
  });

  it("refuses a newer export whose conversations file it does not know by name, rather than passing it over", () => {
    const dir = tempDir();
    const good = join(dir, "export.zip");
    const renamed = join(dir, "export-newer.zip");
    for (const [path, seconds] of [
      [good, 1_000],
      [renamed, 2_000],
    ] as const) {
      writeFileSync(path, ZIP_MAGIC);
      utimesSync(path, seconds, seconds);
    }
    const archive = listingDeps({
      listings: { [good]: ["conversations.json"], [renamed]: ["chat.html", "conversations-part-000.json"] },
    });
    const why = "a conversations file named in a shape this reader does not know, so its history would go unread";
    expect(unwrapErr(findExportArchives({ archive, dir }))).toEqual(
      ChatgptExportErrors.malformedExport({
        detail: ChatgptExportErrors.unsafeMember({ member: "conversations-part-000.json", why }).message,
        path: renamed,
      }),
    );
  });

  it("refuses a folder that does not exist, naming it", () => {
    const missing = join(tempDir(), "nope");
    expect(unwrapErr(findExportArchives({ archive: listingDeps({ listings: {} }), dir: missing }))).toEqual(
      ChatgptExportErrors.exportPathMissing({ path: missing }),
    );
  });
});
