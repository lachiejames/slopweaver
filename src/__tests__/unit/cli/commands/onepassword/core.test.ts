import { describe, expect, it } from "vitest";

import type { OnepasswordSyncReport } from "../../../../../atlas/onepassword/sync.js";
import {
  exitCodeForOnepasswordSyncReport,
  onepasswordSinceFor,
  onepasswordSyncFailureClosingLine,
  parseOnepasswordSyncOptions,
  renderOnepasswordChannelLines,
  renderOnepasswordSyncLines,
  renderOnepasswordTailLines,
} from "../../../../../cli/commands/onepassword/core.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseOnepasswordSyncOptions", () => {
  it("defaults home, json and since when no flag is given", () => {
    expect(unwrap(parseOnepasswordSyncOptions({ defaultHome: "/tmp/default-home", rest: [] }))).toEqual({
      home: "/tmp/default-home",
      json: false,
      since: null,
    });
  });

  it("honours an explicit --home, --json and --since", () => {
    const options = unwrap(
      parseOnepasswordSyncOptions({
        defaultHome: "/tmp/default-home",
        rest: ["--home", "/tmp/other", "--json", "--since", "2026-08-01T00:00:00Z"],
      }),
    );
    expect(options).toEqual({ home: "/tmp/other", json: true, since: "2026-08-01T00:00:00Z" });
  });

  it("refuses a --since that is not a timestamp", () => {
    const result = parseOnepasswordSyncOptions({ defaultHome: "/tmp/x", rest: ["--since", "last tuesday"] });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("is not an ISO timestamp");
  });

  it("refuses an unknown flag", () => {
    const result = parseOnepasswordSyncOptions({ defaultHome: "/tmp/x", rest: ["--bogus"] });
    expect(unwrapErr(result)).toEqual(["unknown flag: --bogus"]);
  });
});

describe("onepasswordSinceFor", () => {
  it("passes an explicit --since through untouched", () => {
    expect(onepasswordSinceFor({ at: "2026-08-29T00:00:00.000Z", since: "2026-01-01T00:00:00Z" })).toBe(
      "2026-01-01T00:00:00Z",
    );
  });

  it("defaults to thirty days before the run", () => {
    expect(onepasswordSinceFor({ at: "2026-08-29T00:00:00.000Z", since: null })).toBe("2026-07-30T00:00:00.000Z");
  });
});

const report = ({
  adminCliConfigured,
  eventsConfigured,
  kinds,
}: Pick<OnepasswordSyncReport, "adminCliConfigured" | "eventsConfigured" | "kinds">): OnepasswordSyncReport => ({
  adminCliConfigured,
  eventsConfigured,
  kinds,
  lockReleaseError: null,
  readmePath: "<home>/atlas/onepassword/README.md",
  reportedFindings: [],
});

const kind = ({ complete }: { complete: boolean }) => ({
  complete,
  entityCount: complete ? 4 : 0,
  kind: "user" as const,
  reasons: complete ? [] : ["no usable `op` session"],
});

describe("exitCodeForOnepasswordSyncReport", () => {
  it("is EXIT_EXPECTED_EMPTY when NEITHER credential is configured", () => {
    expect(
      exitCodeForOnepasswordSyncReport({
        exitError: EXIT_ERROR,
        exitExpectedEmpty: EXIT_EXPECTED_EMPTY,
        exitOk: EXIT_OK,
        report: report({ adminCliConfigured: false, eventsConfigured: false, kinds: [kind({ complete: false })] }),
      }),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("is EXIT_ERROR when one half is configured and a kind read incompletely", () => {
    expect(
      exitCodeForOnepasswordSyncReport({
        exitError: EXIT_ERROR,
        exitExpectedEmpty: EXIT_EXPECTED_EMPTY,
        exitOk: EXIT_OK,
        report: report({ adminCliConfigured: true, eventsConfigured: false, kinds: [kind({ complete: false })] }),
      }),
    ).toBe(EXIT_ERROR);
  });

  it("is EXIT_OK when every attempted kind read completely", () => {
    expect(
      exitCodeForOnepasswordSyncReport({
        exitError: EXIT_ERROR,
        exitExpectedEmpty: EXIT_EXPECTED_EMPTY,
        exitOk: EXIT_OK,
        report: report({ adminCliConfigured: true, eventsConfigured: true, kinds: [kind({ complete: true })] }),
      }),
    ).toBe(EXIT_OK);
  });
});

describe("renderOnepasswordSyncLines", () => {
  it("names each half's configured state before any kind, so empty and missing cannot look alike", () => {
    const lines = renderOnepasswordSyncLines({
      report: report({ adminCliConfigured: true, eventsConfigured: false, kinds: [kind({ complete: false })] }),
    });

    expect(lines[0]).toBe("admin-cli: configured");
    expect(lines[1]).toBe("events-api: NOT configured");
    expect(lines[2]).toBe("user: INCOMPLETE, 0 record(s)");
    expect(lines[3]).toBe("  no usable `op` session");
  });

  it("says so when the README could not be written", () => {
    const lines = renderOnepasswordSyncLines({
      report: {
        ...report({ adminCliConfigured: true, eventsConfigured: true, kinds: [] }),
        readmePath: null,
      },
    });

    expect(lines).toContain("  the atlas README could not be written");
  });
});

describe("renderOnepasswordSyncLines groups reported findings", () => {
  const finding = ({ path }: { path: string }) => ({
    disposition: "report" as const,
    label: "raw-workspace-id",
    path,
    reason: "a provider-identifier shape appears",
    witness: "abc123",
  });

  it("prints ONE counted line per class, not one line per finding", () => {
    const lines = renderOnepasswordSyncLines({
      report: {
        ...report({ adminCliConfigured: false, eventsConfigured: true, kinds: [] }),
        reportedFindings: [finding({ path: "a" }), finding({ path: "b" }), finding({ path: "c" })],
      },
    });

    const reported = lines.filter((line) => line.includes("recorded, not refused"));
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain("3 × raw-workspace-id");
  });

  it("counts each class from one, in first-seen order, showing each class's latest reason", () => {
    const lines = renderOnepasswordSyncLines({
      report: {
        ...report({ adminCliConfigured: false, eventsConfigured: true, kinds: [] }),
        reportedFindings: [
          finding({ path: "a" }),
          { ...finding({ path: "b" }), label: "raw-email", reason: "an address appears" },
          { ...finding({ path: "c" }), reason: "a later reason" },
        ],
      },
    });

    expect(lines.filter((line) => line.includes("recorded, not refused"))).toEqual([
      "  recorded, not refused: 2 × raw-workspace-id — a later reason",
      "  recorded, not refused: 1 × raw-email — an address appears",
    ]);
  });

  it("prints nothing at all when the gate reported none", () => {
    const lines = renderOnepasswordSyncLines({
      report: report({ adminCliConfigured: true, eventsConfigured: true, kinds: [] }),
    });

    expect(lines.filter((line) => line.includes("recorded, not refused"))).toEqual([]);
  });
});

describe("renderOnepasswordChannelLines", () => {
  it("names both halves from the flags the caller already has, before any sync exists", () => {
    expect(renderOnepasswordChannelLines({ adminCliConfigured: false, eventsConfigured: true })).toEqual([
      "admin-cli: NOT configured",
      "events-api: configured",
    ]);
  });
});

describe("onepasswordSyncFailureClosingLine", () => {
  it("names every incomplete kind and its reason on ONE line, whitespace collapsed", () => {
    const line = onepasswordSyncFailureClosingLine({
      report: report({
        adminCliConfigured: true,
        eventsConfigured: true,
        kinds: [
          kind({ complete: true }),
          {
            complete: false,
            entityCount: 13,
            kind: "vault-grant",
            reasons: ["op vault group list v1 failed;   spawnSync op ETIMEDOUT\n"],
          },
          { complete: false, entityCount: 0, kind: "event", reasons: ["walk refused", "page bound hit"] },
        ],
      }),
    });

    expect(line).toBe(
      "onepassword sync incomplete: vault-grant: op vault group list v1 failed; spawnSync op ETIMEDOUT; " +
        "event: walk refused; page bound hit",
    );
  });

  it("still names a kind that stated no reason", () => {
    const line = onepasswordSyncFailureClosingLine({
      report: report({
        adminCliConfigured: true,
        eventsConfigured: true,
        kinds: [{ complete: false, entityCount: 0, kind: "group", reasons: [] }],
      }),
    });

    expect(line).toBe("onepassword sync incomplete: group: incomplete without a stated reason");
  });

  it("is null when every kind synced completely", () => {
    expect(
      onepasswordSyncFailureClosingLine({
        report: report({ adminCliConfigured: true, eventsConfigured: true, kinds: [kind({ complete: true })] }),
      }),
    ).toBeNull();
  });
});

describe("renderOnepasswordTailLines", () => {
  it("carries each kind's reasons NAMED by kind, since the kind lines themselves already streamed", () => {
    const lines = renderOnepasswordTailLines({
      report: report({
        adminCliConfigured: false,
        eventsConfigured: true,
        kinds: [kind({ complete: false })],
      }),
    });

    expect(lines[0]).toBe("  user: no usable `op` session");
  });

  it("does not repeat the per-kind result lines", () => {
    const lines = renderOnepasswordTailLines({
      report: report({ adminCliConfigured: true, eventsConfigured: true, kinds: [kind({ complete: true })] }),
    });

    expect(lines.filter((line) => line.includes("synced,"))).toEqual([]);
  });
});
