/*
 * The line a folded quote of the owner's leads with: the stretch naming what the card is about, speech noise
 * dropped, never the opening filler. The three spoken turns are board-row quotes — the knip heads-up card, and the
 * two waiting asks whose block opened on filler like "Yeah, okay. Well, I guess..." and "Yeah, I like that... sounds
 * good. Uh...".
 */

import { describe, expect, it } from "vitest";

import { quoteLead } from "../../lib/quoteLead";
import { withoutDisfluencies } from "../../lib/quoteLeadSpeech";

const KNIP =
  "anyway... Uh... oh-wait. Hang on I'm talking, hang on... Um... so yeah. Yeah, I've had times where... I run nip... " +
  "and it's like... uh... you know, removed a bunch of dependencies, but it's actually broken some shit... Uh... and, " +
  "so... cause it's not perfect, it, you know, detecting where and how dependency is used. Um... and so... then... um, " +
  "after that... I would uh... uh... then... look at like what the error was where it broke and then I would look at " +
  "which dependency being removed... probably resulted in that and then I would go and add that to an exclusion list " +
  "in the nip dot json. I would say, nip removes this dependency, but it... it actually breaks... if- if we let it do " +
  "that. So... just put this on the exclusion list for now and deal with... You know, if- if we... If we want to do " +
  "more... than we can... but for now... we can like keep other unused dependencies out. I think this would be really " +
  "good because if I'm spending all this time... bumping dependen- if I bump like five hundred dependencies, raise " +
  "five hundred PRs, but it turns out that a hundred of those are unused, that's pretty dumb, right? Like I wouldn't " +
  "want to do that. Maybe we could actually like... um... cut out a lot of work... by... um... uh... if we... um... " +
  "[tongue click] Like, I think that if we have like five hundred vulnerabilities and a hundred of them are coming " +
  "from like unused dependencies, and then we raise PRs to remove those unused dependencies, I think that's... can " +
  "even be better than ";
/** The knip row's summary to its first paragraph's end — the board publishes only its first 320 characters. */
const KNIP_SUMMARY =
  "The owner's words, spoken as 'nip' though the tool is knip, in one recorded call now: 'new work stream candidate. " +
  "I would like to properly use knip in our repo to remove all unused dependencies ... I turn knip on and I'll start " +
  "with just only dependencies, not looking at the rest of the code ... aggressively apply and it'll remove a bunch " +
  "and then I'll watch CI run and see a bunch break ... then I look at what the error was, which dependency being " +
  "removed resulted in that, and add that to an exclusion list in the knip.json ... I am declaring that I want a new " +
  "work stream around aggressively applying knip till CI is green, but an exclusion list has some stuff on it, until " +
  "we get to a point where it's not even possible for us to be working with unused dependencies because PRs are not " +
  "mergeable when they have unused dependencies.'";
const KNIP_SLUG =
  "apply knip aggressively to acme admin in a do not merge draft pr and whitelist what ci proves is used until green";

const BACKWARDS =
  "Yeah, okay. Well, I guess... maybe... something I'm interested in... eh... the supervisor... maybe... spawning a " +
  "session for... is just taking a look at all the things that I've said... you know, in this chat... Mm... And just " +
  "think about... like... you know, instead of focusing... on... evals... specifically... more so... I want to think " +
  "about... what are... other ways... to give... mechanical enforcement... that... context is carried forward... and " +
  "that... mistakes are not... repeated... and... work backwards from there... to decide what... options... we " +
  "might... want to pursue";
const BACKWARDS_SUBJECT =
  "Work backwards from the owner's call: mechanical enforcement that context carries forward and mistakes are not repeated, " +
  "evals only one option";

const DEMO =
  "Yeah, I like that... sounds good. Uh... yeah... and I'd like... um... [tongue click]... for eventually... on the " +
  "queue... um... I'd like to see some... basically slides and a script to react to... uh basically, you know... " +
  "slides and script... for demo day... uh... maybe even showing like, um... you know... what'll happen when... um... " +
  "[tongue click] ... different parts of the live demo are happening, cause uh... you know. Yeah, I'm imagining... " +
  "that we'll have a desktop app... by Friday... and... um... you'll be able to... pre-script... something... but " +
  "also I'm not sure how... we'll... do it";
const DEMO_SUBJECT = "Demo-day slides and script for the owner to react to on the Queue: an opening timeline slide";

describe("the lead a folded quote shows", () => {
  it("leads the knip card, as the board publishes its row, on knip breaking things — never 'Hang on I'm talking'", () => {
    const subject = `${KNIP_SUMMARY.slice(0, 320)} ${KNIP_SLUG}`;
    expect(quoteLead({ cut: "end", subject, where: "call", words: KNIP })).toEqual({
      moreAfter: true,
      moreBefore: true,
      text:
        "I've had times where I run nip and it's like removed a bunch of dependencies, but it's actually broken some " +
        "shit and, so cause it's not perfect, it, detecting where and how dependency is used.",
    });
  });

  it("leads on what the owner would do when a removal breaks CI once the subject names the exclusion list", () => {
    expect(quoteLead({ cut: "end", subject: `${KNIP_SUMMARY} ${KNIP_SLUG}`, where: "call", words: KNIP })).toEqual({
      moreAfter: true,
      moreBefore: true,
      text:
        "after that I would then look at like what the error was where it broke and then I would look at which " +
        "dependency being removed probably resulted in that and then I would go and add that to an exclusion list in " +
        "the nip dot json.",
    });
  });

  it("leads a wandering spoken ask with the stretch stating what is wanted, ending where the speaker did", () => {
    expect(quoteLead({ cut: "none", subject: BACKWARDS_SUBJECT, where: "call", words: BACKWARDS })).toEqual({
      moreAfter: false,
      moreBefore: true,
      text:
        "just think about instead of focusing on evals specifically more so I want to think about what are other " +
        "ways to give mechanical enforcement that context is carried forward and that mistakes are not repeated and " +
        "work backwards from there to decide what options we might want to pursue",
    });
  });

  it("leads the demo-day ask with what the owner would like to see, not 'sounds good'", () => {
    expect(quoteLead({ cut: "none", subject: DEMO_SUBJECT, where: "call", words: DEMO })).toEqual({
      moreAfter: true,
      moreBefore: true,
      text:
        "I'd like for eventually on the queue I'd like to see some basically slides and a script to react to " +
        "basically slides and script for demo day maybe even showing like what'll happen when different parts of " +
        "the live demo are happening",
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
    const words =
      "So... if I bump like five hundred dependencies... raise five hundred PRs... that's pretty dumb. Right.";
    expect(quoteLead({ cut: "none", subject: "bump dependencies", where: "call", words })).toEqual({
      moreAfter: true,
      moreBefore: false,
      text: "if I bump like five hundred dependencies raise five hundred PRs that's pretty dumb.",
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
      "think that if we have like five hundred vulnerabilities from unused dependencies, we raise PRs to remove them.";
    expect(quoteLead({ cut: "none", subject: "unused dependencies vulnerabilities", where: "call", words })).toEqual({
      moreAfter: false,
      moreBefore: true,
      text: "I think that if we have like five hundred vulnerabilities from unused dependencies, we raise PRs to remove them.",
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
          "registration throws, so the register page act on them. What was this PR about again? Um... uh... [sigh] " +
          "It's just more of this GraphQL error code stuff, right...",
      },
      {
        // "Continuing reading", then the briefing's own sentence, then the speaker's reaction.
        where: "console-voice" as const,
        words:
          "Alright, continuing reading. Uh... the one real user we caught waited about fifteen seconds and then " +
          "loaded fine. Three things are still open. Uh... yeah, I have heard of that... Um... Like I've heard of " +
          "slow container startup times, and I know that we have another work stream around it. I don't know if " +
          "it's worth... linking to that here.",
      },
      {
        // three-new-staff-landed-in-vanta-s-default-entry-group-with-the-isms-governance-set: a typed quote line.
        where: "session" as const,
        words:
          ">1. Which Vanta group shape do you take to Theo, your three packs or the three packs plus a named ISMS " +
          "Council? Alright, so I'm currently reading through this Vanta group shape and I feel like you probably had " +
          "a good think about it but I'm just struggling to pass some of this in my head.",
      },
      {
        // A bare "says," before the card's text, then the speaker's own view of their Linear teams.
        where: "console-voice" as const,
        words:
          "Yeah, now, having a look at the release checklist one, so... says, this is real work, but the " +
          "project cannot show it: it holds four status columns, nobody moves... Oh, every one of your per... " +
          "release tickets sits outside it... Yeah... I am not really in the platform team, so I feel like " +
          "I need a change which teams I'm in, in Linear...",
      },
    ].map(({ where, words }) =>
      quoteLead({
        cut: "none",
        subject:
          "registration throws register page user waited loaded vanta group shape security council release " +
          "checklist linear teams",
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
      // A colleague's Slack message read aloud — itself saying "I think" — then the speaker's reply.
      "Are you taking me back to the billing export one? Uh... yeah, we were talking about this earlier Uh, you're " +
        "saying, hey, is the retro for this one still planned? Couldn't find a PIR for it on the post-incident " +
        "reviews page yet... And I think the incidents page wants one for a major... I could facilitate it if it " +
        "helps. The template asks for someone who wasn't on the response and I wasn't. Okay, well that sounds... " +
        "alright.",
      // every-queue-card-lines-up-with-reality-states: a card title read after "Let me see.", with no cue at all.
      "Let me see. Name PR number 1085 name the secret store in the full canon surfaces. Okay, so it is about that.",
    ].map((words) =>
      quoteLead({
        cut: "none",
        subject: "retro post-incident review PIR billing export incident facilitate PR secret store canon surfaces",
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
      "now delete the plain text linear key in acme admin Claude settings, and revoke in linear. Ooh, what is this? " +
        "Is it saying... I'm a little confused.",
      // A stance running on past a pause into the draft being read.
      "So you're saying, hey, the deploy looks off. I think it's a good opener... And then two settings look wrong " +
        "to me, the cloudflare pages deploy drops the previous builds files. See, that's a claim that we're making.",
      // The PIR row punctuated with stops instead of pauses.
      "Uh, you're saying, hey, is the retro for this one still planned? Couldn't find a PIR for it on the " +
        "post-incident reviews page yet. And I think the incidents page wants one for a major. I could facilitate " +
        "it if it helps. Okay, well that sounds alright.",
    ].map((words) =>
      quoteLead({
        cut: "none",
        subject: "linear key acme admin claude settings revoke cloudflare pages deploy builds retro PIR incidents",
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
      "Which of these do you wanna take to the team? Keep the OTel traces plus DD traces profile splits, buy DD trace SDK. Nah, I don't wanna-",
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
      "Cool-cool let's also just pre-approve that to go out once the tag has been fixed up cause I think the Slack message looks good. Oh wait, actually, sorry. Hang on, I haven't looked at the PR yet. I should probably do that first, right?",
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
      `${merge} Uh sorry- Sorry, it's late, I'm tired. Merge the eslint bump on acme admin tonight.`,
      `${merge} I'm sorry about the noise, the builders are in.`,
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
