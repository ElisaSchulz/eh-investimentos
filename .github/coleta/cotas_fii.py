# Coleta pontual: valor patrimonial da cota de FII no Informe Mensal de FII da CVM.
import csv, io, sys, urllib.request, zipfile

CNPJ = "68729014000184"
reg = "https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip"
z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(urllib.request.Request(reg, headers={"User-Agent": "Mozilla/5.0"}), timeout=180).read()))
for n in z.namelist():
    rd = csv.reader(io.StringIO(z.read(n).decode("latin-1")), delimiter=";")
    cab = next(rd)
    print(f"CAB[{n}];" + "|".join(cab))
    for r in rd:
        if any("".join(c for c in v if c.isdigit()) == CNPJ for v in r):
            print(f"ROW[{n}];" + "|".join(r))

for ano in (2026,):
    url = f"https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_{ano}.zip"
    try:
        b = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=180).read()
    except Exception as e:
        print(f"# falhou {url}: {e}")
        continue
    z = zipfile.ZipFile(io.BytesIO(b))
    for n in z.namelist():
        rd = csv.reader(io.StringIO(z.read(n).decode("latin-1")), delimiter=";")
        cab = next(rd)
        print(f"CAB[{n}];" + "|".join(cab))
        for r in rd:
            if any("".join(c for c in v if c.isdigit()) == CNPJ for v in r):
                print(f"ROW[{n}];" + "|".join(r))
