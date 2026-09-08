# Painel de Consumo Global de Álcool · Divisão Nitro

Painel analítico de consumo global de bebidas alcoólicas para a **Deixa Comigo Bebidas — Divisão Nitro**.
O usuário sobe uma planilha de consumo e o painel se calibra sozinho: estatística descritiva,
correlação de Pearson, mapa coroplético, ranking, dispersão e leitura de insights — tudo em um passo.

> **Página única em HTML + CSS + JavaScript puro.** Sem build, sem bundler, sem gerenciador de
> pacotes, sem testes. O entregável é [`Dashboards/index.html`](Dashboards/index.html), aberto por
> duplo clique. Todas as dependências (d3, topojson-client, fontes Poppins, TopoJSON do mundo) estão
> vendorizadas em `Dashboards/assets/` — **funciona 100% offline, a partir de `file://`**.

---

## Estrutura do repositório

```
Dados/          drinks.csv — fonte com 193 países (recortes exportados pelo painel são ignorados no git)
Referencias/    nitro_brand_book_by_pomelli.pdf — fonte da identidade visual
Dashboards/
  index.html          o painel
  assets/
    app.js            o motor (IIFE única, ~1500 linhas, 19 seções numeradas)
    styles.css         tokens de marca em :root, grade de 12 colunas
    geo-meta.js        metadado geográfico de referência (gerado, não editar à mão)
    world-topo.js      TopoJSON do mundo como global JS (contorna CORS em file://)
    d3.v7.min.js  topojson-client.min.js  poppins.css  fonts/*.woff2   (vendorizados)
    nitro-logo-white.png  nitro-logo-dark.png
```

---

## Como executar

### Uso normal

Duplo clique em `Dashboards/index.html`. Nada mais.

### Depuração com ferramentas que exigem HTTP

O painel de preview renderiza `file://` como snapshot estático (sem CSS/JS). Para depurar de verdade:

```bash
python -m http.server 8777
```

e abra <http://127.0.0.1:8777/Dashboards/index.html>.

---

## Formato dos dados

O painel aceita CSV com estas colunas (cabeçalhos em inglês **ou** português são reconhecidos
automaticamente, com detecção de delimitador e de números pt-BR / en-US):

| Inglês                          | Português       | Descrição                              |
|---------------------------------|-----------------|----------------------------------------|
| `country`                       | `pais`          | Nome do país                           |
| `beer_servings`                 | `cerveja`       | Doses de cerveja per capita/ano        |
| `spirit_servings`               | `destilados`    | Doses de destilados per capita/ano     |
| `wine_servings`                 | `vinho`         | Doses de vinho per capita/ano          |
| `total_litres_of_pure_alcohol`  | `total_litros`  | Litros de álcool puro per capita/ano   |

Importação por **arrastar**, **clicar** ou **`Ctrl+V`**. Todos os filtros nascem em "todos".

---

## Arquitetura — restrições que não podem regredir

1. **Zero dados mockados.** Todo número exibido (KPIs, escalas de cor, correlações, textos de insight,
   domínios dos filtros) é recalculado a partir do CSV importado em tempo de execução. O único dado
   embarcado é metadado geográfico de referência (`geo-meta.js`).
2. **Funciona offline, a partir de `file://`.** `fetch()` de JSON local é bloqueado por CORS em
   `file://`; `<script src>` não é. Por isso o TopoJSON é servido como global JS. Nunca trocar por
   CDN nem por `fetch`.
3. **Mínimo de interações.** O público é técnico: abrir e subir a planilha. O painel completo aparece
   em um passo.
4. **Marca do brand book.** Poppins; `#0E5C88` (teal) / `#94C356` (verde) / `#E4ECEB` / branco.
   Séries: cerveja `#94c356`, destilados `#56a8c3`, vinho `#0e5c88`.
5. **Idioma da interface e dos comentários de código: português.**

### Fluxo de dados

`state` (objeto único) → `preRange()` (filtro de continente + país) → `filtered()` (aplica a faixa) →
cada `renderX()` lê `filtered()`. Qualquer mudança de filtro altera `state` e chama `renderAll()`.
Sem framework; toda renderização é idempotente.

Detalhes de manutenção (parser tolerante, resolução de nomes de país, armadilha de abas em segundo
plano, escapes em regex) estão em [`CLAUDE.md`](CLAUDE.md).

---

## Estado em aberto

O formulário de chamado (seção 19, `support()` em `app.js`) está em **modo de teste**: valida, loga no
console e mostra um toast, mas não envia nada. A integração com o banco está pendente.

---

## Licença

Uso interno — Companhia Nitro Química Brasileira. Todos os direitos reservados.
