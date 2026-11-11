# Coleta pontual (análise de carteira): cotas diárias CVM dos fundos do site + fundos da cliente,
# cadastro/extrato (taxa, prazo de resgate, público), cotas mensais de FIDC e CDI diário do BCB.
# Saída compacta em saida/analise_fundos.txt
import csv, io, os, sys, json, urllib.request, zipfile, datetime as dt

BASE = "https://dados.cvm.gov.br/dados"
def dig(s): return "".join(c for c in (s or "") if c.isdigit())
lista = {}
with open("tarefas-mensais/fundos_brasil.csv", encoding="utf-8") as f:
    for r in csv.DictReader(f, delimiter=";"):
        lista[dig(r["cnpj"])] = (r["nome"], r.get("tipo", ""))
for c, n in [("09636393000107", "BNP PARIBAS MATCH DI"), ("51253495000100", "MAPFRE CONFIANZA"),
             ("61749775000159", "TREND INVESTBACK V"), ("28320756000137", "WESTERN ASSET TOTAL CREDIT"),
             ("36249245000102", "VINLAND MACRO SELECAO"), ("42520416000180", "ITAU FMP FGTS ELETROBRAS")]:
    lista.setdefault(c, (n, "CLIENTE"))
CN = set(lista)
os.makedirs("saida", exist_ok=True)
out = open("saida/analise_fundos.txt", "w", encoding="utf-8")
def p(*a): print(*a, file=out, sep=";")

def get(url):
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=300) as r:
                return r.read()
        except Exception as e:
            err = e
    p("#ERRO", url, err); return None

def textos(b):
    try:
        z = zipfile.ZipFile(io.BytesIO(b))
        for n in z.namelist(): yield n, z.read(n).decode("latin-1")
    except zipfile.BadZipFile:
        yield "csv", b.decode("latin-1")

# CDI diário (SGS 12) desde 2023
hoje = dt.date.today()
b = get(f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=01/01/2023&dataFinal={hoje:%d/%m/%Y}")
if b:
    for x in json.loads(b): p("CDI", x["data"], x["valor"])

# Cadastro
b = get(f"{BASE}/FI/CAD/DADOS/registro_fundo_classe.zip")
if b:
    for n, t in textos(b):
        rd = csv.reader(io.StringIO(t), delimiter=";"); cab = next(rd)
        p("CADCAB", n, *cab)
        for r in rd:
            if any(dig(v) in CN for v in r if v and len(dig(v)) == 14): p("CAD", n, *r)
# Extrato (prazos, taxa, público)
b = get(f"{BASE}/FI/DOC/EXTRATO/DADOS/extrato_fi_{hoje.year}.csv") or get(f"{BASE}/FI/DOC/EXTRATO/DADOS/extrato_fi.csv")
if b:
    rd = csv.reader(io.StringIO(b.decode("latin-1")), delimiter=";"); cab = next(rd)
    keep = ["TP_FUNDO_CLASSE","CNPJ_FUNDO_CLASSE","DENOM_SOCIAL","DT_COMPTC","CLASSE_ANBIMA","PUBLICO_ALVO","APLIC_MIN","QT_DIA_CONVERSAO_COTA","QT_DIA_PAGTO_RESGATE","TAXA_ADM","EXISTE_TAXA_PERFM","TAXA_PERFM","ATIVO_CRED_PRIV","FUNDO_COTAS"]
    ix = [cab.index(k) for k in keep if k in cab]
    p("EXTCAB", *[cab[i] for i in ix])
    for r in rd:
        if len(r) > ix[1] and dig(r[ix[1]]) in CN: p("EXT", *[r[i] for i in ix])

# Informe diário: guarda cota de fim de mês + último dia, PL e cotistas do último dia
ult = {}      # (cnpj, sub) -> {mes: (data, cota)}
pl = {}
def ler(b):
    for n, t in textos(b):
        rd = csv.reader(io.StringIO(t), delimiter=";"); cab = next(rd); h = {k: i for i, k in enumerate(cab)}
        ic = h.get("CNPJ_FUNDO_CLASSE", h.get("CNPJ_FUNDO")); isub = h.get("ID_SUBCLASSE")
        for r in rd:
            c = dig(r[ic])
            if c not in CN: continue
            sub = r[isub] if isub is not None and isub < len(r) else ""
            d = r[h["DT_COMPTC"]]; cota = r[h["VL_QUOTA"]]
            k = (c, sub); m = d[:7]
            cur = ult.setdefault(k, {}).get(m)
            if cur is None or d > cur[0]: ult[k][m] = (d, cota)
            if k not in pl or d >= pl[k][0]: pl[k] = (d, r[h["VL_PATRIM_LIQ"]], r[h["NR_COTST"]])
ini = dt.date(2023, 10, 1)
y, m = ini.year, ini.month
while dt.date(y, m, 1) <= hoje:
    b = get(f"{BASE}/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_{y}{m:02d}.zip")
    if b: ler(b)
    m += 1
    if m > 12: y, m = y + 1, 1
for k in sorted(ult):
    for mes in sorted(ult[k]):
        d, cota = ult[k][mes]
        p("MES", k[0], k[1], d, cota)
    p("PL", k[0], k[1], *pl[k])

# FIDC: informe mensal, tabela X_2 (cota por classe/série) e IV (PL)
y, m = 2024, 10
while dt.date(y, m, 1) <= hoje:
    b = get(f"{BASE}/FIDC/DOC/INF_MENSAL/DADOS/inf_mensal_fidc_{y}{m:02d}.zip")
    if b:
        for n, t in textos(b):
            if "tab_X_2" not in n and "tab_IV" not in n and "tab_X_1" not in n: continue
            rd = csv.reader(io.StringIO(t), delimiter=";"); cab = next(rd); first = True
            for r in rd:
                if len(r) > 1 and dig(r[1]) in CN:
                    if first: p("FIDCCAB", n, *cab); first = False
                    p("FIDC", n, *r)
    m += 1
    if m > 12: y, m = y + 1, 1
p("# fim", len(ult))
for c, (n, t) in sorted(lista.items()): p("LISTA", c, n, t)
