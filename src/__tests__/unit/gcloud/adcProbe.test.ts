import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { adcFingerprint } from "../../../gcloud/adcProbe.js";

describe("adcFingerprint", () => {
  let dir: string | undefined;
  afterEach(() => {
    rmSync(dir!, { force: true, recursive: true });
  });

  it("reads missing before a sign-in, and a changed value after the file is rewritten", () => {
    dir = mkdtempSync(join(tmpdir(), "adc-"));
    const path = join(dir, "application_default_credentials.json");
    const before = adcFingerprint({ path });
    writeFileSync(path, "{}");
    utimesSync(path, 1000, 1000);
    const first = adcFingerprint({ path });
    writeFileSync(path, '{"refresh_token":"x"}');
    utimesSync(path, 2000, 2000);
    expect([before, first, adcFingerprint({ path })]).toEqual(["missing", "1000000:2", "2000000:21"]);
  });
});
