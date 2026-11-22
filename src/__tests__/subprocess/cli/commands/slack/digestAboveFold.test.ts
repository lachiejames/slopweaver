/**
 * The SHIPPED binary, `slack post --as bot --dry-run`, against an operator profile carrying the em-dash
 * voice rule for real — the seam the unit lane cannot reach.
 *
 * `digest.ts`'s derivation used to build its TL;DR and index lines with `" — "`, so EVERY digest card
 * refused at this gate regardless of what a composer authored — the layout itself was the violation, not
 * any authored prose. The unit tests call `digestToUpdate` and `aboveFoldFindings` separately, which proves
 * each function's own contract but not that the two AGREE once a real `profile.json` and the real CLI wiring
 * sit between them. This does: it spawns the binary with a private profile carrying exactly the rule the
 * operator's own config carries, and feeds it an ordinary digest form with no authored dash anywhere.
 *
 * A second case proves the harness is actually live rather than vacuously passing because the profile went
 * unread: an authored `lead` clause carrying an em dash still refuses, through the same command. A third
 * pins the digest layout dash as a below-fold WARNING rather than silence — the admit path used to read only
 * refusals, so every warning it emitted reached nobody and an absence proved nothing.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { absentAsNumber } from "#lib/absent.js";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-digest-abovefold-"));
  writeFileSync(
    join(home, "profile.json"),
    JSON.stringify({
      displayName: "Ada Owner",
      gitNamespace: "ada-gh",
      id: "owner-1",
      schemaVersion: 1,
      slackMe: { userId: "U_OWNER", voice: { exact: [{ kind: "literal", value: "—" }] } },
      sources: ["github"],
    }),
    "utf8",
  );
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A digest form, with the one authored field a case may vary. */
function digestForm({ lead }: { lead?: string }): string {
  return JSON.stringify({
    items: [{ count: 3, severity: "red", title: "purchase-payment-pending 422" }],
    kind: "digest",
    label: "Knock",
    window: "24h",
    ...(lead === undefined ? {} : { lead }),
  });
}

/** Run the shipped binary against the seeded, credential-free home. No network call happens under `--dry-run`. */
function run({ form }: { form: string }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    BIN,
    ["slack", "post", "--as", "bot", "--channel", "D123", "--form", "-", "--dry-run", "--home", home],
    {
      cwd: home,
      encoding: "utf8",
      env: { ...accountSandboxChildEnv(), HOME: home, PATH: process.env["PATH"]!, SLACK_BOT_TOKEN: "xoxb-test" },
      input: form,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return {
    status: absentAsNumber({ value: result.status, whenAbsent: -1 }),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

describe("bin/slopweaver slack post --as bot, against a real em-dash voice rule", () => {
  it("the shipped digest layout ACCEPTS with no authored dash and no override", () => {
    const posted = run({ form: digestForm({}) });

    expect(posted.status).toBe(0);
    // An ABOVE-fold hit names the field it fired on and exits 2; a below-fold one opens `warning:` and
    // exits 0. So the acceptance is the absence of a field-named finding, not the absence of the phrase.
    expect(posted.stderr).not.toContain("tldr: matches the configured");
    expect(posted.stderr).not.toContain("blocked because");
  });

  it("names the below-fold dash as a WARNING, which is what makes the acceptance above meaningful", () => {
    // A bare `not.toContain("voice rule")` used to stand for the assertion above, and it was true for the
    // wrong reason: the admit path read only refusals, so every below-fold warning went to nobody. Now that
    // they print, this case pins which side of the fold the digest's own dash sits on — the fold is the
    // whole distinction, and a test that cannot see a warning cannot tell a warning from a silence.
    const posted = run({ form: digestForm({}) });

    expect(posted.stderr).toContain("warning: below the fold, detail[0].rows[0][3]: matches the configured");
    expect(posted.stderr).toContain("This never blocks the write");
  });

  it("an authored dash still REFUSES, so the gate proven above is live rather than unwired", () => {
    const posted = run({ form: digestForm({ lead: "rising fast — page someone" }) });

    expect(posted.status).toBe(2);
    expect(posted.stderr).toContain('tldr: matches the configured literal voice rule "—"');
  });
});
