"""
Carta mensal: busca os dados do mês para a carta da EH e grava carta_dados.json
(séries dos gráficos, fechamento e retorno de cada índice e os destaques da capa).

Os textos de cada seção são escritos no admin do site, na tela Editor da Carta,
que junta estes dados ao modelo carta/carta_template.html e gera o PDF.

Rodar no Spyder: botão Run. Por padrão usa o mês anterior ao de hoje.
Para outro mês, preencha MES abaixo (ex.: "2026-09").
"""
import json
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd

from comum import fechamentos_yahoo, limites_do_mes, mes_referencia, nome_mes, pasta_saida

# ------------------------------------------------------------------ parâmetros
MES = None            # None = mês anterior. Ou "AAAA-MM".

# Nome curto e praça de cada índice na carta em HTML (modelo carta/carta_template.html)
NOMES_CURTOS = {
    "^BVSP": ("Ibovespa", "Brasil"), "^GSPC": ("S&P 500", "Estados Unidos"),
    "^IXIC": ("Nasdaq", "Estados Unidos"), "^DJI": ("Dow Jones", "Estados Unidos"),
    "^STOXX50E": ("Euro Stoxx 50", "Zona do Euro"), "^GDAXI": ("DAX", "Alemanha"),
    "^FTSE": ("FTSE 100", "Reino Unido"), "000001.SS": ("Xangai (SSE)", "China"),
    "^HSCE": ("Hang Seng China Ent.", "Hong Kong"), "^N225": ("Nikkei 225", "Japão"),
}


# ------------------------------------------------------------------ dados
def retorno_no_mes(ticker, inicio, fim):
    """Fechamentos do mês precedidos do último fechamento do mês anterior (base = 0%).

    Usar o último pregão anterior como base evita perder o retorno do primeiro dia
    quando o último dia do mês anterior cai num fim de semana ou feriado.
    """
    s = fechamentos_yahoo(ticker, inicio - timedelta(days=15), fim + timedelta(days=1)).dropna()
    if s.empty:
        return pd.DataFrame(columns=["Close", "Cumulative Return"], index=pd.DatetimeIndex([]), dtype=float)
    antes, no_mes = s[s.index.date < inicio], s[s.index.date >= inicio]
    if no_mes.empty:
        return pd.DataFrame(columns=["Close", "Cumulative Return"], index=pd.DatetimeIndex([]), dtype=float)
    serie = pd.concat([antes.iloc[-1:], no_mes]) if not antes.empty else no_mes
    return pd.DataFrame({"Close": serie, "Cumulative Return": serie / serie.iloc[0] - 1})


def baixar_indices(inicio, fim):
    dados = {}
    for t, (nome, _praca) in NOMES_CURTOS.items():
        d = retorno_no_mes(t, inicio, fim)
        if d.empty:
            print(f"Aviso: sem dados de {nome} ({t}) no mês.")
        dados[t] = d
    return pd.concat(dados, axis=1).sort_index()


def _numero_ou_nada(v, casas=2):
    return None if pd.isna(v) else round(float(v), casas)


def _pct_texto(v):
    sinal = "+ " if v > 0 else ("\u2212 " if v < 0 else "")
    return f"{sinal}{abs(v):.2f}%".replace(".", ",")


def selic_meta():
    """Meta Selic mais recente (série 432 do SGS do Banco Central), ou None."""
    import json
    import urllib.request

    url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json"
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            return float(json.loads(resp.read())[0]["valor"])
    except Exception as e:  # noqa: BLE001 (a carta sai sem a Selic na capa)
        print(f"Aviso: não consegui buscar a Selic no Banco Central ({e}).")
        return None


def dados_carta(df, inicio, fim, mes_nome, ano):
    """Dados do mês para o modelo HTML da carta: séries dos gráficos, tabela de índices
    e destaques da capa. Os textos de cada seção entram depois, no editor."""
    datas = df.index
    series, indices = {}, []
    for t, (nome, praca) in NOMES_CURTOS.items():
        cum = df[(t, "Cumulative Return")]
        series[t] = [_numero_ou_nada(v * 100) for v in cum]
        ok = cum.dropna()
        close = df[(t, "Close")].dropna()
        indices.append({
            "ticker": t, "nome": nome, "praca": praca,
            "fechamento": _numero_ou_nada(close.iloc[-1], 0) if not close.empty else None,
            "retorno": _numero_ou_nada(ok.iloc[-1] * 100) if not ok.empty else None,
            "ultima_data": f"{ok.index[-1]:%d/%m/%Y}" if not ok.empty else None,
        })
    retorno = {i["ticker"]: i["retorno"] for i in indices}
    destaques = []
    for t, rotulo in (("^BVSP", "Ibovespa no mês"), ("^GSPC", "S&P 500 no mês")):
        if retorno.get(t) is not None:
            destaques.append({"rotulo": rotulo, "valor": _pct_texto(retorno[t]),
                              "classe": "pos" if retorno[t] >= 0 else "neg"})
    dolar = fechamentos_yahoo("BRL=X", inicio - timedelta(days=10), fim + timedelta(days=1)).dropna()
    if not dolar.empty:
        destaques.append({"rotulo": "Dólar (fechamento)", "valor": f"R$ {dolar.iloc[-1]:.2f}".replace(".", ",")})
    selic = selic_meta()
    if selic is not None:
        destaques.append({"rotulo": "Selic", "valor": f"{selic:.2f}%".replace(".", ",")})
    return {
        "mes": f"{ano}-{inicio.month:02d}", "mes_nome": mes_nome, "ano": ano,
        "base_data": f"{datas[0]:%d/%m/%Y}",
        "datas": [f"{d:%d/%m}" for d in datas],
        "series": series, "indices": indices, "destaques": destaques,
    }


# ------------------------------------------------------------------ principal
def main(mes=MES):
    ano, m = mes_referencia(mes)
    inicio, fim = limites_do_mes(ano, m)
    mes_nome = nome_mes(m)
    print(f"Dados da carta mensal de {mes_nome}/{ano} ({inicio:%d/%m} a {fim:%d/%m})")

    df = baixar_indices(inicio, fim)
    if df.dropna(how="all").empty:
        raise RuntimeError("Yahoo Finance não devolveu nenhum índice no mês.")
    caminho = os.path.join(pasta_saida(ano, m), "carta_dados.json")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(dados_carta(df, inicio, fim, mes_nome, ano), f, ensure_ascii=False, indent=1)
    print(f"Arquivo salvo: {caminho}")
    print("Escreva os textos no admin do site, em Editor da Carta.")
    return [caminho]


if __name__ == "__main__":
    main()
