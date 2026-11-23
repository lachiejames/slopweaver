import { describe, expect, it } from "vitest";

import { checkedShot } from "../../../incident/findingFields.js";
import { checkedCites, checkedProof } from "../../../incident/formEvidence.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const DD = "https://app.datadoghq.com/logs?query=service%3Aacme-fixture-gateway";
const PR = "https://github.com/example/acme-admin/pull/1";

describe("checkedProof", () => {
  it("admits a page slug", () => {
    expect(unwrap(checkedProof({ value: "gateway-down-receipts" }))).toBe("gateway-down-receipts");
  });

  it.each([undefined, "", "Not A Slug", "http://localhost:3000/queue"])("refuses %j, naming proof", (value) => {
    expect(unwrapErr(checkedProof({ value }))).toMatchObject({ code: "FORM_INVALID", field: "proof" });
  });
});

describe("checkedCites", () => {
  it("trims the links and keeps their order", () => {
    expect(unwrap(checkedCites({ value: [` ${DD} `, PR] }))).toEqual([DD, PR]);
  });

  it("refuses a list with no Datadog link", () => {
    expect(unwrapErr(checkedCites({ value: [PR] })).message).toContain("carries no Datadog link");
  });

  it("refuses a link that is not https", () => {
    expect(unwrapErr(checkedCites({ value: [DD, "http://example.com"] })).message).toContain(
      'carries "http://example.com", which is not an https link',
    );
  });

  it("refuses more than eight links", () => {
    expect(unwrapErr(checkedCites({ value: Array.from({ length: 9 }, () => DD) })).message).toContain(
      "carries 9 links and the cap is 8",
    );
  });

  it("refuses an empty list", () => {
    expect(unwrapErr(checkedCites({ value: [] })).message).toContain("is a non-empty list of evidence links");
  });

  it("admits a list that opens on the EU Datadog site", () => {
    const eu = "https://app.datadoghq.eu/logs?query=service%3Aacme-fixture-gateway";
    expect(unwrap(checkedCites({ value: [eu, PR] }))).toEqual([eu, PR]);
  });

  it("refuses a list that opens on a pull request, the evidence leading", () => {
    expect(unwrapErr(checkedCites({ value: [PR, DD] })).message).toContain(
      `opens on "${PR}" — the evidence leads, so a Datadog link comes first`,
    );
  });
});

// The note's screenshot is evidence too; its check moved to `./findingFields.ts`, where a ruling made it required.
describe("checkedShot", () => {
  it("refuses an absent shot, since a finding reaches the owner only with a screenshot proving it", () => {
    expect(unwrapErr(checkedShot({ value: undefined }))).toMatchObject({ code: "FORM_INVALID", field: "shot" });
  });

  it("admits a path and its boxes", () => {
    expect(unwrap(checkedShot({ value: { boxes: ["0,0,10,10=spike"], path: "/tmp/shot.png" } }))).toEqual({
      boxes: ["0,0,10,10=spike"],
      path: "/tmp/shot.png",
    });
  });

  it("refuses a shot with no boxes", () => {
    expect(unwrapErr(checkedShot({ value: { boxes: [], path: "/tmp/shot.png" } }))).toMatchObject({
      code: "FORM_INVALID",
      field: "shot",
    });
  });
});
