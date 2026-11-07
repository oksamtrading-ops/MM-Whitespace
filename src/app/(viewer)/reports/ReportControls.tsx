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
  ownerName: string;
  mine: boolean;
  /** Its owner, or an Admin: may rename it, change who sees it, delete it. */
  canEdit: boolean;
};

/** A report opened on the Companies page, whose filters may be replaced from there. */
export type FromReport = {
  id: string;
  name: string;
  visibility: "private" | "public";
  /** The filters as saved, canonical: what the table's URL would say. */
  params: string;
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
 * "Replace": a report opened on the Companies page takes the filters as they
 * now stand. Only its owner, or an Admin for a public one, is offered it. The
 * report keeps its name, its link and who can see it.
 */
export function ReplaceReport({ report, params, changed }: { report: FromReport; params: string; changed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useDialog(open);
  return (
    <>
      <button type="button" className="btn sm secondary rp-replace" disabled={!changed}
              title={changed ? `Replace “${report.name}”` : "Change a filter first"}
              onClick={() => { setError(null); setOpen(true); }}>
        <Icon name="check" size={13} /><span>Replace “{report.name}”</span>
      </button>
      <dialog ref={ref} aria-labelledby="rd-rep-h" onClose={() => setOpen(false)}
              onCancel={(e) => { e.preventDefault(); setOpen(false); }}>
        <h2 id="rd-rep-h">Replace this report’s filters?</h2>
        <p>
          “{report.name}” will list the companies these filters find
          {report.visibility === "public" ? ", for everyone who can see it" : ""}. Its name, its link and who
          can see it stay the same.
        </p>
        {error && <p className="rd-error" role="alert">{error}</p>}
        <div className="acts">
          <button type="button" className="btn quiet" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="btn primary" disabled={pending} onClick={() => start(async () => {
            const got = await changeReport(report.id, { params });
            if (!got.ok) { setError(got.message); return; }
            setOpen(false);
            router.push(`/reports/${report.id}` as Route);
          })}>
            {pending ? "Replacing…" : "Replace report"}
          </button>
        </div>
      </dialog>
    </>
  );
}

/**
 * A report's own controls, for its owner or an Admin: rename it or change who
 * sees it, and delete it. Its filters change only from the Companies page.
 */
export function ReportControls({ report }: { report: ReportInfo }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const del = useDialog(dialog === "delete");

  if (!report.canEdit) return null;
  return (
    <>
      <button type="button" className="btn sm quiet" onClick={() => setDialog("rename")}>
        <Icon name="pencil" size={13} />Rename
      </button>
      <button type="button" className="btn sm quiet" onClick={() => { setError(null); setDialog("delete"); }}>
        <Icon name="trash-2" size={13} />Delete
      </button>

      <NameDialog open={dialog === "rename"} title="Rename report" submitLabel="Save"
                  lede="Its filters stay as they are saved. To change them, open it in Companies."
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
