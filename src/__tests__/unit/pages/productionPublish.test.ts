import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrapErr } from "../../../lib/result.js";
import { productionPublishPage } from "../../../pages/productionPublish.js";
import { pagePath } from "../../../pages/publish.js";

describe("productionPublishPage", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-production-publish-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses an unusable slug before writing anything or reaching the store", async () => {
    const refused = await productionPublishPage({
      fragment: "<p>acme</p>",
      home,
      nowIso: "2026-11-09T01:00:00.000Z",
      slug: "../escape",
    });
    expect(unwrapErr(refused)[0]).toContain('"../escape" cannot be a page slug');
    expect(existsSync(pagePath({ home, slug: "escape" }))).toBe(false);
  });
});
