# -*- coding: utf-8 -*-
"""
Rendimentos de FIIs (tarefa "rendimentos_fiis").

Veio do scraper_fiis.py da Elisa: abre a página de rendimentos e amortizações do Funds
Explorer de cada ticker e gera "Rendimentos FIIs <periodo>.xlsx" com ticker, data de
pagamento, data base e valor por cota, filtrado pela DATA DE PAGAMENTO.

Período: DATA_INICIO e DATA_FIM (AAAA-MM-DD) quando existem; senão o mês de referência.

Lista de tickers: um por linha. Fica no bucket privado em config/tickers_fiis.txt (o admin
do site tem o botão para enviar), porque o repositório é público. Rodando no computador,
vale também um tickers_fiis.txt nesta pasta (fora do Git). Os logs só mostram contagens.
"""
import os
import random
import sys
import time

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

AQUI = os.path.dirname(os.path.abspath(__file__))
ARQUIVO_LOCAL = os.path.join(AQUI, "tickers_fiis.txt")
ARQUIVO_BUCKET = "config/tickers_fiis.txt"
BASE_URL = "https://www.fundsexplorer.com.br/rendimentos-e-amortizacoes?ticker={ticker}"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def _ler_tickers(texto):
    vistos = []
    for linha in texto.lstrip("﻿").splitlines():
        t = linha.split("#")[0].strip().upper()
        if t and t not in vistos:
            vistos.append(t)
    return vistos


def carregar_tickers():
    if os.path.exists(ARQUIVO_LOCAL):
        with open(ARQUIVO_LOCAL, encoding="utf-8") as f:
            return _ler_tickers(f.read())
    import supabase_storage
    if supabase_storage.configurado():
        conteudo = supabase_storage.baixar(ARQUIVO_BUCKET)
        if conteudo:
            return _ler_tickers(conteudo.decode("utf-8", "replace"))
    raise SystemExit("Lista de FIIs não encontrada. Envie o tickers.txt em Tarefas Mensais → "
                     "Listas das tarefas (fica em config/tickers_fiis.txt no bucket privado).")


def extrair(page, ticker):
    """Linhas da tabela do Funds Explorer para o ticker (cabeçalho normalizado)."""
    page.goto(BASE_URL.format(ticker=ticker), wait_until="networkidle", timeout=60000)
    seletor = f"table tbody tr[data-ticker='{ticker.lower()}']"
    try:
        page.wait_for_selector(seletor, state="attached", timeout=20000)
    except Exception:
        raise ValueError("ticker não encontrado no Funds Explorer (ou a página não carregou)") from None
    res = page.evaluate("""(sel) => {
        const table = document.querySelector('table');
        const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
        const rows = [...document.querySelectorAll(sel)]
            .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
            .filter(c => c.length);
        return {headers, rows};
    }""", seletor)
    if not res["rows"]:
        raise ValueError("tabela sem linhas")
    n = len(res["rows"][0])
    df = pd.DataFrame(res["rows"], columns=res["headers"][:n] if len(res["headers"]) >= n else None)
    df.columns = (pd.Index(df.columns).astype(str).str.strip().str.lower()
                  .str.replace(r"[^\w]", "_", regex=True).str.replace(r"_+", "_", regex=True).str.strip("_"))
    df.insert(0, "ticker", ticker)
    return df.drop_duplicates()


def numero_br(serie):
    texto = serie.astype(str).str.strip().str.replace(r"[^\d,.\-]", "", regex=True)
    tem_virgula = texto.str.contains(",", regex=False)
    texto = texto.mask(tem_virgula, texto.str.replace(".", "", regex=False))
    return pd.to_numeric(texto.str.replace(",", ".", regex=False), errors="coerce")


def main(mes=None):
    from comum import mes_referencia, pasta_saida
    from cra_eventos import periodo
    ano, m = mes_referencia(mes)
    d_ini, d_fim = periodo(mes)
    tickers = carregar_tickers()
    print(f"Período (data de pagamento): {d_ini:%d/%m/%Y} a {d_fim:%d/%m/%Y}. {len(tickers)} FIIs na lista.")

    from playwright.sync_api import sync_playwright
    frames, status = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_context(user_agent=UA, locale="pt-BR").new_page()
        for i, t in enumerate(tickers, 1):
            erro = None
            for tentativa in (1, 2):
                try:
                    df = extrair(page, t)
                    frames.append(df)
                    erro = None
                    break
                except Exception as e:  # noqa: BLE001
                    erro = str(e).splitlines()[0][:200] if str(e) else type(e).__name__
                    time.sleep(3)
            status.append({"ticker": t, "status": "FALHA" if erro else "OK", "mensagem": erro or ""})
            print(f"[{i}/{len(tickers)}] {'FALHA: ' + erro[:100] if erro else 'ok'}", flush=True)
            time.sleep(random.uniform(1, 2))
        browser.close()

    tudo = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["ticker"])
    for c in ("data_de_pagamento", "data_base"):
        if c in tudo.columns:
            tudo[c] = pd.to_datetime(tudo[c], dayfirst=True, errors="coerce")
    valor = next((c for c in tudo.columns if c.startswith("valor")), None)
    if valor:
        tudo[valor] = numero_br(tudo[valor])
        tudo = tudo.rename(columns={valor: "valor_por_cota"})
    if "data_de_pagamento" not in tudo.columns:
        tudo["data_de_pagamento"] = pd.NaT
    janela = tudo[(tudo["data_de_pagamento"] >= pd.Timestamp(d_ini)) &
                  (tudo["data_de_pagamento"] <= pd.Timestamp(d_fim))]
    colunas = [c for c in ("ticker", "data_de_pagamento", "data_base", "valor_por_cota") if c in janela.columns]
    # o site repete as linhas (filtros escondidos de setor): tira as repetidas
    janela = janela[colunas].drop_duplicates().sort_values(["ticker", "data_de_pagamento"])

    st = pd.DataFrame(status, columns=["ticker", "status", "mensagem"])
    pagos = set(janela["ticker"])
    st.loc[(st["status"] == "OK") & ~st["ticker"].isin(pagos), "mensagem"] = "sem pagamento no período"

    rotulo = f"{d_ini:%Y-%m}" if (d_ini.day == 1 and d_fim == (pd.Timestamp(d_ini) + pd.offsets.MonthEnd(0)).date()) \
        else f"{d_ini:%Y-%m-%d} a {d_fim:%Y-%m-%d}"
    caminho = os.path.join(pasta_saida(ano, m), f"Rendimentos FIIs {rotulo}.xlsx")
    historico = tudo[[c for c in ("ticker", "data_de_pagamento", "data_base", "valor_por_cota") if c in tudo.columns]].drop_duplicates()
    with pd.ExcelWriter(caminho, engine="openpyxl", datetime_format="DD/MM/YYYY") as xl:
        janela.to_excel(xl, sheet_name="Rendimentos", index=False)
        historico.sort_values(["ticker", "data_de_pagamento"]).to_excel(xl, sheet_name="Historico", index=False)
        st.to_excel(xl, sheet_name="Status", index=False)
        for ws in xl.sheets.values():
            ws.freeze_panes = "A2"
            for col in ws.columns:
                ws.column_dimensions[col[0].column_letter].width = 20
                if col[0].value == "valor_por_cota":
                    for cel in col[1:]:
                        cel.number_format = "#,##0.00########"

    falhas = int((st["status"] != "OK").sum())
    print(f"{len(janela)} pagamentos no período, de {len(pagos)} FIIs.")
    if falhas:
        print(f"Aviso: {falhas} de {len(st)} FIIs falharam — veja a aba Status da planilha.")
    sem = int(((st["status"] == "OK") & ~st["ticker"].isin(pagos)).sum())
    if sem:
        print(f"Aviso: {sem} FIIs sem pagamento no período (aba Status).")
    return [caminho]


if __name__ == "__main__":
    # No computador: ponha a lista aqui como tickers_fiis.txt e, se quiser, as datas:
    # os.environ["DATA_INICIO"] = "2026-10-01"; os.environ["DATA_FIM"] = "2026-10-31"
    print(main())
