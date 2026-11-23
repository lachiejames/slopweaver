/**
 * `linear issue create` through the REAL Linear write transport and a real private-terms file under the verb's
 * `--home`: a create the privacy check refuses sends nothing, releases the reservation it took, and the retry once
 * the terms allow it files the issue instead of being refused as a duplicate. The transport is a counting seam.
 */
import { describe, expect, it } from "vitest";

import { runLinearIssue } from "../../../../../../cli/commands/linear/run.js";
import type { LinearWriteDeps } from "../../../../../../cli/commands/linear/writeDeps.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { makeLinearWriteApi } from "../../../../../../corpus/linear/write.js";
import { listIssueIds, readIssueRecord } from "../../../../../../outbound/linear/issueLedger.js";
import { linearWritePrivacy } from "../../../../../../outbound/linear/writePrivacy.js";
import { writePrivateTerms } from "../../../../../privateTermsFixture.js";
import { argv, harness, tempHome, useTempHomeCleanup } from "./harness.js";

useTempHomeCleanup();

const FORM = JSON.stringify({
  artifact: {
    aiPrompt: [{ kind: "para", text: "**Goal.** Do it." }],
    kind: "structured",
    problem: [{ kind: "para", text: "It is broken." }],
    solution: [{ kind: "para", text: "Unbreak it." }],
  },
  fields: { teamId: "00000000-0000-4000-8000-000000000001", title: "Notes for quillfeather" },
});

const STORED = {
  description: "d",
  id: "x",
  identifier: "AAA-9",
  title: "Notes for quillfeather",
  updatedAt: "2026-08-02T10:00:00.000Z",
  url: "https://linear.test/AAA-9",
};

/** The harness's deps with the real write API, judged under the policy of the home the verb hands it. */
function realTransportDeps({ home }: { home: string }): { deps: LinearWriteDeps; requests: string[]; out: string[] } {
  const h = harness({ form: FORM, home });
  const requests: string[] = [];
  const deps: LinearWriteDeps = {
    ...h.deps,
    makeApi: ({ home: given, token }) =>
      makeLinearWriteApi({
        privacy: linearWritePrivacy({ home: given }),
        request: ({ query }) => {
          requests.push(query.includes("issueCreate") ? "create" : "read");
          return Promise.resolve({ issue: STORED, issueCreate: { issue: { id: "x" }, success: true } });
        },
        scheduler: (task) => task(),
        token,
      }),
  };
  return { deps, out: h.out, requests };
}

describe("a create the privacy check refuses", () => {
  it("sends nothing, releases its reservation, and lets the allowed retry file the issue", async () => {
    const home = tempHome();
    writePrivateTerms({ home, rows: ["person\ti\tquillfeather\tsynthetic"] });
    const first = realTransportDeps({ home });
    const refused = await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: first.deps,
    });

    expect(refused).toBe(EXIT_ERROR);
    expect(first.requests).toEqual([]);
    expect(first.out.join(" ")).toContain("a private person term (redacted here)");
    expect(first.out.join(" ")).not.toMatch(/quillfeather/iu);
    expect(listIssueIds({ home })).toEqual([]);

    writePrivateTerms({ home });
    const second = realTransportDeps({ home });
    const filed = await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: second.deps,
    });

    expect(filed).toBe(EXIT_OK);
    expect(second.requests).toEqual(["create", "read"]);
    expect(second.out[0]).toBe("created AAA-9");
    const ids = listIssueIds({ home });
    expect(ids.length).toBe(1);
    expect(readIssueRecord({ home, id: ids[0]! })!.confirmedIso).toBe("2026-08-02T10:00:00.000Z");
  });
});
