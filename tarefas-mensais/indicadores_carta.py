"""
Indicadores da carta mensal calculados a partir das fontes públicas. Usado por carta_mensal.py,
que grava o resultado em carta_dados.json.

Duas tabelas:

  indicadores     a tabela "Indicadores" da carta (fechamento, mês, ano e 12 meses), já em texto:
                  Selic (meta, SGS 432), IPCA (433), IPCA-15 (7478), IGP-M (189),
                  R$/USD (PTAX venda, SGS 1), Brent (Yahoo BZ=F) e Dívida Bruta (% do PIB, 13762).
  rentabilidade   a tabela das cartas antigas (valor, mês, ano, 6, 12 e 24 meses), em números:
                  CDI (taxa anual 4389 e acumulado no mês 4391), IPCA, IGP-M, Poupança (196),
                  R$/USD (PTAX), Ibovespa (^BVSP) e S&P 500 (^GSPC).

Índices de preço (IPCA, IGP-M, CDI, poupança) usam o último mês divulgado: no 3º dia útil o IPCA
do mês de referência ainda não saiu, então a linha mostra o mês anterior e diz isso.
Cada indicador que falhar fica vazio com um aviso, sem derrubar a carta.
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd

from comum import fechamentos_yahoo, nome_mes

MENOS = "−"
MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


# ------------------------------------------------------------------ formatação
def _br(v, casas=2):
    return f"{abs(v):,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def pct_txt(v, casas=2):
    if v is None or pd.isna(v):
        return ""
    v = round(float(v), casas)
    return (f"{MENOS} " if v < 0 else "") + _br(v, casas) + "%"


def pp_txt(v, casas=2):
    """Diferença em pontos percentuais; zero vira "estável"."""
    if v is None or pd.isna(v):
        return ""
    v = round(float(v), casas)
    if v == 0:
        return "estável"
    return (f"{MENOS} " if v < 0 else "") + _br(v, casas) + " p.p."


def num_txt(v, casas=2):
    if v is None or pd.isna(v):
        return ""
    return (f"{MENOS} " if v < 0 else "") + _br(float(v), casas)


def _r(v, casas=2):
    return None if v is None or pd.isna(v) else round(float(v), casas)


# ------------------------------------------------------------------ séries
def _inicio_mes(d, meses_atras=0):
    total = d.year * 12 + (d.month - 1) - meses_atras
    return date(total // 12, total % 12 + 1, 1)


def _fim_mes(d, meses_atras=0):
    proximo = _inicio_mes(d, meses_atras - 1)
    return proximo - timedelta(days=1)


def mensal(serie, ref):
    """Série mensal (valores em % no mês, índice = 1º dia do mês) até o mês de referência.

    Devolve o último mês divulgado e as variações compostas: mês, ano, 6, 12 e 24 meses.
    """
    s = serie[serie.index.date <= _fim_mes(ref)].dropna()
    s.index = pd.to_datetime(s.index).to_period("M")
    s = s[~s.index.duplicated(keep="last")]
    if s.empty:
        return None
    p = s.index[-1]

    def composto(meses):
        periodo = pd.period_range(p - meses + 1, p, freq="M")
        if not all(m in s.index for m in periodo):
            return None
        return ((1 + s.loc[periodo] / 100).prod() - 1) * 100

    return {"mes_ref": date(p.year, p.month, 1), "mes": float(s.loc[p]), "ano": composto(p.month),
            "m6": composto(6), "m12": composto(12), "m24": composto(24)}


def precos(serie, ref):
    """Série diária de preços: fechamento do mês e variação contra o fim de cada período."""
    s = serie.dropna().sort_index()
    s = s[s.index.date <= _fim_mes(ref)]
    if s.empty:
        return None

    def base(fim):
        b = s[s.index.date <= fim]
        return None if b.empty else float(b.iloc[-1])

    ultimo = float(s.iloc[-1])
    var = lambda b: None if not b else (ultimo / b - 1) * 100
    return {"data": s.index[-1].date(), "valor": ultimo, "mes": var(base(_fim_mes(ref, 1))),
            "ano": var(base(date(ref.year - 1, 12, 31))), "m6": var(base(_fim_mes(ref, 6))),
            "m12": var(base(_fim_mes(ref, 12))), "m24": var(base(_fim_mes(ref, 24)))}


def taxa(serie, ref):
    """Série diária de taxa ou nível (Selic, dívida/PIB): valor no fim do mês e diferença em p.p."""
    s = serie.dropna().sort_index()
    s = s[s.index.date <= _fim_mes(ref)]
    if s.empty:
        return None

    def base(fim):
        b = s[s.index.date <= fim]
        return None if b.empty else float(b.iloc[-1])

    ultimo = float(s.iloc[-1])
    dif = lambda b: None if b is None else ultimo - b
    data = s.index[-1].date()
    return {"data": data, "valor": ultimo, "mes": dif(base(_fim_mes(data, 1))),
            "ano": dif(base(date(data.year - 1, 12, 31))), "m12": dif(base(_fim_mes(data, 12)))}


# ------------------------------------------------------------------ principal
def calcular(ano, mes):
    """{"indicadores": [...], "rentabilidade": [...]} para o mês de referência."""
    from dados_planilha import sgs  # mesma busca no Banco Central da planilha base, com novas tentativas

    ref = date(ano, mes, 1)
    inicio = _inicio_mes(ref, 26)
    fim = _fim_mes(ref) + timedelta(days=5)
    nome = lambda d: nome_mes(d.month).lower()

    def buscar(rotulo, funcao):
        try:
            s = funcao()
            if s is None or len(s) == 0:
                print(f"Aviso: sem dados de {rotulo} para os indicadores da carta.")
                return pd.Series(dtype=float)
            return s
        except Exception as e:  # noqa: BLE001 (um indicador a menos não derruba a carta)
            print(f"Aviso: falhou {rotulo} nos indicadores da carta: {e}")
            return pd.Series(dtype=float)

    serie = {
        "selic": buscar("Selic (SGS 432)", lambda: sgs(432, inicio, fim)),
        "ipca": buscar("IPCA (SGS 433)", lambda: sgs(433, inicio, fim)),
        "ipca15": buscar("IPCA-15 (SGS 7478)", lambda: sgs(7478, inicio, fim)),
        "igpm": buscar("IGP-M (SGS 189)", lambda: sgs(189, inicio, fim)),
        "cdi_ano": buscar("CDI anual (SGS 4389)", lambda: sgs(4389, _inicio_mes(ref, 1), fim)),
        "cdi_mes": buscar("CDI no mês (SGS 4391)", lambda: sgs(4391, inicio, fim)),
        "poupanca": buscar("Poupança (SGS 196)", lambda: sgs(196, inicio, fim)),
        "ptax": buscar("PTAX (SGS 1)", lambda: sgs(1, inicio, fim)),
        "divida": buscar("Dívida Bruta (SGS 13762)", lambda: sgs(13762, inicio, fim)),
        "brent": buscar("Brent (BZ=F)", lambda: fechamentos_yahoo("BZ=F", inicio, fim)),
        "ibov": buscar("Ibovespa (^BVSP)", lambda: fechamentos_yahoo("^BVSP", inicio, fim)),
        "sp500": buscar("S&P 500 (^GSPC)", lambda: fechamentos_yahoo("^GSPC", inicio, fim)),
    }
    # Poupança: a série 196 tem uma linha por dia de aniversário; a planilha base usa a do dia 1
    pou = serie["poupanca"]
    serie["poupanca"] = pou[pd.to_datetime(pou.index).day == 1] if len(pou) else pou

    def ok(chave, funcao):
        return funcao(serie[chave], ref) if len(serie[chave]) else None

    selic, ipca, ipca15, igpm = ok("selic", taxa), ok("ipca", mensal), ok("ipca15", mensal), ok("igpm", mensal)
    ptax, brent, divida = ok("ptax", precos), ok("brent", precos), ok("divida", taxa)
    cdi, pou, ibov, sp = ok("cdi_mes", mensal), ok("poupanca", mensal), ok("ibov", precos), ok("sp500", precos)
    cdi_anual = taxa(serie["cdi_ano"], ref) if len(serie["cdi_ano"]) else None

    def ref_txt(m):
        return f"{MESES_ABREV[m.month - 1]}/{m.year}" if m and (m.year, m.month) != (ano, mes) else ""

    # ── tabela Indicadores (texto já formatado, como no editor) ──
    ind = []
    if selic:
        ind.append({"nome": "Selic", "sub": "", "valor": pct_txt(selic["valor"]), "mes": pp_txt(selic["mes"]),
                    "ano": pp_txt(selic["ano"]), "m12": pp_txt(selic["m12"])})
    for chave, rotulo, d, sub in (("ipca", "IPCA", ipca, "Referência {}"),
                                  ("ipca15", "IPCA-15", ipca15, "Prévia de {}"),
                                  ("igpm", "IGP-M", igpm, "{}")):
        if d:
            texto = sub.format(nome(d["mes_ref"]))
            ind.append({"nome": rotulo, "sub": texto[0].upper() + texto[1:], "valor": pct_txt(d["mes"]),
                        "mes": pct_txt(d["mes"]), "ano": pct_txt(d["ano"]), "m12": pct_txt(d["m12"])})
    if ptax:
        ind.append({"nome": "R$/USD", "sub": f"PTAX · fechamento de {nome(ref)}", "valor": num_txt(ptax["valor"]),
                    "mes": pct_txt(ptax["mes"]), "ano": pct_txt(ptax["ano"]), "m12": pct_txt(ptax["m12"])})
    if brent:
        ind.append({"nome": "Brent", "sub": f"US$ por barril · fechamento de {nome(ref)}",
                    "valor": num_txt(brent["valor"]), "mes": pct_txt(brent["mes"]),
                    "ano": pct_txt(brent["ano"]), "m12": pct_txt(brent["m12"])})
    if divida:
        ind.append({"nome": "Dívida Bruta", "sub": f"% do PIB · {nome(divida['data'])}",
                    "valor": pct_txt(divida["valor"], 1), "mes": pp_txt(divida["mes"], 1),
                    "ano": pp_txt(divida["ano"], 1), "m12": pp_txt(divida["m12"], 1)})

    # ── tabela Rentabilidade (números; o modelo da carta formata) ──
    rent = []

    def linha(rotulo, valor_txt, d, referencia="", nota=""):
        if not d:
            return
        rent.append({"nome": rotulo, "valor": valor_txt, "referencia": referencia, "nota": nota,
                     **{k: _r(d.get(k)) for k in ("mes", "ano", "m6", "m12", "m24")}})

    if cdi:
        linha("CDI", pct_txt(cdi_anual["valor"]) if cdi_anual else "", cdi, ref_txt(cdi["mes_ref"]), "taxa ao ano")
    if ipca:
        linha("IPCA", pct_txt(ipca["mes"]), ipca, ref_txt(ipca["mes_ref"]))
    if igpm:
        linha("IGP-M", pct_txt(igpm["mes"]), igpm, ref_txt(igpm["mes_ref"]))
    if pou:
        linha("Poupança", pct_txt(pou["mes"]), pou, ref_txt(pou["mes_ref"]))
    if ptax:
        linha("R$/USD", num_txt(ptax["valor"], 4), ptax, nota="PTAX venda")
    if ibov:
        linha("Ibovespa", num_txt(ibov["valor"], 0), ibov, nota="pontos")
    if sp:
        linha("S&P 500", num_txt(sp["valor"], 0), sp, nota="pontos")

    for l in ind:
        print(f"  {l['nome']:<12} {l['sub']:<40} {l['valor']:>10} | mês {l['mes']:>12} | ano {l['ano']:>12} | 12m {l['m12']:>12}")
    for l in rent:
        print(f"  {l['nome']:<12} {l['valor']:>10} {l['referencia']:<9} | mês {l['mes']} | ano {l['ano']} | "
              f"6m {l['m6']} | 12m {l['m12']} | 24m {l['m24']}")
    return {"indicadores": ind, "rentabilidade": rent}
