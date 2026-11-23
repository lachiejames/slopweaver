/*
 * How a finished frontier walk becomes page entities: one per visited route, each carrying its own deep link, clock
 * and the count of calls its page made.
 */
import { describe, expect, it } from "vitest";

import type { FrontierWalkResult } from "../../../../../atlas/kit/frontierContract.js";
import { projectWalkedPages } from "../../../../../atlas/kit/frontierWalk.js";

import { AT, BASE, explain, observation } from "./harness.js";

describe("projectWalkedPages", () => {
  it("projects one entity per visited route, counting the calls each page made", () => {
    const walk: FrontierWalkResult<{ page: string }> = {
      artifactsWritten: 0,
      calls: [{ page: "/a" }, { page: "/b" }, { page: "/a" }],
      incompletePages: ["/b"],
      notAttempted: [],
      pages: [
        observation({ over: { finalUrl: `${BASE}/a`, route: "/a" } }),
        observation({ over: { finalUrl: null, outcome: "failed", route: "/b" } }),
      ],
      roundsRun: 1,
      sessionEndedAt: null,
    };

    const entities = projectWalkedPages({
      assemble: ({ id, providerId, view, detail }) => ({ detail, id, providerId, view }),
      at: AT,
      entityIdFor: ({ providerId }) => `page:${providerId}`,
      explain,
      onPage: ({ call }) => call.page,
      walk,
    });

    expect(entities.map((entity) => [entity.id, entity.providerId])).toEqual([
      ["page:/a", "/a"],
      ["page:/b", "/b"],
    ]);
    expect(
      entities.map(({ view }) => [
        view.channel,
        view.source.deepLink,
        view.source.deepLinkStatus,
        view.source.endpoint,
      ]),
    ).toEqual([
      ["browser", `${BASE}/a`, "browser-discovered", "/a"],
      ["browser", null, "unavailable", "/b"],
    ]);
    expect(entities.map(({ view, detail }) => view.detail === detail)).toEqual([true, true]);
    expect(entities.map(({ view }) => [view.firstSeenAt, view.source.observedAt])).toEqual([
      [AT, AT],
      [AT, AT],
    ]);
    expect(
      entities.map((entity) => {
        const detail = entity.detail as { callCount: number; captureComplete: boolean };
        return [detail.callCount, detail.captureComplete];
      }),
    ).toEqual([
      [2, true],
      [1, false],
    ]);
  });
});
