#!/usr/bin/env python3
"""
Servidor local de desenvolvimento do painel Nitro.

Substitui o `python -m http.server` quando se quer exercitar o chat com IA e o
widget de clima: alem de servir os arquivos estaticos, ele le o `.env` da raiz e
replica as duas rotas que na producao sao serverless functions da Vercel
(`/api/chat` e `/api/weather`), mantendo as chaves fora do navegador.

    python dev-server.py            # http://127.0.0.1:8777/Dashboards/index.html

Sem dependencias externas: so a biblioteca padrao.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RAIZ = os.path.dirname(os.path.abspath(__file__))
PORTA = int(os.environ.get("PORT", "8777"))

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/"
OWM_URL = "https://api.openweathermap.org/data/2.5/weather"

# espelham api/chat.js: teto por tentativa e orcamento da cadeia inteira
TIMEOUT_S = 24
ORCAMENTO_S = 52

MODELOS_PADRAO = [
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
]

ASPAS = "\"'"


def carrega_env(caminho):
    """Le um .env simples (CHAVE=valor, # comentario) para os.environ."""
    if not os.path.isfile(caminho):
        return False
    with open(caminho, "r", encoding="utf-8") as fh:
        for linha in fh:
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, _, valor = linha.partition("=")
            os.environ.setdefault(chave.strip(), valor.strip().strip(ASPAS))
    return True


def post_json(url, corpo, headers, timeout):
    cabecalhos = {"content-type": "application/json"}
    cabecalhos.update(headers)
    req = urllib.request.Request(
        url, data=json.dumps(corpo).encode("utf-8"), method="POST", headers=cabecalhos)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=RAIZ, **kw)

    # ---------------------------------------------------------------- util
    def responde(self, status, dados):
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    # ------------------------------------------------------------ /api/chat
    def rota_chat(self):
        chave = os.environ.get("GEMINI_API_KEY")
        if not chave:
            return self.responde(503, {"erro": "GEMINI_API_KEY ausente no .env."})

        tam = int(self.headers.get("content-length") or 0)
        try:
            body = json.loads(self.rfile.read(tam).decode("utf-8"))
        except Exception:
            return self.responde(400, {"erro": "Corpo JSON invalido."})

        pergunta = str(body.get("pergunta") or "").strip()
        if not pergunta:
            return self.responde(400, {"erro": "Pergunta vazia."})

        instrucao = (
            "Voce e o analista de dados do painel de Consumo Global de Alcool da "
            "Deixa Comigo Bebidas - Divisao Nitro.\n\nREGRAS:\n"
            "1. Responda SEMPRE em portugues do Brasil.\n"
            "2. Use exclusivamente os dados do RECORTE ATIVO abaixo, que ja reflete "
            "os filtros aplicados no painel.\n"
            "3. Se a pergunta envolver paises ou continentes excluidos pelos filtros, "
            "diga isso e sugira qual filtro afrouxar.\n"
            "4. Nunca invente valores.\n"
            "5. Seja direto e quantitativo, com formato numerico brasileiro.\n"
            "6. No maximo 6 linhas ou uma lista de ate 6 itens.\n"
            "7. Sem tabelas nem blocos de codigo.\n\n"
            "=== RECORTE ATIVO ===\n" + str(body.get("contexto") or "(vazio)")
        )

        contents = []
        for t in (body.get("historico") or [])[-8:]:
            papel = "model" if t.get("papel") == "ia" else "user"
            texto = str(t.get("texto") or "")[:2000]
            if texto:
                contents.append({"role": papel, "parts": [{"text": texto}]})
        contents.append({"role": "user", "parts": [{"text": pergunta}]})

        corpo = {
            "system_instruction": {"parts": [{"text": instrucao}]},
            "contents": contents,
            "generationConfig": {"temperature": 0.25, "maxOutputTokens": 900},
        }

        modelos = [m.strip() for m in os.environ.get("GEMINI_MODELS", "").split(",") if m.strip()]
        tentativas = []
        prazo = time.monotonic() + ORCAMENTO_S
        for modelo in (modelos or MODELOS_PADRAO):
            restante = prazo - time.monotonic()
            if restante < 4:
                tentativas.append({"modelo": modelo, "status": 503,
                                   "erro": "orcamento de tempo esgotado"})
                break
            try:
                _, dados = post_json(GEMINI_URL + modelo + ":generateContent", corpo,
                                     {"x-goog-api-key": chave},
                                     min(TIMEOUT_S, restante))
                cand = (dados.get("candidates") or [{}])[0]
                texto = "".join(p.get("text", "")
                                for p in cand.get("content", {}).get("parts", [])).strip()
                if texto:
                    return self.responde(200, {"resposta": texto, "modelo": modelo,
                                               "tentativas": tentativas})
                tentativas.append({"modelo": modelo, "status": 502, "erro": "resposta vazia"})
            except urllib.error.HTTPError as e:
                detalhe = e.read().decode("utf-8", "replace")[:300]
                tentativas.append({"modelo": modelo, "status": e.code, "erro": detalhe})
                # erro definitivo (400 malformado, 403 chave ruim): trocar de modelo nao ajuda
                if e.code not in (404, 429) and e.code < 500:
                    break
            except Exception as e:
                tentativas.append({"modelo": modelo, "status": 503, "erro": str(e)})

        sobrecarga = len(tentativas) > 1 and all(
            t.get("status") in (429, 503) for t in tentativas)
        return self.responde(502, {
            "erro": ("Os modelos do Gemini estao sobrecarregados neste momento "
                     "(%d tentativas). E passageiro - tente de novo em alguns segundos."
                     % len(tentativas)) if sobrecarga else
                    "Nenhum modelo Gemini respondeu.",
            "tentativas": tentativas})

    # --------------------------------------------------------- /api/weather
    def rota_weather(self, query):
        chave = os.environ.get("OPENWEATHER_API_KEY")
        if not chave:
            return self.responde(503, {"erro": "OPENWEATHER_API_KEY ausente no .env."})
        try:
            lat = float(query.get("lat", [""])[0])
            lon = float(query.get("lon", [""])[0])
        except ValueError:
            return self.responde(400, {"erro": "Coordenadas invalidas."})

        url = "%s?lat=%.4f&lon=%.4f&units=metric&lang=pt_br&appid=%s" % (
            OWM_URL, lat, lon, urllib.parse.quote(chave))
        try:
            with urllib.request.urlopen(url, timeout=20) as resp:
                d = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return self.responde(e.code, {"erro": "Erro no servico de clima."})
        except Exception:
            return self.responde(502, {"erro": "Falha ao consultar o servico de clima."})

        cond = (d.get("weather") or [{}])[0]
        main = d.get("main") or {}
        vento = (d.get("wind") or {}).get("speed")
        return self.responde(200, {
            "cidade": d.get("name", ""),
            "pais": (d.get("sys") or {}).get("country", ""),
            "temp": round(main.get("temp", 0)),
            "sensacao": round(main.get("feels_like", 0)),
            "minima": round(main.get("temp_min", 0)),
            "maxima": round(main.get("temp_max", 0)),
            "umidade": main.get("humidity"),
            "vento": round(vento * 3.6) if isinstance(vento, (int, float)) else None,
            "descricao": cond.get("description", ""),
            "icone": cond.get("icon", ""),
            "codigo": cond.get("id"),
        })

    # ------------------------------------------------------------ despacho
    def do_POST(self):
        if urllib.parse.urlparse(self.path).path == "/api/chat":
            return self.rota_chat()
        self.responde(404, {"erro": "Rota nao encontrada."})

    def do_GET(self):
        partes = urllib.parse.urlparse(self.path)
        if partes.path == "/api/weather":
            return self.rota_weather(urllib.parse.parse_qs(partes.query))
        if partes.path == "/api/chat":
            return self.responde(405, {"erro": "Use POST."})
        super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


if __name__ == "__main__":
    tem_env = carrega_env(os.path.join(RAIZ, ".env"))
    print("Painel Nitro - servidor de desenvolvimento")
    print("  .env: %s" % ("carregado" if tem_env else "AUSENTE (chat e clima ficam off)"))
    print("  Gemini:       %s" % ("ok" if os.environ.get("GEMINI_API_KEY") else "sem chave"))
    print("  OpenWeather:  %s" % ("ok" if os.environ.get("OPENWEATHER_API_KEY") else "sem chave"))
    print("  http://127.0.0.1:%d/Dashboards/index.html" % PORTA)
    ThreadingHTTPServer(("127.0.0.1", PORTA), Handler).serve_forever()
