import { AI_NOTICE } from "../../lib/publish/notices.ts";
import Callout from "./Callout.tsx";
import Icon from "./Icon.tsx";

/**
 * The AI notice, on screen.
 *
 * The dashboard's licence notices live in `.notices`, which is hidden on
 * screen and printed only -- so a notice the reader must SEE needs its own
 * component, and this is it. Two weights: a callout, and the one quiet line
 * the working screens carry, because a callout on every page is a notice
 * nobody reads by the third. The landing page, where everybody arrives, says
 * it in the practice's own cover-page words.
 *
 * The words are AI_NOTICE and nothing else, so the screen can never say more
 * or less than the exported workbook does.
 */
export default function AiNotice({ compact = false, full = false }: {
  compact?: boolean;
  /** Across the page's whole width, not a reading measure: the companies table is full width. */
  full?: boolean;
}) {
  if (compact) {
    return (
      <p className={`ainote${full ? " ainote-full" : ""}`}>
        <Icon name="info" size={13} />
        <span>{AI_NOTICE}</span>
      </p>
    );
  }
  return <Callout tone="info" title="How this information was produced">{AI_NOTICE}</Callout>;
}
