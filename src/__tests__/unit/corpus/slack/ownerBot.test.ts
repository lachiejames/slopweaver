import { describe, expect, it } from "vitest";

import {
  authorAfterMeToMe,
  resolveOwnerBotToOwner,
  type SlackOwnerBotIdentity,
  slackOwnerBotIdentity,
} from "../../../../corpus/slack/ownerBot.js";

const ownerBot: SlackOwnerBotIdentity = {
  appIds: ["A_OWNER_APP"],
  botIds: ["B_OWNER_BOT"],
  botUserIds: ["U_OWNER_BOT"],
  ownerSlackUserId: "U_OWNER",
};

describe("resolveOwnerBotToOwner", () => {
  it("resolves a post by the owner's bot user id back to the owner", () => {
    expect(resolveOwnerBotToOwner({ author: "U_OWNER_BOT", ownerBot, raw: undefined })).toBe("U_OWNER");
  });

  it("resolves by the raw app id back to the owner", () => {
    const raw = { app_id: "A_OWNER_APP", user: "U_OWNER_BOT" };
    expect(resolveOwnerBotToOwner({ author: undefined, ownerBot, raw })).toBe("U_OWNER");
  });

  it("resolves by the raw bot id back to the owner", () => {
    const raw = { bot_id: "B_OWNER_BOT" };
    expect(resolveOwnerBotToOwner({ author: undefined, ownerBot, raw })).toBe("U_OWNER");
  });

  it("does NOT resolve an unrelated third-party bot", () => {
    const raw = { app_id: "A_SOMEONE_ELSE", bot_id: "B_SOMEONE_ELSE", user: "U_TEAMMATE" };
    expect(resolveOwnerBotToOwner({ author: "U_TEAMMATE", ownerBot, raw })).toBeUndefined();
  });

  it("is a no-op when no owner bot is declared", () => {
    expect(resolveOwnerBotToOwner({ author: "U_OWNER_BOT", ownerBot: undefined, raw: undefined })).toBeUndefined();
  });
});

describe("slackOwnerBotIdentity", () => {
  it("defaults absent id lists to empty arrays", () => {
    const built = slackOwnerBotIdentity({ slackBot: { ownerUserId: "U_OWNER" } });
    expect(built).toEqual({ appIds: [], botIds: [], botUserIds: [], ownerSlackUserId: "U_OWNER" });
  });

  it("returns undefined when no declaration is given", () => {
    expect(slackOwnerBotIdentity({ slackBot: undefined })).toBeUndefined();
  });

  it("carries through declared id lists", () => {
    const built = slackOwnerBotIdentity({
      slackBot: { botUserIds: ["U_OWNER_BOT"], ownerUserId: "U_OWNER" },
    });
    expect(built!.botUserIds).toEqual(["U_OWNER_BOT"]);
  });

  it("carries each declared list through as the very list declared, and only the omitted ones as empty", () => {
    const appIds = ["A_OWNER_APP"];
    const botIds = ["B_OWNER_BOT"];
    const built = slackOwnerBotIdentity({ slackBot: { appIds, botIds, ownerUserId: "U_OWNER" } })!;
    expect(built.appIds).toBe(appIds);
    expect(built.botIds).toBe(botIds);
    expect(built.botUserIds).toEqual([]);
    expect(Object.keys(built).toSorted()).toEqual(["appIds", "botIds", "botUserIds", "ownerSlackUserId"]);
  });
});

describe("authorAfterMeToMe", () => {
  it("rewrites a post by the owner's own bot to the owner", () => {
    expect(authorAfterMeToMe({ author: "U_OWNER_BOT", ownerBot, raw: undefined })).toBe("U_OWNER");
  });

  it("keeps the attributed author of any other post", () => {
    const raw = { app_id: "A_SOMEONE_ELSE", user: "U_TEAMMATE" };
    expect(authorAfterMeToMe({ author: "U_TEAMMATE", ownerBot, raw })).toBe("U_TEAMMATE");
  });

  it("keeps the author when me-to-me is off", () => {
    expect(authorAfterMeToMe({ author: "U_OWNER_BOT", ownerBot: undefined, raw: undefined })).toBe("U_OWNER_BOT");
  });

  it("keeps an absent author absent when nothing resolves", () => {
    expect(authorAfterMeToMe({ author: undefined, ownerBot, raw: { user: "U_TEAMMATE" } })).toBeUndefined();
  });
});

/**
 * The distinction the doc comments now spell out, pinned so it cannot silently become false.
 *
 * A declaration exists for two independent reasons — me-to-me resolution AND the cosmetic card chrome — and
 * an operator who wants only the chrome must supply `ownerUserId` because the schema requires it. If merely
 * declaring that armed the rewriting, setting a bot's display name would silently change how the corpus
 * attributes authorship, and a reader who suspected as much declined to set one. It does not: resolution is
 * an `includes` against id lists that default to empty.
 */
describe("a declaration with no id lists is inert", () => {
  const chromeOnly = slackOwnerBotIdentity({ slackBot: { ownerUserId: "U_OWNER" } });

  it("returns an identity rather than undefined", () => {
    expect(chromeOnly).toEqual({ appIds: [], botIds: [], botUserIds: [], ownerSlackUserId: "U_OWNER" });
  });

  it("rewrites no author, even one matching the owner's own user id", () => {
    const raw = { app_id: "A_OWNER_APP", bot_id: "B_OWNER_BOT", user: "U_OWNER" };
    expect(resolveOwnerBotToOwner({ author: "U_OWNER", ownerBot: chromeOnly, raw })).toBeUndefined();
  });

  it("rewrites no author for a bot post", () => {
    const raw = { app_id: "A_OWNER_APP", bot_id: "B_OWNER_BOT" };
    expect(resolveOwnerBotToOwner({ author: "U_OWNER_BOT", ownerBot: chromeOnly, raw })).toBeUndefined();
  });

  it("arms only once an id list is non-empty — the same post then resolves", () => {
    const armed = slackOwnerBotIdentity({ slackBot: { botIds: ["B_OWNER_BOT"], ownerUserId: "U_OWNER" } });
    const raw = { bot_id: "B_OWNER_BOT" };
    expect(resolveOwnerBotToOwner({ author: "U_OWNER_BOT", ownerBot: armed, raw })).toBe("U_OWNER");
  });
});

/**
 * A CHROME-ONLY declaration — no `ownerUserId` at all.
 *
 * This is the shape an operator writes to rename the bot's author row, and it must demand no personal
 * identifier to do so. `ownerUserId` used to be required, which meant a cosmetic change forced a real Slack
 * user id into the profile; it is now optional, and without it there is nothing to resolve TO.
 */
describe("a chrome-only declaration carries no owner id", () => {
  it("yields no identity at all, so me-to-me cannot run", () => {
    expect(slackOwnerBotIdentity({ slackBot: {} })).toBeUndefined();
  });

  it("yields no identity even when bot ids are somehow present", () => {
    // The profile schema refuses this combination outright; this pins the runtime behaviour if one is
    // constructed directly, so the resolver never rewrites an author to `undefined`.
    expect(slackOwnerBotIdentity({ slackBot: { botIds: ["B_OWNER_BOT"] } })).toBeUndefined();
  });
});
