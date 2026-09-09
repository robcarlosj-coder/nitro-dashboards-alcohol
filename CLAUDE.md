# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

Painel analítico de consumo global de bebidas alcoólicas para a **Deixa Comigo Bebidas — Divisão Nitro**.
Página única em HTML + CSS + JavaScript puro. **Não há build, bundler, gerenciador de pacotes nem testes**:
o entregável é `Dashboards/index.html`, aberto por duplo clique.

```
Dados/          drinks.csv (fonte, 193 países) e recortes exportados pelo painel
Referencias/    nitro_brand_book_by_pomelli.pdf (fonte da identidade visual)
Dashboards/     index.html + assets/
api/            chat.js e weather.js — serverless functions da Vercel (CommonJS, zero dependências)
dev-server.py   servidor local que serve os estáticos e replica /api/* lendo o .env
```

Duas funções dependem de rede — o **chat com IA** e o **widget de clima**. São o único ponto do
projeto que não é estático, e existem só quando o painel é servido por HTTP.

## Executar e depurar

Duplo clique em `Dashboards/index.html` já funciona — todas as dependências estão embarcadas em `assets/`.
Para depurar com ferramentas que exigem HTTP (o painel de preview do Claude renderiza `file://` como
snapshot estático, sem CSS/JS):

```bash
python -m http.server 8777
```

e abrir `http://127.0.0.1:8777/Dashboards/index.html`. Não existe upload de arquivo nas ferramentas de
browser; para injetar o CSV no navegador automatizado, dispare o handler real de drop via `javascript_tool`
com `fetch` + `File` + `DataTransfer` + `dispatchEvent(new DragEvent('drop', …))`.

Para exercitar o chat de IA ou o clima é preciso das chaves, então use `python dev-server.py` no lugar
do `http.server`: ele carrega o `.env` e replica `/api/chat` e `/api/weather`.

## Restrições de arquitetura (não regredir)

1. **Zero dados mockados.** Todo número exibido — KPIs, escalas de cor, correlações, textos de insight,
   domínios dos filtros — é recalculado a partir do CSV importado em tempo de execução. O único dado
   embarcado é metadado *geográfico de referência* (`geo-meta.js`).
2. **Funciona offline, a partir de `file://`.** `fetch()` de JSON local é bloqueado por CORS em `file://`,
   mas `<script src>` não é: por isso o TopoJSON do mundo é servido como **global JS**
   (`assets/world-topo.js` → `window.NITRO_WORLD_TOPO`). d3, topojson-client e as 15 fontes Poppins woff2
   também são vendorizados. Nunca trocar por CDN nem por `fetch`.
3. **Mínimo de interações.** O público é técnico e quer abrir e subir a planilha. Importação por
   arrastar, clicar ou `Ctrl+V`; todos os filtros nascem em "todos"; o painel completo aparece em um passo.
4. **Marca do brandbook.** Poppins; `#0E5C88` (teal) / `#94C356` (verde) / `#E4ECEB` / branco, com rampas
   derivadas em `:root`. Séries: `--c-beer #94c356`, `--c-spirit #56a8c3`, `--c-wine #0e5c88`.
   Logos extraídos do PDF (`nitro-logo-white.png` na masthead escura, `nitro-logo-dark.png` no rodapé/favicon).
5. **Idioma da interface e dos comentários de código: português.**
6. **Chave de API nunca chega ao navegador.** Não criar `config.js` nem embutir credencial no
   cliente: `GEMINI_API_KEY` e `OPENWEATHER_API_KEY` só existem em `process.env`, lidas pelas
   functions em `api/`. O `.env` está no `.gitignore`; `.env.example` documenta o formato.

## `assets/app.js` — o motor

IIFE única, organizada em 21 seções numeradas em comentário (`/* ==== N. nome */`).
Navegue por esses cabeçalhos. Ordem: configuração → estatística → parser CSV → estado → seleção derivada →
importação → controles → tooltip → mapa → KPIs → correlação → dispersão → ranking → continentes → insights →
tabela → exportar → orquestração → suporte → clima → chat com IA.

`TEM_BACKEND` (seção 1) é `true` só sob `http(s)://`. As seções 20 e 21 desistem na primeira linha
quando ele é falso, e os elementos correspondentes nascem `hidden` no HTML — é assim que o painel
continua íntegro aberto do disco.

**Fluxo de dados:** `state` (objeto único: `raw`, `metric`, `continents`, `countries`, `range`, e modos de
visualização) → `preRange()` (continente + país) → `filtered()` (aplica a faixa) → cada `renderX()` lê
`filtered()`. Qualquer mudança de filtro altera `state` e chama `renderAll()`. Não há framework nem estado
local nos componentes; toda a renderização é idempotente.

`METRICS` define as quatro métricas (total/beer/spirit/wine) com sua coluna, casas decimais e passo do
slider — quem adicionar métrica mexe só ali e nos aliases.

**Ingestão tolerante:** o parser lida com aspas, quebras de linha dentro do campo, CRLF, BOM,
delimitador auto-detectado (`,` `;` tab `|`) e números pt-BR ou en-US. `COL_ALIASES` aceita cabeçalhos em
inglês e português com fallback por prefixo.

**Resolução de nomes de país** (três funções encadeadas, mexer aqui é sensível):
`canonical()` normaliza (minúsculo, sem acento) e traduz pt→en via `NITRO_GEO.ptNames`;
`inferContinent()` usa o resultado para achar o continente (senão `"Outros"`);
`atlasKey()` aplica `NITRO_GEO.atlasAlias` para casar com os nomes do world-atlas.
29 micro-estados não têm polígono no atlas 1:110m e são desenhados como pontos via `NITRO_GEO.microStates`.

### Armadilha: abas em segundo plano

`requestAnimationFrame` fica suspenso em abas ocultas, e com ele as transições do d3 — foi a causa de KPIs
zerados e mapa sem preenchimento. Três defesas já no código, **preservar as três**: `animateNumber()` escreve
o valor final antes de animar e desiste se `document.hidden`; as cores do mapa são atribuídas direto com
`.attr("fill", …)` e animadas por `transition` do CSS, não do d3; e há um listener de `visibilitychange`
que chama `renderAll()`.

### Escapes em regex

Usar `\uXXXX` (`\u0300-\u036f` para diacríticos combinantes, `\uFEFF` para BOM), nunca os caracteres
literais — eles corrompem o arquivo ao passar por ferramentas em cp1252 no Windows.

## `assets/geo-meta.js` e `world-topo.js` são gerados

Não editar à mão. São produzidos por `gen_meta.py` (fica no scratchpad da sessão, não versionado), que lê
`Dados/drinks.csv` e um `c110m.json` do world-atlas e emite `window.NITRO_GEO`
(`continent`, `atlasAlias`, `microStates`, `ptNames`) e `window.NITRO_WORLD_TOPO`. Ao trocar o dataset por
um com países novos, regenere `geo-meta.js` — o script imprime os países sem continente e sem geometria.

## Seções 20 e 21 — clima e chat com IA

**Clima (20).** `navigator.geolocation` → `GET /api/weather?lat&lon`. A function devolve só os campos
que o widget usa; o resto da resposta da OWM não vaza. Códigos de ícone viram emoji por tabela local,
para não gastar outra requisição. Falha de permissão ou de rede vira texto discreto, nunca erro.

**Chat (21).** O ponto sensível é `contexto()`: monta o texto enviado ao modelo **a partir de
`filtered()`**, nunca de `state.raw`. É isso que faz a IA respeitar os filtros. Inclui filtros em
texto, `describe()` das quatro métricas, correlações com p-valor, agregado por continente e as linhas
do recorte. Ao mexer em filtros ou métricas, verifique se `contexto()` e `rotulosFiltro()` acompanham.

`renderAll()` chama `escopoIA()` — um hook que a seção 21 sobrescreve — para manter as etiquetas de
filtro do chat sincronizadas. Se a seção 21 não rodar (sem backend), o hook fica sendo um no-op.

Respostas do modelo passam por `formata()`, que aceita só negrito, itálico e lista com hífen sobre
texto já escapado. **Não trocar por `innerHTML` cru** — é conteúdo vindo de fora.

### `api/chat.js` — a cadeia de fallback

CommonJS (`module.exports`), sem `package.json`, sem dependência: `fetch` global do runtime Node.
Avança para o próximo modelo em 429/404/5xx/rede/resposta vazia; para em 400/403, que se repetiriam.
Dois limites protegem o usuário e o teto de 60s da function: `TIMEOUT_MS` (24s por tentativa) e
`ORCAMENTO_MS` (52s para a cadeia). Os 503 de *high demand* do Gemini são comuns e transitórios — a
cadeia disparar é o comportamento normal, não sintoma de bug. **Não baixe `TIMEOUT_MS` achando que
deixa o painel mais responsivo:** sob carga o serviço leva 30s para responder, e um teto apertado
descarta modelos que teriam respondido, fazendo a cadeia inteira falhar. A ordem também não é por
capacidade — os *lite* vêm cedo porque respondem quando os maiores estão em 503.

Ao mudar a cadeia, confirme antes que os modelos existem:
`GET https://generativelanguage.googleapis.com/v1beta/models` com o header `x-goog-api-key`. O Google
aposenta versão de flash com frequência e o erro é um 404 com a mensagem de substituição. Mantenha
`MODELOS_PADRAO` em `api/chat.js` e `dev-server.py` em sincronia.

## Estado em aberto

A seção 19 (`support()`) é um formulário de chamado em **modo de teste**: valida, loga no console e mostra
um toast, mas não envia nada. A integração com o banco está pendente.

## CSS

`assets/styles.css` — tokens de marca em `:root`, grade de 12 colunas (`.col-4`, `.col-8`, `.col-12`).
Breakpoints em 1680 / 1180 / 980 / 820 px; abaixo de 980px a barra de filtros deixa de ser `sticky`
porque a masthead passa a ter altura variável. As margens dos gráficos d3 são responsivas
(calculadas como fração da largura em `renderRank`, `drawMix`, `drawBox`), então mudanças de layout
podem exigir ajuste lá também. Há regras para `prefers-reduced-motion` e impressão.
