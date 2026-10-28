"""
Roda todas as tarefas mensais em sequência e grava status.json na pasta de saída
com o resultado de cada uma (arquivos gerados, avisos e erros). É o que o GitHub
Actions executa todo mês; também dá para rodar no Spyder.

TAREFAS (ou a variável de ambiente TAREFAS, separada por vírgula) escolhe quais rodar.
Uma tarefa que falha não impede as outras.
"""
import contextlib
import io
import json
import os
import sys
import traceback
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from comum import mes_referencia, nome_mes, pasta_saida

MES = None
TAREFAS = ["carta_mensal", "indicadores_americanos", "cotas_fundos", "cotas_b3", "etfs"]

NOMES = {
    "carta_mensal": "Dados da carta mensal",
    "indicadores_americanos": "Indicadores americanos",
    "cotas_fundos": "Cotas dos fundos UCITS",
    "cotas_b3": "Cotas B3",
    "etfs": "Fechamentos de ETFs",
}


class Duplicador(io.TextIOBase):
    """Escreve no console e guarda uma cópia para extrair os avisos."""

    def __init__(self, original):
        self.original, self.copia = original, io.StringIO()

    def write(self, texto):
        self.original.write(texto)
        self.copia.write(texto)
        return len(texto)

    def flush(self):
        self.original.flush()


def rodar(nome, mes):
    import importlib

    saida = Duplicador(sys.stdout)
    resultado = {"tarefa": nome, "nome": NOMES.get(nome, nome), "ok": False, "arquivos": [],
                 "avisos": [], "erro": None}
    print(f"\n========== {resultado['nome']} ==========")
    with contextlib.redirect_stdout(saida):
        try:
            modulo = importlib.import_module(nome)
            arquivos = modulo.main(mes) or []
            resultado["arquivos"] = [os.path.basename(a) for a in arquivos]
            resultado["ok"] = True
        except BaseException as e:  # noqa: BLE001 (SystemExit também conta como falha da tarefa)
            traceback.print_exc(file=saida)
            resultado["erro"] = f"{type(e).__name__}: {e}"[:500]
    resultado["avisos"] = [linha.strip() for linha in saida.copia.getvalue().splitlines()
                           if linha.strip().startswith(("Aviso", "ATENÇÃO"))][:50]
    return resultado


def main(mes=MES):
    ano, m = mes_referencia(mes)
    mes_txt = f"{ano}-{m:02d}"
    tarefas = [t.strip() for t in (os.environ.get("TAREFAS") or ",".join(TAREFAS)).split(",") if t.strip()]
    resultados = [rodar(t, mes_txt) for t in tarefas]
    caminho = os.path.join(pasta_saida(ano, m), "status.json")

    # Rodando só algumas tarefas, mantém no status as outras da execução anterior
    if os.path.exists(caminho):
        with open(caminho, encoding="utf-8") as f:
            anteriores = json.load(f).get("tarefas", [])
        novos = {r["tarefa"]: r for r in resultados}
        ordem = [t for t in TAREFAS if t in novos or any(a["tarefa"] == t for a in anteriores)]
        resultados = [novos.get(t) or next(a for a in anteriores if a["tarefa"] == t) for t in ordem]
        resultados += [r for r in novos.values() if r["tarefa"] not in ordem]

    status = {
        "mes": mes_txt,
        "mes_nome": f"{nome_mes(m)} {ano}",
        "executado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "execucao_url": (f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}"
                         f"/actions/runs/{os.environ['GITHUB_RUN_ID']}"
                         if os.environ.get("GITHUB_RUN_ID") else None),
        "tarefas": resultados,
    }
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False, indent=2)

    print("\n========== Resumo ==========")
    for r in resultados:
        avisos = f" ({len(r['avisos'])} aviso(s))" if r["avisos"] else ""
        print(f"{'OK    ' if r['ok'] else 'FALHOU'} {r['nome']}: "
              f"{', '.join(r['arquivos']) or r['erro']}{avisos}")
    return status


if __name__ == "__main__":
    status = main()
    rodadas = {t.strip() for t in (os.environ.get("TAREFAS") or ",".join(TAREFAS)).split(",")}
    sys.exit(0 if all(r["ok"] for r in status["tarefas"] if r["tarefa"] in rodadas) else 1)
