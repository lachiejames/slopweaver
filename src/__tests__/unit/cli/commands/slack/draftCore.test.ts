/*
 * `slack draft`'s parse, on its own. The verb test drives the whole runner; this one pins the edges that
 * runner never reaches — the bare id somebody pastes out of the console, and each mandatory refusal, which
 * has to fire BEFORE any live call so a malformed invocation costs no Slack request at all.
 */

import { describe, expect, it } from "vitest";

import { SlackArgumentErrors, slackArgumentErrorLines } from "../../../../../cli/commands/slack/argumentErrors.js";
import { parseSlackDraftArgs, SLACK_DRAFT_SUBCOMMANDS } from "../../../../../cli/commands/slack/draftCore.js";
import { approvalProblems } from "../../../../../cli/commands/slack/draftRecordProblems.js";
import { SLACK_DRAFT_USAGE } from "../../../../../cli/commands/slack/slackUsage.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** The home every case parses against, so no case depends on the ambient one. */
const HOME = "/tmp/slopweaver-draft-core";

describe("parseSlackDraftArgs", () => {
  it("reads a record invocation whole, and takes the home off the flag when one is given", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({
        defaultHome: HOME,
        rest: [
          "record",
          "--channel",
          "C0ISO",
          "--form",
          "-",
          "--why",
          "the ISO group question",
          "--home",
          "/elsewhere",
        ],
      }),
    );
    expect(parsed).toEqual({
      actor: "me",
      askedBefore: "undeclared",
      channel: "C0ISO",
      formSource: "-",
      home: "/elsewhere",
      json: false,
      media: [],
      mode: "record",
      receipts: { kind: "undeclared" },
      supersedes: [],
      why: "the ISO group question",
    });
  });

  it("reads --media as a comma list in attach order, the way slack post reads it", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({
        defaultHome: HOME,
        rest: ["record", "--channel", "C0ISO", "--form", "-", "--why", "w", "--media", "a.mp4, b.png"],
      }),
    );
    expect(parsed).toEqual({
      actor: "me",
      askedBefore: "undeclared",
      channel: "C0ISO",
      formSource: "-",
      home: HOME,
      json: false,
      media: ["a.mp4", "b.png"],
      mode: "record",
      receipts: { kind: "undeclared" },
      supersedes: [],
      why: "w",
    });
  });

  it("takes the id as a bare word, which is what the console's own copy button hands out", () => {
    const parsed = unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: ["show", "sd-1a2b3c4d", "--json"] }));
    expect(parsed).toEqual({ home: HOME, id: "sd-1a2b3c4d", json: true, mode: "show" });
  });

  it("takes the same id through --id, for a caller composing a command line", () => {
    const parsed = unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: ["show", "--id", "sd-1a2b3c4d"] }));
    expect(parsed).toEqual({ home: HOME, id: "sd-1a2b3c4d", json: false, mode: "show" });
  });

  it("still refuses a stray positional that is not the id, so the bare-id exception stays one word wide", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: ["show", "sd-1a2b3c4d", "oops"] });
    expect(refused.isOk()).toBe(false);
    expect(unwrapErr(refused).code).toBe("FLAGS_INVALID");
    expect(slackArgumentErrorLines({ error: unwrapErr(refused) }).join(" ")).toContain("oops");
  });

  it("names every missing record flag at once rather than one per run", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: ["record"] });
    expect(refused.isOk()).toBe(false);
    expect(unwrapErr(refused).code).toBe("ARGUMENTS_REFUSED");
    const said = slackArgumentErrorLines({ error: unwrapErr(refused) }).join("\n");
    expect(said).toContain("--channel");
    expect(said).toContain("--form");
    expect(said).toContain("--why");
  });

  it("refuses a drop with no --note: a row resolved with no reason is one nobody can audit", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: ["drop", "sd-1a2b3c4d"] });
    expect(refused.isOk()).toBe(false);
    expect(unwrapErr(refused)).toEqual(SlackArgumentErrors.draftNoteMissing());
    expect(unwrapErr(refused).message).toBe(
      "slack draft drop needs --note <text>: a row resolved with no reason is one nobody can audit",
    );
  });

  it("refuses a show with no id at all, and says where to find one", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: ["show"] });
    expect(refused.isOk()).toBe(false);
    expect(unwrapErr(refused)).toEqual(SlackArgumentErrors.draftIdMissing({ subcommand: "show" }));
    expect(unwrapErr(refused).message).toContain("slopweaver slack draft list");
  });

  it("refuses a word that is not a sub-command, naming the ones that are", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: ["release", "sd-1a2b3c4d"] });
    expect(refused.isOk()).toBe(false);
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.draftSubcommandUnknown({ got: "release", known: SLACK_DRAFT_SUBCOMMANDS }),
    );
    expect(unwrapErr(refused).message).toContain(
      "record, list, show, context, approve, pick, compare, revise, restore, hold, drop, corrections",
    );
  });

  it("reads context by the same bare id show takes, since the console asks for one draft's conversation", () => {
    const parsed = unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: ["context", "sd-1a2b3c4d", "--json"] }));
    expect(parsed).toEqual({ home: HOME, id: "sd-1a2b3c4d", json: true, mode: "context" });
  });

  it("refuses a context with no id, naming the sub-command it was", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: ["context"] });
    expect(unwrapErr(refused)).toEqual(SlackArgumentErrors.draftIdMissing({ subcommand: "context" }));
  });

  it("reads list, whose --all is the only way to see a row already resolved", () => {
    expect(unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: ["list"] }))).toEqual({
      all: false,
      home: HOME,
      json: false,
      mode: "list",
    });
    expect(unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: ["list", "--all"] }))).toEqual({
      all: true,
      home: HOME,
      json: false,
      mode: "list",
    });
  });
});

describe("the usage block", () => {
  it("names every sub-command the parser accepts", () => {
    expect(SLACK_DRAFT_SUBCOMMANDS.length).toBeGreaterThan(0);
    expect(SLACK_DRAFT_SUBCOMMANDS.filter((sub) => !SLACK_DRAFT_USAGE.includes(`slack draft ${sub}`))).toEqual([]);
  });

  /**
   * The block names the RELEASE VERB and deliberately not its flags. `helpTruth` reads a usage block token
   * by token, so spelling `--as me --draft <id>` here would advertise two flags `slack draft` does not
   * accept; `show` prints the real command with the id and digest filled in, which is the copyable thing.
   */
  it("says out loud that release is not here, because the send lives on the door's own verb", () => {
    expect(SLACK_DRAFT_USAGE).toContain("release is NOT here");
    expect(SLACK_DRAFT_USAGE).toContain("`slopweaver slack post` sends a top-level one");
    expect(SLACK_DRAFT_USAGE).toContain("`slopweaver slack reply` a\n          thread one");
    expect(SLACK_DRAFT_USAGE).toContain("`show` prints that exact command");
  });
});

describe("record --thread-ts — parking a reply INTO its thread", () => {
  /** A record invocation carrying `extra` after its three mandatory flags. */
  function record({ why = "w", extra = [] }: { why?: string; extra?: readonly string[] }): readonly string[] {
    return ["record", "--channel", "C0SYN000002", "--form", "-", "--why", why, ...extra];
  }

  it("carries the thread root the reply goes under", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({ defaultHome: HOME, rest: record({ extra: ["--thread-ts", "1790566514.594969"] }) }),
    );
    expect(parsed).toEqual({
      actor: "me",
      askedBefore: "undeclared",
      channel: "C0SYN000002",
      formSource: "-",
      home: HOME,
      json: false,
      media: [],
      mode: "record",
      receipts: { kind: "undeclared" },
      supersedes: [],
      threadTs: "1790566514.594969",
      why: "w",
    });
  });

  it("refuses a ts that is not one, naming how to read it off the root's permalink", () => {
    const refused = parseSlackDraftArgs({
      defaultHome: HOME,
      rest: record({ extra: ["--thread-ts", "p1790566514594969"] }),
    });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: [
          "--thread-ts p1790566514594969 is not a Slack ts (seconds.microseconds, e.g. 1790145643.664469) — take " +
            "it from the thread root's permalink: p1790145643664469 is 1790145643.664469",
        ],
      }),
    );
  });

  it("refuses a why that says thread reply with no --thread-ts — the row that went out top-level", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: record({ why: "THREAD REPLY, not top-level" }) });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: [
          "slack draft record: --why says this is a THREAD reply, but no --thread-ts names the thread, so it " +
            "would park top-level and release into the channel. Pass --thread-ts <root ts>, or reword the why.",
        ],
      }),
    );
  });

  it("parks the same thread-reply why once --thread-ts names the thread", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({
        defaultHome: HOME,
        rest: record({ extra: ["--thread-ts", "1790566514.594969"], why: "THREAD REPLY, not top-level" }),
      }),
    );
    expect(parsed).toMatchObject({ threadTs: "1790566514.594969", why: "THREAD REPLY, not top-level" });
  });

  it("carries the held row a re-cut --supersedes, and refuses a value that is not a draft id", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({ defaultHome: HOME, rest: record({ extra: ["--supersedes", "sd-2a84c6d4"] }) }),
    );
    expect(parsed).toMatchObject({ mode: "record", supersedes: ["sd-2a84c6d4"] });
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: record({ extra: ["--supersedes", "2a84c6d4"] }) });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: ["--supersedes 2a84c6d4 is not a draft id (sd- and eight hex digits, e.g. sd-1a2b3c4d)"],
      }),
    );
  });

  it("reads --supersedes as a comma list in the caller's order, so one merged reply re-cuts every held one", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({
        defaultHome: HOME,
        rest: record({ extra: ["--supersedes", "sd-2a84c6d4, sd-0000aaaa,sd-1111bbbb"] }),
      }),
    );
    expect(parsed).toMatchObject({ mode: "record", supersedes: ["sd-2a84c6d4", "sd-0000aaaa", "sd-1111bbbb"] });
  });

  it("refuses an empty --supersedes rather than reading it as absent, which would leave the old cut held", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: record({ extra: ["--supersedes", " , "] }) });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: ["--supersedes names no draft id — pass the held row(s) this one re-cuts, or drop the flag"],
      }),
    );
  });

  it("refuses a --supersedes list naming one row twice, and names every bad entry", () => {
    const refused = parseSlackDraftArgs({
      defaultHome: HOME,
      rest: record({ extra: ["--supersedes", "sd-2a84c6d4,nope,sd-2a84c6d4"] }),
    });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: [
          "--supersedes nope is not a draft id (sd- and eight hex digits, e.g. sd-1a2b3c4d)",
          "--supersedes names sd-2a84c6d4 twice — name each held row once",
        ],
      }),
    );
  });
});

describe("record --as and --kind — who a parked row goes out as, and what it is", () => {
  const RECORD = ["record", "--channel", "C0TEAM", "--form", "-", "--why", "w"] as const;

  it("records a bot finding when both are named", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--as", "bot", "--kind", "finding"] }),
    );
    expect(parsed).toMatchObject({ actor: "bot", kind: "finding" });
  });

  it("reads an absent --as as me and leaves an absent --kind undeclared", () => {
    const parsed = unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD] }));
    expect(parsed).toMatchObject({ actor: "me" });
    expect("kind" in parsed).toBe(false);
  });

  it("refuses an identity or a kind it does not know, naming both at once", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--as", "robot", "--kind", "memo"] });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: [
          "slack draft record --as must be bot or me, got robot",
          "slack draft record --kind must be finding or message, got memo",
        ],
      }),
    );
  });

  it("carries --impact's count and words, and leaves an absent one off the options", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--impact", "2,480 customers re-ordered a test"] }),
    );
    expect(parsed).toMatchObject({ impact: { count: "2,480", text: "2,480 customers re-ordered a test" } });
    expect("impact" in unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD] }))).toBe(false);
  });

  it("refuses an --impact that does not lead with how many people, before anything is read", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--impact", "many tier 3 customers"] });
    expect(unwrapErr(refused).message).toContain("--impact must lead with how many people");
  });

  it("reads each --act the card can badge, and leaves an absent one undeclared", () => {
    const parsed = ["reply", "bump", "review-ask"].map((act) =>
      unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--act", act] })),
    );
    expect(parsed).toMatchObject([
      { act: "reply", mode: "record" },
      { act: "bump", mode: "record" },
      { act: "review-ask", mode: "record" },
    ]);
    expect("act" in unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD] }))).toBe(false);
  });

  it("refuses --act question, naming that a question is an ask row's badge, not a draft's", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--act", "question"] });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: [
          "slack draft record --act must be reply, bump, review-ask, got question: a question is the badge of a board ask row, where they are the one asked — a draft asking somebody is a reply or a bump",
        ],
      }),
    );
  });

  it("reads --row as the board row's slug, and leaves an absent one off the options", () => {
    const parsed = unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--row", "thread-chase-daily"] }));
    expect(parsed).toMatchObject({ mode: "record", row: "thread-chase-daily" });
    expect("row" in unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD] }))).toBe(false);
  });

  it("refuses a --row that is no plain slug, before any doc is looked for", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--row", "../escape"] });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: ['slack draft record --row must be a board row\'s slug, got "../escape"'],
      }),
    );
  });

  it("reads --followup-of as the finding's draft id, and leaves an absent one off the options", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--followup-of", "sd-dd932464"] }),
    );
    expect(parsed).toMatchObject({ followupOf: "sd-dd932464", mode: "record" });
    expect("followupOf" in unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD] }))).toBe(false);
  });

  it("refuses a --followup-of that is no draft id, before the register is read", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--followup-of", "1791764888.080129"] });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: [
          'slack draft record --followup-of must name a released finding\'s draft id (sd-…), got "1791764888.080129"',
        ],
      }),
    );
  });

  it("refuses an --act outside the set, naming the set", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--act", "chase"] });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: ["slack draft record --act must be reply, bump, review-ask, got chase"],
      }),
    );
  });
});

describe("record --reviewer — whether a DM review ask's person was in the conversation", () => {
  const RECORD = ["record", "--channel", "U0SYN000008", "--form", "-", "--why", "w"] as const;

  it("carries a declared reviewer and leaves an absent one off the options", () => {
    expect(unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--reviewer", "new"] }))).toMatchObject({
      reviewer: "new",
    });
    expect("reviewer" in unwrap(parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD] }))).toBe(false);
  });

  it("refuses a reviewer it does not know", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: [...RECORD, "--reviewer", "stranger"] });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: ["slack draft record --reviewer must be new, in-thread or not-an-ask, got stranger"],
      }),
    );
  });
});

describe("approve and hold — a session's judgement of the owner's words on a draft", () => {
  it("reads an approve as the row and the anchor the owner's yes is at", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({ defaultHome: HOME, rest: ["approve", "sd-c57b4ade", "--anchor", "talk-call:f9e9277d#12"] }),
    );
    expect(parsed).toEqual({
      anchor: "talk-call:f9e9277d#12",
      home: HOME,
      id: "sd-c57b4ade",
      json: false,
      mode: "approve",
    });
  });

  it("refuses an approve naming no anchor, since an approval nobody can check is no approval", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: ["approve", "sd-c57b4ade", "--anchor", " "] });
    expect(unwrapErr(refused)).toEqual(SlackArgumentErrors.flagRequired({ flag: "--anchor <the owner's yes>" }));
  });

  it("reads a hold as the row, a reason from the closed set and what the session saw", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({
        defaultHome: HOME,
        rest: ["hold", "sd-c57b4ade", "--reason", "no-fleet-slot", "--why", "every slot is busy", "--json"],
      }),
    );
    expect(parsed).toEqual({
      home: HOME,
      id: "sd-c57b4ade",
      json: true,
      mode: "hold",
      reason: "no-fleet-slot",
      why: "every slot is busy",
    });
  });

  it("refuses a hold with an unknown reason and a blank why, naming both at once", () => {
    const refused = parseSlackDraftArgs({
      defaultHome: HOME,
      rest: ["hold", "sd-c57b4ade", "--reason", "busy", "--why", "  "],
    });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.flagsInvalid({
        reasons: [
          "--reason must be one of not-owner-yes, meaning-changed, thread-moved, no-fleet-slot, slack-refused, not busy",
          "--why <what you saw> is required: the Queue card prints it as the reason it was not sent",
        ],
      }),
    );
  });

  it("refuses a record or a hold whose why names a call by id — the card that opened blank", () => {
    const why = "recut on the owner's word (talk-call efe7b241, 01:16Z)";
    const problem =
      '--why names "call efe7b241" by its machine id, which the Queue card prints to them and refuses — name it by ' +
      'what it was doing ("their call this morning", "the recut they asked for") and drop the id';
    const recorded = parseSlackDraftArgs({
      defaultHome: HOME,
      rest: ["record", "--channel", "C0SYN000002", "--form", "-", "--why", why],
    });
    expect(unwrapErr(recorded)).toEqual(SlackArgumentErrors.argumentsRefused({ reasons: [problem] }));
    const held = parseSlackDraftArgs({
      defaultHome: HOME,
      rest: ["hold", "sd-c57b4ade", "--reason", "no-fleet-slot", "--why", why],
    });
    expect(unwrapErr(held)).toEqual(SlackArgumentErrors.flagsInvalid({ reasons: [problem] }));
    // A hold drops --meaning-changed, but no flag the parser accepts may carry an id.
    const heldMeaning = parseSlackDraftArgs({
      defaultHome: HOME,
      rest: ["hold", "sd-c57b4ade", "--reason", "no-fleet-slot", "--why", "busy", "--meaning-changed", "call efe7b241"],
    });
    expect(unwrapErr(heldMeaning)).toEqual(
      SlackArgumentErrors.flagsInvalid({ reasons: [problem.replace("--why", "--meaning-changed")] }),
    );
  });

  it("refuses a why, an anchor or a meaning change the register would read back as blank", () => {
    // ZERO WIDTH SPACE, which `trim` leaves, and HANGUL FILLER, a letter that renders as nothing.
    const invisible = String.fromCodePoint(0x200b);
    const filler = String.fromCodePoint(0x3164);
    const hold = parseSlackDraftArgs({
      defaultHome: HOME,
      rest: ["hold", "sd-c57b4ade", "--reason", "no-fleet-slot", "--why", invisible],
    });
    const approve = parseSlackDraftArgs({ defaultHome: HOME, rest: ["approve", "sd-c57b4ade", "--anchor", invisible] });

    expect(unwrapErr(hold)).toEqual(
      SlackArgumentErrors.flagsInvalid({
        reasons: ["--why <what you saw> is required: the Queue card prints it as the reason it was not sent"],
      }),
    );
    expect(unwrapErr(approve)).toEqual(SlackArgumentErrors.flagRequired({ flag: "--anchor <the owner's yes>" }));
    expect(approvalProblems({ values: { approved: invisible, "meaning-changed": filler } })).toEqual([
      "--approved names no anchor — pass the talk-call:, talk:, call: or transcript: anchor of their yes",
      "--meaning-changed says nothing — name what changed since they approved the row it re-cuts",
      "--approved and --meaning-changed cannot both be given: one says they said yes, the other that it lapsed",
    ]);
  });

  it("refuses a hold with no reason at all without quoting one", () => {
    const refused = parseSlackDraftArgs({ defaultHome: HOME, rest: ["hold", "sd-c57b4ade", "--why", "w"] });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.flagsInvalid({
        reasons: ["--reason must be one of not-owner-yes, meaning-changed, thread-moved, no-fleet-slot, slack-refused"],
      }),
    );
  });
});

describe("revise and restore — the console voice editing a parked draft live", () => {
  it("reads a revise as the row, the words from stdin, and what the owner said asking for it", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({
        defaultHome: HOME,
        rest: [
          "revise",
          "sd-c57b4ade",
          "--text",
          "-",
          "--heard",
          "make it warmer",
          "--reading",
          '["Warmer opening"]',
          "--anchor",
          "talk-call:f9e9277d#turn_A",
        ],
      }),
    );
    expect(parsed).toEqual({
      anchor: "talk-call:f9e9277d#turn_A",
      heard: "make it warmer",
      home: HOME,
      id: "sd-c57b4ade",
      json: false,
      mode: "revise",
      reading: ["Warmer opening"],
      textSource: "-",
    });
  });

  it("reads a restore as the version to put back", () => {
    const parsed = unwrap(
      parseSlackDraftArgs({ defaultHome: HOME, rest: ["restore", "sd-c57b4ade", "--version", "1"] }),
    );
    expect(parsed).toEqual({ home: HOME, id: "sd-c57b4ade", json: false, mode: "restore", version: 1 });
  });

  it("refuses a revise with no words and a reading that is not a list, naming both at once", () => {
    const refused = parseSlackDraftArgs({
      defaultHome: HOME,
      rest: ["revise", "sd-c57b4ade", "--text", " ", "--reading", "warmer"],
    });
    expect(unwrapErr(refused)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: [
          `--reading is a JSON array of 1-5 short lines, each at most 120 characters: --reading '["cut the second paragraph","tag Ari"]'`,
          "slack draft revise needs --text <the whole rewritten message|->",
        ],
      }),
    );
  });

  it("refuses a restore naming no version, or version zero", () => {
    const expected = SlackArgumentErrors.argumentsRefused({
      reasons: ["slack draft restore needs --version <n>, the version to put back (1 is the parked words)"],
    });
    expect(unwrapErr(parseSlackDraftArgs({ defaultHome: HOME, rest: ["restore", "sd-c57b4ade"] }))).toEqual(expected);
    const zero = parseSlackDraftArgs({ defaultHome: HOME, rest: ["restore", "sd-c57b4ade", "--version", "0"] });
    expect(unwrapErr(zero)).toEqual(expected);
  });
});
