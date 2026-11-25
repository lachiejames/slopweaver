/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { type PullBodyRead, proofWitnessGate } from "../../../../../cli/commands/handover/proofWitnessGate.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { hatchFor } from "../../../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../../../hatch/render.js";
import { err, ok } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";

const ANCHOR = "transcript:a0000032-0000-4000-8000-000000000035#0633bdef-34d9-48a7-92cf-8e02bd019433";
const PR = "https://github.com/acme/acme-admin/pull/17564";

/** The 17564 row's own front matter, the owner's words included, so the gate reads the words that were really there. */
const row = ({ words }: { words: string }) =>
  parseHandoverDoc({
    path: "/h/acme-admin-17564-gets-before-and-after-proof.md",
    text: [
      "---",
      "slug: acme-admin-17564-gets-before-and-after-proof",
      "kind: ask",
      'summary: "17564 gets before and after proof"',
      "status: ready",
      "askedIso: 2026-09-25T02:41:26Z",
      `anchor: ${ANCHOR}`,
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      `ownerWords: ${JSON.stringify(words)}`,
      `ownerWordsAnchor: "${ANCHOR}"`,
      'ownerWordsIso: "2026-09-25T02:41:26.704Z"',
      "ownerWordsWhere: session",
      "ownerWordsCut: none",
      "---",
      "",
    ].join("\n"),
  });

const WORDS =
  "it needs before and after proof: screenshots, plus links to the CI runs in github, and it should carry links and screenshots from datadog CI, where the Acme test logs are";

/** A body read that answers `body` and records each address it was asked for. */
const bodyOf = ({ body, asked }: { body: string; asked: string[] }): PullBodyRead => {
  return ({ address }) => {
    asked.push(address);
    return Promise.resolve(ok(body));
  };
};

const FULL_BODY = [
  "https://github.com/acme/acme-admin/actions/runs/36080719230/job/107901830804",
  "https://github.com/acme/acme-admin/actions/runs/35822152721/job/107056104701",
  "https://github.com/user-attachments/assets/a0000006-0000-4000-8000-000000000007",
  "https://github.com/user-attachments/assets/a0000008-0000-4000-8000-000000000009",
  "https://ap1.datadoghq.com/ci/pipeline-executions?query=x",
].join("\n");

describe("proofWitnessGate", () => {
  it("refuses the 17564 settlement over a body carrying no proof, naming each lack under the hatch", async () => {
    const asked: string[] = [];
    const outcome = await proofWitnessGate({
      env: {},
      home: "/h",
      readBody: bodyOf({ asked, body: "one line changed" }),
      row: row({ words: WORDS }),
      settlement: "answered",
      witness: PR,
    });
    expect(asked).toEqual([PR]);
    expect(outcome).toEqual({
      kind: "refuse",
      lines: hatchRefusalLines({
        detail: `${PR} lacks screenshot (a GitHub attachment): none in the body (0 found, 2 needed); GitHub run link: none in the body (0 found, 2 needed); Datadog link: none in the body (0 found, 1 needed)`,
        hatch: hatchFor({ id: "proof-witness" }),
      }),
    });
    expect(hatchRefusalLines({ hatch: hatchFor({ id: "proof-witness" }) })[2]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_UNPROVEN_ANSWER=1 slopweaver handover settle --as answered.",
    );
  });

  it("still refuses with the hatch variable set to anything but 1", async () => {
    const outcome = await proofWitnessGate({
      env: { SLOPWEAVER_ALLOW_UNPROVEN_ANSWER: "0" },
      home: "/h",
      readBody: bodyOf({ asked: [], body: "https://app.datadoghq.com/ci/test-runs" }),
      row: row({ words: WORDS }),
      settlement: "answered",
      witness: PR,
    });
    expect(outcome).toEqual({
      kind: "refuse",
      lines: hatchRefusalLines({
        detail: `${PR} lacks screenshot (a GitHub attachment): none in the body (0 found, 2 needed); GitHub run link: none in the body (0 found, 2 needed)`,
        hatch: hatchFor({ id: "proof-witness" }),
      }),
    });
  });

  it("passes a body carrying each item, the receipt naming the runs it found", async () => {
    const outcome = await proofWitnessGate({
      env: {},
      home: "/h",
      readBody: bodyOf({ asked: [], body: FULL_BODY }),
      row: row({ words: WORDS }),
      settlement: "answered",
      witness: PR,
    });
    expect(outcome).toEqual({
      kind: "pass",
      receipt: [
        `proof-witness: read ${PR} live — each item the owner's words ask for is PRESENT (present, not judged):`,
        "  screenshot (a GitHub attachment): 2 found, 2 needed — https://github.com/user-attachments/assets/a0000006-0000-4000-8000-000000000007, https://github.com/user-attachments/assets/a0000008-0000-4000-8000-000000000009",
        "  GitHub run link: 2 found, 2 needed — acme/acme-admin run 36080719230, acme/acme-admin run 35822152721",
        "  Datadog link: 1 found, 1 needed — https://ap1.datadoghq.com/ci/pipeline-executions?query=x",
      ],
    });
  });

  it("refuses as a fact, not under the hatch and not waived by it, when the body cannot be read", async () => {
    const outcome = await proofWitnessGate({
      env: { SLOPWEAVER_ALLOW_UNPROVEN_ANSWER: "1" },
      home: "/h",
      readBody: () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "no token" }))),
      row: row({ words: WORDS }),
      settlement: "answered",
      witness: PR,
    });
    expect(outcome).toEqual({
      kind: "refuse",
      lines: [
        `handover settle: the row is NOT settled: the owner's words on it ask for screenshot, github-run, datadog, and ${PR} could not be read, so whether its body carries them is unknown — no token`,
      ],
    });
  });

  it("refuses as the same fact when the read throws or rejects rather than failing", async () => {
    const readers: readonly PullBodyRead[] = [
      () => Promise.reject(new Error("socket reset")),
      () => {
        throw new Error("socket reset");
      },
    ];
    const outcomes = await Promise.all(
      readers.map((readBody) =>
        proofWitnessGate({
          env: { SLOPWEAVER_ALLOW_UNPROVEN_ANSWER: "1" },
          home: "/h",
          readBody,
          row: row({ words: WORDS }),
          settlement: "answered",
          witness: PR,
        }),
      ),
    );
    const refusal = {
      kind: "refuse",
      lines: [
        `handover settle: the row is NOT settled: the owner's words on it ask for screenshot, github-run, datadog, and ${PR} could not be read, so whether its body carries them is unknown — socket reset`,
      ],
    };
    expect(outcomes).toEqual([refusal, refusal]);
  });

  it("refuses as a fact when the read throws a value with no readable message", async () => {
    const hostile = new Error("replaced by a throwing getter below");
    Object.defineProperty(hostile, "message", {
      get: () => {
        throw new Error("message getter exploded");
      },
    });
    const throwers: readonly unknown[] = [Object.create(null), hostile];
    const outcomes = await Promise.all(
      throwers.map((thrown) =>
        proofWitnessGate({
          env: {},
          home: "/h",
          readBody: () => {
            throw thrown;
          },
          row: row({ words: WORDS }),
          settlement: "answered",
          witness: PR,
        }),
      ),
    );
    const refusal = {
      kind: "refuse",
      lines: [
        `handover settle: the row is NOT settled: the owner's words on it ask for screenshot, github-run, datadog, and ${PR} could not be read, so whether its body carries them is unknown — the read threw a value with no readable message`,
      ],
    };
    expect(outcomes).toEqual([refusal, refusal]);
  });

  it("settles a lacking body under the hatch, the receipt naming every shortage", async () => {
    const asked: string[] = [];
    const outcome = await proofWitnessGate({
      env: { SLOPWEAVER_ALLOW_UNPROVEN_ANSWER: "1" },
      home: "/h",
      readBody: bodyOf({ asked, body: "https://app.datadoghq.com/ci/test-runs" }),
      row: row({ words: WORDS }),
      settlement: "answered",
      witness: PR,
    });
    expect(asked).toEqual([PR]);
    expect(outcome).toEqual({
      kind: "pass",
      receipt: [
        `proof-witness: override in force — settling although ${PR} lacks screenshot (a GitHub attachment): none in the body (0 found, 2 needed); GitHub run link: none in the body (0 found, 2 needed)`,
      ],
    });
  });

  it("reads an ask from a held steer when the row's own quote asks nothing", async () => {
    const asked: string[] = [];
    const steer = "transcript:a0000032-0000-4000-8000-000000000035#a0000006-2222-4333-8444-555555555555";
    const withSteer = parseHandoverDoc({
      path: "/h/r.md",
      text: [
        "---",
        "slug: r",
        "kind: ask",
        'summary: "r"',
        "status: ready",
        "askedIso: 2026-09-25T02:41:26Z",
        `anchor: ${ANCHOR}`,
        "blockedBy: []",
        "artifact: null",
        "doneWhen: []",
        'ownerWords: "ship it"',
        `ownerWordsAnchor: "${ANCHOR}"`,
        'ownerWordsIso: "2026-09-25T02:41:26.704Z"',
        "ownerWordsWhere: session",
        "ownerWordsCut: none",
        `ownerWordsSteer1Anchor: "${steer}"`,
        'ownerWordsSteer1Words: "put a datadog link in it"',
        'ownerWordsSteer1Iso: "2026-09-25T03:00:00.000Z"',
        "ownerWordsSteer1Where: session",
        "ownerWordsSteer1Cut: none",
        "---",
        "",
      ].join("\n"),
    });
    const outcome = await proofWitnessGate({
      env: {},
      home: "/h",
      readBody: bodyOf({ asked, body: "" }),
      row: withSteer,
      settlement: "answered",
      witness: PR,
    });
    expect(asked).toEqual([PR]);
    expect(outcome).toEqual({
      kind: "refuse",
      lines: hatchRefusalLines({
        detail: `${PR} lacks Datadog link: none in the body (0 found, 1 needed)`,
        hatch: hatchFor({ id: "proof-witness" }),
      }),
    });
  });

  it("reads nothing for the witness `github landing --register` writes, which is not bare", async () => {
    const asked: string[] = [];
    const outcome = await proofWitnessGate({
      env: {},
      home: "/h",
      readBody: bodyOf({ asked, body: "" }),
      row: row({ words: WORDS }),
      settlement: "answered",
      witness: `${PR} merged at bc0bd119 (2026-10-07T04:30:05Z)`,
    });
    expect(asked).toEqual([]);
    expect(outcome).toEqual({ kind: "pass", receipt: [] });
  });

  it("reads nothing for a filed settlement, a non-URL witness, or words asking no proof", async () => {
    const asked: string[] = [];
    const readBody = bodyOf({ asked, body: "" });
    const outcomes = await Promise.all([
      proofWitnessGate({ env: {}, home: "/h", readBody, row: row({ words: WORDS }), settlement: "filed", witness: PR }),
      proofWitnessGate({
        env: {},
        home: "/h",
        readBody,
        row: row({ words: WORDS }),
        settlement: "answered",
        witness: `${PR}#issuecomment-1`,
      }),
      proofWitnessGate({
        env: {},
        home: "/h",
        readBody,
        row: row({ words: "ship it" }),
        settlement: "answered",
        witness: PR,
      }),
    ]);
    expect(asked).toEqual([]);
    expect(outcomes).toEqual([
      { kind: "pass", receipt: [] },
      { kind: "pass", receipt: [] },
      { kind: "pass", receipt: [] },
    ]);
  });
});
