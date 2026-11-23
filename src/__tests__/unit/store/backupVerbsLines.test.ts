/**
 * The backup verbs' rendered lines: what a backup and a restore print. Pure functions over report values, no Docker.
 * A night prints what it measured once, then one block per destination in list order. The `--sweep-only` lines are
 * `./backupVerbsSweepOnly.test.ts`; `--status` is `./backupStatus.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { backupLines, restoreLines } from "../../../cli/commands/store/backupLines.js";
import type { DestinationSendReport } from "../../../store/backup/sendStaging.js";
import {
  MAC,
  MANIFEST as manifest,
  nightFixture as night,
  SSD_PIN as PIN,
  SSD,
  sentFixture as sent,
} from "./backupReportFixture.js";

describe("a night's lines", () => {
  it("leads with how many destinations it reached, then prints each destination's own block in list order", () => {
    const lines = backupLines({
      report: night({
        destinations: [
          { destination: MAC, report: sent({ root: MAC.root }), status: "succeeded" },
          { destination: SSD, ejected: false, pin: PIN, status: "drive-not-plugged-in" },
        ],
      }),
    });
    expect(lines[0]).toBe("store backup: staged /home/backups/store/x and wrote it to 1 of 2 destination(s)");
    expect(lines[1]).toBe("  files first: 33 file(s), 8.8 KiB");
    expect(lines[2]).toBe("  database postgres — dump 269.4 MiB, storage tar 2.0 KiB, pg_dump (PostgreSQL) 17.6");
    expect(lines.slice(6)).toEqual([
      "  /Users/someone/backups: wrote /Users/someone/backups/slopweaver/x/ encrypted under backup key fp-0123abcd " +
        "(aes-256-gcm-stream-v1)",
      "    2 new blob(s) sent (1.0 KiB)",
      "    backup key wrapped under the master password at slopweaver/keys/fp-0123abcd.wrap",
      "    slopweaver/x/store.dump — 269.4 MiB, sha256 1d1af6c4bd2e…",
      "  /Volumes/FixtureDrive/backups: DRIVE NOT PLUGGED IN — the drive at /Volumes/FixtureDrive is not plugged in, " +
        "so nothing more reached it",
      "    the backup is staged on this machine; plug the drive in and `slopweaver store backup --sweep-only` sends it",
    ]);
    expect(lines).toContain(
      "  credentials NOT included — no master password; generate it once with " +
        "`slopweaver store backup --create-master-password`",
    );
  });

  it("names a failed destination and its reasons, and still prints the one after it", () => {
    const lines = backupLines({
      report: night({
        destinations: [
          { destination: SSD, errors: ["door refused: held"], status: "failed" },
          {
            destination: MAC,
            report: sent({ keyWrap: { state: "no-master-password" }, root: MAC.root }),
            status: "succeeded",
          },
        ],
      }),
    });
    expect(lines[0]).toBe("store backup: staged /home/backups/store/x and wrote it to 1 of 2 destination(s)");
    expect(lines.slice(6, 9)).toEqual([
      "  /Volumes/FixtureDrive/backups: FAILED",
      "    door refused: held",
      "  /Users/someone/backups: wrote /Users/someone/backups/slopweaver/x/ encrypted under backup key fp-0123abcd " +
        "(aes-256-gcm-stream-v1)",
    ]);
    expect(lines).toContain(
      "    backup key NOT wrapped here — only this Mac's Keychain opens it; generate the master password once with " +
        "`slopweaver store backup --create-master-password`",
    );
  });

  it("says a drive pulled mid-run was ejected, rather than absent", () => {
    const lines = backupLines({
      report: night({ destinations: [{ destination: SSD, ejected: true, pin: PIN, status: "drive-not-plugged-in" }] }),
    });
    expect(lines[0]).toBe("store backup: staged /home/backups/store/x and wrote it to 0 of 1 destination(s)");
    expect(lines[6]).toBe(
      "  /Volumes/FixtureDrive/backups: DRIVE NOT PLUGGED IN — the drive at /Volumes/FixtureDrive was ejected during " +
        "the run, so nothing more reached it",
    );
  });

  it("prints each chunked leg's cost and names every staging each destination never got", () => {
    const report = sent({ root: MAC.root });
    const chunked: DestinationSendReport = {
      ...report,
      dumpChunks: {
        chunks: 270,
        held: 266,
        sent: 4,
        sentRawBytes: 16 * 1024 * 1024,
        sentStoredBytes: 16 * 1024 * 1024,
      },
      files: {
        ...report.files,
        chunks: {
          chunks: 4400,
          held: 4390,
          sent: 10,
          sentRawBytes: 40 * 1024 * 1024,
          sentStoredBytes: 2 * 1024 * 1024,
        },
      },
    };
    const lines = backupLines({
      report: night({
        destinations: [{ destination: MAC, report: chunked, status: "succeeded" }],
        stranded: [
          { destination: MAC, names: ["2026-09-12T03-00-00-000Z", "2026-09-13T03-00-00-000Z"] },
          { destination: SSD, names: [] },
        ],
      }),
    });
    expect(lines.slice(7, 10)).toEqual([
      "    2 new blob(s) sent (1.0 KiB)",
      "    large files: 4400 chunk(s), 4390 already held, 10 sent (40.0 MiB as 2.0 MiB)",
      "    dump: 270 chunk(s), 266 already held, 4 sent (16.0 MiB as 16.0 MiB)",
    ]);
    expect(lines.at(-1)).toBe(
      "  2 earlier staging(s) /Users/someone/backups never got, left for `store backup --sweep-only`: " +
        "2026-09-12T03-00-00-000Z, 2026-09-13T03-00-00-000Z",
    );
  });

  it("says a run with no destination staged locally, and says nothing about chunks or stagings", () => {
    const lines = backupLines({ report: night({ destinations: [] }) });
    expect(lines[0]).toBe("store backup: staged locally at /home/backups/store/x (nothing written to a destination)");
    expect(lines.filter((line) => line.includes("staging") || line.includes("chunk"))).toEqual([]);
  });

  it("says how many files vanished mid-read, right under the files line, so an omission is never silent", () => {
    const lines = backupLines({ report: night({ destinations: [], vanished: 2 }) });
    expect(lines[1]).toBe("  files first: 33 file(s), 8.8 KiB");
    expect(lines[2]).toBe("  skipped 2 file(s) removed while the files leg was reading them");
  });

  it("names every protected source the walk left out, with the owner's reason, under the files line", () => {
    const skippedProtectedPaths = [
      { path: "/home/corpus/bronze/provider", why: "fixture: never read by a session" },
      { path: "/home/atlas/vendor", why: "fixture: second reason" },
    ];
    const lines = backupLines({ report: night({ destinations: [], skippedProtectedPaths }) });
    expect(lines[1]).toBe("  files first: 33 file(s), 8.8 KiB");
    expect(lines[2]).toBe(
      "  NOT backed up: /home/corpus/bronze/provider — the owner protects it from every session (fixture: never read by a session)",
    );
    expect(lines[3]).toBe(
      "  NOT backed up: /home/atlas/vendor — the owner protects it from every session (fixture: second reason)",
    );
  });

  it("prints no protection line on a night that pruned nothing", () => {
    const lines = backupLines({ report: night({ destinations: [] }) });
    expect(lines.filter((line) => line.includes("NOT backed up"))).toEqual([]);
  });
});

describe("a restore's lines", () => {
  it("leads with the verdict", () => {
    const lines = restoreLines({
      report: {
        comparison: { identical: false, tables: [{ live: 3, restored: 2, table: "public.content" }] },
        created: true,
        database: "proof",
        dropped: true,
        manifest,
        mode: "empty",
        source: { directory: "/x", kind: "directory" },
        storageMembers: ["./", "./stub"],
        storageRestored: false,
        vaultRows: null,
      },
    });
    expect(lines[0]).toBe("store restore: /x → database proof (created, empty mode) — dropped after the report");
    expect(lines[3]).toBe("  Vault: this backup carried no Vault leg");
    expect(lines[4]).toBe("  compared to live: DIFFERENT row counts");
    expect(lines[5]).toBe("    ≠ public.content: live 3, restored 2");
  });
});
