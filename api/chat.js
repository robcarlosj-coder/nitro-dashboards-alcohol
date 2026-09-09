/* =========================================================================
   Deixa Comigo Bebidas · Divisão Nitro
   /api/chat — proxy do Google Gemini com cadeia de modelos de fallback.

   A chave NUNCA chega ao navegador: mora em process.env.GEMINI_API_KEY
   (arquivo .env local, ou variável de ambiente do projeto na Vercel).
   Sem dependências: usa o fetch global do runtime Node.
   ========================================================================= */

/* Ordem de tentativa: o primeiro modelo que responder atende a requisição.
   A ordem alterna capacidade e velocidade de propósito — na prática o serviço
   oscila muito, e os modelos "lite" costumam responder quando os maiores estão
   em 503 de alta demanda. Sobrescrevível por GEMINI_MODELS no .env. */
const MODELOS_PADRAO = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest"
];

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";

/* A function tem 60s (vercel.json). ORCAMENTO_MS e a janela util da cadeia inteira;
   TIMEOUT_MS e o teto de uma tentativa. Sob carga o Gemini responde em 30s ou
   devolve 503 de "high demand", entao o teto por tentativa precisa ser generoso o
   bastante para nao descartar um modelo que responderia — e o orcamento, curto o
   bastante para o usuario receber um erro honesto em vez de esperar sem fim. */
const ORCAMENTO_MS = 52000;
const TIMEOUT_MS = 24000;

/* Erros que justificam tentar o próximo modelo da cadeia. Um 400 (pedido
   malformado) ou 403 (chave inválida) se repetiria em todos — esses param aqui. */
const RECUPERAVEL = (status) => status === 429 || status === 404 || status >= 500;

function modelos() {
  const bruto = String(process.env.GEMINI_MODELS || "").trim();
  if (!bruto) return MODELOS_PADRAO;
  const lista = bruto.split(",").map((s) => s.trim()).filter(Boolean);
  return lista.length ? lista : MODELOS_PADRAO;
}

/* Uma tentativa contra um modelo. Devolve {ok, texto} ou {ok:false, status, erro}. */
async function tentar(modelo, chave, corpo, tetoMs) {
  const ctrl = new AbortController();
  const corta = setTimeout(() => ctrl.abort(), tetoMs);

  let resp;
  try {
    resp = await fetch(ENDPOINT + encodeURIComponent(modelo) + ":generateContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify(corpo),
      signal: ctrl.signal
    });
  } catch (e) {
    /* timeout ou falha de rede: ambos recuperaveis, cai para o proximo modelo */
    return { ok: false, status: 503,
             erro: e.name === "AbortError"
               ? "Tempo esgotado apos " + Math.round(tetoMs / 1000) + "s"
               : "Falha de rede: " + e.message };
  } finally {
    clearTimeout(corta);
  }

  const dados = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const msg = (dados && dados.error && dados.error.message) || ("HTTP " + resp.status);
    return { ok: false, status: resp.status, erro: msg };
  }

  const cand = dados.candidates && dados.candidates[0];
  const texto = cand && cand.content && Array.isArray(cand.content.parts)
    ? cand.content.parts.map((p) => p.text || "").join("").trim()
    : "";

  /* resposta vazia por filtro de segurança ou corte de tokens: não adianta
     insistir no mesmo modelo, mas o próximo pode responder */
  if (!texto) {
    const motivo = (cand && cand.finishReason) || "SEM_TEXTO";
    return { ok: false, status: 502, erro: "Resposta vazia (" + motivo + ")" };
  }

  return { ok: true, texto };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Use POST." });
  }

  const chave = process.env.GEMINI_API_KEY;
  if (!chave) {
    return res.status(503).json({
      erro: "GEMINI_API_KEY não configurada no ambiente do servidor."
    });
  }

  /* o corpo pode chegar já desserializado (Vercel) ou como string */
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ erro: "Corpo JSON inválido." });
  }

  const pergunta = String(body.pergunta || "").trim();
  if (!pergunta) return res.status(400).json({ erro: "Pergunta vazia." });
  if (pergunta.length > 4000) {
    return res.status(400).json({ erro: "Pergunta longa demais (máx. 4000 caracteres)." });
  }

  /* contexto = recorte filtrado do painel, serializado pelo cliente */
  const contexto = String(body.contexto || "").slice(0, 120000);

  /* histórico curto da conversa, para perguntas encadeadas */
  const historico = Array.isArray(body.historico) ? body.historico.slice(-8) : [];

  const instrucao = [
    "Você é o analista de dados do painel de Consumo Global de Álcool da Deixa Comigo Bebidas — Divisão Nitro.",
    "",
    "REGRAS:",
    "1. Responda SEMPRE em português do Brasil.",
    "2. Use exclusivamente os dados do RECORTE ATIVO abaixo. Ele já reflete os filtros que o usuário aplicou no painel (métrica, continentes, países e faixa de valores).",
    "3. Se a pergunta envolver países ou continentes que os filtros ativos excluíram, diga isso explicitamente e sugira qual filtro afrouxar — não invente o número.",
    "4. Nunca invente valores. Se um dado não está no recorte, afirme que não está.",
    "5. Seja direto e quantitativo: cite os números com a unidade correta e no formato brasileiro (vírgula decimal).",
    "6. Respostas curtas — no máximo 6 linhas ou uma lista de até 6 itens. Sem preâmbulo.",
    "7. Não use tabelas nem blocos de código; texto corrido ou lista simples com hífen.",
    "",
    "=== RECORTE ATIVO ===",
    contexto || "(nenhum recorte enviado)"
  ].join("\n");

  const contents = [];
  historico.forEach((t) => {
    const papel = t && t.papel === "ia" ? "model" : "user";
    const texto = String((t && t.texto) || "").slice(0, 2000);
    if (texto) contents.push({ role: papel, parts: [{ text: texto }] });
  });
  contents.push({ role: "user", parts: [{ text: pergunta }] });

  const corpo = {
    system_instruction: { parts: [{ text: instrucao }] },
    contents,
    generationConfig: { temperature: 0.25, maxOutputTokens: 900 }
  };

  const tentativas = [];
  const prazo = Date.now() + ORCAMENTO_MS;

  for (const modelo of modelos()) {
    const restante = prazo - Date.now();
    /* nao vale comecar uma tentativa que nao cabe mais no orcamento */
    if (restante < 4000) {
      tentativas.push({ modelo, status: 503, erro: "Orcamento de tempo esgotado" });
      break;
    }

    const r = await tentar(modelo, chave, corpo, Math.min(TIMEOUT_MS, restante));
    if (r.ok) {
      return res.status(200).json({ resposta: r.texto, modelo, tentativas });
    }
    tentativas.push({ modelo, status: r.status, erro: r.erro });
    if (!RECUPERAVEL(r.status)) break;   // erro definitivo: trocar de modelo nao ajuda
  }

  const ultima = tentativas[tentativas.length - 1];

  /* 429/503 em toda a cadeia e sobrecarga passageira do lado do Google: a acao
     util para o usuario e tentar de novo, nao conferir configuracao. */
  const sobrecarga = tentativas.length > 1 &&
    tentativas.every((t) => t.status === 503 || t.status === 429);


  return res.status(502).json({
    erro: sobrecarga
      ? "Os modelos do Gemini estão sobrecarregados neste momento (" +
        tentativas.length + " tentativas). É passageiro — tente de novo em alguns segundos."
      : "Nenhum modelo Gemini conseguiu responder. Último erro: " +
        ((ultima && ultima.erro) || "desconhecido"),
    tentativas
  });
};
