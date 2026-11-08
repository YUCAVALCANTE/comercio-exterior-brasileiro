const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function seasonalQuarter(values) {
  const recent = values.slice(-12);
  const older = values.slice(-24, -12);
  const recentLevel = mean(recent);
  const olderLevel = mean(older);
  // Pool two cycles after removing their levels and shrink seasonal factors toward 1.
  const factors = recent.map((value, i) =>
    0.5 + 0.25 * ((recentLevel ? value / recentLevel : 1) + (olderLevel ? older[i] / olderLevel : 1)),
  );
  const level = mean(recent.slice(-3).map((value, i) => value / factors[i + 9]));
  return factors.map((factor) => factor * level);
}

const baseline = {
  name: "Média dos últimos 12 meses",
  template: (values) => Array(12).fill(mean(values.slice(-12))),
};
const models = [
  { name: "Ingênuo sazonal", seasonal: true, template: (values) => values.slice(-12) },
  {
    name: "Média sazonal de dois anos",
    seasonal: true,
    template: (values) => values.slice(-12).map((value, i) => (value + values.at(i - 24)) / 2),
  },
  { name: "Nível trimestral e sazonalidade suavizada", seasonal: true, template: seasonalQuarter },
  { name: "Média dos últimos três meses", template: (values) => Array(12).fill(mean(values.slice(-3))) },
  baseline,
];

export const validationMonths = 12;

export function projectMonthly(values, horizon) {
  if (horizon < 1 || values.length < 36) return null;
  const recent = values.slice(-24);
  const activeMonths = (months) => months.filter((value) => value > 0).length;
  if (activeMonths(recent.slice(0, 12)) < 3 || activeMonths(recent.slice(12)) < 3) return null;

  const folds = values.length - 35;
  let observed = 0;
  const errors = models.map(() => 0);
  for (let origin = 24; origin + validationMonths <= values.length; origin++) {
    const training = values.slice(0, origin);
    const actual = values.slice(origin, origin + validationMonths);
    const templates = models.map((model) => model.template(training));
    actual.forEach((value, month) => {
      observed += value;
      templates.forEach((template, index) => {
        errors[index] += Math.abs(value - template[month]);
      });
    });
  }
  if (!observed) return null;

  const ranked = models.map((model, index) => ({ ...model, wape: errors[index] / observed }))
    .sort((first, second) => first.wape - second.wape);
  const best = ranked[0];
  const seasonal = ranked.find((model) => model.seasonal);
  const seasonalTie = !best.seasonal && seasonal.wape - best.wape <= 0.005;
  const winner = seasonalTie ? seasonal : best;
  const template = winner.template(values);
  return {
    model: winner.name,
    wape: winner.wape,
    bestWape: best.wape,
    baselineWape: errors[models.indexOf(baseline)] / observed,
    seasonalTie,
    folds,
    values: Array.from({ length: horizon }, (_, index) => template[index % 12]),
  };
}
