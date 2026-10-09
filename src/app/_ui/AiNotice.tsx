import { AI_NOTICE } from "../../lib/publish/notices.ts";
import Callout from "./Callout.tsx";
import Icon from "./Icon.tsx";

/**
 * The AI notice, on screen.
 *
 * The dashboard's licence notices live in `.notices`, which is hidden on
 * screen and printed only -- so a notice the reader must SEE needs its own
 * component, and this is it. Two weights: the landing page states it as a
 * callout, once, where everybody arrives; the working screens carry one quiet
 * line, because a callout on every page is a notice nobody reads by the third.
 *
 * The words are AI_NOTICE and nothing else, so the screen can never say more
 * or less than the exported workbook does.
 */
export default function AiNotice({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="ainote">
        <Icon name="info" size={13} />
        <span>{AI_NOTICE}</span>
      </p>
    );
  }
  return <Callout tone="info" title="How this information was produced">{AI_NOTICE}</Callout>;
}
