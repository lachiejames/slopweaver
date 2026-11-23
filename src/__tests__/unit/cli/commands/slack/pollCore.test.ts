import { describe, expect, it } from "vitest";

import {
  buildPollPlan,
  type PollPostOptions,
  parsePollArgs,
  parsePollForm,
  pollDryRunLines,
  pollDryRunWarnings,
  resolvePings,
} from "../../../../../cli/commands/slack/pollCore.js";
import { pollDoorRequest, pollRecordFor } from "../../../../../cli/commands/slack/pollDoor.js";
import {
  type PollResultOutcome,
  pollResultExit,
  pollResultLines,
} from "../../../../../cli/commands/slack/pollResultReport.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { slackDeliveryErrorLines } from "../../../../../outbound/slack/deliveryErrors.js";
import type { SlackCardChrome } from "../../../../../outbound/slack/types.js";

const HOME = "/tmp/home";
const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#8B5CF6",
  detailLabel: "*Details*",
  metadataEventType: "unused_card_v1",
};
const FORM = JSON.stringify({
  kind: "poll",
  options: ["Waiting on someone", "Fighting CI"],
  question: "Where did the time go?",
  why: "Finding the friction.",
});

/** A post invocation, so tests can vary one thing at a time. */
function postOptions(): PollPostOptions {
  return { channel: "D0AAA", dryRun: false, formSource: FORM, home: HOME, json: false, mode: "post" };
}

/** A plan built from the standard form. */
function planOf() {
  return buildPollPlan({
    artifact: unwrap(parsePollForm({ json: FORM })),
    chrome: CHROME,
    metadataEventType: "slopweaver_poll_v1",
    options: postOptions(),
    pings: [],
    surface: "shared-channel",
  });
}

describe("parsePollArgs — post", () => {
  it("parses a full post invocation exactly", () => {
    const parsed = unwrap(
      parsePollArgs({
        defaultHome: HOME,
        rest: ["--as", "bot", "--channel", "D0AAA", "--form", "-", "--dry-run"],
      }),
    );

    expect(parsed).toEqual({
      channel: "D0AAA",
      dryRun: true,
      formSource: "-",
      home: HOME,
      json: false,
      mode: "post",
    });
  });

  it("refuses a missing --as rather than defaulting the identity a message goes out under", () => {
    const errors = unwrapErr(parsePollArgs({ defaultHome: HOME, rest: ["--channel", "D0AAA", "--form", "-"] }));

    expect(errors.join(" ")).toContain("needs --as bot");
  });

  it("refuses --as me and says why a poll is bot-only", () => {
    const errors = unwrapErr(
      parsePollArgs({ defaultHome: HOME, rest: ["--as", "me", "--channel", "D0AAA", "--form", "-"] }),
    );

    expect(errors.join(" ")).toContain("only `--as bot`");
  });

  it("refuses a missing --channel", () => {
    const errors = unwrapErr(parsePollArgs({ defaultHome: HOME, rest: ["--as", "bot", "--form", "-"] }));

    expect(errors.join(" ")).toContain("needs --channel");
  });

  it("refuses a missing --form", () => {
    const errors = unwrapErr(parsePollArgs({ defaultHome: HOME, rest: ["--as", "bot", "--channel", "D0AAA"] }));

    expect(errors.join(" ")).toContain("needs --form");
  });

  it("refuses an unknown flag instead of ignoring it", () => {
    const errors = unwrapErr(
      parsePollArgs({ defaultHome: HOME, rest: ["--as", "bot", "--channel", "D0AAA", "--form", "-", "--nope"] }),
    );

    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("parsePollArgs — results", () => {
  it("parses a results invocation exactly", () => {
    const parsed = unwrap(
      parsePollArgs({ defaultHome: HOME, rest: ["results", "--channel", "D0AAA", "--ts", "111.222"] }),
    );

    expect(parsed).toEqual({ channel: "D0AAA", home: HOME, json: false, mode: "results", ts: "111.222" });
  });

  it("carries the --poll-id repair locator when given", () => {
    const parsed = unwrap(
      parsePollArgs({
        defaultHome: HOME,
        rest: ["results", "--channel", "D0AAA", "--ts", "111.222", "--poll-id", "abc"],
      }),
    );

    expect(parsed).toEqual({
      channel: "D0AAA",
      home: HOME,
      json: false,
      mode: "results",
      pollId: "abc",
      ts: "111.222",
    });
  });

  it("refuses a results read with no --ts, since the ts is how a poll is located", () => {
    const errors = unwrapErr(parsePollArgs({ defaultHome: HOME, rest: ["results", "--channel", "D0AAA"] }));

    expect(errors.join(" ")).toContain("needs --ts");
  });
});

describe("parsePollForm", () => {
  it("validates a well-formed poll", () => {
    expect(unwrap(parsePollForm({ json: FORM })).options).toEqual(["Waiting on someone", "Fighting CI"]);
  });

  it("reports invalid JSON as such", () => {
    const error = unwrapErr(parsePollForm({ json: "{nope" }));
    expect(error.code).toBe("FORM_NOT_JSON");
    expect(slackDeliveryErrorLines({ error }).join(" ")).toContain("not valid JSON");
  });

  it("reports a schema violation with its path", () => {
    const error = unwrapErr(parsePollForm({ json: JSON.stringify({ kind: "poll", options: ["only one"] }) }));
    expect(error.code).toBe("FORM_INVALID");
    const errors = slackDeliveryErrorLines({ error });

    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("buildPollPlan", () => {
  it("renders six blocks in a full-chrome wrapper, with the ballot above Details", () => {
    expect(planOf().payload.attachments[0].blocks.map((block) => block.type)).toEqual([
      "context",
      "divider",
      "section",
      "divider",
      "context",
      "context",
    ]);
  });

  it("derives a stable poll id from the same form and target", () => {
    expect(planOf().pollId).toBe(planOf().pollId);
  });

  it("changes the poll id when the channel changes", () => {
    const other = buildPollPlan({
      artifact: unwrap(parsePollForm({ json: FORM })),
      chrome: CHROME,
      metadataEventType: "slopweaver_poll_v1",
      options: { ...postOptions(), channel: "D0BBB" },
      pings: [],
      surface: "shared-channel",
    });

    expect(other.pollId).not.toBe(planOf().pollId);
  });

  it("pairs each option with its keycap in ballot order", () => {
    expect(planOf().ballot.map((entry) => entry.emojiName)).toEqual(["one", "two", "three"]);
  });
});

describe("pollDryRunLines", () => {
  it("shows which emoji votes for which option", () => {
    const lines = pollDryRunLines({ plan: planOf() }).join("\n");

    expect(lines).toContain(":one:  (1)  Waiting on someone");
    expect(lines).toContain(":two:  (2)  Fighting CI");
    expect(lines).toContain(":three:  (3)  Other — explain in replies");
  });

  it("lists the reactions.add seeding steps, one per ballot chip", () => {
    const lines = pollDryRunLines({ plan: planOf() }).join("\n");

    expect(lines).toContain("step 2: reactions.add(:one:)");
    expect(lines).toContain("step 4: reactions.add(:three:)");
  });

  it("says nothing was posted, and names the follow-up command", () => {
    const lines = pollDryRunLines({ plan: planOf() }).join("\n");

    expect(lines).toContain("DRY RUN — nothing was posted.");
    expect(lines).toContain("slopweaver slack poll results --channel D0AAA --ts <ts>");
  });
});

describe("pollDryRunWarnings", () => {
  it("warns that an authored :shortcode: will render as literal text", () => {
    const artifact = unwrap(
      parsePollForm({
        json: JSON.stringify({
          kind: "poll",
          options: ["Use :one: here", "Other"],
          question: "Pick one",
          why: "Vote now",
        }),
      }),
    );

    const warnings = pollDryRunWarnings({ artifact });

    expect(warnings.length).toBe(1);
    expect(warnings[0]!).toContain('options[0] contains ":one:"');
    expect(warnings[0]!).toContain("LITERAL text");
  });

  it("says nothing about a poll whose authored text carries no shortcode", () => {
    expect(pollDryRunWarnings({ artifact: unwrap(parsePollForm({ json: FORM })) })).toEqual([]);
  });

  it("never BLOCKS a shortcode — the form still validates, because shape is constrained and words are not", () => {
    const json = JSON.stringify({ kind: "poll", options: [":tada: yes", "no"], question: "q", why: "w" });

    expect(unwrap(parsePollForm({ json })).options).toEqual([":tada: yes", "no"]);
  });

  it("warns that a literal keycap in a label COMPETES with the ballot", () => {
    const artifact = unwrap(
      parsePollForm({
        json: JSON.stringify({ kind: "poll", options: ["2\uFE0F\u20E3 do this", "other"], question: "q", why: "w" }),
      }),
    );

    const warnings = pollDryRunWarnings({ artifact });

    expect(warnings.length).toBe(1);
    expect(warnings[0]!).toContain("COMPETES with the ballot");
  });

  it("warns about the question and the why fields too, not only the options", () => {
    const artifact = unwrap(
      parsePollForm({
        json: JSON.stringify({ kind: "poll", options: ["a", "b"], question: "q :one:", why: "w :two:" }),
      }),
    );

    expect(pollDryRunWarnings({ artifact }).length).toBe(2);
  });
});

describe("pollResultLines", () => {
  const COUNTED: PollResultOutcome = {
    kind: "counted",
    tally: {
      ignored: [{ count: 2, name: "eyes", users: ["U0A", "U0B"] }],
      options: [
        { emojiName: "one", label: "Waiting", position: 1, seeded: true, voterListTruncated: false, votes: 3 },
        { emojiName: "two", label: "CI", position: 2, seeded: true, voterListTruncated: false, votes: 1 },
      ],
      totalVotes: 4,
    },
  };

  function linesFor({ outcome }: { outcome: PollResultOutcome }): string {
    return pollResultLines({ channel: "D0AAA", outcome, question: "q", ts: "1.0", warnings: [] }).join("\n");
  }

  it("prints the exact per-option votes and the total", () => {
    const lines = linesFor({ outcome: COUNTED });

    expect(lines).toContain("1. Waiting  3");
    expect(lines).toContain("2. CI       1");
    expect(lines).toContain("total votes: 4");
  });

  it("says the counts are LIVE and that its own seed chips were excluded", () => {
    const lines = linesFor({ outcome: COUNTED });

    expect(lines).toContain("live from Slack, counted just now");
    expect(lines).toContain("seed chips excluded");
  });

  it("carries no staleness vocabulary at all, because a live read has none", () => {
    const lines = linesFor({ outcome: COUNTED });

    expect(lines).not.toContain("NOT LIVE");
    expect(lines).not.toContain("observed:");
    expect(lines).not.toContain("refresh");
  });

  it("reports an off-ballot reaction as not counted", () => {
    expect(linesFor({ outcome: COUNTED })).toContain("not on the ballot (NOT counted): :eyes: x2");
  });

  it("warns when an option's chip never seeded, since that option is under-represented", () => {
    const lines = linesFor({
      outcome: {
        kind: "counted",
        tally: {
          ignored: [],
          options: [
            { emojiName: "one", label: "A", position: 1, seeded: true, voterListTruncated: false, votes: 2 },
            { emojiName: "two", label: "B", position: 2, seeded: false, voterListTruncated: false, votes: 0 },
          ],
          totalVotes: 2,
        },
      },
    });

    expect(lines).toContain("no seed chip on option(s) 2");
    expect(lines).toContain("under-represented");
  });

  it("says nothing about seeding when every chip landed", () => {
    expect(linesFor({ outcome: COUNTED })).not.toContain("no seed chip");
  });

  it("reports a deleted poll as GONE, never as zero votes", () => {
    const lines = linesFor({ outcome: { kind: "gone" } });

    expect(lines).toContain("GONE FROM SLACK");
    expect(lines).toContain("NOT zero votes");
  });

  it("explains an unknown poll in terms of the missing local record", () => {
    const lines = pollResultLines({
      channel: "D0AAA",
      outcome: { kind: "unknown-poll", unreadable: ["abc.json: not valid JSON"] },
      question: undefined,
      ts: "1.0",
      warnings: [],
    }).join("\n");

    expect(lines).toContain("UNKNOWN POLL");
    expect(lines).toContain("unreadable poll record: abc.json: not valid JSON");
  });
});

describe("resolvePings", () => {
  const GROUPS = new Map([["engineers", "S0ENG"]]);
  const PEOPLE = new Map([["ada", "U0ADA"]]);

  it("renders a group ping as a subteam token with a readable fallback", () => {
    const resolved = resolvePings({
      groupIds: GROUPS,
      people: PEOPLE,
      pings: [{ handle: "engineers", kind: "group" }],
    });

    expect(resolved.tokens).toEqual(["<!subteam^S0ENG|@engineers>"]);
    expect(resolved.unresolved).toEqual([]);
  });

  it("renders @here and @channel broadcasts literally", () => {
    const resolved = resolvePings({
      groupIds: GROUPS,
      people: PEOPLE,
      pings: [
        { kind: "broadcast", range: "here" },
        { kind: "broadcast", range: "channel" },
      ],
    });

    expect(resolved.tokens).toEqual(["<!here>", "<!channel>"]);
  });

  it("renders a person by EXACT identity key, never a fuzzy match", () => {
    expect(
      resolvePings({ groupIds: GROUPS, people: PEOPLE, pings: [{ kind: "person", person: "ada" }] }).tokens,
    ).toEqual(["<@U0ADA>"]);
  });

  it("supports several kinds at once, in author order", () => {
    const resolved = resolvePings({
      groupIds: GROUPS,
      people: PEOPLE,
      pings: [
        { handle: "engineers", kind: "group" },
        { kind: "person", person: "ada" },
        { kind: "broadcast", range: "here" },
      ],
    });

    expect(resolved.tokens).toEqual(["<!subteam^S0ENG|@engineers>", "<@U0ADA>", "<!here>"]);
  });

  it("REPORTS an unknown group rather than rendering plain text that notifies nobody", () => {
    const resolved = resolvePings({ groupIds: GROUPS, people: PEOPLE, pings: [{ handle: "nope", kind: "group" }] });

    expect(resolved.tokens).toEqual([]);
    expect(resolved.unresolved).toEqual([{ kind: "group", label: "@nope" }]);
  });

  it("REPORTS an unknown person rather than silently dropping them", () => {
    const resolved = resolvePings({ groupIds: GROUPS, people: PEOPLE, pings: [{ kind: "person", person: "ghost" }] });

    expect(resolved.unresolved).toEqual([{ kind: "person", label: "ghost" }]);
  });

  it("resolves nothing from no pings, which is the default", () => {
    expect(resolvePings({ groupIds: GROUPS, people: PEOPLE, pings: [] })).toEqual({ tokens: [], unresolved: [] });
  });
});

describe("pollResultExit", () => {
  it("succeeds only when votes were actually counted", () => {
    expect(pollResultExit({ outcome: { kind: "gone" } })).toBe(3);
    expect(pollResultExit({ outcome: { kind: "unknown-poll", unreadable: [] } })).toBe(3);
  });
});

describe("pollDoorRequest and pollRecordFor", () => {
  it("hands the door the opaque identity and counts, never the question or the options", () => {
    const plan = planOf();
    expect(pollDoorRequest({ home: HOME, plan })).toEqual({
      action: { kind: "verb", noun: "slack", verb: "poll" },
      artifact: { actor: "bot", blockCount: 1, channel: "D0AAA", duplicateKey: plan.pollId, optionCount: 3 },
      meta: { createsWorkItem: false, effect: "external-write", home: HOME, requiresApproval: false },
    });
  });

  it("stores the BALLOT's labels, Other row included, so each option pairs with its emoji by index", () => {
    const plan = planOf();
    expect(pollRecordFor({ nowIso: "2026-09-28T00:00:00.000Z", plan })).toEqual({
      channel: "D0AAA",
      createdIso: "2026-09-28T00:00:00.000Z",
      emojiNames: ["one", "two", "three"],
      options: ["Waiting on someone", "Fighting CI", "Other — explain in replies"],
      pollId: plan.pollId,
      question: "Where did the time go?",
      schemaVersion: 1,
      why: "Finding the friction.",
    });
  });
});
