# Teste temporário da Riza: fetch de dentro da página (lista pública, não é a carteira).
import json
from playwright.sync_api import sync_playwright
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
API = "https://aks-prod.virgo.inc/mtr/bff-portal/v1/operations"
JS = "async (u) => { const r = await fetch(u, {headers: {Accept: 'application/json'}}); return [r.status, r.status === 200 ? await r.text() : '']; }"
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(user_agent=UA, locale="pt-BR").new_page()
    pg.goto("https://investidor.rizasec.com/emissoes", wait_until="domcontentloaded", timeout=90000)
    st, txt = pg.evaluate(JS, API + "?orderBy=EMISSION_DATE_DESC&pageSize=200&pageNumber=0")
    print("lista", st, len(txt))
    j = json.loads(txt); print("meta", j.get("metadata"), "n", len(j["content"]))
    for o in j["content"][5:40]:
        st, txt = pg.evaluate(JS, f"{API}/{o['id']}/payments?summary=false")
        if st != 200: continue
        pj = json.loads(txt)
        fl = [f for se in pj.get("series", []) for f in se.get("flow", [])]
        if not fl: continue
        print("agg", len(pj["aggregated"]), "series", len(pj["series"]), "flow total", len(fl))
        print("agg0", json.dumps(pj["aggregated"][0])[:300])
        pagos = [f for f in fl if any(isinstance(v, (int, float)) and v for k, v in f.items() if "nterest" in k or "juros" in k.lower())]
        print("flow0", json.dumps(fl[0])[:600])
        if pagos: print("flowpago", json.dumps(pagos[0])[:600])
        break
    b.close()
