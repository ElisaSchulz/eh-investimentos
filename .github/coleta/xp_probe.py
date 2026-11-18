# Sonda: descobre de onde a página pública de fundos da XP carrega a lista
import re, os, urllib.request, json
os.makedirs("saida/xp", exist_ok=True)
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept": "*/*"}
log = open("saida/xp/log.txt", "w", encoding="utf-8")
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=60) as r:
            b = r.read(); print(u, r.status, len(b), file=log); return b.decode("utf-8", "replace")
    except Exception as e:
        print(u, "ERRO", e, file=log); return ""
pags = ["https://www.xpi.com.br/investimentos/fundos-de-investimento/lista/",
        "https://www.xpi.com.br/investimentos/fundos-de-investimento/",
        "https://www.xpi.com.br/produtos/fundos-de-investimento/"]
urls = set(); n = 0
for u in pags:
    t = get(u)
    if not t: continue
    open(f"saida/xp/pag{n}.html", "w", encoding="utf-8").write(t); n += 1
    for s in re.findall(r'<script[^>]+src="([^"]+)"', t):
        if s.startswith("//"): s = "https:" + s
        elif s.startswith("/"): s = "https://www.xpi.com.br" + s
        urls.add(s)
achados = set()
for s in sorted(urls):
    t = get(s)
    for m in re.findall(r'https?://[A-Za-z0-9.\-]+(?:/[A-Za-z0-9_\-./{}$]*)?', t):
        if any(k in m.lower() for k in ("api", "fund", "fundo")): achados.add(m)
    for m in re.findall(r'["\'](/[A-Za-z0-9_\-./]*(?:fund|fundo)[A-Za-z0-9_\-./]*)["\']', t):
        achados.add(m)
open("saida/xp/achados.txt", "w", encoding="utf-8").write("\n".join(sorted(achados)))
