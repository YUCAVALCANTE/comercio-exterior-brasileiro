with calculated as (
    select month, flow, sum(fob_usd) as fob_usd, sum(net_kg) as net_kg
    from {{ ref('fct_trade') }}
    group by month, flow
)
select
    coalesce(a.month, b.month) as month,
    coalesce(a.flow, b.flow) as flow,
    a.fob_usd as model_fob,
    b.fob_usd as official_fob,
    a.net_kg as model_kg,
    b.net_kg as official_kg
from calculated as a
full join {{ source('comex', 'totals') }} as b using (month, flow)
where a.fob_usd is distinct from b.fob_usd
   or a.net_kg is distinct from b.net_kg
