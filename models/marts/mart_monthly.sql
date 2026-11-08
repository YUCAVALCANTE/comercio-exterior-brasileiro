select
    month,
    sum(fob_usd) filter (where flow = 'export')::bigint as exports_usd,
    sum(fob_usd) filter (where flow = 'import')::bigint as imports_usd,
    exports_usd - imports_usd as balance_usd
from {{ ref('fct_trade') }}
group by month
