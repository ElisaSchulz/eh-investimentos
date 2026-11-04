# Sonda temporária: onde a CVM publica dados dos FIIs, FIPs e FIAGROs da lista.
import csv, io, re, urllib.request, zipfile
CNPJS = """61.848.349/0001-72 67.704.827/0001-57 62.526.654/0001-00 62.603.652/0001-78 64.768.982/0001-49
60.743.809/0001-35 61.700.255/0001-51 68.462.426/0001-09 54.869.435/0001-04 54.511.022/0001-45 61.258.419/0001-32
55.219.936/0001-08 61.250.889/0001-50 63.104.203/0001-48 60.027.987/0001-60 60.922.008/0001-37 57.469.492/0001-86
49.343.067/0001-18 63.311.917/0001-40 63.441.263/0001-56 43.741.195/0001-33 65.511.886/0001-83 46.153.220/0001-56
63.932.359/0001-17 54.635.245/0001-14 63.085.032/0001-57 57.593.613/0001-05 66.834.182/0001-04 68.296.665/0001-28
64.125.652/0001-35 64.124.715/0001-39 68.147.762/0001-59 61.424.730/0001-04 39.669.815/0001-01 60.571.986/0001-81""".split()
ALVO = {re.sub(r"\D", "", c) for c in CNPJS}
def get(u):
    try:
        return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=120).read()
    except Exception as e:
        print("FALHOU", u, e); return None
for d in ["FII/DOC/INF_MENSAL/DADOS/", "FII/DOC/INF_TRIMESTRAL/DADOS/", "FIP/DOC/INF_TRIMESTRAL/DADOS/", "FIP/DOC/INF_QUADRIMESTRAL/DADOS/",
          "FIAGRO/DOC/INF_MENSAL/DADOS/", "FIAGRO/DOC/", "FI/CAD/DADOS/", "FIP/DOC/"]:
    b = get("https://dados.cvm.gov.br/dados/" + d)
    if b: print("DIR", d, re.findall(r'href="([^"?/][^"]*)"', b.decode("latin-1"))[-8:])
def varre(u, maxlin=6):
    b = get(u)
    if not b: return
    z = zipfile.ZipFile(io.BytesIO(b))
    for n in z.namelist():
        txt = z.read(n).decode("latin-1")
        rd = csv.reader(io.StringIO(txt), delimiter=";")
        cab = next(rd); k = 0; achou = set()
        for r in rd:
            hit = [v for v in r if re.sub(r"\D", "", v) in ALVO]
            if hit:
                achou.add(re.sub(r"\D", "", hit[0]))
                if k < maxlin: print("ROW", n, r[:40])
                k += 1
        if k: print("CAB", n, cab[:40]); print("N", n, k, "cnpjs", len(achou), sorted(achou))
varre("https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_2026.zip")
varre("https://dados.cvm.gov.br/dados/FIP/DOC/INF_TRIMESTRAL/DADOS/inf_trimestral_fip_2026.zip")
varre("https://dados.cvm.gov.br/dados/FIAGRO/DOC/INF_MENSAL/DADOS/inf_mensal_fiagro_2026.zip")
varre("https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip", maxlin=40)
