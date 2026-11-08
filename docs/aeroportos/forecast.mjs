const models = [
  {
    name: "Ingênuo sazonal",
    template: (values) => values.slice(-12),
  },
  {
    name: "Média sazonal de dois anos",
    template: (values) => values.slice(-12).map((value, i) => (value + values.at(i - 24)) / 2),
  },
  {
    name: "Média dos últimos 12 meses",
    template: (values) => Array(12).fill(values.slice(-12).reduce((sum, value) => sum + value, 0) / 12),
  },
];

export function projectMonthly(values, horizon) {
  if (horizon < 1 || values.length < 36) return null;
  const recent = values.slice(-24);
  const activeMonths = (months) => months.filter((value) => value > 0).length;
  if (activeMonths(recent.slice(0, 12)) < 3 || activeMonths(recent.slice(12)) < 3) return null;

  const folds = values.length - 35;
  let observed = 0;
  const errors = models.map(() => 0);
  for (let origin = 24; origin + 12 <= values.length; origin++) {
    const training = values.slice(0, origin);
    const actual = values.slice(origin, origin + 12);
    const templates = models.map((model) => model.template(training));
    actual.forEach((value, month) => {
      observed += value;
      templates.forEach((template, index) => {
        errors[index] += Math.abs(value - template[month]);
      });
    });
  }
  if (!observed) return null;

  const winner = errors.indexOf(Math.min(...errors));
  const template = models[winner].template(values);
  return {
    model: models[winner].name,
    wape: errors[winner] / observed,
    folds,
    values: Array.from({ length: horizon }, (_, index) => template[index % 12]),
  };
}
