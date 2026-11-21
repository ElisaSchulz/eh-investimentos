"""
Coleta pontual para o estudo de carteira da Viviane (backtest de 60 meses).

Saídas em saida/viviane/:
- bcb.csv: séries mensais do Banco Central (CDI 4391, IPCA 433) e CDI diário (12) composto por mês.
- fundos.csv: cadastro dos fundos coletados (cnpj, nome, classe ANBIMA, público, gestor, PL, cotistas).
- cotas.csv: cota do último dia útil de cada mês por (cnpj, subclasse).

Universo: CNPJs de .github/coleta/viviane_cnpjs.txt (listas XP/BTG e triagem RF), classes de
renda fixa público geral com PL >= 100 mi e qualquer classe público geral cujo nome indique
debêntures incentivadas / infraestrutura, além dos fundos que a Viviane já tem.
"""
import csv
import io
import json
import os
import re
import sys
import time
import urllib.request
import zipfile
from datetime import date

CVM = "https://dados.cvm.gov.br/dados"
UA = {"User-Agent": "Mozilla/5.0"}
SAIDA = "saida/viviane"
INICIO = (2021, 9)
NOMES = re.compile(r"INCENTIVAD|INFRA|DEBENTURE|DEBÊNTURE|12\.431|BNP PARIBAS MATCH|MAPFRE|WESTERN ASSET", re.I)


def baixar(url, tentativas=4, timeout=300):
    for i in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if i == tentativas - 1:
                print(f"Aviso: falhou {url}: {e}")
                return None
            time.sleep(2 ** (i + 1))


def dig(s):
    return "".join(c for c in (s or "") if c.isdigit())


def num(x):
    try:
        return float(str(x).replace(",", "."))
    except ValueError:
        return 0.0


def textos(bruto):
    if bruto[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(bruto))
        for nome in z.namelist():
            yield nome, z.read(nome).decode("latin-1")
    else:
        yield "csv", bruto.decode("latin-1")


def meses():
    a, m = INICIO
    hoje = date.today()
    out = []
    while (a, m) <= (hoje.year, hoje.month):
        out.append(f"{a}{m:02d}")
        m += 1
        if m == 13:
            a, m = a + 1, 1
    return out


def bcb():
    linhas = {}
    for cod, nome in ((4391, "cdi_mes"), (433, "ipca_mes")):
        for ini, fim in (("01/01/2021", "31/12/2023"), ("01/01/2024", "31/12/2026")):
            b = baixar(f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{cod}/dados?formato=json&dataInicial={ini}&dataFinal={fim}")
            for r in json.loads(b or b"[]"):
                d, mth, a = r["data"].split("/")
                linhas.setdefault(f"{a}-{mth}", {})[nome] = num(r["valor"])
    # CDI diário composto por mês (em janelas de até 10 anos)
    b = baixar("https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=01/01/2021&dataFinal=31/12/2026")
    fat = {}
    for r in json.loads(b or b"[]"):
        d, mth, a = r["data"].split("/")
        k = f"{a}-{mth}"
        fat[k] = fat.get(k, 1.0) * (1 + num(r["valor"]) / 100)
    for k, f in fat.items():
        linhas.setdefault(k, {})["cdi_diario_mes"] = (f - 1) * 100
    with open(f"{SAIDA}/bcb.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["mes", "cdi_mes", "cdi_diario_mes", "ipca_mes"])
        for k in sorted(linhas):
            v = linhas[k]
            w.writerow([k, v.get("cdi_mes", ""), v.get("cdi_diario_mes", ""), v.get("ipca_mes", "")])
    print("bcb:", len(linhas), "meses")


def cadastro(lista):
    bruto = baixar(f"{CVM}/FI/CAD/DADOS/registro_fundo_classe.zip")
    fundos, classes = {}, []
    for nome, texto in textos(bruto):
        rd = csv.DictReader(io.StringIO(texto), delimiter=";")
        if nome == "registro_fundo.csv":
            for r in rd:
                fundos[r["ID_Registro_Fundo"]] = r
        elif nome == "registro_classe.csv":
            classes = list(rd)
    cand = {}
    for r in classes:
        c = dig(r.get("CNPJ_Classe"))
        f = fundos.get(r.get("ID_Registro_Fundo"), {})
        publico = r.get("Publico_Alvo") or ""
        nome = (r.get("Denominacao_Social") or "").strip()
        situ = (r.get("Situacao") or "").lower()
        pl = num(r.get("Patrimonio_Liquido"))
        ok = c in lista
        if not ok and publico == "Público Geral" and "funcionamento normal" in situ:
            if NOMES.search(nome):
                ok = True
            elif r.get("Classificacao") == "Renda Fixa" and pl >= 100e6:
                ok = True
        if ok:
            cand[c] = {"cnpj": c, "nome": nome, "anbima": r.get("Classificacao_Anbima") or r.get("Classificacao") or "",
                       "publico": publico, "gestor": (f.get("Gestor") or "").strip(), "situacao": r.get("Situacao") or "",
                       "inicio": r.get("Data_Inicio") or "", "pl_cad": pl,
                       "cnpj_fundo": dig(f.get("CNPJ_Fundo"))}
    print("candidatos:", len(cand))
    return cand


def cotas(cand):
    alvo = set(cand)
    porfundo = {v["cnpj_fundo"]: c for c, v in cand.items() if v["cnpj_fundo"]}
    ult = {}
    info = {}
    for m in meses():
        bruto = baixar(f"{CVM}/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_{m}.zip", tentativas=2)
        if not bruto:
            hist = baixar(f"{CVM}/FI/DOC/INF_DIARIO/DADOS/HIST/inf_diario_fi_{m[:4]}.zip", tentativas=2)
            if not hist:
                print("sem dados", m)
                continue
            bruto = hist
        for _, texto in textos(bruto):
            rd = csv.reader(io.StringIO(texto), delimiter=";")
            cab = next(rd, [])
            h = {k: i for i, k in enumerate(cab)}
            ic = h.get("CNPJ_FUNDO_CLASSE", h.get("CNPJ_FUNDO"))
            isub, idt, iq = h.get("ID_SUBCLASSE"), h["DT_COMPTC"], h["VL_QUOTA"]
            ipl, inc = h["VL_PATRIM_LIQ"], h["NR_COTST"]
            for r in rd:
                if len(r) <= iq:
                    continue
                c = dig(r[ic])
                if c not in alvo:
                    c = porfundo.get(c)
                    if not c:
                        continue
                q = num(r[iq])
                if q <= 0:
                    continue
                k = (c, r[isub] if isub is not None and isub < len(r) else "")
                d = r[idt]
                mm = ult.setdefault(k, {})
                if d[:7] not in mm or d > mm[d[:7]][0]:
                    mm[d[:7]] = (d, q)
                if k not in info or d >= info[k][0]:
                    info[k] = (d, num(r[ipl]), int(num(r[inc])))
        print("ok", m, len(ult))
    with open(f"{SAIDA}/cotas.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cnpj", "sub", "mes", "data", "cota"])
        for (c, s), mm in sorted(ult.items()):
            for mes, (d, q) in sorted(mm.items()):
                w.writerow([c, s, mes, d, f"{q:.10g}"])
    with open(f"{SAIDA}/fundos.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cnpj", "sub", "nome", "anbima", "publico", "gestor", "inicio", "ultima", "pl", "cotistas"])
        for (c, s), (d, pl, nc) in sorted(info.items()):
            v = cand[c]
            w.writerow([c, s, v["nome"], v["anbima"], v["publico"], v["gestor"], v["inicio"], d, round(pl), nc])


def main():
    os.makedirs(SAIDA, exist_ok=True)
    bcb()
    lista = {dig(x) for x in open(os.path.join(os.path.dirname(__file__), "viviane_cnpjs.txt")).read().split()}
    cotas(cadastro(lista))


if __name__ == "__main__":
    main()
