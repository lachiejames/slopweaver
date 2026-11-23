/**
 * The ONE read of the responder break-glass: is the journalled `responder-allow-open` grant open for this
 * session, right now?
 *
 * It was an ambient variable read straight from the environment in nine places, outside the escape-hatch
 * register, so the register could not list it and `escape-hatch` could not police it. It widens who may
 * drive the bot AND who receives its replies, which is the outbound lane's criterion
 * (`src/devLint/journalledIds.ts`), so it opens on a grant that names the visible session, carries a written
 * reason and expires in 30 minutes: `slopweaver hatch open responder-allow-open --reason "<why>"`. No
 * variable opens it.
 *
 * Two consequences are the design rather than a gap. A listener asks PER ADDRESS (`socket.ts`), so a grant
 * cannot outlive itself in a listener that runs for hours. And a bot turn spawned into its own visible
 * session has its own session id, so it needs its own grant — the listener's never travels to it.
 */
import { hatchOpenNow } from "../../hatch/open.js";
import { admitResponder, type ResponderDecision, type ResponderWhitelist } from "./whitelist.js";

/**
 * A live listener's admission of one addresser: the grant asked NOW, the list read NOW, and a loud operator
 * line whenever the grant — not the list — is what let them in, so every such admission is on the record.
 *
 * @param userId the addresser's Slack user id
 * @param responderHatchOpen asks whether the grant is open at this instant; called once, here
 * @param responderWhitelist reads `responders.json` at this instant; called once, here
 * @param log where the operator line goes when the grant admitted someone the list did not
 * @returns the decision {@link admitResponder} reached
 */
export function admitAddresser({
  userId,
  responderHatchOpen,
  responderWhitelist,
  log,
}: {
  userId: string;
  responderHatchOpen: () => boolean;
  responderWhitelist: () => ResponderWhitelist;
  log: (args: { line: string }) => void;
}): ResponderDecision {
  const decision = admitResponder({ openOverride: responderHatchOpen(), userId, whitelist: responderWhitelist() });
  if (decision.admitted && decision.openOverride === true) {
    log({
      line: `admitted ${userId}, who is NOT on responders.json, through the journalled responder-allow-open grant`,
    });
  }
  return decision;
}

/**
 * Whether the journalled `responder-allow-open` grant is open for this process's session at this instant.
 *
 * @param home the state home the verb resolved, whose grant journal `hatch open --home` wrote
 * @returns true when this session holds a live grant for that row
 */
export function responderHatchOpenNow({ home }: { home: string }): boolean {
  return hatchOpenNow({ home, id: "responder-allow-open" });
}
