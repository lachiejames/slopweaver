import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runOnboardWorkstreams } from "../../../cli/commands/onboard/workstreamsRun.js";
import { runWorkstreamsCandidatesPut } from "../../../cli/commands/workstreams/candidatesPut.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../cli/exitCodes.js";
import { inMemoryWorkstreamStore } from "../../workstreamStoreFake.js";
import { validCandidates } from "../workstreams/candidatesFixture.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** A throwaway home the verb reads — never the ambient home. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-onboard-ws-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

/** Put one bronze window file for a source, so it reads as pulled. */
function pulled({ home, source }: { home: string; source: string }): void {
  const directory = join(home, "corpus", "bronze", source);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "2026-01-01_2026-10-01.jsonl"), '{"id":"one"}\n');
}

/** Write the fixture candidates as a mine of Notion alone would, through the verb itself. */
function mined({ home }: { home: string }): void {
  const file = join(home, "mined.json");
  writeFileSync(file, JSON.stringify({ ...validCandidates(), minedSources: [{ recordsRead: 412, source: "notion" }] }));
  const noop = (): void => undefined;
  expect(
    runWorkstreamsCandidatesPut({
      deps: { writeDiagnostic: noop, writeOut: noop },
      rest: ["--file", file, "--home", home],
    }),
  ).toBe(EXIT_OK);
}

/** Run the verb with recording seams, in its JSON form unless `human` is set. */
async function run({ home, human = false }: { home: string; human?: boolean }): Promise<{
  exit: number;
  out: string[];
  diagnostics: string[];
}> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const exit = await runOnboardWorkstreams({
    deps: {
      store: inMemoryWorkstreamStore({ nowIso: "2026-11-10T00:00:00.000Z" }),
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    rest: human ? ["--home", home] : ["--home", home, "--json"],
  });
  return { diagnostics, exit, out };
}

/** The bytes `pulled` writes for one source. */
const ONE_FILE_BYTES = Buffer.byteLength('{"id":"one"}\n');

describe("onboard workstreams", () => {
  it("prints the pull reading with every source at zero and exits 0 in JSON on a fresh home", async () => {
    const result = await run({ home: scratch() });
    expect(result.exit).toBe(EXIT_OK);
    expect(JSON.parse(result.out[0]!)).toEqual({
      held: [
        { bytes: 0, source: "github" },
        { bytes: 0, source: "slack" },
        { bytes: 0, source: "linear" },
        { bytes: 0, source: "notion" },
        { bytes: 0, source: "gmail" },
      ],
      next: "pull one source first — Notion alone is enough to mine — then come back",
      reveal: false,
      step: "pull",
      unread: [],
    });
  });

  it("still exits 3 on a fresh home in its human form, asking for one source first", async () => {
    const result = await run({ home: scratch(), human: true });
    expect(result.exit).toBe(EXIT_EXPECTED_EMPTY);
    expect(result.out).toEqual([
      "step: pull",
      "pulled: nothing yet",
      "next: pull one source first — Notion alone is enough to mine — then come back",
    ]);
  });

  it("asks for a mine once Notion alone is pulled, before the screen is revealed", async () => {
    const home = scratch();
    pulled({ home, source: "notion" });
    const result = await run({ home });
    expect(result.exit).toBe(EXIT_OK);
    expect(JSON.parse(result.out[0]!)).toEqual({
      held: [
        { bytes: 0, source: "github" },
        { bytes: 0, source: "slack" },
        { bytes: 0, source: "linear" },
        { bytes: ONE_FILE_BYTES, source: "notion" },
        { bytes: 0, source: "gmail" },
      ],
      next: "mine notion into candidates, then write them with `workstreams candidates-put`",
      reveal: false,
      step: "mine",
      unread: ["notion"],
    });
  });

  it("sends the person to react once mined, and back to mining when another source joins", async () => {
    const home = scratch();
    pulled({ home, source: "notion" });
    mined({ home });
    expect(JSON.parse((await run({ home })).out[0]!)).toMatchObject({ reveal: true, step: "react", unread: [] });
    pulled({ home, source: "slack" });
    expect(JSON.parse((await run({ home })).out[0]!)).toMatchObject({ reveal: true, step: "mine", unread: ["slack"] });
  });

  it("refuses a candidates file that will not read, rather than calling it unmined", async () => {
    const home = scratch();
    mkdirSync(join(home, "workstreams"), { recursive: true });
    writeFileSync(join(home, "workstreams", "candidates.json"), "{ not json");
    const result = await run({ home });
    expect(result.exit).toBe(EXIT_ERROR);
    expect(result.diagnostics[0]).toContain("onboard workstreams:");
  });

  it("refuses a source whose history directory exists but cannot be listed, rather than counting it as zero", async () => {
    const home = scratch();
    pulled({ home, source: "slack" });
    const directory = join(home, "corpus", "bronze", "slack");
    chmodSync(directory, 0o000);
    cleanups.unshift(() => {
      chmodSync(directory, 0o700);
    });
    const result = await run({ home });
    expect([result.exit, result.out]).toEqual([EXIT_ERROR, []]);
    expect(result.diagnostics[0]).toContain(
      "onboard workstreams: slack's local history directory exists but cannot be listed",
    );
  });
});
