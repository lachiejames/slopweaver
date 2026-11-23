import { describe, expect, it } from "vitest";

import type { SlackPerson } from "../../../../corpus/members/slackPeople.js";
import { taggedIdsOf, untaggedNameFindings, untaggedNameRefusal } from "../../../../outbound/slack/untaggedNames.js";

function person({
  nativeId,
  name,
  nameUnique = true,
  firstNameUnique = true,
  bot = false,
}: {
  nativeId: string;
  name: string;
  nameUnique?: boolean;
  firstNameUnique?: boolean;
  bot?: boolean;
}): SlackPerson {
  return {
    avatarUrl: undefined,
    bot,
    deactivated: false,
    firstNameUnique,
    handle: undefined,
    name,
    nameUnique,
    nativeId,
    org: undefined,
    title: undefined,
  };
}

const PEOPLE: readonly SlackPerson[] = [
  person({ firstNameUnique: false, name: "Seth Tanner", nativeId: "U0SYN000013" }),
  person({ name: "Ansel Jory", nativeId: "U0SYN000020" }),
  person({ name: "Rosa Lindqvist", nativeId: "U0ROSA" }),
  person({ name: "Ada Owner", nativeId: "U0SYNADAOWN" }),
  person({ firstNameUnique: false, name: "Kyle A", nameUnique: false, nativeId: "U0KYLEA" }),
  person({ bot: true, name: "Deploy Bot", nativeId: "U0BOT" }),
];

const NONE: ReadonlySet<string> = new Set();

function findingsIn({
  text,
  tagged = NONE,
  exempt = NONE,
}: {
  text: string;
  tagged?: ReadonlySet<string>;
  exempt?: ReadonlySet<string>;
}): readonly (readonly string[])[] {
  return untaggedNameFindings({ exempt, people: PEOPLE, prose: [{ path: "messages[0].runs[1]", text }], tagged }).map(
    (finding) => [finding.written, finding.nativeId],
  );
}

describe("untaggedNameFindings", () => {
  it("finds a colleague's whole name in any case, and a unique first name, possessive included", () => {
    expect(findingsIn({ text: "seth tanner is the one to ask, and rosa's out today; Ansel agreed" })).toEqual([
      ["seth tanner", "U0SYN000013"],
      ["rosa", "U0ROSA"],
      ["Ansel", "U0SYN000020"],
    ]);
  });

  it("never finds a shared first name, a name nobody holds alone, or a bot", () => {
    expect(findingsIn({ text: "seth said kyle a and deploy bot were fine" })).toEqual([]);
  });

  it("passes a colleague the message also tags, the author, and a DM's other member", () => {
    expect(
      findingsIn({
        exempt: new Set(["U0SYNADAOWN", "U0ROSA"]),
        tagged: new Set(["U0SYN000020"]),
        text: "hey rosa, ansel's keen and ada will chase",
      }),
    ).toEqual([]);
  });

  it("never reads a name inside a hyphenated word, a handle, a path or a dotted name", () => {
    expect(findingsIn({ text: "the bot posted to @rosa and rosa.lindqvist via /ansel" })).toEqual([]);
  });
});

describe("taggedIdsOf", () => {
  it("reads every wire mention once, labelled or not", () => {
    expect([...taggedIdsOf({ text: "<@U0SYN000013> hi <@U0SYN000020|ansel> and <@U0SYN000013>" })]).toEqual([
      "U0SYN000013",
      "U0SYN000020",
    ]);
  });
});

describe("untaggedNameRefusal", () => {
  it("names each untagged colleague, the tag to use, and that there is no hatch", () => {
    const findings = untaggedNameFindings({
      exempt: NONE,
      people: PEOPLE,
      prose: [{ path: "messages[0].runs[1]", text: "bumping this, seth tanner owns it" }],
      tagged: NONE,
    });
    expect(untaggedNameRefusal({ findings })).toEqual([
      "slack draft record: REFUSING to park a message as the owner that names a colleague without tagging them — Slack " +
        "and the owner's queue card can resolve only a tag to a person.",
      '  "seth tanner" at messages[0].runs[1] is Seth Tanner (U0SYN000013): put {"type":"mention","person":"U0SYN000013"} ' +
        "where the name is, or reword so it names nobody the message does not tag.",
      "There is deliberately NO escape hatch: tagging them, or not naming them, is always available.",
    ]);
  });

  it("says nothing when every name is tagged", () => {
    expect(untaggedNameRefusal({ findings: [] })).toEqual([]);
  });
});
