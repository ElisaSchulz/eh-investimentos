# Coleta pontual: cadastro e cotas diárias de 5 fundos nos dados abertos da CVM.
import csv, io, os, sys, urllib.request, zipfile, datetime as dt, re

CNPJS = {"67560824000197"}
BASE = "https://dados.cvm.gov.br/dados/FI"
os.makedirs("saida", exist_ok=True)
sys.stdout = open("saida/coleta_67560824.txt", "w", encoding="utf-8")


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=300) as r:
            return r.read()
    except Exception as e:
        print(f"# falhou {url}: {e}")
        return None


def dig(s):
    return "".join(c for c in s if c.isdigit())


def tem(row):
    return any(len(dig(v)) == 14 and dig(v) in CNPJS for v in row if v)


def varrer(nome, texto, tag):
    rd = csv.reader(io.StringIO(texto), delimiter=";")
    cab = next(rd)
    print(f"{tag}CAB[{nome}];" + ";".join(cab))
    for r in rd:
        if tem(r):
            print(f"{tag}[{nome}];" + ";".join(r))


def arquivos(b, nome):
    if nome.endswith(".zip"):
        z = zipfile.ZipFile(io.BytesIO(b))
        for n in z.namelist():
            yield n, z.read(n).decode("latin-1")
    else:
        yield nome, b.decode("latin-1")


# Cadastros e extratos
for url in [f"{BASE}/CAD/DADOS/registro_fundo_classe.zip", f"{BASE}/CAD/DADOS/cad_fi.csv"]:
    b = get(url)
    if b:
        for n, t in arquivos(b, url):
            varrer(n, t, "CAD")
idx = get(f"{BASE}/DOC/EXTRATO/DADOS/")
if idx:
    nomes = sorted(set(re.findall(r'href="(extrato_fi[^"]*\.csv)"', idx.decode("latin-1"))))
    print("# extratos:", nomes)
    for nm in nomes[-2:]:
        b = get(f"{BASE}/DOC/EXTRATO/DADOS/{nm}")
        if b:
            varrer(nm, b.decode("latin-1"), "EXT")

# Informe diário
linhas = {}
cab_out = None
def ler(b):
    global cab_out
    for n, t in arquivos(b, "x.zip"):
        rd = csv.reader(io.StringIO(t), delimiter=";")
        cab = next(rd)
        for r in rd:
            if tem(r):
                d = dict(zip(cab, r))
                cnpj = dig(d.get("CNPJ_FUNDO_CLASSE") or d.get("CNPJ_FUNDO") or "")
                key = (cnpj, d.get("ID_SUBCLASSE", ""), d["DT_COMPTC"])
                linhas[key] = d

hoje = dt.date.today()
for ano in range(2025, 2025):
    b = get(f"{BASE}/DOC/INF_DIARIO/DADOS/HIST/inf_diario_fi_{ano}.zip")
    if b:
        ler(b)
hist_lido = set()
for ano in range(2025, hoje.year + 1):
    for mes in range(1, 13):
        if dt.date(ano, mes, 1) > hoje:
            break
        b = get(f"{BASE}/DOC/INF_DIARIO/DADOS/inf_diario_fi_{ano}{mes:02d}.zip")
        if b:
            ler(b)
        elif ano not in hist_lido:
            hist_lido.add(ano)
            h = get(f"{BASE}/DOC/INF_DIARIO/DADOS/HIST/inf_diario_fi_{ano}.zip")
            if h:
                ler(h)

# FIDC e FII: informes mensais
def mensal(url, tag):
    b = get(url)
    if b:
        for n, t in arquivos(b, url):
            rd = csv.reader(io.StringIO(t), delimiter=";")
            cab = next(rd)
            achou = False
            for r in rd:
                if tem(r):
                    if not achou:
                        print(f"{tag}CAB[{n}];" + ";".join(cab)); achou = True
                    print(f"{tag}[{n}];" + ";".join(r))
for ano in range(2025, hoje.year + 1):
    mensal(f"https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_{ano}.zip", "FII")
    for mes in range(1, 13):
        if dt.date(ano, mes, 1) > hoje:
            break
        if ano >= 2023:
            mensal(f"https://dados.cvm.gov.br/dados/FIDC/DOC/INF_MENSAL/DADOS/inf_mensal_fidc_{ano}{mes:02d}.zip", "FIDC")

print("DIACAB;CNPJ;SUBCLASSE;DATA;COTA;PL;CAPT;RESG;COTISTAS;TP")
for k in sorted(linhas):
    d = linhas[k]
    print("DIA;" + ";".join([k[0], k[1], k[2], d.get("VL_QUOTA", ""), d.get("VL_PATRIM_LIQ", ""),
                            d.get("CAPTC_DIA", ""), d.get("RESG_DIA", ""), d.get("NR_COTST", ""),
                            d.get("TP_FUNDO_CLASSE", d.get("TP_FUNDO", ""))]))
print("# fim, linhas:", len(linhas))
