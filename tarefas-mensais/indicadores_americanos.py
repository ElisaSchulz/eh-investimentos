"""
Indicadores americanos em Excel: CPI (FRED) e fechamentos de câmbio, juros e
bolsas (Yahoo Finance). Gera USA_Indicators.xlsx com as abas CPI e Indexes.

Rodar no Spyder: botão Run. Por padrão vai até o fim do mês anterior.
Para outro mês, preencha MES abaixo (ex.: "2026-09").

A chave da FRED não fica mais no código: crie o arquivo chave_fred.txt nesta
pasta (uma linha só, com a chave) ou defina a variável FRED_API_KEY.
"""
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd

from comum import chave_fred, fechamentos_yahoo, limites_do_mes, mes_referencia, pasta_saida

# ------------------------------------------------------------------ parâmetros
MES = None                    # None = mês anterior. Ou "AAAA-MM".
INICIO_INFLACAO = "2020-12-01"
INICIO_INDICES = "2022-12-31"
TICKERS = ["BRL=X", "DX-Y.NYB", "^TNX", "^GSPC", "^IXIC", "^DJI", "^STOXX", "^FTSE",
           "^GDAXI", "000001.SS", "^HSI"]
ARQUIVO = "USA_Indicators.xlsx"


def main(mes=MES):
    from fredapi import Fred

    ano, m = mes_referencia(mes)
    _, fim = limites_do_mes(ano, m)
    fim_exclusivo = fim + timedelta(days=1)
    print(f"Indicadores americanos até {fim:%d/%m/%Y}")

    cpi = Fred(api_key=chave_fred()).get_series("CPIAUCSL", INICIO_INFLACAO, fim)
    inflacao = pd.DataFrame({"CPI": cpi})
    inflacao.index = inflacao.index.strftime("%d/%m/%Y")

    series = {}
    for t in TICKERS:
        s = fechamentos_yahoo(t, INICIO_INDICES, fim_exclusivo)
        if s.empty:
            print(f"Aviso: sem dados para {t}.")
        series[t] = s
    indices = pd.concat(series, axis=1).sort_index().ffill()
    indices.index.name = "Data"

    caminho = os.path.join(pasta_saida(ano, m), ARQUIVO)
    with pd.ExcelWriter(caminho) as writer:
        inflacao.to_excel(writer, sheet_name="CPI")
        indices.to_excel(writer, sheet_name="Indexes")
    print(f"Arquivo salvo: {caminho}")
    return [caminho]


if __name__ == "__main__":
    main()
