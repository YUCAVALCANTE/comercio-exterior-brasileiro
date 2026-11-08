"""Painel local de comércio exterior brasileiro."""

from pathlib import Path

import duckdb
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

DATABASE = Path(__file__).resolve().parent / "data" / "comex.duckdb"
SOURCE = "https://comexstat.mdic.gov.br/pt/home"
DIMENSIONS = {"country": "País parceiro", "state": "UF do produto", "chapter": "Capítulo SH"}
NAMES = {"export": "Exportações", "import": "Importações"}
COLORS = {"Exportações": "#007b6d", "Importações": "#2764a5", "Saldo": "#66419e"}

st.set_page_config(page_title="Comércio exterior brasileiro", page_icon="🇧🇷", layout="wide")
st.html("""
<style>
.block-container { max-width: 1350px; padding-top: 2rem; }
.comex-hero {
    border-radius: 18px; padding: 1.65rem 2rem; margin-bottom: 1.1rem;
    background: linear-gradient(110deg, #0b2f45 20%, #0b514d 100%); color: #fff;
}
.comex-hero span { color: #a8e9db; font-weight: 700; font-size: .76rem; letter-spacing: .1em; }
.comex-hero h1 { color: #fff; font-size: clamp(1.55rem, 4vw, 2.65rem); margin: .35rem 0; padding: 0; }
.comex-hero p { color: #d7e9eb; margin: .35rem 0 0; }
</style>
<div class="comex-hero">
  <span>BRASIL · COMÉRCIO DE BENS</span>
  <h1>Comércio exterior brasileiro</h1>
  <p>Exportações, importações e concentração por parceiro comercial.</p>
</div>
""")


def br(value, places=1):
    return f"{value:,.{places}f}".translate(str.maketrans(",.", ".,"))


def money(value):
    if abs(value) >= 1_000_000_000:
        return f"US$ {br(value / 1_000_000_000)} bi"
    if abs(value) >= 1_000_000:
        return f"US$ {br(value / 1_000_000)} mi"
    return f"US$ {br(value, 0)}"


def percent(value):
    return "—" if pd.isna(value) else f"{br(100 * value)}%"


if not DATABASE.is_file():
    st.info("Execute `python pipeline.py` no ambiente do projeto para gerar o banco de dados.")
    st.stop()

with duckdb.connect(str(DATABASE), read_only=True) as db:
    years = [year for (year,) in db.execute("select distinct year from analytics.fct_trade order by year").fetchall()]
    st.sidebar.header("Filtros")
    selected_years = st.sidebar.multiselect("Anos completos", years, default=years)
    if not selected_years:
        st.info("Selecione pelo menos um ano para consultar os dados.")
        st.stop()

    year_filter = "year in (select unnest(?))"
    options = db.execute(
        f"select {', '.join(f'list(distinct {d} order by {d})' for d in DIMENSIONS)} "
        f"from analytics.fct_trade where {year_filter}",
        [selected_years],
    ).fetchone()
    terms = [year_filter]
    parameters = [selected_years]
    for (column, label), choices in zip(DIMENSIONS.items(), options):
        selection = st.sidebar.multiselect(label, choices, placeholder="Todos")
        if selection:
            terms.append(f"{column} in (select unnest(?))")
            parameters.append(selection)
    st.sidebar.caption("Os filtros de país, UF e produto se combinam. A análise de concentração usa o Brasil inteiro.")
    where = " and ".join(terms)

    monthly = db.execute(f"""
        select month,
            coalesce(sum(fob_usd) filter (where flow = 'export'), 0)::bigint as "Exportações",
            coalesce(sum(fob_usd) filter (where flow = 'import'), 0)::bigint as "Importações"
        from analytics.fct_trade where {where}
        group by month order by month
    """, parameters).fetchdf()

    st.sidebar.link_button("Abrir fonte oficial", SOURCE)
    if monthly.empty:
        st.warning("Nenhum registro corresponde a essa combinação de filtros.")
        st.stop()

    overview, rankings, statistics = st.tabs(["Visão geral", "Rankings", "Concentração"])
    with rankings:
        controls = st.columns(3)
        label = controls[0].selectbox("Agrupar por", list(DIMENSIONS.values()))
        dimension = next(column for column, name in DIMENSIONS.items() if name == label)
        direction = controls[1].selectbox("Fluxo", list(NAMES), format_func=NAMES.get)
        metric_label = controls[2].selectbox("Métrica", ["Valor FOB (US$)", "Peso líquido (kg)"])
        metric = "fob_usd" if metric_label == "Valor FOB (US$)" else "net_kg"
        ranked = db.execute(f"""
            with grouped as (
                select {dimension} as label, sum({metric})::bigint as value
                from analytics.fct_trade where {where} and flow = ?
                group by {dimension}
            )
            select label, value, value::double / nullif(sum(value) over (), 0) as share
            from grouped order by value desc, label limit 12
        """, [*parameters, direction]).fetchdf()

    annual = db.execute(
        f"select * from analytics.mart_annual where {year_filter} order by year desc, flow desc",
        [selected_years],
    ).fetchdf()

monthly = monthly.set_index("month")
months = pd.to_datetime([f"{year}-{month:02d}-01" for year in sorted(selected_years) for month in range(1, 13)])
monthly = monthly.reindex(months, fill_value=0)
monthly["Saldo"] = monthly["Exportações"] - monthly["Importações"]
monthly.index.name = "Mês"
totals = monthly.sum()

with overview:
    kpis = st.columns(4)
    for item, title, value in zip(
        kpis,
        ["Exportações", "Importações", "Saldo comercial", "Corrente de comércio"],
        [totals["Exportações"], totals["Importações"], totals["Saldo"], totals["Exportações"] + totals["Importações"]],
    ):
        item.metric(title, money(value), border=True)
    with st.container(border=True):
        st.subheader("Evolução mensal")
        timeline = monthly.reindex(pd.date_range(months.min(), months.max(), freq="MS"))
        figure = go.Figure()
        for label, color in COLORS.items():
            figure.add_scatter(
                x=timeline.index, y=timeline[label] / 1e9, name=label, mode="lines+markers",
                line={"color": color, "width": 2.5, "dash": "dot" if label == "Saldo" else "solid"},
                marker={"size": 5},
                hovertemplate="%{y:.2f} bi<extra>%{fullData.name}</extra>",
            )
        figure.add_hline(y=0, line_color="#a4b5c2", line_width=1)
        figure.update_layout(
            hovermode="x unified", yaxis_title="US$ bilhões FOB", xaxis_title=None,
            legend={"orientation": "h", "y": 1.10}, height=395,
            margin={"l": 12, "r": 12, "t": 40, "b": 20},
        )
        st.plotly_chart(figure, width="stretch", config={"displaylogo": False})
        st.download_button(
            "Baixar série filtrada (CSV)", monthly.to_csv(sep=";", date_format="%Y-%m").encode("utf-8-sig"),
            "serie_mensal_comex.csv", "text/csv",
        )

with rankings:
    if ranked.empty:
        st.info("O fluxo selecionado não tem registros nesse recorte.")
    else:
        scale = 1e9 if ranked["value"].max() >= 1e9 else 1e6 if ranked["value"].max() >= 1e6 else 1
        units = {1e9: "bilhões", 1e6: "milhões", 1: "unidades"}[scale]
        ranked["display"] = ranked["label"].str.slice(0, 54) + ranked["label"].str.len().gt(54).map({True: "…", False: ""})
        figure = px.bar(
            ranked.iloc[::-1], x=ranked["value"].iloc[::-1] / scale, y="display", orientation="h",
            custom_data=["label", "share"], color_discrete_sequence=[COLORS[NAMES[direction]]],
            labels={"x": f"{metric_label} · {units}", "display": label},
        )
        figure.update_traces(hovertemplate="%{customdata[0]}<br>%{x:,.2f}<br>Participação: %{customdata[1]:.1%}<extra></extra>")
        figure.update_layout(height=490, yaxis_title=None, margin={"l": 10, "r": 15, "t": 12, "b": 16})
        st.plotly_chart(figure, width="stretch", config={"displaylogo": False})
        table = pd.DataFrame({
            label: ranked["label"], metric_label: ranked["value"].map(lambda value: br(value, 0)),
            "Participação no recorte": ranked["share"].map(percent),
        })
        st.dataframe(table, hide_index=True, width="stretch")

with statistics:
    st.subheader("Concentração por país parceiro")
    st.caption("Brasil inteiro, nos anos selecionados. A variação anual usa o ano anterior no banco, quando disponível.")
    table = pd.DataFrame({
        "Ano": annual["year"].astype(str), "Fluxo": annual["flow"].map(NAMES),
        "Valor FOB": annual["fob_usd"].map(money), "Variação anual": annual["yoy"].map(percent),
        "Principal parceiro": annual["top_partner"], "Participação": annual["top_share"].map(percent),
        "Parceiros com valor positivo": annual["partner_count"], "HHI": annual["hhi"].map(lambda value: br(value, 3)),
    })
    st.dataframe(table, hide_index=True, width="stretch")
    st.markdown(
        "O HHI é a soma dos quadrados das participações dos parceiros. Em uma escala de 0 a 1, "
        "valores maiores indicam que uma parcela maior do fluxo se concentra em poucos parceiros."
    )

st.caption("Fonte: Comex Stat / SECEX / MDIC · Valores nominais em US$ FOB · UF de origem ou destino do produto.")
