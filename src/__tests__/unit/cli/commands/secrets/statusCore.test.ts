/**
 * `secrets status`'s parser and its renderers, over stated rows.
 *
 * The renderer assertions are what stop the one property this verb must never lose: a row carries no field a
 * token could be in, so no arrangement of them can print one. The parser assertions are the same shape the
 * whole-CLI `helpTruth` ratchet applies, kept here as well because a strictness regression is the way an
 * unadvertised flag gets in.
 */
import { describe, expect, it } from "vitest";

import {
  parseSecretsStatusArgs,
  renderFindings,
  renderStatus,
  renderTable,
  visibleRows,
} from "../../../../../cli/commands/secrets/statusCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { CredentialRow } from "../../../../../secrets/status.js";

const row = (over: Partial<CredentialRow> = {}): CredentialRow => ({
  detail: "stored, 0600, nothing to report",
  expiryKind: "none",
  mintScope: "read-only",
  name: "test-token",
  platform: "TestCo",
  readVerbs: "slopweaver test *",
  reader: "src/config.ts",
  state: "ok",
  stored: true,
  usedFor: "reading TestCo",
  what: "a test token",
  ...over,
});

describe("parseSecretsStatusArgs", () => {
  it("defaults to the stored-plus-findings view of the ambient home", () => {
    const parsed = unwrap(parseSecretsStatusArgs({ rest: [] }));

    expect(parsed.all).toBe(false);
    expect(parsed.json).toBe(false);
    expect(parsed.home).toBe(undefined);
  });

  it("reads every flag it advertises", () => {
    const parsed = unwrap(parseSecretsStatusArgs({ rest: ["--home", "/tmp/h", "--all", "--json"] }));

    expect(parsed.home).toBe("/tmp/h");
    expect(parsed.all).toBe(true);
    expect(parsed.json).toBe(true);
  });

  it("refuses a flag it does not know rather than ignoring it", () => {
    expect(unwrapErr(parseSecretsStatusArgs({ rest: ["--nope"] })).join(" ")).toContain("--nope");
  });

  it("refuses a stray positional", () => {
    expect(unwrapErr(parseSecretsStatusArgs({ rest: ["github-token"] })).length).toBeGreaterThan(0);
  });
});

describe("visibleRows", () => {
  it("hides an unconnected credential by default, so findings are not buried under absences", () => {
    const rows = [row({ name: "a" }), row({ name: "b", state: "absent", stored: false })];

    expect(visibleRows({ all: false, rows }).map((entry) => entry.name)).toEqual(["a"]);
  });

  it("keeps an unstored row when it is itself a finding", () => {
    const rows = [row({ name: "b", state: "off-allowlist", stored: false })];

    expect(visibleRows({ all: false, rows }).map((entry) => entry.name)).toEqual(["b"]);
  });

  it("shows everything under --all", () => {
    const rows = [row({ name: "a" }), row({ name: "b", state: "absent", stored: false })];

    expect(visibleRows({ all: true, rows }).map((entry) => entry.name)).toEqual(["a", "b"]);
  });
});

describe("renderFindings", () => {
  it("says nothing at all when the store is clean", () => {
    expect(renderFindings({ rows: [row()] })).toEqual([]);
  });

  it("leads with the count, then one line per finding carrying its remedy", () => {
    const lines = renderFindings({
      rows: [row(), row({ detail: "nothing in src/ reads this — safe to delete", name: "old-token", state: "dead" })],
    });

    expect(lines[0]).toBe("1 finding(s):");
    expect(lines[1]).toBe("  old-token  dead  nothing in src/ reads this — safe to delete");
  });
});

describe("renderTable", () => {
  it("says so plainly when there is nothing at all to show", () => {
    expect(renderTable({ rows: [] })).toEqual(["no credentials stored, and none declared — run `slopweaver onboard`"]);
  });

  it("heads the columns the owner asked for, and no column a value could sit in", () => {
    expect(renderTable({ rows: [row()] })[0]).toBe(
      "SECRET      PLATFORM  WHAT          AT MINT    EXPIRY  STATE  READ BY",
    );
  });

  it("prints a grant's expiry instant in place of its expiry kind", () => {
    const lines = renderTable({
      rows: [row({ expiryIso: "2026-09-07T03:55:02.318Z", expiryKind: "grant-cache" })],
    });

    expect(lines[1]).toContain("2026-09-07T03:55:02.318Z");
    expect(lines[1]).not.toContain("grant-cache");
  });
});

describe("renderStatus", () => {
  it("puts the findings above the table, and says what it hid", () => {
    const lines = renderStatus({
      all: false,
      rows: [
        row({ detail: "nothing in src/ reads this — safe to delete", name: "old-token", state: "dead" }),
        row({ name: "unconnected", state: "absent", stored: false }),
      ],
    });

    expect(lines[0]).toBe("1 finding(s):");
    expect(lines.at(-1)).toBe("1 declared credential(s) not stored — `--all` to list them");
  });

  it("says nothing about hidden rows when none were hidden", () => {
    const lines = renderStatus({ all: true, rows: [row({ name: "unconnected", state: "absent", stored: false })] });

    expect(lines.at(-1)).toContain("unconnected");
  });
});
