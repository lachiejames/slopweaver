/**
 * The five `grant` verbs over an in-memory store: what each writes, and that a store outage is a refusal with a
 * non-zero exit rather than an empty journal or a write somewhere else.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GrantCommandDeps } from "../../../../../cli/commands/grant/deps.js";
import { runGrantListWithDeps } from "../../../../../cli/commands/grant/list.js";
import { runGrantPerformWithDeps } from "../../../../../cli/commands/grant/perform.js";
import { runGrantRecordWithDeps } from "../../../../../cli/commands/grant/record.js";
import { runGrantRefuseWithDeps } from "../../../../../cli/commands/grant/refuse.js";
import { runGrantShowWithDeps } from "../../../../../cli/commands/grant/show.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../../../supervisor/session.js";
import {
  type MemoryGrantStore,
  memoryGrantJournalPort,
  memoryGrantStore,
  unavailableGrantJournalPort,
} from "../../../../grantJournalFixture.js";

const ARGV_HEAD = ["node", "slopweaver", "grant"];
const SESSION_ENV = { [CLAUDE_CODE_SESSION_ID_ENV]: "session-alpha" };

describe("grant verbs over the store", () => {
  let home: string;
  let store: MemoryGrantStore;
  let deps: GrantCommandDeps;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "grant-verbs-"));
    store = memoryGrantStore();
    deps = { env: SESSION_ENV, journal: memoryGrantJournalPort({ store }) };
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Record one system-target grant and answer its id, read back from the store. */
  async function recordOne(): Promise<string> {
    const code = await runGrantRecordWithDeps({
      argv: [
        ...ARGV_HEAD,
        "record",
        "--target-system",
        "linear",
        "--change-kind",
        "literal",
        "--change",
        "TIMEOUT = 30",
        "--anchor",
        "transcript:aaaa#bbbb",
        "--home",
        home,
      ],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    return store.rows[0]!.grantId;
  }

  it("record writes exactly one grant row, recorded by the visible session", async () => {
    const grantId = await recordOne();
    expect(store.rows.map((row) => [row.entryKind, row.grantId, row.bySession, row.change])).toEqual([
      ["grant", grantId, "session-alpha", "TIMEOUT = 30"],
    ]);
  });

  it("record writes nothing outside a visible session", async () => {
    const code = await runGrantRecordWithDeps({
      argv: [...ARGV_HEAD, "record", "--target-system", "linear", "--change-kind", "literal", "--change", "x"].concat([
        "--anchor",
        "transcript:a#b",
        "--home",
        home,
      ]),
      deps: { ...deps, env: {} },
    });
    expect(code).toBe(EXIT_ERROR);
    expect(store.inserts).toBe(0);
  });

  it("show passes a recorded row, and perform journals one performance and refuses a second", async () => {
    const grantId = await recordOne();
    expect(await runGrantShowWithDeps({ argv: [...ARGV_HEAD, "show", grantId, "--home", home], deps })).toBe(EXIT_OK);
    const perform = [...ARGV_HEAD, "perform", grantId, "--wrote", "TIMEOUT = 30", "--home", home];
    expect(await runGrantPerformWithDeps({ argv: perform, deps })).toBe(EXIT_OK);
    expect(await runGrantPerformWithDeps({ argv: perform, deps })).toBe(EXIT_ERROR);
    expect(store.rows.map((row) => row.entryKind)).toEqual(["grant", "performance"]);
  });

  it("perform journals nothing when what was written is not the row's exact change", async () => {
    const grantId = await recordOne();
    const code = await runGrantPerformWithDeps({
      argv: [...ARGV_HEAD, "perform", grantId, "--wrote", "TIMEOUT = 31", "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(store.rows.map((row) => row.entryKind)).toEqual(["grant"]);
  });

  it("refuse journals a typed refusal each time it runs, and list reads the store", async () => {
    const grantId = await recordOne();
    const refuse = [...ARGV_HEAD, "refuse", grantId, "--check", "RAIL_CROSSED", "--why", "widens access"];
    expect(await runGrantRefuseWithDeps({ argv: [...refuse, "--home", home], deps })).toBe(EXIT_OK);
    expect(await runGrantRefuseWithDeps({ argv: [...refuse, "--home", home], deps })).toBe(EXIT_OK);
    expect(store.rows.map((row) => [row.entryKind, row.refusalCode])).toEqual([
      ["grant", null],
      ["refusal", "RAIL_CROSSED"],
      ["refusal", "RAIL_CROSSED"],
    ]);
    expect(await runGrantListWithDeps({ argv: [...ARGV_HEAD, "list", "--home", home], deps })).toBe(EXIT_OK);
  });

  it("every verb exits non-zero on a store outage, rather than reading an empty journal", async () => {
    const down: GrantCommandDeps = { env: SESSION_ENV, journal: unavailableGrantJournalPort() };
    expect(await runGrantListWithDeps({ argv: [...ARGV_HEAD, "list", "--home", home], deps: down })).toBe(EXIT_ERROR);
    expect(await runGrantShowWithDeps({ argv: [...ARGV_HEAD, "show", "g-1", "--home", home], deps: down })).toBe(
      EXIT_ERROR,
    );
    expect(
      await runGrantPerformWithDeps({
        argv: [...ARGV_HEAD, "perform", "g-1", "--wrote", "x", "--home", home],
        deps: down,
      }),
    ).toBe(EXIT_ERROR);
    expect(
      await runGrantRefuseWithDeps({
        argv: [...ARGV_HEAD, "refuse", "g-1", "--check", "ROW_MISSING", "--why", "none", "--home", home],
        deps: down,
      }),
    ).toBe(EXIT_ERROR);
  });
});
