/* Extratos → Movimentações (versão nova do Extratos → Excel), em eh-cliente-dashboard.html.
 *
 * Lê os mesmos PDFs e usa os mesmos leitores e a mesma Tabela de Produtos do Extratos → Excel,
 * mas gera UMA tabela longa, no formato da aba "Movimentações" da nova Base EH:
 * uma linha por lançamento, com banco, nome do cliente no extrato, código do produto,
 * valor bruto e líquido, saldo, arquivo de origem e um ID.
 *
 * O ID é calculado do banco, nome, data original, histórico, valor líquido e saldo do lançamento
 * (mais um contador para linhas idênticas no mesmo extrato). A macro ImportarMovimentacoes
 * (tarefas-mensais/excel/ImportarMovimentacoes.bas) pula os IDs que já estão na base, então
 * importar o mesmo extrato duas vezes não duplica nada.
 *
 * A coluna Cliente sai vazia: a macro preenche pelo Mapa da base (nome no extrato → aba/código),
 * para que nenhum código de cliente precise ficar no site ou no repositório (que é público).
 *
 * Usa do dashboard (não apagar quando o Extratos → Excel antigo sair do menu): extExtractText,
 * extParseXP, xpnParse, xpnGetSheetName, extGetSheetName, extClassifyTipoXP, extLookupCNPJ,
 * xpnLookupCNPJ, extParseEQI, extRecuarUltimoDiaUtil, extLogBox (destino do log dos leitores),
 * DEFAULT_MAPPING_XP, DEFAULT_MAPPING_EQI, sb e XLSX (SheetJS).
 */
(function () {
  // Banco → leitor (layout do PDF) e Tabela de Produtos usada.
  // BTG usa o mesmo extrato da EQI; Monte Bravo é plataforma XP (layout XP).
  const BANCOS = {
    'XP':          { layout: 'XP',  tabela: 'cnpj_mapping_xp',  padrao: () => DEFAULT_MAPPING_XP,  sub: 'Extrato de Conta Depósito' },
    'EQI':         { layout: 'EQI', tabela: 'cnpj_mapping_eqi', padrao: () => DEFAULT_MAPPING_EQI, sub: 'Extrato da Conta Investimento' },
    'BTG':         { layout: 'EQI', tabela: 'cnpj_mapping_eqi', padrao: () => DEFAULT_MAPPING_EQI, sub: 'Extrato da Conta Investimento' },
    'MONTE BRAVO': { layout: 'XP',  tabela: 'cnpj_mapping_xp',  padrao: () => DEFAULT_MAPPING_XP,  sub: 'Layout XP' },
  };
  // Tipos de lançamento que precisam de código de produto (os outros são caixa: TED, PIX, IR...)
  const TIPOS_COM_PRODUTO = new Set(['Resgate', 'Integralização', 'Rendimento', 'Amortização', 'Juros',
    'Juros CRA/CRI', 'Amortização CRI/CRA', 'Vencimento CRA/CRI', 'Compra']);
  const CABECALHO = ['Data', 'Data Liq.', 'Cliente', 'Nome no extrato', 'Banco', 'Código', 'Histórico', 'Tipo',
    'Valor (R$)', 'Valor Líquido (R$)', 'Saldo (R$)', 'Data original', 'Arquivo', 'ID', 'Conferir', 'Alerta'];

  // Lançamentos de caixa que os leitores deixam como "Outro" mas não precisam de conferência
  const CAIXA = [
    [/TRANSFER[ÊE]NCIA|\bPIX\b|\bTED\b|DEP[ÓO]SITO EM C|D[ÉE]BITO EM C\s*\/\s*C|RETIRADA|ENVIO TRANSF|RECEBIMENTO TRANSF|CREDITO XP/i, 'Transferência'],
    [/LIQ BOLSA \(TAXA|TAXA DE (INTERMEDIA|CUST)|FEE FIXO|TAXA SOBRE/i, 'Taxa'],
    [/LIQ CAMBIO|S\s*\/\s*CAMBIO/i, 'Câmbio'],
    [/CHAMADA DE MARGEM|OPERA[ÇC][ÕO]ES EM BOLSA|LIQ BOLSA|\bBTC\b/i, 'Bolsa'],
  ];
  // Os quatro tipos de alerta (a ordem é a da lista)
  const ALERTAS = {
    linha:  'Linha não reconhecida',
    codigo: 'Código fora da Tabela de Produtos',
    bruto:  'Valor pode ser o líquido',
    cra:    'Juros/amortização previstos que não vieram',
  };

  const S = { arquivos: {}, linhas: [], tabelas: {}, ocupado: false };  // arquivos: banco → [File]
  window.MOV = S;  // para inspecionar no console

  const $ = id => document.getElementById(id);
  const nomeBanco = b => b === 'MONTE BRAVO' ? 'Monte Bravo' : b;
  const idBanco = b => b.replace(/\s+/g, '');
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const brl = n => (n < 0 ? '-' : '') + 'R$ ' + Math.abs(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dataSerial = s => {  // "dd/mm/aaaa" → número de série do Excel (data de verdade na planilha)
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || '');
    return m ? (Date.UTC(+m[3], +m[2] - 1, +m[1]) - Date.UTC(1899, 11, 30)) / 86400000 : null;
  };
  // Hash de 64 bits (dois FNV-1a de 32) em base 36: curto e estável
  function hash(txt) {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < txt.length; i++) {
      const c = txt.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; b ^= b >>> 15;
    }
    return a.toString(36).padStart(7, '0') + (b >>> 0).toString(36).padStart(7, '0');
  }

  function log(msg, tipo) { extLog(msg, tipo || ''); }

  // ── Tabela de Produtos (a mesma do Extratos → Excel, lida direto do Supabase) ──
  async function tabela(banco) {
    const cfg = BANCOS[banco];
    if (S.tabelas[cfg.tabela]) return S.tabelas[cfg.tabela];
    let rows = null;
    try {
      const { data, error } = await sb.from(cfg.tabela).select('key,cnpj,full_name').order('key');
      if (error) throw error;
      if (data && data.length) rows = data.map(r => ({ key: r.key, cnpj: r.cnpj || '', full: r.full_name || '' }));
    } catch (e) { console.warn('Tabela de Produtos:', e.message); }
    if (!rows) { rows = cfg.padrao(); log('Tabela de Produtos salva não encontrada: usando a padrão', 'warn'); }
    return (S.tabelas[cfg.tabela] = rows);
  }

  // ── Arquivos: uma caixinha por banco ──
  function definirArquivos(banco, files) {
    S.arquivos[banco] = files;
    renderLista(banco);
    const total = Object.values(S.arquivos).reduce((n, l) => n + l.length, 0);
    $('movBtnProcessar').disabled = !total;
    $('movBtnLabel').textContent = total > 1 ? `Processar ${total} extratos` : 'Processar extrato';
    limparResultado();
  }
  function renderLista(banco) {
    const lista = S.arquivos[banco] || [];
    $('movLista' + idBanco(banco)).innerHTML = lista.map((f, i) => `
      <div class="file-item-ext">
        <span class="file-item-ext-name">${esc(f.name)}</span>
        <span class="file-item-ext-status file-status-wait" id="movArq${idBanco(banco)}_${i}">aguardando</span>
        <button title="Tirar" onclick="movTirar('${banco}',${i})" style="background:none;border:none;color:#e05555;cursor:pointer;font-size:0.9rem;padding:0 0.2rem;">✕</button>
      </div>`).join('');
    $('movConta' + idBanco(banco)).textContent = lista.length ? `${lista.length} PDF${lista.length > 1 ? 's' : ''}` : '';
  }
  function tirar(banco, i) {
    const lista = [...(S.arquivos[banco] || [])]; lista.splice(i, 1);
    definirArquivos(banco, lista);
  }
  function statusArquivo(banco, i, txt, cls) { const el = $(`movArq${idBanco(banco)}_${i}`); if (el) { el.textContent = txt; el.className = 'file-item-ext-status ' + (cls || ''); } }

  function limparResultado() {
    S.linhas = [];
    $('movPreview').classList.remove('visible');
    $('movStatusBox').classList.remove('visible');
    $('movStatusBox').innerHTML = '';
  }

  // ── Leitura de um PDF → lançamentos no formato da tabela ──
  function lerXP(text, nomeArq, mapa) {
    const antigos = extParseXP(text), novos = xpnParse(text);
    const novo = novos.length > antigos.length;
    const nome = novo ? xpnGetSheetName(text, nomeArq) : extGetSheetName(text, nomeArq);
    if (novo) log('Layout novo da XP detectado', 'ok');
    const rows = (novo ? novos : antigos).map(r => {
      const tipo = extClassifyTipoXP(r.historico);
      const cnpj = ['IOF', 'IRRF'].includes(tipo) ? '—' : (novo ? xpnLookupCNPJ : extLookupCNPJ)(r.historico, mapa);
      return { ...r, tipo, cnpj, isGross: true, needsGross: false };
    });
    return { nome, rows };
  }
  function lerEQI(text, nomeArq, mapa) {
    return { nome: extGetSheetName(text, nomeArq), rows: extParseEQI(text, mapa) };
  }

  function paraLinhas(banco, nome, rows, arquivo) {
    const vistos = {};
    return rows.map(r => {
      const liq = r.valorLiq !== undefined ? r.valorLiq : r.valor;
      const original = r.recuado || r.dataMov;
      const base = [banco, nome.toUpperCase(), original, (r.historico || '').toUpperCase(), (liq || 0).toFixed(2), (r.saldo || 0).toFixed(2)].join('|');
      vistos[base] = (vistos[base] || 0) + 1;
      const codigo = r.cnpj && r.cnpj !== '—' ? r.cnpj : '';
      let tipo = r.tipo;
      if (tipo === 'Outro') {
        if (/^IR\b|IRRF/i.test(r.historico)) tipo = 'IRRF';
        else if (/^IOF\b/i.test(r.historico)) tipo = 'IOF';
        else if (/INVESTBACK/i.test(r.historico)) tipo = 'Investback';
        else if (/^VENCIMENTO\b/i.test(r.historico)) tipo = 'Vencimento';
        else { const c = CAIXA.find(([re]) => re.test(r.historico || '')); if (c) tipo = c[1]; }
      }
      return {
        data: r.dataMov, dataLiq: r.dataLiq || r.dataMov, nome, banco, codigo,
        historico: r.historico, tipo, tipoLeitor: r.tipo, valor: r.valor, valorLiq: liq, saldo: r.saldo ?? 0,
        dataOriginal: r.recuado || '', arquivo,
        id: hash(base + '#' + vistos[base]),
        semCodigo: !codigo && (TIPOS_COM_PRODUTO.has(tipo) || tipo === 'Vencimento'),
        semBruto: !!(r.needsGross && !r.isGross),
      };
    });
  }

  // ── Alertas ──
  // Cada linha ganha l.alertas = [{ tipo, texto }]; os alertas sem linha (juros previstos
  // que não vieram) ficam em S.alertasSoltos.
  const normCod = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^DEB/, '');
  const ehCnpj = c => /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(c || '');
  const ehJuros = l => /JUROS|CUPOM|PGTO/i.test(l.tipo + ' ' + l.historico) && !/IRRF|^IR\b/i.test(l.historico);
  const ehAmort = l => /AMORTIZ|VENCIMENTO/i.test(l.tipo + ' ' + l.historico) && !/IRRF|^IR\b/i.test(l.historico);
  const serialDe = d => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;
  const fmtSerial = n => { const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return extDataFmt(d); };

  const SEM_AVISO = /^(IRRF|IR|IOF|Investback|Come-Cotas)$/;
  function alertar(l, tipo, texto) { (l.alertas = l.alertas || []).push({ tipo, texto }); }

  function alertasDasLinhas(L) {
    L.forEach(l => { l.alertas = []; });
    // IR do mesmo dia, para saber se um resgate de fundo na XP veio bruto
    const irNoDia = new Set(L.filter(l => l.tipo === 'IRRF' || /^IR\b|IRRF/i.test(l.historico)).map(l => `${l.banco}|${l.nome}|${l.data}`));
    L.forEach(l => {
      // Investback, IR e IOF nunca entram nos avisos (Elisa, 25/11/2026)
      if (SEM_AVISO.test(l.tipo) || /INVESTBACK/i.test(l.historico)) return;
      if (l.tipo === 'Outro') alertar(l, 'linha', 'O leitor não reconheceu o tipo deste lançamento');
      if (l.semCodigo) alertar(l, 'codigo', 'Produto sem código: cadastre o trecho do nome na Tabela de Produtos');
      if (l.brutoConferido) return;
      if (l.semBruto) alertar(l, 'bruto', 'Não achei o valor bruto na seção do fundo: o valor é o líquido do extrato (se o pagamento é do fim do mês anterior, o bruto está no extrato daquele mês)');
      else if (BANCOS[l.banco].layout === 'EQI' && /Resgate|Amortiza/.test(l.tipo) && l.valor > 0 && l.valorLiq > 0 && l.valor + 0.005 < l.valorLiq)
        alertar(l, 'bruto', 'Valor bruto menor que o líquido num resgate/amortização');
      else if (BANCOS[l.banco].layout === 'XP' && l.tipo === 'Resgate' && l.valor > 0 && ehCnpj(l.codigo) && !irNoDia.has(`${l.banco}|${l.nome}|${l.data}`))
        alertar(l, 'bruto', 'Resgate de fundo sem IR no mesmo dia: confira se o valor é o bruto');
    });
  }

  // Juros e amortizações do cra_eventos (tarefa mensal) que não apareceram nos extratos.
  // Sem a base, a lista de quem tem cada papel vem dos próprios extratos: avisa quando
  // nenhum extrato trouxe o evento, ou quando o cliente teve outro lançamento do papel no
  // mês mas não o juros/amortização previsto.
  async function alertasCra(L) {
    S.alertasSoltos = []; S.craInfo = '';
    const porMes = {};
    L.forEach(l => { const m = /^\d{2}\/(\d{2})\/(\d{4})$/.exec(l.data); if (m) { const k = `${m[2]}-${m[1]}`; porMes[k] = (porMes[k] || 0) + 1; } });
    const mes = Object.keys(porMes).sort((a, b) => porMes[b] - porMes[a])[0];
    if (!mes) return;
    const caminho = `${mes}/Juros e Amortizacoes ${mes}.xlsx`;
    let eventos;
    try {
      const { data, error } = await sb.storage.from(TM_BUCKET).download(caminho);
      if (error || !data) throw new Error('não encontrado');
      const wb = XLSX.read(await data.arrayBuffer(), { type: 'array', cellDates: true });
      const ws = wb.Sheets['Eventos'];
      if (!ws) throw new Error('sem aba Eventos');
      eventos = XLSX.utils.sheet_to_json(ws, { defval: '' })
        .filter(e => e.codigo && e.data_evento instanceof Date && /Juros|Amortiza|Vencimento/i.test(e.evento) && Number(e.valor) !== 0);
    } catch (e) {
      S.craInfo = `Não achei o resultado do cra_eventos de ${mes} nas Tarefas Mensais (${caminho}). Rode a tarefa para conferir os juros previstos.`;
      log(S.craInfo, 'warn');
      return;
    }
    // Lançamentos por papel (código normalizado)
    const porCod = new Map();
    L.forEach(l => { const k = normCod(l.codigo); if (!k) return; if (!porCod.has(k)) porCod.set(k, []); porCod.get(k).push(l); });
    const perto = (l, alvo) => {
      const ds = [dataSerial(l.data), l.dataOriginal ? dataSerial(l.dataOriginal) : null].filter(x => x != null);
      return ds.some(d => Math.abs(d - alvo) <= 5);
    };
    let n = 0;
    eventos.forEach(e => {
      const k = normCod(e.codigo), alvo = serialDe(e.data_evento);
      const juros = /Juros/i.test(e.evento), quer = juros ? ehJuros : ehAmort;
      const linhas = porCod.get(k) || [];
      const base = { codigo: e.codigo, data: fmtSerial(alvo), evento: e.evento, valorUnit: Number(e.valor) };
      if (!linhas.some(l => quer(l) && perto(l, alvo))) {
        S.alertasSoltos.push({ ...base, tipo: 'cra', nome: '', banco: '',
          texto: `Pagamento de ${e.evento.toLowerCase()} previsto em ${base.data} (cra_eventos) e nenhum extrato trouxe${linhas.length ? '; o papel aparece em outros lançamentos do mês' : ''}` });
        n++; return;
      }
      // Clientes com o papel no mês, mas sem o evento
      const clientes = new Map();
      linhas.forEach(l => { const c = `${l.banco}|${l.nome}`; if (!clientes.has(c)) clientes.set(c, []); clientes.get(c).push(l); });
      clientes.forEach((ls, c) => {
        if (ls.some(l => quer(l) && perto(l, alvo))) return;
        const [banco, nome] = c.split('|');
        S.alertasSoltos.push({ ...base, tipo: 'cra', nome, banco,
          texto: `Pagamento de ${e.evento.toLowerCase()} previsto em ${base.data} (cra_eventos): o cliente tem lançamentos do papel no mês, mas não este` });
        n++;
      });
    });
    S.craInfo = `cra_eventos de ${mes}: ${eventos.length} eventos conferidos, ${n} sem lançamento.`;
    log(S.craInfo, n ? 'warn' : 'ok');
  }

  async function processar() {
    if (S.ocupado || !Object.values(S.arquivos).some(l => l.length)) return;
    S.ocupado = true; S.linhas = []; S.alertasSoltos = []; S.craInfo = '';
    const box = $('movStatusBox');
    box.innerHTML = ''; box.classList.add('visible');
    $('movPreview').classList.remove('visible');
    $('movBtnProcessar').disabled = true;
    const anterior = extLogBox; extLogBox = 'movStatusBox';  // os leitores escrevem o log aqui
    try {
      const recuar = $('movRecuarUltimoDU').checked;
      for (const banco of Object.keys(BANCOS)) {
        const lista = S.arquivos[banco] || [];
        if (!lista.length) continue;
        const cfg = BANCOS[banco];
        log(`══ ${nomeBanco(banco)} (${lista.length} PDF${lista.length > 1 ? 's' : ''})`, 'head');
        const mapa = await tabela(banco);
        for (let i = 0; i < lista.length; i++) {
          const f = lista[i];
          log(`── ${f.name}`, 'head'); statusArquivo(banco, i, 'processando...');
          try {
            const text = await extExtractText(f);
            let { nome, rows } = cfg.layout === 'XP' ? lerXP(text, f.name, mapa) : lerEQI(text, f.name, mapa);
            if (!rows.length) { log('Nenhum lançamento encontrado: confira se o PDF está na caixinha do banco certo', 'err'); statusArquivo(banco, i, 'erro', 'file-status-err'); continue; }
            if (recuar) {
              const rec = extRecuarUltimoDiaUtil(rows);
              if (rec.n) { rows = rec.rows; log(`${rec.n} lançamento(s) de juros/amortização do último dia útil recuado(s) 1 dia útil`, 'ok'); }
            }
            const linhas = paraLinhas(banco, nome, rows, f.name);
            S.linhas.push(...linhas);
            log(`Cliente: "${nome}" · ${linhas.length} lançamentos`, 'ok');
            statusArquivo(banco, i, `✓ ${linhas.length} lançamentos`, 'file-status-ok');
          } catch (e) {
            log('Erro: ' + e.message, 'err'); console.error(e); statusArquivo(banco, i, 'erro', 'file-status-err');
          }
        }
      }
      if (S.linhas.length) {
        alertasDasLinhas(S.linhas);
        await alertasCra(S.linhas);
        mostrarPreview();
      }
    } finally {
      extLogBox = anterior; S.ocupado = false; $('movBtnProcessar').disabled = false;
    }
  }

  // ── Prévia ──
  function todosAlertas() {
    const lista = [];
    S.linhas.forEach(l => (l.alertas || []).forEach(a => lista.push({ ...a, nome: l.nome, banco: l.banco, data: l.data,
      codigo: l.codigo, historico: l.historico, valor: l.valor, id: l.id })));
    (S.alertasSoltos || []).forEach(a => lista.push({ ...a, historico: '', valor: '', id: '' }));
    const ordem = Object.keys(ALERTAS);
    return lista.sort((x, y) => ordem.indexOf(x.tipo) - ordem.indexOf(y.tipo) || x.nome.localeCompare(y.nome) || dataSerial(x.data) - dataSerial(y.data));
  }

  // ── Correção manual do código, antes de gerar o Excel ──
  // Um item por histórico sem código (por Tabela de Produtos): o código digitado vale para todas
  // as linhas cujo histórico contém o trecho, e pode ser salvo na Tabela de Produtos para os
  // próximos meses.
  const tirarPrefixo = h => String(h || '').replace(/^\s*\*\s*PROV\s*\*\s*/i, '').trim();
  function gruposSemCodigo() {
    const g = new Map();
    S.linhas.filter(l => l.semCodigo && !SEM_AVISO.test(l.tipo)).forEach(l => {
      const tab = BANCOS[l.banco].tabela, k = tab + '|' + tirarPrefixo(l.historico).toUpperCase();
      if (!g.has(k)) g.set(k, { tab, historico: tirarPrefixo(l.historico), bancos: new Set(), n: 0, clientes: new Set() });
      const x = g.get(k); x.n++; x.bancos.add(nomeBanco(l.banco)); x.clientes.add(l.nome);
    });
    S.grupos = [...g.values()].sort((a, b) => b.n - a.n);
    return S.grupos;
  }
  function blocoCorrecao() {
    const G = gruposSemCodigo();
    if (!G.length) return '';
    const inp = 'style="width:100%;background:transparent;border:1px solid var(--rule-strong);color:var(--cream);font-family:inherit;padding:0.35rem 0.5rem;font-size:0.75rem;"';
    return `
      <details open style="margin-top:0.9rem;"><summary style="cursor:pointer;font-size:0.8rem;">Corrigir códigos aqui (${G.length} produto${G.length > 1 ? 's' : ''})</summary>
        <p style="font-size:0.72rem;color:var(--gray);margin:0.5rem 0;line-height:1.6;">Digite o CNPJ ou código e clique em Aplicar: vale para todas as linhas sem código cujo histórico contém o trecho (IR e IOF continuam sem código, como hoje). Com "Salvar" marcado, o trecho também entra na Tabela de Produtos e os próximos extratos já saem com o código.</p>
        <div class="ext-preview-wrap"><table class="ext-preview-table">
          <thead><tr><th style="min-width:320px;">Trecho do histórico</th><th>Banco</th><th>Linhas</th><th style="min-width:170px;">CNPJ / código</th><th>Salvar</th><th></th></tr></thead>
          <tbody>${G.map((x, i) => `<tr>
            <td><input id="movTrecho${i}" value="${esc(x.historico)}" ${inp} title="Pode encurtar: basta um pedaço do nome que só este produto tem" /></td>
            <td>${esc([...x.bancos].join(', '))}</td><td>${x.n} <span style="color:var(--gray)">(${x.clientes.size} cliente${x.clientes.size > 1 ? 's' : ''})</span></td>
            <td><input id="movCod${i}" placeholder="00.000.000/0000-00" ${inp} onkeydown="if(event.key==='Enter')movCorrigir(${i})" /></td>
            <td style="text-align:center;"><input type="checkbox" id="movSalvar${i}" checked style="accent-color:var(--gold);" /></td>
            <td><button class="btn-upload" onclick="movCorrigir(${i})" style="font-size:0.62rem;padding:0.35rem 0.7rem;">Aplicar</button></td></tr>`).join('')}</tbody>
        </table></div>
      </details>`;
  }
  async function corrigir(i) {
    const x = (S.grupos || [])[i]; if (!x) return;
    const trecho = $('movTrecho' + i).value.trim(), codigo = $('movCod' + i).value.trim(), salvar = $('movSalvar' + i).checked;
    if (!trecho || !codigo) { alert('Preencha o trecho e o CNPJ/código.'); return; }
    const T = trecho.toUpperCase();
    let n = 0;
    S.linhas.forEach(l => {
      if (!l.semCodigo || BANCOS[l.banco].tabela !== x.tab || !(l.historico || '').toUpperCase().includes(T)) return;
      l.codigo = codigo; l.semCodigo = false; l.corrigido = true; n++;
    });
    if (!n) { alert('Nenhuma linha sem código tem esse trecho no histórico.'); return; }
    let msg = `${n} linha(s) com o código ${codigo}.`;
    if (salvar) {
      try {
        const { error } = await sb.from(x.tab).insert([{ key: trecho, cnpj: codigo, full_name: x.historico, updated_at: new Date().toISOString() }]);
        if (error) throw error;
        delete S.tabelas[x.tab];
        msg += ' Salvo na Tabela de Produtos.';
      } catch (e) { msg += ' Não consegui salvar na Tabela de Produtos (' + e.message + '): cadastre em Extratos → Excel.'; }
    }
    const anterior = extLogBox; extLogBox = 'movStatusBox';
    try { log(msg, 'ok'); alertasDasLinhas(S.linhas); await alertasCra(S.linhas); } finally { extLogBox = anterior; }
    mostrarPreview();
  }

  // ── Valor bruto digitado (ex.: amortização paga no começo do mês, cujo bruto só está no extrato anterior) ──
  function numBr(txt) {
    let t = String(txt || '').replace(/R\$|\s/g, '');
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(t); return isFinite(n) ? n : null;
  }
  async function recalcular(msg) {
    const anterior = extLogBox; extLogBox = 'movStatusBox';
    try { if (msg) log(msg, 'ok'); alertasDasLinhas(S.linhas); } finally { extLogBox = anterior; }
    mostrarPreview();
  }
  function aplicarBruto(id) {
    const l = S.linhas.find(x => x.id === id); if (!l) return;
    const n = numBr($('movBruto_' + id).value);
    if (n == null || n === 0) { alert('Digite o valor bruto, por exemplo 12.650,00'); return; }
    const sinal = (l.valorLiq || l.valor) < 0 ? -1 : 1;
    l.valor = sinal * Math.abs(n); l.semBruto = false; l.brutoConferido = true; l.brutoManual = true;
    recalcular(`Valor bruto digitado: ${l.nome} · ${l.data} · ${brl(l.valor)} (líquido ${brl(l.valorLiq)})`);
  }
  function brutoOk(id) {
    const l = S.linhas.find(x => x.id === id); if (!l) return;
    l.brutoConferido = true;
    recalcular(`Valor conferido como bruto: ${l.nome} · ${l.data} · ${brl(l.valor)}`);
  }

  function mostrarPreview() {
    const L = S.linhas;
    const clientes = new Set(L.map(l => l.nome.toUpperCase())).size;
    const alertas = todosAlertas();
    const conferir = L.filter(l => l.alertas && l.alertas.length).length;
    $('movChips').innerHTML = `
      ${Object.keys(BANCOS).filter(b => L.some(l => l.banco === b)).map(b => `<div class="ext-chip">${nomeBanco(b)} <span>${L.filter(l => l.banco === b).length}</span></div>`).join('')}
      <div class="ext-chip">Clientes <span>${clientes}</span></div>
      <div class="ext-chip">Lançamentos <span>${L.length}</span></div>
      <div class="ext-chip">Para conferir <span style="color:${conferir ? '#e05555' : 'var(--ok-text)'}">${conferir}</span></div>`;

    const cont = t => alertas.filter(a => a.tipo === t).length;
    const linhaAlerta = a => `<tr>
        <td class="td-sheet">${esc(a.nome || '—')}</td><td>${esc(a.banco ? nomeBanco(a.banco) : '')}</td><td>${esc(a.data)}</td>
        <td class="${a.codigo ? 'td-cnpj' : 'td-na'}">${esc(a.codigo || '—')}</td>
        <td title="${esc(a.historico)}">${esc((a.historico || '').length > 40 ? a.historico.slice(0, 39) + '…' : a.historico)}</td>
        <td>${a.valor === '' ? '' : brl(a.valor)}</td>${a.tipo === 'bruto' ? `
        <td style="min-width:240px;white-space:nowrap;"><input id="movBruto_${a.id}" placeholder="Valor bruto" inputmode="decimal" onkeydown="if(event.key==='Enter')movBruto('${a.id}')"
            style="width:110px;background:transparent;border:1px solid var(--rule-strong);color:var(--cream);font-family:inherit;padding:0.3rem 0.45rem;font-size:0.75rem;" />
          <button class="btn-upload" onclick="movBruto('${a.id}')" style="font-size:0.6rem;padding:0.3rem 0.55rem;">Aplicar</button>
          <button class="btn-upload" onclick="movBrutoOk('${a.id}')" title="O valor já é o bruto: tirar o alerta" style="font-size:0.6rem;padding:0.3rem 0.55rem;background:rgba(255,255,255,0.06);color:var(--gray-light);">Está certo</button></td>` : ''}<td>${esc(a.texto)}</td></tr>`;
    $('movFaltam').innerHTML = `
      <div class="upload-panel" style="margin-bottom:1rem;">
        <h3>Alertas para conferir</h3>
        <p style="font-size:0.75rem;color:var(--gray);margin:-0.3rem 0 0.8rem;line-height:1.6;">Confira no PDF só as linhas abaixo: no Excel elas vêm com <strong>Sim</strong> na coluna Conferir e o motivo na coluna Alerta, e tudo junto na aba Alertas.${S.craInfo ? ' ' + esc(S.craInfo) : ''}</p>
        <div class="ext-chips">${Object.entries(ALERTAS).map(([t, nome]) => `<div class="ext-chip">${nome} <span style="color:${cont(t) ? '#e05555' : 'var(--ok-text)'}">${cont(t)}</span></div>`).join('')}</div>
        ${blocoCorrecao()}
        ${alertas.length ? Object.entries(ALERTAS).filter(([t]) => cont(t)).map(([t, nome]) => `
          <details${cont(t) <= 20 ? ' open' : ''} style="margin-top:0.8rem;"><summary style="cursor:pointer;font-size:0.8rem;">${nome} (${cont(t)})</summary>
            <div class="ext-preview-wrap" style="margin-top:0.5rem;"><table class="ext-preview-table">
              <thead><tr><th>Nome no extrato</th><th>Banco</th><th>Data</th><th>Código</th><th>Histórico</th><th>Valor</th>${t === 'bruto' ? '<th>Corrigir</th>' : ''}<th>Motivo</th></tr></thead>
              <tbody>${alertas.filter(a => a.tipo === t).slice(0, 200).map(linhaAlerta).join('')}</tbody></table></div>
          </details>`).join('') : '<p style="font-size:0.8rem;color:var(--ok-text);margin-top:0.6rem;">Nenhum alerta: nada para conferir.</p>'}
      </div>`;

    const so = $('movSoConferir') && $('movSoConferir').checked;
    const base = so ? L.filter(l => l.alertas && l.alertas.length) : L;
    const linhas = base.slice(0, 80).map(l => `
      <tr${l.alertas && l.alertas.length ? ' style="background:rgba(224,85,85,0.08)" title="' + esc(l.alertas.map(a => a.texto).join(' · ')) + '"' : ''}>
        <td class="td-sheet">${esc(l.nome)}</td><td>${esc(nomeBanco(l.banco))}</td><td>${l.data}${l.dataOriginal ? ` <span style="color:var(--gray)" title="Data no extrato: ${l.dataOriginal}">↶</span>` : ''}</td>
        <td class="${l.codigo ? 'td-cnpj' : 'td-na'}">${esc(l.codigo || '—')}</td>
        <td title="${esc(l.historico)}">${esc(l.historico.length > 40 ? l.historico.slice(0, 39) + '…' : l.historico)}</td>
        <td class="${l.valor < 0 ? 'td-neg' : 'td-pos'}">${brl(l.valor)}</td><td>${esc(l.tipo)}</td></tr>`).join('');
    $('movTabela').innerHTML = `<thead><tr><th>Nome no extrato</th><th>Banco</th><th>Data</th><th>Código</th><th>Histórico</th><th>Valor</th><th>Tipo</th></tr></thead>
      <tbody>${linhas}${base.length > 80 ? `<tr><td colspan="7" style="text-align:center;color:var(--gray);padding:0.8rem;font-size:0.68rem;">… e mais ${base.length - 80} lançamentos no Excel</td></tr>` : ''}</tbody>`;
    $('movPreview').classList.add('visible');
  }

  // ── Excel: aba Movimentacoes (para a macro) + Conferência por cliente ──
  function baixar() {
    const L = [...S.linhas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })
      || a.banco.localeCompare(b.banco) || dataSerial(a.data) - dataSerial(b.data));
    const aoa = [CABECALHO, ...L.map(l => [dataSerial(l.data), dataSerial(l.dataLiq), '', l.nome, l.banco, l.codigo,
      l.historico, l.tipo, l.valor, l.valorLiq, l.saldo, l.dataOriginal ? dataSerial(l.dataOriginal) : '', l.arquivo, l.id,
      l.alertas && l.alertas.length ? 'Sim' : '', (l.alertas || []).map(a => a.texto).join(' · ')])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    for (let r = 1; r < aoa.length; r++) {
      [0, 1, 11].forEach(c => { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && typeof cell.v === 'number') cell.z = 'dd/mm/yyyy'; });
      [8, 9, 10].forEach(c => { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && typeof cell.v === 'number') cell.z = '#,##0.00'; });
    }
    ws['!cols'] = [11, 11, 14, 34, 11, 22, 50, 18, 14, 14, 14, 11, 30, 16, 9, 50].map(w => ({ wch: w }));
    ws['!autofilter'] = { ref: ws['!ref'] };

    // Conferência: um resumo por cliente para bater com o PDF
    const porNome = new Map();
    L.forEach(l => {
      const k = l.nome + '|' + l.banco; if (!porNome.has(k)) porNome.set(k, { nome: l.nome, banco: l.banco, n: 0, ent: 0, sai: 0, semCod: 0, semBruto: 0, saldo: 0 });
      const c = porNome.get(k); c.n++; if (l.valorLiq >= 0) c.ent += l.valorLiq; else c.sai += l.valorLiq;
      c.semCod += l.alertas && l.alertas.length ? 1 : 0; c.saldo = l.saldo;
    });
    const conf = [['Nome no extrato', 'Banco', 'Lançamentos', 'Entradas líquidas (R$)', 'Saídas líquidas (R$)', 'Saldo do último lançamento (R$)', 'Para conferir'],
      ...[...porNome.values()].map(c => [c.nome, nomeBanco(c.banco), c.n, Math.round(c.ent * 100) / 100, Math.round(c.sai * 100) / 100, c.saldo, c.semCod])];
    const ws2 = XLSX.utils.aoa_to_sheet(conf);
    ws2['!cols'] = [34, 12, 12, 20, 20, 24, 13].map(w => ({ wch: w }));

    // Alertas: tudo o que precisa ser conferido, numa lista só
    const al = todosAlertas();
    const aoaA = [['Alerta', 'Nome no extrato', 'Banco', 'Data', 'Código', 'Histórico', 'Valor (R$)', 'Motivo', 'Conferido', 'ID'],
      ...al.map(a => [ALERTAS[a.tipo], a.nome, a.banco ? nomeBanco(a.banco) : '', dataSerial(a.data), a.codigo, a.historico,
        a.valor === '' ? '' : a.valor, a.texto, '', a.id])];
    const ws3 = XLSX.utils.aoa_to_sheet(aoaA);
    for (let r = 1; r < aoaA.length; r++) {
      const d = ws3[XLSX.utils.encode_cell({ r, c: 3 })]; if (d && typeof d.v === 'number') d.z = 'dd/mm/yyyy';
      const v = ws3[XLSX.utils.encode_cell({ r, c: 6 })]; if (v && typeof v.v === 'number') v.z = '#,##0.00';
    }
    ws3['!cols'] = [30, 32, 11, 11, 20, 48, 14, 60, 10, 16].map(w => ({ wch: w }));
    if (aoaA.length > 1) ws3['!autofilter'] = { ref: ws3['!ref'] };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Movimentacoes');
    XLSX.utils.book_append_sheet(wb, ws3, 'Alertas');
    XLSX.utils.book_append_sheet(wb, ws2, 'Conferencia');
    const hoje = new Date().toISOString().slice(0, 10);
    const bancos = Object.keys(BANCOS).filter(b => L.some(l => l.banco === b)).map(b => idBanco(b).toLowerCase()).join('_');
    XLSX.writeFile(wb, `movimentacoes_${bancos}_${hoje}.xlsx`);
  }

  // ── Ligações da tela ──
  function iniciar() {
    const caixas = $('movCaixas');
    if (!caixas || caixas.dataset.ok) return;
    caixas.dataset.ok = '1';
    caixas.innerHTML = Object.entries(BANCOS).map(([b, cfg]) => `
      <div class="upload-panel" style="margin:0;">
        <h3 style="display:flex;justify-content:space-between;align-items:baseline;gap:0.5rem;">${nomeBanco(b)}
          <span id="movConta${idBanco(b)}" style="font-size:0.62rem;font-weight:400;color:var(--gold-text);"></span></h3>
        <div style="font-size:0.68rem;color:var(--gray);margin:-0.4rem 0 0.7rem;">${cfg.sub}</div>
        <div class="extrato-upload-zone" id="movZona${idBanco(b)}" style="padding:1.2rem;">
          <input type="file" accept=".pdf" multiple />
          <div style="font-size:0.8rem;color:var(--gray-light);">Arraste os PDFs aqui</div>
          <div style="font-size:0.66rem;color:var(--gray);">ou clique para selecionar</div>
        </div>
        <div class="file-list-ext" id="movLista${idBanco(b)}"></div>
      </div>`).join('');
    Object.keys(BANCOS).forEach(b => {
      const zona = $('movZona' + idBanco(b)), input = zona.querySelector('input');
      const somar = files => definirArquivos(b, [...(S.arquivos[b] || []), ...files.filter(f => !(S.arquivos[b] || []).some(g => g.name === f.name))]);
      zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('drag-over'); });
      zona.addEventListener('dragleave', () => zona.classList.remove('drag-over'));
      zona.addEventListener('drop', e => {
        e.preventDefault(); zona.classList.remove('drag-over');
        const pdfs = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf');
        if (pdfs.length) somar(pdfs);
      });
      input.addEventListener('change', () => { if (input.files.length) somar([...input.files]); input.value = ''; });
    });
  }

  window.movInit = () => { iniciar(); S.tabelas = {}; };
  window.movTirar = tirar;
  window.movProcessar = processar;
  window.movBaixar = baixar;
  window.movCorrigir = corrigir;
  window.movBruto = aplicarBruto;
  window.movBrutoOk = brutoOk;
  window.movFiltrar = () => { if (S.linhas.length) mostrarPreview(); };
  window.MOV_TESTE = { paraLinhas, alertasDasLinhas, alertasCra, mostrarPreview };  // para testes no console
})();
