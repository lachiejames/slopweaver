/**
 * The corpus hygiene scan rendered for the lint plan.
 *
 * Three outcomes have to be distinguishable from one line of output, because that line is all a `pre-push`
 * reader sees: a corpus that is clean, a machine that HAS no corpus, and a corpus carrying a credential. The
 * middle one is the interesting case — it is what CI, a fresh checkout and a fork all hit, and rendering it
 * as a bare `clean` would be the false green this gate exists to refuse.
 */
import { describe, expect, it } from "vitest";

import { renderCorpusHygieneGate } from "../../../hygiene/corpusGate.js";
import type { CorpusScanResult } from "../../../hygiene/corpusScan.js";

const EMPTY_ARM = { byLabel: {}, sample: [], total: 0 };

const scan = ({ over = {} }: { over?: Partial<CorpusScanResult> } = {}): CorpusScanResult => ({
  denylistLoaded: true,
  denylistWords: 8,
  filesScanned: 12,
  identifiers: EMPTY_ARM,
  leaks: [],
  linesScanned: 2226826,
  protectedSkipped: [],
  unreadable: [],
  ...over,
});

/** A synthetic no-access skip, met through a link so the line shows both spellings. */
const SKIP = {
  entry: { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: "/p/held", why: "fixture" },
  path: "/h/corpus/bronze/gmail",
};
const SKIP_LINE = "  NOT CHECKED, protected by the owner's list: /p/held [no-access] (met as /h/corpus/bronze/gmail)";

describe("renderCorpusHygieneGate", () => {
  it("says a machine with NO bronze scanned nothing, rather than reporting it clean", () => {
    const lines = renderCorpusHygieneGate({
      bronze: "/h/corpus/bronze",
      result: scan({ over: { filesScanned: 0, linesScanned: 0 } }),
    });

    expect(lines).toEqual([
      "corpus-hygiene: no bronze under /h/corpus/bronze — nothing to scan (a fresh checkout and CI have none)",
    ]);
  });

  it("reports a clean corpus in ONE line, carrying the scale and the denylist state", () => {
    const lines = renderCorpusHygieneGate({ bronze: "/h/corpus/bronze", result: scan() });

    expect(lines).toEqual([
      "corpus-hygiene: clean — 12 file(s), 2226826 record(s), 0 identifier(s), denylist 8 word(s)",
    ]);
  });

  it("names an unloaded denylist in the clean line, so a weaker run cannot look like a full one", () => {
    const lines = renderCorpusHygieneGate({
      bronze: "/h/corpus/bronze",
      result: scan({ over: { denylistLoaded: false, denylistWords: 0 } }),
    });

    expect(lines[0]).toContain("denylist NOT LOADED");
  });

  it("prints every credential LOCATION and the repair command, never the matched text", () => {
    const lines = renderCorpusHygieneGate({
      bronze: "/h/corpus/bronze",
      result: scan({
        over: {
          leaks: [{ file: "linear/compact.jsonl", label: "client-secret", line: 53422, sourceId: "CCCC-220" }],
        },
      }),
    });
    const text = lines.join("\n");

    expect(lines[0]).toContain("corpus-hygiene: FAILED");
    expect(text).toContain("linear/compact.jsonl:53422  client-secret  CCCC-220");
    expect(text).toContain("slopweaver audit hygiene --scrub");
  });

  it("fails on an unreadable file even with no credential, and names it", () => {
    const lines = renderCorpusHygieneGate({
      bronze: "/h/corpus/bronze",
      result: scan({ over: { unreadable: ["slack/compact.jsonl"] } }),
    });
    const text = lines.join("\n");

    expect(lines[0]).toContain("corpus-hygiene: FAILED");
    expect(text).toContain("NOT CHECKED, unreadable: slack/compact.jsonl");
    expect(text).not.toContain("--scrub");
  });

  it("passes a protected skip, naming it NOT CHECKED on its own line rather than claiming the whole corpus", () => {
    const lines = renderCorpusHygieneGate({
      bronze: "/h/corpus/bronze",
      result: scan({ over: { protectedSkipped: [SKIP] } }),
    });

    expect(lines).toEqual([
      "corpus-hygiene: clean over what it may read — 12 file(s), 2226826 record(s), 0 identifier(s), denylist 8 word(s)",
      SKIP_LINE,
    ]);
  });

  it("names a protected skip even when it was the only source, never reading that as no bronze at all", () => {
    const lines = renderCorpusHygieneGate({
      bronze: "/h/corpus/bronze",
      result: scan({ over: { filesScanned: 0, linesScanned: 0, protectedSkipped: [SKIP] } }),
    });

    expect(lines).toEqual([
      "corpus-hygiene: clean over what it may read — 0 file(s), 0 record(s), 0 identifier(s), denylist 8 word(s)",
      SKIP_LINE,
    ]);
  });

  it("still fails a leak beside a protected skip, and names the skip in the failing arm", () => {
    const lines = renderCorpusHygieneGate({
      bronze: "/h/corpus/bronze",
      result: scan({
        over: {
          leaks: [{ file: "linear/compact.jsonl", label: "client-secret", line: 9, sourceId: "CCCC-1" }],
          protectedSkipped: [SKIP],
        },
      }),
    });

    expect(lines[0]).toContain("corpus-hygiene: FAILED");
    expect(lines).toContain(SKIP_LINE);
  });

  it("renders a hit with no parseable sourceId as (unparsed) rather than dropping the location", () => {
    const lines = renderCorpusHygieneGate({
      bronze: "/h/corpus/bronze",
      result: scan({
        over: { leaks: [{ file: "slack/compact.jsonl", label: "slack-token", line: 7, sourceId: undefined }] },
      }),
    });

    expect(lines.join("\n")).toContain("slack/compact.jsonl:7  slack-token  (unparsed)");
  });
});
