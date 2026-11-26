# Atualizar a EH Base Unica com a macro ImportarDadosEH

A tarefa mensal **Dados da planilha base** (`dados_planilha.py`) coleta os dados e gera
`atualizacao_dados_<mês>_<ano>.xlsx`, que aparece na aba **Tarefas Mensais** do admin.
A macro lê esse arquivo e cola cada valor no lugar certo das abas Dados e Cotas da `EH Base Unica.xlsx`,
sem mudar a estrutura dela. As outras abas (extratos, Mapa...) não são tocadas.

## O que vem no arquivo

| Aba | Para que serve |
|---|---|
| Importar | Uma linha por valor. É o que a macro lê. |
| Conferência | Fundo não encontrado na CVM, FIDC só com cota de fim de mês, dia útil sem cota, cota repetida, variação fora do normal. |
| Dados - ... / Cotas | Cada bloco já no layout da planilha, para copiar e colar à mão se preferir. Na aba Cotas, cabeçalho laranja = fundo de coleta manual (o motivo está no comentário do CNPJ), azul = FIP (CVM só em abril, agosto e dezembro), amarelo = sem cota no mês. |
| Notas | Fontes e premissas. |

## Instalar (uma vez só)

1. Abra um arquivo novo em branco no Excel e aperte **Alt + F11**.
2. **Arquivo > Importar arquivo...** e escolha `ImportarDadosEH.bas`.
3. Salve como **Pasta de Trabalho Habilitada para Macro (.xlsm)** numa pasta local, fora do
   OneDrive (ex.: `Documentos\Importador Dados EH.xlsm`). Pode ser o mesmo arquivo do
   gerador do relatório: é só importar mais este módulo nele.

## Usar

1. Baixe o `atualizacao_dados_...xlsx` do mês na aba Tarefas Mensais do admin.
2. Abra o arquivo com a macro e depois a `EH Base Unica.xlsx`. Deixe a planilha base na frente.
3. **Alt + F8 > ImportarDadosEH > Executar** e escolha o arquivo baixado.
4. A macro salva uma cópia de segurança da planilha base (na mesma pasta, ou em Documentos se
   ela estiver aberta pela nuvem) e pergunta o que fazer quando um valor digitado for diferente
   do coletado. O recomendado é **Não**: mantém o seu e mostra no relatório.
5. No fim abre um relatório com o resumo, os conflitos e a Conferência. Confira e **salve a
   planilha base você mesma** (a macro não salva).

## Regras da macro

- Célula vazia ou com erro recebe o valor.
- Fórmula que repete a célula de cima (`=C2951`) ou puxa de outro arquivo (`=HLOOKUP([35]...)`)
  é trocada pelo valor coletado quando ele é diferente. Quando é igual, a fórmula com vínculo
  externo vira valor (congela o dado) e as outras ficam como estão (ex.: o CDI repetido).
- Valor digitado ou conta digitada (`=29885.31/287`) nunca é trocado sem você pedir.
- Cota dos informes mensais e quadrimestrais da CVM (FIDC, FII, FIP, FIAGRO; fonte "CVM informe ...")
  só preenche célula vazia.
  Se já houver um valor diferente, mesmo vindo de fórmula, ele vira conflito no relatório.
- Data nova depois da última da coluna vira linha nova, em ordem.
- CNPJ ou ticker que não está na linha 2 da aba Cotas aparece no relatório: crie a coluna e rode de novo.

## Rodar fora do 3º dia útil

GitHub > Actions > **Tarefas mensais** > **Run workflow**, com tarefas = `dados_planilha` e, se
quiser um pedaço do mês, data inicial e final (ex.: do dia 1 ao dia 20).

## Cotas de fim de mês pelos extratos (antes do relatório do dia 10)

FIDCs, FIIs, FIPs e FIAGROs não têm cota diária na CVM, e o informe mensal dos FIDCs só sai
uns 15 dias depois do fim do mês. Para o relatório, use os extratos:

1. No site, **Cotas dos Fundos**: arraste os PDFs do fim do mês (XP e EQI/BTG) e baixe o Excel.
   Tudo é lido no navegador; nenhum extrato sai do seu computador.
2. Na planilha base, rode a macro **ImportarDadosEH** e escolha esse Excel. A aba **Importar**
   dele traz uma linha por fundo da lista (fonte "Extrato XP" ou "Extrato EQI/BTG"), na data
   da cota do extrato.
3. As regras são as de cima: célula vazia ou fórmula recebe a cota do extrato; valor digitado
   diferente vira conflito.

Séries com CNPJ fictício (ex.: Exodus SR3) casam pelo nome dentro do mesmo fundo. Fundo que
não aparece em nenhum extrato do lote fica de fora.

---

# Importar movimentações (aba Movimentações da nova Base EH)

`ImportarMovimentacoes.bas` acrescenta na aba **Movimentações** da base (tabela `tbl_Movimentacoes`)
os lançamentos do arquivo `movimentacoes_<banco>_<data>.xlsx`, gerado no site em
**Extratos → Movimentações** (versão nova do Extratos → Excel).

1. No site, coloque os PDFs de cada corretora na caixinha dela (XP, EQI, BTG, Monte Bravo) e baixe um Excel só.
2. Abra a base, deixe ela ativa e rode `ImportarMovimentacoes` (Alt+F8). Dá para escolher
   vários arquivos de uma vez (XP, EQI e BTG do mês juntos).
3. A macro mostra quantos lançamentos entraram, quantos já estavam na base e os nomes que
   não estão na aba **Mapa**. Complete o Mapa e rode `PreencherClientesPeloMapa`.
4. Confira e salve a base (a macro não salva).

Regras:

- Cada lançamento tem um ID (banco, nome, data do extrato, histórico, valor líquido e saldo).
  ID que já está na base é pulado: importar o mesmo extrato duas vezes não duplica, e o que
  você corrigiu à mão na base (código, valor, Obs) continua como está.
- Cliente vem do Mapa: coluna A = nome no extrato, coluna B = cliente (ex.: LuizFLM).
- Valor = bruto (é o que vai para a COTA); Valor Líquido = o que saiu na conta corrente.
- Data = data usada no cálculo; Data original só aparece quando o juro/amortização do último
  dia útil foi recuado um dia útil.
- Se a aba Movimentações não existir, a macro cria com a tabela e os formatos.

Na planilha do cliente, a movimentação de um ativo num dia fica assim:

```
=-SUMIFS(tbl_Movimentacoes[Valor], tbl_Movimentacoes[Cliente], "LuizFLM",
         tbl_Movimentacoes[Banco], "XP", tbl_Movimentacoes[Código], $E55,
         tbl_Movimentacoes[Data], FJ$1)
```

(com a base aberta, como já acontece hoje com o SUMIFS nas abas de cada cliente).

## Alertas (o que conferir no PDF)

Investback, IR e IOF nunca entram nos avisos. O Excel do site marca **Sim** na coluna Conferir e explica o motivo na coluna Alerta. A aba
**Alertas** junta tudo. São quatro tipos:

- **Linha não reconhecida**: o leitor não soube o tipo do lançamento. Transferências, PIX, TED,
  taxas, câmbio e bolsa já são reconhecidos e não entram.
- **Código fora da Tabela de Produtos**: resgate, aplicação, rendimento, juros, amortização ou
  vencimento sem código. Dá para corrigir na própria tela, em "Corrigir códigos aqui": digite o
  CNPJ/código e clique em Aplicar (vale para todas as linhas sem código com aquele trecho no
  histórico; com "Salvar" marcado, o trecho entra na Tabela de Produtos para os próximos meses).
- **Valor pode ser o líquido**: na EQI/BTG, quando o valor bruto não foi achado na seção do
  fundo ou ficou menor que o líquido; na XP/Monte Bravo, resgate de fundo sem IR no mesmo dia.
  Na tela dá para digitar o valor bruto (Aplicar) ou marcar "Está certo". Ex.: amortização paga
  no dia 1º cujo evento foi no fim do mês anterior: o bruto está no extrato daquele mês.
- **Juros/amortização previstos que não vieram**: compara com o resultado do `cra_eventos` do
  mês nas Tarefas Mensais (mês com mais lançamentos). Avisa quando nenhum extrato trouxe o
  pagamento previsto (±5 dias) e quando o cliente tem outro lançamento do papel no mês, mas não
  o pagamento previsto. Quem tem o papel e não teve nenhum lançamento dele no mês só vai ser
  pego quando a base tiver o histórico de Movimentações.

Na importação, o alerta vai para a coluna Obs como `Conferir: ...`.
