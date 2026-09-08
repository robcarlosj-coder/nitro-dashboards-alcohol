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
```

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

## `assets/app.js` — o motor

IIFE única, ~1500 linhas, organizada em 19 seções numeradas em comentário (`/* ==== N. nome */`).
Navegue por esses cabeçalhos. Ordem: configuração → estatística → parser CSV → estado → seleção derivada →
importação → controles → tooltip → mapa → KPIs → correlação → dispersão → ranking → continentes → insights →
tabela → exportar → orquestração → suporte.

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

## Estado em aberto

A seção 19 (`support()`) é um formulário de chamado em **modo de teste**: valida, loga no console e mostra
um toast, mas não envia nada. A integração com o banco está pendente.

## CSS

`assets/styles.css` — tokens de marca em `:root`, grade de 12 colunas (`.col-4`, `.col-8`, `.col-12`).
Breakpoints em 1680 / 1180 / 980 / 820 px; abaixo de 980px a barra de filtros deixa de ser `sticky`
porque a masthead passa a ter altura variável. As margens dos gráficos d3 são responsivas
(calculadas como fração da largura em `renderRank`, `drawMix`, `drawBox`), então mudanças de layout
podem exigir ajuste lá também. Há regras para `prefers-reduced-motion` e impressão.
