(() => {
  const sourceCases = new Map((window.LOOKML_USE_CASES || []).map(item => [item.id, item]));
  const cases = [];
  const DOCS = {
    overview: { label: "About MetricFlow", url: "https://docs.getdbt.com/docs/build/about-metricflow" },
    latestSpec: { label: "Latest metrics specification", url: "https://docs.getdbt.com/docs/build/latest-metrics-spec" },
    semanticModels: { label: "Semantic models", url: "https://docs.getdbt.com/docs/build/semantic-models" },
    dimensions: { label: "Dimensions and SCD Type II", url: "https://docs.getdbt.com/docs/build/dimensions" },
    simple: { label: "Simple metrics", url: "https://docs.getdbt.com/docs/build/simple" },
    ratio: { label: "Ratio metrics", url: "https://docs.getdbt.com/docs/build/ratio" },
    derived: { label: "Derived metrics", url: "https://docs.getdbt.com/docs/build/derived" },
    cumulative: { label: "Cumulative metrics", url: "https://docs.getdbt.com/docs/build/cumulative" },
    conversion: { label: "Conversion metrics", url: "https://docs.getdbt.com/docs/build/conversion" },
    joins: { label: "MetricFlow joins", url: "https://docs.getdbt.com/docs/build/join-logic" },
    calendar: { label: "Time spine and custom calendars", url: "https://docs.getdbt.com/guides/mf-time-spine" },
    commands: { label: "MetricFlow commands", url: "https://docs.getdbt.com/docs/build/metricflow-commands" },
    exports: { label: "Semantic Layer exports", url: "https://docs.getdbt.com/docs/use-dbt-semantic-layer/exports" },
    cache: { label: "Semantic Layer caching", url: "https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-cache" },
    architecture: { label: "Semantic Layer architecture", url: "https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-architecture" },
    access: { label: "Semantic Layer credentials and access", url: "https://docs.getdbt.com/docs/use-dbt-semantic-layer/setup-sl" },
    models: { label: "dbt SQL models", url: "https://docs.getdbt.com/docs/build/sql-models" },
    incremental: { label: "Incremental models", url: "https://docs.getdbt.com/docs/build/incremental-models" },
    tests: { label: "dbt data tests", url: "https://docs.getdbt.com/docs/build/data-tests" },
    ci: { label: "Continuous integration", url: "https://docs.getdbt.com/docs/deploy/continuous-integration" }
  };
  const labels = {
    core: "Native MetricFlow",
    boundary: "dbt / platform boundary",
    unsupported: "Not supported"
  };
  const BUSINESS_OVERRIDES = {
    "case-06": "Daily CSV exports land under an S3 prefix and analysts need governed metrics through dbt Semantic Layer.",
    "case-07": "Finance publishes CSV extracts in ADLS and needs governed metrics through dbt Semantic Layer.",
    "case-60": "Several consumers need the same audited revenue metric with small presentation differences.",
    "case-62": "Semantic queries and cached exports should refresh after the warehouse transformation job completes.",
    "case-65": "A large daily dbt model should process new data and rebuild three days for late events."
  };

  function add(number, support, rule, code, supportNote, caveat, docs = []) {
    const id = `case-${String(number).padStart(2, "0")}`;
    const source = sourceCases.get(id);
    if (!source) throw new Error(`Missing LookML source situation ${id}`);
    cases.push({
      ...source,
      business: BUSINESS_OVERRIDES[id] || source.business,
      rule,
      code: code ? code.trim() : "",
      caveat,
      mode: labels[support],
      support,
      supportNote: supportNote || (support === "core"
        ? "Expressible with the current dbt Semantic Layer and MetricFlow specification."
        : ""),
      docs
    });
  }

  // 01–12 · Sources and table shapes
  add(1, "core",
    "Declare the order as the primary entity, expose dimensions on that entity, and define each aggregation as a simple metric.",
    `models:
  - name: fct_orders
    semantic_model: { enabled: true, name: orders }
    agg_time_dimension: ordered_at
    columns:
      - name: order_id
        entity: { name: order, type: primary }
      - name: customer_id
        entity: { name: customer, type: foreign }
      - name: ordered_at
        granularity: day
        dimension: { type: time }
    metrics:
      - { name: gross_revenue, type: simple, agg: sum, expr: revenue }
      - { name: units, type: simple, agg: sum, expr: quantity }`,
    "", "The primary entity column must be unique and non-null at the model grain. If orders repeat across lines, model the line as primary and keep order-level facts separate.", [DOCS.semanticModels, DOCS.simple]);

  add(2, "core",
    "Define one simple metric per additive KPI; a wide physical layout does not make ratios or stored distinct counts additive.",
    `models:
  - name: daily_location_kpis
    semantic_model: { enabled: true }
    agg_time_dimension: day
    columns:
      - name: location_day_key
        entity: { type: primary }
      - name: location_id
        dimension: { type: categorical }
      - name: day
        granularity: day
        dimension: { type: time }
    metrics:
      - { name: gross_revenue, type: simple, agg: sum }
      - { name: orders, type: simple, agg: sum, expr: order_count }
      - { name: units, type: simple, agg: sum }`,
    "", "The row key and contributions must be disjoint. Give ratios and stored distinct counts their own safe definitions instead of treating every column as summable.", [DOCS.semanticModels, DOCS.simple]);

  add(3, "core",
    "Give every long-table business concept a named metric with an expression that selects only its metric code.",
    `models:
  - name: long_kpis
    semantic_model: { enabled: true }
    agg_time_dimension: day
    columns:
      - name: row_key
        entity: { type: primary }
      - name: day
        granularity: day
        dimension: { type: time }
      - name: metric_code
        dimension: { type: categorical }
    metrics:
      - name: gross_revenue
        type: simple
        agg: sum
        expr: "case when metric_code = 'GROSS_REVENUE' then metric_value end"
      - name: units
        type: simple
        agg: sum
        expr: "case when metric_code = 'UNITS' then metric_value end"`,
    "", "Never expose one generic sum across incompatible units. Enforce one contribution per metric at the declared location/day grain.", [DOCS.simple]);

  add(4, "core",
    "Model each behavior explicitly: sums for additive values, count-distinct over retained identifiers, and ratios from reusable component metrics.",
    `models:
  - name: metric_events
    semantic_model: { enabled: true }
    agg_time_dimension: day
    columns:
      - name: event_id
        entity: { type: primary }
      - name: customer_id
        entity: { name: customer, type: foreign }
      - name: day
        granularity: day
        dimension: { type: time }
    metrics:
      - { name: revenue, type: simple, agg: sum, expr: "case when metric_code = 'REVENUE' then metric_value end" }
      - { name: customers, type: simple, agg: count_distinct, expr: customer_id }
metrics:
  - { name: revenue_per_customer, type: ratio, numerator: revenue, denominator: customers }`,
    "", "MetricFlow cannot infer behavior, unit, or valid dimensions from metric_code. Keep that contract in descriptions, metadata, tests, and source grain.", [DOCS.simple, DOCS.ratio]);

  add(5, "core",
    "Aggregate filtered clicks and impressions independently, then define CTR as a ratio of those metrics.",
    `models:
  - name: campaign_metric_rows
    semantic_model: { enabled: true }
    agg_time_dimension: day
    columns:
      - name: row_key
        entity: { type: primary }
      - name: day
        granularity: day
        dimension: { type: time }
    metrics:
      - { name: clicks, type: simple, agg: sum, expr: "case when metric_code = 'CLICKS' then metric_value end" }
      - { name: impressions, type: simple, agg: sum, expr: "case when metric_code = 'IMPRESSIONS' then metric_value end" }
metrics:
  - { name: click_through_rate, type: ratio, numerator: clicks, denominator: impressions }`,
    "", "Averaging stored daily CTR gives every day equal weight. Query the component metrics at the requested grain and let MetricFlow divide them.", [DOCS.ratio]);

  add(6, "boundary",
    "Register and parse S3 files in the query platform, transform that relation with dbt, and annotate the resulting dbt model semantically.",
    `# models/staging/stg_sales_csv.sql
select cast(order_id as varchar) as order_id,
       cast(sold_at as timestamp) as sold_at,
       cast(revenue as numeric) as revenue
from {{ source('s3_lake', 'sales_csv') }}

# models/marts/fct_sales.yml
models:
  - name: fct_sales
    semantic_model: { enabled: true }
    agg_time_dimension: sold_at
    metrics:
      - { name: revenue, type: simple, agg: sum }`,
    "MetricFlow queries a dbt relation; Athena/Glue or another supported platform owns S3 paths, CSV parsing, partitions, and credentials.",
    "Test headers, delimiters, malformed rows, types, partition discovery, and schema drift before semantic queries depend on the model.", [DOCS.models, DOCS.architecture]);

  add(7, "boundary",
    "Expose ADLS files through a supported SQL platform, normalize them in a dbt model, and define metrics on that stable model.",
    `# models/staging/stg_finance_extract.sql
select cast(row_id as varchar) as row_id,
       cast(as_of_date as date) as as_of_date,
       cast(net_revenue as numeric) as net_revenue
from {{ source('adls_external', 'finance_extract') }}

models:
  - name: stg_finance_extract
    semantic_model: { enabled: true }
    agg_time_dimension: as_of_date
    metrics:
      - { name: net_revenue, type: simple, agg: sum }`,
    "Synapse, Databricks, or the selected query platform owns external-table or OPENROWSET configuration, credentials, casts, and file discovery.",
    "The managed Semantic Layer supports a defined set of data platforms. Verify the adapter, deployment plan, and endpoint before relying on this pattern.", [DOCS.models, DOCS.architecture]);

  add(8, "boundary",
    "Use a supported dbt adapter to read the cataloged Delta, Iceberg, or Parquet relation; MetricFlow starts from the built dbt model.",
    `# models/marts/fct_events.sql
select event_id, occurred_at, customer_id
from {{ source('lakehouse', 'events') }}

models:
  - name: fct_events
    semantic_model: { enabled: true }
    agg_time_dimension: occurred_at
    metrics:
      - { name: events, type: simple, agg: count, expr: 1 }`,
    "The dbt adapter and query platform own table-format readers, snapshots, catalog permissions, pruning, and maintenance.",
    "Confirm that both the dbt build and the selected MetricFlow deployment support the data platform; open-format support is not supplied by YAML.", [DOCS.models, DOCS.architecture]);

  add(9, "boundary",
    "Flatten repeated arrays in a dbt model at an explicit element grain, then annotate the flattened relation.",
    `# models/intermediate/int_event_items.sql (warehouse syntax varies)
select e.event_id, e.occurred_at, item.index as item_index,
       item.value:sku::string as sku,
       item.value:quantity::number as quantity
from {{ source('raw', 'events') }} e,
     lateral flatten(input => e.payload:items) item

# Use event_id + item_index to build the primary entity upstream.`,
    "MetricFlow models relational columns and metrics; JSON traversal, array expansion, and dialect-specific parsing belong in the dbt model.",
    "Use a real array offset or source element ID. SKU alone is not a safe key when the same item can repeat in one event.", [DOCS.models, DOCS.semanticModels]);

  add(10, "boundary",
    "Union compatible shards in dbt with source lineage and a collision-safe key before the relation enters the semantic graph.",
    `# models/intermediate/int_all_orders.sql
select 'US' as source_region, * from {{ ref('stg_us_orders') }}
union all
select 'EU' as source_region, * from {{ ref('stg_eu_orders') }}

# primary key in the final model
{{ dbt_utils.generate_surrogate_key(['source_region', 'order_id']) }}`,
    "MetricFlow does not discover shards or generate a union. It queries the single dbt model named by the semantic model.",
    "Use UNION ALL unless deduplication is an explicit rule. Test schema compatibility and key collisions across shards.", [DOCS.models, DOCS.semanticModels]);

  add(11, "boundary",
    "Ingest APIs and spreadsheets first, record freshness and source versions, and build a typed dbt model for MetricFlow.",
    `sources:
  - name: loaded_inputs
    tables:
      - name: billing_actuals
        loaded_at_field: _loaded_at
      - name: sheet_targets
        loaded_at_field: _loaded_at

# An EL tool owns extraction; dbt tests and source freshness
# protect the relations consumed by the semantic model.`,
    "Neither MetricFlow nor the dbt Semantic Layer calls business APIs or authenticates to spreadsheets as an ingestion service.",
    "Preserve load time, source version, rejected rows, and ownership. A semantically valid metric can still be stale or incompletely loaded.", [DOCS.architecture, DOCS.models]);

  add(12, "unsupported",
    "Land or federate both data sets in one supported query platform before asking MetricFlow for a joined semantic query.",
    "",
    "A single MetricFlow query does not join Snowflake orders directly to BigQuery tickets through two unrelated Semantic Layer credentials.",
    "Choose one execution plane, materialize an exchange, or use a federation engine. Its cost, latency, identity, and security semantics remain outside MetricFlow.", [DOCS.architecture, DOCS.joins]);

  // 13–27 · Aggregation
  add(13, "core",
    "Use simple sum metrics only for contributions that are additive across every exposed grouping dimension.",
    `models:
  - name: order_lines
    semantic_model: { enabled: true }
    agg_time_dimension: ordered_at
    columns:
      - name: order_line_id
        entity: { type: primary }
      - name: ordered_at
        granularity: day
        dimension: { type: time }
    metrics:
      - { name: revenue, type: simple, agg: sum }
      - { name: units, type: simple, agg: sum }`,
    "", "Exclude subtotal rows or model their level explicitly; MetricFlow will sum the rows it receives and cannot recognize a hidden subtotal by intent.", [DOCS.simple]);

  add(14, "core",
    "Keep row count and distinct-entity count as separate metrics over their respective identifiers.",
    `models:
  - name: orders
    semantic_model: { enabled: true }
    agg_time_dimension: ordered_at
    columns:
      - name: order_id
        entity: { name: order, type: primary }
      - name: customer_id
        entity: { name: customer, type: foreign }
      - name: ordered_at
        granularity: day
        dimension: { type: time }
    metrics:
      - { name: order_rows, type: simple, agg: count, expr: 1 }
      - { name: unique_customers, type: simple, agg: count_distinct, expr: customer_id }`,
    "", "Distinct count needs the customer identifier at query time. Null identifiers are not counted, and a dirty order key still produces misleading row counts.", [DOCS.simple]);

  add(15, "core",
    "Retain customer IDs and count them distinctly at the grouping requested by the query; do not add location-level scalar counts.",
    `models:
  - name: customer_visits
    semantic_model: { enabled: true }
    agg_time_dimension: visited_at
    columns:
      - name: visit_id
        entity: { type: primary }
      - name: customer_id
        entity: { name: customer, type: foreign }
      - name: location_id
        dimension: { type: categorical }
      - name: region
        dimension: { type: categorical }
    metrics:
      - { name: unique_customers, type: simple, agg: count_distinct, expr: customer_id }`,
    "", "The exact regional answer is possible only while identities survive. If the source retains L1=2 and L2=2 but discards IDs, no semantic definition can recover the overlap.", [DOCS.simple]);

  add(16, "core",
    "Count distinct customer identifiers over the selected time range so MetricFlow recomputes the set instead of summing monthly outputs.",
    `metrics:
  - name: unique_customers
    type: simple
    agg: count_distinct
    expr: customer_id

# Re-query at the desired grain:
# dbt sl query --metrics unique_customers --group-by metric_time__month`,
    "", "A two-month query must scan or merge customer identity state across both months. Summing independently materialized monthly counts remains wrong.", [DOCS.simple, DOCS.commands]);

  add(17, "unsupported",
    "Retain customer identifiers, a mergeable sketch, or separately materialized counts at every allowed regrouping grain.",
    "",
    "MetricFlow cannot reconstruct an exact cross-location or cross-day distinct from scalar unique_customers values after the identities and overlaps have been discarded.",
    "A sum is valid only for provably disjoint scopes. Restrict groupings or redesign the feed instead of labeling an unsafe sum as a distinct count.", [DOCS.simple]);

  add(18, "core",
    "Define numerator and denominator as simple metrics and calculate the regroupable result as a ratio metric.",
    `models:
  - name: orders
    semantic_model: { enabled: true }
    metrics:
      - { name: revenue, type: simple, agg: sum, expr: order_total }
      - { name: orders, type: simple, agg: count, expr: 1 }
metrics:
  - name: average_order_value
    type: ratio
    numerator: revenue
    denominator: orders`,
    "", "This weights every order correctly when stores or months are regrouped. Specify expected null or zero behavior for groups without orders.", [DOCS.ratio]);

  add(19, "core",
    "Sum value times weight and divide by the summed weight; both simple metrics must share the same row grain.",
    `models:
  - name: sales_lines
    semantic_model: { enabled: true }
    metrics:
      - name: extended_sales
        type: simple
        agg: sum
        expr: unit_price * quantity
      - { name: units, type: simple, agg: sum, expr: quantity }
metrics:
  - { name: weighted_average_price, type: ratio, numerator: extended_sales, denominator: units }`,
    "", "Weights must be meaningful, non-negative, and at the same base grain. Do not multiply values that were already aggregated at an incompatible grain.", [DOCS.simple, DOCS.ratio]);

  add(20, "core",
    "Use the percentile aggregation and state the percentile plus continuous or discrete behavior in the metric definition.",
    `models:
  - name: deliveries
    semantic_model: { enabled: true }
    metrics:
      - name: delivery_minutes_p90
        type: simple
        agg: percentile
        expr: delivery_minutes
        percentile: 90.0
        percentile_type: continuous`,
    "", "Warehouse functions and performance differ. Validate the compiled SQL and do not assume this metric is mergeable across pre-aggregated percentile rows.", [DOCS.simple, DOCS.latestSpec]);

  add(21, "core",
    "Use min and max simple metrics over the raw eligible rows.",
    `models:
  - name: support_responses
    semantic_model: { enabled: true }
    metrics:
      - { name: earliest_response_at, type: simple, agg: min, expr: responded_at }
      - { name: worst_latency_minutes, type: simple, agg: max, expr: latency_minutes }`,
    "", "Min and max can roll up from complete shard extrema, but null handling and incomplete source coverage still follow the data platform.", [DOCS.simple]);

  add(22, "core",
    "Declare snapshot time as a non-additive dimension and select the last eligible value per account while summing across accounts.",
    `models:
  - name: account_balances
    semantic_model: { enabled: true }
    agg_time_dimension: snapshot_date
    columns:
      - name: account_snapshot_key
        entity: { type: primary }
      - name: account_id
        entity: { name: account, type: foreign }
      - name: snapshot_date
        granularity: day
        dimension: { type: time }
    metrics:
      - name: balance
        type: simple
        agg: sum
        non_additive_dimension:
          name: snapshot_date
          window_agg: last
          group_by: [account]`,
    "", "Validate one snapshot per account/date and define missing-account behavior. A latest snapshot is not necessarily a complete or approved accounting close.", [DOCS.simple, DOCS.latestSpec]);

  add(23, "core",
    "Use a non-additive time dimension grouped by warehouse so the latest inventory is selected per warehouse before warehouses are summed.",
    `metrics:
  - name: on_hand_units
    type: simple
    agg: sum
    expr: on_hand_units
    non_additive_dimension:
      name: observed_at
      window_agg: last
      group_by: [warehouse]`,
    "", "Expose only dimensions for which this interpretation is valid. Test ties and late-arriving snapshots, especially when warehouses report at different times.", [DOCS.simple, DOCS.latestSpec]);

  add(24, "core",
    "Build a cumulative metric without a finite window so values accumulate from the start of the requested series.",
    `metrics:
  - name: cumulative_revenue
    type: cumulative
    input_metric: revenue

# Query with the desired display grain:
# dbt sl query --metrics cumulative_revenue --group-by metric_time__month`,
    "", "Cumulative metrics require a configured time spine and are non-additive. Query order and selected time bounds determine the displayed series.", [DOCS.cumulative, DOCS.calendar]);

  add(25, "unsupported",
    "Compute a fixed, governed denominator as another metric when its scope is known; leave percentage of displayed rows to the consuming tool.",
    "",
    "MetricFlow metrics cannot reference the visible result set or remove arbitrary query filters to calculate each row's share of a dynamic displayed total.",
    "A dashboard table calculation changes with hidden rows and consumer filters. If the denominator is a fixed company scope, model that scope explicitly upstream.", [DOCS.derived, DOCS.ratio]);

  add(26, "core",
    "Choose null-preserving or zero-filled behavior deliberately; use a time-spine join only when a missing metric should be represented as zero.",
    `metrics:
  - name: reported_orders
    type: simple
    agg: sum
    expr: order_count
    fill_nulls_with: 0
    join_to_timespine: true

# Keep a separate reporting_coverage metric when
# absence means 'not received' rather than zero.`,
    "", "Zero filling can erase a data-quality signal. Publish coverage or expected-versus-received checks alongside the business metric.", [DOCS.simple, DOCS.calendar]);

  add(27, "core",
    "Define gross sales and returns independently, then combine them in a derived net metric with the agreed sign convention.",
    `models:
  - name: commerce_events
    semantic_model: { enabled: true }
    metrics:
      - { name: gross_sales, type: simple, agg: sum, expr: "case when event_type = 'SALE' then amount end" }
      - { name: returns, type: simple, agg: sum, expr: "case when event_type = 'RETURN' then amount end" }
metrics:
  - name: net_revenue
    type: derived
    expr: gross_sales - returns
    input_metrics:
      - name: gross_sales
      - name: returns`,
    "", "If returns are already negative, use addition rather than subtracting twice. Document cancellation, discount, fee, and tax treatment.", [DOCS.derived]);

  // 28–38 · Relationships and grain
  add(28, "core",
    "Mark the truly unique row identifier as a primary entity and validate its uniqueness with dbt tests.",
    `models:
  - name: fct_orders
    semantic_model: { enabled: true, name: orders }
    columns:
      - name: order_id
        entity: { name: order, type: primary }
        data_tests: [not_null, unique]
      - name: customer_id
        entity: { name: customer, type: foreign }`,
    "", "An entity declaration is not a data constraint. Composite identifiers should be built collision-safely in the dbt model and tested before MetricFlow uses the graph.", [DOCS.semanticModels, DOCS.tests]);

  add(29, "boundary",
    "Expose region, market, and location as governed dimensions and let each consuming tool arrange them into its drill hierarchy.",
    `models:
  - name: dim_locations
    semantic_model: { enabled: true, name: locations }
    columns:
      - name: location_id
        entity: { name: location, type: primary }
      - name: region
        dimension: { type: categorical }
      - name: market
        dimension: { type: categorical }
      - name: location_name
        dimension: { type: categorical }`,
    "MetricFlow provides dimensions and entity join paths but has no first-class ordered drill-hierarchy object shared by every consumer.",
    "Test that every location has the intended single parent at each level. Multi-parent and historical hierarchies require explicit modeling.", [DOCS.dimensions, DOCS.joins]);

  add(30, "boundary",
    "Create two role-specific dbt dimension models so each entity name has one unambiguous path in the semantic graph.",
    `# dim_billing_customers.sql
select * from {{ ref('dim_customers') }}

# dim_shipping_customers.sql
select * from {{ ref('dim_customers') }}

# fct_orders.yml
columns:
  - name: billing_customer_id
    entity: { name: billing_customer, type: foreign }
  - name: shipping_customer_id
    entity: { name: shipping_customer, type: foreign }`,
    "MetricFlow joins by matching entity names; it does not declare two aliases of one semantic model inside a query the way a BI join model can.",
    "Duplicate only the role projection, not business logic. Give every exposed dimension a role-specific label so users cannot confuse billing and shipping.", [DOCS.semanticModels, DOCS.joins]);

  add(31, "core",
    "Declare primary and foreign entities accurately; MetricFlow permits safe many-to-one paths and rejects fanout or chasm paths.",
    `models:
  - name: order_lines
    semantic_model: { enabled: true }
    columns:
      - name: order_line_id
        entity: { name: order_line, type: primary }
      - name: order_id
        entity: { name: order, type: foreign }
  - name: orders
    semantic_model: { enabled: true }
    columns:
      - name: order_id
        entity: { name: order, type: primary }`,
    "", "MetricFlow's graph restriction prevents unsafe primary-to-foreign fanout from the wrong side; it does not repair duplicate primary keys. Run semantic and data validation.", [DOCS.joins, DOCS.tests]);

  add(32, "unsupported",
    "Split order headers from item rows or deduplicate to one order row before defining order revenue.",
    "",
    "MetricFlow has no sum-distinct-by-order-key aggregation that can safely add one repeated header amount while preserving item-level grouping.",
    "SUM(DISTINCT order_total) is not equivalent: two different orders can have the same amount. Reject inconsistent totals per order and model the header grain.", [DOCS.simple, DOCS.joins]);

  add(33, "unsupported",
    "Resolve the bridge into an allocated fact or choose an explicit reporting grain before it enters the semantic graph.",
    "",
    "MetricFlow rejects foreign-to-foreign and other fanout/chasm join paths, so a general customer-to-segment many-to-many bridge is not a native join pattern.",
    "A customer in two segments legitimately appears twice by segment. Grand totals require retained customer identity or an allocation rule, not an unrestricted bridge join.", [DOCS.joins]);

  add(34, "boundary",
    "Materialize one attributed row per conversion and channel in dbt, validate that weights sum to the intended total, then sum weighted value in MetricFlow.",
    `# models/marts/fct_attributed_conversions.sql
select conversion_id, channel, attribution_model,
       conversion_value * attribution_weight as attributed_value
from {{ ref('int_conversion_attribution') }}

metrics:
  - name: attributed_revenue
    type: simple
    agg: sum
    expr: attributed_value`,
    "MetricFlow does not introduce allocation rows or normalize a many-to-many bridge during query planning; the dbt model owns the allocation.",
    "Test weight totals, unattributed events, and model versions. Never overwrite old attribution weights without an explicit restatement policy.", [DOCS.models, DOCS.simple]);

  add(35, "core",
    "Define each fact model with shared entities and time dimensions, then combine its metrics in a top-level derived metric.",
    `models:
  - name: fct_actuals
    semantic_model: { enabled: true }
    agg_time_dimension: month
    columns:
      - name: actual_id
        entity: { type: primary }
      - name: department_id
        entity: { name: department, type: foreign }
    metrics:
      - { name: actual, type: simple, agg: sum, expr: amount }
  - name: fct_budgets
    semantic_model: { enabled: true }
    agg_time_dimension: month
    columns:
      - name: budget_id
        entity: { type: primary }
      - name: department_id
        entity: { name: department, type: foreign }
    metrics:
      - { name: budget, type: simple, agg: sum, expr: amount }
metrics:
  - { name: actual_vs_budget, type: derived, expr: actual - budget, input_metrics: [actual, budget] }`,
    "", "MetricFlow uses full outer joins for multi-fact queries and exposes common dimensions. Align calendar, currency, department identity, and aggregation grain first.", [DOCS.joins, DOCS.derived]);

  add(36, "core",
    "Model the changing dimension with a natural entity plus valid-from and valid-to time dimensions; join fact metrics through the matching foreign entity.",
    `models:
  - name: customer_segments_scd
    semantic_model: { enabled: true }
    agg_time_dimension: valid_from
    columns:
      - name: customer_id
        entity: { name: customer, type: natural }
      - name: segment
        dimension: { type: categorical }
      - name: valid_from
        granularity: day
        dimension: { type: time, validity_params: { is_start: true } }
      - name: valid_to
        granularity: day
        dimension: { type: time, validity_params: { is_end: true } }
  - name: fct_orders
    semantic_model: { enabled: true }
    columns:
      - name: customer_id
        entity: { name: customer, type: foreign }`,
    "", "Validity windows must not overlap. MetricFlow uses the dimension value at the start of a coarser query window, so validate that behavior against the required day/month semantics.", [DOCS.dimensions, DOCS.joins]);

  add(37, "boundary",
    "Expand the recursive ancestor/descendant closure in a dbt model, then expose the resulting reporting path as ordinary dimensions or a prepared rollup.",
    `# models/intermediate/int_org_closure.sql
with recursive org as (
  select employee_id, manager_id, employee_id as descendant_id, 0 as depth
  from {{ ref('dim_employees') }}
  union all
  select p.employee_id, p.manager_id, c.descendant_id, c.depth + 1
  from {{ ref('dim_employees') }} p
  join org c on p.employee_id = c.manager_id
)
select * from org`,
    "MetricFlow follows a bounded entity graph; it does not execute recursive hierarchy traversal or perform cycle detection.",
    "Recursive SQL varies by platform. Enforce a maximum depth, detect cycles, and decide how historical manager changes affect old reports.", [DOCS.models, DOCS.joins]);

  add(38, "boundary",
    "Resolve and version the customer-to-household mapping in dbt, then carry household_id onto the fact grain needed for exact reach metrics.",
    `# models/marts/fct_household_activity.sql
select a.activity_id, a.occurred_at, a.customer_id,
       i.household_id, i.identity_model_version
from {{ ref('fct_customer_activity') }} a
join {{ ref('int_customer_household_identity') }} i
  on a.customer_id = i.customer_id

metrics:
  - { name: reached_households, type: simple, agg: count_distinct, expr: household_id }`,
    "MetricFlow can group through safe entities, but it does not perform probabilistic identity resolution or aggregate a joined dimension as a new exact distinct metric.",
    "Version mappings and confidence, and decide whether old results restate. One customer mapping to several households reintroduces a many-to-many problem.", [DOCS.models, DOCS.simple]);

  // 39–48 · Time and behavior
  add(39, "boundary",
    "Create the canonical business timestamp and date in the dbt model, then expose both UTC and business-local time as dimensions.",
    `# models/marts/fct_sales.sql (function varies by platform)
select *,
       convert_timezone('UTC', 'America/Los_Angeles', sold_at_utc)
         as sold_at_los_angeles,
       cast(convert_timezone('UTC', 'America/Los_Angeles', sold_at_utc) as date)
         as business_date
from {{ ref('stg_sales') }}

# YAML: mark business_date as the aggregation time dimension.`,
    "MetricFlow exposes time dimensions and grains but does not carry a per-user timezone policy that rewrites timestamps consistently across every consumer.",
    "Test daylight-saving transitions and source timestamp types. Never apply a UTC conversion to a value already stored in local time.", [DOCS.dimensions, DOCS.models]);

  add(40, "core",
    "Define a custom fiscal calendar time spine and query its fiscal period columns as custom granularities.",
    `models:
  - name: fiscal_calendar
    time_spine:
      standard_granularity_column: date_day
      custom_granularities:
        - { name: fiscal_month, column_name: fiscal_month }
        - { name: fiscal_quarter, column_name: fiscal_quarter }
        - { name: fiscal_year, column_name: fiscal_year }
    columns:
      - { name: date_day, granularity: day }
      - name: fiscal_year
      - name: fiscal_quarter
      - name: fiscal_month`,
    "", "The calendar model must encode the February start and naming convention correctly. Consumer integrations do not all surface custom granularities; APIs provide the broadest access.", [DOCS.calendar, DOCS.commands]);

  add(41, "core",
    "Materialize the governed 4-4-5 calendar as a custom time spine with retail week, period, quarter, and year columns.",
    `models:
  - name: retail_445_calendar
    time_spine:
      standard_granularity_column: date_day
      custom_granularities:
        - { name: retail_week, column_name: retail_week }
        - { name: retail_period, column_name: retail_period }
        - { name: retail_quarter, column_name: retail_quarter }
        - { name: retail_year, column_name: retail_year }
    columns:
      - { name: date_day, granularity: day }
      - name: retail_week
      - name: retail_period
      - name: retail_quarter
      - name: retail_year`,
    "", "Generate the calendar under an owned policy for week starts, 53rd weeks, and restatements. A custom granularity labels dates; it does not invent those rules.", [DOCS.calendar]);

  add(42, "core",
    "Use a derived metric with an offset copy of the base metric, and include a time dimension in the query.",
    `metrics:
  - name: revenue_year_over_year
    type: derived
    expr: (revenue - revenue_prior_year) / revenue_prior_year
    input_metrics:
      - name: revenue
      - name: revenue
        alias: revenue_prior_year
        offset_window: 1 year

# dbt sl query --metrics revenue_year_over_year --group-by metric_time__month`,
    "", "Offset metrics require metric_time in the query. Define whether comparison uses standard or custom fiscal periods and test partial-period behavior.", [DOCS.derived]);

  add(43, "core",
    "Define a cumulative distinct-customer metric with a 28-day sliding window and query it for each displayed day.",
    `metrics:
  - name: active_users_28d
    type: cumulative
    input_metric: active_users
    window: 28 days
    period_agg: first

# active_users is a simple count_distinct metric.
# A configured daily time spine is required.`,
    "", "Rolling distinct values overlap and are non-additive. Validate the requested display grain and period_agg instead of summing daily rolling outputs.", [DOCS.cumulative, DOCS.calendar]);

  add(44, "core",
    "Filter the component metric to completed business dates, accumulate it year-to-date, and offset that governed cumulative metric for the prior-year comparison.",
    `metrics:
  - name: completed_revenue_ytd
    type: cumulative
    grain_to_date: year
    input_metric:
      name: revenue
      filter: "{{ Dimension('calendar__is_complete_day') }} = true"
  - name: completed_revenue_ytd_yoy
    type: derived
    expr: current_ytd - prior_ytd
    input_metrics:
      - { name: completed_revenue_ytd, alias: current_ytd }
      - { name: completed_revenue_ytd, alias: prior_ytd, offset_window: 1 year }`,
    "", "The calendar model must update is_complete_day from the business clock and data-completeness cutoff. Midnight alone is not proof that a day is final.", [DOCS.cumulative, DOCS.derived, DOCS.calendar]);

  add(45, "core",
    "Use a last-value non-additive balance metric and pass the selected as-of date as the query end time.",
    `metrics:
  - name: balance
    type: simple
    agg: sum
    non_additive_dimension:
      name: snapshot_date
      window_agg: last
      group_by: [account]

# dbt sl query --metrics balance --end-time '2026-03-31'`,
    "", "Confirm the CLI/API end-time boundary and timezone, and decide what to do when an account has no snapshot on or before the selected date.", [DOCS.simple, DOCS.commands]);

  add(46, "boundary",
    "Build one dbt cohort-period row with cohort month, activity month, cohort size, and retained customers; MetricFlow then aggregates and divides those governed components.",
    `# models/marts/fct_customer_retention.sql
select cohort_month, activity_month, months_since_acquisition,
       cohort_size, retained_customers
from {{ ref('int_customer_cohort_activity') }}

metrics:
  - { name: retained_customers, type: simple, agg: sum }
  - { name: cohort_size, type: simple, agg: max }
  - { name: retention_rate, type: ratio, numerator: retained_customers, denominator: cohort_size }`,
    "MetricFlow can calculate the metrics but does not derive first acquisition, cohort membership, and months-since-acquisition from an arbitrary event stream.",
    "Keep one consistent cohort_size per cohort and define identity, reactivation, and late-event restatement. A max is safe only under that contract.", [DOCS.models, DOCS.ratio]);

  add(47, "boundary",
    "Use conversion metrics for governed event pairs; prepare an activation-qualified purchase event upstream when all three ordered steps must be satisfied.",
    `metrics:
  - name: signup_to_activation_7d
    type: conversion
    entity: user
    calculation: conversion_rate
    base_metric: signups
    conversion_metric: activations
    window: 7 days
  - name: activation_to_purchase_30d
    type: conversion
    entity: user
    calculation: conversion_rate
    base_metric: activations
    conversion_metric: purchases
    window: 30 days`,
    "MetricFlow natively evaluates base-to-conversion pairs. A single three-stage funnel with first qualifying timestamps and strict step chaining still needs a prepared event or entity model.",
    "Define repeated-event selection, identity, attribution window, and constant properties. Two pairwise rates are not automatically one end-to-end funnel rate.", [DOCS.conversion, DOCS.models]);

  add(48, "boundary",
    "Calculate the governed duration in the dbt model, then aggregate it and expose an SLA-hit metric in MetricFlow.",
    `# models/marts/fct_support_tickets.sql
with durations as (
  select *,
         {{ dbt.datediff('opened_at', 'first_response_at', 'hour') }}
           as response_hours
  from {{ ref('int_support_tickets') }}
)
select *, case when response_hours <= 4 then 1 else 0 end as met_4h_sla
from durations

metrics:
  - { name: average_response_hours, type: simple, agg: average, expr: response_hours }
  - { name: tickets_meeting_sla, type: simple, agg: sum, expr: met_4h_sla }`,
    "MetricFlow aggregates prepared expressions; business-hour clocks, holiday exclusions, pause intervals, and missing endpoints belong in the dbt transformation.",
    "Elapsed hours and business hours are different metrics. Make the SLA calendar and incomplete-ticket behavior explicit and test boundary cases.", [DOCS.models, DOCS.simple]);

  // 49–55 · Business transformations
  add(49, "boundary",
    "Join the uniquely keyed FX rate in dbt at the required currency/date/rate-type grain, then sum the converted row value as a simple metric.",
    `# models/marts/fct_orders_converted.sql
select o.*,
       o.revenue_local * fx.rate as revenue_usd,
       fx.rate_type, fx.rate_version
from {{ ref('fct_orders') }} o
left join {{ ref('dim_daily_fx_rates') }} fx
  on o.currency_code = fx.from_currency
 and cast(o.ordered_at as date) = fx.rate_date
 and fx.to_currency = 'USD'

metrics:
  - { name: revenue_usd, type: simple, agg: sum }`,
    "A MetricFlow simple metric cannot multiply a fact by an arbitrarily joined rate dimension at query time or accept a reporting currency parameter.",
    "Define spot versus average rates, missing-rate behavior, triangulation, and restatement. Test that exactly one rate joins to each fact row.", [DOCS.models, DOCS.simple]);

  add(50, "boundary",
    "Apply the context-specific conversion factor in dbt at row grain, then expose the normalized quantity as an additive metric.",
    `# models/marts/fct_inventory_normalized.sql
select i.*,
       i.quantity * c.factor_to_kg as quantity_kg
from {{ ref('fct_inventory') }} i
join {{ ref('dim_unit_conversions') }} c
  on i.unit_code = c.from_unit
 and c.to_unit = 'KG'
 and (c.product_id is null or c.product_id = i.product_id)

metrics:
  - { name: quantity_kg, type: simple, agg: sum }`,
    "MetricFlow does not apply a semantic conversion relationship inside a metric expression across joined models; the normalized fact must be prepared first.",
    "Density, temperature, product, and effective date can change a factor. Treat those dimensions as part of the conversion key when required.", [DOCS.models, DOCS.simple]);

  add(51, "core",
    "Define actual, budget, and forecast as separate metrics sharing common entities and time; combine only compatible metrics in derived calculations.",
    `models:
  - name: fct_finance_scenarios
    semantic_model: { enabled: true }
    agg_time_dimension: month
    columns:
      - name: scenario_row_id
        entity: { type: primary }
      - name: scenario
        dimension: { type: categorical }
      - name: forecast_version
        dimension: { type: categorical }
    metrics:
      - { name: actual, type: simple, agg: sum, expr: "case when scenario = 'ACTUAL' then amount end" }
      - { name: budget, type: simple, agg: sum, expr: "case when scenario = 'BUDGET' then amount end" }
      - { name: forecast, type: simple, agg: sum, expr: "case when scenario = 'FORECAST' then amount end" }
metrics:
  - { name: actual_vs_budget, type: derived, expr: actual - budget }`,
    "", "All scenarios must share compatible month, cost-center, currency, and unit semantics. Version forecasts so a resubmission does not rewrite old evaluations.", [DOCS.simple, DOCS.derived]);

  add(52, "unsupported",
    "Materialize named scenarios upstream or let a consuming application calculate the simulation outside the governed MetricFlow metric.",
    "",
    "MetricFlow has no allowed-value query parameter that can be referenced inside a metric expression to change a discount or other what-if assumption at request time.",
    "A free-form consumer calculation is not the observed business metric. Bound, label, audit, and persist scenarios when they become decision records.", [DOCS.semanticModels, DOCS.derived]);

  add(53, "boundary",
    "Publish revenue, orders, and units as separate governed metrics and let the consumer choose which metric to request or display.",
    `# Keep the semantic contract explicit:
metrics:
  - { name: revenue, type: simple, agg: sum, expr: revenue }
  - { name: orders, type: simple, agg: count, expr: 1 }
  - { name: units, type: simple, agg: sum, expr: quantity }

# Consumer request chooses one:
# dbt sl query --metrics revenue --group-by metric_time__month`,
    "MetricFlow serves named metrics but does not define a BI presentation parameter that dynamically replaces one displayed field with another.",
    "Metrics have different formats and valid dimensions. Do not collapse them into an untyped generic value merely to simplify one tile.", [DOCS.commands, DOCS.simple]);

  add(54, "boundary",
    "Calculate stable lifetime features and versioned segment thresholds in a customer-grain dbt model, then expose the segment as a categorical dimension.",
    `# models/marts/dim_customer_segments.sql
select customer_id, lifetime_revenue, active_days_90,
       case
         when lifetime_revenue >= 100000 then 'Strategic'
         when active_days_90 >= 30 then 'Engaged'
         else 'Standard'
       end as customer_segment,
       '2027-v1' as segment_version
from {{ ref('int_customer_features') }}

columns:
  - name: customer_segment
    dimension: { type: categorical }`,
    "MetricFlow can expose derived semantics, but lifetime feature calculation and threshold refresh are safer as tested dbt transformations at customer grain.",
    "CASE uses first-match order. Version thresholds, retain inputs, and avoid calculating lifetime features on a fanout-prone transaction join.", [DOCS.models, DOCS.dimensions]);

  add(55, "boundary",
    "Expose country, region, city, postal code, latitude, and longitude as categorical dimensions; the consumer owns maps and drill presentation.",
    `models:
  - name: dim_locations
    semantic_model: { enabled: true }
    columns:
      - name: location_id
        entity: { name: location, type: primary }
      - name: country
        dimension: { type: categorical }
      - name: region
        dimension: { type: categorical }
      - name: city
        dimension: { type: categorical }
      - name: postal_code
        dimension: { type: categorical }
      - name: latitude
        dimension: { type: categorical }
      - name: longitude
        dimension: { type: categorical }`,
    "MetricFlow has categorical and time dimensions, not a first-class geographic type, geometry relationship, map layer, or ordered geographic drill hierarchy.",
    "Geocoding accuracy, privacy, changing boundaries, and postal-code reuse remain data-governance concerns. Coordinates must represent the intended object.", [DOCS.dimensions]);

  // 56–60 · Governance
  add(56, "boundary",
    "Enforce regional row access in the data platform and map Semantic Layer personal or service tokens to credentials whose policies implement that scope.",
    `# Administration pattern (not MetricFlow YAML)
regional_manager_token -> regional_manager_credential
finance_service_token  -> finance_reader_credential

# The data platform row-access policy evaluates the executing
# role or user; MetricFlow queries the protected view/model.`,
    "MetricFlow metric definitions have no user-attribute row predicate. The managed service respects policies attached to the credential used for execution.",
    "Test every token, personal credential, export, and cache path. Declarative cache tables do not automatically preserve the source security context.", [DOCS.access, DOCS.cache]);

  add(57, "boundary",
    "Protect cost-bearing relations or columns with data-platform privileges and expose finance-only access through a separately mapped credential or endpoint.",
    `# Administration pattern (not a field visibility flag)
finance_token -> role with SELECT on finance_metric_inputs
general_token -> role without SELECT on finance_metric_inputs

# Optionally separate finance semantic models into an owned
# dbt group, but dbt model access controls ref() dependencies,
# not end-user warehouse authorization.`,
    "MetricFlow has no per-user field grant that conditionally removes one metric from metadata while retaining the rest of the semantic model.",
    "Hiding a field in a BI tool is not security. Audit alternate metrics, exports, cached tables, and derivable values under every credential.", [DOCS.access, DOCS.architecture]);

  add(58, "core",
    "Put the immutable retention predicate in the metric definition and allow callers to add an editable status filter to the query or saved query.",
    `models:
  - name: events
    semantic_model: { enabled: true }
    metrics:
      - name: retained_events
        type: simple
        agg: count
        expr: 1
        filter: |
          {{ TimeDimension('event__occurred_at', 'day') }}
            >= current_date - interval '25 months'

# Consumer may additionally filter event__status.`,
    "", "Relative-date SQL is data-platform-specific. A metric filter constrains that metric; it is not a substitute for row-level security when the data must be inaccessible.", [DOCS.simple, DOCS.commands]);

  add(59, "boundary",
    "Use descriptions, labels, groups, and meta for the business contract; use a saved query to publish a useful summary-to-detail dataset.",
    `groups:
  - name: finance
    owner: { name: Finance Analytics, email: finance@example.com }
metrics:
  - name: net_revenue
    label: Net revenue
    description: "Settled sales less settled returns; USD at daily close."
    type: derived
    expr: gross_sales - settled_returns
    config:
      group: finance
      meta: { steward: finops, certification: governed }
saved_queries:
  - name: net_revenue_detail
    query_params:
      metrics: [net_revenue]
      group_by: [metric_time__day, order__region, order]`,
    "MetricFlow metadata and saved queries are portable context, but there is no universal click-to-drill path or field set enforced across every downstream integration.",
    "Keep ownership and change notes current, and do not export sensitive identifiers merely to make a convenient detail route.", [DOCS.semanticModels, DOCS.exports]);

  add(60, "core",
    "Define audited base metrics once and reuse them in ratio, cumulative, conversion, and derived metrics rather than copying SQL into every consumer.",
    `models:
  - name: orders
    semantic_model: { enabled: true }
    metrics:
      - name: gross_revenue
        label: Gross revenue
        description: "Recognized item revenue before returns."
        type: simple
        agg: sum
        expr: revenue
metrics:
  - name: net_revenue
    type: derived
    expr: gross_revenue - settled_returns
  - name: average_order_value
    type: ratio
    numerator: gross_revenue
    denominator: orders`,
    "", "Reuse does not eliminate governance. Keep names stable, avoid circular definitions, document valid dimensions, and validate every downstream dependency before changing the base.", [DOCS.simple, DOCS.derived, DOCS.ratio]);

  // 61–68 · Performance and evolution
  add(61, "boundary",
    "Build the reusable daily product aggregation as a dbt model, preserve only additive or mergeable state, and place the semantic definition on that relation.",
    `# models/marts/agg_daily_product.sql
{{ config(materialized='incremental', unique_key=['day', 'product_id']) }}
select cast(occurred_at as date) as day, product_id,
       sum(revenue) as revenue, count(*) as events
from {{ ref('fct_events') }}
{% if is_incremental() %}
where occurred_at >= (select max(day) - interval '3 days' from {{ this }})
{% endif %}
group by 1, 2

# Annotate agg_daily_product with simple sum metrics.`,
    "dbt creates and refreshes the physical aggregation; MetricFlow describes and queries the resulting model but does not build arbitrary source rollups itself.",
    "Do not pre-aggregate exact distincts, percentiles, or ratios unless you retain mergeable state or the final valid grain.", [DOCS.incremental, DOCS.semanticModels]);

  add(62, "core",
    "Define a saved query with an export and declarative cache, then run it after upstream models in the dbt job.",
    `saved_queries:
  - name: executive_revenue
    query_params:
      metrics: [revenue, orders]
      group_by: [metric_time__day, order__region]
    config:
      cache: { enabled: true }
    exports:
      - name: executive_revenue_cache
        config: { export_as: table }

# Production job after model builds:
# dbt build --select executive_revenue`,
    "", "Declarative caching is a managed Enterprise feature. The export job schedule warms the cache, and upstream run metadata drives invalidation; grant access to the dbt_sl_cache schema deliberately.", [DOCS.cache, DOCS.exports]);

  add(63, "core",
    "Precompute a saved-query cache at month and region grain; matching requests can use it while unmatched dimensions fall back to source execution.",
    `saved_queries:
  - name: monthly_region_metrics
    query_params:
      metrics: [revenue, orders, units]
      group_by: [metric_time__month, order__region]
    config:
      cache: { enabled: true }
    exports:
      - name: monthly_region_metrics_cache
        config: { export_as: table }`,
    "", "This is query-cache matching, not a general source aggregate planner. Only requests compatible with the saved query's metrics and dimensions benefit; access-control limitations also apply.", [DOCS.cache, DOCS.exports]);

  add(64, "unsupported",
    "Keep the exact count_distinct metric, or calculate a platform-specific approximation in a separately governed dbt model with an explicit error contract.",
    "",
    "MetricFlow's documented simple aggregations include exact count_distinct but no native approximate-distinct or mergeable-sketch aggregation that can be substituted automatically.",
    "A scalar approximate count is not safely additive. Record the algorithm and error bound, and never use approximation for billing, compliance, or entitlement decisions.", [DOCS.simple]);

  add(65, "boundary",
    "Use a dbt incremental or microbatch model with a lookback window for late events; MetricFlow reads the completed relation after the build.",
    `# models/marts/fct_daily_events.sql
{{ config(
  materialized='incremental',
  incremental_strategy='microbatch',
  event_time='occurred_at',
  begin='2026-01-01',
  batch_size='day',
  lookback=3
) }}

select * from {{ ref('stg_events') }}`,
    "Incremental maintenance belongs to dbt materialization and the adapter. MetricFlow does not append, merge, or rebuild the underlying semantic-model relation.",
    "Choose the lookback from observed lateness, test idempotence and unique keys, and refresh dependent exports or caches only after the model succeeds.", [DOCS.incremental, DOCS.cache]);

  add(66, "boundary",
    "Run dbt data tests on metric inputs and dbt sl validate on semantic nodes; add an explicit closed-period query assertion when an exact metric result must be protected.",
    `# Structural and warehouse-backed semantic validation
dbt build --select state:modified+
dbt sl validate --select state:modified+

# Closed-period regression assertion in CI
dbt sl query --metrics net_revenue --start-time 2026-01-01 --end-time 2026-12-31 --csv target/net_revenue_2026.csv
# Compare the single result with an approved fixture.`,
    "dbt and MetricFlow validate models, tests, references, generated SQL, and semantic paths; an exact historical metric-value assertion needs a fixture or custom CI check.",
    "Use immutable closed periods or seeded fixtures. Mutable production data makes exact-value checks noisy; investigate expected restatements instead of blindly updating baselines.", [DOCS.ci, DOCS.commands, DOCS.tests]);

  add(67, "boundary",
    "Publish an explicit v2 metric beside v1, describe the effective date and owner in metadata, and migrate consumers before disabling the old definition.",
    `metrics:
  - name: net_revenue_v1
    label: "Net revenue (legacy—booked returns)"
    description: "Deprecated after FY2026 close."
    type: derived
    expr: gross_sales - booked_returns
    config: { meta: { status: deprecated, owner: finance } }
  - name: net_revenue_v2
    label: Net revenue
    description: "v2: gross sales less settled returns; effective FY2027."
    type: derived
    expr: gross_sales - settled_returns
    config: { meta: { status: governed, owner: finance } }`,
    "MetricFlow can host both names and metadata, but it has no first-class effective-dated alias, consumer migration, or automatic deprecation workflow for metric definitions.",
    "Renaming is not versioning. Reconcile both metrics, inspect exposures and API consumers, and retain the old contract for the agreed migration window.", [DOCS.derived, DOCS.semanticModels]);

  add(68, "core",
    "Retain result type, forecast version, horizon, and evaluation cutoff; define observed and predicted metrics separately and derive the error.",
    `models:
  - name: demand_results
    semantic_model: { enabled: true }
    agg_time_dimension: target_date
    columns:
      - name: result_row_id
        entity: { type: primary }
      - name: result_type
        dimension: { type: categorical }
      - name: model_version
        dimension: { type: categorical }
      - name: forecast_horizon
        dimension: { type: categorical }
    metrics:
      - { name: observed_units, type: simple, agg: sum, expr: "case when result_type = 'OBSERVED' then units end" }
      - { name: predicted_units, type: simple, agg: sum, expr: "case when result_type = 'PREDICTED' then units end" }
metrics:
  - { name: forecast_error, type: derived, expr: observed_units - predicted_units }`,
    "", "Evaluate the model version that existed at the cutoff rather than a backfill. Observed and predicted rows must align on item, horizon, target date, currency or unit, and grain.", [DOCS.simple, DOCS.derived]);

  if (cases.length !== 68) throw new Error(`Expected 68 dbt Semantic Layer situations, found ${cases.length}`);
  window.DBT_SEMANTIC_LAYER_USE_CASES = cases;
})();
