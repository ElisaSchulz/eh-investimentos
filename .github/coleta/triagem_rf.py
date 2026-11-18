# Triagem: classes de Renda Fixa abertas, público geral, com cota diária na CVM; retorno 12m/24m vs CDI
import csv, io, os, json, urllib.request, zipfile, datetime as dt
BASE = "https://dados.cvm.gov.br/dados"
os.makedirs("saida/triagem", exist_ok=True)
log = open("saida/triagem/log.txt", "w", encoding="utf-8")
def dig(s): return "".join(c for c in (s or "") if c.isdigit())
def get(url):
    err = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=300) as r:
                return r.read()
        except Exception as e: err = e
    print("ERRO", url, err, file=log); return None
def textos(b):
    try:
        z = zipfile.ZipFile(io.BytesIO(b))
        for n in z.namelist(): yield n, z.read(n).decode("latin-1")
    except zipfile.BadZipFile:
        yield "csv", b.decode("latin-1")
def rows(t):
    rd = csv.reader(io.StringIO(t), delimiter=";"); cab = next(rd)
    for r in rd: yield dict(zip(cab, r))

# Cadastro (CVM 175): fundo, classe, subclasse
cad = get(f"{BASE}/FI/CAD/DADOS/registro_fundo_classe.zip")
fundos, classes, subs = {}, {}, {}
for n, t in textos(cad):
    rr = list(rows(t))
    print("CAD", n, len(rr), list(rr[0].keys()) if rr else "", file=log)
    if "fundo" in n and "classe" not in n:
        for r in rr: fundos[r.get("ID_Registro_Fundo")] = r
    elif "subclasse" in n:
        for r in rr: subs.setdefault(r.get("ID_Registro_Classe"), []).append(r)
    elif "classe" in n:
        for r in rr: classes[r.get("ID_Registro_Classe")] = r
def g(r, *ks):
    for k in ks:
        if k in r and r[k]: return r[k]
    return ""
cand = {}   # cnpj classe -> info
for idc, r in classes.items():
    if "renda fixa" not in g(r, "Classificacao").lower(): continue
    if "funcionamento normal" not in g(r, "Situacao").lower(): continue
    if g(r, "Forma_Condominio").lower().startswith("fech"): continue
    if g(r, "Exclusivo").upper().startswith("S"): continue
    f = fundos.get(g(r, "ID_Registro_Fundo"), {})
    pub = g(r, "Publico_Alvo")
    ss = subs.get(idc, [])
    cand[dig(g(r, "CNPJ_Classe"))] = {"nome": g(r, "Denominacao_Social"), "pub": pub, "anbima": g(r, "Classificacao_Anbima"),
        "trib": g(r, "Tributacao_Longo_Prazo"), "gestor": g(f, "Gestor"), "admin": g(f, "Administrador"),
        "subs": {g(s, "ID_Subclasse"): (g(s, "Denominacao_Social"), g(s, "Publico_Alvo"), g(s, "Situacao")) for s in ss}}
print("candidatos RF", len(cand), file=log)

# Extrato: taxa, aplicação mínima, prazos
hoje = dt.date.today(); ext = {}
b = get(f"{BASE}/FI/DOC/EXTRATO/DADOS/extrato_fi_{hoje.year}.csv") or get(f"{BASE}/FI/DOC/EXTRATO/DADOS/extrato_fi.csv")
if b:
    for r in rows(b.decode("latin-1")):
        c = dig(r.get("CNPJ_FUNDO_CLASSE") or r.get("CNPJ_FUNDO"))
        if c in cand and (c not in ext or r.get("DT_COMPTC", "") >= ext[c].get("DT_COMPTC", "")): ext[c] = r

# CDI diário
cdi = {}
b = get(f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=01/10/2024&dataFinal={hoje:%d/%m/%Y}")
for x in json.loads(b): cdi[dt.datetime.strptime(x["data"], "%d/%m/%Y").date().isoformat()] = float(x["valor"])

# Informe diário: cota fim de mês por (cnpj, subclasse), PL e cotistas do último dia
mes = {}; ult = {}
y, m = 2024, 10
while dt.date(y, m, 1) <= hoje:
    b = get(f"{BASE}/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_{y}{m:02d}.zip")
    if b:
        for n, t in textos(b):
            for r in rows(t):
                c = dig(r.get("CNPJ_FUNDO_CLASSE") or r.get("CNPJ_FUNDO"))
                if c not in cand: continue
                k = (c, r.get("ID_SUBCLASSE", "") or ""); d = r["DT_COMPTC"]
                try: q = float(r["VL_QUOTA"])
                except: continue
                if q <= 0: continue
                mm = mes.setdefault(k, {})
                if d[:7] not in mm or d > mm[d[:7]][0]: mm[d[:7]] = (d, q)
                if k not in ult or d >= ult[k][0]: ult[k] = (d, r.get("VL_PATRIM_LIQ"), r.get("NR_COTST"))
    m += 1
    if m > 12: y, m = y + 1, 1

def fator_cdi(d0, d1):  # de d0 (exclusive) a d1 (inclusive)
    f = 1.0
    for d, v in cdi.items():
        if d0 < d <= d1: f *= 1 + v / 100
    return f
FIM = "2026-10"
cab = ["cnpj","sub","nome","sub_nome","publico","sub_publico","anbima","trib","gestor","admin","dt_ini12","dt_fim","ret12","cdi12","pct12","ret24","cdi24","pct24","meses_abaixo_cdi_12","pior_mes_vs_cdi","pl","cotistas","dt_ult","taxa_adm","taxa_perf","aplic_min","conv","pagto","cred_priv"]
out = csv.writer(open("saida/triagem/rf_vs_cdi.csv", "w", encoding="utf-8", newline=""), delimiter=";"); out.writerow(cab)
ser = csv.writer(open("saida/triagem/cotas_mensais.csv", "w", encoding="utf-8", newline=""), delimiter=";")
for k, mm in mes.items():
    if FIM not in mm or "2025-10" not in mm: continue
    d1, q1 = mm[FIM]; d0, q0 = mm["2025-10"]
    if d1 < "2026-10-28": continue
    r12 = q1 / q0 - 1; c12 = fator_cdi(d0, d1) - 1
    if r12 <= c12: continue
    r24 = c24 = None
    if "2024-10" in mm:
        r24 = q1 / mm["2024-10"][1] - 1; c24 = fator_cdi(mm["2024-10"][0], d1) - 1
    meses = sorted(x for x in mm if "2025-10" <= x <= FIM); abaixo = 0; pior = 9
    for a, bm in zip(meses, meses[1:]):
        rm = mm[bm][1] / mm[a][1] - 1; cm = fator_cdi(mm[a][0], mm[bm][0]) - 1
        if rm < cm: abaixo += 1
        pior = min(pior, rm - cm)
    c, s = k; i = cand[c]; e = ext.get(c, {}); sb = i["subs"].get(s, ("", "", ""))
    out.writerow([c, s, i["nome"], sb[0], i["pub"], sb[1], i["anbima"], i["trib"], i["gestor"], i["admin"], d0, d1,
        f"{r12:.6f}", f"{c12:.6f}", f"{r12/c12:.4f}", "" if r24 is None else f"{r24:.6f}", "" if c24 is None else f"{c24:.6f}",
        "" if r24 is None else f"{r24/c24:.4f}", abaixo, f"{pior:.6f}", ult[k][1], ult[k][2], ult[k][0],
        e.get("TAXA_ADM",""), e.get("TAXA_PERFM",""), e.get("APLIC_MIN",""), e.get("QT_DIA_CONVERSAO_COTA",""), e.get("QT_DIA_PAGTO_RESGATE",""), e.get("ATIVO_CRED_PRIV","")])
    for x in sorted(mm): ser.writerow([c, s, x, mm[x][0], mm[x][1]])
print("fim", len(mes), file=log)
