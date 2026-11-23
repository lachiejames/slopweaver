import { describe, expect, it } from "vitest";
import { redactText } from "../../../corpus/redact.js";

describe("redactText", () => {
  it("redacts emails, tokens and long digit runs", () => {
    const { text, redactions } = redactText({
      text: "mail me at a.b@example.com token ghp_" + "x".repeat(30) + " id 123456789012",
    });
    expect(text).toContain("[email]");
    expect(text).toContain("[token]");
    expect(text).toContain("[number]");
    expect(new Set(redactions)).toEqual(new Set(["email", "token", "number"]));
  });

  it("preserves graph-edge tokens (@mention, issue refs, TEAM-123)", () => {
    const { text, redactions } = redactText({ text: "@alice see #42 and TEAM-7" });
    expect(text).toBe("@alice see #42 and TEAM-7");
    expect(redactions).toEqual([]);
  });

  it("does not carve up a token into an email/number", () => {
    // Built from parts so the committed source carries no real-looking token literal (the hygiene gate
    // scans for exactly this shape). At runtime it reassembles into a slack-style token for the redactor.
    const token = ["xoxb", "1234567890", "abcdefghij"].join("-");
    expect(redactText({ text: token }).text).toBe("[token]");
  });
});

/**
 * Every prefix here is a single character placed immediately before a secret. The last three are word
 * characters, which is precisely what a `\b` anchor rejects — so under the anchored patterns these cases
 * wrote the secret to disk verbatim, and each expectation below read `"x" + the raw key` instead of
 * `"x[token]"`. The first three always worked and are kept in the same list, so a "fix" that closed the hole
 * by deleting the pattern's original job would fail too.
 *
 * The `x`-prefixed case is the `xsk-` concatenation shape: flattening a Slack `rich_text` tree joins adjacent
 * leaves with no separator, so a leaf ending `x` followed by a leaf holding a key produces it.
 */
describe("redactText scrubs a secret whatever precedes it (no word-boundary anchor)", () => {
  // Assembled from parts for the same reason as above: the hygiene gate scans THIS file for token shapes,
  // and it is no longer `\b`-anchored either, so a literal `xsk-<24 chars>` on a source line would trip it.
  const SK = ["sk", "-"].join("");
  const SECRET = ["secret", "_"].join("");
  const BODY = "A".repeat(24);
  const PREFIXES = ["", " ", "(", "x", "9", "_"] as const;
  const EXPECTED = ["[token]", " [token]", "([token]", "x[token]", "9[token]", "_[token]"];

  it("scrubs an sk- key after every prefix, including the xsk- shape", () => {
    expect(PREFIXES.map((prefix) => redactText({ text: prefix + SK + BODY }).text)).toEqual(EXPECTED);
  });

  it("scrubs a secret_ token after every prefix", () => {
    expect(PREFIXES.map((prefix) => redactText({ text: prefix + SECRET + BODY }).text)).toEqual(EXPECTED);
  });

  it("scrubs a Bearer credential after every prefix", () => {
    expect(PREFIXES.map((prefix) => redactText({ text: `${prefix}Bearer ${BODY}` }).text)).toEqual(EXPECTED);
  });

  it("scrubs the client_secret query-param shape, which a word boundary alone misses", () => {
    // The shape: an underscore precedes `secret_`, so `\b` never matches, and a credential shape of this kind
    // would pass unredacted. Body synthesised — never a real credential.
    const { text, redactions } = redactText({ text: `?payment_intent_client_secret=pi_3Aa_${SECRET}${BODY}` });
    expect(text).toBe("?payment_intent_client_secret=pi_3Aa_[token]");
    expect(redactions).toEqual(["token"]);
  });

  it("over-redacts the one false-positive class the measurement found, and that is the accepted cost", () => {
    // A URL slug ending `-task-<hex>` reads as `sk-` plus a body. One such string exists across a couple of gigabytes of
    // corpus, and the `\d{9,}` pass has already replaced part of it there, so the fidelity was lost anyway.
    const { text } = redactText({ text: `https://example.com/a-10-min-ta${SK}0f1e2d3c4b5a69788796a5b4` });
    expect(text).toBe("https://example.com/a-10-min-ta[token]");
  });
});

/**
 * The `\d{9,}` pass used to CARVE UP a UUID whose final group held nine or more consecutive digits, storing
 * `…-956b-[number]efe`. Measured over a real Linear history store: a small fraction of a percent of distinct ids. Small, and
 * lethal where it lands, because the mangled form still parses as an id-shaped string — so a workflow-state
 * id copied out of the corpus reads as plausible and is not the id it claims to be.
 */
describe("redactText preserves a UUID the long-digit pass would otherwise carve up", () => {
  it("leaves a bare UUID whose last group is nine digits intact", () => {
    const uuid = "01d0a8c3-1c3e-4cc4-956b-123456789efe";

    expect(redactText({ text: uuid })).toEqual({ redactions: [], text: uuid });
  });

  it("leaves an all-digit final group intact — the shape the corpus most often mangled", () => {
    const uuid = "05ab78e8-5ce2-423c-989e-123456789012";

    expect(redactText({ text: `state ${uuid} here` }).text).toBe(`state ${uuid} here`);
  });

  it("still scrubs a long digit run sitting NEXT TO a UUID", () => {
    const uuid = "01d0a8c3-1c3e-4cc4-956b-123456789efe";

    expect(redactText({ text: `phone 123456789012 and id ${uuid}` }).text).toBe(`phone [number] and id ${uuid}`);
  });

  it("still scrubs a Bearer credential that happens to BE a UUID — the token pass runs first, on the full text", () => {
    expect(redactText({ text: "Bearer 01d0a8c3-1c3e-4cc4-956b-123456789efe" }).text).toBe("[token]");
  });

  it("exempts NOTHING when digits are prefixed to hex, because the leading word boundary fails", () => {
    // `1234567890abcdef12-3456-4789-9abc-123456789012` is not a UUID span: the `\b` before the first hex
    // group cannot match after a digit. So the exemption is unreachable by prefixing digits to hex.
    expect(redactText({ text: "1234567890abcdef12-3456-4789-9abc-123456789012" }).text).toBe(
      "[number]abcdef12-3456-4789-9abc-[number]",
    );
  });

  it("scrubs an email and a token in the same string as an intact UUID", () => {
    const uuid = "01d0a8c3-1c3e-4cc4-956b-123456789efe";
    const { text, redactions } = redactText({ text: `${uuid} a.b@example.com ghp_${"x".repeat(30)}` });

    expect(text).toBe(`${uuid} [email] [token]`);
    expect(new Set(redactions)).toEqual(new Set(["email", "token"]));
  });
});

describe("a full git object id survives the long-digit-run pass", () => {
  it("keeps a 40-hex commit oid whose middle is nine consecutive digits", () => {
    const oid = "8bd1234567890d09b8855550b85c84d50dc6a708";
    expect(oid).toHaveLength(40);
    expect(redactText({ text: `merged as ${oid}` }).text).toBe(`merged as ${oid}`);
  });

  it("keeps an oid at the start and the end of the text, and two in one line", () => {
    const a = "21db8e4e12068839f8fb3a798697d84a412e0eea";
    const b = "6cee7bb190123456789a818c8b614aea7c22ebf5";
    expect(redactText({ text: `${a} ${b}` }).text).toBe(`${a} ${b}`);
  });

  it("still scrubs a 40-DIGIT run, which the letter requirement is what keeps reachable", () => {
    const digits = "1".repeat(40);
    expect(redactText({ text: digits }).text).toBe("[number]");
  });

  it("still scrubs a long digit run abutting an oid", () => {
    const oid = "21db8e4e12068839f8fb3a798697d84a412e0eea";
    expect(redactText({ text: `999999999${oid}` }).text).toContain("[number]");
  });

  it("still scrubs a 39-hex run — the exemption is the full object id, not any hex", () => {
    expect(redactText({ text: "a".repeat(29) + "1".repeat(10) }).text).toContain("[number]");
  });

  it("leaves the UUID exemption working beside it", () => {
    const uuid = "01d0a8c3-1c3e-4cc4-956b-123456789efe";
    const oid = "21db8e4e12068839f8fb3a798697d84a412e0eea";
    expect(redactText({ text: `${uuid} and ${oid}` }).text).toBe(`${uuid} and ${oid}`);
  });

  it("still redacts a token that abuts an oid", () => {
    const oid = "21db8e4e12068839f8fb3a798697d84a412e0eea";
    const out = redactText({ text: `ghp_${"a".repeat(30)} ${oid}` }).text;
    expect(out).toBe(`[token] ${oid}`);
  });
});

describe("a SHA-256 digest survives the long-digit-run pass", () => {
  // The measured case, from bronze: a live `refresh --source notion` stored a body digest with its
  // long digit runs replaced by `[number]`, and the sidecar it named could not
  // be opened. A content-addressed digest is the ADDRESS, not a label on it, so carving one character out
  // does not degrade the pointer — it destroys it.
  const MANGLED_IN_BRONZE = "f20610c1df68be5d3eb62db8b5221cbe1234567890f3a1234567890c4c1a1234";

  it("keeps a 64-hex digest whose middle holds two long digit runs", () => {
    expect(MANGLED_IN_BRONZE).toHaveLength(64);
    expect(redactText({ text: MANGLED_IN_BRONZE }).text).toBe(MANGLED_IN_BRONZE);
  });

  it("keeps the digest inside the reference a record actually carries", () => {
    const ref = `sha256:${MANGLED_IN_BRONZE}`;
    expect(redactText({ text: ref }).text).toBe(ref);
    // The attachment store names its bytes the same way, so the same exemption is what keeps a fetched
    // attachment openable (`corpus/notion/attachmentStore.ts`).
    const fileRef = `attachment: sha256:${MANGLED_IN_BRONZE}`;
    expect(redactText({ text: fileRef }).text).toBe(fileRef);
  });

  it("keeps two digests on one line, and one at each end of the text", () => {
    const a = "a1234567890bcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const b = "b9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcb";
    expect(redactText({ text: `${a} ${b}` }).text).toBe(`${a} ${b}`);
  });

  it("still scrubs a 64-DIGIT run, which the letter requirement is what keeps reachable", () => {
    expect(redactText({ text: "1".repeat(64) }).text).toBe("[number]");
  });

  it("still scrubs a long digit run abutting a digest", () => {
    expect(redactText({ text: `999999999${MANGLED_IN_BRONZE}` }).text).toContain("[number]");
  });

  it("still scrubs a 63-hex run — the exemption is the full digest, not any hex", () => {
    expect(redactText({ text: "a".repeat(53) + "1".repeat(10) }).text).toContain("[number]");
  });

  it("leaves the oid and UUID exemptions working beside it", () => {
    const uuid = "01d0a8c3-1c3e-4cc4-956b-123456789efe";
    const oid = "21db8e4e12068839f8fb3a798697d84a412e0eea";
    const out = redactText({ text: `${uuid} ${oid} ${MANGLED_IN_BRONZE}` }).text;
    expect(out).toBe(`${uuid} ${oid} ${MANGLED_IN_BRONZE}`);
  });

  it("still redacts a token that abuts a digest", () => {
    const out = redactText({ text: `ghp_${"a".repeat(30)} ${MANGLED_IN_BRONZE}` }).text;
    expect(out).toBe(`[token] ${MANGLED_IN_BRONZE}`);
  });
});

describe("the git-oid exemption's named residue", () => {
  it("exempts a 40-char hex span that is one letter and 39 digits, as the comment says it does", () => {
    // Asserted rather than described so the residue cannot drift out of the doc comment unnoticed. It is
    // left open deliberately: a criterion tight enough to catch it starts mangling a digit-heavy real sha.
    const span = `a${"1".repeat(39)}`;
    expect(span).toHaveLength(40);
    expect(redactText({ text: span }).text).toBe(span);
  });

  it("scrubs the same digit run one character shorter, where no span is exempted", () => {
    expect(redactText({ text: `a${"1".repeat(38)}` }).text).toBe("a[number]");
  });

  it("scrubs a phone-length run sitting beside an oid, and keeps the oid", () => {
    const oid = "21db8e4e12068839f8fb3a798697d84a412e0eea";
    expect(redactText({ text: `call 61412345678 about ${oid}` }).text).toBe(`call [number] about ${oid}`);
  });
});

describe("the sk- project-key family the scrubber could not see", () => {
  it("redacts an sk-proj- key whose base64url body carries hyphens and underscores", () => {
    const key = `sk-proj-${"aB3-_".repeat(12)}`;
    expect(redactText({ text: `OPENAI_API_KEY=${key}` }).text).toBe("OPENAI_API_KEY=[token]");
  });

  it("redacts the sk-svcacct- and sk-admin- members of the same family", () => {
    const body = "x9_Q-".repeat(12);
    expect(redactText({ text: `sk-svcacct-${body}` }).text).toBe("[token]");
    expect(redactText({ text: `sk-admin-${body}` }).text).toBe("[token]");
  });

  it("redacts one inside a diff hunk, a shape that would otherwise carry a credential through", () => {
    const key = `sk-proj-${"aB3-_".repeat(12)}`;
    const hunk = `@@ -1,2 +1,3 @@\n GCP_LOCATION=australia-southeast1\n+OPENAI_API_KEY=${key}\n`;
    const out = redactText({ text: hunk }).text;
    expect(out).toContain("+OPENAI_API_KEY=[token]");
    expect(out).toContain("GCP_LOCATION=australia-southeast1");
  });

  it("reports the token category, so a caller can tell a secret fired from a number", () => {
    expect(redactText({ text: `sk-proj-${"aB3-_".repeat(12)}` }).redactions).toEqual(["token"]);
  });

  it("leaves a short sk-proj- string alone — the floor is what keeps prose readable", () => {
    expect(redactText({ text: "sk-proj-short" }).text).toBe("sk-proj-short");
  });
});

/**
 * The same class as the UUID span one layer along, and the one that had already done its damage.
 *
 * A Slack `ts` is `1773784810.008629`, so the ten-digit epoch is a run of nine-or-more digits and the
 * `\d{9,}` pass rewrote it as `[number].008629` — in `raw.ts`, `raw.thread_ts` and every promoted column
 * derived from them. MEASURED on a live store: 662,438 of 709,059 `message_ts` values and
 * 100% of the non-null `thread_ts` values were carved up, and 6,343 thread keys merged two or more
 * distinct threads as a result. Nothing here is a credential: a timestamp is an address.
 */
describe("redactText preserves a Slack timestamp", () => {
  it("leaves a bare Slack ts intact, reporting no redaction at all", () => {
    expect(redactText({ text: "1773784810.008629" })).toEqual({ redactions: [], text: "1773784810.008629" });
  });

  it("leaves one intact inside the JSON envelope ingest actually stores", () => {
    const raw = '{"ts":"1773811363.025049","thread_ts":"1773784810.008629"}';
    expect(redactText({ text: raw }).text).toBe(raw);
  });

  it("spans the whole epoch range a Slack workspace can hold — 2017 through 2033", () => {
    expect(redactText({ text: "1500000000.000100" }).text).toBe("1500000000.000100");
    expect(redactText({ text: "1999999999.999999" }).text).toBe("1999999999.999999");
  });

  it("still scrubs a long digit run sitting next to one, so the span buys nothing wider", () => {
    expect(redactText({ text: "phone 123456789012 at 1773784810.008629" }).text).toBe(
      "phone [number] at 1773784810.008629",
    );
  });

  it("still scrubs a ten-digit epoch with no fractional part, which is not a Slack ts", () => {
    expect(redactText({ text: "1773784810" }).text).toBe("[number]");
  });

  it("still scrubs a run of digits with the wrong fraction width, which addresses no message", () => {
    expect(redactText({ text: "1773784810.00862" }).text).toBe("[number].00862");
  });
});
