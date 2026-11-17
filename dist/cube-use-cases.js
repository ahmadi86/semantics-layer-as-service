(() => {
  const sourceCases = new Map((window.LOOKML_USE_CASES || []).map(item => [item.id, item]));
  const cases = [];
  const DOCS = {
    cubes: { label: "Cubes", url: "https://docs.cube.dev/reference/data-modeling/cube" },
    measures: { label: "Measures", url: "https://docs.cube.dev/reference/data-modeling/measures" },
    dimensions: { label: "Dimensions", url: "https://docs.cube.dev/reference/data-modeling/dimensions" },
    joins: { label: "Joins", url: "https://docs.cube.dev/reference/data-modeling/joins" },
    views: { label: "Views", url: "https://docs.cube.dev/docs/data-modeling/views" },
    multiFact: { label: "Multi-fact views", url: "https://docs.cube.dev/docs/data-modeling/multi-fact-views" },
    hierarchies: { label: "Hierarchies", url: "https://docs.cube.dev/reference/data-modeling/hierarchies" },
    access: { label: "Access policies", url: "https://docs.cube.dev/reference/data-modeling/data-access-policies" },
    preAggregations: { label: "Pre-aggregations", url: "https://docs.cube.dev/reference/data-modeling/pre-aggregations" },
    time: { label: "Multi-stage calculations", url: "https://docs.cube.dev/reference/data-modeling/measures#multi-stage-calculations" },
    calendar: { label: "Custom calendars", url: "https://docs.cube.dev/recipes/data-modeling/custom-calendar" },
    parameters: { label: "Query-time parameters", url: "https://docs.cube.dev/recipes/data-modeling/passing-dynamic-parameters-in-a-query" },
    crossSource: { label: "Cross-data-source queries", url: "https://docs.cube.dev/recipes/data-modeling/cross-data-source-queries" },
    snapshots: { label: "Data snapshots", url: "https://docs.cube.dev/recipes/data-modeling/snapshots" },
    percentiles: { label: "Averages and percentiles", url: "https://docs.cube.dev/recipes/data-modeling/percentiles" },
    share: { label: "Share of total", url: "https://docs.cube.dev/recipes/data-modeling/share-of-total" },
    configuration: { label: "Model configuration", url: "https://docs.cube.dev/docs/data-modeling/configuration" },
    contentValidator: { label: "Content Validator", url: "https://docs.cube.dev/docs/data-modeling/content-validator" }
  };
  const labels = {
    core: "Native Cube",
    boundary: "Source / consumer boundary",
    unsupported: "Not supported"
  };
  const BUSINESS_OVERRIDES = {
    "case-06": "Daily CSV exports land under an S3 prefix and analysts need governed fields in Cube.",
    "case-07": "Finance publishes CSV extracts in ADLS and needs governed fields in Cube.",
    "case-60": "Several Cube views need the same audited revenue measure with small presentation differences.",
    "case-62": "Query cache and pre-aggregations should refresh after the warehouse ETL completes.",
    "case-65": "A large daily pre-aggregation should refresh recent partitions for late events."
  };

  const yaml = (name, body) => `cubes:\n  - name: ${name}\n${body.trim().split("\n").map(line => `    ${line}`).join("\n")}`;

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
        ? "Expressible in Cube's data model and query engine without a source-side semantic workaround."
        : ""),
      docs
    });
  }

  // 01–12 · Sources and table shapes
  add(1, "core",
    "Declare the row key, expose attributes as dimensions, and aggregate only measures whose contributions are disjoint at that grain.",
    yaml("orders", `sql_table: analytics.orders
dimensions:
  - { name: order_id, sql: order_id, type: string, primary_key: true }
  - { name: customer_id, sql: customer_id, type: string }
  - { name: ordered_at, sql: ordered_at, type: time }
measures:
  - { name: gross_revenue, sql: revenue, type: sum }
  - { name: orders, type: count }`),
    "", "The primary key must be non-null and unique. If an order repeats across line items, model the line grain or a separate order cube.", [DOCS.cubes, DOCS.measures]);

  add(2, "core",
    "Create a named measure per business concept; a separate physical column does not make a stored KPI additive across every dimension.",
    yaml("daily_location_kpis", `sql_table: analytics.daily_location_kpis
dimensions:
  - { name: location_day_key, sql: location_day_key, type: string, primary_key: true }
  - { name: location_id, sql: location_id, type: string }
  - { name: day, sql: day, type: time }
measures:
  - { name: gross_revenue, sql: gross_revenue, type: sum }
  - { name: orders, sql: order_count, type: sum }
  - { name: units, sql: units, type: sum }`),
    "", "These sums require non-overlapping location/day contributions. Keep ratios and distinct counts out of a generic additive pattern.", [DOCS.measures]);

  add(3, "core",
    "Filter every named measure by its metric code so values with different units and aggregation behavior never share one generic sum.",
    yaml("long_kpis", `sql_table: analytics.long_kpis
dimensions:
  - { name: metric_code, sql: metric_code, type: string }
measures:
  - name: gross_revenue
    sql: metric_value
    type: sum
    filters: [{ sql: "{CUBE}.metric_code = 'GROSS_REVENUE'" }]
  - name: units
    sql: metric_value
    type: sum
    filters: [{ sql: "{CUBE}.metric_code = 'UNITS'" }]`),
    "", "A generic sum of metric_value would mix currencies, counts, rates, and quantities. The source contract still has to define each metric's grain and unit.", [DOCS.measures]);

  add(4, "core",
    "Model each behavior separately: sum additive components, recompute ratios from their measures, and keep stored distinct counts scoped to their valid grain.",
    yaml("kpis", `sql_table: analytics.long_kpis
measures:
  - name: revenue
    sql: metric_value
    type: sum
    filters: [{ sql: "{CUBE}.metric_code = 'REVENUE'" }]
  - name: orders
    sql: metric_value
    type: sum
    filters: [{ sql: "{CUBE}.metric_code = 'ORDERS'" }]
  - { name: average_order_value, sql: "1.0 * {revenue} / NULLIF({orders}, 0)", type: number }`),
    "", "Cube cannot infer aggregation behavior from metric_code. Maintain a registry of units, valid dimensions, and source grain.", [DOCS.measures]);

  add(5, "core",
    "Filter and aggregate numerator and denominator independently, then divide the aggregated components.",
    yaml("campaign_kpis", `sql_table: analytics.campaign_kpis
measures:
  - name: clicks
    sql: metric_value
    type: sum
    filters: [{ sql: "{CUBE}.metric_code = 'CLICKS'" }]
  - name: impressions
    sql: metric_value
    type: sum
    filters: [{ sql: "{CUBE}.metric_code = 'IMPRESSIONS'" }]
  - name: click_through_rate
    sql: "1.0 * {clicks} / NULLIF({impressions}, 0)"
    type: number
    format: percent_2`),
    "", "Do not average daily CTR unless equal-day weighting is the intended business definition.", [DOCS.measures]);

  add(6, "boundary",
    "Expose the S3 files through a supported query engine such as Athena, then model the registered relation in Cube.",
    yaml("sales_csv", `data_source: athena
sql_table: lake.sales_csv
dimensions:
  - { name: row_id, sql: row_id, type: string, primary_key: true }
  - { name: sold_at, sql: sold_at, type: time }
measures:
  - { name: revenue, sql: revenue, type: sum }`),
    "Cube connects to Athena; S3 object discovery, CSV parsing, partitions, and schema enforcement remain in Athena/Glue.",
    "Define delimiters, types, malformed-row handling, credentials, and partition discovery upstream, and monitor schema drift.", [DOCS.cubes]);

  add(7, "boundary",
    "Expose ADLS files as a stable relation through Synapse, Databricks, or another supported engine; Cube models that relation rather than the blob path.",
    yaml("finance_extract", `data_source: synapse
sql_table: reporting.sales_csv
dimensions:
  - { name: row_id, sql: row_id, type: string, primary_key: true }
measures:
  - { name: net_revenue, sql: net_revenue, type: sum }`),
    "The connected SQL engine owns OPENROWSET or external-table configuration, credentials, casts, and file parsing.",
    "Connector behavior varies by engine. Test type inference, file-set consistency, and permission propagation.", [DOCS.cubes]);

  add(8, "boundary",
    "Connect Cube to the engine that catalogs and reads the open table format, then map the cube to its logical relation.",
    yaml("events", `data_source: lakehouse
sql_table: catalog.analytics.events
dimensions:
  - { name: event_id, sql: event_id, type: string, primary_key: true }
  - { name: occurred_at, sql: occurred_at, type: time }
measures:
  - { name: events, type: count }`),
    "Cube queries the catalog relation; the connected engine owns snapshots, storage readers, partition pruning, and table-format semantics.",
    "Validate the selected Cube driver and engine version for Delta, Iceberg, or Parquet behavior.", [DOCS.cubes]);

  add(9, "boundary",
    "Flatten repeated arrays to a declared row grain in source SQL and preserve a stable event or array-element key before defining measures.",
    yaml("event_items", `sql: |
  SELECT e.event_id, e.occurred_at, i.offset AS item_offset,
         i.sku, i.quantity
  FROM raw.events e
  CROSS JOIN UNNEST(e.items) WITH OFFSET AS i
dimensions:
  - name: item_row_key
    sql: "CONCAT(event_id, '|', item_offset)"
    type: string
    primary_key: true
measures:
  - { name: units, sql: quantity, type: sum }`),
    "Cube can wrap a SQL query, but JSON extraction and UNNEST syntax are database-specific source work.",
    "Use a true array offset or generated key; SKU alone may repeat within one event.", [DOCS.cubes]);

  add(10, "boundary",
    "Union compatible sources with UNION ALL, retain provenance, and prove that partitions do not overlap before exposing additive measures.",
    yaml("unified_sales", `sql: |
  SELECT 'us' AS source_region, * FROM raw.sales_us
  UNION ALL
  SELECT 'eu' AS source_region, * FROM raw.sales_eu
dimensions:
  - { name: source_region, sql: source_region, type: string }
  - { name: sale_key, sql: "CONCAT(source_region, '|', sale_id)", type: string, primary_key: true }
measures:
  - { name: revenue, sql: revenue, type: sum }`),
    "Cube can define the union in cube SQL, while overlap checks, schema conformance, and large-scale union maintenance belong to the data pipeline.",
    "UNION removes duplicates and can hide source defects; UNION ALL preserves them. Namespaced keys are required when identifiers collide.", [DOCS.cubes]);

  add(11, "boundary",
    "Ingest APIs and spreadsheets into governed tables with explicit keys and freshness columns, then model those tables as ordinary cubes.",
    yaml("monthly_targets", `sql_table: staging.monthly_targets
dimensions:
  - { name: target_key, sql: target_key, type: string, primary_key: true }
  - { name: month, sql: month, type: time }
  - { name: loaded_at, sql: loaded_at, type: time }
measures:
  - { name: target_amount, sql: target_amount, type: sum }`),
    "Cube is not an API or spreadsheet ingestion service. Extraction, credentials, retries, deduplication, and schema validation must happen upstream.",
    "Do not query volatile operational APIs from generated analytical SQL; snapshot and audit imported values.", [DOCS.cubes]);

  add(12, "boundary",
    "Use Cube's supported cross-source UNION behavior or materialized pre-aggregations/rollup joins; do not imply an arbitrary live federated join.",
    `# Orders and tickets keep separate data_source values.
# For entity-level joining, materialize compatible rollups in Cube Store
# and join them through a rollup_join, or federate upstream.
pre_aggregations:
  - name: orders_by_customer
    type: rollup
    dimensions: [customer_id]
    measures: [revenue]
    external: true`,
    "Cube supports specific cross-source patterns, but arbitrary row-level joins between two live databases require federation or materialization.",
    "Align identifiers, latency, permissions, and refresh cadences. A cross-source UNION is not a substitute for a relational join.", [DOCS.crossSource, DOCS.preAggregations]);

  // 13–27 · Aggregation
  add(13, "core",
    "Sum the lowest-grain disjoint contribution and never re-sum subtotals alongside their children.",
    yaml("order_items", `sql_table: analytics.order_items
dimensions:
  - { name: order_item_id, sql: order_item_id, type: string, primary_key: true }
measures:
  - { name: revenue, sql: revenue, type: sum }
  - { name: units, sql: quantity, type: sum }`),
    "", "Additivity depends on grain and dimensions, not on the measure type alone.", [DOCS.measures]);

  add(14, "core",
    "Name row counts and distinct entity counts separately so consumers can see the difference in grain.",
    yaml("orders", `sql_table: analytics.orders
measures:
  - { name: order_rows, type: count }
  - { name: customers, sql: customer_id, type: count_distinct }`),
    "", "A count measure counts rows at the cube's source grain. The primary key and distinct key must match the intended business entities.", [DOCS.measures]);

  add(15, "core",
    "Count customer identities at the query's grouping scope; do not add precomputed location-level counts.",
    yaml("visits", `sql_table: analytics.customer_visits
dimensions:
  - { name: visit_id, sql: visit_id, type: string, primary_key: true }
  - { name: location_id, sql: location_id, type: string }
  - { name: region, sql: region, type: string }
measures:
  - { name: customers, sql: customer_id, type: count_distinct }`),
    "", "Exact distinct counts require the identity at query time. Approximate sketches are a separate, explicitly approximate contract.", [DOCS.measures]);

  add(16, "core",
    "Count customer identity over the selected date range so the same customer is deduplicated across months.",
    yaml("orders", `sql_table: analytics.orders
dimensions:
  - { name: ordered_at, sql: ordered_at, type: time }
measures:
  - { name: customers, sql: customer_id, type: count_distinct }`),
    "", "Summing monthly customer counts is not an exact multi-month distinct count.", [DOCS.measures]);

  add(17, "boundary",
    "Expose a stored distinct count only at its certified grain, or provide separately materialized rollups or mergeable sketch state for every supported regrouping.",
    yaml("customer_count_snapshots", `sql_table: analytics.customer_count_snapshots
dimensions:
  - { name: aggregation_level, sql: aggregation_level, type: string }
  - { name: location_id, sql: location_id, type: string }
  - { name: day, sql: day, type: time }
measures:
  - { name: unique_customers_at_stored_grain, sql: unique_customers, type: max }`),
    "Cube cannot reconstruct cross-location or cross-time identity from scalar counts. The source must retain identities, sketches, or certified higher-grain results.",
    "Use a curated view and documentation to constrain valid dimensions; max is only safe when one consistent stored value exists per requested group.", [DOCS.views]);

  add(18, "core",
    "Divide aggregate numerator by aggregate denominator so regrouping recomputes the ratio.",
    yaml("orders", `sql_table: analytics.orders
measures:
  - { name: revenue, sql: revenue, type: sum }
  - { name: orders, type: count }
  - { name: average_order_value, sql: "1.0 * {revenue} / NULLIF({orders}, 0)", type: number }`),
    "", "A calculated number measure inherits the filters of its component measures; keep numerator and denominator definitions aligned.", [DOCS.measures]);

  add(19, "core",
    "Aggregate the weighted contribution and the weight separately, then divide the two measures.",
    yaml("sales", `sql_table: analytics.sales
measures:
  - { name: extended_value, sql: "unit_price * units", type: sum }
  - { name: units, sql: units, type: sum }
  - { name: weighted_average_price, sql: "1.0 * {extended_value} / NULLIF({units}, 0)", type: number }`),
    "", "Define how null and negative weights behave; the weight must correspond to the same observation as the value.", [DOCS.measures]);

  add(20, "core",
    "Use a database-specific ordered-set or approximate percentile expression in a number measure.",
    yaml("deliveries", `sql_table: analytics.deliveries
measures:
  - name: delivery_hours_p90
    type: number
    sql: "PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY delivery_hours)"`),
    "", "Percentile SQL is dialect-specific and is generally non-additive. Validate pre-aggregation behavior and exact-versus-approximate semantics.", [DOCS.percentiles]);

  add(21, "core",
    "Use min and max measures over the raw observation rather than summing stored extrema.",
    yaml("responses", `sql_table: analytics.responses
measures:
  - { name: fastest_response_ms, sql: response_ms, type: min }
  - { name: worst_response_ms, sql: response_ms, type: max }
  - { name: first_response_at, sql: "MIN(responded_at)", type: time }`),
    "", "Min and max ignore nulls in normal SQL semantics. Confirm that missing observations should not be treated as zeros.", [DOCS.measures]);

  add(22, "core",
    "Sum balances across accounts only within one selected snapshot date, and expose snapshot time explicitly.",
    yaml("account_snapshots", `sql_table: finance.account_snapshots
dimensions:
  - { name: snapshot_key, sql: snapshot_key, type: string, primary_key: true }
  - { name: snapshot_at, sql: snapshot_at, type: time }
  - { name: account_id, sql: account_id, type: string }
measures:
  - { name: balance, sql: balance, type: sum }`),
    "", "The semantic model does not automatically force one date. Curate the view or consumer query so a point-in-time total cannot span multiple snapshots.", [DOCS.views]);

  add(23, "boundary",
    "Prepare one last observation per entity and reporting period, then sum those entity-level balances across the requested non-time dimensions.",
    yaml("month_end_inventory", `sql_table: analytics.month_end_inventory
dimensions:
  - { name: warehouse_sku_month_key, sql: warehouse_sku_month_key, type: string, primary_key: true }
  - { name: month, sql: month, type: time }
  - { name: warehouse_id, sql: warehouse_id, type: string }
measures:
  - { name: ending_quantity, sql: ending_quantity, type: sum }`),
    "The source transformation selects the last valid snapshot for each SKU, warehouse, and reporting period; Cube then aggregates the prepared semi-additive result.",
    "If users group several periods, the measure is still non-additive across time. Expose an explicit ending-period contract.", [DOCS.snapshots]);

  add(24, "core",
    "Use an unbounded trailing rolling window over an additive measure.",
    yaml("orders", `sql_table: analytics.orders
dimensions:
  - { name: ordered_at, sql: ordered_at, type: time }
measures:
  - { name: revenue, sql: revenue, type: sum }
  - name: cumulative_revenue
    sql: revenue
    type: sum
    rolling_window: { trailing: unbounded }`),
    "", "Running values depend on a time dimension and range in the query. Define the desired reset grain and sorting behavior in the consuming view.", [DOCS.measures]);

  add(25, "core",
    "Use a multi-stage helper fixed at the grand-total grain, then divide the grouped measure by that helper.",
    yaml("sales", `sql_table: analytics.sales
measures:
  - { name: revenue, sql: revenue, type: sum }
  - name: total_revenue_all_groups
    sql: "{revenue}"
    type: number
    multi_stage: true
    grain: { keep_only: [] }
  - name: revenue_share
    sql: "1.0 * {revenue} / NULLIF({total_revenue_all_groups}, 0)"
    type: number
    multi_stage: true
    format: percent_2`),
    "", "Decide whether the denominator should ignore all dimensions or retain selected filters. Multi-stage calculations require the current Tesseract engine.", [DOCS.share]);

  add(26, "core",
    "Preserve a reporting-presence measure and publish zero-filled output only as a separately named convenience measure.",
    yaml("daily_kpis", `sql_table: analytics.daily_kpis
measures:
  - { name: reported_rows, type: count }
  - { name: reported_value, sql: metric_value, type: sum }
  - { name: value_or_zero, sql: "COALESCE({reported_value}, 0)", type: number }`),
    "", "A date spine may still be needed to emit rows for missing dates. Coalescing without a presence signal erases the difference between absent and reported zero.", [DOCS.measures]);

  add(27, "core",
    "Keep gross and returns separately auditable and derive net from their aggregate measures under one sign convention.",
    yaml("sales", `sql_table: analytics.sales_events
measures:
  - { name: gross_sales, sql: gross_sales, type: sum }
  - { name: returns, sql: return_amount, type: sum }
  - { name: net_sales, sql: "{gross_sales} - {returns}", type: number }`),
    "", "If returns arrive at another grain or date, model the facts separately and combine them through a conformed multi-fact view.", [DOCS.measures, DOCS.views]);

  // 28–38 · Relationships and grain
  add(28, "core",
    "Mark a stable, non-null, truly unique dimension as the cube primary key.",
    yaml("orders", `sql_table: analytics.orders
dimensions:
  - name: order_id
    sql: order_id
    type: string
    primary_key: true`),
    "", "Cube uses keys and relationship metadata to avoid join multiplication, but the declaration does not validate source uniqueness for you.", [DOCS.dimensions, DOCS.joins]);

  add(29, "core",
    "Define geography levels as dimensions and group them into an ordered hierarchy for drill and roll-up.",
    yaml("locations", `sql_table: analytics.locations
dimensions:
  - { name: location_id, sql: location_id, type: string, primary_key: true }
  - { name: region, sql: region, type: string }
  - { name: market, sql: market, type: string }
  - { name: location, sql: location_name, type: string }
hierarchies:
  - name: geography
    levels: [region, market, location]`),
    "", "A hierarchy declares navigation order; it does not enforce parent-child uniqueness or repair changing geography assignments.", [DOCS.hierarchies]);

  add(30, "core",
    "Use join aliases so the same customer cube can play billing and shipping roles without ambiguous member names.",
    `cubes:
  - name: orders
    sql_table: analytics.orders
    joins:
      - { name: customers, alias: billing_customer, relationship: many_to_one, sql: "{CUBE}.billing_customer_id = {billing_customer}.id" }
      - { name: customers, alias: shipping_customer, relationship: many_to_one, sql: "{CUBE}.shipping_customer_id = {shipping_customer}.id" }
  - name: customers
    sql_table: analytics.customers
    dimensions:
      - { name: id, sql: id, type: string, primary_key: true }`,
    "", "Join aliases require Tesseract and Cube v1.8.7 or later. Expose explicit aliased paths in a curated view.", [DOCS.joins, DOCS.views]);

  add(31, "core",
    "Declare keys and relationship cardinality so Cube can protect eligible measures from join row multiplication.",
    `cubes:
  - name: orders
    sql_table: analytics.orders
    joins:
      - { name: line_items, relationship: one_to_many, sql: "{CUBE}.order_id = {line_items}.order_id" }
    dimensions:
      - { name: order_id, sql: order_id, type: string, primary_key: true }
    measures:
      - { name: revenue, sql: revenue, type: sum }
  - name: line_items
    sql_table: analytics.line_items
    dimensions:
      - { name: line_item_id, sql: line_item_id, type: string, primary_key: true }`,
    "", "Incorrect primary keys or relationship directions can still produce wrong SQL. Test mixed-grain queries against known fixtures.", [DOCS.joins]);

  add(32, "boundary",
    "Deduplicate repeated header values to one row per order before exposing the order amount as additive.",
    yaml("order_headers", `sql: |
  SELECT order_id, MAX(order_total) AS order_total
  FROM raw.denormalized_order_items
  GROUP BY order_id
dimensions:
  - { name: order_id, sql: order_id, type: string, primary_key: true }
measures:
  - { name: order_revenue, sql: order_total, type: sum }`),
    "Cube has no declaration that makes inconsistent repeated values safe. The source query must collapse and validate one stable amount per order.",
    "MAX is only a deduplication device when all repeated values agree; add a source data-quality check for disagreements.", [DOCS.cubes]);

  add(33, "core",
    "Model membership as its own bridge cube with one row per customer-segment pair and traverse it through declared one-to-many/many-to-one joins.",
    `cubes:
  - name: customers
    sql_table: analytics.customers
    joins:
      - { name: customer_segment_memberships, relationship: one_to_many, sql: "{CUBE}.customer_id = {customer_segment_memberships}.customer_id" }
  - name: customer_segment_memberships
    sql_table: analytics.customer_segment_memberships
    joins:
      - { name: segments, relationship: many_to_one, sql: "{CUBE}.segment_id = {segments}.segment_id" }
    dimensions:
      - { name: membership_id, sql: membership_id, type: string, primary_key: true }`,
    "", "Many-to-many is represented through the bridge rather than a many_to_many relationship type. Counts and amounts must be distinct or allocated deliberately.", [DOCS.joins]);

  add(34, "core",
    "Store bridge weights that sum to one per conversion and aggregate the allocated row contribution.",
    yaml("conversion_attribution", `sql_table: analytics.conversion_attribution
dimensions:
  - { name: attribution_id, sql: attribution_id, type: string, primary_key: true }
  - { name: channel, sql: channel, type: string }
measures:
  - { name: allocated_revenue, sql: "conversion_revenue * attribution_weight", type: sum }
  - { name: attribution_weight, sql: attribution_weight, type: sum }`),
    "", "Validate that weights sum to one at the conversion grain and version the attribution model.", [DOCS.measures]);

  add(35, "core",
    "Model actuals and budgets as separate fact cubes linked to conformed dimensions, then expose compatible measures through a multi-fact view.",
    `cubes:
  - name: actuals
    sql_table: finance.actuals
    joins:
      - { name: departments, relationship: many_to_one, sql: "{CUBE}.department_id = {departments}.id" }
      - { name: months, relationship: many_to_one, sql: "DATE_TRUNC('month', {CUBE}.ordered_at) = {months}.month" }
    measures:
      - { name: revenue, sql: revenue, type: sum }
    dimensions:
      - { name: actual_id, sql: actual_id, type: string, primary_key: true }
  - name: budgets
    sql_table: finance.budgets
    joins:
      - { name: departments, relationship: many_to_one, sql: "{CUBE}.department_id = {departments}.id" }
      - { name: months, relationship: many_to_one, sql: "{CUBE}.budget_month = {months}.month" }
    measures:
      - { name: budget_amount, sql: budget_amount, type: sum }
    dimensions:
      - { name: budget_id, sql: budget_id, type: string, primary_key: true }
  - name: departments
    sql_table: finance.departments
    dimensions:
      - { name: id, sql: id, type: string, primary_key: true }
      - { name: name, sql: name, type: string }
  - name: months
    sql_table: analytics.months
    dimensions:
      - { name: month, sql: month, type: time, primary_key: true }
views:
  - name: actual_vs_budget
    cubes:
      - join_path: actuals
        includes: [revenue]
      - join_path: budgets
        includes: [budget_amount]
      - { join_path: departments, includes: [name] }
      - { join_path: months, includes: [month] }`,
    "", "Cube can combine facts, but the model must prevent accidental daily-versus-monthly comparisons and align currencies, departments, and period keys.", [DOCS.multiFact]);

  add(36, "core",
    "Join each fact to the one dimension version whose effective interval contains the fact timestamp.",
    `cubes:
  - name: orders
    sql_table: analytics.orders
    joins:
      - name: customer_history
        relationship: many_to_one
        sql: >
          {CUBE}.customer_id = {customer_history}.customer_id
          AND {CUBE}.ordered_at >= {customer_history}.valid_from
          AND {CUBE}.ordered_at < COALESCE({customer_history}.valid_to, TIMESTAMP '9999-12-31')`,
    "", "The history table must have non-overlapping intervals so every fact matches at most one version. Range-join SQL is database-specific.", [DOCS.joins]);

  add(37, "boundary",
    "Build an ancestor/descendant closure relation with recursive SQL, then model that flattened bridge in Cube.",
    yaml("org_closure", `sql_table: analytics.org_closure
dimensions:
  - { name: path_id, sql: path_id, type: string, primary_key: true }
  - { name: ancestor_id, sql: ancestor_id, type: string }
  - { name: descendant_id, sql: descendant_id, type: string }
  - { name: depth, sql: depth, type: number }`),
    "Cube consumes the closure table; recursion, cycle detection, effective dating, and rebuild strategy belong to the warehouse transformation.",
    "Protect manager visibility with an access policy on the resulting descendant key, not merely a dashboard filter.", [DOCS.cubes, DOCS.access]);

  add(38, "core",
    "Join a versioned identity map and count the canonical household key rather than the source customer account.",
    `cubes:
  - name: orders
    sql_table: analytics.orders
    joins:
      - { name: identity_map, relationship: many_to_one, sql: "{CUBE}.customer_id = {identity_map}.customer_id" }
    measures:
      - { name: households, sql: "{identity_map.household_id}", type: count_distinct }`,
    "", "Identity resolution is an upstream governed process. Define effective dates, merge/split policy, and treatment of unresolved accounts.", [DOCS.joins, DOCS.measures]);

  // 39–48 · Time and behavior
  add(39, "core",
    "Use the query/default timezone for timestamp presentation and define the business-date expression explicitly when it differs from the user's display timezone.",
    yaml("sales", `sql_table: analytics.sales
dimensions:
  - { name: sold_at, sql: sold_at_utc, type: time }
  - name: los_angeles_business_date
    sql: "DATE(sold_at_utc AT TIME ZONE 'America/Los_Angeles')"
    type: time`),
    "", "Timezone conversion SQL is dialect-specific. Set the deployment default and test daylight-saving transitions and API queries that override timezone.", [DOCS.configuration, DOCS.dimensions]);

  add(40, "core",
    "Define a custom time granularity with a fiscal origin or offset, and proxy it when the consuming protocol cannot address custom granularities directly.",
    yaml("orders", `sql_table: analytics.orders
dimensions:
  - name: ordered_at
    sql: ordered_at
    type: time
    granularities:
      - name: fiscal_year
        interval: 1 year
        origin: "2026-02-01"`),
    "", "Custom granularity support varies by data source; SQL and GraphQL consumers may need a proxy dimension.", [DOCS.dimensions]);

  add(41, "core",
    "Use a calendar cube backed by a governed retail calendar table and override standard grains with its precomputed period starts.",
    yaml("retail_calendar", `calendar: true
sql_table: analytics.retail_calendar
dimensions:
  - { name: date_key, sql: calendar_date, type: time, primary_key: true }
  - name: date
    sql: calendar_date
    type: time
    granularities:
      - { name: week, sql: "{CUBE}.retail_week_begins" }
      - { name: month, sql: "{CUBE}.retail_month_begins" }
      - { name: quarter, sql: "{CUBE}.retail_quarter_begins" }
      - { name: year, sql: "{CUBE}.retail_year_begins" }`),
    "", "Calendar cubes require Tesseract. Generate 53rd-week and comparable-day rules upstream and declare matching grains in pre-aggregations.", [DOCS.calendar]);

  add(42, "core",
    "Define a multi-stage measure with a one-year prior time shift over the governed revenue measure.",
    yaml("orders", `sql_table: analytics.orders
dimensions:
  - { name: ordered_at, sql: ordered_at, type: time }
measures:
  - { name: revenue, sql: revenue, type: sum }
  - name: revenue_prior_year
    sql: "{revenue}"
    type: number
    multi_stage: true
    time_shift:
      - { time_dimension: ordered_at, interval: 1 year, type: prior }`),
    "", "A one-year interval follows the selected calendar semantics. Custom retail comparison may require a calendar cube and comparable-date mapping.", [DOCS.measures, DOCS.time]);

  add(43, "core",
    "Use a trailing window over a distinct user key and anchor it to the query's time range.",
    yaml("activity", `sql_table: analytics.activity
dimensions:
  - { name: activity_at, sql: activity_at, type: time }
measures:
  - name: active_users_28d
    sql: user_id
    type: count_distinct
    rolling_window: { trailing: 28 days }`),
    "", "Rolling distinct work can be expensive and non-additive. Confirm the window's endpoint and pre-aggregation compatibility under the deployed Tesseract version.", [DOCS.measures]);

  add(44, "core",
    "Combine to-date measures with governed completeness flags or comparable-date mappings from the calendar cube.",
    `cubes:
  - name: sales
    sql_table: analytics.sales
    joins:
      - { name: calendar, relationship: many_to_one, sql: "CAST({CUBE}.sold_at AS DATE) = {calendar}.date_key" }
    measures:
      - name: revenue_ytd
        sql: revenue
        type: sum
        rolling_window: { type: to_date, granularity: year }
      - name: revenue_completed_ytd
        sql: revenue
        type: sum
        filters: [{ sql: "{calendar}.is_in_completed_ytd" }]
  - name: calendar
    calendar: true
    sql_table: analytics.calendar
    dimensions:
      - { name: date_key, sql: date_key, type: time, primary_key: true }
      - { name: is_in_completed_ytd, sql: is_in_completed_ytd, type: boolean }`,
    "", "The business completeness cutoff is not necessarily midnight. Refresh calendar flags with the pipeline watermark and use the same calendar for the prior-year comparison.", [DOCS.measures, DOCS.calendar]);

  add(45, "core",
    "Generate or materialize snapshot rows that resolve the latest eligible state per entity and date, then expose the resolved balance.",
    yaml("account_balance_snapshots", `sql: |
  SELECT d.date_value AS as_of_date, s.account_id, s.balance
  FROM analytics.date_spine d
  JOIN finance.account_snapshots s ON s.snapshot_at <= d.date_value
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY d.date_value, s.account_id ORDER BY s.snapshot_at DESC
  ) = 1
dimensions:
  - { name: snapshot_key, sql: "CONCAT(as_of_date, '|', account_id)", type: string, primary_key: true }
  - { name: as_of_date, sql: as_of_date, type: time }
measures:
  - { name: balance, sql: balance, type: sum }`),
    "", "The SQL is illustrative and dialect-specific. Persist or pre-aggregate large snapshot expansions and constrain the supported date range.", [DOCS.snapshots]);

  add(46, "boundary",
    "Prepare cohort membership and activity offset at customer-period grain, then compute retained customers over a stable cohort-size measure.",
    yaml("customer_retention", `sql_table: analytics.customer_retention
dimensions:
  - { name: cohort_customer_period_key, sql: cohort_customer_period_key, type: string, primary_key: true }
  - { name: cohort_month, sql: cohort_month, type: time }
  - { name: months_since_cohort, sql: months_since_cohort, type: number }
measures:
  - { name: retained_customers, sql: customer_id, type: count_distinct }
  - { name: cohort_size, sql: cohort_size, type: max }
  - { name: retention_rate, sql: "1.0 * {retained_customers} / NULLIF({cohort_size}, 0)", type: number }`),
    "First qualifying activity, reactivation, and period-offset logic are source transformations; Cube governs the resulting cohort measures.",
    "cohort_size is non-additive across cohorts. Max assumes one consistent value within each cohort.", [DOCS.cubes, DOCS.measures]);

  add(47, "boundary",
    "Prepare one entity-level funnel record with ordered step timestamps, then count entities that reached each valid step.",
    yaml("user_funnels", `sql_table: analytics.user_funnels
dimensions:
  - { name: user_id, sql: user_id, type: string, primary_key: true }
  - { name: signed_up_at, sql: signed_up_at, type: time }
  - { name: reached_activation, sql: "activated_at >= signed_up_at", type: boolean }
  - { name: reached_purchase, sql: "purchased_at >= activated_at", type: boolean }
measures:
  - { name: signups, type: count }
  - { name: activated, type: count, filters: [{ sql: "{CUBE}.reached_activation" }] }
  - { name: purchased, type: count, filters: [{ sql: "{CUBE}.reached_purchase" }] }`),
    "Sessionization, first qualifying timestamps, ordering, and conversion windows are prepared upstream; Cube does not infer a funnel from arbitrary event rows.",
    "Define identity, duplicate-event, and late-event policy before materializing the entity record.", [DOCS.cubes]);

  add(48, "core",
    "Compute elapsed duration and the SLA flag as explicit SQL dimensions, then aggregate each business outcome separately.",
    yaml("support_tickets", `sql_table: analytics.support_tickets
dimensions:
  - { name: ticket_id, sql: ticket_id, type: string, primary_key: true }
  - { name: first_response_hours, sql: "DATEDIFF('second', opened_at, first_response_at) / 3600.0", type: number }
  - { name: met_first_response_sla, sql: "DATEDIFF('minute', opened_at, first_response_at) <= 240", type: boolean }
measures:
  - { name: average_first_response_hours, sql: "{first_response_hours}", type: avg }
  - { name: tickets_meeting_sla, type: count, filters: [{ sql: "{CUBE}.met_first_response_sla" }] }`),
    "", "DATEDIFF syntax is dialect-specific. Working hours, holidays, paused states, and missing endpoints require a business-calendar calculation.", [DOCS.dimensions, DOCS.measures]);

  // 49–55 · Business transformations
  add(49, "core",
    "Join exactly one governed rate by source currency, reporting currency, date, and rate type; sum converted row values.",
    `cubes:
  - name: orders
    sql_table: analytics.orders
    joins:
      - name: fx_daily
        relationship: many_to_one
        sql: >
          {CUBE}.currency_code = {fx_daily}.from_currency
          AND CAST({CUBE}.ordered_at AS DATE) = {fx_daily}.rate_date
          AND {fx_daily}.to_currency = 'USD'
    measures:
      - { name: revenue_usd, sql: "{CUBE}.revenue_local * {fx_daily.rate}", type: sum }`,
    "", "Define spot versus average rate, missing-rate behavior, triangulation, and restatement. The join must return at most one rate per fact row.", [DOCS.joins, DOCS.measures]);

  add(50, "core",
    "Join a versioned conversion factor and aggregate the normalized base-unit quantity.",
    `cubes:
  - name: inventory_movements
    sql_table: analytics.inventory_movements
    joins:
      - name: unit_conversion
        relationship: many_to_one
        sql: "{CUBE}.unit_code = {unit_conversion}.from_unit AND {unit_conversion}.to_unit = 'KG'"
    measures:
      - { name: quantity_kg, sql: "{CUBE}.quantity * {unit_conversion.factor}", type: sum }`,
    "", "Some conversions depend on product density, temperature, or effective date. Add that context to the key when a universal factor is invalid.", [DOCS.joins]);

  add(51, "core",
    "Keep scenario as a dimension and define named filtered measures for stable comparisons.",
    yaml("plan", `sql_table: finance.plan
dimensions:
  - { name: scenario, sql: scenario, type: string }
measures:
  - { name: actual, sql: amount, type: sum, filters: [{ sql: "{CUBE}.scenario = 'ACTUAL'" }] }
  - { name: budget, sql: amount, type: sum, filters: [{ sql: "{CUBE}.scenario = 'BUDGET'" }] }
  - { name: forecast, sql: amount, type: sum, filters: [{ sql: "{CUBE}.scenario = 'FORECAST'" }] }
  - { name: actual_vs_budget, sql: "{actual} - {budget}", type: number }`),
    "", "Facts must share grain, currency, and version. Keep forecast submissions versioned rather than silently replacing prior forecasts.", [DOCS.measures]);

  add(52, "core",
    "Use a switch dimension with an allowlist and a multi-stage case measure so the selected assumption cannot inject arbitrary SQL.",
    yaml("orders", `sql_table: analytics.orders
dimensions:
  - { name: discount_scenario, type: switch, values: [none, five_percent, ten_percent] }
measures:
  - { name: gross_revenue, sql: revenue, type: sum }
  - name: simulated_revenue
    type: number
    multi_stage: true
    case:
      switch: "{CUBE.discount_scenario}"
      when:
        - { value: five_percent, sql: "{CUBE.gross_revenue} * 0.95" }
        - { value: ten_percent, sql: "{CUBE.gross_revenue} * 0.90" }
      else: { sql: "{CUBE.gross_revenue}" }`),
    "", "Switch and case measures require Tesseract. Label simulations clearly; they are query-time scenarios, not persisted plans.", [DOCS.dimensions, DOCS.measures]);

  add(53, "core",
    "Use a switch dimension and case measure to select among a controlled set of governed measures.",
    yaml("orders", `sql_table: analytics.orders
dimensions:
  - { name: metric_picker, type: switch, values: [revenue, orders, units] }
measures:
  - { name: revenue, sql: revenue, type: sum }
  - { name: orders, type: count }
  - { name: units, sql: units, type: sum }
  - name: selected_metric
    type: number
    multi_stage: true
    case:
      switch: "{CUBE.metric_picker}"
      when:
        - { value: orders, sql: "{CUBE.orders}" }
        - { value: units, sql: "{CUBE.units}" }
      else: { sql: "{CUBE.revenue}" }`),
    "", "One selected field cannot preserve different units and formats perfectly. Keep the named measures available for audited reuse.", [DOCS.measures]);

  add(54, "boundary",
    "Materialize entity-level lifetime features, then define ordered and mutually exclusive segment labels in the customer cube.",
    yaml("customers", `sql_table: analytics.customer_features
dimensions:
  - { name: customer_id, sql: customer_id, type: string, primary_key: true }
  - name: customer_segment
    type: string
    case:
      when:
        - { sql: "{CUBE}.lifetime_revenue >= 100000", label: Enterprise }
        - { sql: "{CUBE}.lifetime_revenue >= 10000", label: Growth }
      else: { label: Core }`),
    "Cube owns the segment rule, while lifetime revenue and activity features must be computed at one row per customer before transactional joins can fan them out.",
    "CASE uses first-match order. Version thresholds and make segment effective dates explicit.", [DOCS.dimensions]);

  add(55, "core",
    "Expose stable geography attributes, an ordered hierarchy, and a native geo dimension for coordinates.",
    yaml("locations", `sql_table: analytics.locations
dimensions:
  - { name: country, sql: country_code, type: string }
  - { name: region, sql: region, type: string }
  - { name: city, sql: city, type: string }
  - { name: postal_code, sql: postal_code, type: string }
  - name: location
    type: geo
    latitude: { sql: "{CUBE}.latitude" }
    longitude: { sql: "{CUBE}.longitude" }
hierarchies:
  - { name: geography, levels: [country, region, city, postal_code] }`),
    "", "Geocoding quality, privacy, and boundary changes remain data-governance concerns. Coordinates should represent the intended entity.", [DOCS.dimensions, DOCS.hierarchies]);

  // 56–60 · Governance
  add(56, "core",
    "Apply a row-level access policy using a trusted user attribute or security-context value.",
    yaml("orders", `sql_table: analytics.orders
access_policy:
  - group: regional_manager
    row_level:
      filters:
        - { member: region_code, operator: equals, values: ["{ userAttributes.region_code }"] }`),
    "", "Cube Cloud userAttributes and Cube Core securityContext differ. Secure token issuance and test REST, SQL, GraphQL, scheduled, and service-account paths.", [DOCS.access]);

  add(57, "core",
    "Use member-level policies to grant sensitive measures only to authorized groups, and protect equivalent derivation paths too.",
    yaml("orders", `sql_table: analytics.orders
access_policy:
  - group: finance
    member_level: { includes: "*" }
  - group: analyst
    member_level:
      excludes: [gross_margin, cost]
measures:
  - { name: gross_margin, sql: gross_margin, type: sum }`),
    "", "Visibility is enforced by policy, but warehouse credentials and alternate fields must also be reviewed for leakage.", [DOCS.access]);

  add(58, "boundary",
    "Use access policies for non-negotiable security predicates; keep editable defaults and ordinary query filters in the consuming application or workbook.",
    yaml("events", `sql_table: analytics.events
dimensions:
  - { name: retention_scope, sql: retention_scope, type: string }
access_policy:
  - group: "*"
    row_level:
      filters:
        - { member: retention_scope, operator: equals, values: [allowed] }
# Consumer default: status = complete (editable in UI).`),
    "Cube access policies enforce authorization. A default-but-editable filter is presentation state, not a security control in the semantic model.",
    "Do not encode a rolling retention date as a static allowlist. Derive an allowed scope upstream or use a trusted query-rewrite/security rule.", [DOCS.access]);

  add(59, "core",
    "Put the business definition and curated drill members beside the measure, and add AI context where it improves agent behavior.",
    yaml("orders", `sql_table: analytics.orders
dimensions:
  - { name: order_id, sql: order_id, type: string, primary_key: true }
  - { name: ordered_at, sql: ordered_at, type: time }
  - { name: customer_name, sql: customer_name, type: string }
measures:
  - { name: gross_sales, sql: gross_sales, type: sum }
  - { name: returns, sql: return_amount, type: sum }
  - name: net_revenue
    title: Net revenue
    description: "Captured sales less posted returns; excludes tax. Owner: Finance Analytics."
    sql: "{gross_sales} - {returns}"
    type: number
    drill_members: [order_id, ordered_at, customer_name, net_revenue]
    meta:
      ai_context: "Use this certified measure for net revenue questions."`),
    "", "Descriptions are part of the contract. Keep ownership current and ensure drills do not reveal fields the caller is not authorized to access.", [DOCS.measures]);

  add(60, "core",
    "Define audited logic once in a base cube and reuse it through extends and curated views instead of copying SQL.",
    `cubes:
  - name: financial_metrics_base
    public: false
    measures:
      - { name: net_revenue, sql: net_revenue, type: sum }
  - name: orders
    extends: financial_metrics_base
    sql_table: analytics.orders
views:
  - name: finance_orders
    cubes:
      - join_path: orders
        includes: [net_revenue]`,
    "", "Keep inheritance shallow and validate the exposed view after changes. Extends merges definitions; it does not create an independent version automatically.", [DOCS.cubes, DOCS.views]);

  // 61–68 · Performance and evolution
  add(61, "core",
    "Define a rollup pre-aggregation at the smallest reusable grain and include only measures that can be rolled up safely.",
    yaml("events", `sql_table: analytics.events
dimensions:
  - { name: occurred_at, sql: occurred_at, type: time }
  - { name: product_id, sql: product_id, type: string }
measures:
  - { name: revenue, sql: revenue, type: sum }
  - { name: events, type: count }
pre_aggregations:
  - name: daily_product_metrics
    measures: [CUBE.revenue, CUBE.events]
    dimensions: [CUBE.product_id]
    time_dimension: CUBE.occurred_at
    granularity: day`),
    "", "Non-additive measures need a documented decomposition or specialized pre-aggregation strategy. Confirm that queries actually match the rollup.", [DOCS.preAggregations]);

  add(62, "core",
    "Tie cube cache invalidation and pre-aggregation refresh to a cheap, monotonic warehouse freshness signal.",
    yaml("orders", `sql_table: analytics.orders
refresh_key:
  sql: "SELECT MAX(batch_id) FROM analytics.etl_audit WHERE pipeline = 'orders'"
dimensions:
  - { name: ordered_at, sql: ordered_at, type: time }
measures:
  - { name: revenue, sql: revenue, type: sum }
  - { name: count, type: count }
pre_aggregations:
  - name: daily_orders
    measures: [CUBE.revenue, CUBE.count]
    time_dimension: CUBE.ordered_at
    granularity: day
    refresh_key:
      every: 1 hour`),
    "", "A refresh key detects change; it does not prove ETL success or completeness. Keep the trigger query cheap and available to refresh workers.", [DOCS.cubes, DOCS.preAggregations]);

  add(63, "core",
    "Define a rollup containing the dimensions, time grain, and measures common queries need; Cube selects matching pre-aggregations automatically.",
    yaml("orders", `sql_table: analytics.orders
dimensions:
  - { name: region, sql: region, type: string }
  - { name: ordered_at, sql: ordered_at, type: time }
measures:
  - { name: revenue, sql: revenue, type: sum }
  - { name: count, type: count }
pre_aggregations:
  - name: monthly_region
    measures: [CUBE.revenue, CUBE.count]
    dimensions: [CUBE.region]
    time_dimension: CUBE.ordered_at
    granularity: month`),
    "", "A query only matches when its members, filters, time grain, and measure semantics can be served from the rollup. Inspect used pre-aggregations in query metadata.", [DOCS.preAggregations]);

  add(64, "core",
    "Use count_distinct_approx when documented error is acceptable; the HyperLogLog state is additive and rollup-friendly.",
    yaml("events", `sql_table: analytics.events
dimensions:
  - { name: occurred_at, sql: occurred_at, type: time }
measures:
  - { name: approximate_users, sql: user_id, type: count_distinct_approx }
pre_aggregations:
  - name: daily_users
    measures: [CUBE.approximate_users]
    time_dimension: CUBE.occurred_at
    granularity: day`),
    "", "Never substitute approximation for billing, compliance, or entitlements. Validate error characteristics and data-source support.", [DOCS.measures, DOCS.preAggregations]);

  add(65, "core",
    "Partition the rollup by time, refresh incrementally, and keep a late-arrival update window based on observed data latency.",
    yaml("flights", `sql_table: analytics.flights
dimensions:
  - { name: carrier, sql: carrier, type: string }
  - { name: departure_at, sql: departure_at, type: time }
measures:
  - { name: count, type: count }
pre_aggregations:
  - name: daily_carrier
    measures: [CUBE.count]
    dimensions: [CUBE.carrier]
    time_dimension: CUBE.departure_at
    granularity: day
    partition_granularity: month
    refresh_key:
      every: 1 hour
      incremental: true
      update_window: 3 days`),
    "", "The update window refreshes recent partitions; it does not repair changes older than the window. Schedule backfills or targeted partition refreshes when required.", [DOCS.preAggregations]);

  add(66, "boundary",
    "Run a fixed Cube query against a controlled fixture or approved historical slice in CI and assert the expected result outside the model file.",
    `# CI pseudocode
result = cube_api.load({
  measures: ["orders.net_revenue"],
  timeDimensions: [{ dimension: "orders.ordered_at", dateRange: ["2026-01-01", "2026-12-31"] }]
})
assert result.first("orders.net_revenue") == 204259`,
    "Cube has compile/development validation and content dependency checks, but no native YAML data-test assertion equivalent for an exact metric value.",
    "Use stable fixtures or approved closed periods. Mutable production data makes exact-value assertions noisy; also test SQL shape, permissions, and pre-aggregation matches.", [DOCS.contentValidator]);

  add(67, "core",
    "Publish an explicit new measure, retain the prior definition during migration, and describe effective dates and deprecation in metadata.",
    yaml("orders", `sql_table: analytics.orders
measures:
  - name: net_revenue_v1
    title: "Net revenue (legacy—booked returns)"
    description: "Deprecated after FY2026 close."
    sql: "{gross_sales} - {booked_returns}"
    type: number
  - name: net_revenue_v2
    title: Net revenue
    description: "v2: gross sales less settled returns. Effective FY2027."
    sql: "{gross_sales} - {settled_returns}"
    type: number`),
    "", "Renaming a member is not versioning. Check view, workbook, API, and pre-aggregation dependencies before hiding the old measure.", [DOCS.measures, DOCS.contentValidator]);

  add(68, "core",
    "Retain result type and model version as dimensions, and expose observed and predicted quantities as separate filtered measures.",
    yaml("demand_results", `sql_table: analytics.demand_results
dimensions:
  - { name: result_type, sql: result_type, type: string }
  - { name: model_version, sql: model_version, type: string }
  - { name: forecast_horizon, sql: forecast_horizon, type: string }
measures:
  - { name: observed_units, sql: units, type: sum, filters: [{ sql: "{CUBE}.result_type = 'OBSERVED'" }] }
  - { name: predicted_units, sql: units, type: sum, filters: [{ sql: "{CUBE}.result_type = 'PREDICTED'" }] }
  - { name: forecast_error, sql: "{observed_units} - {predicted_units}", type: number }`),
    "", "Evaluate the forecast version available at the cutoff, not a backfilled model. Actual and predicted rows must align on item, horizon, unit, and grain.", [DOCS.measures]);

  window.CUBE_USE_CASES = cases;
})();
