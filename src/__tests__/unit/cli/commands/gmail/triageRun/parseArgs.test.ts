/**
 * Unit: `gmail triage`'s parser — the declared default limit, the flags that pair and the ones that refuse each
 * other, and the usage text quoting the same bounds the parser enforces.
 */
import { describe, expect, it } from "vitest";

import { parseGmailTriageArgs } from "../../../../../../cli/commands/gmail/triageCore.js";
import { GMAIL_TRIAGE_USAGE } from "../../../../../../cli/commands/gmail/triageUsage.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { DEFAULT_TRIAGE_LIMIT, MAX_TRIAGE_LIMIT } from "../../../../../../live/gmail/triageRead.js";

describe("parseGmailTriageArgs", () => {
  it("defaults to the declared limit and writes nothing", () => {
    const args = unwrap(parseGmailTriageArgs({ rest: [] }));
    expect([args.limit, args.write, args.json, args.key, args.pin, args.card, args.ruled]).toEqual([
      DEFAULT_TRIAGE_LIMIT,
      false,
      false,
      undefined,
      undefined,
      undefined,
      false,
    ]);
  });

  it("takes --ruled alone, and refuses it beside --key or --card", () => {
    expect(unwrap(parseGmailTriageArgs({ rest: ["--ruled", "--json"] })).ruled).toBe(true);
    for (const rest of [
      ["--ruled", "--key", "from:a@example.test"],
      ["--ruled", "--card", "inbox-triage-1"],
    ]) {
      expect(unwrapErr(parseGmailTriageArgs({ rest })).message).toBe(
        "--ruled prints every ruled group's ids, so it takes none of --key, --pin or --card",
      );
    }
    expect(GMAIL_TRIAGE_USAGE).toContain("--ruled    print the ids every declared archive rule covers");
  });

  it("quotes the same default and maximum its usage prints", () => {
    expect(GMAIL_TRIAGE_USAGE).toContain(
      `(default ${String(DEFAULT_TRIAGE_LIMIT)}, maximum ${String(MAX_TRIAGE_LIMIT)})`,
    );
    expect(GMAIL_TRIAGE_USAGE).toContain(`[--limit <1..${String(MAX_TRIAGE_LIMIT)}>]`);
  });

  it("takes --pin with --key, and --card alone", () => {
    const pinning = unwrap(parseGmailTriageArgs({ rest: ["--key", "from:a@example.test", "--pin", "inbox-triage-1"] }));
    expect([pinning.key, pinning.pin]).toEqual(["from:a@example.test", "inbox-triage-1"]);
    expect(unwrap(parseGmailTriageArgs({ rest: ["--card", "inbox-triage-1"] })).card).toBe("inbox-triage-1");
  });

  it("refuses --pin without --key, --card beside either, a slug that could leave its directory, and a bad limit", () => {
    expect(unwrapErr(parseGmailTriageArgs({ rest: ["--pin", "c-1"] })).code).toBe("FLAG_MISSING");
    expect(unwrapErr(parseGmailTriageArgs({ rest: ["--card", "c-1", "--key", "k"] })).message).toBe(
      "--card prints a set already pinned, so it takes neither --key nor --pin",
    );
    expect(unwrapErr(parseGmailTriageArgs({ rest: ["--card", "../c"] })).message).toBe(
      "--card takes a card slug of lower-case letters, digits and hyphens, not ../c",
    );
    expect(unwrapErr(parseGmailTriageArgs({ rest: ["--key", "k", "--pin", "C-1"] })).code).toBe("INVALID_FLAG_VALUE");
    expect(unwrapErr(parseGmailTriageArgs({ rest: ["--limit", "2001"] })).message).toBe(
      "--limit must be an integer between 1 and 2000",
    );
    expect(unwrapErr(parseGmailTriageArgs({ rest: ["--limit", "0"] })).code).toBe("INVALID_FLAG_VALUE");
  });
});
