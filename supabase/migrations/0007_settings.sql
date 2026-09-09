-- Settings an Admin owns.
--
-- These are DEFAULTS FOR THE NEXT PERIOD, not knobs on the current one. A
-- period's threshold and band are part of what it published; editing them
-- afterwards would leave a frozen snapshot disagreeing with the header above
-- it. So the values live here, a commit copies them onto the period it
-- creates, and from that moment they belong to that period.
--
-- Coverage floors and the fabrication ceiling are deliberately NOT here. The
-- way past a floor is an override with a recorded reason that prints on the
-- dashboard header; a quietly lowered floor is the same decision with nobody
-- named against it.
create table app_settings (
  key        text primary key,
  value      text not null,
  updated_by uuid references app_users(id),
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value) values
  -- Decision 9: at or above CAD 200M, with a 2% proximity band.
  ('default_threshold_amount',   '200000000'),
  ('default_threshold_currency', 'CAD'),
  ('default_threshold_operator', 'gte'),
  ('default_proximity_band_pct', '2'),
  -- A run cannot be created without a budget; this is what it gets when
  -- nobody names one.
  ('default_run_budget_usd',     '25');
