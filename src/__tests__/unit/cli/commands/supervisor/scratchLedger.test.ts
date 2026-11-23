import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendToLedger } from "../../../../../cli/commands/supervisor/scratchLedger.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import {
  LANDING_DRAFTS_READING,
  type ReadingOutcome,
  type TickReading,
  tickReadings,
} from "../../../../../supervisor/scratch/tickCapture.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scratch-ledger-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** The landing reading a sweep tick takes, as `tickReadings` declares it. */
const LANDING: TickReading = { argv: ["github", "landing", "--if-due", "--json"], format: "json", name: "landing" };

/** A recorded tick document, verbatim: the skip that stood as the latest landing for half an hour. */
const SKIP =
  '{"cadenceMinutes":30,"kind":"skipped","lastReadAtIso":"2026-10-01T14:21:40.562Z","nextDueAtIso":"2026-10-01T14:51:40.562Z","selection":"acme/acme-admin,lachiejames/slopweaver@@me","why":"acme/acme-admin,lachiejames/slopweaver@@me was read 17 minute(s) ago and the cadence is 30 minute(s), so this tick makes no GitHub request"}';

/**
 * Append `text` as the landing reading's stdout, with a ledger that answers `answer`.
 *
 * @returns the row id the append answered, what reached the ledger and every diagnostic printed
 */
function append({
  text,
  answer = ok("row-1"),
  reading = LANDING,
}: {
  text: string;
  answer?: Result<string, string>;
  reading?: TickReading;
}) {
  const path = join(root, "landing.json");
  writeFileSync(path, text);
  const recorded: { by: string; document: string; producer: string }[] = [];
  const diagnostics: string[] = [];
  const outcome: ReadingOutcome = {
    argv: reading.argv,
    bytes: Buffer.byteLength(text, "utf8"),
    child: { durationMs: 5, exitCode: 0, kind: "exited" },
    completed: true,
    errFile: "landing.err",
    exitCode: 0,
    file: "landing.json",
    name: reading.name,
  };
  const readingId = appendToLedger({
    by: "tick-865",
    deps: {
      now: () => "2026-10-01T14:39:33.213Z",
      recordReading: ({ by, document, producer }) => {
        recorded.push({ by, document, producer });
        return answer;
      },
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
    },
    home: undefined,
    outcome,
    path,
    reading,
  });
  return { diagnostics, readingId, recorded };
}

describe("appendToLedger", () => {
  it("appends a landing reading under its verb words, answering the row's id", () => {
    const appended = append({ text: '{"rows":[],"tally":{"total":0}}' });
    expect(appended.readingId).toBe("row-1");
    expect(appended.recorded).toEqual([
      { by: "tick-865", document: '{"rows":[],"tally":{"total":0}}', producer: "github landing" },
    ]);
  });

  it("never offers the drafts slice to the ledger, though it is a complete landing document", () => {
    const drafts = tickReadings({ landingRepos: ["acme/acme-admin"], loopSessionKey: "k" }).find(
      (reading) => reading.name === LANDING_DRAFTS_READING,
    )!;
    const appended = append({ reading: drafts, text: '{"rows":[],"tally":{"total":0}}' });
    expect(appended.readingId).toBeUndefined();
    expect(appended.recorded).toEqual([]);
    expect(appended.diagnostics).toEqual([]);
    // The same document from the press read IS recorded, so the slice is held out by its declaration, not its bytes.
    expect(append({ text: '{"rows":[],"tally":{"total":0}}' }).readingId).toBe("row-1");
  });

  it("never offers a cadence skip to the ledger, and says nothing about it", () => {
    const appended = append({ text: SKIP });
    expect(appended.readingId).toBeUndefined();
    expect(appended.recorded).toEqual([]);
    expect(appended.diagnostics).toEqual([]);
  });

  it("prints the ledger's own refusal as a diagnostic and answers no row", () => {
    const appended = append({ answer: err("the readings ledger is busy"), text: '{"rows":[]}' });
    expect(appended.readingId).toBeUndefined();
    expect(appended.diagnostics).toEqual([
      "supervisor tick-capture: landing was not appended to the readings ledger — the readings ledger is busy",
    ]);
  });
});
