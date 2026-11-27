/* Aba "Histórico de ordens" de Mensagens Padrão (eh-cliente-dashboard.html).
 *
 * Cada ordem gerada em "Ordem ao Banco" (copiar tabela, WhatsApp, imagem ou Excel) vira
 * linhas de histórico: uma por cliente e ativo, com data, instituição, operação e valor.
 * Ficam no bucket privado tarefas-mensais, um arquivo por mês (historico-ordens/AAAA-MM.json),
 * nunca no repositório, que é público.
 *
 * % da carteira: valor ÷ patrimônio do cliente. O patrimônio vem da carteira guardada em
 * Análise de Fundos → Carteiras dos clientes (config/carteiras_clientes.json), copiado para a
 * linha no momento da ordem, ou do valor digitado aqui para o mês (vale mais que o da carteira).
 *
 * Gerar a mesma ordem de novo (mesmo cliente ou fundo, data, tipo e instituição) substitui as
 * linhas anteriores dessa ordem, para não duplicar quando o valor é corrigido.
 *
 * As ordens da lista "Ordens enviadas ao banco" (msgLib.ordens, em Aprovação do Cliente) também
 * entram sozinhas: ao abrir esta aba, as que ainda não estão no histórico são acrescentadas.
 * Linhas removidas aqui ficam em "removidas" no arquivo do mês, para não voltarem.
 *
 * Usa do dashboard: sb, TM_BUCKET, tmNomeMes, escHtml, gv, hojeISO, moInst, moModo, moTipo,
 * moFmtCnpj, msgClientes, msgLib, MO_TIPO_NOME, showFb2, currentUser e XLSX (SheetJS).
 */
(function () {
  const PASTA = 'historico-ordens';
  const ARQ_CART = 'config/carteiras_clientes.json';
  const OP_NOME = { compra: 'Aplicação', resgate: 'Resgate' };

  const S = { mes: null, dados: null, meses: [], cart: null, iniciado: false };
  window.HO = S;  // para inspecionar no console

  // ── utilidades ──
  const esc = s => escHtml(s == null ? '' : String(s));
  const dig = s => String(s == null ? '' : s).replace(/\D/g, '');
  const normNome = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const brl = n => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = x => x == null || !isFinite(x) ? '—' : (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const dataBr = iso => iso ? iso.split('-').reverse().join('/') : '';
  const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const arquivo = mes => `${PASTA}/${mes}.json`;
  const vazio = () => ({ linhas: [], patrimonio: {}, removidas: [] });
  // Mesma linha = mesmo cliente, data, operação e ativo
  const chave = l => [normNome(l.cliente), l.data, l.operacao, chaveAtivo(l)].join('|');

  async function baixarJson(caminho) {
    try {
      const { data, error } = await sb.storage.from(TM_BUCKET).download(caminho);
      if (error || !data) return null;
      return JSON.parse(await data.text());
    } catch (e) { return null; }
  }
  async function enviarJson(caminho, obj) {
    const corpo = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const { error } = await sb.storage.from(TM_BUCKET).upload(caminho, corpo, { upsert: true, contentType: 'application/json' });
    if (error) throw new Error(error.message);
  }
  async function lerMes(mes) {
    const d = await baixarJson(arquivo(mes));
    return d && Array.isArray(d.linhas) ? { ...vazio(), ...d, patrimonio: d.patrimonio || {}, removidas: d.removidas || [] } : vazio();
  }
  // Lê de novo antes de gravar, para não apagar o que outro admin salvou nesse meio tempo.
  async function alterarMes(mes, fn) {
    const d = await lerMes(mes);
    fn(d);
    d.atualizado = new Date().toISOString();
    await enviarJson(arquivo(mes), d);
    if (S.mes === mes) { S.dados = d; render(); }
    if (!S.meses.includes(mes)) { S.meses.push(mes); S.meses.sort().reverse(); renderMeses(); }
    return d;
  }

  // ── carteiras dos clientes (patrimônio) ──
  async function carteiras(recarregar) {
    if (!S.cart || recarregar) {
      const c = (window.AF && window.AF.cart && window.AF.cart.clientes && Object.keys(window.AF.cart.clientes).length)
        ? window.AF.cart : await baixarJson(ARQ_CART);
      S.cart = c && c.clientes ? c : { clientes: {} };
    }
    return S.cart;
  }
  // Carteira do cliente: nome igual; senão a única carteira cujo nome contém todas as palavras
  // do nome da ordem (ou o contrário), para "DANIEL" achar "Daniel Souza Lima".
  function carteiraDe(nome) {
    const k = normNome(nome);
    if (!k || !S.cart) return null;
    if (S.cart.clientes[k]) return S.cart.clientes[k];
    const tk = k.split(' ');
    const cands = Object.entries(S.cart.clientes).filter(([kc]) => {
      const tc = kc.split(' ');
      return tk.every(t => tc.includes(t)) || tc.every(t => tk.includes(t));
    });
    return cands.length === 1 ? cands[0][1] : null;
  }
  const totalCart = c => c.itens.reduce((a, i) => a + (i.valor || 0), 0);
  function posicaoNaCarteira(cart, cnpj, nome) {
    if (!cart) return null;
    const c = dig(cnpj), n = normNome(nome);
    const its = cart.itens.filter(i => (c && i.c && dig(i.c) === c) || (n && normNome(i.n) === n));
    return its.length ? its.reduce((a, i) => a + (i.valor || 0), 0) : null;
  }

  // Patrimônio usado no % da linha: o digitado para o mês, senão o copiado na hora da ordem,
  // senão o da carteira guardada hoje.
  function patrimonioDe(l) {
    const p = S.dados && S.dados.patrimonio[normNome(l.cliente)];
    if (p && p.valor) return { valor: p.valor, fonte: 'digitado' + (p.ref ? ' (' + p.ref + ')' : '') };
    if (l.patrimonio) return { valor: l.patrimonio, fonte: 'carteira' + (l.patrimonio_ref ? ' de ' + l.patrimonio_ref : '') };
    const c = carteiraDe(l.cliente);
    return c ? { valor: totalCart(c), fonte: 'carteira' + (c.ref ? ' de ' + c.ref : '') } : null;
  }
  // Valor da linha; no resgate total, a posição do cliente no ativo pela carteira (estimado).
  const valorDe = l => l.total ? (l.valor_estimado || 0) : (l.valor || 0);

  // ── registrar a ordem (chamado por moLembrar em Mensagens Padrão) ──
  async function hoRegistrarOrdem(o) {
    const dataIso = gv('mo_data') || hojeISO();
    const mes = dataIso.slice(0, 7);
    const inst = moInst();
    await carteiras();
    const base = (cliente, conta) => {
      const cart = carteiraDe(cliente);
      return { data: dataIso, cliente, conta: conta || '', instituicao: inst,
               patrimonio: cart ? totalCart(cart) : null, patrimonio_ref: cart ? (cart.ref || '') : '', _cart: cart };
    };
    const linha = (b, l, ativo, cnpj, liquidez) => {
      const { _cart, ...resto } = b;
      const out = { id: novoId(), ...resto, operacao: l.op, ativo: ativo || '', cnpj: cnpj || '', liquidez: liquidez || '',
                    valor: l.total ? 0 : l.valor, total: !!l.total, registrada_em: new Date().toISOString(),
                    por: (currentUser && currentUser.email) || '' };
      if (l.total) { const pos = posicaoNaCarteira(_cart, cnpj, ativo); if (pos) out.valor_estimado = pos; }
      return out;
    };
    let grupo, novas;
    if (o.modo === 'fundo') {
      const fundo = gv('mo_f_fundo'), cnpj = moFmtCnpj(gv('mo_f_cnpj'));
      grupo = ['f', dataIso, o.tipo, inst, dig(cnpj) || normNome(fundo)].join('|');
      novas = o.linhas.filter(l => l.nome && (l.valor || l.total))
        .map(l => linha(base(l.nome, l.conta), l, fundo, cnpj, gv('mo_f_liq').trim()));
    } else {
      const cli = msgClientes.find(c => c.user_id === gv('mo_cliente'));
      const nome = (cli && cli.nome) || gv('mo_nome');
      if (!nome) return;
      grupo = ['c', dataIso, o.tipo, inst, normNome(nome)].join('|');
      const b = base(nome, gv('mo_conta'));
      novas = o.linhas.filter(l => l.fundo && (l.valor || l.total)).map(l => linha(b, l, l.fundo, l.cnpj, l.liquidez));
    }
    if (!novas.length) return;
    novas.forEach(l => { l.grupo = grupo; });
    // Substitui também a mesma linha vinda de "Ordens enviadas ao banco" (ou da outra forma de
    // montar a ordem), e uma linha removida antes volta, já que a ordem foi gerada de novo.
    const ks = new Set(novas.map(chave));
    await alterarMes(mes, d => {
      d.linhas = d.linhas.filter(l => l.grupo !== grupo && !ks.has(chave(l))).concat(novas);
      d.removidas = d.removidas.filter(k => !ks.has(k));
    });
  }

  // ── tela ──
  async function hoInit(recarregar) {
    if (S.iniciado && !recarregar) { render(); return; }
    S.iniciado = true;
    const st = document.getElementById('hoStatus');
    const { data, error } = await sb.storage.from(TM_BUCKET).list(PASTA, { limit: 500 });
    if (error) { st.textContent = 'Não consegui ler o histórico: ' + error.message; S.iniciado = false; return; }
    S.meses = (data || []).map(a => (/^(\d{4}-\d{2})\.json$/.exec(a.name) || [])[1]).filter(Boolean);
    const atual = hojeISO().slice(0, 7);
    if (!S.meses.includes(atual)) S.meses.push(atual);
    S.meses.sort().reverse();
    renderMeses();
    await carteiras(true);
    await hoMes(S.mes && S.meses.includes(S.mes) ? S.mes : atual);
    try {
      const n = await hoSincronizar();
      if (n) showFb2('hoFb', `✓ ${n} linha(s) acrescentadas da lista "Ordens enviadas ao banco".`, 'success');
    } catch (e) { showFb2('hoFb', 'Não consegui trazer as ordens enviadas ao banco: ' + e.message, 'error'); }
  }
  function renderMeses() {
    const sel = document.getElementById('hoMes');
    if (!sel) return;
    sel.innerHTML = S.meses.map(m => `<option value="${m}">${tmNomeMes(m)}</option>`).join('');
    if (S.mes) sel.value = S.mes;
  }
  async function hoMes(mes) {
    S.mes = mes;
    document.getElementById('hoMes').value = mes;
    document.getElementById('hoStatus').textContent = 'Carregando…';
    S.dados = await lerMes(mes);
    ['hoCliente', 'hoFundo'].forEach(id => { document.getElementById(id).value = ''; });
    render();
  }

  function filtradas() {
    const cli = gv('hoCliente'), fundo = gv('hoFundo'), op = gv('hoOp'), inst = gv('hoInst');
    return (S.dados ? S.dados.linhas : [])
      .filter(l => (!cli || normNome(l.cliente) === cli) && (!fundo || chaveAtivo(l) === fundo) &&
                   (!op || l.operacao === op) && (!inst || l.instituicao === inst))
      .sort((a, b) => a.data.localeCompare(b.data) || a.cliente.localeCompare(b.cliente, 'pt-BR'));
  }
  const chaveAtivo = l => dig(l.cnpj).length >= 11 ? dig(l.cnpj) : normNome(l.ativo);

  function opcoes(id, pares, rotuloTodos) {
    const sel = document.getElementById(id), atual = sel.value;
    sel.innerHTML = `<option value="">${rotuloTodos}</option>` + pares.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    sel.value = pares.some(([v]) => v === atual) ? atual : '';
  }

  // Resumo por cliente (ou por ativo): aplicado, resgatado e o % da carteira de cada cliente.
  function porCliente(ls) {
    const m = {};
    ls.forEach(l => {
      const k = normNome(l.cliente);
      const r = m[k] || (m[k] = { k, cliente: l.cliente, aplicado: 0, resgatado: 0, totais: 0, ativos: new Set(), inst: new Set(), pat: null });
      if (l.operacao === 'resgate') r.resgatado += valorDe(l); else r.aplicado += valorDe(l);
      if (l.total && !l.valor_estimado) r.totais++;
      r.ativos.add(l.ativo); r.inst.add(l.instituicao);
      const p = patrimonioDe(l);
      if (p && (!r.pat || p.fonte.startsWith('digitado'))) r.pat = p;
    });
    return Object.values(m).sort((a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR'));
  }
  function porAtivo(ls) {
    const m = {};
    ls.forEach(l => {
      const k = chaveAtivo(l);
      const r = m[k] || (m[k] = { ativo: l.ativo, cnpj: l.cnpj, aplicado: 0, resgatado: 0, clientes: new Set() });
      if (l.operacao === 'resgate') r.resgatado += valorDe(l); else r.aplicado += valorDe(l);
      r.clientes.add(normNome(l.cliente));
    });
    return Object.values(m).sort((a, b) => (b.aplicado + b.resgatado) - (a.aplicado + a.resgatado));
  }

  function render() {
    if (!S.dados || !document.getElementById('hoTabela')) return;
    const todas = S.dados.linhas;
    opcoes('hoCliente', [...new Map(todas.map(l => [normNome(l.cliente), l.cliente])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), 'Todos');
    opcoes('hoFundo', [...new Map(todas.map(l => [chaveAtivo(l), l.ativo])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), 'Todos');
    const ls = filtradas();
    const clientes = porCliente(ls), ativos = porAtivo(ls);
    const aplicado = clientes.reduce((a, c) => a + c.aplicado, 0), resgatado = clientes.reduce((a, c) => a + c.resgatado, 0);
    const ordens = new Set(ls.map(l => l.grupo + '|' + normNome(l.cliente))).size;
    const chips = [['Ordens', ordens], ['Clientes', clientes.length], ['Ativos', ativos.length],
                   ['Aplicado', 'R$ ' + brl(aplicado)], ['Resgatado', 'R$ ' + brl(resgatado)], ['Líquido', 'R$ ' + brl(aplicado - resgatado)]];
    document.getElementById('hoResumo').innerHTML = chips.map(([a, b]) => `<div class="ext-chip">${a}<span>${b}</span></div>`).join('');
    const st = document.getElementById('hoStatus');
    st.textContent = todas.length ? (S.dados.atualizado ? 'Atualizado em ' + new Date(S.dados.atualizado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '')
      : 'Nenhuma ordem registrada neste mês ainda. As ordens entram aqui sozinhas quando você copia ou baixa a tabela em "Ordem ao Banco".';

    const semPat = clientes.filter(c => !c.pat).length;
    document.getElementById('hoClientes').innerHTML =
      `<tr><th>Cliente</th><th class="af-num">Patrimônio (R$)</th><th class="af-num">Aplicado (R$)</th><th class="af-num">% carteira</th><th class="af-num">Resgatado (R$)</th><th class="af-num">% carteira</th><th>Ativos</th></tr>` +
      (clientes.map(c => {
        const t = c.pat && c.pat.valor;
        return `<tr><td style="font-weight:600;"><a href="#" onclick="hoFiltrarCliente('${esc(c.k)}');return false;">${esc(c.cliente)}</a></td>
          <td class="af-num" title="${esc(c.pat ? 'Fonte: ' + c.pat.fonte : 'Sem carteira guardada')}">${t ? brl(t) : '<span class="td-na">—</span>'}
            <a href="#" class="af-sub" onclick="hoPatrimonio('${esc(c.k)}');return false;">${t ? 'alterar' : 'informar'}</a></td>
          <td class="af-num">${c.aplicado ? brl(c.aplicado) : '—'}</td><td class="af-num">${t && c.aplicado ? pct(c.aplicado / t) : '—'}</td>
          <td class="af-num">${c.resgatado ? brl(c.resgatado) : '—'}${c.totais ? ' <span class="af-tag">+ resgate total</span>' : ''}</td><td class="af-num">${t && c.resgatado ? pct(c.resgatado / t) : '—'}</td>
          <td class="af-sub" style="white-space:normal;min-width:200px;">${esc([...c.ativos].join(' · '))}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="td-na">Nada neste filtro.</td></tr>');
    document.getElementById('hoSemPat').textContent = semPat
      ? `${semPat} cliente(s) sem patrimônio: guarde a carteira em Análise de Fundos → Carteiras dos clientes, ou clique em "informar".` : '';

    document.getElementById('hoAtivos').innerHTML =
      `<tr><th>Ativo</th><th>CNPJ / código</th><th class="af-num">Clientes</th><th class="af-num">Aplicado (R$)</th><th class="af-num">Resgatado (R$)</th></tr>` +
      (ativos.map(a => `<tr><td class="af-nome">${esc(a.ativo)}</td><td>${esc(a.cnpj)}</td><td class="af-num">${a.clientes.size}</td>
        <td class="af-num">${a.aplicado ? brl(a.aplicado) : '—'}</td><td class="af-num">${a.resgatado ? brl(a.resgatado) : '—'}</td></tr>`).join('') ||
       '<tr><td colspan="5" class="td-na">Nada neste filtro.</td></tr>');

    document.getElementById('hoTabela').innerHTML =
      `<tr><th>Data</th><th>Cliente</th><th>Instituição</th><th>Operação</th><th>Ativo</th><th class="af-num">Valor (R$)</th><th class="af-num">% carteira</th><th></th></tr>` +
      (ls.map(l => {
        const p = patrimonioDe(l), v = valorDe(l);
        const valor = l.total ? (v ? brl(v) + ' <span class="af-tag" title="Resgate total: posição pela carteira guardada">total, estimado</span>' : '<span class="af-tag">Resgate total</span>') : (v ? brl(v) : '<span class="td-na">sem valor</span>');
        return `<tr><td>${dataBr(l.data)}</td><td>${esc(l.cliente)}${l.conta ? `<div class="af-sub">conta ${esc(l.conta)}</div>` : ''}</td><td>${esc(l.instituicao)}</td>
          <td class="${l.operacao === 'resgate' ? 'td-neg' : ''}">${OP_NOME[l.operacao] || esc(l.operacao)}</td>
          <td class="af-nome">${esc(l.ativo)}${l.cnpj ? `<div class="af-sub">${esc(l.cnpj)}${l.liquidez ? ' · ' + esc(l.liquidez) : ''}</div>` : ''}</td>
          <td class="af-num">${valor}</td><td class="af-num" title="${esc(p ? 'Patrimônio R$ ' + brl(p.valor) + ', ' + p.fonte : '')}">${p && v ? pct(v / p.valor) : '—'}</td>
          <td><a href="#" class="af-sub" style="color:var(--err-text);" onclick="hoRemover('${l.id}');return false;">remover</a></td></tr>`;
      }).join('') || '<tr><td colspan="8" class="td-na">Nenhuma ordem neste filtro.</td></tr>');
  }

  function hoFiltrarCliente(k) {
    const sel = document.getElementById('hoCliente');
    sel.value = sel.value === k ? '' : k;
    render();
  }

  async function hoPatrimonio(k) {
    const l = S.dados.linhas.find(x => normNome(x.cliente) === k);
    if (!l) return;
    const atual = S.dados.patrimonio[k];
    const r = prompt(`Patrimônio de ${l.cliente} para o % da carteira em ${tmNomeMes(S.mes)} (R$). Deixe vazio para voltar a usar a carteira guardada.`,
      atual && atual.valor ? brl(atual.valor) : '');
    if (r === null) return;
    const v = moParseValor(r);
    try {
      await alterarMes(S.mes, d => {
        if (v > 0) d.patrimonio[k] = { valor: v, ref: new Date().toLocaleDateString('pt-BR') };
        else delete d.patrimonio[k];
      });
    } catch (e) { alert('Não consegui salvar: ' + e.message); }
  }

  async function hoRemover(id) {
    const l = S.dados.linhas.find(x => x.id === id);
    if (!l || !confirm(`Remover do histórico: ${OP_NOME[l.operacao] || l.operacao} de ${l.ativo} para ${l.cliente} em ${dataBr(l.data)}?`)) return;
    try {
      await alterarMes(S.mes, d => {
        d.linhas = d.linhas.filter(x => x.id !== id);
        if (!d.removidas.includes(chave(l))) d.removidas.push(chave(l));  // não volta na sincronização
      });
    }
    catch (e) { alert('Não consegui salvar: ' + e.message); }
  }

  // Ordens da lista "Ordens enviadas ao banco" (msgLib.ordens: as pendentes e as concluídas dos
  // últimos 30 dias) que ainda não estão no histórico. Roda sozinha ao abrir a aba; só acrescenta,
  // nunca altera linhas existentes nem traz de volta as que foram removidas aqui.
  async function hoSincronizar() {
    if (window.msgLibPronta) { try { await window.msgLibPronta; } catch (e) { /* segue com o que houver */ } }
    const ordens = (typeof msgLib !== 'undefined' && msgLib && msgLib.ordens) || [];
    if (!ordens.length) return 0;
    await carteiras();
    const porMes = {};
    ordens.forEach(o => {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(o.data || '');
      if (!m) return;
      const dataIso = `${m[3]}-${m[2]}-${m[1]}`;
      const cart = carteiraDe(o.cliente);
      (o.ativos || []).forEach(a => {
        if (!a.nome) return;  // sem valor também entra (ex.: compra sem valor anotado), para a ordem aparecer
        const l = { id: novoId(), grupo: ['c', dataIso, o.operacao, o.instituicao || '', normNome(o.cliente)].join('|'),
                    data: dataIso, cliente: o.cliente, conta: '', instituicao: o.instituicao || '',
                    operacao: a.operacao || (o.operacao === 'resgate' ? 'resgate' : 'compra'), ativo: a.nome, cnpj: a.cnpj || '', liquidez: a.liquidez || '',
                    valor: a.total ? 0 : a.valor || 0, total: !!a.total,
                    patrimonio: cart ? totalCart(cart) : null, patrimonio_ref: cart ? (cart.ref || '') : '',
                    registrada_em: o.criada_em || new Date().toISOString(), por: 'ordens enviadas ao banco', ordem_id: o.id || '' };
        if (a.total) { const pos = posicaoNaCarteira(cart, a.cnpj, a.nome); if (pos) l.valor_estimado = pos; }
        (porMes[dataIso.slice(0, 7)] = porMes[dataIso.slice(0, 7)] || []).push(l);
      });
    });
    let n = 0;
    for (const [mes, novas] of Object.entries(porMes)) {
      // Lê antes para não regravar o mês quando não há nada novo
      const atual = await lerMes(mes);
      const tem = new Set(atual.linhas.map(chave).concat(atual.removidas));
      const faltam = novas.filter(l => !tem.has(chave(l)) && tem.add(chave(l)));
      if (!faltam.length) continue;
      await alterarMes(mes, d => {
        const ja = new Set(d.linhas.map(chave).concat(d.removidas));
        faltam.forEach(l => { if (!ja.has(chave(l))) { d.linhas.push(l); ja.add(chave(l)); n++; } });
      });
    }
    return n;
  }

  function hoExportar() {
    const ls = filtradas();
    if (!ls.length) { showFb2('hoFb', 'Nada para exportar neste filtro.', 'error'); return; }
    const ordens = ls.map(l => {
      const p = patrimonioDe(l), v = valorDe(l);
      return { Data: dataBr(l.data), Cliente: l.cliente, Conta: l.conta || '', 'Instituição': l.instituicao,
               'Operação': OP_NOME[l.operacao] || l.operacao, Ativo: l.ativo, 'CNPJ / código': l.cnpj, Liquidez: l.liquidez || '',
               'Valor (R$)': l.total && !v ? 'Resgate total' : v, 'Resgate total': l.total ? 'sim' : '',
               'Patrimônio (R$)': p ? p.valor : '', '% da carteira': p && v ? v / p.valor : '', 'Fonte do patrimônio': p ? p.fonte : '' };
    });
    const clientes = porCliente(ls).map(c => {
      const t = c.pat && c.pat.valor;
      return { Cliente: c.cliente, 'Instituições': [...c.inst].join(', '), 'Patrimônio (R$)': t || '',
               'Aplicado (R$)': c.aplicado, '% aplicado': t && c.aplicado ? c.aplicado / t : '', 'Resgatado (R$)': c.resgatado,
               '% resgatado': t && c.resgatado ? c.resgatado / t : '', 'Líquido (R$)': c.aplicado - c.resgatado, Ativos: [...c.ativos].join(' · ') };
    });
    const ativos = porAtivo(ls).map(a => ({ Ativo: a.ativo, 'CNPJ / código': a.cnpj, Clientes: a.clientes.size,
                                             'Aplicado (R$)': a.aplicado, 'Resgatado (R$)': a.resgatado }));
    const wb = XLSX.utils.book_new();
    const aba = (linhas, nome, moeda, pcts) => {
      const ws = XLSX.utils.json_to_sheet(linhas);
      const cab = Object.keys(linhas[0] || {});
      for (let r = 1; r <= linhas.length; r++) cab.forEach((h, c) => {
        const cel = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cel || typeof cel.v !== 'number') return;
        if (moeda.includes(h)) cel.z = '#,##0.00'; else if (pcts.includes(h)) cel.z = '0.0%';
      });
      ws['!cols'] = cab.map(h => ({ wch: Math.max(12, Math.min(48, h.length + 4, ...linhas.map(x => String(x[h] == null ? '' : x[h]).length + 2))) }));
      XLSX.utils.book_append_sheet(wb, ws, nome);
    };
    const M = ['Valor (R$)', 'Patrimônio (R$)', 'Aplicado (R$)', 'Resgatado (R$)', 'Líquido (R$)'];
    const P = ['% da carteira', '% aplicado', '% resgatado'];
    aba(clientes, 'Por cliente', M, P);
    aba(ativos, 'Por ativo', M, P);
    aba(ordens, 'Ordens', M, P);
    XLSX.writeFile(wb, `Historico de ordens ${S.mes}.xlsx`);
  }

  Object.assign(window, { hoInit, hoMes, hoRender: render, hoFiltrarCliente, hoPatrimonio, hoRemover, hoSincronizar, hoExportar, hoRegistrarOrdem });
})();
