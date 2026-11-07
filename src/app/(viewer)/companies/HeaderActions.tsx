"use client";

import { useSearchParams } from "next/navigation";
import { parseRosterParams, toRosterParams } from "../../../lib/profile/roster.ts";
import Icon from "../../_ui/Icon.tsx";
import { SaveAsReport } from "../reports/ReportControls.tsx";

/**
 * Excel and Save as report, in the page header (Samuel, 7 November), so the
 * filter row has room for the filters. They act on the view on screen: the
 * table keeps the address in step with its filters (history.replaceState,
 * which Next's useSearchParams follows), and these read it from there. The
 * page is dynamic, so the address is known on the server's first render too.
 * Read through the roster's own parser, so an old link (hide=) is saved in
 * the spelling the table writes; `from=` names a report, not a filter.
 */
export default function HeaderActions() {
  const search = useSearchParams();
  const view = new URLSearchParams(search.toString());
  view.delete("from");
  const params = toRosterParams(parseRosterParams(view)).toString();
  const excel = new URLSearchParams(params);
  excel.set("format", "xlsx");
  return (
    <>
      <a className="btn sm secondary" href={`/api/companies/export?${excel.toString()}`} download>
        <Icon name="download" size={13} /><span className="lbl">Excel</span>
      </a>
      <SaveAsReport params={params} />
    </>
  );
}
