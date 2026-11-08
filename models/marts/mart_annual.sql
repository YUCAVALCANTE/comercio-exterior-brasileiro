with partners as (
    select year, flow, country, sum(fob_usd)::bigint as fob_usd
    from {{ ref('fct_trade') }}
    group by all
),
annual as (
    select
        year,
        flow,
        sum(fob_usd)::bigint as fob_usd,
        count(*) filter (where fob_usd > 0) as partner_count,
        arg_max(country, fob_usd order by country) as top_partner,
        max(fob_usd)::double / nullif(sum(fob_usd), 0) as top_share,
        sum(fob_usd::double * fob_usd) / nullif(pow(sum(fob_usd), 2), 0) as hhi
    from partners
    group by year, flow
),
lagged as (
    select
        *,
        lag(year) over history as previous_year,
        lag(fob_usd) over history as previous_fob
    from annual
    window history as (partition by flow order by year)
)
select
    year, flow, fob_usd, partner_count, top_partner, top_share, hhi,
    case when previous_year = year - 1
        then fob_usd::double / nullif(previous_fob, 0) - 1
    end as yoy
from lagged
