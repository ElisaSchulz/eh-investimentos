# Detalhe da lista curta: lâmina CVM (taxas, prazos, risco) e cotas diárias 12m (vol, drawdown)
import csv, io, os, urllib.request, zipfile, datetime as dt
BASE = "https://dados.cvm.gov.br/dados"
CN = set(open(".github/coleta/shortlist_cnpj.txt").read().split())
os.makedirs("saida/triagem", exist_ok=True)
log = open("saida/triagem/log_detalhe.txt", "w", encoding="utf-8")
def dig(s): return "".join(c for c in (s or "") if c.isdigit())
def get(url):
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=300) as r: return r.read()
        except Exception as e: err = e
    print("ERRO", url, err, file=log); return None
def textos(b):
    try:
        z = zipfile.ZipFile(io.BytesIO(b))
        for n in z.namelist(): yield n, z.read(n).decode("latin-1")
    except zipfile.BadZipFile: yield "csv", b.decode("latin-1")
hoje = dt.date.today()
# Lâmina: mês mais recente disponível
for k in range(0, 6):
    d = dt.date(hoje.year, hoje.month, 1) - dt.timedelta(days=28 * k)
    b = get(f"{BASE}/FI/DOC/LAMINA/DADOS/lamina_fi_{d.year}{d.month:02d}.zip")
    if not b: continue
    w = None
    for n, t in textos(b):
        rd = csv.reader(io.StringIO(t), delimiter=";"); cab = next(rd)
        print("LAMINA", n, cab, file=log)
        if not n.startswith("lamina_fi_2") : continue
        w = csv.writer(open("saida/triagem/lamina.csv", "w", encoding="utf-8", newline=""), delimiter=";"); w.writerow(cab)
        ic = [i for i, c in enumerate(cab) if c.startswith("CNPJ")][0]
        for r in rd:
            if len(r) > ic and dig(r[ic]) in CN: w.writerow(r)
    if w: break
# Cotas diárias desde out/2025
w = csv.writer(open("saida/triagem/cotas_diarias.csv", "w", encoding="utf-8", newline=""), delimiter=";")
y, m = 2025, 10
while dt.date(y, m, 1) <= hoje:
    b = get(f"{BASE}/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_{y}{m:02d}.zip")
    if b:
        for n, t in textos(b):
            rd = csv.reader(io.StringIO(t), delimiter=";"); cab = next(rd); h = {c: i for i, c in enumerate(cab)}
            ic = h.get("CNPJ_FUNDO_CLASSE", h.get("CNPJ_FUNDO"))
            for r in rd:
                if dig(r[ic]) in CN: w.writerow([dig(r[ic]), r[h["ID_SUBCLASSE"]] if "ID_SUBCLASSE" in h else "", r[h["DT_COMPTC"]], r[h["VL_QUOTA"]], r[h["CAPTC_DIA"]], r[h["RESG_DIA"]], r[h["VL_PATRIM_LIQ"]]])
    m += 1
    if m > 12: y, m = y + 1, 1
