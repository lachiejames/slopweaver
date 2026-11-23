/*
 * `classifyRawCommand` on a one-shot CI run, job or log read: `gh run view --log*` and a `gh api` fetch of an Actions
 * run, job or log are refused and pointed at `github run-log`/`github checks --log`; a plain run summary and every
 * other Actions endpoint still pass, and a DELETE of a log is still judged a write.
 */
import { describe, expect, it } from "vitest";

import { classifyGhRead } from "../../../../admit/rawGhReadRoute.js";
import { classifyRawCommand, RAW_ESCAPE } from "../../../../admit/rawTools.js";
import { blockedMessage, isBlocked } from "./harness.js";

/** The two doored replacements every run-log refusal must name. */
const CHECKS_LOG = "slopweaver github checks --number <n> --log";
const RUN_LOG = "slopweaver github run-log <run-id> [--job <name>]";

describe("classifyGhRead", () => {
  it("keys a log read, a run-id watch and a PR-checks watch on three distinct categories", () => {
    const logRead = classifyGhRead({
      group: "run",
      loopWrapped: false,
      rest: ["run", "view", "1", "--log"],
      sub: "view",
    });
    const runWatch = classifyGhRead({ group: "run", loopWrapped: false, rest: ["run", "watch", "1"], sub: "watch" });
    const prWatch = classifyGhRead({ group: "pr", loopWrapped: true, rest: ["pr", "checks", "1"], sub: "checks" });
    expect(logRead!.category).toBe("governed-read-run-log");
    expect(runWatch!.reason).toBe("`gh run watch` polls a workflow run outside the door");
    expect(prWatch!.category).toBe("governed-read-watch");
  });

  it("names the `--watch` flag in a `gh run view --watch` reason, ahead of a `--log` on the same call", () => {
    const verdict = classifyGhRead({
      group: "run",
      loopWrapped: false,
      rest: ["run", "view", "1", "--watch", "--log"],
      sub: "view",
    });
    expect(verdict!.category).toBe("ungoverned-read-watch");
    expect(verdict!.reason).toBe("`gh run view --watch` polls a workflow run outside the door");
  });

  it("returns undefined for an ordinary read", () => {
    expect(classifyGhRead({ group: "pr", loopWrapped: false, rest: ["pr", "view", "1"], sub: "view" })).toBe(undefined);
  });
});

describe("classifyRawCommand", () => {
  describe("a raw CI run, job or log read routes to the run-log verbs", () => {
    it("blocks `gh run view --log-failed`, naming both verbs and the escape", () => {
      const message = blockedMessage({ command: "gh run view 35502228255 --log-failed" });
      expect(message).toContain(CHECKS_LOG);
      expect(message).toContain(RUN_LOG);
      expect(message).toContain(RAW_ESCAPE);
      expect(message).toContain("raw gh reads a CI run, job or log outside the door");
    });

    it("blocks `gh run view --log`, its `=` form, and the `--job` read", () => {
      expect(isBlocked({ command: "gh run view 123 --log" })).toBe(true);
      expect(isBlocked({ command: "gh run view --job 106055916296 --log" })).toBe(true);
      expect(isBlocked({ command: "gh run view 123 --log=true" })).toBe(true);
      expect(isBlocked({ command: "gh run view 123 '--log'" })).toBe(true);
      expect(isBlocked({ command: "gh run view 123 --jq '\"--log\"' --json jobs" })).toBe(false);
    });

    it("blocks the read piped through a filter, and inside a compound line", () => {
      expect(isBlocked({ command: "gh run view 123 --log-failed | tail -200" })).toBe(true);
      expect(isBlocked({ command: "cd /x && gh run view 123 --log" })).toBe(true);
    });

    it("blocks a `gh api` fetch of a job log, a run log and an attempt's log", () => {
      expect(blockedMessage({ command: "gh api repos/acme/app/actions/jobs/106055916296/logs" })).toContain(RUN_LOG);
      expect(isBlocked({ command: "gh api /repos/acme/app/actions/runs/123/logs > logs.zip" })).toBe(true);
      expect(isBlocked({ command: "gh api repos/acme/app/actions/runs/123/attempts/2/logs" })).toBe(true);
    });

    it("blocks a `gh api` fetch of a run, a run's jobs and one job", () => {
      expect(isBlocked({ command: "gh api repos/acme/app/actions/runs/123" })).toBe(true);
      expect(isBlocked({ command: "gh api 'repos/{owner}/{repo}/actions/runs/123/jobs?per_page=100'" })).toBe(true);
      expect(isBlocked({ command: "gh api repos/acme/app/actions/jobs/$JOB" })).toBe(true);
      expect(
        isBlocked({ command: "gh api https://api.github.com/repos/acme/app/actions/runs/1/attempts/1/jobs" }),
      ).toBe(true);
    });

    it("finds the path behind a flag whose value splits into words", () => {
      expect(
        isBlocked({ command: "gh api -H 'Accept: application/vnd.github+json' repos/acme/app/actions/jobs/9/logs" }),
      ).toBe(true);
      expect(isBlocked({ command: "gh api --paginate repos/acme/app/actions/runs/9/jobs --jq '.jobs[].name'" })).toBe(
        true,
      );
    });

    it("still judges a DELETE of a run's logs as a write, not a read", () => {
      const message = blockedMessage({ command: "gh api -X DELETE repos/acme/app/actions/runs/123/logs" });
      expect(message).toContain("raw gh mutates GitHub outside the door");
      expect(message).not.toContain(RUN_LOG);
    });

    it("judges an attached field flag as the write it is, spaced or attached", () => {
      const attached = blockedMessage({ command: "gh api repos/acme/app/actions/runs/123 --raw-field=foo=bar" });
      expect(attached).toContain("raw gh mutates GitHub outside the door");
      expect(blockedMessage({ command: "gh api repos/acme/app/issues/1/comments -fbody=hi" })).toContain(
        "raw gh mutates GitHub outside the door",
      );
    });

    it("allows a plain `gh run view <id>` and Actions endpoints no run-log verb replaces", () => {
      expect(isBlocked({ command: "gh run view 123456" })).toBe(false);
      expect(isBlocked({ command: "gh run list --limit 5" })).toBe(false);
      expect(isBlocked({ command: "gh api repos/acme/app/actions/runs/123/artifacts" })).toBe(false);
      expect(isBlocked({ command: "gh api repos/acme/app/actions/runs?branch=main" })).toBe(false);
      expect(isBlocked({ command: "gh api repos/acme/app/actions/workflows" })).toBe(false);
      expect(isBlocked({ command: "gh api repos/acme/app/pulls/1" })).toBe(false);
      expect(isBlocked({ command: "gh run view 123 --json jobs" })).toBe(false);
      expect(isBlocked({ command: "gh api repos/acme/app/actions/runs/123/timing" })).toBe(false);
      expect(isBlocked({ command: "gh api repos/acme/app/actions/jobs/9/logs/extra" })).toBe(false);
    });

    it("reads the path segment by segment: a trailing slash and an attempt match, a blank owner does not", () => {
      expect(isBlocked({ command: "gh api repos/acme/app/actions/runs/123/" })).toBe(true);
      expect(isBlocked({ command: "gh api repos/acme/app/actions/runs/123/attempts/2" })).toBe(true);
      expect(isBlocked({ command: "gh api repos//app/actions/runs/123" })).toBe(false);
      expect(isBlocked({ command: "gh api repos/acme/app/actions/runs/123/attempts/2/timing" })).toBe(false);
      expect(isBlocked({ command: "gh api 'repos/a?x/b/actions/runs/1'" })).toBe(false);
    });

    it("strips the API host only as a whole segment, never a lookalike prefix", () => {
      expect(isBlocked({ command: "gh api https://api.github.com/repos/acme/app/actions/runs/1/" })).toBe(true);
      expect(isBlocked({ command: "gh api https://api.github.com.evil/repos/acme/app/actions/runs/1" })).toBe(false);
      expect(isBlocked({ command: "gh api http://api.github.com/repos/acme/app/actions/runs/1" })).toBe(false);
      // Host `api.github.comrepos` is not GitHub's: a string-prefix strip read it as the API host and refused it.
      expect(isBlocked({ command: "gh api https://api.github.comrepos/acme/app/actions/runs/1" })).toBe(false);
    });

    it("blocks a log read that is a loop's condition, and a backslash-spelled path", () => {
      expect(blockedMessage({ command: "until gh run view 1 --log-failed; do sleep 5; done" })).toContain(RUN_LOG);
      expect(isBlocked({ command: "gh api repos/acme/app/actions/j\\obs/9/logs" })).toBe(true);
    });

    it("reads only the endpoint, never a flag value shaped like an Actions path", () => {
      expect(isBlocked({ command: `gh api repos/acme/app/pulls/1 --jq '"repos/acme/app/actions/runs/123"'` })).toBe(
        false,
      );
      expect(isBlocked({ command: "gh api --jq 'repos/acme/app/actions/jobs/9/logs' repos/acme/app/pulls/1" })).toBe(
        false,
      );
      expect(isBlocked({ command: "gh api --jq '.jobs[] | .name' 'repos/acme/app/actions/runs/9/jobs'" })).toBe(true);
      expect(isBlocked({ command: "gh api -H X-Test:\\ repos/acme/app/actions/runs/123 repos/acme/app/pulls/1" })).toBe(
        false,
      );
    });

    it("leaves the doored verbs themselves alone", () => {
      expect(isBlocked({ command: "slopweaver github run-log 123 --job lint" })).toBe(false);
      expect(isBlocked({ command: "slopweaver github checks --number 1 --log" })).toBe(false);
    });

    it("admits the read under the escape hatch, naming the tool", () => {
      const verdict = classifyRawCommand({ allowRaw: true, command: "gh run view 123 --log-failed" });
      expect(verdict.blocked).toBe(false);
      expect(verdict.tool).toBe("gh");
    });
  });
});
