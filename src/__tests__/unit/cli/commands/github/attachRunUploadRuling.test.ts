/**
 * `github attach upload` behind the owner's recorded attach-upload ruling: refused before the file is read or the
 * session touched until a ruling permits it, a recording included, and a dry run previewing the same refusal.
 */
import { describe, expect, it } from "vitest";

import { runGithubAttach } from "../../../../../cli/commands/github/attachRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { type AttachUploadStanding, attachUploadRefusalLines } from "../../../../../handover/attachUploadRuling.js";
import { recordedCassette } from "../../../../attachEvidenceFixture.js";
import { attachRunHarness, HAPPY, PERMITTED_ATTACH_UPLOAD } from "../../../../attachRunFixture.js";

/** Attach upload no ruling has permitted: the standing on every install until the owner rules. */
const UNRULED_ATTACH_UPLOAD: Extract<AttachUploadStanding, { kind: "refused" }> = {
  because: "unruled",
  kind: "refused",
};

const { fixtureFile, makeDeps } = attachRunHarness();

const argvFor = ({ path }: { path: string }): readonly string[] => [
  "upload",
  "--file",
  path,
  "--repo",
  "slopweaver/slopweaver",
  "--number",
  "485",
  "--proves",
  "the unit suite passes",
];

describe("runGithubAttach — upload behind the owner's ruling", () => {
  it("refuses before reading the file or touching the session when no ruling permits it", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps, door } = makeDeps({ attachUpload: UNRULED_ATTACH_UPLOAD, filePath: path, replies: HAPPY });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect([
      captured.diagnostics[0],
      captured.diagnostics[2],
      captured.out,
      captured.recognised.length,
      door.store.rows.length,
    ]).toEqual([
      "refused: attach-upload: `slopweaver github attach upload` sends no picture or recording off this machine",
      "  no ruling on this install decides it, and an unrecorded answer is not a yes.",
      [],
      0,
      0,
    ]);
  });

  it("refuses a recording too, and names the owner's refusing ruling", async () => {
    const path = fixtureFile({ bytes: 4, name: "clip.mp4" });
    const ruling = {
      ...PERMITTED_ATTACH_UPLOAD.by.ruling,
      attachUpload: { verdict: "refused" as const },
      ruling: "no pictures",
    };
    const refused: AttachUploadStanding = { because: "ruled", by: { ruling, slug: "a-row" }, kind: "refused" };
    const { captured, deps } = makeDeps({
      attachUpload: refused,
      filePath: path,
      picture: recordedCassette(),
      replies: HAPPY,
    });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.slice(2, 4)).toEqual([
      "  the owner ruled it refused on a-row: no pictures",
      "    where: talk:p1",
    ]);
  });
});

describe("runGithubAttach — dry run behind the owner's ruling", () => {
  it("previews a refused upload with the very block the real upload prints, still sending nothing", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ attachUpload: UNRULED_ATTACH_UPLOAD, filePath: path, replies: [] });
    const code = await runGithubAttach({
      deps,
      rest: ["upload", "--file", path, "--repo", "o/r", "--number", "7", "--proves", "it passes", "--dry-run"],
    });
    const block = attachUploadRefusalLines({ standing: UNRULED_ATTACH_UPLOAD });
    expect(code).toBe(EXIT_OK);
    expect(captured.out.slice(0, block.length + 2)).toEqual([
      ...block,
      "attach upload is refused: no ruling on this install permits it",
      "would refuse to upload shot.png (image/png, 4 of 10485760 bytes allowed)",
    ]);
  });

  it("carries the refusal block in the JSON plan, and an empty one when permitted", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const argv = [
      "upload",
      "--file",
      path,
      "--repo",
      "o/r",
      "--number",
      "7",
      "--proves",
      "it passes",
      "--dry-run",
      "--json",
    ];
    const refused = makeDeps({ attachUpload: UNRULED_ATTACH_UPLOAD, filePath: path, replies: [] });
    const permitted = makeDeps({ filePath: path, replies: [] });
    await runGithubAttach({ deps: refused.deps, rest: argv });
    await runGithubAttach({ deps: permitted.deps, rest: argv });
    const planOf = ({ out }: { out: readonly string[] }): { outcome: string; refusalLines: string[] } =>
      JSON.parse(out[0]!) as { outcome: string; refusalLines: string[] };
    expect([planOf({ out: refused.captured.out }), planOf({ out: permitted.captured.out })]).toMatchObject([
      {
        outcome: "would refuse: attach upload is not permitted",
        refusalLines: attachUploadRefusalLines({ standing: UNRULED_ATTACH_UPLOAD }),
      },
      { outcome: "would upload", refusalLines: [] },
    ]);
  });
});
