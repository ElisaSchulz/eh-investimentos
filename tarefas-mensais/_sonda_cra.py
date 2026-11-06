# Teste temporário: o handler novo da Riza funciona a partir do GitHub? Usa a 1ª emissão
# da lista pública da Riza (não é da carteira) e só imprime contagens.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cra_eventos as c
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(user_agent=c.UA, locale="pt-BR")
    pg = ctx.new_page(); pg.goto("https://investidor.rizasec.com/emissoes", wait_until="networkidle", timeout=90000)
    links = sorted({h for h in pg.eval_on_selector_all("a[href*='/emissoes/RZA']", "els => els.map(e => e.href)")})
    print("links Riza:", len(links)); pg.close()
    for u in links[:3]:
        pg = ctx.new_page()
        try:
            evs = c.handle_riza(pg, {"codigo": "X", "nome": "X", "url": u})
            print("Riza OK eventos:", len(evs), "juros>0:", sum(1 for e in evs if e["evento"] == "Juros"))
        except Exception as e:
            print("Riza FALHA:", str(e)[:200])
        pg.close()
    b.close()
