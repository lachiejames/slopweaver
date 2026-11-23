import { describe, expect, it } from "vitest";

import type { DatadogChannelEntity, DatadogEntity } from "../../../../atlas/datadog/documents.js";
import { foldDatadogChannel, mergeDatadogChannel, staleDatadogChannel } from "../../../../atlas/datadog/merge.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-06T01:00:00.000Z";
const LATER = "2026-09-07T01:00:00.000Z";

const channel = ({ at, name }: { at: string; name: DatadogChannelEntity["channel"] }): DatadogChannelEntity => ({
  channel: name,
  detail: { seen: at },
  firstSeenAt: at,
  lastSeenAt: at,
  source: null,
  state: "observed",
});

const entity = ({
  id = "e-1",
  api = null,
  compiled = null,
}: {
  id?: string;
  api?: DatadogChannelEntity | null;
  compiled?: DatadogChannelEntity | null;
} = {}): DatadogEntity => ({
  channels: { api, "compiled-catalogue": compiled, console: null },
  id,
  kind: "monitor",
  providerId: `p-${id}`,
  scope: "@datadog/datadog-api-client 1.62.0",
});

describe("foldDatadogChannel", () => {
  it("carries the stored channel's firstSeenAt forward, so age belongs to the entity not the run", () => {
    const stored = entity({ compiled: channel({ at: AT, name: "compiled-catalogue" }) });
    const observed = entity({ compiled: channel({ at: LATER, name: "compiled-catalogue" }) });

    const folded = foldDatadogChannel({ channel: "compiled-catalogue", observed, stored });

    expect(folded.channels["compiled-catalogue"]!.firstSeenAt).toBe(AT);
    expect(folded.channels["compiled-catalogue"]!.lastSeenAt).toBe(LATER);
  });

  // The whole reason a run declares WHICH channel it refreshes: a compiled sync must not stale or erase
  // what a live pass knows, and vice versa. The corroboration between them is the atlas's output.
  it("leaves another channel's record exactly as it was", () => {
    const stored = entity({ api: channel({ at: AT, name: "api" }) });
    const observed = entity({ compiled: channel({ at: LATER, name: "compiled-catalogue" }) });

    const folded = foldDatadogChannel({ channel: "compiled-catalogue", observed, stored });

    expect(folded.channels.api).toStrictEqual(channel({ at: AT, name: "api" }));
  });

  it("stamps a brand-new entity's firstSeenAt from this run", () => {
    const observed = entity({ compiled: channel({ at: LATER, name: "compiled-catalogue" }) });

    const folded = foldDatadogChannel({ channel: "compiled-catalogue", observed, stored: undefined });

    expect(folded.channels["compiled-catalogue"]!.firstSeenAt).toBe(LATER);
  });
});

describe("staleDatadogChannel", () => {
  it("stales a channel this run refreshed and did not see", () => {
    const stored = entity({ compiled: channel({ at: AT, name: "compiled-catalogue" }) });

    expect(staleDatadogChannel({ channel: "compiled-catalogue", stored })!.channels["compiled-catalogue"]!.state).toBe(
      "stale",
    );
  });

  // A channel that has never looked is `null`, and `null` must never become "looked and found nothing".
  it("leaves a channel that has never looked exactly as it is", () => {
    expect(staleDatadogChannel({ channel: "api", stored: entity() })).toBe(null);
  });

  it("leaves an already-stale channel alone rather than rewriting it", () => {
    const held = { ...channel({ at: AT, name: "api" }), state: "stale" as const };

    expect(staleDatadogChannel({ channel: "api", stored: entity({ api: held }) })).toBe(null);
  });
});

describe("mergeDatadogChannel", () => {
  it("adds an entity the store has never held", () => {
    const merged = unwrap(
      mergeDatadogChannel({
        at: LATER,
        channel: "compiled-catalogue",
        observed: [entity({ compiled: channel({ at: LATER, name: "compiled-catalogue" }), id: "e-2" })],
        stored: [],
      }),
    );

    expect(merged.map((one) => one.id)).toStrictEqual(["e-2"]);
  });

  it("stales an entity the store held that this run did not observe", () => {
    const stored = [entity({ compiled: channel({ at: AT, name: "compiled-catalogue" }), id: "e-1" })];
    const merged = unwrap(mergeDatadogChannel({ at: LATER, channel: "compiled-catalogue", observed: [], stored }));

    expect(merged[0]!.channels["compiled-catalogue"]!.state).toBe("stale");
  });

  it("sorts by id, so two runs over the same data write identical bytes", () => {
    const observed = ["e-3", "e-1", "e-2"].map((id) =>
      entity({ compiled: channel({ at: AT, name: "compiled-catalogue" }), id }),
    );
    const merged = unwrap(mergeDatadogChannel({ at: AT, channel: "compiled-catalogue", observed, stored: [] }));

    expect(merged.map((one) => one.id)).toStrictEqual(["e-1", "e-2", "e-3"]);
  });

  it("REFUSES a run that produced the same entity id twice, because that is how a count double-counts", () => {
    const twice = [entity({ id: "e-1" }), entity({ id: "e-1" })];
    const merged = mergeDatadogChannel({ at: AT, channel: "compiled-catalogue", observed: twice, stored: [] });

    expect(merged.isErr()).toBe(true);
    expect(unwrapErr(merged)[0]).toContain("e-1");
  });
});
