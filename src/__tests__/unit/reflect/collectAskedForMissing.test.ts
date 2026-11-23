import { describe, expect, it } from "vitest";

import {
  ABSENCE_MARKERS,
  looksLikeAbsence,
  type ReflectOwnerJudgement,
} from "../../../reflect/askedForMissingHeuristics.js";
import { ASKED_FOR_MISSING_UNREAD_NOTICE, collectAskedForMissing } from "../../../reflect/collectAskedForMissing.js";
import type { ReflectWindow, SubstrateReader } from "../../../reflect/substrate.js";

const window: ReflectWindow = { fromIso: "2026-08-27T00:00:00.000Z", toIso: "2026-08-28T00:00:00.000Z" };

/** An in-memory filesystem, the same fake every other reflect collector test uses — not a mock. */
const fakeReader = ({ files }: { files: Readonly<Record<string, string>> }): SubstrateReader => ({
  listNames: (dir) =>
    [
      ...new Set(
        Object.keys(files)
          .filter((path) => path.startsWith(`${dir}/`))
          .map((path) => path.slice(dir.length + 1).split("/")[0]!),
      ),
    ].toSorted((a, b) => a.localeCompare(b)),
  readText: (path) => files[path],
});

const paths = {
  feedbackDraftsDir: "/drafts",
  loopBreakageLedger: "/ledgers/loop-breakage.jsonl",
  runsDir: "/runs",
  sessionLogPath: "/sessions/sessions.jsonl",
};

const NO_DIRECTIVES: ReflectOwnerJudgement = { directives: [], kind: "loaded" };

const collect = ({
  files,
  ownerJudgement = NO_DIRECTIVES,
}: {
  files: Readonly<Record<string, string>>;
  ownerJudgement?: ReflectOwnerJudgement;
}) => collectAskedForMissing({ ...paths, ownerJudgement, reader: fakeReader({ files }), window });

const notedLine = ({ note, sessionKey, tsIso }: { note: string; sessionKey: string; tsIso: string }): string =>
  JSON.stringify({ kind: "noted", note, schemaVersion: 1, sessionKey, tsIso });

const draft = ({ created, title, type }: { created: string; title: string; type: string }): string =>
  JSON.stringify({ created_at: created, title, type });

const journalAsk = ({ atIso, kind, text }: { atIso: string; kind: "answered" | "question"; text: string }): string =>
  JSON.stringify(kind === "question" ? { atIso, kind, question: text } : { atIso, answer: text, kind });

const breakageLine = ({
  at,
  what,
  error,
  didInstead,
}: {
  at: string;
  what: string;
  error: string;
  didInstead?: string;
}): string => JSON.stringify({ at, didInstead, error, what });

const loaded = ({
  directiveText,
  modified,
}: {
  directiveText: string;
  modified: string | null;
}): ReflectOwnerJudgement => ({
  directives: [
    {
      id: "d1",
      source: { contentHash: `sha256:${"a".repeat(64)}`, file: "some-memory.md", modified },
      text: directiveText,
    },
  ],
  kind: "loaded",
});

describe("looksLikeAbsence", () => {
  it("has at least one entry in ABSENCE_MARKERS, so the guards below are not vacuously green", () => {
    expect(ABSENCE_MARKERS.length).toBeGreaterThan(0);
  });

  it("matches every marker it declares", () => {
    for (const marker of ABSENCE_MARKERS) {
      expect(looksLikeAbsence({ text: `some prose containing ${marker} in it` })).toBe(true);
    }
  });

  it("does not match ordinary prose", () => {
    expect(looksLikeAbsence({ text: "landed the PR, all checks green" })).toBe(false);
  });
});

describe("collectAskedForMissing", () => {
  it("carries the standing notice about the two unread sources on every run", () => {
    const reading = collect({ files: {} });
    expect(reading.residue).toContain(ASKED_FOR_MISSING_UNREAD_NOTICE);
  });

  it("names a loop-breakage row without needing an absence marker", () => {
    const reading = collect({
      files: {
        "/ledgers/loop-breakage.jsonl": breakageLine({
          at: "2026-08-27T01:00:00.000Z",
          didInstead: "used the browser lane instead",
          error: "slack does not serve transcript bytes to a bot token",
          what: "fetch a huddle transcript's bytes via the API",
        }),
      },
    });
    const finding = reading.findings.find((one) => one.locus === "loop-breakage")!;
    expect(finding.occurrences).toBe(1);
    expect(finding.safety).toBe(5);
    expect(finding.evidence[0]).toContain("did instead");
  });

  it("groups two loop-breakage rows describing the same defect into one finding", () => {
    const reading = collect({
      files: {
        "/ledgers/loop-breakage.jsonl": [
          breakageLine({
            at: "2026-08-27T01:00:00.000Z",
            error: "the successor would be booted into the same stale worktree",
            what: "session respawn scheduler",
          }),
          breakageLine({
            at: "2026-08-27T02:00:00.000Z",
            error: "the successor would be booted into the same stale worktree",
            what: "session respawn scheduler",
          }),
        ].join("\n"),
      },
    });
    const findings = reading.findings.filter((one) => one.locus === "loop-breakage");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.occurrences).toBe(2);
  });

  it("reports a loop-breakage line that did not decode as residue rather than dropping it", () => {
    const reading = collect({ files: { "/ledgers/loop-breakage.jsonl": "{not json" } });
    expect(reading.residue.some((line) => line.includes("did not decode"))).toBe(true);
  });

  it("names a SendFeedback draft filed as missing_capability", () => {
    const reading = collect({
      files: {
        "/drafts/a.json": draft({
          created: "2026-08-27T01:00:00.000Z",
          title: "no verb to edit a Slack message as the owner",
          type: "missing_capability",
        }),
      },
    });
    const finding = reading.findings.find((one) => one.locus === "SendFeedback missing_capability")!;
    expect(finding.occurrences).toBe(1);
    expect(finding.safety).toBe(5);
  });

  it("ignores a draft of any other type", () => {
    const reading = collect({
      files: {
        "/drafts/a.json": draft({ created: "2026-08-27T01:00:00.000Z", title: "unrelated bug", type: "bug" }),
      },
    });
    expect(reading.findings.some((one) => one.locus === "SendFeedback missing_capability")).toBe(false);
  });

  it("names a session note that reports a trap", () => {
    const reading = collect({
      files: {
        "/sessions/sessions.jsonl": notedLine({
          note: "TRAP: as-me edit claimed to work but the message was never changed",
          sessionKey: "as-me-verbs",
          tsIso: "2026-08-27T02:00:00.000Z",
        }),
      },
    });
    const finding = reading.findings.find((one) => one.locus === "session note")!;
    expect(finding.occurrences).toBe(1);
    expect(finding.evidence[0]).toContain("as-me-verbs");
  });

  it("ignores a session note with nothing to flag", () => {
    const reading = collect({
      files: {
        "/sessions/sessions.jsonl": notedLine({
          note: "landed the PR, all checks green",
          sessionKey: "some-session",
          tsIso: "2026-08-27T02:00:00.000Z",
        }),
      },
    });
    expect(reading.findings.some((one) => one.locus === "session note")).toBe(false);
    expect(reading.rowsRead).toBeGreaterThan(0);
  });

  it("names a run-journal question that reports a missing verb", () => {
    const reading = collect({
      files: {
        "/runs/some-doc.jsonl": journalAsk({
          atIso: "2026-08-27T03:00:00.000Z",
          kind: "question",
          text: "there is no such thing as a notion write verb on this installation, how should this publish",
        }),
      },
    });
    const finding = reading.findings.find((one) => one.locus === "handover question")!;
    expect(finding.evidence[0]).toContain("some-doc");
  });

  it("names an owner directive written because a capability turned out missing", () => {
    const reading = collect({
      files: {},
      ownerJudgement: loaded({
        directiveText: "there is no way to attach media through the door yet, never claim otherwise",
        modified: "2026-08-27T04:00:00.000Z",
      }),
    });
    const finding = reading.findings.find((one) => one.locus === "owner directive")!;
    expect(finding.evidence[0]).toContain("d1");
  });

  it("skips a directive with no modified timestamp rather than always including it", () => {
    const reading = collect({
      files: {},
      ownerJudgement: loaded({ directiveText: "there is no way to attach media through the door yet", modified: null }),
    });
    expect(reading.findings.some((one) => one.locus === "owner directive")).toBe(false);
  });

  it("skips a directive outside the window", () => {
    const reading = collect({
      files: {},
      ownerJudgement: loaded({
        directiveText: "there is no way to attach media through the door yet",
        modified: "2026-08-01T04:00:00.000Z",
      }),
    });
    expect(reading.findings.some((one) => one.locus === "owner directive")).toBe(false);
  });

  it("reports an owner-judgement store that could not be read as residue, never as no directives", () => {
    const reading = collect({ files: {}, ownerJudgement: { kind: "unavailable", why: "connection refused" } });
    expect(reading.residue).toContain("the owner directives could not be read from the store: connection refused");
    expect(reading.findings.some((one) => one.locus === "owner directive")).toBe(false);
  });

  it("reads an entirely absent installation as a quiet day, not a broken one", () => {
    const reading = collect({ files: {} });
    expect(reading.findings).toStrictEqual([]);
    expect(reading.rowsRead).toBe(0);
  });
});
