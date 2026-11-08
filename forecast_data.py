"""Atualiza a série nacional do Comex Stat usada na projeção."""

from datetime import datetime
import time

import pandas as pd
import requests

from pipeline import API, FLOWS, ROOT

PUBLIC_DATA = ROOT / "docs" / "dados"
HISTORY = PUBLIC_DATA / "historico-mensal.csv"
START = "1997-01"


def query(session, method, url, payload=None):
    for attempt in range(5):
        try:
            response = session.request(
                method, url, params={"language": "pt"}, json=payload, timeout=(15, 90),
            )
        except (requests.ConnectionError, requests.Timeout):
            if attempt == 4:
                raise
            time.sleep(2 ** (attempt + 1))
            continue
        if response.status_code in {429, 500, 502, 503, 504} and attempt < 4:
            wait = response.headers.get("Retry-After", "")
            time.sleep(max(1, int(wait)) if wait.isdecimal() else 11)
            continue
        response.raise_for_status()
        return response.json()["data"]


def fetch_history():
    with requests.Session() as session:
        session.headers["User-Agent"] = "comex-brasil-portfolio/1.0"
        update = query(session, "GET", f"{API}/dates/updated")
        cutoff = f'{int(update["year"]):04d}-{int(update["monthNumber"]):02d}'
        published = datetime.strptime(update["updated"], "%Y-%m-%d").date().isoformat()
        months = pd.period_range(START, cutoff, freq="M")
        history = pd.DataFrame(index=months)
        cutoff_year = months[-1].year
        last_full_year = cutoff_year - (months[-1].month != 12)
        ranges = [
            (f"{year}-01", f"{min(year + 14, last_full_year)}-12")
            for year in range(months[0].year, last_full_year + 1, 15)
        ]
        # An incomplete end month applies to every year in a multi-year API query.
        if last_full_year < cutoff_year:
            ranges.append((f"{cutoff_year}-01", cutoff))
        for flow in FLOWS:
            rows = []
            for first, last in ranges:
                payload = {
                    "flow": flow, "monthDetail": True, "period": {"from": first, "to": last},
                    "filters": [], "details": [], "metrics": ["metricFOB"],
                }
                rows.extend(query(session, "POST", API, payload)["list"])
                print(f"{flow}: recebido {first} a {last}", flush=True)
            values = pd.Series(
                [int(row["metricFOB"]) for row in rows],
                index=pd.PeriodIndex.from_fields(
                    year=[int(row["year"]) for row in rows],
                    month=[int(row["monthNumber"]) for row in rows],
                    freq="M",
                ),
                name=flow,
            ).sort_index()
            if not values.index.equals(months) or (values <= 0).any():
                raise ValueError(f"{flow} tem valores não positivos, meses duplicados ou cobertura incompleta.")
            history[flow] = values
            print(f"{flow}: {len(values)} meses conferidos até {cutoff}", flush=True)
    history.index.name = "mes"
    history["publicacao_mdic"] = published
    return history


def main():
    history = fetch_history()
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    temporary = HISTORY.with_suffix(".tmp")
    history.to_csv(temporary, lineterminator="\n")
    temporary.replace(HISTORY)
    print(f"Série oficial gravada em {HISTORY}")


if __name__ == "__main__":
    main()
