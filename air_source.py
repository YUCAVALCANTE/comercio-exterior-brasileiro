"""Baixa os microdados de exportação e as tabelas oficiais do Comex Stat."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import shutil
import subprocess
from tempfile import NamedTemporaryFile

from pipeline import DATA

AIR_SOURCE = DATA / "air-source"
BASE = "https://balanca.mdic.gov.br/balanca/bd"
LOOKUPS = ("NCM", "PAIS", "URF")


def download(name, url, refresh):
    destination = AIR_SOURCE / name
    if destination.exists() and not refresh:
        return destination

    curl = shutil.which("curl.exe") or shutil.which("curl")
    if not curl:
        raise RuntimeError("curl é necessário para baixar os CSVs oficiais.")
    with NamedTemporaryFile(prefix=name + "-", suffix=".part", dir=AIR_SOURCE, delete=False) as file:
        temporary = Path(file.name)
    try:
        subprocess.run(
            [curl, "--fail", "--silent", "--show-error", "--location", "--proto", "=https",
             "--proto-redir", "=https", "--retry", "3", "--retry-all-errors", "--connect-timeout", "25",
             "--max-time", "240", "--output", str(temporary), url],
            check=True,
        )
        with temporary.open("rb") as file:
            prefix = file.read(32).lstrip(b"\xef\xbb\xbf\"")
        if not prefix.startswith(b"CO_"):
            raise ValueError(f"O arquivo {name} não tem o cabeçalho CSV esperado.")
        temporary.replace(destination)
        print(f"{name}: {destination.stat().st_size:,} bytes", flush=True)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def fetch_files(years, refresh=False):
    AIR_SOURCE.mkdir(parents=True, exist_ok=True)
    jobs = {
        f"{name}.csv": f"{BASE}/tabelas/{name}.csv"
        for name in LOOKUPS
    }
    jobs.update({
        f"EXP_{year}.csv": f"{BASE}/comexstat-bd/ncm/EXP_{year}.csv"
        for year in years
    })
    with ThreadPoolExecutor(max_workers=4) as workers:
        return list(workers.map(lambda job: download(*job, refresh), jobs.items()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("years", type=int, nargs="+")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    fetch_files(sorted(set(args.years)), args.refresh)


if __name__ == "__main__":
    main()
