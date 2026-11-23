import { describe, expect, it } from "vitest";

import {
  foldGeminiAiStudioChannel,
  mergeGeminiAiStudioChannel,
  staleGeminiAiStudioChannel,
} from "../../../../atlas/geminiAiStudio/merge.js";
import {
  GEMINI_AI_STUDIO_CHANNELS,
  type GeminiAiStudioAtlasEntity,
  type GeminiAiStudioChannel,
} from "../../../../atlas/geminiAiStudio/model.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const FIRST = "2026-08-01T00:00:00.000Z";
const SECOND = "2026-09-01T00:00:00.000Z";
const AT = "2026-10-01T00:00:00.000Z";

type Slot = GeminiAiStudioAtlasEntity["channels"]["compiled"];

function slot({
  channel,
  detail,
  firstSeenAt,
  lastSeenAt,
  state,
}: {
  channel: "compiled" | "api" | "browser";
  detail: string;
  firstSeenAt: string;
  lastSeenAt: string;
  state: "observed" | "stale";
}): NonNullable<Slot> {
  return { channel, detail, firstSeenAt, lastSeenAt, source: null, state };
}

function entity({
  id,
  channels,
}: {
  id: string;
  channels: GeminiAiStudioAtlasEntity["channels"];
}): GeminiAiStudioAtlasEntity {
  return { channels, id, kind: "models", providerId: `GET /v1beta/${id}` };
}

const storedCompiled = slot({
  channel: "compiled",
  detail: "stored-compiled",
  firstSeenAt: FIRST,
  lastSeenAt: FIRST,
  state: "observed",
});
const storedBrowser = slot({
  channel: "browser",
  detail: "stored-browser",
  firstSeenAt: FIRST,
  lastSeenAt: SECOND,
  state: "observed",
});
const storedApi = slot({
  channel: "api",
  detail: "stored-api",
  firstSeenAt: FIRST,
  lastSeenAt: SECOND,
  state: "observed",
});
const freshCompiled = slot({
  channel: "compiled",
  detail: "fresh-compiled",
  firstSeenAt: AT,
  lastSeenAt: AT,
  state: "observed",
});
const freshApi = slot({ channel: "api", detail: "fresh-api", firstSeenAt: AT, lastSeenAt: AT, state: "observed" });
const freshBrowser = slot({
  channel: "browser",
  detail: "fresh-browser",
  firstSeenAt: AT,
  lastSeenAt: AT,
  state: "observed",
});

/** A stored entity's channels with every slot populated, each first seen at FIRST. */
const STORED_CHANNELS: Record<GeminiAiStudioChannel, NonNullable<Slot>> = {
  api: storedApi,
  browser: storedBrowser,
  compiled: storedCompiled,
};
/** The one fresh slot a run on each channel observes. */
const FRESH_SLOTS: Record<GeminiAiStudioChannel, NonNullable<Slot>> = {
  api: freshApi,
  browser: freshBrowser,
  compiled: freshCompiled,
};
const NO_CHANNELS: GeminiAiStudioAtlasEntity["channels"] = { api: null, browser: null, compiled: null };

describe("foldGeminiAiStudioChannel", () => {
  it("replaces the refreshed compiled channel, keeps its stored firstSeenAt, and carries the stored browser channel", () => {
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: storedCompiled }, id: "models" });
    const observed = entity({ channels: { api: null, browser: null, compiled: freshCompiled }, id: "models" });
    expect(foldGeminiAiStudioChannel({ channel: "compiled", observed, stored })).toEqual(
      entity({
        channels: {
          api: null,
          browser: storedBrowser,
          compiled: { ...freshCompiled, firstSeenAt: FIRST },
        },
        id: "models",
      }),
    );
  });

  it("ignores a browser channel the observed row happens to carry when a stored row exists", () => {
    const stray = slot({
      channel: "browser",
      detail: "observed-stray-browser",
      firstSeenAt: AT,
      lastSeenAt: AT,
      state: "observed",
    });
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: storedCompiled }, id: "models" });
    const observed = entity({ channels: { api: null, browser: stray, compiled: freshCompiled }, id: "models" });
    expect(foldGeminiAiStudioChannel({ channel: "compiled", observed, stored })).toEqual(
      entity({
        channels: { api: null, browser: storedBrowser, compiled: { ...freshCompiled, firstSeenAt: FIRST } },
        id: "models",
      }),
    );
  });

  it("keeps the observed firstSeenAt and channel map for an entity with no stored predecessor", () => {
    const observed = entity({ channels: { api: null, browser: null, compiled: freshCompiled }, id: "models" });
    expect(foldGeminiAiStudioChannel({ channel: "compiled", observed, stored: undefined })).toEqual(observed);
  });

  it("retains the stored slot exactly when the observed row carries nothing on the refreshed channel", () => {
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: storedCompiled }, id: "models" });
    const observed = entity({ channels: { api: null, browser: null, compiled: null }, id: "models" });
    expect(foldGeminiAiStudioChannel({ channel: "compiled", observed, stored })).toEqual(stored);
  });

  it("refreshes the browser channel without touching the stored compiled channel", () => {
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: storedCompiled }, id: "models" });
    const observed = entity({ channels: { api: null, browser: freshBrowser, compiled: null }, id: "models" });
    expect(foldGeminiAiStudioChannel({ channel: "browser", observed, stored })).toEqual(
      entity({
        channels: { api: null, browser: { ...freshBrowser, firstSeenAt: FIRST }, compiled: storedCompiled },
        id: "models",
      }),
    );
  });

  it("keeps this run's own firstSeenAt when the stored entity's refreshed channel never looked before", () => {
    const stored = entity({ channels: { api: null, browser: null, compiled: storedCompiled }, id: "models" });
    const observed = entity({ channels: { api: null, browser: freshBrowser, compiled: null }, id: "models" });
    expect(foldGeminiAiStudioChannel({ channel: "browser", observed, stored })).toEqual(
      entity({ channels: { api: null, browser: freshBrowser, compiled: storedCompiled }, id: "models" }),
    );
  });
});

describe("staleGeminiAiStudioChannel", () => {
  it("marks only the refreshed channel stale and leaves every other field and channel exact", () => {
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: storedCompiled }, id: "models" });
    expect(staleGeminiAiStudioChannel({ channel: "compiled", stored })).toEqual(
      entity({
        channels: { api: null, browser: storedBrowser, compiled: { ...storedCompiled, state: "stale" } },
        id: "models",
      }),
    );
  });

  it("returns null when the refreshed channel was never populated", () => {
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: null }, id: "models" });
    expect(staleGeminiAiStudioChannel({ channel: "compiled", stored })).toBeNull();
  });

  it("returns null when the refreshed channel is already stale", () => {
    const stored = entity({
      channels: { api: null, browser: null, compiled: { ...storedCompiled, state: "stale" } },
      id: "models",
    });
    expect(staleGeminiAiStudioChannel({ channel: "compiled", stored })).toBeNull();
  });
});

describe("mergeGeminiAiStudioChannel", () => {
  it("folds the observed row, stales only the compiled channel of the absent stored row, and sorts by id", () => {
    const absent = entity({
      channels: { api: null, browser: storedBrowser, compiled: storedCompiled },
      id: "a-absent",
    });
    const heldObserved = entity({
      channels: { api: null, browser: storedBrowser, compiled: storedCompiled },
      id: "b-seen",
    });
    const observed = entity({ channels: { api: null, browser: null, compiled: freshCompiled }, id: "b-seen" });
    const merged = unwrap(
      mergeGeminiAiStudioChannel({ at: AT, channel: "compiled", observed: [observed], stored: [heldObserved, absent] }),
    );
    expect(merged).toEqual([
      entity({
        channels: { api: null, browser: storedBrowser, compiled: { ...storedCompiled, state: "stale" } },
        id: "a-absent",
      }),
      entity({
        channels: { api: null, browser: storedBrowser, compiled: { ...freshCompiled, firstSeenAt: FIRST } },
        id: "b-seen",
      }),
    ]);
  });

  it("accepts exactly the channels the per-channel fixtures cover", () => {
    expect([...GEMINI_AI_STUDIO_CHANNELS]).toEqual(["compiled", "api", "browser"]);
  });

  it.each(GEMINI_AI_STUDIO_CHANNELS)(
    "driven on the %s channel: refreshes the observed row, keeps its stored firstSeenAt, stales the absent row's slot, leaves every other slot as stored",
    (channel) => {
      const seen = entity({ channels: STORED_CHANNELS, id: "b-seen" });
      const absent = entity({ channels: STORED_CHANNELS, id: "a-absent" });
      const observed = entity({ channels: { ...NO_CHANNELS, [channel]: FRESH_SLOTS[channel] }, id: "b-seen" });
      const merged = unwrap(
        mergeGeminiAiStudioChannel({ at: AT, channel, observed: [observed], stored: [seen, absent] }),
      );
      expect(merged).toEqual([
        entity({
          channels: { ...STORED_CHANNELS, [channel]: { ...STORED_CHANNELS[channel], state: "stale" } },
          id: "a-absent",
        }),
        entity({
          channels: { ...STORED_CHANNELS, [channel]: { ...FRESH_SLOTS[channel], firstSeenAt: FIRST } },
          id: "b-seen",
        }),
      ]);
    },
  );

  it("stamps a brand new entity with its own firstSeenAt, never the run's at", () => {
    const observed = entity({ channels: { api: null, browser: null, compiled: freshCompiled }, id: "fresh" });
    const merged = unwrap(
      mergeGeminiAiStudioChannel({
        at: "2026-12-31T00:00:00.000Z",
        channel: "compiled",
        observed: [observed],
        stored: [],
      }),
    );
    expect(merged).toEqual([observed]);
  });

  it("leaves a stored entity untouched when it was not observed and its compiled channel was never populated", () => {
    const browserOnly = entity({ channels: { api: null, browser: storedBrowser, compiled: null }, id: "page" });
    const merged = unwrap(
      mergeGeminiAiStudioChannel({ at: AT, channel: "compiled", observed: [], stored: [browserOnly] }),
    );
    expect(merged).toEqual([browserOnly]);
  });

  it("refuses an observed generation that names one id twice", () => {
    const observed = entity({ channels: { api: null, browser: null, compiled: freshCompiled }, id: "twice" });
    const lines = unwrapErr(
      mergeGeminiAiStudioChannel({ at: AT, channel: "compiled", observed: [observed, observed], stored: [] }),
    );
    expect(lines).toEqual([
      "this run produced the same entity id twice: twice",
      "refusing to merge — one read producing two records for one thing is how a count double-counts",
    ]);
  });

  it("returns an empty list for an empty stored and an empty observed generation", () => {
    expect(unwrap(mergeGeminiAiStudioChannel({ at: AT, channel: "compiled", observed: [], stored: [] }))).toEqual([]);
  });
});
