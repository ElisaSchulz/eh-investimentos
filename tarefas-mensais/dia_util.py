"""Diz se hoje é o N-ésimo dia útil do mês (feriados nacionais e bancários).

Usado pelo agendamento das tarefas mensais: o GitHub roda o workflow todo dia de 1 a 8
e este script decide se é o dia certo. Uso: python dia_util.py [N] [AAAA-MM-DD]
Escreve "rodar=true" ou "rodar=false" no GITHUB_OUTPUT (ou na tela).
"""
import os
import sys
from datetime import date, timedelta

DIA_UTIL = 3  # terceiro dia útil do mês


def pascoa(ano):
    """Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)."""
    a, b, c = ano % 19, ano // 100, ano % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = (h + l - 7 * m + 114) % 31 + 1
    return date(ano, mes, dia)


def feriados(ano):
    """Feriados nacionais com mercado fechado (calendário ANBIMA)."""
    p = pascoa(ano)
    fixos = [(1, 1), (4, 21), (5, 1), (9, 7), (10, 12), (11, 2), (11, 15), (12, 25)]
    if ano >= 2024:
        fixos.append((11, 20))  # Consciência Negra, nacional desde a Lei 14.759/2023
    moveis = [p - timedelta(days=48), p - timedelta(days=47),  # Carnaval
              p - timedelta(days=2),                           # Sexta-feira Santa
              p + timedelta(days=60)]                          # Corpus Christi
    return {date(ano, m, d) for m, d in fixos} | set(moveis)


def dia_util_do_mes(n, ano, mes):
    d, achados = date(ano, mes, 1), 0
    fer = feriados(ano)
    while True:
        if d.weekday() < 5 and d not in fer:
            achados += 1
            if achados == n:
                return d
        d += timedelta(days=1)


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else DIA_UTIL
    hoje = date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else date.today()
    alvo = dia_util_do_mes(n, hoje.year, hoje.month)
    rodar = hoje == alvo
    print(f"{n}º dia útil de {hoje:%m/%Y}: {alvo:%d/%m/%Y}. Hoje é {hoje:%d/%m/%Y}: "
          f"{'roda' if rodar else 'não roda'}.")
    saida = os.environ.get("GITHUB_OUTPUT")
    if saida:
        with open(saida, "a") as f:
            f.write(f"rodar={'true' if rodar else 'false'}\n")
