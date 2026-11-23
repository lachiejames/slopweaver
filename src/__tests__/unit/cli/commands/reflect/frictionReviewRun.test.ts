/**
 * `reflect friction-review --republish` against a real temp `$SLOPWEAVER_HOME` (testing.md's fixture
 * allowance): the page and the stamp land together, and neither lands when the republish cannot happen. The page
 * goes to the store alone, so what was published is read off a recording store write, never off a folder.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runFrictionReviewAt } from "../../../../../cli/commands/reflect/frictionReviewRun.js";
import { readFrictionReviewPublishStamp } from "../../../../../reflect/frictionReviewPublish.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { localPagePublisher, publisherWith, recordingWriter, refusingWriter } from "../../../../pagePublisherFake.js";

const NOW = new Date("2026-10-14T21:00:00.000Z");

const tempHomes: string[] = [];

afterEach(() => {
  tempHomes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A temp home holding one report for `date`, with the given body. */
function homeWithReport({ date, body }: { date: string; body: string }): string {
  const home = mkdtempSync(join(tmpdir(), "friction-review-run-test-"));
  tempHomes.push(home);
  const morning = stateHomePaths({ home }).morning;
  mkdirSync(morning, { recursive: true });
  writeFileSync(join(morning, `self-improvement-${date}.md`), body);
  return home;
}

const REPORT = "# Self-improvement mining, 2026-10-14\n\n## Surfaced\n\n- board: a-row\n";

describe("reflect friction-review --republish", () => {
  it("publishes the newest report as its day's page and stamps that day", async () => {
    const home = homeWithReport({ body: REPORT, date: "2026-10-14" });
    const { writer, written } = recordingWriter();

    expect(
      await runFrictionReviewAt({
        now: NOW,
        publish: publisherWith({ writer }),
        rest: ["--republish", "--home", home],
      }),
    ).toBe(0);

    expect(written.map((page) => page.slug)).toStrictEqual(["friction-review-14oct"]);
    expect(written[0]!.document).toContain("<h1>Self-improvement mining, 2026-10-14</h1>");
    expect(written[0]!.document).toContain("<li>board: a-row</li>");
    expect(existsSync(stateHomePaths({ home }).pages)).toBe(false);
    expect(readFrictionReviewPublishStamp({ home })).toStrictEqual({
      localDate: "2026-10-14",
      publishedAtIso: "2026-10-14T21:00:00.000Z",
    });
  });

  it("stamps nothing when the store write fails, and leaves nothing on disk", async () => {
    const home = homeWithReport({ body: REPORT, date: "2026-10-14" });
    const publish = publisherWith({ writer: refusingWriter({ line: "the store is down" }) });

    expect(await runFrictionReviewAt({ now: NOW, publish, rest: ["--republish", "--home", home] })).toBe(1);

    expect(existsSync(stateHomePaths({ home }).pages)).toBe(false);
    expect(readFrictionReviewPublishStamp({ home })).toBeUndefined();
  });

  it("refuses a stale report and writes neither the page nor the stamp", async () => {
    const home = homeWithReport({ body: REPORT, date: "2026-10-01" });
    const { writer, written } = recordingWriter();

    expect(
      await runFrictionReviewAt({
        now: NOW,
        publish: publisherWith({ writer }),
        rest: ["--republish", "--home", home],
      }),
    ).toBe(3);

    expect(written).toStrictEqual([]);
    expect(readFrictionReviewPublishStamp({ home })).toBeUndefined();
  });

  it("stamps nothing when the report cannot be rendered", async () => {
    const home = homeWithReport({ body: "no heading here\n", date: "2026-10-14" });
    const { writer, written } = recordingWriter();

    expect(
      await runFrictionReviewAt({
        now: NOW,
        publish: publisherWith({ writer }),
        rest: ["--republish", "--home", home],
      }),
    ).toBe(1);

    expect(written).toStrictEqual([]);
    expect(readFrictionReviewPublishStamp({ home })).toBeUndefined();
  });

  it("refuses with nothing to publish on a home that never wrote a report", async () => {
    const home = mkdtempSync(join(tmpdir(), "friction-review-run-test-"));
    tempHomes.push(home);

    expect(
      await runFrictionReviewAt({ now: NOW, publish: localPagePublisher, rest: ["--republish", "--home", home] }),
    ).toBe(1);

    expect(readFrictionReviewPublishStamp({ home })).toBeUndefined();
  });

  it("fails on a morning path it cannot list, rather than reading it as no report", async () => {
    const home = mkdtempSync(join(tmpdir(), "friction-review-run-test-"));
    tempHomes.push(home);
    writeFileSync(stateHomePaths({ home }).morning, "a file where the reports directory should be\n");

    // A home with no reports at all reads 0 with no closing flag; an unlistable one must not.
    expect(await runFrictionReviewAt({ now: NOW, publish: localPagePublisher, rest: ["--home", home] })).toBe(1);
    expect(
      await runFrictionReviewAt({ now: NOW, publish: localPagePublisher, rest: ["--republish", "--home", home] }),
    ).toBe(1);

    expect(readFrictionReviewPublishStamp({ home })).toBeUndefined();
  });

  it("fails on a morning symlink to nowhere, rather than reading it as a home with no reports", async () => {
    const home = mkdtempSync(join(tmpdir(), "friction-review-run-test-"));
    tempHomes.push(home);
    symlinkSync(join(home, "gone"), stateHomePaths({ home }).morning);

    expect(await runFrictionReviewAt({ now: NOW, publish: localPagePublisher, rest: ["--home", home] })).toBe(1);
  });

  it("refuses both closing flags together before touching the home", async () => {
    const home = homeWithReport({ body: REPORT, date: "2026-10-14" });
    const { writer, written } = recordingWriter();

    expect(
      await runFrictionReviewAt({
        now: NOW,
        publish: publisherWith({ writer }),
        rest: ["--republish", "--mark-published", "--home", home],
      }),
    ).toBe(2);

    expect(written).toStrictEqual([]);
    expect(readFrictionReviewPublishStamp({ home })).toBeUndefined();
  });

  it("reads the gap under --home without a closing flag, and writes nothing", async () => {
    const home = homeWithReport({ body: REPORT, date: "2026-10-14" });

    expect(await runFrictionReviewAt({ now: NOW, publish: localPagePublisher, rest: ["--home", home, "--json"] })).toBe(
      3,
    );

    expect(readFrictionReviewPublishStamp({ home })).toBeUndefined();
  });
});
