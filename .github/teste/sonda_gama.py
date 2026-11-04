# Teste temporário: histórico diário do Gama Oaktree no informe diário da CVM.
import io, zipfile, urllib.request
for m in ("202607", "202608", "202609", "202610", "202611"):
    url = f"https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_{m}.zip"
    try:
        z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url, timeout=180).read()))
    except Exception as e:
        print("ERR", m, e); continue
    for n in z.namelist():
        linhas = z.read(n).decode("latin-1").splitlines()
        if m == "202607": print("HDR", linhas[0])
        for l in linhas:
            if "68.311.917" in l or "68311917" in l:
                print("ROW", l)
