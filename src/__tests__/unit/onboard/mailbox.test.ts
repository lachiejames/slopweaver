/**
 * The mailbox step of `slopweaver onboard` — the derivation, and the words it says about it.
 *
 * Three of these are ratchets rather than copy assertions, and they are the point of the file. The block
 * prints COMMANDS, so a flag renamed on `alias list`, `alias provision` or `alias catch-all` leaves `onboard`
 * confidently telling a new user to run something that no longer parses — the failure this flow can least
 * afford, because its reader has no way to tell a stale instruction from a correct one. So every `--flag`
 * token in every command this module builds is checked against the alias verbs' OWN declared flag names.
 */
import { describe, expect, it } from "vitest";

import { ALIAS_PROVIDERS } from "../../../alias/address.js";
import {
  ALIAS_CATCH_ALL_FLAG_NAMES,
  ALIAS_LIST_FLAG_NAMES,
  ALIAS_PROVISION_FLAG_NAMES,
} from "../../../cli/commands/alias/core.js";
import {
  catchAllCommand,
  FIRST_SEAT_LABEL,
  IDENTITY_FLAG,
  listCommand,
  MAILBOX_ZONE_FLAG,
  mailboxCommandLines,
  mailboxLines,
  mailboxPlan,
  provisionCommand,
} from "../../../onboard/mailbox.js";

/** Every `--flag` token in one command line. */
function flagsIn({ command }: { command: string }): readonly string[] {
  return command.split(" ").filter((token) => token.startsWith("--"));
}

/** The block, as one string, for whole-output assertions. */
function blockText({ identity, zone }: { identity: string | undefined; zone: string | undefined }): string {
  return mailboxLines({ plan: mailboxPlan({ identity, zone }) }).join("\n");
}

describe("mailboxPlan", () => {
  it("has at least one provider, so the seat guards below are not vacuously green", () => {
    expect(ALIAS_PROVIDERS.length).toBeGreaterThan(0);
  });

  it("derives one address per provider, identity first and label `one`", () => {
    const plan = mailboxPlan({ identity: "ada-lovelace", zone: "example.org" });

    expect(plan.kind).toBe("derived");
    expect(plan).toEqual({
      identity: "ada-lovelace",
      kind: "derived",
      seats: [
        { address: "ada-lovelace-claude-one@example.org", provider: "claude" },
        { address: "ada-lovelace-codex-one@example.org", provider: "codex" },
      ],
      zone: "example.org",
    });
  });

  it("covers EVERY provider the alias verb knows, so adding one cannot silently drop a seat", () => {
    const plan = mailboxPlan({ identity: "ada-lovelace", zone: "example.org" });
    const providers = plan.kind === "derived" ? plan.seats.map((seat) => seat.provider) : [];

    expect(providers).toEqual([...ALIAS_PROVIDERS]);
  });

  it("names BOTH missing flags when neither was given", () => {
    expect(mailboxPlan({ identity: undefined, zone: undefined })).toEqual({
      kind: "unasked",
      missing: [IDENTITY_FLAG, MAILBOX_ZONE_FLAG],
    });
  });

  it("names only the flag that is actually missing", () => {
    expect(mailboxPlan({ identity: "ada-lovelace", zone: undefined })).toEqual({
      kind: "unasked",
      missing: [MAILBOX_ZONE_FLAG],
    });
    expect(mailboxPlan({ identity: undefined, zone: "example.org" })).toEqual({
      kind: "unasked",
      missing: [IDENTITY_FLAG],
    });
  });

  it("refuses an identity carrying a provider segment, in aliasAddress's own words", () => {
    const plan = mailboxPlan({ identity: "claude-smith", zone: "example.org" });

    expect(plan.kind).toBe("refused");
    expect(plan).toEqual({
      kind: "refused",
      why:
        '"claude-smith" cannot be part of an alias address: it carries the provider claude, which is what ' +
        "separates the identity from the label",
    });
  });

  it("refuses an identity the address rule cannot hold, rather than minting an unreadable address", () => {
    const plan = mailboxPlan({ identity: "Ada.Lovelace", zone: "example.org" });

    expect(plan.kind).toBe("refused");
  });

  it("refuses a zone that is not dot-joined labels", () => {
    const plan = mailboxPlan({ identity: "ada-lovelace", zone: "https://example.org" });

    expect(plan.kind).toBe("refused");
  });
});

describe("the commands the block builds", () => {
  it("builds the provision command from the same parts as the address", () => {
    expect(provisionCommand({ identity: "ada-lovelace", provider: "claude", zone: "example.org" })).toBe(
      "slopweaver alias provision --domain example.org --identity ada-lovelace --provider claude " +
        "--label one --destination <verified mailbox>",
    );
  });

  it("builds the catch-all command, leaving the destination a placeholder it cannot verify", () => {
    expect(catchAllCommand({ zone: "example.org" })).toBe(
      "slopweaver alias catch-all --domain example.org --enable --destination <verified mailbox>",
    );
  });

  it("builds the probe command against the zone it was given", () => {
    expect(listCommand({ zone: "example.org" })).toBe("slopweaver alias list --domain example.org");
  });

  it("uses only flags `alias list` actually declares", () => {
    const unknown = flagsIn({ command: listCommand({ zone: "example.org" }) }).filter(
      (flag) => !ALIAS_LIST_FLAG_NAMES.includes(flag),
    );

    expect(ALIAS_LIST_FLAG_NAMES.length).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });

  it("uses only flags `alias provision` actually declares", () => {
    const unknown = flagsIn({
      command: provisionCommand({ identity: "ada-lovelace", provider: "codex", zone: "example.org" }),
    }).filter((flag) => !ALIAS_PROVISION_FLAG_NAMES.includes(flag));

    expect(ALIAS_PROVISION_FLAG_NAMES.length).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });

  it("uses only flags `alias catch-all` actually declares", () => {
    const unknown = flagsIn({ command: catchAllCommand({ zone: "example.org" }) }).filter(
      (flag) => !ALIAS_CATCH_ALL_FLAG_NAMES.includes(flag),
    );

    expect(ALIAS_CATCH_ALL_FLAG_NAMES.length).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });
});

describe("what the block says", () => {
  it("prints the person's own two addresses once they are derivable", () => {
    const text = blockText({ identity: "ada-lovelace", zone: "example.org" });

    expect(text).toContain("ada-lovelace-claude-one@example.org");
    expect(text).toContain("ada-lovelace-codex-one@example.org");
  });

  it("teaches the shape and names the flags when it was told nothing — never a guessed identity", () => {
    const text = blockText({ identity: undefined, zone: undefined });

    expect(text).toContain(IDENTITY_FLAG);
    expect(text).toContain(MAILBOX_ZONE_FLAG);
    expect(text).toContain(`<identity>-claude-${FIRST_SEAT_LABEL}@<zone>`);
  });

  it("puts the REAL zone in the probe command once it has one — never the placeholder beside it", () => {
    const text = blockText({ identity: "ada-lovelace", zone: "example.org" });

    // The negative is a witness only because the unasked block really does print that placeholder line —
    // asserted here so a rename that kills both halves reddens rather than passing on silence.
    expect(blockText({ identity: undefined, zone: undefined })).toContain("alias list --domain <your zone>");
    expect(text).toContain("slopweaver alias list --domain example.org");
    expect(text).not.toContain("alias list --domain <your zone>");
  });

  it("names no real zone or mailbox of its own when it was told none", () => {
    const text = blockText({ identity: undefined, zone: undefined });

    expect(text).toContain("<your zone>");
    expect(text).toContain("<verified mailbox>");
  });

  it("states the catch-all's ONE destination for the WHOLE zone at the point of choice", () => {
    const lines = mailboxLines({ plan: mailboxPlan({ identity: "ada-lovelace", zone: "example.org" }) });
    const catchAll = lines.findIndex((line) => line.includes("CATCH-ALL"));
    const command = lines.findIndex((line) => line.includes("alias catch-all"));

    expect(catchAll).toBeGreaterThan(-1);
    expect(command).toBeGreaterThan(catchAll);
    expect(lines.slice(catchAll, command).join("\n")).toContain("ONE destination for the WHOLE");
  });

  it("names the Edit scope as the cost of the per-seat shape, and the admin who holds it", () => {
    const text = blockText({ identity: "ada-lovelace", zone: "example.org" });

    expect(text).toContain("Zone · Email Routing Rules · Edit");
    expect(text).toContain("an admin credential");
  });

  it("names both refusals a write hits before it works, and says each one writes nothing", () => {
    const text = blockText({ identity: "ada-lovelace", zone: "example.org" });

    expect(text).toContain("ROUTING_DISABLED");
    expect(text).toContain("DESTINATION_UNVERIFIED");
    expect(text.split("writes nothing").length - 1).toBe(2);
  });

  it("says onboard writes none of it, and that the signup itself stays a hand step", () => {
    const text = blockText({ identity: "ada-lovelace", zone: "example.org" });

    expect(text).toContain("`onboard` writes NONE of this");
    expect(text).toContain("utilize automation in account creation");
  });

  it("says the step is for the NEXT seat, so it does not read as bootstrapping the plan you are on", () => {
    expect(blockText({ identity: "ada-lovelace", zone: "example.org" })).toContain("NEXT seat");
  });

  it("shows the refusal instead of an address when the flags cannot make one", () => {
    const text = blockText({ identity: "claude-smith", zone: "example.org" });

    expect(text).toContain("it carries the provider claude");
    expect(text).not.toContain("claude-smith-claude-one@");
  });
});

describe("the command stanza", () => {
  it("spells the derived seat once the flags make one", () => {
    const stanza = mailboxCommandLines({
      plan: mailboxPlan({ identity: "ada-lovelace", zone: "example.org" }),
    }).join("\n");

    expect(stanza).toContain("slopweaver alias list --domain example.org");
    expect(stanza).toContain("--domain example.org --identity ada-lovelace --provider claude");
  });

  it("never shows a real identity beside a placeholder zone — half a pair derives nothing", () => {
    const stanza = mailboxCommandLines({
      plan: mailboxPlan({ identity: "ada-lovelace", zone: undefined }),
    }).join("\n");

    expect(stanza).toContain("--domain <your zone> --identity <your-name>");
    expect(stanza).not.toContain("ada-lovelace");
  });

  it("uses only flags the three alias verbs declare, across the whole stanza", () => {
    const declared = [...ALIAS_LIST_FLAG_NAMES, ...ALIAS_CATCH_ALL_FLAG_NAMES, ...ALIAS_PROVISION_FLAG_NAMES];
    const unknown = mailboxCommandLines({ plan: mailboxPlan({ identity: "ada-lovelace", zone: "example.org" }) })
      .flatMap((line) => flagsIn({ command: line }))
      .filter((flag) => !declared.includes(flag));

    expect(declared.length).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });
});
