/*
 * What a Slack member id is drawn as on the console — a draft once read
 * `you (U0SYN000001)`, so: a name where the roster holds one, the id on hover, and never an invented name.
 */

import { describe, expect, it } from "vitest";

import {
  addressedInWords,
  avatarOf,
  directMessagePeer,
  draftContextInWords,
  draftDestination,
  draftParentInWords,
  draftPlacement,
  groupLabel,
  mentionLabel,
  personLabel,
  type SlackPeople,
  spokenName,
  taggedLabels,
} from "../../lib/slackPeople";

const PEOPLE: SlackPeople = new Map([
  ["U0SYN000001", { avatarUrl: "https://avatars.example/ada_72.png", handle: "ada.owner", name: "Ada Owner" }],
  ["U0SYN000003", { handle: "ari.singh", name: "Ari" }],
  ["U0NONAME", { handle: "no.name", name: "   " }],
]);

describe("personLabel", () => {
  it("draws the name with the id on hover", () => {
    expect(personLabel({ id: "U0SYN000003", people: PEOPLE })).toEqual({ text: "Ari", title: "U0SYN000003" });
  });

  it("draws the id itself for an id the roster does not hold, or holds with a blank name", () => {
    expect(personLabel({ id: "U0SYNUNKNOWN", people: PEOPLE })).toEqual({
      text: "U0SYNUNKNOWN",
      title: "U0SYNUNKNOWN",
    });
    expect(personLabel({ id: "U0NONAME", people: PEOPLE })).toEqual({ text: "U0NONAME", title: "U0NONAME" });
  });
});

describe("mentionLabel", () => {
  it("prefers the roster's name over the key the author wrote", () => {
    expect(mentionLabel({ id: "U0SYN000003", people: PEOPLE, recordedKey: "@ari" })).toEqual({
      text: "Ari",
      title: "U0SYN000003",
    });
  });

  it("falls to the written handle, without its @, when the roster has no name", () => {
    expect(mentionLabel({ id: "U0SYNUNKNOWN", people: PEOPLE, recordedKey: "@ada" })).toEqual({
      text: "ada",
      title: "U0SYNUNKNOWN",
    });
  });

  it("never draws an id-shaped key as though it were a handle", () => {
    expect(mentionLabel({ id: "U0SYNUNKNOWN", people: PEOPLE, recordedKey: "@W0SYNUNKNOWN1" })).toEqual({
      text: "U0SYNUNKNOWN",
      title: "U0SYNUNKNOWN",
    });
    expect(mentionLabel({ id: "U0SYNUNKNOWN", people: PEOPLE, recordedKey: undefined })).toEqual({
      text: "U0SYNUNKNOWN",
      title: "U0SYNUNKNOWN",
    });
  });
});

describe("taggedLabels", () => {
  it("names each person tagged and keeps a group's written key, each with its target on hover", () => {
    const mentions = [
      { key: "U0SYN000003", kind: "person", target: "U0SYN000003" },
      { key: "@security", kind: "group", target: "S0SEC" },
    ];
    expect(taggedLabels({ mentions, people: PEOPLE })).toEqual([
      { text: "Ari", title: "U0SYN000003" },
      { text: "security", title: "S0SEC" },
    ]);
  });

  it("draws a person's key spelled as an id as its own target, and a group's as a group (fiftieth pass)", () => {
    const mentions = [
      { key: "@U0BOB", kind: "person", target: "U9TARGET" },
      { key: "＠Ｓ９ＯＴＨＥＲ​", kind: "group", target: "S0OPS" },
      { key: "\u0085@ops​", kind: "group", target: "S0SEC" },
    ];
    expect(taggedLabels({ mentions, people: PEOPLE })).toEqual([
      { text: "U9TARGET", title: "U9TARGET" },
      { text: "a group", title: "S0OPS" },
      { text: "ops", title: "S0SEC" },
    ]);
  });
});

describe("groupLabel — a tagged team by its name, never its S… id", () => {
  it("draws the recorded key first, its @ dropped", () => {
    expect(groupLabel({ groupId: "S0SYN000012", handle: "@platform", recordedKey: "@dev-platform" })).toEqual({
      text: "dev-platform",
      title: "S0SYN000012",
    });
  });

  it("draws the wire's handle when no usable key was recorded", () => {
    expect(groupLabel({ groupId: "S0SYN000012", handle: "@platform", recordedKey: undefined })).toEqual({
      text: "platform",
      title: "S0SYN000012",
    });
    expect(groupLabel({ groupId: "S0SYN000012", handle: "@platform", recordedKey: "@S0SYN000012" })).toEqual({
      text: "platform",
      title: "S0SYN000012",
    });
  });

  it("draws a group as a group when neither names it, a handle spelled as an id included", () => {
    expect(groupLabel({ groupId: "S0SYN000012", handle: undefined, recordedKey: undefined })).toEqual({
      text: "a group",
      title: "S0SYN000012",
    });
    expect(groupLabel({ groupId: "S0SYN000012", handle: "@S0SYN000012", recordedKey: " " })).toEqual({
      text: "a group",
      title: "S0SYN000012",
    });
  });

  it("draws a group as a group when a candidate is spelled in Slack's subteam^S… wire form", () => {
    expect(
      groupLabel({ groupId: "S0SYN000012", handle: "@subteam^S0SYN000012", recordedKey: "subteam^S0SYN000012" }),
    ).toEqual({ text: "a group", title: "S0SYN000012" });
  });

  it("reads a subteam^ spelling hidden behind an unseen character as the id it is", () => {
    const hidden = `@sub${String.fromCodePoint(0x200b)}team^S0SYN000012`;
    expect(groupLabel({ groupId: "S0SYN000012", handle: "@platform", recordedKey: hidden })).toEqual({
      text: "platform",
      title: "S0SYN000012",
    });
  });

  it("never draws a candidate showing the group's own id, however it is wrapped", () => {
    expect(groupLabel({ groupId: "S0SYN000012", handle: "@platform", recordedKey: "@@S0SYN000012" })).toEqual({
      text: "platform",
      title: "S0SYN000012",
    });
    expect(groupLabel({ groupId: "S0SYN000012", handle: "team S0SYN000012", recordedKey: undefined })).toEqual({
      text: "a group",
      title: "S0SYN000012",
    });
  });
});

describe("draftDestination — where a parked draft goes and who it is to", () => {
  const TAGS = [
    { key: "@ari", kind: "person", target: "U0SYN000003" },
    { key: "@security", kind: "group", target: "S0SEC" },
  ];

  it("names the member a DM is addressed to, with the id on hover, ignoring whom it tags", () => {
    expect(
      draftDestination({
        channel: "U0SYN000001",
        channelName: undefined,
        mentions: TAGS,
        people: PEOPLE,
        threaded: false,
      }),
    ).toEqual({
      to: [{ text: "Ada Owner", title: "U0SYN000001" }],
      where: "a direct message",
    });
  });

  it("draws a DM recipient the roster does not hold as the id", () => {
    expect(
      draftDestination({
        channel: "U0SYNUNKNOWN",
        channelName: undefined,
        mentions: [],
        people: PEOPLE,
        threaded: false,
      }),
    ).toEqual({
      to: [{ text: "U0SYNUNKNOWN", title: "U0SYNUNKNOWN" }],
      where: "a direct message",
    });
  });

  it("names a channel and the PEOPLE it tags, leaving a group out", () => {
    expect(
      draftDestination({ channel: "C0ISO", channelName: "iso-27001", mentions: TAGS, people: PEOPLE, threaded: false }),
    ).toEqual({
      to: [{ text: "Ari", title: "U0SYN000003" }],
      where: "#iso-27001",
    });
  });

  it("says only that a D… conversation is a direct message, never taking a tagged person for its peer", () => {
    expect(
      draftDestination({
        channel: "D0SYN000004",
        channelName: undefined,
        mentions: TAGS,
        people: PEOPLE,
        threaded: false,
      }),
    ).toEqual({
      to: [],
      where: "a direct message",
    });
  });

  it("names each tagged person once, in first-seen order", () => {
    const twice = [...TAGS, { key: "@ada", kind: "person", target: "U0SYN000001" }, ...TAGS];
    expect(
      draftDestination({
        channel: "C0ISO",
        channelName: "iso-27001",
        mentions: twice,
        people: PEOPLE,
        threaded: false,
      }).to.map((label) => label.text),
    ).toEqual(["Ari", "Ada Owner"]);
  });

  it("draws a channel the recording read could not name as its id", () => {
    expect(
      draftDestination({ channel: "C0NONAME", channelName: undefined, mentions: [], people: PEOPLE, threaded: false }),
    ).toEqual({
      to: [],
      where: "C0NONAME",
    });
  });

  it("says a thread reply goes into a thread, never that it posts to the channel", () => {
    expect(
      draftDestination({ channel: "C0ISO", channelName: "iso-27001", mentions: TAGS, people: PEOPLE, threaded: true }),
    ).toEqual({ to: [{ text: "Ari", title: "U0SYN000003" }], where: "a thread in #iso-27001" });
  });
});

describe("draftPlacement — a held draft's top-right stamp", () => {
  it("says a reply lands in its thread", () => {
    expect(draftPlacement({ threaded: true })).toBe("in thread");
  });

  it("says a post lands at the conversation's top level", () => {
    expect(draftPlacement({ threaded: false })).toBe("top level");
  });
});

describe("draftParentInWords — the message a parked reply goes under", () => {
  it("names the root's author off the roster and quotes what it said", () => {
    const thread = { parentText: "pool exhausted at 09:12", parentUserId: "U0SYN000003", ts: "1790566514.594969" };
    expect(draftParentInWords({ people: PEOPLE, thread })).toBe('under Ari\'s message: "pool exhausted at 09:12"');
  });

  it("draws each mention in the root as Slack does, by name, else its label, else its id", () => {
    const thread = {
      parentText: "yo <@U0SYN000003> and <@U0SYNNOBODY1|sadie>, ask <@U0SYNNOBODY2>",
      parentUserId: "U0SYN000001",
      ts: "1790566514.594969",
    };
    expect(draftParentInWords({ people: PEOPLE, thread })).toBe(
      'under Ada Owner\'s message: "yo @Ari and @sadie, ask @U0SYNNOBODY2"',
    );
  });

  it("names the root's author by first name when no one shares it", () => {
    const people: SlackPeople = new Map([
      ["U0SETH", { firstNameUnique: true, handle: "seth", name: "Seth Collis-Bird" }],
      ["U0ABEL", { firstNameUnique: false, handle: "abel", name: "Abel Sutter" }],
    ]);
    expect([
      draftParentInWords({ people, thread: { parentText: "odd", parentUserId: "U0SETH", ts: "1.2" } }),
      draftParentInWords({ people, thread: { parentText: "odd", parentUserId: "U0ABEL", ts: "1.2" } }),
    ]).toEqual(['under Seth\'s message: "odd"', 'under Abel Sutter\'s message: "odd"']);
  });

  it("draws a user group by its handle, else as a group, and a broadcast as Slack does — never the S… id", () => {
    const thread = {
      parentText: "<!subteam^S0SYN000013> and <!subteam^S0OTHER|@platform>, <!here>",
      parentUserId: undefined,
      ts: "1790566514.594969",
    };
    expect(draftParentInWords({ people: PEOPLE, thread })).toBe('under the message: "@a group and @platform, @here"');
  });

  it("draws a link by its label, else its address, and Slack's escapes as the characters they stand for", () => {
    const thread = {
      parentText:
        "Renovate &amp; <https://github.com/o/r/pull/1|the bump> &lt;soon&gt; see <https://x.example/a?b=1&amp;c=2>",
      parentUserId: undefined,
      ts: "1790566514.594969",
    };
    expect(draftParentInWords({ people: PEOPLE, thread })).toBe(
      'under the message: "Renovate & the bump <soon> see https://x.example/a?b=1&c=2"',
    );
  });

  it("never reads an escaped angle bracket in the owner's words as a link", () => {
    const thread = { parentText: "&lt;https://x.example|y&gt;", parentUserId: undefined, ts: "1.2" };
    expect(draftParentInWords({ people: PEOPLE, thread })).toBe('under the message: "<https://x.example|y>"');
  });

  it("draws Slack's older <!group> as the @channel it means", () => {
    const thread = { parentText: "<!group> look", parentUserId: undefined, ts: "1.2" };
    expect(draftParentInWords({ people: PEOPLE, thread })).toBe('under the message: "@channel look"');
  });

  it("draws a cut mention whose label survived by the roster, and one cut before its label as the cut", () => {
    const thread = { parentText: "ask <@U0SYN000003|ar… and", parentUserId: undefined, ts: "1.2" };
    const bare = { parentText: "ask <@U0SYN0…", parentUserId: undefined, ts: "1.2" };
    expect([
      draftParentInWords({ people: PEOPLE, thread }),
      draftParentInWords({ people: PEOPLE, thread: bare }),
    ]).toEqual(['under the message: "ask @Ari"', 'under the message: "ask …"']);
  });

  it("draws a roster name exactly as the person set it, never unescaping it as wire text", () => {
    const people: SlackPeople = new Map([
      ["U0RND", { firstNameUnique: true, handle: "rnd", name: "R&amp;D <https://x.example|Ops>" }],
    ]);
    const thread = { parentText: "ask <@U0RND> &amp; go", parentUserId: undefined, ts: "1.2" };
    expect(draftParentInWords({ people, thread })).toBe(
      'under the message: "ask @R&amp;D <https://x.example|Ops> & go"',
    );
  });

  it("opens the context line with the first sentence as Slack draws it", () => {
    expect(
      draftContextInWords({
        channel: "C0ENG",
        channelName: "dev",
        people: PEOPLE,
        thread: { parentText: "Ship it &amp; tell <https://x.example|Seth>. Then rest.", parentUserId: undefined },
        yourId: undefined,
      }),
    ).toBe('on a thread in #dev: "Ship it & tell Seth."');
  });

  it("quotes the root without an author when Slack named none", () => {
    const thread = { parentText: "pool exhausted", parentUserId: undefined, ts: "1790566514.594969" };
    expect(draftParentInWords({ people: PEOPLE, thread })).toBe('under the message: "pool exhausted"');
  });

  it("names the root by its ts when the recording read no parent", () => {
    const thread = { parentText: undefined, parentUserId: undefined, ts: "1790566514.594969" };
    expect(draftParentInWords({ people: PEOPLE, thread })).toBe("under the thread rooted at 1790566514.594969");
  });
});

describe("addressedInWords", () => {
  it("says where alone for a message to nobody in particular", () => {
    expect(addressedInWords({ to: [], where: "#dev" })).toBe("in #dev");
  });

  it("names one, two and three people as a sentence would", () => {
    expect(addressedInWords({ to: ["Kyle"], where: "a direct message" })).toBe("to Kyle in a direct message");
    expect(addressedInWords({ to: ["Ari", "Sadie"], where: "#dev" })).toBe("to Ari and Sadie in #dev");
    expect(addressedInWords({ to: ["Ari", "Sadie", "Jonah"], where: "#dev" })).toBe("to Ari, Sadie and Jonah in #dev");
  });
});

describe("spokenName — what a card's sentence calls a person", () => {
  it("is a first name no one shares, the whole name for a shared one, and the label for a name the roster lacks", () => {
    const people: SlackPeople = new Map([
      ["U0QUINN", { firstNameUnique: true, handle: "quinn", name: "Quinn Vance" }],
      ["U0ABEL", { firstNameUnique: false, handle: "abel", name: "Abel Sutter" }],
      ["U0SYNUNJUDGED", { handle: "kim", name: "Kim Lee" }],
    ]);
    expect([
      spokenName({ label: { text: "Quinn Vance", title: "U0QUINN" }, people }),
      spokenName({ label: { text: "Abel Sutter", title: "U0ABEL" }, people }),
      spokenName({ label: { text: "Kim Lee", title: "U0SYNUNJUDGED" }, people }),
      spokenName({ label: { text: "platform", title: "S0GROUP" }, people }),
    ]).toEqual(["Quinn", "Abel Sutter", "Kim Lee", "platform"]);
  });
});

describe("avatarOf — the face Slack draws beside a member", () => {
  it("answers the picture the roster holds, and nothing for an id without one or no id", () => {
    expect([
      avatarOf({ id: "U0SYN000001", people: PEOPLE }),
      avatarOf({ id: "U0SYN000003", people: PEOPLE }),
      avatarOf({ id: "U0SYNUNKNOWN", people: PEOPLE }),
      avatarOf({ id: undefined, people: PEOPLE }),
    ]).toEqual(["https://avatars.example/ada_72.png", undefined, undefined, undefined]);
  });
});

describe("directMessagePeer", () => {
  it("names the member a DM recorded against a member id is with, and no one for a D… or channel id", () => {
    expect(
      ["U0SYN000006", "W0SYNENTERPRISE", "D0SYN000008", "C0ISO"].map((channel) => directMessagePeer({ channel })),
    ).toEqual(["U0SYN000006", "W0SYNENTERPRISE", undefined, undefined]);
  });
});
