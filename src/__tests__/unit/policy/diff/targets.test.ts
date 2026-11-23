import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { type DocDiffRecord, parseDocDiffRecord } from "../../../../policy/diff/record.js";
import { resolveTargets } from "../../../../policy/diff/targets.js";
import { recordText, SLOT_URL } from "./fixture.js";

const evidence = [{ id: "network-diagram", url: SLOT_URL }];
const policies = [
  { id: "p-1", name: "Secure Development Policy", url: "https://app.vanta.com/c/acme/policies/p-1" },
  { id: "p-2", name: "Access Policy", url: "https://app.vanta.com/c/acme/policies/p-2" },
];

/** The fixture record with the given links. */
function recordWith({ links }: { links: readonly { text: string; target: string }[] }): DocDiffRecord {
  return unwrap(parseDocDiffRecord({ text: recordText({ overrides: { links } }) }));
}

/** The fixture record with its one document living at the given Vanta address. */
function recordAt({ vantaEvidence }: { vantaEvidence: string }): DocDiffRecord {
  const documents = recordWith({ links: [] }).documents.map((document) => ({ ...document, vantaEvidence }));
  return unwrap(parseDocDiffRecord({ text: recordText({ overrides: { documents } }) }));
}

describe("resolveTargets", () => {
  it("puts the record's links first, then every policy it did not already name", () => {
    const record = recordWith({
      links: [
        { target: "vanta-evidence:network-diagram", text: "network diagram" },
        { target: "vanta-policy:p-2", text: "access policy" },
        { target: "https://linear.app/x/issue/NET-1", text: "the ticket" },
      ],
    });
    const resolved = unwrap(resolveTargets({ evidence, policies, record }));
    expect(resolved.phrases).toEqual([
      { text: "network diagram", url: SLOT_URL },
      { text: "access policy", url: "https://app.vanta.com/c/acme/policies/p-2" },
      { text: "the ticket", url: "https://linear.app/x/issue/NET-1" },
      { text: "Secure Development Policy", url: "https://app.vanta.com/c/acme/policies/p-1" },
    ]);
    expect([...resolved.slotUrls]).toEqual([["network-diagram", SLOT_URL]]);
  });

  it("addresses a document that is a policy at its policy page", () => {
    const record = recordAt({ vantaEvidence: "vanta-policy:p-1" });
    const resolved = unwrap(resolveTargets({ evidence, policies, record }));
    expect([...resolved.slotUrls]).toEqual([["vanta-policy:p-1", "https://app.vanta.com/c/acme/policies/p-1"]]);
  });

  it("refuses a document policy the atlas does not hold, naming it as written", () => {
    const record = recordAt({ vantaEvidence: "vanta-policy:gone" });
    const issues = unwrapErr(resolveTargets({ evidence, policies, record }));
    expect(issues.map((issue) => issue.message)).toEqual([
      "link target vanta-policy:gone names nothing the Vanta atlas holds — run slopweaver atlas vanta sync, or give an https URL",
    ]);
  });

  it("refuses a target the atlas does not hold, and a document slot it does not hold", () => {
    const record = recordWith({ links: [{ target: "vanta-policy:gone", text: "gone" }] });
    const issues = unwrapErr(resolveTargets({ evidence: [], policies, record }));
    expect(issues.map((issue) => issue.message)).toEqual([
      "link target vanta-policy:gone names nothing the Vanta atlas holds — run slopweaver atlas vanta sync, or give an https URL",
      "link target vanta-evidence:network-diagram names nothing the Vanta atlas holds — run slopweaver atlas vanta sync, or give an https URL",
    ]);
  });
});
