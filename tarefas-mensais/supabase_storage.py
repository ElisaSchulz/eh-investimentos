"""
Troca de arquivos com o bucket privado `tarefas-mensais` do Supabase. Usado pelo
GitHub Actions:

    python supabase_storage.py enviar <pasta> <AAAA-MM>   arquivos da pasta para AAAA-MM/
    python supabase_storage.py status <pasta> <AAAA-MM>   baixa AAAA-MM/status.json, se existir

Precisa das variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (segredo do GitHub).
"""
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BUCKET = "tarefas-mensais"


def _requisicao(metodo, caminho, corpo=None, cabecalhos=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/storage/v1/" + caminho
    chave = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(url, data=corpo, method=metodo, headers={
        "Authorization": f"Bearer {chave}", "apikey": chave, **(cabecalhos or {})})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def _objeto(caminho):
    return f"object/{BUCKET}/" + urllib.parse.quote(caminho)


def enviar(pasta, mes):
    # status.json por último: o admin só vê a execução como concluída depois dos arquivos
    for nome in sorted(os.listdir(pasta), key=lambda n: (n == "status.json", n)):
        arquivo = os.path.join(pasta, nome)
        if not os.path.isfile(arquivo):
            continue
        tipo = mimetypes.guess_type(nome)[0] or "application/octet-stream"
        with open(arquivo, "rb") as f:
            _requisicao("POST", _objeto(f"{mes}/{nome}"), f.read(),
                        {"Content-Type": tipo, "x-upsert": "true"})
        print(f"Enviado: {mes}/{nome}")


def baixar_status(pasta, mes):
    """Traz o status.json do mês para a pasta, para uma execução parcial não apagar as outras tarefas."""
    try:
        conteudo = _requisicao("GET", f"object/authenticated/{BUCKET}/" + urllib.parse.quote(f"{mes}/status.json"))
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            print("Ainda não há status.json para este mês.")
            return
        raise
    os.makedirs(pasta, exist_ok=True)
    with open(os.path.join(pasta, "status.json"), "wb") as f:
        f.write(conteudo)
    print(f"Status anterior baixado: {mes}/status.json")


if __name__ == "__main__":
    acao = sys.argv[1] if len(sys.argv) > 1 else ""
    if acao == "enviar":
        enviar(sys.argv[2], sys.argv[3])
    elif acao == "status":
        baixar_status(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
