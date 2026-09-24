-- ─────────────────────────────────────────────────────────────
--  eh-diagnostico-setup.sql — EH Investimentos · Diagnóstico Financeiro
--
--  Execute este script no projeto Supabase da EH (o mesmo do
--  Portal do Cliente):
--  painel do Supabase > SQL Editor > New query > cole tudo > Run.
--
--  Pode ser executado quantas vezes quiser: o script é idempotente
--  (não duplica nada e não apaga dados já gravados). Ele não mexe
--  nas tabelas do portal (profiles, onboarding, reports…).
--
--  Modelo de segurança: a chave anon (pública, embutida no site)
--  só permite INSERIR respostas e ENVIAR arquivos de relatório.
--  Ninguém consegue ler, listar, alterar ou apagar dados com ela.
--  Você acessa as respostas e os relatórios pelo painel do
--  Supabase (Table Editor e Storage), que usa sua conta de admin.
-- ─────────────────────────────────────────────────────────────

-- ── 1) Tabela com as respostas do formulário ──────────────────
create table if not exists public.diagnosticos (
  id uuid primary key,
  created_at timestamptz not null default now(),
  nome text,
  email text,
  score integer,
  nivel text,
  arquetipo text,
  respostas jsonb not null,
  relatorio_arquivo text,
  idade_aposentadoria integer,
  estrategia text,
  renda_desejada numeric,
  patrimonio_necessario numeric,
  aporte_necessario numeric,
  aporte_atual numeric,
  resumo jsonb
);

create index if not exists diagnosticos_created_at_idx on public.diagnosticos (created_at desc);
create index if not exists diagnosticos_email_idx on public.diagnosticos (email);

alter table public.diagnosticos enable row level security;

-- Visitantes (chave anon) e clientes logados podem apenas inserir —
-- nunca ler/alterar/apagar.
drop policy if exists "anon insere diagnostico" on public.diagnosticos;
create policy "anon insere diagnostico"
  on public.diagnosticos
  for insert
  to anon, authenticated
  with check (true);

-- ── 2) Bucket privado para os arquivos de relatório ───────────
insert into storage.buckets (id, name, public)
values ('relatorios-diagnostico', 'relatorios-diagnostico', false)
on conflict (id) do nothing;

-- Visitantes podem apenas enviar arquivos para esse bucket —
-- nunca listar, baixar, sobrescrever ou apagar.
drop policy if exists "anon envia relatorio diagnostico" on storage.objects;
create policy "anon envia relatorio diagnostico"
  on storage.objects
  for insert
  to anon, authenticated
  with check (bucket_id = 'relatorios-diagnostico');

-- ── 3) Conferência ────────────────────────────────────────────
-- Depois do Run, estas duas consultas devem retornar 1 linha cada.
-- Se a segunda vier vazia, o bucket não foi criado: crie-o à mão em
-- Storage > New bucket, com o nome "relatorios-diagnostico" e a
-- opção "Public" DESMARCADA, e rode este script de novo.
select 'tabela diagnosticos' as item, count(*) as ok
  from information_schema.tables
 where table_schema = 'public' and table_name = 'diagnosticos';

select 'bucket relatorios-diagnostico' as item, count(*) as ok
  from storage.buckets where id = 'relatorios-diagnostico';
