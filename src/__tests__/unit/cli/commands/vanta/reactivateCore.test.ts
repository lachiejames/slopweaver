import { describe, expect, it } from "vitest";

import { vantaReactivateDigest } from "../../../../../atlas/vanta/reactivateApproval.js";
import { resolveVantaWriteRequest } from "../../../../../atlas/vanta/writePreview.js";
import {
  parseVantaReactivateOptions,
  renderVantaReactivateDryRun,
} from "../../../../../cli/commands/vanta/reactivateCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const HOME = "/tmp/home";

describe("parseVantaReactivateOptions", () => {
  it("builds one id-only update per named finding, in the order named", () => {
    const options = unwrap(parseVantaReactivateOptions({ defaultHome: HOME, rest: ["--ids", "a, b", "--dry-run"] }));
    expect(options).toEqual({
      approve: null,
      clientIdFile: null,
      clientSecretFile: null,
      dryRun: true,
      home: HOME,
      json: false,
      updates: [{ id: "a" }, { id: "b" }],
    });
  });

  it("carries the approval digest through untouched", () => {
    const options = unwrap(
      parseVantaReactivateOptions({ defaultHome: HOME, rest: ["--ids", "a", "--approve", "abc"] }),
    );
    expect(options.approve).toBe("abc");
  });

  it("refuses a missing --ids", () => {
    expect(unwrapErr(parseVantaReactivateOptions({ defaultHome: HOME, rest: ["--dry-run"] }))).toEqual([
      "name the findings: --ids <id[,id...]>",
    ]);
  });

  it("refuses an --ids that names nothing", () => {
    expect(unwrapErr(parseVantaReactivateOptions({ defaultHome: HOME, rest: ["--ids", " , "] }))).toEqual([
      "--ids named no finding — pass one id, or several separated by commas",
    ]);
  });

  it("refuses a repeated --ids, because the shared parser would otherwise keep only the last", () => {
    const result = parseVantaReactivateOptions({ defaultHome: HOME, rest: ["--ids", "a", "--ids", "b"] });
    expect(unwrapErr(result)).toEqual([
      "--ids was given 2 times — pass it once; the parser would keep only the last and drop the rest",
    ]);
  });

  it("refuses a flag reactivation does not take", () => {
    expect(
      unwrapErr(parseVantaReactivateOptions({ defaultHome: HOME, rest: ["--ids", "a", "--reason", "x"] })),
    ).toContain("unknown flag: --reason");
  });
});

describe("renderVantaReactivateDryRun", () => {
  it("says nothing was sent, lists every id, prints the exact bytes and the digest", () => {
    const updates = [{ id: "6a32310b7e098647ce4ef350" }];
    const request = resolveVantaWriteRequest({ input: { updates }, kind: "reactivate-vulnerabilities" });
    const digest = vantaReactivateDigest({ request });
    expect(renderVantaReactivateDryRun({ digest, request, updates })).toEqual([
      "vanta reactivate --dry-run: 1 finding(s) would go back under monitoring, nothing was sent " +
        "(Vanta's own batch maximum is 50)",
      "",
      "6a32310b7e098647ce4ef350",
      "",
      "POST /v1/vulnerabilities/reactivate",
      "  authorization: Bearer <token>",
      "  content-type: application/json",
      "",
      '{"updates":[{"id":"6a32310b7e098647ce4ef350"}]}',
      "",
      `to send exactly this batch: --approve ${digest}`,
      "  the digest covers the route and every id above, in this order; change any of them and it stops matching",
    ]);
  });
});
