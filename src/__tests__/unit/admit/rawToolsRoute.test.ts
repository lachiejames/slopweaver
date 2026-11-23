import { describe, expect, it } from "vitest";

import { gcloudCategory } from "../../../admit/rawGcloudRoute.js";
import { githubWriteCategory } from "../../../admit/rawGhWriteRoute.js";
import { reachDescription, reachingSegment, routeHint } from "../../../admit/rawToolsRoute.js";

describe("githubWriteCategory", () => {
  it("routes a reopen to cycle, a failed-jobs re-run to rerun, and an uncovered write to the generic hint", () => {
    expect([
      githubWriteCategory({ group: "pr", rest: ["pr", "reopen", "9876"], sub: "reopen" }),
      githubWriteCategory({ group: "run", rest: ["run", "rerun", "1", "--failed"], sub: "rerun" }),
      githubWriteCategory({ group: "run", rest: ["run", "rerun", "1"], sub: "rerun" }),
      githubWriteCategory({ group: "pr", rest: ["pr", "edit", "1", "--base=main"], sub: "edit" }),
      githubWriteCategory({ group: "pr", rest: ["pr", "edit", "1", "--title", "t"], sub: "edit" }),
    ]).toEqual([
      "supported-github-write-cycle",
      "supported-github-write-rerun",
      "other-github-write",
      "supported-github-write-retarget",
      "supported-github-write",
    ]);
  });
});

describe("routeHint", () => {
  it("points a failed-jobs re-run at the governed verb by its exact flags", () => {
    expect(routeHint({ category: "supported-github-write-rerun" })).toBe(
      "`slopweaver github rerun --repo <owner/name> --run-id <id>` (or `--number <n>` for a pull request's head)",
    );
  });

  it("points a reopen at the governed cycle verb, and says it never reopens a closed pull request", () => {
    expect(routeHint({ category: "supported-github-write-cycle" })).toBe(
      "`slopweaver github cycle --repo <owner/name> --number <n>` to close and reopen an OPEN pull request for fresh CI — no verb reopens one somebody closed",
    );
  });

  it("names no verb for a GitHub write that has none", () => {
    expect(routeHint({ category: "other-github-write" })).toBe(
      "a governed GitHub verb if one exists (`slopweaver catalog`), or the explicit break-glass below — this one has none yet",
    );
  });
});

describe("gcloudCategory", () => {
  const categoryOf = ({ command }: { command: string }): string => gcloudCategory({ tokens: command.split(" ") });

  it("points every call `slopweaver gcp` performs at it, past a global flag written before the group", () => {
    expect(
      [
        "gcloud run deploy svc --image x --region r",
        "gcloud run services describe svc --region r",
        "gcloud --project p secrets versions add s --data-file=f",
        "gcloud secrets versions disable 2 --secret s",
        "gcloud secrets versions access latest --secret s",
        "gcloud secrets add-iam-policy-binding s --member m --role r",
        "gcloud iam service-accounts create a",
        "gcloud services enable run.googleapis.com",
        "gcloud artifacts repositories create r --repository-format docker",
      ].map((command) => categoryOf({ command })),
    ).toEqual(Array.from({ length: 9 }, () => "gcp-governed"));
  });

  it("keeps the generic cloud hint for every call the door has no verb for", () => {
    expect(
      [
        "gcloud secrets list --project p",
        "gcloud logging read q",
        "gcloud projects add-iam-policy-binding p --member m --role r",
        "gcloud auth list",
        "gcloud run services delete svc",
        "gcloud run --region r services describe svc",
      ].map((command) => categoryOf({ command })),
    ).toEqual(Array.from({ length: 6 }, () => "cloud-cli"));
  });
});

describe("reachDescription", () => {
  it("names what each reaching class reaches", () => {
    expect(
      (["cloud-cli", "gcp-governed", "secrets-cli", "production-cli"] as const).map((category) =>
        reachDescription({ category }),
      ),
    ).toEqual([
      "a cloud control plane outside the door",
      "a cloud control plane outside the door",
      "a credential vault outside the door",
      "a production system outside the door",
    ]);
  });
});

describe("reachingSegment", () => {
  it("refines only a gcloud call by the door's cover, and keeps the table's reach in the reason", () => {
    expect([
      reachingSegment({ reaching: "cloud-cli", tokens: ["gcloud", "run", "deploy", "svc"], tool: "gcloud" }),
      reachingSegment({ reaching: "cloud-cli", tokens: ["gcloud", "logging", "read", "q"], tool: "gcloud" }),
      reachingSegment({ reaching: "secrets-cli", tokens: ["op", "read", "x"], tool: "op" }),
    ]).toEqual([
      { category: "gcp-governed", reason: "raw gcloud reaches a cloud control plane outside the door", tool: "gcloud" },
      { category: "cloud-cli", reason: "raw gcloud reaches a cloud control plane outside the door", tool: "gcloud" },
      { category: "secrets-cli", reason: "raw op reaches a credential vault outside the door", tool: "op" },
    ]);
  });
});
