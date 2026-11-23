/**
 * Each `ruling` verb body called directly, over parsed flags and plain seams: the edges the end-to-end run in
 * `rulingRun.test.ts` does not reach. Synthetic words only.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runList, runView } from "../../../../../cli/commands/ruling/read.js";
import { runRecord } from "../../../../../cli/commands/ruling/record.js";
import { runSeed } from "../../../../../cli/commands/ruling/seed.js";
import { parseRulingArgs, type RulingArgs, type RulingDeps } from "../../../../../cli/commands/ruling/shared.js";
import { unwrap } from "../../../../../lib/result.js";
import { publisherWith, recordingWriter } from "../../../../pagePublisherFake.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, its register path, fake seams, and what they printed and published. */
function harness(): {
  home: string;
  file: string;
  deps: RulingDeps;
  out: string[];
  errors: string[];
  written: ReturnType<typeof recordingWriter>["written"];
} {
  const home = mkdtempSync(join(tmpdir(), "ruling-verbs-"));
  homes.push(home);
  const out: string[] = [];
  const errors: string[] = [];
  const { writer, written } = recordingWriter();
  const deps: RulingDeps = {
    home: () => home,
    logger: {
      error: ({ msg }) => {
        errors.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
    },
    newId: () => "ruling-abcabcabcabc",
    nowIso: () => "2026-01-10T00:00:00.000Z",
    publish: publisherWith({ writer }),
  };
  return { deps, errors, file: join(home, "rulings.jsonl"), home, out, written };
}

/** One verb's flags, parsed. */
function argsOf({ verb, rest }: { verb: string; rest: readonly string[] }): RulingArgs {
  return unwrap(parseRulingArgs({ rest, verb }));
}

describe("runList", () => {
  it("says there are no current rulings in a category of an empty register", () => {
    const { deps, file, out } = harness();
    expect(runList({ args: argsOf({ rest: ["--category", "landing"], verb: "list" }), deps, file })).toBe(0);
    expect(out).toStrictEqual([`ruling: no current rulings in landing (${file})`]);
  });
});

describe("runRecord", () => {
  it("prints the filed row as one JSON object under --json", () => {
    const { deps, file, home, out } = harness();
    const rest = ["--category", "landing", "--words", "keep it", "--decided-on", "2026-01-05", "--new-category"];
    expect(runRecord({ args: argsOf({ rest: [...rest, "--json"], verb: "record" }), deps, file, home })).toBe(0);
    const printed = JSON.parse(out[0]!) as { beside: string[]; record: { id: string; words: string } };
    expect(printed.beside).toStrictEqual([]);
    expect(printed.record.id).toBe("ruling-abcabcabcabc");
    expect(printed.record.words).toBe("keep it");
  });

  it("still prints an undisposed earlier ruling when the refusal is a stale --replaces", () => {
    const { deps, file, home, errors } = harness();
    const base = ["--category", "landing", "--decided-on", "2026-01-05"];
    runRecord({
      args: argsOf({ rest: [...base, "--words", "two passes, no third", "--new-category"], verb: "record" }),
      deps,
      file,
      home,
    });
    const stale = [...base, "--words", "one pass is enough", "--replaces", "ruling-ffffffffffff"];
    expect(runRecord({ args: argsOf({ rest: stale, verb: "record" }), deps, file, home })).toBe(2);
    expect(errors).toContain("    one pass is enough");
    expect(errors).toContain("  ruling-abcabcabcabc · decided 2026-01-05");
    expect(errors).toContain("    two passes, no third");
  });

  it("refuses an impossible calendar day as usage", () => {
    const { deps, file, home, errors } = harness();
    const rest = ["--category", "landing", "--words", "keep it", "--decided-on", "2026-02-31", "--new-category"];
    expect(runRecord({ args: argsOf({ rest, verb: "record" }), deps, file, home })).toBe(2);
    expect(errors[0]).toContain("2026-02-31");
  });
});

describe("runSeed", () => {
  it("refuses --plan together with --apply", () => {
    const { deps, file, home, errors } = harness();
    const rest = ["--from", join(home, "state.md"), "--plan", "--apply"];
    expect(runSeed({ args: argsOf({ rest, verb: "seed" }), deps, file, home })).toBe(2);
    expect(errors[0]).toContain("--plan alone or --decisions with --apply");
  });

  it("reports a source document that cannot be read as an error", () => {
    const { deps, file, home, errors } = harness();
    const rest = ["--from", join(home, "absent.md"), "--plan"];
    expect(runSeed({ args: argsOf({ rest, verb: "seed" }), deps, file, home })).toBe(1);
    expect(errors[0]).toContain("absent.md");
  });
});

describe("runView", () => {
  it("reports a malformed register and publishes nothing", async () => {
    const { deps, file, home, written } = harness();
    writeFileSync(file, "not json\n");
    expect(await runView({ deps, file, home })).toBe(1);
    expect(written).toStrictEqual([]);
  });
});
