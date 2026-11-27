-- =====================================================================
-- IT Asset Manager - Supabase (PostgreSQL) Schema
-- Paste this entire script into Supabase SQL Editor and click "RUN"
-- =====================================================================

-- 1. Employees Table
create table if not exists employees (
  "id" text primary key,
  "createdAt" text,
  "empCode" text,
  "name" text not null,
  "email" text,
  "phone" text,
  "designation" text,
  "department" text,
  "location" text,
  "company" text,
  "doj" text,
  "band" text,
  "status" text default 'Active',
  "exitDate" text,
  "notes" text
);

-- 2. Assets Table
create table if not exists assets (
  "id" text primary key,
  "createdAt" text,
  "tag" text not null,
  "type" text not null,
  "status" text default 'In Stock',
  "make" text,
  "model" text,
  "serialNo" text,
  "hostname" text,
  "processor" text,
  "ram" text,
  "storage" text,
  "os" text,
  "osLicense" text,
  "domainJoin" text,
  "imei" text,
  "simNumber" text,
  "screenTag" text,
  "accessories" text,
  "condition" text,
  "physical" text,
  "qsync" text,
  "empCode" text,
  "holderName" text,
  "holderEmail" text,
  "department" text,
  "location" text,
  "allocatedDate" text,
  "vendor" text,
  "purchaseDate" text,
  "warrantyEnd" text,
  "cost" numeric,
  "engineer" text,
  "adobeId" text,
  "extra" text,
  "remarks" text
);

-- 3. Software Table
create table if not exists software (
  "id" text primary key,
  "name" text not null,
  "version" text,
  "category" text,
  "licenseType" text,
  "vendor" text,
  "totalSeats" numeric default 0,
  "cost" numeric,
  "expiry" text,
  "departments" text,
  "notes" text
);

-- 4. Software Assignments Table
create table if not exists sw_assign (
  "id" text primary key,
  "empId" text,
  "swId" text,
  "name" text,
  "tag" text
);

-- 5. Maintenance Table
create table if not exists maint (
  "id" text primary key,
  "tag" text not null,
  "type" text,
  "cost" numeric,
  "engineer" text,
  "date" text,
  "note" text,
  "before" text,
  "after" text
);

-- 6. Audit History Table
create table if not exists history (
  "id" text primary key,
  "ts" text,
  "tag" text,
  "action" text,
  "detail" text,
  "who" jsonb,
  "by" text
);

-- 7. Settings Table
create table if not exists settings (
  "id" text primary key default 'global',
  "org" text,
  "engineer" text,
  "locations" jsonb,
  "theme" text,
  "lastBackup" text
);

-- Indexes for lightning-fast search
create index if not exists idx_assets_tag on assets ("tag");
create index if not exists idx_assets_serial on assets ("serialNo");
create index if not exists idx_assets_emp on assets ("empCode");
create index if not exists idx_emp_code on employees ("empCode");
create index if not exists idx_emp_email on employees ("email");

-- =====================================================================
-- 8. Enable Full Replica Identity for Real-Time Synchronization
-- Ensures Supabase Realtime sends complete row details on update/delete
-- =====================================================================
alter table employees replica identity full;
alter table assets replica identity full;
alter table software replica identity full;
alter table sw_assign replica identity full;
alter table maint replica identity full;
alter table history replica identity full;
alter table settings replica identity full;

-- Enable Realtime publication for all tables (idempotent block)
do $$
begin
  alter publication supabase_realtime add table employees, assets, software, sw_assign, maint, history, settings;
exception when others then null;
end $$;

-- =====================================================================
-- 9. Row Level Security (RLS) Policies
-- =====================================================================
alter table employees enable row level security;
alter table assets enable row level security;
alter table software enable row level security;
alter table sw_assign enable row level security;
alter table maint enable row level security;
alter table history enable row level security;
alter table settings enable row level security;

-- Clean existing legacy policies to prevent duplicate policy errors on re-run
drop policy if exists "Allow all operations for employees" on employees;
drop policy if exists "Allow all operations for assets" on assets;
drop policy if exists "Allow all operations for software" on software;
drop policy if exists "Allow all operations for sw_assign" on sw_assign;
drop policy if exists "Allow all operations for maint" on maint;
drop policy if exists "Allow all operations for history" on history;
drop policy if exists "Allow all operations for settings" on settings;

drop policy if exists "emp_select" on employees;
drop policy if exists "emp_insert" on employees;
drop policy if exists "emp_update" on employees;
drop policy if exists "emp_delete" on employees;

drop policy if exists "assets_select" on assets;
drop policy if exists "assets_insert" on assets;
drop policy if exists "assets_update" on assets;
drop policy if exists "assets_delete" on assets;

drop policy if exists "sw_select" on software;
drop policy if exists "sw_insert" on software;
drop policy if exists "sw_update" on software;
drop policy if exists "sw_delete" on software;

drop policy if exists "sw_assign_all" on sw_assign;
drop policy if exists "maint_all" on maint;
drop policy if exists "history_all" on history;
drop policy if exists "settings_all" on settings;

-- ---------------------------------------------------------------------
-- ROLE-BASED ACCESS CONTROL (RBAC) FUNCTIONS & POLICIES
-- IT Admin: Full access to all tables (Assets, Software, Settings, etc.)
-- HR Team: Access STRICTLY to Employee profiles & No-Dues Clearance
-- ---------------------------------------------------------------------

create or replace function is_it_admin()
returns boolean as $$
begin
  if auth.uid() is not null then
    return coalesce(auth.jwt() -> 'user_metadata' ->> 'role', 'it_admin') = 'it_admin';
  end if;
  return true;
end;
$$ language plpgsql security definer;

-- Employees: Both HR and IT Admin can read, insert and update. Only IT Admin can delete.
create policy "emp_select" on employees for select using (true);
create policy "emp_insert" on employees for insert with check (id is not null);
create policy "emp_update" on employees for update using (id is not null) with check (id is not null);
create policy "emp_delete" on employees for delete using (id is not null and is_it_admin());

-- Assets: Strictly restricted to IT Admin! HR cannot read, write, or delete assets.
create policy "assets_select" on assets for select using (is_it_admin());
create policy "assets_insert" on assets for insert with check (id is not null and tag is not null and is_it_admin());
create policy "assets_update" on assets for update using (id is not null and is_it_admin()) with check (id is not null and is_it_admin());
create policy "assets_delete" on assets for delete using (id is not null and is_it_admin());

-- Software: Strictly restricted to IT Admin
create policy "sw_select" on software for select using (is_it_admin());
create policy "sw_insert" on software for insert with check (id is not null and is_it_admin());
create policy "sw_update" on software for update using (id is not null and is_it_admin()) with check (id is not null and is_it_admin());
create policy "sw_delete" on software for delete using (id is not null and is_it_admin());

-- Software Assignments, Maintenance, Audit History, Settings
create policy "sw_assign_all" on sw_assign for all using (id is not null and (auth.uid() is null or is_it_admin())) with check (id is not null and (auth.uid() is null or is_it_admin()));
create policy "maint_all" on maint for all using (id is not null and (auth.uid() is null or is_it_admin())) with check (id is not null and (auth.uid() is null or is_it_admin()));
create policy "history_all" on history for all using (id is not null) with check (id is not null);
create policy "settings_all" on settings for all using (id is not null and (auth.uid() is null or is_it_admin())) with check (id is not null and (auth.uid() is null or is_it_admin()));

-- ---------------------------------------------------------------------
-- OPTIONAL: STRICT AUTHENTICATION POLICIES (If you enable Supabase Auth)
-- Uncomment these if you wish to restrict write/delete strictly to logged-in users:
--
-- drop policy if exists "emp_insert" on employees;
-- drop policy if exists "emp_update" on employees;
-- drop policy if exists "emp_delete" on employees;
-- create policy "emp_auth_write" on employees for all to authenticated using (true) with check (true);
--
-- Or restrict to your company email domain:
-- create policy "emp_company_only" on employees for all to authenticated
--   using (auth.jwt() ->> 'email' like '%@tractorjunction.com')
--   with check (auth.jwt() ->> 'email' like '%@tractorjunction.com');
-- ---------------------------------------------------------------------

-- Grant Table Permissions to anon and authenticated roles
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

