"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import Icon from "../../_ui/Icon.tsx";
import { changeReport, removeReport, saveReport } from "./actions.ts";

export type ReportInfo = {
  id: string;
  name: string;
  visibility: "private" | "public";
  /** The filters as saved, canonical: what the table's URL would say. */
  params: string;
  ownerName: string;
  mine: boolean;
  /** Its owner, or an Admin: may rename it, update it, delete it. */
  canEdit: boolean;
};

/** A modal that opens with `open` and reports every way out through onClose. */
function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

/** Name and who can see it: the one form behind "Save as report" and "Rename". */
function NameDialog({ open, title, lede, submitLabel, initial, onSubmit, onClose }: {
  open: boolean; title: string; lede: string; submitLabel: string;
  initial: { name: string; visibility: "private" | "public" };
  onSubmit: (v: { name: string; visibility: "private" | "public" }) => Promise<string | null>;
  onClose: () => void;
}) {
  const ref = useDialog(open);
  const [name, setName] = useState(initial.name);
  const [visibility, setVisibility] = useState(initial.visibility);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = `rd-${title.replace(/\W+/g, "-").toLowerCase()}`;

  useEffect(() => {
    if (open) { setName(initial.name); setVisibility(initial.visibility); setError(null); }
  }, [open, initial.name, initial.visibility]);

  return (
    <dialog ref={ref} aria-labelledby={`${id}-h`} onClose={onClose}
            onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const problem = await onSubmit({ name, visibility });
          if (problem) setError(problem);
        });
      }}>
        <h2 id={`${id}-h`}>{title}</h2>
        <p>{lede}</p>
        <label className="rd-field">
          <span>Name</span>
          <input type="text" name="name" value={name} maxLength={80} required autoComplete="off"
                 onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined}
                 aria-describedby={error ? `${id}-e` : undefined} />
        </label>
        <fieldset className="rd-vis">
          <legend>Who can see it</legend>
          <label>
            <input type="radio" name="visibility" value="private" checked={visibility === "private"}
                   onChange={() => setVisibility("private")} />
            <span><b>Private</b> Only you</span>
          </label>
          <label>
            <input type="radio" name="visibility" value="public" checked={visibility === "public"}
                   onChange={() => setVisibility("public")} />
            <span><b>Public</b> Everyone who can sign in</span>
          </label>
        </fieldset>
        {error && <p className="rd-error" id={`${id}-e`} role="alert">{error}</p>}
        <div className="acts">
          <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** "Save as report": the table as it is now, under a name. */
export function SaveAsReport({ params, label = "Save as report", quiet = false }: {
  params: string; label?: string; quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button type="button" className={`btn sm ${quiet ? "quiet" : "secondary"}`} onClick={() => setOpen(true)}>
        <Icon name="bookmark" size={13} />{label}
      </button>
      <NameDialog open={open} title="Save as report" submitLabel="Save report"
                  lede="Saves these filters, the sort and the columns shown. The report always shows the current published data."
                  initial={{ name: "", visibility: "private" }}
                  onClose={() => setOpen(false)}
                  onSubmit={async (v) => {
                    const got = await saveReport({ ...v, params });
                    if (!got.ok) return got.message;
                    setOpen(false);
                    router.push(`/reports/${got.id}` as Route);
                    return null;
                  }} />
    </>
  );
}

/**
 * A report's own controls. Its owner, or an Admin, may save the filters as
 * they now stand, rename it or change who sees it, and delete it. Anybody
 * may save what they are looking at as a report of their own.
 */
export function ReportControls({ report, params, dirty }: { report: ReportInfo; params: string; dirty: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const del = useDialog(dialog === "delete");

  const update = () => start(async () => {
    const got = await changeReport(report.id, { params });
    setError(got.ok ? null : got.message);
    if (got.ok) router.refresh();
  });

  return (
    <>
      {dirty && <span className="rd-dirty" role="status">Changed since saved</span>}
      {report.canEdit && (
        <button type="button" className="btn sm primary" disabled={!dirty || pending} onClick={update}>
          <Icon name="check" size={13} />{pending ? "Saving…" : "Save changes"}
        </button>
      )}
      {dirty && (
        <a className="btn sm quiet" href={`/reports/${report.id}`}>
          <Icon name="undo-2" size={13} />Revert
        </a>
      )}
      {(dirty || !report.canEdit) && <SaveAsReport params={params} label="Save as new" quiet />}
      {report.canEdit && (
        <>
          <button type="button" className="btn sm quiet" onClick={() => setDialog("rename")}>
            <Icon name="pencil" size={13} />Rename
          </button>
          <button type="button" className="btn sm quiet" onClick={() => { setError(null); setDialog("delete"); }}>
            <Icon name="trash-2" size={13} />Delete
          </button>
        </>
      )}
      {error && !dialog && <span className="rd-error" role="alert">{error}</span>}

      <NameDialog open={dialog === "rename"} title="Rename report" submitLabel="Save"
                  lede="Its filters stay as they are saved."
                  initial={{ name: report.name, visibility: report.visibility }}
                  onClose={() => setDialog(null)}
                  onSubmit={async (v) => {
                    const got = await changeReport(report.id, v);
                    if (!got.ok) return got.message;
                    setDialog(null);
                    router.refresh();
                    return null;
                  }} />

      <dialog ref={del} aria-labelledby="rd-del-h" onClose={() => setDialog(null)}
              onCancel={(e) => { e.preventDefault(); setDialog(null); }}>
        <h2 id="rd-del-h">Delete this report?</h2>
        <p>
          “{report.name}” is deleted for everyone{report.visibility === "public" ? " who can see it" : ""}.
          {!report.mine && ` It was saved by ${report.ownerName}.`} The companies it lists are not affected.
        </p>
        {error && <p className="rd-error" role="alert">{error}</p>}
        <div className="acts">
          <button type="button" className="btn quiet" onClick={() => setDialog(null)}>Cancel</button>
          <button type="button" className="btn danger" disabled={pending} onClick={() => start(async () => {
            const got = await removeReport(report.id);
            if (!got.ok) { setError(got.message); return; }
            router.push("/reports" as Route);
          })}>
            {pending ? "Deleting…" : "Delete report"}
          </button>
        </div>
      </dialog>
    </>
  );
}
