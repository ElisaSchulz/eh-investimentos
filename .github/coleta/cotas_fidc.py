# Coleta pontual: cotas de FIDCs nos dados abertos da CVM (Informe Diário e Informe Mensal de FIDC).
import csv, io, sys, urllib.request, zipfile, datetime as dt

CNPJS = {"43596847000193", "66846870000194", "50695893000105", "60095738000101",
         "34027976000170", "58311427000190", "58038938000180"}
BASE = "https://dados.cvm.gov.br/dados/FI"


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=180) as r:
            return r.read()
    except Exception as e:
        print(f"# falhou {url}: {e}", file=sys.stderr)
        return None


def dig(s):
    return "".join(c for c in s if c.isdigit())


def tem(row):
    return any(dig(v) in CNPJS for v in row if v and 14 <= len(dig(v)) <= 14)


# Cadastro (fundo x classe x subclasse)
reg = get(f"{BASE}/CAD/DADOS/registro_fundo_classe.zip")
if reg:
    z = zipfile.ZipFile(io.BytesIO(reg))
    for n in z.namelist():
        rd = csv.reader(io.StringIO(z.read(n).decode("latin-1")), delimiter=";")
        cab = next(rd)
        print(f"REGCAB[{n}];" + ";".join(cab))
        for r in rd:
            if tem(r):
                print(f"REG[{n}];" + ";".join(r))

diario, mensal = [], []
def ler_diario(b):
    z = zipfile.ZipFile(io.BytesIO(b))
    for n in z.namelist():
        rd = csv.reader(io.StringIO(z.read(n).decode("latin-1")), delimiter=";")
        cab = next(rd)
        for r in rd:
            if tem(r):
                diario.append(dict(zip(cab, r)))

def ler_mensal(b, ref):
    z = zipfile.ZipFile(io.BytesIO(b))
    for n in z.namelist():
        if "tab_x_2" not in n.lower() and "tab_iv" not in n.lower():
            continue
        rd = csv.reader(io.StringIO(z.read(n).decode("latin-1")), delimiter=";")
        cab = next(rd)
        for r in rd:
            if tem(r):
                mensal.append((n, cab, r))

hoje = dt.date.today()
for ano in range(2025, hoje.year + 1):
    for mes in range(1, 13):
        if (ano, mes) > (hoje.year, hoje.month):
            break
        b = None and get(f"{BASE}/DOC/INF_DIARIO/DADOS/inf_diario_fi_{ano}{mes:02d}.zip")
        if b:
            ler_diario(b)
        elif mes == 1:
            h = get(f"{BASE}/DOC/INF_DIARIO/DADOS/HIST/inf_diario_fi_{ano}.zip")
            if h:
                ler_diario(h)
        m = get(f"https://dados.cvm.gov.br/dados/FIDC/DOC/INF_MENSAL/DADOS/inf_mensal_fidc_{ano}{mes:02d}.zip")
        if m:
            ler_mensal(m, f"{ano}{mes:02d}")

with open("fidc_diario.csv", "w", newline="") as f:
    if diario:
        cols = sorted({k for d in diario for k in d})
        w = csv.DictWriter(f, cols, delimiter=";")
        w.writeheader(); w.writerows(diario)
with open("fidc_mensal.csv", "w", newline="") as f:
    for n, cab, r in mensal:
        f.write("MENSAL;" + n + ";" + "|".join(cab) + ";" + "|".join(r) + "\n")
print(f"# diario {len(diario)} linhas, mensal {len(mensal)} linhas")
print("=====DIARIO")
print(open("fidc_diario.csv").read())
print("=====MENSAL")
print(open("fidc_mensal.csv").read())
