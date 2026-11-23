import { describe, expect, it } from "vitest";

import { readCopyHeader } from "../../../../store/ownerTurnDump/copyHeader.js";

describe("readCopyHeader", () => {
  it("folds an unquoted name to lower case and keeps a quoted one exact, a doubled quote standing for one", () => {
    expect(readCopyHeader({ line: "COPY PUBLIC.Owner_Turn (a, b) FROM stdin;" })).toEqual({
      columns: "a, b",
      kind: "named",
      schema: "public",
      table: "owner_turn",
    });
    expect(readCopyHeader({ line: 'COPY "Public"."say ""hi"".x" (a) FROM stdin;' })).toEqual({
      columns: "a",
      kind: "named",
      schema: "Public",
      table: 'say "hi".x',
    });
  });

  it("reads an unqualified name, and a header that declares no column list", () => {
    expect(readCopyHeader({ line: "COPY other2 FROM stdin;" })).toEqual({
      columns: undefined,
      kind: "named",
      schema: undefined,
      table: "other2",
    });
  });

  it("names a header it cannot parse as such, and any other line as none", () => {
    expect(readCopyHeader({ line: 'COPY public."owner_turn (a) FROM stdin;' }).kind).toBe("unparsed");
    expect(readCopyHeader({ line: "COPY public.owner_turn junk FROM stdin;" }).kind).toBe("unparsed");
    expect(readCopyHeader({ line: "COPY 9table (a) FROM stdin;" }).kind).toBe("unparsed");
    expect(readCopyHeader({ line: "SET search_path = public;" }).kind).toBe("none");
    expect(readCopyHeader({ line: "COPYRIGHT 2026" }).kind).toBe("none");
  });

  it("names every other form of a line opening with COPY unparsed, so none is passed over as a non-header", () => {
    for (const line of [
      "COPY public.owner_turn (a) FROM stdout;",
      "COPY\tpublic.owner_turn (a) FROM stdin;",
      "copy public.owner_turn (a) from stdin;",
      "  COPY public.owner_turn (a) FROM stdin;",
      'COPY U&"owner\\005fturn" (a) FROM stdin;',
      'COPY "" (a) FROM stdin;',
      'COPY public."" (a) FROM stdin;',
      "COPY public.owner_turn",
    ]) {
      expect(readCopyHeader({ line }).kind).toBe("unparsed");
    }
  });
});
