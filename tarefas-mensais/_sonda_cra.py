# Teste temporário do handle_riza novo (papéis da lista pública da Riza, não da carteira).
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cra_eventos as c
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(user_agent=c.UA, locale="pt-BR")
    pg = ctx.new_page(); pg.goto("https://investidor.rizasec.com/emissoes", wait_until="domcontentloaded")
    c._riza_carregar_indice(pg); pg.close()
    print("índice:", len(c._riza_indice))
    cods = [k for k in c._riza_indice if k[:2].isdigit()][10:200:40]
    for k in cods:
        pg = ctx.new_page()
        try:
            evs = c.handle_riza(pg, {"codigo": "CRI" + k, "nome": "X", "url": "https://investidor.rizasec.com/emissoes/RZA9999"})
            j = [e for e in evs if e["evento"] == "Juros"]
            print("OK", len(evs), "juros", len(j), "ex.", [(e["data_evento"], round(e["valor"], 4)) for e in j[-3:]])
            op = c._riza_indice[k]
            ag = c._riza_get(pg, f"{c.RIZA_API}/{op}/payments?summary=false")["aggregated"]
            print("   agregado/qtd", [(a["date"], round(a["interest"] / a["quantity"], 4)) for a in ag if a["interest"]][-3:])
        except Exception as e:
            print("FALHA", str(e)[:150])
        pg.close()
    b.close()
