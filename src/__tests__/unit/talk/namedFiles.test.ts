/**
 * The local files a card's or row's words name — the Tauri card's own words first.
 */
import { describe, expect, it } from "vitest";

import { localFilesNamed } from "../../../talk/namedFiles.js";

/** The Tauri run's recorded question as it stood when recorded, cut to the sentences that place the plan. */
const TAURI_CARD =
  "The prototype is ready: do you want to try it? Folder: ~/dev/acme-desktop-tauri (local git, nothing pushed). " +
  "Run: npm run broker, then npm run app. Built app: src-tauri/target/release/bundle/macos/acme.com, unsigned. " +
  "Tauri's updater reads latest.json from the GCS bucket. The endpoint reads GET /v1/people/{id}. " +
  "Plan: PLAN.md in the folder.";

describe("localFilesNamed", () => {
  it("joins the card's bare plan name to the one folder it names, and takes no API route, app or JSON for a file", () => {
    expect(localFilesNamed({ texts: [TAURI_CARD] })).toEqual(["~/dev/acme-desktop-tauri/PLAN.md"]);
  });

  it("takes an absolute path as written, its sentence's full stop dropped", () => {
    const text = "Plan: /Users/someone/dev/acme-desktop-tauri/PLAN.md. AUTH: Google desktop sign-in.";
    expect(localFilesNamed({ texts: [text] })).toEqual(["/Users/someone/dev/acme-desktop-tauri/PLAN.md"]);
  });

  it("never takes a path inside an address", () => {
    const text =
      "Page: file:///Users/someone/.slopweaver/pages/plan/index.html and https://example.com/Users/x/notes.md";
    expect(localFilesNamed({ texts: [text] })).toEqual([]);
  });

  it("leaves a bare name alone when the text names no folder, or two", () => {
    expect(localFilesNamed({ texts: ["Plan: PLAN.md in the folder."] })).toEqual([]);
    const two = "Folders ~/dev/one and ~/dev/two; Plan: PLAN.md.";
    expect(localFilesNamed({ texts: [two] })).toEqual([]);
  });

  it("never joins one text's folder to another text's bare name", () => {
    expect(localFilesNamed({ texts: ["Folder: ~/dev/app", "Plan: PLAN.md"] })).toEqual([]);
  });

  it("names a file once across texts, first seen first, and an empty text names nothing", () => {
    const texts = ["see ~/notes/a.md and /tmp/b.txt", "", "again ~/notes/a.md"];
    expect(localFilesNamed({ texts })).toEqual(["~/notes/a.md", "/tmp/b.txt"]);
  });

  it("takes a /private path and drops the brackets, backticks and quotes prose wraps a path in", () => {
    const text = 'Under /private/tmp/run-1/out.html, (see `~/x/y.md`) and "~/q/r.txt".';
    expect(localFilesNamed({ texts: [text] })).toEqual(["/private/tmp/run-1/out.html", "~/x/y.md", "~/q/r.txt"]);
  });

  it("joins a multi-dot document name to its folder whole", () => {
    expect(localFilesNamed({ texts: ["Folder: ~/dev/app. Draft: proposal.final.md."] })).toEqual([
      "~/dev/app/proposal.final.md",
    ]);
  });

  it("takes a file the text names beside a folder it also names, then the bare document joined to that folder", () => {
    const text = "Folder: ~/dev/app/. Built ~/dev/app/out/report.pdf; summary in NOTES.md.";
    expect(localFilesNamed({ texts: [text] })).toEqual(["~/dev/app/out/report.pdf", "~/dev/app/NOTES.md"]);
  });
});
