/** `route profile-answer` validates a real drafted answer against a real pinned brief. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseRouteProfileAnswerArgs,
  routeProfileAnswerCommand,
  runRouteProfileAnswer,
} from "../../../../../cli/commands/route/profileAnswer.js";
import { runRouteProfileBrief } from "../../../../../cli/commands/route/profileBrief.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { routeManifest } from "../../../../../cli/manifests/route.js";
import { sha256Text } from "../../../../../lib/hash.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { loadJudgementProfile } from "../../../../../live/turn/judgementProfileStore.js";
import { balancedRouting } from "../../../../balancedRouting.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-route-profile-answer-home-"));
  fixtureDirs.push(dir);
  return dir;
}

/** Run a real profile-brief first, so a real pinned brief exists for the answer step to validate against. */
function pinBrief({ home }: { home: string }): void {
  const sourceRoot = mkdtempSync(join(tmpdir(), "slopweaver-route-profile-answer-source-"));
  fixtureDirs.push(sourceRoot);
  writeFileSync(join(sourceRoot, "note.md"), "some first-person writing", "utf8");
  const manifestDir = mkdtempSync(join(tmpdir(), "slopweaver-route-profile-answer-manifest-"));
  fixtureDirs.push(manifestDir);
  const sourcesPath = join(manifestDir, "sources.json");
  writeFileSync(sourcesPath, JSON.stringify([{ label: "test-source", path: sourceRoot }]), "utf8");
  const exit = runRouteProfileBrief([
    "node",
    "slopweaver",
    "route",
    "profile-brief",
    "--sources",
    sourcesPath,
    "--home",
    home,
    "--json",
  ]);
  expect(exit).toBe(EXIT_OK);
}

function writeAnswer({ text }: { text: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-route-profile-answer-draft-"));
  fixtureDirs.push(dir);
  const path = join(dir, "answer.json");
  writeFileSync(
    path,
    JSON.stringify({
      routing: balancedRouting(),
      voice: { examples: [{ sourceHash: sha256Text({ text }), text }], principles: [text] },
    }),
    "utf8",
  );
  return path;
}

describe("route profile-answer", () => {
  it("parses the required --answer flag", () => {
    expect(parseRouteProfileAnswerArgs({ rest: ["--answer", "/tmp/answer.json", "--json"] }).isOk()).toBe(true);
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseRouteProfileAnswerArgs({ rest: ["--unknown"] }))).toEqual(["unknown flag: --unknown"]);
  });

  it("requires the explicit JSON hand-off mode", () => {
    expect(
      runRouteProfileAnswer(["node", "slopweaver", "route", "profile-answer", "--answer", "/tmp/answer.json"]),
    ).toBe(EXIT_USAGE);
  });

  it("fails loudly when no brief is pinned yet", () => {
    const home = freshHome();
    const answerPath = writeAnswer({ text: "reply tersely" });
    expect(
      runRouteProfileAnswer([
        "node",
        "slopweaver",
        "route",
        "profile-answer",
        "--answer",
        answerPath,
        "--home",
        home,
        "--json",
      ]),
    ).toBe(EXIT_ERROR);
  });

  it("accepts a self-consistent answer and writes the private profile", () => {
    const home = freshHome();
    pinBrief({ home });
    const answerPath = writeAnswer({ text: "reply tersely, lead with the outcome" });
    const exit = runRouteProfileAnswer([
      "node",
      "slopweaver",
      "route",
      "profile-answer",
      "--answer",
      answerPath,
      "--home",
      home,
      "--json",
    ]);
    expect(exit).toBe(EXIT_OK);
    const outcome = loadJudgementProfile({ home });
    expect(outcome.kind).toBe("profile");
  });

  it("refuses an answer whose routing has no act side, and writes nothing", () => {
    const home = freshHome();
    pinBrief({ home });
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-route-profile-answer-skewed-"));
    fixtureDirs.push(dir);
    const answerPath = join(dir, "answer.json");
    const routing = balancedRouting();
    writeFileSync(
      answerPath,
      JSON.stringify({
        routing: { ...routing, principles: routing.principles.filter((entry) => entry.decision !== "act") },
        voice: { examples: [], principles: [] },
      }),
      "utf8",
    );
    const exit = runRouteProfileAnswer([
      "node",
      "slopweaver",
      "route",
      "profile-answer",
      "--answer",
      answerPath,
      "--home",
      home,
      "--json",
    ]);
    expect(exit).toBe(EXIT_ERROR);
    expect(loadJudgementProfile({ home }).kind).toBe("absent");
  });

  it("refuses a self-inconsistent answer and writes nothing", () => {
    const home = freshHome();
    pinBrief({ home });
    const badDir = mkdtempSync(join(tmpdir(), "slopweaver-route-profile-answer-bad-"));
    fixtureDirs.push(badDir);
    const answerPath = join(badDir, "answer.json");
    writeFileSync(
      answerPath,
      JSON.stringify({
        routing: { counterexamples: [], examples: [], principles: [] },
        voice: { examples: [{ sourceHash: `sha256:${"0".repeat(64)}`, text: "tampered" }], principles: [] },
      }),
      "utf8",
    );
    const exit = runRouteProfileAnswer([
      "node",
      "slopweaver",
      "route",
      "profile-answer",
      "--answer",
      answerPath,
      "--home",
      home,
      "--json",
    ]);
    expect(exit).toBe(EXIT_ERROR);
    expect(loadJudgementProfile({ home }).kind).toBe("absent");
  });

  it("exposes the manifest-selected command as a local-state write", () => {
    expect(routeProfileAnswerCommand).toBe(runRouteProfileAnswer);
    expect(routeManifest["profile-answer"]?.meta.effect).toBe("local-state");
  });
});
