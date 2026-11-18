/* Aba "Análise de Fundos" do admin (eh-cliente-dashboard.html).
 *
 * Lê AAAA-MM/analise_fundos.json do bucket privado tarefas-mensais (gerado pela tarefa
 * mensal analise_fundos.py: rentabilidade mês a mês dos fundos de renda fixa e FIDCs pela
 * CVM e o CDI do Banco Central) e calcula aqui os indicadores: YTD, 12, 24 e 36 meses,
 * % do CDI, volatilidade, Sharpe, drawdown e meses abaixo do CDI.
 *
 * Também guarda no bucket (config/) as listas de fundos de cada plataforma (XP, BTG...)
 * e as estratégias de alocação montadas aqui.
 *
 * Usa do dashboard: sb (Supabase), escHtml, TM_BUCKET, tmNomeMes e XLSX (SheetJS).
 */
(function () {
  const ARQ_DADOS = 'analise_fundos.json';
  const ARQ_PLATS = 'config/plataformas.json';
  const ARQ_ESTR = 'config/estrategias_fundos.json';
  const MAX_LINHAS = 300;
  const CORES = ['#2a78d6', '#eb6834', '#1baf7a'];   // até 3 estratégias no gráfico; CDI em cinza tracejado
  const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  const S = {
    iniciado: false, mes: null, dados: null, fundos: [], porId: {},
    plats: { plataformas: {} }, estr: { estrategias: [] },
    ordem: { col: 'r12', dir: -1 }, sel: null, editando: null, comparar: new Set(), janela: 36,
  };
  window.AF = S;  // para inspecionar no console

  // ── utilidades ──
  const dig = s => String(s == null ? '' : s).replace(/\D/g, '');
  const fmtCnpj = c => c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c;
  const pct = (x, d = 2) => x == null || !isFinite(x) ? '—' : (Math.abs(x) < 0.5 * Math.pow(10, -d - 2) ? 0 : x * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  const pctCdi = x => x == null || !isFinite(x) ? '—' : (Math.abs(x) < 0.00005 ? 0 : x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  const num = (x, d = 2) => x == null || !isFinite(x) ? '—' : x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const mi = x => x == null ? '—' : (x / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: x >= 1e8 ? 0 : 1 });
  const mesCurto = m => { const [a, mm] = m.split('-'); return `${MESES_CURTOS[+mm - 1]}/${a.slice(2)}`; };
  const id = f => f.c + (f.s ? '|' + f.s : '');
  const esc = s => escHtml(s == null ? '' : String(s));

  // ── indicadores ──
  // r e cdi alinhados por mês (null = sem dado). fim = índice do último mês da janela.
  function janela(r, cdi, fim, n) {
    const ini = fim - n + 1;
    if (ini < 0) return null;
    let fr = 1, fc = 1;
    const rs = [], cs = [];
    for (let i = ini; i <= fim; i++) {
      if (r[i] == null || cdi[i] == null) return null;
      fr *= 1 + r[i]; fc *= 1 + cdi[i];
      rs.push(r[i]); cs.push(cdi[i]);
    }
    const ret = fr - 1, rc = fc - 1;
    const out = { ret, cdi: rc, pc: rc > 0 ? ret / rc : null };
    if (n >= 6) {
      const anos = n / 12;
      const ra = Math.pow(fr, 1 / anos) - 1, rca = Math.pow(fc, 1 / anos) - 1;
      const media = rs.reduce((a, b) => a + b, 0) / n;
      const dp = Math.sqrt(rs.reduce((a, b) => a + (b - media) ** 2, 0) / (n - 1));
      out.vol = dp * Math.sqrt(12);
      out.sharpe = out.vol > 1e-6 ? (ra - rca) / out.vol : null;
      let pico = 1, acc = 1, dd = 0;
      rs.forEach(x => { acc *= 1 + x; pico = Math.max(pico, acc); dd = Math.min(dd, acc / pico - 1); });
      out.dd = dd;
      out.abaixo = rs.filter((x, i) => x < cs[i]).length;
      out.pior = Math.min(...rs);
    }
    return out;
  }

  // Indicadores de uma série: a janela termina no último mês com dado (FIDCs saem com
  // ~15 dias de atraso, então podem estar um mês atrás); "defas" marca isso.
  function indicadores(r) {
    const cdi = S.dados.cdi, meses = S.dados.meses;
    let fim = r.length - 1;
    while (fim >= 0 && r[fim] == null) fim--;
    if (fim < 0) return { fim: -1 };
    const anoFim = meses[fim].slice(0, 4);
    let nYtd = 0;
    for (let i = fim; i >= 0 && meses[i].slice(0, 4) === anoFim; i--) nYtd++;
    const o = { fim, defas: fim < meses.length - 1 ? meses[fim] : null };
    o.ytd = janela(r, cdi, fim, nYtd);
    o.j12 = janela(r, cdi, fim, 12);
    o.j24 = janela(r, cdi, fim, 24);
    o.j36 = janela(r, cdi, fim, 36);
    o.m1 = r[fim];
    o.m1c = cdi[fim];
    return o;
  }

  // Colunas da tabela: chave de ordenação, título, valor e formatação
  const COLS = [
    { k: 'n', t: 'Fundo', v: f => f.n, fmt: null },
    { k: 'pl', t: 'PL (R$ mi)', v: f => f.pl, fmt: f => mi(f.pl) },
    { k: 'ct', t: 'Cotistas', v: f => f.ct, fmt: f => f.ct ? f.ct.toLocaleString('pt-BR') : '—' },
    { k: 'lq', t: 'Liquidez', v: f => f.liq && f.liq.dias, fmt: f => f.liq && f.liq.fonte ? `<span title="Fonte: ${esc(f.liq.fonte)}">${esc(f.liq.txt)}</span>` : '—' },
    { k: 'm1', t: 'Mês', v: f => f.ind.m1, fmt: f => pct(f.ind.m1), cmp: f => [f.ind.m1, f.ind.m1c] },
    { k: 'ytd', t: 'YTD', v: f => f.ind.ytd && f.ind.ytd.ret, fmt: f => pct(f.ind.ytd && f.ind.ytd.ret), cmp: f => f.ind.ytd && [f.ind.ytd.ret, f.ind.ytd.cdi] },
    { k: 'pytd', t: '% CDI YTD', v: f => f.ind.ytd && f.ind.ytd.pc, fmt: f => pctCdi(f.ind.ytd && f.ind.ytd.pc), pc: true },
    { k: 'r12', t: '12m', v: f => f.ind.j12 && f.ind.j12.ret, fmt: f => pct(f.ind.j12 && f.ind.j12.ret), cmp: f => f.ind.j12 && [f.ind.j12.ret, f.ind.j12.cdi] },
    { k: 'p12', t: '% CDI 12m', v: f => f.ind.j12 && f.ind.j12.pc, fmt: f => pctCdi(f.ind.j12 && f.ind.j12.pc), pc: true },
    { k: 'r24', t: '24m', v: f => f.ind.j24 && f.ind.j24.ret, fmt: f => pct(f.ind.j24 && f.ind.j24.ret), cmp: f => f.ind.j24 && [f.ind.j24.ret, f.ind.j24.cdi] },
    { k: 'p24', t: '% CDI 24m', v: f => f.ind.j24 && f.ind.j24.pc, fmt: f => pctCdi(f.ind.j24 && f.ind.j24.pc), pc: true },
    { k: 'r36', t: '36m', v: f => f.ind.j36 && f.ind.j36.ret, fmt: f => pct(f.ind.j36 && f.ind.j36.ret), cmp: f => f.ind.j36 && [f.ind.j36.ret, f.ind.j36.cdi] },
    { k: 'p36', t: '% CDI 36m', v: f => f.ind.j36 && f.ind.j36.pc, fmt: f => pctCdi(f.ind.j36 && f.ind.j36.pc), pc: true },
    { k: 'vol', t: 'Vol 12m', v: f => f.ind.j12 && f.ind.j12.vol, fmt: f => pct(f.ind.j12 && f.ind.j12.vol) },
    { k: 's12', t: 'Sharpe 12m', v: f => f.ind.j12 && f.ind.j12.sharpe, fmt: f => num(f.ind.j12 && f.ind.j12.sharpe) },
    { k: 's36', t: 'Sharpe 36m', v: f => f.ind.j36 && f.ind.j36.sharpe, fmt: f => num(f.ind.j36 && f.ind.j36.sharpe) },
    { k: 'dd', t: 'Drawdown 36m', v: f => { const j = f.ind.j36 || f.ind.j24 || f.ind.j12; return j && j.dd; }, fmt: f => { const j = f.ind.j36 || f.ind.j24 || f.ind.j12; return pct(j && j.dd); } },
    { k: 'ab', t: 'Meses < CDI (12m)', v: f => f.ind.j12 && f.ind.j12.abaixo, fmt: f => f.ind.j12 ? String(f.ind.j12.abaixo) : '—' },
    { k: 'cap', t: 'Captação último mês (R$ mi)', v: f => f.cap, fmt: f => f.cap == null ? '—' : mi(f.cap) },
    { k: 'pf', t: 'Plataformas', v: f => f.plats.length, fmt: null },
  ];

  // ── liquidez ──
  // Ordem: catálogo de ativos da EH (eh-ativos-catalogo.js) → lista da plataforma (ex.: BTG
  // "Liquidez (pagamento do resgate)") → extrato de informações da CVM (tarefa mensal).
  let catalogoLiq = null;
  function liqCatalogo(c) {
    if (!catalogoLiq) {
      catalogoLiq = {};
      (window.EH_ATIVOS_CATALOGO || []).forEach(a => { const k = dig(a[0]); if (k.length === 14 && a[2]) catalogoLiq[k] = String(a[2]); });
    }
    return catalogoLiq[c] || null;
  }
  function diasLiq(txt) {
    const m = /D\s*\+\s*(\d+)/i.exec(txt || '');
    if (m) return +m[1];
    return /venc/i.test(txt || '') ? 99999 : null;
  }
  function liquidez(f) {
    const cat = liqCatalogo(f.c);
    if (cat) return { txt: cat.replace(/D\s*\+\s*/i, 'D+'), dias: diasLiq(cat), fonte: 'catálogo da EH' };
    for (const p of f.plats) {
      const meta = S.plats.plataformas[p].fundos[f.c] || {};
      const k = Object.keys(meta).find(x => /liquidez|pagamento do resgate/i.test(x));
      if (k && diasLiq(meta[k]) != null) {
        const kc = Object.keys(meta).find(x => /cotiza.*resgate/i.test(x));
        return { txt: meta[k].replace(/D\s*\+\s*/i, 'D+'), dias: diasLiq(meta[k]), fonte: `lista ${p}` + (kc ? ` (cotização ${meta[kc]})` : '') };
      }
    }
    if (f.lq && f.lq[1] != null) {
      return { txt: 'D+' + f.lq[1], dias: f.lq[1], fonte: 'CVM' + (f.lq[0] != null ? ` (cotização D+${f.lq[0]})` : '') };
    }
    return { txt: '—', dias: null, fonte: '' };
  }

  // ── carregar ──
  async function baixarJson(caminho) {
    const { data, error } = await sb.storage.from(TM_BUCKET).download(caminho);
    if (error || !data) return null;
    try { return JSON.parse(await data.text()); } catch (e) { return null; }
  }

  async function enviarJson(caminho, obj) {
    const corpo = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const { error } = await sb.storage.from(TM_BUCKET).upload(caminho, corpo, { upsert: true, contentType: 'application/json' });
    if (error) throw new Error(error.message);
  }

  async function afInit() {
    if (S.iniciado) return;
    S.iniciado = true;
    try { const a = localStorage.getItem('eh-af-aba'); if (a) afAba(a); } catch (e) {}
    const sel = document.getElementById('afMes');
    const { data, error } = await sb.storage.from(TM_BUCKET).list('', { limit: 200, sortBy: { column: 'name', order: 'desc' } });
    if (error) { msgTabela(`Não consegui ler o bucket: ${esc(error.message)}`, 'td-neg'); S.iniciado = false; return; }
    const meses = (data || []).map(i => i.name).filter(n => /^\d{4}-\d{2}$/.test(n)).sort().reverse();
    const comDados = [];
    for (const m of meses) {
      const { data: arqs } = await sb.storage.from(TM_BUCKET).list(m, { limit: 200, search: ARQ_DADOS });
      if ((arqs || []).some(a => a.name === ARQ_DADOS)) comDados.push(m);
      if (comDados.length >= 12) break;
    }
    [S.plats, S.estr] = await Promise.all([baixarJson(ARQ_PLATS), baixarJson(ARQ_ESTR)]);
    S.plats = S.plats && S.plats.plataformas ? S.plats : { plataformas: {} };
    S.estr = S.estr && S.estr.estrategias ? S.estr : { estrategias: [] };
    renderPlats();
    if (!comDados.length) {
      sel.innerHTML = '<option value="">Ainda sem dados</option>';
      msgTabela('A tarefa "Análise de fundos (CVM)" ainda não rodou. Rode no GitHub (Tarefas Mensais → Rodar agora, tarefa analise_fundos); leva uns 15 a 25 minutos.', 'td-na');
      return;
    }
    sel.innerHTML = comDados.map(m => `<option value="${m}">${tmNomeMes(m)}</option>`).join('');
    const q = new URLSearchParams(location.search);
    const mesQ = comDados.includes(q.get('mes')) ? q.get('mes') : comDados[0];
    sel.value = mesQ;
    await afCarregar(mesQ);
    if (q.get('fundo')) paginaFundo(q.get('fundo'));
  }

  async function afCarregar(mes) {
    if (!mes) return;
    msgTabela('Carregando…', 'td-na');
    const d = await baixarJson(`${mes}/${ARQ_DADOS}`);
    if (!d) { msgTabela('Não consegui ler os dados deste mês.', 'td-neg'); return; }
    S.mes = mes; S.dados = d;
    S.fundos = d.fundos.map(f => ({ ...f, id: id(f), ind: indicadores(f.r) }));
    S.porId = {};
    S.fundos.forEach(f => { S.porId[f.id] = f; });
    marcarPlats();
    renderResumo();
    afFiltrar();
    renderEstrategias();
  }

  function marcarPlats() {
    const P = S.plats.plataformas;
    S.fundos.forEach(f => {
      f.plats = Object.keys(P).filter(nome => P[nome].fundos && P[nome].fundos[f.c]);
      f.liq = liquidez(f);
    });
    const sel = document.getElementById('afPlat');
    const atual = sel.value;
    sel.innerHTML = '<option value="">Todas</option><option value="*">Em alguma lista</option>' +
      Object.keys(P).map(n => `<option value="${esc(n)}">Só ${esc(n)}</option>`).join('');
    sel.value = [...sel.options].some(o => o.value === atual) ? atual : '';
  }

  function renderResumo() {
    const d = S.dados, cdi = d.cdi;
    const fim = d.meses.length - 1;
    const um = (n) => janela(cdi, cdi, fim, n);
    let nYtd = 0;
    for (let i = fim; i >= 0 && d.meses[i].slice(0, 4) === d.meses[fim].slice(0, 4); i--) nYtd++;
    const chips = [
      ['Dados até', mesCurto(d.meses[fim])],
      ['CDI no mês', pct(cdi[fim])],
      ['CDI YTD', pct(um(nYtd) && um(nYtd).ret)],
      ['CDI 12m', pct(um(12) && um(12).ret)],
      ['CDI 24m', pct(um(24) && um(24).ret)],
      ['CDI 36m', pct(um(36) && um(36).ret)],
      ['Fundos', S.fundos.length.toLocaleString('pt-BR')],
    ];
    document.getElementById('afResumo').innerHTML = chips.map(([a, b]) => `<div class="ext-chip">${a}<span>${b}</span></div>`).join('') +
      `<div class="ext-chip">Gerado em<span>${esc(new Date(d.gerado_em).toLocaleDateString('pt-BR'))}</span></div>`;
  }

  // ── filtros e tabela ──
  function filtrados() {
    const q = (document.getElementById('afBusca').value || '').trim().toLowerCase();
    const qd = dig(q);
    const tipo = document.getElementById('afTipo').value;
    const pub = document.getElementById('afPublico').value;
    const plat = document.getElementById('afPlat').value;
    const plMin = parseFloat(document.getElementById('afPlMin').value || '0') * 1e6;
    const liqTxt = (document.getElementById('afLiqMax').value || '').trim();
    const liqMax = liqTxt === '' ? null : parseInt(liqTxt, 10);
    const acima = document.getElementById('afAcima').checked;
    const capt = document.getElementById('afCapt').checked;
    const aberto = document.getElementById('afAberto').checked;
    return S.fundos.filter(f => {
      if (q && !(f.n.toLowerCase().includes(q) || (f.ns || '').toLowerCase().includes(q) || (f.g || '').toLowerCase().includes(q) || (qd.length >= 4 && f.c.includes(qd)))) return false;
      if (tipo && f.t !== tipo) return false;
      if (pub === 'G' && f.p !== 'G') return false;
      if (pub === 'Q' && !(f.p === 'G' || f.p === 'Q')) return false;
      if (pub === 'SQ' && f.p !== 'Q') return false;
      if (plat === '*' && !f.plats.length) return false;
      if (plat && plat !== '*' && !f.plats.includes(plat)) return false;
      if (f.pl < plMin) return false;
      if (liqMax != null && !(f.liq && f.liq.dias != null && f.liq.dias <= liqMax)) return false;
      if (acima && !(f.ind.j12 && f.ind.j12.ret > f.ind.j12.cdi)) return false;
      if (capt && !(f.cap > 0)) return false;
      if (aberto && !f.plats.some(p => abertoNa(f, p) === true)) return false;
      return true;
    });
  }

  // Situação "aberto para aplicação" numa plataforma, se a lista enviada tiver essa coluna
  function abertoNa(f, plat) {
    const meta = (S.plats.plataformas[plat].fundos || {})[f.c] || {};
    const k = Object.keys(meta).find(x => /aberto|aplica/i.test(x) && !/cotiza|hor/i.test(x));
    if (!k) return null;
    return /^\s*sim/i.test(meta[k]);
  }

  function afFiltrar() {
    if (!S.dados) return;
    const lista = filtrados();
    const col = COLS.find(c => c.k === S.ordem.col) || COLS[0];
    const dir = S.ordem.dir;
    lista.sort((a, b) => {
      const va = col.v(a), vb = col.v(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return typeof va === 'string' ? dir * va.localeCompare(vb, 'pt-BR') : dir * (va - vb);
    });
    S.lista = lista;
    renderTabela();
  }

  function msgTabela(txt, cls) {
    document.getElementById('afTabela').innerHTML = `<tr><td class="${cls}" style="white-space:normal;">${txt}</td></tr>`;
  }

  function celulaPlats(f) {
    return f.plats.map(p => {
      const ab = abertoNa(f, p);
      const meta = S.plats.plataformas[p].fundos[f.c] || {};
      const dica = Object.entries(meta).filter(([k]) => k !== 'n').map(([k, v]) => `${k}: ${v}`).join('\n');
      const cls = ab === false ? 'af-tag af-tag-off' : 'af-tag';
      return `<span class="${cls}" title="${esc(dica)}">${esc(p)}${ab === false ? ' fechado' : ''}</span>`;
    }).join(' ') || '<span class="td-na">—</span>';
  }

  function renderTabela() {
    const lista = S.lista;
    const tab = document.getElementById('afTabela');
    document.getElementById('afContagem').textContent =
      `${lista.length.toLocaleString('pt-BR')} fundos` + (lista.length > MAX_LINHAS ? ` (mostrando os ${MAX_LINHAS} primeiros; use os filtros ou baixe o Excel)` : '');
    if (!lista.length) { msgTabela('Nenhum fundo com esses filtros.', 'td-na'); return; }
    const est = S.editando;
    const cab = '<tr>' + COLS.map(c =>
      `<th class="af-th${c.k === 'n' ? ' af-fixa' : ''}" onclick="afOrdenar('${c.k}')">${c.t}${S.ordem.col === c.k ? (S.ordem.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('') + '</tr>';
    const linhas = lista.slice(0, MAX_LINHAS).map(f => {
      const nome = `<div class="af-nome"><a href="${linkFundo(f.id)}" onclick="return afClique(event, '${f.id}')">${esc(f.n)}</a>` +
        (f.ns ? `<div class="af-sub">${esc(f.ns)}</div>` : '') +
        `<div class="af-sub">${fmtCnpj(f.c)} · ${f.t}${f.cl && f.cl !== f.t ? ' · ' + esc(f.cl) : ''} · ${f.p === 'G' ? 'Geral' : f.p === 'Q' ? 'Qualificado' : 'Profissional'}${f.g ? ' · ' + esc(f.g) : ''}` +
        (f.ind.defas ? ` · <span class="td-neg">dados até ${mesCurto(f.ind.defas)}</span>` : '') + '</div></div>';
      const marca = est ? `<input type="checkbox" class="af-marca" title="Incluir em ${esc(est.nome)}" ${est.itens.some(i => i.id === f.id) ? 'checked' : ''} onchange="afMarcar('${f.id}', this.checked)">` : '';
      const tds = COLS.map(c => {
        if (c.k === 'n') return `<td class="af-fixa"><div class="af-nome-linha">${marca}${nome}</div></td>`;
        if (c.k === 'pf') return `<td>${celulaPlats(f)}</td>`;
        let cls = '';
        if (c.pc) { const v = c.v(f); cls = v == null ? 'td-na' : v >= 1 ? 'td-pos' : 'td-neg'; }
        else if (c.cmp) { const p = c.cmp(f); cls = !p || p[0] == null ? 'td-na' : p[0] >= p[1] ? 'td-pos' : 'td-neg'; }
        return `<td class="af-num ${cls}">${c.fmt(f)}</td>`;
      }).join('');
      return `<tr class="${S.sel === f.id ? 'af-sel' : ''}">${tds}</tr>`;
    }).join('');
    tab.innerHTML = cab + linhas;
    barraEdicao();
  }

  // Faixa no topo da aba Fundos enquanto uma estratégia está sendo montada
  function barraEdicao() {
    const el = document.getElementById('afBarraEdicao');
    if (!el) return;
    const e = S.editando;
    el.style.display = e ? '' : 'none';
    if (e) el.innerHTML = `Montando <strong>${esc(e.nome)}</strong> · ${e.itens.length} fundo(s). Marque a caixinha ao lado do nome para incluir. ` +
      `<a href="#" onclick="afAba('estrategias');return false;">Ver pesos e indicadores →</a> · <a href="#" onclick="afEditar('${e.id}');return false;">concluir</a>`;
  }

  // Sub-abas da tela: fundos, estratégias e listas das plataformas
  function afAba(nome) {
    document.querySelectorAll('#view-fundos .af-aba').forEach(d => d.classList.toggle('active', d.id === 'afAba-' + nome));
    document.querySelectorAll('#view-fundos .af-aba-btn').forEach(b => b.classList.toggle('active', b.dataset.aba === nome));
    try { localStorage.setItem('eh-af-aba', nome); } catch (e) {}
  }

  // Tela inteira: esconde menu e topo e usa a tela cheia do navegador
  function afTelaInteira(abrir) {
    if (abrir === undefined) abrir = !document.body.classList.contains('af-cheia');
    document.body.classList.toggle('af-cheia', abrir);
    const cheio = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (abrir && !cheio) {
        const el = document.documentElement, pedir = el.requestFullscreen || el.webkitRequestFullscreen;
        const pr = pedir ? pedir.call(el) : null;
        if (pr && pr.catch) pr.catch(() => {});
      } else if (!abrir && cheio) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } catch (e) {}
    const b = document.getElementById('afBtnCheia');
    if (b) b.textContent = abrir ? 'Sair da tela inteira' : 'Tela inteira';
  }
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    if (document.getElementById('afModal').classList.contains('aberto')) afFecharDetalhe();
    else if (document.body.classList.contains('af-cheia')) afTelaInteira(false);
  });
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(n => document.addEventListener(n, () => {
    if (!(document.fullscreenElement || document.webkitFullscreenElement) && document.body.classList.contains('af-cheia')) afTelaInteira(false);
  }));

  function afOrdenar(k) {
    if (S.ordem.col === k) S.ordem.dir = -S.ordem.dir;
    else S.ordem = { col: k, dir: k === 'n' || k === 'vol' || k === 'ab' ? 1 : -1 };
    afFiltrar();
  }

  // ── detalhe: rentabilidade mês a mês ──
  function gradeMensal(r) {
    const meses = S.dados.meses, cdi = S.dados.cdi;
    const anos = [...new Set(meses.map(m => m.slice(0, 4)))].sort().reverse();
    let h = '<tr><th>Ano</th>' + MESES_CURTOS.map(m => `<th>${m}</th>`).join('') + '<th>Ano</th><th>CDI ano</th></tr>';
    anos.forEach(a => {
      let fa = 1, fc = 1, completo = true, algum = false;
      const tds = MESES_CURTOS.map((_, i) => {
        const k = meses.indexOf(`${a}-${String(i + 1).padStart(2, '0')}`);
        if (k < 0) { return '<td class="td-na">·</td>'; }
        if (r[k] == null) { completo = false; return '<td class="td-na">—</td>'; }
        fa *= 1 + r[k]; fc *= 1 + cdi[k]; algum = true;
        const pc = cdi[k] > 0 ? r[k] / cdi[k] : null;
        const cls = r[k] < 0 ? 'td-neg' : r[k] >= cdi[k] ? 'td-pos' : '';
        return `<td class="af-num ${cls}">${pct(r[k])}<div class="af-sub">${pctCdi(pc)} CDI</div></td>`;
      }).join('');
      if (!algum) { h += `<tr><th>${a}</th>${tds}<td class="td-na">—</td><td class="td-na">—</td></tr>`; return; }
      const pcA = fc > 1 ? (fa - 1) / (fc - 1) : null;
      const dica = completo ? '' : ' title="Só os meses com dado; o CDI do ano é dos mesmos meses"';
      h += `<tr><th>${a}</th>${tds}<td class="af-num" style="font-weight:700;"${dica}>${completo ? '' : '*'}${pct(fa - 1)}<div class="af-sub">${pctCdi(pcA)} CDI</div></td><td class="af-num"${dica}>${pct(fc - 1)}</td></tr>`;
    });
    return h;
  }

  function cartoesIndicadores(ind) {
    const linha = (rot, j) => j ? `<tr><th>${rot}</th><td class="af-num">${pct(j.ret)}</td><td class="af-num">${pct(j.cdi)}</td><td class="af-num ${j.pc >= 1 ? 'td-pos' : 'td-neg'}">${pctCdi(j.pc)}</td>` +
      `<td class="af-num">${pct(j.vol)}</td><td class="af-num">${num(j.sharpe)}</td><td class="af-num">${pct(j.dd)}</td><td class="af-num">${j.abaixo == null ? '—' : j.abaixo}</td><td class="af-num">${pct(j.pior)}</td></tr>`
      : `<tr><th>${rot}</th><td class="td-na" colspan="8">sem histórico suficiente</td></tr>`;
    return '<tr><th></th><th>Retorno</th><th>CDI</th><th>% CDI</th><th>Vol. anual</th><th>Sharpe</th><th>Drawdown</th><th>Meses &lt; CDI</th><th>Pior mês</th></tr>' +
      linha('YTD', ind.ytd) + linha('12 meses', ind.j12) + linha('24 meses', ind.j24) + linha('36 meses', ind.j36);
  }

  // Endereço da ficha do fundo: abre numa aba própria (clique com o scroll ou Ctrl+clique)
  function linkFundo(fid) {
    const q = new URLSearchParams({ fundo: fid, mes: S.mes || '' });
    return `${location.pathname}?${q.toString()}#fundos`;
  }

  // Clique normal abre o painel; Ctrl/Cmd/Shift+clique deixa o navegador abrir em outra aba
  function afClique(ev, fid) {
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return true;
    afDetalhe(fid);
    return false;
  }

  function htmlDetalhe(f, pagina) {
    const plats = f.plats.map(p => {
      const meta = S.plats.plataformas[p].fundos[f.c] || {};
      const info = Object.entries(meta).filter(([k]) => k !== 'n').map(([k, v]) => `${esc(k)}: <strong>${esc(v)}</strong>`).join(' · ');
      return `<div><span class="af-tag">${esc(p)}</span> ${info}</div>`;
    }).join('') || '<div class="td-na">Não está em nenhuma lista de plataforma enviada.</div>';
    const incluir = S.editando ? (S.editando.itens.some(i => i.id === f.id) ? '<span class="af-nota" style="margin:0;align-self:center;">Já está na estratégia</span>' : `<button class="btn-download-ext" onclick="afMarcar('${f.id}', true);afDetalhe('${f.id}')">Incluir em ${esc(S.editando.nome)}</button>`) : '';
    const botoes = pagina
      ? `<a class="btn-download-ext" style="text-decoration:none;" href="${location.pathname}#fundos" onclick="return afSairPagina(event)">← Todos os fundos</a>`
      : `${incluir}<a class="btn-download-ext" style="text-decoration:none;" href="${linkFundo(f.id)}" target="_blank" rel="noopener">Abrir em nova aba ↗</a><button class="btn-download-ext" onclick="afFecharDetalhe()">Fechar (Esc)</button>`;
    return `<div class="upload-panel">
      <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;align-items:flex-start;">
        <div><h3 style="margin-bottom:0.3rem;">${esc(f.n)}</h3>
          <div class="af-sub">${f.ns ? esc(f.ns) + ' · ' : ''}${fmtCnpj(f.c)} · ${f.t} · ${esc(f.cl || '')} · ${f.p === 'G' ? 'Público geral' : f.p === 'Q' ? 'Qualificado' : 'Profissional'} · Gestor: ${esc(f.g || '—')}</div>
          <div class="af-sub">Liquidez: <strong>${esc(f.liq ? f.liq.txt : '—')}</strong>${f.liq && f.liq.fonte ? ` (${esc(f.liq.fonte)})` : ''} · PL R$ ${mi(f.pl)} mi · ${f.ct ? f.ct.toLocaleString('pt-BR') + ' cotistas' : 'cotistas não informados'} · último dado ${esc(f.dt)}${f.capm ? ` · captação em ${mesCurto(f.capm)}: R$ ${mi(f.cap)} mi` : ''} · dados de ${mesCurto(S.dados.meses[S.dados.meses.length - 1])}</div>
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">${botoes}</div>
      </div>
      <div style="margin:0.8rem 0;font-size:12px;">${plats}</div>
      <div class="ext-preview-wrap" style="max-height:none;"><table class="ext-preview-table">${cartoesIndicadores(f.ind)}</table></div>
      <h3 style="margin-top:1.2rem;">Rentabilidade mês a mês</h3>
      <div class="ext-preview-wrap" style="max-height:none;"><table class="ext-preview-table af-grade">${gradeMensal(f.r)}</table></div>
      <p class="af-nota">Verde: mês acima do CDI. Abaixo de cada mês, o rendimento em % do CDI. Fonte: cotas de fim de mês da CVM${f.t === 'FIDC' ? ' (informe mensal de FIDC, série sênior quando há)' : ''}.</p>
    </div>`;
  }

  function afDetalhe(fid) {
    const f = S.porId[fid];
    if (!f) return;
    S.sel = fid;
    document.getElementById('afDetalheCorpo').innerHTML = htmlDetalhe(f, false);
    renderTabela();
    const modal = document.getElementById('afModal');
    modal.classList.add('aberto');
    modal.scrollTop = 0;
  }

  function afFecharDetalhe() {
    document.getElementById('afModal').classList.remove('aberto');
    S.sel = null;
    if (S.lista) renderTabela();
  }

  // Aba própria do fundo (endereço com ?fundo=...): só a ficha, sem a tabela
  function paginaFundo(fid) {
    const f = S.porId[fid];
    const el = document.getElementById('afPagina');
    document.body.classList.add('af-pagina');
    el.innerHTML = f ? htmlDetalhe(f, true)
      : `<div class="upload-panel"><p class="td-neg">Não achei esse fundo nos dados deste mês.</p><a class="btn-download-ext" style="text-decoration:none;" href="${location.pathname}#fundos" onclick="return afSairPagina(event)">← Todos os fundos</a></div>`;
    if (f) document.title = f.n + ' · EH Investimentos';
    window.scrollTo(0, 0);
  }

  function afSairPagina(ev) {
    if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0)) return true;
    document.body.classList.remove('af-pagina');
    document.getElementById('afPagina').innerHTML = '';
    history.replaceState(null, '', location.pathname + '#fundos');
    return false;
  }

  // ── listas de plataforma ──
  function renderPlats() {
    const P = S.plats.plataformas;
    const el = document.getElementById('afPlats');
    const linhas = Object.keys(P).map(n => `<tr><td style="font-weight:600;">${esc(n)}</td><td>${Object.keys(P[n].fundos || {}).length} CNPJs</td>` +
      `<td>${P[n].atualizado ? esc(new Date(P[n].atualizado).toLocaleString('pt-BR')) : '—'}</td>` +
      `<td>${esc((P[n].colunas || []).join(', ')) || '—'}</td>` +
      `<td><a href="#" onclick="afRemoverPlat(decodeURIComponent('${encodeURIComponent(n)}'));return false;" style="color:var(--err-text);">remover</a></td></tr>`).join('');
    el.innerHTML = '<tr><th>Plataforma</th><th>Fundos</th><th>Atualizada em</th><th>Informações guardadas</th><th></th></tr>' +
      (linhas || '<tr><td colspan="5" class="td-na">Nenhuma lista enviada ainda.</td></tr>');
  }

  // Lê xlsx/csv com uma coluna de CNPJ; as outras colunas (ex.: "Aberto para aplicação",
  // "Liquidez") ficam guardadas por fundo e aparecem na tabela.
  async function afEnviarPlat(input) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    const nome = (document.getElementById('afPlatNome').value || '').trim();
    if (!nome) { alert('Escreva o nome da plataforma (ex.: XP, BTG) antes de escolher o arquivo.'); return; }
    let linhas;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    } catch (e) { alert('Não consegui ler o arquivo: ' + e.message); return; }
    const ic = linhas.slice(0, 15).map(l => l.findIndex(c => /cnpj/i.test(String(c))));
    const hRow = ic.findIndex(i => i >= 0);
    let cab, iC, corpo;
    if (hRow >= 0) { cab = linhas[hRow].map(c => String(c).trim()); iC = ic[hRow]; corpo = linhas.slice(hRow + 1); }
    else {
      // sem cabeçalho: usa a primeira coluna que tiver CNPJs
      iC = (linhas[0] || []).findIndex(c => dig(c).length === 14);
      if (iC < 0) { alert('Não achei uma coluna de CNPJ no arquivo.'); return; }
      cab = (linhas[0] || []).map((_, i) => i === iC ? 'CNPJ' : `Coluna ${i + 1}`); corpo = linhas;
    }
    const iNome = cab.findIndex((c, i) => i !== iC && /fundo|nome/i.test(c));
    const extras = cab.map((c, i) => i).filter(i => i !== iC && i !== iNome && cab[i] && !/^#$|^n[º°o]?$/i.test(cab[i]));
    const fundos = {};
    corpo.forEach(l => {
      const c = dig(l[iC]).padStart(14, '0');
      if (!/^\d{14}$/.test(c) || /^0+$/.test(c)) return;
      const meta = {};
      if (iNome >= 0 && l[iNome]) meta.n = String(l[iNome]).trim();
      extras.forEach(i => { if (String(l[i]).trim()) meta[cab[i]] = String(l[i]).trim(); });
      fundos[c] = meta;
    });
    const n = Object.keys(fundos).length;
    if (!n) { alert('Nenhum CNPJ válido no arquivo.'); return; }
    const nov = JSON.parse(JSON.stringify(S.plats));
    nov.plataformas[nome] = { atualizado: new Date().toISOString(), arquivo: f.name, colunas: extras.map(i => cab[i]), fundos };
    try { await enviarJson(ARQ_PLATS, nov); } catch (e) { alert('Não consegui salvar: ' + e.message); return; }
    S.plats = nov;
    renderPlats();
    if (S.dados) {
      marcarPlats(); afFiltrar();
      const achados = S.fundos.filter(x => fundos[x.c]).length;
      const semDado = Object.keys(fundos).filter(c => !S.fundos.some(x => x.c === c)).length;
      alert(`${nome}: ${n} CNPJs salvos. ${achados} classes já aparecem na análise; ${semDado} CNPJs não estão nos dados deste mês (entram na próxima execução da tarefa, mesmo se forem de outra classe).`);
    }
  }

  async function afRemoverPlat(nome) {
    if (!confirm(`Remover a lista ${nome}?`)) return;
    const nov = JSON.parse(JSON.stringify(S.plats));
    delete nov.plataformas[nome];
    try { await enviarJson(ARQ_PLATS, nov); } catch (e) { alert('Não consegui salvar: ' + e.message); return; }
    S.plats = nov; renderPlats();
    if (S.dados) { marcarPlats(); afFiltrar(); }
  }

  // ── estratégias de alocação ──
  // Retorno mensal da carteira = soma dos pesos × retornos. Num mês em que um fundo não tem
  // dado, os pesos dos outros são reescalados (e o mês fica marcado como parcial).
  function serieEstrategia(e) {
    const meses = S.dados.meses;
    const itens = e.itens.map(i => ({ ...i, f: S.porId[i.id] })).filter(i => i.f && i.peso > 0);
    const total = itens.reduce((a, i) => a + i.peso, 0);
    const r = [], parcial = [];
    for (let k = 0; k < meses.length; k++) {
      let s = 0, w = 0;
      itens.forEach(i => { if (i.f.r[k] != null) { s += i.peso * i.f.r[k]; w += i.peso; } });
      if (!total || w < total * 0.999) parcial.push(k);
      r.push(total && w >= total * 0.5 ? s / w : null);
    }
    return { r, parcial, faltam: e.itens.filter(i => !S.porId[i.id]).length, total };
  }

  function salvarEstr() {
    return enviarJson(ARQ_ESTR, S.estr).catch(e => alert('Não consegui salvar a estratégia: ' + e.message));
  }

  function afNovaEstrategia() {
    const nome = prompt('Nome da estratégia (ex.: Moderado RF, Viviane, Caixa D+1):');
    if (!nome) return;
    const e = { id: 'e' + Date.now().toString(36), nome: nome.trim(), obs: '', itens: [], criado: new Date().toISOString() };
    S.estr.estrategias.push(e);
    S.editando = e;
    salvarEstr();
    renderEstrategias(); renderTabela();
    afAba('fundos');
  }

  function afEditar(eid) {
    S.editando = S.editando && S.editando.id === eid ? null : S.estr.estrategias.find(e => e.id === eid) || null;
    renderEstrategias(); renderTabela();
    if (S.editando) { afAba('estrategias'); document.getElementById('afEditor').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  function afMarcar(fid, sim) {
    const e = S.editando;
    if (!e) return;
    const ja = e.itens.findIndex(i => i.id === fid);
    if (sim && ja < 0) {
      const f = S.porId[fid];
      e.itens.push({ id: fid, c: f.c, s: f.s, n: f.n, peso: 10 });
    } else if (!sim && ja >= 0) e.itens.splice(ja, 1);
    e.atualizado = new Date().toISOString();
    salvarEstr();
    renderEstrategias(); renderTabela();
  }

  function afPeso(fid, v) {
    const e = S.editando;
    const it = e && e.itens.find(i => i.id === fid);
    if (!it) return;
    it.peso = Math.max(0, parseFloat(String(v).replace(',', '.')) || 0);
    e.atualizado = new Date().toISOString();
    salvarEstr();
    renderEstrategias();
  }

  function afNormalizar() {
    const e = S.editando;
    const t = e.itens.reduce((a, i) => a + i.peso, 0);
    if (!t) return;
    e.itens.forEach(i => { i.peso = Math.round(i.peso / t * 10000) / 100; });
    salvarEstr(); renderEstrategias();
  }

  function afIgualar() {
    const e = S.editando;
    if (!e.itens.length) return;
    e.itens.forEach(i => { i.peso = Math.round(10000 / e.itens.length) / 100; });
    salvarEstr(); renderEstrategias();
  }

  function afRenomear() {
    const e = S.editando;
    const n = prompt('Novo nome:', e.nome);
    if (!n) return;
    e.nome = n.trim(); salvarEstr(); renderEstrategias();
  }

  function afObs(v) { if (S.editando) { S.editando.obs = v; salvarEstr(); } }

  function afExcluir(eid) {
    const e = S.estr.estrategias.find(x => x.id === eid);
    if (!e || !confirm(`Excluir a estratégia "${e.nome}"?`)) return;
    S.estr.estrategias = S.estr.estrategias.filter(x => x.id !== eid);
    if (S.editando && S.editando.id === eid) S.editando = null;
    S.comparar.delete(eid);
    salvarEstr(); renderEstrategias(); renderTabela();
  }

  function afDuplicar(eid) {
    const e = S.estr.estrategias.find(x => x.id === eid);
    if (!e) return;
    const c = JSON.parse(JSON.stringify(e));
    c.id = 'e' + Date.now().toString(36); c.nome = e.nome + ' (cópia)'; c.criado = new Date().toISOString();
    S.estr.estrategias.push(c);
    salvarEstr(); renderEstrategias();
  }

  function afComparar(eid, sim) {
    if (sim) {
      if (S.comparar.size >= CORES.length) { alert(`O gráfico compara até ${CORES.length} estratégias por vez.`); renderEstrategias(); return; }
      S.comparar.add(eid);
    } else S.comparar.delete(eid);
    renderEstrategias();
  }

  function afJanela(n) { S.janela = n; renderEstrategias(); }

  function renderEstrategias() {
    const el = document.getElementById('afEstrategias');
    if (!el) return;
    if (!S.dados) { el.innerHTML = '<p class="td-na">Carregando dados…</p>'; return; }
    const lista = S.estr.estrategias;
    const linhaInd = (e) => {
      const se = serieEstrategia(e);
      const ind = indicadores(se.r);
      const j = k => ind[k] || null;
      const c = (x, cmp) => x == null ? 'td-na' : cmp ? 'td-pos' : 'td-neg';
      return `<tr>
        <td><input type="checkbox" title="Mostrar no gráfico" ${S.comparar.has(e.id) ? 'checked' : ''} onchange="afComparar('${e.id}', this.checked)"></td>
        <td style="font-weight:600;"><a href="#" onclick="afEditar('${e.id}');return false;">${esc(e.nome)}</a><div class="af-sub">${e.itens.length} fundos${se.faltam ? ` · ${se.faltam} sem dados neste mês` : ''}${e.obs ? ' · ' + esc(e.obs) : ''}</div></td>
        ${['ytd', 'j12', 'j24', 'j36'].map(k => `<td class="af-num ${c(j(k), j(k) && j(k).ret >= j(k).cdi)}">${pct(j(k) && j(k).ret)}<div class="af-sub">${pctCdi(j(k) && j(k).pc)} CDI</div></td>`).join('')}
        <td class="af-num">${pct(j('j12') && j('j12').vol)}</td>
        <td class="af-num">${num(j('j12') && j('j12').sharpe)}</td>
        <td class="af-num">${num(j('j36') && j('j36').sharpe)}</td>
        <td class="af-num">${pct((j('j36') || j('j24') || j('j12') || {}).dd)}</td>
        <td style="white-space:nowrap;"><a href="#" onclick="afEditar('${e.id}');return false;">${S.editando && S.editando.id === e.id ? 'fechar' : 'editar'}</a> · <a href="#" onclick="afDuplicar('${e.id}');return false;">duplicar</a> · <a href="#" style="color:var(--err-text);" onclick="afExcluir('${e.id}');return false;">excluir</a></td>
      </tr>`;
    };
    const tabela = lista.length
      ? '<tr><th title="Mostrar no gráfico">Gráf.</th><th>Estratégia</th><th>YTD</th><th>12m</th><th>24m</th><th>36m</th><th>Vol 12m</th><th>Sharpe 12m</th><th>Sharpe 36m</th><th>Drawdown</th><th></th></tr>' + lista.map(linhaInd).join('')
      : '<tr><td class="td-na">Nenhuma estratégia ainda. Clique em "Nova estratégia", marque os fundos na aba Fundos e depois ajuste os pesos aqui.</td></tr>';
    el.innerHTML = `<div class="ext-preview-wrap" style="max-height:none;"><table class="ext-preview-table">${tabela}</table></div>` +
      grafico() + editor();
  }

  function editor() {
    const e = S.editando;
    if (!e) return '<div id="afEditor"></div>';
    const se = serieEstrategia(e);
    const ind = indicadores(se.r);
    const total = e.itens.reduce((a, i) => a + i.peso, 0);
    const itens = e.itens.map(i => {
      const f = S.porId[i.id];
      const j12 = f && f.ind.j12;
      return `<tr><td>${f ? `<a href="${linkFundo(i.id)}" onclick="return afClique(event, '${i.id}')">${esc(f.n)}</a>${f.ns ? `<div class="af-sub">${esc(f.ns)}</div>` : ''}` : `${esc(i.n)} <span class="td-neg">(sem dados neste mês)</span>`}<div class="af-sub">${fmtCnpj(i.c)}${f ? ' · ' + f.t + ' · ' + celulaPlats(f) : ''}</div></td>
        <td><input class="af-peso" type="number" min="0" step="0.5" value="${i.peso}" onchange="afPeso('${i.id}', this.value)"> %</td>
        <td class="af-num">${total ? pct(i.peso / total, 1) : '—'}</td>
        <td class="af-num">${e.valorTotal && total ? brl(e.valorTotal * i.peso / total) : '—'}</td>
        <td class="af-num">${f && f.liq ? esc(f.liq.txt) : '—'}</td>
        <td class="af-num">${pct(j12 && j12.ret)}<div class="af-sub">${pctCdi(j12 && j12.pc)} CDI</div></td>
        <td class="af-num">${num(j12 && j12.sharpe)}</td>
        <td><a href="#" style="color:var(--err-text);" onclick="afMarcar('${i.id}', false);return false;">tirar</a></td></tr>`;
    }).join('');
    return `<div class="upload-panel af-editor" id="afEditor">
      <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;align-items:center;">
        <h3>Editando: ${esc(e.nome)} <a href="#" onclick="afRenomear();return false;" style="font-size:11px;">renomear</a></h3>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <button class="btn-download-ext" onclick="afAba('fundos')">Escolher fundos</button>
          <button class="btn-download-ext" onclick="afIgualar()">Pesos iguais</button>
          <button class="btn-download-ext" onclick="afNormalizar()">Somar 100%</button>
          <button class="btn-download-ext" onclick="afEditar('${e.id}')">Concluir</button>
        </div>
      </div>
      <p class="af-nota">Para incluir fundos, vá em <a href="#" onclick="afAba('fundos');return false;">Fundos</a> e marque a caixinha ao lado do nome. Soma dos pesos: <strong class="${Math.abs(total - 100) < 0.01 ? 'td-pos' : 'td-neg'}">${num(total, 1)}%</strong> (os indicadores usam os pesos proporcionais, então não precisa fechar 100%).</p>
      <div class="upload-field" style="margin-bottom:0.8rem;"><label>Observações (perfil, clientes que usam, racional)</label>
        <input type="text" value="${esc(e.obs || '')}" onchange="afObs(this.value)" placeholder="ex.: moderado, não qualificado, liquidez até D+30"></div>
      <div class="ext-preview-wrap" style="max-height:none;"><table class="ext-preview-table">
        <tr><th>Fundo</th><th>Peso</th><th>Proporção</th><th>Valor (R$)</th><th>Liquidez</th><th>12m</th><th>Sharpe 12m</th><th></th></tr>${itens || '<tr><td colspan="8" class="td-na">Nenhum fundo ainda.</td></tr>'}</table></div>
      ${e.itens.length ? painelEnvio(e, ind) : ''}
      ${e.itens.length ? `<h3 style="margin-top:1.2rem;">Indicadores da carteira</h3>
      <div class="ext-preview-wrap" style="max-height:none;"><table class="ext-preview-table">${cartoesIndicadores(ind)}</table></div>
      <h3 style="margin-top:1.2rem;">Carteira mês a mês</h3>
      <div class="ext-preview-wrap" style="max-height:none;"><table class="ext-preview-table af-grade">${gradeMensal(se.r)}</table></div>
      ${se.parcial.length ? `<p class="af-nota">Em ${se.parcial.length} mês(es) algum fundo não tinha dado (fundo mais novo ou FIDC ainda sem informe); nesses meses a carteira usa os demais fundos com os pesos reescalados.</p>` : ''}` : ''}
    </div>`;
  }

  // ── proposta para o cliente (imagem e WhatsApp) e ordem ao banco ──
  const brl = v => v == null || !isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Nome do catálogo da EH quando houver (mais curto que a denominação da CVM)
  function nomeCurto(c, n) {
    const a = (window.EH_ATIVOS_CATALOGO || []).find(x => dig(x[0]) === c);
    return a ? a[1] : n;
  }

  function linhasProposta(e) {
    const total = e.itens.reduce((a, i) => a + i.peso, 0) || 1;
    const L = e.itens.filter(i => i.peso > 0).map(i => {
      const f = S.porId[i.id];
      const j12 = f && f.ind.j12;
      return {
        id: i.id, c: i.c, nome: nomeCurto(i.c, f ? f.n : i.n), nomeCvm: f ? f.n : i.n,
        peso: i.peso / total, valor: e.valorTotal ? Math.round(e.valorTotal * i.peso / total * 100) / 100 : null,
        liq: f && f.liq && f.liq.txt !== '—' ? f.liq.txt : '', r12: j12 ? j12.ret : null, pc12: j12 ? j12.pc : null,
      };
    });
    // Centavos do arredondamento vão para o maior fundo, para o total fechar
    if (e.valorTotal && L.length) {
      const dif = Math.round((e.valorTotal - L.reduce((a, l) => a + l.valor, 0)) * 100) / 100;
      const maior = L.reduce((m, l) => l.peso > m.peso ? l : m, L[0]);
      maior.valor = Math.round((maior.valor + dif) * 100) / 100;
    }
    return L;
  }

  function propostaHtml(e, ind) {
    const L = linhasProposta(e), rent = e.envRent !== false;
    const f = "font-family:Calibri,Arial,sans-serif;font-size:11pt;";
    const td = f + 'padding:5px 10px;border-bottom:1px solid #d9d9d9;color:#000;';
    const th = f + 'color:#fff;font-weight:bold;padding:9px 10px;background:#002060;';
    const comValor = L.some(l => l.valor != null);
    const cab = ['Fundo', 'Liquidez', '% da carteira', ...(comValor ? ['Valor (R$)'] : []), ...(rent ? ['Rent. 12m', '% do CDI 12m'] : [])];
    const linhas = L.map((l, k) => `<tr style="background:${k % 2 ? '#f2f2f2' : '#fff'};">
      <td style="${td}">${esc(l.nome)}</td><td style="${td}text-align:center;">${esc(l.liq || '—')}</td>
      <td style="${td}text-align:right;">${pct(l.peso, 1)}</td>
      ${comValor ? `<td style="${td}text-align:right;color:#0000ff;">${brl(l.valor)}</td>` : ''}
      ${rent ? `<td style="${td}text-align:right;">${pct(l.r12)}</td><td style="${td}text-align:right;">${pctCdi(l.pc12)}</td>` : ''}</tr>`).join('');
    const tot = `<tr style="background:#dfe5f1;"><td style="${td}font-weight:bold;border-top:2px solid #002060;">TOTAL</td><td style="${td}border-top:2px solid #002060;"></td>
      <td style="${td}text-align:right;font-weight:bold;border-top:2px solid #002060;">100%</td>
      ${comValor ? `<td style="${td}text-align:right;font-weight:bold;border-top:2px solid #002060;">${brl(L.reduce((a, l) => a + (l.valor || 0), 0))}</td>` : ''}
      ${rent ? `<td style="${td}text-align:right;font-weight:bold;border-top:2px solid #002060;">${pct(ind.j12 && ind.j12.ret)}</td><td style="${td}text-align:right;font-weight:bold;border-top:2px solid #002060;">${pctCdi(ind.j12 && ind.j12.pc)}</td>` : ''}</tr>`;
    const fim = S.dados.meses[ind.fim >= 0 ? ind.fim : S.dados.meses.length - 1];
    const resumo = rent && ind.j12 ? `<div style="${f}margin-top:10px;color:#000;">Carteira proposta nos últimos 12 meses: <b>${pct(ind.j12.ret)}</b> (${pctCdi(ind.j12.pc)} do CDI). CDI no período: ${pct(ind.j12.cdi)}.` +
      (ind.j24 ? ` Em 24 meses: <b>${pct(ind.j24.ret)}</b> (${pctCdi(ind.j24.pc)} do CDI).` : '') + '</div>' : '';
    return `<div style="${f}color:#000;">
      <div style="${f}font-size:15pt;font-weight:bold;color:#002060;">PROPOSTA DE ALOCAÇÃO${e.cliente ? ' – ' + esc(e.cliente.toUpperCase()) : ''}</div>
      <div style="${f}color:#92600D;margin:2px 0 10px;">${esc(new Date().toLocaleDateString('pt-BR'))} · EH Investimentos</div>
      <table style="border-collapse:collapse;${f}min-width:620px;"><thead><tr>${cab.map((c, j) => `<th style="${th}text-align:${j ? 'right' : 'left'};${j === 1 ? 'text-align:center;' : ''}">${c}</th>`).join('')}</tr></thead>
      <tbody>${linhas}${tot}</tbody></table>${resumo}
      ${rent ? `<div style="${f}font-size:9pt;color:#6C6D70;margin-top:8px;">Rentabilidade passada não é garantia de rentabilidade futura. Fonte: CVM e Banco Central, dados até ${mesCurto(fim)}.</div>` : ''}
    </div>`;
  }

  function propostaTexto(e, ind) {
    const L = linhasProposta(e), rent = e.envRent !== false;
    const linhas = L.map(l => `• ${l.nome}: ${pct(l.peso, 1)}${l.valor != null ? ` (R$ ${brl(l.valor)})` : ''}${l.liq ? ` · liquidez ${l.liq}` : ''}` +
      (rent && l.r12 != null ? ` · 12m ${pct(l.r12)} (${pctCdi(l.pc12)} do CDI)` : ''));
    const totalV = L.reduce((a, l) => a + (l.valor || 0), 0);
    return [`*Proposta de alocação${e.cliente ? ' – ' + e.cliente : ''}*`, '', ...linhas,
      ...(totalV ? ['', `*Total: R$ ${brl(totalV)}*`] : []),
      ...(rent && ind.j12 ? ['', `Carteira proposta nos últimos 12 meses: ${pct(ind.j12.ret)} (${pctCdi(ind.j12.pc)} do CDI). CDI no período: ${pct(ind.j12.cdi)}.`,
        '_Rentabilidade passada não é garantia de rentabilidade futura._'] : [])].join('\n');
  }

  function painelEnvio(e, ind) {
    return `<h3 style="margin-top:1.2rem;">Enviar ao cliente e gerar a ordem</h3>
      <div class="upload-form af-filtros" style="margin-bottom:0.6rem;">
        <div class="upload-field"><label>Cliente (nome na proposta)</label><input type="text" value="${esc(e.cliente || '')}" placeholder="ex.: Viviane" onchange="afEnvio('cliente', this.value)"></div>
        <div class="upload-field"><label>Valor total (R$)</label><input type="text" inputmode="decimal" value="${e.valorTotal ? brl(e.valorTotal) : ''}" placeholder="ex.: 250.000,00" onchange="afEnvio('valorTotal', this.value)"></div>
        <div class="upload-field" style="justify-content:flex-end;"><label>&nbsp;</label><label style="display:flex;gap:0.4rem;align-items:center;font-size:12px;cursor:pointer;"><input type="checkbox" ${e.envRent !== false ? 'checked' : ''} onchange="afEnvio('envRent', this.checked)"> Mostrar rentabilidade</label></div>
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.6rem;">
        <button class="btn-download-ext" onclick="afPropostaImagem('copiar')">Copiar imagem</button>
        <button class="btn-download-ext" onclick="afPropostaImagem('baixar')">Baixar imagem</button>
        <button class="btn-download-ext" onclick="afPropostaTexto('copiar')">Copiar texto</button>
        <button class="btn-download-ext" onclick="afPropostaTexto('whatsapp')">Abrir no WhatsApp</button>
        <button class="btn-download-ext" onclick="afParaOrdem()">Gerar ordem ao banco →</button>
        <span class="af-nota" id="afEnvioFb" style="margin:0;align-self:center;"></span>
      </div>
      <div class="af-proposta-prev">${propostaHtml(e, ind)}</div>`;
  }

  function afEnvio(campo, v) {
    const e = S.editando;
    if (!e) return;
    if (campo === 'valorTotal') {
      const n = parseFloat(String(v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
      e.valorTotal = isFinite(n) && n > 0 ? n : null;
    } else e[campo] = v;
    e.atualizado = new Date().toISOString();
    salvarEstr();
    renderEstrategias();
  }

  function fbEnvio(txt, ok = true) {
    const el = document.getElementById('afEnvioFb');
    if (el) { el.textContent = txt; el.className = 'af-nota ' + (ok ? 'td-pos' : 'td-neg'); }
  }

  function nomeArquivo(e) {
    return `Proposta ${(e.cliente || e.nome).replace(/[\\/:*?"<>|]/g, '')} - ${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.png`;
  }

  async function canvasProposta(e) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;padding:18px;display:inline-block;';
    box.innerHTML = propostaHtml(e, indicadores(serieEstrategia(e).r));
    document.body.appendChild(box);
    try { return await html2canvas(box, { backgroundColor: '#ffffff', scale: 2 }); }
    finally { box.remove(); }
  }

  // Mesmo jeito da Ordem ao Banco: ClipboardItem criado no clique (Safari), e no celular sem
  // suporte cai no menu de compartilhar.
  async function afPropostaImagem(modo) {
    const e = S.editando;
    if (!e || !e.itens.length) return;
    if (modo === 'baixar') {
      try {
        const c = await canvasProposta(e);
        const a = document.createElement('a');
        a.href = c.toDataURL('image/png'); a.download = nomeArquivo(e); a.click();
      } catch (err) { fbEnvio('Erro ao gerar a imagem: ' + err.message, false); }
      return;
    }
    const blob = canvasProposta(e).then(c => new Promise((ok, erro) => c.toBlob(b => b ? ok(b) : erro(new Error('falha ao gerar a imagem')), 'image/png')));
    try {
      if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error('sem suporte');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      fbEnvio('✓ Imagem copiada. Cole no WhatsApp.');
    } catch (err) {
      try {
        const arq = new File([await blob], nomeArquivo(e), { type: 'image/png' });
        if (navigator.canShare?.({ files: [arq] })) await navigator.share({ files: [arq] });
        else fbEnvio('Este navegador não deixa copiar imagem. Use "Baixar imagem".', false);
      } catch (e2) { if (e2.name !== 'AbortError') fbEnvio('Não consegui copiar a imagem: ' + e2.message, false); }
    }
  }

  async function afPropostaTexto(modo) {
    const e = S.editando;
    if (!e || !e.itens.length) return;
    const txt = propostaTexto(e, indicadores(serieEstrategia(e).r));
    if (modo === 'whatsapp') { window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank'); return; }
    try { await navigator.clipboard.writeText(txt); fbEnvio('✓ Texto copiado.'); }
    catch (err) { fbEnvio('Não consegui copiar: ' + err.message, false); }
  }

  // Leva a carteira para Mensagens Padrão → Ordem ao Banco (ordem de compra por cliente),
  // com CNPJ, fundo, liquidez e valor de cada fundo; lá saem a tabela, a imagem e o Excel.
  async function afParaOrdem() {
    const e = S.editando;
    if (!e || !e.itens.length) return;
    if (typeof msgInit !== 'function' || typeof moAddRow !== 'function') { fbEnvio('Não achei a tela de Mensagens Padrão.', false); return; }
    const L = linhasProposta(e);
    navigateToView('mensagens');
    await msgInit();
    const aba = [...document.querySelectorAll('#view-mensagens .email-tab')].find(b => (b.getAttribute('onclick') || '').includes("'banco'"));
    if (aba) msgSwitchTab('banco', aba);
    gset('mo_modo', 'cliente'); moModoChange();
    gset('mo_tipo', 'compra');
    if (e.cliente) gset('mo_nome', e.cliente.toUpperCase());
    document.getElementById('mo_rows').innerHTML = '';
    L.forEach(l => moAddRow({ cnpj: fmtCnpj(l.c), fundo: l.nome, liquidez: l.liq, valor: l.valor != null ? brl(l.valor) : '' }));
    moAtualizarLinhas();
    window.scrollTo(0, 0);
  }

  // Gráfico de retorno acumulado das estratégias marcadas contra o CDI
  function grafico() {
    const ids = [...S.comparar].filter(x => S.estr.estrategias.some(e => e.id === x));
    if (!ids.length) return '<p class="af-nota">Marque até 3 estratégias na coluna "Gráf." para comparar o retorno acumulado com o CDI.</p>';
    const meses = S.dados.meses, cdi = S.dados.cdi;
    const n = Math.min(S.janela, meses.length);
    const ini = meses.length - n;
    const series = ids.map((eid, k) => {
      const e = S.estr.estrategias.find(x => x.id === eid);
      const r = serieEstrategia(e).r;
      return { nome: e.nome, cor: CORES[k], v: acumulado(r.slice(ini)) };
    });
    series.push({ nome: 'CDI', cor: '#8a8b8e', tracejado: true, v: acumulado(cdi.slice(ini)) });
    const W = 760, H = 260, ml = 48, mr = 150, mt = 14, mb = 26;
    const todos = series.flatMap(s => s.v).filter(x => x != null);
    const vmax = Math.max(0.001, ...todos), vmin = Math.min(0, ...todos);
    const x = i => ml + (W - ml - mr) * (i / n);
    const y = v => mt + (H - mt - mb) * (1 - (v - vmin) / (vmax - vmin));
    const passo = escalaPasso(vmax - vmin);
    let grade = '';
    for (let v = Math.ceil(vmin / passo) * passo; v <= vmax + 1e-9; v += passo) {
      grade += `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)" stroke-width="1"/>` +
        `<text x="${ml - 6}" y="${y(v) + 3}" text-anchor="end" class="af-eixo">${pct(v, 0)}</text>`;
    }
    const rotX = [];
    for (let i = 0; i <= n; i++) {
      const m = i === 0 ? null : meses[ini + i - 1];
      if (m && (m.endsWith('-01') || i === n)) rotX.push(`<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="af-eixo">${mesCurto(m)}</text>`);
    }
    // rótulos diretos na ponta, empurrados para não se sobreporem
    const pontas = series.map(s => ({ s, yy: y(ultimo(s.v)) })).sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < pontas.length; i++) if (pontas[i].yy - pontas[i - 1].yy < 13) pontas[i].yy = pontas[i - 1].yy + 13;
    const linhas = series.map(s => {
      let d = '';
      s.v.forEach((v, i) => { if (v != null) d += (d && s.v[i - 1] != null ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); });
      return `<path d="${d}" fill="none" stroke="${s.cor}" stroke-width="2" ${s.tracejado ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>`;
    }).join('');
    const rotulos = pontas.map(p => `<text x="${W - mr + 6}" y="${p.yy + 3}" class="af-rot"><tspan fill="${p.s.cor}">■</tspan> ${esc(p.s.nome.length > 16 ? p.s.nome.slice(0, 15) + '…' : p.s.nome)} ${pct(ultimo(p.s.v), 1)}</text>`).join('');
    S.graf = { series, n, ini, x, y, W, H, ml, mr, mt, mb };
    const legenda = series.map(s => `<span class="af-leg"><span style="background:${s.cor};${s.tracejado ? 'opacity:0.7;' : ''}"></span>${esc(s.nome)}</span>`).join('');
    const botoes = [12, 24, 36].map(k => `<button class="af-jan ${S.janela === k ? 'on' : ''}" onclick="afJanela(${k})">${k}m</button>`).join('');
    return `<div class="upload-panel" style="margin-top:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.6rem;">
        <h3 style="margin:0;">Retorno acumulado · ${n} meses</h3><div>${botoes}</div></div>
      <div class="af-legenda">${legenda}</div>
      <div class="af-graf-wrap"><svg viewBox="0 0 ${W} ${H}" class="af-graf" onmousemove="afHover(evt)" onmouseleave="afHover(null)">
        ${grade}<line x1="${ml}" x2="${W - mr}" y1="${y(0)}" y2="${y(0)}" stroke="var(--rule-strong)"/>${rotX.join('')}${linhas}${rotulos}
        <line id="afCruz" x1="0" x2="0" y1="${mt}" y2="${H - mb}" stroke="var(--cream-faint)" stroke-width="1" style="display:none"/>
        <rect x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H - mt - mb}" fill="transparent"/>
      </svg><div class="af-tip" id="afTip"></div></div>
    </div>`;
  }

  function acumulado(r) {
    const out = [0];
    let f = 1, ok = true;
    r.forEach(x => { if (x == null) ok = false; if (ok) { f *= 1 + x; out.push(f - 1); } else out.push(null); });
    return out;
  }
  const ultimo = v => { for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return v[i]; return 0; };
  function escalaPasso(amp) {
    const bruto = amp / 5;
    const p = Math.pow(10, Math.floor(Math.log10(bruto)));
    return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= bruto) || bruto;
  }

  function afHover(evt) {
    const g = S.graf, tip = document.getElementById('afTip'), cruz = document.getElementById('afCruz');
    if (!g || !tip) return;
    if (!evt) { tip.style.display = 'none'; cruz.style.display = 'none'; return; }
    const svg = evt.currentTarget, box = svg.getBoundingClientRect();
    const px = (evt.clientX - box.left) * g.W / box.width;
    const i = Math.max(0, Math.min(g.n, Math.round((px - g.ml) / (g.W - g.ml - g.mr) * g.n)));
    cruz.setAttribute('x1', g.x(i)); cruz.setAttribute('x2', g.x(i)); cruz.style.display = '';
    const rot = i === 0 ? `início (fim de ${mesCurto(S.dados.meses[g.ini - 1] || S.dados.meses[0])})` : mesCurto(S.dados.meses[g.ini + i - 1]);
    tip.innerHTML = `<strong>${rot}</strong>` + g.series.map(s => `<div><span style="color:${s.cor}">■</span> ${esc(s.nome)}: ${pct(s.v[i])}</div>`).join('');
    tip.style.display = 'block';
    const left = g.x(i) / g.W * box.width;
    tip.style.left = (left > box.width * 0.6 ? left - tip.offsetWidth - 10 : left + 10) + 'px';
  }

  // ── exportar ──
  function afExportar() {
    if (!S.lista) return;
    const meses = S.dados.meses;
    const ind = S.lista.map(f => {
      const o = {
        Fundo: f.n, Subclasse: f.ns || '', CNPJ: fmtCnpj(f.c), Tipo: f.t, Classe: f.cl || '',
        'Público': f.p === 'G' ? 'Geral' : f.p === 'Q' ? 'Qualificado' : 'Profissional', Gestor: f.g || '',
        'PL (R$)': f.pl, Cotistas: f.ct, 'Último dado': f.dt, 'Dados até': mesCurto(meses[f.ind.fim] || meses[meses.length - 1]),
      };
      const j = (k, nome) => { const x = f.ind[k]; o[nome] = x ? x.ret : null; o['CDI ' + nome] = x ? x.cdi : null; o['% CDI ' + nome] = x ? x.pc : null; };
      j('ytd', 'YTD'); j('j12', '12m'); j('j24', '24m'); j('j36', '36m');
      o['Vol 12m'] = f.ind.j12 ? f.ind.j12.vol : null;
      o['Sharpe 12m'] = f.ind.j12 ? f.ind.j12.sharpe : null;
      o['Sharpe 36m'] = f.ind.j36 ? f.ind.j36.sharpe : null;
      const jd = f.ind.j36 || f.ind.j24 || f.ind.j12;
      o['Drawdown'] = jd ? jd.dd : null;
      o['Meses < CDI 12m'] = f.ind.j12 ? f.ind.j12.abaixo : null;
      o['Captação último mês (R$)'] = f.cap;
      o['Liquidez'] = f.liq ? f.liq.txt : '';
      o['Fonte da liquidez'] = f.liq ? f.liq.fonte : '';
      o['Plataformas'] = f.plats.join(', ');
      f.plats.forEach(p => Object.entries(S.plats.plataformas[p].fundos[f.c] || {}).forEach(([k, v]) => { if (k !== 'n') o[`${p}: ${k}`] = v; }));
      return o;
    });
    const mens = [{ Fundo: 'CDI', Subclasse: '', CNPJ: '' }].concat(S.lista.map(f => ({ Fundo: f.n, Subclasse: f.ns || '', CNPJ: fmtCnpj(f.c) })));
    meses.forEach((m, k) => { mens[0][m] = S.dados.cdi[k]; S.lista.forEach((f, i) => { mens[i + 1][m] = f.r[k]; }); });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ind), 'Indicadores');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mens), 'Rentabilidade mensal');
    const met = [
      ['Fonte', 'Cotas de fim de mês dos dados abertos da CVM (informe diário para FIF; informe mensal para FIDC, série sênior quando há). CDI: série 12 do Banco Central.'],
      ['Janelas', 'YTD, 12, 24 e 36 meses terminando no último mês com dado de cada fundo (FIDCs podem estar 1 mês atrás).'],
      ['% do CDI', 'Retorno acumulado do fundo / retorno acumulado do CDI na mesma janela.'],
      ['Volatilidade', 'Desvio-padrão dos retornos mensais × raiz de 12.'],
      ['Sharpe', '(retorno anualizado do fundo − CDI anualizado) / volatilidade anual.'],
      ['Drawdown', 'Maior queda acumulada de pico a vale nas cotas de fim de mês (36m ou a maior janela disponível).'],
      ['Gerado em', S.dados.gerado_em],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(met), 'Metodologia');
    XLSX.writeFile(wb, `Analise de fundos ${S.mes}.xlsx`);
  }

  Object.assign(window, {
    afInit, afCarregar, afFiltrar, afOrdenar, afDetalhe, afEnviarPlat, afRemoverPlat, afNovaEstrategia,
    afEditar, afMarcar, afPeso, afNormalizar, afIgualar, afRenomear, afObs, afExcluir, afDuplicar,
    afComparar, afJanela, afHover, afExportar, afAba, afTelaInteira, afFecharDetalhe, afClique, afSairPagina,
    afEnvio, afPropostaImagem, afPropostaTexto, afParaOrdem,
  });
  window.AF_TESTE = { janela, acumulado, escalaPasso };
})();
