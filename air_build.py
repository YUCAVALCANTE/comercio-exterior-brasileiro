"""Gera os dados estáticos do painel de exportações aéreas."""

import argparse
from collections import defaultdict
import csv
from io import StringIO
import json
from pathlib import Path
import re
import unicodedata

import duckdb
import pandas as pd
import requests

from air_source import AIR_SOURCE
from forecast_data import API, query
from pipeline import ROOT

PUBLIC = ROOT / "docs" / "aeroportos" / "dados"
AIR_CODE = "04"
PAPAYA = "08072000"
SALVADOR = ("0517801", "0517700", "0517601")


def lookup(filename, code, label, width):
    raw = (AIR_SOURCE / filename).read_bytes()
    try:
        decoded = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        decoded = raw.decode("latin-1")
    return {
        row[code].strip().zfill(width): row[label].strip()
        for row in csv.DictReader(StringIO(decoded), delimiter=";")
        if row[code] and row[label]
    }


def read_routes(start, end):
    files = [str(AIR_SOURCE / f"EXP_{year}.csv") for year in range(start.year, end.year + 1)]
    with duckdb.connect(config={"threads": 4, "temp_directory": str(AIR_SOURCE / "duckdb-temp")}) as db:
        db.execute("""
            create temporary table air as
            select
                make_date(cast(CO_ANO as integer), cast(CO_MES as integer), 1) as month,
                lpad(coalesce(CO_URF, '0'), 7, '0') as urf,
                lpad(coalesce(CO_NCM, '0'), 8, '0') as product,
                lpad(coalesce(CO_PAIS, '0'), 3, '0') as country,
                cast(VL_FOB as bigint) as fob,
                cast(KG_LIQUIDO as bigint) as kg
            from read_csv(?, header=true, delim=';', all_varchar=true, strict_mode=true)
            where cast(CO_VIA as integer) = ? and month between ? and ?
        """, [files, int(AIR_CODE), start.start_time.date(), end.start_time.date()])
        totals = {
            month.strftime("%Y-%m"): (fob, kg) for month, fob, kg in db.execute("""
                select month, sum(fob)::bigint, sum(kg)::bigint from air group by month order by month
            """).fetchall()
        }
        if list(totals) != list(map(str, pd.period_range(start, end, freq="M"))):
            raise ValueError("A cobertura mensal da extração aérea está incompleta.")
        if db.execute("select count(*) from air where fob < 0 or kg < 0 or fob is null or kg is null").fetchone()[0]:
            raise ValueError("Há valores negativos ou ausentes no extrato aéreo.")
        routes = db.execute("""
            select month, urf, product, country, sum(fob)::bigint, sum(kg)::bigint
            from air group by all order by urf, product, month, country
        """).fetchall()
    return routes, totals


def verify_official(totals, start, end):
    reference = {}
    with requests.Session() as session:
        update = query(session, "GET", API + "/dates/updated")
        for year in range(start.year, end.year + 1):
            first = max(start, pd.Period(f"{year}-01", freq="M"))
            last = min(end, pd.Period(f"{year}-12", freq="M"))
            payload = {
                "flow": "export", "monthDetail": True,
                "period": {"from": str(first), "to": str(last)},
                "filters": [{"filter": "via", "values": [AIR_CODE]}],
                "details": [], "metrics": ["metricFOB", "metricKG"],
            }
            rows = query(session, "POST", API, payload)["list"]
            for row in rows:
                key = f'{int(row["year"]):04d}-{int(row["monthNumber"]):02d}'
                if key in reference:
                    raise ValueError(f"Mês duplicado na consulta oficial: {key}.")
                reference[key] = (int(row["metricFOB"]), int(row["metricKG"]))
            print(f"Consulta de conferência recebida para {year}", flush=True)
    differences = [(key, totals.get(key), reference.get(key))
                   for key in sorted(totals.keys() | reference.keys()) if totals.get(key) != reference.get(key)]
    if differences:
        raise ValueError(f"Os CSVs divergem da API em {len(differences)} meses: {differences[:5]}")
    return update["updated"]


def json_write(path: Path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")) + "\n",
                         encoding="utf-8")
    temporary.replace(path)


def airport_name(name):
    plain = "".join(c for c in unicodedata.normalize("NFD", name) if not unicodedata.combining(c))
    return bool(re.search(r"\bAEROP(?:ORTO|\.)", plain.upper()))


def package(routes, totals, start, end, updated):
    product_names = lookup("NCM.csv", "CO_NCM", "NO_NCM_POR", 8)
    country_names = lookup("PAIS.csv", "CO_PAIS", "NO_PAIS", 3)
    origin_names = lookup("URF.csv", "CO_URF", "NO_URF", 7)
    countries = sorted({row[3] for row in routes})
    country_index = {code: index for index, code in enumerate(countries)}
    chapters = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    all_products = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    values = defaultdict(lambda: defaultdict(int))
    packed_totals = defaultdict(lambda: [0, 0])
    first_month = start.year * 12 + start.month
    products = set()
    for month, urf, product, country, fob, kg in routes:
        if not (urf.isdecimal() and product.isdecimal() and country.isdecimal()):
            raise ValueError(f"Código inválido no registro {urf} / {product} / {country}.")
        offset = month.year * 12 + month.month - first_month
        country_id = country_index[country]
        chapters[urf][product[:2]][product].append([offset, country_id, fob, kg])
        amounts = all_products[urf][offset, country_id]
        amounts[0] += fob
        amounts[1] += kg
        values[urf][product] += fob
        month_totals = packed_totals[month.strftime("%Y-%m")]
        month_totals[0] += fob
        month_totals[1] += kg
        products.add(product)
    if {month: tuple(amounts) for month, amounts in packed_totals.items()} != totals:
        raise ValueError("O empacotamento alterou os totais mensais.")

    origins = []
    for urf, packs in sorted(chapters.items()):
        name = origin_names.get(urf, f"Unidade {urf} sem nome na tabela de referência")
        origin_path = PUBLIC / "origens" / urf
        product_codes = sorted(values[urf], key=lambda code: (-values[urf][code], code))
        json_write(origin_path / "catalogo.json", product_codes)
        json_write(origin_path / "todos.json", [[*key, *amounts] for key, amounts in sorted(all_products[urf].items())])
        for chapter, group in sorted(packs.items()):
            json_write(origin_path / (chapter + ".json"), group)
        origins.append({
            "id": urf, "name": name, "airport": airport_name(name),
            "products": len(product_codes), "fob": sum(values[urf].values()),
        })

    example = next(({"origin": urf, "product": PAPAYA} for urf in SALVADOR if PAPAYA in values.get(urf, {})), None)
    result = {
        "start": str(start), "end": str(end), "updated": updated,
        "origins": origins, "rows": len(routes),
        "countries": [country_names.get(code, f"País não identificado ({code})") for code in countries],
        "products": {code: product_names.get(code, "Descrição indisponível na tabela atual") for code in sorted(products)},
        "example": example, "verified_months": len(totals),
    }
    json_write(PUBLIC / "index.json", result)
    print(json.dumps({
        "rows": len(routes), "origins": len(origins), "airports": sum(item["airport"] for item in origins),
        "products": len(products), "months": len(totals), "example": example,
    }, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="2023-01")
    parser.add_argument("--end", default="2026-10")
    args = parser.parse_args()
    start, end = (pd.Period(value, freq="M") for value in (args.start, args.end))
    if start > end:
        parser.error("O mês inicial deve ser anterior ou igual ao mês final.")
    routes, totals = read_routes(start, end)
    print(f"{len(routes):,} combinações agregadas; verificando os totais oficiais.", flush=True)
    updated = verify_official(totals, start, end)
    package(routes, totals, start, end, updated)


if __name__ == "__main__":
    main()
