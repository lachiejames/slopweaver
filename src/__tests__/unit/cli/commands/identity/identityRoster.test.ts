/**
 * Unit: `identity roster show|replace` over an in-memory store — the parse, the exit codes, and `replace`'s one
 * pinned write, decoded whole before the store is touched. Every record here is synthetic.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type IdentityRosterDeps,
  parseExpectedRevision,
  parseIdentityRosterArgs,
  renderIdentityRoster,
  runIdentityRosterWithDeps,
} from "../../../../../cli/commands/identity/identityRoster.js";
import { IdentityRosterArgsErrors } from "../../../../../cli/commands/identity/rosterArgsErrors.js";
import { IDENTITY_ROSTER_USAGE } from "../../../../../cli/commands/identity/rosterUsage.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import type { IdentityRosterPort } from "../../../../../silver/identityRoster.js";
import { readIdentityRosterFile } from "../../../../../silver/identityRosterDecode.js";
import { memoryIdentityRosterPort, unavailableIdentityRosterPort } from "../../../../identityRosterFixture.js";
import { type MemorySingletonStore, memorySingletonStore } from "../../../../singletonRegisterFixture.js";

const ADA = { handle: "ada", id: "U0FIXTUREADA", name: "Ada Acme" } as const;
const BOB = { handle: "bob", id: "U0FIXTUREBOB", name: "Bob Acme" } as const;

const ARGV_HEAD = ["node", "slopweaver", "identity", "roster"] as const;

interface Recorded {
  readonly out: string[];
  readonly errors: string[];
  readonly warnings: string[];
}

describe("parseExpectedRevision", () => {
  it("reads `none` as a writer that saw no row", () => {
    expect(unwrap(parseExpectedRevision({ token: "none" }))).toBe(null);
  });

  it("reads a positive whole revision", () => {
    expect(unwrap(parseExpectedRevision({ token: "12" }))).toBe(12);
  });

  it.each(["0", "-1", "1.5", "01", "latest", ""])("refuses %j", (token) => {
    const refusal = parseExpectedRevision({ token })._unsafeUnwrapErr();
    expect(refusal).toEqual(IdentityRosterArgsErrors.revisionMalformed({ noRowToken: "none", token }));
    expect(refusal.message).toContain("--expect-revision takes a positive whole revision");
  });
});

describe("parseIdentityRosterArgs", () => {
  it("refuses no action at all", () => {
    const refusal = parseIdentityRosterArgs({ rest: [] })._unsafeUnwrapErr();
    expect(refusal.code).toBe("ROSTER_ACTION_MISSING");
    expect(refusal.message).toBe("identity roster takes exactly one action: `show` or `replace`");
  });

  it("refuses replace without its revision", () => {
    const refusal = parseIdentityRosterArgs({ rest: ["replace", "--file", "x.json"] })._unsafeUnwrapErr();
    expect(refusal).toEqual(IdentityRosterArgsErrors.replaceUnpinned());
    expect(refusal.message).toContain("identity roster replace needs --file <path> and --expect-revision <n|none>");
  });

  it("refuses replace's flags on show", () => {
    const refusal = parseIdentityRosterArgs({ rest: ["show", "--file", "x.json"] })._unsafeUnwrapErr();
    expect(refusal.code).toBe("ROSTER_SHOW_TAKES_NO_WRITE_FLAGS");
    expect(refusal.message).toBe("identity roster show takes no --file or --expect-revision; those are replace's");
  });

  it("carries every flag-parser problem through, one per line", () => {
    const refusal = parseIdentityRosterArgs({ rest: ["show", "--nope"] })._unsafeUnwrapErr();
    expect(refusal.code).toBe("ROSTER_FLAGS_UNPARSED");
    expect(refusal.message).toContain("--nope");
  });

  it("parses a whole replace", () => {
    expect(
      unwrap(parseIdentityRosterArgs({ rest: ["replace", "--file", "x.json", "--expect-revision", "3", "--json"] })),
    ).toEqual({ action: "replace", expectedRevision: 3, file: "x.json", home: undefined, json: true });
  });
});

describe("renderIdentityRoster", () => {
  it("prints the revision, then one line per record", () => {
    expect(
      renderIdentityRoster({ json: false, snapshot: { records: [ADA, BOB], retiredFile: undefined, revision: 4 } }),
    ).toEqual([
      "identity roster: revision 4, 2 record(s)",
      "  U0FIXTUREADA  @ada  Ada Acme",
      "  U0FIXTUREBOB  @bob  Bob Acme",
    ]);
  });

  it("emits the records and revision as one JSON document, never the retired-file note", () => {
    expect(
      renderIdentityRoster({ json: true, snapshot: { records: [ADA], retiredFile: undefined, revision: null } }),
    ).toEqual([JSON.stringify({ records: [ADA], revision: null }, null, 2)]);
  });
});

describe("runIdentityRosterWithDeps", () => {
  let home: string;
  let store: MemorySingletonStore;
  let recorded: Recorded;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-identity-roster-run-"));
    store = memorySingletonStore();
    recorded = { errors: [], out: [], warnings: [] };
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const depsOver = ({ port }: { port: IdentityRosterPort }): IdentityRosterDeps => ({
    home: () => home,
    logger: {
      error: ({ msg }) => {
        recorded.errors.push(msg);
      },
      out: ({ line }) => {
        recorded.out.push(line);
      },
      warn: ({ msg }) => {
        recorded.warnings.push(msg);
      },
    },
    port,
    readDocument: ({ path }) => readIdentityRosterFile({ operation: "read the replacement", path }),
  });

  const run = ({
    rest,
    port = memoryIdentityRosterPort({ store }),
  }: {
    rest: readonly string[];
    port?: IdentityRosterPort;
  }): Promise<number> => runIdentityRosterWithDeps({ argv: [...ARGV_HEAD, ...rest], deps: depsOver({ port }) });

  const declared = ({ value }: { value: unknown }): string => {
    const path = join(home, "replacement.json");
    writeFileSync(path, JSON.stringify(value));
    return path;
  };

  it("--help prints the usage leaf the manifest quotes, and touches no store", async () => {
    expect(await run({ port: unavailableIdentityRosterPort(), rest: ["--help"] })).toBe(EXIT_OK);
    expect(recorded.out).toEqual([IDENTITY_ROSTER_USAGE]);
    expect(recorded.errors).toEqual([]);
  });

  it("show exits 3 and names the empty row when the store holds none", async () => {
    expect(await run({ rest: ["show"] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(recorded.out).toEqual([
      "identity roster: the store holds no row (an empty roster); replace with --expect-revision none",
    ]);
  });

  it("replace --expect-revision none writes revision 1 once, then shows it", async () => {
    const path = declared({ value: [ADA] });
    expect(await run({ rest: ["replace", "--file", path, "--expect-revision", "none"] })).toBe(EXIT_OK);
    expect(store.rows.get(home)).toEqual({ document: [ADA], revision: 1 });
    expect(recorded.warnings).toEqual(["identity roster: wrote revision 1"]);
    expect(recorded.out).toEqual(["identity roster: revision 1, 1 record(s)", "  U0FIXTUREADA  @ada  Ada Acme"]);
  });

  it("replace pinned to a stale revision writes nothing and is not retried", async () => {
    const first = declared({ value: [ADA] });
    expect(await run({ rest: ["replace", "--file", first, "--expect-revision", "none"] })).toBe(EXIT_OK);
    const second = declared({ value: [ADA, BOB] });
    expect(await run({ rest: ["replace", "--file", second, "--expect-revision", "none"] })).toBe(EXIT_ERROR);
    expect(store.rows.get(home)).toEqual({ document: [ADA], revision: 1 });
    expect(recorded.errors).toEqual([
      "identity roster replace: the identity roster changed while this replacement was prepared (read at revision " +
        "0), so nothing was written; run `slopweaver identity roster show` and judge the replacement again against " +
        "what is there now.",
    ]);
  });

  it("replace pinned to the revision read moves it on by one", async () => {
    const first = declared({ value: [ADA] });
    expect(await run({ rest: ["replace", "--file", first, "--expect-revision", "none"] })).toBe(EXIT_OK);
    const second = declared({ value: [ADA, BOB] });
    expect(await run({ rest: ["replace", "--file", second, "--expect-revision", "1", "--json"] })).toBe(EXIT_OK);
    expect(store.rows.get(home)).toEqual({ document: [ADA, BOB], revision: 2 });
    expect(JSON.parse(recorded.out.at(-1)!)).toEqual({ records: [ADA, BOB], revision: 2 });
  });

  it("a malformed replacement exits 2 and never touches the store", async () => {
    const path = declared({ value: { not: "an array" } });
    expect(
      await run({
        port: unavailableIdentityRosterPort(),
        rest: ["replace", "--file", path, "--expect-revision", "none"],
      }),
    ).toBe(EXIT_USAGE);
    expect(recorded.errors).toEqual([
      `identity roster replace: ${path} is not an identity roster: it is not a JSON array — nothing was written`,
    ]);
  });

  it("a missing replacement file exits 1 and writes nothing", async () => {
    const path = join(home, "absent.json");
    expect(await run({ rest: ["replace", "--file", path, "--expect-revision", "none"] })).toBe(EXIT_ERROR);
    expect(store.rows.size).toBe(0);
    expect(recorded.errors).toEqual([`identity roster replace: ${path} does not exist — nothing was written`]);
  });

  it("an outage on replace says to read the row again before retrying", async () => {
    const path = declared({ value: [ADA] });
    expect(
      await run({
        port: unavailableIdentityRosterPort(),
        rest: ["replace", "--file", path, "--expect-revision", "none"],
      }),
    ).toBe(EXIT_ERROR);
    expect(recorded.errors.length).toBe(2);
    expect(recorded.errors[0]).toContain("this install keeps its identity roster in the store");
    expect(recorded.errors[1]).toBe(
      "identity roster replace: run `slopweaver identity roster show` before retrying — a connection that fails " +
        "after the commit cannot be told apart from one that failed before it, so the write may have landed",
    );
  });

  it("an outage on show is an error, never an empty roster", async () => {
    expect(await run({ port: unavailableIdentityRosterPort(), rest: ["show"] })).toBe(EXIT_ERROR);
    expect(recorded.out).toEqual([]);
    expect(recorded.errors[0]).toContain("identity roster show: this install keeps its identity roster in the store");
  });

  it("show names the retired file as inert beside a row", async () => {
    writeFileSync(join(home, "identity.json"), JSON.stringify([BOB]));
    const path = declared({ value: [ADA] });
    expect(await run({ rest: ["replace", "--file", path, "--expect-revision", "none"] })).toBe(EXIT_OK);
    recorded.warnings.length = 0;
    expect(await run({ rest: ["show"] })).toBe(EXIT_OK);
    expect(recorded.warnings).toEqual([
      `identity roster: ${join(home, "identity.json")} is retired and read by nothing: the store's row (revision 1) ` +
        "is the identity roster. Change it with `slopweaver identity roster replace`, then move that file out of the home",
    ]);
  });

  it("--help prints the usage and touches nothing", async () => {
    expect(await run({ port: unavailableIdentityRosterPort(), rest: ["--help"] })).toBe(EXIT_OK);
    expect(recorded.out[0]).toContain("usage: slopweaver identity roster show");
  });
});
