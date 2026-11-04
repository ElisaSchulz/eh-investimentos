# Teste temporário: coleta de setembro/2026 com os informes de FII, FIAGRO e FIP.
import glob, os, sys
import pandas as pd
os.environ.update(PASTA_SAIDA="/tmp/saida", BLOCOS_DADOS="cotas_cvm,cotas_fidc")
sys.path.insert(0, os.path.abspath("tarefas-mensais"))
os.chdir("tarefas-mensais")
import dados_planilha as d
d.main("2026-09")
f = glob.glob("/tmp/saida/**/*.xlsx", recursive=True)[0]
imp = pd.read_excel(f, "Importar")
for _, r in imp[imp["Fonte"].str.contains("FII|FIP|FIAGRO")].iterrows():
    print("VAL", r["Chave"], str(r["Data"])[:10], r["Valor"], r["Fonte"])
for _, r in pd.read_excel(f, "Conferência").iterrows():
    t = " | ".join(str(x) for x in r)
    if any(k in t for k in ("FII", "FIP", "FIAGRO", "Não encontrado")):
        print("CONF", t)
