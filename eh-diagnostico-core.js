// ─────────────────────────────────────────────────────────────
//  eh-diagnostico-core.js | EH Investimentos
//  Lógica de cálculo do Diagnóstico Financeiro (fonte da verdade
//  das regras de negócio), compartilhada entre o formulário
//  (eh-diagnostico.html) e o relatório (eh-diagnostico-relatorio.html).
//  Expõe tudo em window.EHDiag.
// ─────────────────────────────────────────────────────────────
(function () {
  "use strict";

  /* ===================== Premissas de projeção ===================== */
  // Retornos NOMINAIS anuais por classe e por perfil; a projeção converte
  // tudo para retorno REAL (descontada a inflação), de modo que curvas e
  // meta fiquem a preços de hoje. Ajuste os valores aqui se necessário.
  var PREMISSAS = {
    inflacaoAnual: 0.04,
    nominalPorAtivo: { investPoupanca: 0.065, investRendaFixaPublica: 0.105, investRendaFixaPrivada: 0.105, investRendaVariavel: 0.13, investCripto: 0.15, investOutros: 0.09 },
    nominalPorPerfil: { "Conservador": 0.105, "Moderado": 0.115, "Arrojado": 0.13 },
    // Taxa de retirada anual do cenário de renda perpétua (regra dos 4% → 25x).
    taxaRetiradaPerpetua: 0.04,
    // Até quando a renda precisa durar quando a pessoa opta por consumir o
    // patrimônio e não informa uma idade final.
    idadeFimRendaPadrao: 95,
    // Horizonte desenhado depois da aposentadoria no cenário perpétuo: o
    // patrimônio não acaba, mas o gráfico precisa de um fim. Vinte anos
    // mostram a sustentação da renda sem esticar a escala do eixo Y.
    anosRendaPerpetua: 20
  };
  function taxaReal(nominal) {
    return (1 + nominal) / (1 + PREMISSAS.inflacaoAnual) - 1;
  }

  /* ===================== Matemática financeira =====================
     Tudo roda em taxa REAL (acima da inflação), ou seja, em poder de
     compra de hoje. */
  var EPS = 1e-9;
  function paraMensal(anual) { return Math.pow(1 + anual, 1 / 12) - 1; }
  // Valor futuro de um saldo inicial somado a aportes no fim de cada mês.
  function valorFuturo(p0, aporte, i, n) {
    if (n <= 0) return p0;
    if (Math.abs(i) < EPS) return p0 + aporte * n;
    var g = Math.pow(1 + i, n);
    return p0 * g + aporte * (g - 1) / i;
  }
  // Aporte mensal necessário para sair de p0 e chegar a `alvo` em n meses.
  function aportePara(alvo, p0, i, n) {
    if (n <= 0) return Infinity;
    if (Math.abs(i) < EPS) return (alvo - p0) / n;
    var g = Math.pow(1 + i, n);
    return (alvo - p0 * g) * i / (g - 1);
  }
  // Valor presente de n saques mensais feitos no início de cada mês.
  function vpSaques(saque, i, n) {
    if (n <= 0) return 0;
    if (Math.abs(i) < EPS) return saque * n;
    return saque * (1 - Math.pow(1 + i, -n)) / i * (1 + i);
  }
  // Capital necessário para n saques mensais deixando `heranca` no final.
  function capitalNecessario(saque, i, n, heranca) {
    return vpSaques(saque, i, n) + (heranca > 0 ? heranca * Math.pow(1 + i, -n) : 0);
  }
  // Saque mensal que um capital sustenta por n meses deixando `heranca`.
  function saqueSustentavel(capital, i, n, heranca) {
    if (n <= 0) return 0;
    var liquido = capital - (heranca > 0 ? heranca * Math.pow(1 + i, -n) : 0);
    if (liquido <= 0) return 0;
    if (Math.abs(i) < EPS) return liquido / n;
    return liquido * i / ((1 - Math.pow(1 + i, -n)) * (1 + i));
  }
  // Simulação mês a mês: acumulação e, depois, a fase de saques. Devolve os
  // pontos anuais do gráfico e o mês em que o dinheiro acaba, se acabar.
  function simular(p0, aporte, i, mesesAcumulo, saque, mesesRenda) {
    var saldo = p0;
    var pontos = [{ mes: 0, saldo: saldo }];
    var total = mesesAcumulo + mesesRenda;
    var esgotouMes = null, patNoAlvo = p0;
    for (var m = 1; m <= total; m++) {
      if (m <= mesesAcumulo) {
        saldo += saldo * i + aporte;
        if (m === mesesAcumulo) patNoAlvo = saldo;
      } else {
        var s = Math.min(saque, Math.max(0, saldo)); // saque no início do mês
        saldo -= s;
        saldo += saldo * i;
        if (saldo <= 0.005 && esgotouMes === null) { saldo = 0; esgotouMes = m; }
      }
      if (m % 12 === 0 || m === total) pontos.push({ mes: m, saldo: saldo });
    }
    return { pontos: pontos, esgotouMes: esgotouMes, patNoAlvo: patNoAlvo, saldoFinal: saldo };
  }
  // Em quantos meses o aporte atual chega ao alvo (null se não chegar no limite).
  function mesesParaAlvo(p0, aporte, i, alvo, limiteMeses) {
    if (alvo <= 0) return 0;
    if (p0 >= alvo) return 0;
    var saldo = p0;
    for (var m = 1; m <= limiteMeses; m++) {
      saldo += saldo * i + aporte;
      if (saldo >= alvo) return m;
    }
    return null;
  }

  /* ===================== Textos fixos ===================== */
  var NIVEL_TEXTS = {
    1: { nome: "Ponto de Partida", contexto: "Você está no início da jornada de organização financeira. Os fundamentos ainda precisam ser construídos, um passo de cada vez." },
    2: { nome: "Em Construção", contexto: "Algumas bases já existem, mas ainda há lacunas importantes que pedem atenção antes de avançar para otimização." },
    3: { nome: "Fundação Formada", contexto: "Os fundamentos estão no lugar. Agora é hora de fechar as lacunas que restam e dar direção de longo prazo ao que já foi construído." },
    4: { nome: "Consolidado", contexto: "Sua vida financeira está bem estruturada na maior parte das dimensões. O foco agora é refinar pontos específicos e manter consistência." },
    5: { nome: "Otimizado", contexto: "Você construiu uma relação madura e estruturada com o dinheiro. A partir daqui, o jogo é sofisticação e eficiência, não mais construção de base." }
  };

  var ARCHETYPE_TEXTS = {
    negacao: { nome: "Negação Financeira", abertura: "Você não está sozinho nisso, e o primeiro passo pra sair daqui já foi dado: você chegou até aqui e olhou pros números de frente." },
    ilusao: { nome: "Ilusão de Controle", abertura: "As contas fecham no fim do mês, e isso já é melhor do que boa parte das pessoas. Mas \"fechar as contas\" e \"estar seguro\" são coisas diferentes, e é aí que vale a pena olhar com mais cuidado." },
    adiamento: { nome: "Adiamento do Futuro", abertura: "Você tem disciplina, guarda dinheiro, se vira bem no dia a dia. O que falta não é esforço, é direção." },
    otimismo: { nome: "Otimismo Desprotegido", abertura: "Ninguém gosta de pensar no que pode dar errado, e é exatamente por isso que essa é a área mais adiada por quase todo mundo." },
    paralisia: { nome: "Paralisia da Decisão", abertura: "Você guarda dinheiro, isso já é mais do que a maioria consegue fazer. O problema não é a disciplina, é o próximo passo depois de guardar." },
    vazamento: { nome: "Vazamento Silencioso", abertura: "Suas contas fecham, você não vive no vermelho, mas isso não significa que não haja dinheiro escorrendo pelo ralo todo mês. Só que esse vazamento é silencioso." },
    dominio: { nome: "Domínio Comportamental", abertura: "Você já construiu algo raro: uma relação madura com o dinheiro, não só uma planilha organizada." },
    // Quem já passou da idade-alvo não está adiando nada: a pergunta deixa de
    // ser quanto acumular e passa a ser quanto dá pra sacar sem comprometer o
    // futuro. Os outros sete arquétipos falam de construção; este, de colheita.
    colheita: { nome: "Fase de Colheita", abertura: "A fase de construir patrimônio ficou pra trás. O que está em jogo agora é outra coisa: transformar o que você juntou em renda que dure o quanto você precisar." }
  };

  // Ordem fixa de prioridade do plano de ação e nomes das dimensões.
  var PRIORITY_ORDER = ["fluxo", "liquidez", "endividamento", "risco", "patrimonio", "metas"];
  var DIM_NAMES = { fluxo: "Fluxo de Caixa e Orçamento", liquidez: "Liquidez e Reserva", endividamento: "Endividamento", risco: "Gestão de Risco (Seguros)", patrimonio: "Patrimônio e Investimentos", metas: "Metas e Planejamento" };
  // "a, b e c" — para listas em texto corrido.
  function listaPt(itens) {
    if (!itens.length) return "";
    if (itens.length === 1) return itens[0];
    return itens.slice(0, -1).join(", ") + " e " + itens[itens.length - 1];
  }

  var ACTION_LIBRARY = {
    fluxo: {
      critico: function (n) { return { texto: "Sua despesa mensal supera sua renda em " + n.deficit + ". Antes de qualquer outra ação, é essencial mapear os 3 maiores gastos variáveis e cortar ou renegociar o que for possível nos próximos 30 dias.", acao: "Listar os 3 maiores gastos variáveis do último mês e definir um corte ou renegociação para cada um." }; },
      insuficiente: function (n) { return { texto: "Sua taxa de poupança está em " + n.taxa + ", abaixo do recomendado (mínimo 10%). Recomendamos revisar a categoria de maior peso no seu orçamento, " + n.categoria + ", que representa " + n.categoriaPct + " da sua renda.", acao: "Revisar os gastos em " + n.categoria + " e buscar reduzir em pelo menos 10% no próximo mês." }; },
      otimizacao: function (n) { return { texto: "Sua taxa de poupança de " + n.taxa + " está saudável. O foco agora é otimizar o destino desse valor guardado, não aumentar o quanto é guardado.", acao: "Revisar se o valor poupado está indo para as aplicações mais adequadas ao seu perfil e objetivos." }; }
    },
    liquidez: {
      critico: function (n) { return { texto: "Sua reserva cobre menos de 1 mês de despesas. Definir um valor mensal fixo, mesmo pequeno, pra construir esse colchão é a prioridade imediata.", acao: "Definir um valor fixo mensal (mesmo que pequeno) e automatizar a transferência para a reserva de emergência." }; },
      insuficiente: function (n) { return { texto: "Você tem " + n.meses + " meses de cobertura, mas o ideal é 6. Mantendo o ritmo atual de poupança, você atinge isso em aproximadamente " + n.mesesParaMeta + " meses.", acao: "Direcionar parte do valor poupado mensalmente para a reserva até atingir 6 meses de cobertura." }; },
      otimizacao: function (n) { return { texto: "Sua reserva está bem dimensionada" + n.aplicacaoNota, acao: n.aplicacaoAcao }; }
    },
    endividamento: {
      // Dívida sem parcela fixa (rotativo, cheque especial) é o caso em que o
      // comprometimento de renda é 0% e o problema é justamente esse: o saldo
      // cresce sozinho. O texto precisa falar do estoque, não da parcela.
      critico: function (n) {
        var peso = n.temParcelas
          ? "com parcelas comprometendo " + n.comprometimento + " da renda mensal, nível crítico"
          : "sem nenhuma parcela fixa, ou seja, o saldo segue rodando no rotativo e crescendo por conta própria";
        return { texto: "Suas dívidas somam " + n.totalDividas + " (cerca de " + n.mesesDivida + " meses da sua renda), " + peso + ". Priorizar a quitação da dívida de maior taxa de juros antes de qualquer investimento é essencial.", acao: "Listar todas as dívidas por taxa de juros e priorizar a quitação da mais cara primeiro." };
      },
      insuficiente: function (n) {
        var peso = n.temParcelas
          ? "e as parcelas comprometem " + n.comprometimento + " da renda mensal, o que pede atenção"
          : "sem parcela fixa definida, o que costuma significar rotativo rodando e saldo crescendo";
        return { texto: "Suas dívidas somam " + n.totalDividas + " " + peso + ". Recomendamos consolidar ou renegociar as dívidas de maior taxa.", acao: "Buscar consolidação ou renegociação das dívidas de maior taxa de juros." };
      },
      otimizacao: function (n) {
        if (n.temDividas) return { texto: "Suas dívidas somam " + n.totalDividas + ", com parcelas em " + n.comprometimento + " da renda mensal, dentro de uma faixa saudável para o tamanho da sua renda." + (n.deficitAtivo ? " Ainda assim, com o orçamento no vermelho, essas parcelas fazem parte do rombo: enquanto ele não fechar, elas competem com o essencial." : " Não são elas que travam seu plano hoje, mas vale manter o ritmo de quitação e evitar contratar dívida nova mais cara."), acao: "Manter o plano de quitação atual e evitar crédito rotativo e cheque especial." };
        return { texto: "Sem dívidas em aberto no momento. Sua saúde de endividamento está excelente.", acao: "Manter o hábito de evitar crédito rotativo e cheque especial." };
      }
    },
    risco: {
      critico: function (n) { return { texto: "Sua proteção contra imprevistos tem lacunas sérias: " + n.protecaoLista + ". Isso expõe " + (n.dependentes > 0 ? "sua família" : "você") + " a risco financeiro significativo em caso de imprevisto.", acao: n.protecaoAcao }; },
      insuficiente: function (n) { return { texto: "Sua proteção cobre parte dos cenários, mas ainda há lacunas: " + n.protecaoLista + ".", acao: n.protecaoAcao }; },
      otimizacao: function (n) {
        if (n.semCoberturaInvalidez) return {
          texto: "O que você tem hoje cobre bem os imprevistos do dia a dia. O que fica em aberto é o cenário mais caro e menos lembrado por quem não tem dependentes: a invalidez, continuar vivo e sem conseguir trabalhar. Quem banca isso hoje é a sua reserva, que tem prazo pra acabar. Um seguro com cobertura de invalidez cobre justamente a parte que ela não alcança, e costuma custar pouco em idade de trabalho.",
          acao: "Cotar um seguro com cobertura de invalidez e comparar o custo mensal com o tempo que a reserva sustentaria sozinha."
        };
        return { texto: "Sua proteção está bem estruturada. Recomendamos revisão periódica a cada 2 anos para manter a adequação.", acao: "Revisar " + n.coberturas + " em até 2 anos." };
      }
    },
    patrimonio: {
      // O alerta de carteira (concentração ou descasamento com o perfil) precisa
      // aparecer nas duas faixas: quem está pior é justamente quem mais precisa.
      critico: function (n) { return { texto: "Seu patrimônio atual representa " + n.indice + " " + n.baseIndice + ". Isso não reflete falta de capacidade, reflete falta de estrutura de investimento, o que é resolvível." + (n.planoCoberto ? " Vale o contexto: esse índice compara seu patrimônio com o esperado para a sua faixa de renda e idade, não com a sua meta — e o ritmo atual de aportes já cobre a renda que você quer na aposentadoria. O ponto aqui é folga, não risco de não chegar lá." : "") + n.alertaCarteira, acao: n.alertaCarteira ? "Estruturar aportes mensais recorrentes e corrigir a alocação apontada acima." : "Estruturar um plano de aportes mensais recorrentes em investimentos alinhados ao seu perfil de risco." }; },
      insuficiente: function (n) { return { texto: "Você está próximo do patrimônio esperado, mas " + n.gapDesc + ".", acao: "Revisar a composição da carteira para reduzir a concentração ou realinhar ao perfil de risco declarado." }; },
      otimizacao: function (n) { return { texto: "Seu patrimônio está bem posicionado frente ao esperado. O foco agora é eficiência: custos, diversificação e adequação fina ao perfil." + n.alertaCarteira, acao: n.alertaCarteira ? "Corrigir a alocação apontada acima e revisar custos da carteira anualmente." : "Revisar custos e diversificação da carteira atual anualmente." }; }
    },
    // A régua desta dimensão é a cobertura projetada: quanto da renda desejada
    // o ritmo atual de aportes sustenta na idade-alvo, e não só o que já existe.
    metas: {
      critico: function (n) {
        if (n.aposentado) return { texto: "Pela idade-alvo informada, você já está no período de aposentadoria, e o patrimônio investido sustenta cerca de " + n.rendaSustentavel + " por mês, " + n.cobertura + " da renda de " + n.rendaDesejada + " que você deseja (" + n.regraTexto + ").", acao: "Revisar o gasto mensal sustentável com base no patrimônio atual, junto com a estratégia de renda." };
        if (n.metasVagas) return { texto: "No ritmo atual de aportes, você chegaria aos " + n.idadeAposentadoria + " anos com uma renda de " + n.rendaSustentavel + " por mês, " + n.cobertura + " do que você quer receber. E, sem metas com prazo e valor definidos, " + (n.deficitAtivo ? "qualquer sobra que apareça depois de reequilibrar o orçamento vai continuar sem destino." : "não há como priorizar o que fazer com o dinheiro que sobra."), acao: "Definir 2-3 metas prioritárias com prazo e valor específicos nos próximos 30 dias." };
        return { texto: "No ritmo atual de aportes, você chegaria aos " + n.idadeAposentadoria + " anos com uma renda de " + n.rendaSustentavel + " por mês, " + n.cobertura + " dos " + n.rendaDesejada + " que você deseja. O plano ainda não se paga.", acao: n.aporteViavel ? "Estruturar um aporte mensal de " + n.aporte + " direcionado à meta de aposentadoria." : "Revisar valor e prazo da meta de aposentadoria pra chegar num plano de aportes realista." };
      },
      insuficiente: function (n) {
        if (n.aposentado) return { texto: "Pela idade-alvo informada, você já está no período de aposentadoria, e o patrimônio investido sustenta cerca de " + n.rendaSustentavel + " por mês, " + n.cobertura + " da renda de " + n.rendaDesejada + " que você deseja (" + n.regraTexto + ").", acao: "Revisar o gasto mensal sustentável com base no patrimônio atual, junto com a estratégia de renda." };
        if (n.carteiraArrasta) return { texto: "O ritmo atual de aportes cobre " + n.cobertura + " da renda que você quer ter aos " + n.idadeAposentadoria + " anos — e o que falta não é volume guardado. Seu aporte de " + n.aporteAtual + " já bastaria numa carteira de perfil " + n.perfilRisco + " (" + n.retornoPlano + " ao ano acima da inflação); a composição atual rende " + n.retornoAtual + ", e é essa diferença que abre o gap.", acao: "Realinhar a carteira ao perfil declarado antes de aumentar o valor aportado." };
        if (!n.aporteViavel) return { texto: "O ritmo atual de aportes cobre " + n.cobertura + " da renda que você quer ter aos " + n.idadeAposentadoria + " anos. O aporte necessário pra fechar o gap no prazo atual (" + n.aporte + ") está acima do que a renda comporta, sinal de que o valor ou o prazo da meta precisam ser recalibrados.", acao: "Revisar valor e prazo da meta de aposentadoria pra chegar num plano de aportes realista." };
        return { texto: "O ritmo atual de aportes cobre " + n.cobertura + " da renda que você quer ter aos " + n.idadeAposentadoria + " anos. Subir o aporte de " + n.aporteAtual + " para " + n.aporte + " por mês fecha essa diferença dentro do prazo desejado.", acao: "Estruturar um aporte mensal de " + n.aporte + " direcionado à meta de aposentadoria." };
      },
      otimizacao: function (n) {
        if (n.aposentado) return { texto: "Seu patrimônio sustenta " + n.rendaSustentavel + " por mês, cobrindo " + n.cobertura + " da renda que você deseja. O plano de renda está de pé; o foco passa a ser preservar o poder de compra e revisar a estratégia de saque periodicamente.", acao: "Revisar anualmente o valor de saque e a alocação da carteira de renda." };
        return { texto: "No ritmo atual de aportes, você chega aos " + n.idadeAposentadoria + " anos com uma renda de " + n.rendaSustentavel + " por mês, " + n.cobertura + " do que você quer receber. O plano se paga: daqui pra frente o jogo é consistência, não volume.", acao: "Manter o aporte atual e revisar metas e prazos uma vez por ano." };
      }
    }
  };

  var GLOSSARIO = [
    { termo: "Taxa de poupança", definicao: "Percentual da sua renda que sobra depois de pagar todas as despesas do mês. Quanto maior, mais rápido você constrói patrimônio." },
    { termo: "Meses de cobertura", definicao: "Por quantos meses sua reserva de emergência sustentaria seu padrão de vida, caso você perdesse sua renda hoje." },
    { termo: "Comprometimento de renda", definicao: "Percentual da sua renda mensal usado para pagar parcelas de dívidas. Acima de 36% é considerado um sinal de alerta." },
    { termo: "Índice de solvência", definicao: "Proporção do seu patrimônio que é realmente sua (patrimônio líquido) em relação ao patrimônio total, descontando dívidas e financiamentos." },
    { termo: "Cobertura de seguro (múltiplo da renda)", definicao: "Quantas vezes sua renda anual o capital do seu seguro de vida cobriria, caso algo acontecesse com você." },
    { termo: "Patrimônio esperado x real", definicao: "Comparação entre o patrimônio que seria esperado pra sua idade e renda, e o patrimônio que você realmente tem hoje." },
    { termo: "Regra dos 25x (renda perpétua)", definicao: "Estimativa de quanto patrimônio é necessário pra viver só do rendimento: 25 vezes o gasto anual desejado, o equivalente a sacar 4% ao ano. O principal fica intacto e vira herança." },
    { termo: "Consumir o patrimônio", definicao: "Estratégia alternativa em que o patrimônio é gasto ao longo da aposentadoria, terminando em zero (ou no valor de herança desejado) numa idade definida. Exige menos capital que a renda perpétua, mas o prazo precisa ser generoso." },
    { termo: "Aporte mensal necessário", definicao: "Quanto você precisaria guardar todo mês, a partir de hoje e até a idade-alvo, pra chegar ao patrimônio necessário. É calculado em reais de hoje: na prática, o valor precisa ser reajustado pela inflação todo ano." },
    { termo: "Retorno real", definicao: "Rentabilidade que sobra depois de descontar a inflação. É o que mede o ganho de poder de compra e a base de todas as projeções deste relatório." }
  ];

  /* ===================== Helpers ===================== */
  function fmt(value) {
    var n = Number(value) || 0;
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
  }
  function pct(value, digits) {
    var d = digits === undefined ? 0 : digits;
    return (Number(value) || 0).toFixed(d).replace(".", ",") + "%";
  }
  function num1(value) {
    return (Number(value) || 0).toFixed(1).replace(".", ",");
  }
  // Versão curta para eixos de gráfico: "R$ 1,2 mi", "R$ 850 mil".
  function fmtCurto(value) {
    var n = Number(value) || 0;
    var abs = Math.abs(n);
    if (abs >= 1e6) return "R$ " + (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(".", ",") + " mi";
    if (abs >= 1e3) return "R$ " + Math.round(n / 1e3) + " mil";
    return "R$ " + Math.round(n);
  }
  function plural(n, singular, pluralForma) {
    return n + " " + (Math.abs(n) === 1 ? singular : pluralForma);
  }
  // Idade a partir da data de nascimento (AAAA-MM-DD), na data de referência.
  // Retorna null se a data for inválida ou implausível.
  function idadeEm(dataNascimento, referencia) {
    if (!dataNascimento) return null;
    var n = new Date(dataNascimento);
    if (isNaN(n.getTime())) return null;
    var hoje = referencia ? new Date(referencia) : new Date();
    if (isNaN(hoje.getTime())) hoje = new Date();
    var anos = hoje.getFullYear() - n.getFullYear();
    var m = hoje.getMonth() - n.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < n.getDate())) anos--;
    return (anos >= 0 && anos <= 120) ? anos : null;
  }
  // Idade efetiva: calcula pela data de nascimento quando existir e,
  // para os diagnósticos antigos, cai de volta no campo `idade`.
  function idadeDe(D, referencia) {
    var calc = idadeEm(D.dataNascimento, referencia);
    return calc !== null ? calc : (Number(D.idade) || null);
  }
  function formatarData(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  }
  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function bandInterp(value, edges) {
    var t1 = edges[0], t2 = edges[1], t3 = edges[2];
    if (value < t1) return 0 + Math.max(0, value / t1) * 30;
    if (value < t2) return 30 + ((value - t1) / (t2 - t1)) * 30;
    if (value < t3) return 60 + ((value - t2) / (t3 - t2)) * 25;
    return Math.min(100, 85 + Math.min(1, (value - t3) / (t3 * 0.5 || 1)) * 15);
  }
  function bandLabel(score) {
    if (score < 30) return "critico";
    if (score < 60) return "insuficiente";
    if (score < 85) return "adequado";
    return "excelente";
  }

  /* ===================== Cálculo do relatório (regras de negócio) ===================== */
  // geradoEm (opcional): data ISO em que o diagnóstico foi finalizado. O
  // relatório fica datado do momento da finalização, não da visita à página.
  function computeReport(data, geradoEm) {
    var D = data;
    var primeiroNome = (D.nome || "").split(" ")[0] || D.nome;
    var dataRef = geradoEm ? new Date(geradoEm) : new Date();
    if (isNaN(dataRef.getTime())) dataRef = new Date();

    // ---- Dim 1: Fluxo de Caixa ----
    // Ter cônjuge com renda e querer que ela entre na análise são coisas
    // diferentes: casal com orçamento separado declara a renda do outro como
    // contexto, mas o diagnóstico é sobre as contas de quem respondeu. Sem o
    // campo (diagnósticos gerados antes da escolha existir), soma — que era o
    // comportamento quando eles foram feitos.
    var somaRendaConjuge = !!D.temConjuge && D.considerarRendaConjuge !== false;
    var rendaTotal = (D.rendaPropria || 0) + (somaRendaConjuge ? (D.rendaConjuge || 0) : 0) + (D.outrasRendas || []).reduce(function (a, r) { return a + (r.valor || 0); }, 0);
    var despesasCats = D.despesas || {};
    // "impostos" saiu do formulário, mas continua aqui: diagnósticos gerados
    // antes dessa mudança ainda trazem a categoria, e o relatório deles precisa
    // seguir nomeando o valor que soma no total.
    var CAT_LABELS = { alimentacao: "Alimentação", educacao: "Educação", filhos: "Filhos/Dependentes", impostos: "Impostos", investimentos: "Investimentos/Poupança", lazer: "Lazer", moradia: "Moradia", presentes: "Presentes/Doações", saude: "Saúde", seguros: "Seguros", servicos: "Serviços", transporte: "Transporte", vestuario: "Vestuário" };
    // Despesas que a pessoa acrescentou à mão, já classificadas por ela como
    // essenciais ou flexíveis.
    var despesasExtras = (D.despesasExtras || []).filter(function (d) { return (d.valor || 0) > 0; });
    var extraEssencial = despesasExtras.reduce(function (a, d) { return a + (d.tipo === "flexivel" ? 0 : (d.valor || 0)); }, 0);
    var extraFlexivel = despesasExtras.reduce(function (a, d) { return a + (d.tipo === "flexivel" ? (d.valor || 0) : 0); }, 0);
    // O valor aportado em "Investimentos/Poupança" é poupança, não gasto de vida:
    // fica fora da despesa total e, portanto, soma a favor da taxa de poupança.
    var aporteMensal = despesasCats.investimentos || 0;
    var despesaTotal = Object.keys(despesasCats).reduce(function (a, k) { return a + (despesasCats[k] || 0); }, 0) - aporteMensal +
      extraEssencial + extraFlexivel;
    var taxaPoupanca = rendaTotal > 0 ? ((rendaTotal - despesaTotal) / rendaTotal) * 100 : 0;
    var deficit = despesaTotal > rendaTotal;

    // ---- Distribuição das despesas (seção 6 do relatório) ----
    // Duas leituras diferentes na mesma página, e por isso duas bases:
    //   · a rosca reparte a DESPESA em categorias, então fecha em 100%;
    //   · a régua 50/30/20 é sobre a RENDA, que é como a referência é definida.
    // "Investimentos/Poupança" não entra na rosca: o que é aportado não é gasto
    // de vida, e já aparece como a terceira faixa da régua.
    var ESSENCIAIS = ["moradia", "alimentacao", "transporte", "saude", "educacao", "filhos", "seguros", "impostos"];
    var FLEXIVEIS = ["lazer", "vestuario", "presentes", "servicos"];
    var somaDe = function (chaves) {
      return chaves.reduce(function (a, k) { return a + (despesasCats[k] || 0); }, 0);
    };
    var gastoEssencial = somaDe(ESSENCIAIS) + extraEssencial;
    var gastoFlexivel = somaDe(FLEXIVEIS) + extraFlexivel;
    var pctDaRenda = function (v) { return rendaTotal > 0 ? (v / rendaTotal) * 100 : 0; };

    var catsDistribuicao = Object.keys(CAT_LABELS)
      .filter(function (k) { return k !== "investimentos" && (despesasCats[k] || 0) > 0; })
      .map(function (k) {
        return {
          key: k,
          label: CAT_LABELS[k],
          valor: despesasCats[k],
          pct: despesaTotal > 0 ? (despesasCats[k] / despesaTotal) * 100 : 0,
          grupo: ESSENCIAIS.indexOf(k) !== -1 ? "essenciais" : "flexiveis"
        };
      })
      .concat(despesasExtras.map(function (d, i) {
        return {
          key: "extra-" + i,
          label: (d.descricao || "").trim() || "Outra despesa",
          valor: d.valor || 0,
          pct: despesaTotal > 0 ? ((d.valor || 0) / despesaTotal) * 100 : 0,
          grupo: d.tipo === "flexivel" ? "flexiveis" : "essenciais"
        };
      }))
      .sort(function (a, b) { return b.valor - a.valor; });

    var distribuicao = {
      total: despesaTotal,
      renda: rendaTotal,
      categorias: catsDistribuicao,
      faixas: [
        { key: "essenciais", nome: "Despesas essenciais", pct: pctDaRenda(gastoEssencial), valor: gastoEssencial,
          ideal: 50, limite: "ate", itens: "Moradia, alimentação, transporte, saúde, educação, filhos, seguros e o que você marcou como essencial." },
        { key: "flexiveis", nome: "Despesas flexíveis", pct: pctDaRenda(gastoFlexivel), valor: gastoFlexivel,
          ideal: 30, limite: "ate", itens: "Lazer, vestuário, presentes, serviços e o que você marcou como flexível." },
        { key: "investimentos", nome: "Investimentos e reserva", pct: taxaPoupanca, valor: rendaTotal - despesaTotal,
          ideal: 20, limite: "minimo", itens: "O que sobra da renda no mês, somado ao aporte que você declarou." }
      ]
    };
    distribuicao.faixas.forEach(function (f) {
      f.dentro = f.limite === "ate" ? f.pct <= f.ideal : f.pct >= f.ideal;
    });

    // A lista de distribuição já vem ordenada por valor e sem o aporte, então a
    // maior categoria é o primeiro item — e as despesas extras disputam junto.
    var maiorCat = catsDistribuicao[0] || null;
    var maiorCatLabel = maiorCat ? maiorCat.label : null;
    var maiorCatVal = maiorCat ? maiorCat.valor : 0;
    var scoreFluxo = deficit ? 0 : (taxaPoupanca < 0 ? 0 : taxaPoupanca < 10 ? 30 + (taxaPoupanca / 10) * 30 : taxaPoupanca < 20 ? 60 + ((taxaPoupanca - 10) / 10) * 25 : Math.min(100, 85 + Math.min(1, (taxaPoupanca - 20) / 20) * 15));

    // ---- Dim 2: Liquidez ----
    var mesesCobertura = despesaTotal > 0 ? (D.reservaEmergencia || 0) / despesaTotal : 0;
    var scoreLiquidez = bandInterp(mesesCobertura, [1, 3, 6]);
    var aplicacaoAdequada = ["CDB liquidez diária", "Tesouro Selic"].indexOf(D.ondeAplicada) !== -1;

    // ---- Dim 3: Endividamento ----
    var totalDividas = D.temDividas ? (D.cartaoCredito || 0) + (D.chequeEspecial || 0) + (D.emprestimoPessoal || 0) + (D.outrasDividas || []).reduce(function (a, x) { return a + (x.valor || 0); }, 0) : 0;
    var comprometimento = rendaTotal > 0 ? ((D.parcelasMensais || 0) / rendaTotal) * 100 : 0;
    var scoreEndiv;
    if (!D.temDividas) scoreEndiv = 100;
    else if (comprometimento <= 10) scoreEndiv = 100 - (comprometimento / 10) * 15;
    else if (comprometimento <= 20) scoreEndiv = 85 - ((comprometimento - 10) / 10) * 25;
    else if (comprometimento <= 36) scoreEndiv = 60 - ((comprometimento - 20) / 16) * 30;
    else scoreEndiv = Math.max(0, 30 - ((comprometimento - 36) / 20) * 30);
    // O estoque de dívida também pesa: dívida grande não pode se esconder atrás
    // de parcelas baixas (ex.: rotativo do cartão sem parcela fixa).
    var mesesDivida = rendaTotal > 0 ? totalDividas / rendaTotal : (totalDividas > 0 ? 12 : 0);
    if (D.temDividas && totalDividas > 0) {
      var scoreEstoque;
      if (mesesDivida <= 0.5) scoreEstoque = 100 - (mesesDivida / 0.5) * 15;
      else if (mesesDivida <= 1.5) scoreEstoque = 85 - ((mesesDivida - 0.5) / 1) * 25;
      else if (mesesDivida <= 4) scoreEstoque = 60 - ((mesesDivida - 1.5) / 2.5) * 30;
      else scoreEstoque = Math.max(0, 30 - ((mesesDivida - 4) / 8) * 30);
      scoreEndiv = Math.min(scoreEndiv, scoreEstoque);
    }

    // ---- Patrimônio (precisa vir antes p/ solvência) ----
    var patrimonioImoveis = (D.imoveis || []).reduce(function (a, i) { return a + (i.valorMercado || 0); }, 0);
    var patrimonioVeiculos = (D.veiculos || []).reduce(function (a, i) { return a + (i.valor || 0); }, 0);
    var INVEST_KEYS = ["investPoupanca", "investRendaFixaPublica", "investRendaFixaPrivada", "investRendaVariavel", "investCripto", "investOutros"];
    var patrimonioInvest = INVEST_KEYS.reduce(function (a, k) { return a + (D[k] || 0); }, 0);
    var patrimonioTotal = patrimonioImoveis + patrimonioVeiculos + patrimonioInvest;
    var saldosFinanciamento = (D.imoveis || []).concat(D.veiculos || []).reduce(function (a, i) { return a + (i.status === "financiado" ? (i.saldoDevedor || 0) : 0); }, 0);
    var patrimonioLiquido = patrimonioTotal - saldosFinanciamento - totalDividas;
    // Sem bens e com dívidas em aberto, a solvência é zero — não 100%, como
    // saía antes por falta de denominador.
    // Proporção do patrimônio que é de fato sua. Com dívida maior que os bens a
    // razão fica negativa e não comunica nada ("-100%"): o piso é zero, e o
    // recado de que o líquido é negativo vai no texto do indicador.
    var indiceSolvencia = patrimonioTotal > 0
      ? Math.max(0, (patrimonioLiquido / patrimonioTotal) * 100)
      : (patrimonioLiquido < 0 ? 0 : 100);

    // ---- Dim 4: Gestão de Risco ----
    var rendaAnual = rendaTotal * 12;
    // O seguro de vida cobre a perda da renda do titular, então o benchmark
    // usa a renda própria (não a do casal); household só como fallback.
    var rendaSeguroAnual = (D.rendaPropria || 0) > 0 ? (D.rendaPropria || 0) * 12 : rendaAnual;
    var multiploCobertura = rendaSeguroAnual > 0 ? (D.capitalSegurado || 0) / rendaSeguroAnual : 0;
    var dependentes = Number(D.filhos) || 0;
    var benchmarkMultiplo = dependentes <= 2 ? 6.5 : 9;
    var DURACAO_SCORE = { "Nenhum tempo": 5, "Menos de 3 meses": 30, "3-6 meses": 68, "6+ meses ou tenho seguro invalidez": 92 };
    // Proteção de renda se a pessoa não puder trabalhar. A resposta declarada é
    // o ponto de partida, mas a reserva de emergência é proteção concreta contra
    // esse mesmo cenário: parada a renda, é ela que paga as contas enquanto
    // durar. Por isso a reserva entra como piso — nunca derruba o que foi
    // declarado, só impede que uma reserva robusta seja ignorada aqui.
    var duracaoDeclarada = DURACAO_SCORE[D.tempoRendaGarantida] !== undefined ? DURACAO_SCORE[D.tempoRendaGarantida] : 40;
    var pisoReserva = mesesCobertura >= 6 ? 70 : mesesCobertura >= 3 ? 50 : mesesCobertura >= 1 ? 28 : 0;
    var scoreRisco2 = Math.max(duracaoDeclarada, pisoReserva);
    var rendaProtegidaPelaReserva = pisoReserva > duracaoDeclarada;
    // Proteção de saúde: plano de saúde e/ou reserva médica dedicada
    var scoreRisco3 = D.temPlanoSaude ? (D.reservaMedica ? 100 : 80) : (D.reservaMedica ? 45 : 10);
    var scoreRisco1 = null, scoreRisco;
    if (dependentes === 0) {
      // Sem dependentes, o seguro de vida deixa de ser sobre sustentar alguém
      // depois da sua morte, e passa a valer pela cobertura de invalidez que
      // quase toda apólice traz junto. Então ele continua na conta, mas com
      // peso pequeno e sem punição pesada: ter o seguro soma, não ter custa
      // alguns pontos, e ninguém cai na faixa crítica só por estar solteiro e
      // sem filhos. O que decide a nota é o que sustenta a renda se a pessoa
      // não puder trabalhar, e a cobertura de saúde.
      scoreRisco1 = D.temSeguroVida ? 90 : 45;
      scoreRisco = scoreRisco1 * 0.2 + scoreRisco2 * 0.5 + scoreRisco3 * 0.3;
    } else {
      scoreRisco1 = D.temSeguroVida
        ? bandInterp(multiploCobertura, [benchmarkMultiplo * 0.5, benchmarkMultiplo * 0.85, benchmarkMultiplo * 1.15])
        : 5;
      scoreRisco = scoreRisco1 * 0.4 + scoreRisco2 * 0.35 + scoreRisco3 * 0.25;
    }

    // ---- Dim 5: Patrimônio ----
    var idadeCalculada = idadeDe(D, geradoEm);
    var idade = idadeCalculada || 30;
    var patrimonioEsperado = (idade * rendaAnual) / 10;
    var indicePatrimonio = patrimonioEsperado > 0 ? (patrimonioTotal / patrimonioEsperado) * 100 : 100;
    var scorePatrimonio = bandInterp(indicePatrimonio, [50, 100, 150]);
    // Ajuste fino comportamental: conhecer a rentabilidade da própria carteira
    // e investir de forma automática são preditores de acúmulo consistente.
    var AJUSTE_CONHECIMENTO = { "Não sei": -4, "Ideia vaga": -2, "Sei aproximado": 1, "Sei exato": 3 };
    var AJUSTE_AUTOMATICO = { "Só o que sobra": -4, "Às vezes automático": -1, "Quase sempre": 2, "Sempre automático": 4 };
    scorePatrimonio = Math.max(0, Math.min(100, scorePatrimonio + (AJUSTE_CONHECIMENTO[D.sabeRentabilidade] || 0) + (AJUSTE_AUTOMATICO[D.investeAutomatico] || 0)));
    // Concentração só é alerta quando há patrimônio suficiente para o risco
    // importar: apontar "100% numa classe" sobre R$ 1.200 é ruído.
    // Mede o que sobra além da reserva: se toda a carteira é reserva de
    // emergência, estar concentrado numa classe segura é o comportamento certo.
    var carteiraRelevante = Math.max(0, patrimonioInvest - (D.reservaEmergencia || 0)) >= rendaTotal * 3;
    var concentracaoMax = (patrimonioInvest > 0 && carteiraRelevante) ? Math.max.apply(null, INVEST_KEYS.map(function (k) { return D[k] || 0; })) / patrimonioInvest * 100 : 0;
    var rvPct = patrimonioInvest > 0 ? (((D.investRendaVariavel || 0) + (D.investCripto || 0)) / patrimonioInvest) * 100 : 0;
    var perfilAlertText = null;
    if (patrimonioInvest > 0 && carteiraRelevante) {
      if (D.perfilRisco === "Conservador" && rvPct > 30) perfilAlertText = "alocação em renda variável (" + pct(rvPct) + ") acima do que seu perfil conservador costuma sugerir";
      else if (D.perfilRisco === "Moderado" && rvPct > 65) perfilAlertText = "alocação em renda variável (" + pct(rvPct) + ") bem acima do que um perfil moderado costuma sugerir";
      else if (D.perfilRisco === "Arrojado" && rvPct < 15) perfilAlertText = "apenas " + pct(rvPct) + " em renda variável para um perfil arrojado, possível ineficiência de alocação";
    }

    // ---- Plano de aposentadoria ----
    // Base tanto da dimensão de Metas quanto da projeção patrimonial: a partir
    // da idade-alvo, da renda mensal desejada e da estratégia escolhida
    // (viver do rendimento x consumir o patrimônio), calcula o patrimônio
    // necessário, o aporte que o plano exige e o que o ritmo atual entrega.
    var gastoMensalAposentadoria = D.gastoNaoSei ? rendaTotal * ((D.gastoPercent || 70) / 100) : (D.gastoMensalAposentadoria || 0);
    // A reserva de emergência tem função própria (imprevistos) e fica fora
    // dos ativos destinados à aposentadoria, evitando contar duas vezes.
    var ativosLiquidos = Math.max(0, patrimonioInvest - (D.reservaEmergencia || 0));
    var idadeAposentadoria = Number(D.idadeAposentadoria) || idade + 20;
    // Quem já atingiu (ou passou) a idade-alvo é avaliado pelo progresso absoluto
    // frente ao patrimônio necessário, não pela curva de acúmulo esperada por idade.
    var aposentadoriaAtingida = idadeAposentadoria <= idade;
    var anosAcumulo = Math.max(0, idadeAposentadoria - idade);
    var mesesAcumulo = anosAcumulo * 12;

    // Estratégia: "renda" preserva o patrimônio (regra dos 4% / 25x, padrão dos
    // diagnósticos antigos), "consumo" gasta o principal até a idade final.
    var estrategia = D.estrategiaAposentadoria === "consumo" ? "consumo" : "renda";
    var idadeFimRenda = Math.max(idadeAposentadoria + 1, Number(D.idadeFimRenda) || PREMISSAS.idadeFimRendaPadrao);
    var anosRenda = estrategia === "consumo" ? (idadeFimRenda - idadeAposentadoria) : PREMISSAS.anosRendaPerpetua;
    var mesesRenda = anosRenda * 12;
    var herancaDesejada = estrategia === "consumo" ? Math.max(0, Number(D.herancaDesejada) || 0) : 0;

    // Taxas reais: o plano recomendado assume a carteira do perfil declarado;
    // o ritmo atual usa a composição real da carteira (limitada ao perfil).
    var rPlanoAnual = taxaReal(PREMISSAS.nominalPorPerfil[D.perfilRisco] || PREMISSAS.nominalPorPerfil["Moderado"]);
    var rComposicaoAnual = patrimonioInvest > 0
      ? taxaReal(INVEST_KEYS.reduce(function (a, k) { return a + (D[k] || 0) * (PREMISSAS.nominalPorAtivo[k] || 0.09); }, 0) / patrimonioInvest)
      : rPlanoAnual;
    var rAtualAnual = Math.min(rPlanoAnual, rComposicaoAnual);
    var iPlano = paraMensal(rPlanoAnual);
    var iAtual = paraMensal(rAtualAnual);

    var multiploAlvo = Math.round(1 / PREMISSAS.taxaRetiradaPerpetua);
    var patrimonioNecessario = estrategia === "consumo"
      ? capitalNecessario(gastoMensalAposentadoria, iPlano, mesesRenda, herancaDesejada)
      : gastoMensalAposentadoria * 12 / PREMISSAS.taxaRetiradaPerpetua;
    var progressoAtual = patrimonioNecessario > 0 ? (ativosLiquidos / patrimonioNecessario) * 100 : 0;

    // Para quem já se aposentou, comparar o patrimônio com "idade × renda ÷ 10"
    // não diz nada: a renda caiu justamente por causa da aposentadoria, e o
    // índice infla — dava 172% para quem sustenta 10% do que quer receber. A
    // régua passa a ser o patrimônio que o próprio plano de renda exige.
    if (aposentadoriaAtingida && patrimonioNecessario > 0) {
      indicePatrimonio = progressoAtual;
      scorePatrimonio = Math.max(0, Math.min(100, bandInterp(progressoAtual, [50, 100, 150]) +
        (AJUSTE_CONHECIMENTO[D.sabeRentabilidade] || 0) + (AJUSTE_AUTOMATICO[D.investeAutomatico] || 0)));
    }

    // Aporte do ritmo atual (o que a taxa de poupança representa em reais) x
    // aporte que o plano exige para chegar ao patrimônio necessário na idade-alvo.
    var aporteAtual = Math.max(0, (taxaPoupanca / 100) * rendaTotal);
    var aporteBruto = mesesAcumulo > 0 ? aportePara(patrimonioNecessario, ativosLiquidos, iPlano, mesesAcumulo) : 0;
    var aporteNecessario = isFinite(aporteBruto) ? Math.max(0, aporteBruto) : 0;
    var gapAporte = Math.max(0, aporteNecessario - aporteAtual);
    // Aporte já suficiente para a carteira do perfil, mas cobertura abaixo de
    // 100%: o que separa os dois cenários é o rendimento da carteira atual,
    // não o valor guardado.
    var carteiraArrasta = mesesAcumulo > 0 && aporteNecessario < aporteAtual && rAtualAnual < rPlanoAnual;

    // Simulações mês a mês: acumulação até a idade-alvo e, depois, a fase de
    // renda sacando o valor desejado. A curva do ritmo atual pode acabar antes
    // do fim — é justamente esse o alerta que o gráfico precisa mostrar.
    var simPlano = simular(ativosLiquidos, aporteNecessario, iPlano, mesesAcumulo, gastoMensalAposentadoria, mesesRenda);
    var simAtual = simular(ativosLiquidos, aporteAtual, iAtual, mesesAcumulo, gastoMensalAposentadoria, mesesRenda);
    var patrimonioNoAlvoAtual = simAtual.patNoAlvo;
    // Renda mensal que o ritmo atual sustentaria, na régua da estratégia escolhida.
    var rendaSustentavelAtual = estrategia === "consumo"
      ? saqueSustentavel(patrimonioNoAlvoAtual, iAtual, mesesRenda, herancaDesejada)
      : patrimonioNoAlvoAtual * PREMISSAS.taxaRetiradaPerpetua / 12;
    var semGasto = gastoMensalAposentadoria <= 0;
    var coberturaAtual = semGasto ? 0 : rendaSustentavelAtual / gastoMensalAposentadoria;
    // Zerar no último mês é o objetivo do modo consumo; só é alerta quando o
    // dinheiro acaba antes do fim do período planejado.
    var totalMeses = mesesAcumulo + mesesRenda;
    var esgotaAtualMes = (simAtual.esgotouMes !== null && simAtual.esgotouMes < totalMeses) ? simAtual.esgotouMes : null;
    var idadeEsgotaAtual = esgotaAtualMes !== null ? idade + Math.floor(esgotaAtualMes / 12) : null;
    // Quando o dinheiro acaba já no primeiro ano de aposentadoria, dizer "acaba
    // aos 60" (a mesma idade em que ela começa) não comunica nada.
    var esgotaLogoNoComeco = esgotaAtualMes !== null && esgotaAtualMes <= mesesAcumulo + 12;
    var textoEsgota = esgotaAtualMes === null ? "" :
      (esgotaLogoNoComeco
        ? "Mantendo o gasto desejado, o dinheiro não duraria nem o primeiro ano de aposentadoria."
        : "Mantendo o gasto desejado, o dinheiro acabaria aos " + idadeEsgotaAtual + " anos, " + plural(idadeEsgotaAtual - idadeAposentadoria, "ano", "anos") + " depois de parar de trabalhar.");
    var mesesAteMeta = patrimonioNecessario > 0
      ? mesesParaAlvo(ativosLiquidos, aporteAtual, iAtual, patrimonioNecessario, Math.max(0, (100 - idade) * 12))
      : null;
    var idadeAtingeMeta = mesesAteMeta !== null ? idade + Math.ceil(mesesAteMeta / 12) : null;

    // A nota mede a COBERTURA PROJETADA: quanto da renda desejada o ritmo atual
    // de aportes sustenta na idade-alvo. Olhar só o patrimônio de hoje reprovava
    // quem está no meio de um plano que funciona — o acúmulo é justamente o que
    // ainda não aconteceu. Abaixo de 40% é crítico; a partir de 80% o plano se
    // sustenta; acima de 110% há folga.
    var scoreMetas;
    if (semGasto) {
      // Sem renda-alvo declarada (só diagnósticos antigos) não há cobertura a
      // medir: cai na régua anterior, de progresso frente ao esperado por idade.
      var expectedProgress = Math.max(5, Math.min(95, ((idade - 25) / Math.max(1, (idadeAposentadoria - 25))) * 100));
      scoreMetas = bandInterp(aposentadoriaAtingida ? progressoAtual : (progressoAtual / expectedProgress) * 100, [50, 100, 150]);
    } else {
      scoreMetas = bandInterp(coberturaAtual * 100, [40, 80, 110]);
    }
    // Ajustes de planejamento: ter metas com prazo e valor e já ter calculado
    // quanto guardar por mês são sinais de direção, não só de acúmulo.
    var AJUSTE_CALCULO = { "Não": -4, "Pensei mas não calculei": -2, "Calculei aproximado": 1, "Calculei exato": 3 };
    var AJUSTE_METAS = { "Não tenho metas": -6, "Ideias vagas": -3, "Algumas com prazo/valor": 2, "Todas com prazo/valor": 4 };
    scoreMetas = Math.max(0, Math.min(100, scoreMetas + (AJUSTE_CALCULO[D.calculouQuantoGuardar] || 0) + (AJUSTE_METAS[D.temMetasDefinidas] || 0)));

    // ---- Score geral ----
    var WEIGHTS = { fluxo: 0.20, liquidez: 0.15, endividamento: 0.20, risco: 0.15, patrimonio: 0.20, metas: 0.10 };
    var scores = { fluxo: scoreFluxo, liquidez: scoreLiquidez, endividamento: scoreEndiv, risco: scoreRisco, patrimonio: scorePatrimonio, metas: scoreMetas };
    var scoreGeral = Math.round(Object.keys(WEIGHTS).reduce(function (a, k) { return a + scores[k] * WEIGHTS[k]; }, 0));
    var nivelN = scoreGeral <= 20 ? 1 : scoreGeral <= 40 ? 2 : scoreGeral <= 60 ? 3 : scoreGeral <= 80 ? 4 : 5;
    var nivel = Object.assign({ n: nivelN }, NIVEL_TEXTS[nivelN]);
    // O texto do nível vem da média e, sozinho, apaga o que está em faixa
    // crítica: "sua vida financeira está bem estruturada" era dito a quem está
    // sem plano de saúde com três filhos. A ressalva devolve o caso ao texto.
    var criticasNivel = PRIORITY_ORDER.filter(function (k) { return scores[k] < 30; });
    if (criticasNivel.length && nivelN >= 3) {
      nivel.contexto += " Um ponto importante, porém: " +
        // Os nomes das dimensões já têm "e" dentro ("Liquidez e Reserva"), então
        // a lista sai separada por vírgula para não gaguejar.
        (criticasNivel.length === 1
          ? "a dimensão de " + DIM_NAMES[criticasNivel[0]] + " está em faixa crítica"
          : "as dimensões de " + criticasNivel.map(function (k) { return DIM_NAMES[k]; }).join(", ") + " estão em faixa crítica") +
        ", e é por aí que o plano de ação começa.";
    }

    // ---- Arquétipo ----
    var dimScoreList = [
      { key: "fluxo", nome: "Fluxo de Caixa", score: scoreFluxo },
      { key: "liquidez", nome: "Liquidez", score: scoreLiquidez },
      { key: "endividamento", nome: "Endividamento", score: scoreEndiv },
      { key: "risco", nome: "Gestão de Risco", score: scoreRisco },
      { key: "patrimonio", nome: "Patrimônio", score: scorePatrimonio },
      { key: "metas", nome: "Metas e Planejamento", score: scoreMetas }
    ];
    // Uma dimensão só descreve o padrão da pessoa se o objetivo que ela mede
    // ainda estiver em aberto. Patrimônio e Metas medem o mesmo destino — a
    // aposentadoria —, então, com o plano já coberto, elas saem da disputa: era
    // por aqui que alguém com o plano 173% coberto virava "Paralisia da Decisão".
    var planoCoberto = !semGasto && coberturaAtual >= 1;
    var candidatas = dimScoreList.filter(function (d) {
      if (d.score >= 60) return false;
      if (planoCoberto && (d.key === "metas" || d.key === "patrimonio")) return false;
      return true;
    });
    // Entre dimensões praticamente empatadas, quem decide é a urgência
    // financeira, não a ordem em que elas aparecem na lista.
    var URGENCIA = { fluxo: 0, endividamento: 1, liquidez: 2, risco: 3, patrimonio: 4, metas: 5 };
    candidatas.sort(function (a, b) { return (a.score - b.score) || (URGENCIA[a.key] - URGENCIA[b.key]); });
    if (candidatas.length) {
      var piorScore = candidatas[0].score;
      candidatas = candidatas.filter(function (d) { return d.score <= piorScore + 10; })
        .sort(function (a, b) { return URGENCIA[a.key] - URGENCIA[b.key]; });
    }
    var foco = candidatas[0] || null;

    // "Paralisia da Decisão" é sobre dinheiro guardado e parado. Sem dinheiro
    // parado, patrimônio baixo é distância até a meta, não paralisia.
    var reservaParada = (D.ondeAplicada === "Poupança" || D.ondeAplicada === "Conta corrente") ? (D.reservaEmergencia || 0) : 0;
    var dinheiroParado = (D.investPoupanca || 0) + reservaParada;
    var temDinheiroParado = dinheiroParado >= rendaTotal * 3 &&
      (patrimonioInvest <= 0 || dinheiroParado / patrimonioInvest >= 0.5);

    // Dívida cara e volumosa é um padrão por si só: ela drena antes de qualquer
    // outra dimensão, mesmo quando outra pontua mais baixo.
    var dividaSufocante = !!D.temDividas && totalDividas > rendaTotal * 3 &&
      (D.usouRotativo === "Frequentemente" || (D.chequeEspecial || 0) > 0 || (D.cartaoCredito || 0) > rendaTotal);

    // Quem já passou da idade-alvo está em outra fase da vida financeira, e os
    // arquétipos de construção não descrevem esse momento. A exceção é quando
    // existe um problema urgente antes disso.
    var outraCritica = dimScoreList.some(function (d) { return d.key !== "metas" && d.key !== "patrimonio" && d.score < 30; });
    var archetypeId;
    if (deficit) archetypeId = "negacao";
    else if (aposentadoriaAtingida && !outraCritica) archetypeId = "colheita";
    else if (dividaSufocante) archetypeId = "vazamento";
    // Nenhuma dimensão em aberto: o padrão é de domínio.
    else if (!foco) archetypeId = "dominio";
    else if (scoreGeral < 40) archetypeId = "ilusao";
    else if (foco.key === "fluxo") archetypeId = "ilusao";
    else if (foco.key === "metas") archetypeId = "adiamento";
    else if (foco.key === "risco") archetypeId = "otimismo";
    else if (foco.key === "patrimonio") archetypeId = temDinheiroParado ? "paralisia" : "adiamento";
    else if (foco.key === "liquidez") archetypeId = "ilusao";
    else if (foco.key === "endividamento") archetypeId = "vazamento";
    else archetypeId = "adiamento";
    var archBase = ARCHETYPE_TEXTS[archetypeId];

    var rendaBand = rendaTotal < 8000 ? "inicial" : rendaTotal <= 20000 ? "média" : "alta";

    // Fatos reais do cliente que condicionam os textos do arquétipo:
    // nenhum texto pode afirmar algo que as respostas contradizem.
    var metasVagas = D.temMetasDefinidas === "Não tenho metas" || D.temMetasDefinidas === "Ideias vagas" || !D.temMetasDefinidas;
    var protecaoAtiva = !!(D.temSeguroVida && D.temPlanoSaude);
    var taxaSaudavel = taxaPoupanca >= 10;
    // O texto de "Ilusão de Controle" listava reserva, proteção e investimento
    // como inexistentes sem olhar os dados. Agora só entra o que falta de fato.
    var lacunasEstrutura = [];
    if (mesesCobertura < 3) lacunasEstrutura.push("reserva de emergência");
    // A proteção só entra como lacuna se a própria dimensão de risco apontar
    // isso: antes bastava não ter seguro de vida, e o relatório cobrava o item
    // de quem não tem dependentes enquanto elogiava a proteção dois blocos
    // depois.
    if (scoreRisco < 60) lacunasEstrutura.push("proteção contra imprevistos");
    if (ativosLiquidos < rendaTotal * 6) lacunasEstrutura.push("investimento de longo prazo");
    var listaLacunas = listaPt(lacunasEstrutura);

    var ARCH_PADRAO = {
      negacao: "Hoje, mais dinheiro sai do que entra (déficit de " + fmt(despesaTotal - rendaTotal) + "/mês). Isso não é sobre falta de esforço ou de renda, na maioria das vezes é sobre um padrão de evitar olhar pro extrato e deixar o piloto automático decidir por você.",
      ilusao: (taxaSaudavel
        ? "Você poupa " + pct(taxaPoupanca) + " da renda, o que é disciplina de verdade. O que ainda não existe é a estrutura em volta disso: sua reserva cobre " + num1(mesesCobertura) + " meses de despesa."
        : "Você não está no vermelho, mas também não tem margem real: sua taxa de poupança é de " + pct(taxaPoupanca) + " e sua reserva cobre " + num1(mesesCobertura) + " meses.") +
        " Esse tipo de estabilidade é frágil por natureza: basta um imprevisto para o plano inteiro depender de crédito.",
      adiamento: (taxaSaudavel
        ? "Sua taxa de poupança de " + pct(taxaPoupanca) + " mostra disciplina real."
        : "Suas contas fecham no azul, com taxa de poupança de " + pct(taxaPoupanca) + ".") +
        " Mas no ritmo atual de aportes você chegaria aos " + idadeAposentadoria + " anos com uma renda de " + fmt(rendaSustentavelAtual) +
        " por mês, " + pct(coberturaAtual * 100) + " do que você quer receber" +
        (metasVagas ? ", e suas metas ainda são ideias vagas, sem prazo ou valor definidos." : ", abaixo do que as metas que você definiu pedem."),
      otimismo: (dependentes > 0
        ? "Sua cobertura de seguro de vida é de " + num1(multiploCobertura) + "x sua renda anual, com " + dependentes + " dependente(s), abaixo do recomendado (" + String(benchmarkMultiplo).replace(".", ",") + "x)."
        : "Sua proteção contra imprevistos está incompleta" + (D.temPlanoSaude ? "" : ", a começar pela ausência de plano de saúde") + ", e sua renda ficaria garantida por pouco tempo se algo acontecesse.") +
        " Existe um viés bem humano por trás disso: a crença de que imprevistos graves acontecem com os outros, não com a gente.",
      paralisia: "Você guarda dinheiro, isso já é mais do que a maioria consegue fazer. Mas " + fmt(dinheiroParado) + " está parado em poupança ou conta corrente, rendendo menos que a inflação. O problema não é a disciplina, é o próximo passo depois de guardar.",
      vazamento: "Suas contas fecham (taxa de poupança de " + pct(taxaPoupanca) + "), mas você carrega " + fmt(totalDividas) + " em dívidas" +
        (comprometimento > 0
          ? ", com " + pct(comprometimento) + " da renda mensal comprometida em parcelas"
          : " — sem parcela fixa, o que faz o saldo crescer em silêncio no rotativo") +
        (D.sabeTaxaJuros === "Não sei" ? ", e você não sabe a que taxa de juros" : "") +
        ". Esse é o tipo de vazamento que não aparece como problema óbvio no orçamento, mas consome silenciosamente sua capacidade de construir patrimônio.",
      dominio: "Reserva, proteção, planejamento e investimento já estão no lugar: score geral de " + scoreGeral + ". Isso não é sorte, é hábito e comportamento construídos ao longo do tempo.",
      colheita: "Com " + fmt(ativosLiquidos) + " investidos, seu patrimônio sustenta cerca de " + fmt(rendaSustentavelAtual) + " por mês" +
        (estrategia === "consumo" ? " até os " + idadeFimRenda + " anos" : ", de forma perpétua") +
        (semGasto ? "." : ", contra os " + fmt(gastoMensalAposentadoria) + " que você deseja — " + pct(coberturaAtual * 100) + " do desejado.") +
        " A partir daqui, cada decisão é sobre ritmo de saque e proteção do que já existe."
    };
    var ARCH_NAO_OUTRO = {
      negacao: "Diferente de quem só precisa de ajuste fino, aqui o problema é estrutural: com déficit mensal, nenhuma outra dimensão pode ser resolvida de forma sustentável antes desta.",
      ilusao: (D.temDividas
        ? "Mesmo com dívidas em aberto, o ponto central aqui não é o endividamento em si, e sim "
        : "Diferente de quem está endividado (você não tem dívidas em aberto), o que te diferencia aqui é ") +
        (listaLacunas
          ? "o que ainda falta na estrutura de segurança: " + listaLacunas + "."
          : "o descompasso entre o que já foi construído e o que ainda não tem direção definida."),
      adiamento: "Diferente de quem enfrenta um rombo mensal (você poupa " + pct(taxaPoupanca) + " da renda)" +
        (protecaoAtiva ? " ou de quem não tem proteção básica (seu seguro e plano de saúde estão ativos)" : "") +
        ", o que te diferencia é " +
        (metasVagas
          ? "a ausência de metas com prazo e valor definidos: o dinheiro é guardado, mas sem destino claro."
          : "a distância entre o ritmo atual de aportes e o que suas metas pedem: o dinheiro é guardado, mas ainda não no volume necessário."),
      otimismo: "Diferente de quem tem problema de disciplina de poupança (sua taxa de poupança de " + pct(taxaPoupanca) + " é saudável), o gap está especificamente na proteção contra imprevistos.",
      paralisia: (taxaSaudavel
        ? "Diferente de quem não consegue guardar dinheiro, sua taxa de poupança de " + pct(taxaPoupanca) + " mostra disciplina. O gap está em transformar essa disciplina em patrimônio de fato investido."
        : "Diferente de quem não consegue fechar as contas no azul, seu fluxo está sob controle. O gap está em transformar o que você já acumulou em patrimônio de fato investido."),
      vazamento: "Diferente de quem está no vermelho (suas contas fecham, com taxa de poupança de " + pct(taxaPoupanca) + ") ou sem direção de longo prazo, o que te diferencia aqui é uma dívida cara ativa consumindo recursos que poderiam estar rendendo. O problema não é falta de renda ou disciplina, e sim uma prioridade de quitação que ainda não foi resolvida.",
      dominio: "Todas as 6 dimensões avaliadas estão em faixa adequada ou excelente, o que é raro: o foco deixa de ser corrigir e passa a ser otimizar.",
      colheita: "Diferente de quem ainda está construindo, seu horizonte de acumulação acabou: não há mais décadas de juros compostos pela frente pra corrigir uma rota. O que resta são alavancas de curto prazo — o valor do saque, a alocação da carteira de renda e a proteção contra imprevistos de saúde."
    };

    // ---- Duração do acompanhamento ----
    // Um único número manda no relatório inteiro: a gravidade do quadro. O
    // texto do arquétipo cita essa mesma duração, em vez de trazer a sua.
    var criticosCount = dimScoreList.filter(function (d) { return d.score < 30; }).length;
    var insuficientesCount = dimScoreList.filter(function (d) { return d.score >= 30 && d.score < 60; }).length;
    var duracaoFinal = 3;
    if (criticosCount >= 2) duracaoFinal = 12;
    else if (criticosCount === 1 || insuficientesCount >= 2) duracaoFinal = 6;

    // A prioridade imediata do arquétipo diz O QUE atacar primeiro. A duração
    // do acompanhamento é recomendação comercial e vive só na seção "Seu
    // Próximo Passo" — repetir "Plano de N meses" aqui antecipava a oferta no
    // meio da análise e dizia duas vezes a mesma coisa.
    var CTA_FOCO = {
      negacao: {
        inicial: "Estancar o rombo mensal e construir o primeiro colchão de segurança, antes de qualquer outra coisa.",
        "média": "Estancar o rombo mensal e construir o primeiro colchão de segurança, antes de qualquer outra coisa.",
        alta: "Reorganizar hábitos: mesmo com renda alta, esse padrão muda mais devagar do que uma planilha."
      },
      ilusao: {
        inicial: "Montar a reserva de emergência, que é a base de todo o resto.",
        "média": "Montar a reserva de emergência, que é a base de todo o resto.",
        alta: "Começar pela estrutura, não pelo recurso: aqui não falta dinheiro, falta organização."
      },
      adiamento: {
        inicial: metasVagas ? "Estruturar as 2-3 metas prioritárias com prazo e valor claros." : "Fechar a distância entre o aporte atual e o que suas metas pedem.",
        "média": metasVagas ? "Estruturar as 2-3 metas prioritárias com prazo e valor claros." : "Fechar a distância entre o aporte atual e o que suas metas pedem.",
        alta: metasVagas ? "Transformar recurso em rota: definir metas com prazo e valor e direcionar o aporte." : "Calibrar aporte, prazo e renda desejada até o plano fechar."
      },
      otimismo: {
        inicial: "Revisar a proteção básica — seguro de vida, plano de saúde e proteção de renda — como prioridade nº 1.",
        "média": "Revisar a proteção básica — seguro de vida, plano de saúde e proteção de renda — como prioridade nº 1.",
        alta: "Revisar a proteção: quanto maior o patrimônio, maior o custo de não estar protegido."
      },
      paralisia: {
        inicial: "Estruturar os primeiros investimentos com segurança e clareza.",
        "média": "Estruturar os primeiros investimentos com segurança e clareza.",
        alta: "Dar destino ao capital que já está disponível e parado."
      },
      vazamento: {
        inicial: "Eliminar a dívida mais cara e redirecionar esse valor para a construção de patrimônio.",
        "média": "Eliminar a dívida mais cara e redirecionar esse valor para a construção de patrimônio.",
        alta: "Quitar a dívida cara: com sua renda isso é rápido, é mais questão de prioridade do que de recurso."
      },
      dominio: {
        inicial: "Otimização e ajuste fino: não há lacuna estrutural a corrigir.",
        "média": "Otimização e ajuste fino: não há lacuna estrutural a corrigir.",
        alta: "Sofisticação: estruturas avançadas, diversificação internacional e planejamento sucessório."
      },
      colheita: {
        inicial: "Definir um saque mensal sustentável e proteger a renda contra imprevistos de saúde.",
        "média": "Definir um saque mensal sustentável e organizar a carteira de renda.",
        alta: "Calibrar o saque, organizar a carteira de renda e cuidar da sucessão."
      }
    };
    var arquetipo = {
      nome: archBase.nome, abertura: archBase.abertura,
      padrao: ARCH_PADRAO[archetypeId], naoOutro: ARCH_NAO_OUTRO[archetypeId],
      prioridade: CTA_FOCO[archetypeId][rendaBand]
    };

    // ---- Plano de ação (ordem fixa de prioridade) ----
    var gapCobertura = Math.max(0, benchmarkMultiplo - multiploCobertura) * rendaSeguroAnual;

    // Lacunas de proteção (usadas nos textos da dimensão de risco)
    // Sem dependentes, seguro de vida não entra como lacuna: não há renda de
    // terceiros a proteger, e cobrar isso desloca o foco do que importa.
    var seguroVidaInsuficiente = dependentes > 0 && D.temSeguroVida && multiploCobertura < benchmarkMultiplo * 0.85;
    // Como se referir às coberturas que a pessoa de fato contratou. Usado nos
    // textos de revisão de proteção, que antes falavam em "apólices" mesmo para
    // quem só tinha plano de saúde.
    var coberturasDaPessoa =
      (D.temSeguroVida && D.temPlanoSaude) ? "seu seguro de vida e seu plano de saúde" :
      D.temSeguroVida ? "seu seguro de vida" : "seu plano de saúde";
    var protecaoGaps = [];
    if (dependentes > 0 && !D.temSeguroVida) protecaoGaps.push("nenhum seguro de vida, com " + plural(dependentes, "dependente", "dependentes"));
    else if (seguroVidaInsuficiente) protecaoGaps.push("cobertura de seguro de vida de " + num1(multiploCobertura) + "x a renda anual, abaixo do recomendado (" + String(benchmarkMultiplo).replace(".", ",") + "x)");
    if (!D.temPlanoSaude) protecaoGaps.push(D.reservaMedica ? "sem plano de saúde (compensado em parte pela reserva médica)" : "sem plano de saúde nem reserva pra emergências médicas");
    // A lacuna de renda só vale como lacuna se a reserva também não cobrir o
    // período: quem declarou pouco tempo mas tem meio ano de despesas guardado
    // está protegido, e apontar isso como falha seria ignorar o próprio número.
    var rendaCurtaEmIncapacidade = (D.tempoRendaGarantida === "Nenhum tempo" || D.tempoRendaGarantida === "Menos de 3 meses") && mesesCobertura < 3;
    if (rendaCurtaEmIncapacidade) protecaoGaps.push("renda garantida por pouco tempo em caso de incapacidade de trabalhar");
    // Sem dependentes, não ter seguro nenhum ainda é uma lacuna — não pela
    // morte, e sim pela invalidez, cenário em que a pessoa continua viva e
    // precisando se sustentar sem conseguir trabalhar.
    var semCoberturaInvalidez = dependentes === 0 && !D.temSeguroVida && D.tempoRendaGarantida !== "6+ meses ou tenho seguro invalidez";
    if (semCoberturaInvalidez) protecaoGaps.push("nenhuma cobertura para invalidez além do que a reserva sustenta");
    var protecaoAcao =
      (dependentes > 0 && !D.temSeguroVida) ? "Cotar um seguro de vida compatível com o número de dependentes nos próximos 30 dias." :
      seguroVidaInsuficiente ? "Revisar o capital segurado do seguro de vida para fechar o gap identificado." :
      (!D.temPlanoSaude) ? "Cotar um plano de saúde ou estruturar uma reserva dedicada a emergências médicas." :
      semCoberturaInvalidez ? "Cotar um seguro com cobertura de invalidez, que é o cenário que pesa quando não há dependentes." :
      "Estruturar proteção de renda (seguro de invalidez ou reserva estendida) para imprevistos longos.";

    var N = {
      deficit: fmt(despesaTotal - rendaTotal),
      taxa: pct(taxaPoupanca),
      categoria: maiorCatLabel || "—",
      categoriaPct: rendaTotal > 0 ? pct((maiorCatVal / rendaTotal) * 100) : "0%",
      meses: num1(mesesCobertura),
      mesesParaMeta: taxaPoupanca > 0 ? Math.ceil(((6 - mesesCobertura) * despesaTotal) / ((taxaPoupanca / 100) * rendaTotal || 1)) : "—",
      aplicacaoNota: aplicacaoAdequada ? ", e bem aplicada." : ", mas vale revisar se está na aplicação mais eficiente.",
      aplicacaoAcao: aplicacaoAdequada ? "Manter o acompanhamento periódico da reserva." : "Realocar a reserva para um CDB ou Tesouro Selic com liquidez diária.",
      comprometimento: pct(comprometimento),
      dependentes: dependentes,
      multiplo: num1(multiploCobertura),
      benchmark: String(benchmarkMultiplo).replace(".", ","),
      gap: fmt(gapCobertura),
      indice: pct(indicePatrimonio),
      baseIndice: aposentadoriaAtingida ? "do patrimônio necessário pra renda que você deseja" : "do esperado pra sua idade e renda",
      gapDesc: concentracaoMax > 70 ? "concentração excessiva em uma única classe de investimento (" + pct(concentracaoMax) + ")" : perfilAlertText ? perfilAlertText : "vale revisar a diversificação da carteira",
      // Frase pronta (ou vazia) sobre concentração e descasamento de perfil,
      // para poder entrar em qualquer faixa da dimensão de patrimônio.
      alertaCarteira: patrimonioInvest <= 0 ? "" :
        (concentracaoMax > 70 ? " Vale olhar também a composição: há concentração excessiva em uma única classe de investimento (" + pct(concentracaoMax) + ")." : "") +
        (perfilAlertText ? " Um ponto de atenção na carteira: " + perfilAlertText + "." : ""),
      progresso: pct(progressoAtual, 1),
      aporte: fmt(aporteNecessario),
      aporteAtual: fmt(aporteAtual),
      cobertura: pct(coberturaAtual * 100),
      rendaSustentavel: fmt(rendaSustentavelAtual),
      rendaDesejada: fmt(gastoMensalAposentadoria),
      idadeAposentadoria: idadeAposentadoria,
      regraTexto: estrategia === "consumo"
        ? "consumindo o patrimônio até os " + idadeFimRenda + " anos"
        : "vivendo do rendimento, pela regra dos " + multiploAlvo + "x",
      totalDividas: fmt(totalDividas),
      mesesDivida: num1(mesesDivida),
      temDividas: !!D.temDividas && totalDividas > 0,
      temParcelas: (D.parcelasMensais || 0) > 0,
      carteiraArrasta: carteiraArrasta,
      perfilRisco: (D.perfilRisco || "Moderado").toLowerCase(),
      retornoPlano: pct(rPlanoAnual * 100, 1),
      retornoAtual: pct(rAtualAnual * 100, 1),
      protecaoLista: protecaoGaps.join("; ") || "nenhuma lacuna relevante identificada",
      protecaoAcao: protecaoAcao,
      semCoberturaInvalidez: semCoberturaInvalidez,
      coberturas: coberturasDaPessoa,
      aporteViavel: aporteNecessario <= rendaTotal * 0.5,
      aposentado: aposentadoriaAtingida,
      deficitAtivo: deficit,
      planoCoberto: planoCoberto,
      metasVagas: metasVagas
    };

    var planEntries = PRIORITY_ORDER.map(function (key) { return { key: key, score: scores[key] }; }).filter(function (e) { return e.score < 60; });
    var strengthEntries = PRIORITY_ORDER.map(function (key) { return { key: key, score: scores[key] }; }).filter(function (e) { return e.score >= 60; });

    var actionPlan = planEntries.map(function (e, i) {
      var fnKey = e.score < 30 ? "critico" : "insuficiente";
      var gen = ACTION_LIBRARY[e.key][fnKey](N);
      return { n: i + 1, dimNome: DIM_NAMES[e.key], texto: gen.texto, acao: gen.acao, key: e.key };
    });

    // Sem nenhuma lacuna, o cliente recebia a seção "Plano de Ação" vazia e um
    // checklist de um item só — justamente quem está mais bem organizado. Aqui
    // o plano deixa de ser de correção e passa a ser de refinamento.
    var planoOtimizacao = actionPlan.length === 0;
    var otimizacoes = [];
    (function montaOtimizacoes() {
      if (aposentadoriaAtingida) {
        otimizacoes.push({ dimNome: "Estratégia de saque", texto: "Seu patrimônio sustenta a renda que você deseja. O trabalho agora é definir de onde sai o dinheiro a cada mês: sequência de resgates, reserva de curto prazo separada e revisão do valor sacado sempre que a inflação corroer o poder de compra.", acao: "Definir a ordem de resgate dos ativos e revisar o valor do saque uma vez por ano." });
      } else {
        otimizacoes.push({ dimNome: "Eficiência da carteira", texto: "Com o plano de pé, cada ponto percentual de custo passa a valer muito ao longo do tempo. Vale revisar taxas de administração, custos de corretagem e a eficiência tributária de cada aplicação, comparando com alternativas equivalentes.", acao: "Levantar a taxa de administração de cada aplicação e substituir as que estiverem acima da média do mercado." });
      }
      otimizacoes.push({ dimNome: "Rebalanceamento", texto: "Carteiras saem do lugar sozinhas: a classe que mais sobe vai ganhando peso e leva o risco junto, sem que ninguém decida isso. Definir bandas de rebalanceamento transforma esse desvio numa regra, em vez de uma decisão tomada no calor do momento.", acao: "Definir a alocação-alvo por classe e uma banda de tolerância para rebalancear." });
      if ((D.temSeguroVida || D.temPlanoSaude) && D.revisouApolices !== "Recentemente") {
        otimizacoes.push({ dimNome: "Revisão de proteção", texto: "Sua proteção está adequada hoje, mas coberturas envelhecem junto com o patrimônio e a estrutura familiar. Uma revisão periódica evita descobrir uma lacuna no pior momento possível.", acao: "Revisar " + coberturasDaPessoa + " nos próximos 12 meses." });
      }
      if (patrimonioLiquido > 1500000) {
        otimizacoes.push({ dimNome: "Sucessão e estrutura", texto: "Num patrimônio desse porte, a conversa deixa de ser só rentabilidade e passa a incluir como ele se transfere: inventário, custos de transmissão e a forma de titularidade dos bens fazem diferença relevante para a família.", acao: "Mapear a titularidade dos bens e avaliar as alternativas de planejamento sucessório." });
      }
    })();
    if (planoOtimizacao) {
      actionPlan = otimizacoes.slice(0, 4).map(function (o, i) {
        return { n: i + 1, dimNome: o.dimNome, texto: o.texto, acao: o.acao, key: "otimizacao" };
      });
    }
    var strengths = strengthEntries.map(function (e) {
      var gen = ACTION_LIBRARY[e.key].otimizacao(N);
      return { dimNome: DIM_NAMES[e.key], texto: gen.texto, key: e.key };
    });

    // Regra contextual: como a dívida aparece e o uso de rotativo pra cobrir
    // outra dívida sempre entram na recomendação de endividamento. São dois
    // padrões de comportamento, e é o padrão — não o saldo — que decide se o
    // plano é de quitação ou de sair do ciclo.
    if (D.temDividas) {
      var extra = "";
      // A pergunta de taxa de juros saiu do formulário; diagnósticos gerados
      // antes disso ainda trazem a resposta, e o texto dela continua valendo.
      if (D.sabeTaxaJuros === "Não sei") {
        extra += " Levantar a taxa de juros exata de cada dívida é o primeiro passo. Sem esse dado não é possível priorizar corretamente o que quitar primeiro.";
      }
      if (D.origemDivida === "Sempre no aperto, quando não tem outra saída" || D.origemDivida === "Quase sempre no aperto") {
        extra += " Suas dívidas " + (D.origemDivida === "Quase sempre no aperto" ? "quase sempre aparecem" : "aparecem") +
          " no aperto, sem espaço pra comparar custo — e é aí que se contrata a linha mais cara disponível. Nesse padrão, quitar o saldo resolve metade do problema: sem uma reserva mínima, a próxima emergência vira dívida nova. Construir essa reserva, mesmo pequena, entra no mesmo plano da quitação.";
      } else if (D.origemDivida === "Depende: às vezes planejo, às vezes não") {
        extra += " Parte das suas dívidas é planejada e parte aparece no aperto. Vale separar quais foram as de emergência: são elas que costumam carregar as taxas mais altas e as que mais ganham com renegociação.";
      } else if (D.origemDivida === "Sempre planejada, comparando o custo antes") {
        extra += " Você contrata dívida de forma planejada, comparando o custo antes, e isso muda a natureza do que está em jogo aqui: é uma questão de volume e prazo, não de padrão de comportamento.";
      }
      if (D.usouRotativo === "Frequentemente" || D.usouRotativo === "Já aconteceu 1-2 vezes") {
        extra += " O uso recorrente de crédito rotativo pra cobrir outra dívida é um sinal de ciclo. Resolver isso é tão prioritário quanto reduzir o valor total da dívida.";
      }
      if (extra) {
        var inPlan = actionPlan.filter(function (a) { return a.key === "endividamento"; })[0];
        var inStrengths = strengths.filter(function (s) { return s.key === "endividamento"; })[0];
        if (inPlan) inPlan.texto += extra;
        else if (inStrengths) inStrengths.texto += extra;
      }
    }

    // Regra contextual: coberturas sem revisão há 2+ anos entram na recomendação
    // de risco. O texto nomeia o que a pessoa tem: falar em "apólices" para quem
    // só marcou plano de saúde contradiz a resposta que ela acabou de dar.
    if ((D.temSeguroVida || D.temPlanoSaude) && (D.revisouApolices === "Nunca revisei" || D.revisouApolices === "Faz mais de 2 anos")) {
      var extraRisco = (D.revisouApolices === "Nunca revisei"
        ? " Você nunca revisou " + coberturasDaPessoa + " desde a contratação."
        : " Faz mais de 2 anos que você não revisa " + coberturasDaPessoa + ".") +
        " Coberturas desatualizadas costumam ser descobertas na pior hora, então vale agendar uma revisão.";
      var riscoPlan = actionPlan.filter(function (a) { return a.key === "risco"; })[0];
      var riscoStrength = strengths.filter(function (s) { return s.key === "risco"; })[0];
      if (riscoPlan) riscoPlan.texto += extraRisco;
      else if (riscoStrength) riscoStrength.texto += extraRisco;
    }

    // Regra contextual: hábitos de investimento entram na recomendação de patrimônio
    var extraPatrimonio = "";
    if (D.investeAutomatico === "Só o que sobra") {
      extraPatrimonio += " Investir \"só o que sobra\" costuma ser o maior freio de acúmulo. Automatizar o aporte logo após receber a renda muda esse jogo.";
    }
    if (D.sabeRentabilidade === "Não sei") {
      extraPatrimonio += " Vale também passar a acompanhar a rentabilidade da carteira. Sem esse número, não dá pra saber se ela está trabalhando a seu favor.";
    }
    if (extraPatrimonio) {
      var patPlan = actionPlan.filter(function (a) { return a.key === "patrimonio"; })[0];
      var patStrength = strengths.filter(function (s) { return s.key === "patrimonio"; })[0];
      if (patPlan) patPlan.texto += extraPatrimonio;
      else if (patStrength) patStrength.texto += extraPatrimonio;
    }

    // ---- Checklist 30 dias ----
    var checklist = [];
    if (deficit) {
      checklist = [
        "Listar os 3 maiores gastos variáveis do último mês",
        "Cancelar ou renegociar pelo menos 1 assinatura/gasto recorrente",
        "Separar despesas fixas de variáveis num rascunho simples",
        "Definir uma meta de corte de gastos para os próximos 30 dias",
        "Agendar 15 minutos semanais para revisar o extrato"
      ];
    } else {
      checklist = actionPlan.slice(0, 3).map(function (a) { return a.acao; });
      // O item de aposentadoria só entra se o plano de ação ainda não trouxe um:
      // sem isso o checklist repetia a mesma frase duas vezes.
      var jaTemMetas = actionPlan.slice(0, 3).some(function (a) { return a.key === "metas"; });
      // Com dívida cara em aberto, mandar simular aporte contradiz o próprio
      // plano, que manda quitar antes de investir.
      var dividaCritica = scoreEndiv < 30;
      if (scoreMetas < 60 && !N.aposentado && !jaTemMetas && !dividaCritica) {
        checklist.push(N.aporteViavel
          ? "Simular um aporte mensal de " + N.aporte + " direcionado à meta de aposentadoria."
          : "Revisar valor e prazo da meta de aposentadoria pra chegar num plano de aportes realista.");
      }
      // Poucas lacunas rendiam um checklist de um ou dois itens. Quem está bem
      // também merece um mês com o que fazer: completa-se com refinamento.
      otimizacoes.forEach(function (o) {
        if (checklist.length < 4) checklist.push(o.acao);
      });
      if (checklist.length < 5) checklist.push("Revisar o extrato do último mês e confirmar se os números batem com sua percepção.");
    }
    // Rede de segurança: nenhuma linha repetida, venha de onde vier.
    checklist = checklist.filter(function (item, i, todos) { return todos.indexOf(item) === i; }).slice(0, 5);

    // ---- Próximo passo ----
    var plural2 = function (n, s, p) { return n + " " + (n === 1 ? s : p); };
    var nextStep = {
      duracao: duracaoFinal + " meses",
      justificativa: "Com " + plural2(criticosCount, "dimensão crítica", "dimensões críticas") + " e " +
        plural2(insuficientesCount, "insuficiente", "insuficientes") + ", somado ao seu perfil comportamental (" + arquetipo.nome +
        "), um acompanhamento de " + duracaoFinal + " meses é o que permite consolidar mudanças de forma realista, sem pressa nem abandono no meio do caminho."
    };

    // ---- Projeção patrimonial: acumulação + fase de renda ----
    // Toda a projeção corre em termos REAIS (acima da inflação), então meta,
    // curvas e valores ficam a preços de hoje. O gráfico vai da idade atual
    // até o fim do período de renda, marcando a idade-alvo de aposentadoria.
    var COR = { plano: "#2F7D5B", atual: "rgba(13,30,78,0.45)", meta: "#C48A3E", grade: "rgba(13,30,78,0.10)", alerta: "#B34747" };
    var CH = { w: 720, h: 300, padL: 16, padR: 16, padT: 34, padB: 26 };
    var chartAreaW = CH.w - CH.padL - CH.padR;
    var chartAreaH = CH.h - CH.padT - CH.padB;
    var ptsPlano = simPlano.pontos, ptsAtual = simAtual.pontos;
    var ultimoMes = Math.max(1, ptsPlano[ptsPlano.length - 1].mes);
    var maxSaldo = 0;
    ptsPlano.concat(ptsAtual).forEach(function (p) { if (p.saldo > maxSaldo) maxSaldo = p.saldo; });
    // Meta muito acima das curvas achataria tudo no rodapé: nesse caso ela é
    // fixada no topo do gráfico e o rótulo avisa que está fora da escala.
    var metaNaEscala = patrimonioNecessario > 0 && patrimonioNecessario <= Math.max(maxSaldo, 1) * 3;
    var maxVal = Math.max(maxSaldo, metaNaEscala ? patrimonioNecessario : 0) * 1.08 || 1;
    var CX = function (mes) { return CH.padL + (mes / ultimoMes) * chartAreaW; };
    var CY = function (v) { return CH.padT + chartAreaH - (Math.min(Math.max(v, 0), maxVal) / maxVal) * chartAreaH; };
    var baseY = CH.padT + chartAreaH;
    var poly = function (pontos) { return pontos.map(function (p) { return CX(p.mes).toFixed(1) + "," + CY(p.saldo).toFixed(1); }).join(" "); };

    // Os rótulos saem como HTML posicionado em porcentagem, não como <text> do
    // SVG: assim eles mantêm o tamanho de fonte quando o gráfico encolhe no
    // celular, em vez de virarem letras microscópicas junto com o desenho.
    var rotulos = [];
    var rotulo = function (x, y, texto, tipo, alinhamento, acima) {
      var deslocX = alinhamento === "fim" ? "-100%" : alinhamento === "meio" ? "-50%" : "0";
      rotulos.push({
        texto: texto,
        tipo: tipo,
        style: "left:" + ((x / CH.w) * 100).toFixed(2) + "%; top:" + ((y / CH.h) * 100).toFixed(2) + "%;" +
          " transform: translate(" + deslocX + "," + (acima ? "-100%" : "0") + ");"
      });
    };
    // Perto das bordas o rótulo é ancorado para dentro, senão vaza do cartão.
    var alinhaPor = function (x) { return x < CH.padL + 90 ? "inicio" : (x > CH.padL + chartAreaW - 90 ? "fim" : "meio"); };

    var svg = "";
    // Grade horizontal; o valor de cada linha fica logo acima dela, à esquerda,
    // o que dispensa uma coluna de eixo e sobra largura para a curva.
    for (var g = 0; g <= 4; g++) {
      var gy = CH.padT + chartAreaH - (g / 4) * chartAreaH;
      svg += '<line x1="' + CH.padL + '" y1="' + gy.toFixed(1) + '" x2="' + (CH.padL + chartAreaW) + '" y2="' + gy.toFixed(1) + '" stroke="' + COR.grade + '" stroke-width="1" vector-effect="non-scaling-stroke" />';
      if (g > 0) rotulo(CH.padL + 2, gy - 3, fmtCurto(maxVal * g / 4), "eixo", "inicio", true);
    }
    // Linha da meta
    if (patrimonioNecessario > 0) {
      var metaY = metaNaEscala ? CY(patrimonioNecessario) : CH.padT + 3;
      svg += '<line x1="' + CH.padL + '" y1="' + metaY.toFixed(1) + '" x2="' + (CH.padL + chartAreaW) + '" y2="' + metaY.toFixed(1) + '" stroke="' + COR.meta + '" stroke-width="1.5" stroke-dasharray="6,4" vector-effect="non-scaling-stroke" />';
      rotulo(CH.padL + chartAreaW - 2, metaY - 4, "Meta: " + fmt(patrimonioNecessario) + (metaNaEscala ? "" : " (acima da escala)"), "meta", "fim", true);
    }
    // Marco vertical da aposentadoria
    if (mesesAcumulo > 0 && mesesAcumulo < ultimoMes) {
      var mx = CX(mesesAcumulo);
      svg += '<line x1="' + mx.toFixed(1) + '" y1="' + CH.padT + '" x2="' + mx.toFixed(1) + '" y2="' + baseY + '" stroke="rgba(13,30,78,0.3)" stroke-width="1.2" stroke-dasharray="3,3" vector-effect="non-scaling-stroke" />';
      rotulo(mx, CH.padT - 6, "aposentadoria · " + idadeAposentadoria + " anos", "marco", alinhaPor(mx), true);
    }
    // Área sob a curva do plano recomendado
    svg += '<polygon points="' + CX(0).toFixed(1) + "," + baseY + " " + poly(ptsPlano) + " " + CX(ultimoMes).toFixed(1) + "," + baseY + '" fill="rgba(212,130,10,0.16)" />';
    // Curva do ritmo atual (tracejada) e do plano recomendado (cheia)
    svg += '<polyline points="' + poly(ptsAtual) + '" fill="none" stroke="' + COR.atual + '" stroke-width="2" stroke-dasharray="5,4" stroke-linejoin="round" vector-effect="non-scaling-stroke" />';
    svg += '<polyline points="' + poly(ptsPlano) + '" fill="none" stroke="' + COR.plano + '" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />';
    // Patrimônio de cada cenário na idade-alvo
    if (mesesAcumulo > 0 && mesesAcumulo <= ultimoMes) {
      svg += '<circle cx="' + CX(mesesAcumulo).toFixed(1) + '" cy="' + CY(simPlano.patNoAlvo).toFixed(1) + '" r="4" fill="' + COR.plano + '" />';
      svg += '<circle cx="' + CX(mesesAcumulo).toFixed(1) + '" cy="' + CY(patrimonioNoAlvoAtual).toFixed(1) + '" r="3.5" fill="#0D1E4E" fill-opacity="0.55" />';
    }
    // Ponto em que o dinheiro acaba no ritmo atual
    if (esgotaAtualMes !== null) {
      var ex = CX(esgotaAtualMes);
      svg += '<circle cx="' + ex.toFixed(1) + '" cy="' + baseY + '" r="4.5" fill="' + COR.alerta + '" />';
      rotulo(ex, baseY - 8, esgotaLogoNoComeco ? "acaba logo no início" : "acaba aos " + idadeEsgotaAtual + " anos", "alerta", alinhaPor(ex), true);
    }
    // Eixo X em idades
    var totalAnos = Math.max(1, Math.round(ultimoMes / 12));
    var passoAnos = Math.max(1, Math.ceil(totalAnos / 7));
    var ultimoTick = 0;
    for (var ta = 0; ta <= totalAnos; ta += passoAnos) {
      rotulo(CX(ta * 12), CH.h - 20, String(idade + ta), "eixo", alinhaPor(CX(ta * 12)));
      ultimoTick = ta;
    }
    // A idade final só entra se não for grudar no tick anterior.
    if (totalAnos - ultimoTick >= passoAnos * 0.5) rotulo(CX(totalAnos * 12), CH.h - 20, String(idade + totalAnos), "eixo", "fim");

    // O desenho preenche a caixa (preserveAspectRatio="none"), que no celular
    // é proporcionalmente mais alta — daí ganhar altura em vez de virar uma
    // faixa fininha. Os traços não distorcem por causa do non-scaling-stroke.
    var chartSvg = '<svg viewBox="0 0 ' + CH.w + ' ' + CH.h + '" preserveAspectRatio="none" style="position:absolute; inset:0; width:100%; height:100%; display:block;">' + svg + '</svg>';
    var chart = { svg: chartSvg, rotulos: rotulos };

    // ---- Painel da aposentadoria (números e veredito da projeção) ----
    var estrategiaLabel = estrategia === "consumo"
      ? "Consumir o patrimônio ao longo da aposentadoria"
      : "Viver do rendimento, preservando o patrimônio";
    var estrategiaResumo = estrategia === "consumo"
      ? "Você escolheu consumir o patrimônio: receber " + fmt(gastoMensalAposentadoria) + " por mês dos " + idadeAposentadoria + " aos " + idadeFimRenda + " anos" +
        (herancaDesejada > 0 ? ", deixando " + fmt(herancaDesejada) + " no final." : ", terminando sem patrimônio.") +
        " Como o principal é gasto, o valor necessário é menor do que o de uma renda perpétua."
      : "Você escolheu viver do rendimento: sacar " + pct(PREMISSAS.taxaRetiradaPerpetua * 100, 1) + " ao ano (" + fmt(gastoMensalAposentadoria) + " por mês) sem tocar no principal. " +
        "O patrimônio permanece intacto e vira herança, o que exige " + multiploAlvo + "x o gasto anual.";

    // Cada cartão degrada com elegância: sem renda desejada não há meta, e quem
    // já passou da idade-alvo não tem aporte nem diferença a mostrar.
    var apoCards = [
      {
        label: aposentadoriaAtingida ? "Patrimônio necessário" : "Patrimônio necessário aos " + idadeAposentadoria,
        value: semGasto ? "—" : fmt(patrimonioNecessario),
        sub: semGasto
          ? "depende da renda mensal desejada, que ficou em branco"
          : (estrategia === "consumo"
            ? "pra receber " + fmt(gastoMensalAposentadoria) + "/mês por " + plural(anosRenda, "ano", "anos")
            : multiploAlvo + "x o gasto anual de " + fmt(gastoMensalAposentadoria * 12))
      },
      {
        label: "Aporte mensal necessário",
        value: (semGasto || aposentadoriaAtingida) ? "—" : fmt(aporteNecessario),
        sub: aposentadoriaAtingida
          ? "você já está na idade-alvo, não há fase de acumulação"
          : (semGasto
            ? "sem renda-alvo não há aporte a calcular"
            : (aporteNecessario <= 0
              ? "o que você já tem investido cobre a meta sozinho"
              : "todo mês por " + plural(anosAcumulo, "ano", "anos") + ", dos " + idade + " aos " + idadeAposentadoria))
      },
      {
        label: "Seu aporte hoje",
        value: fmt(aporteAtual),
        sub: taxaPoupanca < 0
          ? "suas despesas superam a renda, não há sobra pra investir"
          : pct(taxaPoupanca) + " da renda mensal"
      },
      {
        label: "Diferença por mês",
        value: (semGasto || aposentadoriaAtingida) ? "—" : fmt(gapAporte),
        sub: aposentadoriaAtingida
          ? "sem fase de acumulação, o ajuste é no gasto, não no aporte"
          : (semGasto
            ? "aparece quando a renda desejada estiver informada"
            : (gapAporte > 0 ? "o quanto falta guardar todo mês" : "seu ritmo atual já cobre o aporte necessário"))
      },
      {
        label: "Renda que o ritmo atual sustenta",
        value: fmt(rendaSustentavelAtual) + "/mês",
        sub: semGasto
          ? "informe a renda desejada pra comparar"
          : pct(coberturaAtual * 100) + " da renda de " + fmt(gastoMensalAposentadoria) + " que você deseja"
      },
      {
        label: aposentadoriaAtingida ? "Investido hoje" : "Patrimônio projetado aos " + idadeAposentadoria,
        value: fmt(patrimonioNoAlvoAtual),
        sub: aposentadoriaAtingida ? "sem contar a reserva de emergência" : "mantendo exatamente o ritmo atual de aportes"
      }
    ];

    var veredito;
    if (semGasto) {
      veredito = { tipo: "atencao", texto: "Você ainda não informou quanto quer receber por mês na aposentadoria, então não há como calcular o patrimônio necessário. Definir esse número é o primeiro passo pra transformar \"guardar dinheiro\" em um plano com destino." };
    } else if (aposentadoriaAtingida) {
      veredito = { tipo: "atencao", texto: "Pela idade-alvo informada (" + idadeAposentadoria + " anos), você já está no período de aposentadoria. Com " + fmt(ativosLiquidos) + " investidos, o patrimônio sustenta cerca de " + fmt(rendaSustentavelAtual) + " por mês" + (estrategia === "consumo" ? " até os " + idadeFimRenda + " anos" : " de forma perpétua") + ", contra os " + fmt(gastoMensalAposentadoria) + " desejados. O ajuste aqui é de gasto sustentável e estratégia de renda, não de aporte." };
    } else if (coberturaAtual >= 1) {
      veredito = { tipo: "ok", texto: "No ritmo atual de " + fmt(aporteAtual) + " por mês, você chega aos " + idadeAposentadoria + " anos com " + fmt(patrimonioNoAlvoAtual) + " — o suficiente para a renda de " + fmt(gastoMensalAposentadoria) + " que você deseja. O plano está de pé: o foco agora é manter a consistência dos aportes e a carteira alinhada ao seu perfil." };
    } else {
      var faltaTexto = "No ritmo atual de " + fmt(aporteAtual) + " por mês, você chegaria aos " + idadeAposentadoria + " anos com " + fmt(patrimonioNoAlvoAtual) +
        ", o que sustenta " + fmt(rendaSustentavelAtual) + " por mês (" + pct(coberturaAtual * 100) + " do que você quer receber). ";
      // Quando o aporte já seria suficiente na carteira do perfil declarado, o
      // gap não vem do quanto se guarda, e sim de onde o dinheiro está: mandar
      // "subir o aporte" para um valor menor que o atual não faria sentido.
      if (carteiraArrasta) {
        faltaTexto += "Repare que o seu aporte de " + fmt(aporteAtual) + " já seria suficiente se a carteira rendesse como a de um perfil " +
          (D.perfilRisco || "Moderado").toLowerCase() + " (" + pct(rPlanoAnual * 100, 1) + " ao ano acima da inflação). A composição atual rende " +
          pct(rAtualAnual * 100, 1) + ", e é essa diferença que abre o gap: aqui, realinhar a carteira pesa mais do que guardar mais.";
      } else {
        faltaTexto += "Pra fechar esse gap, o aporte precisa subir de " + fmt(aporteAtual) + " para " + fmt(aporteNecessario) + " por mês" +
          (gapAporte > 0 ? " — " + fmt(gapAporte) + " a mais." : ".");
      }
      if (textoEsgota) faltaTexto += " " + textoEsgota;
      if (idadeAtingeMeta !== null && idadeAtingeMeta > idadeAposentadoria) {
        // Acima dos 90 o número exato assusta sem informar: um gap de R$ 99 por
        // mês virava "só seria atingido aos 99 anos".
        faltaTexto += idadeAtingeMeta >= 90
          ? " Sem mudar nada, o patrimônio necessário só seria atingido bem depois dos 90 anos — os últimos anos de juros compostos são os que mais pesam, e é por isso que uma diferença pequena hoje custa tanto lá na frente."
          : " Sem mudar nada, o patrimônio necessário só seria atingido por volta dos " + idadeAtingeMeta + " anos.";
      }
      if (!carteiraArrasta && aporteNecessario > rendaTotal * 0.5) faltaTexto += " Como esse aporte passa de metade da sua renda, o caminho realista combina três alavancas: adiar a idade-alvo, revisar a renda desejada e aumentar o aporte no que for possível.";
      veredito = { tipo: coberturaAtual < 0.5 ? "critico" : "atencao", texto: faltaTexto };
    }

    var aposentadoria = {
      estrategia: estrategia,
      estrategiaLabel: estrategiaLabel,
      estrategiaResumo: estrategiaResumo,
      idadeAtual: idade,
      idadeAposentadoria: idadeAposentadoria,
      idadeFimRenda: estrategia === "consumo" ? idadeFimRenda : null,
      anosAcumulo: anosAcumulo,
      anosRenda: anosRenda,
      cards: apoCards,
      veredito: veredito,
      titulo: aposentadoriaAtingida
        ? "Sua aposentadoria em números"
        : "Sua aposentadoria aos " + idadeAposentadoria + " anos",
      subtitulo: "Comparação entre manter o ritmo atual de aportes e seguir o plano necessário pra bancar a renda que você quer" +
        (estrategia === "consumo" ? " dos " + idadeAposentadoria + " aos " + idadeFimRenda + " anos." : " de forma perpétua."),
      premissas: "Valores a preços de hoje: as projeções usam retorno real anual de " + pct(rAtualAnual * 100, 1) + " (composição atual da sua carteira) e " +
        pct(rPlanoAnual * 100, 1) + " (carteira do perfil " + (D.perfilRisco || "Moderado") + "), ou seja, já descontada uma inflação estimada de " + pct(PREMISSAS.inflacaoAnual * 100, 1) +
        " ao ano. O aporte do ritmo atual é a sua taxa de poupança aplicada sobre a renda; o patrimônio de partida (" + fmt(ativosLiquidos) + ") exclui a reserva de emergência. " +
        (estrategia === "renda"
          ? "A renda sustentável dos cartões usa a regra de retirada segura de " + pct(PREMISSAS.taxaRetiradaPerpetua * 100, 1) + " ao ano, deliberadamente mais conservadora que a curva do gráfico: ela existe justamente porque o retorno real não vem parelho todo ano. "
          : "A curva do plano é desenhada para zerar no fim do período de renda" + (herancaDesejada > 0 ? ", deixando " + fmt(herancaDesejada) + " de herança. " : ". ")) +
        "Projeções não constituem garantia ou promessa de retorno; são baseadas em premissas assumidas e podem não se concretizar."
    };

    // ---- Gauge ----
    var gaugeCirc = 2 * Math.PI * 68;
    var gaugeDash = gaugeCirc.toFixed(1) + " " + gaugeCirc.toFixed(1);
    var gaugeOffset = (gaugeCirc * (1 - scoreGeral / 100)).toFixed(1);

    // ---- KPI cards ----
    // O KPI de destaque usa a mesma régua da dimensão de Metas e da projeção:
    // cobertura da renda desejada. O progresso patrimonial continua no
    // relatório, mas com o nome do que ele realmente mede.
    // ---- KPIs, agrupados por assunto ----
    // Antes eram três cartões de destaque soltos e uma grade única de onze.
    // Agrupar por assunto dá ao leitor três perguntas em vez de catorze números:
    // quanto entra e sai, quanto já foi construído, e quão protegido isso está.
    // Cada grupo tem um número-âncora e os que o explicam.
    var kpiGrupos = [
      {
        titulo: "Fluxo mensal",
        destaque: { label: "Renda total mensal", value: fmt(rendaTotal),
          sub: !D.temConjuge ? undefined
            : (somaRendaConjuge
              ? "soma da sua renda com a do seu cônjuge"
              : "só a sua renda: a do cônjuge (" + fmt(D.rendaConjuge || 0) + ") ficou fora da análise, como você pediu") },
        itens: [
          { label: "Despesa total mensal", value: fmt(despesaTotal), sub: aporteMensal > 0 ? "+ " + fmt(aporteMensal) + " de aporte em investimentos" : undefined },
          { label: "Taxa de poupança", value: pct(taxaPoupanca), sub: aporteMensal > 0 ? "inclui o aporte mensal declarado" : undefined }
        ]
      },
      {
        titulo: "Patrimônio",
        destaque: { label: "Patrimônio líquido", value: fmt(patrimonioLiquido) },
        itens: [
          { label: "Patrimônio total", value: fmt(patrimonioTotal) },
          { label: "Patrimônio esperado x real", value: pct(indicePatrimonio) },
          { label: "Investido para aposentadoria", value: fmt(ativosLiquidos), sub: (D.reservaEmergencia || 0) > 0 ? "não inclui a reserva de emergência" : undefined },
          { label: "Patrimônio acumulado x necessário", value: semGasto ? "—" : pct(progressoAtual, 1), sub: semGasto ? "renda desejada não informada" : "quanto do alvo já existe hoje" },
          {
            label: "Cobertura da renda desejada",
            value: semGasto ? "—" : pct(coberturaAtual * 100),
            sub: semGasto ? "renda desejada não informada" : (aposentadoriaAtingida ? "do que seu patrimônio sustenta hoje" : "no ritmo atual, aos " + idadeAposentadoria + " anos")
          },
          { label: "Aporte mensal necessário", value: (semGasto || aposentadoriaAtingida) ? "—" : fmt(aporteNecessario), sub: aposentadoriaAtingida ? "já está na idade-alvo" : (semGasto ? "renda desejada não informada" : "pra se aposentar aos " + idadeAposentadoria + " anos") }
        ]
      },
      {
        titulo: "Proteção e dívida",
        destaque: { label: "Reserva de emergência", value: fmt(D.reservaEmergencia), sub: num1(mesesCobertura) + " meses de cobertura" },
        itens: [
          { label: "Total de dívidas", value: fmt(totalDividas), sub: D.temDividas ? pct(comprometimento) + " da renda em parcelas" : "sem dívidas em aberto" },
          { label: "Cobertura de seguro de vida", value: num1(multiploCobertura) + "x", sub: "da sua renda anual" },
          { label: "Índice de solvência", value: pct(indiceSolvencia), sub: patrimonioLiquido < 0 ? "suas dívidas superam o que você tem em bens" : undefined }
        ]
      }
    ];

    // Insight comportamental: divergência entre percepção e realidade calculada
    var divergencias = [];
    if (D.salarioCobre === true && deficit) {
      divergencias.push("Você sente que sua renda cobre as despesas, mas o cálculo real mostra um déficit de " + fmt(despesaTotal - rendaTotal) + "/mês. Vale revisar o orçamento com mais atenção.");
    } else if (D.salarioCobre === false && !deficit) {
      divergencias.push("Você sente que a renda não cobre as despesas, mas pelos números reais suas contas fecham (taxa de poupança de " + pct(taxaPoupanca) + "). A sensação de aperto pode vir de falta de clareza sobre para onde o dinheiro vai, não de um problema real de fluxo.");
    }
    if (D.sobraEmpataVermelho === "Sobra" && taxaPoupanca < 5 && !deficit) {
      divergencias.push("Você sente que sobra dinheiro no fim do mês, mas sua taxa de poupança real é de apenas " + pct(taxaPoupanca) + ". Vale confirmar se essa sobra está realmente sendo guardada ou só some sem destino.");
    } else if (D.sobraEmpataVermelho === "Fico no vermelho" && !deficit) {
      divergencias.push("Você sente que fica no vermelho, mas o cálculo mostra que as contas fecham. Pode valer a pena mapear os gastos com mais detalhe pra entender de onde vem essa sensação.");
    }
    if (D.sabeParaOndeVaiDinheiro === "Não, tenho surpresas com frequência") {
      divergencias.push("Você relatou ter surpresas frequentes com os próprios gastos. Mapear categorias com mais detalhe no dia a dia pode trazer bastante clareza sobre para onde o dinheiro está indo.");
    }
    // Segurança percebida (tempo que aguentaria sem renda) × cobertura real da reserva
    var TEMPO_PERCEBIDO_MESES = { "Dias": 0.2, "Semanas": 0.7, "Poucos meses": 3, "6+ meses": 6 };
    var percepcaoMeses = TEMPO_PERCEBIDO_MESES[D.tempoSemRenda];
    if (percepcaoMeses !== undefined && despesaTotal > 0) {
      if (percepcaoMeses >= 3 && mesesCobertura < percepcaoMeses * 0.5) {
        divergencias.push("Você acredita que manteria seu padrão de vida por " + D.tempoSemRenda.toLowerCase() + " sem renda, mas sua reserva cobre " + num1(mesesCobertura) + " meses de despesas. A segurança percebida está maior que a real.");
      } else if (percepcaoMeses <= 0.7 && mesesCobertura >= 3) {
        divergencias.push("Você sente que se desesperaria em " + D.tempoSemRenda.toLowerCase() + " sem renda, mas sua reserva cobre " + num1(mesesCobertura) + " meses de despesas. Você está mais protegido(a) do que imagina.");
      }
    }
    var insightPercepcao = { show: divergencias.length > 0, itens: divergencias.slice(0, 3) };

    // ---- Linhas de dimensão ----
    var DIM_CONTEXT = {
      fluxo: deficit ? "Despesas superam a renda em " + fmt(despesaTotal - rendaTotal) + "/mês." : "Taxa de poupança de " + pct(taxaPoupanca) + (aporteMensal > 0 ? ", incluindo " + fmt(aporteMensal) + " de aporte mensal." : "."),
      liquidez: num1(mesesCobertura) + " meses de despesas cobertos pela reserva.",
      endividamento: D.temDividas ? "Dívidas de " + fmt(totalDividas) + ", com parcelas comprometendo " + pct(comprometimento) + " da renda mensal." : "Sem dívidas em aberto no momento.",
      risco: (dependentes > 0
        ? "Cobertura de seguro de vida de " + num1(multiploCobertura) + "x a renda anual para " + plural(dependentes, "dependente", "dependentes") + ", "
        : "Sem dependentes, o peso fica na invalidez: " + (D.temSeguroVida ? "com seguro contratado, " : "sem seguro contratado, ")) +
        (D.temPlanoSaude ? "com" : "sem") + " plano de saúde, renda garantida por \"" + (D.tempoRendaGarantida || "—").toLowerCase() + "\"" +
        (rendaProtegidaPelaReserva ? " e reserva que cobre " + num1(mesesCobertura) + " meses de despesas." : "."),
      patrimonio: aposentadoriaAtingida
        ? "Patrimônio investido cobre " + pct(indicePatrimonio) + " do necessário para a renda que você deseja."
        : "Patrimônio em " + pct(indicePatrimonio) + " do esperado pra sua idade e renda.",
      metas: semGasto
        ? "Renda desejada na aposentadoria não informada, então a projeção usa o progresso frente ao esperado pra sua idade."
        : (aposentadoriaAtingida
          ? "Seu patrimônio sustenta " + pct(coberturaAtual * 100) + " da renda de " + fmt(gastoMensalAposentadoria) + " que você deseja."
          : "No ritmo atual de aportes, você cobre " + pct(coberturaAtual * 100) + " da renda que quer ter aos " + idadeAposentadoria + " anos.")
    };
    var dimRows = PRIORITY_ORDER.map(function (key) {
      var score = Math.round(scores[key]);
      var band = bandLabel(scores[key]);
      var barColor = band === "critico" ? "#B34747" : band === "insuficiente" ? "#C48A3E" : band === "adequado" ? "#2F7D5B" : "#0D1E4E";
      return { nome: DIM_NAMES[key], score: score, contexto: DIM_CONTEXT[key], barStyle: "width:" + Math.max(4, score) + "%; background:" + barColor + ";" };
    });

    // ---- Metas declaradas (aposentadoria + outras metas do formulário) ----
    var metasDeclaradas = [{
      titulo: "Aposentadoria aos " + idadeAposentadoria + " anos",
      detalhe: "renda desejada de " + fmt(gastoMensalAposentadoria) + "/mês · patrimônio-alvo de " + fmt(patrimonioNecessario) +
        (estrategia === "consumo"
          ? " (consumindo o patrimônio até os " + idadeFimRenda + " anos" + (herancaDesejada > 0 ? ", deixando " + fmt(herancaDesejada) : "") + ")"
          : " (regra dos " + multiploAlvo + "x, vivendo do rendimento)")
    }];
    (D.outrasMetas || []).forEach(function (m) {
      if (!m || (!m.descricao && !(m.valorEstimado > 0))) return;
      var det = [];
      if (m.valorEstimado > 0) det.push(fmt(m.valorEstimado));
      if (m.prazo) det.push("prazo: " + m.prazo);
      metasDeclaradas.push({ titulo: m.descricao || "Meta", detalhe: det.join(" · ") });
    });

    // ---- Alternativas seguras e mais rentáveis (CDB 100% CDI, Tesouro Selic) ----
    var poupancaParada = (D.investPoupanca || 0) > 0;
    var reservaMalAplicada = (D.reservaEmergencia || 0) > 0 && !aplicacaoAdequada;
    var investSeguroIntro;
    if (poupancaParada && reservaMalAplicada) {
      investSeguroIntro = "Você tem " + fmt(D.investPoupanca) + " na poupança e sua reserva de emergência está em \"" + (D.ondeAplicada || "—") + "\". Com a mesma segurança (ou maior), esse dinheiro pode render mais:";
    } else if (poupancaParada) {
      investSeguroIntro = "Você tem " + fmt(D.investPoupanca) + " na poupança. Com a mesma segurança e liquidez, esse dinheiro pode render mais:";
    } else if (reservaMalAplicada) {
      investSeguroIntro = "Sua reserva de emergência está em \"" + (D.ondeAplicada || "—") + "\". Pra reserva e objetivos de curto prazo, estas alternativas combinam segurança, liquidez e rentabilidade:";
    } else {
      investSeguroIntro = "Pra reserva de emergência e objetivos de curto prazo, estas são as classes de aplicação que combinam segurança, liquidez e rentabilidade:";
    }
    var investSeguro = {
      destaque: poupancaParada || reservaMalAplicada,
      intro: investSeguroIntro,
      itens: [
        { nome: "CDB 100% do CDI (ou mais) com liquidez diária", desc: "Rende consistentemente mais que a poupança, com garantia do FGC de até R$ 250 mil por CPF por instituição e resgate no mesmo dia." },
        { nome: "Tesouro Selic", desc: "Título público federal, a aplicação de menor risco do mercado brasileiro. Acompanha a taxa Selic e permite resgate a qualquer momento sem perda relevante." }
      ],
      nota: "Indicações educacionais de classes de aplicação, não recomendação individualizada de produto."
    };

    return {
      data: Object.assign({}, D, {
        primeiroNome: primeiroNome,
        idade: idadeCalculada !== null ? idadeCalculada : (D.idade || ""),
        nascimentoDisplay: formatarData(D.dataNascimento),
        nascimentoConjugeDisplay: formatarData(D.dataNascimentoConjuge)
      }),
      dataFormatada: dataRef.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }),
      scoreGeral: scoreGeral, nivel: nivel, arquetipo: arquetipo,
      gaugeDash: gaugeDash, gaugeOffset: gaugeOffset,
      kpis: {
        rendaTotalDisplay: fmt(rendaTotal),
        patrimonioTotalDisplay: fmt(patrimonioTotal),
        patrimonioNecessarioDisplay: fmt(patrimonioNecessario),
        aporteNecessarioDisplay: fmt(aporteNecessario),
        aporteAtualDisplay: fmt(aporteAtual),
        rendaSustentavelDisplay: fmt(rendaSustentavelAtual),
        taxaRetornoDisplay: pct(rAtualAnual * 100, 1) + " (atual) / " + pct(rPlanoAnual * 100, 1) + " (recomendado)",
        inflacaoDisplay: pct(PREMISSAS.inflacaoAnual * 100, 1)
      },
      // Números crus (sem formatação), para quem precisa dos valores e não
      // do texto — hoje, o resumo gravado no Supabase.
      valores: {
        rendaTotal: rendaTotal,
        despesaTotal: despesaTotal,
        taxaPoupanca: taxaPoupanca,
        patrimonioTotal: patrimonioTotal,
        patrimonioLiquido: patrimonioLiquido,
        ativosLiquidos: ativosLiquidos,
        totalDividas: totalDividas,
        patrimonioNecessario: patrimonioNecessario,
        aporteNecessario: aporteNecessario,
        aporteAtual: aporteAtual,
        rendaSustentavelAtual: rendaSustentavelAtual,
        progressoAtual: progressoAtual
      },
      kpiGrupos: kpiGrupos, distribuicao: distribuicao, dimRows: dimRows, metasDeclaradas: metasDeclaradas,
      aposentadoria: aposentadoria,
      chart: chart,
      actionPlan: actionPlan, planoOtimizacao: planoOtimizacao, hasStrengths: strengths.length > 0, strengths: strengths, investSeguro: investSeguro,
      checklist: checklist, glossario: GLOSSARIO, nextStep: nextStep, insightPercepcao: insightPercepcao,
      vozCliente: { show: !!(D.descricaoSituacao || D.maiorDor || D.sonhos), situacao: D.descricaoSituacao, maiorDor: D.maiorDor, sonhos: D.sonhos },
      contatoMailto: "mailto:contato@ehinvestimentos.com.br?subject=Diagn%C3%B3stico%20Financeiro%20-%20Pr%C3%B3ximos%20passos"
    };
  }

  var raiz = typeof window !== "undefined" ? window : globalThis;
  raiz.EHDiag = {
    fmt: fmt,
    fmtCurto: fmtCurto,
    pct: pct,
    num1: num1,
    plural: plural,
    PREMISSAS: PREMISSAS,
    idadeEm: idadeEm,
    idadeDe: idadeDe,
    formatarData: formatarData,
    esc: esc,
    bandInterp: bandInterp,
    bandLabel: bandLabel,
    computeReport: computeReport,
    GLOSSARIO: GLOSSARIO,
    NIVEL_TEXTS: NIVEL_TEXTS,
    ARCHETYPE_TEXTS: ARCHETYPE_TEXTS
  };
})();
