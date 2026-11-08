"""Validação temporal e projeção nacional do comércio de bens até 2030."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing

from forecast_data import HISTORY, PUBLIC_DATA, START
from pipeline import FLOWS

END_YEAR = 2030
SELECTION_END = 2018
MODEL_NAMES = {
    "naive": "Ingênuo sazonal",
    "holt": "Holt-Winters amortecido",
    "trend": "Regressão log-linear sazonal",
}


def read_history():
    snapshot = pd.read_csv(HISTORY, dtype={"mes": str, "publicacao_mdic": str})
    history = snapshot.set_index(pd.PeriodIndex(snapshot.pop("mes"), freq="M"))
    dates = pd.period_range(START, history.index[-1], freq="M")
    if not history.index.equals(dates) or history[list(FLOWS)].isna().any().any():
        raise ValueError("A série deve ter todos os meses em ordem, sem lacunas ou duplicatas.")
    if (history[list(FLOWS)] <= 0).any().any() or history["publicacao_mdic"].nunique() != 1:
        raise ValueError("O histórico exige valores positivos e uma única data de divulgação.")
    return history[list(FLOWS)], history["publicacao_mdic"].iloc[0]


def forecast(values, steps, model):
    if model == "naive":
        return np.resize(values[-12:], steps)
    if model == "holt":
        fit = ExponentialSmoothing(
            np.log(values), trend="add", damped_trend=True, seasonal="add",
            seasonal_periods=12, initialization_method="estimated",
        ).fit(use_brute=True)
        if not fit.mle_retvals.success:
            raise RuntimeError("A otimização de Holt-Winters não convergiu.")
        return np.exp(fit.forecast(steps))

    def design(months):
        trend = (months - len(values) + 1) / 12
        seasons = np.eye(12)[months % 12, 1:]
        return np.column_stack((np.ones(len(months)), trend, seasons))

    recent = np.arange(len(values) - 120, len(values))
    coefs, *_ = np.linalg.lstsq(design(recent), np.log(values[-120:]), rcond=None)
    return np.exp(design(np.arange(len(values), len(values) + steps)) @ coefs)


def forecast_years(history, origin, final_year, flow, model):
    dates = pd.period_range(origin + 1, f"{final_year}-12", freq="M")
    path = pd.Series(forecast(history.loc[:origin, flow].to_numpy(), len(dates), model), index=dates)
    if not np.isfinite(path).all() or (path <= 0).any():
        raise ValueError(f"Previsão inválida para {flow} em {origin} com {model}.")
    return path.groupby(path.index.year).sum()


def backtest(history, cutoff, max_lead):
    rows = []
    last_full_year = cutoff.year - (cutoff.month != 12)
    for year in range(history.index[0].year + 10, last_full_year + 1):
        origin = pd.Period(f"{year}-{cutoff.month:02d}", freq="M")
        last_target = min(last_full_year, year + max_lead)
        if origin >= pd.Period(f"{last_target}-12", freq="M"):
            continue
        print(f"Validação com corte em {origin}", flush=True)
        for flow in FLOWS:
            for model in MODEL_NAMES:
                totals = forecast_years(history, origin, last_target, flow, model)
                for target, projected in totals.items():
                    actual = history.loc[str(target), flow].sum()
                    known = history.loc[f"{target}-01":origin, flow].sum() if target == year else 0
                    estimate = known + projected
                    rows.append({
                        "origin": year, "target": target, "lead": target - year, "flow": flow,
                        "model": model, "actual": float(actual), "estimate": float(estimate),
                        "absolute_error": float(abs(actual - estimate)),
                        "error_ratio": float((actual - estimate) / projected),
                        "phase": "selecao" if target <= SELECTION_END else "teste",
                    })
    return pd.DataFrame(rows)


def score(folds, max_lead):
    table = (
        folds.groupby(["phase", "flow", "model", "lead"], as_index=False)
        .agg(total_absolute_error=("absolute_error", "sum"), total_actual=("actual", "sum"),
             total_estimate=("estimate", "sum"), n=("target", "size"))
    )
    table["wape"] = table["total_absolute_error"] / table["total_actual"]
    table["mae"] = table["total_absolute_error"] / table["n"]
    table["bias"] = table["total_estimate"] / table["total_actual"] - 1
    selection = table[(table["phase"] == "selecao") & table["lead"].between(1, max_lead)]
    selection_scores = selection.groupby(["flow", "model"])["wape"].mean()
    selected = {
        flow: min(MODEL_NAMES, key=lambda model: selection_scores.loc[flow, model])
        for flow in FLOWS
    }
    metrics = []
    for flow in FLOWS:
        for model in MODEL_NAMES:
            tests = table[(table["phase"] == "teste") & (table["flow"] == flow) & (table["model"] == model)]
            first = tests[tests["lead"] == 1].iloc[0]
            last = tests[tests["lead"] == max_lead].iloc[0]
            metrics.append({
                "flow": flow, "model": MODEL_NAMES[model], "selected": selected[flow] == model,
                "selection_wape": round(selection_scores.loc[flow, model], 6),
                "wape_first": round(first["wape"], 6), "wape_last": round(last["wape"], 6),
                "mae_last": round(last["mae"]), "bias_last": round(last["bias"], 6),
                "n_last": int(last["n"]),
            })
    return selected, metrics, table[["phase", "flow", "model", "lead", "n", "wape", "mae", "bias"]]


def annual_rows(history, cutoff, selected, folds):
    annual = history.groupby(history.index.year).sum()
    paths = {
        flow: forecast_years(history, cutoff, END_YEAR, flow, selected[flow])
        for flow in FLOWS
    }
    future = paths["export"].index
    rows = []
    for year in range(history.index[0].year, END_YEAR + 1):
        observed = history[history.index.year == year]
        known = observed.sum()
        if year not in future:
            row = {
                "year": year, "type": "observado", "known_months": 12,
                **{flow: int(annual.loc[year, flow]) for flow in FLOWS},
            }
            row["balance"] = row["export"] - row["import"]
            rows.append(row)
            continue

        lead = year - cutoff.year
        candidates = folds[(folds["phase"] == "teste") & (folds["lead"] == lead)]
        errors = pd.concat({
            flow: candidates[
                (candidates["flow"] == flow) & (candidates["model"] == selected[flow])
            ].set_index("origin")["error_ratio"]
            for flow in FLOWS
        }, axis=1).dropna()
        if len(errors) < 5:
            raise ValueError(f"Amostra insuficiente para calcular a faixa do ano {year}.")

        row = {"year": year, "type": "parcial" if len(observed) else "projetado",
               "known_months": len(observed), "range_n": len(errors)}
        scenarios = {}
        for flow in FLOWS:
            forecast_value = paths[flow].loc[year]
            row[flow] = int(round(known[flow] + forecast_value))
            scenarios[flow] = known[flow] + forecast_value * (1 + errors[flow])
        row["balance"] = row["export"] - row["import"]
        scenarios["balance"] = scenarios["export"] - scenarios["import"]
        for series, values in scenarios.items():
            estimate = row[series]
            radius = (values - estimate).abs().quantile(0.8)
            lower_limit = known[series] if series in FLOWS else -np.inf
            row[series + "_low"] = int(round(max(lower_limit, estimate - radius)))
            row[series + "_high"] = int(round(estimate + radius))
        rows.append(row)
    return rows


def write_text(path: Path, content: str):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def main():
    history, published = read_history()
    cutoff = history.index[-1]
    if cutoff >= pd.Period(f"{END_YEAR}-12", freq="M"):
        raise ValueError("O horizonte do projeto precisa ultrapassar o último mês observado.")
    max_lead = max(1, END_YEAR - cutoff.year)
    folds = backtest(history, cutoff, max_lead)
    selected, metrics, scores = score(folds, max_lead)
    rows = annual_rows(history, cutoff, selected, folds)
    result = {
        "cutoff": str(cutoff), "mdic_release": published, "first": str(history.index[0]),
        "end_year": END_YEAR, "selection_end": SELECTION_END, "last_lead": max_lead,
        "series_months": len(history), "models": {flow: MODEL_NAMES[m] for flow, m in selected.items()},
        "metrics": metrics, "annual": rows,
    }
    write_text(PUBLIC_DATA / "projecao.json", json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2) + "\n")
    write_text(PUBLIC_DATA / "validacao.csv", scores.to_csv(index=False, lineterminator="\n"))
    write_text(PUBLIC_DATA / "projecao-anual.csv", pd.DataFrame(rows).astype({
        column: "Int64" for column in pd.DataFrame(rows).columns
        if column not in {"type", "year", "known_months"}
    }).to_csv(index=False, lineterminator="\n"))
    print(json.dumps({"cutoff": str(cutoff), "models": result["models"], "2030": rows[-1]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
