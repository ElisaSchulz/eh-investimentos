# Atualizar a planilha Dados EH com a macro ImportarDadosEH

A tarefa mensal **Dados da planilha base** (`dados_planilha.py`) coleta os dados e gera
`atualizacao_dados_<mês>_<ano>.xlsx`, que aparece na aba **Tarefas Mensais** do admin.
A macro lê esse arquivo e cola cada valor no lugar certo da `Dados_EH_Investimentos.xlsx`,
sem mudar a estrutura dela.

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
2. Abra o arquivo com a macro e depois a `Dados_EH_Investimentos.xlsx`. Deixe a planilha base na frente.
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
