"use strict";

const labels = {
  export: { name: "Exportações", color: "var(--chart-blue)" },
  import: { name: "Importações", color: "var(--chart-neutral)" },
  balance: { name: "Saldo comercial", color: "var(--chart-teal)" },
};
const types = {
  observado: "Observado",
  parcial: "Observado + projeção",
  projetado: "Projeção",
};
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const integers = new Intl.NumberFormat("pt-BR");
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const byId = (id) => document.getElementById(id);
const billions = (value) => decimal.format(value / 1e9);
const svgNs = "http://www.w3.org/2000/svg";
let selected = "export";
let activeYear;
let data;
let view;

function html(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

function svg(tag, attrs, content) {
  const node = document.createElementNS(svgNs, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (content) node.textContent = content;
  return node;
}

function rangeText(row) {
  if (row.type === "observado") return "—";
  return billions(row[selected + "_low"]) + " a " + billions(row[selected + "_high"]);
}

function drawCards() {
  const latest = data.annual.at(-1);
  const cards = Object.entries(labels).map(([key, label]) => {
    const card = html("article", "", "kpi");
    const range = billions(latest[key + "_low"]) + " a " + billions(latest[key + "_high"]) + " bi";
    card.append(
      html("p", label.name + " em " + latest.year, "kpi-label"),
      html("p", "US$ " + billions(latest[key]) + " bi", "kpi-number"),
      html("p", "Faixa empírica · " + range, "kpi-range"),
    );
    return card;
  });
  byId("kpis").replaceChildren(...cards);
}

function rowStatus(row) {
  return row.type === "parcial" ? types.parcial + " · " + row.known_months + "/12 meses" : types[row.type];
}

function drawTables() {
  const label = labels[selected].name;
  byId("annual-description").textContent = label + " em US$ bilhões FOB. A série completa está no CSV.";
  const recent = data.annual.filter((row) => row.year >= Number(data.cutoff.slice(0, 4)) - 2);
  document.querySelector("#annual tbody").replaceChildren(...recent.map((row) => {
    const tr = html("tr", "", row.type !== "observado" ? "projected" : "");
    const year = html("th", String(row.year));
    year.scope = "row";
    tr.append(year, html("td", rowStatus(row)), html("td", billions(row[selected]), "num"), html("td", rangeText(row), "num"));
    return tr;
  }));
}

function drawScores() {
  const horizon = data.last_lead === 1 ? "1 ano" : data.last_lead + " anos";
  byId("last-lead").textContent = "WAPE a " + horizon;
  byId("last-bias").textContent = "Viés a " + horizon;
  byId("method-text").textContent =
    "Treino com a série mensal desde " + data.first.slice(0, 4) +
    ". Os modelos foram escolhidos em previsões de anos até " + data.selection_end +
    " e avaliados separadamente em anos posteriores. O mês de corte é o mesmo em cada origem histórica.";
  document.querySelector("#scores tbody").replaceChildren(...data.metrics.map((row) => {
    const tr = html("tr", "", row.selected ? "selected" : "");
    const model = html("td", row.model);
    if (row.selected) model.append(html("span", "Selecionado", "badge"));
    tr.append(
      html("td", labels[row.flow].name), model,
      html("td", percent.format(row.selection_wape), "num"),
      html("td", percent.format(row.wape_first), "num"),
      html("td", percent.format(row.wape_last), "num"),
      html("td", percent.format(row.bias_last), "num"),
    );
    return tr;
  }));
}

function selectPoint(year) {
  if (!view) return;
  const row = view.rows.find((candidate) => candidate.year === year);
  if (!row) return;
  activeYear = row.year;
  const x = view.x(row.year);
  view.guide.setAttribute("x1", x);
  view.guide.setAttribute("x2", x);
  view.marker.setAttribute("cx", x);
  view.marker.setAttribute("cy", view.y(row[selected]));
  view.marker.setAttribute("fill", row.type === "observado" ? labels[selected].color : "var(--forecast-ink)");
  const value = "US$ " + billions(row[selected]) + " bi";
  const interval = row.type === "observado" || !byId("range").checked ? "" :
    " · Faixa " + rangeText(row) + " bi (" + row.range_n + " erros históricos)";
  byId("point").replaceChildren(
    html("strong", row.year + " · " + value),
    document.createTextNode(rowStatus(row) + interval),
  );
}

function drawChart() {
  const chart = byId("chart");
  const width = Math.max(260, Math.floor(byId("chart-wrap").clientWidth));
  const height = width < 520 ? 285 : 340;
  const left = 44, right = width - 13, top = 25, bottom = height - 28;
  const rows = data.annual.filter((row) => row.year >= Number(byId("history").value));
  const firstYear = rows[0].year;
  const lastYear = rows.at(-1).year;
  const projected = rows.filter((row) => row.type !== "observado");
  const observed = rows.filter((row) => row.type === "observado");
  const bandVisible = byId("range").checked;
  const color = labels[selected].color;
  byId("range-legend").parentElement.style.setProperty("--series", color);
  const values = rows.map((row) => row[selected]);
  if (bandVisible) projected.forEach((row) => values.push(row[selected + "_low"], row[selected + "_high"]));
  const floor = Math.min(0, ...values);
  const ceiling = Math.max(1e9, ...values);
  const rough = (ceiling - floor) / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].find((size) => size * magnitude >= rough) * magnitude;
  const min = Math.floor(floor / step) * step;
  const max = Math.ceil(ceiling / step) * step;
  const x = (year) => left + (year - firstYear) * (right - left) / (lastYear - firstYear);
  const y = (value) => bottom - (value - min) * (bottom - top) / (max - min);
  const coord = (row, key) => x(row.year) + "," + y(row[key]);
  const coords = (points, key) => points.map((row) => coord(row, key)).join(" ");

  chart.replaceChildren();
  chart.setAttribute("viewBox", "0 0 " + width + " " + height);
  chart.setAttribute("aria-label", labels[selected].name + " por ano de " + firstYear + " a " + lastYear);
  byId("range-legend").hidden = !bandVisible;
  if (projected.length) {
    const shade = Math.max(left, x(projected[0].year - 0.5));
    chart.append(svg("rect", { x: shade, y: top, width: right - shade, height: bottom - top, class: "forecast-fill" }));
    if (right - shade > 90) {
      chart.append(svg("text", { x: right - 6, y: 15, "text-anchor": "end", class: "annotation" }, "PROJEÇÃO"));
    }
  }
  for (let tick = min; tick <= max + step / 1000; tick += step) {
    chart.append(
      svg("line", { x1: left, y1: y(tick), x2: right, y2: y(tick), class: "grid" }),
      svg("text", { x: left - 7, y: y(tick) + 4, "text-anchor": "end", class: "axis" }, integers.format(tick / 1e9)),
    );
  }
  const stride = Math.max(1, Math.ceil((lastYear - firstYear) / (width < 520 ? 5 : 10)));
  for (const row of rows) {
    if ((row.year - firstYear) % stride !== 0 && row.year !== lastYear) continue;
    if (row.year !== lastYear && lastYear - row.year < stride / 2) continue;
    chart.append(svg("text", { x: x(row.year), y: bottom + 18, "text-anchor": "middle", class: "axis" }, String(row.year)));
  }
  if (bandVisible && projected.length) {
    chart.append(svg("polygon", {
      points: coords(projected, selected + "_low") + " " + coords([...projected].reverse(), selected + "_high"),
      fill: "var(--forecast-ink)", "fill-opacity": ".13",
    }));
  }
  chart.append(svg("polyline", { points: coords(observed, selected), fill: "none", stroke: color, "stroke-width": 2.6 }));
  const dashed = observed.length ? [observed.at(-1), ...projected] : projected;
  chart.append(svg("polyline", {
    points: coords(dashed, selected), fill: "none", stroke: "var(--forecast-ink)", "stroke-width": 2.6, "stroke-dasharray": "6 5",
  }));
  for (const row of projected) {
    chart.append(svg("circle", { cx: x(row.year), cy: y(row[selected]), r: 3, fill: "var(--paper)", stroke: "var(--forecast-ink)", "stroke-width": 1.8 }));
  }

  const guide = svg("line", { y1: top, y2: bottom, stroke: color, "stroke-opacity": ".55", "stroke-dasharray": "3 4" });
  const marker = svg("circle", { r: 4.5, fill: color, stroke: "var(--paper)", "stroke-width": 1.8 });
  chart.append(guide, marker);
  const halfStep = (right - left) / (lastYear - firstYear) / 2;
  for (const row of rows) {
    const hit = svg("rect", {
      x: Math.max(left, x(row.year) - halfStep), y: top,
      width: Math.min(right, x(row.year) + halfStep) - Math.max(left, x(row.year) - halfStep),
      height: bottom - top, fill: "transparent", class: "chart-hit", "data-year": row.year,
    });
    chart.append(hit);
  }
  view = { rows, x, y, guide, marker };
  selectPoint(rows.some((row) => row.year === activeYear) ? activeYear : lastYear);
}

async function init() {
  const response = await fetch("dados/projecao.json");
  if (!response.ok) throw new Error("Falha ao ler a projeção publicada.");
  data = await response.json();
  activeYear = data.end_year;
  const month = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(data.cutoff + "-01T00:00:00Z"));
  byId("cutoff").textContent = integers.format(data.series_months) + " meses observados · até " + month;
  byId("results").hidden = false;
  drawCards();
  drawTables();
  drawScores();
  drawChart();

  for (const button of document.querySelectorAll("[data-series]")) {
    button.addEventListener("click", () => {
      selected = button.dataset.series;
      document.querySelectorAll("[data-series]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      drawTables();
      drawChart();
    });
  }
  for (const control of ["history", "range"]) byId(control).addEventListener("change", drawChart);
  for (const eventName of ["pointermove", "click"]) {
    byId("chart").addEventListener(eventName, (event) => {
      const year = Number(event.target.dataset.year);
      if (year && year !== activeYear) selectPoint(year);
    });
  }
  byId("chart").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    selectPoint(activeYear + (event.key === "ArrowLeft" ? -1 : 1));
  });
  new ResizeObserver(drawChart).observe(byId("chart-wrap"));
}

init().catch((error) => {
  console.error(error);
  byId("results").hidden = true;
  byId("cutoff").hidden = true;
  byId("load-error").textContent = "Não foi possível abrir os dados da projeção. Recarregue a página.";
  byId("load-error").hidden = false;
});
