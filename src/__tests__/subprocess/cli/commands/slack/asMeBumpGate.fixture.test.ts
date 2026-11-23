/**
 * Proves the SHIPPED `bin/slopweaver slack post|edit --as me` binary refuses an untagged bump — not just the
 * pure `bumpRefusalFor` unit — on a completely bare `$HOME` (no corpus, no derived roster, no store selected),
 * because the whole point of the gate is that it fires before any of that machinery matters. `HOME` and `PATH`
 * are the only inherited environment; `SLACK_USER_TOKEN` is a shape-only fake, same convention as
 * `../connect/fixture.test.ts`. `--dry-run` sends nothing; the one read it makes is the live departed-tag check
 * on a message that resolves a mention, which that fake token cannot pass.
 *
 * Two checks meet on the same message and this fixture keeps them apart. The bump gate asks whether a
 * `<@U…>` TOKEN is present, and the mention check asks whether that id names anybody. A bare `$HOME` can
 * answer the first and never the second, so the raw-mention case here proves the gate passed while the
 * second refused, and the case below it writes a retired `identity.json` naming the id and watches the send
 * still refuse on the store, never falling back to the file.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const FAKE_USER_TOKEN = "xoxp-test";

let isolatedHome: string;
beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "slop-asme-bump-fixture-home-"));
});
afterEach(() => {
  rmSync(isolatedHome, { force: true, recursive: true });
});

/** Run the shipped binary with a minimal, isolated environment and a piece of stdin. */
function runSlack({ args, stdin }: { args: readonly string[]; stdin: string }): {
  status: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync(BIN, args, {
      cwd: isolatedHome,
      encoding: "utf8",
      env: { HOME: isolatedHome, PATH: process.env["PATH"]!, SLACK_USER_TOKEN: FAKE_USER_TOKEN },
      input: stdin,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    // A non-zero exit here always carries these — execFileSync sets them whenever the subprocess actually
    // ran with `encoding` given; an undefined status/stdout/stderr would mean it never spawned at all, a
    // different failure this test isn't exercising.
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

/**
 * A minimal `profile.json`, so a send that passes every gate under test is not then refused for a home that
 * cannot say which channels are high-stakes (`src/outbound/slack/highStakesChannel.ts`).
 */
function seedProfile(): void {
  mkdirSync(join(isolatedHome, ".slopweaver"), { recursive: true });
  writeFileSync(
    join(isolatedHome, ".slopweaver", "profile.json"),
    JSON.stringify({ displayName: "Ada Owner", gitNamespace: "ada-gh", id: "owner-1", schemaVersion: 1, sources: [] }),
  );
}

describe("bin/slopweaver slack post|edit --as me — the bump gate", () => {
  it("refuses a bump with no resolved mention, on a bare $HOME with no roster at all", { timeout: 30_000 }, () => {
    const result = runSlack({
      args: ["slack", "post", "--as", "me", "--channel", "C1", "--shape", "top-level", "--body", "-", "--dry-run"],
      stdin: "just bumping this — any update?\n",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("blocked because the message reads as a chase");
    expect(result.stderr).toContain("carries no resolved `<@U…>` mention");
    expect(result.stdout).toBe("");
  });

  it("passes the bump GATE with a raw <@U…>, and is then refused because no store can say who holds that id", () => {
    const result = runSlack({
      args: ["slack", "post", "--as", "me", "--channel", "C1", "--shape", "top-level", "--body", "-", "--dry-run"],
      stdin: "just bumping this <@U0JONAH> — any update?\n",
    });
    expect(result.status).toBe(2);
    // The bump gate is satisfied — its own refusal is gone — and a SECOND check takes over. That split is
    // the point: a `<@U…>` token is syntax, and on a bare $HOME, which selects no store, the identity roster
    // cannot vouch for this one, so the send stops rather than resolving against the layers it could read.
    expect(result.stderr).not.toContain("blocked because the message reads as a chase");
    expect(result.stderr).toContain("this install keeps its identity roster in the store");
    expect(result.stdout).toBe("");
  });

  // The retired `identity.json` vouching for the id changes nothing: the store is the authority, so with no store
  // selected the send refuses on the outage and never reads the file in its place. The witness is the line the
  // file WOULD have reached — the live departed-tag read (`src/outbound/slack/departedTags.ts`), which runs only
  // once the mention check passes.
  it(
    "never reads a retired identity.json in place of the store, even when it names that id",
    {
      timeout: 30_000,
    },
    () => {
      seedProfile();
      mkdirSync(join(isolatedHome, ".slopweaver"), { recursive: true });
      writeFileSync(
        join(isolatedHome, ".slopweaver", "identity.json"),
        JSON.stringify([
          {
            handle: "jonah-example",
            id: "person-jonah",
            identities: [{ nativeId: "U0JONAH", source: "slack" }],
            name: "Jonah Example",
          },
        ]),
      );

      const result = runSlack({
        args: ["slack", "post", "--as", "me", "--channel", "C1", "--shape", "top-level", "--body", "-", "--dry-run"],
        stdin: "just bumping this <@U0JONAH> — any update?\n",
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("this install keeps its identity roster in the store");
      expect(result.stderr).not.toContain("could not read <@U0JONAH> off Slack's live roster");
      expect(result.stdout).toBe("");
    },
  );

  it("refuses the same shape on `edit --as me`", { timeout: 30_000 }, () => {
    const result = runSlack({
      args: ["slack", "edit", "--as", "me", "--channel", "C1", "--ts", "1712345678.000100", "--body", "-", "--dry-run"],
      stdin: "just bumping this — any update?\n",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("blocked because the message reads as a chase");
  });

  it("does not touch a message that is not a chase, even with no mention at all", { timeout: 30_000 }, () => {
    seedProfile();
    const result = runSlack({
      args: ["slack", "post", "--as", "me", "--channel", "C1", "--shape", "top-level", "--body", "-", "--dry-run"],
      stdin: "shipped the retry fix, staging looked clean overnight\n",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dry run — nothing was sent.");
  });

  it("refuses the same message to a channel from a home with no profile.json, and still sends it to a DM", () => {
    const toChannel = runSlack({
      args: ["slack", "post", "--as", "me", "--channel", "C1", "--shape", "top-level", "--body", "-", "--dry-run"],
      stdin: "shipped the retry fix, staging looked clean overnight\n",
    });
    expect(toChannel.status).toBe(2);
    expect(toChannel.stderr).toContain("holds no profile.json, so it cannot say which channels are high-stakes");
    expect(toChannel.stdout).toBe("");
    const toDm = runSlack({
      args: [
        "slack",
        "post",
        "--as",
        "me",
        "--channel",
        "D0SYNOWNERDM",
        "--shape",
        "top-level",
        "--body",
        "-",
        "--dry-run",
      ],
      stdin: "shipped the retry fix, staging looked clean overnight\n",
    });
    expect(toDm.status).toBe(0);
    expect(toDm.stdout).toContain("dry run — nothing was sent.");
  });
});
