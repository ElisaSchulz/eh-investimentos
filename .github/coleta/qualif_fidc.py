# Qualificado: (1) FIDCs abertos (geral/qualificado) com cota mensal do informe FIDC; (2) cotas diárias e captação dos FIFs candidatos
import csv, io, os, urllib.request, zipfile, datetime as dt
BASE = "https://dados.cvm.gov.br/dados"
os.makedirs("saida/qualif", exist_ok=True)
log = open("saida/qualif/log.txt", "w", encoding="utf-8")
def dig(s): return "".join(c for c in (s or "") if c.isdigit())
def get(url):
    err = None
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
# cadastro FIDC
fid = {}
for n, t in textos(get(f"{BASE}/FI/CAD/DADOS/registro_fundo_classe.zip")):
    rd = csv.DictReader(io.StringIO(t), delimiter=";")
    if n == "registro_classe.csv":
        for r in rd:
            if "FIDC" not in (r.get("Tipo_Classe") or ""): continue
            if "funcionamento normal" not in (r.get("Situacao") or "").lower(): continue
            if (r.get("Forma_Condominio") or "").lower().startswith("fech"): continue
            if (r.get("Exclusivo") or "").upper().startswith("S"): continue
            if (r.get("Publico_Alvo") or "") not in ("Qualificado", "Público Geral"): continue
            fid[dig(r["CNPJ_Classe"])] = r
w = csv.writer(open("saida/qualif/fidc_cad.csv", "w", encoding="utf-8", newline=""), delimiter=";")
w.writerow(["cnpj", "nome", "publico", "pl", "dt_pl", "condominio", "id_classe"])
for c, r in fid.items(): w.writerow([c, r["Denominacao_Social"], r["Publico_Alvo"], r.get("Patrimonio_Liquido"), r.get("Data_Patrimonio_Liquido"), r.get("Forma_Condominio"), r.get("ID_Registro_Classe")])
print("fidc candidatos", len(fid), file=log)
# informe mensal FIDC
wx = csv.writer(open("saida/qualif/fidc_mensal.csv", "w", encoding="utf-8", newline=""), delimiter=";")
y, m = 2024, 9
while dt.date(y, m, 1) <= hoje:
    b = get(f"{BASE}/FIDC/DOC/INF_MENSAL/DADOS/inf_mensal_fidc_{y}{m:02d}.zip")
    if b:
        for n, t in textos(b):
            tab = n.replace(f"_{y}{m:02d}.csv", "").replace("inf_mensal_fidc_", "")
            keep = tab in ("tab_X_2", "tab_IV", "tab_X_1", "tab_X_1_1", "tab_X_3", "tab_X_4", "tab_X_5", "tab_X_6", "tab_X_7", "tab_VII", "tab_I")
            if not keep: continue
            rd = csv.reader(io.StringIO(t), delimiter=";"); cab = next(rd)
            wx.writerow(["CAB", tab, f"{y}{m:02d}"] + cab)
            ic = cab.index("CNPJ_FUNDO_CLASSE") if "CNPJ_FUNDO_CLASSE" in cab else 1
            for r in rd:
                if len(r) > ic and dig(r[ic]) in fid:
                    if tab in ("tab_I",) and f"{y}{m:02d}" < "202609": continue
                    wx.writerow(["ROW", tab, f"{y}{m:02d}"] + r)
    m += 1
    if m > 12: y, m = y + 1, 1
# FIF: cotas diárias + captação desde out/2025
CN = set(open(".github/coleta/cnpj_fif_capt.txt").read().split())
w = csv.writer(open("saida/qualif/fif_diario.csv", "w", encoding="utf-8", newline=""), delimiter=";")
y, m = 2025, 10
while dt.date(y, m, 1) <= hoje:
    b = get(f"{BASE}/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_{y}{m:02d}.zip")
    if b:
        for n, t in textos(b):
            rd = csv.reader(io.StringIO(t), delimiter=";"); cab = next(rd); h = {c: i for i, c in enumerate(cab)}
            ic = h.get("CNPJ_FUNDO_CLASSE", h.get("CNPJ_FUNDO"))
            for r in rd:
                if dig(r[ic]) in CN:
                    w.writerow([dig(r[ic]), r[h["ID_SUBCLASSE"]] if "ID_SUBCLASSE" in h else "", r[h["DT_COMPTC"]], r[h["VL_QUOTA"]], r[h["CAPTC_DIA"]], r[h["RESG_DIA"]], r[h["VL_PATRIM_LIQ"]], r[h["NR_COTST"]]])
    m += 1
    if m > 12: y, m = y + 1, 1
print("fim", file=log)
