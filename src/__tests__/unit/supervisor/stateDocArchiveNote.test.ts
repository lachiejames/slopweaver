import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { chainArchiveNote } from "../../../supervisor/stateDocArchiveNote.js";

/** The note inputs every test shares, overridable per test. */
const chain = (over: Partial<Parameters<typeof chainArchiveNote>[0]> = {}): ReturnType<typeof chainArchiveNote> =>
  chainArchiveNote({
    archiveDisplayPath: "~/h/archive/x.md",
    description: "the eighth seat",
    movedFrom: { first: 5, last: 9 },
    preamble: "# State",
    predecessor: "9008",
    successor: "9009",
    ...over,
  });

/** The note handoff-9009 writes for handoff-9008's block at lines 5-9. */
const NOTE =
  "The handoff-9008 block (lines 5-9, the eighth seat) is in `~/h/archive/x.md` (archived by handoff-9009). Nothing was deleted.";

describe("chainArchiveNote", () => {
  it("chains the note straight after the predecessor's own, keeping what follows it", () => {
    const result = chain({
      preamble: "# State\n\nNotes (archived by handoff-9008). Nothing was deleted. RESTORE: kept.",
    });
    expect(unwrap(result)).toBe(
      `# State\n\nNotes (archived by handoff-9008). Nothing was deleted. ${NOTE} RESTORE: kept.\n\n`,
    );
  });

  it("seeds the chain as the last paragraph of a preamble no seat has archived", () => {
    expect(unwrap(chain())).toBe(`# State\n\n${NOTE}\n\n`);
  });

  it("seeds the note alone into an empty preamble", () => {
    expect(unwrap(chain({ preamble: "" }))).toBe(`${NOTE}\n\n`);
  });

  it("refuses a chain another seat started without the predecessor's note", () => {
    const result = chain({ preamble: "# State\n\nNotes (archived by handoff-9007). Nothing was deleted." });
    expect(result._unsafeUnwrapErr().code).toBe("ARCHIVE_NOTE_NOT_FOUND");
  });

  it("refuses a finished preamble carrying the successor's sentence twice", () => {
    const result = chain({ description: "quoting (archived by handoff-9009). Nothing was deleted." });
    expect(result._unsafeUnwrapErr().code).toBe("INPUT_REJECTED");
  });
});
