/**
 * The Alignment page's voice section (`./Alignment.tsx`): how the owner writes, learnt from the Slack messages they sent and
 * never asked. Which of its states is drawn is `../../lib/alignmentVoice.ts`'s decision; this only draws it.
 */

import type { ReactElement } from "react";

import { type VoiceProfileView, voiceBansOf, voiceSlackStepOf } from "../../lib/alignmentVoice";
import { integrationOf } from "../../lib/integrations";
import type { VoiceRules } from "../live/readAlignment";
import { CARD } from "./AlignmentCommon";
import { PageEmpty } from "./PageEmpty";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";
import type { SlackConnectionState } from "./useSlackConnection";

/** The integration the owner's voice is learnt from. */
const SLACK = integrationOf({ id: "slack" });

/** The words both empty states open on. */
const VOICE_EMPTY_TITLE = "Your voice will appear here.";

/**
 * The owner's voice rules, folded and labelled as rules THEY set: the send door refuses them in anything written as them. Never
 * drawn as learnt, since nothing measured them.
 *
 * @returns the fold, or nothing while the rules have not read or hold none
 */
function RulesYouSet({ rules }: { rules: VoiceRules | undefined }): ReactElement | null {
  if (rules === undefined || rules.rules.length === 0) {
    return null;
  }
  const bans = voiceBansOf({ rules });
  return (
    <details className="mt-[0.6rem] text-[0.82rem]" data-testid="alignment-voice-rules">
      <summary className="cursor-pointer text-muted-foreground">
        Rules you set · {String(bans.length)} {bans.length === 1 ? "ban" : "bans"}
      </summary>
      <p className="mt-[0.3rem] mb-0 text-[0.75rem] text-muted-foreground">
        Not learnt: these are yours, and the send door refuses any of them in a message written as you.
      </p>
      <ul className="my-[0.3rem] pl-[1.1rem]">
        {bans.map((ban) => (
          <li key={ban}>{ban}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The voice section's body: the connect step while Slack is known not connected, a designed empty state while the
 * owner's sent messages have not been measured, or the lengths measured over them and the rules they set.
 *
 * @param view what `voiceProfileOf` decided, `undefined` while the measured register has not read
 * @param rules the owner's voice rules, `undefined` until they read
 * @param slack whether a Slack token is present; an unreadable answer is a mark, never "not connected"
 * @param provenNow whether the register's latest read answered, without which an empty one draws no designed state
 * @returns the section body
 */
export function VoiceProfile({
  view,
  rules,
  slack,
  provenNow,
}: {
  view: VoiceProfileView | undefined;
  rules: VoiceRules | undefined;
  slack: SlackConnectionState;
  provenNow: boolean;
}): ReactElement | null {
  const slackUnread =
    slack.phase === "not-measured" ? (
      <StaleMark facts={[{ subject: "whether Slack is connected", why: slack.why }]} block />
    ) : null;
  let tokenPresent: boolean | undefined;
  if (slack.phase === "ready") {
    tokenPresent = slack.tokenPresent;
  }
  const step = voiceSlackStepOf({ tokenPresent, view });
  // `voiceSlackStepOf` answers `connect` for every `not-connected` view; the second test only narrows the type below.
  if (step === "connect" || view?.kind === "not-connected") {
    // The send door's rules are the owner's, never inferred, so they stand whether or not Slack is connected.
    return (
      <>
        <PageEmpty
          title={VOICE_EMPTY_TITLE}
          appearsWhen="How the fleet writes as you is learnt from the Slack messages you sent, never asked. It needs Slack connected first."
          action={{ integration: SLACK, kind: "connect", subjects: [] }}
          surface="alignment-voice"
        />
        <RulesYouSet rules={rules} />
      </>
    );
  }
  if (view === undefined) {
    // The register has not read; an unread Slack preflight is still a fact the section owes, and so are
    // the rules the owner set.
    return (
      <>
        {slackUnread}
        <RulesYouSet rules={rules} />
      </>
    );
  }
  if (view.kind === "not-measured") {
    if (slack.phase === "loading" || slack.phase === "idle") {
      return (
        <>
          <ReadingIndicator label="Checking whether Slack is connected" block />
          <RulesYouSet rules={rules} />
        </>
      );
    }
    if (!provenNow) {
      return (
        <>
          {slackUnread}
          <p className="m-0 text-[0.84rem] text-muted-foreground">
            Your sent Slack messages were not measured as of the last reading that answered.
          </p>
          <RulesYouSet rules={rules} />
        </>
      );
    }
    return (
      <>
        {slackUnread}
        <PageEmpty
          title={VOICE_EMPTY_TITLE}
          appearsWhen="It is learnt from the Slack messages you sent, and appears once a Slack refresh has measured them."
          action={{ kind: "none" }}
          surface="alignment-voice"
        />
        <RulesYouSet rules={rules} />
      </>
    );
  }
  // A measurement already taken stays shown, and an absent token still draws the connect action above it.
  const slackAbsent =
    step === "reconnect" ? (
      <PageEmpty
        title="Slack is not connected"
        appearsWhen="What is shown below is the last measurement of the Slack messages you sent. Connect Slack so it can be measured again."
        action={{ integration: SLACK, kind: "connect", subjects: [] }}
        surface="alignment-voice"
      />
    ) : null;
  return (
    <section className={CARD} data-testid="alignment-voice" aria-label="your voice, learnt from your Slack">
      {slackUnread}
      {slackAbsent}
      <p className="m-0 text-[0.75rem] text-muted-foreground">Measured from the Slack messages you sent</p>
      {view.lengths.map((length) => (
        <div key={length.label} className="mt-[0.5rem]">
          <p className="m-0 text-[0.86rem] font-[650]">{length.label}</p>
          <p className="mt-[0.2rem] mb-0 text-[0.9rem]">{length.spread}</p>
          <p className="mt-[0.2rem] mb-0 text-[0.75rem] text-muted-foreground">{length.basis}</p>
        </div>
      ))}
      <RulesYouSet rules={rules} />
    </section>
  );
}
