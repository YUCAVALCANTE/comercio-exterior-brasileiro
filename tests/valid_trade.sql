select *
from {{ ref('fct_trade') }}
where fob_usd < 0 or net_kg < 0 or day(month) <> 1
