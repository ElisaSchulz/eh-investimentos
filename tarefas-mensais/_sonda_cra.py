# Teste temporário da Riza com emissões da lista pública (não são da carteira).
import sys, os, re, json
from playwright.sync_api import sync_playwright
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(user_agent=UA, locale="pt-BR")
    lista = []
    pg = ctx.new_page()
    def pega(r):
        if "virgo" in r.url and r.request.method == "GET" and r.status == 200 and "operations" in r.url:
            print("  lista url:", r.url[:160])
            try: lista.append(r.json())
            except Exception: pass
    pg.on("response", pega)
    pg.goto("https://investidor.rizasec.com/emissoes", wait_until="networkidle", timeout=90000); pg.wait_for_timeout(4000); pg.close()
    ops = [o for l in lista if isinstance(l, dict) for o in l.get("content", [])]
    print("operações:", len(ops), "chaves resposta:", [list(l.keys()) for l in lista if isinstance(l, dict)])
    for l in lista:
        if isinstance(l, dict): print("  paginação:", {k: v for k, v in l.items() if k != "content"})
    for o in ops[:12:3]:
        pg = ctx.new_page(); res = []
        pg.on("response", lambda r: res.append(r) if "virgo" in r.url and r.request.method == "GET" else None)
        pg.goto("https://investidor.rizasec.com/emissoes/" + o["id"], wait_until="networkidle", timeout=90000); pg.wait_for_timeout(3000)
        print("OP", o["id"][:4], [(r.status, re.sub(r".*/v1/", "", r.url)[:80].replace(o["id"], "{id}")) for r in res])
        for r in res:
            if "payments" in r.url and r.status == 200:
                j = r.json(); print("   payments chaves:", list(j.keys()) if isinstance(j, dict) else type(j))
                ag = j.get("aggregated") if isinstance(j, dict) else None
                if ag: print("   item:", json.dumps(ag[0])[:400])
                for k, v in (j.items() if isinstance(j, dict) else []):
                    if k != "aggregated" and isinstance(v, list) and v: print("   ", k, json.dumps(v[0])[:400])
        pg.close()
    b.close()
