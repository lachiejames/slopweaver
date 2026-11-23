import { describe, expect, it } from "vitest";

import { unreadSinks } from "../../../gcpAudit/coverage.js";

const sink = ({ destination, disabled = null }: { destination: string; disabled?: boolean | null }) => ({
  destination,
  disabled,
});

describe("unreadSinks", () => {
  const searched = ["organizations/1", "projects/acme-log-hub", "projects/acme-local"] as const;

  it("reads a sink into a bucket of a searched container as covered", () => {
    const sinks = [
      sink({ destination: "logging.googleapis.com/projects/acme-local/locations/global/buckets/_Required" }),
      sink({
        destination: "logging.googleapis.com/projects/acme-log-hub/locations/us-central1/buckets/acme-retained-logs",
      }),
    ];
    expect(unreadSinks({ searched, sinks })).toEqual([]);
  });

  it("names a sink to Pub/Sub, Cloud Storage, or a bucket outside the search", () => {
    const sinks = [
      sink({ destination: "pubsub.googleapis.com/projects/p-one/topics/t" }),
      sink({ destination: "storage.googleapis.com/acme-archive-bucket" }),
      sink({ destination: "logging.googleapis.com/projects/elsewhere/locations/global/buckets/b" }),
    ];
    expect(unreadSinks({ searched, sinks })).toEqual(sinks);
  });

  it("skips a disabled sink, which routes nothing", () => {
    expect(
      unreadSinks({
        searched,
        sinks: [sink({ destination: "pubsub.googleapis.com/projects/p/topics/t", disabled: true })],
      }),
    ).toEqual([]);
  });
});
