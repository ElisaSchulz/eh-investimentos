-- Bucket privado para as tarefas mensais (carta, indicadores, cotas, ETFs).
-- Rodar no Supabase: SQL Editor → New query → colar → Run.
-- Precisa rodar ANTES de usar a aba Tarefas Mensais e antes da primeira execução
-- do workflow "Tarefas mensais" no GitHub.
--
-- Estrutura do bucket:
--   AAAA-MM/...                  — arquivos gerados pelo GitHub Actions
--   AAAA-MM/status.json          — resultado de cada tarefa
--   AAAA-MM/carta_dados.json     — dados do mês para a carta (gerado pelo GitHub)
--   AAAA-MM/carta_textos.json    — textos da carta, salvos pelo Editor da Carta
--   AAAA-MM/Carta Mensal EH ...  — carta final em HTML, salva pelo Editor da Carta
--
-- O GitHub Actions grava com a service role key (ignora as políticas abaixo).
-- No site, só os e-mails de admin conseguem listar, baixar e gravar arquivos.

insert into storage.buckets (id, name, public)
values ('tarefas-mensais', 'tarefas-mensais', false)
on conflict (id) do update set public = false;

drop policy if exists "tarefas_mensais_admin_select" on storage.objects;
drop policy if exists "tarefas_mensais_admin_insert" on storage.objects;
drop policy if exists "tarefas_mensais_admin_update" on storage.objects;
drop policy if exists "tarefas_mensais_admin_delete" on storage.objects;

create policy "tarefas_mensais_admin_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'tarefas-mensais'
         and lower(auth.jwt() ->> 'email') in ('elisacmazzo@gmail.com', 'contato@eduardohorta.com.br'));

create policy "tarefas_mensais_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tarefas-mensais'
              and lower(auth.jwt() ->> 'email') in ('elisacmazzo@gmail.com', 'contato@eduardohorta.com.br'));

create policy "tarefas_mensais_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'tarefas-mensais'
         and lower(auth.jwt() ->> 'email') in ('elisacmazzo@gmail.com', 'contato@eduardohorta.com.br'));

create policy "tarefas_mensais_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tarefas-mensais'
         and lower(auth.jwt() ->> 'email') in ('elisacmazzo@gmail.com', 'contato@eduardohorta.com.br'));
