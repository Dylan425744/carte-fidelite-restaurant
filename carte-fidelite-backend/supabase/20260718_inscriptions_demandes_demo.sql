-- Inscriptions publiques et demandes de rappel, accessibles uniquement au backend.

create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  email text not null,
  status text not null default 'new',
  source text not null default 'site_bravocard',
  notes text,
  created_at timestamptz not null default now(),
  contacted_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint demo_requests_full_name_check
    check (char_length(btrim(full_name)) between 2 and 100),
  constraint demo_requests_phone_check
    check (phone ~ '^\+?[0-9]{8,15}$'),
  constraint demo_requests_email_check
    check (email = lower(email) and char_length(email) <= 254),
  constraint demo_requests_status_check
    check (status in ('new', 'contacted', 'qualified', 'closed')),
  constraint demo_requests_source_check
    check (char_length(source) between 2 and 80),
  constraint demo_requests_notes_check
    check (notes is null or char_length(notes) <= 1000)
);

create index if not exists demo_requests_status_created_idx
  on public.demo_requests (status, created_at desc);

create index if not exists demo_requests_email_created_idx
  on public.demo_requests (email, created_at desc);

alter table public.demo_requests enable row level security;
revoke all on table public.demo_requests from anon, authenticated;
grant select, insert, update, delete on table public.demo_requests to service_role;
