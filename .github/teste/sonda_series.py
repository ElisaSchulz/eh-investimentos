# Teste temporário: séries do BTG Apolo e Artesanal no informe mensal de FIDC.
import io, zipfile, urllib.request
RAIZES = ("60571986", "68462426", "57555376")
for m in ("202608", "202609"):
    url = f"https://dados.cvm.gov.br/dados/FIDC/DOC/INF_MENSAL/DADOS/inf_mensal_fidc_{m}.zip"
    z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url, timeout=180).read()))
    for n in z.namelist():
        if "tab_X_2_" in n or "tab_IV_" in n:
            linhas = z.read(n).decode("latin-1").splitlines()
            print("HDR", n, linhas[0][:300])
            for l in linhas:
                d = "".join(c for c in l.split(";")[1] if c.isdigit()) if ";" in l else ""
                if d[:8] in RAIZES:
                    print("ROW", m, n[:20], l[:300])
