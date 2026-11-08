import { projectMonthly, validationMonths } from "./forecast.mjs?v=capitulos";

const byId = (id) => document.getElementById("air-" + id);
const integer = new Intl.NumberFormat("pt-BR");
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });
const names = { "0517801": "Salvador · Aeroporto Internacional", "0517700": "Salvador · Aeroporto Internacional" };
const metrics = {
  kg: { label: "Peso líquido", index: 3, color: "var(--chart-indigo)", prefix: "", suffix: " kg" },
  fob: { label: "Valor FOB", index: 2, color: "var(--chart-neutral)", prefix: "US$ ", suffix: "" },
};
const aliases = { "08072000": "mamão mamões papaia papaya" };
const cache = new Map();
let metadata;
let chapterNames;
let periods;
let catalog = [];
let rows = null;
let metric = "kg";
let request = 0;
let selection;
let chartView;
let focusMonth;
let futurePeriods;
let projection;

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function svg(tag, attributes, content) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (content !== undefined) node.textContent = content;
  return node;
}

function option(value, label) {
  const node = element("option", label);
  node.value = value;
  return node;
}

function normalize(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function periodLabel(period) {
  return dateFormat.format(new Date(period + "-01T00:00:00Z"));
}

function monthList(first, last) {
  const months = [];
  const date = new Date(first + "-01T00:00:00Z");
  while (date.toISOString().slice(0, 7) <= last) {
    months.push(date.toISOString().slice(0, 7));
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return months;
}

function showError(message) {
  byId("error").textContent = message;
  byId("error").hidden = !message;
}

async function loadJson(path) {
  if (cache.has(path)) return cache.get(path);
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error("Arquivo indisponível: " + path);
  const data = await response.json();
  if (cache.size >= 7) cache.delete(cache.keys().next().value);
  cache.set(path, data);
  return data;
}

function officialName(origin) {
  return origin.name.replace(/^\d{7}\s*-\s*/, "");
}

function originName(origin) {
  return names[origin.id] || officialName(origin);
}

function productName(code) {
  return code ? metadata.products[code] + " · " + code : "Todos os produtos";
}

function fillOrigins() {
  const groups = [
    { label: "Aeroportos identificados", airport: true },
    { label: "Outras URFs com embarques aéreos", airport: false },
  ].map(({ label, airport }) => {
    const group = element("optgroup");
    group.label = label;
    const origins = metadata.origins.filter((origin) => origin.airport === airport);
    origins.sort((a, b) => originName(a).localeCompare(originName(b), "pt-BR"));
    group.append(...origins.map((origin) => option(origin.id, originName(origin) + " · " + origin.id)));
    return group;
  });
  byId("origin").replaceChildren(...groups);
}

function categoryName(code) {
  return code + " · " + (chapterNames[code] || "Capítulo sem descrição na tabela oficial");
}

function fillCategories(preferred) {
  const chapters = [...new Set(catalog.map((code) => code.slice(0, 2)))].sort();
  const dropdown = byId("category");
  dropdown.replaceChildren(option("", "Todas as categorias"),
    ...chapters.map((chapter) => option(chapter, categoryName(chapter))));
  dropdown.value = chapters.includes(preferred) ? preferred : "";
}

function matchingProducts() {
  const category = byId("category").value;
  const terms = normalize(byId("search").value).split(/\s+/).filter(Boolean);
  return catalog.filter((code) => {
    if (category && !code.startsWith(category)) return false;
    const searchable = normalize(code + " " + metadata.products[code] + " " + (aliases[code] || ""));
    return terms.every((term) => searchable.includes(term));
  });
}

function fillProducts(code) {
  const matches = matchingProducts();
  const visible = matches.slice(0, 120);
  const category = byId("category").value;
  const valid = catalog.includes(code) && (!category || code.startsWith(category));
  if (valid && !visible.includes(code)) visible.unshift(code);
  byId("product").replaceChildren(
    option("", category ? "Todos os produtos da categoria" : "Todos os produtos"),
    ...visible.map((product) => option(product, productName(product))),
  );
  byId("product").value = valid ? code : "";
  const count = matches.length;
  byId("search-note").textContent = count === 0
    ? "Nenhum produto corresponde à busca neste ponto de embarque."
    : integer.format(count) + (count === 1 ? " produto encontrado." : " produtos encontrados.") +
      (count > 120 ? " Busque pelo nome ou código para acessar o catálogo completo." : "");
}

function setLoading(message) {
  rows = null;
  byId("results").hidden = true;
  byId("status").textContent = message;
  byId("destination").disabled = true;
  showError("");
}

function reportLoadError(error, sequence) {
  if (sequence !== request) return;
  console.error(error);
  byId("status").textContent = "";
  showError("Não foi possível carregar o recorte. Escolha outro filtro ou recarregue a página.");
}

async function changeOrigin(id, preferred = "", preferredCategory = "") {
  const sequence = ++request;
  setLoading("Carregando produtos da origem…");
  byId("origin").value = id;
  byId("search").value = "";
  byId("search").disabled = true;
  byId("product").disabled = true;
  byId("category").disabled = true;
  const origin = metadata.origins.find((entry) => entry.id === id);
  byId("origin-note").textContent = "URF " + origin.id +
    (origin.airport ? " · aeroporto identificado" : " · unidade sem aeroporto identificado");
  try {
    const result = await loadJson("dados/origens/" + id + "/catalogo.json");
    if (sequence !== request) return;
    catalog = result;
    fillCategories(catalog.includes(preferred) ? preferred.slice(0, 2) : preferredCategory);
    fillProducts(preferred);
    byId("category").disabled = false;
    byId("search").disabled = false;
    byId("product").disabled = false;
    await changeProduct();
  } catch (error) {
    reportLoadError(error, sequence);
  }
}

function aggregateChapter(products) {
  const totals = new Map();
  for (const entries of Object.values(products)) {
    for (const [month, country, fob, kg] of entries) {
      const key = month + ":" + country;
      const row = totals.get(key) || [month, country, 0, 0];
      row[2] += fob;
      row[3] += kg;
      totals.set(key, row);
    }
  }
  return [...totals.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

async function changeProduct() {
  const sequence = ++request;
  const origin = byId("origin").value;
  const code = byId("product").value;
  if (code && !byId("category").value) {
    byId("category").value = code.slice(0, 2);
    fillProducts(code);
  }
  const category = byId("category").value;
  const previousCountry = byId("destination").value;
  setLoading("Carregando a série mensal e os destinos…");
  try {
    const url = "dados/origens/" + origin + "/" + (category || "todos") + ".json";
    const result = await loadJson(url);
    if (sequence !== request) return;
    rows = code ? result[code] : category ? aggregateChapter(result) : result;
    const countries = [...new Set(rows.map((row) => row[1]))];
    countries.sort((a, b) => metadata.countries[a].localeCompare(metadata.countries[b], "pt-BR"));
    const dropdown = byId("destination");
    dropdown.replaceChildren(option("", "Todos os países"), ...countries.map((country) => option(country, metadata.countries[country])));
    if (previousCountry !== "" && countries.includes(Number(previousCountry))) dropdown.value = previousCountry;
    dropdown.disabled = false;
    const urlState = new URL(location.href);
    urlState.searchParams.set("origem", origin);
    if (category) urlState.searchParams.set("capitulo", category);
    else urlState.searchParams.delete("capitulo");
    if (code) urlState.searchParams.set("produto", code);
    else urlState.searchParams.delete("produto");
    if (!document.getElementById("view-air").hidden) history.replaceState(null, "", urlState);
    render();
  } catch (error) {
    reportLoadError(error, sequence);
  }
}

function summarize(first, last, country) {
  const trend = Array.from({ length: last - first + 1 }, () => ({ kg: 0, fob: 0 }));
  const ranking = new Map();
  const detail = [];
  let kg = 0, fob = 0;
  const selectedCountries = new Set();
  for (const row of rows) {
    const [month, id, value, weight] = row;
    if (month < first || month > last) continue;
    const totals = ranking.get(id) || { id, kg: 0, fob: 0 };
    totals.kg += weight;
    totals.fob += value;
    ranking.set(id, totals);
    if (country !== null && country !== id) continue;
    trend[month - first].kg += weight;
    trend[month - first].fob += value;
    selectedCountries.add(id);
    kg += weight;
    fob += value;
    detail.push(row);
  }
  return { first, last, trend, ranking: [...ranking.values()], kg, fob, destinations: selectedCountries.size, detail };
}

function drawCards() {
  const cards = [
    ["Peso líquido", compact.format(selection.kg) + " kg", integer.format(selection.kg) + " kg no recorte", "var(--chart-indigo)"],
    ["Valor FOB", "US$ " + compact.format(selection.fob), "US$ " + integer.format(selection.fob) + " no recorte", "var(--chart-neutral)"],
    ["Países de destino", integer.format(selection.destinations), "Com registros no recorte", "var(--chart-indigo)"],
  ];
  const year2030 = projection && forecastYears().get("2030");
  const format = metrics[metric];
  const forecastLabel = year2030?.scenarioMonths ? "Cenário para 2030" : "Estimativa para 2030";
  cards.push(year2030
    ? [forecastLabel, format.prefix + compact.format(year2030.observed + year2030.projected) + format.suffix,
      "WAPE de " + percent.format(projection.wape) + " na validação de 12 meses", format.color]
    : ["Estimativa para 2030", "Indisponível", "Histórico insuficiente para o recorte", format.color]);
  byId("kpis").replaceChildren(...cards.map(([title, value, note, color]) => {
    const card = element("article", undefined, "kpi");
    card.style.setProperty("--series", color);
    card.append(element("p", title, "kpi-label"), element("p", value, "kpi-number"), element("p", note, "kpi-range"));
    return card;
  }));
}

function drawRanking() {
  const countries = selection.ranking.sort((a, b) => b[metric] - a[metric] ||
    metadata.countries[a.id].localeCompare(metadata.countries[b.id], "pt-BR"));
  const total = countries.reduce((sum, country) => sum + country[metric], 0);
  const body = document.querySelector("#air-rank tbody");
  const selectedCountry = byId("destination").value;
  byId("rank-note").textContent = "Ordenado por " + metrics[metric].label.toLowerCase() +
    ". O ranking mantém todos os destinos da mercadoria ou categoria no período.";
  if (countries.length === 0) {
    const row = element("tr");
    const cell = element("td", "Nenhum país com registros nesse período.");
    cell.colSpan = 4;
    row.append(cell);
    body.replaceChildren(row);
    return;
  }
  body.replaceChildren(...countries.map((country) => {
    const row = element("tr", undefined, String(country.id) === selectedCountry ? "selected" : "");
    const name = element("th", metadata.countries[country.id]);
    name.scope = "row";
    const share = element("td", undefined, "num rank-share");
    if (total > 0) {
      const fraction = country[metric] / total;
      const bar = element("progress");
      bar.max = 1;
      bar.value = fraction;
      bar.setAttribute("aria-hidden", "true");
      share.append(bar, document.createTextNode(percent.format(fraction)));
    } else {
      share.textContent = "—";
    }
    row.append(name, element("td", integer.format(country.kg), "num"), element("td", integer.format(country.fob), "num"), share);
    return row;
  }));
}

function forecastYears() {
  const years = new Map();
  for (const [index, period] of futurePeriods.entries()) {
    const year = period.slice(0, 4);
    const totals = years.get(year) || { observed: 0, months: 0, forecast: 0, forecastMonths: 0, scenario: 0, scenarioMonths: 0, projected: 0 };
    const value = projection.values[index];
    if (index < validationMonths) {
      totals.forecast += value;
      totals.forecastMonths++;
    } else {
      totals.scenario += value;
      totals.scenarioMonths++;
    }
    totals.projected += value;
    years.set(year, totals);
  }
  periods.forEach((period, index) => {
    const totals = years.get(period.slice(0, 4));
    if (!totals) return;
    totals.observed += projection.historical[index][metric];
    totals.months++;
  });
  return years;
}

function drawForecast() {
  const note = byId("forecast-note");
  byId("forecast-csv").hidden = !projection;
  byId("forecast-table").hidden = !projection;
  if (!projection) {
    note.textContent = "Série insuficiente para projetar este recorte. São necessários 36 meses de cobertura e pelo menos três meses com valor positivo em cada um dos dois blocos recentes de 12 meses.";
    return;
  }
  const unit = metric === "kg" ? "kg" : "US$ FOB";
  const tie = projection.seasonalTie
    ? " Média de menor erro: " + percent.format(projection.bestWape) + ". A diferença para o sazonal ficou dentro de 0,5 ponto percentual." : "";
  note.textContent = projection.model + " · WAPE de " + percent.format(projection.wape) +
    " em " + projection.folds + " janelas históricas de 12 meses. Média de 12 meses: " +
    percent.format(projection.baselineWape) + ". Após os primeiros 12 meses, os valores em " + unit +
    " representam um cenário de continuidade." + tie;
  const body = document.querySelector("#air-annual tbody");
  body.replaceChildren(...Array.from(forecastYears(), ([year, totals]) => {
    const row = element("tr", undefined, year === "2030" ? "projected" : "");
    const label = element("th", year);
    label.scope = "row";
    row.append(label, element("td", totals.months ? integer.format(totals.observed) : "—", "num"),
      element("td", totals.forecastMonths ? integer.format(totals.forecast) : "—", "num"),
      element("td", totals.scenarioMonths ? integer.format(totals.scenario) : "—", "num"),
      element("td", integer.format(totals.observed + totals.projected), "num"));
    return row;
  }));
}

function downloadForecast() {
  if (!projection) return;
  const urf = byId("origin").value;
  const product = byId("product").value;
  const country = byId("destination").value;
  const destination = country === "" ? "Todos os países" : metadata.countries[Number(country)];
  const category = byId("category").value;
  const headers = ["mes", "situacao", "urf_embarque", "capitulo_sh2", "ncm", "pais_destino", "metrica", "valor", "modelo"];
  const series = [
    ...periods.map((period, index) => [period, "observado", projection.historical[index][metric]]),
    ...futurePeriods.map((period, index) => [period, index < validationMonths ? "previsao" : "cenario", projection.values[index]]),
  ];
  const data = series.map(([period, state, value]) =>
    [period, state, urf, category, product, destination, metric, value, state !== "observado" ? projection.model : ""]);
  downloadCsv(headers, data, "projecao-aerea-" + urf + "-" + (product || category || "todos") + ".csv");
}

function point(index) {
  const item = chartView?.points[index];
  if (!item) return;
  chartView.active = index;
  focusMonth = item.period;
  const x = chartView.x(index);
  chartView.guide.setAttribute("x1", x);
  chartView.guide.setAttribute("x2", x);
  chartView.marker.setAttribute("cx", x);
  chartView.marker.setAttribute("cy", chartView.y(item.value));
  chartView.marker.setAttribute("fill", item.scenario ? "var(--scenario-ink)" : item.projected ? "var(--forecast-ink)" : metrics[metric].color);
  const format = metrics[metric];
  byId("point").replaceChildren(
    element("strong", periodLabel(item.period)),
    document.createTextNode(format.prefix + integer.format(item.value) + format.suffix +
      " · " + (item.scenario ? "Cenário" : item.projected ? "Previsão" : "Observado")),
  );
}

function drawChart() {
  if (!selection || byId("results").hidden) return;
  const chart = byId("chart");
  const width = Math.max(270, Math.floor(byId("chart-wrap").clientWidth));
  const height = width < 520 ? 280 : 346;
  const left = 57, right = width - 19, top = 24, bottom = height - 29;
  const canOverlay = Boolean(projection && selection.last === periods.length - 1);
  const overlay = canOverlay && byId("forecast-toggle").checked;
  byId("forecast-toggle").disabled = !canOverlay;
  byId("forecast-legend").hidden = !overlay;
  byId("scenario-legend").hidden = !overlay || futurePeriods.length <= validationMonths;
  byId("chart-help").textContent = projection && !canOverlay
    ? "Inclua o último mês observado no filtro para sobrepor a projeção. A tabela anual usa o histórico completo."
    : "Use o cursor ou as setas do teclado para ler os meses. Zero indica ausência de valor registrado.";
  const points = selection.trend.map((entry, index) => ({
    period: periods[selection.first + index], value: entry[metric], projected: false,
  }));
  const observedCount = points.length;
  if (overlay) futurePeriods.forEach((period, index) => points.push({
    period, value: projection.values[index], projected: true, scenario: index >= validationMonths,
  }));
  const forecastEnd = Math.min(points.length, observedCount + validationMonths);
  const values = points.map((item) => item.value);
  const rough = Math.max(1, ...values) / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].find((size) => size * magnitude >= rough) * magnitude;
  const maximum = Math.ceil(Math.max(step, ...values) / step) * step;
  const x = (index) => values.length === 1 ? (left + right) / 2 : left + index * (right - left) / (values.length - 1);
  const y = (value) => bottom - value * (bottom - top) / maximum;
  const color = metrics[metric].color;
  byId("forecast-legend").parentElement.style.setProperty("--series", color);

  chart.replaceChildren();
  chart.setAttribute("viewBox", "0 0 " + width + " " + height);
  chart.setAttribute("aria-label", metrics[metric].label + " mensal de " + points[0].period + " a " + points.at(-1).period);
  if (overlay) {
    const split = (x(observedCount - 1) + x(observedCount)) / 2;
    const boundary = forecastEnd < points.length ? (x(forecastEnd - 1) + x(forecastEnd)) / 2 : right;
    chart.append(svg("rect", { x: split, y: top, width: boundary - split, height: bottom - top, class: "forecast-fill" }));
    if (boundary - split >= 76) chart.append(svg("text", { x: (boundary + split) / 2, y: 14, "text-anchor": "middle", class: "annotation" }, "PREVISÃO"));
    if (forecastEnd < points.length) {
      chart.append(svg("rect", { x: boundary, y: top, width: right - boundary, height: bottom - top, class: "scenario-fill" }));
      if (right - boundary >= 72) chart.append(svg("text", { x: right - 4, y: 14, "text-anchor": "end", class: "annotation scenario-annotation" }, "CENÁRIO"));
    }
  }
  for (let tick = 0; tick <= maximum + step / 1000; tick += step) {
    chart.append(
      svg("line", { x1: left, y1: y(tick), x2: right, y2: y(tick), class: "grid" }),
      svg("text", { x: left - 7, y: y(tick) + 4, "text-anchor": "end", class: "axis" }, compact.format(tick)),
    );
  }
  const stride = Math.max(1, Math.ceil((values.length - 1) / (width < 520 ? 4 : 8)));
  for (let index = 0; index < values.length; index++) {
    if (index !== values.length - 1 && (index % stride || values.length - 1 - index < stride / 2)) continue;
    const label = points[index].period;
    chart.append(svg("text", { x: x(index), y: bottom + 18, "text-anchor": "middle", class: "axis" },
      label.slice(5) + "/" + label.slice(2, 4)));
  }
  const coords = (start, end) => values.slice(start, end).map((value, index) => x(start + index) + "," + y(value)).join(" ");
  const line = { fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linejoin": "round" };
  chart.append(svg("polyline", { ...line, points: coords(0, observedCount) }));
  if (overlay) chart.append(svg("polyline", {
    ...line, stroke: "var(--forecast-ink)", points: coords(observedCount - 1, forecastEnd), "stroke-dasharray": "6 5", "data-forecast": "true",
  }));
  if (overlay && forecastEnd < points.length) chart.append(svg("polyline", {
    ...line, stroke: "var(--scenario-ink)", points: coords(forecastEnd - 1, points.length),
    "stroke-dasharray": "2 5", "stroke-opacity": ".76", "data-scenario": "true",
  }));
  const guide = svg("line", { y1: top, y2: bottom, stroke: color, "stroke-opacity": ".6", "stroke-dasharray": "3 4" });
  const marker = svg("circle", { r: 4.8, fill: color, stroke: "#fff", "stroke-width": 1.8 });
  chart.append(guide, marker);
  const half = (right - left) / (2 * Math.max(1, values.length - 1));
  for (let index = 0; index < values.length; index++) {
    const start = Math.max(left, x(index) - half);
    const end = Math.min(right, x(index) + half);
    chart.append(svg("rect", { x: start, width: end - start, y: top, height: bottom - top, fill: "transparent", class: "chart-hit", "data-index": index }));
  }
  chartView = { x, y, guide, marker, points };
  const previous = points.findIndex((item) => item.period === focusMonth);
  point(previous >= 0 ? previous : observedCount - 1);
}
function render() {
  if (!rows) return;
  const first = periods.indexOf(byId("from").value);
  const last = periods.indexOf(byId("to").value);
  if (first < 0 || last < first) {
    byId("status").textContent = "Selecione um intervalo válido dentro da cobertura exibida.";
    byId("results").hidden = true;
    return;
  }
  const country = byId("destination").value;
  const countryId = country === "" ? null : Number(country);
  selection = summarize(first, last, countryId);
  const historical = first === 0 && last === periods.length - 1
    ? selection.trend : summarize(0, periods.length - 1, countryId).trend;
  const forecast = projectMonthly(historical.map((month) => month[metric]), futurePeriods.length);
  projection = forecast ? { ...forecast, historical } : null;
  byId("status").textContent = selection.detail.length ? "" : "Nenhum embarque registrado nesse recorte.";
  byId("download").disabled = !selection.detail.length;
  const origin = metadata.origins.find((entry) => entry.id === byId("origin").value);
  const code = byId("product").value;
  const category = byId("category").value;
  byId("series-title").textContent = code ? metadata.products[code] : category ? chapterNames[category] || categoryName(category) : "Todos os produtos";
  byId("series-kicker").textContent = code ? "Exportação aérea · NCM " + code
    : category ? "Exportação aérea · Capítulo SH2 " + category : "Exportação aérea · Pauta completa";
  byId("series-description").textContent = (code ? "" : "Todos os produtos · ") +
    originName(origin) + " → " + (country ? metadata.countries[Number(country)] : "Todos os destinos") +
    " · " + (metric === "kg" ? "Peso líquido (kg)" : "Valor (US$ FOB)");
  byId("results").hidden = false;
  drawCards();
  drawRanking();
  drawForecast();
  drawChart();
}

function csvCell(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function download() {
  const headers = ["mes", "urf_embarque", "capitulo_sh2", "ncm", "produto", "pais_destino", "vl_fob_usd", "kg_liquido"];
  const urf = byId("origin").value;
  const product = byId("product").value;
  const records = selection.detail.map(([month, country, fob, kg]) =>
    [periods[month], urf, byId("category").value, product, productName(product), metadata.countries[country], fob, kg]);
  downloadCsv(headers, records, "comex-aereo-" + urf + "-" + (product || byId("category").value || "todos") + ".csv");
}

function downloadCsv(headers, records, filename) {
  const content = [headers, ...records].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }));
  const link = element("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function init() {
  [metadata, chapterNames] = await Promise.all([loadJson("dados/index.json"), loadJson("dados/capitulos.json")]);
  periods = monthList(metadata.start, metadata.end);
  futurePeriods = monthList(metadata.end, "2030-12").slice(1);
  const airports = metadata.origins.filter((origin) => origin.airport).length;
  byId("coverage").textContent = periodLabel(metadata.start) + " a " + periodLabel(metadata.end) +
    " · " + airports + " códigos com aeroporto identificado · " + metadata.origins.length + " URFs";
  fillOrigins();
  for (const [id, value] of [["from", metadata.start], ["to", metadata.end]]) {
    const field = byId(id);
    field.min = metadata.start;
    field.max = metadata.end;
    field.value = value;
  }
  byId("explorer").hidden = false;
  const example = metadata.example;
  if (example) {
    byId("example").hidden = false;
    byId("example").addEventListener("click", () => {
      byId("from").value = metadata.start;
      byId("to").value = metadata.end;
      byId("destination").value = "";
      changeOrigin(example.origin, example.product);
    });
  }
  byId("origin").addEventListener("change", () =>
    changeOrigin(byId("origin").value, byId("product").value, byId("category").value));
  byId("category").addEventListener("change", () => {
    byId("search").value = "";
    fillProducts("");
    changeProduct();
  });
  byId("product").addEventListener("change", changeProduct);
  byId("search").addEventListener("input", () => fillProducts(byId("product").value));
  byId("search").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const first = matchingProducts()[0];
    if (first) {
      byId("product").value = first;
      changeProduct();
    }
  });
  for (const id of ["from", "to", "destination"]) byId(id).addEventListener("change", render);
  document.querySelectorAll("[data-metric]").forEach((button) => {
    button.addEventListener("click", () => {
      metric = button.dataset.metric;
      document.querySelectorAll("[data-metric]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      render();
    });
  });
  byId("download").addEventListener("click", download);
  byId("forecast-toggle").addEventListener("change", drawChart);
  byId("forecast-csv").addEventListener("click", downloadForecast);
  for (const name of ["pointermove", "click"]) {
    byId("chart").addEventListener(name, (event) => {
      const index = event.target.dataset.index;
      if (index !== undefined && Number(index) !== chartView?.active) point(Number(index));
    });
  }
  byId("chart").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    if (chartView) point(chartView.active + (event.key === "ArrowLeft" ? -1 : 1));
  });
  new ResizeObserver(drawChart).observe(byId("chart-wrap"));
  const url = new URLSearchParams(location.search);
  const initialOrigin = url.get("origem");
  const requested = metadata.origins.some((origin) => origin.id === initialOrigin);
  const largest = [...metadata.origins].sort((a, b) => b.fob - a.fob)[0];
  await changeOrigin(requested ? initialOrigin : (example?.origin || largest.id),
    requested ? (url.get("produto") || "") : (example?.product || ""), url.get("capitulo") || "");
}

init().catch((error) => {
  console.error(error);
  byId("coverage").hidden = true;
  showError("Não foi possível abrir os dados de exportação aérea. Recarregue a página.");
});
