-- Vídeos explicativos da área do cliente (aba "Vídeos" e botão "Como ler este relatório").
-- Rodar no Supabase: SQL Editor → New query → colar → Run.
-- Precisa rodar ANTES de publicar a versão do site com a aba de vídeos;
-- sem a tabela, a aba mostra "nenhum vídeo" e a tela de admin não salva.

create table if not exists public.videos (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  youtube_id  text not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  category    text not null default 'Geral',
  report_type text,          -- ex.: 'Relatório Mensal'; mostra o botão "Como ler" nos documentos desse tipo
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.videos is 'Vídeos (YouTube não listado) exibidos na área logada do cliente';

alter table public.videos enable row level security;

-- Qualquer usuário logado (cliente ou admin) pode ver os vídeos.
drop policy if exists "videos_select_logados" on public.videos;
create policy "videos_select_logados" on public.videos
  for select to authenticated using (true);

-- Só os admins (mesma lista de ADMIN_EMAILS do painel) podem criar, editar e remover.
drop policy if exists "videos_admin_escreve" on public.videos;
create policy "videos_admin_escreve" on public.videos
  for all to authenticated
  using      (lower(auth.jwt() ->> 'email') in ('elisacmazzo@gmail.com', 'contato@eduardohorta.com.br'))
  with check (lower(auth.jwt() ->> 'email') in ('elisacmazzo@gmail.com', 'contato@eduardohorta.com.br'));
