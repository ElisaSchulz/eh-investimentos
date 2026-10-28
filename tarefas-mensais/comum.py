"""
Funções compartilhadas pelas tarefas mensais.

Mês de referência, pasta de saída e chave da FRED vêm de variáveis de ambiente
quando existem (é assim que o GitHub Actions passa), senão dos valores padrão:

    MES_REFERENCIA   "AAAA-MM". Padrão: mês anterior ao de hoje.
    PASTA_SAIDA      onde gravar os arquivos. Padrão: saidas/AAAA-MM ao lado dos scripts.
    FRED_API_KEY     chave da FRED. Sem ela, o script procura o arquivo chave_fred.txt
                     nesta pasta (o arquivo não vai para o GitHub, está no .gitignore).
"""
import calendar
import os
from datetime import date, timedelta

import pandas as pd

AQUI = os.path.dirname(os.path.abspath(__file__))

MESES_PT = {
    1: "Janeiro", 2: "Fevereiro", 3: "Março", 4: "Abril", 5: "Maio", 6: "Junho",
    7: "Julho", 8: "Agosto", 9: "Setembro", 10: "Outubro", 11: "Novembro", 12: "Dezembro",
}


def mes_referencia(mes=None):
    """Devolve (ano, mes) do mês de referência.

    Ordem: argumento `mes` ("AAAA-MM"), variável MES_REFERENCIA, mês anterior ao de hoje.
    """
    mes = mes or os.environ.get("MES_REFERENCIA") or None
    if mes:
        ano, m = (int(x) for x in mes.split("-"))
        return ano, m
    anterior = date.today().replace(day=1) - timedelta(days=1)
    return anterior.year, anterior.month


def limites_do_mes(ano, mes):
    """Primeiro e último dia do mês (date)."""
    return date(ano, mes, 1), date(ano, mes, calendar.monthrange(ano, mes)[1])


def nome_mes(mes):
    return MESES_PT[mes]


def pasta_saida(ano, mes):
    pasta = os.environ.get("PASTA_SAIDA") or os.path.join(AQUI, "saidas", f"{ano}-{mes:02d}")
    os.makedirs(pasta, exist_ok=True)
    return pasta


def chave_fred():
    chave = os.environ.get("FRED_API_KEY", "").strip()
    if chave:
        return chave
    arquivo = os.path.join(AQUI, "chave_fred.txt")
    if os.path.exists(arquivo):
        with open(arquivo, encoding="utf-8") as f:
            return f.read().strip()
    raise SystemExit(
        "Chave da FRED não encontrada. Crie o arquivo chave_fred.txt nesta pasta com a chave "
        "(uma linha só) ou defina a variável de ambiente FRED_API_KEY."
    )


def ler_csv(nome):
    """Lê uma lista de configuração (CSV separado por ;) desta pasta."""
    return pd.read_csv(os.path.join(AQUI, nome), sep=";", dtype=str, keep_default_na=False)


def fechamentos_yahoo(ticker, inicio, fim, coluna="Close"):
    """Série diária de fechamento de um ticker do Yahoo, com índice de datas sem fuso.

    `fim` é exclusivo, como no yfinance. Devolve série vazia se o Yahoo não tiver dados.
    """
    import yfinance as yf

    hist = yf.Ticker(ticker).history(start=str(inicio), end=str(fim), interval="1d",
                                     auto_adjust=False)
    if hist.empty:
        return pd.Series(dtype=float, name=ticker)
    if coluna not in hist.columns:
        print(f"Aviso: {coluna} indisponível para {ticker}. Usando Close.")
        coluna = "Close"
    serie = hist[coluna].copy()
    serie.index = pd.to_datetime(serie.index).tz_localize(None).normalize()
    serie = serie[~serie.index.duplicated(keep="last")]
    serie.name = ticker
    return serie
