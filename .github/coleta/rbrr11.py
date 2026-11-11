# Coleta pontual RBRR11: CNPJ (CVM), informe mensal FII (VP/cota, PL, cotistas), documentos FNET (relatórios e fatos relevantes) em texto.
import csv, io, os, json, base64, zipfile, urllib.request, urllib.parse, subprocess, datetime as dt, re
os.makedirs("saida/rbrr11", exist_ok=True)
log = open("saida/rbrr11/log.txt", "w", encoding="utf-8")
def p(*a): print(*a, file=log, sep=";", flush=True)
def get(url, hdr=None):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", **(hdr or {})})
        with urllib.request.urlopen(req, timeout=120) as r: return r.read()
    except Exception as e:
        p("#ERRO", url, e); return None
# CNPJ pelo cadastro
cnpj = None
b = get("https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip")
if b:
    z = zipfile.ZipFile(io.BytesIO(b))
    for n in z.namelist():
        for r in csv.reader(io.StringIO(z.read(n).decode("latin-1")), delimiter=";"):
            if any("RBR HIGH GRADE" in (v or "").upper() for v in r):
                p("CAD", n, *r)
                for v in r:
                    d = "".join(c for c in v if c.isdigit())
                    if len(d) == 14 and cnpj is None and n.startswith("registro_fundo"): cnpj = d
cnpj = cnpj or "29467977000103"
p("CNPJ", cnpj)
# Informe mensal FII 2025-2026
for ano in (2025, 2026):
    b = get(f"https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_{ano}.zip")
    if not b: continue
    z = zipfile.ZipFile(io.BytesIO(b))
    for n in z.namelist():
        rd = csv.reader(io.StringIO(z.read(n).decode("latin-1")), delimiter=";"); cab = next(rd); first = True
        for r in rd:
            if (cnpj and any("".join(c for c in v if c.isdigit()) == cnpj for v in r)):
                if first: p("MCAB", n, *cab); first = False
                p("M", n, *r)
# FNET
docs = []
if cnpj:
    for tipo in ("", ):
        q = urllib.parse.urlencode({"d": 1, "s": 0, "l": 60, "o[0][dataEntrega]": "desc", "tipoFundo": 1, "cnpjFundo": cnpj})
        b = get("https://fnet.bmfbovespa.com.br/fnet/publico/pesquisarGerenciadorDocumentosDados?" + q,
                {"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"})
        if b:
            try:
                j = json.loads(b); docs = j.get("data", [])
            except Exception as e:
                p("#FNETJSON", e, b[:300])
for d in docs:
    p("DOC", d.get("id"), d.get("dataEntrega"), d.get("dataReferencia"), d.get("categoriaDocumento"), d.get("tipoDocumento"), d.get("especieDocumento"), (d.get("descricaoFundo") or "")[:40])
def baixar(d, nome):
    b = get(f"https://fnet.bmfbovespa.com.br/fnet/publico/downloadDocumento?id={d['id']}")
    if not b: return
    if not b[:4] == b"%PDF":
        try: b2 = base64.b64decode(b); b = b2 if b2[:4] == b"%PDF" else b
        except Exception: pass
    path = f"saida/rbrr11/{nome}"
    if b[:4] == b"%PDF":
        open(path + ".pdf", "wb").write(b)
        subprocess.run(["pdftotext", "-layout", path + ".pdf", path + ".txt"])
        os.remove(path + ".pdf")
    else:
        open(path + ".txt", "wb").write(b)
rel = [d for d in docs if "gerencial" in (str(d.get("tipoDocumento")) + str(d.get("categoriaDocumento"))).lower()][:4]
fato = [d for d in docs if "fato" in (str(d.get("categoriaDocumento")) + str(d.get("tipoDocumento"))).lower() or "comunicado" in str(d.get("categoriaDocumento")).lower()][:6]
for i, d in enumerate(rel): baixar(d, f"relatorio_{i}_{str(d.get('dataReferencia')).replace('/', '-')}")
for i, d in enumerate(fato): baixar(d, f"fato_{i}_{str(d.get('dataEntrega'))[:10].replace('/', '-')}")
p("# fim", len(docs))
