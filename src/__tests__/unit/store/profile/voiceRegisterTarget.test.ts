/**
 * Opening the voice register's store refuses, before any connection, when this home selected no store — the refusal
 * the refresh lane turns into `no-store`. The open connection and its transaction are proven against a real store by
 * `subprocess/profile/profileVoiceMeasureContract.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ok, unwrapErr } from "../../../../lib/result.js";
import { openVoiceRegisterTarget } from "../../../../store/profile/voiceRegisterTarget.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("openVoiceRegisterTarget", () => {
  it("refuses with STORE_URL_MISSING when neither the home nor the environment selects a store", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-voiceregister-"));
    homes.push(home);
    const calls: string[] = [];
    const refusal = unwrapErr(
      await openVoiceRegisterTarget({
        env: {},
        home,
        refreshCache: async () => {
          calls.push("cache");
          return ok("refreshed");
        },
      }),
    );
    expect(refusal.code).toBe("STORE_URL_MISSING");
    expect(calls).toStrictEqual([]);
  });
});
