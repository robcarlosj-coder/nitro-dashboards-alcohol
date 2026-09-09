/* =========================================================================
   Deixa Comigo Bebidas · Divisão Nitro
   /api/weather — proxy do OpenWeatherMap para o widget da masthead.

   A chave mora em process.env.OPENWEATHER_API_KEY e nunca chega ao cliente,
   que envia apenas latitude e longitude obtidas via navigator.geolocation.
   ========================================================================= */

const ENDPOINT = "https://api.openweathermap.org/data/2.5/weather";

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();

  const chave = process.env.OPENWEATHER_API_KEY;
  if (!chave) {
    return res.status(503).json({ erro: "OPENWEATHER_API_KEY não configurada." });
  }

  const lat = Number(req.query && req.query.lat);
  const lon = Number(req.query && req.query.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ erro: "Coordenadas inválidas." });
  }

  const url = ENDPOINT + "?lat=" + lat.toFixed(4) + "&lon=" + lon.toFixed(4) +
              "&units=metric&lang=pt_br&appid=" + encodeURIComponent(chave);

  let resp, dados;
  try {
    resp = await fetch(url);
    dados = await resp.json();
  } catch (e) {
    return res.status(502).json({ erro: "Falha ao consultar o serviço de clima." });
  }

  if (!resp.ok) {
    return res.status(resp.status).json({
      erro: (dados && dados.message) || "Erro no serviço de clima."
    });
  }

  const cond = (dados.weather && dados.weather[0]) || {};

  /* devolve só o que o widget usa — nada da resposta bruta vaza */
  res.setHeader("cache-control", "public, max-age=600");
  return res.status(200).json({
    cidade: dados.name || "",
    pais: (dados.sys && dados.sys.country) || "",
    temp: Math.round(dados.main && dados.main.temp),
    sensacao: Math.round(dados.main && dados.main.feels_like),
    minima: Math.round(dados.main && dados.main.temp_min),
    maxima: Math.round(dados.main && dados.main.temp_max),
    umidade: (dados.main && dados.main.humidity) ?? null,
    vento: dados.wind && isFinite(dados.wind.speed)
      ? Math.round(dados.wind.speed * 3.6) : null,   // m/s → km/h
    descricao: cond.description || "",
    icone: cond.icon || "",
    codigo: cond.id ?? null
  });
};
