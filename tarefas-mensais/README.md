# Tarefas mensais

Scripts que rodavam à mão todo mês, agora num lugar só. Rodam sozinhos no GitHub
todo **dia 2**, sempre para o **mês anterior**, e os arquivos aparecem para baixar
na aba **Tarefas Mensais** do admin do site.

| Script | O que gera | Substitui |
|---|---|---|
| `carta_mensal.py` | `carta_dados.json`: gráficos, índices e destaques da capa da carta | `template_carta_mensal.py` |
| `indicadores_americanos.py` | `USA_Indicators.xlsx` (CPI + índices) | `pyscript-indicadores-americanos.py` |
| `cotas_fundos.py` | `cotacoes_fundos_<mês>_<ano>.xlsx` (NAV dos UCITS) | `baixar_cotas_fundos.py` |
| `cotas_b3.py` | `cotas_b3_<mês>_<ano>.xlsx` (todos os pregões do mês) | `cotas_b3_datas.py` |
| `etfs.py` | `fechamentos.csv` (Close) e `fechamentos_ajustados.csv` (Adj Close) | `cotacao_etfs.py` e `adj_cotacao_etfs.py` |
| `rodar_todas.py` | roda tudo e grava `status.json` | — |

## O que muda todo mês

- **Nada nos scripts.** As datas são calculadas a partir do mês de referência.
- `fundos.csv`: atualizar `cota_referencia` (ponto como decimal) e `data_referencia`
  (AAAA-MM-DD) com as cotas do extrato. É a conferência da aba Controle.
- Listas de ativos: `ativos_b3.csv` (B3), `fundos.csv` (UCITS) e `CONJUNTOS` no topo de `etfs.py`.

> O repositório é público: tudo nesta pasta fica visível na internet. A chave da
> FRED e os arquivos gerados nunca entram aqui (estão no `.gitignore`).

## Configuração (uma vez só)

1. **Supabase:** rodar `supabase/2026-10-28_tarefas_mensais.sql` no SQL Editor.
   Cria o bucket privado `tarefas-mensais`, que só os admins acessam.
2. **GitHub → Settings → Secrets and variables → Actions → New repository secret:**
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API → `service_role`.
   - `FRED_API_KEY`: a chave da FRED. Como a antiga ficou escrita no script, vale gerar
     uma nova em https://fred.stlouisfed.org/docs/api/api_key.html.

## Carta mensal

A carta é montada no admin, na tela **Editor da Carta**: os dados do mês vêm do
`carta_dados.json`, os textos de cada seção, os indicadores e o Focus são escritos ali
(o rascunho fica salvo em `AAAA-MM/carta_textos.json` no Supabase) e a prévia em A4
usa o modelo `carta/carta_template.html`. **Salvar PDF** imprime a carta;
**Guardar carta final no site** grava o HTML junto dos arquivos do mês.

## Rodar fora do dia 2

GitHub → Actions → **Tarefas mensais** → **Run workflow** (o admin tem um link direto).
Campos opcionais: mês (`AAAA-MM`), tarefas (ex.: `cotas_b3,etfs`) e, só para a B3,
data inicial e final.

## Rodar no Spyder (opcional)

1. Copiar esta pasta para o computador e instalar: `pip install -r requirements.txt`
   (as cotas dos fundos pedem Python 3.11 ou mais novo).
2. Criar `chave_fred.txt` nesta pasta com a chave da FRED (uma linha só).
3. Abrir o script e apertar **Run**. Para outro mês, preencher `MES = "2026-09"` no topo.
   Os arquivos vão para `saidas/AAAA-MM/`.
