# Teste temporário da Riza com emissões da lista pública (só contagens no log).
import sys, os, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cra_eventos as c
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(user_agent=c.UA, locale="pt-BR")
    corpos = []
    pg = ctx.new_page()
    def pega(r):
        if "virgo" in r.url and r.request.method == "GET" and r.status == 200:
            try: corpos.append(r.text())
            except Exception: pass
    pg.on("response", pega)
    pg.goto("https://investidor.rizasec.com/emissoes", wait_until="networkidle", timeout=90000); pg.wait_for_timeout(4000); pg.close()
    tudo = " ".join(corpos)
    print("respostas:", len(corpos), "tamanho:", len(tudo))
    ids = sorted(set(re.findall(r'RZA\d{4}', tudo)))
    if not ids:
        print("amostra:", re.sub(r"\s+", " ", tudo[:600]))
    print("ids na lista pública:", len(ids))
    teste = ids[::max(1, len(ids)//6)][:6]
    for u in teste:
        pg = ctx.new_page()
        try:
            evs = c.handle_riza(pg, {"codigo": "X", "nome": "X", "url": "https://investidor.rizasec.com/emissoes/" + u})
            print("Riza OK eventos:", len(evs), "juros:", sum(1 for e in evs if e["evento"] == "Juros"))
        except Exception as e:
            print("Riza FALHA:", str(e)[:200])
        pg.close()
    b.close()
