/*
 * `renderAtlasRead`: a page said to be a page of STORED records, each row led by the entity's own name with its id
 * line and observation lines, and a `--query` witness line naming the field it matched on.
 */
import { describe, expect, it } from "vitest";

import { answerAtlasRead } from "../../../../../../atlas/kit/readAnswer.js";
import { renderAtlasRead } from "../../../../../../cli/commands/atlas/readCore.js";
import { answeredWith, FIXTURE_NOW_MS, snapshot } from "./harness.js";

describe("renderAtlasRead", () => {
  it("says a page is a page, hands back the cursor, and says the count is of STORED records", () => {
    const answered = answerAtlasRead({
      kinds: snapshot().kinds,
      nowMs: FIXTURE_NOW_MS,
      selection: { includeStale: false, limit: 1 },
      snapshot: snapshot(),
    });
    const lines = renderAtlasRead({ acceptUnproven: false, result: answered });
    expect(lines[0]).toBe("cloudflare atlas — 1 matching STORED entity");
    expect(
      lines.some((line) => line.includes("counts are of STORED records, never the provider's own population")),
    ).toBe(true);
  });

  it("names an absent deep link's REASON rather than printing an empty column", () => {
    const answered = answerAtlasRead({
      kinds: snapshot().kinds,
      nowMs: FIXTURE_NOW_MS,
      selection: { includeStale: false },
      snapshot: snapshot(),
    });
    const lines = renderAtlasRead({ acceptUnproven: false, result: answered });
    expect(lines.some((line) => line.includes("(no link — unverified)"))).toBe(true);
  });

  it("prints a surface's deep link at the end of its observation line when it holds one", () => {
    const base = snapshot();
    const kind = base.kinds[0]!;
    const entity = kind.entities[0]!;
    const linked = {
      ...entity.observations[0]!,
      deepLink: "https://dash.cloudflare.com/abc",
      deepLinkStatus: "provider-provided" as const,
    };
    const kinds = [{ ...kind, entities: [{ ...entity, observations: [linked] }] }];
    const answered = answerAtlasRead({
      kinds,
      nowMs: FIXTURE_NOW_MS,
      selection: { includeStale: false },
      snapshot: { ...base, kinds },
    });
    expect(renderAtlasRead({ acceptUnproven: false, result: answered })).toContain(
      "  rest-api  observed  2026-08-20T07:07:53.351Z  zones-list  https://dash.cloudflare.com/abc",
    );
  });

  it("leads a row with the entity's own name, and keeps the provider id on the id line", () => {
    const lines = renderAtlasRead({ acceptUnproven: false, result: answeredWith({ selection: {} }) });
    expect(lines).toContain("zone  acme.com");
    expect(lines).toContain("  id atlas-1  ·  account/abc  ·  00000000000000000000000000002e01");
  });

  it("falls back to nothing when the provider names the entity nothing — the head lines are unchanged", () => {
    const lines = renderAtlasRead({
      acceptUnproven: false,
      result: answeredWith({ detail: { keys: 4 }, selection: {} }),
    });
    expect(lines).toContain("zone  00000000000000000000000000002e01");
    expect(lines).toContain("  id atlas-1  ·  account/abc");
  });

  it("says which field a --query matched on, so a reader can tell a real hit from an incidental one", () => {
    const lines = renderAtlasRead({
      acceptUnproven: false,
      result: answeredWith({
        detail: { name: "acme.com", settings: { ssl: { label: "Password required" } } },
        selection: { query: "password" },
      }),
    });
    expect(lines).toContain('  matched "password" at detail.settings.ssl.label — Password required');
  });

  it("counts the other fields a token also hit rather than printing one line each", () => {
    const lines = renderAtlasRead({
      acceptUnproven: false,
      result: answeredWith({
        detail: { name: "password policy", notes: "a password rule", tip: "password" },
        selection: { query: "password" },
      }),
    });
    expect(lines).toContain('  matched "password" at detail.name (+2 more) — password policy');
  });

  it("prints no witness line at all when no --query was given", () => {
    const lines = renderAtlasRead({ acceptUnproven: false, result: answeredWith({ selection: {} }) });
    expect(lines.filter((line) => line.includes('matched "'))).toEqual([]);
  });
});
