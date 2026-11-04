# -*- coding: utf-8 -*-
"""
Coleta os dados da planilha base (Dados_EH_Investimentos.xlsx) e gera um arquivo de
atualização no mesmo layout dela, para a macro ImportarDadosEH colar sozinha.

Rodar no Spyder: botão Run. Por padrão pega o mês anterior (as séries mensais
pegam os últimos 6 meses, porque o IPCA sai só no meio do mês seguinte).
Para outro mês, preencha MES. Para um intervalo próprio, DATA_INICIO e DATA_FIM.

O que coleta e para onde vai na planilha base:

    Aba Dados
      IPCA, IGP-M, Poupança (variação mensal)  E:J  Banco Central (SGS 433, 189, 196)
      CDI (taxa anual)                         M:N  Banco Central (SGS 4389)
      PTAX venda                               Q:R  Banco Central (SGS 1)
      Ibovespa                                 T:U  Yahoo (^BVSP, pontos inteiros)
      S&P 500                                  W:X  Yahoo (^GSPC)
      Indicadores globais                      Z:AL Yahoo (AGG ajustado; BRL=X do fim do mês = PTAX)
      CPI EUA                                  AN:AO FRED (precisa da chave)
    Aba Cotas
      Fundos brasileiros (fundos_brasil.csv)   pelo CNPJ da linha 2   CVM, informe diário
      FIDCs e fundos fora do informe diário    pelo CNPJ da linha 2   CVM, informe mensal de FIDC
                                                                     (só a cota de fim de mês)
      FIIs e FIAGROs                           pelo CNPJ da linha 2   CVM, informe mensal (cota patrimonial)
      FIPs                                     pelo CNPJ da linha 2   CVM, informe quadrimestral
      Ações, FIIs e ETFs (ativos_b3.csv)       pelo ticker da linha 2 Yahoo

Abas do arquivo gerado:
    Importar      uma linha por valor (aba, coluna, data, valor). É o que a macro lê.
    Conferência   o que faltou, cota repetida e variação fora do normal.
    Dados - ...   cada bloco no layout da planilha, para copiar e colar à mão.
    Cotas         nome na linha 1, CNPJ/ticker na linha 2 e datas nas linhas, com todos os
                  fundos da lista; os sem cota ficam vazios (cabeçalho amarelo) para colar à mão.
    Notas         fontes e premissas.
"""
import io
import json
import re
import os
import sys
import time
import urllib.request
import zipfile
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from comum import fechamentos_yahoo, ler_csv, limites_do_mes, mes_referencia, nome_mes, pasta_saida

# ------------------------------------------------------------------ parâmetros
MES = None          # None = mês anterior. Ou "AAAA-MM".
DATA_INICIO = os.environ.get("DATA_INICIO") or None   # "AAAA-MM-DD" para um intervalo próprio
DATA_FIM = os.environ.get("DATA_FIM") or None
MESES_SERIES_MENSAIS = 6   # quantos meses para trás buscar IPCA, IGP-M, Poupança e CPI
BLOCOS = os.environ.get("BLOCOS_DADOS") or "todos"   # ou alguns de: bc,yahoo,cpi,cotas_cvm,cotas_fidc,cotas_b3

# Bloco da aba Dados -> (coluna da data, coluna do valor, nome)
DADOS = {
    "ipca": ("E", "F", "IPCA"),
    "igpm": ("E", "H", "IGP-M"),
    "poupanca": ("E", "J", "Poupança"),
    "cdi": ("M", "N", "CDI"),
    "ptax": ("Q", "R", "PTAX venda"),
    "ibov": ("T", "U", "Ibovespa"),
    "sp500": ("W", "X", "S&P 500"),
    "cpi": ("AN", "AO", "CPI"),
}
GLOBAIS = {  # ticker do Yahoo -> coluna na aba Dados (datas em Z)
    "BRL=X": "AA", "DX-Y.NYB": "AB", "^TNX": "AC", "^GSPC": "AD", "^IXIC": "AE",
    "^DJI": "AF", "^STOXX": "AG", "^FTSE": "AH", "^GDAXI": "AI", "000001.SS": "AJ",
    "^HSI": "AK", "AGG": "AL",
}
AJUSTADOS = {"AGG"}
SGS = {"ipca": 433, "igpm": 189, "poupanca": 196, "cdi": 4389, "ptax": 1}

# Limites da conferência: variação de um dia para o outro que merece um olhar
LIMITE_VARIACAO = {"fundo": 0.02, "b3": 0.10, "indice": 0.06, "cambio": 0.04, "taxa": 0.10}
DIAS_REPETIDA = 3   # cota igual por este número de dias seguidos vira aviso

CVM = "https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS"
CVM_FIDC = "https://dados.cvm.gov.br/dados/FIDC/DOC/INF_MENSAL/DADOS"
CVM_FII = "https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS"
CVM_FIAGRO = "https://dados.cvm.gov.br/dados/FIAGRO/DOC/INF_MENSAL/DADOS"
CVM_FIP = "https://dados.cvm.gov.br/dados/FIP/DOC/INF_QUADRIMESTRAL/DADOS"
MESES_FIDC = 3   # meses para trás no informe mensal de FIDC (ele sai até uns 15 dias depois do fim do mês)
UA = {"User-Agent": "Mozilla/5.0 (tarefas-mensais EH)"}


# --------------------------------------------------------------------------
# Fontes
# --------------------------------------------------------------------------
def baixar(url, tentativas=4, timeout=180):
    for i in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if i == tentativas - 1:
                print(f"Aviso: falhou {url}: {e}")
                return None
            time.sleep(2 ** (i + 1))


def sgs(codigo, inicio, fim):
    """Série do Banco Central (SGS) como pd.Series indexada por data. Valores em %."""
    url = (f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados?formato=json"
           f"&dataInicial={inicio:%d/%m/%Y}&dataFinal={fim:%d/%m/%Y}")
    vazia = pd.Series(dtype=float, index=pd.DatetimeIndex([], name="data"))
    # A API do Banco Central às vezes devolve uma página de erro (HTML) em vez do JSON;
    # costuma passar tentando de novo depois de alguns segundos.
    for tentativa in range(4):
        bruto = baixar(url)
        if not bruto:
            return vazia
        try:
            dados = json.loads(bruto)
            break
        except ValueError:
            if tentativa == 3:
                trecho = bruto[:120].decode("utf-8", "replace").replace("\n", " ")
                print(f"Aviso: resposta inesperada do Banco Central para a série {codigo}: {trecho}")
                return vazia
            time.sleep(10 * (tentativa + 1))
    if not isinstance(dados, list) or not dados:
        return vazia
    df = pd.DataFrame(dados)
    df["data"] = pd.to_datetime(df["data"], format="%d/%m/%Y")
    df["valor"] = pd.to_numeric(df["valor"], errors="coerce")
    return df.set_index("data")["valor"].dropna().sort_index()


def series_banco_central(inicio, fim, inicio_mensal):
    """Devolve {bloco: Series} com os valores já no formato da planilha (decimal, não %)."""
    out = {}
    for bloco in ("ipca", "igpm"):
        s = sgs(SGS[bloco], inicio_mensal, fim) / 100
        out[bloco] = s.round(6)
    # Poupança: a série 196 tem uma linha por dia de aniversário; a planilha usa o dia 1
    pou = sgs(SGS["poupanca"], inicio_mensal, fim)
    out["poupanca"] = (pou[pou.index.day == 1] / 100).round(6)
    out["cdi"] = (sgs(SGS["cdi"], inicio, fim) / 100).round(6)
    out["ptax"] = sgs(SGS["ptax"], inicio, fim).round(4)
    return out


def series_yahoo(inicio, fim):
    fim_exclusivo = fim + timedelta(days=1)
    out = {
        # O Yahoo entrega o Ibovespa em pontos inteiros; a macro aceita diferença de até 1 ponto
        "ibov": fechamentos_yahoo("^BVSP", inicio, fim_exclusivo).round(2),
        "sp500": fechamentos_yahoo("^GSPC", inicio, fim_exclusivo).round(2),
    }
    # AGG entra ajustado por dividendos (Adj Close), como na planilha
    globais = {t: fechamentos_yahoo(t, inicio - timedelta(days=10), fim_exclusivo,
                                    coluna="Adj Close" if t in AJUSTADOS else "Close")
               for t in GLOBAIS}
    tabela = pd.concat(globais, axis=1).sort_index().ffill()
    tabela = tabela[(tabela.index.date >= inicio) & (tabela.index.date <= fim)]
    for t in GLOBAIS:
        if globais[t].empty:
            print(f"Aviso: Yahoo sem dados para {t}.")
    return out, tabela


def serie_cpi(inicio_mensal, fim):
    chave = os.environ.get("FRED_API_KEY", "").strip()
    arquivo = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chave_fred.txt")
    if not chave and os.path.exists(arquivo):
        chave = open(arquivo, encoding="utf-8").read().strip()
    if not chave:
        print("Aviso: sem chave da FRED, o CPI ficou de fora.")
        return pd.Series(dtype=float)
    from fredapi import Fred

    return Fred(api_key=chave).get_series("CPIAUCSL", inicio_mensal, fim).dropna()


def cotas_cvm(cnpjs, inicio, fim):
    """Cotas do informe diário da CVM. Devolve (tabela data x CNPJ, avisos por CNPJ)."""
    alvo = {"".join(ch for ch in c if ch.isdigit()): c for c in cnpjs}
    linhas, subclasses = [], {}
    meses = pd.period_range(inicio, fim, freq="M")
    for p in meses:
        bruto = baixar(f"{CVM}/inf_diario_fi_{p.year}{p.month:02d}.zip")
        if not bruto:
            continue
        z = zipfile.ZipFile(io.BytesIO(bruto))
        for nome in z.namelist():
            df = pd.read_csv(z.open(nome), sep=";", dtype=str, encoding="latin-1")
            col_cnpj = next(c for c in df.columns if c.startswith("CNPJ_FUNDO"))
            df["cnpj"] = df[col_cnpj].str.replace(r"\D", "", regex=True)
            df = df[df["cnpj"].isin(alvo)]
            if "ID_SUBCLASSE" not in df.columns:
                df["ID_SUBCLASSE"] = ""
            df["ID_SUBCLASSE"] = df["ID_SUBCLASSE"].fillna("")
            linhas.append(df[["cnpj", "ID_SUBCLASSE", "DT_COMPTC", "VL_QUOTA"]])
    if not linhas:
        return pd.DataFrame(), {}
    df = pd.concat(linhas)
    df["data"] = pd.to_datetime(df["DT_COMPTC"])
    df["cota"] = pd.to_numeric(df["VL_QUOTA"], errors="coerce")
    df = df[(df["data"].dt.date >= inicio) & (df["data"].dt.date <= fim) & (df["cota"] > 0)]

    avisos = {}
    escolhidos = []
    for cnpj, g in df.groupby("cnpj"):
        subs = sorted(set(g["ID_SUBCLASSE"]))
        if len(subs) > 1:
            # Mais de uma subclasse no mesmo CNPJ: não dá para saber qual é a da planilha
            subclasses[alvo[cnpj]] = subs
            avisos[alvo[cnpj]] = f"CNPJ com {len(subs)} subclasses na CVM ({', '.join(subs)[:80]}): conferir à mão"
            continue
        escolhidos.append(g)
    if not escolhidos:
        return pd.DataFrame(), avisos
    df = pd.concat(escolhidos)
    tabela = df.pivot_table(index="data", columns="cnpj", values="cota", aggfunc="last")
    tabela.columns = [alvo[c] for c in tabela.columns]
    return tabela.sort_index(), avisos


def _num(x):
    try:
        return float(str(x).replace(",", "."))
    except ValueError:
        return 0.0


def _serie_do_nome(nome):
    """Número da série/subclasse sênior escrito no nome da planilha (SR2, SEN2...), ou None."""
    import re
    m = re.search(r"\b(?:SR|SEN|SÊNIOR|SENIOR)\s*(\d+)\b", nome.upper())
    return int(m.group(1)) if m else None


def _ultimo_dia_util(d):
    d = pd.Timestamp(d)
    while d.weekday() >= 5:
        d -= pd.Timedelta(days=1)
    return d


def cotas_fidc_mensal(fundos, ate, meses=MESES_FIDC):
    """Cota de fim de mês do informe mensal de FIDC da CVM (tabelas X.2 e IV).

    fundos: lista de (cnpj, nome). Usa a subclasse sênior; se a sênior está zerada e só uma
    subclasse tem cota (FIC que só tem a subordinada como classe única), usa essa. Quando o
    fundo informou a quantidade no campo da cota, calcula PL / quantidade.
    Devolve (cotas {cnpj: Series}, origem {cnpj: texto}, avisos {cnpj: texto}, meses sem informe).
    """
    digitos = lambda c: "".join(ch for ch in c if ch.isdigit())
    por_cnpj = {digitos(c): (c, n) for c, n in fundos}
    por_raiz = {}
    for d in por_cnpj:
        por_raiz.setdefault(d[:8], []).append(d)
    linhas, pls, sem_informe = [], {}, []
    fim = pd.Period(ate, freq="M")
    for p in pd.period_range(fim - meses, fim, freq="M"):
        bruto = baixar(f"{CVM_FIDC}/inf_mensal_fidc_{p.year}{p.month:02d}.zip", tentativas=2)
        if not bruto:
            sem_informe.append(p)
            continue
        z = zipfile.ZipFile(io.BytesIO(bruto))
        for nome in z.namelist():
            if "tab_X_2_" not in nome and "tab_IV_" not in nome:
                continue
            df = pd.read_csv(z.open(nome), sep=";", dtype=str, encoding="latin-1")
            df["cnpj"] = df["CNPJ_FUNDO_CLASSE"].str.replace(r"\D", "", regex=True)
            df = df[df["cnpj"].str[:8].isin(por_raiz)]
            if "tab_IV_" in nome:
                col_pl = next((c for c in df.columns if c.endswith("_VL_PL")), None)
                if col_pl:
                    for _, r in df.iterrows():
                        pls[(r["cnpj"], r["DT_COMPTC"])] = _num(r[col_pl])
            else:
                linhas.append(df)
    cotas, origem, avisos = {}, {}, {}
    if not linhas:
        return cotas, origem, avisos, sem_informe
    df = pd.concat(linhas).drop_duplicates(["cnpj", "DT_COMPTC", "TAB_X_CLASSE_SERIE"], keep="last")
    df["qt"] = df["TAB_X_QT_COTA"].map(_num)
    df["vl"] = df["TAB_X_VL_COTA"].map(_num)
    df["classe"] = df["TAB_X_CLASSE_SERIE"].fillna("").str.upper()
    for d, (cnpj, nome_planilha) in por_cnpj.items():
        g = df[df["cnpj"] == d]
        if g.empty:  # CNPJ "inventado" na planilha para outra série do mesmo fundo (ex.: SR3)
            irmaos = [x for x in df["cnpj"].unique() if x[:8] == d[:8]]
            if len(irmaos) == 1:
                g = df[df["cnpj"] == irmaos[0]]
        if g.empty:
            continue
        serie_nome = _serie_do_nome(nome_planilha)
        valores, notas = {}, set()
        for dt_comptc, m in g.groupby("DT_COMPTC"):
            com_cota = m[(m["vl"] > 0) & (m["qt"] > 0)]
            senior = com_cota[com_cota["classe"].str.contains("SENIOR|SÊNIOR")]
            escolha = senior if not senior.empty else com_cota
            if len(escolha) > 1 and serie_nome:
                pela_serie = escolha[escolha["classe"].str.contains(rf"(?:SÉRIE|SERIE|SUBCLASSE)\s*{serie_nome}\b")]
                if len(pela_serie) == 1:
                    escolha = pela_serie
            if len(escolha) != 1:
                if len(escolha) > 1:
                    avisos[cnpj] = (f"{len(escolha)} séries sênior no informe mensal "
                                    f"({'; '.join(escolha['TAB_X_CLASSE_SERIE'].str.strip())[:90]}): conferir à mão")
                continue
            r = escolha.iloc[0]
            cota = r["vl"]
            pl = pls.get((r["cnpj"], dt_comptc))
            if abs(r["vl"] - r["qt"]) <= 1e-9 * max(1.0, r["qt"]) and pl and len(com_cota) == 1:
                cota = pl / r["qt"]
                notas.add("PL ÷ quantidade (o fundo informou a quantidade no campo da cota)")
            valores[_ultimo_dia_util(dt_comptc)] = round(cota, 8)
            notas.add(r["TAB_X_CLASSE_SERIE"].strip())
        if valores:
            s = pd.Series(valores).sort_index()
            cotas[cnpj] = s
            origem[cnpj] = "; ".join(sorted(notas))
            var = s.pct_change().abs()
            if len(s) > 1 and s.iloc[-1] == s.iloc[-2]:
                avisos[cnpj] = (f"Cota de {s.index[-1]:%m/%Y} igual à do mês anterior no informe mensal: "
                                "o fundo pode ter repetido o dado")
            elif (var > 0.05).any():
                avisos[cnpj] = (f"Cota de fim de mês variou {var.max():.1%} de um mês para o outro: "
                                "conferir se o informe trocou cota e quantidade")
    return cotas, origem, avisos, sem_informe


def _ler_csvs(bruto, contem=None):
    """Lê os CSVs de um zip (ou um CSV solto) da CVM como DataFrames de texto."""
    if bruto[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(bruto))
        return [pd.read_csv(z.open(n), sep=";", dtype=str, encoding="latin-1")
                for n in z.namelist() if not contem or contem in n]
    return [pd.read_csv(io.BytesIO(bruto), sep=";", dtype=str, encoding="latin-1")]


def cotas_outros_cvm(fundos, ate, meses=MESES_FIDC):
    """Cota patrimonial de FII (informe mensal), FIAGRO (informe mensal, por subclasse) e
    FIP (informe quadrimestral, por classe) nos dados abertos da CVM.

    Devolve (cotas {cnpj: Series}, origem {cnpj: texto}, avisos {cnpj: texto}, fonte {cnpj: texto}).
    """
    dig = lambda c: re.sub(r"\D", "", str(c))  # noqa: E731
    alvo = {dig(c): c for c, _ in fundos}
    fim = pd.Period(ate, freq="M")
    periodo = pd.period_range(fim - meses, fim, freq="M")
    cotas, origem, avisos, fonte = {}, {}, {}, {}

    def guarda(cnpj, d, v, texto, nome_fonte):
        cotas.setdefault(cnpj, {})[_ultimo_dia_util(d)] = round(v, 8)
        origem[cnpj] = texto
        fonte[cnpj] = nome_fonte

    # FII: um zip por ano, aba "complemento" tem Valor_Patrimonial_Cotas (referência = 1º dia do mês)
    for ano in sorted({p.year for p in periodo}):
        bruto = baixar(f"{CVM_FII}/inf_mensal_fii_{ano}.zip", tentativas=2)
        for df in (_ler_csvs(bruto, "complemento") if bruto else []):
            df = df[df["CNPJ_Fundo_Classe"].map(dig).isin(alvo)]
            df = df.sort_values("Versao", key=lambda s: pd.to_numeric(s, errors="coerce"))
            for _, r in df.iterrows():
                ref = pd.Period(r["Data_Referencia"][:7], freq="M")
                v = _num(r["Valor_Patrimonial_Cotas"])
                if ref in periodo and v > 0:
                    guarda(alvo[dig(r["CNPJ_Fundo_Classe"])], ref.end_time.normalize(), v,
                           "valor patrimonial da cota (informe mensal de FII)", "CVM informe mensal FII")

    # FIAGRO: um zip por mês, aba de subclasse
    for p in periodo:
        bruto = baixar(f"{CVM_FIAGRO}/inf_mensal_fiagro_{p.year}{p.month:02d}.zip", tentativas=2)
        for df in (_ler_csvs(bruto, "subclasse") if bruto else []):
            df = df[df["CNPJ_Classe"].map(dig).isin(alvo)]
            for d, g in df.groupby(df["CNPJ_Classe"].map(dig)):
                cnpj = alvo[d]
                g = g[g["Valor_Patrimonial_Cota"].map(_num) > 0]
                if len(g) == 1:
                    guarda(cnpj, p.end_time.normalize(), _num(g.iloc[0]["Valor_Patrimonial_Cota"]),
                           "valor patrimonial da cota (informe mensal de FIAGRO, 2 casas)", "CVM informe mensal FIAGRO")
                elif len(g) > 1:
                    avisos[cnpj] = (f"FIAGRO com {len(g)} subclasses no informe mensal "
                                    f"({'; '.join(g['Nome_Subclasse'])[:80]}): conferir à mão")

    # FIP: um CSV por ano, quadrimestral (abril, agosto e dezembro), cota por classe
    for ano in sorted({p.year for p in periodo} | {fim.year - 1}):
        bruto = baixar(f"{CVM_FIP}/inf_quadrimestral_fip_{ano}.csv", tentativas=2)
        for df in (_ler_csvs(bruto) if bruto else []):
            df = df[df["CNPJ_FUNDO_CLASSE"].map(dig).isin(alvo)]
            df = df[df["DT_COMPTC"] >= str((fim - 8).start_time.date())]   # os dois últimos informes
            for (d, dt_comptc), g in df.groupby([df["CNPJ_FUNDO_CLASSE"].map(dig), "DT_COMPTC"]):
                cnpj = alvo[d]
                g = g[g["VL_QUOTA_CLASSE"].map(_num) > 0]
                valores = sorted({round(_num(x), 6) for x in g["VL_QUOTA_CLASSE"]})
                if len(valores) == 1:
                    guarda(cnpj, dt_comptc, valores[0], "cota da classe (informe quadrimestral de FIP)",
                           "CVM informe quadrimestral FIP")
                elif len(valores) > 1:
                    um = g[g["CLASSE_COTA"].str.strip() == "1"]
                    if len(um):
                        guarda(cnpj, dt_comptc, _num(um.iloc[0]["VL_QUOTA_CLASSE"]),
                               "cota da classe 1 (informe quadrimestral de FIP)", "CVM informe quadrimestral FIP")
                    avisos[cnpj] = (f"FIP com classes de cota diferentes ({', '.join(map(str, valores))[:80]}): "
                                    "usada a classe 1, conferir")
    cotas = {c: pd.Series(v).sort_index() for c, v in cotas.items()}
    for c, s in cotas.items():
        if c not in avisos and len(s) > 1 and (s.pct_change().abs() > 0.05).any():
            avisos[c] = (f"Cota variou {s.pct_change().abs().max():.1%} entre dois informes: conferir")
    return cotas, origem, avisos, fonte


def cotas_b3(tickers, inicio, fim):
    from cotas_b3 import baixar as baixar_b3

    return baixar_b3(tickers, inicio, fim).round(2)


# --------------------------------------------------------------------------
# Conferência
# --------------------------------------------------------------------------
def conferir(nome, serie, tipo, calendario=None):
    """Lista problemas de uma série diária: faltando, repetida, variação grande."""
    problemas = []
    s = serie.dropna()
    if s.empty:
        return [(nome, "Sem dados no período", "")]
    if calendario is not None:
        faltam = [d for d in calendario if d not in s.index and d >= s.index.min() - pd.Timedelta(days=40)]
        if faltam:
            txt = ", ".join(f"{d:%d/%m}" for d in faltam[:8]) + (" ..." if len(faltam) > 8 else "")
            problemas.append((nome, f"{len(faltam)} dia(s) útil(eis) sem valor", txt))
    iguais = (s.diff() == 0).astype(int)
    seq = iguais.groupby((iguais == 0).cumsum()).cumsum().max()
    if tipo in ("fundo", "b3") and seq >= DIAS_REPETIDA:
        problemas.append((nome, f"Valor repetido por {int(seq) + 1} dias seguidos", "cota pode estar parada"))
    var = s.pct_change().abs()
    limite = LIMITE_VARIACAO.get(tipo, 0.05)
    grandes = var[var > limite]
    for d, v in grandes.head(5).items():
        problemas.append((nome, f"Variação de {v:.1%} em um dia", f"{d:%d/%m/%Y}"))
    return problemas


# --------------------------------------------------------------------------
# Saída
# --------------------------------------------------------------------------
def linhas_importar(aba, col_data, linha_chave, chave, serie, fonte, tolerancia=None):
    """Linhas da aba Importar. Tolerancia: diferença absoluta que a macro aceita como igual."""
    return [{"Aba": aba, "ColunaData": col_data, "LinhaChave": linha_chave, "Chave": chave,
             "Data": d.date() if hasattr(d, "date") else d, "Valor": float(v), "Fonte": fonte,
             "Tolerancia": tolerancia}
            for d, v in serie.dropna().items()]


def escrever_bloco(writer, aba, cabecalho, tabela, formato="#,##0.00######"):
    tabela = tabela.copy()
    tabela.index = [d.date() for d in tabela.index]
    tabela.to_excel(writer, sheet_name=aba, startrow=1, header=False)
    ws = writer.sheets[aba]
    for i, titulo in enumerate(cabecalho, start=1):
        c = ws.cell(row=1, column=i, value=titulo)
        c.font = Font(bold=True)
        c.alignment = Alignment(wrap_text=True, horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = 14 if i > 1 else 12
    for linha in ws.iter_rows(min_row=2):
        linha[0].number_format = "dd/mm/yyyy"
        for c in linha[1:]:
            c.number_format = formato
    ws.freeze_panes = "B2"


MARCAS = {  # cor do cabeçalho na aba Cotas para fundos que não vêm completos da CVM
    "manual": ("F8CBAD", "Coleta manual"),
    "quadrimestral": ("DDEBF7", "CVM só a cada 4 meses (abril, agosto e dezembro)"),
}


def escrever_cotas(writer, nomes, tabela, repetidas=None, marcas=None):
    """Aba Cotas como na planilha: nome na linha 1, CNPJ/ticker na linha 2, datas a partir da 3.
    Colunas sem nenhuma cota ficam vazias e com o cabeçalho amarelo, para colar à mão.
    marcas {código: (tipo, motivo)}: fundos de coleta manual (laranja) ou só quadrimestral (azul),
    com o motivo num comentário do cabeçalho."""
    ws = writer.book.create_sheet("Cotas")
    amarelo = PatternFill("solid", fgColor="FFF4CC")
    ws.cell(row=1, column=1, value="Nome").font = Font(bold=True)
    ws.cell(row=2, column=1, value="Data").font = Font(bold=True)
    ws.column_dimensions["A"].width = 12
    for i, d in enumerate(tabela.index, start=3):
        c = ws.cell(row=i, column=1, value=d.date() if hasattr(d, "date") else d)
        c.number_format = "dd/mm/yyyy"
    for j, cod in enumerate(tabela.columns, start=2):
        nome = ws.cell(row=1, column=j, value=nomes.get(cod, ""))
        nome.font = Font(size=8)
        nome.alignment = Alignment(wrap_text=True, horizontal="center", vertical="bottom")
        codigo = ws.cell(row=2, column=j, value=cod)
        codigo.font = Font(bold=True)
        codigo.alignment = Alignment(horizontal="center")
        ws.column_dimensions[get_column_letter(j)].width = 14
        serie = tabela[cod]
        marca = (marcas or {}).get(cod)
        if marca:
            cor, titulo = MARCAS[marca[0]]
            nome.fill = codigo.fill = PatternFill("solid", fgColor=cor)
            codigo.comment = Comment(f"{titulo}: {marca[1]}", "Tarefas mensais", width=260, height=90)
        if serie.isna().all():
            if not marca:
                nome.fill = codigo.fill = amarelo
            continue
        rep = (repetidas or {}).get(cod)
        for i, (d, v) in enumerate(serie.items(), start=3):
            if pd.notna(v):
                c = ws.cell(row=i, column=j, value=float(v))
                c.number_format = "#,##0.00######"
                if rep is not None and rep.get(d, False):
                    c.font = Font(italic=True, color="808080")
    ws.row_dimensions[1].height = 45
    ws.freeze_panes = "B3"


def main(mes=MES):
    ano, m = mes_referencia(mes)
    inicio, fim = limites_do_mes(ano, m)
    if DATA_INICIO:
        inicio = date.fromisoformat(DATA_INICIO)
    if DATA_FIM:
        fim = date.fromisoformat(DATA_FIM)
    inicio_mensal = (pd.Timestamp(inicio) - pd.DateOffset(months=MESES_SERIES_MENSAIS)).date().replace(day=1)
    blocos = None if BLOCOS == "todos" else {b.strip() for b in BLOCOS.split(",")}
    quer = lambda b: blocos is None or b in blocos  # noqa: E731
    print(f"Dados da planilha base de {inicio:%d/%m/%Y} a {fim:%d/%m/%Y} "
          f"(séries mensais desde {inicio_mensal:%m/%Y})")

    importar, conferencia, blocos_saida = [], [], {}

    # ---- Banco Central
    bc = series_banco_central(inicio, fim, inicio_mensal) if quer("bc") else {}
    calendario = list(bc["cdi"].index) if "cdi" in bc and not bc["cdi"].empty else None
    for bloco, s in bc.items():
        col_data, col_valor, nome = DADOS[bloco]
        importar += linhas_importar("Dados", col_data, "", col_valor, s, "Banco Central")
        tipo = "taxa" if bloco in ("cdi",) else ("cambio" if bloco == "ptax" else "mensal")
        if bloco in ("cdi", "ptax"):
            conferencia += conferir(nome, s, tipo, calendario)
        elif s.empty:
            conferencia.append((nome, "Sem dados no período",
                                "o Banco Central não respondeu: rode só a tarefa dados_planilha de novo"))
    if bc:
        mensais = pd.concat({DADOS[b][2]: bc[b] for b in ("ipca", "igpm", "poupanca")}, axis=1)
        blocos_saida["Dados - Mensais"] = (["Mês", "IPCA", "IGP-M", "Poupança"], mensais, "0.00%")
        blocos_saida["Dados - CDI"] = (["Data", "CDI"], bc["cdi"].to_frame(), "0.00%")
        blocos_saida["Dados - PTAX"] = (["Data", "PTAX Vda"], bc["ptax"].to_frame(), "0.0000")

    # ---- Ibovespa e Yahoo
    if quer("yahoo"):
        yh, globais = series_yahoo(inicio, fim)
        for bloco, s in yh.items():
            col_data, col_valor, nome = DADOS[bloco]
            importar += linhas_importar("Dados", col_data, "", col_valor, s, "Yahoo",
                                        tolerancia=1.0 if bloco == "ibov" else None)
            conferencia += conferir(nome, s, "indice", calendario if bloco == "ibov" else None)
        # Na planilha, o BRL=X do último dia útil de cada mês é a PTAX venda
        if "ptax" in bc and not bc["ptax"].empty:
            ptax = bc["ptax"]
            fins = ptax.groupby([ptax.index.year, ptax.index.month]).tail(1)
            for d, v in fins.items():
                if d in globais.index:
                    globais.loc[d, "BRL=X"] = v
        for t, col in GLOBAIS.items():
            importar += linhas_importar("Dados", "Z", "", col, globais[t], "Yahoo")
        blocos_saida["Dados - Ibovespa"] = (["Data", "Fechamento"], yh["ibov"].to_frame(), "#,##0.00")
        blocos_saida["Dados - S&P 500"] = (["Data", "Fechamento"], yh["sp500"].to_frame(), "#,##0.00")
        blocos_saida["Dados - Globais"] = (["Data"] + list(GLOBAIS), globais, "#,##0.0000")

    # ---- CPI
    if quer("cpi"):
        cpi = serie_cpi(inicio_mensal, fim)
        if not cpi.empty:
            importar += linhas_importar("Dados", "AN", "", "AO", cpi, "FRED")
            blocos_saida["Dados - CPI"] = (["Data", "CPI"], cpi.to_frame(), "0.000")

    # ---- Cotas de fundos (CVM) e B3
    cotas, ordem, cotas_mensais, marcas = [], [], {}, {}
    if quer("cotas_cvm"):
        fundos = ler_csv("fundos_brasil.csv")
        if "coleta" not in fundos.columns:
            fundos["coleta"] = ""
        ordem += [(f["cnpj"], f["nome"]) for _, f in fundos.iterrows()]
        # Coluna "coleta" da lista: "manual: motivo" para os fundos sem fonte pública que bata
        manuais = {f["cnpj"]: f["coleta"].split(":", 1)[-1].strip() for _, f in fundos.iterrows()
                   if f["coleta"].lower().startswith("manual")}
        marcas.update({c: ("manual", m) for c, m in manuais.items()})
        tabela, avisos = cotas_cvm(list(fundos["cnpj"]), inicio, fim)
        faltando = [(f["cnpj"], f["nome"]) for _, f in fundos.iterrows()
                    if f["cnpj"] not in avisos and f["cnpj"] not in manuais
                    and (tabela.empty or f["cnpj"] not in tabela.columns)]
        fidc, fidc_origem, fidc_avisos, fidc_sem = ({}, {}, {}, [])
        if faltando and quer("cotas_fidc"):
            fidc, fidc_origem, fidc_avisos, fidc_sem = cotas_fidc_mensal(faltando, fim)
            for p in fidc_sem:
                conferencia.append(("Informe mensal de FIDC (CVM)", f"{p.month:02d}/{p.year} ainda não publicado",
                                    "sai até uns 15 dias depois do fim do mês: rode a tarefa de novo depois"))
        fonte_mensal = {c: "CVM informe mensal FIDC" for c in fidc}
        resto = [(c, n) for c, n in faltando if c not in fidc]
        if resto and quer("cotas_fidc"):
            outros, outros_origem, outros_avisos, outros_fonte = cotas_outros_cvm(resto, fim)
            fidc.update(outros); fidc_origem.update(outros_origem)
            fidc_avisos.update(outros_avisos); fonte_mensal.update(outros_fonte)
        for _, f in fundos.iterrows():
            c = f["cnpj"]
            if c in avisos:
                conferencia.append((f"{f['nome']} ({c})", avisos[c], ""))
            elif c in fidc:
                s = fidc[c]
                importar += linhas_importar("Cotas", "B", 2, c, s, fonte_mensal[c])
                ult = s.index.max()
                conferencia.append((f"{f['nome']} ({c})", f"Sem cota diária: {fonte_mensal[c]}, "
                                    f"última {ult:%d/%m/%Y} = {s[ult]:.8f}", fidc_origem.get(c, "")))
                if c in fidc_avisos:
                    conferencia.append((f"{f['nome']} ({c})", fidc_avisos[c], ""))
                cotas_mensais[c] = s
                if "FIP" in fonte_mensal[c]:
                    marcas[c] = ("quadrimestral", "nos outros meses, usar o extrato")
            elif c in manuais and (tabela.empty or c not in tabela.columns):
                conferencia.append((f"{f['nome']} ({c})", "Coleta manual", manuais[c]))
            elif tabela.empty or c not in tabela.columns:
                if c in fidc_avisos:
                    motivo = fidc_avisos[c]
                elif f["tipo"] == "FIDC":
                    motivo = "FIDC sem cota no informe mensal da CVM"
                else:
                    motivo = "Não encontrado nos informes da CVM (diário, FIDC, FII, FIAGRO e FIP)"
                conferencia.append((f"{f['nome']} ({c})", motivo, "continua pelo Eduardo-Scrapping ou extrato"))
            else:
                s = tabela[c]
                importar += linhas_importar("Cotas", "B", 2, c, s, "CVM")
                conferencia += conferir(f"{f['nome']} ({c})", s, "fundo", calendario)
        if not tabela.empty:
            cotas.append(tabela.round(8))
    if quer("cotas_b3"):
        ativos = ler_csv("ativos_b3.csv")
        tickers = list(ativos["ticker"])
        ordem += [(a["ticker"], a["nome"]) for _, a in ativos.iterrows()]
        b3 = cotas_b3(tickers, inicio, fim)
        for t in tickers:
            if t in b3.columns:
                importar += linhas_importar("Cotas", "B", 2, t, b3[t], "Yahoo")
                conferencia += conferir(t, b3[t], "b3", calendario)
        cotas.append(b3)
    if ordem:
        # Todas as colunas da planilha, mesmo sem cota, para colar à mão as que faltam.
        tab = pd.concat(cotas, axis=1) if cotas else pd.DataFrame()
        datas = sorted(set(tab.index) | set(calendario or []))
        codigos = [c for c, _ in ordem]
        tab = tab.reindex(index=datas, columns=codigos) if not tab.empty else pd.DataFrame(index=datas, columns=codigos)
        tab = tab.loc[:, ~tab.columns.duplicated()]
        # Fundos só com cota de fim de mês: repete a última cota nos dias seguintes, como na planilha.
        repetidas = {}
        for c, s in cotas_mensais.items():
            if c not in tab.columns or tab.empty:
                continue
            base = s.reindex(sorted(set(s.index) | set(tab.index))).ffill().reindex(tab.index)
            repetidas[c] = base.notna() & ~base.index.isin(s.index)
            tab[c] = base
        cotas_saida = (dict(ordem), tab, repetidas, marcas)
    else:
        cotas_saida = None

    # ---- Arquivo
    caminho = os.path.join(pasta_saida(ano, m), f"atualizacao_dados_{nome_mes(m).lower()}_{ano}.xlsx")
    imp = pd.DataFrame(importar, columns=["Aba", "ColunaData", "LinhaChave", "Chave", "Data", "Valor",
                                          "Fonte", "Tolerancia"])
    conf = pd.DataFrame(conferencia, columns=["Série", "Ponto de atenção", "Detalhe"])
    with pd.ExcelWriter(caminho, engine="openpyxl") as writer:
        imp.to_excel(writer, sheet_name="Importar", index=False)
        ws = writer.sheets["Importar"]
        for c in ws["E"][1:]:
            c.number_format = "dd/mm/yyyy"
        for c in ws["F"][1:]:
            c.number_format = "0.00########"
        for col, larg in zip("ABCDEFGH", (8, 12, 11, 22, 12, 16, 14, 11)):
            ws.column_dimensions[col].width = larg
        ws.freeze_panes = "A2"

        if conf.empty:
            conf = pd.DataFrame([("Tudo certo", "Nenhum ponto de atenção", "")], columns=conf.columns)
        conf.to_excel(writer, sheet_name="Conferência", index=False)
        ws = writer.sheets["Conferência"]
        for col, larg in zip("ABC", (60, 55, 45)):
            ws.column_dimensions[col].width = larg
        amarelo = PatternFill("solid", fgColor="FFF4CC")
        laranja = PatternFill("solid", fgColor=MARCAS["manual"][0])
        for linha in ws.iter_rows(min_row=2):
            if "Variação" in str(linha[1].value) or "repetido" in str(linha[1].value):
                for c in linha:
                    c.fill = amarelo
            elif linha[1].value == "Coleta manual":
                for c in linha:
                    c.fill = laranja

        for aba, (cab, tabela, fmt) in blocos_saida.items():
            escrever_bloco(writer, aba[:31], cab, tabela, fmt)

        if cotas_saida:
            escrever_cotas(writer, *cotas_saida)

        notas = writer.book.create_sheet("Notas")
        for i, txt in enumerate([
            f"Período: {inicio:%d/%m/%Y} a {fim:%d/%m/%Y}. Séries mensais desde {inicio_mensal:%m/%Y}.",
            "Banco Central (api.bcb.gov.br): IPCA 433, IGP-M 189, Poupança 196 (aniversário dia 1), "
            "CDI 4389 (% a.a., base 252), PTAX venda 1. Valores em decimal, como na planilha.",
            "CVM (dados.cvm.gov.br): informe diário de fundos. CNPJs com mais de uma subclasse "
            "ficam de fora e aparecem na Conferência.",
            "CVM, informe mensal de FIDC (tabelas X.2 e IV): cota de fim de mês da subclasse sênior "
            "(ou da única subclasse com cota), lançada no último dia útil do mês. Na aba Cotas, os "
            "dias seguintes repetem essa cota em cinza, como na planilha; a aba Importar leva só a de "
            "fim de mês. O informe sai até uns 15 dias depois do fim do mês.",
            "CVM, informes de FII e FIAGRO (mensais, valor patrimonial da cota; FIAGRO com 2 casas) e "
            "de FIP (quadrimestral: abril, agosto e dezembro). Entram só em célula vazia.",
            "Yahoo Finance: Ibovespa (pontos inteiros; a macro aceita até 1 ponto de diferença), S&P 500, indicadores globais (AGG ajustado; BRL=X do último dia útil do mês = PTAX) e ativos da B3 (fechamento sem ajuste).",
            "FRED: CPI (CPIAUCSL).",
            "Aba Cotas: cabeçalho laranja = coleta manual (coluna 'coleta' de fundos_brasil.csv; o motivo "
            "está no comentário do CNPJ); azul = FIP, que a CVM só publica em abril, agosto e dezembro; "
            "amarelo = sem cota neste mês.",
            "A macro ImportarDadosEH lê a aba Importar: só preenche célula vazia ou fórmula; "
            "valor digitado diferente vira conflito no relatório, sem sobrescrever.",
        ], start=1):
            notas.cell(row=i, column=1, value=txt)
        notas.column_dimensions["A"].width = 120

    print(f"{len(imp)} valores para importar, {len(conf)} pontos na conferência.")
    for _, r in conf.head(30).iterrows():
        if r["Série"] != "Tudo certo":
            print(f"Aviso: {r['Série']}: {r['Ponto de atenção']} {r['Detalhe']}".strip())
    print(f"Arquivo salvo: {caminho}")
    return [caminho]


if __name__ == "__main__":
    main()
