-- =============================================================================
-- 0500 MONEY
-- Ledger (append-only, single source of truth for what a customer owes),
-- payments, bills (immutable statements), expenses & investments.
-- Sign convention: amount_paise > 0 = customer owes more; < 0 = credit.
-- =============================================================================

create table public.ledger_entries (
  id                 uuid primary key default gen_random_uuid(),
  kitchen_id         uuid not null,
  customer_id        uuid not null,
  entry_date         date not null,
  kind               text not null check (kind in
                       ('meal','addon','late_skip','late_fee','payment','waiver','discount','adjustment','reversal')),
  amount_paise       bigint not null check (amount_paise <> 0 and abs(amount_paise) <= 100000000),
  order_id           uuid,
  order_addon_id     uuid,
  payment_id         uuid,
  reverses_entry_id  uuid references public.ledger_entries(id),
  note               text check (char_length(note) <= 300),
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  unique (id, kitchen_id),
  foreign key (customer_id, kitchen_id)    references public.customers (id, kitchen_id),
  foreign key (order_id, kitchen_id)       references public.orders (id, kitchen_id),
  foreign key (order_addon_id, kitchen_id) references public.order_addons (id, kitchen_id),
  check (kind not in ('meal','late_skip','addon') or order_id is not null),
  check (kind <> 'addon' or order_addon_id is not null),
  check (kind not in ('meal','addon','late_skip','late_fee') or amount_paise > 0),
  check (kind not in ('payment','waiver','discount') or amount_paise < 0),
  check (kind <> 'payment' or payment_id is not null),
  check (kind <> 'reversal' or reverses_entry_id is not null),
  check (kind not in ('waiver','discount','adjustment','reversal') or char_length(btrim(note)) > 0)
);
create index ledger_customer_date on public.ledger_entries (customer_id, entry_date);
create index ledger_order on public.ledger_entries (order_id) where order_id is not null;
create unique index ledger_payment_once  on public.ledger_entries (payment_id)        where kind = 'payment';
create unique index ledger_reversal_once on public.ledger_entries (reverses_entry_id) where kind = 'reversal';

-- Append-only, even for the database owner (corrections = new reversal rows).
create trigger ledger_entries_immutable before update or delete on public.ledger_entries
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  kitchen_id         uuid not null,
  customer_id        uuid not null,
  amount_paise       bigint not null check (amount_paise between 100 and 100000000),  -- ₹1 .. ₹10 lakh
  method             text not null check (method in ('cash','upi','bank','other')),
  utr                text check (utr ~ '^[A-Za-z0-9]{6,30}$'),
  proof_path         text check (char_length(proof_path) <= 300),
  paid_on            date not null,
  status             text not null check (status in ('submitted','confirmed','rejected')),
  submitted_by_role  text not null check (submitted_by_role in ('customer','owner')),
  idempotency_key    text not null check (char_length(idempotency_key) between 8 and 80),
  note               text check (char_length(note) <= 300),
  rejected_reason    text check (char_length(rejected_reason) <= 200),
  confirmed_by       uuid references auth.users(id),
  confirmed_at       timestamptz,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            int not null default 1,
  unique (id, kitchen_id),
  unique (kitchen_id, idempotency_key),
  foreign key (customer_id, kitchen_id) references public.customers (id, kitchen_id),
  check (submitted_by_role <> 'customer' or (method = 'upi' and utr is not null)),
  check (status <> 'confirmed' or confirmed_at is not null),
  check (status <> 'rejected' or rejected_reason is not null)
);
-- The same UTR can never be used twice (unless the earlier one was rejected).
create unique index payments_utr_uniq on public.payments (kitchen_id, upper(utr)) where utr is not null and status <> 'rejected';
create index payments_customer on public.payments (customer_id, created_at desc);

alter table public.ledger_entries
  add constraint ledger_payment_fk foreign key (payment_id, kitchen_id) references public.payments (id, kitchen_id);

create trigger payments_no_delete before delete on public.payments
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Bills (statements). Immutable once generated.
-- ---------------------------------------------------------------------------
create table public.bills (
  id                     uuid primary key default gen_random_uuid(),
  kitchen_id             uuid not null,
  customer_id            uuid not null,
  bill_no                text not null,
  period_start           date not null,
  period_end             date not null,
  opening_balance_paise  bigint not null,
  charges_paise          bigint not null,
  credits_paise          bigint not null,
  closing_balance_paise  bigint not null,
  due_date               date not null,
  generated_by           uuid references auth.users(id),
  generated_at           timestamptz not null default now(),
  unique (kitchen_id, bill_no),
  unique (customer_id, period_start, period_end),
  foreign key (customer_id, kitchen_id) references public.customers (id, kitchen_id),
  check (period_end >= period_start and period_end - period_start <= 92),
  check (closing_balance_paise = opening_balance_paise + charges_paise + credits_paise)
);
create trigger bills_immutable before update or delete on public.bills
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Expenses & investments
-- ---------------------------------------------------------------------------
create table public.expense_categories (
  id            uuid primary key default gen_random_uuid(),
  kitchen_id    uuid not null references public.kitchens(id),
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  default_kind  text not null default 'running' check (default_kind in ('running','investment')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (id, kitchen_id)
);
create unique index expense_categories_name_uniq on public.expense_categories (kitchen_id, lower(btrim(name)));

create table public.expenses (
  id               uuid primary key default gen_random_uuid(),
  kitchen_id       uuid not null,
  expense_date     date not null,
  category_id      uuid not null,
  kind             text not null check (kind in ('running','investment')),
  amount_paise     bigint not null check (amount_paise between 1 and 100000000),
  vendor           text check (char_length(vendor) <= 100),
  method           text not null default 'cash' check (method in ('cash','upi','bank','card','other')),
  note             text check (char_length(note) <= 500),
  receipt_path     text check (char_length(receipt_path) <= 300),
  staff_member_id  uuid,      -- salary / advance to staff
  archived_at      timestamptz,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          int not null default 1,
  foreign key (category_id, kitchen_id)     references public.expense_categories (id, kitchen_id),
  foreign key (staff_member_id, kitchen_id) references public.staff_members (id, kitchen_id)
);
create index expenses_kitchen_date on public.expenses (kitchen_id, expense_date);
-- Expenses are archived, never deleted.
create trigger expenses_no_delete before delete on public.expenses
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Charging helpers (called only from functions that perform the state change
-- under a row lock, so each charge happens exactly once per transition).
-- ---------------------------------------------------------------------------
create or replace function app.charge_delivered(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if o.unit_price_paise > 0 then
    insert into public.ledger_entries (kitchen_id, customer_id, entry_date, kind, amount_paise, order_id, created_by)
    values (o.kitchen_id, o.customer_id, o.order_date, 'meal', o.unit_price_paise, o.id, auth.uid());
  end if;
  insert into public.ledger_entries (kitchen_id, customer_id, entry_date, kind, amount_paise, order_id, order_addon_id, created_by)
  select o.kitchen_id, o.customer_id, o.order_date, 'addon', a.qty * a.unit_price_paise, o.id, a.id, auth.uid()
  from public.order_addons a
  where a.order_id = o.id and a.status = 'accepted' and a.qty * a.unit_price_paise > 0;
end $$;

-- Late skip (decision 8): charged at the configured % after N free per month.
create or replace function app.charge_late_skip(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders; c public.customers; s public.business_settings;
  v_free int; v_pct int; v_prior int; v_base bigint; v_amount bigint;
begin
  select * into o from public.orders where id = p_order;
  select * into c from public.customers where id = o.customer_id;
  select * into s from public.business_settings where kitchen_id = o.kitchen_id;
  v_free := coalesce(c.late_skip_free_override, s.free_late_skips_per_month);
  v_pct  := coalesce(c.late_skip_charge_percent_override, s.late_skip_charge_percent);

  select count(*) into v_prior from public.orders x
  where x.customer_id = o.customer_id and x.id <> o.id and x.status = 'skipped_late'
    and date_trunc('month', x.order_date) = date_trunc('month', o.order_date);

  if v_prior < v_free or v_pct = 0 then return; end if;

  select o.unit_price_paise + coalesce(sum(a.qty * a.unit_price_paise), 0) into v_base
  from public.order_addons a where a.order_id = o.id and a.status = 'accepted';
  v_amount := round(v_base * v_pct / 100.0);
  if v_amount > 0 then
    insert into public.ledger_entries (kitchen_id, customer_id, entry_date, kind, amount_paise, order_id, note, created_by)
    values (o.kitchen_id, o.customer_id, o.order_date, 'late_skip', v_amount, o.id,
            format('Skipped after cutoff (%s%%)', v_pct), auth.uid());
    update public.orders set late_skip_charged = true where id = o.id;
  end if;
end $$;

-- Reverse every not-yet-reversed charge of an order (status correction).
create or replace function app.reverse_order_charges(p_order uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ledger_entries (kitchen_id, customer_id, entry_date, kind, amount_paise, order_id, reverses_entry_id, note, created_by)
  select e.kitchen_id, e.customer_id, app.today(), 'reversal', -e.amount_paise, e.order_id, e.id, p_note, auth.uid()
  from public.ledger_entries e
  where e.order_id = p_order and e.kind in ('meal','addon','late_skip')
    and not exists (select 1 from public.ledger_entries r where r.reverses_entry_id = e.id);
  update public.orders set late_skip_charged = false where id = p_order and late_skip_charged;
end $$;

create or replace function app.customer_balance(p_customer uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_paise), 0)::bigint from public.ledger_entries where customer_id = p_customer
$$;

create trigger payments_touch before update on public.payments for each row execute function app.touch();
create trigger expenses_touch before update on public.expenses for each row execute function app.touch();

create trigger payments_audit           after insert or update or delete on public.payments           for each row execute function app.audit_row('true');
create trigger bills_audit              after insert on public.bills                                   for each row execute function app.audit_row('true');
create trigger expense_categories_audit after insert or update or delete on public.expense_categories for each row execute function app.audit_row('true');
create trigger expenses_audit           after insert or update or delete on public.expenses           for each row execute function app.audit_row('true');
-- ledger_entries are themselves the audit trail (immutable, created_by recorded).
