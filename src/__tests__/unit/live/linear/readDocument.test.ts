/** One Linear document's node, read through an injected request seam — a plain fake, never a mock. */
import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { LinearLiveErrors } from "../../../../live/linear/errors.js";
import type { LinearReadRequest } from "../../../../live/linear/read.js";
import { readLinearDocument } from "../../../../live/linear/readDocument.js";

const NODE = { content: "body", documentContentId: "content-1", id: "doc-1" };

describe("readLinearDocument", () => {
  it("asks for the document by the id it was given and answers its node untouched", async () => {
    const asked: unknown[] = [];
    const request: LinearReadRequest = ({ variables }) => {
      asked.push(variables);
      return Promise.resolve(ok({ document: NODE }));
    };

    expect(unwrap(await readLinearDocument({ id: "cdd0e58a1f3b", request }))).toEqual(NODE);
    expect(asked).toEqual([{ id: "cdd0e58a1f3b" }]);
  });

  it("names a response with no document node as NOT_FOUND for that id", async () => {
    const request: LinearReadRequest = () => Promise.resolve(ok({ document: null }));

    expect(unwrapErr(await readLinearDocument({ id: "doc-9", request }))).toEqual(
      LinearLiveErrors.notFound({ identity: "doc-9", kind: "document" }),
    );
  });

  it("passes a transport failure through as it came", async () => {
    const failure = LinearLiveErrors.readFailed({ message: "socket hang up" });
    const request: LinearReadRequest = () => Promise.resolve(err(failure));

    expect(unwrapErr(await readLinearDocument({ id: "doc-1", request }))).toEqual(failure);
  });
});
