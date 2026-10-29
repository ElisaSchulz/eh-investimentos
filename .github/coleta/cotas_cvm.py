# Coleta pontual: baixa as cotas diárias de fundos nos dados abertos da CVM (Informe Diário).
import csv, io, sys, urllib.request, zipfile, datetime as dt

CNPJS = {"42520416000180": "Itau FMP FGTS Eletrobras", "36249245000102": "Vinland Macro Selecao FIC FIM"}
BUSCA_NOME = ["VINLAND MACRO SELE", "FGTS ELETROBRAS"]
BASE = "https://dados.cvm.gov.br/dados/FI"


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=120) as r:
            return r.read()
    except Exception as e:
        print(f"# falhou {url}: {e}", file=sys.stderr)
        return None


def so_digitos(s):
    return "".join(c for c in s if c.isdigit())


# Cadastro: confirma CNPJ e nome
cad = get(f"{BASE}/CAD/DADOS/cad_fi.csv")
if cad:
    for row in csv.DictReader(io.StringIO(cad.decode("latin-1")), delimiter=";"):
        nome = (row.get("DENOM_SOCIAL") or "").upper()
        if any(b in nome for b in BUSCA_NOME):
            print("CAD;" + ";".join([row.get("CNPJ_FUNDO", ""), nome, row.get("SIT", ""), row.get("DT_INI_ATIV", ""), row.get("CLASSE", ""), row.get("ADMIN", ""), row.get("GESTOR", "")]))
reg = get(f"{BASE}/CAD/DADOS/registro_fundo_classe.zip")
if reg:
    z = zipfile.ZipFile(io.BytesIO(reg))
    for n in z.namelist():
        for row in csv.DictReader(io.StringIO(z.read(n).decode("latin-1")), delimiter=";"):
            txt = ";".join(str(v) for v in row.values()).upper()
            if any(b in txt for b in BUSCA_NOME):
                print(f"REG[{n}];" + txt[:300])

linhas = {}
def ler(conteudo):
    z = zipfile.ZipFile(io.BytesIO(conteudo))
    for n in z.namelist():
        rd = csv.reader(io.StringIO(z.read(n).decode("latin-1")), delimiter=";")
        cab = next(rd)
        ic = next(i for i, c in enumerate(cab) if c.startswith("CNPJ_FUNDO"))
        idt, iq, ipl = cab.index("DT_COMPTC"), cab.index("VL_QUOTA"), cab.index("VL_PATRIM_LIQ")
        isub = cab.index("ID_SUBCLASSE") if "ID_SUBCLASSE" in cab else None
        for r in rd:
            c = so_digitos(r[ic])
            if c in CNPJS:
                sub = r[isub] if isub is not None else ""
                linhas[(c, sub, r[idt])] = (r[iq], r[ipl])

hoje = dt.date.today()
for ano in range(2020, hoje.year + 1):
    for mes in range(1, 13):
        if (ano, mes) > (hoje.year, hoje.month):
            break
        b = get(f"{BASE}/DOC/INF_DIARIO/DADOS/inf_diario_fi_{ano}{mes:02d}.zip")
        if b:
            ler(b)
        elif mes == 1:
            h = get(f"{BASE}/DOC/INF_DIARIO/DADOS/HIST/inf_diario_fi_{ano}.zip")
            if h:
                ler(h)

with open("cotas_cvm.csv", "w", newline="") as f:
    f.write("cnpj;fundo;subclasse;data;cota;pl\n")
    for (c, sub, d), (q, pl) in sorted(linhas.items()):
        f.write(f"{c};{CNPJS[c]};{sub};{d};{q};{pl}\n")
print(f"# {len(linhas)} linhas")
print(open("cotas_cvm.csv").read())
