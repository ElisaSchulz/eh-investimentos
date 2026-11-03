# Teste temporário: roda a coleta de setembro/2026 só com as cotas da CVM e imprime os FIDCs.
import glob, os, sys
import pandas as pd
os.environ.update(PASTA_SAIDA="/tmp/saida", BLOCOS_DADOS="cotas_cvm,cotas_fidc")
sys.path.insert(0, "tarefas-mensais")
os.chdir("tarefas-mensais")
import dados_planilha as d
d.main("2026-09")
f = glob.glob("/tmp/saida/**/*.xlsx", recursive=True)[0]
imp = pd.read_excel(f, "Importar")
fidc = imp[imp["Fonte"].str.contains("FIDC")]
for _, r in fidc.iterrows():
    print("FIDC", r["Chave"], r["Data"], r["Valor"])
conf = pd.read_excel(f, "Conferência")
for _, r in conf.iterrows():
    t = " | ".join(str(x) for x in r)
    if "mensal" in t.lower() or "FIDC" in t or "Não encontrado" in t or "série" in t:
        print("CONF", t)
