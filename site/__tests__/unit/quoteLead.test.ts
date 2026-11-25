/*
 * The line a folded quote of the owner's leads with: the stretch naming what the card is about, speech noise
 * dropped, never the opening filler. The three long spoken turns are synthetic, shaped like board-row quotes: a
 * heads-up card for a package-pruning work stream, and two waiting asks whose block opens on filler.
 */

import { describe, expect, it } from "vitest";

import { quoteLead } from "../../lib/quoteLead";
import { withoutDisfluencies } from "../../lib/quoteLeadSpeech";

const TIDY =
  "okay... Um... right. Hold on a sec, hold on... Uh... so yeah. So tidy runs over the acme admin repo and... um... " +
  "deletes every unused package it flags, in one pass... and then, uh, a few of the builds fall over. Uh... cause " +
  "tidy is not great at, you know, spotting where a package still gets pulled in. Um... so after that... someone " +
  "opens the red leg... checks which deleted package the failure shows... and then appends that package to the " +
  "ignore list in the tidy dot yaml. The ticket gets a short line too, tidy flags this package, but the build still " +
  "uses it... so it stays on the ignore list for now. And... you know, if- if the team wants... more... later... " +
  "that is fine... but for now... the ignore list holds the used ones back. The payoff is big because... bumping " +
  "packa- bumping four hundred packages means four hundred PRs, and if a hundred of those packages are unused, that " +
  "is a lot of wasted effort, right? So maybe... um... a lot of that work just... disappears... by... um... uh... " +
  "if it... um... [tongue click] Like, it turns out that with four hundred vulnerabilities and a hundred of them " +
  "coming from unused packages, PRs that delete those unused packages could even be better than ";
/** The tidy row's summary — the board publishes only its first 320 characters. */
const TIDY_SUMMARY =
  "The heads-up for a new work stream, from one recorded call: turn tidy on in the acme admin repo for packages alone, " +
  "not the rest of the code, and let it delete every unused package it flags, aggressively and in one pass. The stream " +
  "stays a draft that is never merged, and the card names every step of it in order. Tidy will then delete a bunch, CI " +
  "will run and a bunch will break, the failure on each red leg shows which deleted package ended in it, and that " +
  "package is appended to the ignore list in tidy.yaml. The stream closes when no PRs can merge with an unused package " +
  "in them.";
const TIDY_SLUG =
  "apply tidy aggressively to acme admin in a do not merge draft pr and allowlist what ci proves is used until green";

const BACKWARDS =
  "Yeah, okay. Well, I guess... maybe... something I'm interested in... eh... the scheduler... maybe... starting a " +
  "job for... is just taking a look at all the things that I've said... you know, in this channel... Mm... And just " +
  "think about... like... you know, instead of dwelling... on... alerts... alone... more so... I want to think " +
  "about... what are... other ways... to give... automatic checks... that... state is passed forward... and " +
  "that... errors are not... repeated... and... work backwards from there... to decide what... options... we " +
  "might... want to pursue";
const BACKWARDS_SUBJECT =
  "Work backwards from the owner's call: automatic checks that state passes forward and errors are not repeated, " +
  "alerts only one option";

const LAUNCH =
  "Yeah, I like that... sounds good. Uh... yeah... and I'd like... um... [tongue click]... for eventually... on the " +
  "queue... um... I'd like to see some... basically mockups and a plan to react to... uh basically, you know... " +
  "mockups and plan... for launch day... uh... maybe even showing like, um... you know... what'll happen when... um... " +
  "[tongue click] ... different parts of the live launch are happening, cause uh... you know. Yeah, I'm imagining... " +
  "that we'll have a mobile app... by Thursday... and... um... you'll be able to... pre-plan... something... but " +
  "also I'm not sure how... we'll... do it";
const LAUNCH_SUBJECT = "Launch-day mockups and plan for the owner to react to on the Queue: an opening timeline mockup";

describe("the lead a folded quote shows", () => {
  it("leads the tidy card, as the board publishes its row, on tidy breaking builds — never the opening filler", () => {
    const subject = `${TIDY_SUMMARY.slice(0, 320)} ${TIDY_SLUG}`;
    expect(quoteLead({ cut: "end", subject, where: "call", words: TIDY })).toEqual({
      moreAfter: true,
      moreBefore: true,
      text:
        "tidy runs over the acme admin repo and deletes every unused package it flags, in one pass and then, a few " +
        "of the builds fall over.",
    });
  });

  it("leads on how a deletion that breaks CI is handled once the subject names the ignore list", () => {
    expect(quoteLead({ cut: "end", subject: `${TIDY_SUMMARY} ${TIDY_SLUG}`, where: "call", words: TIDY })).toEqual({
      moreAfter: true,
      moreBefore: true,
      text:
        "after that someone opens the red leg checks which deleted package the failure shows and then appends that " +
        "package to the ignore list in the tidy dot yaml.",
    });
  });

  it("leads a wandering spoken ask with the stretch stating what is wanted, ending where the speaker did", () => {
    expect(quoteLead({ cut: "none", subject: BACKWARDS_SUBJECT, where: "call", words: BACKWARDS })).toEqual({
      moreAfter: false,
      moreBefore: true,
      text:
        "just think about instead of dwelling on alerts alone more so I want to think about what are other " +
        "ways to give automatic checks that state is passed forward and that errors are not repeated and " +
        "work backwards from there to decide what options we might want to pursue",
    });
  });

  it("leads the launch-day ask with what the speaker would like to see, not 'sounds good'", () => {
    expect(quoteLead({ cut: "none", subject: LAUNCH_SUBJECT, where: "call", words: LAUNCH })).toEqual({
      moreAfter: true,
      moreBefore: true,
      text:
        "I'd like for eventually on the queue I'd like to see some basically mockups and a plan to react to " +
        "basically mockups and plan for launch day maybe even showing like what'll happen when different parts of " +
        "the live launch are happening",
    });
  });

  it("changes no character of a typed turn but its annotations — 'pre- and post-merge' is the writer's own", () => {
    const words =
      "[Image #2] ok so for acme-admin i want the pre- and post-merge checks to run on every renovate bump, um, " +
      "not just the weekly ones. the rest can wait.";
    expect(quoteLead({ cut: "none", subject: "renovate bump checks", where: "console-typed", words })).toEqual({
      moreAfter: true,
      moreBefore: false,
      text: "for acme-admin i want the pre- and post-merge checks to run on every renovate bump, um, not just the weekly ones.",
    });
  });

  it("never leads on an 'if' whose consequent it drops, nor stops just before the clause that turns it", () => {
    const words = "So... if I bump like four hundred packages... raise four hundred PRs... that's pretty dumb. Right.";
    expect(quoteLead({ cut: "none", subject: "bump packages", where: "call", words })).toEqual({
      moreAfter: true,
      moreBefore: false,
      text: "if I bump like four hundred packages raise four hundred PRs that's pretty dumb.",
    });
  });

  it("never leads on a stretch a later sentence takes back", () => {
    const words =
      "Let's move the nightly backup to the GCP bucket in the other region. Actually no, scratch that, the nightly backup " +
      "stays local. Keep the weekly one as it is.";
    expect(quoteLead({ cut: "none", subject: "nightly backup bucket", where: "call", words })).toEqual({
      moreAfter: true,
      moreBefore: true,
      text: "Actually no, scratch that, the nightly backup stays local.",
    });
  });

  it("never leads on the card's own text read back aloud", () => {
    const words =
      "Okay... so the card says... merge the evidence mirror pull request tonight... Hmm. I want the mirror to " +
      "wait for the auditor's list first.";
    expect(quoteLead({ cut: "none", subject: "merge the evidence mirror pull request", where: "call", words })).toEqual(
      { moreAfter: false, moreBefore: true, text: "I want the mirror to wait for the auditor's list first." },
    );
  });

  it("never leads on a stretch the very next sentence takes back, whatever words that sentence uses", () => {
    const leads = [
      "So I was thinking we should remove the knip exclusion list entirely. Actually no, scratch that, keep the " +
        "exclusion list for now.",
      "Let's delete the nightly backup bucket in the other region. Never mind. Leave the backup bucket alone for this week.",
    ].map((words) =>
      quoteLead({ cut: "none", subject: "knip exclusion list nightly backup bucket", where: "call", words }),
    );
    expect(leads).toEqual([
      { moreAfter: false, moreBefore: true, text: "Actually no, scratch that, keep the exclusion list for now." },
      { moreAfter: false, moreBefore: true, text: "Leave the backup bucket alone for this week." },
    ]);
  });

  it("never leads on the card read back across several sentences, nor on what a card said", () => {
    const leads = [
      "Okay so it says, knip flags three unused exports. Add them to the exclusion list in knip dot json. Hmm, I " +
        "don't know about that, the exclusion list should stay short.",
      "Okay so the card said merge the evidence mirror pull request tonight. Hmm. I'm not sure about the timing of " +
        "the evidence mirror.",
    ].map((words) =>
      quoteLead({ cut: "none", subject: "knip exclusion list evidence mirror pull request", where: "call", words }),
    );
    expect(leads).toEqual([
      { moreAfter: false, moreBefore: true, text: "I don't know about that, the exclusion list should stay short." },
      { moreAfter: false, moreBefore: true, text: "I'm not sure about the timing of the evidence mirror." },
    ]);
  });

  it("never leads on a sentence the next one opens a condition on", () => {
    const words =
      "I want to merge the renovate bump on acme admin tonight. Unless the auditor objects to the renovate bump.";
    expect(quoteLead({ cut: "none", subject: "merge the renovate bump on acme admin", where: "call", words })).toEqual({
      moreAfter: false,
      moreBefore: true,
      text: "Unless the auditor objects to the renovate bump.",
    });
  });

  it("runs no stretch through a thought the speaker dropped and restarted", () => {
    const words =
      "Maybe we could actually like... um... cut out a lot of work... by... um... if we... [tongue click] Like, I " +
      "think that if we have like four hundred vulnerabilities from unused packages, we raise PRs to delete them.";
    expect(quoteLead({ cut: "none", subject: "unused packages vulnerabilities", where: "call", words })).toEqual({
      moreAfter: false,
      moreBefore: true,
      text: "I think that if we have like four hundred vulnerabilities from unused packages, we raise PRs to delete them.",
    });
  });

  it("never leads on a stretch cut before an in-sentence condition, or ending one the next sentence conditions", () => {
    const leads = [
      "Merge the knip dependency bump on acme admin tonight... once CI is green. Unless the auditor objects.",
      "We should merge the knip dependency bump on acme admin tonight... if we... If CI goes red on the knip leg, hold it.",
      "Merge the knip dependency bump on acme admin tonight. If the auditor signs off on it.",
      "We could just delete the whole knip exclusion list. That's pretty dumb though.",
    ].map((words) =>
      quoteLead({ cut: "none", subject: "merge knip dependency bump acme admin exclusion list", where: "call", words }),
    );
    expect(leads).toEqual([
      undefined,
      { moreAfter: false, moreBefore: true, text: "If CI goes red on the knip leg, hold it." },
      undefined,
      undefined,
    ]);
  });

  it("never leads on a stretch taken back after an interjection, or in words outside the stock phrases", () => {
    const leads = [
      "Let's delete the nightly backup bucket in the other region. Wait. Actually no, keep it.",
      "Let's delete the nightly backup bucket in the other region. Actually, let's not.",
      "Let's delete the nightly backup bucket in the other region. No wait, keep it.",
    ].map((words) => quoteLead({ cut: "none", subject: "nightly backup bucket", where: "call", words }));
    expect(leads).toEqual([undefined, undefined, undefined]);
  });

  it("keeps a read-back running through the card's own 'I'll' and 'us', and after a named speaker", () => {
    const leads = [
      "Okay so the card says, knip flagged three unused exports. I'll add them to the knip exclusion list and " +
        "merge tonight. Hmm. Wait for the auditor.",
      "So the draft says, the auditor wants us to export the evidence mirror. Export the evidence mirror pull " +
        "request tonight for us.",
      "Somebody said we should merge the evidence mirror pull request tonight. I think the auditor reviews the evidence mirror first.",
      "Auditco said we should merge the evidence mirror pull request tonight. I think the auditor reviews the evidence mirror first.",
    ].map((words) =>
      quoteLead({ cut: "none", subject: "knip exclusion list evidence mirror pull request", where: "call", words }),
    );
    expect(leads).toEqual([
      undefined,
      undefined,
      { moreAfter: false, moreBefore: true, text: "I think the auditor reviews the evidence mirror first." },
      { moreAfter: false, moreBefore: true, text: "I think the auditor reviews the evidence mirror first." },
    ]);
  });

  it("never leaves a condition behind anywhere in the sentence, or in the sentence either side", () => {
    const leads = [
      "Merge the knip dependency bump on acme admin tonight... and close the renovate ticket. Unless the auditor objects.",
      "We should merge the knip dependency bump on acme admin tonight... and then we... If CI goes red on the knip leg, " +
        "hold it.",
      "If the auditor signs off on the evidence mirror. Merge the knip dependency bump on acme admin tonight.",
      "If nobody on the platform team raises anything... and the acme admin staging deploy stays healthy... then merge " +
        "the knip dependency bump tonight.",
      "Merge the knip dependency bump on acme admin tonight. Only after the auditor signs off though.",
      "Merge the knip dependency bump on acme admin tonight. When CI is green on every leg.",
      "Merge the knip dependency bump on acme admin tonight. Not tonight though.",
      "Merge the knip dependency bump on acme admin tonight. Hmm, no. Leave it.",
    ].map((words) =>
      quoteLead({ cut: "none", subject: "merge knip dependency bump acme admin", where: "call", words }),
    );
    expect(leads).toEqual([
      undefined,
      { moreAfter: false, moreBefore: true, text: "If CI goes red on the knip leg, hold it." },
      undefined,
      {
        moreAfter: false,
        moreBefore: false,
        text: "If nobody on the platform team raises anything and the acme admin staging deploy stays healthy then merge the knip dependency bump tonight.",
      },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("never leads on a stretch taken back after a longer interjection", () => {
    const leads = [
      "Let's delete the nightly backup bucket in the other region. Wait a second. Actually no, keep it.",
      "Let's delete the nightly backup bucket in the other region. Hmm, hold on. No wait, keep it.",
    ].map((words) => quoteLead({ cut: "none", subject: "nightly backup bucket", where: "call", words }));
    expect(leads).toEqual([undefined, undefined]);
  });

  it("never cuts the first half off a hyphenated word it reads as an opener, typed or spoken", () => {
    const leads = [
      { where: "call" as const, words: "So-called unused dependencies are breaking CI on the knip leg." },
      { where: "console-typed" as const, words: "Right-click the knip config and open the exclusion list." },
      { where: "call" as const, words: "Well-tested dependencies should stay off the knip exclusion list." },
    ].map(({ where, words }) => quoteLead({ cut: "none", subject: "knip exclusion list dependencies", where, words }));
    expect(leads.map((lead) => lead!.text)).toEqual([
      "So-called unused dependencies are breaking CI on the knip leg.",
      "Right-click the knip config and open the exclusion list.",
      "Well-tested dependencies should stay off the knip exclusion list.",
    ]);
  });

  it("keeps a read-back running through the bot's words, a question it asks, and the card's own 'I'd'", () => {
    const leads = [
      "So the bot says we should merge the evidence mirror pull request tonight.",
      "So it's asking whether to merge the evidence mirror pull request tonight.",
      "Okay so the card says, knip flagged three unused exports. I'd add them to the knip exclusion list and merge " +
        "tonight.",
    ].map((words) =>
      quoteLead({ cut: "none", subject: "knip exclusion list evidence mirror pull request", where: "call", words }),
    );
    expect(leads).toEqual([undefined, undefined, undefined]);
  });

  it("in a turn that reads aloud, leads only on the speaker's own stance opening a sentence", () => {
    const leads = [
      {
        // Reading a PR card back, no "says" beside the read text.
        where: "call-landing" as const,
        words:
          "[breath] Yeah, I'm just, uh... um... just reading through the rest of this. So... uh, code the five " +
          "checkout timeouts, so the checkout page acts on them. What was this PR about again? Um... uh... [sigh] " +
          "It's just more of this webhook retry code stuff, right...",
      },
      {
        // "Continuing reading", then the briefing's own sentence, then the speaker's reaction.
        where: "console-voice" as const,
        words:
          "Alright, continuing reading. Uh... the one real customer we traced retried about twenty times and then " +
          "synced fine. Two jobs are still open. Uh... yeah, I have heard of that... Um... Like I've heard of " +
          "slow cache warmup times, and I know that we have another work stream around it. I don't know if " +
          "it's worth... linking to that here.",
      },
      {
        // A typed quote line, then the speaker reading it.
        where: "session" as const,
        words:
          ">1. Which access group shape do you take to the auditor, your three packs or the three packs plus a named " +
          "review board? Alright, so I'm currently reading through this access group shape and I feel like you " +
          "probably had a good think about it but I'm still missing how the packs map to it.",
      },
      {
        // A bare "says," before the card's text, then the speaker's own view of the checklist.
        where: "console-voice" as const,
        words:
          "Yeah, now, having a look at the release checklist one, so... says, this is real work, but the " +
          "project cannot show it: it holds four status columns, nobody moves... Oh, every one of your per... " +
          "release tickets sits outside it... Yeah... I am not really on the release rota, so I feel like " +
          "the checklist wants a different owner, in Acme...",
      },
    ].map(({ where, words }) =>
      quoteLead({
        cut: "none",
        subject:
          "checkout timeouts checkout page customer retried synced access group shape review board release " +
          "checklist rota",
        where,
        words,
      }),
    );
    expect(leads.map((lead) => lead?.text)).toEqual([
      undefined,
      undefined,
      undefined,
      // The speaker's own view, but after a pause mid-sentence, where read text and reaction run together.
      undefined,
    ]);
  });

  it("never leads on a stretch the next sentences take back in everyday words", () => {
    const leads = [
      "Let's delete the nightly backup bucket in the other region. Hmm, maybe not.",
      "Let's delete the nightly backup bucket in the other region. Wait, keep it for now.",
      "Let's delete the nightly backup bucket in the other region. Or wait, the auditor hasn't signed off yet.",
      "Let's delete the nightly backup bucket in the other region. Nobody has read from it since March. Actually no, keep " +
        "it, the auditor might want it.",
    ].map((words) => quoteLead({ cut: "none", subject: "delete nightly backup bucket", where: "call", words }));
    expect(leads.map((lead) => lead?.text)).toEqual([
      undefined,
      undefined,
      "Or wait, the auditor hasn't signed off yet.",
      undefined,
    ]);
  });

  it("never leads on a stretch an answered, narrowing, interrupted or conjoined condition governs", () => {
    const leads = [
      "Has the auditor signed off on the evidence mirror? If so... Merge the knip dependency bump on acme admin tonight.",
      "Merge the knip dependency bump on acme admin tonight. I mean, only if CI is green.",
      "Merge the knip dependency bump on acme admin tonight. After the auditor signs off though.",
      "If the auditor signs off on the evidence mirror. Okay. Merge the knip dependency bump on acme admin tonight.",
      "But if the auditor signs off on the evidence mirror. Merge the knip dependency bump on acme admin tonight.",
    ].map((words) =>
      quoteLead({ cut: "none", subject: "merge knip dependency bump acme admin", where: "call", words }),
    );
    expect(leads.map((lead) => lead?.text)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("never leads on a colleague's message or a card title read aloud, whatever cue opens it", () => {
    const leads = [
      // A teammate's message read aloud — itself saying "I think" — then the speaker's reply.
      "Are you taking me back to the invoice sync one? Uh... yeah, we were talking about this earlier Uh, you're " +
        "saying, hey, is the demo for this one still on? Couldn't find a recording for it on the team " +
        "videos page yet... And I think the videos page wants one for a launch... I could record it if it " +
        "helps. The checklist asks for someone who wasn't on the build and I wasn't. Okay, well that sounds... " +
        "alright.",
      // A card title read after "Let me see.", with no cue at all.
      "Let me see. Tag PR number 2048 tag the release notes in the full docs index. Okay, so it is about that.",
    ].map((words) =>
      quoteLead({
        cut: "none",
        subject: "demo recording videos invoice sync launch record PR release notes docs index",
        where: "call",
        words,
      }),
    );
    expect(leads).toEqual([undefined, undefined]);
  });

  it("never leads on a stretch an 'or not' or a later retraction undoes, nor leaves an inverted condition behind", () => {
    const leads = [
      "Let's merge the knip dependency bump on acme admin tonight. Or not. I don't know.",
      "Let's merge the knip dependency bump on acme admin tonight. The renovate leg went green this morning. Auditco " +
        "checked the staging deploy too. Actually no, let's not do it tonight.",
      "Should the auditor sign off on the evidence mirror... we merge the knip dependency bump on acme admin tonight.",
      "Depending on what the auditor says... we merge the knip dependency bump on acme admin tonight.",
    ].map((words) =>
      quoteLead({ cut: "none", subject: "merge knip dependency bump acme admin", where: "call", words }),
    );
    expect(leads.map((lead) => lead?.text)).toEqual([
      undefined,
      undefined,
      // The whole sentence, its condition carried with it.
      "Should the auditor sign off on the evidence mirror we merge the knip dependency bump on acme admin tonight.",
      "Depending on what the auditor says we merge the knip dependency bump on acme admin tonight.",
    ]);
  });

  it("in a reading turn, admits one clause of the speaker's stance that opens its sentence, never one behind 'And'", () => {
    const leads = [
      // A card title read with no cue, then "Is it saying".
      "now rotate the plain text deploy token in acme admin CI settings, and revoke in vault. Ooh, what is this? " +
        "Is it saying... I'm a little confused.",
      // A stance running on past a pause into the draft being read.
      "So you're saying, hey, the deploy looks off. I think it's a good opener... And then two settings look wrong " +
        "to me, the acme preview deploy keeps only the latest bundle. See, that's a claim that we're making.",
      // The teammate's message punctuated with stops instead of pauses.
      "Uh, you're saying, hey, is the demo for this one still on? Couldn't find a recording for it on the " +
        "team videos page yet. And I think the videos page wants one for a launch. I could record " +
        "it if it helps. Okay, well that sounds alright.",
    ].map((words) =>
      quoteLead({
        cut: "none",
        subject: "deploy token acme admin ci settings revoke vault preview deploy bundle demo recording videos",
        where: "call",
        words,
      }),
    );
    expect(leads).toEqual([undefined, undefined, undefined]);
  });

  it("never leads on a stretch the speaker scraps or tells the bot to ignore", () => {
    const leads = [
      "Let's delete the nightly backup bucket in the other region. Scrap that, it stays.",
      "Let's delete the nightly backup bucket in the other region. Ignore that, it stays.",
    ].map((words) => quoteLead({ cut: "none", subject: "delete nightly backup bucket", where: "call", words }));
    expect(leads).toEqual([undefined, undefined]);
  });

  it("never leads on an option turned down with 'nah', or tells the bot not to do yet — only on what is said instead", () => {
    const leads = [
      "Which of these do you wanna take to the team? Keep the nightly backups plus weekly backups region splits, buy cold backup tier. Nah, I don't wanna-",
      "Let's merge the knip dependency bump on acme admin tonight. Nah. Leave it till the auditor replies.",
      "Let's merge the knip dependency bump on acme admin tonight. Yeah, nah, leave it till the auditor replies.",
      "Let's merge the knip dependency bump on acme admin tonight. Hang on, don't do that yet.",
      "Let's merge the knip dependency bump on acme admin tonight. Probably not though, the auditor is still reading.",
    ].map((words) =>
      quoteLead({ cut: "none", subject: "merge knip dependency bump acme admin", where: "call", words }),
    );
    expect(leads).toEqual([
      undefined,
      { moreAfter: false, moreBefore: true, text: "Leave it till the auditor replies." },
      { moreAfter: false, moreBefore: true, text: "nah, leave it till the auditor replies." },
      undefined,
      undefined,
    ]);
  });

  it("never leads on an approval withdrawn mid-call, however it is worded — only on the withdrawal", () => {
    const merge = "Merge the knip dependency bump on acme admin tonight.";
    const leads = [
      "Cool-cool let's also just pre-approve that to go out once the notes have been fixed up cause I think the release post looks good. Oh wait, actually, sorry. Hang on, I haven't looked at the PR yet. I should probably do that first, right?",
      `${merge} Oh, wait, hang on... No, sorry, the auditor froze it.`,
      `${merge} Nope, the auditor froze it.`,
      `${merge} Hmm. Let's leave it, the auditor froze it.`,
      `${merge} Leave it for now, the auditor froze it.`,
      `${merge} I changed my mind, the auditor froze it.`,
      `${merge} On reflection, the auditor froze it.`,
    ].map((words) => quoteLead({ cut: "none", subject: "pre-approve merge knip bump", where: "call", words }));
    expect(leads.map((lead) => lead?.text)).toEqual([
      undefined,
      "wait, hang on No, sorry, the auditor froze it.",
      "Nope, the auditor froze it.",
      "Let's leave it, the auditor froze it.",
      "Leave it for now, the auditor froze it.",
      "I changed my mind, the auditor froze it.",
      "On reflection, the auditor froze it.",
    ]);
  });

  it("never leads on a stretch corrected with 'sorry', only on what it is corrected to", () => {
    const merge = "Merge the knip dependency bump on acme admin tonight.";
    const leads = [
      `${merge} Um, and the lockfile. Sorry, not the knip bump, the eslint bump.`,
      `${merge} Uh, sorry, I'm more talking about the eslint bump.`,
      `${merge} Uh sorry- Sorry, wrong one, my mistake. Merge the eslint bump on acme admin tonight.`,
      `${merge} I'm sorry about the echo, the mic is new.`,
    ].map((words) => quoteLead({ cut: "none", subject: "merge knip bump acme admin", where: "call", words }));
    expect(leads.map((lead) => lead?.text)).toEqual([
      "not the knip bump, the eslint bump.",
      "I'm more talking about the eslint bump.",
      "Merge the eslint bump on acme admin tonight.",
      "Merge the knip dependency bump on acme admin tonight.",
    ]);
  });

  it("has no lead when no stretch carries a thought, so the fold shows the opening as before", () => {
    expect(
      quoteLead({ cut: "none", subject: undefined, where: "call", words: "Yeah... uh... hang on. Okay, yep. Mm." }),
    ).toBe(undefined);
  });
});

describe("what a lead drops", () => {
  it("drops a spoken turn's fillers, stutters, false starts, doubled words and annotations, and nothing else", () => {
    expect(
      withoutDisfluencies({
        spoken: true,
        text: "uh, o-our dependen- if- if we, you know, bump it, it [tongue click] like, it's fine, a heroic heroic effort",
      }),
    ).toBe("our if we, bump it like, it's fine, a heroic effort");
  });

  it("never rewrites a real word: a joining prefix, a word said whole twice, an acronym, a unit, a negation", () => {
    const kept = [
      "We need to re-record the cassette and re-review it",
      "a co-owner, a so-so result, a no-no",
      "the ER dashboard and the AH record",
      "the mm wave antenna",
      "ship it, it's ready, Will will merge it",
      "I'd rather we didn't- ship it, merge it now- not tomorrow",
      "do you know Auditco's number, as you know",
      "fixing the four oh four errors, PR nineteen oh eight, version two point oh",
      "the uh-oh moment, Uh-huh, merge it",
      "the in-ingest step, it had had enough",
      "the oh-four-two incident, it's done done, merge it- unless CI is red",
      "I want the pre- and post-merge checks, the short- and long-term plan, what it is is a bug",
      "PR one three eight eight, four four hundred, twenty twenty, five five seconds, the teams I'm in, in Linear",
      "PR seventeen oh oh nine is a win win, a no no, the so so one",
    ].map((text) => withoutDisfluencies({ spoken: true, text }));
    expect(kept).toEqual([
      "We need to re-record the cassette and re-review it",
      "a co-owner, a so-so result, a no-no",
      "the ER dashboard and the AH record",
      "the mm wave antenna",
      "ship it, it's ready, Will will merge it",
      "I'd rather we didn't- ship it, merge it now- not tomorrow",
      "do you know Auditco's number, as you know",
      "fixing the four oh four errors, PR nineteen oh eight, version two point oh",
      "the uh-oh moment, Uh-huh, merge it",
      "the in-ingest step, it had had enough",
      "the oh-four-two incident, it's done done, merge it- unless CI is red",
      "I want the pre- and post-merge checks, the short- and long-term plan, what it is is a bug",
      "PR one three eight eight, four four hundred, twenty twenty, five five seconds, the teams I'm in, in Linear",
      "PR seventeen oh oh nine is a win win, a no no, the so so one",
    ]);
  });

  it("keeps 'you know' when it opens a clause of its own", () => {
    expect(withoutDisfluencies({ spoken: true, text: "you know how the queue sorts" })).toBe(
      "you know how the queue sorts",
    );
  });

  it("drops only the annotations of a typed turn", () => {
    expect(withoutDisfluencies({ spoken: false, text: "um [Image #3] the pre- and post-merge gate" })).toBe(
      "um the pre- and post-merge gate",
    );
  });
});
