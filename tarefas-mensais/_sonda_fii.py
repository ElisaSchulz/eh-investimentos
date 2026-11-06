# Teste temporário: Funds Explorer a partir do GitHub, com FIIs que não são da carteira.
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rendimentos_fiis as r
open(r.ARQUIVO_LOCAL, "w").write("HGLG11\nMXRF11\nXPML11\nNAOEXISTE11\n")
os.environ["MES_REFERENCIA"] = "2026-10"; os.environ["PASTA_SAIDA"] = tempfile.mkdtemp()
arq = r.main()[0]
import pandas as pd
for n, d in pd.read_excel(arq, sheet_name=None).items():
    print("==", n, len(d)); print(d.head(6).to_string())
# rodada 2
