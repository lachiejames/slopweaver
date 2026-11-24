/**
 * The SHIPPED binary, `talk attach`, over a throwaway home — exactly as the console route spawns it: a kept file's
 * JSON receipt on stdout, and a refusal's code and reason on stdout too, so the page can show the owner why.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

let scratch: string;
let home: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "slop-attach-"));
  home = join(scratch, "home");
});
afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/** Run the verb over the throwaway home. */
const attach = ({ name, bytes }: { name: string; bytes: Uint8Array }): { status: number | null; stdout: string } => {
  const staged = join(scratch, "upload");
  writeFileSync(staged, bytes, { mode: 0o600 });
  const ran = spawnSync(BIN, ["talk", "attach", "--file", staged, "--name", name, "--home", home, "--json"], {
    cwd: scratch,
    encoding: "utf8",
    env: { ...accountSandboxChildEnv(), HOME: scratch, PATH: process.env["PATH"]!, SLOPWEAVER_HOME: home },
  });
  return { status: ran.status, stdout: ran.stdout };
};

describe("bin/slopweaver talk attach", () => {
  it("keeps a text file under the home and prints where", () => {
    const { status, stdout } = attach({ bytes: new TextEncoder().encode("hello\n"), name: "notes.md" });
    expect(status).toBe(0);
    const receipt = JSON.parse(stdout) as { path: string; name: string; kind: string; bytes: number };
    expect([receipt.name, receipt.kind, receipt.bytes]).toEqual(["notes.md", "text", 6]);
    expect(receipt.path.startsWith(join(home, "talk", "attachments"))).toBe(true);
    expect(readFileSync(receipt.path, "utf8")).toBe("hello\n");
  });

  it("refuses a binary file with its code and reason on stdout, and exits 1", () => {
    const { status, stdout } = attach({ bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0]), name: "deck.pdf" });
    expect(status).toBe(1);
    expect(JSON.parse(stdout)).toEqual({
      refused: {
        code: "BINARY",
        message:
          "the file is not a picture or text (it holds a NUL byte): the voice reads PNG, JPEG and WebP pictures and UTF-8 text files, not a PDF or other binary file",
      },
    });
  });
});
