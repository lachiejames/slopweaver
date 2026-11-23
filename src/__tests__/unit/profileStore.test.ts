import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../lib/result.js";
import {
  acknowledgedReactionEmojiFromProfile,
  botSelfHandlesFromProfile,
  botSelfHandlesOf,
  captureReactionEmojiFromProfile,
  completionReactionEmojiFromProfile,
  forAHumanReactionEmojiFromProfile,
  loadProfile,
  readHighStakesConfig,
  readProfile,
  standDownReactionEmojiFromProfile,
  stoppedReactionEmojiFromProfile,
} from "../../profileStore.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Write a `profile.json` into a fresh temp home and return the home dir. */
function seedProfile({ content }: { content: string }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-profile-"));
  fixtureDirs.push(home);
  writeFileSync(join(home, "profile.json"), content, "utf8");
  return home;
}

/** A warning sink that records what `loadProfile` reports. */
function sink(): { warn: (report: { readonly message: string }) => void; warnings: string[] } {
  const warnings: string[] = [];
  return {
    warn: ({ message }) => {
      warnings.push(message);
    },
    warnings,
  };
}

describe("loadProfile", () => {
  it("reads a valid profile back, including the owner-bot declaration", () => {
    const home = seedProfile({
      content: JSON.stringify({
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: 1,
        slackBot: { botUserIds: ["U_OWNER_BOT"], ownerUserId: "U_OWNER" },
        sources: ["github"],
      }),
    });
    const profile = loadProfile({ home });
    expect(profile!.id).toBe("owner-1");
    expect(profile!.slackBot).toEqual({
      appIds: [],
      botIds: [],
      botUserIds: ["U_OWNER_BOT"],
      captureReaction: { emoji: "eyes" },
      cardChrome: {
        authorEmoji: ":robot_face:",
        authorLabel: "slopweaver",
        bannerColor: "#8B5CF6",
        detailLabel: "*Details*",
        metadataEventType: "slopweaver_card_v1",
      },
      completionReaction: { emoji: "white_check_mark" },
      ownerUserId: "U_OWNER",
      pollChrome: { metadataEventType: "slopweaver_poll_v1" },
      // PR5.2's progress chrome defaults in the same way cardChrome does. `emojiShortcode` is deliberately
      // ABSENT rather than defaulted: an animated custom emoji is workspace-specific, so guessing a name
      // would render literal colons in a workspace that never uploaded one.
      progressChrome: {
        barWidth: 5,
        emojiFallback: "⏳",
        metadataEventType: "slopweaver_progress_v1",
      },
      selfHandles: [],
      selfUserIds: [],
      // The stand-down reaction is Unicode by default, so it works before a custom one is uploaded.
      standDownReaction: { emoji: "zipper_mouth_face" },
      stoppedReaction: { emoji: "warning" },
      witnessBotHandles: [],
      // The acknowledged-reaction emoji defaults to `ack`, and is the one default that is a CUSTOM
      // workspace emoji rather than a Unicode one — the owner's own call for "read and judged, nothing
      // owed", an outcome the tick and the warning both misreport.
      acknowledgedReaction: { emoji: "ack" },
      // The fourth ending, also a custom emoji: read and judged, a PERSON should answer.
      forAHumanReaction: { emoji: "for-a-human" },
    });
  });

  it("resolves the stand-down reaction from a configured profile, and to its Unicode default without one", () => {
    const configured = seedProfile({
      content: JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { standDownReaction: { emoji: "standing-down" } },
        sources: [],
      }),
    });
    const bare = mkdtempSync(join(tmpdir(), "slopweaver-profile-"));
    fixtureDirs.push(bare);
    expect(standDownReactionEmojiFromProfile({ home: configured })).toBe("standing-down");
    expect(standDownReactionEmojiFromProfile({ home: bare })).toBe("zipper_mouth_face");
  });

  it("resolves the bot's own handles from a configured profile, and to none without one", () => {
    const configured = seedProfile({
      content: JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { selfHandles: ["acme-bot"] },
        sources: [],
      }),
    });
    const bare = mkdtempSync(join(tmpdir(), "slopweaver-profile-"));
    fixtureDirs.push(bare);
    expect(botSelfHandlesFromProfile({ home: configured, reader: "test" })).toEqual(["acme-bot"]);
    expect(botSelfHandlesFromProfile({ home: bare, reader: "test" })).toEqual([]);
  });

  it("owes the no-handle notice only when a slackBot block exists and names no handle", () => {
    expect([
      botSelfHandlesOf({ reader: "handover reconcile", slackBot: undefined }),
      botSelfHandlesOf({ reader: "handover reconcile", slackBot: { selfHandles: ["@acme-bot"] } }),
      botSelfHandlesOf({ reader: "handover reconcile", slackBot: { selfHandles: [" "] } }),
    ]).toEqual([
      { handles: [], notice: undefined },
      { handles: ["acme-bot"], notice: undefined },
      {
        handles: [],
        notice:
          "handover reconcile: profile.json declares no slackBot.selfHandles, so the bot is recognised by its role word alone, never by its handle",
      },
    ]);
  });

  it("reads each declared handle bare — trimmed, its leading @ dropped, a blank one gone", () => {
    const configured = seedProfile({
      content: JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { selfHandles: ["@acme-bot", " acme-helper ", "  "] },
        sources: [],
      }),
    });
    expect(botSelfHandlesFromProfile({ home: configured, reader: "test" })).toEqual(["acme-bot", "acme-helper"]);
  });

  it("resolves the for-a-human reaction from a configured profile, and to its custom default without one", () => {
    const configured = seedProfile({
      content: JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { forAHumanReaction: { emoji: "raising_hand" } },
        sources: [],
      }),
    });
    const bare = mkdtempSync(join(tmpdir(), "slopweaver-profile-"));
    fixtureDirs.push(bare);
    expect(forAHumanReactionEmojiFromProfile({ home: configured })).toBe("raising_hand");
    expect(forAHumanReactionEmojiFromProfile({ home: bare })).toBe("for-a-human");
  });

  it("resolves the capture, completion, stopped and acknowledged reactions as configured, and to each schema default without a profile", () => {
    const configured = seedProfile({
      content: JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: {
          acknowledgedReaction: { emoji: "seen-it" },
          captureReaction: { emoji: "inbox_tray" },
          completionReaction: { emoji: "tada" },
          stoppedReaction: { emoji: "octagonal_sign" },
        },
        sources: [],
      }),
    });
    const bare = mkdtempSync(join(tmpdir(), "slopweaver-profile-"));
    fixtureDirs.push(bare);
    expect(captureReactionEmojiFromProfile({ home: configured })).toBe("inbox_tray");
    expect(completionReactionEmojiFromProfile({ home: configured })).toBe("tada");
    expect(stoppedReactionEmojiFromProfile({ home: configured })).toBe("octagonal_sign");
    expect(acknowledgedReactionEmojiFromProfile({ home: configured })).toBe("seen-it");
    expect(captureReactionEmojiFromProfile({ home: bare })).toBe("eyes");
    expect(completionReactionEmojiFromProfile({ home: bare })).toBe("white_check_mark");
    expect(stoppedReactionEmojiFromProfile({ home: bare })).toBe("warning");
    expect(acknowledgedReactionEmojiFromProfile({ home: bare })).toBe("ack");
  });

  it("returns undefined when no profile file exists, and warns nothing", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-profile-none-"));
    fixtureDirs.push(home);
    const { warn, warnings } = sink();
    expect(loadProfile({ home, warn })).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("returns undefined for a corrupt profile, warning once per path however often it is read", () => {
    const home = seedProfile({ content: "{ not json" });
    const { warn, warnings } = sink();
    expect(loadProfile({ home, warn })).toBeUndefined();
    expect(loadProfile({ home, warn })).toBeUndefined();
    expect(warnings).toEqual([unwrapErr(readProfile({ home })).message]);
  });

  it("returns undefined for a schema-invalid profile, and says why", () => {
    const home = seedProfile({ content: JSON.stringify({ id: "owner-1", schemaVersion: 99 }) });
    const { warn, warnings } = sink();
    expect(loadProfile({ home, warn })).toBeUndefined();
    expect(warnings).toEqual([unwrapErr(readProfile({ home })).message]);
  });
});

describe("readProfile", () => {
  it("reads no file as null — an install that has configured nothing", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-profile-none-"));
    fixtureDirs.push(home);
    expect(unwrap(readProfile({ home }))).toBeNull();
  });

  it("refuses a profile that is not JSON, naming the path and the way out", () => {
    const home = seedProfile({ content: "{ not json" });
    const error = unwrapErr(readProfile({ home }));
    expect(error.code).toBe("PROFILE_UNREADABLE");
    expect(error.path).toBe(join(home, "profile.json"));
    expect(error.message).toContain(
      `the profile at ${join(home, "profile.json")} is there but cannot be trusted (not JSON`,
    );
    expect(error.message).toContain("— fix it, or move it aside to run as an install that has configured nothing");
  });

  it("refuses a schema-invalid profile rather than reading it as none", () => {
    const home = seedProfile({ content: JSON.stringify({ id: "owner-1", schemaVersion: 99 }) });
    expect(unwrapErr(readProfile({ home })).code).toBe("PROFILE_UNREADABLE");
  });

  it("refuses a profile that is not valid UTF-8 rather than repairing it", () => {
    const home = seedProfile({ content: "" });
    writeFileSync(join(home, "profile.json"), Buffer.from([0x7b, 0xff, 0x7d]));
    expect(unwrapErr(readProfile({ home })).detail).toContain("encoded data was not valid");
  });

  it("refuses a profile behind a byte-order mark, as the lenient reader always did, rather than stripping it", () => {
    const home = seedProfile({ content: "" });
    const valid = JSON.stringify({ id: "owner-1", schemaVersion: 1, sources: ["github"] });
    writeFileSync(join(home, "profile.json"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(valid)]));
    expect(unwrapErr(readProfile({ home })).detail).toContain("not JSON");
  });

  it("refuses a profile.json that is a dangling link — something is there", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-profile-link-"));
    fixtureDirs.push(home);
    symlinkSync(join(home, "gone.json"), join(home, "profile.json"));
    expect(unwrapErr(readProfile({ home })).code).toBe("PROFILE_UNREADABLE");
  });

  it("refuses a profile in a directory it cannot search, which existsSync would call absent", () => {
    const home = seedProfile({ content: "{}" });
    chmodSync(home, 0o000);
    const read = readProfile({ home });
    chmodSync(home, 0o700);
    expect(unwrapErr(read).code).toBe("PROFILE_UNREADABLE");
  });

  it("reads a valid profile", () => {
    const home = seedProfile({
      content: JSON.stringify({
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: 1,
        sources: ["github"],
      }),
    });
    expect(unwrap(readProfile({ home }))!.id).toBe("owner-1");
  });
});

describe("readHighStakesConfig", () => {
  const BASE = { displayName: "Ada Owner", gitNamespace: "ada-gh", id: "owner-1", schemaVersion: 1, sources: [] };

  it("reads the named channels and every fleet id, de-duplicated", () => {
    const home = seedProfile({
      content: JSON.stringify({
        ...BASE,
        slackBot: { botUserIds: ["U_BOT"], ownerUserId: "U_OWNER", selfUserIds: ["U_BOT", "U_APP"] },
        slackHighStakes: { channels: [{ id: "C0SYN000003", name: "#defects" }] },
      }),
    });
    expect(unwrap(readHighStakesConfig({ home }))).toEqual({
      channels: [{ id: "C0SYN000003", name: "#defects" }],
      fleetGap: undefined,
      fleetUserIds: ["U_OWNER", "U_BOT", "U_APP"],
      listGap: undefined,
    });
  });

  it.each([
    { expected: "names no `slackBot.ownerUserId`", slackBot: { botUserIds: [], selfUserIds: [] } },
    { expected: "names no bot user id", slackBot: { botUserIds: [], ownerUserId: "U_OWNER", selfUserIds: [] } },
    { expected: "names no `slackBot.ownerUserId`", slackBot: undefined },
  ])(
    "names the fleet gap when channels are named without the ids that post there: $expected",
    ({ expected, slackBot }) => {
      const home = seedProfile({
        content: JSON.stringify({
          ...BASE,
          ...(slackBot === undefined ? {} : { slackBot }),
          slackHighStakes: { channels: [{ id: "C0SYN000003", name: "#defects" }] },
        }),
      });
      expect(unwrap(readHighStakesConfig({ home })).fleetGap).toContain(expected);
    },
  );

  it("answers none for a profile that names none, and names the missing list when there is no profile", () => {
    const named = seedProfile({ content: JSON.stringify(BASE) });
    expect(unwrap(readHighStakesConfig({ home: named }))).toEqual({
      channels: [],
      fleetGap: undefined,
      fleetUserIds: [],
      listGap: undefined,
    });
    const bare = mkdtempSync(join(tmpdir(), "slopweaver-profile-none-"));
    fixtureDirs.push(bare);
    expect(unwrap(readHighStakesConfig({ home: bare }))).toEqual({
      channels: [],
      fleetGap: undefined,
      fleetUserIds: [],
      listGap: `${bare} holds no profile.json, so it cannot say which channels are high-stakes`,
    });
  });

  it("REFUSES a channel id that is not a channel, rather than reading it as none", () => {
    const home = seedProfile({
      content: JSON.stringify({ ...BASE, slackHighStakes: { channels: [{ id: "bugs", name: "#defects" }] } }),
    });
    expect(unwrapErr(readHighStakesConfig({ home })).message).toContain(
      "slackHighStakes.channels[].id must be a C… or G… id",
    );
  });
});
