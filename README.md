# Painel de Consumo Global de Álcool · Divisão Nitro

Painel analítico de consumo global de bebidas alcoólicas para a **Deixa Comigo Bebidas — Divisão Nitro**.
O usuário sobe uma planilha de consumo e o painel se calibra sozinho: estatística descritiva,
correlação de Pearson, mapa coroplético, ranking, dispersão e leitura de insights — tudo em um passo.

> **Página única em HTML + CSS + JavaScript puro.** Sem build, sem bundler, sem gerenciador de
> pacotes, sem testes. O entregável é [`Dashboards/index.html`](Dashboards/index.html), aberto por
> duplo clique. Todas as dependências (d3, topojson-client, fontes Poppins, TopoJSON do mundo) estão
> vendorizadas em `Dashboards/assets/` — **funciona 100% offline, a partir de `file://`**.
>
> Duas capacidades dependem de rede e por isso vivem em *serverless functions* da Vercel:
> o **chat com IA** e o **widget de clima**. Abertas do disco elas simplesmente não aparecem;
> o painel analítico continua inteiro.

---

## Estrutura do repositório

```
Dados/          drinks.csv — fonte com 193 países (recortes exportados pelo painel são ignorados no git)
Referencias/    nitro_brand_book_by_pomelli.pdf — fonte da identidade visual
api/
  chat.js             proxy do Gemini com cadeia de modelos de fallback (lê GEMINI_API_KEY)
  weather.js          proxy do OpenWeatherMap (lê OPENWEATHER_API_KEY)
dev-server.py   servidor local: serve os estáticos e replica /api/* lendo o .env
.env.example    modelo das variáveis (o .env real nunca vai para o git)
Dashboards/
  index.html          o painel
  assets/
    app.js            o motor (IIFE única, 21 seções numeradas)
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

### Com chat de IA e clima

Essas duas funções precisam das chaves, que ficam **no servidor**. Copie o modelo e preencha:

```bash
cp .env.example .env
```

```bash
python dev-server.py
```

O `dev-server.py` serve os estáticos e replica `/api/chat` e `/api/weather` lendo o `.env` —
as mesmas rotas que em produção são *serverless functions*. Abra
<http://127.0.0.1:8777/Dashboards/index.html>.

### Depuração sem as chaves

O painel de preview renderiza `file://` como snapshot estático (sem CSS/JS). Para depurar só a
parte analítica basta:

```bash
python -m http.server 8777
```

---

## Chat com IA e clima

### Onde ficam as chaves

Nunca no navegador. As duas credenciais vivem em variáveis de ambiente lidas apenas do lado do
servidor — `.env` em desenvolvimento, *Environment Variables* do projeto na Vercel em produção:

| Variável               | Usada por       | O que é                                            |
|------------------------|-----------------|----------------------------------------------------|
| `GEMINI_API_KEY`       | `/api/chat`     | Chave do Google Gemini                             |
| `GEMINI_MODELS`        | `/api/chat`     | Cadeia de fallback, em ordem (opcional)            |
| `OPENWEATHER_API_KEY`  | `/api/weather`  | Chave do OpenWeatherMap                            |

O `.env` está no `.gitignore`. **Não existe `config.js`** — nenhuma chave é servida ao cliente.

### Fallback de modelos

`/api/chat` percorre os modelos em ordem e avança para o próximo diante de 429 (limite), 404
(modelo aposentado), 5xx, falha de rede ou resposta vazia. Um 400/403 interrompe a cadeia: o erro
se repetiria em todos. Padrão atual:

`gemini-3.6-flash` → `gemini-3.5-flash-lite` → `gemini-3.8-flash` → `gemini-3.5-flash` → `gemini-flash-latest`

A ordem alterna capacidade e velocidade de propósito: sob carga os modelos *lite* costumam responder
enquanto os maiores devolvem 503. Esses 503 de *high demand* são frequentes e transitórios, então a
cadeia é o caminho normal, não a exceção. Dois limites protegem o usuário: **24s por tentativa** e
**52s para a cadeia inteira** (a function tem 60s em `vercel.json`). Quando toda a cadeia devolve
429/503, a mensagem diz que é sobrecarga passageira e pede nova tentativa — em vez de sugerir um erro
de configuração que não existe. O rodapé de cada resposta diz qual modelo atendeu e quantas
tentativas foram gastas antes.

### Como os filtros são respeitados

A cada pergunta o cliente serializa o recorte a partir de `filtered()` — a mesma função que alimenta
todos os gráficos. Vai no contexto: os filtros ativos em texto, estatística descritiva das quatro
métricas, correlações de Pearson com p-valor, agregado por continente e as linhas do recorte. O
*prompt* de sistema proíbe o modelo de usar qualquer outro dado e o obriga a dizer quando um filtro
exclui o que foi perguntado — na prática ele responde "o Japão está fora do recorte, afrouxe o
filtro de continentes" em vez de inventar o número. As etiquetas no topo do chat espelham o recorte
que a IA enxerga naquele instante.

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
