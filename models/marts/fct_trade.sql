select
    month,
    year(month) as year,
    flow,
    country,
    state,
    chapter,
    sum(fob_usd)::bigint as fob_usd,
    sum(net_kg)::bigint as net_kg
from {{ ref('stg_trade') }}
group by all
