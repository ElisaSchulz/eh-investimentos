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
    o = next(o for o in j["content"] if len(o.get("series", [])) >= 2)
    print("series", [(s["id"], s["number"], len(s.get("instrumentCode") or "")) for s in o["series"]])
    st, txt = pg.evaluate(JS, f"{API}/{o['id']}/payments?summary=false")
    print("payments false", st, len(txt))
    if st == 200:
        pj = json.loads(txt); print(list(pj.keys()))
        s0 = pj["series"][0]; print("serie chaves", {k: (type(v).__name__) for k, v in s0.items()})
        for k, v in s0.items():
            if isinstance(v, list) and v: print(" ", k, json.dumps(v[0])[:300])
            elif not isinstance(v, list): print(" ", k, str(v)[:60] if k not in ("instrumentCode",) else len(str(v)))
    st, txt = pg.evaluate(JS, f"{API}/{o['id']}/payments?summary=true")
    print("payments true", st, len(txt))
    b.close()
