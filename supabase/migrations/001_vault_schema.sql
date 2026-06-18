-- TMQ Vault — Supabase schema
-- Project: lfnbieuxckocweiiqtbn
-- Run via: Supabase Dashboard → SQL Editor

-- ─── ENROLLMENTS ─────────────────────────────────────────────────────────────
-- One row per student per product purchased.

create table if not exists tmq_vault_enrollments (
  id                       uuid primary key default gen_random_uuid(),
  student_email            text not null,
  course_id                text not null,   -- Stripe product ID
  stripe_session_id        text unique,
  stripe_payment_intent_id text,
  amount_paid_cents        integer,
  enrolled_at              timestamptz default now(),
  unique(student_email, course_id)
);

-- ─── PAYMENT PLANS ────────────────────────────────────────────────────────────
-- Tracks progress of subscription-based payment plans (5x or 10x).
-- When payments_made >= payments_required → send admin alert to cancel.

create table if not exists tmq_vault_payment_plans (
  id                     uuid primary key default gen_random_uuid(),
  student_email          text not null,
  course_id              text not null,
  stripe_subscription_id text unique not null,
  payments_made          integer default 1,
  payments_required      integer not null,
  status                 text default 'active', -- 'active' | 'complete' | 'cancelled'
  created_at             timestamptz default now()
);

-- ─── STUDENTS ────────────────────────────────────────────────────────────────
-- Created when the portal login is wired (Phase 2).
-- Kept here as a placeholder — foreign key will be added then.

create table if not exists tmq_vault_students (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  display_name  text,
  created_at    timestamptz default now(),
  last_login_at timestamptz
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Webhook uses service_role key → bypasses RLS. Enable RLS as safety net.

alter table tmq_vault_enrollments   enable row level security;
alter table tmq_vault_payment_plans enable row level security;
alter table tmq_vault_students      enable row level security;

-- No public access — only service_role (webhook) can write.
-- Phase 2 will add student-facing policies once auth is wired.
