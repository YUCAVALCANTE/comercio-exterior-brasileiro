"""Build the local warehouse from the official Comex Stat API."""

import argparse
import gzip
import json
import os
import subprocess
import sys
import time
from collections import defaultdict
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory

import duckdb
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
API = "https://api-comexstat.mdic.gov.br/general"
FLOWS = ("export", "import")
DETAILS = {"detail": ["country", "state", "chapter"], "partner_state": ["country", "state"], "total": []}
UNALLOCATED_CHAPTER = "Capítulo não detalhado pela API"
METRICS = ["metricFOB", "metricKG"]
DEFAULT_YEARS = (2023, 2024, 2025)


class QueryTooLarge(Exception):
    """The API cannot return a complete batch at this granularity."""


def api_rows(session, flow, year, first, last, level, refresh):
    stem = f"{flow}_{year}_{first:02d}-{last:02d}_{level}"
    cache = DATA / "raw" / f"{stem}.json.gz"
    if cache.exists() and not refresh:
        with gzip.open(cache, "rt", encoding="utf-8") as file:
            return json.load(file)
    payload = {
        "flow": flow,
        "monthDetail": True,
        "period": {"from": f"{year}-{first:02d}", "to": f"{year}-{last:02d}"},
        "filters": [],
        "details": DETAILS[level],
        "metrics": METRICS,
    }

    for attempt in range(5):
        try:
            response = session.post(API, params={"language": "pt"}, json=payload, timeout=(15, 85))
        except (requests.ConnectionError, requests.Timeout):
            if attempt == 4:
                raise
            time.sleep(2 ** (attempt + 1))
            continue
        if response.status_code in {429, 500, 502, 503, 504} and attempt < 4:
            wait = response.headers.get("Retry-After", "")
            delay = int(wait) if wait.isdecimal() else (11 if response.status_code == 429 else 2 ** (attempt + 1))
            time.sleep(max(1, delay))
            continue
        if not response.ok:
            message = response.text[:500].lower()
            if response.status_code != 429 and any(term in message for term in ("limite", "registros", "too many rows")):
                raise QueryTooLarge(f"{stem}: {response.text[:500]}")
            raise RuntimeError(f"{stem}: HTTP {response.status_code}. {response.text[:500]}")
        rows = response.json()["data"]["list"]
        if not isinstance(rows, list) or not rows:
            raise RuntimeError(f"Resposta vazia ou inválida: {stem}")
        break

    partial = cache.with_suffix(".part")
    with gzip.open(partial, "wt", encoding="utf-8") as file:
        json.dump(rows, file, ensure_ascii=False, separators=(",", ":"))
    partial.replace(cache)
    print(f"{stem}: {len(rows):,} registros recebidos", flush=True)
    return rows


def parse_rows(rows, flow, year, first, last, level):
    records = []
    for row in rows:
        month = int(row["monthNumber"])
        if int(row["year"]) != year or not first <= month <= last:
            raise ValueError("A API retornou um mês fora do período solicitado.")
        values = (date(year, month, 1), flow, int(row["metricFOB"]), int(row["metricKG"]))
        if level != "total":
            values += (row["country"] or "País não informado", row["state"] or "UF não informada")
        if level == "detail":
            chapter = f'{row["chapterCode"]} · {row["chapter"]}' if row["chapterCode"] else "Capítulo não informado"
            values += (chapter,)
        records.append(values)
    return records


def measure_by(records, dimensions):
    totals = defaultdict(lambda: (0, 0))
    for record in records:
        key = tuple(record[index] for index in dimensions)
        fob, kg = totals[key]
        totals[key] = (fob + record[2], kg + record[3])
    return totals


def complete_month(session, flow, year, month, records, expected, refresh):
    rows = api_rows(session, flow, year, month, month, "partner_state", refresh)
    broad = parse_rows(rows, flow, year, month, month, "partner_state")
    broad_totals = measure_by(broad, (4, 5))
    detailed_totals = measure_by(records, (4, 5))
    month_date = date(year, month, 1)
    residuals = []
    for country, state in sorted(broad_totals.keys() | detailed_totals.keys()):
        fob, kg = broad_totals[country, state]
        detail_fob, detail_kg = detailed_totals[country, state]
        missing_fob, missing_kg = fob - detail_fob, kg - detail_kg
        if min(missing_fob, missing_kg) < 0:
            raise ValueError(f"{flow} {month_date:%Y-%m}: os recortes oficiais têm totais incompatíveis.")
        if missing_fob or missing_kg:
            residuals.append((month_date, flow, missing_fob, missing_kg, country, state, UNALLOCATED_CHAPTER))

    subtotal_fob, subtotal_kg = measure_by(broad, (0,))[(month_date,)]
    target_fob, target_kg = expected[month_date]
    missing_fob, missing_kg = target_fob - subtotal_fob, target_kg - subtotal_kg
    if min(missing_fob, missing_kg) < 0:
        raise ValueError(f"{flow} {month_date:%Y-%m}: o recorte supera o total nacional.")
    if missing_fob or missing_kg:
        residuals.append((
            month_date, flow, missing_fob, missing_kg, "País não detalhado pela API",
            "UF não detalhada pela API", UNALLOCATED_CHAPTER,
        ))
    print(f"{flow} {month_date:%Y-%m}: {len(residuals)} diferença(s) mantida(s) sem detalhamento completo", flush=True)
    return records + residuals


def fetch_batch(session, flow, year, first, last, expected, refresh):
    try:
        rows = api_rows(session, flow, year, first, last, "detail", refresh)
    except QueryTooLarge:
        if first == last:
            raise
        middle = (first + last) // 2
        yield from fetch_batch(session, flow, year, first, middle, expected, refresh)
        yield from fetch_batch(session, flow, year, middle + 1, last, expected, refresh)
        return

    records = parse_rows(rows, flow, year, first, last, "detail")
    actual = measure_by(records, (0,))
    dates = [date(year, month, 1) for month in range(first, last + 1)]
    differences = {month for month in dates if actual.get((month,)) != expected[month]}
    if not differences:
        yield records
    elif first == last:
        yield complete_month(session, flow, year, first, records, expected, refresh)
    else:
        yield [record for record in records if record[0] not in differences]
        for month in sorted(differences):
            yield from fetch_batch(session, flow, year, month.month, month.month, expected, refresh)


def extract(path, years, refresh):
    (DATA / "raw").mkdir(parents=True, exist_ok=True)
    with duckdb.connect(str(path)) as db, requests.Session() as session:
        session.headers["User-Agent"] = "comex-brasil-portfolio/1.0"
        db.execute("""
            create schema raw;
            create table raw.trade (
                month date, flow varchar, fob_usd bigint, net_kg bigint,
                country varchar, state varchar, chapter varchar
            );
            create table raw.totals (
                month date, flow varchar, fob_usd bigint, net_kg bigint,
                primary key (month, flow)
            );
            create table raw.coverage (
                year integer, flow varchar, source_rows bigint, primary key (year, flow)
            );
        """)
        columns = ["month", "flow", "fob_usd", "net_kg"]
        for year in years:
            for flow in FLOWS:
                print(f"Processando {year} / {flow}", flush=True)
                rows = api_rows(session, flow, year, 1, 12, "total", refresh)
                totals = parse_rows(rows, flow, year, 1, 12, "total")
                expected = {month: (fob, kg) for month, _, fob, kg in totals}
                if len(totals) != 12 or len(expected) != 12:
                    raise ValueError(f"{year} / {flow}: são necessários 12 meses distintos.")
                db.executemany("insert into raw.totals values (?, ?, ?, ?)", totals)
                count = 0
                for first in (1, 4, 7, 10):
                    for records in fetch_batch(session, flow, year, first, first + 2, expected, refresh):
                        if not records:
                            continue
                        batch = pd.DataFrame.from_records(records, columns=columns + ["country", "state", "chapter"])
                        db.register("batch", batch)
                        db.execute("insert into raw.trade select * from batch")
                        db.unregister("batch")
                        count += len(records)
                db.execute("insert into raw.coverage values (?, ?, ?)", [year, flow, count])


def build(years, refresh):
    DATA.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix="build_", dir=DATA) as directory:
        candidate = Path(directory) / "comex.duckdb"
        extract(candidate, years, refresh)
        env = os.environ | {"COMEX_DB": str(candidate), "DBT_SEND_ANONYMOUS_USAGE_STATS": "false"}
        subprocess.run(
            [sys.executable, "-c", "from dbt.cli.main import cli; cli()", "build", "--profiles-dir", "."],
            cwd=ROOT, env=env, check=True,
        )
        candidate.replace(DATA / "comex.duckdb")
    print(f"Banco validado: {DATA / 'comex.duckdb'}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--years", nargs="+", type=int, default=DEFAULT_YEARS, help="Anos completos.")
    parser.add_argument("--refresh", action="store_true", help="Consulta a fonte mesmo com cache local.")
    args = parser.parse_args()
    years = sorted(set(args.years))
    if any(year < 1997 or year >= date.today().year for year in years):
        parser.error("Selecione anos completos, de 1997 ao último ano encerrado.")
    try:
        build(years, args.refresh)
    except (OSError, ValueError, KeyError, RuntimeError, QueryTooLarge, requests.RequestException,
            duckdb.Error, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"Falha na atualização: {exc}\n")


if __name__ == "__main__":
    main()
