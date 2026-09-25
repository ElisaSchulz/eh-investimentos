/* EH Investimentos — documentos do cliente (Suitability e Contrato de Consultoria)
 * no design novo, gerados como PDF (páginas A4 renderizadas como imagem).
 *
 * Requer, carregados antes deste arquivo:
 *   jsPDF       https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
 *   html2canvas https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
 *
 * Uso:
 *   const base64 = await EHDocs.pdfBase64('suitability', { nome, cpf, data, perfil });
 *   const base64 = await EHDocs.pdfBase64('contrato',    { nome, nacionalidade, estadoCivil, rg, cpf,
 *                                                          endereco, data, remuneracao });
 *   await EHDocs.abrirPdf('suitability', dados);   // abre o PDF numa nova aba
 */
(function () {
  const LOGO = 'Logo_EH.png';

  // Página A4 a 96 dpi, margem de 16 mm
  const PAGE_W = 794, PAGE_H = 1123, MARGIN = 60;

  const NAVY = '#002060', GOLD = '#EE9A1E', BRONZE = '#92600D', GRAY = '#6C6D70';
  const RULE = 'rgba(0,32,96,0.12)', CREAM = '#F7F5EF', TEXT = '#2A3550';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const dataCurta   = d => d.toLocaleDateString('pt-BR');
  const dataExtenso = d => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  const fmtCPF = c => {
    const n = String(c || '').replace(/\D/g, '');
    return n.length === 11 ? n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : String(c || '');
  };

  // ── Peças comuns ──
  const header = titulo => `
    <div style="padding-bottom:8px;border-bottom:1px solid ${RULE};display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div style="display:flex;align-items:center;gap:9px;">
        <img src="${LOGO}" alt="EH" style="height:18px;width:auto;display:block;">
        <span style="font-weight:800;font-size:9.5px;letter-spacing:0.14em;color:${NAVY};">EH INVESTIMENTOS</span>
      </div>
      <span style="font-size:8.5px;letter-spacing:0.18em;color:${GRAY};font-weight:600;">${titulo}</span>
    </div>`;

  const footer = (pagina, total) => `
    <div style="padding-top:8px;border-top:1px solid ${RULE};display:flex;justify-content:space-between;gap:12px;font-size:8.5px;letter-spacing:0.16em;color:${GRAY};font-weight:600;">
      <span>EH INVESTIMENTOS · GESTÃO FINANCEIRA</span>
      <span>BELO HORIZONTE · MG · ${pagina}/${total}</span>
    </div>`;

  const capa = (kicker, tituloHtml, comMarca) => `
    <div style="background:${NAVY};color:#fff;border-radius:8px;padding:30px 32px 28px;margin:10px 0 26px;position:relative;overflow:hidden;text-align:left;">
      <div style="position:absolute;top:-120px;right:-90px;width:320px;height:320px;border:1px solid rgba(238,154,30,0.22);border-radius:50%;"></div>
      <div style="position:absolute;top:-60px;right:-30px;width:200px;height:200px;border:1px solid rgba(255,255,255,0.07);border-radius:50%;"></div>
      ${comMarca ? `
      <div style="display:flex;align-items:center;gap:12px;position:relative;">
        <img src="${LOGO}" alt="EH" style="height:30px;width:auto;display:block;">
        <div style="display:flex;flex-direction:column;line-height:1;">
          <span style="font-weight:800;font-size:12.5px;letter-spacing:0.16em;">EH INVESTIMENTOS</span>
          <span style="font-weight:400;font-size:8.5px;letter-spacing:0.34em;color:#9aa3bd;margin-top:5px;">GESTÃO FINANCEIRA</span>
        </div>
      </div>` : ''}
      <div style="font-size:10px;letter-spacing:0.28em;color:${GOLD};font-weight:700;margin:${comMarca ? '34px' : '0'} 0 10px;position:relative;">${kicker}</div>
      <h1 style="font-family:'Fraunces',serif !important;font-weight:600;font-size:34px;line-height:1.08;letter-spacing:-0.01em;margin:0;position:relative;">${tituloHtml}</h1>
      <div style="width:60px;height:2px;background:${GOLD};margin-top:20px;position:relative;"></div>
    </div>`;

  // Títulos de seção ficam presos ao bloco seguinte na paginação (data-keep)
  const secao = (kicker, titulo) => `
    <div data-keep style="margin:26px 0 14px;padding-top:14px;border-top:1px solid ${RULE};text-align:left;">
      <div style="font-size:10px;letter-spacing:0.24em;color:${BRONZE};font-weight:700;margin-bottom:5px;">${kicker}</div>
      <h2 style="font-family:'Fraunces',serif !important;font-weight:600;font-size:21px;color:${NAVY};margin:0;line-height:1.15;">${titulo}</h2>
    </div>`;

  const campo = (rotulo, valor) => `
    <div style="background:${CREAM};border-radius:8px;padding:16px 18px;">
      <div style="font-size:9.5px;letter-spacing:0.22em;color:${BRONZE};font-weight:700;margin-bottom:6px;">${rotulo}</div>
      <p style="margin:0;font-size:12.5px;line-height:1.5;"><strong style="color:${NAVY};">${valor}</strong></p>
    </div>`;

  const assinaturas = (localData, esq, dir) => `
    <div style="margin:40px 0 10px;text-align:left;">
      <p style="margin:0 0 56px;">${localData}</p>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:40px;">
        ${[esq, dir].map(([papel, nome]) => `
        <div>
          <div style="height:1px;background:${NAVY};margin-bottom:10px;"></div>
          <div style="font-size:9.5px;letter-spacing:0.22em;color:${BRONZE};font-weight:700;margin-bottom:4px;">${papel}</div>
          <div style="font-size:12.5px;font-weight:700;color:${NAVY};line-height:1.4;">${nome}</div>
        </div>`).join('')}
      </div>
    </div>`;

  // Item numerado de cláusula; nivel 0 = "1.", 1 = "1.1.", 2 = "1.1.1." / "a)"
  const item = (num, texto, nivel = 0) => {
    const col = [34, 42, 52][nivel], indent = [0, 34, 76][nivel];
    const col2 = /^[a-z]\)$/.test(num) ? 30 : col;
    return `<div style="display:grid;grid-template-columns:${col2}px minmax(0,1fr);margin:0 0 9px ${indent}px;"><b style="color:${BRONZE};">${num}</b><p style="margin:0;">${texto}</p></div>`;
  };

  // ── SUITABILITY ──
  const PERFIS = [
    { n: '01', nome: 'CONSERVADOR',
      texto: ['Você prioriza a segurança como ponto decisivo para as suas aplicações. O ideal é manter percentual maior da sua carteira de investimentos em produtos de baixo risco, mas você pode investir uma pequena parcela em produtos que ofereçam níveis de riscos diferenciados, com objetivo de atingir ganhos melhores no longo prazo. Apesar de ser caracterizado como conservador poderá investir uma pequena parte de seus recursos em renda variável, mantendo um alto percentual em produtos de renda fixa e alta liquidez. Quando investe em renda variável, deve focar em estratégias de portfólio com ações de primeira linha - mais líquidas, de bom perfil financeiro e boas pagadoras de dividendos – com foco no longo prazo e sem modificar (girar) muito a sua carteira.'],
      produtos: 'Títulos Públicos, Títulos Privados (LCI, LCA, CDB), Fundos de Renda Fixa, Fundos Multimercado Conservadores, Fundos de Ações com foco no Longo Prazo.' },
    { n: '02', nome: 'MODERADO',
      texto: ['Você deseja segurança nos seus investimentos, mas também quer investir em produtos que podem proporcionar ganhos melhores no longo prazo. Seu objetivo principal é obter lucros acima dos padrões de renda fixa disponíveis no mercado com uma exposição moderada aos riscos de renda variável. No seu caso, a segurança tem papel importante assim como um retorno acima da média. É um investidor que já tem certo conhecimento do Mercado de Capitais e por isto procura por oportunidades de diversificação de investimentos um pouco mais sofisticadas. Quando investe em renda variável, pode adotar estratégias de portfólios que combinam ações de primeira e segunda linha com foco no médio e longo prazo; adotando assim um comportamento mais dinâmico quanto ao giro da carteira.'],
      produtos: 'Fundos Multimercado, Fundos Imobiliários, Ações e Fundos de Ações.' },
    { n: '03', nome: 'ARROJADO',
      texto: ['Você busca possibilidade de maiores ganhos e, para isso, aceita correr mais riscos. Você é um investidor que busca a boa rentabilidade ofertada pela renda variável no curto, médio e longo prazos, estando disposto a suportar mais risco na busca de melhores resultados. O investidor arrojado geralmente tem um bom conhecimento de Mercado de Capitais e procura estar sempre atualizado para aproveitar eventuais oportunidades de investimento. Quando investe em renda variável pode possuir como característica um giro alto de sua carteira, com operações de day-trade e, conforme o caso, em derivativos, termo e opção.',
              'Entretanto, mesmo para estratégias mais arrojadas, é necessário manter uma fatia de seus recursos em produtos de baixo risco e alta liquidez, a fim de proteger e dar certa liquidez ao seu patrimônio.'],
      produtos: 'Ações, Derivativos, Mercado Futuro, Fundos de Ações, Fundos Cambiais, Fundos Multimercado Arrojados.' }
  ];

  function suitability(d) {
    const nome = esc((d.nome || '').trim().toUpperCase());
    const data = dataCurta(d.data || new Date());
    const perfil = String(d.perfil || '').toUpperCase();
    const perfilLabel = perfil.charAt(0) + perfil.slice(1).toLowerCase();

    const blocos = [
      capa('RESULTADO DO TESTE', 'Análise do Perfil<br>do Investidor · Suitability', true),
      `<div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr);gap:14px;margin-bottom:22px;text-align:left;">
        ${campo('NOME DO INVESTIDOR', nome)}${campo('CPF', esc(fmtCPF(d.cpf)))}${campo('DATA', data)}
      </div>`,
      secao('OBSERVAÇÃO', 'Resultado da Análise'),
      `<p style="margin:0 0 16px;">O cliente foi avaliado de acordo com os critérios estabelecidos pelo suitability e, em virtude desta análise, informamos que o seu perfil foi enquadrado como:</p>`,
      `<div style="border:1.5px solid ${GOLD};border-radius:8px;padding:20px 24px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:16px;text-align:left;">
        <div style="font-size:9.5px;letter-spacing:0.22em;color:${BRONZE};font-weight:700;">PERFIL DO INVESTIDOR</div>
        <div style="font-family:'Fraunces',serif !important;font-weight:600;font-size:26px;color:${NAVY};line-height:1.1;">${esc(perfilLabel)}</div>
      </div>`,
      secao('PERFIS', 'Descrição dos Perfis'),
      ...PERFIS.map(p => `
        <div style="background:${CREAM};border-radius:8px;padding:18px 20px;margin-bottom:14px;${p.nome === perfil ? `border-left:3px solid ${GOLD};` : ''}">
          <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px;text-align:left;">
            <span style="font-family:'Fraunces',serif !important;font-weight:600;color:${GOLD};">${p.n}</span>
            <span style="font-size:10px;letter-spacing:0.22em;color:${NAVY};font-weight:800;">CLIENTE COM PERFIL ${p.nome}</span>
          </div>
          ${p.texto.map((t, i) => `<p style="margin:0 0 ${i === p.texto.length - 1 ? 12 : 8}px;">${t}</p>`).join('')}
          <div style="border-top:1px solid ${RULE};padding-top:10px;text-align:left;">
            <div style="font-size:9px;letter-spacing:0.22em;color:${BRONZE};font-weight:700;margin-bottom:3px;">PRINCIPAIS PRODUTOS RECOMENDADOS</div>
            <p style="margin:0;font-size:12.5px;color:${NAVY};font-weight:600;">${p.produtos}</p>
          </div>
        </div>`),
      `<div style="margin:12px 0 0;padding-top:14px;border-top:1px solid ${RULE};display:flex;flex-direction:column;gap:10px;">
        <p style="margin:0;">Esta condição de perfil é resultante de uma série de informações repassadas pelo próprio cliente, e o condiciona a investimentos voltados ao seu perfil.</p>
        <p style="margin:0;">Se o seu perfil foi enquadrado a uma condição mais conservadora do que ao investimento ao qual deseja aplicar seus recursos, recomendamos que leia atentamente o “Termo de Ciência de Desenquadramento de Suitability” e o assine, podendo assim, dar continuidade aos seus investimentos.</p>
      </div>`,
      assinaturas(`<strong style="color:${NAVY};">Local e data:</strong> Belo Horizonte, ${data}`,
        ['CLIENTE', nome], ['GESTOR', 'Eduardo Barbosa Horta Dos Santos'])
    ];
    return { titulo: 'ANÁLISE DO PERFIL DO INVESTIDOR · SUITABILITY', blocos };
  }

  // ── CONTRATO DE CONSULTORIA ──
  function contrato(d) {
    const nome = esc(d.nome || '');
    const partes = [esc(d.nacionalidade), esc((d.estadoCivil || '').toLowerCase()), d.rg ? 'RG ' + esc(d.rg) : '', 'CPF ' + esc(fmtCPF(d.cpf))].filter(Boolean).join(', ');

    const blocos = [
      capa('INSTRUMENTO PARTICULAR', 'Contrato de Consultoria<br>de Investimentos', false),
      `<p style="margin:0 0 16px;">Pelo presente instrumento e na melhor forma de direito, as partes:</p>`,
      `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin-bottom:22px;">
        <div style="background:${CREAM};border-radius:8px;padding:16px 18px;">
          <div style="font-size:9.5px;letter-spacing:0.22em;color:${BRONZE};font-weight:700;margin-bottom:8px;text-align:left;">CONTRATANTE</div>
          <p style="margin:0;font-size:12.5px;line-height:1.6;text-align:left;"><strong style="color:${NAVY};">${nome}</strong>, ${partes} e residente ${esc(d.endereco)} (“CONTRATANTE”); e</p>
        </div>
        <div style="background:${CREAM};border-radius:8px;padding:16px 18px;">
          <div style="font-size:9.5px;letter-spacing:0.22em;color:${BRONZE};font-weight:700;margin-bottom:8px;text-align:left;">CONTRATADO</div>
          <p style="margin:0;font-size:12.5px;line-height:1.6;text-align:left;"><strong style="color:${NAVY};">EDUARDO BARBOSA HORTA DOS SANTOS</strong>, pessoa física, inscrito no CPF sob o nº 026.489.996-20, com residência na Rua do Ouro, 1920, apto 502, Bairro Serra, Belo Horizonte MG, CEP 30.210-590 (“CONTRATADO”), considerando que:</p>
        </div>
      </div>`,
      ...[
        ['(I)', 'O CONTRATANTE deseja aplicar seus recursos em uma carteira de títulos, valores mobiliários e ativos financeiros;'],
        ['(II)', 'O CONTRATADO é pessoa natural autorizada pela Comissão de Valores Mobiliários – CVM a prestar serviços de consultoria de valores mobiliários, nos termos do artigo 27 da Lei nº 6.385, de 7 de dezembro de 1976, e da Resolução CVM nº 19, de 25 de fevereiro de 2021, e alterações posteriores; e'],
        ['(III)', 'O CONTRATADO aceita prestar o serviço de consultoria abrangido na presente contratação.']
      ].map(([n, t]) => `<div style="display:grid;grid-template-columns:40px minmax(0,1fr);margin-bottom:10px;"><span style="font-family:'Fraunces',serif !important;font-weight:600;color:${GOLD};">${n}</span><p style="margin:0;">${t}</p></div>`),
      `<p style="margin:8px 0 8px;">Resolvem celebrar o presente Contrato de Consultoria de Investimentos (“CONTRATO”), que se regerá pelas seguintes disposições.</p>`,

      secao('CLÁUSULA 1', 'Objeto'),
      item('1.', 'Constitui objeto deste contrato a prestação de serviço de consultoria de valores mobiliários, compreendido como o estudo de oportunidades de alocação de capital em títulos e valores mobiliários.'),
      item('1.1.', 'Considera-se consultoria de valores mobiliários a prestação dos serviços de orientação, recomendação e aconselhamento, de forma profissional, independente e individualizada, sobre investimentos no mercado de valores mobiliários, cuja adoção e implementação são exclusivas do cliente.', 1),

      secao('CLÁUSULA 2', 'Serviço de Consultoria'),
      item('2.', 'O serviço de consultoria terá as seguintes características:'),
      item('2.1.', 'Com base em material colhido dos dados fornecidos pelo CONTRATANTE, o CONTRATADO disponibilizará relatórios onde constarão os títulos e valores mobiliários que representem oportunidade de investimento para o CONTRATANTE.', 1),
      item('2.2.', 'Otimização de carteiras de investimento, baseada em informações fornecidas pelo CONTRATANTE. As principais informações são, mas não se restringem somente a essas:', 1),
      item('2.2.1.', 'Objetivos de vida financeira, representando futuras realizações de gastos e/ou despesas do CONTRATANTE, detalhadas por valores, datas, moedas de pagamento e número de pagamentos;', 2),
      item('2.2.2.', 'Receitas disponíveis atualmente e futuramente, detalhadas por valores, datas, moedas de pagamento e número de recebimentos;', 2),
      item('2.2.3.', 'Temas de investimentos preferidos, com ponderações entre eles definidas pelo CONTRATANTE;', 2),
      item('2.2.4.', 'Posições de valores mobiliários e títulos financeiros do CONTRATANTE;', 2),
      item('2.2.5.', 'Patrimônios informados pelo CONTRATANTE;', 2),
      item('2.2.6.', 'Perfil de Suitability informado pelo CONTRATANTE.', 2),
      item('2.3.', 'Acompanhamento dos resultados (performance) das alocações, com rebalanceamentos regulares, conforme mudanças dos cenários econômicos, dos objetivos e das receitas do CONTRATANTE, considerando custos de transação e impostos.', 1),
      item('2.4.', 'A adoção da carteira ideal sugerida pelo CONTRATADO é de total responsabilidade do CONTRATANTE.', 1),
      item('2.5.', 'Toda e qualquer execução de ordens de compra e venda possivelmente, mas não exclusivamente, resultantes das recomendações do CONTRATADO será enviada pelo próprio CONTRATANTE.', 1),

      secao('CLÁUSULA 3', 'Remuneração'),
      item('3.', `Em contrapartida à prestação dos serviços descritos neste CONTRATO, o CONTRATANTE pagará ao CONTRATADO: <strong style="color:${NAVY};">${esc(d.remuneracao)}</strong>`),
      item('3.1.', 'Caso o contrato seja rescindido antes do prazo de 6 meses, será devido o pagamento referente ao valor contratado, calculado para 6 meses.', 1),
      item('3.2.', 'Ocorrendo a suspensão da prestação de serviço por qualquer razão, a remuneração relativa àquele serviço será proporcional ao período em que o mesmo foi prestado.', 1),
      item('3.3.', 'Na hipótese de atraso no pagamento, total ou parcial, dos valores devidos pelo CONTRATANTE ao CONTRATADO, serão acrescidos ao valor em atraso juros moratórios de 1% (um por cento) ao mês e correção monetária pelo Índice de Preços ao Consumidor Amplo – IPCA, assim como multa moratória de 2% (dois por cento) sobre a quantia total em atraso.', 1),

      secao('CLÁUSULA 4', 'Declarações, Obrigações e Responsabilidade'),
      item('4.', 'O CONTRATANTE declara possuir inequívoca ciência de que:'),
      item('a)', 'As recomendações oriundas desta prestação de serviço refletirão única e exclusivamente as opiniões de seus autores e serão elaboradas de forma independente;', 1),
      item('b)', 'Este serviço não constitui nem deve ser interpretado como oferta ou solicitação de compra ou venda de qualquer instrumento financeiro, ou de participação em uma determinada estratégia de negócios em qualquer jurisdição;', 1),
      item('c)', 'A decisão final em relação aos investimentos deve ser tomada pelo próprio CONTRATANTE, levando em consideração todos os riscos e custos incidentes;', 1),
      item('d)', 'Os desempenhos anteriores não são, necessariamente, indicativos de resultados futuros e nenhuma declaração ou garantia, de forma expressa ou implícita, é feita em relação a desempenhos futuros;', 1),
      item('e)', 'O CONTRATANTE é o único responsável pelas decisões de investimento ou de abstenção de investimento que tomar em decorrência da prestação do serviço objeto deste Contrato.', 1),
      item('4.1.', 'O CONTRATANTE declara, sob as penas da lei, que todos os dados enviados ao CONTRATADO através do cadastro para assinatura deste Contrato ou de quaisquer outros meios são verdadeiros.', 1),
      item('4.2.', 'Cada parte obriga-se a manter sigilo a respeito de qualquer informação confidencial de titularidade da outra parte que venha a receber em decorrência da prestação de serviços realizada no âmbito deste contrato, a saber:', 1),
      item('4.2.1.', '"Informação Confidencial" inclui todas as informações identificadas por legendas como sendo privadas ou confidenciais, ou identificadas oralmente pela parte informante como privadas ou confidenciais e confirmadas por escrito dentro de 30 (trinta) dias da comunicação;', 2),
      item('4.2.2.', 'Também são consideradas informações confidenciais, para todos os efeitos do presente contrato, as informações assim definidas pela legislação relacionadas às atividades do CONTRATADO e aquelas constantes de documentos referentes à carteira de investimentos do CONTRATANTE, especialmente quando demonstrarem a composição da referida carteira ou os objetivos ou planos de investimento do CONTRATANTE.', 2),
      item('4.3.', 'Para a execução dos serviços contratados, as informações confidenciais poderão ser disponibilizadas a empregados, prepostos, consultores ou pesquisadores das partes, respondendo cada parte perante a outra pelos atos destas pessoas no que tange ao dever de sigilo.', 1),
      item('4.4.', 'Não serão consideradas como informações confidenciais aquelas:', 1),
      item('4.4.1.', 'Já disponíveis ao público sem quebra deste contrato;', 2),
      item('4.4.2.', 'Já comprovadamente conhecidas do recebedor no momento da divulgação, ou que, por ordem judicial ou de autoridade competente, devam ser divulgadas, hipótese na qual a parte a quem for dirigida a ordem deve comunicar, imediatamente, à outra parte sobre a existência da determinação e as informações a ela relacionadas.', 2),
      item('4.5.', 'São obrigações do CONTRATANTE:', 1),
      item('4.5.1.', 'Fornecer ao CONTRATADO as informações necessárias à realização das análises e confecção dos relatórios.', 2),
      item('4.6.', 'São obrigações do CONTRATADO:', 1),
      item('4.6.1.', 'Manter os padrões de qualidade e metodologia especificados, informando previamente qualquer alteração que deva ser introduzida por razão de ordem técnica de mercado ou derivada de nova regulamentação do setor;', 2),
      item('4.6.2.', 'Utilizar sistemas de comunicação e processamento de informações seguros, que preservem a confidencialidade das informações individuais recebidas e processadas, com base em padrões normalmente aceitos no mercado ou pelas partes;', 2),
      item('4.6.3.', 'Suspender a prestação de serviços que estejam comprometidos ou que, em sua opinião, possam vir a ser comprometidos por problemas ou falhas até que tais falhas ou problemas sejam sanados;', 2),
      item('4.6.4.', 'Suspender definitivamente, e a qualquer tempo, quaisquer dos serviços que sejam comprometidos por falhas ou problemas ou que possam vir a ser comprometidos por problemas ou falhas quando tais falhas ou problemas não possam ser sanados;', 2),
      item('4.6.5.', 'Iniciar imediatamente os estudos e procedimentos visando contornar qualquer problema detectado na prestação dos serviços;', 2),
      item('4.6.6.', 'Utilizar metodologias e critérios baseados em séries de desempenho histórico dos ativos e/ou das instituições analisadas.', 2),
      item('4.7.', 'Os direitos e obrigações decorrentes deste contrato não poderão ser cedidos por qualquer das partes sem a autorização prévia e expressa da outra.', 1),
      item('4.8.', 'Se qualquer das partes, em benefício da outra, permitir, mesmo por omissão, a inobservância, de todo ou em parte, de qualquer das cláusulas e condições deste contrato, tal fato não poderá ser considerado novação nem liberará, desonerará ou, de qualquer forma, afetará ou prejudicará essas mesmas cláusulas e condições, as quais permanecerão inalteradas, como se nenhuma tolerância houvesse ocorrido.', 1),

      secao('CLÁUSULA 5', 'Garantias'),
      item('5.', 'O CONTRATADO garante que buscará, em regime de melhor esforço, na execução dos serviços contratados, fornecer informações ao CONTRATANTE que o auxiliem na gestão de risco e na administração de carteiras de investimentos, próprias ou terceirizadas, a fim de que o CONTRATANTE avalie o desempenho de tais carteiras e, se possível, otimize o desempenho de seus investimentos.'),
      item('5.1.', 'Para tanto, o CONTRATADO garante que as metodologias e critérios utilizados na prestação dos serviços atendam aos requisitos regulamentares e técnicos usualmente utilizados no mercado e recomendados pelos órgãos oficiais competentes.', 1),
      item('5.2.', 'O CONTRATADO não garante a obtenção de resultados positivos ou vantagens esperadas pelo CONTRATANTE em decorrência da contratação dos serviços.', 1),
      item('5.3.', 'Tendo em vista que as metodologias e critérios adotados pelo CONTRATADO são baseados em séries de desempenho histórico dos ativos e/ou das instituições analisadas, os produtos e serviços, inclusive os relatórios que forem fornecidos pelo CONTRATADO não poderão ser utilizados ou entendidos pelo CONTRATANTE como garantia do comportamento futuro ou de desempenho dos ativos e/ou instituições analisadas.', 1),
      item('5.4.', 'O CONTRATADO deverá manter os dados dos produtos da carteira de investimento do CONTRATANTE pelo período de 5 anos objetivando assegurar a alta qualidade e confiabilidade dos serviços prestados.', 1),
      item('5.5.', 'O CONTRATADO não se responsabiliza, em nenhuma hipótese, por danos decorrentes de casos fortuitos ou eventos de força maior.', 1),
      item('5.6.', 'O CONTRATANTE se declara ciente de que nenhum índice, coeficiente ou produto do processamento gerado pelo CONTRATADO, inclusive os relatórios que lhe forem fornecidos, poderá ser considerado como garantia do comportamento futuro dos ativos ou instituições analisadas.', 1),
      item('5.7.', 'As decisões acerca dos investimentos são de única e exclusiva responsabilidade do CONTRATANTE, tenham estas decisões sido ou não tomadas com base em informações obtidas por meio do CONTRATADO.', 1),

      secao('CLÁUSULA 6', 'Vigência e Disposições Gerais'),
      item('6.', 'Este Contrato supera todas as discussões, acordos e entendimentos pretéritos havidos entre as partes envolvendo as matérias nele reguladas e vigorará por prazo indeterminado, contado da data de assinatura do presente instrumento.'),
      item('6.1.', 'Qualquer das partes pode resilir este Contrato, a qualquer tempo, mediante comunicação escrita à outra com antecedência mínima de 30 (trinta) dias. As Partes ficam obrigadas a cumprir suas respectivas obrigações contratuais até o término do Contrato.', 1),
      item('6.2.', 'A extinção do contrato não significará a extinção das obrigações e direitos eventualmente pendentes ou gerados em virtude da própria extinção.', 1),
      item('6.3.', 'A invalidação ou nulidade, no todo ou em parte, de qualquer das cláusulas ou itens deste Contrato não afetará os demais, que permanecerão sempre válidos e eficazes durante o prazo de vigência deste Contrato. Ocorrendo a declaração de invalidade ou nulidade de qualquer cláusula ou item deste Contrato, as partes, desde já, se comprometem a negociar, no menor prazo possível, em substituição à cláusula ou item declarado inválido ou nulo, a inclusão, neste Contrato, de termos e condições que reflitam os termos e condições da cláusula ou item invalidado ou nulo, observada a intenção e objetivo das partes quando da negociação da cláusula ou item invalidado ou nulo e o contexto em que se insere.', 1),
      item('6.4.', 'Em qualquer hipótese de encerramento da prestação dos serviços, inclusive quando pelo normal decurso do prazo contratado, permanecerão válidas e vinculantes as obrigações de confidencialidade, as garantias e responsabilidades assumidas pelas partes e outras obrigações que, em decorrência de sua própria natureza, tenham caráter permanente.', 1),
      item('6.5.', 'Além dos serviços oferecidos explicitamente neste contrato, o CONTRATADO não é responsável por qualquer obrigação legal do CONTRATANTE como, por exemplo, pagamentos de impostos, tributos ou taxas de serviços de terceiros decorrentes da prestação de serviços objeto deste instrumento contratual.', 1),
      item('6.6.', 'O CONTRATADO não se responsabiliza por atrasos, interrupções, erros, falhas, danos ou prejuízos na prestação dos serviços oriundos do não recebimento, do recebimento em atraso ou do recebimento com falhas ou defeitos de conteúdo das informações fornecidas pelo CONTRATANTE, ainda que a responsabilidade pelo encaminhamento das informações do CONTRATANTE ao CONTRATADO tenha sido transferida a terceiros.', 1),
      item('6.7.', 'Fica eleito o foro de Belo Horizonte/MG, em detrimento de qualquer outro por mais privilegiado que possa ser, para dirimir quaisquer dúvidas oriundas deste contrato.', 1),

      assinaturas(`Belo Horizonte, ${dataExtenso(d.data || new Date())}.`,
        ['CONTRATADO', 'EDUARDO BARBOSA HORTA DOS SANTOS'], ['CONTRATANTE', nome])
    ];
    return { titulo: 'CONTRATO DE CONSULTORIA DE INVESTIMENTOS', blocos };
  }

  const MODELOS = { suitability, contrato };

  // ── Paginação: distribui os blocos em páginas A4 de altura fixa ──
  function novaPagina(host, titulo) {
    const page = document.createElement('div');
    page.style.cssText = `width:${PAGE_W}px;height:${PAGE_H}px;padding:${MARGIN * 0.6}px ${MARGIN}px;box-sizing:border-box;background:#fff;display:flex;flex-direction:column;overflow:hidden;font-family:'Manrope',sans-serif;color:${TEXT};`;
    page.innerHTML = `<div>${header(titulo)}</div>
      <div data-body style="flex:1;min-height:0;overflow:hidden;padding:18px 0 12px;font-size:13px;line-height:1.66;text-align:justify;"></div>
      <div data-footer></div>`;
    host.appendChild(page);
    return page;
  }

  function paginar(host, doc) {
    const paginas = [];
    let page = novaPagina(host, doc.titulo), body = page.querySelector('[data-body]');
    paginas.push(page);
    const tpl = document.createElement('template');
    const cabe = () => body.scrollHeight <= body.clientHeight;

    for (const html of doc.blocos) {
      tpl.innerHTML = html.trim();
      const el = tpl.content.firstElementChild;
      body.appendChild(el);
      if (cabe() || body.children.length === 1) continue;
      // Não deixa título de seção sozinho no fim da página
      const mover = [el];
      const anterior = el.previousElementSibling;
      if (anterior && anterior.hasAttribute('data-keep') && body.children.length > 2) mover.unshift(anterior);
      page = novaPagina(host, doc.titulo);
      body = page.querySelector('[data-body]');
      paginas.push(page);
      mover.forEach(m => body.appendChild(m));
    }
    paginas.forEach((p, i) => { p.querySelector('[data-footer]').innerHTML = footer(i + 1, paginas.length); });
    return paginas;
  }

  async function esperarImagens(root) {
    await Promise.all(Array.from(root.querySelectorAll('img')).map(img =>
      img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
  }

  async function gerarPdf(tipo, dados) {
    if (!window.jspdf || !window.html2canvas) throw new Error('Bibliotecas de PDF não carregadas.');
    const modelo = MODELOS[tipo];
    if (!modelo) throw new Error('Documento desconhecido: ' + tipo);

    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-10000px;top:0;';
    document.body.appendChild(host);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const paginas = paginar(host, modelo(dados));
      await esperarImagens(host);

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
      for (let i = 0; i < paginas.length; i++) {
        const canvas = await window.html2canvas(paginas[i], {
          scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
          width: PAGE_W, height: PAGE_H, windowWidth: PAGE_W
        });
        if (i > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.82), 'JPEG', 0, 0, 210, 297);
      }
      return pdf;
    } finally {
      host.remove();
    }
  }

  window.EHDocs = {
    async pdfBase64(tipo, dados) {
      const pdf = await gerarPdf(tipo, dados);
      return pdf.output('datauristring').split(',')[1];
    },
    async abrirPdf(tipo, dados) {
      // Abre a aba antes do await para não ser bloqueada como pop-up
      const aba = window.open('', '_blank');
      try {
        const pdf = await gerarPdf(tipo, dados);
        const url = URL.createObjectURL(pdf.output('blob'));
        if (aba) aba.location.href = url; else window.location.href = url;
      } catch (e) {
        if (aba) aba.close();
        throw e;
      }
    },
    fmtCPF
  };
})();
