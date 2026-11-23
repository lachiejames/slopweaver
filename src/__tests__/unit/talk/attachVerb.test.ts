/**
 * `talk attach`, driven through the real runner against a home this file mints — never the ambient one, per
 * `testing.md`. The runner's exit code and what it left under `talk/attachments/` are the witness: a kept file is the
 * staged bytes exactly, and a refused or malformed call keeps nothing.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTalkAttach } from "../../../cli/commands/talk/attachRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";

let scratch: string;
let home: string;
let staged: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "talk-attach-verb-"));
  home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
  staged = join(scratch, "upload");
});

afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

const attachmentsRoot = (): string => join(home, "talk", "attachments");

/** Every file kept under the attachments root, as `<id>/<name>`. */
const keptFiles = (): readonly string[] => {
  const root = attachmentsRoot();
  const ids = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  return ids.flatMap((id) => readdirSync(join(root, id.name)).map((name) => `${id.name}/${name}`));
};

const attach = ({ name }: { name: string }): number =>
  runTalkAttach(["node", "slopweaver", "talk", "attach", "--file", staged, "--name", name, "--home", home, "--json"]);

describe("talk attach", () => {
  it("keeps the staged text file's exact bytes under the name the owner chose", () => {
    writeFileSync(staged, "the staging pool exhausted at 09:14\n", { mode: 0o600 });
    expect(attach({ name: "notes.md" })).toBe(EXIT_OK);
    const kept = keptFiles();
    expect(kept.length).toBe(1);
    expect(kept[0]!.endsWith("/notes.md")).toBe(true);
    expect(readFileSync(join(attachmentsRoot(), kept[0]!), "utf8")).toBe("the staging pool exhausted at 09:14\n");
  });

  it("exits 1 and keeps nothing for a binary file", () => {
    writeFileSync(staged, Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]), { mode: 0o600 });
    expect(attach({ name: "dump.bin" })).toBe(EXIT_ERROR);
    expect(() => readdirSync(attachmentsRoot())).toThrow("ENOENT");
  });

  it("exits with the usage code and keeps nothing when --name is missing", () => {
    writeFileSync(staged, "hello\n", { mode: 0o600 });
    const code = runTalkAttach(["node", "slopweaver", "talk", "attach", "--file", staged, "--home", home]);
    expect(code).toBe(EXIT_USAGE);
    expect(() => readdirSync(attachmentsRoot())).toThrow("ENOENT");
  });
});
