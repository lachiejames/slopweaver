/*
 * The voice saying it put a draft on the owner's running list, held to an offer that landed there.
 * Every sentence is the shape of a real call with synthetic ids; the false claim and the true ones around it are
 * replayed in the order the page saw them. Beside them, the clause readers over a third-person pronoun, the words a
 * claim's subject or determiner is read by.
 */
import { describe, expect, it } from "vitest";

import {
  claimGroundingEntry,
  claimGroundingOf,
  foldSpokenClaims,
  NO_SPOKEN_CLAIMS,
  type SentenceClaim,
  type SpokenClaimsInput,
  type SpokenGroundingNote,
  spokenClaimsOf,
  spokenGroundingDetail,
} from "../../lib/talkSpokenClaims";
import { MAX_GROUNDING_KEY_CHARS } from "../../lib/talkVoiceRecord";

/** An input as a test writes it: the owner's words or a completed message may leave out the id, and take their place's. */
type Fed = SpokenClaimsInput | { readonly kind: "heard" | "wrote"; readonly text: string };

/**
 * Feed the fold in order, as the page does.
 *
 * @returns every claim it owed a grounding, with the index of the input that owed it
 */
function fold({ inputs }: { inputs: readonly Fed[] }): readonly { at: number; claim: SentenceClaim }[] {
  let state = NO_SPOKEN_CLAIMS;
  const owed: { at: number; claim: SentenceClaim }[] = [];
  inputs.forEach((fed, at) => {
    const carriesNoId = fed.kind === "confirmed" || fed.kind === "offer-landed" || fed.kind === "owner-began";
    const input: SpokenClaimsInput = carriesNoId || "id" in fed ? fed : { ...fed, id: `${fed.kind}-${at}` };
    const step = foldSpokenClaims({ input, state });
    state = step.state;
    owed.push(...step.owed.map((claim) => ({ at, claim })));
  });
  return owed;
}

/**
 * The kinds a run of inputs leaves owed.
 *
 * @returns each owed claim's kind
 */
function owedAfter({ inputs }: { inputs: readonly Fed[] }): readonly string[] {
  return fold({ inputs }).map(({ claim }) => claim.kind);
}

const KEY_REFUSAL = { refused: `key must be a string of 1 to ${String(MAX_GROUNDING_KEY_CHARS)} characters` };

describe("foldSpokenClaims, a running-list claim", () => {
  const landed = { kind: "offer-landed" } as const;
  const began = { kind: "owner-began" } as const;
  const claim = ({ id, text }: { id: string; text: string }) => ({ id, kind: "said", text }) as const;
  const first = claim({ id: "v1", text: " I've put a draft on your running list that covers secret exposure." });
  const revision = claim({
    id: "v2",
    text: " I've put a revision on your running list that quotes lines and responds to them one at a time.",
  });
  const second = claim({
    id: "v3",
    text: " I've put a new draft on your running list with each line quoted and answered individually. What do you think?",
  });

  const reply = ({ id }: { id: string }) => claim({ id, text: " Understood." });

  // The order the page saw it. An offer, then the line about it. The owner began. An offer, landing inside a voice
  // sentence whose FINAL came just before the owner began, and began twice more; the voice replied and said "I've put a
  // revision" with no offer. The owner began; the voice replied; the owner began. An offer, inside a voice sentence,
  // another voice sentence, then "I've put a new draft".
  it("owes the false claim made with no offer and neither of the true claims around it", () => {
    const inputs = [
      landed,
      first,
      began,
      landed,
      reply({ id: "r1" }),
      began,
      began,
      began,
      reply({ id: "r2" }),
      revision,
      began,
      reply({ id: "r3" }),
      began,
      landed,
      reply({ id: "r4" }),
      reply({ id: "r5" }),
      second,
    ];
    expect(fold({ inputs }).map(({ at, claim: c }) => [at, c.kind])).toEqual([[9, "running-list"]]);
  });

  // "[lip smack] Okay." began: a noise between a landing and the line about it must not correct the line.
  it("grounds the line when the owner made a sound after the landing, before the voice answered it", () => {
    expect(owedAfter({ inputs: [landed, began, first] })).toEqual([]);
  });

  it("owes a claim on a call with no offer at all", () => {
    expect(owedAfter({ inputs: [revision] })).toEqual(["running-list"]);
  });

  it("grounds a claim when the offer lands while the owner is mid-sentence, since their sentence began before it", () => {
    expect(owedAfter({ inputs: [began, landed, { kind: "heard", text: "Yes, do that." }, first] })).toEqual([]);
  });

  it("grounds the voice saying so twice about one landing, with nothing of the owner's between", () => {
    expect(owedAfter({ inputs: [landed, first, second] })).toEqual([]);
  });

  it("owes the claim once the owner has begun a sentence after the voice answered the landing", () => {
    expect(owedAfter({ inputs: [landed, reply({ id: "r6" }), began, first] })).toEqual(["running-list"]);
  });

  it("takes a new landing after the owner moved on as grounding the next claim", () => {
    expect(owedAfter({ inputs: [landed, reply({ id: "r7" }), began, landed, first] })).toEqual([]);
  });

  it("is not grounded by the thinking model writing that it is on the list", () => {
    expect(owedAfter({ inputs: [{ kind: "wrote", text: "It's on your running list." }, revision] })).toEqual([
      "running-list",
    ]);
  });

  it("owes one grounding for two claims in one segment, keyed at the first", () => {
    const step = foldSpokenClaims({
      input: claim({ id: "v4", text: " I've put it on your running list. I've added it to your running list." }),
      state: NO_SPOKEN_CLAIMS,
    });
    expect(step.owed.map((owed) => [owed.kind, owed.start])).toEqual([["running-list", 1]]);
  });
});

describe("a running-list claim's grounding and notes", () => {
  // None of "I've put a revision" travels, only where it was said.
  it("takes a running-list claim as exactly a key and a kind, refusing its words", () => {
    expect([
      claimGroundingOf({ value: { key: "v2:1", kind: "running-list" } }),
      claimGroundingOf({ value: { key: "v2:1", kind: "running-list", words: "I've put a revision." } }),
      claimGroundingOf({ value: { kind: "running-list" } }),
    ]).toEqual([
      { key: "v2:1", kind: "running-list" },
      { refused: "a running-list grounding is exactly key and kind" },
      KEY_REFUSAL,
    ]);
  });

  it("keeps a running-list claim as the voice's own, owed a correction aloud", () => {
    expect(claimGroundingEntry({ grounding: { kind: "running-list" } })).toEqual({
      text: "the voice said it put a draft on the owner's running list",
      why:
        "no offer landed on the list that the owner has not moved on from, so the line is the realtime voice's own; the " +
        "call owes a correction aloud, said once the floor is clear",
    });
  });

  it("names a running-list claim as one, and that the voice is corrected once it is recorded", () => {
    const claim = spokenClaimsOf({ text: "I've put a revision on your running list." })[0];
    const notes: readonly SpokenGroundingNote[] = [
      { claim, kind: "ungrounded" },
      { claim, kind: "recorded" },
    ];
    expect(notes.map((note) => spokenGroundingDetail({ note }))).toEqual([
      "said \"I've put a revision on your running list.\": no offer landed on the owner's running list that they have not moved on from",
      'recorded where "I\'ve put a revision on your running list." came from, for the thinking model; the call owes the voice a correction aloud',
    ]);
  });
});

describe("spoken claims around a third-person pronoun, whichever person it names", () => {
  // Spoken words, spelled through a pattern's source: the owner-pronoun gate reads a pattern as speech, which these are.
  const [subject, possessive] = [/he/u.source, /his/u.source];
  const said = (text: string) => owedAfter({ inputs: [{ id: "s1", kind: "said", text }] });

  it("reads an act with a third-person subject as somebody else's, and a possessive before a past form as an adjective", () => {
    const texts = [`${subject} approved them.`, "She approved them.", `That goes in ${possessive} sent folder.`];
    expect(texts.map((text) => spokenClaimsOf({ text }))).toEqual(texts.map(() => []));
  });

  it("opens a new clause on one, so a negation or a record before it never reaches the act after it", () => {
    expect([
      said(`I can't verify it, but ${possessive} draft was sent.`),
      said(`I can't verify it, but ${subject}'s sent it.`),
      said("I can't verify it, but she's sent it."),
      said(`The card says the queue is empty and ${possessive} draft was sent.`),
      said("The card says the queue is empty and her draft was sent."),
    ]).toEqual([["outcome"], ["outcome"], ["outcome"], ["outcome"], ["outcome"]]);
  });
});
