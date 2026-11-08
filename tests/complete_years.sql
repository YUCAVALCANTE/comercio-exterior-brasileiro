with expected as (
    select year, flow from {{ source('comex', 'coverage') }}
),
actual as (
    select year, flow, count(distinct month) as month_count
    from {{ ref('fct_trade') }}
    group by year, flow
)
select *
from expected
full join actual using (year, flow)
where expected.year is null or month_count is distinct from 12
