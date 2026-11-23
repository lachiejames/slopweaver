import { describe, expect, it } from "vitest";

import { diskLine, diskReadingOf, parseDfKib, volumeFreeGb } from "../../../../live/machine/diskFootprint.js";

/**
 * This machine's own `df -k "$SLOPWEAVER_HOME"`, verbatim — the reading this whole module was
 * built for. Its `df -h` companion says `68Gi` avail at `93%` capacity, which is what pins both assertions
 * below: 93% is `df`'s own Capacity column and not `used / 1024-blocks` (that is 90%), and 72.9 GB is
 * `available × 1024 / 10^9` and not `available / 10^6` (that is 71.2).
 */
const REAL_DF =
  "Filesystem   1024-blocks      Used Available Capacity  iused     ifree %iused  Mounted on\n" +
  "/dev/disk3s5   971298980 878244236  71239176    93% 55084013 712391760    7%   /System/Volumes/Data\n";

describe("parseDfKib", () => {
  it("reads the volume's blocks and free space off a real report", () => {
    const volume = parseDfKib({ text: REAL_DF })!;
    expect(volume.totalKib).toBe(971_298_980);
    expect(volume.availableKib).toBe(71_239_176);
  });

  it("takes `df`'s own Capacity column, not used-over-blocks, which is three points lower", () => {
    expect(parseDfKib({ text: REAL_DF })!.usedPct).toBe(93);
  });

  it("answers undefined when the read failed outright", () => {
    expect(parseDfKib({ text: undefined })).toBeUndefined();
  });

  it("answers undefined for a header with no data row", () => {
    expect(parseDfKib({ text: "Filesystem 1024-blocks Used Available Capacity Mounted on\n" })).toBeUndefined();
  });

  it("answers undefined for empty output rather than a volume of size zero", () => {
    expect(parseDfKib({ text: "" })).toBeUndefined();
  });

  it("answers undefined when the row's numbers are not numbers", () => {
    expect(parseDfKib({ text: "Filesystem blocks\n/dev/disk3s5 - - - - /\n" })).toBeUndefined();
  });

  it("reads the LAST row, so a wrapped device name does not shift every column", () => {
    const wrapped =
      "Filesystem 1024-blocks Used Available Capacity Mounted on\n" +
      "map auto_home 0 0 0 100% /System/Volumes/Data/home\n" +
      "/dev/disk3s5 1000 250 750 25% /\n";
    const volume = parseDfKib({ text: wrapped })!;
    expect(volume.usedPct).toBe(25);
    expect(volume.availableKib).toBe(750);
  });
});

describe("volumeFreeGb", () => {
  it("reports this machine's own free space in the GB a reader sees in Finder", () => {
    expect(volumeFreeGb({ volume: parseDfKib({ text: REAL_DF }) })).toBe(72.9);
  });

  it("answers undefined when there is no reading, never zero GB free", () => {
    expect(volumeFreeGb({ volume: undefined })).toBeUndefined();
  });
});

describe("diskReadingOf", () => {
  it("totals the registrations across every repository that answered", () => {
    const reading = diskReadingOf({
      repos: [
        { registered: 767, repoRoot: "/dev/slopweaver" },
        { registered: 105, repoRoot: "/dev/acme-admin" },
      ],
      volume: undefined,
    });
    expect(reading.registeredTotal).toBe(872);
  });

  it("totals only what answered, leaving the unreadable repository in the list", () => {
    const reading = diskReadingOf({
      repos: [
        { registered: 767, repoRoot: "/dev/slopweaver" },
        { registered: null, repoRoot: "/dev/acme-admin" },
      ],
      volume: undefined,
    });
    expect(reading.registeredTotal).toBe(767);
    expect(reading.repos).toEqual([
      { registered: 767, repoRoot: "/dev/slopweaver" },
      { registered: null, repoRoot: "/dev/acme-admin" },
    ]);
  });

  it("answers UNDEFINED when nothing could be counted — never zero worktrees", () => {
    const reading = diskReadingOf({ repos: [{ registered: null, repoRoot: "/dev/slopweaver" }], volume: undefined });
    expect(reading.registeredTotal).toBeUndefined();
  });

  it("answers undefined when no repository is declared at all", () => {
    expect(diskReadingOf({ repos: [], volume: undefined }).registeredTotal).toBeUndefined();
  });

  it("carries the volume through untouched", () => {
    const volume = parseDfKib({ text: REAL_DF })!;
    expect(diskReadingOf({ repos: [], volume }).volume).toEqual(volume);
  });
});

describe("diskLine", () => {
  it("prints the volume and the per-repository counts, with the total first", () => {
    const line = diskLine({
      reading: diskReadingOf({
        repos: [
          { registered: 767, repoRoot: "/dev/slopweaver" },
          { registered: 105, repoRoot: "/dev/acme-admin" },
        ],
        volume: { availableKib: 71_239_176, totalKib: 971_298_980, usedPct: 93 },
      }),
    });
    expect(line).toBe(
      "disk: 93% used, 72.9 GB free; 872 registered worktree(s) — /dev/slopweaver 767, /dev/acme-admin 105",
    );
  });

  it("names an unreadable repository as UNREADABLE rather than reporting it at zero", () => {
    const line = diskLine({
      reading: diskReadingOf({
        repos: [
          { registered: 767, repoRoot: "/dev/slopweaver" },
          { registered: null, repoRoot: "/dev/acme-admin" },
        ],
        volume: undefined,
      }),
    });
    expect(line).toBe("disk: 767 registered worktree(s) — /dev/slopweaver 767, /dev/acme-admin UNREADABLE");
  });

  it("prints the volume alone when no repository is declared", () => {
    const line = diskLine({
      reading: diskReadingOf({ repos: [], volume: { availableKib: 976_563, totalKib: 10_000_000, usedPct: 90 } }),
    });
    expect(line).toBe("disk: 90% used, 1 GB free");
  });

  it("answers undefined when NEITHER half could be read, so no line is printed at all", () => {
    expect(diskLine({ reading: diskReadingOf({ repos: [], volume: undefined }) })).toBeUndefined();
  });
});
