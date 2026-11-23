/**
 * The file edge `spend forward` attaches from: a pulled file reads back byte for byte, and a missing one is a
 * failure carrying why rather than a throw. Bytes are invented.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { attachmentsFor, readPulledFile } from "../../../../../cli/commands/spend/forwardEdges.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { SpendForwardErrors } from "../../../../../spend/tasks/forwardErrors.js";
import type { TaskAct } from "../../../../../spend/tasks/read.js";

/** One card expense, with the invoice given. */
function act({ invoice }: { invoice: TaskAct["invoice"] }): TaskAct {
  return {
    expense: {
      amount: { currency: "AUD", minor: 12000 },
      day: "2027-03-04",
      identity: { kind: "raw", merchant: "Vendor" },
      merchant: "Vendor",
    },
    invoice,
    query: undefined,
  };
}

const MATCHED: TaskAct["invoice"] = {
  files: [
    { filename: "a.pdf", localPath: "/pulled/a.pdf" },
    { filename: "b.pdf", localPath: "/pulled/b.pdf" },
  ],
  kind: "matched",
  messageId: "m1",
  permalink: "https://mail.example/m1",
  subject: "Your receipt",
};

const dirs: string[] = [];

/** A throwaway directory, removed after each test. */
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-forward-edges-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("readPulledFile", () => {
  it("reads a pulled file back byte for byte", () => {
    const path = join(freshDir(), "receipt.pdf");
    writeFileSync(path, Buffer.from("%PDF-1.7 invented"));
    expect(Buffer.from(unwrap(readPulledFile({ path }))).toString("utf8")).toBe("%PDF-1.7 invented");
  });

  it("answers a missing file with why, never a throw", () => {
    const path = join(freshDir(), "absent.pdf");
    expect(unwrapErr(readPulledFile({ path })).message).toContain("ENOENT");
  });
});

describe("attachmentsFor", () => {
  it("attaches every pulled file of a matched receipt as a PDF, in order", () => {
    const readBytes = ({ path }: { path: string }) => ok(new TextEncoder().encode(path));
    const attachments = unwrap(attachmentsFor({ act: act({ invoice: MATCHED }), readBytes }));
    expect(
      attachments.map((a) => ({ bytes: new TextDecoder().decode(a.bytes), filename: a.filename, mime: a.mimeType })),
    ).toEqual([
      { bytes: "/pulled/a.pdf", filename: "a.pdf", mime: "application/pdf" },
      { bytes: "/pulled/b.pdf", filename: "b.pdf", mime: "application/pdf" },
    ]);
  });

  it("attaches nothing, and reads nothing, for an act with no matched receipt", () => {
    const read: string[] = [];
    const readBytes = ({ path }: { path: string }) => {
      read.push(path);
      return ok(new Uint8Array());
    };
    expect(unwrap(attachmentsFor({ act: act({ invoice: { kind: "none" } }), readBytes }))).toEqual([]);
    expect(read).toEqual([]);
  });

  it("refuses on the first file that will not read, naming it", () => {
    const readBytes = ({ path }: { path: string }) =>
      path.endsWith("b.pdf") ? err({ message: "ENOENT" }) : ok(new Uint8Array());
    expect(unwrapErr(attachmentsFor({ act: act({ invoice: MATCHED }), readBytes }))).toEqual(
      SpendForwardErrors.attachmentUnreadable({ cause: "ENOENT", path: "/pulled/b.pdf" }),
    );
  });
});
