import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MemberFacts } from "../../../cli/commands/sessionStart/slackPeople.js";
import {
  authorIsHuman,
  displayNameOf,
  isTaggablePerson,
  selfBotIds,
} from "../../../cli/commands/sessionStart/slackPeople.js";

// Slack ids are spelled the way Slack spells them, because `src/review/prLink.ts`'s mention matcher is
// structural (`[UW][A-Z0-9]{1,30}`) and a made-up lowercase id can never reach the code under test.
const OWNER = "U0SYNOWNER123";
const COLLEAGUE = "U0SYNHUMAN123";
const ALERT_APP = "U0SYNAPP12345";
const SELF = "U0SYNBOT12345";

const DEPARTED = "U0SYNGONE1234";

const members = new Map<string, MemberFacts>([
  [COLLEAGUE, { active: true, bot: false, name: "A Colleague" }],
  [ALERT_APP, { active: true, bot: true, name: "Nightfall Enterprise DLP for Slack" }],
  [SELF, { active: true, bot: true, name: "acme-bot" }],
  [DEPARTED, { active: false, bot: false, name: "A Former Colleague" }],
  [OWNER, { active: true, bot: false, name: "Ada Owner" }],
]);

const dirs: string[] = [];

// The schema requires the identity block, so a fixture declaring only `slackBot` parses to nothing at all
// and every case below would pass on an unreadable profile rather than on what it declares.
const homeWithProfile = ({ slackBot }: { slackBot: Record<string, unknown> }): string => {
  const home = mkdtempSync(join(tmpdir(), "slack-people-"));
  dirs.push(home);
  writeFileSync(
    join(home, "profile.json"),
    JSON.stringify({
      displayName: "Ada Owner",
      gitNamespace: "ada-gh",
      id: "owner-1",
      schemaVersion: 1,
      slackBot,
      sources: ["github"],
    }),
    "utf8",
  );
  return home;
};

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("displayNameOf", () => {
  it("gives the index's name for somebody it knows", () => {
    expect(displayNameOf({ author: COLLEAGUE, members })).toBe("A Colleague");
  });

  it("gives back the raw id for somebody the index has never seen", () => {
    expect(displayNameOf({ author: "U0SYNSTRANGER1", members })).toBe("U0SYNSTRANGER1");
  });
});

describe("authorIsHuman", () => {
  it("calls a colleague the index knows a person", () => {
    expect(authorIsHuman({ author: COLLEAGUE, members, selfIds: new Set([SELF]) })).toBe(true);
  });

  it("refuses an app the index marks a bot — the measured top mentioner", () => {
    expect(authorIsHuman({ author: ALERT_APP, members, selfIds: new Set([SELF]) })).toBe(false);
  });

  it("refuses Slopweaver's own id even though nothing else about it says bot", () => {
    expect(authorIsHuman({ author: SELF, members: new Map(), selfIds: new Set([SELF]) })).toBe(false);
  });

  it("refuses USLACKBOT, which Slack itself reports as is_bot: false", () => {
    expect(authorIsHuman({ author: "USLACKBOT", members: new Map(), selfIds: new Set() })).toBe(false);
  });

  it("calls an id the index has never seen a person, rather than guessing it is a bot", () => {
    expect(authorIsHuman({ author: "U0SYNSTRANGER1", members, selfIds: new Set([SELF]) })).toBe(true);
  });
});

describe("isTaggablePerson", () => {
  const taggable = ({ id }: { id: string }): boolean =>
    isTaggablePerson({ id, members, ownerId: OWNER, selfIds: new Set([SELF]) });

  it("lets a chase tag an active colleague the index knows", () => {
    expect(taggable({ id: COLLEAGUE })).toBe(true);
  });

  it("never tags the owner, an app, Slopweaver, a deactivated account or Slackbot", () => {
    expect([OWNER, ALERT_APP, SELF, DEPARTED, "USLACKBOT"].map((id) => taggable({ id }))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("never tags an id the index has never seen, unlike the answer test, which counts one as a person", () => {
    expect([
      taggable({ id: "U0SYNSTRANGER1" }),
      authorIsHuman({ author: "U0SYNSTRANGER1", members, selfIds: new Set() }),
    ]).toEqual([false, true]);
  });
});

describe("selfBotIds", () => {
  it("reads the ids the profile declares", () => {
    const home = homeWithProfile({ slackBot: { ownerUserId: OWNER, selfUserIds: [SELF] } });
    expect([...selfBotIds({ home })]).toEqual([SELF]);
  });

  it("answers empty for a slackBot block that names no self ids", () => {
    const home = homeWithProfile({ slackBot: { ownerUserId: OWNER } });
    expect([...selfBotIds({ home })]).toEqual([]);
  });

  it("answers empty for a profile with no slackBot block at all — an install the bot has never posted from", () => {
    const home = mkdtempSync(join(tmpdir(), "slack-people-"));
    dirs.push(home);
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: 1,
        sources: ["github"],
      }),
      "utf8",
    );
    expect([...selfBotIds({ home })]).toEqual([]);
  });

  it("answers empty for a home with no profile at all, rather than throwing", () => {
    const home = mkdtempSync(join(tmpdir(), "slack-people-"));
    dirs.push(home);
    expect([...selfBotIds({ home })]).toEqual([]);
  });
});
