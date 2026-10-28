"""
Cotas (fechamento sem ajuste de proventos) dos ativos da B3 em todos os pregões
do mês. Saída: Excel com as datas na coluna A e os ativos nas colunas, na ordem
da lista ativos_b3.csv (linha 1 com o nome, linha 2 com o ticker).

Rodar no Spyder: botão Run. Por padrão pega todos os pregões do mês anterior.
Para outro mês, preencha MES (ex.: "2026-10"). Para um intervalo específico,
preencha DATA_INICIO e DATA_FIM (ex.: "2026-10-01" e "2026-10-20").

Para incluir ou tirar ativos, edite ativos_b3.csv (ticker;nome).
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter

from comum import ler_csv, limites_do_mes, mes_referencia, nome_mes, pasta_saida

# ------------------------------------------------------------------ parâmetros
MES = None          # None = mês anterior. Ou "AAAA-MM".
DATA_INICIO = os.environ.get("DATA_INICIO") or None   # "AAAA-MM-DD" para um intervalo próprio
DATA_FIM = os.environ.get("DATA_FIM") or None


def baixar(tickers, inicio, fim):
    import yfinance as yf

    dados = yf.download([f"{t}.SA" for t in tickers], start=str(inicio),
                        end=str(fim + timedelta(days=1)),  # 'end' é exclusivo
                        auto_adjust=False, progress=False, group_by="ticker")
    series = {}
    for t in tickers:
        try:
            series[t] = dados[f"{t}.SA"]["Close"].dropna()
        except KeyError:
            pass  # ticker sem dados no Yahoo: coluna fica em branco
    tabela = pd.concat(series, axis=1) if series else pd.DataFrame(index=pd.DatetimeIndex([]))
    tabela = tabela.reindex(columns=tickers)
    tabela.index = pd.to_datetime(tabela.index).tz_localize(None).normalize()
    # Só datas de pregão (em que algum ativo negociou) dentro do intervalo
    tabela = tabela[(tabela.index.date >= inicio) & (tabela.index.date <= fim)].dropna(how="all")
    return tabela.sort_index()


def main(mes=MES):
    ano, m = mes_referencia(mes)
    inicio, fim = limites_do_mes(ano, m)
    if DATA_INICIO:
        inicio = date.fromisoformat(DATA_INICIO)
    if DATA_FIM:
        fim = date.fromisoformat(DATA_FIM)
    ativos = ler_csv("ativos_b3.csv")
    tickers = list(ativos["ticker"])
    print(f"Cotas B3 de {len(tickers)} ativos, {inicio:%d/%m/%Y} a {fim:%d/%m/%Y}")

    tabela = baixar(tickers, inicio, fim)
    if tabela.empty:
        raise RuntimeError("Yahoo Finance não devolveu nenhuma cotação no período.")
    datas = len(tabela)
    tabela.index = tabela.index.strftime("%d/%m/%Y")
    tabela.index.name = "Data"
    tabela = tabela.round(2)

    caminho = os.path.join(pasta_saida(ano, m), f"cotas_b3_{nome_mes(m).lower()}_{ano}.xlsx")
    with pd.ExcelWriter(caminho, engine="openpyxl") as writer:
        tabela.to_excel(writer, sheet_name="Cotas", startrow=2, header=False)
        ws = writer.sheets["Cotas"]
        ws.cell(row=1, column=1, value="Data").font = Font(bold=True)
        for i, (t, nome) in enumerate(zip(ativos["ticker"], ativos["nome"]), start=2):
            c1 = ws.cell(row=1, column=i, value=nome)
            c1.font = Font(bold=True)
            c1.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
            c2 = ws.cell(row=2, column=i, value=t)
            c2.font = Font(italic=True)
            c2.alignment = Alignment(horizontal="center")
            ws.column_dimensions[get_column_letter(i)].width = 18
            for r in range(3, 3 + datas):
                ws.cell(row=r, column=i).number_format = "#,##0.00"
        ws.column_dimensions["A"].width = 12
        ws.row_dimensions[1].height = 60
        ws.freeze_panes = "B3"

    faltando = [t for t in tickers if tabela[t].isna().all()]
    if faltando:
        print(f"Aviso: sem nenhuma cotação no Yahoo Finance: {', '.join(faltando)}")
    parciais = [t for t in tickers if t not in faltando and tabela[t].isna().any()]
    if parciais:
        print(f"Aviso: com datas faltando: {', '.join(parciais)}")
    print(f"{datas} pregões. Arquivo salvo: {caminho}")
    return [caminho]


if __name__ == "__main__":
    main()
