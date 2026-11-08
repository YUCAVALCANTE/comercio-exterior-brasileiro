"use strict";

const byId = (id) => document.getElementById(id);
const integer = new Intl.NumberFormat("pt-BR");
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });
const names = { "0517801": "Salvador · Aeroporto Internacional", "0517700": "Salvador · Aeroporto Internacional" };
const metrics = {
  kg: { label: "Peso líquido", index: 3, color: "#08725d", prefix: "", suffix: " kg" },
  fob: { label: "Valor FOB", index: 2, color: "#225eaa", prefix: "US$ ", suffix: "" },
};
const aliases = { "08072000": "mamão mamões papaia papaya" };
const cache = new Map();
let metadata;
let periods;
let catalog = [];
let rows = null;
let metric = "kg";
let request = 0;
let selection;
let chartView;
let focusMonth;

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
  const response = await fetch(path);
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

function matchingProducts() {
  const terms = normalize(byId("search").value).split(/\s+/).filter(Boolean);
  return catalog.filter((code) => {
    const searchable = normalize(code + " " + metadata.products[code] + " " + (aliases[code] || ""));
    return terms.every((term) => searchable.includes(term));
  });
}

function fillProducts(code) {
  const matches = matchingProducts();
  const visible = matches.slice(0, 120);
  if (code && catalog.includes(code) && !visible.includes(code)) visible.unshift(code);
  byId("product").replaceChildren(
    option("", "Todos os produtos"),
    ...visible.map((product) => option(product, productName(product))),
  );
  byId("product").value = catalog.includes(code) ? code : "";
  const count = matches.length;
  byId("search-note").textContent = count === 0
    ? "Nenhum produto corresponde à busca neste ponto de embarque."
    : integer.format(count) + " produto(s) encontrado(s)." +
      (count > 120 ? " A lista mostra até 120. Use a busca para localizar os demais." : "");
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

async function changeOrigin(id, preferred = "") {
  const sequence = ++request;
  setLoading("Carregando produtos da origem…");
  byId("origin").value = id;
  byId("search").value = "";
  byId("search").disabled = true;
  byId("product").disabled = true;
  const origin = metadata.origins.find((entry) => entry.id === id);
  byId("origin-note").textContent = officialName(origin) + " · URF " + origin.id +
    (origin.airport ? " · aeroporto identificado na descrição oficial." : " · a fonte não identifica um aeroporto específico.");
  try {
    const result = await loadJson("dados/origens/" + id + "/catalogo.json");
    if (sequence !== request) return;
    catalog = result;
    fillProducts(preferred);
    byId("search").disabled = false;
    byId("product").disabled = false;
    await changeProduct();
  } catch (error) {
    reportLoadError(error, sequence);
  }
}

async function changeProduct() {
  const sequence = ++request;
  const origin = byId("origin").value;
  const code = byId("product").value;
  const previousCountry = byId("destination").value;
  setLoading("Carregando a série mensal e os destinos…");
  try {
    const url = "dados/origens/" + origin + "/" + (code ? code.slice(0, 2) : "todos") + ".json";
    const result = await loadJson(url);
    if (sequence !== request) return;
    rows = code ? result[code] : result;
    const countries = [...new Set(rows.map((row) => row[1]))];
    countries.sort((a, b) => metadata.countries[a].localeCompare(metadata.countries[b], "pt-BR"));
    const dropdown = byId("destination");
    dropdown.replaceChildren(option("", "Todos os países"), ...countries.map((country) => option(country, metadata.countries[country])));
    if (previousCountry !== "" && countries.includes(Number(previousCountry))) dropdown.value = previousCountry;
    dropdown.disabled = false;
    const urlState = new URL(location.href);
    urlState.searchParams.set("origem", origin);
    if (code) urlState.searchParams.set("produto", code);
    else urlState.searchParams.delete("produto");
    history.replaceState(null, "", urlState);
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
    ["Peso líquido", compact.format(selection.kg) + " kg", integer.format(selection.kg) + " kg no recorte", "#08725d"],
    ["Valor FOB", "US$ " + compact.format(selection.fob), "US$ " + integer.format(selection.fob) + " no recorte", "#225eaa"],
    ["Países de destino", integer.format(selection.destinations), "Com registros no recorte", "#8b4b16"],
  ];
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
  const body = document.querySelector("#rank tbody");
  const selectedCountry = byId("destination").value;
  byId("rank-note").textContent = "Ordenado por " + metrics[metric].label.toLowerCase() +
    ". O ranking mantém todos os destinos do produto e do período.";
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

function point(index) {
  if (!chartView || index < 0 || index >= selection.trend.length) return;
  focusMonth = selection.first + index;
  const x = chartView.x(index);
  const current = selection.trend[index];
  chartView.guide.setAttribute("x1", x);
  chartView.guide.setAttribute("x2", x);
  chartView.marker.setAttribute("cx", x);
  chartView.marker.setAttribute("cy", chartView.y(current[metric]));
  byId("point").replaceChildren(
    element("strong", periodLabel(periods[focusMonth])),
    document.createTextNode(integer.format(current.kg) + " kg · US$ " + integer.format(current.fob) + " FOB"),
  );
}

function drawChart() {
  if (!selection || byId("results").hidden) return;
  const chart = byId("chart");
  const width = Math.max(260, Math.floor(byId("chart-wrap").clientWidth));
  const height = width < 520 ? 270 : 320;
  const left = 57, right = width - 19, top = 20, bottom = height - 29;
  const values = selection.trend.map((entry) => entry[metric]);
  const rough = Math.max(1, ...values) / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].find((size) => size * magnitude >= rough) * magnitude;
  const maximum = Math.ceil(Math.max(step, ...values) / step) * step;
  const x = (index) => values.length === 1 ? (left + right) / 2 : left + index * (right - left) / (values.length - 1);
  const y = (value) => bottom - value * (bottom - top) / maximum;
  const color = metrics[metric].color;

  chart.replaceChildren();
  chart.setAttribute("viewBox", "0 0 " + width + " " + height);
  chart.setAttribute("aria-label", metrics[metric].label + " mensal de " + periods[selection.first] + " a " + periods[selection.last]);
  for (let tick = 0; tick <= maximum + step / 1000; tick += step) {
    chart.append(
      svg("line", { x1: left, y1: y(tick), x2: right, y2: y(tick), class: "grid" }),
      svg("text", { x: left - 7, y: y(tick) + 4, "text-anchor": "end", class: "axis" }, compact.format(tick)),
    );
  }
  const stride = Math.max(1, Math.ceil((values.length - 1) / (width < 520 ? 4 : 8)));
  for (let index = 0; index < values.length; index++) {
    if (index !== values.length - 1 && (index % stride || values.length - 1 - index < stride / 2)) continue;
    const label = periods[selection.first + index];
    chart.append(svg("text", { x: x(index), y: bottom + 18, "text-anchor": "middle", class: "axis" },
      label.slice(5) + "/" + label.slice(2, 4)));
  }

  const line = values.map((value, index) => x(index) + "," + y(value)).join(" ");
  chart.append(
    svg("polygon", { points: x(0) + "," + bottom + " " + line + " " + x(values.length - 1) + "," + bottom, fill: color, "fill-opacity": ".1" }),
    svg("polyline", { points: line, fill: "none", stroke: color, "stroke-width": 2.8, "stroke-linejoin": "round" }),
  );
  const guide = svg("line", { y1: top, y2: bottom, stroke: color, "stroke-opacity": ".6", "stroke-dasharray": "3 4" });
  const marker = svg("circle", { r: 4.8, fill: color, stroke: "#fff", "stroke-width": 1.8 });
  chart.append(guide, marker);
  const half = (right - left) / (2 * Math.max(1, values.length - 1));
  for (let index = 0; index < values.length; index++) {
    const start = Math.max(left, x(index) - half);
    const end = Math.min(right, x(index) + half);
    chart.append(svg("rect", { x: start, width: end - start, y: top, height: bottom - top, fill: "transparent", class: "chart-hit", "data-index": index }));
  }
  chartView = { x, y, guide, marker };
  const index = focusMonth >= selection.first && focusMonth <= selection.last ? focusMonth - selection.first : values.length - 1;
  point(index);
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
  selection = summarize(first, last, country === "" ? null : Number(country));
  byId("status").textContent = selection.detail.length ? "" : "Nenhum embarque registrado nesse recorte.";
  byId("download").disabled = !selection.detail.length;
  const origin = metadata.origins.find((entry) => entry.id === byId("origin").value);
  byId("series-description").textContent = productName(byId("product").value) + " · " +
    originName(origin) + (country ? " → " + metadata.countries[Number(country)] : "") +
    " · " + metrics[metric].label + (metric === "kg" ? " (kg)" : " (US$)");
  byId("results").hidden = false;
  drawCards();
  drawRanking();
  drawChart();
}

function csvCell(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function download() {
  const headers = ["mes", "urf_embarque", "ncm", "produto", "pais_destino", "vl_fob_usd", "kg_liquido"];
  const urf = byId("origin").value;
  const product = byId("product").value;
  const records = selection.detail.map(([month, country, fob, kg]) =>
    [periods[month], urf, product, productName(product), metadata.countries[country], fob, kg]);
  const content = [headers, ...records].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }));
  const link = element("a");
  link.href = url;
  link.download = "comex-aereo-" + urf + "-" + (product || "todos") + ".csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function init() {
  metadata = await loadJson("dados/index.json");
  periods = monthList(metadata.start, metadata.end);
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
  byId("origin").addEventListener("change", () => changeOrigin(byId("origin").value, byId("product").value));
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
  for (const name of ["pointermove", "click"]) {
    byId("chart").addEventListener(name, (event) => {
      const index = event.target.dataset.index;
      if (index !== undefined && Number(index) + selection.first !== focusMonth) point(Number(index));
    });
  }
  byId("chart").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    point(focusMonth - selection.first + (event.key === "ArrowLeft" ? -1 : 1));
  });
  new ResizeObserver(drawChart).observe(byId("chart-wrap"));
  const url = new URLSearchParams(location.search);
  const initialOrigin = url.get("origem");
  const requested = metadata.origins.some((origin) => origin.id === initialOrigin);
  const largest = [...metadata.origins].sort((a, b) => b.fob - a.fob)[0];
  await changeOrigin(requested ? initialOrigin : (example?.origin || largest.id),
    requested ? (url.get("produto") || "") : (example?.product || ""));
}

init().catch((error) => {
  console.error(error);
  byId("coverage").hidden = true;
  showError("Não foi possível abrir os dados de exportação aérea. Recarregue a página.");
});
