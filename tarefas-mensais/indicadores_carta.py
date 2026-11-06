"""
Indicadores da carta mensal calculados a partir das fontes públicas. Usado por carta_mensal.py,
que grava o resultado em carta_dados.json (chave indicadores_auto).

Uma tabela só, em grupos, com fechamento e variação no mês, no ano e em 6, 12 e 24 meses:

  Juros     Selic (meta, SGS 432, variações em p.p.), CDI (taxa anual 4389 e rentabilidade
            acumulada 4391), Poupança (196, linha do dia 1 como na planilha base)
  Inflação  IPCA (433), IPCA-15 (7478), IGP-M (189), variação composta
  Mercado   R$/USD (PTAX venda, SGS 1), Brent (Yahoo BZ=F), Ibovespa (^BVSP), S&P 500 (^GSPC)
  Fiscal    Dívida Bruta (% do PIB, 13762, variações em p.p.)

Índices de preço usam o último mês divulgado: no 3º dia útil o IPCA do mês de referência ainda
não saiu, então a linha mostra o mês anterior e diz isso no detalhe.
Cada indicador que falhar fica de fora com um aviso, sem derrubar a carta.
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
            "ano": dif(base(date(data.year - 1, 12, 31))), "m6": dif(base(_fim_mes(data, 6))),
            "m12": dif(base(_fim_mes(data, 12))), "m24": dif(base(_fim_mes(data, 24)))}


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

    # ── tabela Indicadores: uma linha por indicador, em grupos, tudo já em texto ──
    ind = []
    periodos = ("mes", "ano", "m6", "m12", "m24")

    def linha(grupo, rotulo, sub, valor, d, fmt=pct_txt):
        if d:
            ind.append({"grupo": grupo, "nome": rotulo, "sub": sub, "valor": valor,
                        **{k: fmt(d.get(k)) for k in periodos}})

    def pp1(v):
        return pp_txt(v, 1)

    def ref_mes(d, modelo):
        texto = modelo.format(nome(d["mes_ref"]))
        return texto[0].upper() + texto[1:]

    if selic:
        linha("Juros", "Selic", "", pct_txt(selic["valor"]), selic, pp_txt)
    if cdi:
        linha("Juros", "CDI", "Taxa ao ano · rentabilidade no período" + (f" · {ref_txt(cdi['mes_ref'])}" if ref_txt(cdi["mes_ref"]) else ""),
              pct_txt(cdi_anual["valor"]) if cdi_anual else "", cdi)
    if pou:
        linha("Juros", "Poupança", ref_mes(pou, "Rendimento de {}"), pct_txt(pou["mes"]), pou)
    if ipca:
        linha("Inflação", "IPCA", ref_mes(ipca, "Referência {}"), pct_txt(ipca["mes"]), ipca)
    if ipca15:
        linha("Inflação", "IPCA-15", ref_mes(ipca15, "Prévia de {}"), pct_txt(ipca15["mes"]), ipca15)
    if igpm:
        linha("Inflação", "IGP-M", ref_mes(igpm, "{}"), pct_txt(igpm["mes"]), igpm)
    if ptax:
        linha("Mercado", "R$/USD", f"PTAX · fechamento de {nome(ref)}", num_txt(ptax["valor"]), ptax)
    if brent:
        linha("Mercado", "Brent", f"US$ por barril · fechamento de {nome(ref)}", num_txt(brent["valor"]), brent)
    if ibov:
        linha("Mercado", "Ibovespa", f"Pontos · fechamento de {nome(ref)}", num_txt(ibov["valor"], 0), ibov)
    if sp:
        linha("Mercado", "S&P 500", f"Pontos · fechamento de {nome(ref)}", num_txt(sp["valor"], 0), sp)
    if divida:
        linha("Fiscal", "Dívida Bruta", f"% do PIB · {nome(divida['data'])}", pct_txt(divida["valor"], 1), divida, pp1)

    for l in ind:
        print(f"  {l['grupo']:<9} {l['nome']:<12} {l['sub']:<42} {l['valor']:>10} | " +
              " | ".join(f"{k} {l[k]:>11}" for k in periodos))
    return {"indicadores": ind}
