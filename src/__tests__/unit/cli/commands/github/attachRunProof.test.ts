import { describe, expect, it } from "vitest";
import { runGithubAttach } from "../../../../../cli/commands/github/attachRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readUploadReceipt } from "../../../../../outbound/github/attachReceipt.js";
import { ImageTextErrors } from "../../../../../visualEvidence/imageTextRecognition.js";
import { recordedCassette, SIGNED_ASSET_URL, servingReadBack } from "../../../../attachEvidenceFixture.js";
import { attachRunHarness, HAPPY, RECEIPT_ID } from "../../../../attachRunFixture.js";

const { fixtureFile, makeDeps, picture } = attachRunHarness();

/**
 * An upload as proof: the capture receipt that must name the bytes, the read-back that must match them, and the
 * upload receipt a description cites. The verb's usage, session and ledger behaviour is `./attachRun.test.ts`'s.
 */
describe("runGithubAttach — upload as proof", () => {
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

  it("files an upload receipt a description can cite, only after the read-back matched", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { deps, home } = makeDeps({ filePath: path, replies: HAPPY });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_OK);
    const receipt = unwrap(readUploadReceipt({ home, uploadReceiptId: RECEIPT_ID }));
    const shot = picture().receipt;
    expect(receipt.asset.href).toBe("https://github.com/user-attachments/assets/uuid-1");
    expect(receipt.image).toEqual({
      alt: "shot.png",
      captureId: shot.captureId,
      captureVerb: "browser terminal-shot",
      digest: shot.final.artifact.digest,
      heightPx: shot.final.artifact.heightPx,
      imageReceiptId: "rec-attachable",
      proves: "the unit suite passes",
      widthPx: shot.final.artifact.widthPx,
    });
    expect(receipt.readBack.digest).toBe(shot.final.artifact.digest);
    expect(receipt.target).toEqual({ number: 485, owner: "slopweaver", repo: "slopweaver" });
  });

  it("sends the cookie to github.com only, never to the signed attachment host", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const seen: { url: string; cookieHeader: string | undefined }[] = [];
    const { deps } = makeDeps({ filePath: path, replies: HAPPY });
    const watched = { ...deps, fetchAsset: servingReadBack({ seen, served: picture().bytes }) };
    expect(await runGithubAttach({ deps: watched, rest: argvFor({ path }) })).toBe(EXIT_OK);
    expect(seen).toEqual([
      { cookieHeader: "user_session=v", url: "https://github.com/user-attachments/assets/uuid-1" },
      { cookieHeader: undefined, url: SIGNED_ASSET_URL },
    ]);
  });

  it("writes no receipt and refuses when GitHub serves back different bytes", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps, home } = makeDeps({ filePath: path, replies: HAPPY });
    const swapped = { ...deps, fetchAsset: servingReadBack({ served: new Uint8Array([9, 9, 9]) }) };
    expect(await runGithubAttach({ deps: swapped, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.at(-1)).toContain("that was sent — do not embed it");
    expect(captured.out).toEqual([]);
    expect(unwrapErr(readUploadReceipt({ home, uploadReceiptId: RECEIPT_ID })).code).toBe("UPLOAD_RECEIPT_UNREADABLE");
  });

  it("refuses a picture with no capture receipt, uploads nothing, and records the hold", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps, door } = makeDeps({ evidence: false, filePath: path, replies: HAPPY });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.at(-1)).toContain("no capture receipt names these bytes");
    expect(captured.out).toEqual([]);
    expect(door.records()[0]!["status"]).toBe("hold");
  });

  it("refuses a picture whose frame text the scan flags, naming the surface", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: HAPPY });
    const flagging = {
      ...deps,
      textScanFor: () =>
        ok((input: { surface: string; text: string }) =>
          input.surface === "frame-text" && input.text.includes("PASS") ? ["a fixture term"] : [],
        ),
    };
    expect(await runGithubAttach({ deps: flagging, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.at(-1)).toContain("the picture shows a fixture term");
  });

  it("reads the picture's pixels once, from the very buffer it uploads", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: HAPPY });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_OK);
    expect(captured.recognised).toEqual([picture().bytes]);
  });

  it("holds a picture whose pixels show what the scan flags, uploads nothing, and records the hold", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps, door } = makeDeps({
      filePath: path,
      pixelText: ok({ lines: ["Acme Widgets"] }),
      replies: HAPPY,
    });
    const flagging = {
      ...deps,
      textScanFor: () =>
        ok((input: { surface: string; text: string }) =>
          input.surface === "pixel-text" && input.text.includes("Acme") ? ["a fixture term"] : [],
        ),
    };
    expect(await runGithubAttach({ deps: flagging, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.join("\n")).toContain("the picture's pixels show a fixture term");
    expect(captured.out).toEqual([]);
    expect(door.records()[0]!["status"]).toBe("hold");
  });

  it("holds a picture whose pixels could not be read, and uploads nothing", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps, door } = makeDeps({
      filePath: path,
      pixelText: err(ImageTextErrors.unsupportedHost({ hostOs: "linux" })),
      replies: HAPPY,
    });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.join("\n")).toContain(
      "the text the picture shows could not be read, so it cannot be checked: text in an image is read with macOS " +
        "Vision, and this host is linux",
    );
    expect(captured.out).toEqual([]);
    expect(door.records()[0]!["status"]).toBe("hold");
  });

  it("previews the pixel hold in a dry run, from the same single reading", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({
      filePath: path,
      pixelText: err(ImageTextErrors.timedOut({ timeoutMs: 150_000 })),
      replies: [],
    });
    const code = await runGithubAttach({
      deps,
      rest: ["upload", "--file", path, "--repo", "o/r", "--number", "7", "--proves", "it passes", "--dry-run"],
    });
    expect(code).toBe(EXIT_OK);
    expect(captured.out.join("\n")).toContain("the text recogniser did not finish within 150s");
    expect(captured.recognised.length).toBe(1);
  });

  it("reads no pixels of a recording, whose screens are its transcript", async () => {
    const path = fixtureFile({ bytes: 4, name: "demo.mp4" });
    const { captured, deps } = makeDeps({ filePath: path, picture: recordedCassette(), replies: HAPPY });
    await runGithubAttach({ deps, rest: argvFor({ path }) });
    expect(captured.recognised).toEqual([]);
  });

  it("refuses before the session is read or GitHub is fetched when the hygiene policy did not load", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps, door } = makeDeps({ filePath: path, replies: HAPPY });
    const contacted: string[] = [];
    const unloaded = {
      ...deps,
      fetchImpl: () => {
        contacted.push("fetch");
        return Promise.reject(new Error("fetched"));
      },
      loadCookies: () => {
        contacted.push("cookies");
        return Promise.resolve(ok("user_session=v"));
      },
      textScanFor: () => err("the private terms file is absent."),
    };
    expect(await runGithubAttach({ deps: unloaded, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics).toEqual(["refused: the private terms file is absent. nothing was sent."]);
    expect(contacted).toEqual([]);
    expect(door.records()).toEqual([]);
    expect(captured.out).toEqual([]);
  });

  it("refuses with no --proves line before reading anything", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: HAPPY });
    const rest = ["upload", "--file", path, "--repo", "o/r", "--number", "7"];
    expect(await runGithubAttach({ deps, rest })).toBe(EXIT_USAGE);
    expect(captured.diagnostics[0]).toContain('--proves "<one line: what the picture proves>" is required');
  });

  it("refuses a receipted PNG renamed .mp4, which is not the recording any receipt describes", async () => {
    const path = fixtureFile({ bytes: 4, name: "clip.mp4" });
    const { captured, deps } = makeDeps({ filePath: path, replies: HAPPY });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.at(-1)).toContain("the upload would be declared video/mp4");
    expect(captured.out).toEqual([]);
  });

  it("refuses a video no capture verb recorded", async () => {
    const path = fixtureFile({ bytes: 4, name: "demo.mp4" });
    const { captured, deps } = makeDeps({
      evidence: false,
      filePath: path,
      picture: recordedCassette(),
      replies: HAPPY,
    });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.join("\n")).toContain("no capture receipt names these bytes");
    expect(captured.out).toEqual([]);
  });

  it("sizes a video against its own ceiling, then refuses it at the receipt check rather than the size check", async () => {
    const path = fixtureFile({ bytes: 10485761, name: "clip.mp4" });
    const { captured, deps } = makeDeps({ filePath: path, replies: HAPPY });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.join("\n")).not.toContain("exceeds GitHub's measured ceiling");
    expect(captured.diagnostics.at(-1)).toContain("the upload would be declared video/mp4");
  });

  it("previews the picture checks' holds, through the refusal renderer, with no session needed", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ evidence: false, filePath: path, replies: [] });
    const code = await runGithubAttach({
      deps,
      rest: ["upload", "--file", path, "--repo", "o/r", "--number", "7", "--proves", "it passes", "--dry-run"],
    });
    expect(code).toBe(EXIT_OK);
    expect(captured.out.join("\n")).toContain("no capture receipt names these bytes");
  });
});
