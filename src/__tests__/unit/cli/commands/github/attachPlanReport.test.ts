/**
 * `reportUploadPlan` — the `--dry-run` plan of `github attach upload`, driven directly over the same prepared checks
 * the real upload judges: a permitted plan carries no refusal, a refused one leads with the real refusal block.
 */
import { describe, expect, it } from "vitest";

import { parseGithubAttachArgs } from "../../../../../cli/commands/github/attachCore.js";
import { reportUploadPlan } from "../../../../../cli/commands/github/attachPlanReport.js";
import { prepareUpload } from "../../../../../cli/commands/github/attachVerify.js";
import { type AttachUploadStanding, attachUploadRefusalLines } from "../../../../../handover/attachUploadRuling.js";
import { unwrap } from "../../../../../lib/result.js";
import { classifyAttachment } from "../../../../../outbound/github/attachment.js";
import { attachRunHarness, PERMITTED_ATTACH_UPLOAD } from "../../../../attachRunFixture.js";

const UNRULED: Extract<AttachUploadStanding, { kind: "refused" }> = { because: "unruled", kind: "refused" };

const { fixtureFile, makeDeps } = attachRunHarness();

/** Print one plan for a 4-byte picture under `standing`, and hand back every line it wrote. */
function planFor({ json, standing }: { json: boolean; standing: AttachUploadStanding }): readonly string[] {
  const path = fixtureFile({ bytes: 4, name: "shot.png" });
  const { captured, deps, home } = makeDeps({ attachUpload: standing, filePath: path });
  const rest = ["upload", "--file", path, "--repo", "o/r", "--number", "7", "--proves", "it passes", "--dry-run"];
  const args = unwrap(parseGithubAttachArgs({ rest: json ? [...rest, "--json"] : rest }));
  if (args.kind !== "upload") {
    throw new Error(`parsed the ${args.kind} sub-verb, not upload`);
  }
  const classified = unwrap(classifyAttachment({ byteLength: 4, fileName: "shot.png" }));
  const prepared = unwrap(prepareUpload({ args, classified, deps, home, scan: () => [] }));
  reportUploadPlan({ args, classified, deps, prepared, standing });
  return captured.out;
}

describe("reportUploadPlan", () => {
  it("prints a permitted plan with no refusal block", () => {
    expect(planFor({ json: false, standing: PERMITTED_ATTACH_UPLOAD }).slice(0, 2)).toEqual([
      "attach upload is permitted by the owner's ruling on a-row (talk:p1)",
      "would upload shot.png (image/png, 4 of 10485760 bytes allowed)",
    ]);
  });

  it("leads a refused plan with the real refusal block, in text and in JSON", () => {
    const block = attachUploadRefusalLines({ standing: UNRULED });
    const text = planFor({ json: false, standing: UNRULED });
    const json = JSON.parse(planFor({ json: true, standing: UNRULED })[0]!) as { refusalLines: string[] };
    expect([text.slice(0, block.length), json.refusalLines]).toEqual([block, block]);
  });
});
