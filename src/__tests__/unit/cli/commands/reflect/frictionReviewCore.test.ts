import { describe, expect, it } from "vitest";

import {
  parseReflectFrictionReviewOptions,
  REFLECT_FRICTION_REVIEW_FLAG_SPEC,
} from "../../../../../cli/commands/reflect/frictionReviewCore.js";
import { reflectFrictionReviewCommand } from "../../../../../cli/commands/reflect/frictionReviewRun.js";
import { REFLECT_FRICTION_REVIEW_USAGE } from "../../../../../cli/commands/reflect/usage.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseReflectFrictionReviewOptions", () => {
  it("defaults to reporting only, no publish mark", () => {
    expect(unwrap(parseReflectFrictionReviewOptions({ rest: [] }))).toStrictEqual({
      json: false,
      markPublished: false,
      republish: false,
    });
  });

  it("takes every flag its usage line advertises", () => {
    const parsed = unwrap(
      parseReflectFrictionReviewOptions({ rest: ["--mark-published", "--json", "--home", "/tmp/h"] }),
    );
    expect(parsed).toStrictEqual({ home: "/tmp/h", json: true, markPublished: true, republish: false });
  });

  it("takes --republish on its own", () => {
    const parsed = unwrap(parseReflectFrictionReviewOptions({ rest: ["--republish"] }));
    expect(parsed).toStrictEqual({ json: false, markPublished: false, republish: true });
  });

  it("refuses --republish beside --mark-published rather than guessing which was meant", () => {
    const parsed = parseReflectFrictionReviewOptions({ rest: ["--republish", "--mark-published"] });
    expect(unwrapErr(parsed)).toEqual([
      "--republish already stamps the report it publishes — pass one of --republish or --mark-published",
    ]);
  });

  it("refuses a flag it does not know rather than ignoring it", () => {
    const parsed = parseReflectFrictionReviewOptions({ rest: ["--surface-everything"] });
    expect(unwrapErr(parsed)).toEqual(["unknown flag: --surface-everything"]);
  });

  it("advertises exactly the flags it parses", () => {
    const advertised = [...REFLECT_FRICTION_REVIEW_USAGE.matchAll(/--([a-z-]+)/g)].map((match) => match[1]!).toSorted();
    const parsed = [
      ...REFLECT_FRICTION_REVIEW_FLAG_SPEC.boolean,
      ...REFLECT_FRICTION_REVIEW_FLAG_SPEC.value,
    ].toSorted();
    expect(advertised).toStrictEqual(parsed);
  });
});

describe("the reflect friction-review command module", () => {
  it("answers --help with its usage line and no side effect", async () => {
    expect(await reflectFrictionReviewCommand(["node", "slopweaver", "reflect", "friction-review", "--help"])).toBe(0);
  });

  it("refuses an unknown flag before reading anything", async () => {
    expect(await reflectFrictionReviewCommand(["node", "slopweaver", "reflect", "friction-review", "--nope"])).toBe(2);
  });

  it("reports no gap on a home with no report and no republish", async () => {
    expect(await reflectFrictionReviewCommand(["node", "slopweaver", "reflect", "friction-review", "--json"])).toBe(0);
  });

  it("refuses --mark-published when no report exists to stamp", async () => {
    expect(
      await reflectFrictionReviewCommand(["node", "slopweaver", "reflect", "friction-review", "--mark-published"]),
    ).toBe(1);
  });
});
