select
    month,
    flow,
    country,
    state,
    chapter,
    fob_usd,
    net_kg
from {{ source('comex', 'trade') }}
