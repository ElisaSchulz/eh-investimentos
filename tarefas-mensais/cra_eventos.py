# -*- coding: utf-8 -*-
"""
Juros e amortizações de CRA, CRI e debêntures (tarefa "cra_eventos").

Veio do cra-scraper da Elisa. Lê a lista de ativos (codigo, nome, url) e coleta, para
cada ativo, a agenda de eventos de Juros e Amortização em ANBIMA, Opea, Riza, Oliveira
Trust, Ecoagro, Habitasec, Pentágono e Vórtx. Gera "Juros e Amortizacoes <periodo>.xlsx"
com as abas Resumo, Eventos (só o período), Fonte (histórico completo, no formato que o
integrar.py usa na EH Base Unica), Proximos e Status.

Período: DATA_INICIO e DATA_FIM (AAAA-MM-DD) quando existem; senão o mês de referência
inteiro (do dia 1 ao último dia).

Lista de ativos: o repositório é público, então a lista NÃO fica no GitHub. Ela fica no
bucket privado, em config/ativos_cra.tsv (o admin do site tem o botão para enviar). Rodando
no computador, vale também um ativos_cra.tsv nesta pasta (fora do Git).

Os logs do GitHub são públicos: aqui só se imprimem contagens, nunca os códigos.
"""
import calendar
import csv
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.request
from collections import Counter
from datetime import date, datetime
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

AQUI = os.path.dirname(os.path.abspath(__file__))
ARQUIVO_LOCAL = os.path.join(AQUI, "ativos_cra.tsv")
ARQUIVO_BUCKET = "config/ativos_cra.tsv"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def _contexto_ssl():
    """No Windows o Python não usa os certificados do sistema e sites como Opea e
    Pentágono falhavam com CERTIFICATE_VERIFY_FAILED. O truststore usa os do sistema;
    sem ele, tenta o certifi."""
    try:
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except ImportError:
        pass
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


SSL_CTX = _contexto_ssl()

# ---------------------------------------------------------------------------
# Helpers de parsing
# ---------------------------------------------------------------------------

def num_br(s):
    """Converte número em formato pt-BR ('1.234,56', 'R$ 30,67', '6,53 %') em float.
    Retorna None se vazio/'-'."""
    if s is None:
        return None
    s = str(s).strip()
    if s in ("", "-", "--", "R$ -", "N/A", "nan"):
        return None
    s = s.replace("R$", "").replace("%", "").replace("\xa0", " ").strip()
    s = s.replace(".", "").replace(",", ".")
    s = re.sub(r"[^0-9.\-]", "", s)
    if s in ("", "-", ".", "-."):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def num_iso(x):
    """Número já em formato internacional (ponto decimal) -> float ou None."""
    if x is None:
        return None
    try:
        f = float(x)
    except (ValueError, TypeError):
        return None
    return f


def date_br(s):
    """'16/11/2022' ou '17.07.2026' -> ISO 'YYYY-MM-DD'."""
    if not s:
        return None
    m = re.search(r"(\d{2})[./](\d{2})[./](\d{4})", s)
    if not m:
        return None
    d, mo, y = m.groups()
    return f"{y}-{mo}-{d}"


DATE_BR_RE = re.compile(r"^\d{2}[./]\d{2}[./]\d{4}$")


def date_iso(s):
    """'2030-11-18' ou '2026-06-25T00:00:00Z' -> '2030-11-18'."""
    if not s:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(s))
    return m.group(0) if m else None


def classify_evento(raw):
    """Normaliza o rótulo do evento."""
    t = (raw or "").lower()
    if "amortiza" in t and ("extra" in t or "amex" in t):
        return "Amortização Extraordinária"
    if "amortiza" in t:
        return "Amortização"
    if "juro" in t:
        return "Juros"
    if "vencimento" in t or "resgate" in t:
        return "Vencimento"
    if "premio" in t or "prêmio" in t:
        return "Prêmio"
    return (raw or "").strip() or "Outro"


def tipo_from_codigo(cod):
    c = cod.upper()
    if c.startswith("CRA"):
        return "CRA"
    if c.startswith("CRI"):
        return "CRI"
    if c.startswith("DEB"):
        return "Debênture"
    return "?"


def source_key(url):
    host = urlparse(url).netloc.lower()
    if "data.anbima.com.br" in host:
        return "anbima"
    if "app.opea.com.br" in host:
        return "opea"
    if "rizasec.com" in host:
        return "riza"
    if "api-site.oliveiratrust.com.br" in host:
        return "ot-api"
    if "www.oliveiratrust.com.br" in host or host == "oliveiratrust.com.br":
        return "ot-site"
    if "ecoagro.agr.br" in host:
        return "ecoagro"
    if "habitasec.com.br" in host:
        return "habitasec"
    if "pentagonotrustee.com.br" in host:
        return "pentagono"
    if "vortx.com.br" in host:
        return "vortx"
    return "?"


def http_get(url, timeout=40, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
        data = r.read()
    if binary:
        return data
    for enc in ("utf-8", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace")


def http_get_json(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def ev(asset, source, data_evento, evento, valor=None, percentual=None,
       data_liq=None, status=None, saldo=None, extra=None):
    """Monta um registro de evento no schema unificado."""
    return {
        "codigo": asset["codigo"],
        "nome": asset["nome"],
        "tipo": tipo_from_codigo(asset["codigo"]),
        "fonte": source,
        "data_evento": data_evento,
        "data_liquidacao": data_liq,
        "evento": classify_evento(evento),
        "percentual": percentual,
        "valor": valor,
        "status": status,
        "saldo_devedor": saldo,
        "url": asset["url"],
    }


# ---------------------------------------------------------------------------
# Handlers — fontes estáticas (sem navegador)
# ---------------------------------------------------------------------------
from bs4 import BeautifulSoup


def _rows_from_pu_table(soup, idx_map):
    """Extrai linhas de tabelas de PU (Oliveira Trust / Ecoagro).
    idx_map: dict com índices das colunas date, amort_pag, juros_pag."""
    out = []
    for tr in soup.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) <= max(idx_map.values()):
            continue
        cells = [td.get_text(" ", strip=True) for td in tds]
        d = cells[idx_map["date"]].strip()
        if not DATE_BR_RE.match(d):
            continue
        out.append(cells)
    return out


def handle_ot_api(asset, ativo=None, tit=None):
    """Oliveira Trust api-site pu_hist.php — usa &excel=1 p/ histórico completo."""
    url = asset["url"]
    q = parse_qs(urlparse(url).query)
    ativo = ativo or (q.get("ativo", [None])[0])
    tit = tit or (q.get("tit", [None])[0])
    base = "https://api-site.oliveiratrust.com.br/fiduciario/pu_hist.php"
    full = f"{base}?ativo={ativo}&tit={tit}&excel=1"
    html = http_get(full)
    soup = BeautifulSoup(html, "lxml")
    # Colunas: Data | Valor Nominal | Juros | Premio | P.U. | [Amort, Juros, Premio, Total](pgto) | P.U.(ex)
    idx = {"date": 0, "amort_pag": 5, "juros_pag": 6}
    events = []
    for cells in _rows_from_pu_table(soup, idx):
        d = date_br(cells[0])
        amort = num_br(cells[5]) if len(cells) > 5 else None
        juros = num_br(cells[6]) if len(cells) > 6 else None
        if amort and amort > 0:
            events.append(ev(asset, "Oliveira Trust", d, "Amortização", valor=amort,
                             status="Liquidado"))
        if juros and juros > 0:
            events.append(ev(asset, "Oliveira Trust", d, "Juros", valor=juros,
                             status="Liquidado"))
    return events


def handle_ecoagro(asset):
    html = http_get(asset["url"])
    soup = BeautifulSoup(html, "lxml")
    # thead: Data | P.u(EX) | Cetip | Série | Valor nominal | JUROS | PRÊMIO | P.U | AMORTIZAÇÃO | JUROS | PRÊMIO | TOTAL
    idx = {"date": 0, "amort_pag": 8, "juros_pag": 9}
    events = []
    for cells in _rows_from_pu_table(soup, idx):
        d = date_br(cells[0])
        amort = num_br(cells[8]) if len(cells) > 8 else None
        juros = num_br(cells[9]) if len(cells) > 9 else None
        if amort and amort > 0:
            events.append(ev(asset, "Ecoagro", d, "Amortização", valor=amort,
                             status="Liquidado"))
        if juros and juros > 0:
            events.append(ev(asset, "Ecoagro", d, "Juros", valor=juros,
                             status="Liquidado"))
    return events


def handle_habitasec(asset):
    html = http_get(asset["url"])
    m = re.search(r"const\s+_deal\s*=\s*(\{.*?\})\s*;", html, re.S)
    if not m:
        raise RuntimeError("objeto _deal não encontrado na página")
    deal = json.loads(m.group(1))
    events = []
    du = date_iso(deal.get("DataUltimoPagamento"))
    if du:
        ju = num_iso(deal.get("JurosUltimoPagamento"))
        au = num_iso(deal.get("AmortUltimoPagamento"))
        ax = num_iso(deal.get("AmexUltimoPagamento"))
        if ju:
            events.append(ev(asset, "Habitasec", du, "Juros", valor=ju, status="Liquidado"))
        if au:
            events.append(ev(asset, "Habitasec", du, "Amortização", valor=au, status="Liquidado"))
        if ax:
            events.append(ev(asset, "Habitasec", du, "Amortização Extraordinária", valor=ax,
                             status="Liquidado"))
    dp = date_iso(deal.get("DataProximoPagamento"))
    if dp:
        jp = num_iso(deal.get("JurosProximoPagamento"))
        ap = num_iso(deal.get("AmortProximoPagamento"))
        if jp:
            events.append(ev(asset, "Habitasec", dp, "Juros", valor=jp, status="Previsto"))
        if ap:
            events.append(ev(asset, "Habitasec", dp, "Amortização", valor=ap, status="Previsto"))
    return events


def handle_pentagono(asset):
    import io
    import pandas as pd
    q = parse_qs(urlparse(asset["url"]).query)
    ativo = q.get("ativo", [None])[0]
    # Exportação .xlsx com a agenda completa de pagamentos:
    url = f"https://www.pentagonotrustee.com.br/Site/GerarExcelPagamento?ativo={ativo}"
    data = http_get(url, binary=True)
    df = pd.read_excel(io.BytesIO(data))
    df.columns = [str(c).strip() for c in df.columns]
    events = []
    for _, r in df.iterrows():
        d = date_br(str(r.get("Data", "")))
        if not d:
            continue
        evento = str(r.get("Evento", ""))
        taxa = num_br(r.get("Taxa"))
        valor = num_br(r.get("Valor"))
        cl = classify_evento(evento)
        if cl in ("Juros", "Amortização", "Amortização Extraordinária"):
            events.append(ev(asset, "Pentágono", d, evento, valor=valor, percentual=taxa))
    return events


# ---------------------------------------------------------------------------
# Handlers — fontes com navegador (Playwright)
# ---------------------------------------------------------------------------

ANBIMA_EXTRACT_JS = r"""
() => {
  const dateRe = /^\d{2}\/\d{2}\/\d{4}$/;
  const rows = [];
  document.querySelectorAll('table tr').forEach(tr => {
    const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim().replace(/\s+/g,' '));
    if (cells.length >= 5 && dateRe.test(cells[0])) rows.push(cells);
  });
  const m = document.body.innerText.match(/Exibindo\s+[\d]+\s*[-–]\s*[\d]+\s+de\s+(\d+)/i);
  return { rows, total: m ? parseInt(m[1]) : null };
}
"""


def _anbima_url_size(url, size=500):
    p = urlparse(url)
    q = parse_qs(p.query)
    q["page"] = ["0"]
    q["size"] = [str(size)]
    return urlunparse(p._replace(query=urlencode({k: v[0] for k, v in q.items()})))


def handle_anbima(page, asset):
    url = _anbima_url_size(asset["url"])
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    # aceitar aviso de privacidade, se houver
    for sel in ["text=Prosseguir", "text=Aceito", "a[href='#aceito-as-regras']"]:
        try:
            el = page.locator(sel)
            if el.count() > 0 and el.first.is_visible():
                el.first.click(timeout=2000)
                break
        except Exception:
            pass
    # esperar a tabela renderizar
    try:
        page.wait_for_function(
            "() => { const r=[...document.querySelectorAll('table tr td')]"
            ".filter(td=>/^\\d{2}\\/\\d{2}\\/\\d{4}$/.test(td.innerText.trim())); "
            "return r.length>0 || /Nenhum|não há|sem eventos/i.test(document.body.innerText); }",
            timeout=45000)
    except Exception:
        pass
    seen = {}
    total = None
    for _ in range(60):  # limite de páginas de segurança
        data = page.evaluate(ANBIMA_EXTRACT_JS)
        total = data.get("total")
        for c in data["rows"]:
            key = (c[0], c[2] if len(c) > 2 else "", c[4] if len(c) > 4 else "")
            seen[key] = c
        if total is None or len(seen) >= total:
            break
        # tentar próxima página
        moved = False
        for sel in ["button[aria-label*='próxima' i]", "button[aria-label*='next' i]",
                    "button[aria-label*='Próxima' i]", "li.next:not(.disabled) a"]:
            try:
                btn = page.locator(sel)
                if btn.count() > 0 and btn.first.is_enabled():
                    btn.first.click(timeout=3000)
                    page.wait_for_timeout(1200)
                    moved = True
                    break
            except Exception:
                continue
        if not moved:
            break
    events = []
    for c in seen.values():
        d = date_br(c[0])
        d_liq = date_br(c[1]) if len(c) > 1 else None
        evento = c[2] if len(c) > 2 else ""
        taxa = num_br(c[3]) if len(c) > 3 else None
        valor = num_br(c[4]) if len(c) > 4 else None
        status = (c[5].title() if len(c) > 5 and c[5] else None)
        cl = classify_evento(evento)
        events.append(ev(asset, "ANBIMA", d, evento, valor=valor, percentual=taxa,
                         data_liq=d_liq, status=status))
    return events


OPEA_CODE_RE = re.compile(r"[A-Z]{3}\.\d+\.[A-Z]+\.\d+")


def handle_opea(asset):
    """Opea: tudo via API interna (JSON), sem navegador.
    O codigoOpea (ex.: CRA.218.CIA.3) vem embutido na resposta de 'detalhe'."""
    codigo_if = asset["url"].rstrip("/").split("/")[-1]
    base_bff = "https://app.opea.com.br/bff/v1/api/emissao"
    detalhe = http_get_json(f"{base_bff}/passivosoperacoes/detalhe?codigoIf={codigo_if}")
    if not detalhe.get("content"):
        raise RuntimeError("Opea não possui dados para este código (operação não encontrada)")
    m = OPEA_CODE_RE.search(json.dumps(detalhe, ensure_ascii=False))
    if not m:
        raise RuntimeError("codigoOpea não encontrado na resposta de detalhe")
    codigo_opea = m.group(0)
    # paginar precificações (agenda de eventos)
    items = []
    page_no, last = 1, 1
    while page_no <= last and page_no < 50:
        url = (f"{base_bff}/precificacoes/detalhe?pagina={page_no}&tamanhoPagina=100"
               f"&dataEventoFinal=2100-12-31&codigoOpea={codigo_opea}")
        r = http_get_json(url)
        c = r.get("content") or {}
        items.extend(c.get("items", []))
        last = c.get("lastPage") or 1
        page_no += 1
    events = []
    for it in items:
        d = date_iso(it.get("dataEvento"))
        d_pg = date_iso(it.get("dataPagamento"))
        status = (it.get("status") or {}).get("value")
        saldo = num_iso(it.get("saldoDevedor"))
        juros = num_iso(it.get("jurosPago"))
        amort = num_iso(it.get("amortizacao"))
        amex = num_iso(it.get("amortizacaoExtraordinaria"))
        if juros and juros > 0:
            events.append(ev(asset, "Opea", d, "Juros", valor=juros, data_liq=d_pg,
                             status=status, saldo=saldo))
        if amort and amort > 0:
            events.append(ev(asset, "Opea", d, "Amortização", valor=amort, data_liq=d_pg,
                             status=status, saldo=saldo))
        if amex and amex > 0:
            events.append(ev(asset, "Opea", d, "Amortização Extraordinária", valor=amex,
                             data_liq=d_pg, status=status, saldo=saldo))
    return events


RIZA_API = "https://aks-prod.virgo.inc/mtr/bff-portal/v1/operations"
RIZA_FETCH_JS = ("async (u) => { const r = await fetch(u, {headers: {Accept: 'application/json'}});"
                 " return [r.status, r.status === 200 ? await r.text() : '']; }")
_riza_indice = {}


def _riza_get(page, url):
    status, texto = page.evaluate(RIZA_FETCH_JS, url)
    if status != 200:
        raise RuntimeError(f"API da Riza respondeu HTTP {status}")
    return json.loads(texto)


def _riza_carregar_indice(page):
    """Código do papel (ifCode/instrumentCode) -> id da operação, a partir da lista pública."""
    if _riza_indice:
        return
    pagina, total = 0, 1
    while pagina < total and pagina < 60:
        j = _riza_get(page, f"{RIZA_API}?orderBy=EMISSION_DATE_DESC&pageSize=50&pageNumber={pagina}")
        total = (j.get("metadata") or {}).get("totalPages") or 1
        for op in j.get("content", []):
            _riza_indice[op["id"].upper()] = op["id"]
            for se in op.get("series", []):
                if se.get("instrumentCode"):
                    _riza_indice[se["instrumentCode"].upper()] = op["id"]
        pagina += 1


def handle_riza(page, asset):
    """Riza: em 2026 o site mudou os endereços (RZA0866 virou CRI_CORP_..., e os antigos
    dão 404) e a API passou a recusar pedidos feitos de fora do site (403). Agora:
    abre o site, faz as consultas de dentro da página (como o próprio site faz), acha a
    operação pelo código do papel e lê o fluxo da SÉRIE do papel, já por unidade."""
    page.goto("https://investidor.rizasec.com/emissoes", wait_until="domcontentloaded", timeout=60000)
    _riza_carregar_indice(page)
    codigo = asset["codigo"].upper().replace(" ", "")
    sem_prefixo = re.sub(r"^(CRI|CRA)(?=\d{2}[A-Z])", "", codigo)
    ultimo = asset["url"].rstrip("/").split("/")[-1].upper()
    op = _riza_indice.get(codigo) or _riza_indice.get(sem_prefixo) or _riza_indice.get(ultimo)
    if not op:
        raise RuntimeError("papel não encontrado na lista de emissões da Riza")
    data = _riza_get(page, f"{RIZA_API}/{op}/payments?summary=false")
    events = []
    series = [se for se in data.get("series", [])
              if (se.get("ifCode") or "").upper() in (codigo, sem_prefixo)]
    # O fluxo da série é DIÁRIO (os juros vão acumulando dia a dia); só valem as datas de
    # pagamento, que são as do agregado da operação.
    datas_pgto = {date_iso(it.get("date")) for it in data.get("aggregated", [])
                  if (num_iso(it.get("totalPayment")) or 0) > 0}
    if series:
        for se in series:
            for f in se.get("flow", []):
                u = f.get("unitary") or {}
                d = date_iso(f.get("date"))
                pago = (num_iso(u.get("payment")) or 0) > 0 or (
                    (num_iso(u.get("amortization")) or 0) + (num_iso(u.get("extraAmortization")) or 0)) > 0
                if d not in datas_pgto and not pago:
                    continue
                juros = num_iso(u.get("interest"))
                amort = num_iso(u.get("amortization"))
                amex = (num_iso(u.get("extraAmortization")) or 0) + (num_iso(u.get("extraordinaryPayment")) or 0)
                if juros and juros > 0:
                    events.append(ev(asset, "Riza", d, "Juros", valor=juros))
                if amort and amort > 0:
                    events.append(ev(asset, "Riza", d, "Amortização", valor=amort))
                if amex > 0:
                    events.append(ev(asset, "Riza", d, "Amortização Extraordinária", valor=amex))
        if events:
            return events
    # sem o fluxo da série: usa o agregado da operação (totais / quantidade)
    for it in data.get("aggregated", []):
        d = date_iso(it.get("date"))
        q = num_iso(it.get("quantity")) or 0

        def per_cota(x):
            v = num_iso(x)
            if v is None:
                return None
            return v / q if q else v
        juros = per_cota(it.get("interest"))
        amort = per_cota(it.get("amortization"))
        amex = per_cota(it.get("amex"))
        if juros and juros > 0:
            events.append(ev(asset, "Riza", d, "Juros", valor=juros))
        if amort and amort > 0:
            events.append(ev(asset, "Riza", d, "Amortização", valor=amort))
        if amex and amex > 0:
            events.append(ev(asset, "Riza", d, "Amortização Extraordinária", valor=amex))
    return events


def handle_ot_site(page, asset):
    """www.oliveiratrust.com.br/.../historico-valores/{id}
    Usa a API JSON services-ft (histórico diário de PU, paginado)."""
    tid = asset["url"].split("historico-valores/")[-1].split("?")[0].strip("/")
    page.goto(asset["url"], wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1500)  # deixa o app carregar (define contexto/headers)
    base = f"https://services-ft.oliveiratrust.com.br/app/v1/titulos/historico_pu/{tid}"
    headers = {"Accept": "application/json", "Referer": "https://www.oliveiratrust.com.br/"}
    events = []
    limit = 50  # a API rejeita limites maiores (HTTP 422)
    page_no = 1
    last_page = 1
    while page_no <= last_page and page_no <= 2000:
        resp = page.context.request.get(f"{base}?page={page_no}&limit={limit}",
                                        headers=headers, timeout=60000)
        if not resp.ok:
            if page_no == 1:
                raise RuntimeError(f"services-ft HTTP {resp.status}")
            break
        payload = resp.json()
        data = payload.get("data", {})
        rows = data.get("data", []) if isinstance(data, dict) else []
        if page_no == 1 and isinstance(data, dict):
            lp = data.get("last_page")
            if lp:
                last_page = int(lp)
            elif data.get("total"):
                last_page = (int(data["total"]) + limit - 1) // limit
        for r in rows:
            d = date_iso(r.get("data"))
            amort = num_br(r.get("amort_pgto"))
            juros = num_br(r.get("juros_pgto"))
            if amort and amort > 0:
                events.append(ev(asset, "Oliveira Trust", d, "Amortização", valor=amort,
                                 status="Liquidado"))
            if juros and juros > 0:
                events.append(ev(asset, "Oliveira Trust", d, "Juros", valor=juros,
                                 status="Liquidado"))
        if not rows:
            break
        page_no += 1
    return events


def handle_vortx(asset):
    """Vórtx: a agenda (histórico diário de PU) vem embutida no HTML (SSR/RSC)
    no array 'unitPrices'. Eventos = linhas com interest>0 ou amortization>0."""
    html = http_get(asset["url"])
    h = html.replace('\\"', '"').replace('\\/', '/')
    m = re.search(r'"unitPrices"\s*:\s*(\[.*?\])', h, re.S)
    if not m:
        raise RuntimeError("array unitPrices não encontrado no HTML da Vórtx")
    rows = json.loads(m.group(1))
    events = []
    for r in rows:
        d = date_iso(r.get("paymentDate"))
        juros = num_iso(r.get("interest"))
        amort = num_iso(r.get("amortization"))
        if juros and juros > 0:
            events.append(ev(asset, "Vórtx", d, "Juros", valor=juros, status="Liquidado"))
        if amort and amort > 0:
            events.append(ev(asset, "Vórtx", d, "Amortização", valor=amort, status="Liquidado"))
    if not events:
        raise RuntimeError("Vórtx não publica os valores de juros/amortização nesta "
                           "página (apenas PU diário e metadados) — obter manualmente")
    return events


# ---------------------------------------------------------------------------
# Orquestração
# ---------------------------------------------------------------------------

STATIC_SOURCES = {"ot-api", "ecoagro", "habitasec", "pentagono", "vortx", "opea"}
BROWSER_SOURCES = {"anbima", "riza", "ot-site"}

STATIC_HANDLERS = {
    "ot-api": handle_ot_api,
    "ecoagro": handle_ecoagro,
    "habitasec": handle_habitasec,
    "pentagono": handle_pentagono,
    "vortx": handle_vortx,
    "opea": handle_opea,
}
BROWSER_HANDLERS = {
    "anbima": handle_anbima,
    "riza": handle_riza,
    "ot-site": handle_ot_site,
}


def _ler_tsv(texto):
    assets = []
    for row in csv.DictReader(io.StringIO(texto.lstrip("﻿")), delimiter="\t"):
        if not (row.get("url") or "").strip() or not (row.get("codigo") or "").strip():
            continue
        assets.append({"codigo": row["codigo"].strip(), "nome": (row.get("nome") or "").strip(),
                       "url": row["url"].strip()})
    return assets


def carregar_ativos():
    if os.path.exists(ARQUIVO_LOCAL):
        with open(ARQUIVO_LOCAL, encoding="utf-8") as f:
            return _ler_tsv(f.read())
    import supabase_storage
    if supabase_storage.configurado():
        conteudo = supabase_storage.baixar(ARQUIVO_BUCKET)
        if conteudo:
            for enc in ("utf-8", "latin-1"):
                try:
                    return _ler_tsv(conteudo.decode(enc))
                except UnicodeDecodeError:
                    continue
    raise SystemExit("Lista de ativos não encontrada. Envie o assets.tsv do cra-scraper em "
                     "Tarefas Mensais → Lista de CRA/CRI/debêntures (fica em config/ativos_cra.tsv "
                     "no bucket privado).")


def periodo(mes):
    """(início, fim) como date: DATA_INICIO/DATA_FIM se existirem, senão o mês inteiro."""
    from comum import mes_referencia
    ano, m = mes_referencia(mes)
    ini = os.environ.get("DATA_INICIO", "").strip()
    fim = os.environ.get("DATA_FIM", "").strip()
    d_ini = date.fromisoformat(ini) if ini else date(ano, m, 1)
    d_fim = date.fromisoformat(fim) if fim else (
        date(ano, m, calendar.monthrange(ano, m)[1]) if not ini else date.today())
    if d_fim < d_ini:
        raise SystemExit(f"Data final {d_fim} antes da inicial {d_ini}.")
    return d_ini, d_fim


def coletar(assets, headed=False):
    for a in assets:
        a["source"] = source_key(a["url"])
    all_events, status_rows = [], []
    need_browser = any(a["source"] in BROWSER_SOURCES for a in assets)
    browser = ctx = pw = None
    if need_browser:
        from playwright.sync_api import sync_playwright
        pw = sync_playwright().start()
        browser = pw.chromium.launch(headless=not headed)
        ctx = browser.new_context(user_agent=UA, locale="pt-BR",
                                  viewport={"width": 1366, "height": 900})
        ctx.set_default_timeout(60000)
    try:
        for i, a in enumerate(assets, 1):
            src = a["source"]
            try:
                if src in STATIC_HANDLERS:
                    evs = STATIC_HANDLERS[src](a)
                elif src in BROWSER_HANDLERS:
                    for att in (1, 2):  # navegador pode falhar por timing; tenta 2x
                        page = ctx.new_page()
                        try:
                            evs = BROWSER_HANDLERS[src](page, a)
                            break
                        except Exception:
                            if att == 2:
                                raise
                        finally:
                            page.close()
                else:
                    raise RuntimeError(f"fonte desconhecida: {src}")
                all_events.extend(evs)
                status_rows.append({"codigo": a["codigo"], "nome": a["nome"], "fonte": src,
                                    "status": "OK" if evs else "SEM EVENTOS", "eventos": len(evs),
                                    "mensagem": "" if evs else "a fonte respondeu, mas sem nenhum evento",
                                    "url": a["url"]})
                ok = "ok" if evs else "sem eventos"
            except Exception as e:
                msg = str(e).splitlines()[0][:200] if str(e) else type(e).__name__
                status_rows.append({"codigo": a["codigo"], "nome": a["nome"], "fonte": src,
                                    "status": "FALHA", "eventos": 0, "mensagem": msg, "url": a["url"]})
                ok = "FALHA: " + msg[:120]
            # log público: só a posição e a fonte, nunca o código
            print(f"[{i}/{len(assets)}] {src:<9} {ok}", flush=True)
    finally:
        if ctx:
            ctx.close()
        if browser:
            browser.close()
        if pw:
            pw.stop()
    return all_events, status_rows


def montar_planilha(events, status_rows, d_ini, d_fim, caminho):
    import pandas as pd
    cols = ["codigo", "nome", "tipo", "fonte", "data_evento", "data_liquidacao",
            "evento", "percentual", "valor", "status", "saldo_devedor", "url"]
    df = pd.DataFrame(events, columns=cols)
    df["data_evento"] = pd.to_datetime(df["data_evento"], errors="coerce")
    df["data_liquidacao"] = pd.to_datetime(df["data_liquidacao"], errors="coerce")
    df = df.sort_values(["codigo", "data_evento", "evento"], na_position="last")

    janela = df[(df["data_evento"] >= pd.Timestamp(d_ini)) & (df["data_evento"] <= pd.Timestamp(d_fim))]

    # Resumo: total de juros e amortização por ativo no período
    base = janela[janela["evento"].isin(["Juros", "Amortização", "Amortização Extraordinária"])].copy()
    resumo = pd.DataFrame(columns=["codigo", "nome", "tipo", "total_juros", "total_amortizacao",
                                   "total", "n_eventos"])
    if not base.empty:
        base["grupo"] = base["evento"].where(base["evento"] == "Juros", "Amortização")
        piv = (base.groupby(["codigo", "nome", "tipo", "grupo"])["valor"].sum()
               .unstack(fill_value=0).reset_index())
        for c in ("Juros", "Amortização"):
            if c not in piv.columns:
                piv[c] = 0.0
        piv = piv.rename(columns={"Juros": "total_juros", "Amortização": "total_amortizacao"})
        piv["total"] = piv["total_juros"] + piv["total_amortizacao"]
        n = base.groupby("codigo").size().rename("n_eventos")
        resumo = (piv.merge(n, on="codigo", how="left")[list(resumo.columns)]
                  .sort_values("total", ascending=False))

    # Fonte: histórico completo no formato da aba Fonte da EH Base Unica (integrar.py)
    grupo_juros = {"Juros", "Prêmio"}
    grupo_amort = {"Amortização", "Amortização Extraordinária", "Vencimento"}
    fdf = df.copy()
    fdf["Grupo"] = fdf["evento"].map(
        lambda e: "Juros" if e in grupo_juros else ("Amortização" if e in grupo_amort else None))
    fdf = fdf[fdf["Grupo"].notna() & fdf["valor"].notna() & (fdf["valor"] != 0)]
    fonte = (fdf.groupby(["codigo", "Grupo", "data_evento"], as_index=False)["valor"].sum()
             .rename(columns={"codigo": "Codigo", "data_evento": "Data", "valor": "Valor"})
             .sort_values(["Codigo", "Data", "Grupo"]))

    # Próximos: próximo Juros e próxima Amortização de cada ativo
    hoje = pd.Timestamp(date.today())
    fut = df[(df["data_evento"] >= hoje) &
             df["evento"].isin(["Juros", "Amortização", "Amortização Extraordinária"])].copy()
    prox = pd.DataFrame()
    if not fut.empty:
        fut["grupo"] = fut["evento"].where(fut["evento"] == "Juros", "Amortização")
        prox = (fut.sort_values("data_evento").groupby(["codigo", "grupo"], as_index=False).first()
                [["codigo", "nome", "tipo", "grupo", "data_evento", "valor", "percentual", "status", "fonte"]]
                .rename(columns={"grupo": "evento"}).sort_values(["data_evento", "codigo"]))

    st = pd.DataFrame(status_rows, columns=["codigo", "nome", "fonte", "status", "eventos", "mensagem", "url"])
    st["ordem"] = st["status"].map({"FALHA": 0, "SEM EVENTOS": 1}).fillna(2)
    st = st.sort_values(["ordem", "fonte", "codigo"]).drop(columns="ordem")

    with pd.ExcelWriter(caminho, engine="openpyxl", datetime_format="dd/mm/yyyy") as xl:
        resumo.to_excel(xl, sheet_name="Resumo", index=False, startrow=2)
        ws = xl.sheets["Resumo"]
        ws["A1"] = (f"Juros e amortizações pagos de {d_ini:%d/%m/%Y} a {d_fim:%d/%m/%Y} "
                    f"(pela data do evento). Valores por unidade do papel.")
        ws["A2"] = (f"{(st['status'] == 'OK').sum()} de {len(st)} ativos coletados. "
                    f"Os que falharam estão no topo da aba Status.")
        janela.to_excel(xl, sheet_name="Eventos", index=False)
        fonte.to_excel(xl, sheet_name="Fonte", index=False)
        if not prox.empty:
            prox.to_excel(xl, sheet_name="Proximos", index=False)
        st.to_excel(xl, sheet_name="Status", index=False)
        _format_workbook(xl)
    return resumo, st


def main(mes=None):
    from comum import mes_referencia, pasta_saida
    ano, m = mes_referencia(mes)
    d_ini, d_fim = periodo(mes)
    assets = carregar_ativos()
    print(f"Período: {d_ini:%d/%m/%Y} a {d_fim:%d/%m/%Y}. {len(assets)} ativos na lista.")
    events, status_rows = coletar(assets)

    if d_ini.day == 1 and d_fim == date(d_ini.year, d_ini.month, calendar.monthrange(d_ini.year, d_ini.month)[1]):
        rotulo = f"{d_ini:%Y-%m}"
    else:
        rotulo = f"{d_ini:%Y-%m-%d} a {d_fim:%Y-%m-%d}"
    caminho = os.path.join(pasta_saida(ano, m), f"Juros e Amortizacoes {rotulo}.xlsx")
    resumo, st = montar_planilha(events, status_rows, d_ini, d_fim, caminho)

    por_fonte = Counter((s["fonte"], s["status"]) for s in status_rows)
    for (fonte, status), n in sorted(por_fonte.items()):
        print(f"  {fonte:<9} {status:<12} {n}")
    falhas = int((st["status"] != "OK").sum())
    print(f"{len(resumo)} ativos com pagamento no período; total de {len(events)} eventos coletados.")
    if falhas:
        print(f"Aviso: {falhas} de {len(st)} ativos sem dados — veja a aba Status da planilha.")
    return [caminho]


def _format_workbook(xl):
    from openpyxl.worksheet.table import Table, TableStyleInfo
    from openpyxl.utils import get_column_letter
    for name, ws in xl.sheets.items():
        inicio = 3 if name == "Resumo" else 1
        for col in ws.iter_cols(min_row=inicio):
            letter = get_column_letter(col[0].column)
            width = 12
            for cell in col[:200]:
                if cell.value is not None:
                    width = max(width, min(48, len(str(cell.value)) + 2))
            ws.column_dimensions[letter].width = width
        ws.freeze_panes = f"A{inicio + 1}"
        if ws.max_row >= inicio + 1 and ws.max_column >= 1:
            ref = f"A{inicio}:{get_column_letter(ws.max_column)}{ws.max_row}"
            tbl = Table(displayName=f"tbl_{re.sub(r'[^A-Za-z0-9_]', '_', name)}", ref=ref)
            tbl.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
            ws.add_table(tbl)
        if name == "Resumo":
            for c in ("D", "E", "F"):
                for cell in ws[c][3:]:
                    cell.number_format = "#,##0.00000000"


if __name__ == "__main__":
    # No computador (Spyder): ponha o assets.tsv aqui como ativos_cra.tsv e ajuste abaixo.
    # os.environ["DATA_INICIO"] = "2026-10-01"; os.environ["DATA_FIM"] = "2026-10-31"
    print(main())
