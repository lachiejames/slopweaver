/**
 * The verb's flag surface and every line it prints. Two of these assertions exist because the OPPOSITE
 * behaviour would be a confident lie: the summary must state the docs denominator even when it is small,
 * and a method with no docs row must say so rather than omitting the line.
 */
import { describe, expect, it } from "vitest";

import type { FieldHit, MethodView } from "../../../../atlas/slackApi/build.js";
import type { SlackApiAtlas } from "../../../../atlas/slackApi/model.js";
import { AtlasCommandErrors, atlasCommandErrorLines } from "../../../../cli/commands/atlas/errors.js";
import {
  ATLAS_SLACK_API_FLAG_NAMES,
  parseAtlasSlackApiArgs,
  renderAtlasSlackApi,
  renderBrowser,
  renderFieldHits,
  renderMethod,
  renderSummary,
} from "../../../../cli/commands/atlas/slackApiCore.js";
import { ATLAS_SLACK_API_USAGE } from "../../../../cli/commands/atlas/slackUsage.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const atlas: SlackApiAtlas = {
  browser: [
    {
      name: "client.counts",
      publicSurface: false,
      responsePaths: ["threads.unread_count_by_channel"],
      responsePathsTotal: 82,
      undocumentedParams: ["thread_counts_by_channel"],
    },
    {
      name: "conversations.history",
      publicSurface: true,
      responsePaths: ["latest_updates", "unchanged_messages"],
      responsePathsTotal: 37,
      undocumentedParams: ["cached_latest_updates"],
    },
  ],
  builtAtIso: "2026-08-23T00:00:00.000Z",
  counts: { browserObserved: 2, browserOnly: 1, methods: 264, params: 1102, responseFields: 4441, withDocs: 11 },
  docs: [
    {
      audience: "bot-and-user",
      botScopes: ["channels:history"],
      limitDefault: 100,
      limitMax: 999,
      name: "conversations.history",
      note: "a non-Marketplace app is throttled harder.",
      observedOn: "2026-08-23",
      pagination: "cursor",
      tier: "3",
      userScopes: ["channels:history"],
    },
  ],
  methods: [
    {
      argsType: "ConversationsHistoryArguments",
      description: "Fetches a conversation's history.",
      name: "conversations.history",
      params: [
        { name: "channel", optional: false, type: "string" },
        { name: "limit", optional: true, type: "number" },
      ],
      responseFields: [{ name: "messages", optional: true, type: "MessageElement[]" }],
      responseNested: { messages: ["reply_count"] },
      responseType: "ConversationsHistoryResponse",
    },
  ],
  sdkVersion: "8.0.0",
};

describe("parseAtlasSlackApiArgs", () => {
  it("has at least one entry in ATLAS_SLACK_API_FLAG_NAMES, so the guards below are not vacuously green", () => {
    expect(ATLAS_SLACK_API_FLAG_NAMES.length).toBeGreaterThan(0);
  });

  it("defaults to the summary with no flags", () => {
    expect(unwrap(parseAtlasSlackApiArgs({ rest: [] }))).toEqual({
      browser: false,
      field: undefined,
      fromHar: undefined,
      json: false,
      method: undefined,
    });
  });

  it("reads every flag", () => {
    const parsed = unwrap(
      parseAtlasSlackApiArgs({ rest: ["--method", "conversations", "--field", "reply_count", "--browser", "--json"] }),
    );
    expect(parsed).toEqual({
      browser: true,
      field: "reply_count",
      fromHar: undefined,
      json: true,
      method: "conversations",
    });
  });

  it("refuses an empty term rather than matching everything", () => {
    const result = parseAtlasSlackApiArgs({ rest: ["--method", ""] });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(AtlasCommandErrors.slackApiTermEmpty());
    expect(result._unsafeUnwrapErr().message).toBe("--method and --field need a term; pass one or drop the flag");
  });

  it("refuses a flag it does not accept", () => {
    const result = parseAtlasSlackApiArgs({ rest: ["--nope"] });
    expect(unwrapErr(result)).toEqual(AtlasCommandErrors.flagsInvalid({ reasons: ["unknown flag: --nope"] }));
    expect(atlasCommandErrorLines({ error: unwrapErr(result) })).toEqual(["unknown flag: --nope"]);
  });

  it("names in the usage line exactly the flags the parser accepts", () => {
    for (const flag of ATLAS_SLACK_API_FLAG_NAMES) {
      expect(ATLAS_SLACK_API_USAGE).toContain(flag);
    }
  });
});

describe("renderSummary", () => {
  it("states the docs count as a fraction of the method total", () => {
    expect(renderSummary({ atlas }).join("\n")).toContain("with a docs page read   : 11 of 264");
  });

  it("names the SDK version the map was built from", () => {
    expect(renderSummary({ atlas })[0]).toBe("slack api atlas: @slack/web-api 8.0.0, built 2026-08-23T00:00:00.000Z");
  });
});

describe("renderMethod", () => {
  const merged: MethodView = {
    browser: atlas.browser[1],
    docs: atlas.docs[0],
    name: "conversations.history",
    sdk: atlas.methods[0],
  };

  it("marks required arguments and lists the nested response fields", () => {
    const text = renderMethod({ view: merged }).join("\n");
    expect(text).toContain("args    : channel*, limit");
    expect(text).toContain("messages[] : reply_count");
  });

  it("prints the docs facts on one line, dated", () => {
    expect(renderMethod({ view: merged }).join("\n")).toContain(
      "docs    : tier 3 (50+/min) · bot-and-user · bot [channels:history] · user [channels:history] · cursor · limit 100/999 · read 2026-08-23",
    );
  });

  it("surfaces the undocumented parameters observed on the wire", () => {
    expect(renderMethod({ view: merged }).join("\n")).toContain(
      "browser : undocumented params observed — cached_latest_updates",
    );
  });

  it("says a missing docs row is UNKNOWN rather than omitting the line", () => {
    const bare: MethodView = { browser: undefined, docs: undefined, name: "users.list", sdk: atlas.methods[0] };
    expect(renderMethod({ view: bare }).join("\n")).toContain(
      "docs    : NOT READ. Tier and scopes are unknown, which is not the same as Tier 3.",
    );
  });

  it("says a method with no arguments takes only the token, and one with no resolved field is unresolved", () => {
    const opaque: MethodView = {
      ...merged,
      sdk: { ...atlas.methods[0]!, params: [], responseFields: [], responseNested: {} },
    };
    const lines = renderMethod({ view: opaque });
    expect(lines).toContain("  args    : (none but the token)");
    expect(lines).toContain("  returns : (unresolved)");
  });

  it("prints ? for a tier and a page size the docs page names none of", () => {
    const sparse: MethodView = {
      ...merged,
      docs: { ...atlas.docs[0]!, limitDefault: undefined, limitMax: undefined, tier: undefined },
    };
    expect(renderMethod({ view: sparse })).toContain(
      "  docs    : tier ? · bot-and-user · bot [channels:history] · user [channels:history] · cursor · limit ?/? · read 2026-08-23",
    );
  });

  it("says plainly when a name is not in the SDK at all", () => {
    const internal: MethodView = { browser: atlas.browser[0], docs: undefined, name: "client.counts", sdk: undefined };
    expect(renderMethod({ view: internal }).join("\n")).toContain("NOT in the installed SDK typings");
  });
});

describe("renderFieldHits", () => {
  it("flags a browser-only hit in the row itself", () => {
    const hits: readonly FieldHit[] = [
      { browserOnly: true, method: "client.counts", paths: ["threads.unread_count_by_channel"] },
    ];
    expect(renderFieldHits({ field: "unread", hits }).join("\n")).toContain("[browser-only] client.counts");
  });

  it("says an empty result is an absence in THIS map, not in Slack", () => {
    expect(renderFieldHits({ field: "nope", hits: [] }).join("\n")).toContain("That is an absence in THIS map");
  });
});

describe("renderBrowser", () => {
  it("lists the undocumented surface with its public/internal split and total path count", () => {
    const text = renderBrowser({ atlas }).join("\n");
    expect(text).toContain("2 method(s) observed on the wire; 1 are not in the SDK:");
    expect(text).toContain("PUBLIC   conversations.history");
    expect(text).toContain("internal client.counts");
  });
});

describe("renderAtlasSlackApi", () => {
  it("prints only the summary when no view flag was given", () => {
    const text = renderAtlasSlackApi({
      atlas,
      hits: [],
      options: { browser: false, field: undefined, fromHar: undefined, json: false, method: undefined },
      views: [],
    });
    expect(text).toBe(renderSummary({ atlas }).join("\n"));
  });

  it("appends the field answer under the summary when --field was given", () => {
    const text = renderAtlasSlackApi({
      atlas,
      hits: [{ browserOnly: false, method: "conversations.history", paths: ["messages[].reply_count"] }],
      options: { browser: false, field: "reply_count", fromHar: undefined, json: false, method: undefined },
      views: [],
    });
    expect(text).toContain('1 method(s) return a field matching "reply_count":');
  });
});
