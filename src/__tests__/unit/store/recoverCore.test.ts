/**
 * `store recover`'s parser and closing report. The report is what a person reads the morning after a wipe, so
 * the tests pin the three things it must never blur: a backup that carried no credentials, a path left in
 * staging, and what no backup carries at all.
 */
import { describe, expect, it } from "vitest";

import { storeCommandErrorLines } from "../../../cli/commands/store/errors.js";
import {
  DEFAULT_RECOVER_DATABASE,
  parseStoreRecoverArgs,
  recoverReportLines,
} from "../../../cli/commands/store/recoverCore.js";
import { runStoreRecover } from "../../../cli/commands/store/recoverRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { RecoverReport } from "../../../store/backup/recover.js";
import { NOT_IN_ANY_BACKUP } from "../../../store/backup/recoverPlan.js";

const PREFIX = "slopweaver/2026-09-29T17-12-51-910Z/";

/** The lines a refused `store recover` invocation prints. */
const refusalLines = ({ parsed }: { parsed: ReturnType<typeof parseStoreRecoverArgs> }): readonly string[] =>
  storeCommandErrorLines({ error: unwrapErr(parsed) });

const WHOLE: RecoverReport = {
  complete: true,
  conflicts: [],
  credentialsCarried: true,
  database: DEFAULT_RECOVER_DATABASE,
  dryRun: false,
  files: { conflicts: [], identical: 0, replaced: [], written: 12 },
  prefix: PREFIX,
  secrets: { conflicts: [], identical: 0, replaced: [], written: 9 },
};

describe("the verb, before anything runs", () => {
  it("prints its usage for --help and touches nothing", async () => {
    expect(await runStoreRecover(["node", "cli", "store", "recover", "--help"])).toBe(EXIT_OK);
  });

  it("exits usage on a flag it does not know, before resolving a home or a destination", async () => {
    expect(await runStoreRecover(["node", "cli", "store", "recover", "--overwrite"])).toBe(EXIT_USAGE);
  });
});

describe("parseStoreRecoverArgs", () => {
  it("defaults to the newest backup, into store_recovered", () => {
    expect(unwrap(parseStoreRecoverArgs({ rest: [] }))).toEqual({
      database: "store_recovered",
      destination: null,
      dryRun: false,
      from: null,
    });
  });

  it("carries every flag", () => {
    const args = parseStoreRecoverArgs({
      rest: ["--destination", "/Volumes/Backup", "--from", PREFIX, "--into", "store_two", "--dry-run", "--home", "/h"],
    });

    expect(unwrap(args)).toEqual({
      database: "store_two",
      destination: "/Volumes/Backup",
      dryRun: true,
      from: PREFIX,
      home: "/h",
    });
  });

  it("refuses a --from that is not a prefix", () => {
    const refused = parseStoreRecoverArgs({ rest: ["--from", "latest"] });

    expect(unwrapErr(refused).code).toBe("ARGUMENTS_REFUSED");
    expect(refusalLines({ parsed: refused })).toEqual([
      '--from takes a <project>/<instant>/ prefix as the destination spells it, not "latest"',
    ]);
  });

  it("refuses the retired --bucket flag as one it does not know", () => {
    const refused = parseStoreRecoverArgs({ rest: ["--bucket", "a-backup-bucket"] });

    expect(unwrapErr(refused).code).toBe("FLAGS_INVALID");
    expect(refusalLines({ parsed: refused }).join("\n")).toContain("--bucket");
  });

  it("refuses a database name that is not a safe identifier", () => {
    const refused = parseStoreRecoverArgs({ rest: ["--into", "Store; drop"] });

    expect(refusalLines({ parsed: refused }).length).toBe(1);
    expect(refusalLines({ parsed: refused })[0]).toContain("Store; drop");
  });

  it("refuses an unknown flag", () => {
    expect(refusalLines({ parsed: parseStoreRecoverArgs({ rest: ["--force"] }) }).length).toBe(1);
  });
});

describe("recoverReportLines", () => {
  it("a dry run says nothing was written", () => {
    expect(recoverReportLines({ home: "/h", report: { ...WHOLE, dryRun: true } })).toEqual([
      "store recover: dry run — nothing was downloaded or written. Run it again without --dry-run to recover.",
    ]);
  });

  it("a whole recovery names what no backup carries, then the next step", () => {
    const lines = recoverReportLines({ home: "/h", report: WHOLE });

    expect(lines).toEqual([
      "store recover: what no backup carries, so it is still yours to do:",
      ...NOT_IN_ANY_BACKUP.map((line) => `  - ${line}`),
      `store recover: /h recovered from ${PREFIX} into store_recovered. Next: \`slopweaver handover list\`, then open the supervisor.`,
    ]);
  });

  it("names the store-url it repointed by database alone, before anything else", () => {
    const secrets = {
      conflicts: [],
      identical: 0,
      replaced: [{ newDatabase: "store_recovered", oldDatabase: "postgres", path: "secrets/store-url" as const }],
      written: 8,
    };

    const lines = recoverReportLines({ home: "/h", report: { ...WHOLE, secrets } });

    expect(lines[0]).toBe(
      "store recover: replaced secrets/store-url database postgres → store_recovered; every other connection field was identical.",
    );
  });

  it("a backup without credentials says every token must be minted again", () => {
    const lines = recoverReportLines({ home: "/h", report: { ...WHOLE, credentialsCarried: false } });

    expect(lines[0]).toBe(
      "store recover: this backup carried NO credentials — `backup-passphrase` was never set on the machine that took it,",
    );
    expect(lines.at(-1)).toContain("/h recovered from");
  });

  it("a conflict lists each path and says the home is not whole", () => {
    const lines = recoverReportLines({
      home: "/h",
      report: { ...WHOLE, complete: false, conflicts: ["profile.json", "secrets/slack-bot-token"] },
    });

    expect(lines.slice(0, 3)).toEqual([
      "store recover: 2 path(s) LEFT IN STAGING — the home already holds different bytes, and a recovery never overwrites:",
      "  profile.json",
      "  secrets/slack-bot-token",
    ]);
    expect(lines.at(-1)).toBe(
      "store recover: /h is NOT whole — resolve the paths above, then run store recover again to finish.",
    );
  });
});
