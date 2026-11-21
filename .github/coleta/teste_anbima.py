import urllib.request, ssl, sys
UA={"User-Agent":"Mozilla/5.0"}
urls=[
 "https://www.anbima.com.br/informacoes/merc-sec-debentures/arqs/db251031.txt",
 "https://www.anbima.com.br/informacoes/merc-sec-debentures/arqs/db261030.txt",
 "https://www.anbima.com.br/informacoes/merc-sec-debentures/arqs/db211029.txt",
 "https://www.anbima.com.br/informacoes/merc-sec-cri-cra/arqs/cri_cra_251031.txt",
 "https://www.anbima.com.br/pt_br/informar/precos-e-indices/precos/taxas-de-cri-e-cra.htm",
 "https://www.anbima.com.br/informacoes/merc-sec-debentures/default.asp",
 "https://www.anbima.com.br/informacoes/merc-sec-cri-cra/default.asp",
 "https://data.anbima.com.br/certificado-de-recebiveis",
 "https://www.debentures.com.br/exploreosnd/consultaadados/emissoesdedebentures/puhistorico_r.asp?op_exc=False&ativo=VALE29&dt_ini=01/10/2025&dt_fim=31/10/2026&Submit.x=1",
 "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv",
]
for u in urls:
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=60) as r:
            b=r.read(); print("OK",r.status,len(b),u); print(b[:600].decode("latin-1","replace").replace("\r",""))
    except Exception as e:
        print("ERR",u,e)
    print("-----")
