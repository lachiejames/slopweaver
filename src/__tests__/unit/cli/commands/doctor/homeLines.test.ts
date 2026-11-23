import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  codexConfigLine,
  dirStatus,
  identityLines,
  identityStatus,
  rosterStoreAbsent,
  seedStatus,
} from "../../../../../cli/commands/doctor/homeLines.js";
import { err, ok } from "../../../../../lib/result.js";
import { IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "doctor-home-lines-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

const unreadable = err(IdentityRosterErrors.storeUnavailable({ doing: "open", reason: "connection refused" }));

describe("identityLines", () => {
  it("names the retired file without reaching the store on the default run", () => {
    const path = join(dir, "identity.json");
    writeFileSync(path, "[]");
    expect(identityLines({ path, stored: undefined })).toEqual([
      `identity roster: in the store, not checked (--deep peeks it) — the retired ${path} is still in the home (imported once if the store holds no row, inert beside one)`,
    ]);
  });

  it("says no retired file is present when the home holds none", () => {
    expect(identityLines({ path: join(dir, "identity.json"), stored: undefined })).toEqual([
      "identity roster: in the store, not checked (--deep peeks it) — no retired identity.json in the home",
    ]);
  });

  it("reports the row's revision and record count, never a name", () => {
    const stored = ok({ records: [], retiredFile: undefined, revision: 4 });
    expect(identityLines({ path: join(dir, "identity.json"), stored })).toEqual([
      "identity roster: store row revision 4, 0 person record(s)",
    ]);
  });

  it("says the store holds no row yet at revision null", () => {
    const stored = ok({ records: [], retiredFile: undefined, revision: null });
    expect(identityLines({ path: join(dir, "identity.json"), stored })).toEqual([
      "identity roster: the store holds no row yet",
    ]);
  });

  it("surfaces an unreadable store's own message", () => {
    expect(identityLines({ path: join(dir, "identity.json"), stored: unreadable })[0]).toBe(
      `identity roster: store UNREADABLE — ${unreadable.error.message}`,
    );
  });
});

describe("rosterStoreAbsent", () => {
  it("is true only when the --deep peek ran and the store refused it", () => {
    expect(rosterStoreAbsent({ stored: unreadable })).toBe(true);
    expect(rosterStoreAbsent({ stored: undefined })).toBe(false);
    expect(rosterStoreAbsent({ stored: ok({ records: [], retiredFile: undefined, revision: null }) })).toBe(false);
    expect(rosterStoreAbsent({ stored: ok({ records: [], retiredFile: undefined, revision: 2 }) })).toBe(false);
  });
});

describe("identityStatus", () => {
  it("maps each state onto its closed status word", () => {
    const path = join(dir, "identity.json");
    expect(identityStatus({ path, stored: undefined })).toBe("retired-file-absent");
    writeFileSync(path, "[]");
    expect(identityStatus({ path, stored: undefined })).toBe("retired-file-present");
    expect(identityStatus({ path, stored: unreadable })).toBe("store-unreadable");
    expect(identityStatus({ path, stored: ok({ records: [], retiredFile: undefined, revision: null }) })).toBe(
      "store-no-row",
    );
    expect(identityStatus({ path, stored: ok({ records: [], retiredFile: undefined, revision: 1 }) })).toBe(
      "store-row",
    );
  });
});

describe("dirStatus and seedStatus", () => {
  it("tells a missing, an empty and a populated directory apart", () => {
    expect(dirStatus({ path: join(dir, "absent") })).toBe("missing");
    expect(dirStatus({ path: dir })).toBe("exists (empty)");
    writeFileSync(join(dir, "f"), "x");
    expect(dirStatus({ path: dir })).toBe("exists");
  });

  it("reports a seed's parse status without its contents", () => {
    const path = join(dir, "seed.json");
    const valid: Parameters<typeof seedStatus>[0]["valid"] = (value) => Array.isArray(value);
    expect(seedStatus({ path, valid })).toBe("missing");
    writeFileSync(path, "{}");
    expect(seedStatus({ path, valid })).toBe("present-invalid");
    writeFileSync(path, "[]");
    expect(seedStatus({ path, valid })).toBe("present-valid");
  });
});

describe("codexConfigLine", () => {
  it("flags a config that declares MCP servers", () => {
    const path = join(dir, "config.toml");
    writeFileSync(path, "[mcp_servers.x]\n");
    expect(codexConfigLine({ path })).toBe(
      `codex config: present at ${path} and appears to declare MCP servers — Codex SPAWNS those at startup (dispatch is blocked, the process still runs)`,
    );
  });
});
