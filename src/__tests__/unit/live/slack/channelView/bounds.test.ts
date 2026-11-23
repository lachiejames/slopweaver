/*
 * How the live channel window bounds its Slack calls: the page, picture, lookup and parallelism constants, the
 * lookup that withholds past its limit, and the lookup that prefetches each distinct id once. It was split out
 * when the channel-window suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { LookupSlackFile } from "../../../../../live/slack/blockFiles.js";
import { CHANNEL_VIEW_MESSAGES, CHANNEL_VIEW_PICTURES } from "../../../../../live/slack/channelView.js";
import {
  boundedLookup,
  CHANNEL_VIEW_LOOKUPS,
  CHANNEL_VIEW_PARALLEL,
  prefetchedLookup,
} from "../../../../../live/slack/channelViewLookups.js";

describe("the bounds", () => {
  it("draws one history page, at most sixteen pictures and sixteen lookups", () => {
    expect(CHANNEL_VIEW_MESSAGES).toBe(30);
    expect(CHANNEL_VIEW_PICTURES).toBe(16);
    expect(CHANNEL_VIEW_LOOKUPS).toBe(16);
    expect(CHANNEL_VIEW_PARALLEL).toBe(4);
  });
});

describe("boundedLookup", () => {
  it("asks the real lookup up to the limit, then withholds without asking", async () => {
    const asked: string[] = [];
    const real: LookupSlackFile = async ({ fileId }) => {
      asked.push(fileId);
      return ok({ id: fileId, isExternal: false });
    };
    const bounded = boundedLookup({ limit: 2, lookup: real });
    const answers = [
      await bounded({ fileId: "F0A" }),
      await bounded({ fileId: "F0B" }),
      await bounded({ fileId: "F0C" }),
    ];

    expect(asked).toEqual(["F0A", "F0B"]);
    expect(unwrap(answers[0]!).id).toBe("F0A");
    expect(unwrapErr(answers[2]!)).toEqual({
      code: "FILE_LOOKUP_WITHHELD",
      fileId: "F0C",
      limit: 2,
      message: "F0C was not looked up: this read already looked up 2 files",
    });
  });
});

describe("prefetchedLookup", () => {
  it("asks each distinct id once, in the order given, before the resolver reaches it, and an unknown id when asked", async () => {
    const asked: string[] = [];
    const real: LookupSlackFile = async ({ fileId }) => {
      asked.push(fileId);
      return ok({ id: fileId, isExternal: false });
    };
    const lookup = prefetchedLookup({ ids: ["F0B", "F0A", "F0B"], lookup: real, parallel: 2 });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(asked).toEqual(["F0B", "F0A"]);
    expect(unwrap(await lookup({ fileId: "F0A" })).id).toBe("F0A");
    expect(unwrap(await lookup({ fileId: "F0B" })).id).toBe("F0B");
    expect(unwrap(await lookup({ fileId: "F0C" })).id).toBe("F0C");
    expect(asked).toEqual(["F0B", "F0A", "F0C"]);
  });
});
