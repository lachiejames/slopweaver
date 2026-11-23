/**
 * The quote-back condition: a reply quotes a line only when the other side said more than one thing. Every
 * case is a real call on the pure function with its exact answer. Every `ap1` region named in this file is the
 * synthetic Datadog site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { redundantOpeningQuote } from "../../../../outbound/voice/redundantOpeningQuote.js";

const ONE_LINE = "Can you confirm which region the account is on?";

describe("redundantOpeningQuote", () => {
  it("names the quote when a single-point source is quoted back whole", () => {
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nIt is on ap1.`, source: ONE_LINE })).toBe(ONE_LINE);
  });

  it("names the quote when the source only wraps its one line in a greeting and a sign-off", () => {
    const source = `Hi Ada,\n\n${ONE_LINE}\n\nThanks,\nAlex Chen\nAccount Executive | Othercompany`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nIt is on ap1.`, source })).toBe(ONE_LINE);
  });

  it("names the quote when a greeting addresses a group rather than a name", () => {
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\nap1.`, source: `Hi all,\n${ONE_LINE}\nCheers` })).toBe(
      ONE_LINE,
    );
  });

  it("answers undefined for a single-point source when the draft opens on the answer", () => {
    expect(redundantOpeningQuote({ draft: "It is on ap1.", source: ONE_LINE })).toBeUndefined();
  });

  it("answers undefined when the quote picks one of several points", () => {
    const source = "Which region is the account on? And who owns the monitors now?";
    expect(
      redundantOpeningQuote({ draft: "> And who owns the monitors now?\n\nPlatform does.", source }),
    ).toBeUndefined();
  });

  it("names the quote when every one of several points is quoted back, since it still picks nothing", () => {
    const source = "Which region is the account on?\nAnd who owns the monitors now?";
    expect(
      redundantOpeningQuote({
        draft: `> Which region is the account on?\n> And who owns the monitors now?\n\nBoth below.`,
        source,
      }),
    ).toBe("Which region is the account on? And who owns the monitors now?");
  });

  it("matches across CRLF line endings and re-wrapped whitespace", () => {
    const source = "Can you confirm which\r\nregion the account is on?";
    expect(redundantOpeningQuote({ draft: `\r\n>  ${ONE_LINE}\r\n\r\nap1.`, source })).toBe(ONE_LINE);
  });

  it("answers undefined when the quote changes case or punctuation, as that is not the source's text", () => {
    expect(
      redundantOpeningQuote({ draft: "> can you confirm which region the account is on\n\nap1.", source: ONE_LINE }),
    ).toBeUndefined();
  });

  it("answers undefined for an empty source", () => {
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source: "  \n" })).toBeUndefined();
  });

  it("answers undefined when the quote comes after authored text rather than opening the draft", () => {
    expect(
      redundantOpeningQuote({ draft: `On your question:\n> ${ONE_LINE}\nap1.`, source: ONE_LINE }),
    ).toBeUndefined();
  });

  it("answers undefined when a second request hides after the sign-off's closer", () => {
    const source = `${ONE_LINE}\n\nThanks! Also send the deck.\nDavid`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("names the quote when a pleasantry sits between the greeting and the one question", () => {
    const source =
      "Hey Seth,\n\nHope you had a great weekend.\n\nAny progress on the staging migration?\n\nCheers,\nAlex";
    expect(redundantOpeningQuote({ draft: "> Any progress on the staging migration?\n\nNot yet.", source })).toBe(
      "Any progress on the staging migration?",
    );
  });

  it("names the quote when a nameless greeting runs straight into a pleasantry", () => {
    const source = `Hi, hope you're well. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBe(ONE_LINE);
  });

  it("answers undefined when a 'hope you can' request precedes the quoted line", () => {
    const source = `Hi Seth, Hope you can send the deck. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("answers undefined when a 'hope you send' request precedes the quoted line", () => {
    const source = `Hi Seth, Hope you send the deck. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("names the quote when a 'hope your week is' pleasantry precedes the one question", () => {
    const source = `Hi Seth, Hope your week is going well. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBe(ONE_LINE);
  });

  it("answers undefined when a title-cased sentence after a nameless greeting ends in a full stop", () => {
    expect(
      redundantOpeningQuote({ draft: "> Then archive.\n\nDone.", source: "Hi, Delete Records. Then archive." }),
    ).toBeUndefined();
  });

  it("answers undefined when 'trust you have' reports an act rather than a state", () => {
    const source = `Hi Seth, I trust you have deleted the old records. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("answers undefined when 'trust you had' reports an act rather than wishing well", () => {
    const source = `Hi Seth, I trust you had deleted the old records. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("answers undefined when a request rides on a pleasantry after a semicolon", () => {
    const source = `Hi Seth, Hope you are well; review the budget. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("answers undefined when a request rides on a pleasantry after 'and'", () => {
    const source = `Hi Seth, Hope you are well and send the deck. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("names the quote when 'hope your week is going well so far' precedes the one question", () => {
    const source = `Hi Seth, Hope your week is going well so far. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBe(ONE_LINE);
  });

  it("names the quote when 'hope you're having a great week' precedes the one question", () => {
    const source = `Hi Seth, Hope you're having a great week! ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBe(ONE_LINE);
  });

  it("answers undefined when 'Happy' opens a sentence about something other than a day", () => {
    const source = `Happy Customers. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("names the quote when 'Happy Friday!' precedes the one question", () => {
    const source = `Happy Friday! ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBe(ONE_LINE);
  });

  it("answers undefined when 'trust you had the' reports a result rather than an occasion", () => {
    const source = `Hi Seth, I trust you had the budget approved. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("answers undefined when 'trust the migration went well' reports on work rather than an occasion", () => {
    const source = `Hi Seth, I trust the migration went well. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("names the quote when 'hope the weekend went well' precedes the one question", () => {
    const source = `Hi Seth, Hope the weekend went well. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBe(ONE_LINE);
  });

  it("answers undefined when 'trust you had the deployment time' reports a fact rather than an occasion", () => {
    const source = `Hi Seth, I trust you had the deployment time. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("names the quote when 'hope you've been well' precedes the one question", () => {
    const source = `Hi Seth, Hope you've been well. ${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBe(ONE_LINE);
  });

  it("answers undefined when the greeting carries content of its own", () => {
    const source = `Hi Ada, quick one before the call:\n${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("answers undefined when a shouted second point follows the closer, since it is no signature", () => {
    const source = `${ONE_LINE}\n\nThanks.\nSEND THE DECK.`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nIt is on ap1.`, source })).toBeUndefined();
  });

  it("answers undefined when a title-cased request ends in a full stop after the closer", () => {
    const source = `${ONE_LINE}\n\nThanks,\nPlease Send The Deck.`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nIt is on ap1.`, source })).toBeUndefined();
  });

  it("answers undefined when a title-cased sentence ends in a full stop anywhere after the closer", () => {
    const source = `${ONE_LINE}\n\nThanks,\nReview The Numbers. Deploy Friday`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nIt is on ap1.`, source })).toBeUndefined();
  });

  it("names the quote after a greeting whose name words join on 'and', the stated false-refusal residue", () => {
    const source = `Hi Review and Approve.\n\n${ONE_LINE}`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBe(ONE_LINE);
  });

  it("names the quote when a sign-off's only full stop closes an initial", () => {
    const source = `${ONE_LINE}\n\nThanks,\nAlex J. Chen`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBe(ONE_LINE);
  });

  it("answers undefined when a title-cased request carries a request word and no full stop", () => {
    const source = `${ONE_LINE}\n\nThanks,\nPlease Send The Deck`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nIt is on ap1.`, source })).toBeUndefined();
  });

  it("names the quote when the signature carries an email address and a phone number", () => {
    const source = `${ONE_LINE}\n\nThanks,\nAlex Chen\nalex@example.com\n+1 202 555 0100`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBe(ONE_LINE);
  });

  it("names the quote when a whole two-paragraph source is quoted with an unmarked blank line between", () => {
    const source = "First paragraph.\n\nSecond paragraph.";
    expect(redundantOpeningQuote({ draft: "> First paragraph.\n\n> Second paragraph.\n\nAnswer.", source })).toBe(
      "First paragraph. Second paragraph.",
    );
  });

  it("answers undefined when a blank line ends the quote and the answer follows", () => {
    const source = "First paragraph.\n\nSecond paragraph.";
    expect(redundantOpeningQuote({ draft: "> First paragraph.\n\nAnswer.", source })).toBeUndefined();
  });

  it("matches a compatibility ligature in the source against its plain letters in the quote", () => {
    expect(redundantOpeningQuote({ draft: "> Can you confirm?\n\nap1.", source: "Can you conﬁrm?" })).toBe(
      "Can you confirm?",
    );
  });

  it("answers undefined when an emoji follows the closer, since it is no signature separator", () => {
    const source = `${ONE_LINE}\n\nThanks,\n⚠️`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("answers undefined when a digitless bracket run follows the closer, since it is no phone number", () => {
    const source = `${ONE_LINE}\n\nThanks,\n(())`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("answers undefined when a key=value fact follows the closer, since it is no name", () => {
    const source = `${ONE_LINE}\n\nThanks,\nDEPLOYMENT=failed`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("answers undefined when an address-like token has a malformed domain, since it is no email", () => {
    const source = `${ONE_LINE}\n\nThanks,\nx@y.z/`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });

  it("names the quote when the signature carries initials and an acronym title", () => {
    const source = `${ONE_LINE}\n\nRegards,\nAlex J. Chen, CEO`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBe(ONE_LINE);
  });

  it("does not read a name that merely starts like a closer as a sign-off", () => {
    const source = `${ONE_LINE}\nTanya wants to know too.`;
    expect(redundantOpeningQuote({ draft: `> ${ONE_LINE}\n\nap1.`, source })).toBeUndefined();
  });
});
