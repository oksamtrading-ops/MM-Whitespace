"use client";

/**
 * The decision round-trip, shared by both axes of the review workspace.
 *
 * docs/design/08: "Both read the same resolved values; only the axis differs."
 * That has to be true of the decisions too — two copies of accept, override,
 * flag and keep-extract would drift, and the one that drifts is the one nobody
 * is looking at.
 *
 * What each grid keeps for itself is its own shape: a column of companies has
 * a different optimistic patch and a different idea of "next" from a grid of
 * companies against fields.
 */
import { startTransition, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { decide, undo } from "./[field]/actions.ts";

export type DecisionTarget = {
  companyId: string;
  fieldKey: string;
  findingId: string | null;
  findingAttempt: number | null;
};

export type RecordOptions = {
  /** Applied before the server is asked, so the keypress lands on screen. */
  optimistic?: () => void;
  /** The tier consequence, announced with the decision as doc 08 requires. */
  consequence?: string | null;
  /** Undecided rows left after this one. Omitted for an undo, which may not touch this view. */
  remainingAfter?: number;
  extra?: Record<string, string>;
};

export function useDecide(periodId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const announce = useCallback((text: string) => setAnnouncement(text), []);

  const run = useCallback((
    fn: () => Promise<{ ok: boolean; message: string }>,
    opts: Pick<RecordOptions, "optimistic" | "consequence" | "remainingAfter"> = {},
  ) => {
    setBusy(true);
    startTransition(async () => {
      try {
        opts.optimistic?.();
        const result = await fn();
        // The announcement carries the decision AND its consequence: this is
        // how a non-sighted Analyst receives what a sighted one gets from the
        // row changing.
        const left = opts.remainingAfter === undefined ? "" : ` ${opts.remainingAfter} remaining.`;
        announce(`${result.message}${left}` + (opts.consequence ? ` ${opts.consequence}` : ""));
        router.refresh();
      } finally {
        setBusy(false);
      }
    });
  }, [announce, router]);

  const record = useCallback((
    target: DecisionTarget, decision: string, opts: RecordOptions = {},
  ) => {
    const form = new FormData();
    form.set("periodId", periodId);
    form.set("companyId", target.companyId);
    form.set("fieldKey", target.fieldKey);
    form.set("decision", decision);
    if (target.findingId) form.set("findingId", target.findingId);
    if (target.findingAttempt !== null) form.set("findingAttempt", String(target.findingAttempt));
    for (const [k, v] of Object.entries(opts.extra ?? {})) form.set(k, v);
    run(() => decide(form), opts);
  }, [periodId, run]);

  /** Choosing the workbook over the model. The server reads the value. */
  const keepExtract = useCallback((target: DecisionTarget, opts: RecordOptions = {}) => {
    record(target, "override", { ...opts, extra: { ...opts.extra, overrideSource: "extract" } });
  }, [record]);

  const undoLast = useCallback((fieldKey: string) => {
    const form = new FormData();
    form.set("periodId", periodId);
    form.set("fieldKey", fieldKey);
    run(() => undo(form));
  }, [periodId, run]);

  return { busy, announcement, announce, record, keepExtract, undoLast, run };
}
