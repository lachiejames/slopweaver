import { describe, expect, it } from "vitest";

import { sensitivityHits } from "../../../../atlas/linear/sensitivity.js";

describe("sensitivityHits", () => {
  it("refuses a webhook signing secret wherever it sits", () => {
    const hits = sensitivityHits({ generation: { setting: { entities: [{ detail: { value: { secret: "s" } } }] } } });
    expect(hits.length).toBe(1);
    expect(hits[0]!.path).toBe("setting.entities[0].detail.value.secret");
  });

  it("refuses a calendar hash, matching the field name case-insensitively", () => {
    expect(sensitivityHits({ generation: { CalendarHash: "abc" } }).length).toBe(1);
  });

  it("refuses a Linear API key by its value shape, under any field name", () => {
    const hits = sensitivityHits({ generation: { note: "lin_api_abcdefghijklmnopqrstuvwx" } });
    expect(hits.length).toBe(1);
    expect(hits[0]!.reason).toBe("the value has the shape of a credential");
  });

  it("refuses a PEM private key", () => {
    expect(sensitivityHits({ generation: { x: "-----BEGIN RSA PRIVATE KEY-----\nab\n" } }).length).toBe(1);
  });

  it("passes an ordinary configuration record with ids and names", () => {
    expect(
      sensitivityHits({
        generation: {
          entities: [{ detail: { value: { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", name: "In Progress" } } }],
        },
      }),
    ).toEqual([]);
  });

  it("passes a webhook URL, which is deliberately held", () => {
    expect(sensitivityHits({ generation: { url: "https://example.test/hooks/linear" } })).toEqual([]);
  });
});

describe("sensitivityHits over a tokenised URL", () => {
  it("refuses a schedule URL carrying a token in its query string", () => {
    const hits = sensitivityHits({
      generation: { value: { externalUrl: "https://calendar.example.test/ops.ics?token=calendar-bearer-secret" } },
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.reason).toBe("the value has the shape of a credential");
  });

  it("refuses a URL carrying a signature parameter", () => {
    expect(sensitivityHits({ generation: { u: "https://example.test/x?sig=abcdefghijkl" } }).length).toBe(1);
  });

  it("passes an ordinary webhook destination with no credential parameter", () => {
    expect(sensitivityHits({ generation: { url: "https://example.test/hooks/linear?team=ENG" } })).toEqual([]);
  });
});

describe("sensitivityHits over an unanticipated credential parameter name", () => {
  it("refuses a URL whose token parameter is named something the gate never enumerated", () => {
    const hits = sensitivityHits({
      generation: { url: "https://calendar.example.test/ops.ics?feedToken=abcdefghijklmnopqrstuvwxyz" },
    });
    expect(hits.length).toBe(1);
  });

  it("refuses a snake-cased access key parameter", () => {
    expect(sensitivityHits({ generation: { u: "https://x.test/a?access_key=abcdefghijkl" } }).length).toBe(1);
  });

  it("still passes a destination whose parameters name no credential", () => {
    expect(sensitivityHits({ generation: { url: "https://example.test/hooks?team=ENG&kind=issue" } })).toEqual([]);
  });
});

describe("sensitivityHits over a URL FRAGMENT", () => {
  it("refuses an implicit-flow callback carrying a token in its fragment", () => {
    const hits = sensitivityHits({
      generation: { developerUrl: "https://client.example.test/callback#access_token=abcdefghijklmnopqrstuvwx" },
    });
    expect(hits.length).toBe(1);
  });

  it("passes a URL whose fragment is an ordinary anchor", () => {
    expect(sensitivityHits({ generation: { url: "https://example.test/docs#installation" } })).toEqual([]);
  });
});
