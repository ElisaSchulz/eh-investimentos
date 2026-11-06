"""
Rascunho da carta mensal escrito pelo Claude (API da Anthropic).

O Claude recebe o pedido fixo de carta/prompt_carta.md, os números do mês (carta_dados.json),
as últimas cartas como referência de linguagem e os pedidos do mês escritos no Editor da Carta.
Ele pesquisa na web os acontecimentos do mês e devolve o texto de cada seção, a tabela de
indicadores e o Focus. O resultado vai para carta_rascunho_ia.json, que o Editor da Carta
oferece para preencher a carta. Nada é publicado sem passar pelo editor.

Cartas de referência, em ordem de prioridade (até MAX_REFERENCIAS):
  1. as cartas dos meses anteriores escritas no editor (AAAA-MM/carta_textos.json no Supabase);
  2. PDFs ou .txt de cartas antigas na pasta referencias-carta/ do Supabase (enviados pelo
     Editor da Carta) ou, rodando no computador, em carta/referencias/ (fora do GitHub).

Chave da API: variável ANTHROPIC_API_KEY (segredo do GitHub) ou arquivo chave_anthropic.txt
nesta pasta (não vai para o GitHub). Sem chave, a tarefa só avisa e não faz nada.

Rodar no Spyder: botão Run. Para outro mês, preencha MES abaixo (ex.: "2026-09").
"""
import base64
import json
import os
import re
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import supabase_storage as storage
from comum import AQUI, limites_do_mes, mes_referencia, nome_mes, pasta_saida

# ------------------------------------------------------------------ parâmetros
MES = None                 # None = mês anterior. Ou "AAAA-MM".
MODELO = os.environ.get("CLAUDE_MODELO") or "claude-opus-5-5"
ESFORCO = "high"           # low | medium | high | xhigh | max: mais alto pesquisa mais e custa mais
MAX_REFERENCIAS = 4        # quantas cartas antigas mandar como referência de linguagem
MAX_BUSCAS = 30            # limite de buscas na web por carta
MAX_PAGINAS = 20           # limite de páginas abertas por carta

PASTA_REFERENCIAS = "referencias-carta"       # no bucket do Supabase
PASTA_REFERENCIAS_LOCAL = os.path.join(AQUI, "carta", "referencias")
ARQUIVO_PROMPT = os.path.join(AQUI, "carta", "prompt_carta.md")
SECOES = {"visao": "Visão geral", "eua": "Estados Unidos", "europa": "Europa",
          "china": "China", "japao": "Japão", "brasil": "Brasil", "carteiras": "Carteiras"}
INDICADORES_PADRAO = [("Selic", "Meta · Copom"), ("IPCA", "Referência do mês anterior"),
                      ("IPCA-15", "Prévia do mês"), ("IGP-M", ""), ("R$/USD", "Fechamento do mês"),
                      ("Brent", "US$ por barril"), ("Dívida Bruta", "% do PIB")]
# US$ por milhão de tokens (entrada, saída) e por busca, para estimar o custo no relatório
PRECOS = {"claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-fable-5-1": (10.0, 50.0)}
PRECO_BUSCA = 0.01


# ------------------------------------------------------------------ entradas
def chave_anthropic():
    chave = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    arquivo = os.path.join(AQUI, "chave_anthropic.txt")
    if not chave and os.path.exists(arquivo):
        with open(arquivo, encoding="utf-8") as f:
            chave = f.read().strip()
    return chave


def ler_prompt():
    with open(ARQUIVO_PROMPT, encoding="utf-8") as f:
        texto = f.read()
    return texto.split("\n---\n", 1)[1].strip() if "\n---\n" in texto else texto.strip()


def _json_do_bucket(caminho):
    conteudo = storage.baixar(caminho)
    try:
        return json.loads(conteudo) if conteudo else None
    except ValueError:
        return None


def dados_do_mes(mes, pasta):
    local = os.path.join(pasta, "carta_dados.json")
    if os.path.exists(local):
        with open(local, encoding="utf-8") as f:
            return json.load(f)
    dados = _json_do_bucket(f"{mes}/carta_dados.json") if storage.configurado() else None
    if not dados:
        raise RuntimeError(f"Não achei carta_dados.json de {mes}. Rode antes a tarefa carta_mensal.")
    return dados


def meses_anteriores(mes):
    if not storage.configurado():
        return []
    return sorted((n for n in storage.listar("") if re.fullmatch(r"\d{4}-\d{2}", n) and n < mes), reverse=True)


def carta_em_texto(mes, t):
    ano, m = mes.split("-")
    partes = [f"Carta de {nome_mes(int(m))} de {ano}"]
    if t.get("subtitulo"):
        partes.append(f"Subtítulo: {t['subtitulo']}")
    for chave, titulo in SECOES.items():
        if (t.get("textos") or {}).get(chave, "").strip():
            partes.append(f"## {titulo}\n\n{t['textos'][chave].strip()}")
    linhas = [f"- {l.get('nome')} ({l.get('sub')}): valor {l.get('valor')}; mês {l.get('mes')}; "
              f"ano {l.get('ano')}; 12m {l.get('m12')}" for l in t.get("indicadores") or [] if l.get("nome")]
    if linhas:
        partes.append("## Indicadores\n\n" + "\n".join(linhas))
    if t.get("focus"):
        partes.append(f"## {t.get('focus_titulo') or 'Focus'}\n\n" +
                      "\n".join(f"- {f.get('rotulo')}: {f.get('valor')}" for f in t["focus"])
                      + (f"\n\n{t['focus_referencia']}" if t.get("focus_referencia") else ""))
    return "\n\n".join(partes)


def referencias(mes):
    """Blocos de conteúdo com as cartas de referência e a lista do que foi usado."""
    blocos, usadas = [], []
    for anterior in meses_anteriores(mes):
        if len(usadas) >= MAX_REFERENCIAS:
            break
        t = _json_do_bucket(f"{anterior}/carta_textos.json")
        if t and any(v.strip() for v in (t.get("textos") or {}).values()):
            blocos.append({"type": "text", "text": "<carta_referencia>\n" + carta_em_texto(anterior, t)
                           + "\n</carta_referencia>"})
            usadas.append(f"{anterior}/carta_textos.json")

    arquivos = []  # (nome, função que devolve os bytes)
    if storage.configurado():
        arquivos += [(n, lambda n=n: storage.baixar(f"{PASTA_REFERENCIAS}/{n}"))
                     for n in storage.listar(PASTA_REFERENCIAS) if not n.startswith(".")]
    if os.path.isdir(PASTA_REFERENCIAS_LOCAL):
        arquivos += [(n, lambda n=n: open(os.path.join(PASTA_REFERENCIAS_LOCAL, n), "rb").read())
                     for n in os.listdir(PASTA_REFERENCIAS_LOCAL)]
    # nomes mais "recentes" primeiro (ex.: "2026-07 Carta Julho.pdf")
    for nome, ler in sorted(arquivos, key=lambda a: a[0], reverse=True):
        if len(usadas) >= MAX_REFERENCIAS:
            break
        ext = os.path.splitext(nome)[1].lower()
        if ext not in (".pdf", ".txt", ".md"):
            continue
        conteudo = ler()
        if not conteudo:
            continue
        if ext == ".pdf":
            blocos.append({"type": "document", "title": nome, "source": {
                "type": "base64", "media_type": "application/pdf",
                "data": base64.standard_b64encode(conteudo).decode()}})
        else:
            blocos.append({"type": "text", "text": f"<carta_referencia arquivo=\"{nome}\">\n"
                           + conteudo.decode("utf-8", "replace") + "\n</carta_referencia>"})
        usadas.append(nome)
    return blocos, usadas


def textos_do_mes(mes, anteriores):
    """carta_textos.json do mês (pedidos ao Claude) e a lista de indicadores a preencher."""
    atual = _json_do_bucket(f"{mes}/carta_textos.json") if storage.configurado() else None
    base = atual
    if not (base and base.get("indicadores")):
        base = next((t for t in (_json_do_bucket(f"{a}/carta_textos.json") for a in anteriores[:1]) if t), None)
    if base and base.get("indicadores"):
        indicadores = [(l.get("nome", ""), l.get("sub", "")) for l in base["indicadores"] if l.get("nome")]
    else:
        indicadores = INDICADORES_PADRAO
    focus = [f.get("rotulo") for f in (base or {}).get("focus") or []] or ["Selic", "IPCA", "PIB", "Dólar"]
    pedidos = (atual or {}).get("instrucoes_ia", "").strip()
    carteiras = (atual or {}).get("notas_carteiras", "").strip()
    return pedidos, indicadores, focus, carteiras


def _milhar(v):
    return "—" if v is None else f"{v:,.0f}".replace(",", ".")


def bloco_dados(dados, inicio, fim, indicadores, focus, pedidos, carteiras=""):
    linhas = [f"- {i['nome']} ({i['praca']}): fechamento {_milhar(i['fechamento'])}, retorno no mês "
              f"{str(i['retorno']).replace('.', ',')}% (último pregão {i['ultima_data']})"
              for i in dados.get("indices", []) if i.get("retorno") is not None]
    destaques = [f"- {d['rotulo']}: {d['valor']}" for d in dados.get("destaques", [])]

    calculados = []
    for a in dados.get("indicadores_auto") or []:
        detalhe = f" ({a['sub']})" if a.get("sub") else ""
        calculados.append(f"- {a['nome']}{detalhe}: fechamento {a.get('valor') or '—'}; mês {a.get('mes') or '—'}; "
                          f"ano {a.get('ano') or '—'}; 6 meses {a.get('m6') or '—'}; "
                          f"12 meses {a.get('m12') or '—'}; 24 meses {a.get('m24') or '—'}")
    texto = (
        f"Hoje é {date.today():%d/%m/%Y}. Escreva a carta de {dados['mes_nome']} de {dados['ano']} "
        f"(de {inicio:%d/%m/%Y} a {fim:%d/%m/%Y}).\n\n"
        "<dados_do_mes>\nÍndices de bolsa (fonte oficial da carta, use estes números):\n" + "\n".join(linhas)
        + "\n\nDestaques da capa:\n" + "\n".join(destaques) + "\n</dados_do_mes>\n\n"
        "Linhas da tabela de indicadores, nesta ordem (nome · detalhe do mês anterior):\n"
        + "\n".join(f"- {n} · {s}" for n, s in indicadores)
        + "\n\nProjeções do Focus, nesta ordem: " + ", ".join(focus) + "\n"
    )
    if calculados:
        texto += ("\n<indicadores_calculados>\nJá calculados a partir do Banco Central e do Yahoo (repita estes "
                  "valores exatamente na tabela e use-os no texto; complete só o que faltar, como a data do Copom "
                  "no detalhe da Selic):\n" + "\n".join(calculados) + "\n</indicadores_calculados>\n")
    fa = dados.get("focus_auto") or {}
    if fa.get("itens"):
        br = lambda iso: "/".join(reversed(iso.split("-"))) if iso else ""
        texto += (f"\n<focus_calculado>\nBoletim Focus de {br(fa.get('data_boletim'))}, com as projeções coletadas até "
                  f"{br(fa.get('data_coleta'))} (o último com coleta no mês), direto do Banco Central. Repita estes "
                  "valores e esta referência exatamente e use este boletim no texto do Brasil:\n"
                  + "\n".join(f"- {f['rotulo']}: {f['valor']}" for f in fa["itens"])
                  + f"\nfocus_referencia: {fa.get('referencia', '')}\n</focus_calculado>\n")
    if pedidos:
        texto += f"\n<pedidos_do_mes>\n{pedidos}\n</pedidos_do_mes>\n"
    texto += ("\n<carteiras_do_mes>\nComo as carteiras da EH foram no mês, nas palavras da gestora (base da seção "
              f"Carteiras):\n{carteiras}\n</carteiras_do_mes>\n" if carteiras else
              "\n<carteiras_do_mes>\n(A gestora não contou como foram as carteiras neste mês: escreva a seção "
              "Carteiras pelo comportamento de cada classe e anote em pontos_a_conferir que o resultado das "
              "carteiras precisa ser confirmado.)\n</carteiras_do_mes>\n")
    texto += ("\nAs cartas de referência acima mostram a linguagem e o tipo de informação esperados. "
              "Pesquise os acontecimentos do mês e responda no formato pedido.")
    return texto


# ------------------------------------------------------------------ Claude
def chamar_claude(chave, sistema, conteudo):
    import anthropic

    cliente = anthropic.Anthropic(api_key=chave, timeout=900, max_retries=3)
    ferramentas = [
        {"type": "web_search_20260209", "name": "web_search", "max_uses": MAX_BUSCAS},
        {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": MAX_PAGINAS},
    ]
    mensagens = [{"role": "user", "content": conteudo}]
    blocos, usos = [], []
    for _ in range(8):  # a pesquisa pode pausar (pause_turn); cada volta retoma de onde parou
        with cliente.beta.messages.stream(
            model=MODELO, max_tokens=64000, system=sistema, messages=mensagens, tools=ferramentas,
            thinking={"type": "adaptive"}, output_config={"effort": ESFORCO},
            # se o filtro de segurança recusar por engano, a API tenta o modelo reserva indicado
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        ) as stream:
            resposta = stream.get_final_message()
        usos.append(resposta.usage)
        blocos += resposta.content
        if resposta.stop_reason == "refusal":
            raise RuntimeError(f"O Claude recusou o pedido ({resposta.stop_details}).")
        if resposta.stop_reason == "max_tokens":
            raise RuntimeError("A resposta passou do limite de tamanho. Tente de novo.")
        if resposta.stop_reason != "pause_turn":
            break
        buscas = sum(1 for b in resposta.content if b.type == "server_tool_use")
        print(f"Pesquisando… ({buscas} consulta(s) nesta etapa)")
        if mensagens[-1]["role"] == "assistant":
            mensagens[-1]["content"] = list(mensagens[-1]["content"]) + list(resposta.content)
        else:
            mensagens.append({"role": "assistant", "content": resposta.content})
    else:
        raise RuntimeError("A pesquisa não terminou depois de várias etapas.")
    return blocos, usos


def resumo_uso(usos):
    entrada = sum((u.input_tokens or 0) + (u.cache_creation_input_tokens or 0)
                  + (u.cache_read_input_tokens or 0) for u in usos)
    saida = sum(u.output_tokens or 0 for u in usos)
    buscas = sum(getattr(u.server_tool_use, "web_search_requests", 0) or 0
                 for u in usos if getattr(u, "server_tool_use", None))
    p_in, p_out = PRECOS.get(MODELO, PRECOS["claude-opus-5-5"])
    custo = entrada / 1e6 * p_in + saida / 1e6 * p_out + buscas * PRECO_BUSCA
    return {"tokens_entrada": entrada, "tokens_saida": saida, "buscas": buscas,
            "custo_estimado_usd": round(custo, 2)}


def extrair_json(texto):
    achados = re.findall(r"<carta_json>\s*(.*?)\s*</carta_json>", texto, re.S)
    bruto = achados[-1] if achados else texto[texto.find("{"): texto.rfind("}") + 1]
    bruto = re.sub(r"^```(?:json)?\s*|\s*```$", "", bruto.strip())
    return json.loads(bruto)


def normalizar(r, indicadores, focus):
    textos = {k: str((r.get("textos") or {}).get(k) or "").strip() for k in SECOES}
    vazias = [SECOES[k] for k, v in textos.items() if not v]
    if vazias:
        print(f"Aviso: o Claude não escreveu {', '.join(vazias)}.")
    campos = ("grupo", "nome", "sub", "valor", "mes", "ano", "m6", "m12", "m24")
    inds = [{c: str(l.get(c) or "") for c in campos} for l in r.get("indicadores") or [] if isinstance(l, dict)]
    if not inds:
        inds = [{"nome": n, "sub": s, "valor": "", "mes": "", "ano": "", "m12": ""} for n, s in indicadores]
    fcs = [{"rotulo": str(f.get("rotulo") or ""), "valor": str(f.get("valor") or "")}
           for f in r.get("focus") or [] if isinstance(f, dict)] or [{"rotulo": f, "valor": ""} for f in focus]
    fontes = [{"titulo": str(f.get("titulo") or f.get("url") or ""), "url": str(f.get("url") or ""),
               "uso": str(f.get("uso") or "")} for f in r.get("fontes") or [] if isinstance(f, dict)]
    return {"subtitulo": str(r.get("subtitulo") or "").strip(), "textos": textos, "indicadores": inds,
            "focus": fcs, "focus_referencia": str(r.get("focus_referencia") or "").strip(), "fontes": fontes,
            "pontos_a_conferir": [str(p) for p in r.get("pontos_a_conferir") or []]}


# ------------------------------------------------------------------ principal
def main(mes=MES):
    ano, m = mes_referencia(mes)
    mes_txt = f"{ano}-{m:02d}"
    inicio, fim = limites_do_mes(ano, m)
    print(f"Rascunho da carta de {nome_mes(m)}/{ano} com o Claude ({MODELO})")

    chave = chave_anthropic()
    if not chave:
        print("Aviso: sem chave da API do Claude (segredo ANTHROPIC_API_KEY); rascunho não gerado.")
        return []

    pasta = pasta_saida(ano, m)
    dados = dados_do_mes(mes_txt, pasta)
    anteriores = meses_anteriores(mes_txt)
    pedidos, indicadores, focus, carteiras = textos_do_mes(mes_txt, anteriores)
    refs, usadas = referencias(mes_txt)
    if not usadas:
        print("Aviso: nenhuma carta de referência encontrada; o estilo vai depender só do prompt.")
    print(f"Referências: {', '.join(usadas) or 'nenhuma'}")
    if pedidos:
        print(f"Pedidos do mês: {pedidos[:200]}")

    conteudo = refs + [{"type": "text", "text": bloco_dados(dados, inicio, fim, indicadores, focus, pedidos, carteiras)}]
    blocos, usos = chamar_claude(chave, ler_prompt(), conteudo)
    texto = "".join(b.text for b in blocos if b.type == "text")
    uso = resumo_uso(usos)
    print(f"Uso: {uso['tokens_entrada']:,} tokens de entrada, {uso['tokens_saida']:,} de saída, "
          f"{uso['buscas']} buscas, cerca de US$ {uso['custo_estimado_usd']:.2f}")

    try:
        resposta = extrair_json(texto)
    except ValueError:
        bruto = os.path.join(pasta, "carta_ia_resposta.txt")
        with open(bruto, "w", encoding="utf-8") as f:
            f.write(texto)
        raise RuntimeError("Não consegui ler o rascunho devolvido pelo Claude (resposta salva em "
                           "carta_ia_resposta.txt).")

    rascunho = {"mes": mes_txt, "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "modelo": MODELO, **normalizar(resposta, indicadores, focus),
                "referencias": usadas, "pedidos": pedidos, "uso": uso}
    caminho = os.path.join(pasta, "carta_rascunho_ia.json")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(rascunho, f, ensure_ascii=False, indent=1)
    print(f"Arquivo salvo: {caminho}")
    print("Abra o Editor da Carta e use 'Preencher com o rascunho do Claude'.")
    return [caminho]


if __name__ == "__main__":
    main()
