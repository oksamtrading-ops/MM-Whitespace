-- The stage rows, frozen with each revision.
--
-- Until now publish froze values and tiers but not company_period_stages, so
-- the companies table could only infer a stage from the tier -- the one stage
-- that DECIDED it -- and a producer that also explores looked like a producer
-- alone. The practice's own workbook shows all four as check marks ("Stage of
-- Operations"), and so must the table, from the snapshot, because a Viewer
-- reads nothing else.
--
-- Presence rows, as in company_period_stages: a missing row means "false" ONLY
-- when that company's stage_evidence_state, frozen beside it in
-- published_period_values, is complete. Under partial evidence it means "not
-- known", and with none it means nobody researched it.
--
-- Revisions published before this table exist with no rows here. They are
-- not back-filled: the working rows have moved since, and a revision is what
-- was published, not what would be published now.

create table published_period_stages (
  publication_id uuid not null references period_publications(id),
  company_id     uuid not null references companies(id),
  stage          text not null check (stage in
                   ('exploration', 'development', 'production', 'royalty_streaming')),
  primary key (publication_id, company_id, stage)
);
