/*
 * The files a Queue card's words name and the files a board row's words name are one grammar.
 *
 * `site/lib/cardFiles.ts` restates `src/talk/namedFiles.ts` because a file under `site/` may not import one under
 * `src/`; this file, in the lane that reaches both roots, drives one table through both so a change to either that
 * the other misses fails here.
 */

import { describe, expect, it } from "vitest";

import { localFilesNamed } from "../../../src/talk/namedFiles";
import { cardFilesNamed } from "../../lib/cardFiles";

const TEXTS: readonly (readonly string[])[] = [
  [
    "The prototype is ready. Folder: ~/dev/acme-desktop-tauri (local git, nothing pushed). Built app: " +
      "src-tauri/target/release/bundle/macos/acme.com. Reads latest.json and GET /v1/people/{id}. " +
      "Plan: PLAN.md in the folder.",
  ],
  ["Plan: /Users/someone/dev/acme-desktop-tauri/PLAN.md. AUTH: Google desktop sign-in."],
  ["Page: file:///Users/someone/.slopweaver/pages/plan/index.html and https://example.com/Users/x/notes.md"],
  ["Plan: PLAN.md in the folder."],
  ["Folders ~/dev/one and ~/dev/two; Plan: PLAN.md."],
  ["Folder: ~/dev/app", "Plan: PLAN.md"],
  ["see ~/notes/a.md and /tmp/b.txt", "", "again ~/notes/a.md"],
  ["Folder: ~/dev/app/. Built ~/dev/app/out/report.pdf; summary in NOTES.md and proposal.final.md."],
  ['Under /private/tmp/run-1/out.html, (see `~/x/y.md`) and "~/q/r.txt".'],
  [],
];

describe("cardFilesNamed", () => {
  it("names exactly the files the board row's reading names, over every case", () => {
    expect(TEXTS.length).toBeGreaterThan(0);
    for (const texts of TEXTS) {
      expect(cardFilesNamed({ texts })).toEqual(localFilesNamed({ texts }));
    }
  });

  it("finds the Tauri card's plan file, so the table is not two readers agreeing on nothing", () => {
    expect(cardFilesNamed({ texts: TEXTS[0] })).toEqual(["~/dev/acme-desktop-tauri/PLAN.md"]);
  });
});
