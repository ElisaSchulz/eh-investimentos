# Sonda temporária: colunas do informe mensal de FIDC (CVM) e linhas dos FIDCs da lista.
import csv, io, urllib.request, zipfile
alvo = {"".join(ch for ch in r["cnpj"] if ch.isdigit()) for r in csv.DictReader(open("tarefas-mensais/fundos_brasil.csv"), delimiter=";") if r["tipo"] == "FIDC"}
for ym in ("202609", "202610", "202608"):
    url = f"https://dados.cvm.gov.br/dados/FIDC/DOC/INF_MENSAL/DADOS/inf_mensal_fidc_{ym}.zip"
    try:
        b = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=120).read()
    except Exception as e:
        print("FALHOU", url, e); continue
    z = zipfile.ZipFile(io.BytesIO(b))
    print("ZIP", ym, z.namelist())
    for n in z.namelist():
        if not any(t in n for t in ("tab_X_2", "tab_IV_")):
            continue
        rd = csv.reader(io.StringIO(z.read(n).decode("latin-1")), delimiter=";")
        cab = next(rd); print("CAB", n, cab)
        k = 0
        for r in rd:
            if any("".join(ch for ch in v if ch.isdigit()) in alvo for v in r if v):
                if k < 60: print("ROW", n, r)
                k += 1
        print("N", n, k)
    break
