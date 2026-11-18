"""
Base da aba "Análise de Fundos" do admin: rentabilidade mensal dos fundos de renda fixa
e dos FIDCs abertos (público geral e qualificado) nos dados abertos da CVM, mais o CDI do
Banco Central. Grava `analise_fundos.json`; os indicadores (YTD, 12, 24 e 36 meses, % do
CDI, Sharpe, volatilidade, drawdown) são calculados na própria aba a partir dele.

Universo:
- FIF (informe diário): classes "Renda Fixa" em funcionamento, abertas, não exclusivas, com
  público-alvo Geral ou Qualificado e PL de pelo menos PL_MINIMO.
- FIDC (informe mensal, tabela X_2): classes FIDC abertas, não exclusivas, Geral ou Qualificado.
- Qualquer CNPJ das listas de plataforma enviadas pela aba (config/plataformas.json no
  bucket privado), mesmo de outra classe (multimercado de crédito, por exemplo).

Rentabilidade de cada mês = cota do último dia do mês / cota do último dia do mês anterior.
"""
import csv
import io
import json
import os
import sys
import zipfile
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from comum import mes_referencia, pasta_saida  # noqa: E402
from dados_planilha import baixar  # noqa: E402

MES = None
MESES = 38            # meses de cota de fim de mês (36 meses de retorno + folga)
PL_MINIMO = 10e6      # FIF menor que isso só entra se estiver numa lista de plataforma
CVM = "https://dados.cvm.gov.br/dados"
ARQUIVO = "analise_fundos.json"
FIDC_INICIO = "2025-01"   # antes disso o zip do informe mensal de FIDC não existe na CVM (404)


def dig(s):
    return "".join(c for c in (s or "") if c.isdigit())


def num(x):
    try:
        return float(str(x).replace(",", "."))
    except ValueError:
        return 0.0


def textos(bruto):
    """CSVs de um zip (ou o CSV solto) da CVM, como texto."""
    if bruto[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(bruto))
        for nome in z.namelist():
            yield nome, z.read(nome).decode("latin-1")
    else:
        yield "csv", bruto.decode("latin-1")


def linhas(texto):
    rd = csv.reader(io.StringIO(texto), delimiter=";")
    cab = next(rd, [])
    return cab, rd


def coluna(cab, *finais):
    """Índice da primeira coluna cujo nome termina com um dos finais (o leiaute da CVM muda)."""
    for f in finais:
        for i, k in enumerate(cab):
            if k.upper().endswith(f):
                return i
    return None


def meses_ate(ano, mes, n):
    out = []
    a, m = ano, mes
    for _ in range(n):
        out.append(f"{a}-{m:02d}")
        m -= 1
        if m == 0:
            a, m = a - 1, 12
    return out[::-1]


def plataformas():
    """CNPJs das listas de plataforma (XP, BTG...) guardadas pela aba no bucket privado."""
    try:
        import supabase_storage as st
        if not st.configurado():
            return {}
        bruto = st.baixar("config/plataformas.json")
        if not bruto:
            return {}
        dados = json.loads(bruto)
        return {nome: set(lista.get("fundos", {})) for nome, lista in dados.get("plataformas", {}).items()}
    except Exception as e:  # noqa: BLE001
        print(f"Aviso: não consegui ler as listas de plataforma: {e}")
        return {}


def cadastro(extra):
    """Classes candidatas do cadastro da CVM: {cnpj: info}."""
    bruto = baixar(f"{CVM}/FI/CAD/DADOS/registro_fundo_classe.zip")
    if not bruto:
        raise SystemExit("Não consegui baixar o cadastro de fundos da CVM.")
    fundos, classes, subs = {}, [], {}
    for nome, texto in textos(bruto):
        rd = csv.DictReader(io.StringIO(texto), delimiter=";")
        if nome == "registro_fundo.csv":
            for r in rd:
                fundos[r["ID_Registro_Fundo"]] = r
        elif nome == "registro_classe.csv":
            classes = list(rd)
        elif nome == "registro_subclasse.csv":
            for r in rd:
                subs.setdefault(r["ID_Registro_Classe"], []).append(r)
    cand = {}
    for r in classes:
        c = dig(r.get("CNPJ_Classe"))
        tipo = "FIDC" if "FIDC" in (r.get("Tipo_Classe") or "") else "FIF"
        classif = r.get("Classificacao") or ""
        publico = r.get("Publico_Alvo") or ""
        ok = ("funcionamento normal" in (r.get("Situacao") or "").lower()
              and not (r.get("Forma_Condominio") or "").lower().startswith("fech")
              and not (r.get("Exclusivo") or "").upper().startswith("S")
              and publico in ("Público Geral", "Qualificado")
              and (tipo == "FIDC" or classif == "Renda Fixa"))
        if not ok and c not in extra:
            continue
        f = fundos.get(r.get("ID_Registro_Fundo"), {})
        cand[c] = {
            "n": r.get("Denominacao_Social", "").strip(),
            "t": tipo,
            "cl": "FIDC" if tipo == "FIDC" else (r.get("Classificacao_Anbima") or classif),
            "p": "G" if publico == "Público Geral" else "Q" if publico == "Qualificado" else "P" if publico else "",
            "g": (f.get("Gestor") or "").strip(),
            "cp": (r.get("Classificacao_Anbima") or "").lower().find("crédito livre") >= 0,
            "subs": {s.get("ID_Subclasse"): (s.get("Denominacao_Social", "").strip(), s.get("Publico_Alvo") or "")
                     for s in subs.get(r.get("ID_Registro_Classe"), [])},
        }
    return cand


def cotas_fif(cand, meses):
    """Cota de fim de mês, PL, cotistas e captação do último mês por (cnpj, subclasse)."""
    fif = {c for c, i in cand.items() if i["t"] == "FIF"}
    ult = {}    # (cnpj, sub) -> {mes: (data, cota)}
    info = {}   # (cnpj, sub) -> (data, pl, cotistas)
    capt = {}   # (cnpj, sub) -> soma da captação no último mês com dado
    sem = []
    for m in meses:
        bruto = baixar(f"{CVM}/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_{m.replace('-', '')}.zip", tentativas=3)
        if not bruto:
            sem.append(m)
            continue
        for _, texto in textos(bruto):
            cab, rd = linhas(texto)
            h = {k: i for i, k in enumerate(cab)}
            ic = h.get("CNPJ_FUNDO_CLASSE", h.get("CNPJ_FUNDO"))
            isub, idt, iq = h.get("ID_SUBCLASSE"), h["DT_COMPTC"], h["VL_QUOTA"]
            ipl, inc, icap = h["VL_PATRIM_LIQ"], h["NR_COTST"], h["CAPTC_DIA"]
            for r in rd:
                if len(r) <= iq:
                    continue
                c = dig(r[ic])
                if c not in fif:
                    continue
                q = num(r[iq])
                if q <= 0:
                    continue
                k = (c, r[isub] if isub is not None and isub < len(r) else "")
                d = r[idt]
                mm = ult.setdefault(k, {})
                if d[:7] not in mm or d > mm[d[:7]][0]:
                    mm[d[:7]] = (d, q)
                if k not in info or d >= info[k][0]:
                    info[k] = (d, num(r[ipl]), int(num(r[inc])))
                if d[:7] == m:
                    capt.setdefault(k, {}).setdefault(m, 0.0)
                    capt[k][m] += num(r[icap])
    if sem:
        print(f"Aviso: informe diário da CVM indisponível para {', '.join(sem)}")
    return ult, info, capt


def cotas_fidc(cand, meses):
    """Cota de fim de mês dos FIDCs pelo informe mensal (série sênior quando há)."""
    alvo = {c for c, i in cand.items() if i["t"] == "FIDC"}
    x2, pl, nc, cap = {}, {}, {}, {}
    sem = []
    for m in meses:
        if m < FIDC_INICIO:          # a CVM só tem o informe mensal de FIDC em zip a partir de 2025
            continue
        bruto = baixar(f"{CVM}/FIDC/DOC/INF_MENSAL/DADOS/inf_mensal_fidc_{m.replace('-', '')}.zip", tentativas=2)
        if not bruto:
            sem.append(m)
            continue
        for nome, texto in textos(bruto):
            tab = next((t for t in ("tab_X_2_", "tab_X_1_", "tab_X_4_", "tab_IV_") if t in nome), None)
            if not tab:
                continue
            cab, rd = linhas(texto)
            ic = coluna(cab, "CNPJ_FUNDO_CLASSE", "CNPJ_FUNDO")
            idt = coluna(cab, "DT_COMPTC")
            if tab == "tab_X_2_":
                cols = [coluna(cab, "CLASSE_SERIE"), coluna(cab, "VL_COTA"), coluna(cab, "QT_COTA")]
            elif tab == "tab_IV_":
                cols = [coluna(cab, "_VL_PL")]
            elif tab == "tab_X_1_":
                cols = [coluna(cab, "NR_COTST", "COTST")]
            else:
                cols = [coluna(cab, "TP_OPER"), coluna(cab, "VL_TOTAL")]
            if ic is None or idt is None or None in cols:
                print(f"Aviso: leiaute inesperado em {nome} ({m}); colunas: {', '.join(cab)[:300]}")
                continue
            for r in rd:
                if len(r) < len(cab) or dig(r[ic]) not in alvo:
                    continue
                c, d = dig(r[ic]), r[idt]
                if tab == "tab_X_2_":
                    x2.setdefault((c, d[:7]), []).append((r[cols[0]], num(r[cols[1]]), num(r[cols[2]]), d))
                elif tab == "tab_IV_":
                    pl[(c, d[:7])] = num(r[cols[0]])
                elif tab == "tab_X_1_":
                    nc[(c, d[:7])] = nc.get((c, d[:7]), 0) + int(num(r[cols[0]]))
                elif "capta" in r[cols[0]].lower():
                    cap[(c, d[:7])] = cap.get((c, d[:7]), 0) + num(r[cols[1]])
    if sem:
        print(f"Aviso: informe mensal de FIDC indisponível para {', '.join(sem)} (sai até uns 15 dias depois do fim do mês)")
    ult = {}
    for (c, m), linhas_x2 in x2.items():
        com = [x for x in linhas_x2 if x[1] > 0 and x[2] > 0]
        sen = [x for x in com if "SENIOR" in x[0].upper() or "SÊNIOR" in x[0].upper() or "S?NIOR" in x[0].upper()]
        esc = sen or com
        if not esc:
            continue
        esc = max(esc, key=lambda x: x[2])       # várias séries: a de maior quantidade
        cota = esc[1]
        if abs(esc[1] - esc[2]) <= 1e-9 * max(1.0, esc[2]) and pl.get((c, m)) and len(com) == 1:
            cota = pl[(c, m)] / esc[2]           # fundo informou a quantidade no campo da cota
        ult.setdefault((c, ""), {})[m] = (esc[3], cota)
    info = {}
    for (c, _), mm in ult.items():
        m = max(mm)
        info[(c, "")] = (mm[m][0], pl.get((c, m), 0.0), nc.get((c, m), 0))
    capt = {}
    for (c, m), v in cap.items():
        capt.setdefault((c, ""), {})[m] = v
    return ult, info, capt


def cdi_mensal(meses):
    """CDI de cada mês (fator - 1) pela série diária 12 do Banco Central."""
    from dados_planilha import sgs
    a, m = (int(x) for x in meses[0].split("-"))
    s = sgs(12, date(a, m, 1), date.today())
    if s.empty:
        raise SystemExit("Não consegui baixar o CDI do Banco Central.")
    out = {}
    for d, v in s.items():
        k = f"{d.year}-{d.month:02d}"
        out[k] = out.get(k, 1.0) * (1 + v / 100)
    return {k: round(v - 1, 8) for k, v in out.items() if k in meses}


def main(mes=MES):
    ano, m = mes_referencia(mes)
    meses = meses_ate(ano, m, MESES)
    print(f"Análise de fundos: cotas de {meses[0]} a {meses[-1]}")
    plats = plataformas()
    extra = set().union(*plats.values()) if plats else set()
    print(f"Listas de plataforma: {', '.join(f'{k} ({len(v)})' for k, v in plats.items()) or 'nenhuma enviada'}")

    cand = cadastro(extra)
    print(f"Classes candidatas no cadastro: {len(cand)} "
          f"({sum(1 for i in cand.values() if i['t'] == 'FIDC')} FIDC)")
    u1, i1, c1 = cotas_fif(cand, meses)
    u2, i2, c2 = cotas_fidc(cand, meses)
    ult, info, capt = {**u1, **u2}, {**i1, **i2}, {**c1, **c2}
    cdi = cdi_mensal(meses)

    retornos_meses = meses[1:]
    fundos = []
    for k, mm in ult.items():
        c, sub = k
        i = cand[c]
        d_ult, pl, cot = info.get(k, ("", 0.0, 0))
        if i["t"] == "FIF" and pl < PL_MINIMO and c not in extra:
            continue
        if d_ult[:7] < meses[-3]:        # parou de informar
            continue
        r = []
        for a, b in zip(meses, retornos_meses):
            if a in mm and b in mm and mm[a][1] > 0:
                r.append(round(mm[b][1] / mm[a][1] - 1, 7))
            else:
                r.append(None)
        if all(x is None for x in r):
            continue
        nome_sub, pub_sub = i["subs"].get(sub, ("", "")) if sub else ("", "")
        pub = {"Público Geral": "G", "Qualificado": "Q", "Profissional": "P"}.get(pub_sub, i["p"])
        cm = capt.get(k, {})
        ult_capt_mes = max(cm) if cm else None
        fundos.append({
            "c": c, "s": sub, "n": i["n"], "ns": nome_sub, "t": i["t"], "cl": i["cl"], "p": pub,
            "g": i["g"], "pl": round(pl), "ct": cot, "dt": d_ult,
            "cap": None if ult_capt_mes is None else round(cm[ult_capt_mes]),
            "capm": ult_capt_mes, "r": r,
        })
    fundos.sort(key=lambda f: -f["pl"])
    saida = {
        "mes": f"{ano}-{m:02d}",
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "meses": retornos_meses,
        "cdi": [cdi.get(x) for x in retornos_meses],
        "fundos": fundos,
    }
    caminho = os.path.join(pasta_saida(ano, m), ARQUIVO)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(fundos)} fundos ({sum(1 for f in fundos if f['t'] == 'FIDC')} FIDC) em {ARQUIVO} "
          f"({os.path.getsize(caminho) / 1e6:.1f} MB)")
    return [caminho]


if __name__ == "__main__":
    main()
