import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { liveBodiesOf } from "../../../spend/liveBodies.js";
import { LiveCaptureErrors } from "../../../spend/liveErrors.js";
import { CARD_ID, details, limits, transactions } from "./liveFixture.js";

describe("liveBodiesOf", () => {
  it("parses each operation's answers and keeps no field the schema does not declare", () => {
    const bodies = unwrap(
      liveBodiesOf({ responses: [details(), limits(), transactions({ rows: [], totalCount: 0 })] }),
    );
    expect(bodies.limits.map((body) => body.data.getCard.id)).toEqual([CARD_ID]);
    expect(bodies.transactions.map((body) => body.data.spendCardTransactionsByCardId.pageInfo.totalCount)).toEqual([0]);
    expect(Object.keys(bodies.details[0]!.data.getCard).toSorted()).toEqual(["cardExtension", "id", "nickname"]);
  });

  it("names the first operation missing, ignoring a failed answer and a response with no URL", () => {
    const failed = { ...details(), statusCode: 500 };
    const unaddressed = { ...details(), url: "not a url" };
    expect(unwrapErr(liveBodiesOf({ responses: [limits(), failed, unaddressed] }))).toEqual(
      LiveCaptureErrors.operationMissing({ operation: "GetExpandedCardDetails" }),
    );
  });

  it("refuses a malformed transaction page by field path", () => {
    const refusal = unwrapErr(
      liveBodiesOf({ responses: [details(), limits(), { ...transactions({ rows: [], totalCount: 0 }), body: {} }] }),
    );
    expect(refusal.code).toBe("LIVE_BODY_INVALID");
    expect(refusal.message).toContain("TransactionSearchByCardId");
  });
});
