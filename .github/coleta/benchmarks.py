# Coleta pontual: CDI diário (BCB SGS 12) e fechamentos diários de IBOV e AXIA3/ELET3 (Yahoo).
import json, urllib.request, sys

def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=120) as r:
            return r.read().decode()
    except Exception as e:
        print(f"# falhou {url}: {e}")
        return None

for ini, fim in [("01/05/2020", "31/12/2022"), ("01/01/2023", "31/12/2026")]:
    t = get(f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial={ini}&dataFinal={fim}")
    if t:
        for x in json.loads(t):
            print(f"CDI;{x['data']};{x['valor']}")
for tk in ["^BVSP", "ELET3.SA", "AXIA3.SA"]:
    t = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{tk}?period1=1590000000&period2=1800000000&interval=1d")
    if not t:
        continue
    r = json.loads(t)["chart"]["result"]
    if not r:
        continue
    r = r[0]
    adj = r["indicators"].get("adjclose", [{}])[0].get("adjclose") or r["indicators"]["quote"][0]["close"]
    for ts, c in zip(r["timestamp"], adj):
        if c is not None:
            print(f"PX;{tk};{ts};{c}")
