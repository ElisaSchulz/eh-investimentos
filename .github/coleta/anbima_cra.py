# Coleta pontual: captura as respostas JSON da página ANBIMA Data do CRA (preços/PU histórico e agenda)
import json, os, urllib.request
from playwright.sync_api import sync_playwright
COD = "CRA021000RY"
os.makedirs("saida", exist_ok=True)
caps = []
def on_resp(r):
    try:
        if "json" in (r.headers.get("content-type") or ""):
            caps.append({"url": r.url, "body": r.json()})
    except Exception as e:
        caps.append({"url": r.url, "erro": str(e)})
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.on("response", on_resp)
    for sec in ["precos", "agenda", "caracteristicas"]:
        try:
            pg.goto(f"https://data.anbima.com.br/certificado-de-recebiveis/{COD}/{sec}", wait_until="networkidle", timeout=90000)
            pg.wait_for_timeout(5000)
            open(f"saida/anbima_{sec}.txt", "w").write(pg.inner_text("body"))
        except Exception as e:
            print("erro", sec, e)
    b.close()
json.dump(caps, open("saida/anbima_json.json", "w"), ensure_ascii=False, indent=1)
print("respostas json:", len(caps))
for c in caps: print(c["url"])
# IPCA número-índice (SIDRA tabela 1737, variável 2266)
try:
    u = "https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/202501-202612"
    open("saida/ipca_indice.json", "w").write(urllib.request.urlopen(u, timeout=60).read().decode())
except Exception as e:
    print("erro ipca", e)
