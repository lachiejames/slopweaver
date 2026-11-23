import { describe, expect, it } from "vitest";

import { BrowserActionErrors } from "../../../browser/actionErrors.js";
import { type DownloadFile, isInFlightDownload, selectDownloadCandidate } from "../../../browser/download.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const DIR = "/home/downloads";
const FIRST = "2026-09-12T04:00:01.000Z";
const SECOND = "2026-09-12T04:00:02.000Z";

/** Two readings of the same directory, which is what the settle test compares. */
const twice = ({ files }: { files: readonly DownloadFile[] }) => [
  { atIso: FIRST, files },
  { atIso: SECOND, files },
];

describe("telling a finished download from a transfer", () => {
  it("reads Chrome's own in-flight suffix as a transfer", () => {
    expect(isInFlightDownload({ name: "report.pdf.crdownload" })).toBe(true);
  });

  it("reads a plain name as finished", () => {
    expect(isInFlightDownload({ name: "report.pdf" })).toBe(false);
  });
});

describe("picking the file a click produced", () => {
  it("picks the one new file whose size held still", () => {
    const picked = selectDownloadCandidate({
      baseline: [{ bytes: 10, name: "old.txt" }],
      directory: DIR,
      expectName: undefined,
      observations: twice({
        files: [
          { bytes: 10, name: "old.txt" },
          { bytes: 34, name: "payload.txt" },
        ],
      }),
    });
    expect(unwrap(picked).name).toBe("payload.txt");
  });

  it("reports the size it settled at", () => {
    const picked = selectDownloadCandidate({
      baseline: [],
      directory: DIR,
      expectName: undefined,
      observations: twice({ files: [{ bytes: 34, name: "payload.txt" }] }),
    });
    expect(unwrap(picked).bytes).toBe(34);
  });

  it("labels its provenance as an inference, never a browser confirmation", () => {
    const picked = selectDownloadCandidate({
      baseline: [],
      directory: DIR,
      expectName: undefined,
      observations: twice({ files: [{ bytes: 34, name: "payload.txt" }] }),
    });
    expect(unwrap(picked).provenance).toBe("directory-observed");
  });

  it("accepts a zero-byte download, because an empty file is a real result", () => {
    const picked = selectDownloadCandidate({
      baseline: [],
      directory: DIR,
      expectName: undefined,
      observations: twice({ files: [{ bytes: 0, name: "empty.txt" }] }),
    });
    expect(unwrap(picked).name).toBe("empty.txt");
  });

  it("ignores a file that is still being written", () => {
    const picked = selectDownloadCandidate({
      baseline: [],
      directory: DIR,
      expectName: undefined,
      observations: twice({ files: [{ bytes: 5, name: "big.zip.crdownload" }] }),
    });
    expect(unwrapErr(picked).code).toBe("DOWNLOAD_NOT_RESOLVED");
  });

  it("refuses a file whose size is still moving", () => {
    const picked = selectDownloadCandidate({
      baseline: [],
      directory: DIR,
      expectName: undefined,
      observations: [
        { atIso: FIRST, files: [{ bytes: 100, name: "big.zip" }] },
        { atIso: SECOND, files: [{ bytes: 400, name: "big.zip" }] },
      ],
    });
    expect(unwrapErr(picked).code).toBe("DOWNLOAD_NOT_RESOLVED");
  });

  it("refuses to guess between two files that both settled", () => {
    const picked = selectDownloadCandidate({
      baseline: [],
      directory: DIR,
      expectName: undefined,
      observations: twice({
        files: [
          { bytes: 1, name: "mine.txt" },
          { bytes: 2, name: "theirs.txt" },
        ],
      }),
    });
    expect(unwrapErr(picked).message).toContain("2 new files settled");
  });

  it("names them, so the caller can pick one up rather than click again", () => {
    const picked = selectDownloadCandidate({
      baseline: [],
      directory: DIR,
      expectName: undefined,
      observations: twice({
        files: [
          { bytes: 1, name: "mine.txt" },
          { bytes: 2, name: "theirs.txt" },
        ],
      }),
    });
    expect(unwrapErr(picked).message).toContain("mine.txt, theirs.txt");
  });

  it("tells the caller NOT to re-run, because the click already happened", () => {
    const picked = selectDownloadCandidate({
      baseline: [],
      directory: DIR,
      expectName: undefined,
      observations: twice({
        files: [
          { bytes: 1, name: "mine.txt" },
          { bytes: 2, name: "theirs.txt" },
        ],
      }),
    });
    expect(unwrapErr(picked).message).toContain("Do NOT simply re-run this command");
  });

  it("resolves that ambiguity when the caller named the file", () => {
    const picked = selectDownloadCandidate({
      baseline: [],
      directory: DIR,
      expectName: "mine.txt",
      observations: twice({
        files: [
          { bytes: 1, name: "mine.txt" },
          { bytes: 2, name: "theirs.txt" },
        ],
      }),
    });
    expect(unwrap(picked).name).toBe("mine.txt");
  });

  it("never picks a file that was already there", () => {
    const picked = selectDownloadCandidate({
      baseline: [{ bytes: 34, name: "payload.txt" }],
      directory: DIR,
      expectName: undefined,
      observations: twice({ files: [{ bytes: 34, name: "payload.txt" }] }),
    });
    expect(unwrapErr(picked).code).toBe("DOWNLOAD_NOT_RESOLVED");
  });

  it("does not claim a deadline was reached when a name filtered everything out", () => {
    const picked = selectDownloadCandidate({
      baseline: [],
      directory: DIR,
      expectName: "report.csv",
      observations: twice({ files: [{ bytes: 9, name: "unrelated.csv" }] }),
    });
    expect(unwrapErr(picked).message).toContain("under the name report.csv");
  });

  it("says nothing appeared when the watch saw only one reading", () => {
    const picked = selectDownloadCandidate({
      baseline: [],
      directory: DIR,
      expectName: undefined,
      observations: [{ atIso: FIRST, files: [{ bytes: 34, name: "payload.txt" }] }],
    });
    expect(unwrapErr(picked).message).toContain("nothing matching arrived");
  });
});

describe("a download that arrived and could not be handed over", () => {
  it("says the click was made, so nobody re-runs it", () => {
    const failure = BrowserActionErrors.downloadNotResolved({ candidates: 1, directory: DIR, names: ["report.csv"] });
    expect(failure.message).toContain("the click WAS made");
  });

  it("points the caller at the file rather than at the command", () => {
    const failure = BrowserActionErrors.downloadNotResolved({ candidates: 1, directory: DIR, names: ["report.csv"] });
    expect(failure.message).toContain("collect it");
  });

  it("never claims the download succeeded, because arriving is all that was observed", () => {
    const failure = BrowserActionErrors.downloadNotResolved({ candidates: 1, directory: DIR, names: ["report.csv"] });
    expect(failure.message).toContain("attributed to this click by having ARRIVED");
  });

  it("tells the caller not to re-run it", () => {
    const failure = BrowserActionErrors.downloadNotResolved({ candidates: 1, directory: DIR, names: ["report.csv"] });
    expect(failure.message).toContain("Do NOT re-run this command");
  });

  it("never claims the click produced one of them, since no download was observed starting", () => {
    const failure = BrowserActionErrors.downloadNotResolved({
      candidates: 2,
      directory: DIR,
      names: ["a.csv", "b.csv"],
    });
    expect(failure.message).toContain("or NONE of them");
  });

  it("says the click was made on a timeout too", () => {
    const failure = BrowserActionErrors.downloadNotResolved({ candidates: 0, directory: DIR, names: [] });
    expect(failure.message).toContain("the click WAS made");
  });

  it("says nothing MATCHED rather than nothing arrived, when a name was filtering", () => {
    const failure = BrowserActionErrors.downloadNotResolved({
      candidates: 0,
      directory: DIR,
      expected: "report.csv",
      names: [],
    });
    expect(failure.message).toContain("not evidence that nothing downloaded");
  });
});
