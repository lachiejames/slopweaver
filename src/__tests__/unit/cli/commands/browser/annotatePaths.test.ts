/**
 * `browser annotate`'s path resolution: the record form sits beside the output, and neither may land on the source.
 * The link and inode refusals need real files and run through the verb in `annotateRun.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { annotatePaths } from "../../../../../cli/commands/browser/annotatePaths.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("annotatePaths", () => {
  it("puts the record form beside the output", () => {
    expect(unwrap(annotatePaths({ form: { out: "/a/b.png", source: "/a/c.png" } }))).toEqual({
      out: "/a/b.png",
      recordForm: "/a/b.png.image-record.json",
      source: "/a/c.png",
    });
  });

  it("refuses an out that names the source", () => {
    const problems = unwrapErr(annotatePaths({ form: { out: "/a/../a/c.png", source: "/a/c.png" } }));

    expect(problems[0]).toContain("out names the source /a/c.png");
  });

  it("refuses a record form that would land on the source", () => {
    const problems = unwrapErr(annotatePaths({ form: { out: "/a/b.png", source: "/a/b.png.image-record.json" } }));

    expect(problems[0]).toContain("the record form would land on the source");
  });
});
