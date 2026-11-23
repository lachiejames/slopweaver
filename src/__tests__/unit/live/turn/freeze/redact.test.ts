/**
 * The fixture redactor — the allowlist, the id mapper, and the two shapes a fixture has to keep parseable.
 * Every Datadog host in this file reads a synthetic site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { scanContent } from "../../../../../hygiene/scan.js";
import {
  type FixtureIdMap,
  HOME_PLACEHOLDER,
  REDACTED,
  redactFixtureText,
  redactFixtureValue,
  syntheticIdFor,
} from "../../../../../live/turn/freeze/redact.js";

const NO_DENYLIST: readonly string[] = [];
const HOME = "/tmp/fixture-home";
/**
 * A workspace-id-shaped literal is what the hygiene gate's `raw-workspace-id` class reports — the very class
 * this mapper exists to remove — so the inputs below are assembled from parts at runtime.
 * Every one of them is invented: none is any real workspace's id, and the assembly exists only to keep a
 * line-wise scanner from matching a made-up value. Same for the absolute home path.
 */
const rawId = ({ prefix, body }: { prefix: string; body: string }): string => `${prefix}${body}`;
const A_CHANNEL = rawId({ body: "0QWERTY12", prefix: "C" });
const A_USER = rawId({ body: "0ZXCVBN34", prefix: "U" });
const AN_OUTSIDE_PATH = ["", "Users", "tester", "dev", "repo"].join("/");
const A_TOKEN = ["xoxb", "1234567890", "abcdefghij"].join("-");

/** A fresh working map per assertion — synthetic ids are minted in first-appearance order. */
function ids(): FixtureIdMap {
  return new Map();
}

describe("syntheticIdFor", () => {
  it("mints a prefixed, all-letter id for a Slack-shaped id", () => {
    expect(syntheticIdFor({ ids: ids(), real: A_CHANNEL })).toBe("CFIXTUREAA");
  });

  it("keeps the prefix so a channel is still tellable from a user", () => {
    const map = ids();
    expect(syntheticIdFor({ ids: map, real: A_CHANNEL })).toBe("CFIXTUREAA");
    expect(syntheticIdFor({ ids: map, real: A_USER })).toBe("UFIXTUREAB");
  });

  it("keeps an enterprise prefix, one of the hygiene gate's eight", () => {
    expect(syntheticIdFor({ ids: ids(), real: rawId({ body: "0QWERTY12", prefix: "E" }) })).toBe("EFIXTUREAA");
  });

  it("is stable for the same real id", () => {
    const map = ids();
    expect(syntheticIdFor({ ids: map, real: A_CHANNEL })).toBe(syntheticIdFor({ ids: map, real: A_CHANNEL }));
    expect(map.size).toBe(1);
  });

  it("names a UUID as one rather than inventing a prefix", () => {
    expect(syntheticIdFor({ ids: ids(), real: "1190849D-DC9A-43FA-8BCC-F5C01C45ADF5" })).toBe("fixture-uuid-aa");
  });

  it("mints an id the hygiene gate does not flag", () => {
    const minted = syntheticIdFor({ ids: ids(), real: A_CHANNEL });
    expect(scanContent({ content: minted, denylist: NO_DENYLIST, path: "f" })).toEqual([]);
  });

  it("mints an id the hygiene gate still does not flag beside a timestamp", () => {
    const minted = syntheticIdFor({ ids: ids(), real: A_CHANNEL });
    expect(scanContent({ content: `ask-${minted}-1787878821.099679`, denylist: NO_DENYLIST, path: "f" })).toEqual([]);
  });
});

describe("redactFixtureText", () => {
  it("maps every id in a compound string consistently", () => {
    expect(
      redactFixtureText({
        denylist: NO_DENYLIST,
        home: HOME,
        ids: ids(),
        text: `["${A_CHANNEL}","1787878821.099679","1787878821.099679"]`,
      }),
    ).toBe('["CFIXTUREAA","1787878821.099679","1787878821.099679"]');
  });

  it("rewrites a path inside the home to the placeholder, keeping the tail", () => {
    expect(redactFixtureText({ denylist: NO_DENYLIST, home: HOME, ids: ids(), text: `${HOME}/briefs/x.json` })).toBe(
      `${HOME_PLACEHOLDER}/briefs/x.json`,
    );
  });

  it("rewrites an absolute path outside the home to a neutral user directory", () => {
    expect(redactFixtureText({ denylist: NO_DENYLIST, home: HOME, ids: ids(), text: AN_OUTSIDE_PATH })).toBe(
      "/fixture/user/dev/repo",
    );
  });

  it("neutralises a token shape", () => {
    expect(redactFixtureText({ denylist: NO_DENYLIST, home: HOME, ids: ids(), text: A_TOKEN })).toBe("[token]");
  });

  it("neutralises an email address", () => {
    expect(redactFixtureText({ denylist: NO_DENYLIST, home: HOME, ids: ids(), text: "a.b@example.com" })).toBe(
      "[email]",
    );
  });

  it("removes a denylist word case-insensitively", () => {
    expect(redactFixtureText({ denylist: ["acme"], home: HOME, ids: ids(), text: "live-AcMe-loop" })).toBe(
      "live-[redacted-word]-loop",
    );
  });

  it("treats a denylist word as a literal, never as a pattern", () => {
    expect(redactFixtureText({ denylist: ["a.c"], home: HOME, ids: ids(), text: "abc a.c" })).toBe(
      "abc [redacted-word]",
    );
  });

  it("leaves a Slack timestamp intact — it is the ask's own key, not a leak class", () => {
    expect(redactFixtureText({ denylist: NO_DENYLIST, home: HOME, ids: ids(), text: "1787878821.099679" })).toBe(
      "1787878821.099679",
    );
  });
});

describe("redactFixtureValue", () => {
  it("blanks a string whose key is not allowlisted", () => {
    expect(
      redactFixtureValue({ denylist: NO_DENYLIST, home: HOME, ids: ids(), key: undefined, value: { text: "secrets" } }),
    ).toEqual({ text: REDACTED });
  });

  it("keeps and maps a string whose key is allowlisted", () => {
    expect(
      redactFixtureValue({
        denylist: NO_DENYLIST,
        home: HOME,
        ids: ids(),
        key: undefined,
        value: { channel: A_CHANNEL },
      }),
    ).toEqual({ channel: "CFIXTUREAA" });
  });

  it("keeps a detective wave's report path while blanking the question beside it", () => {
    expect(
      redactFixtureValue({
        denylist: NO_DENYLIST,
        home: HOME,
        ids: ids(),
        key: undefined,
        value: {
          question: "what are Tobin's pain points",
          reportPath: `${HOME}/live/slack/detectives/${A_CHANNEL}-1789521183.332199/store-1/report-1.md`,
        },
      }),
    ).toEqual({
      question: REDACTED,
      reportPath: `${HOME_PLACEHOLDER}/live/slack/detectives/CFIXTUREAA-1789521183.332199/store-1/report-1.md`,
    });
  });

  it("keeps non-string leaves as they are", () => {
    expect(
      redactFixtureValue({
        denylist: NO_DENYLIST,
        home: HOME,
        ids: ids(),
        key: undefined,
        value: { round: 5, schemaVersion: 2, settled: true },
      }),
    ).toEqual({ round: 5, schemaVersion: 2, settled: true });
  });

  it("gives array elements their array's key", () => {
    expect(
      redactFixtureValue({
        denylist: NO_DENYLIST,
        home: HOME,
        ids: ids(),
        key: undefined,
        value: { person: [A_CHANNEL] },
      }),
    ).toEqual({ person: ["CFIXTUREAA"] });
  });

  it("keeps a Slack permalink parseable by moving it to a neutral workspace host", () => {
    expect(
      redactFixtureValue({
        denylist: NO_DENYLIST,
        home: HOME,
        ids: ids(),
        key: undefined,
        value: { askPermalink: `https://acme-group.slack.com/archives/${A_CHANNEL}/p1787878821099679` },
      }),
    ).toEqual({ askPermalink: "https://fixture.slack.com/archives/CFIXTUREAA/p1787878821099679" });
  });

  it("blanks a non-Slack URL whole", () => {
    expect(
      redactFixtureValue({
        denylist: NO_DENYLIST,
        home: HOME,
        ids: ids(),
        key: undefined,
        value: { url: "https://internal.example.com/runbook" },
      }),
    ).toEqual({ url: "https://redacted.invalid/[REDACTED]" });
  });

  it("keeps a banned Datadog console host so the incident survives the freeze, blanking its path", () => {
    expect(
      redactFixtureValue({
        denylist: NO_DENYLIST,
        home: HOME,
        ids: ids(),
        key: undefined,
        value: { url: "https://app.ap1.datadoghq.com/monitors/1000001" },
      }),
    ).toEqual({ url: "https://app.ap1.datadoghq.com/[REDACTED]" });
  });

  it("blanks a REAL Datadog console URL whole, like any other", () => {
    expect(
      redactFixtureValue({
        denylist: NO_DENYLIST,
        home: HOME,
        ids: ids(),
        key: undefined,
        value: { url: "https://ap1.datadoghq.com/monitors/1000001" },
      }),
    ).toEqual({ url: "https://redacted.invalid/[REDACTED]" });
  });

  it("keeps a citation label and id, because the answer form cross-validates them", () => {
    expect(
      redactFixtureValue({
        denylist: NO_DENYLIST,
        home: HOME,
        ids: ids(),
        key: undefined,
        value: { citations: [{ id: "1", label: "[1]" }] },
      }),
    ).toEqual({ citations: [{ id: "1", label: "[1]" }] });
  });

  it("blanks a label and id that are prose rather than a citation key", () => {
    expect(
      redactFixtureValue({
        denylist: NO_DENYLIST,
        home: HOME,
        ids: ids(),
        key: undefined,
        value: { id: "production-data", label: "the staging pool dashboard" },
      }),
    ).toEqual({ id: REDACTED, label: REDACTED });
  });

  it("mints a kebab-case synthetic id for a capability-shaped object, never the literal '[REDACTED]'", () => {
    // `SourceCapability.id` (`../../../route/profile.ts`) is regex-constrained to `^[a-z0-9]+(?:-[a-z0-9]+)*$`,
    // which the literal REDACTED marker fails outright — a brief carrying capabilities could never be frozen.
    // `sourceClass` sits only on this exact shape, so its presence is what tells this `id` apart from every
    // other one in the document.
    const result = redactFixtureValue({
      denylist: NO_DENYLIST,
      home: HOME,
      ids: ids(),
      key: undefined,
      value: { id: "telemetry", owner: "the merge queue team", sourceClass: "atlas" },
    }) as { id: string; owner: string; sourceClass: string };
    expect(result.id).not.toBe(REDACTED);
    expect(result.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(result.owner).toBe(REDACTED);
    // `sourceClass` is its own allowlisted key (an enum, not free prose) — unaffected by this fix.
    expect(result.sourceClass).toBe("atlas");
  });

  it("maps the same real capability id to the same synthetic id everywhere it appears", () => {
    const map = ids();
    const first = redactFixtureValue({
      denylist: NO_DENYLIST,
      home: HOME,
      ids: map,
      key: undefined,
      value: { id: "telemetry", sourceClass: "atlas" },
    }) as { id: string };
    const second = redactFixtureValue({
      denylist: NO_DENYLIST,
      home: HOME,
      ids: map,
      key: undefined,
      value: { id: "telemetry", sourceClass: "provider" },
    }) as { id: string };
    expect(second.id).toBe(first.id);
  });
});

describe("a frozen checkpoint log stays joinable to the drafts beside it", () => {
  it("keeps every field a replay needs to open the file a row names", () => {
    const row = {
      answerDigest: "sha256:c73ef2b79c4214d0dc564aea9d73741f122711bbfa2b021e9954d3854cd9e481",
      draftFile: "draft-sha256-c73ef2b7.json",
      leaseExpiresAt: "2026-09-10T15:00:00.000Z",
      recordedAtIso: "2026-09-10T13:40:00.000Z",
      schemaVersion: 1,
    };

    const frozen = redactFixtureValue({
      denylist: NO_DENYLIST,
      home: HOME,
      ids: ids(),
      key: undefined,
      value: row,
    }) as typeof row;

    expect(frozen.draftFile).toBe("draft-sha256-c73ef2b7.json");
    expect(frozen.recordedAtIso).toBe("2026-09-10T13:40:00.000Z");
    expect(frozen.answerDigest).toBe(row.answerDigest);
    expect(frozen.leaseExpiresAt).toBe("2026-09-10T15:00:00.000Z");
  });

  it("still blanks a field beside them that the allowlist does not name", () => {
    const frozen = redactFixtureValue({
      denylist: NO_DENYLIST,
      home: HOME,
      ids: ids(),
      key: undefined,
      value: { draftFile: "draft-sha256-aaaa.json", note: "the mailbox this thread was about" },
    }) as { draftFile: string; note: string };

    expect(frozen.draftFile).toBe("draft-sha256-aaaa.json");
    expect(frozen.note).toBe(REDACTED);
  });

  it("keeps the four verdict enums a replay reads, and blanks the prose beside them", () => {
    const frozen = redactFixtureValue({
      denylist: NO_DENYLIST,
      home: HOME,
      ids: ids(),
      key: undefined,
      value: {
        claims: [{ evidence: "read the whole thread", impact: "high", support: "unsupported", text: "a claim" }],
        outcome: "broken",
      },
    }) as { claims: readonly Record<string, string>[]; outcome: string };

    expect(frozen.outcome).toBe("broken");
    expect(frozen.claims[0]!["impact"]).toBe("high");
    expect(frozen.claims[0]!["support"]).toBe("unsupported");
    expect(frozen.claims[0]!["text"]).toBe(REDACTED);
    expect(frozen.claims[0]!["evidence"]).toBe(REDACTED);
  });
});
