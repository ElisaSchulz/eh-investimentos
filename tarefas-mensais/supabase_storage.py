"""
Troca de arquivos com o bucket privado `tarefas-mensais` do Supabase. Usado pelo
GitHub Actions:

    python supabase_storage.py baixar-modelos <pasta>     modelos/* do bucket para a pasta
    python supabase_storage.py enviar <pasta> <AAAA-MM>   arquivos da pasta para AAAA-MM/

Precisa das variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (segredo do GitHub).
"""
import json
import mimetypes
import os
import sys
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


def listar(prefixo):
    corpo = json.dumps({"prefix": prefixo, "limit": 1000}).encode()
    itens = json.loads(_requisicao("POST", f"object/list/{BUCKET}", corpo,
                                   {"Content-Type": "application/json"}))
    return [i["name"] for i in itens if i.get("id")]  # sem id = subpasta


def baixar_modelos(pasta):
    os.makedirs(pasta, exist_ok=True)
    nomes = listar("modelos/")
    for nome in nomes:
        with open(os.path.join(pasta, nome), "wb") as f:
            f.write(_requisicao("GET", _objeto(f"modelos/{nome}")))
        print(f"Modelo baixado: {nome}")
    if not nomes:
        print("Aviso: nenhum modelo em modelos/ no Supabase. A carta mensal vai ser pulada.")


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


if __name__ == "__main__":
    acao = sys.argv[1] if len(sys.argv) > 1 else ""
    if acao == "baixar-modelos":
        baixar_modelos(sys.argv[2])
    elif acao == "enviar":
        enviar(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
