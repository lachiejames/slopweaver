import { describe, expect, it } from "vitest";

import { buildStatusProfilePlan, parseStatusArgs } from "../../../../../cli/commands/slack/statusCore.js";
import { SlackStatusErrors } from "../../../../../cli/commands/slack/statusErrors.js";
import {
  classifyStatusFailure,
  presenceDocument,
  presenceFollowUp,
  presenceHeldLines,
  presenceReadbackMismatch,
  presenceWriteFailureLine,
  readbackFailure,
  statusDryRunLines,
  statusHeldLines,
  statusReadbackMismatch,
  statusWriteFailureLine,
  UNDO_MANUAL_AWAY,
} from "../../../../../cli/commands/slack/statusReport.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const HOME = "/probe-home";

function parse({ rest }: { rest: readonly string[] }): ReturnType<typeof parseStatusArgs> {
  return parseStatusArgs({ defaultHome: HOME, rest });
}

describe("parseStatusArgs", () => {
  it("parses a set with text, emoji and an end-of-day expiry in a named zone", () => {
    const parsed = parse({
      rest: [
        "set",
        "--text",
        "Public holiday, back Monday",
        "--emoji",
        ":palm_tree:",
        "--until",
        "end-of-day",
        "--zone",
        "Australia/Melbourne",
      ],
    });
    expect(unwrap(parsed)).toEqual({
      dryRun: false,
      emoji: ":palm_tree:",
      home: HOME,
      json: false,
      sub: "set",
      text: "Public holiday, back Monday",
      until: { kind: "end-of-day", zone: "Australia/Melbourne" },
      zone: "Australia/Melbourne",
    });
  });

  it("reads an ISO --until that names its offset as that instant", () => {
    const parsed = parse({ rest: ["set", "--text", "x", "--until", "2026-09-26T00:00:00+10:00"] });
    expect(unwrap(parsed)).toEqual({
      dryRun: false,
      emoji: "",
      home: HOME,
      json: false,
      sub: "set",
      text: "x",
      until: { atMs: Date.parse("2026-09-25T14:00:00Z"), kind: "instant" },
      zone: undefined,
    });
  });

  it("parses clear, show and presence with --home", () => {
    expect(unwrap(parse({ rest: ["clear", "--dry-run", "--home", "/h"] }))).toEqual({
      dryRun: true,
      home: "/h",
      json: false,
      sub: "clear",
    });
    expect(unwrap(parse({ rest: ["show", "--json"] }))).toEqual({
      home: HOME,
      json: true,
      sub: "show",
      zone: undefined,
    });
    expect(unwrap(parse({ rest: ["presence", "--to", "away"] }))).toEqual({
      dryRun: false,
      home: HOME,
      json: false,
      presence: "away",
      sub: "presence",
    });
  });

  it("refuses an unknown sub-command, naming it", () => {
    expect(unwrapErr(parse({ rest: ["wipe"] })).code).toBe("SUBCOMMAND_UNKNOWN");
  });

  it("refuses a flag that belongs to another sub-command rather than ignoring it", () => {
    const error = unwrapErr(parse({ rest: ["clear", "--text", "x"] }));
    expect(error).toEqual(SlackStatusErrors.flagNotForSubcommand({ flag: "text", sub: "clear" }));
  });

  it("refuses a set with neither text nor emoji", () => {
    expect(unwrapErr(parse({ rest: ["set", "--until", "end-of-day", "--zone", "UTC"] })).code).toBe("STATUS_EMPTY");
  });

  it("refuses text over Slack's 100 characters instead of cutting it", () => {
    expect(unwrapErr(parse({ rest: ["set", "--text", "a".repeat(101)] }))).toEqual(
      SlackStatusErrors.textTooLong({ chars: 101, max: 100 }),
    );
    expect(parse({ rest: ["set", "--text", "a".repeat(100)] }).isOk()).toBe(true);
  });

  it("refuses an emoji without its colons, and accepts a skin tone", () => {
    expect(unwrapErr(parse({ rest: ["set", "--emoji", "palm_tree"] })).code).toBe("EMOJI_MALFORMED");
    expect(parse({ rest: ["set", "--emoji", ":wave::skin-tone-3:"] }).isOk()).toBe(true);
  });

  it("refuses end-of-day without a zone — the day is never guessed", () => {
    expect(unwrapErr(parse({ rest: ["set", "--text", "x", "--until", "end-of-day"] })).code).toBe("UNTIL_NEEDS_ZONE");
  });

  it("refuses an ISO --until with no offset, which Date.parse would read as machine-local", () => {
    expect(unwrapErr(parse({ rest: ["set", "--text", "x", "--until", "2026-09-26T00:00:00"] })).code).toBe(
      "UNTIL_UNPARSEABLE",
    );
  });

  it("refuses a wall clock that does not exist rather than letting Date.parse roll it over", () => {
    expect(Date.parse("2026-02-30T10:00:00Z")).toBe(Date.parse("2026-03-02T10:00:00Z"));
    expect(unwrapErr(parse({ rest: ["set", "--text", "x", "--until", "2026-02-30T10:00:00Z"] }))).toEqual(
      SlackStatusErrors.untilUnparseable({ raw: "2026-02-30T10:00:00Z" }),
    );
    expect(unwrapErr(parse({ rest: ["set", "--text", "x", "--until", "2026-09-25T24:30:00+10:00"] })).code).toBe(
      "UNTIL_UNPARSEABLE",
    );
  });

  it("refuses a non-ISO shape Date.parse would still accept", () => {
    expect(Number.isFinite(Date.parse("25 Sep 2026 17:00 -05:00"))).toBe(true);
    expect(unwrapErr(parse({ rest: ["set", "--text", "x", "--until", "25 Sep 2026 17:00 -05:00"] })).code).toBe(
      "UNTIL_UNPARSEABLE",
    );
  });

  it("takes an ISO instant with no seconds", () => {
    const noSeconds = unwrap(parse({ rest: ["set", "--text", "x", "--until", "2026-09-26T00:00-05:00"] }));
    expect(noSeconds).toEqual({ ...noSeconds, until: { atMs: Date.parse("2026-09-26T05:00:00Z"), kind: "instant" } });
  });

  it("refuses fractional seconds, which Slack's whole-second expiry would have to round", () => {
    expect(unwrapErr(parse({ rest: ["set", "--text", "x", "--until", "2026-09-26T00:00:00.999Z"] })).code).toBe(
      "UNTIL_UNPARSEABLE",
    );
  });

  it("refuses a --zone this runtime does not know on set and show, before anything is rendered in it", () => {
    expect(
      unwrapErr(
        parse({
          rest: ["set", "--text", "Out", "--until", "2026-09-26T00:00:00+10:00", "--zone", "Australia/Melborne"],
        }),
      ),
    ).toEqual(SlackStatusErrors.zoneUnknown({ zone: "Australia/Melborne" }));
    expect(unwrapErr(parse({ rest: ["show", "--zone", "Australia/Melborne"] })).code).toBe("ZONE_UNKNOWN");
    expect(parse({ rest: ["show", "--zone", "UTC"] }).isOk()).toBe(true);
  });

  it("refuses presence without away or auto", () => {
    expect(unwrapErr(parse({ rest: ["presence", "--to", "dnd"] }))).toEqual(
      SlackStatusErrors.presenceInvalid({ raw: "dnd" }),
    );
  });
});

describe("buildStatusProfilePlan", () => {
  it("sends a set's expiry in whole epoch seconds", () => {
    const invocation = unwrap(parse({ rest: ["set", "--text", "Away", "--emoji", ":palm_tree:"] }));
    expect(invocation.sub).toBe("set");
    const plan = buildStatusProfilePlan({
      expiresAtMs: Date.parse("2026-09-25T14:00:00.900Z"),
      invocation: invocation as Extract<typeof invocation, { sub: "set" }>,
    });
    expect(plan).toEqual({
      expirationSeconds: 1790344800,
      operation: "set",
      statusEmoji: ":palm_tree:",
      statusText: "Away",
    });
  });

  it("clears all three fields together", () => {
    const invocation = unwrap(parse({ rest: ["clear"] }));
    const plan = buildStatusProfilePlan({
      expiresAtMs: 123,
      invocation: invocation as Extract<typeof invocation, { sub: "clear" }>,
    });
    expect(plan).toEqual({ expirationSeconds: 0, operation: "clear", statusEmoji: "", statusText: "" });
  });
});

describe("lines", () => {
  it("prints the exact dry run of a status write", () => {
    expect(
      statusDryRunLines({
        expiry: "never",
        plan: { expirationSeconds: 0, operation: "set", statusEmoji: ":palm_tree:", statusText: "Away" },
      }),
    ).toEqual([
      "DRY RUN — nothing was changed. On YOUR Slack profile, slopweaver would:",
      '  users.profile.set status_text="Away" status_emoji=":palm_tree:" status_expiration=0',
      "  expires: never",
    ]);
  });

  it("says none for an empty status", () => {
    expect(statusHeldLines({ expiry: "never", held: { emoji: "", text: "" } })).toEqual(["your Slack status: none"]);
  });

  it("prints a manual away with its own reversal", () => {
    expect(presenceHeldLines({ held: { manualAway: true, presence: "away" } })).toEqual([
      "your Slack presence: away (manual — it stays away until you undo it)",
      "  undo: slopweaver slack status presence --to auto",
    ]);
  });
});

describe("read-back", () => {
  const plan = {
    expirationSeconds: 1790344800,
    operation: "set",
    statusEmoji: ":palm_tree:",
    statusText: "Away",
  } as const;

  it("accepts a status that landed as sent", () => {
    expect(
      statusReadbackMismatch({ held: { emoji: ":palm_tree:", expirationSeconds: 1790344800, text: "Away" }, plan }),
    ).toBe(undefined);
  });

  it("names the first field Slack reads back differently", () => {
    expect(
      statusReadbackMismatch({ held: { emoji: ":palm_tree:", expirationSeconds: 0, text: "Away" }, plan }),
    ).toEqual(
      SlackStatusErrors.readbackMismatch({
        asked: "1790344800",
        field: "status_expiration",
        held: "0",
        next: "remove it with `slopweaver slack status clear`",
      }),
    );
  });

  it("names no follow-up after a clear, which left nothing to remove", () => {
    const cleared = { expirationSeconds: 0, operation: "clear", statusEmoji: "", statusText: "" } as const;
    expect(statusReadbackMismatch({ held: { emoji: "", expirationSeconds: 0, text: "Busy" }, plan: cleared })).toEqual(
      SlackStatusErrors.readbackMismatch({ asked: "", field: "status_text", held: "Busy", next: undefined }),
    );
  });

  it("requires a manual away after away, and none after auto", () => {
    expect(presenceReadbackMismatch({ manualAway: true, presence: "away" })).toBe(undefined);
    expect(presenceReadbackMismatch({ manualAway: false, presence: "auto" })).toBe(undefined);
    expect(presenceReadbackMismatch({ manualAway: false, presence: "away" })).toEqual(
      SlackStatusErrors.readbackMismatch({ asked: "away", field: "manual_away", held: "false", next: undefined }),
    );
  });

  it("names the undo when auto was sent but a manual away is still held", () => {
    expect(presenceReadbackMismatch({ manualAway: true, presence: "auto" })!.message).toContain(
      `undo a manual away with \`${UNDO_MANUAL_AWAY}\``,
    );
  });
});

describe("presenceDocument", () => {
  it("carries the undo under --json whenever a manual away is held", () => {
    expect(presenceDocument({ held: { manualAway: true, online: true, presence: "away" } })).toEqual({
      manualAway: true,
      online: true,
      presence: "away",
      undo: "slopweaver slack status presence --to auto",
    });
    expect(presenceDocument({ held: { manualAway: false, online: true, presence: "active" } })).toEqual({
      manualAway: false,
      online: true,
      presence: "active",
    });
  });
});

describe("readbackFailure", () => {
  it("says a presence write most likely landed and how to undo it, never that nothing changed", () => {
    const error = readbackFailure({
      cause: SlackStatusErrors.scopeMissing({ method: "users.getPresence" }),
      next: presenceFollowUp({ awayMayBeHeld: true }),
      wrote: "users.setPresence",
    });
    expect(error).toEqual(
      SlackStatusErrors.readbackFailed({
        next: "undo a manual away with `slopweaver slack status presence --to auto`",
        reason: "users.getPresence needs users:read",
        wrote: "users.setPresence",
      }),
    );
    expect(error.message).toContain("undo a manual away with `slopweaver slack status presence --to auto`");
    expect(error.message).not.toContain("Nothing was changed");
  });

  it("carries any other read failure's own message, and no undo when the write restored the default", () => {
    const error = readbackFailure({
      cause: SlackStatusErrors.slackRejected({ method: "users.profile.get", slackError: "ratelimited" }),
      next: undefined,
      wrote: "users.profile.set",
    });
    expect(error.message).toBe(
      "Slack accepted users.profile.set, but reading it back failed (users.profile.get failed: ratelimited), so " +
        "the change has most likely landed unconfirmed — check it with `slopweaver slack status show`",
    );
  });
});

describe("presenceWriteFailureLine", () => {
  const timeout = SlackStatusErrors.slackRejected({
    method: "users.setPresence",
    slackError: "A request error occurred: ETIMEDOUT",
  });

  it("says a failed auto leaves any manual away held, and how to retry it", () => {
    expect(presenceWriteFailureLine({ error: timeout, presence: "auto" })).toBe(
      "users.setPresence failed: A request error occurred: ETIMEDOUT — a manual away may still be held; check " +
        "with `slopweaver slack status show`, and retry `slopweaver slack status presence --to auto` to undo it",
    );
  });

  it("says a transport-failed away may have landed, with its undo", () => {
    expect(presenceWriteFailureLine({ error: timeout, presence: "away" })).toBe(
      "users.setPresence failed: A request error occurred: ETIMEDOUT — if it landed anyway, check with " +
        "`slopweaver slack status show` and undo it with `slopweaver slack status presence --to auto`",
    );
  });

  it("adds nothing to a missing scope on away, which changed nothing", () => {
    const scope = SlackStatusErrors.scopeMissing({ method: "users.setPresence" });
    expect(presenceWriteFailureLine({ error: scope, presence: "away" })).toBe(scope.message);
  });
});

describe("statusWriteFailureLine", () => {
  const timeout = SlackStatusErrors.slackRejected({
    method: "users.profile.set",
    slackError: "A request error occurred: ETIMEDOUT",
  });

  it("says a transport-failed set may have landed, how to check it and how to remove it", () => {
    expect(statusWriteFailureLine({ error: timeout, operation: "set" })).toBe(
      "users.profile.set failed: A request error occurred: ETIMEDOUT — if it landed anyway, check with " +
        "`slopweaver slack status show` and remove it with `slopweaver slack status clear`",
    );
  });

  it("says a transport-failed clear may have left the earlier status held", () => {
    expect(statusWriteFailureLine({ error: timeout, operation: "clear" })).toBe(
      "users.profile.set failed: A request error occurred: ETIMEDOUT — the earlier status may still be held; " +
        "check with `slopweaver slack status show`, and retry `slopweaver slack status clear`",
    );
  });

  it("adds nothing to a refusal Slack named, which changed nothing", () => {
    const scope = SlackStatusErrors.scopeMissing({ method: "users.profile.set" });
    expect(statusWriteFailureLine({ error: scope, operation: "set" })).toBe(scope.message);
  });
});

describe("classifyStatusFailure", () => {
  it("names the scope each method's missing_scope is about", () => {
    const set = classifyStatusFailure({
      emoji: "",
      message: "An API error occurred: missing_scope",
      method: "users.profile.set",
    });
    expect(set).toEqual(SlackStatusErrors.scopeMissing({ method: "users.profile.set" }));
    expect(set.message).toContain("users.profile:write");
    const presence = classifyStatusFailure({ emoji: "", message: "missing_scope", method: "users.setPresence" });
    expect(presence.message).toContain("users:write");
  });

  it("names the emoji Slack would not take", () => {
    expect(
      classifyStatusFailure({
        emoji: ":nope:",
        message: "An API error occurred: invalid_emoji_not_allowed",
        method: "users.profile.set",
      }),
    ).toEqual(SlackStatusErrors.emojiNotAllowed({ emoji: ":nope:", slackCode: "invalid_emoji_not_allowed" }));
  });

  it("names the emoji code Slack actually sent, not a fixed one", () => {
    const error = classifyStatusFailure({
      emoji: ":nope:",
      message: "An API error occurred: profile_status_set_failed_not_valid_emoji",
      method: "users.profile.set",
    });
    expect(error.message).toBe(
      "Slack refused :nope: as a status emoji (profile_status_set_failed_not_valid_emoji). Nothing was changed.",
    );
  });

  it("carries any other Slack error through verbatim", () => {
    expect(classifyStatusFailure({ emoji: "", message: "ratelimited", method: "users.profile.get" })).toEqual(
      SlackStatusErrors.slackRejected({ method: "users.profile.get", slackError: "ratelimited" }),
    );
  });
});
