# Tarefas mensais

Scripts que rodavam à mão todo mês, agora num lugar só. Rodam sozinhos no GitHub
todo **3º dia útil** do mês (feriados nacionais em `dia_util.py`), sempre para o **mês anterior**, e os arquivos aparecem para baixar
na aba **Tarefas Mensais** do admin do site.

| Script | O que gera | Substitui |
|---|---|---|
| `carta_mensal.py` | `carta_dados.json`: gráficos, índices, destaques da capa e as tabelas de indicadores (`indicadores_carta.py`) | `template_carta_mensal.py` |
| `carta_ia.py` | `carta_rascunho_ia.json`: rascunho da carta escrito pelo Claude via API (opcional, só com a chave) | o prompt colado à mão no Claude |
| `indicadores_americanos.py` | `USA_Indicators.xlsx` (CPI + índices) | `pyscript-indicadores-americanos.py` |
| `cotas_fundos.py` | `cotacoes_fundos_<mês>_<ano>.xlsx` (NAV dos UCITS) | `baixar_cotas_fundos.py` |
| `cotas_b3.py` | `cotas_b3_<mês>_<ano>.xlsx` (todos os pregões do mês) | `cotas_b3_datas.py` |
| `etfs.py` | `fechamentos.csv` (Close) e `fechamentos_ajustados.csv` (Adj Close) | `cotacao_etfs.py` e `adj_cotacao_etfs.py` |
| `dados_planilha.py` | `atualizacao_dados_<mês>_<ano>.xlsx`: índices do Banco Central, CDI, PTAX, Ibovespa, indicadores globais, CPI, cotas da CVM e da B3 no layout da planilha Dados EH, com aba de conferência | digitação na `Dados_EH_Investimentos.xlsx` |
| `rodar_todas.py` | roda tudo e grava `status.json` | — |

## O que muda todo mês

- **Nada nos scripts.** As datas são calculadas a partir do mês de referência.
- `fundos.csv`: atualizar `cota_referencia` (ponto como decimal) e `data_referencia`
  (AAAA-MM-DD) com as cotas do extrato. É a conferência da aba Controle.
- Listas de ativos: `ativos_b3.csv` (B3), `fundos.csv` (UCITS), `fundos_brasil.csv` (CNPJs da aba
  Cotas da EH Base Unica) e `CONJUNTOS` no topo de `etfs.py`.

## Planilha EH Base Unica (abas Dados e Cotas)

O arquivo `atualizacao_dados_...xlsx` entra na planilha base pela macro `excel/ImportarDadosEH.bas`,
que cola cada valor no lugar certo sem mudar a estrutura e lista os conflitos. Instalação e regras
em `excel/COMO-USAR.md`. Fundo novo na aba Cotas: incluir o CNPJ em `fundos_brasil.csv`. Fundo sem fonte pública que bata com a planilha: escrever `manual: motivo` na coluna `coleta`.

FIDCs e fundos que não estão no informe diário da CVM saem do informe mensal de FIDC (cota de
fim de mês). Esse informe é publicado até uns 15 dias depois do fim do mês, então no 3º dia útil ainda
vem a cota do mês anterior; rodando a tarefa de novo depois do dia 15, vem a do mês de referência.

> O repositório é público: tudo nesta pasta fica visível na internet. A chave da
> FRED e os arquivos gerados nunca entram aqui (estão no `.gitignore`).

## Configuração (uma vez só)

1. **Supabase:** rodar `supabase/2026-10-28_tarefas_mensais.sql` no SQL Editor.
   Cria o bucket privado `tarefas-mensais`, que só os admins acessam.
2. **GitHub → Settings → Secrets and variables → Actions → New repository secret:**
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API → `service_role`.
   - `ANTHROPIC_API_KEY` (opcional, pago): a chave da API do Claude (veja "Rascunho da carta com o Claude").
   - `FRED_API_KEY`: a chave da FRED. Como a antiga ficou escrita no script, vale gerar
     uma nova em https://fred.stlouisfed.org/docs/api/api_key.html.

## Carta mensal

A carta é montada no admin, na tela **Editor da Carta**: os dados do mês vêm do
`carta_dados.json`, os textos de cada seção, os indicadores e o Focus são escritos ali
(o rascunho fica salvo em `AAAA-MM/carta_textos.json` no Supabase) e a prévia em A4
usa o modelo `carta/carta_template.html`. **Salvar PDF** imprime a carta;
**Guardar carta final no site** grava o HTML junto dos arquivos do mês.

A tabela **Indicadores** vem sozinha (`indicadores_carta.py`, Banco Central e Yahoo), em grupos,
com fechamento e variação no mês, no ano e em 6, 12 e 24 meses:

- **Juros:** Selic (variações em p.p.), CDI (taxa ao ano e rentabilidade acumulada) e Poupança.
- **Inflação:** IPCA, IPCA-15 e IGP-M.
- **Mercado:** R$/USD (PTAX), Brent, Ibovespa e S&P 500.
- **Fiscal:** Dívida Bruta (% do PIB, variações em p.p.).

Ela entra no editor ao abrir um mês novo e no botão **Atualizar com os dados do mês**. A data do
Copom no detalhe da Selic continua à mão. Linha tirada da tabela não volta sozinha; linha nova
que você criar fica no fim.

IPCA e outros índices que saem depois do 3º dia útil usam o último mês divulgado, e a carta diz
qual é. Rodando a tarefa `carta_mensal` de novo depois do dia 10, vem o IPCA do mês.

O **Boletim Focus** também vem sozinho (API de Expectativas do Banco Central): Selic, IPCA, PIB e
dólar para o fim do ano, mediana, do último boletim com a coleta dentro do mês. O Focus sai na
segunda-feira com as projeções até a sexta anterior, então a carta de outubro usa o boletim de 3 de
novembro (coleta até 30 de outubro). A referência com as duas datas aparece abaixo das projeções e
pode ser editada no editor.

### Rascunho da carta com o Claude

O pedido fixo ao Claude fica em `carta/prompt_carta.md` (estilo, roteiro de cada seção, formato).
Pode editar à vontade. Há dois jeitos de usar:

**De graça, copiando e colando (padrão).** No Editor da Carta, painel "Rascunho com o Claude":
1. (opcional) escrever os pedidos do mês, por exemplo "dar mais espaço às eleições";
2. **Copiar pedido para o Claude**: junta o prompt, os números do mês e as cartas dos meses
   anteriores escritas no editor;
3. colar numa conversa nova no Claude, com a busca na web ligada (dá para anexar PDFs de cartas
   antigas junto);
4. copiar a resposta inteira, colar no editor e clicar **Preencher a carta com a resposta**.
   O painel mostra as fontes e os pontos que o Claude marcou para conferir.

**Automático, pela API (opcional, pago).** `carta_ia.py` faz o mesmo sozinho no 3º dia útil e
grava `carta_rascunho_ia.json`. Só funciona com o segredo `ANTHROPIC_API_KEY` (chave criada em
https://platform.claude.com, cobrada à parte da assinatura do Claude, cerca de US$ 2 a 5 por carta).
Sem a chave, a tarefa só avisa e nada é cobrado. Cartas antigas para a API vão na pasta
`referencias-carta/` do bucket, pelo próprio editor.

## Rodar fora do 3º dia útil

GitHub → Actions → **Tarefas mensais** → **Run workflow** (o admin tem um link direto).
Campos opcionais: mês (`AAAA-MM`), tarefas (ex.: `cotas_b3,etfs`) e, só para a B3,
data inicial e final.

## Rodar no Spyder (opcional)

1. Copiar esta pasta para o computador e instalar: `pip install -r requirements.txt`
   (as cotas dos fundos pedem Python 3.11 ou mais novo).
2. Criar `chave_fred.txt` nesta pasta com a chave da FRED (uma linha só) e, para o rascunho
   da carta, `chave_anthropic.txt` com a chave da API do Claude. Cartas antigas de referência
   podem ir em `carta/referencias/`. Nenhum desses arquivos vai para o GitHub.
3. Abrir o script e apertar **Run**. Para outro mês, preencher `MES = "2026-09"` no topo.
   Os arquivos vão para `saidas/AAAA-MM/`.
