# Teste temporário: as fontes de CRA/CRI respondem a partir do GitHub? (sem códigos da carteira)
import ssl, urllib.request, json, sys
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
urls = [
 "https://app.opea.com.br/bff/v1/api/emissao/passivosoperacoes/detalhe?codigoIf=TESTE000",
 "https://app.opea.com.br/pt/emissoes",
 "https://www.pentagonotrustee.com.br/",
 "https://investidor.rizasec.com/",
 "https://aks-prod.virgo.inc/mtr/bff-portal/v1/operations/0/payments?summary=false",
 "https://www.vortx.com.br/investidor/dcm",
 "https://data.anbima.com.br/",
 "https://api-site.oliveiratrust.com.br/fiduciario/pu_hist.php",
 "https://www.ecoagro.agr.br/",
 "https://www.habitasec.com.br/",
]
for u in urls:
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=30)
        print("OK", r.status, len(r.read()), u)
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, u, e.read()[:150])
    except Exception as e:
        print("ERRO", type(e).__name__, str(e)[:150], u)
# ANBIMA com navegador: página pública de busca
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(user_agent=UA, locale="pt-BR")
    for u in ["https://data.anbima.com.br/busca/certificado-de-recebiveis", "https://investidor.rizasec.com/emissoes"]:
        try:
            resp = pg.goto(u, wait_until="domcontentloaded", timeout=60000); pg.wait_for_timeout(6000)
            t = pg.inner_text("body")[:300].replace("\n", " | ")
            print("PW", resp.status if resp else None, u, "->", t)
        except Exception as e:
            print("PW ERRO", u, str(e)[:200])
    b.close()
