-- Órgão emissor do RG no cadastro do cliente (onboarding e contrato).
-- Rodar no Supabase: SQL Editor → New query → colar → Run.
-- Precisa rodar ANTES de publicar a versão do site que grava rg_orgao,
-- senão o "Salvar e continuar" do cadastro falha com "column not found".

alter table public.cadastro_clientes
  add column if not exists rg_orgao text;

comment on column public.cadastro_clientes.rg_orgao is
  'Órgão emissor do RG (ex.: SSP/MG, DETRAN/RJ)';
