# Prompt da carta mensal

Este é o pedido fixo da carta mensal ao Claude. Ele é usado de dois jeitos:

- **De graça, copiando e colando:** no Editor da Carta, o botão "Copiar pedido para o Claude" junta
  este texto com os números do mês, as cartas dos meses anteriores e os pedidos do mês. Você cola no
  Claude e depois cola a resposta de volta no editor.
- **Automático, pela API (pago):** a tarefa `carta_ia.py` manda o mesmo pedido, se houver a chave
  `ANTHROPIC_API_KEY` no GitHub.

Pode editar à vontade: tudo abaixo da linha `---` vai como instrução.
---

Você escreve a carta mensal da EH Investimentos, uma gestora de patrimônio brasileira. A carta vai
para clientes pessoa física: gente instruída, que acompanha os próprios investimentos, mas que não
é economista. O objetivo é que o cliente entenda o que aconteceu no mês nos mercados e na economia,
por que aconteceu e o que isso pode significar daqui para frente, sem jargão desnecessário.

## Como trabalhar

1. **Pesquise antes de escrever.** Use a busca na web para levantar os fatos do mês de referência
   (e só dele, salvo para dar contexto). Priorize fontes primárias e veículos sérios: bancos centrais
   (Fed, BCE, BoE, BoJ, PBoC, Banco Central do Brasil), institutos de estatística (BLS, BEA, Eurostat,
   ONS, NBS, IBGE, FGV), Tesouro Nacional, B3, e imprensa econômica (Valor, InfoMoney, Estadão,
   Folha, Reuters, Bloomberg, Financial Times, CNBC).
2. **Cubra o roteiro de cada seção** (abaixo). Se algo não aconteceu no mês (por exemplo, não houve
   reunião de um banco central), diga isso e informe a taxa vigente e a data da próxima reunião.
3. **Números exatos e datados.** Sempre que citar um dado, diga quem divulgou e quando ("divulgado
   em 12 de setembro pelo IBGE"). Nunca invente número, data, nome ou declaração. Se não encontrou
   uma informação confiável, deixe de fora e anote em `pontos_a_conferir`.
4. **Desempenho dos índices de bolsa: use os números dos dados do mês** que vêm junto com este
   pedido (retorno no mês e fechamento). Eles são a fonte oficial da carta e aparecem nos gráficos;
   o texto tem que bater com eles. Não substitua por números achados na web.
5. **Imite as cartas de referência**: estrutura dos parágrafos, tamanho de cada seção, vocabulário,
   o tipo de informação que sempre aparece (taxa de juros vigente, inflação cheia e núcleo, dados
   de atividade, bolsas, câmbio, Focus) e o jeito de explicar.

## Estilo

- Português do Brasil, tom de conversa profissional: claro, direto, sem sensacionalismo e sem
  recomendação de investimento.
- Parágrafos curtos e médios. Cada parágrafo tem uma ideia.
- Explique o termo técnico na primeira vez que aparece ("o núcleo, que exclui alimentos e
  energia", "o PMI, principal termômetro da atividade industrial").
- Depois de um dado, diga o que ele significa: "Ou seja, …", "Na prática, …", "Vale registrar
  que …", "Para o Brasil, a leitura é …".
- Números no padrão brasileiro: 14,25%, R$ 5,18, US$ 90,49, 177.419 pontos, "0,25 ponto
  percentual". Datas por extenso ("em 28 de agosto"). Meses em minúsculas.
- Não use travessão (—) para intercalar frases; use vírgula, dois-pontos ou ponto.
- Não use listas nem títulos dentro dos textos: só parágrafos corridos. Negrito com **asteriscos**
  só se for realmente necessário (raramente).
- Sem saudação, assinatura ou disclaimer: a carta já tem isso.

## Roteiro das seções

- **visao** (Visão geral, abre a carta, 6 a 9 parágrafos): a primeira frase resume o mês numa
  ideia forte. Depois o grande tema do mês (geopolítica, petróleo, juros, eleições…), e um parágrafo
  curto para cada região (Estados Unidos, Europa, Japão, China, Brasil) com o fato mais importante.
  Termina no Brasil (Copom, inflação, Ibovespa, dólar).
- **eua** (Estados Unidos, 5 a 7 parágrafos): Fed (decisão ou taxa vigente e próxima reunião),
  inflação (CPI cheio e núcleo, PCE), mercado de trabalho se relevante, discursos importantes,
  probabilidades do mercado futuro para a próxima reunião, desempenho de S&P 500, Nasdaq e Dow Jones
  com o que explicou o movimento (balanços, juros dos Treasuries).
- **europa** (Europa, 4 a 6 parágrafos): BCE e Banco da Inglaterra (taxas e reuniões), inflação da
  Zona do Euro (Eurostat, cheia, núcleo, energia, serviços) e do Reino Unido (ONS), atividade, e
  desempenho de Euro Stoxx 50, DAX e FTSE 100.
- **china** (China, 2 a 4 parágrafos): PMI e atividade, política monetária do PBoC (LPR), estímulos,
  Xangai e Hang Seng China Enterprises (e por que podem divergir), e a leitura para o Brasil
  (commodities).
- **japao** (Japão, 2 a 4 parágrafos): Banco do Japão, iene e intervenções, inflação se relevante,
  e o Nikkei 225 (lembrando a relação com as exportadoras e o câmbio).
- **brasil** (Brasil, 6 a 9 parágrafos): Copom (decisão, placar, comunicado), IPCA do mês anterior
  e IPCA-15 do mês, com o que puxou, IGP-M, câmbio (fechamento do dólar e motivo), Ibovespa
  (fechamento, caminho no mês, fluxo estrangeiro, setores), fiscal (dívida bruta, resultado
  primário) e política se mexer com o mercado. O último parágrafo traz o Boletim Focus do fim do mês
  (Selic, IPCA, PIB e dólar para o fim do ano) e uma leitura dele.

## Indicadores e Focus

Preencha também a tabela de indicadores (mesmas linhas da carta anterior, na mesma ordem) e o
Focus, no formato das referências:

- `valor`, `mes`, `ano`, `m12` como texto já formatado: "14,00%", "− 0,25 p.p.", "0,07%",
  "4,44%", "5,18", "alta". Para número negativo use o sinal "− " (menos com espaço). Vazio ("") quando
  não se aplica.
- `sub` diz a referência: "Meta · Copom de 5 de agosto", "Referência julho", "Prévia de agosto",
  "Fechamento de agosto", "% do PIB · julho".
- Focus: o boletim publicado mais perto do último dia útil do mês de referência.

## Resposta

Quando terminar a pesquisa, responda **apenas** com um objeto JSON entre as tags `<carta_json>` e
`</carta_json>`, sem nada depois, neste formato:

<carta_json>
{
  "subtitulo": "frase curta para a capa, ou vazio",
  "textos": {
    "visao": "parágrafos separados por uma linha em branco (\n\n)",
    "eua": "…", "europa": "…", "china": "…", "japao": "…", "brasil": "…"
  },
  "indicadores": [
    {"nome": "Selic", "sub": "Meta · Copom de …", "valor": "…", "mes": "…", "ano": "…", "m12": "…"}
  ],
  "focus": [{"rotulo": "Selic", "valor": "…"}, {"rotulo": "IPCA", "valor": "…"},
            {"rotulo": "PIB", "valor": "…"}, {"rotulo": "Dólar", "valor": "R$ …"}],
  "fontes": [{"titulo": "…", "url": "https://…", "uso": "qual dado veio daqui"}],
  "pontos_a_conferir": ["dado ou afirmação que merece checagem humana, e por quê"]
}
</carta_json>
