/* =========================================================================
   Deixa Comigo Bebidas · Divisão Nitro
   Painel de Consumo Global de Álcool — motor do dashboard
   Stack: HTML + CSS + JavaScript (d3 e topojson embarcados, funciona offline)
   Todos os números do painel derivam da planilha importada — nada é fixo.
   ========================================================================= */
(function () {
  "use strict";

  /* ===================================================== 1. configuração */

  const METRICS = [
    { key: "total",  col: "total_litres_of_pure_alcohol", label: "Álcool puro",
      unit: "L/hab.ano", short: "L puro", dec: 2, step: 0.1, color: "#0e5c88" },
    { key: "beer",   col: "beer_servings",   label: "Cerveja",
      unit: "doses/ano", short: "doses", dec: 0, step: 1, color: "#94c356" },
    { key: "spirit", col: "spirit_servings", label: "Destilados",
      unit: "doses/ano", short: "doses", dec: 0, step: 1, color: "#56a8c3" },
    { key: "wine",   col: "wine_servings",   label: "Vinho",
      unit: "doses/ano", short: "doses", dec: 0, step: 1, color: "#0e5c88" }
  ];
  const M = Object.fromEntries(METRICS.map((m) => [m.key, m]));
  const TYPES = ["beer", "spirit", "wine"];          // tipos de bebida
  const ALLKEYS = ["beer", "spirit", "wine", "total"];

  const CONTINENTS = ["Africa", "Americas", "Asia", "Europe", "Oceania"];
  const CONT_PT = {
    Africa: "África", Americas: "Américas", Asia: "Ásia",
    Europe: "Europa", Oceania: "Oceania"
  };
  const CONT_COLOR = {
    Africa: "#94c356", Americas: "#0e5c88", Asia: "#56a8c3",
    Europe: "#3f7d5f", Oceania: "#8fa1ab"
  };

  /* As serverless functions (/api/chat e /api/weather) so existem quando o painel
     e servido por HTTP. Aberto direto do disco (file://) o dashboard continua
     inteiro, mas o chat com IA e o widget de clima ficam fora do ar. */
  const TEM_BACKEND = /^https?:$/.test(location.protocol);

  /* aliases aceitos para cada coluna (normalizados: minúsculo, sem acento/símbolo) */
  const COL_ALIASES = {
    country: ["country", "pais", "paises", "nation", "nome", "territorio", "local"],
    beer:    ["beerservings", "beer", "cerveja", "cervejas", "cervejadoses"],
    spirit:  ["spiritservings", "spirit", "spirits", "destilado", "destilados",
              "licor", "licores", "aguardente"],
    wine:    ["wineservings", "wine", "vinho", "vinhos"],
    total:   ["totallitresofpurealcohol", "totallitres", "totallitros", "totallitrospuros",
              "alcoolpuro", "totalalcool", "litrosdealcoolpuro", "total", "litros"]
  };

  const nfPt = (d) => new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: d, maximumFractionDigits: d
  });
  const fmt = (v, d = 1) => (v == null || !isFinite(v)) ? "—" : nfPt(d).format(v);
  const fmtM = (v, m) => fmt(v, m.dec);
  const fmtCompact = (v) => (v == null || !isFinite(v)) ? "—"
    : new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(v);

  /* ========================================================= 2. estatística */

  const S = {
    sum:  (a) => a.reduce((s, x) => s + x, 0),
    mean: (a) => a.length ? S.sum(a) / a.length : NaN,
    min:  (a) => a.length ? Math.min.apply(null, a) : NaN,
    max:  (a) => a.length ? Math.max.apply(null, a) : NaN,
    /* quantil por interpolação linear (tipo 7 / padrão R e numpy) */
    quantile(a, p) {
      if (!a.length) return NaN;
      const s = a.slice().sort((x, y) => x - y);
      const h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
      return s[lo] + (h - lo) * (s[hi] - s[lo]);
    },
    median: (a) => S.quantile(a, 0.5),
    /* desvio-padrão amostral (n-1) */
    std(a) {
      if (a.length < 2) return NaN;
      const m = S.mean(a);
      return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
    },
    /* coeficiente de correlação de Pearson */
    pearson(x, y) {
      const n = Math.min(x.length, y.length);
      if (n < 3) return NaN;
      const mx = S.mean(x), my = S.mean(y);
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) {
        const a = x[i] - mx, b = y[i] - my;
        sxy += a * b; sxx += a * a; syy += b * b;
      }
      const den = Math.sqrt(sxx * syy);
      return den === 0 ? NaN : sxy / den;
    },
    /* regressão linear simples por mínimos quadrados */
    linreg(x, y) {
      const n = Math.min(x.length, y.length);
      const mx = S.mean(x), my = S.mean(y);
      let sxy = 0, sxx = 0;
      for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
      const slope = sxx === 0 ? 0 : sxy / sxx;
      return { slope, intercept: my - slope * mx, n };
    },
    /* p-valor bicaudal aproximado via transformação z de Fisher */
    pValue(r, n) {
      if (!isFinite(r) || n < 5 || Math.abs(r) >= 1) return 0;
      const z = Math.atanh(r) * Math.sqrt(n - 3);
      return 2 * (1 - S.normCdf(Math.abs(z)));
    },
    normCdf(z) {
      /* Abramowitz & Stegun 7.1.26 */
      const t = 1 / (1 + 0.2316419 * Math.abs(z));
      const d = 0.3989422804014327 * Math.exp(-z * z / 2);
      const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 +
                t * (-1.821255978 + t * 1.330274429))));
      return z > 0 ? 1 - p : p;
    }
  };

  const describe = (arr) => ({
    n: arr.length,
    sum: S.sum(arr), mean: S.mean(arr), median: S.median(arr),
    min: S.min(arr), max: S.max(arr), std: S.std(arr),
    q1: S.quantile(arr, 0.25), q3: S.quantile(arr, 0.75)
  });

  /* ======================================================== 3. CSV parser */

  const norm = (s) => String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");

  function detectDelimiter(head) {
    const cands = [",", ";", "\t", "|"];
    let best = ",", bestN = -1;
    cands.forEach((c) => {
      const n = (head.match(new RegExp("\\" + c, "g")) || []).length;
      if (n > bestN) { bestN = n; best = c; }
    });
    return best;
  }

  /* parser tolerante a aspas, quebras dentro de campo e CRLF */
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const delim = detectDelimiter(text.slice(0, text.indexOf("\n") + 1 || 400));
    const rows = [];
    let row = [], field = "", i = 0, quoted = false;
    while (i < text.length) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { quoted = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ""; i++; continue; }
      if (ch === "\r") { i++; continue; }
      if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += ch; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  }

  function toNumber(v) {
    if (v == null) return NaN;
    let s = String(v).trim();
    if (!s) return NaN;
    /* aceita 1.234,56 (pt-BR) e 1,234.56 (en-US) */
    if (/,/.test(s) && /\./.test(s)) {
      s = s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
    } else if (/,/.test(s)) {
      s = s.replace(",", ".");
    }
    s = s.replace(/[^\d.\-+eE]/g, "");
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  function ingest(text, fileName) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error("O arquivo não tem linhas de dados suficientes.");

    const header = rows[0].map(norm);
    const idx = {};
    Object.keys(COL_ALIASES).forEach((key) => {
      let pos = -1;
      for (const alias of COL_ALIASES[key]) {
        const p = header.indexOf(alias);
        if (p !== -1) { pos = p; break; }
      }
      /* fallback: correspondência por prefixo (ex.: "beer_servings_2010") */
      if (pos === -1) {
        pos = header.findIndex((h) => COL_ALIASES[key].some((a) => h.startsWith(a) && a.length > 3));
      }
      idx[key] = pos;
    });

    const faltando = Object.keys(idx).filter((k) => idx[k] === -1);
    if (faltando.length) {
      throw new Error(
        "Colunas não encontradas: " + faltando.join(", ") +
        ". Cabeçalho lido: " + rows[0].join(" | ")
      );
    }

    const data = [], descartadas = [];
    for (let r = 1; r < rows.length; r++) {
      const raw = rows[r];
      const country = String(raw[idx.country] || "").trim();
      if (!country) continue;
      const rec = {
        country,
        continent: inferContinent(country),
        beer: toNumber(raw[idx.beer]),
        spirit: toNumber(raw[idx.spirit]),
        wine: toNumber(raw[idx.wine]),
        total: toNumber(raw[idx.total])
      };
      if (ALLKEYS.some((k) => !isFinite(rec[k]))) { descartadas.push(country); continue; }
      rec.servings = rec.beer + rec.spirit + rec.wine;
      TYPES.forEach((t) => { rec[t + "Share"] = rec.servings ? rec[t] / rec.servings : 0; });
      rec.dominant = rec.servings
        ? TYPES.reduce((a, b) => (rec[a] >= rec[b] ? a : b))
        : null;
      data.push(rec);
    }
    if (!data.length) throw new Error("Nenhuma linha válida encontrada após a conversão numérica.");

    return { data, fileName, discarded: descartadas, columns: rows[0] };
  }

  /* índices de nomes: aceita a grafia canônica (inglês) ou em português */
  const CONT_INDEX = new Map(Object.keys(window.NITRO_GEO.continent)
    .map((k) => [norm(k), k]));
  const PT_INDEX = new Map(Object.keys(window.NITRO_GEO.ptNames)
    .map((k) => [norm(k), window.NITRO_GEO.ptNames[k]]));

  /* resolve o nome informado na planilha para a grafia canônica de referência */
  function canonical(country) {
    const n = norm(country);
    if (CONT_INDEX.has(n)) return CONT_INDEX.get(n);
    if (PT_INDEX.has(n)) return PT_INDEX.get(n);
    return country;
  }

  /* países fora do dicionário de referência entram como "Outros" */
  function inferContinent(country) {
    const c = canonical(country);
    return window.NITRO_GEO.continent[c] || "Outros";
  }

  /* ============================================================= 4. estado */

  const state = {
    raw: [],            // todas as linhas importadas
    fileName: "",
    metric: "total",
    continents: new Set(),   // vazio = todos
    countries: new Set(),    // vazio = todos
    range: null,             // [min, max] na métrica ativa
    mapScale: "linear",
    rankDir: "top",
    contView: "mix",
    scatterColor: "cont",
    corrPair: ["beer", "total"],
    tblSort: { key: "total", dir: "desc" },
    tblQuery: ""
  };

  /* preenchido pela secao 21; renderAll() o aciona a cada mudanca de filtro */
  let escopoIA = () => {};

  const $ = (id) => document.getElementById(id);
  const el = {};
  ["gate", "gateErr", "drop", "file", "shell", "dsChip", "dsName", "dsMeta",
   "btnReimport", "btnExport", "btnReset", "segMetric", "chipsCont", "pickCountry",
   "pickBtn", "pickLbl", "pickSearch", "pickList", "pickAll", "pickNone",
   "rangeMin", "rangeMax", "rangeFill", "rangeOut", "rangeLbl", "kpis", "map",
   "mapLegend", "mapSub", "mapScale", "insights", "corrGrid", "corrBar", "corrByCont",
   "scatter", "scatterMeta", "scatterSub", "scatterColor", "rank", "rankSub", "rankDir",
   "contChart", "contSub", "contView", "tbl", "tblSub", "tblSearch", "tip", "toast",
   "toastMsg", "footMeta"].forEach((k) => { el[k] = $(k); });

  /* ================================================== 5. seleção derivada */

  function activeContinents() {
    return state.continents.size ? state.continents : new Set(presentContinents());
  }
  function presentContinents() {
    const set = new Set(state.raw.map((d) => d.continent));
    return CONTINENTS.filter((c) => set.has(c)).concat(set.has("Outros") ? ["Outros"] : []);
  }
  /* linhas após continente + país (sem o filtro de faixa) — base do slider */
  function preRange() {
    const conts = activeContinents();
    return state.raw.filter((d) =>
      conts.has(d.continent) &&
      (!state.countries.size || state.countries.has(d.country)));
  }
  function filtered() {
    const m = state.metric, r = state.range;
    return preRange().filter((d) => !r || (d[m] >= r[0] - 1e-9 && d[m] <= r[1] + 1e-9));
  }

  /* ================================================= 6. importação de dados */

  function showError(msg) {
    el.gateErr.textContent = msg;
    el.gateErr.classList.remove("u-hidden");
  }
  let toastT;
  function toast(msg, isErr) {
    el.toastMsg.textContent = msg;
    el.toast.classList.toggle("toast--err", !!isErr);
    el.toast.classList.add("is-on");
    clearTimeout(toastT);
    toastT = setTimeout(() => el.toast.classList.remove("is-on"), 3400);
  }

  function loadText(text, fileName) {
    let res;
    try {
      res = ingest(text, fileName);
    } catch (e) {
      showError(e.message);
      if (!el.gate.classList.contains("is-gone")) return;
      toast(e.message, true);
      return;
    }
    el.gateErr.classList.add("u-hidden");

    state.raw = res.data;
    state.fileName = fileName || "planilha.csv";
    state.continents.clear();
    state.countries.clear();
    state.range = null;

    el.dsName.textContent = state.fileName;
    el.dsMeta.textContent = "· " + res.data.length + " países";
    el.dsChip.hidden = false;
    el.btnReimport.hidden = false;
    el.btnExport.hidden = false;
    el.shell.hidden = false;
    if (TEM_BACKEND) $("fabAI").hidden = false;
    el.gate.classList.add("is-gone");

    const semGeo = res.data.filter((d) => !atlasKey(d.country)).length;
    el.footMeta.textContent =
      res.data.length + " registros · " + presentContinents().length + " continentes · " +
      semGeo + " territórios sem geometria no atlas 1:110m" +
      (res.discarded.length ? " · " + res.discarded.length + " linhas descartadas" : "");

    buildControls();
    revealCards();
    renderAll();
    toast("Planilha carregada: " + res.data.length + " países" +
      (res.discarded.length ? " (" + res.discarded.length + " linhas incompletas descartadas)" : ""));
  }

  function readFile(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => loadText(String(fr.result), file.name);
    fr.onerror = () => showError("Não foi possível ler o arquivo.");
    fr.readAsText(file, "utf-8");
  }

  /* --- eventos de importação --- */
  el.file.addEventListener("change", (e) => readFile(e.target.files[0]));
  el.drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.file.click(); }
  });
  ["dragenter", "dragover"].forEach((ev) =>
    el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.remove("is-over"); }));
  el.drop.addEventListener("drop", (e) => readFile(e.dataTransfer.files[0]));
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });
  window.addEventListener("paste", (e) => {
    const t = (e.clipboardData || window.clipboardData).getData("text");
    if (t && t.split("\n").length > 2) loadText(t, "colado.csv");
  });
  el.btnReimport.addEventListener("click", () => el.file.click());

  /* =========================================== 7. construção dos controles */

  function buildControls() {
    /* métricas */
    el.segMetric.innerHTML = "";
    METRICS.forEach((m) => {
      const b = document.createElement("button");
      b.className = "seg__btn";
      b.setAttribute("aria-pressed", state.metric === m.key);
      b.innerHTML = '<i class="seg__swatch" style="background:' + m.color + '"></i>' + m.label;
      b.onclick = () => {
        state.metric = m.key;
        state.range = null;
        [...el.segMetric.children].forEach((c, i) =>
          c.setAttribute("aria-pressed", METRICS[i].key === m.key));
        syncRange(true);
        renderAll();
      };
      el.segMetric.appendChild(b);
    });

    /* continentes */
    el.chipsCont.innerHTML = "";
    presentContinents().forEach((c) => {
      const n = state.raw.filter((d) => d.continent === c).length;
      const b = document.createElement("button");
      b.className = "chip";
      b.setAttribute("aria-pressed", "false");
      b.innerHTML = (CONT_PT[c] || c) + '<span class="chip__n">' + n + "</span>";
      b.onclick = () => {
        state.continents.has(c) ? state.continents.delete(c) : state.continents.add(c);
        b.setAttribute("aria-pressed", state.continents.has(c));
        /* países fora do escopo saem da seleção explícita */
        const conts = activeContinents();
        [...state.countries].forEach((k) => {
          const rec = state.raw.find((d) => d.country === k);
          if (rec && !conts.has(rec.continent)) state.countries.delete(k);
        });
        buildPicker(); syncRange(true); renderAll();
      };
      el.chipsCont.appendChild(b);
    });

    buildPicker();
    syncRange(true);
  }

  function buildPicker() {
    const q = norm(el.pickSearch.value);
    const conts = activeContinents();
    const list = state.raw
      .filter((d) => conts.has(d.continent))
      .filter((d) => !q || norm(d.country).includes(q))
      .sort((a, b) => a.country.localeCompare(b.country, "pt-BR"));

    el.pickList.innerHTML = "";
    list.forEach((d) => {
      const row = document.createElement("label");
      row.className = "picker__row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.countries.has(d.country);
      cb.onchange = () => {
        cb.checked ? state.countries.add(d.country) : state.countries.delete(d.country);
        syncPickLabel(); syncRange(true); renderAll();
      };
      const nm = document.createElement("span");
      nm.textContent = d.country;
      const cn = document.createElement("span");
      cn.textContent = CONT_PT[d.continent] || d.continent;
      row.append(cb, nm, cn);
      el.pickList.appendChild(row);
    });
    if (!list.length) {
      el.pickList.innerHTML = '<div class="empty" style="min-height:60px">Nenhum país encontrado</div>';
    }
    syncPickLabel();
  }

  function syncPickLabel() {
    const n = state.countries.size;
    el.pickLbl.textContent = n === 0 ? "Todos os países"
      : n === 1 ? [...state.countries][0]
      : n + " países selecionados";
  }

  el.pickBtn.onclick = () => {
    const open = el.pickCountry.classList.toggle("is-open");
    el.pickBtn.setAttribute("aria-expanded", open);
    if (open) el.pickSearch.focus();
  };
  el.pickSearch.oninput = buildPicker;
  el.pickAll.onclick = () => {
    const conts = activeContinents();
    state.raw.filter((d) => conts.has(d.continent)).forEach((d) => state.countries.add(d.country));
    buildPicker(); syncRange(true); renderAll();
  };
  el.pickNone.onclick = () => {
    state.countries.clear(); buildPicker(); syncRange(true); renderAll();
  };
  document.addEventListener("click", (e) => {
    if (!el.pickCountry.contains(e.target)) {
      el.pickCountry.classList.remove("is-open");
      el.pickBtn.setAttribute("aria-expanded", "false");
    }
  });

  /* --- faixa de consumo (slider duplo) --- */
  function metricDomain() {
    const rows = preRange();
    const m = state.metric;
    if (!rows.length) return [0, 1];
    const vals = rows.map((d) => d[m]);
    const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    return [lo, hi === lo ? lo + (M[m].step || 1) : hi];
  }

  function syncRange(resetToFull) {
    const m = M[state.metric];
    const [lo, hi] = metricDomain();
    const step = m.step;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    [el.rangeMin, el.rangeMax].forEach((r) => { r.min = a; r.max = b; r.step = step; });
    if (resetToFull || !state.range) state.range = [a, b];
    state.range = [Math.max(a, state.range[0]), Math.min(b, state.range[1])];
    el.rangeMin.value = state.range[0];
    el.rangeMax.value = state.range[1];
    el.rangeLbl.textContent = m.label;
    paintRange();
  }

  function paintRange() {
    const a = +el.rangeMin.min, b = +el.rangeMin.max;
    const lo = +el.rangeMin.value, hi = +el.rangeMax.value;
    const p = (v) => b === a ? 0 : ((v - a) / (b - a)) * 100;
    el.rangeFill.style.left = p(lo) + "%";
    el.rangeFill.style.width = Math.max(0, p(hi) - p(lo)) + "%";
    el.rangeOut.textContent = fmtM(lo, M[state.metric]) + " – " + fmtM(hi, M[state.metric]);
  }

  function onRange() {
    let lo = +el.rangeMin.value, hi = +el.rangeMax.value;
    if (lo > hi) { const t = lo; lo = hi; hi = t; el.rangeMin.value = lo; el.rangeMax.value = hi; }
    state.range = [lo, hi];
    paintRange();
    renderAll();
  }
  el.rangeMin.addEventListener("input", onRange);
  el.rangeMax.addEventListener("input", onRange);

  el.btnReset.onclick = () => {
    state.continents.clear();
    state.countries.clear();
    state.tblQuery = ""; el.tblSearch.value = "";
    [...el.chipsCont.children].forEach((c) => c.setAttribute("aria-pressed", "false"));
    buildPicker(); syncRange(true); renderAll();
    toast("Filtros limpos");
  };

  /* mini-segmentos genéricos */
  function bindMiniSeg(node, attr, apply) {
    node.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      [...node.children].forEach((c) => c.setAttribute("aria-pressed", c === b));
      apply(b.dataset[attr]);
    });
  }
  bindMiniSeg(el.mapScale, "scale", (v) => { state.mapScale = v; renderMap(); });
  bindMiniSeg(el.rankDir, "dir", (v) => { state.rankDir = v; renderRank(); });
  bindMiniSeg(el.contView, "view", (v) => { state.contView = v; renderContinents(); });
  bindMiniSeg(el.scatterColor, "mode", (v) => { state.scatterColor = v; renderScatter(); });
  el.tblSearch.oninput = () => { state.tblQuery = el.tblSearch.value; renderTable(); };

  /* ============================================================ 8. tooltip */

  function tipShow(html, ev) {
    el.tip.innerHTML = html;
    el.tip.classList.add("is-on");
    tipMove(ev);
  }
  function tipMove(ev) {
    const pad = 16, r = el.tip.getBoundingClientRect();
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
    el.tip.style.left = Math.max(8, x) + "px";
    el.tip.style.top = Math.max(8, y) + "px";
  }
  const tipHide = () => el.tip.classList.remove("is-on");

  function countryTip(d) {
    const m = M[state.metric];
    let h = '<div class="tip__cont">' + (CONT_PT[d.continent] || d.continent) + "</div>";
    h += '<div class="tip__t">' + d.country + "</div>";
    h += '<div class="tip__r"><span>Álcool puro</span><b>' + fmt(d.total, 2) + " L</b></div>";
    TYPES.forEach((t) => {
      h += '<div class="tip__r"><span>' + M[t].label + "</span><b>" + fmt(d[t], 0) +
           " <small style=\"opacity:.6\">(" + fmt(d[t + "Share"] * 100, 0) + "%)</small></b></div>";
    });
    if (state.metric !== "total") {
      h += '<div class="tip__r" style="border-top:1px solid rgba(255,255,255,.14);margin-top:5px;padding-top:5px">' +
           "<span>" + m.label + "</span><b>" + fmtM(d[state.metric], m) + " " + m.short + "</b></div>";
    }
    return h;
  }

  /* ================================================= 9. mapa (coroplético) */

  /* regiões polares sem população relevante ficam fora do enquadramento */
  const SKIP_FEATURES = new Set(["Antarctica", "Fr. S. Antarctic Lands"]);
  const world = topojson.feature(window.NITRO_WORLD_TOPO,
    window.NITRO_WORLD_TOPO.objects.countries);
  world.features = world.features.filter((f) => !SKIP_FEATURES.has(f.properties.name));
  const worldMesh = topojson.mesh(window.NITRO_WORLD_TOPO,
    window.NITRO_WORLD_TOPO.objects.countries, (a, b) => a !== b);
  const ALIAS = window.NITRO_GEO.atlasAlias;
  const MICRO = window.NITRO_GEO.microStates;

  /* índice: nome no atlas (normalizado) -> feature */
  const atlasIndex = new Map();
  world.features.forEach((f) => atlasIndex.set(norm(f.properties.name), f));

  function atlasKey(country) {
    const c = canonical(country);
    const k = norm(ALIAS[c] || c);
    return atlasIndex.has(k) ? k : null;
  }

  function colorScale(rows) {
    const m = state.metric;
    const vals = rows.map((d) => d[m]).filter(isFinite);
    const ramp = d3.interpolateRgbBasis(["#eef5f9", "#b7d5e5", "#6aa8c8", "#2c7cab", "#0e5c88", "#072f46"]);
    if (!vals.length) return { fn: () => "#f0f4f5", ticks: [], ramp };
    if (state.mapScale === "quantile") {
      const sc = d3.scaleQuantile().domain(vals).range(d3.range(7).map((i) => ramp(i / 6)));
      return { fn: sc, ticks: [S.min(vals)].concat(sc.quantiles()).concat([S.max(vals)]), ramp, sc };
    }
    const sc = d3.scaleSequential(ramp).domain([S.min(vals), S.max(vals)]);
    return { fn: sc, ticks: sc.ticks ? [] : [], ramp, sc, domain: sc.domain() };
  }

  function renderMap() {
    const rows = filtered();
    const box = el.map;
    const W = Math.max(320, box.clientWidth || 900);
    const H = Math.round(W * 0.50);
    const byCountry = new Map(rows.map((d) => [atlasKey(d.country), d]));
    const byName = new Map(rows.map((d) => [d.country, d]));
    const cs = colorScale(rows);
    const m = M[state.metric];

    const proj = d3.geoNaturalEarth1()
      .fitExtent([[8, 8], [W - 8, H - 8]], { type: "FeatureCollection", features: world.features });
    const path = d3.geoPath(proj);

    let svg = d3.select(box).select("svg");
    if (svg.empty()) {
      svg = d3.select(box).append("svg");
      svg.append("g").attr("class", "gCountries");
      svg.append("path").attr("class", "map-mesh")
        .attr("fill", "none").attr("stroke", "#ffffff").attr("stroke-width", 0.4);
      svg.append("g").attr("class", "gDots");
    }
    svg.attr("viewBox", "0 0 " + W + " " + H)
       .attr("preserveAspectRatio", "xMidYMid meet")
       .style("height", H + "px");
    svg.select(".map-mesh").attr("d", path(worldMesh));

    const fillOf = (d) => d ? cs.fn(d[state.metric]) : "#f2f6f7";

    const sel = svg.select(".gCountries").selectAll("path.map-country")
      .data(world.features, (f) => f.properties.name);
    const enter = sel.enter().append("path")
      .attr("class", "map-country")
      .attr("fill", "#f2f6f7");
    enter.merge(sel)
      .attr("d", path)
      .classed("is-sel", (f) => {
        const d = byCountry.get(norm(f.properties.name));
        return !!d && state.countries.has(d.country);
      })
      .on("mousemove", function (ev, f) {
        const d = byCountry.get(norm(f.properties.name));
        tipShow(d ? countryTip(d)
          : '<div class="tip__t">' + f.properties.name + "</div>" +
            '<div class="tip__r"><span>Fora do recorte ativo</span></div>', ev);
      })
      .on("mouseleave", tipHide)
      .on("click", (ev, f) => {
        const d = byCountry.get(norm(f.properties.name));
        if (d) toggleCountry(d.country);
      })
      /* a animação da cor fica a cargo do CSS (.map-country { transition: fill }),
         que continua funcionando mesmo com a aba em segundo plano */
      .attr("fill", (f) => fillOf(byCountry.get(norm(f.properties.name))));

    /* micro-estados sem geometria no atlas 1:110m: marcados como pontos */
    const microRows = rows.filter((d) => !atlasKey(d.country) && MICRO[d.country]);
    const dots = svg.select(".gDots").selectAll("circle.map-dot")
      .data(microRows, (d) => d.country);
    dots.exit().remove();
    dots.enter().append("circle")
      .attr("class", "map-dot")
      .attr("r", 0)
      .on("mousemove", (ev, d) => tipShow(countryTip(d), ev))
      .on("mouseleave", tipHide)
      .on("click", (ev, d) => toggleCountry(d.country))
      .merge(dots)
      .attr("cx", (d) => proj(MICRO[d.country])[0])
      .attr("cy", (d) => proj(MICRO[d.country])[1])
      .attr("fill", (d) => cs.fn(d[state.metric]))
      .attr("r", 3.1);

    el.mapSub.textContent = m.label + " (" + m.unit + ") · " + rows.length +
      " países no recorte · escala " + (state.mapScale === "linear" ? "linear" : "por quantis");

    renderLegend(cs, rows);
  }

  function renderLegend(cs, rows) {
    const m = M[state.metric];
    const vals = rows.map((d) => d[state.metric]).filter(isFinite);
    const lo = vals.length ? S.min(vals) : 0, hi = vals.length ? S.max(vals) : 0;
    const stops = d3.range(0, 1.001, 0.05).map((t) => cs.ramp(t) + " " + (t * 100) + "%").join(",");
    el.mapLegend.innerHTML =
      '<div class="legend__scale">' +
        '<span class="legend__t u-num">' + fmtM(lo, m) + "</span>" +
        '<div class="legend__bar" style="background:linear-gradient(90deg,' + stops + ')"></div>' +
        '<span class="legend__t u-num">' + fmtM(hi, m) + "</span>" +
        '<span class="legend__t" style="margin-left:6px">' + m.unit + "</span>" +
      "</div>" +
      '<div class="legend__scale" style="margin-left:18px">' +
        '<svg width="11" height="11"><circle cx="5.5" cy="5.5" r="3.2" fill="#0e5c88"/></svg>' +
        '<span class="legend__t">micro-estados (ponto)</span>' +
      "</div>" +
      '<div class="legend__note">clique num país para incluí-lo no filtro · ' +
        '<span style="color:var(--faint)">cinza = fora do recorte</span></div>';
  }

  function toggleCountry(name) {
    state.countries.has(name) ? state.countries.delete(name) : state.countries.add(name);
    buildPicker(); syncRange(false); renderAll();
    toast(state.countries.size
      ? state.countries.size + " país(es) no filtro — use “Limpar filtros” para voltar"
      : "Filtro de países limpo");
  }

  /* ================================================================ 10. KPIs */

  const KPI_DEFS = [
    { k: "n",      lbl: "Países no recorte", hero: true },
    { k: "sum",    lbl: "Soma" },
    { k: "mean",   lbl: "Média" },
    { k: "median", lbl: "Mediana" },
    { k: "min",    lbl: "Mínimo" },
    { k: "max",    lbl: "Máximo" },
    { k: "std",    lbl: "Desvio-padrão" }
  ];

  function renderKPIs() {
    const rows = filtered();
    const m = M[state.metric];
    const st = describe(rows.map((d) => d[state.metric]));
    const cv = st.mean ? st.std / st.mean : NaN;

    const foots = {
      n: rows.length + " de " + state.raw.length + " na base",
      sum: "acumulado do recorte",
      mean: "aritmética simples",
      median: st.mean ? (st.median < st.mean ? "assimetria à direita" : "assimetria à esquerda") : "",
      min: minmaxLabel(rows, "min"),
      max: minmaxLabel(rows, "max"),
      std: "CV " + fmt(cv * 100, 1) + "%"
    };

    if (!el.kpis.children.length) {
      el.kpis.innerHTML = KPI_DEFS.map((d) =>
        '<div class="kpi' + (d.hero ? " kpi--hero" : "") + '">' +
          '<div class="kpi__label">' + d.lbl + "</div>" +
          '<div class="kpi__val u-num" data-k="' + d.k + '">0</div>' +
          '<div class="kpi__foot" data-f="' + d.k + '"></div>' +
        "</div>").join("");
    }
    KPI_DEFS.forEach((d) => {
      const node = el.kpis.querySelector('[data-k="' + d.k + '"]');
      const val = d.k === "n" ? rows.length : st[d.k];
      /* mínimo/máximo mantêm a precisão nativa da métrica; médias ganham 1 casa */
      const dec = d.k === "n" ? 0
        : d.k === "sum" ? Math.min(m.dec, 1)
        : (d.k === "min" || d.k === "max") ? m.dec
        : (m.dec || 1);
      const unit = d.k === "n" ? "" : m.short;
      animateNumber(node, val, dec, unit);
      el.kpis.querySelector('[data-f="' + d.k + '"]').textContent = foots[d.k] || "";
    });

    /* rótulos contextuais: a métrica escolhida aparece no cabeçalho do bloco */
    KPI_DEFS.forEach((d, i) => {
      if (d.k === "n") return;
      el.kpis.children[i].querySelector(".kpi__label").textContent = d.lbl + " · " + m.label;
    });
  }

  function minmaxLabel(rows, which) {
    if (!rows.length) return "";
    const m = state.metric;
    const r = rows.reduce((a, b) => (which === "min"
      ? (a[m] <= b[m] ? a : b) : (a[m] >= b[m] ? a : b)));
    return r.country;
  }

  function animateNumber(node, target, dec, unit) {
    const from = parseFloat(node.dataset.v || "0") || 0;
    const to = isFinite(target) ? target : 0;
    node.dataset.v = to;
    const t0 = performance.now(), dur = 620;
    const suffix = unit ? ' <span class="kpi__unit">' + unit + "</span>" : "";
    if (!isFinite(target)) { node.innerHTML = "—"; return; }
    /* aba oculta ou preferência por menos movimento: escreve o valor final direto
       (requestAnimationFrame fica suspenso em abas em segundo plano) */
    const still = document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.innerHTML = fmt(to, dec) + suffix;
    if (still) return;
    function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      node.innerHTML = fmt(from + (to - from) * e, dec) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ========================================================= 11. correlação */

  function corrMatrix(rows) {
    const cols = Object.fromEntries(ALLKEYS.map((k) => [k, rows.map((d) => d[k])]));
    const m = {};
    ALLKEYS.forEach((a) => {
      m[a] = {};
      ALLKEYS.forEach((b) => { m[a][b] = a === b ? 1 : S.pearson(cols[a], cols[b]); });
    });
    return m;
  }

  const corrRamp = d3.interpolateRgbBasis(
    ["#b06a4e", "#dcae97", "#f1f0ec", "#b7d5e5", "#56a8c3", "#0e5c88"]);
  const corrColor = (r) => isFinite(r) ? corrRamp((r + 1) / 2) : "#f1f0ec";
  const corrText = (r) => (isFinite(r) && Math.abs(r) > 0.55) ? "#fff" : "#0b1f2a";

  function renderCorr() {
    const rows = filtered();
    const mat = corrMatrix(rows);

    el.corrBar.style.background = "linear-gradient(90deg," +
      d3.range(0, 1.001, 0.05).map((t) => corrRamp(t) + " " + t * 100 + "%").join(",") + ")";

    let h = '<div class="corr-h"></div>';
    ALLKEYS.forEach((k) => { h += '<div class="corr-h">' + M[k].label + "</div>"; });
    ALLKEYS.forEach((a) => {
      h += '<div class="corr-h corr-h--row">' + M[a].label + "</div>";
      ALLKEYS.forEach((b) => {
        const r = mat[a][b];
        const isSel = (state.corrPair[0] === a && state.corrPair[1] === b) ||
                      (state.corrPair[0] === b && state.corrPair[1] === a);
        h += '<div class="corr-c' + (isSel ? " is-sel" : "") + '" data-a="' + a + '" data-b="' + b +
             '" style="background:' + corrColor(r) + ";color:" + corrText(r) + '">' +
             (a === b ? "1,00" : fmt(r, 2)) + "</div>";
      });
    });
    el.corrGrid.innerHTML = h;

    el.corrGrid.querySelectorAll(".corr-c").forEach((c) => {
      c.addEventListener("mousemove", (ev) => {
        const a = c.dataset.a, b = c.dataset.b, r = mat[a][b];
        tipShow('<div class="tip__t">' + M[a].label + " × " + M[b].label + "</div>" +
          '<div class="tip__r"><span>r de Pearson</span><b>' + fmt(r, 3) + "</b></div>" +
          '<div class="tip__r"><span>r² (variância explicada)</span><b>' + fmt(r * r * 100, 1) + "%</b></div>" +
          '<div class="tip__r"><span>n</span><b>' + rows.length + "</b></div>" +
          (a === b ? "" : '<div class="tip__r" style="margin-top:5px"><span>' +
            interpretR(r) + "</span></div>"), ev);
      });
      c.addEventListener("mouseleave", tipHide);
      c.onclick = () => {
        if (c.dataset.a === c.dataset.b) return;
        state.corrPair = [c.dataset.a, c.dataset.b];
        renderCorr(); renderScatter();
      };
    });

    /* correlação de cada tipo com o total, dentro de cada continente */
    const conts = presentContinents().filter((c) => activeContinents().has(c));
    let hb = "";
    conts.forEach((c) => {
      const sub = rows.filter((d) => d.continent === c);
      hb += '<div style="display:flex;align-items:center;gap:9px;padding:5px 0;font-size:11.5px">' +
            '<span style="width:8px;height:8px;border-radius:2px;flex:none;background:' +
              (CONT_COLOR[c] || "#8fa1ab") + '"></span>' +
            '<span style="width:70px;color:var(--muted)">' + (CONT_PT[c] || c) + "</span>";
      TYPES.forEach((t) => {
        const r = sub.length > 3 ? S.pearson(sub.map((d) => d[t]), sub.map((d) => d.total)) : NaN;
        hb += '<span title="' + M[t].label + ' × álcool puro (n=' + sub.length + ')" ' +
              'style="flex:1;text-align:center;padding:2px 0;border-radius:4px;font-weight:600;' +
              "background:" + corrColor(r) + ";color:" + corrText(r) + '">' + fmt(r, 2) + "</span>";
      });
      hb += "</div>";
    });
    hb = '<div style="display:flex;gap:9px;padding-bottom:4px;font-size:9.5px;letter-spacing:.1em;' +
         'text-transform:uppercase;color:var(--faint)">' +
         '<span style="width:8px;flex:none"></span><span style="width:70px"></span>' +
         TYPES.map((t) => '<span style="flex:1;text-align:center">' + M[t].label + "</span>").join("") +
         "</div>" + hb;
    el.corrByCont.innerHTML = hb || '<div class="empty">Sem dados</div>';
  }

  function interpretR(r) {
    const a = Math.abs(r);
    const f = a < 0.2 ? "desprezível" : a < 0.4 ? "fraca" : a < 0.6 ? "moderada"
            : a < 0.8 ? "forte" : "muito forte";
    return "Associação " + f + (r < 0 ? " e negativa" : " e positiva");
  }

  /* ========================================================== 12. dispersão */

  function renderScatter() {
    const rows = filtered();
    const [ka, kb] = state.corrPair;
    const mx = M[ka], my = M[kb];
    const box = el.scatter;
    const W = Math.max(320, box.clientWidth || 700);
    const H = 340, mg = { t: 12, r: 16, b: 44, l: 58 };

    const x = rows.map((d) => d[ka]), y = rows.map((d) => d[kb]);
    const r = S.pearson(x, y);
    const reg = S.linreg(x, y);
    const p = S.pValue(r, rows.length);

    el.scatterSub.textContent = mx.label + " (eixo X) × " + my.label +
      " (eixo Y) — selecione outro par na matriz de correlação";

    el.scatterMeta.innerHTML = [
      ["r de Pearson", fmt(r, 3), interpretR(r)],
      ["r²", fmt(r * r, 3), fmt(r * r * 100, 1) + "% da variância"],
      ["Inclinação", fmt(reg.slope, 3), my.short + " por " + mx.short],
      ["p-valor", p < 0.001 ? "< 0,001" : fmt(p, 3), "bicaudal (Fisher z)"],
      ["n", String(rows.length), "observações"]
    ].map(([k, v, s]) =>
      '<div class="stat-pill"><div class="stat-pill__k">' + k + "</div>" +
      '<div class="stat-pill__v u-num">' + v + " <small>" + s + "</small></div></div>").join("");

    const sx = d3.scaleLinear().domain(niceDomain(x)).range([mg.l, W - mg.r]);
    const sy = d3.scaleLinear().domain(niceDomain(y)).range([H - mg.b, mg.t]);

    let svg = d3.select(box).select("svg");
    if (svg.empty()) svg = d3.select(box).append("svg");
    svg.attr("viewBox", "0 0 " + W + " " + H).style("height", H + "px");
    svg.selectAll("*").remove();

    /* grades e eixos */
    const gx = svg.append("g").attr("class", "axis").attr("transform", "translate(0," + (H - mg.b) + ")")
      .call(d3.axisBottom(sx).ticks(7).tickFormat((v) => fmt(v, mx.dec ? 1 : 0)));
    const gy = svg.append("g").attr("class", "axis").attr("transform", "translate(" + mg.l + ",0)")
      .call(d3.axisLeft(sy).ticks(6).tickFormat((v) => fmt(v, my.dec ? 1 : 0)));
    gx.selectAll(".domain").attr("stroke", "#dbe5e7");
    gy.selectAll(".domain").remove();
    gy.selectAll(".tick line").attr("class", "gridline").attr("x2", W - mg.l - mg.r);

    svg.append("text").attr("class", "axis-title")
      .attr("x", (W + mg.l) / 2).attr("y", H - 6).attr("text-anchor", "middle")
      .text(mx.label + " · " + mx.unit);
    svg.append("text").attr("class", "axis-title")
      .attr("transform", "rotate(-90)").attr("x", -(H - mg.b + mg.t) / 2).attr("y", 13)
      .attr("text-anchor", "middle").text(my.label + " · " + my.unit);

    /* reta de regressão */
    if (isFinite(reg.slope) && rows.length > 2) {
      const dx = sx.domain();
      svg.append("line").attr("class", "reg-line")
        .attr("x1", sx(dx[0])).attr("y1", sy(reg.intercept + reg.slope * dx[0]))
        .attr("x2", sx(dx[0])).attr("y2", sy(reg.intercept + reg.slope * dx[0]))
        .transition().duration(700).ease(d3.easeCubicOut)
        .attr("x2", sx(dx[1])).attr("y2", sy(reg.intercept + reg.slope * dx[1]));
    }

    /* pontos */
    const colorOf = (d) => state.scatterColor === "cont"
      ? (CONT_COLOR[d.continent] || "#8fa1ab") : "#0e5c88";
    svg.append("g").selectAll("circle").data(rows).join("circle")
      .attr("class", "dot")
      .attr("cx", (d) => sx(d[ka])).attr("cy", (d) => sy(d[kb]))
      .attr("fill", colorOf).attr("fill-opacity", 0.62)
      .attr("stroke", "#fff").attr("stroke-width", 0.7)
      .attr("r", 0)
      .on("mousemove", (ev, d) => tipShow(countryTip(d), ev))
      .on("mouseleave", tipHide)
      .on("click", (ev, d) => toggleCountry(d.country))
      .transition().delay((d, i) => Math.min(i * 3, 320)).duration(420)
      .attr("r", 4.4);

    /* legenda de continentes */
    if (state.scatterColor === "cont") {
      const conts = presentContinents().filter((c) => rows.some((d) => d.continent === c));
      const g = svg.append("g").attr("transform", "translate(" + (mg.l + 10) + "," + (mg.t + 6) + ")");
      /* a legenda quebra em linhas conforme a largura disponível do gráfico */
      const itemW = 92, perRow = Math.max(1, Math.floor((W - mg.l - mg.r - 10) / itemW));
      conts.forEach((c, i) => {
        const row = g.append("g").attr("transform",
          "translate(" + ((i % perRow) * itemW) + "," + (Math.floor(i / perRow) * 15) + ")");
        row.append("circle").attr("r", 4).attr("cy", -3).attr("fill", CONT_COLOR[c] || "#8fa1ab");
        row.append("text").attr("x", 9).attr("font-size", 10).attr("fill", "#5a6b75")
          .text(CONT_PT[c] || c);
      });
    }
  }

  function niceDomain(vals) {
    if (!vals.length) return [0, 1];
    const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    const pad = (hi - lo) * 0.06 || 1;
    return [Math.max(0, lo - pad), hi + pad];
  }

  /* ============================================================ 13. ranking */

  function renderRank() {
    const rows = filtered().slice();
    const m = M[state.metric];
    rows.sort((a, b) => b[state.metric] - a[state.metric]);
    const top = state.rankDir === "top" ? rows.slice(0, 15) : rows.slice(-15).reverse();

    el.rankSub.textContent = (state.rankDir === "top" ? "15 maiores" : "15 menores") +
      " em " + m.label + " · " + m.unit + " — cor da barra indica o continente";

    const box = el.rank;
    const W = Math.max(300, box.clientWidth || 480);
    /* margens acompanham a largura para não espremer as barras em telas estreitas */
    const rowH = 22, mg = { t: 6, b: 6, l: Math.min(128, Math.round(W * 0.3)),
                            r: Math.min(58, Math.round(W * 0.14)) };
    const H = mg.t + mg.b + top.length * rowH;

    let svg = d3.select(box).select("svg");
    if (svg.empty()) svg = d3.select(box).append("svg");
    svg.attr("viewBox", "0 0 " + W + " " + H).style("height", H + "px");
    svg.selectAll("*").remove();
    if (!top.length) { box.innerHTML = '<div class="empty">Sem países no recorte</div>'; return; }

    const maxV = Math.max.apply(null, top.map((d) => d[state.metric])) || 1;
    const sx = d3.scaleLinear().domain([0, maxV]).range([mg.l, W - mg.r]);

    const g = svg.selectAll("g.row").data(top).join("g")
      .attr("class", "row")
      .attr("transform", (d, i) => "translate(0," + (mg.t + i * rowH) + ")")
      .style("cursor", "pointer")
      .on("mousemove", (ev, d) => tipShow(countryTip(d), ev))
      .on("mouseleave", tipHide)
      .on("click", (ev, d) => toggleCountry(d.country));

    g.append("text").attr("class", "bar-lbl").attr("x", mg.l - 9).attr("y", 13)
      .attr("text-anchor", "end")
      .text((d) => {
        const cap = Math.max(8, Math.floor(mg.l / 6.2));
        return d.country.length > cap ? d.country.slice(0, cap - 1) + "…" : d.country;
      });

    g.append("rect").attr("x", mg.l).attr("y", 4).attr("height", 13).attr("rx", 2)
      .attr("class", "bar")
      .attr("fill", (d) => CONT_COLOR[d.continent] || "#8fa1ab")
      .attr("width", 0)
      .transition().duration(620).delay((d, i) => i * 22).ease(d3.easeCubicOut)
      .attr("width", (d) => Math.max(1, sx(d[state.metric]) - mg.l));

    g.append("text").attr("class", "bar-val u-num").attr("y", 14)
      .attr("x", mg.l).attr("opacity", 0)
      .text((d) => fmtM(d[state.metric], m))
      .transition().duration(620).delay((d, i) => i * 22)
      .attr("x", (d) => Math.max(mg.l + 4, sx(d[state.metric]) + 6)).attr("opacity", 1);
  }

  /* ======================================================= 14. continentes */

  function renderContinents() {
    const rows = filtered();
    const conts = presentContinents().filter((c) => rows.some((d) => d.continent === c));
    const box = el.contChart;
    const W = Math.max(320, box.clientWidth || 640);

    let svg = d3.select(box).select("svg");
    if (svg.empty()) svg = d3.select(box).append("svg");
    svg.selectAll("*").remove();
    if (!conts.length) { box.innerHTML = '<div class="empty">Sem países no recorte</div>'; return; }

    if (state.contView === "mix") { drawMix(svg, conts, rows, W); }
    else { drawBox(svg, conts, rows, W); }
  }

  function drawMix(svg, conts, rows, W) {
    const rowH = 42, mg = { t: 26, b: 8, l: Math.min(96, Math.round(W * 0.24)),
                            r: Math.min(82, Math.round(W * 0.2)) };
    const H = mg.t + mg.b + conts.length * rowH;
    svg.attr("viewBox", "0 0 " + W + " " + H).style("height", H + "px");

    el.contSub.textContent = "Mix médio de doses por habitante/ano em cada continente (cerveja, destilados, vinho)";

    const agg = conts.map((c) => {
      const sub = rows.filter((d) => d.continent === c);
      const o = { cont: c, n: sub.length, total: S.mean(sub.map((d) => d.total)) };
      TYPES.forEach((t) => { o[t] = S.mean(sub.map((d) => d[t])); });
      o.sum = TYPES.reduce((s, t) => s + o[t], 0);
      return o;
    }).sort((a, b) => b.sum - a.sum);

    const maxSum = Math.max.apply(null, agg.map((d) => d.sum)) || 1;
    const sx = d3.scaleLinear().domain([0, maxSum]).range([mg.l, W - mg.r]);

    /* legenda */
    const lg = svg.append("g").attr("transform", "translate(" + mg.l + ",12)");
    TYPES.forEach((t, i) => {
      const g = lg.append("g").attr("transform", "translate(" + (i * 104) + ",0)");
      g.append("rect").attr("width", 9).attr("height", 9).attr("rx", 2).attr("y", -8)
        .attr("fill", M[t].color);
      g.append("text").attr("x", 14).attr("font-size", 10).attr("fill", "#5a6b75").text(M[t].label);
    });

    const g = svg.selectAll("g.crow").data(agg).join("g")
      .attr("class", "crow")
      .attr("transform", (d, i) => "translate(0," + (mg.t + i * rowH) + ")");

    g.append("text").attr("class", "bar-lbl").attr("x", mg.l - 10).attr("y", 15)
      .attr("text-anchor", "end").attr("font-weight", 500).attr("fill", "#0b1f2a")
      .text((d) => CONT_PT[d.cont] || d.cont);
    g.append("text").attr("class", "bar-lbl").attr("x", mg.l - 10).attr("y", 28)
      .attr("text-anchor", "end").attr("font-size", 9.5)
      .text((d) => d.n + " países · " + fmt(d.total, 1) + " L puro");

    g.each(function (d) {
      let acc = 0;
      const node = d3.select(this);
      TYPES.forEach((t) => {
        const x0 = sx(acc), x1 = sx(acc + d[t]);
        node.append("rect")
          .attr("x", x0).attr("y", 6).attr("height", 19).attr("width", 0)
          .attr("fill", M[t].color).attr("class", "bar")
          .on("mousemove", (ev) => tipShow(
            '<div class="tip__cont">' + (CONT_PT[d.cont] || d.cont) + "</div>" +
            '<div class="tip__t">' + M[t].label + "</div>" +
            '<div class="tip__r"><span>Média</span><b>' + fmt(d[t], 1) + " doses/ano</b></div>" +
            '<div class="tip__r"><span>Participação</span><b>' + fmt(d[t] / d.sum * 100, 1) + "%</b></div>" +
            '<div class="tip__r"><span>Países</span><b>' + d.n + "</b></div>", ev))
          .on("mouseleave", tipHide)
          .transition().duration(680).ease(d3.easeCubicOut)
          .attr("width", Math.max(0, x1 - x0));
        acc += d[t];
      });
      node.append("text").attr("class", "bar-val u-num").attr("y", 20)
        .attr("x", sx(acc) + 7).attr("opacity", 0)
        .text(fmt(acc, 0) + " doses")
        .transition().delay(400).duration(400).attr("opacity", 1);
    });
  }

  function drawBox(svg, conts, rows, W) {
    const m = M[state.metric];
    const rowH = 42, mg = { t: 22, r: 24, b: 30, l: Math.min(96, Math.round(W * 0.24)) };
    const H = mg.t + mg.b + conts.length * rowH;
    svg.attr("viewBox", "0 0 " + W + " " + H).style("height", H + "px");

    el.contSub.textContent = "Distribuição de " + m.label +
      " por continente — caixa = quartis 1 a 3, traço = mediana, hastes = mínimo e máximo";

    const agg = conts.map((c) => {
      const v = rows.filter((d) => d.continent === c).map((d) => d[state.metric]);
      return Object.assign({ cont: c }, describe(v));
    }).sort((a, b) => b.median - a.median);

    const hi = Math.max.apply(null, agg.map((d) => d.max)) || 1;
    const sx = d3.scaleLinear().domain([0, hi]).nice().range([mg.l, W - mg.r]);

    const ax = svg.append("g").attr("class", "axis")
      .attr("transform", "translate(0," + (H - mg.b + 6) + ")")
      .call(d3.axisBottom(sx).ticks(6).tickFormat((v) => fmt(v, m.dec ? 1 : 0)));
    ax.selectAll(".domain").attr("stroke", "#dbe5e7");

    const g = svg.selectAll("g.brow").data(agg).join("g")
      .attr("class", "brow")
      .attr("transform", (d, i) => "translate(0," + (mg.t + i * rowH) + ")")
      .on("mousemove", (ev, d) => tipShow(
        '<div class="tip__t">' + (CONT_PT[d.cont] || d.cont) + "</div>" +
        '<div class="tip__r"><span>n</span><b>' + d.n + "</b></div>" +
        '<div class="tip__r"><span>Mínimo</span><b>' + fmtM(d.min, m) + "</b></div>" +
        '<div class="tip__r"><span>Q1</span><b>' + fmtM(d.q1, m) + "</b></div>" +
        '<div class="tip__r"><span>Mediana</span><b>' + fmtM(d.median, m) + "</b></div>" +
        '<div class="tip__r"><span>Média</span><b>' + fmtM(d.mean, m) + "</b></div>" +
        '<div class="tip__r"><span>Q3</span><b>' + fmtM(d.q3, m) + "</b></div>" +
        '<div class="tip__r"><span>Máximo</span><b>' + fmtM(d.max, m) + "</b></div>" +
        '<div class="tip__r"><span>Desvio-padrão</span><b>' + fmtM(d.std, m) + "</b></div>", ev))
      .on("mouseleave", tipHide);

    g.append("text").attr("class", "bar-lbl").attr("x", mg.l - 10).attr("y", 15)
      .attr("text-anchor", "end").attr("font-weight", 500).attr("fill", "#0b1f2a")
      .text((d) => CONT_PT[d.cont] || d.cont);
    g.append("text").attr("class", "bar-lbl").attr("x", mg.l - 10).attr("y", 27)
      .attr("text-anchor", "end").attr("font-size", 9.5)
      .text((d) => "n = " + d.n);

    /* haste mínimo–máximo */
    g.append("line").attr("y1", 15).attr("y2", 15).attr("stroke", "#b7d5e5").attr("stroke-width", 1.4)
      .attr("x1", (d) => sx(d.min)).attr("x2", (d) => sx(d.min))
      .transition().duration(620).attr("x2", (d) => sx(d.max));
    [["min", -5, 5], ["max", -5, 5]].forEach(([k]) => {
      g.append("line").attr("stroke", "#b7d5e5").attr("stroke-width", 1.4)
        .attr("y1", 10).attr("y2", 20)
        .attr("x1", (d) => sx(d[k])).attr("x2", (d) => sx(d[k]));
    });
    /* caixa interquartil */
    g.append("rect").attr("y", 6).attr("height", 18).attr("rx", 2)
      .attr("fill", (d) => CONT_COLOR[d.cont] || "#8fa1ab").attr("fill-opacity", 0.55)
      .attr("stroke", (d) => CONT_COLOR[d.cont] || "#8fa1ab")
      .attr("x", (d) => sx(d.q1)).attr("width", 0)
      .transition().duration(620).ease(d3.easeCubicOut)
      .attr("width", (d) => Math.max(1, sx(d.q3) - sx(d.q1)));
    /* mediana */
    g.append("line").attr("y1", 5).attr("y2", 25).attr("stroke", "#0b1f2a").attr("stroke-width", 2)
      .attr("x1", (d) => sx(d.median)).attr("x2", (d) => sx(d.median));
    /* média */
    g.append("circle").attr("cy", 15).attr("r", 2.6).attr("fill", "#fff")
      .attr("stroke", "#0b1f2a").attr("stroke-width", 1.2)
      .attr("cx", (d) => sx(d.mean));
  }

  /* ============================================================ 15. insights */

  function renderInsights() {
    const rows = filtered();
    const m = M[state.metric];
    const out = [];
    if (rows.length < 2) {
      el.insights.innerHTML = '<div class="empty">Recorte pequeno demais para gerar leituras.</div>';
      return;
    }

    const st = describe(rows.map((d) => d[state.metric]));
    const sorted = rows.slice().sort((a, b) => b[state.metric] - a[state.metric]);
    const top = sorted[0], bot = sorted[sorted.length - 1];
    const cv = st.std / st.mean;

    out.push(["01", "Líder do recorte",
      "<b>" + top.country + "</b> registra <b>" + fmtM(top[state.metric], m) + " " + m.unit +
      "</b> — " + fmt(top[state.metric] / (st.mean || 1), 1) + "× a média do recorte (" +
      fmtM(st.mean, m) + ").", true]);

    /* continente com maior média */
    const contAgg = presentContinents()
      .map((c) => {
        const sub = rows.filter((d) => d.continent === c);
        return { c, n: sub.length, mean: S.mean(sub.map((d) => d[state.metric])) };
      })
      .filter((d) => d.n >= 3).sort((a, b) => b.mean - a.mean);
    if (contAgg.length > 1) {
      const a = contAgg[0], z = contAgg[contAgg.length - 1];
      out.push(["02", "Contraste entre continentes",
        "<b>" + (CONT_PT[a.c] || a.c) + "</b> lidera com média de <b>" + fmtM(a.mean, m) +
        "</b>, contra <b>" + fmtM(z.mean, m) + "</b> em " + (CONT_PT[z.c] || z.c) +
        " — razão de " + fmt(a.mean / (z.mean || 1), 1) + "×."]);
    }

    /* mix dominante */
    const domCount = {};
    rows.forEach((d) => { if (d.dominant) domCount[d.dominant] = (domCount[d.dominant] || 0) + 1; });
    const domTop = Object.keys(domCount).sort((a, b) => domCount[b] - domCount[a])[0];
    if (domTop) {
      out.push(["03", "Bebida dominante",
        "<b>" + M[domTop].label + "</b> é o tipo de maior consumo em <b>" + domCount[domTop] +
        "</b> dos " + rows.length + " países (" + fmt(domCount[domTop] / rows.length * 100, 0) + "%). " +
        Object.keys(domCount).filter((k) => k !== domTop)
          .map((k) => M[k].label + ": " + domCount[k]).join(" · ") + ".", true]);
    }

    /* correlação mais forte entre tipo e total */
    const corr = TYPES.map((t) => ({
      t, r: S.pearson(rows.map((d) => d[t]), rows.map((d) => d.total))
    })).filter((d) => isFinite(d.r)).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    if (corr.length) {
      const c0 = corr[0], cN = corr[corr.length - 1];
      out.push(["04", "Tipo que mais explica o total",
        "<b>" + M[c0.t].label + "</b> tem r = <b>" + fmt(c0.r, 2) + "</b> com o álcool puro (r² = " +
        fmt(c0.r * c0.r * 100, 0) + "%), enquanto " + M[cN.t].label + " fica em r = " +
        fmt(cN.r, 2) + ". " + interpretR(c0.r) + "."]);
    }

    /* dispersão / concentração */
    const share10 = sorted.slice(0, Math.max(1, Math.round(rows.length * 0.1)))
      .reduce((s, d) => s + d[state.metric], 0) / (st.sum || 1);
    out.push(["05", "Dispersão e concentração",
      "Coeficiente de variação de <b>" + fmt(cv * 100, 0) + "%</b> (σ = " + fmtM(st.std, m) +
      "). Os 10% maiores concentram <b>" + fmt(share10 * 100, 0) + "%</b> do volume do recorte."]);

    /* abstêmios / zeros */
    const zeros = rows.filter((d) => d.total === 0);
    if (zeros.length) {
      out.push(["06", "Consumo nulo declarado",
        "<b>" + zeros.length + "</b> país(es) com zero litro de álcool puro: " +
        zeros.slice(0, 6).map((d) => d.country).join(", ") +
        (zeros.length > 6 ? " e mais " + (zeros.length - 6) : "") + "."]);
    } else {
      out.push(["06", "Piso do recorte",
        "Menor consumo em <b>" + bot.country + "</b> (" + fmtM(bot[state.metric], m) + " " +
        m.unit + "), " + fmt((st.mean - bot[state.metric]) / (st.std || 1), 1) +
        " desvios-padrão abaixo da média."]);
    }

    el.insights.innerHTML = out.map(([n, t, d, g]) =>
      '<div class="ins__i">' +
        '<div class="ins__ico' + (g ? " ins__ico--g" : "") + '">' + n + "</div>" +
        '<div class="ins__b"><div class="ins__t">' + t + '</div><div class="ins__d">' + d + "</div></div>" +
      "</div>").join("");
  }

  /* ============================================================= 16. tabela */

  const TBL_COLS = [
    { k: "rank",      lbl: "#",            sortable: false },
    { k: "country",   lbl: "País" },
    { k: "continent", lbl: "Continente" },
    { k: "beer",      lbl: "Cerveja" },
    { k: "spirit",    lbl: "Destilados" },
    { k: "wine",      lbl: "Vinho" },
    { k: "servings",  lbl: "Total doses" },
    { k: "total",     lbl: "Álcool puro (L)" },
    { k: "dominant",  lbl: "Dominante" }
  ];

  function renderTable() {
    let rows = filtered();
    const q = norm(state.tblQuery);
    if (q) rows = rows.filter((d) => norm(d.country).includes(q));

    const { key, dir } = state.tblSort;
    rows = rows.slice().sort((a, b) => {
      const va = a[key], vb = b[key];
      const c = typeof va === "string"
        ? String(va).localeCompare(String(vb), "pt-BR")
        : (va - vb);
      return dir === "asc" ? c : -c;
    });

    const maxTotal = rows.length ? Math.max.apply(null, rows.map((d) => d.total)) : 1;
    el.tblSub.textContent = rows.length + (rows.length === 1 ? " linha" : " linhas") +
      " · clique num cabeçalho para ordenar, numa linha para incluir o país no filtro";

    let h = "<thead><tr>";
    TBL_COLS.forEach((c) => {
      const on = c.k === key;
      h += "<th" + (c.sortable === false ? "" : ' data-k="' + c.k + '"') +
           (on ? ' class="is-sorted"' : "") + ">" + c.lbl +
           '<span class="caret">' + (dir === "asc" ? "▲" : "▼") + "</span></th>";
    });
    h += "</tr></thead><tbody>";

    rows.forEach((d, i) => {
      h += '<tr data-c="' + d.country.replace(/"/g, "&quot;") + '"' +
           (state.countries.has(d.country) ? ' class="is-sel"' : "") + ">" +
        '<td class="tbl__rank u-num">' + (i + 1) + "</td>" +
        '<td class="tbl__cty">' + d.country + "</td>" +
        '<td><span class="tbl__cont">' + (CONT_PT[d.continent] || d.continent) + "</span></td>" +
        '<td class="u-num">' + fmt(d.beer, 0) + "</td>" +
        '<td class="u-num">' + fmt(d.spirit, 0) + "</td>" +
        '<td class="u-num">' + fmt(d.wine, 0) + "</td>" +
        '<td class="u-num">' + fmt(d.servings, 0) + "</td>" +
        '<td><span class="tbl__mini"><span class="u-num">' + fmt(d.total, 1) + "</span>" +
          '<span class="tbl__minibar"><i style="width:' +
            (maxTotal ? (d.total / maxTotal * 100) : 0) + '%"></i></span></span></td>' +
        "<td>" + (d.dominant ? M[d.dominant].label : "—") + "</td>" +
      "</tr>";
    });
    h += "</tbody>";
    if (!rows.length) {
      h = '<tbody><tr><td><div class="empty">Nenhum país no recorte atual</div></td></tr></tbody>';
    }
    el.tbl.innerHTML = h;

    el.tbl.querySelectorAll("th[data-k]").forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.k;
        state.tblSort = (state.tblSort.key === k)
          ? { key: k, dir: state.tblSort.dir === "desc" ? "asc" : "desc" }
          : { key: k, dir: (k === "country" || k === "continent" || k === "dominant") ? "asc" : "desc" };
        renderTable();
      };
    });
    el.tbl.querySelectorAll("tbody tr[data-c]").forEach((tr) => {
      tr.onclick = () => toggleCountry(tr.dataset.c);
    });
  }

  /* ============================================================ 17. exportar */

  el.btnExport.onclick = () => {
    const rows = filtered();
    if (!rows.length) { toast("Nada a exportar no recorte atual", true); return; }
    const head = ["country", "continent", "beer_servings", "spirit_servings", "wine_servings",
                  "total_servings", "total_litres_of_pure_alcohol", "dominant_type"];
    const body = rows.map((d) => [
      '"' + d.country.replace(/"/g, '""') + '"', d.continent,
      d.beer, d.spirit, d.wine, d.servings, d.total,
      d.dominant ? M[d.dominant].label : ""
    ].join(","));
    const blob = new Blob(["﻿" + [head.join(",")].concat(body).join("\n")],
      { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nitro-consumo-recorte-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(rows.length + " linhas exportadas");
  };

  /* ========================================================= 18. orquestração */

  function renderAll() {
    renderKPIs();
    renderMap();
    renderInsights();
    renderCorr();
    renderScatter();
    renderRank();
    renderContinents();
    renderTable();
    escopoIA();
  }

  function revealCards() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.06 });
    document.querySelectorAll(".card").forEach((c) => io.observe(c));
  }

  /* abas em segundo plano suspendem requestAnimationFrame e, com ele, as
     transições do d3: ao voltar à aba, o painel é redesenhado por inteiro */
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.raw.length) renderAll();
  });

  /* redimensionamento: redesenha os gráficos dependentes de largura */
  let rzT;
  window.addEventListener("resize", () => {
    if (!state.raw.length) return;
    clearTimeout(rzT);
    rzT = setTimeout(() => {
      renderMap(); renderScatter(); renderRank(); renderContinents();
    }, 180);
  });

  /* ================================================= 19. suporte (form de teste) */
  /* Botão flutuante → modal com formulário. Ainda NÃO envia nada: apenas valida,
     registra no console e confirma via toast. A integração com o banco entra depois. */

  (function support() {
    const fab   = $("fabSupport");
    const modal = $("supportModal");
    const form  = $("supForm");
    if (!fab || !modal || !form) return;

    let lastFocus = null;

    function onKey(e) { if (e.key === "Escape") close(); }

    function open() {
      lastFocus = document.activeElement;
      modal.hidden = false;
      const first = form.querySelector("input, select, textarea");
      if (first) first.focus();
      document.addEventListener("keydown", onKey);
    }
    function close() {
      modal.hidden = true;
      document.removeEventListener("keydown", onKey);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    fab.addEventListener("click", open);
    $("supClose").addEventListener("click", close);
    $("supCancel").addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const dados = Object.fromEntries(new FormData(form).entries());
      console.log("[suporte] chamado registrado (modo teste, sem envio):", dados);
      form.reset();
      close();
      toast("Chamado registrado em modo de teste — integração com o banco pendente");
    });
  })();

  /* ============================================== 20. clima (masthead) */
  /* Consulta /api/weather com as coordenadas do navegador. A chave do
     OpenWeatherMap vive no .env do servidor e nunca chega até aqui.
     Em file:// não há backend: o widget simplesmente não aparece. */

  (function clima() {
    const box = $("wx");
    if (!box || !TEM_BACKEND) return;

    /* mapeia o código do ícone da OWM para um emoji — evita mais uma
       requisição de rede e mantém o widget leve */
    const ICONES = {
      "01d": "☀️", "01n": "🌙", "02d": "🌤️", "02n": "☁️",
      "03d": "☁️", "03n": "☁️", "04d": "☁️", "04n": "☁️",
      "09d": "🌧️", "09n": "🌧️", "10d": "🌦️", "10n": "🌧️",
      "11d": "⛈️", "11n": "⛈️", "13d": "🌨️", "13n": "🌨️",
      "50d": "🌫️", "50n": "🌫️"
    };

    function mostraErro(msg) {
      box.hidden = false;
      box.classList.add("wx--erro");
      $("wxIcon").textContent = "🌡️";
      $("wxTemp").textContent = msg;
      $("wxPlace").textContent = "";
      box.title = msg;
    }

    async function busca(lat, lon) {
      let r, d;
      try {
        r = await fetch("/api/weather?lat=" + lat.toFixed(4) + "&lon=" + lon.toFixed(4));
        d = await r.json();
      } catch {
        return mostraErro("Clima indisponível");
      }
      if (!r.ok) return mostraErro(d && d.erro ? "Clima indisponível" : "Clima indisponível");

      box.hidden = false;
      box.classList.remove("wx--erro");
      $("wxIcon").textContent = ICONES[d.icone] || "🌡️";
      $("wxTemp").textContent = d.temp + "°C";
      $("wxPlace").textContent = d.cidade + (d.pais ? " · " + d.pais : "");

      const det = [
        d.descricao ? d.descricao.charAt(0).toUpperCase() + d.descricao.slice(1) : "",
        "Sensação " + d.sensacao + "°C",
        "Mín " + d.minima + "° / Máx " + d.maxima + "°",
        d.umidade != null ? "Umidade " + d.umidade + "%" : "",
        d.vento != null ? "Vento " + d.vento + " km/h" : ""
      ].filter(Boolean);
      box.title = det.join(" · ");
    }

    if (!navigator.geolocation) return mostraErro("Sem geolocalização");

    navigator.geolocation.getCurrentPosition(
      (pos) => busca(pos.coords.latitude, pos.coords.longitude),
      () => mostraErro("Localização negada"),
      { timeout: 9000, maximumAge: 15 * 60 * 1000 }
    );
  })();

  /* ========================================== 21. chat com IA (Gemini) */
  /* Botão na base central abre um chat que responde SOBRE O RECORTE ATIVO.
     O contexto é montado a cada pergunta a partir de filtered() — a mesma
     função que alimenta os gráficos —, então os filtros são sempre
     respeitados. Nada é pré-calculado nem mockado. */

  (function chatIA() {
    const fab   = $("fabAI");
    const painel = $("aiPanel");
    const form  = $("aiForm");
    if (!fab || !painel || !form || !TEM_BACKEND) return;

    const log = $("aiLog"), input = $("aiInput"), send = $("aiSend"), sug = $("aiSug");
    const historico = [];          // {papel:"eu"|"ia", texto}
    let ocupado = false;

    /* ---------------------------------------------- descrição dos filtros */

    /* rótulo curto do recorte, mostrado como etiquetas no topo do chat */
    function rotulosFiltro() {
      const m = M[state.metric];
      const tags = [["Métrica", m.label]];

      const conts = state.continents.size
        ? [...state.continents].map((c) => CONT_PT[c] || c).join(", ")
        : "todos";
      tags.push(["Continentes", conts]);

      tags.push(["Países", state.countries.size
        ? state.countries.size + " selecionado" + (state.countries.size > 1 ? "s" : "")
        : "todos"]);

      if (state.range) {
        const base = preRange().map((d) => d[state.metric]);
        const lo = S.min(base), hi = S.max(base);
        const cheio = !base.length ||
          (state.range[0] <= lo + 1e-9 && state.range[1] >= hi - 1e-9);
        tags.push(["Faixa", cheio ? "completa"
          : fmtM(state.range[0], m) + " – " + fmtM(state.range[1], m) + " " + m.unit]);
      }
      return tags;
    }

    function atualizaEscopo() {
      const alvo = $("aiScope");
      if (!alvo) return;
      const n = filtered().length;
      alvo.innerHTML =
        '<span class="ai__tag ai__tag--n"><b>' + n + "</b> país" + (n === 1 ? "" : "es") + "</span>" +
        rotulosFiltro().map(([k, v]) =>
          '<span class="ai__tag">' + k + ": <b>" + esc(v) + "</b></span>").join("");
    }
    /* exposto para renderAll() manter as etiquetas em dia */
    escopoIA = atualizaEscopo;

    /* ------------------------------------- serialização do recorte ativo */

    /* Monta o texto que vai como contexto ao modelo. Tudo sai de filtered():
       filtros, estatística descritiva, correlações, agregado por continente e
       as linhas em si. Com 193 países o payload fica na casa de poucos KB. */
    function contexto() {
      const rows = filtered();
      const m = M[state.metric];
      const L = [];

      L.push("FILTROS ATIVOS NO PAINEL:");
      rotulosFiltro().forEach(([k, v]) => L.push("- " + k + ": " + v));
      L.push("- Países no recorte: " + rows.length + " de " + state.raw.length + " da planilha");
      L.push("- Planilha de origem: " + state.fileName);

      if (state.countries.size) {
        L.push("- ATENÇÃO: há filtro de país ativo. Só existem no recorte: " +
               [...state.countries].join(", "));
      }
      if (!rows.length) {
        L.push("", "O recorte está VAZIO — nenhum país passa pelos filtros atuais.");
        return L.join("\n");
      }

      L.push("", "UNIDADES: álcool puro em L/hab.ano; cerveja, destilados e vinho em doses/ano.");

      L.push("", "ESTATÍSTICA DESCRITIVA DO RECORTE:");
      ALLKEYS.forEach((k) => {
        const st = describe(rows.map((d) => d[k]));
        const mk = M[k];
        L.push("- " + mk.label + " (" + mk.unit + "): n=" + st.n +
               "; soma=" + fmtM(st.sum, mk) + "; média=" + fmtM(st.mean, mk) +
               "; mediana=" + fmtM(st.median, mk) + "; desvio=" + fmtM(st.std, mk) +
               "; min=" + fmtM(st.min, mk) + "; Q1=" + fmtM(st.q1, mk) +
               "; Q3=" + fmtM(st.q3, mk) + "; max=" + fmtM(st.max, mk));
      });

      L.push("", "CORRELAÇÃO DE PEARSON NO RECORTE (r, n=" + rows.length + "):");
      for (let i = 0; i < ALLKEYS.length; i++) {
        for (let j = i + 1; j < ALLKEYS.length; j++) {
          const a = ALLKEYS[i], b = ALLKEYS[j];
          const r = S.pearson(rows.map((d) => d[a]), rows.map((d) => d[b]));
          L.push("- " + M[a].label + " x " + M[b].label + ": r=" + fmt(r, 3) +
                 " (p≈" + fmt(S.pValue(r, rows.length), 4) + ")");
        }
      }

      L.push("", "AGREGADO POR CONTINENTE (dentro do recorte):");
      presentContinents().forEach((c) => {
        const sub = rows.filter((d) => d.continent === c);
        if (!sub.length) return;
        L.push("- " + (CONT_PT[c] || c) + ": n=" + sub.length +
               "; " + ALLKEYS.map((k) =>
                 M[k].label + " média " + fmtM(S.mean(sub.map((d) => d[k])), M[k])).join("; "));
      });

      L.push("", "LINHAS DO RECORTE (ordenadas pela métrica ativa, " + m.label + " decrescente):");
      L.push("pais | continente | alcool_puro_L | cerveja_doses | destilados_doses | vinho_doses");
      rows.slice()
        .sort((a, b) => b[state.metric] - a[state.metric])
        .forEach((d) => {
          L.push([d.country, CONT_PT[d.continent] || d.continent,
                  fmt(d.total, 2), fmt(d.beer, 0), fmt(d.spirit, 0), fmt(d.wine, 0)].join(" | "));
        });

      return L.join("\n");
    }

    /* ------------------------------------------------------ interface */

    function esc(s) {
      return String(s).replace(/[&<>"]/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    }

    /* markdown mínimo: negrito, itálico e lista com hífen — nada de HTML cru */
    function formata(txt) {
      const linhas = esc(txt).split(/\n+/).map((l) => l.trim()).filter(Boolean);
      let html = "", emLista = false;
      linhas.forEach((l) => {
        const item = /^[-*•]\s+/.test(l);
        if (item && !emLista) { html += "<ul>"; emLista = true; }
        if (!item && emLista) { html += "</ul>"; emLista = false; }
        const corpo = l.replace(/^[-*•]\s+/, "")
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/(^|\s)\*(?!\s)(.+?)\*(?=\s|$)/g, "$1<em>$2</em>");
        html += item ? "<li>" + corpo + "</li>" : "<p>" + corpo + "</p>";
      });
      if (emLista) html += "</ul>";
      return html;
    }

    function limpaVazio() {
      const v = log.querySelector(".ai-msg--vazio");
      if (v) v.remove();
    }

    function bolha(papel, html, classe) {
      limpaVazio();
      const div = document.createElement("div");
      div.className = "ai-msg ai-msg--" + papel + (classe ? " " + classe : "");
      div.innerHTML = html;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      return div;
    }

    function estadoVazio() {
      log.innerHTML = '<div class="ai-msg ai-msg--vazio">' +
        "Pergunte o que quiser sobre os <b>" + filtered().length +
        "</b> países que passam pelos filtros de agora." +
        "</div>";
    }

    /* sugestões geradas a partir do próprio recorte — nada fixo */
    function sugestoes() {
      const rows = filtered();
      const m = M[state.metric];
      if (!rows.length) { sug.innerHTML = ""; return; }
      const topo = rows.slice().sort((a, b) => b[state.metric] - a[state.metric])[0];
      const conts = state.continents.size
        ? [...state.continents] : presentContinents();

      const perguntas = [
        "Resuma o recorte atual em três pontos",
        "Por que " + topo.country + " lidera em " + m.label.toLowerCase() + "?",
        conts.length > 1
          ? "Compare " + (CONT_PT[conts[0]] || conts[0]) + " e " +
            (CONT_PT[conts[1]] || conts[1])
          : "Qual o perfil de bebidas deste recorte?",
        "Que oportunidade comercial os dados sugerem?"
      ];

      sug.innerHTML = "";
      perguntas.forEach((p) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = p;
        b.addEventListener("click", () => { input.value = p; enviar(); });
        sug.appendChild(b);
      });
    }

    /* ------------------------------------------------------- envio */

    async function enviar() {
      if (ocupado) return;
      const pergunta = input.value.trim();
      if (!pergunta) return;

      if (!state.raw.length) {
        bolha("ia", "<p>Suba a planilha primeiro — sem dados não há o que analisar.</p>", "ai-msg--erro");
        return;
      }

      ocupado = true;
      send.disabled = true;
      input.value = "";
      input.style.height = "auto";
      sug.innerHTML = "";

      bolha("eu", esc(pergunta).replace(/\n/g, "<br>"));
      const carregando = bolha("ia", '<span class="ai-dots"><i></i><i></i><i></i></span>');

      let r, d;
      try {
        r = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pergunta, contexto: contexto(), historico })
        });
        d = await r.json();
      } catch (e) {
        carregando.remove();
        bolha("ia", "<p>Não consegui falar com o serviço de IA. Verifique a conexão.</p>",
              "ai-msg--erro");
        ocupado = false; send.disabled = false;
        return;
      }

      carregando.remove();

      if (!r.ok || !d || !d.resposta) {
        const msg = (d && d.erro) || "O serviço de IA não respondeu.";
        bolha("ia", "<p>" + esc(msg) + "</p>", "ai-msg--erro");
      } else {
        historico.push({ papel: "eu", texto: pergunta });
        historico.push({ papel: "ia", texto: d.resposta });
        const nTent = Array.isArray(d.tentativas) ? d.tentativas.length : 0;
        bolha("ia", formata(d.resposta) +
          '<span class="ai-msg__meta">' + esc(d.modelo || "gemini") +
          " · " + filtered().length + " países no recorte" +
          (nTent ? " · fallback após " + nTent + " tentativa" + (nTent > 1 ? "s" : "") : "") +
          "</span>");
      }

      ocupado = false;
      send.disabled = false;
      input.focus();
    }

    /* ------------------------------------------------------ abre/fecha */

    function onKey(e) { if (e.key === "Escape" && !painel.hidden) fecha(); }

    function abre() {
      painel.hidden = false;
      fab.hidden = true;
      fab.setAttribute("aria-expanded", "true");
      atualizaEscopo();
      if (!log.children.length || log.querySelector(".ai-msg--vazio")) estadoVazio();
      if (!historico.length) sugestoes();
      input.focus();
      document.addEventListener("keydown", onKey);
    }
    function fecha() {
      painel.hidden = true;
      fab.hidden = !state.raw.length;
      fab.setAttribute("aria-expanded", "false");
      document.removeEventListener("keydown", onKey);
      fab.focus();
    }

    fab.addEventListener("click", abre);
    $("aiClose").addEventListener("click", fecha);

    form.addEventListener("submit", (e) => { e.preventDefault(); enviar(); });

    /* Enter envia; Shift+Enter quebra linha */
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
    });
    /* textarea que cresce com o conteúdo, até o teto do CSS */
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 116) + "px";
    });
  })();

})();
