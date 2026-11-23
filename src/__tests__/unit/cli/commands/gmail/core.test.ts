/**
 * Unit: `gmail` argument parsing — the layer that must refuse before any credential or socket is touched.
 *
 * `connect` lives beside the read verbs here even though its parser was extracted to its own module: the
 * cases follow the code they cover by IMPORT, which is what `untested-modules` measures, and splitting a
 * test file to mirror a path is the shape that gate rejected by name.
 */
import { describe, expect, it } from "vitest";
import { MAX_ARCHIVE_IDS, parseGmailArchiveArgs } from "../../../../../cli/commands/gmail/archiveArgs.js";
import { GMAIL_CONNECT_USAGE, parseGmailConnectArgs } from "../../../../../cli/commands/gmail/connectCore.js";
import {
  parseGmailLabelArgs,
  parseGmailLabelsArgs,
  parseGmailListArgs,
  parseGmailMarkArgs,
  parseGmailReadArgs,
} from "../../../../../cli/commands/gmail/core.js";
import { GmailArgsErrors, gmailArgsErrorLines } from "../../../../../cli/commands/gmail/errors.js";
import { collectRepeated, withoutRepeated } from "../../../../../cli/optionParsers.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { GMAIL_SCOPE_TABLE, GMAIL_SCOPES } from "../../../../../live/gmail/scopes.js";
import { scopesToRequest } from "../../../../../live/google/scopes.js";

describe("parseGmailListArgs", () => {
  it("defaults the limit and takes no query", () => {
    const args = unwrap(parseGmailListArgs({ rest: [] }));
    expect(args.limit).toBe(25);
    expect(args.query).toBe(undefined);
    expect(args.labelIds).toStrictEqual([]);
  });

  it("keeps EVERY --label, not just the last one", () => {
    const args = unwrap(parseGmailListArgs({ rest: ["--label", "INBOX", "--label", "STARRED"] }));
    expect(args.labelIds).toStrictEqual(["INBOX", "STARRED"]);
  });

  it("accepts a query and a limit together", () => {
    const args = unwrap(parseGmailListArgs({ rest: ["--query", "is:unread", "--limit", "50"] }));
    expect(args.query).toBe("is:unread");
    expect(args.limit).toBe(50);
  });

  it("refuses a limit above the provider page cap", () => {
    const parsed = parseGmailListArgs({ rest: ["--limit", "101"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("between 1 and 100");
  });

  it("refuses a zero limit", () => {
    const parsed = parseGmailListArgs({ rest: ["--limit", "0"] });
    expect(unwrapErr(parsed).message).toBe("--limit must be an integer between 1 and 100");
  });

  it("refuses a non-numeric limit", () => {
    const parsed = parseGmailListArgs({ rest: ["--limit", "lots"] });
    expect(unwrapErr(parsed).message).toBe("--limit must be an integer between 1 and 100");
  });
});

describe("parseGmailReadArgs", () => {
  it("takes the leading positional as the id", () => {
    const args = unwrap(parseGmailReadArgs({ rest: ["19c4f2a1b0d3e5f7"] }));
    expect(args.address).toBe("19c4f2a1b0d3e5f7");
    expect(args.thread).toBe(false);
  });

  it("reads --thread and --json", () => {
    const args = unwrap(parseGmailReadArgs({ rest: ["t1", "--thread", "--json"] }));
    expect(args.thread).toBe(true);
    expect(args.json).toBe(true);
  });

  it("refuses a missing id", () => {
    const parsed = parseGmailReadArgs({ rest: [] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("missing <message-id>");
  });

  it("refuses a leading flag where the id should be", () => {
    const parsed = parseGmailReadArgs({ rest: ["--thread"] });
    expect(unwrapErr(parsed).message).toBe("missing <message-id>");
  });
});

describe("collectRepeated / withoutRepeated", () => {
  it("collects both spellings of a repeated flag", () => {
    expect(collectRepeated({ name: "--label", rest: ["--label", "A", "--label=B"] })).toStrictEqual(["A", "B"]);
  });

  it("skips a repeated flag whose value is missing rather than swallowing the next flag", () => {
    expect(collectRepeated({ name: "--label", rest: ["--label", "--json"] })).toStrictEqual([]);
  });

  it("strips the repeated flag and its value, leaving the rest of the tail intact", () => {
    expect(
      withoutRepeated({ name: "--label", rest: ["--label", "A", "--limit", "5", "--label=B", "--json"] }),
    ).toStrictEqual(["--limit", "5", "--json"]);
  });
});

describe("parseGmailLabelsArgs", () => {
  it("takes no arguments at all", () => {
    const args = unwrap(parseGmailLabelsArgs({ rest: [] }));
    expect(args.json).toBe(false);
    expect(args.home).toBe(undefined);
  });

  it("reads --json and --home", () => {
    const args = unwrap(parseGmailLabelsArgs({ rest: ["--json", "--home", "/tmp/x"] }));
    expect(args.json).toBe(true);
    expect(args.home).toBe("/tmp/x");
  });

  it("refuses an unknown flag", () => {
    const parsed = parseGmailLabelsArgs({ rest: ["--nope"] });
    expect(unwrapErr(parsed).message).toBe("unknown flag: --nope");
  });
});

describe("parseGmailLabelArgs", () => {
  it("collects repeated --add and --remove in the order written", () => {
    const args = unwrap(
      parseGmailLabelArgs({ rest: ["m-1", "--add", "Waiting on", "--add=Urgent", "--remove", "INBOX"] }),
    );
    expect(args.addRefs).toStrictEqual(["Waiting on", "Urgent"]);
    expect(args.removeRefs).toStrictEqual(["INBOX"]);
    expect(args.addresses).toStrictEqual(["m-1"]);
    expect(args.intent).toBe("label");
  });

  it("refuses a change that names neither --add nor --remove", () => {
    const parsed = parseGmailLabelArgs({ rest: ["m-1"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("at least one --add or --remove");
  });

  it("refuses a missing id", () => {
    expect(unwrapErr(parseGmailLabelArgs({ rest: [] })).message).toContain("missing <message-id>");
  });

  it("refuses a leading flag where the id should be", () => {
    const parsed = parseGmailLabelArgs({ rest: ["--add", "X"] });
    expect(unwrapErr(parsed).message).toBe("missing <message-id>");
  });

  it("reads --thread, --dry-run and --json alongside the repeatable pair", () => {
    const args = unwrap(parseGmailLabelArgs({ rest: ["m-1", "--add", "Urgent", "--thread", "--dry-run", "--json"] }));
    expect(args.thread).toBe(true);
    expect(args.dryRun).toBe(true);
    expect(args.json).toBe(true);
  });

  it("defaults every boolean to false", () => {
    const args = unwrap(parseGmailLabelArgs({ rest: ["m-1", "--remove", "INBOX"] }));
    expect(args.thread).toBe(false);
    expect(args.dryRun).toBe(false);
    expect(args.json).toBe(false);
  });
});

describe("parseGmailMarkArgs", () => {
  it("turns --read into the removal of UNREAD", () => {
    const args = unwrap(parseGmailMarkArgs({ rest: ["m-1", "--read"] }));
    expect(args.removeRefs).toStrictEqual(["UNREAD"]);
    expect(args.addRefs).toStrictEqual([]);
    expect(args.intent).toBe("mark read");
  });

  it("turns --unread into the addition of UNREAD", () => {
    const args = unwrap(parseGmailMarkArgs({ rest: ["m-1", "--unread"] }));
    expect(args.addRefs).toStrictEqual(["UNREAD"]);
    expect(args.removeRefs).toStrictEqual([]);
    expect(args.intent).toBe("mark unread");
  });

  it("refuses a bare id rather than defaulting to one direction", () => {
    const parsed = parseGmailMarkArgs({ rest: ["m-1"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("exactly one of --read or --unread");
  });

  it("refuses both directions at once, and says they are opposites", () => {
    const parsed = parseGmailMarkArgs({ rest: ["m-1", "--read", "--unread"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("opposites");
  });

  it("refuses a missing id", () => {
    expect(unwrapErr(parseGmailMarkArgs({ rest: ["--read"] })).message).toContain("missing <message-id>");
  });
});

describe("parseGmailArchiveArgs", () => {
  it("archives by removing INBOX", () => {
    const args = unwrap(parseGmailArchiveArgs({ rest: ["m-1"] }));
    expect(args.removeRefs).toStrictEqual(["INBOX"]);
    expect(args.addRefs).toStrictEqual([]);
    expect(args.intent).toBe("archive");
  });

  it("restores by adding INBOX back", () => {
    const args = unwrap(parseGmailArchiveArgs({ rest: ["m-1", "--restore"] }));
    expect(args.addRefs).toStrictEqual(["INBOX"]);
    expect(args.removeRefs).toStrictEqual([]);
    expect(args.intent).toBe("restore to inbox");
  });

  it("reads --thread and --dry-run", () => {
    const args = unwrap(parseGmailArchiveArgs({ rest: ["t-1", "--thread", "--dry-run"] }));
    expect(args.thread).toBe(true);
    expect(args.dryRun).toBe(true);
  });

  it("refuses a missing id", () => {
    expect(unwrapErr(parseGmailArchiveArgs({ rest: [] })).message).toContain("missing <message-id>");
  });

  it("refuses an unknown flag", () => {
    const parsed = parseGmailArchiveArgs({ rest: ["m-1", "--purge"] });
    expect(unwrapErr(parsed).message).toBe("unknown flag: --purge");
  });

  it("takes every leading id, in the order given, dropping a repeat", () => {
    const args = unwrap(parseGmailArchiveArgs({ rest: ["m-2", "m-1", "m-2", "--dry-run"] }));
    expect(args.addresses).toStrictEqual(["m-2", "m-1"]);
    expect(args.dryRun).toBe(true);
  });

  it("takes exactly the cap, and refuses one past it", () => {
    const ids = Array.from({ length: MAX_ARCHIVE_IDS + 1 }, (_, index) => `m-${String(index)}`);
    expect(unwrap(parseGmailArchiveArgs({ rest: ids.slice(0, MAX_ARCHIVE_IDS) })).addresses.length).toBe(100);
    const refused = unwrapErr(parseGmailArchiveArgs({ rest: ids }));
    expect(refused.message).toBe("at most 100 ids in one call, not 101 — split the set");
    expect(refused.code).toBe("INVALID_FLAG_VALUE");
  });
});

describe("parseGmailConnectArgs", () => {
  it("defaults to the manage grant — read plus modify, and neither composing scope", () => {
    const args = unwrap(parseGmailConnectArgs({ rest: [] }));
    expect(scopesToRequest({ capabilities: args.capabilities, table: GMAIL_SCOPE_TABLE })).toStrictEqual([
      GMAIL_SCOPES.identity,
      GMAIL_SCOPES.read,
      GMAIL_SCOPES.modify,
      GMAIL_SCOPES.docs,
    ]);
    expect(args.statusOnly).toBe(false);
    expect(args.json).toBe(false);
  });

  it("narrows to readonly on --grant read — plus the Docs scope, which rides EVERY grant", () => {
    const args = unwrap(parseGmailConnectArgs({ rest: ["--grant", "read"] }));
    expect(scopesToRequest({ capabilities: args.capabilities, table: GMAIL_SCOPE_TABLE })).toStrictEqual([
      GMAIL_SCOPES.identity,
      GMAIL_SCOPES.read,
      GMAIL_SCOPES.docs,
    ]);
  });

  it("asks for the Docs scope on every grant, because a meeting transcript is behind a linked document", () => {
    for (const grant of ["read", "manage", "full"]) {
      const args = unwrap(parseGmailConnectArgs({ rest: ["--grant", grant] }));
      expect(scopesToRequest({ capabilities: args.capabilities, table: GMAIL_SCOPE_TABLE })).toContain(
        GMAIL_SCOPES.docs,
      );
    }
  });

  it("widens to compose and send on --grant full", () => {
    const args = unwrap(parseGmailConnectArgs({ rest: ["--grant", "full"] }));
    expect(scopesToRequest({ capabilities: args.capabilities, table: GMAIL_SCOPE_TABLE })).toStrictEqual([
      GMAIL_SCOPES.identity,
      GMAIL_SCOPES.read,
      GMAIL_SCOPES.modify,
      GMAIL_SCOPES.compose,
      GMAIL_SCOPES.send,
      GMAIL_SCOPES.docs,
    ]);
  });

  it("refuses an unknown grant name and lists the accepted ones", () => {
    const parsed = parseGmailConnectArgs({ rest: ["--grant", "everything"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("read | manage | full");
    expect(unwrapErr(parsed)).toEqual(
      GmailArgsErrors.grantUnknown({
        grant: "everything",
        known: ["read", "manage", "full"],
        usage: GMAIL_CONNECT_USAGE,
      }),
    );
  });

  it("carries --status and --home through", () => {
    const args = unwrap(parseGmailConnectArgs({ rest: ["--status", "--home", "/tmp/h", "--json"] }));
    expect(args.statusOnly).toBe(true);
    expect(args.home).toBe("/tmp/h");
    expect(args.json).toBe(true);
  });

  it("refuses an unknown flag rather than ignoring it, naming the flag it did not know", () => {
    const parsed = parseGmailConnectArgs({ rest: ["--force"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("--force");
  });
});

describe("GMAIL_CONNECT_USAGE", () => {
  it("names --revoke and says the withdrawal takes every door on the client", () => {
    expect(GMAIL_CONNECT_USAGE).toContain("--revoke");
    expect(GMAIL_CONNECT_USAGE).toContain("every door sharing this OAuth client goes with it");
  });

  it("carries the usage a refusal appends, so a caller sees the grant names it may use", () => {
    const parsed = parseGmailConnectArgs({ rest: ["--grant", "everything"] });
    expect(unwrapErr(parsed).usage).toBe(GMAIL_CONNECT_USAGE);
  });
});

describe("gmailArgsErrorLines", () => {
  it("prints the tokeniser's list and the --board checks as those lists, one record per reason", () => {
    const reasons = ["unknown flag: --bogus", "unexpected argument: extra"];
    expect(gmailArgsErrorLines({ error: GmailArgsErrors.flagsInvalid({ reasons, usage: "u" }) })).toEqual(reasons);
    expect(gmailArgsErrorLines({ error: GmailArgsErrors.boardArgsInvalid({ reasons, usage: "u" }) })).toEqual(reasons);
  });

  it("prints every other refusal as its one message, and never the usage", () => {
    expect(
      gmailArgsErrorLines({ error: GmailArgsErrors.argumentMissing({ name: "<message-id>", usage: "u" }) }),
    ).toEqual(["missing <message-id>"]);
  });

  it("gives an unknown flag and a stray argument as two records", () => {
    const error = unwrapErr(parseGmailReadArgs({ rest: ["m-1", "--bogus", "extra"] }));
    expect(error.code).toBe("FLAGS_INVALID");
    expect(gmailArgsErrorLines({ error })).toEqual(["unknown flag: --bogus", "unexpected argument: extra"]);
  });
});
