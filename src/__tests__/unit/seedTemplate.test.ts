import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { seedTemplate } from "../seedTemplate.js";

describe("seedTemplate", () => {
  it("returns the directory its seed built", () => {
    const template = seedTemplate({
      prefix: "seed-template-ok-",
      seed: ({ dir }) => {
        writeFileSync(join(dir, "seeded.txt"), "yes\n");
      },
    });

    expect(readFileSync(join(template, "seeded.txt"), "utf8")).toBe("yes\n");
    rmSync(template, { force: true, recursive: true });
  });

  it("removes a half-built template and rethrows, so a caller's cache never holds one", () => {
    const seen: string[] = [];
    const attempt = (): string =>
      seedTemplate({
        prefix: "seed-template-fail-",
        seed: ({ dir }) => {
          seen.push(dir);
          writeFileSync(join(dir, "half.txt"), "half\n");
          throw new Error("git commit failed: no space left on device");
        },
      });

    expect(attempt).toThrow("no space left on device");
    expect(seen.length).toBe(1);
    expect(existsSync(seen[0]!)).toBe(false);
  });
});
