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
    'Valor (R$)', 'Valor Líquido (R$)', 'Saldo (R$)', 'Data original', 'Arquivo', 'ID'];

  const S = { banco: 'XP', arquivos: [], linhas: [], tabelas: {}, ocupado: false };
  window.MOV = S;  // para inspecionar no console

  const $ = id => document.getElementById(id);
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

  // ── Seleção de banco e arquivos ──
  function selecionarBanco(banco) {
    S.banco = banco;
    document.querySelectorAll('#movBancos .broker-btn').forEach(b => b.classList.toggle('active', b.dataset.banco === banco));
    $('movAvisoEqi').classList.toggle('visible', BANCOS[banco].layout === 'EQI');
    limparResultado();
  }

  function definirArquivos(files) {
    S.arquivos = files;
    $('movListaArquivos').innerHTML = files.map((f, i) => `
      <div class="file-item-ext">
        <span class="file-item-ext-name">${esc(f.name)}</span>
        <span class="file-item-ext-status file-status-wait" id="movArq${i}">aguardando</span>
      </div>`).join('');
    $('movBtnProcessar').disabled = !files.length;
    $('movBtnLabel').textContent = files.length > 1 ? `Processar ${files.length} extratos` : 'Processar extrato';
    limparResultado();
  }
  function statusArquivo(i, txt, cls) { const el = $('movArq' + i); if (el) { el.textContent = txt; el.className = 'file-item-ext-status ' + (cls || ''); } }

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
      return {
        data: r.dataMov, dataLiq: r.dataLiq || r.dataMov, nome, banco, codigo,
        historico: r.historico, tipo: r.tipo, valor: r.valor, valorLiq: liq, saldo: r.saldo ?? 0,
        dataOriginal: r.recuado || '', arquivo,
        id: hash(base + '#' + vistos[base]),
        semCodigo: !codigo && TIPOS_COM_PRODUTO.has(r.tipo),
        semBruto: !!(r.needsGross && !r.isGross),
      };
    });
  }

  async function processar() {
    if (!S.arquivos.length || S.ocupado) return;
    S.ocupado = true; S.linhas = [];
    const box = $('movStatusBox');
    box.innerHTML = ''; box.classList.add('visible');
    $('movPreview').classList.remove('visible');
    $('movBtnProcessar').disabled = true;
    const anterior = extLogBox; extLogBox = 'movStatusBox';  // os leitores escrevem o log aqui
    try {
      const banco = S.banco, cfg = BANCOS[banco];
      const mapa = await tabela(banco);
      const recuar = $('movRecuarUltimoDU').checked;
      for (let i = 0; i < S.arquivos.length; i++) {
        const f = S.arquivos[i];
        log(`── ${f.name}`, 'head'); statusArquivo(i, 'processando...');
        try {
          const text = await extExtractText(f);
          let { nome, rows } = cfg.layout === 'XP' ? lerXP(text, f.name, mapa) : lerEQI(text, f.name, mapa);
          if (!rows.length) { log('Nenhum lançamento encontrado', 'err'); statusArquivo(i, 'erro', 'file-status-err'); continue; }
          if (recuar) {
            const rec = extRecuarUltimoDiaUtil(rows);
            if (rec.n) { rows = rec.rows; log(`${rec.n} lançamento(s) de juros/amortização do último dia útil recuado(s) 1 dia útil`, 'ok'); }
          }
          const linhas = paraLinhas(banco, nome, rows, f.name);
          S.linhas.push(...linhas);
          log(`Cliente: "${nome}" · ${linhas.length} lançamentos`, 'ok');
          statusArquivo(i, `✓ ${linhas.length} lançamentos`, 'file-status-ok');
        } catch (e) {
          log('Erro: ' + e.message, 'err'); console.error(e); statusArquivo(i, 'erro', 'file-status-err');
        }
      }
      if (S.linhas.length) mostrarPreview();
    } finally {
      extLogBox = anterior; S.ocupado = false; $('movBtnProcessar').disabled = false;
    }
  }

  // ── Prévia ──
  function mostrarPreview() {
    const L = S.linhas;
    const clientes = new Set(L.map(l => l.nome)).size;
    const semCodigo = L.filter(l => l.semCodigo), semBruto = L.filter(l => l.semBruto);
    $('movChips').innerHTML = `
      <div class="ext-chip">Clientes <span>${clientes}</span></div>
      <div class="ext-chip">Lançamentos <span>${L.length}</span></div>
      <div class="ext-chip">Sem código <span style="color:${semCodigo.length ? '#e05555' : 'var(--ok-text)'}">${semCodigo.length}</span></div>
      ${semBruto.length ? `<div class="ext-chip">Sem valor bruto <span style="color:#e05555">${semBruto.length}</span></div>` : ''}`;
    // Produtos sem código: um por histórico, para cadastrar na Tabela de Produtos
    const faltam = [...new Map(semCodigo.map(l => [l.historico.toUpperCase(), l])).values()];
    $('movFaltam').innerHTML = faltam.length ? `
      <div class="eqi-notice-dash visible" style="margin-bottom:1rem;">
        <strong style="color:var(--white);">${faltam.length} produto(s) sem código.</strong>
        Cadastre o trecho do nome na Tabela de Produtos (${BANCOS[S.banco].layout === 'XP' ? 'XP' : 'EQI/BTG'}) em Extratos → Excel e processe de novo, ou corrija o código depois na base.
        <ul style="margin:0.5rem 0 0 1.1rem;">${faltam.slice(0, 15).map(l => `<li>${esc(l.historico)} <span style="color:var(--gray)">(${esc(l.nome)})</span></li>`).join('')}</ul>
        ${faltam.length > 15 ? `<div>… e mais ${faltam.length - 15}</div>` : ''}
      </div>` : '';
    const linhas = L.slice(0, 80).map(l => `
      <tr${l.semCodigo || l.semBruto ? ' style="background:rgba(224,85,85,0.08)"' : ''}>
        <td class="td-sheet">${esc(l.nome)}</td><td>${l.data}${l.dataOriginal ? ` <span style="color:var(--gray)" title="Data no extrato: ${l.dataOriginal}">↶</span>` : ''}</td>
        <td class="${l.codigo ? 'td-cnpj' : 'td-na'}">${esc(l.codigo || '—')}</td>
        <td title="${esc(l.historico)}">${esc(l.historico.length > 40 ? l.historico.slice(0, 39) + '…' : l.historico)}</td>
        <td class="${l.valor < 0 ? 'td-neg' : 'td-pos'}">${brl(l.valor)}</td><td>${esc(l.tipo)}</td></tr>`).join('');
    $('movTabela').innerHTML = `<thead><tr><th>Nome no extrato</th><th>Data</th><th>Código</th><th>Histórico</th><th>Valor</th><th>Tipo</th></tr></thead>
      <tbody>${linhas}${L.length > 80 ? `<tr><td colspan="6" style="text-align:center;color:var(--gray);padding:0.8rem;font-size:0.68rem;">… e mais ${L.length - 80} lançamentos no Excel</td></tr>` : ''}</tbody>`;
    $('movPreview').classList.add('visible');
  }

  // ── Excel: aba Movimentacoes (para a macro) + Conferência por cliente ──
  function baixar() {
    const L = [...S.linhas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })
      || dataSerial(a.data) - dataSerial(b.data));
    const aoa = [CABECALHO, ...L.map(l => [dataSerial(l.data), dataSerial(l.dataLiq), '', l.nome, l.banco, l.codigo,
      l.historico, l.tipo, l.valor, l.valorLiq, l.saldo, l.dataOriginal ? dataSerial(l.dataOriginal) : '', l.arquivo, l.id])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    for (let r = 1; r < aoa.length; r++) {
      [0, 1, 11].forEach(c => { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && typeof cell.v === 'number') cell.z = 'dd/mm/yyyy'; });
      [8, 9, 10].forEach(c => { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && typeof cell.v === 'number') cell.z = '#,##0.00'; });
    }
    ws['!cols'] = [11, 11, 14, 34, 11, 22, 50, 18, 14, 14, 14, 11, 30, 16].map(w => ({ wch: w }));
    ws['!autofilter'] = { ref: ws['!ref'] };

    // Conferência: um resumo por cliente para bater com o PDF
    const porNome = new Map();
    L.forEach(l => {
      const k = l.nome; if (!porNome.has(k)) porNome.set(k, { n: 0, ent: 0, sai: 0, semCod: 0, semBruto: 0, saldo: 0 });
      const c = porNome.get(k); c.n++; if (l.valorLiq >= 0) c.ent += l.valorLiq; else c.sai += l.valorLiq;
      c.semCod += l.semCodigo ? 1 : 0; c.semBruto += l.semBruto ? 1 : 0; c.saldo = l.saldo;
    });
    const conf = [['Nome no extrato', 'Banco', 'Lançamentos', 'Entradas líquidas (R$)', 'Saídas líquidas (R$)', 'Saldo do último lançamento (R$)', 'Sem código', 'Sem valor bruto'],
      ...[...porNome].map(([k, c]) => [k, S.banco, c.n, Math.round(c.ent * 100) / 100, Math.round(c.sai * 100) / 100, c.saldo, c.semCod, c.semBruto])];
    const ws2 = XLSX.utils.aoa_to_sheet(conf);
    ws2['!cols'] = [34, 12, 12, 20, 20, 24, 11, 14].map(w => ({ wch: w }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Movimentacoes');
    XLSX.utils.book_append_sheet(wb, ws2, 'Conferencia');
    const hoje = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `movimentacoes_${S.banco.toLowerCase().replace(/\s+/g, '')}_${hoje}.xlsx`);
  }

  // ── Ligações da tela ──
  function iniciar() {
    const zona = $('movUploadZone'), input = $('movFileInput');
    if (!zona || zona.dataset.ok) return;
    zona.dataset.ok = '1';
    zona.addEventListener('click', () => input.click());
    zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('drag-over'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('drag-over'));
    zona.addEventListener('drop', e => {
      e.preventDefault(); zona.classList.remove('drag-over');
      const pdfs = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf');
      if (pdfs.length) definirArquivos(pdfs);
    });
    input.addEventListener('change', () => { if (input.files.length) definirArquivos([...input.files]); input.value = ''; });
    $('movBancos').innerHTML = Object.entries(BANCOS).map(([b, cfg]) => `
      <button class="broker-btn${b === S.banco ? ' active' : ''}" data-banco="${b}" onclick="movSelecionarBanco('${b}')">
        <span class="broker-btn-name">${b === 'MONTE BRAVO' ? 'Monte Bravo' : b}</span>
        <span class="broker-btn-sub">${cfg.sub}</span>
      </button>`).join('');
    S.tabelas = {};  // recarrega a Tabela de Produtos a cada visita (pode ter sido editada)
  }

  window.movInit = () => { iniciar(); S.tabelas = {}; };
  window.movSelecionarBanco = selecionarBanco;
  window.movProcessar = processar;
  window.movBaixar = baixar;
})();
