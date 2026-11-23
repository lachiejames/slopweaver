/**
 * `openKnockSession` is the one construction site of a live Knock seam: no key is the install's TOKEN_MISSING, and
 * a stored key yields a seam whose send refuses a write route — a workflow trigger here — before any request
 * leaves the process.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { KNOCK_API_KEY_SECRET } from "../../../../live/knock/credential.js";
import { KnockReadErrors } from "../../../../live/knock/errors.js";
import { openKnockSession } from "../../../../live/knock/session.js";
import { secretFilePath } from "../../../../stateHome.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-knock-session-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("openKnockSession", () => {
  it("is TOKEN_MISSING when nothing is stored", () => {
    expect(unwrapErr(openKnockSession({ home }))).toEqual(KnockReadErrors.tokenMissing());
  });

  it("opens over a stored key, and its seam refuses a trigger route before sending", async () => {
    const path = secretFilePath({ home, name: KNOCK_API_KEY_SECRET });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "sk_fake_knock_secret_key\n", { mode: 0o600 });
    const session = unwrap(openKnockSession({ home }));
    const sent = await session.get({
      operation: "knock.messages.list",
      url: new URL("https://api.knock.app/v1/workflows/booking-reminder/trigger"),
    });
    expect(unwrapErr(sent)).toEqual(
      KnockReadErrors.urlRefused({
        operation: "knock.messages.list",
        why: "the URL is not one the closed call list builds",
      }),
    );
  });
});
