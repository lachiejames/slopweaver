/*
 * The two posting rules: an incident card opens its proof, and an approval ask opens
 * a page or a pull request, never a console list or a CI run. Each case is a step the real builder made, so it
 * changes exactly the field it is about — and the first is the incident's own posted line.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { postingRefusal } from "../../../hand/posting.js";
import {
  isCiRunUrl,
  isConsoleListUrl,
  isIncidentProofUrl,
  isPublishedPageUrl,
  isPullRequestUrl,
} from "../../../hand/proofAddress.js";
import { approvalWithoutPage, incidentWithoutProof } from "../../../hand/proofLink.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ROW = "incident-acme-admin-gateway-fixture-dashboard-unreachable";
const PROOF = "http://localhost:3000/view?src=%2Fapi%2Fpage%2Fgateway-down-receipts%2Findex.html&back=%2Fqueue";
const CI_RUN = "https://github.com/acme/acme-admin/actions/runs/1234567890/job/1";
const PR = "https://github.com/acme/acme-admin/pull/1234";
const DD = "https://app.datadoghq.com/logs?query=service%3Aacme-fixture-gateway";

/** A fixture incident note, every field but the ones a case changes. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "gateway-down-open-fix-pr",
        ifIgnored: "fixture events stay dropped: every new gateway instance fails since the deploy",
        postedBy: "workspace:663",
        postedIso: "2026-10-16T06:00:00.000Z",
        row: ROW,
        unblocks: "the PR against staging, a Linear ticket, declaring it to the team, then the gateway deploy",
        url: "http://localhost:3000/queue",
        what: "Approve the fix PR to staging and the team post for the fixture prod gateway, failing since the deploy",
        where: "the Queue card on the incident row; the fix branch is pushed, tests pass",
        witness: "the incident seat saw only 5xx on acme-fixture-gateway on the test dashboard since the deploy",
        ...over,
      },
    }),
  );
}

const HINT =
  "publish the receipts with `slopweaver page publish <slug> --page <file> --review <id>` (the review from " +
  "`slopweaver page review-prepare`) and pass its viewer address " +
  "(http://localhost:3000/view?src=%2Fapi%2Fpage%2F<slug>%2Findex.html&back=%2Fqueue), or the Datadog view that shows it";

describe("the address shapes", () => {
  it.each([
    [PROOF, true],
    ["https://console.example/view?src=%2Fapi%2Fpage%2Fa%2Findex.html", true],
    ["http://localhost:3000/api/page/a/index.html", true],
    ["https://host.example/console/view?src=%2Fapi%2Fpage%2Fa%2Findex.html", true],
    ["https://host.example/console/api/page/a/index.html", true],
    ["http://localhost:3000/view?src=%2Fapi%2Fpage%2F..%252Fetc%2Findex.html", false],
    ["http://localhost:3000/api/page/a/other.html", false],
    ["http://localhost:3000/view?src=%2Fapi%2Fpage%2Fa%2Findex.html&src=%2Fqueue", false],
    ["http://localhost:3000/view?src=%2Fqueue", false],
    ["http://localhost:3000/queue", false],
  ])("reads %j as a published page: %j", (url, page) => {
    expect(isPublishedPageUrl({ url })).toBe(page);
  });

  it.each([
    [CI_RUN, true],
    ["https://github.com/acme/acme-admin/actions/runs/1234567890", true],
    ["https://github.com/acme/acme-admin/runs/12345", true],
    ["https://github.com/acme/acme-admin/actions", false],
    [PR, false],
  ])("reads %j as a CI run: %j", (url, run) => {
    expect(isCiRunUrl({ url })).toBe(run);
  });

  it.each([
    [PR, true],
    [`${PR}/files`, true],
    ["https://github.com/acme/acme-admin/pulls", false],
  ])("reads %j as a pull request: %j", (url, pr) => {
    expect(isPullRequestUrl({ url })).toBe(pr);
  });

  it.each([
    ["http://localhost:3000/queue", true],
    ["http://127.0.0.1:3000/board", true],
    ["http://localhost:3000/", true],
    ["http://localhost:3000/queue?open=ask%3Agateway-down", false],
    [PROOF, false],
    ["https://console.example/queue", false],
    ["http://127.0.0.1:8792/release-plan.html", false],
    ["http://localhost:3000/%62oard", true],
    ["http://localhost:3000/%E0%A4%A", false],
    ["http://localhost:4173/report/", false],
    ["http://localhost:3000/board/", true],
    ["http://localhost:3000/pull-requests/acme/acme-admin/1234", false],
    ["https://localhost/queue?open=ask%3Ax", false],
    ["https://localhost/queue", false],
    ["http://localhost:3000/?open=ask%3Ax", false],
    ["http://localhost:3000/today", false],
    ["http://localhost:3000/console", false],
    ["http://localhost:3000/triage", false],
    ["http://localhost:3000/alignment?open=not-a-key", true],
    ["http://localhost:3000/settings", false],
    ["http://localhost:3000/board?row=gateway-down", false],
    ["http://localhost:3000/workstreams?row=gateway-down", false],
    ["http://localhost:3000/board?row=", true],
    ["http://localhost:3000/queue#settings/theme", false],
    ["http://localhost:3000/board#settings", false],
    ["http://localhost:3000/queue#settingsx", true],
    ["http://localhost:3000/queue#settings&page=candidates", false],
    ["http://localhost:3000/alignment?open=act%3Ax", false],
    // Both ends of the config's act redirect, which the reader does not restate, answer alike.
    ["http://localhost:3000/queue?open=act%3Ax", false],
    ["http://localhost:3000/alignment", true],
    ["http://localhost:3000/steers", false],
    ["http://localhost:3000/talk", false],
    ["http://localhost:3000/fleet", true],
    ["http://localhost:3000/fleet/session/x", false],
    ["http://localhost:3000/now", false],
  ])("reads %j as a console list: %j", (url, list) => {
    expect(isConsoleListUrl({ url })).toBe(list);
  });

  /** Every console page's path, a dynamic `[segment]` filled with a sample value. */
  const consolePages = readdirSync(join(REPO_ROOT, "site", "app", "(console)"), { recursive: true })
    .map(String)
    .filter((file) => file.endsWith("page.tsx"))
    .map((file) => `/${dirname(file).replaceAll(/\[[^\]]+\]/gu, "x")}`);

  it("reads every top-level console page but the viewer as a console list", () => {
    const lists = consolePages.filter((path) => path.split("/").length === 2 && path !== "/view");
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.filter((path) => !isConsoleListUrl({ url: `http://localhost:3000${path}` }))).toEqual([]);
  });

  it("reads no nested console page as a list — each opens one thing", () => {
    const nested = consolePages.filter((path) => path.split("/").length > 2);
    expect(nested.length).toBeGreaterThan(0);
    expect(nested.filter((path) => isConsoleListUrl({ url: `http://localhost:3000${path}` }))).toEqual([]);
  });

  it.each([
    [PROOF, true],
    [DD, true],
    ["https://us5.datadoghq.com/dashboard/abc", true],
    ["https://datadoghq.com.evil.example/x", false],
    ["http://app.datadoghq.com/logs", false],
    [CI_RUN, false],
  ])("reads %j as an incident's proof: %j", (url, proof) => {
    expect(isIncidentProofUrl({ url })).toBe(proof);
  });
});

describe("incidentWithoutProof", () => {
  it("refuses the note itself: it opened the Queue", () => {
    expect(incidentWithoutProof({ step: step() })!.message).toBe(
      `url opens the console on a step for an incident's row — the owner lands on the Queue, not on the proof — ${HINT}`,
    );
  });

  it("refuses a Queue item too — the card the owner came from is not the evidence", () => {
    const refused = incidentWithoutProof({
      step: step({ url: "http://localhost:3000/queue?open=ask%3Agateway-down" }),
    });
    expect(refused!.message).toBe(
      `url opens the console on a step for an incident's row — the owner lands on the Queue, not on the proof — ${HINT}`,
    );
  });

  it("refuses the CI run the owner was shown", () => {
    expect(incidentWithoutProof({ step: step({ url: CI_RUN }) })!.message).toBe(
      `url opens a CI run on a step for an incident's row — a CI log is not the proof the owner judges an incident by — ${HINT}`,
    );
  });

  it("refuses a pull request — lead with the proof, never with the PR", () => {
    expect(incidentWithoutProof({ step: step({ url: PR }) })!.message).toBe(
      `url opens a pull request on a step for an incident's row — lead with the proof, never with the PR — ${HINT}`,
    );
  });

  it("refuses a note that opens nothing", () => {
    const { url: _dropped, ...rest } = step();
    expect(incidentWithoutProof({ step: { ...rest, unaddressed: "it is all on the card" } })!.message).toBe(
      `url is missing on a step for an incident's row, so its note opens nothing — an incident note opens its proof — ${HINT}`,
    );
  });

  it("refuses some other page", () => {
    expect(incidentWithoutProof({ step: step({ url: "https://linear.app/acme/issue/ENG-1" }) })).toMatchObject({
      code: "INVALID_FIELD",
      field: "url",
    });
  });

  it.each([PROOF, DD])("admits a note opening its proof %j", (url) => {
    expect(incidentWithoutProof({ step: step({ url }) })).toBeUndefined();
  });

  it("leaves a sign-in the incident read waits on to the sign-in rules", () => {
    const signIn = step({
      url: "https://app.datadoghq.com/account/login",
      what: "Sign in to Datadog in the work Chrome",
    });
    expect(incidentWithoutProof({ step: { ...signIn, url: "https://accounts.google.com/" } })).toBeUndefined();
  });

  it("does not read a step on any other row", () => {
    expect(incidentWithoutProof({ step: step({ row: "gateway-down-follow-up" }) })).toBeUndefined();
  });
});

describe("approvalWithoutPage", () => {
  const off = (over: Partial<HandStepDraft>): HandStep => step({ row: "gateway-down-follow-up", ...over });

  it("refuses an approval opening the Queue list, naming the phrase", () => {
    expect(approvalWithoutPage({ step: off({}) })!.message).toBe(
      'url opens a console list and the step asks the owner to "Approve the fix" — the owner lands on the list and hunts; pass the page that shows what the owner approves, the pull request, or the one Queue item (open=<kind>%3A<id>) that carries it',
    );
  });

  it("refuses an approval opening a CI run", () => {
    expect(approvalWithoutPage({ step: off({ url: CI_RUN }) })!.message).toBe(
      'url opens a CI run and the step asks the owner to "Approve the fix" — a CI log is not what the owner approves; pass the page that shows it, or the pull request',
    );
  });

  it("refuses an approval opening nothing", () => {
    const { url: _dropped, ...rest } = off({});
    expect(approvalWithoutPage({ step: rest })!.message).toBe(
      'url is missing and the step asks the owner to "Approve the fix" — pass the page that shows what the owner approves, or the pull request, so the note\'s Open button lands on it',
    );
  });

  it.each([
    PROOF,
    PR,
    "http://localhost:3000/queue?open=ask%3Agateway-down",
    "https://linear.app/acme/issue/ENG-1",
    "http://127.0.0.1:8792/release-plan.html",
  ])("admits an approval opening %j", (url) => {
    expect(approvalWithoutPage({ step: off({ url }) })).toBeUndefined();
  });

  it.each([
    "Approve the push on your phone",
    "Approve the sign-in prompt on the laptop",
    "Tap Approve in the Duo app",
    "Approve it in the macOS dialog",
    "Sign in and approve the SSO change in JumpCloud",
    "Say whether we approved the fix yesterday",
    "Tell Sadie we do not approve the deploy window",
    "Tell Sadie we don't approve the deploy window",
    "Say whether you approve of the release notes",
    "Read and approve the post-mortem timeline",
    "Approve the deployment window in the calendar",
    "Approve it in the dialog; release notes follow",
    "Approve it: release notes follow",
    "Approve the one long weekend roster change",
    "Approve the macOS change in the system dialog",
    "Approve the login item change in System Settings",
    "Approve the keychain access change",
    "Approve the new passkey change on your YubiKey",
  ])("leaves %j — no fleet work asked for", (what) => {
    expect(approvalWithoutPage({ step: off({ what }) })).toBeUndefined();
  });

  it.each([
    ["Approve the team post for the gateway incident", "Approve the team post"],
    ["Approve PR #1234 for staging", "Approve PR"],
    ["Approve the parked draft to Sadie", "Approve the parked draft"],
    ["Please approve this pull request", "approve this pull request"],
    ["Approve the urgent production fix", "Approve the urgent production fix"],
    ["Approve this revised release plan", "Approve this revised release"],
    ["Approve the follow-up fix", "Approve the follow-up fix"],
  ])("reads %j as an approval", (what, phrase) => {
    expect(approvalWithoutPage({ step: off({ what }) })!.message).toContain(`"${phrase}"`);
  });
});

describe("postingRefusal", () => {
  it("refuses the note on the incident rule, before any other", () => {
    expect(postingRefusal({ step: step() })!.message).toBe(
      `url opens the console on a step for an incident's row — the owner lands on the Queue, not on the proof — ${HINT}`,
    );
  });

  it("refuses the same note on the receipts page for its headline, which still leads with the fix PR", () => {
    expect(postingRefusal({ step: step({ url: PROOF }) })!.message).toContain(
      'what leads with a pull request ("Approve the fix") instead of the discussion',
    );
  });

  it("admits the note once it opens the receipts page and leads with what was noticed", () => {
    const what = "The fixture prod gateway has returned only 5xx since the deploy: should we share it with the team?";
    expect(postingRefusal({ step: step({ url: PROOF, what }) })).toBeUndefined();
  });
});
