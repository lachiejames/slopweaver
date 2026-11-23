/**
 * `slack dm open`'s pure half. No I/O, no clock, no mocks.
 *
 * The two properties worth pinning are the ones that make this verb different from every other Slack write
 * here: it is IDEMPOTENT (so the report must be able to say "that already existed" rather than claiming a
 * create), and it has a hard ceiling Slack itself reports only as `too_many_users` with no number attached.
 */
import { describe, expect, it } from "vitest";

import { slackArgumentErrorLines } from "../../../../../cli/commands/slack/argumentErrors.js";
import {
  buildDmOpenPlan,
  type DmOpenOptions,
  dmOpenDryRunLines,
  dmOpenReportLines,
  parseDmArgs,
} from "../../../../../cli/commands/slack/dmCore.js";
import { SLACK_GROUP_DM_MAX_OTHERS } from "../../../../../cli/commands/slack/verbUsage.js";
import { unwrap } from "../../../../../lib/result.js";

const HOME = "/tmp/does-not-need-to-exist";

function options({ over = {} }: { over?: Partial<DmOpenOptions> } = {}): DmOpenOptions {
  return { actor: "bot", dryRun: false, home: HOME, json: false, with: ["seth"], ...over };
}

/** N distinct people, and the map resolving each to its own id. */
function roster({ count }: { count: number }): { keys: readonly string[]; resolved: ReadonlyMap<string, string> } {
  const keys = Array.from({ length: count }, (_unused, index) => `person-${String(index)}`);
  return { keys, resolved: new Map(keys.map((key, index) => [key, `U${String(index).padStart(3, "0")}`])) };
}

describe("parseDmArgs", () => {
  it("defaults to the BOT lane — the conversation the bot then posts into is the common case", () => {
    expect(unwrap(parseDmArgs({ defaultHome: HOME, rest: ["open", "--with", "seth"] })).actor).toBe("bot");
  });

  it("reads a comma-separated --with into a list", () => {
    expect(unwrap(parseDmArgs({ defaultHome: HOME, rest: ["open", "--with", "seth, alex"] })).with).toEqual([
      "seth",
      "alex",
    ]);
  });

  it("refuses a sub-command it does not have, naming the one it does", () => {
    const parsed = parseDmArgs({ defaultHome: HOME, rest: ["close", "--with", "seth"] });

    expect(parsed._unsafeUnwrapErr().code).toBe("SUBCOMMAND_UNKNOWN");
    expect(parsed.mapErr((error) => slackArgumentErrorLines({ error }))._unsafeUnwrapErr()[0]).toContain(
      "one sub-command: open",
    );
  });

  it("refuses `open` with nobody named", () => {
    expect(
      parseDmArgs({ defaultHome: HOME, rest: ["open"] })
        .mapErr((error) => slackArgumentErrorLines({ error }))
        ._unsafeUnwrapErr(),
    ).toEqual(["slack dm open needs --with <key,...> — at least one person to open a conversation with"]);
  });
});

describe("buildDmOpenPlan", () => {
  it("calls one person a direct-message and several a group-dm", () => {
    const one = unwrap(buildDmOpenPlan({ options: options(), resolved: new Map([["seth", "U01"]]) }));
    const two = unwrap(
      buildDmOpenPlan({
        options: options({ over: { with: ["seth", "alex"] } }),
        resolved: new Map([
          ["seth", "U01"],
          ["alex", "U02"],
        ]),
      }),
    );

    expect(one.surface).toBe("direct-message");
    expect(two.surface).toBe("group-dm");
  });

  it("DEDUPLICATES two keys that resolve to one person, so the repeat is not counted twice", () => {
    const plan = unwrap(
      buildDmOpenPlan({
        options: options({ over: { with: ["seth", "seth@example.test"] } }),
        resolved: new Map([
          ["seth", "U01"],
          ["seth@example.test", "U01"],
        ]),
      }),
    );

    expect(plan.userIds).toEqual(["U01"]);
    expect(plan.surface).toBe("direct-message");
  });

  it("refuses an unresolvable key, naming it and saying nothing was opened", () => {
    const plan = buildDmOpenPlan({ options: options({ over: { with: ["ghost"] } }), resolved: new Map() });

    expect(plan.isErr()).toBe(true);
    expect(plan._unsafeUnwrapErr()[0]).toContain('"ghost"');
    expect(plan._unsafeUnwrapErr()[0]).toContain("nothing was opened");
  });

  it(`allows exactly ${String(SLACK_GROUP_DM_MAX_OTHERS)} others — the boundary Slack itself draws`, () => {
    const { keys, resolved } = roster({ count: SLACK_GROUP_DM_MAX_OTHERS });

    expect(unwrap(buildDmOpenPlan({ options: options({ over: { with: keys } }), resolved })).userIds.length).toBe(
      SLACK_GROUP_DM_MAX_OTHERS,
    );
  });

  it("refuses one person past the ceiling, and names the verb to reach for instead", () => {
    const { keys, resolved } = roster({ count: SLACK_GROUP_DM_MAX_OTHERS + 1 });
    const plan = buildDmOpenPlan({ options: options({ over: { with: keys } }), resolved });

    expect(plan.isErr()).toBe(true);
    expect(plan._unsafeUnwrapErr()[0]).toContain("slopweaver slack channel create");
  });
});

describe("dmOpenDryRunLines", () => {
  it("shows the exact users argument, and says the open is repeatable", () => {
    const plan = unwrap(buildDmOpenPlan({ options: options(), resolved: new Map([["seth", "U01"]]) }));

    expect(dmOpenDryRunLines({ plan })).toEqual([
      "DRY RUN — nothing was opened. As the bot, slopweaver would:",
      "  1. conversations.open users=U01",
      "  that resolves to a 1:1 DM, existing or new.",
      "  Slack answers the SAME conversation for the same people, so re-running this opens nothing twice.",
    ]);
  });
});

describe("dmOpenReportLines", () => {
  it("says ALREADY EXISTED rather than claiming a create, when Slack reported the conversation standing", () => {
    const plan = unwrap(buildDmOpenPlan({ options: options(), resolved: new Map([["seth", "U01"]]) }));

    expect(dmOpenReportLines({ alreadyExisted: true, channelId: "D01", plan })[0]).toBe("that DM already existed: D01");
  });

  it("names the count and the id on a fresh open, then the exact next command", () => {
    const plan = unwrap(buildDmOpenPlan({ options: options(), resolved: new Map([["seth", "U01"]]) }));
    const lines = dmOpenReportLines({ alreadyExisted: false, channelId: "D01", plan });

    expect(lines[0]).toBe("opened a DM with 1 person(s): D01");
    expect(lines[2]).toBe("  slopweaver slack post --as bot --channel D01 --shape top-level --form -");
  });
});
