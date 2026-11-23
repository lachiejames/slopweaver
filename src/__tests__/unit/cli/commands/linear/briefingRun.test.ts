import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  briefingBundleWrites,
  parseLinearBriefingArgs,
  staleFormNames,
} from "../../../../../cli/commands/linear/briefingCore.js";
import {
  appliedRecordVerdict,
  briefingFloor,
  compareInstants,
} from "../../../../../cli/commands/linear/briefingFloor.js";
import { type LinearBriefingDeps, runLinearBriefing } from "../../../../../cli/commands/linear/briefingRun.js";
import { linearVerbErrorLines } from "../../../../../cli/commands/linear/errors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { BRIEFING } from "../../../outbound/linear/briefingFixture.js";
import { witnessesFor, YESTERDAY, YESTERDAY_STEPS } from "./briefingYesterdayFixture.js";

const ARGV_HEAD = ["node", "slopweaver", "linear", "briefing"];
const BUILD = [...ARGV_HEAD, "build", "--form", "-", "--out", "bundle"];

let dir: string;

/** Write yesterday's whole bundle into a sibling directory, as `build` did, plus the record its apply-all left. */
function appliedBundle({ witnesses }: { witnesses: Record<string, string> }): void {
  const outDir = join(dir, "2026-10-25");
  for (const write of briefingBundleWrites({ form: YESTERDAY, outDir }).writes) {
    mkdirSync(join(write.path, ".."), { recursive: true });
    writeFileSync(write.path, write.contents);
  }
  writeFileSync(join(outDir, "applied-all.json"), `${JSON.stringify({ asOfIso: YESTERDAY.asOfIso, witnesses })}\n`);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "briefing-"));
  appliedBundle({ witnesses: witnessesFor({ files: YESTERDAY_STEPS }) });
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Plain fake edges: the form text comes from the test, output is collected. */
function fakeDeps({ form }: { form: string }): { deps: LinearBriefingDeps; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    deps: {
      cwd: () => dir,
      err: (line) => err.push(line),
      out: (line) => out.push(line),
      readForm: () => form,
    },
    err,
    out,
  };
}

describe("parseLinearBriefingArgs", () => {
  it("resolves a relative --out against the working directory", () => {
    const args = unwrap(parseLinearBriefingArgs({ argv: ["build", "--form", "-", "--out", "b"], cwd: "/work" }));

    expect(args.outDir).toBe("/work/b");
  });

  it("normalises an absolute --out, so a trailing /. still finds its siblings one level up", () => {
    const args = unwrap(
      parseLinearBriefingArgs({ argv: ["build", "--form", "-", "--out", "/lb/2026-10-26/."], cwd: "/work" }),
    );

    expect(args.outDir).toBe("/lb/2026-10-26");
  });

  it("refuses a missing --out by name", () => {
    const parsed = parseLinearBriefingArgs({ argv: ["build", "--form", "-"], cwd: "/work" });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "--out <dir> is required: the bundle directory",
    ]);
  });
});

describe("staleFormNames", () => {
  it("removes only a numbered form this briefing does not write", () => {
    const stale = staleFormNames({
      keep: new Set(["01-a-move.json"]),
      present: ["01-a-move.json", "02-b-comment.json", "notes.txt"],
    });

    expect(stale).toEqual(["02-b-comment.json"]);
  });

  it("removes a numbered form of any digit count, the 100th proposal's three included", () => {
    expect(staleFormNames({ keep: new Set(), present: ["100-a-comment.json", "1-x.json", "x-1.json"] })).toEqual([
      "100-a-comment.json",
      "1-x.json",
    ]);
  });
});

describe("briefingFloor", () => {
  it("is the newest fully applied instant, whatever order the bundles are read in", () => {
    const floor = briefingFloor({ applied: ["2026-10-24T06:30:00Z", "2026-10-25T06:30:00Z", "2026-10-23T06:30:00Z"] });

    expect(floor).toBe("2026-10-25T06:30:00Z");
  });

  it("is null when no briefing was ever applied in full", () => {
    expect(briefingFloor({ applied: [] })).toBe(null);
  });

  it("orders past the millisecond Date.parse truncates to, in either reading order", () => {
    const older = "2026-10-25T06:30:00.0001Z";
    const newer = "2026-10-25T06:30:00.0002Z";

    expect(briefingFloor({ applied: [older, newer] })).toBe(newer);
    expect(briefingFloor({ applied: [newer, older] })).toBe(newer);
  });

  it("picks one text for one instant written in two offsets, in either reading order", () => {
    const utc = "2026-10-25T06:30:00Z";
    const sydney = "2026-10-25T17:30:00+11:00";

    expect(briefingFloor({ applied: [utc, sydney] })).toBe(sydney);
    expect(briefingFloor({ applied: [sydney, utc] })).toBe(sydney);
  });
});

describe("compareInstants", () => {
  it("orders a shorter fraction against a longer one by value", () => {
    expect(compareInstants({ a: "2026-10-25T06:30:00.0001Z", b: "2026-10-25T06:30:00.000Z" })).toBe(1);
  });

  it("is zero only for identical text", () => {
    expect(compareInstants({ a: "2026-10-25T06:30:00Z", b: "2026-10-25T06:30:00Z" })).toBe(0);
  });
});

describe("appliedRecordVerdict", () => {
  const writes = briefingBundleWrites({ form: YESTERDAY, outDir: "/b" }).writes;
  const apply = writes.find((write) => write.path === "/b/apply.json")!.contents;
  const briefing = writes.find((write) => write.path === "/b/briefing.json")!.contents;
  const forms: Readonly<Record<string, string | undefined>> = Object.fromEntries(
    writes
      .filter((write) => write.path.startsWith("/b/forms/"))
      .map((write) => [write.path.slice("/b/".length), write.contents]),
  );
  /** A record's text. */
  const record = ({ asOfIso, files }: { asOfIso: string; files: readonly string[] }): string =>
    JSON.stringify({ asOfIso, witnesses: witnessesFor({ files }) });

  it("moves the floor to the bundle's own instant when every planned step has a witness", () => {
    const verdict = appliedRecordVerdict({
      applied: record({ asOfIso: YESTERDAY.asOfIso, files: YESTERDAY_STEPS }),
      apply,
      briefing,
      bundleDir: "/b",
      forms,
    });

    expect(verdict).toEqual({ asOfIso: "2026-10-25T06:30:00Z", kind: "applied" });
  });

  it("refuses a partly applied briefing that names only the write that landed", () => {
    const verdict = appliedRecordVerdict({
      applied: record({ asOfIso: YESTERDAY.asOfIso, files: YESTERDAY_STEPS.slice(0, 1) }),
      apply,
      briefing,
      bundleDir: "/b",
      forms,
    });

    expect(verdict).toEqual({
      kind: "refused",
      problems: [`no witness for 5 step(s): ${YESTERDAY_STEPS.slice(1).join(", ")}`],
    });
  });

  it("refuses a record claiming another briefing's instant, or a step that was never planned", () => {
    const verdict = appliedRecordVerdict({
      applied: record({ asOfIso: "2026-10-26T06:30:00Z", files: [...YESTERDAY_STEPS, "forms/09-made-up.json"] }),
      apply,
      briefing,
      bundleDir: "/b",
      forms,
    });

    expect(verdict).toEqual({
      kind: "refused",
      problems: [
        "it records asOfIso 2026-10-26T06:30:00Z, but its briefing is as of 2026-10-25T06:30:00Z",
        "it witnesses step(s) the briefing never planned: forms/09-made-up.json",
      ],
    });
  });

  it("refuses a plan naming one step file twice, so one witness cannot certify two writes", () => {
    const doubled = [YESTERDAY_STEPS[0]!, ...YESTERDAY_STEPS];
    const verdict = appliedRecordVerdict({
      applied: record({ asOfIso: YESTERDAY.asOfIso, files: YESTERDAY_STEPS }),
      apply: JSON.stringify({ items: [{ steps: doubled.map((file) => ({ file })) }] }),
      briefing,
      bundleDir: "/b",
      forms,
    });

    expect(verdict).toEqual({
      kind: "refused",
      problems: [
        `its apply.json plans ${doubled.join(", ")}, but its briefing.json implies ${YESTERDAY_STEPS.join(", ")}`,
      ],
    });
  });

  it("refuses an apply.json emptied by hand, which would otherwise certify a briefing with no witness at all", () => {
    const verdict = appliedRecordVerdict({
      applied: record({ asOfIso: YESTERDAY.asOfIso, files: [] }),
      apply: '{"items":[]}',
      briefing,
      bundleDir: "/b",
      forms,
    });

    expect(verdict).toEqual({
      kind: "refused",
      problems: [
        `its apply.json plans no step, but its briefing.json implies ${YESTERDAY_STEPS.join(", ")}`,
        `no witness for 6 step(s): ${YESTERDAY_STEPS.join(", ")}`,
      ],
    });
  });

  it("refuses a briefing.json that is no longer a briefing, so its plan cannot be re-derived", () => {
    const verdict = appliedRecordVerdict({
      applied: record({ asOfIso: YESTERDAY.asOfIso, files: YESTERDAY_STEPS }),
      apply,
      briefing: JSON.stringify({ asOfIso: YESTERDAY.asOfIso }),
      bundleDir: "/b",
      forms,
    });

    expect(verdict).toEqual({ kind: "refused", problems: ["its bundle has no readable briefing.json"] });
  });

  it("refuses an apply.json whose step names its file but sends a command the briefing never planned", () => {
    const plan = JSON.parse(apply) as { items: { steps: { apply: string }[] }[] };
    plan.items[0]!.steps[0]!.apply = "slopweaver linear comment create --issue ENG-999";

    const verdict = appliedRecordVerdict({
      applied: record({ asOfIso: YESTERDAY.asOfIso, files: YESTERDAY_STEPS }),
      apply: JSON.stringify(plan),
      briefing,
      bundleDir: "/b",
      forms,
    });

    expect(verdict).toEqual({
      kind: "refused",
      problems: ["its apply.json's steps differ from the ones its briefing.json plans at this bundle's directory"],
    });
  });

  it("refuses a bundle whose form no longer carries the write its briefing.json plans", () => {
    const verdict = appliedRecordVerdict({
      applied: record({ asOfIso: YESTERDAY.asOfIso, files: YESTERDAY_STEPS }),
      apply,
      briefing,
      bundleDir: "/b",
      forms: { ...forms, [YESTERDAY_STEPS[0]!]: '{"body":"a different comment"}\n' },
    });

    expect(verdict).toEqual({
      kind: "refused",
      problems: [`its form file(s) differ from the writes its briefing.json plans: ${YESTERDAY_STEPS[0]!}`],
    });
  });

  it("refuses a numbered form its briefing never planned, which build would have removed", () => {
    const verdict = appliedRecordVerdict({
      applied: record({ asOfIso: YESTERDAY.asOfIso, files: YESTERDAY_STEPS }),
      apply,
      briefing,
      bundleDir: "/b",
      forms: { ...forms, "forms/99-injected.json": "{}\n", "forms/notes.txt": "a note beside the forms\n" },
    });

    expect(verdict).toEqual({
      kind: "refused",
      problems: ["its forms/ holds numbered form(s) its briefing.json never planned: forms/99-injected.json"],
    });
  });

  it("refuses a bundle whose forms/ cannot be listed, even one that planned no form", () => {
    const empty = briefingBundleWrites({ form: { ...YESTERDAY, proposals: [] }, outDir: "/e" }).writes;
    const verdict = appliedRecordVerdict({
      applied: record({ asOfIso: YESTERDAY.asOfIso, files: [] }),
      apply: empty.find((write) => write.path === "/e/apply.json")!.contents,
      briefing: empty.find((write) => write.path === "/e/briefing.json")!.contents,
      bundleDir: "/e",
      forms: undefined,
    });

    expect(verdict).toEqual({ kind: "refused", problems: ["its bundle's forms/ cannot be listed"] });
  });

  it("refuses a numbered form it could not read, rather than leaving it out of the count", () => {
    const verdict = appliedRecordVerdict({
      applied: record({ asOfIso: YESTERDAY.asOfIso, files: YESTERDAY_STEPS }),
      apply,
      briefing,
      bundleDir: "/b",
      forms: { ...forms, "forms/99-unreadable.json": undefined },
    });

    expect(verdict).toEqual({
      kind: "refused",
      problems: ["its forms/ holds numbered form(s) its briefing.json never planned: forms/99-unreadable.json"],
    });
  });

  it("refuses a bundle judged at a directory other than the one it was built in", () => {
    const verdict = appliedRecordVerdict({
      applied: record({ asOfIso: YESTERDAY.asOfIso, files: YESTERDAY_STEPS }),
      apply,
      briefing,
      bundleDir: "/moved",
      forms,
    });

    expect(verdict).toEqual({
      kind: "refused",
      problems: ["its apply.json's steps differ from the ones its briefing.json plans at this bundle's directory"],
    });
  });

  it("refuses a witness that is not a Linear URL", () => {
    const witnesses = { ...witnessesFor({ files: YESTERDAY_STEPS }), [YESTERDAY_STEPS[0]!]: "https://example.test/x" };

    const verdict = appliedRecordVerdict({
      applied: JSON.stringify({ asOfIso: YESTERDAY.asOfIso, witnesses }),
      apply,
      briefing,
      bundleDir: "/b",
      forms,
    });

    expect(verdict).toEqual({
      kind: "refused",
      problems: ["it is not { asOfIso, witnesses: { <form file>: <url> } }"],
    });
  });

  it("refuses a record whose bundle lost its plan", () => {
    const verdict = appliedRecordVerdict({ applied: "{}", apply: undefined, briefing, bundleDir: "/b", forms });

    expect(verdict).toEqual({
      kind: "refused",
      problems: ["it is not { asOfIso, witnesses: { <form file>: <url> } }", "its bundle has no readable apply.json"],
    });
  });
});

describe("runLinearBriefing", () => {
  it("writes the whole bundle and prints every dry run", () => {
    const { deps, out } = fakeDeps({ form: JSON.stringify(BRIEFING) });

    const code = runLinearBriefing({ argv: BUILD, deps });

    const bundle = join(dir, "bundle");
    expect(code).toBe(0);
    expect(readdirSync(bundle).toSorted()).toEqual([
      "apply.json",
      "briefing.json",
      "forms",
      "on-the-owners-word.md",
      "page.html",
    ]);
    expect(readdirSync(join(bundle, "forms")).length).toBe(6);
    expect(out[0]).toBe(`linear briefing: 4 item(s), 2 high and 2 low, 6 write(s) → ${bundle}`);
    expect(out.filter((line) => line.includes("--dry-run")).length).toBe(6);
  });

  it("removes a stale form left by an earlier briefing", () => {
    mkdirSync(join(dir, "bundle", "forms"), { recursive: true });
    writeFileSync(join(dir, "bundle", "forms", "09-gone-move.json"), "{}\n");
    const { deps, out } = fakeDeps({ form: JSON.stringify(BRIEFING) });

    runLinearBriefing({ argv: BUILD, deps });

    expect(readdirSync(join(dir, "bundle", "forms"))).not.toContain("09-gone-move.json");
    expect(out).toContain("  removed 1 stale form(s): 09-gone-move.json");
  });

  it("refuses a forms/ that is a link, and neither removes nor writes anything through it", () => {
    const escape = mkdtempSync(join(tmpdir(), "briefing-escape-"));
    writeFileSync(join(escape, "09-gone-move.json"), "{}\n");
    mkdirSync(join(dir, "bundle"));
    symlinkSync(escape, join(dir, "bundle", "forms"));
    const { deps, err } = fakeDeps({ form: JSON.stringify(BRIEFING) });

    const code = runLinearBriefing({ argv: BUILD, deps });

    expect(code).toBe(1);
    expect(err[0]).toContain("is not a plain directory (a symlink or a file stands there)");
    expect(readdirSync(escape)).toEqual(["09-gone-move.json"]);
    rmSync(escape, { force: true, recursive: true });
  });

  it("refuses an invalid briefing as a usage error and writes nothing", () => {
    const { deps, err } = fakeDeps({ form: JSON.stringify({ ...BRIEFING, zone: "Mars/Olympus" }) });

    const code = runLinearBriefing({ argv: BUILD, deps });

    expect(code).toBe(2);
    expect(err).toEqual(["zone: zone is an IANA name, e.g. Australia/Melbourne"]);
    expect(existsSync(join(dir, "bundle"))).toBe(false);
  });

  it("names a held bundle whose briefing.json cannot be read, rather than crashing", () => {
    mkdirSync(join(dir, "2026-10-26", "briefing.json"), { recursive: true });
    const { deps, out } = fakeDeps({ form: JSON.stringify({ ...BRIEFING, asOfIso: "2026-10-27T06:30:00Z" }) });

    expect(runLinearBriefing({ argv: BUILD, deps })).toBe(0);
    expect(out).toContain("  carries 1 unapplied briefing(s) since the floor: 2026-10-26 (no readable briefing.json)");
  });

  it("still names a held briefing when the bundle cannot be written", () => {
    mkdirSync(join(dir, "2026-10-26"));
    mkdirSync(join(dir, "bundle"));
    writeFileSync(join(dir, "bundle", "forms"), "a file where the forms directory goes\n");
    const { deps, err } = fakeDeps({ form: JSON.stringify(BRIEFING) });

    expect(runLinearBriefing({ argv: BUILD, deps })).toBe(1);
    expect(err.at(-1)).toBe("unapplied since that floor, so re-read: 2026-10-26 (no readable briefing.json)");
  });

  it("refuses to build when the briefings beside --out cannot be listed", () => {
    const blocker = join(dir, "not-a-directory");
    writeFileSync(blocker, "a file\n");
    const { deps, err } = fakeDeps({ form: JSON.stringify(BRIEFING) });

    const code = runLinearBriefing({
      argv: [...ARGV_HEAD, "build", "--form", "-", "--out", join(blocker, "bundle")],
      deps,
    });

    expect(code).toBe(1);
    expect(err[0]).toContain(`could not list the briefings beside ${join(blocker, "bundle")}`);
  });

  it("follows a sibling bundle that is a link to a directory, so its full apply still sets the floor", () => {
    const archive = mkdtempSync(join(tmpdir(), "archive-"));
    try {
      renameSync(join(dir, "2026-10-25"), join(archive, "applied"));
      symlinkSync(join(archive, "applied"), join(dir, "2026-10-25"));
      const { deps, err } = fakeDeps({ form: JSON.stringify(BRIEFING) });

      expect(runLinearBriefing({ argv: BUILD, deps })).toBe(0);
      expect(err).toEqual([]);
    } finally {
      rmSync(archive, { force: true, recursive: true });
    }
  });

  it("never takes the bundle being built as its own floor when --out names it by another path", () => {
    symlinkSync(join(dir, "2026-10-25"), join(dir, "alias"));
    const { deps, err } = fakeDeps({ form: JSON.stringify(BRIEFING) });

    expect(runLinearBriefing({ argv: [...ARGV_HEAD, "build", "--form", "-", "--out", "alias"], deps })).toBe(2);
    expect(err[0]).toContain("evidenceSinceIso must be null");
  });

  it("names a sibling link that resolves to nothing as an unreadable held bundle", () => {
    symlinkSync(join(dir, "nowhere"), join(dir, "2026-10-26"));
    const { deps, out } = fakeDeps({ form: JSON.stringify({ ...BRIEFING, asOfIso: "2026-10-27T06:30:00Z" }) });

    expect(runLinearBriefing({ argv: BUILD, deps })).toBe(0);
    expect(out).toContain("  carries 1 unapplied briefing(s) since the floor: 2026-10-26 (no readable briefing.json)");
  });

  it("lets an empty briefing with no forms/ set the floor, but never one whose forms/ is a dangling link", () => {
    const applied = join(dir, "2026-10-25");
    rmSync(applied, { force: true, recursive: true });
    for (const write of briefingBundleWrites({ form: { ...YESTERDAY, proposals: [] }, outDir: applied }).writes) {
      mkdirSync(join(write.path, ".."), { recursive: true });
      writeFileSync(write.path, write.contents);
    }
    writeFileSync(join(applied, "applied-all.json"), JSON.stringify({ asOfIso: YESTERDAY.asOfIso, witnesses: {} }));
    const absent = fakeDeps({ form: JSON.stringify(BRIEFING) });

    expect(runLinearBriefing({ argv: BUILD, deps: absent.deps })).toBe(0);

    symlinkSync(join(dir, "nowhere"), join(applied, "forms"));
    const dangling = fakeDeps({ form: JSON.stringify(BRIEFING) });

    expect(runLinearBriefing({ argv: BUILD, deps: dangling.deps })).toBe(2);
    expect(dangling.err).toContain("  its bundle's forms/ cannot be listed");
  });

  it("names a held briefing composed at the floor's own instant", () => {
    const held = join(dir, "2026-10-25-b");
    for (const write of briefingBundleWrites({ form: YESTERDAY, outDir: held }).writes) {
      mkdirSync(join(write.path, ".."), { recursive: true });
      writeFileSync(write.path, write.contents);
    }
    const { deps, out } = fakeDeps({ form: JSON.stringify(BRIEFING) });

    expect(runLinearBriefing({ argv: BUILD, deps })).toBe(0);
    expect(out).toContain("  carries 1 unapplied briefing(s) since the floor: 2026-10-25-b");
  });

  it("still names a held briefing when the form itself is refused", () => {
    mkdirSync(join(dir, "2026-10-26"));
    const { deps, err } = fakeDeps({ form: JSON.stringify({ ...BRIEFING, zone: "Mars/Olympus" }) });

    expect(runLinearBriefing({ argv: BUILD, deps })).toBe(2);
    expect(err).toEqual([
      "zone: zone is an IANA name, e.g. Australia/Melbourne",
      "unapplied since that floor, so re-read: 2026-10-26 (no readable briefing.json)",
    ]);
  });

  it("names each held briefing since the floor that this one carries forward", () => {
    const held = join(dir, "2026-10-26");
    for (const write of briefingBundleWrites({ form: { ...BRIEFING, asOfIso: "2026-10-26T06:30:00Z" }, outDir: held })
      .writes) {
      mkdirSync(join(write.path, ".."), { recursive: true });
      writeFileSync(write.path, write.contents);
    }
    const { deps, out } = fakeDeps({ form: JSON.stringify({ ...BRIEFING, asOfIso: "2026-10-27T06:30:00Z" }) });

    runLinearBriefing({ argv: BUILD, deps });

    expect(out).toContain("  carries 1 unapplied briefing(s) since the floor: 2026-10-26");
  });

  it("names an interrupted bundle with no readable briefing.json, which has no instant to place", () => {
    mkdirSync(join(dir, "2026-10-26"));
    writeFileSync(join(dir, "2026-10-26", "apply.json"), '{"items":[]}\n');
    const { deps, out } = fakeDeps({ form: JSON.stringify({ ...BRIEFING, asOfIso: "2026-10-27T06:30:00Z" }) });

    expect(runLinearBriefing({ argv: BUILD, deps })).toBe(0);
    expect(out).toContain("  carries 1 unapplied briefing(s) since the floor: 2026-10-26 (no readable briefing.json)");
  });

  it("refuses a floor moved past a held briefing, names that briefing, and writes nothing", () => {
    const held = join(dir, "2026-10-26");
    for (const write of briefingBundleWrites({ form: { ...BRIEFING, asOfIso: "2026-10-26T06:30:00Z" }, outDir: held })
      .writes) {
      mkdirSync(join(write.path, ".."), { recursive: true });
      writeFileSync(write.path, write.contents);
    }
    const { deps, err } = fakeDeps({
      form: JSON.stringify({ ...BRIEFING, asOfIso: "2026-10-27T06:30:00Z", evidenceSinceIso: "2026-10-26T06:30:00Z" }),
    });

    const code = runLinearBriefing({ argv: BUILD, deps });

    expect(code).toBe(2);
    expect(err).toEqual([
      'evidenceSinceIso: evidenceSinceIso must be "2026-10-25T06:30:00Z", the asOfIso of the newest ' +
        "applied-all.json beside this bundle — only a fully landed apply-all moves the floor",
      "unapplied since that floor, so re-read: 2026-10-26",
    ]);
    expect(existsSync(join(dir, "bundle"))).toBe(false);
  });

  it("refuses the floor's instant spelled another way, because the floor is copied, never re-spelled", () => {
    const { deps } = fakeDeps({ form: JSON.stringify({ ...BRIEFING, evidenceSinceIso: "2026-10-25T07:30:00+01:00" }) });

    expect(runLinearBriefing({ argv: BUILD, deps })).toBe(2);
  });

  it("reads the whole corpus when no briefing was ever applied in full", () => {
    rmSync(join(dir, "2026-10-25"), { force: true, recursive: true });
    const { deps } = fakeDeps({ form: JSON.stringify({ ...BRIEFING, evidenceSinceIso: null }) });

    expect(runLinearBriefing({ argv: BUILD, deps })).toBe(0);
  });

  it("refuses a floor when no briefing was ever applied in full", () => {
    rmSync(join(dir, "2026-10-25"), { force: true, recursive: true });
    const { deps, err } = fakeDeps({ form: JSON.stringify(BRIEFING) });

    const code = runLinearBriefing({ argv: BUILD, deps });

    expect(code).toBe(2);
    expect(err).toEqual([
      "evidenceSinceIso: evidenceSinceIso must be null: no bundle beside this one certifies a full apply, so " +
        "the whole corpus is read — only a fully landed apply-all moves the floor",
    ]);
  });

  it("names a partly applied briefing's record and never lets it move the floor", () => {
    appliedBundle({ witnesses: witnessesFor({ files: YESTERDAY_STEPS.slice(0, 1) }) });
    const { deps, err } = fakeDeps({ form: JSON.stringify(BRIEFING) });

    const code = runLinearBriefing({ argv: BUILD, deps });

    expect(code).toBe(2);
    expect(err).toEqual([
      `ignored ${join(dir, "2026-10-25", "applied-all.json")}: it does not certify a full apply, so that briefing ` +
        "never moves the floor —",
      `  no witness for 5 step(s): ${YESTERDAY_STEPS.slice(1).join(", ")}`,
      "evidenceSinceIso: evidenceSinceIso must be null: no bundle beside this one certifies a full apply, so " +
        "the whole corpus is read — only a fully landed apply-all moves the floor",
      "unapplied since that floor, so re-read: 2026-10-25",
    ]);
  });

  it("keeps the older full apply's floor past a newer partial one", () => {
    const older = join(dir, "2026-10-24");
    const form = { ...YESTERDAY, asOfIso: "2026-10-24T06:30:00Z" };
    for (const write of briefingBundleWrites({ form, outDir: older }).writes) {
      mkdirSync(join(write.path, ".."), { recursive: true });
      writeFileSync(write.path, write.contents);
    }
    writeFileSync(
      join(older, "applied-all.json"),
      JSON.stringify({ asOfIso: form.asOfIso, witnesses: witnessesFor({ files: YESTERDAY_STEPS }) }),
    );
    appliedBundle({ witnesses: witnessesFor({ files: YESTERDAY_STEPS.slice(0, 1) }) });
    const { deps } = fakeDeps({ form: JSON.stringify({ ...BRIEFING, evidenceSinceIso: "2026-10-24T06:30:00Z" }) });

    expect(runLinearBriefing({ argv: BUILD, deps })).toBe(0);
  });

  it("writes the page fragment the report names", () => {
    const { deps } = fakeDeps({ form: JSON.stringify(BRIEFING) });

    runLinearBriefing({ argv: [...BUILD, "--json"], deps });

    expect(readFileSync(join(dir, "bundle", "page.html"), "utf8")).toContain("<h1>Linear briefing</h1>");
  });

  it("names the paste-in file under the owner-neutral onOwnerWord key", () => {
    const { deps, out } = fakeDeps({ form: JSON.stringify(BRIEFING) });

    runLinearBriefing({ argv: [...BUILD, "--json"], deps });

    const report = JSON.parse(out.at(-1)!) as Record<string, unknown>;
    expect(report["onOwnerWord"]).toBe(join(dir, "bundle", "on-the-owners-word.md"));
    expect(Object.keys(report).toSorted()).toEqual(["carried", "items", "onOwnerWord", "outDir", "page", "removed"]);
  });
});
