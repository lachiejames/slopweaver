/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  barePullRequestUrl,
  judgeProof,
  proofAskedIn,
  proofCarriedIn,
  proofLacking,
  proofVerdictLine,
} from "../../../handover/proofAsk.js";

/** A synthetic proof ask on an acme-admin pull request, shaped as a row stores one: a pasted image, the link, the ask. */
const WORDS_17564 =
  "[Image #12] the diff on https://github.com/acme/acme-admin/pull/17564 is close, but it needs before and after proof: screenshots, plus links to the CI runs in github, and it should carry links and screenshots from datadog CI, where the Acme test logs are";

const RUN_A = "https://github.com/acme/acme-admin/actions/runs/36080719230/job/107901830804";
const RUN_B = "https://github.com/acme/acme-admin/actions/runs/35822152721/job/107056104701";
const SHOT_A = "https://github.com/user-attachments/assets/a0000006-0000-4000-8000-000000000007";
const SHOT_B = "https://github.com/user-attachments/assets/a0000008-0000-4000-8000-000000000009";
const DD = "https://ap1.datadoghq.com/ci/pipeline-executions?query=ci_level%3Ajob";
const BADGE = '<img src="https://img.shields.io/badge/risk-low-2ea44f?style=flat" alt="risk: low">';

describe("proofAskedIn", () => {
  it("reads every item and the before-and-after off the 17564 words", () => {
    expect(proofAskedIn({ words: [WORDS_17564] })).toEqual({
      beforeAndAfter: true,
      items: ["screenshot", "github-run", "datadog"],
    });
  });

  it("asks nothing of words that only say run as a verb or paste an image", () => {
    expect(proofAskedIn({ words: ["[Image #3] run the tests again and merge it"] })).toEqual({
      beforeAndAfter: false,
      items: [],
    });
  });

  it("reads an item asked in a steer when the row's own quote asks nothing", () => {
    expect(proofAskedIn({ words: ["looks fine", "put a CI run link in the body"] })).toEqual({
      beforeAndAfter: false,
      items: ["github-run"],
    });
  });

  it("asks nothing in a clause that negates, and still asks in the clause after a but", () => {
    expect(proofAskedIn({ words: ["No screenshots are needed; merge it."] })).toEqual({
      beforeAndAfter: false,
      items: [],
    });
    expect(proofAskedIn({ words: ["don't bother with screenshots but a datadog link would help"] })).toEqual({
      beforeAndAfter: false,
      items: ["datadog"],
    });
  });

  it("asks nothing in a clause asking to take an item away", () => {
    expect(proofAskedIn({ words: ["Please remove the screenshots."] })).toEqual({ beforeAndAfter: false, items: [] });
  });

  it("asks nothing in a clause that only mentions an item, and asks once the clause requests it", () => {
    expect(proofAskedIn({ words: ["Datadog is too expensive; merge this."] })).toEqual({
      beforeAndAfter: false,
      items: [],
    });
    expect(proofAskedIn({ words: ["the ci runs are flaky. please add the Datadog view"] })).toEqual({
      beforeAndAfter: false,
      items: ["datadog"],
    });
  });

  it("never spells a phrase across two quotes", () => {
    expect(proofAskedIn({ words: ["see the before", "and after the release"] })).toEqual({
      beforeAndAfter: false,
      items: [],
    });
  });

  it("reads pictures, a screen recording and the US spelling of test optimization", () => {
    expect(
      proofAskedIn({ words: ["attach a couple of pictures, or a screen recording, plus test optimization"] }),
    ).toEqual({
      beforeAndAfter: false,
      items: ["screenshot", "datadog"],
    });
  });

  it("asks nothing of no words at all", () => {
    expect(proofAskedIn({ words: [] })).toEqual({ beforeAndAfter: false, items: [] });
  });
});

describe("proofCarriedIn", () => {
  it("counts a job link and its run's link as one run, and never a badge as a screenshot", () => {
    const body = [
      BADGE,
      `[run](${RUN_A}) and [again](https://github.com/acme/acme-admin/actions/runs/36080719230)`,
      `<a href="${SHOT_A}">its screenshot</a> ![b](${SHOT_B})`,
      `[the Datadog view](${DD})`,
    ].join("\n");
    expect(proofCarriedIn({ body })).toEqual({
      datadog: [DD],
      "github-run": ["acme/acme-admin run 36080719230"],
      screenshot: [SHOT_A, SHOT_B],
    });
  });

  it("counts a Datadog host only when the host ends at datadoghq, never a lookalike", () => {
    const body = [
      "https://datadoghq.com.example.org/ci",
      "https://app.datadoghq.com@example.org/ci",
      "[eu](https://app.datadoghq.eu)",
    ].join("\n");
    expect(proofCarriedIn({ body }).datadog).toEqual(["https://app.datadoghq.eu"]);
  });

  it("carries nothing in an empty body", () => {
    expect(proofCarriedIn({ body: "" })).toEqual({ datadog: [], "github-run": [], screenshot: [] });
  });
});

describe("judgeProof", () => {
  it("needs two runs and two screenshots for a before and after, one Datadog link, and names the lack", () => {
    const asked = proofAskedIn({ words: [WORDS_17564] });
    const verdicts = judgeProof({ asked, carried: proofCarriedIn({ body: `${RUN_A} ${SHOT_A} ${SHOT_B} ${DD}` }) });
    expect(
      verdicts.filter((verdict) => proofLacking({ verdict })).map((verdict) => proofVerdictLine({ verdict })),
    ).toEqual(["GitHub run link: 1 found, 2 needed — acme/acme-admin run 36080719230"]);
  });

  it("finds nothing lacking when the body carries a before and an after of each", () => {
    const asked = proofAskedIn({ words: [WORDS_17564] });
    const carried = proofCarriedIn({ body: `${RUN_A} ${RUN_B} ${SHOT_A} ${SHOT_B} ${DD}` });
    expect(judgeProof({ asked, carried }).filter((verdict) => proofLacking({ verdict }))).toEqual([]);
  });

  it("says none when the body carries none of an item", () => {
    const verdicts = judgeProof({
      asked: { beforeAndAfter: false, items: ["datadog"] },
      carried: proofCarriedIn({ body: "" }),
    });
    expect(verdicts.map((verdict) => proofVerdictLine({ verdict }))).toEqual([
      "Datadog link: none in the body (0 found, 1 needed)",
    ]);
  });
});

describe("barePullRequestUrl", () => {
  it("accepts a pull request URL, a trailing slash dropped", () => {
    expect(barePullRequestUrl({ witness: "https://github.com/acme/acme-admin/pull/17564/" })).toBe(
      "https://github.com/acme/acme-admin/pull/17564",
    );
  });

  it("accepts every spelling of the same page as the same pull request", () => {
    const witnesses = [
      "HTTPS://GitHub.com/acme/acme-admin/pull/17564",
      "https://www.github.com/acme/acme-admin/PULL/17564",
      "https://github.com:443/acme/acme-admin/pull/17564",
      "http://github.com/acme/acme-admin/pull/17564?w=1",
      "https://github.com/acme/acme-admin/pull/17564/files",
    ];
    expect(new Set(witnesses.map((witness) => barePullRequestUrl({ witness })))).toEqual(
      new Set(["https://github.com/acme/acme-admin/pull/17564"]),
    );
  });

  it("refuses a comment permalink, prose around the URL, and an issue", () => {
    const witnesses = [
      "https://github.com/acme/acme-admin/pull/17564#issuecomment-1",
      "merged in https://github.com/acme/acme-admin/pull/17564",
      "https://github.com/acme/acme-admin/issues/17564",
      "https://github.com.example.org/acme/acme-admin/pull/17564",
    ];
    expect(witnesses.map((witness) => barePullRequestUrl({ witness }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
