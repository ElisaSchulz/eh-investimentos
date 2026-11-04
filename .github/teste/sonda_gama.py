# Teste temporário: procura o Gama Oaktree (68.311.917/0001-40) no cadastro e nos informes da CVM.
import glob, io, os, sys, zipfile, urllib.request
import pandas as pd
ALVOS = ("68.311.917", "68311917")
url = "https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip"
z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url, timeout=120).read()))
for n in z.namelist():
    for linha in z.read(n).decode("latin-1").splitlines():
        if any(a in linha for a in ALVOS):
            print("CAD", n, linha[:400])
os.environ.update(PASTA_SAIDA="/tmp/saida", BLOCOS_DADOS="cotas_cvm,cotas_fidc")
sys.path.insert(0, os.path.abspath("tarefas-mensais"))
os.chdir("tarefas-mensais")
import dados_planilha as d
for mes in ("2026-09", "2026-10"):
    d.main(mes)
    f = sorted(glob.glob("/tmp/saida/**/*.xlsx", recursive=True), key=os.path.getmtime)[-1]
    imp = pd.read_excel(f, "Importar")
    for _, r in imp[imp["Chave"].astype(str).str.contains("68.311.917")].iterrows():
        print("VAL", mes, r["Chave"], str(r["Data"])[:10], r["Valor"], r["Fonte"])
    for _, r in pd.read_excel(f, "Conferência").iterrows():
        t = " | ".join(str(x) for x in r)
        if "68.311.917" in t or "OAKTREE" in t.upper():
            print("CONF", mes, t)
