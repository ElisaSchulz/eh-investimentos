"""
Atualização diária da aba "Análise de Fundos": para os fundos da última análise mensal
(analise_fundos.json), lê o informe diário da CVM do mês corrente e grava no bucket privado
`diario/fundos_diario.json` com, por fundo:

- rentabilidade do mês até o último dia informado (cota do dia / cota do fim do mês anterior);
- aplicações e resgates dos últimos 5 dias informados e em quantos desses dias houve aplicação
  (se o fundo está recebendo dinheiro, está aberto para aplicação naquele momento);
- PL e cotistas do último dia.

Também grava o CDI do mês até a mesma data. Só fundos com informe diário (FIDC é mensal na CVM).
Roda pelo workflow .github/workflows/fundos-diario.yml de segunda a sexta.
"""
import json
import os
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import supabase_storage as st  # noqa: E402
from analise_fundos import CVM, dig, linhas, num, textos  # noqa: E402
from dados_planilha import baixar, sgs  # noqa: E402

DESTINO = "diario/fundos_diario.json"
DIAS = 5   # dias informados olhados para aplicações e resgates


def ultima_analise():
    """analise_fundos.json mais recente do bucket."""
    meses = sorted((n for n in st.listar("") if len(n) == 7 and n[4] == "-"), reverse=True)
    for m in meses:
        bruto = st.baixar(f"{m}/analise_fundos.json")
        if bruto:
            print(f"Universo: análise de {m}")
            return json.loads(bruto)
    raise SystemExit("Ainda não há analise_fundos.json no bucket. Rode a tarefa mensal analise_fundos primeiro.")


def mes_anterior(m):
    a, mm = int(m[:4]), int(m[5:])
    return f"{a - 1}-12" if mm == 1 else f"{a}-{mm - 1:02d}"


def ler_mes(m, alvo, dias):
    """Linhas do informe diário do mês: {(cnpj, sub): {data: (cota, pl, cotistas, captação, resgate)}}."""
    bruto = baixar(f"{CVM}/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_{m.replace('-', '')}.zip", tentativas=3)
    if not bruto:
        return False
    for _, texto in textos(bruto):
        cab, rd = linhas(texto)
        h = {k: i for i, k in enumerate(cab)}
        ic = h.get("CNPJ_FUNDO_CLASSE", h.get("CNPJ_FUNDO"))
        isub, idt, iq = h.get("ID_SUBCLASSE"), h["DT_COMPTC"], h["VL_QUOTA"]
        ipl, inc, icap, ires = h["VL_PATRIM_LIQ"], h["NR_COTST"], h["CAPTC_DIA"], h["RESG_DIA"]
        for r in rd:
            if len(r) <= iq:
                continue
            k = (dig(r[ic]), r[isub] if isub is not None and isub < len(r) else "")
            if k not in alvo:
                continue
            q = num(r[iq])
            if q <= 0:
                continue
            dias.setdefault(k, {})[r[idt]] = (q, num(r[ipl]), int(num(r[inc])), num(r[icap]), num(r[ires]))
    return True


def main():
    if not st.configurado():
        raise SystemExit("Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.")
    analise = ultima_analise()
    alvo = {(f["c"], f.get("s") or "") for f in analise["fundos"] if f["t"] == "FIF"}
    hoje = date.today()
    atual = f"{hoje.year}-{hoje.month:02d}"
    dias = {}
    tem_atual = ler_mes(atual, alvo, dias)
    if not tem_atual or not any(d[:7] == atual for v in dias.values() for d in v):
        # começo do mês: a CVM ainda não publicou o mês corrente
        atual = mes_anterior(atual)
        ler_mes(atual, alvo, dias)
    ler_mes(mes_anterior(atual), alvo, dias)

    fundos, data_max = {}, ""
    for k, por_dia in dias.items():
        datas = sorted(por_dia)
        no_mes = [d for d in datas if d[:7] == atual]
        if not no_mes:
            continue
        base = [d for d in datas if d[:7] < atual]
        ult = no_mes[-1]
        q, pl, ct = por_dia[ult][:3]
        mtd = round(q / por_dia[base[-1]][0] - 1, 7) if base else None
        rec = datas[-DIAS:]
        cap = sum(por_dia[d][3] for d in rec)
        res = sum(por_dia[d][4] for d in rec)
        dias_cap = sum(1 for d in rec if por_dia[d][3] > 0)
        fundos[k[0] + ("|" + k[1] if k[1] else "")] = [ult, mtd, round(cap), round(res), dias_cap, round(pl), ct]
        data_max = max(data_max, ult)

    cdi = None
    if data_max:
        ini = date(int(atual[:4]), int(atual[5:]), 1)
        s = sgs(12, ini, date.fromisoformat(data_max))
        if not s.empty:
            fator = 1.0
            for _, v in s.items():
                fator *= 1 + v / 100
            cdi = round(fator - 1, 8)

    saida = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mes": atual, "data": data_max, "cdi_mes": cdi, "dias": DIAS,
        "campos": ["data", "ret_mes", "aplicacoes", "resgates", "dias_com_aplicacao", "pl", "cotistas"],
        "fundos": fundos,
    }
    corpo = json.dumps(saida, ensure_ascii=False, separators=(",", ":")).encode()
    st._requisicao("POST", st._objeto(DESTINO), corpo, {"Content-Type": "application/json", "x-upsert": "true"})
    print(f"{len(fundos)} fundos com dado diário até {data_max} (CDI no mês: {cdi}); enviado para {DESTINO}")


if __name__ == "__main__":
    main()
