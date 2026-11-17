(() => {
  const sourceCases = new Map((window.LOOKML_USE_CASES || []).map(item => [item.id, item]));
  const cases = [];
  const DOCS = {
    genie: { label: "Genie Agents overview", url: "https://docs.databricks.com/aws/en/genie-agents/" },
    concepts: { label: "Genie Agent concepts", url: "https://docs.databricks.com/aws/en/genie-agents/concepts" },
    tune: { label: "Tune Genie Agent quality", url: "https://docs.databricks.com/aws/en/genie-agents/tune-quality/" },
    monitor: { label: "Test and monitor Genie Agents", url: "https://docs.databricks.com/aws/en/genie-agents/monitor" },
    yaml: { label: "Metric view YAML reference", url: "https://docs.databricks.com/aws/en/uc-semantics/metric-views/yaml-reference" },
    model: { label: "Model metric views", url: "https://docs.databricks.com/aws/en/uc-semantics/metric-views/basic-modeling" },
    query: { label: "Query metric views", url: "https://docs.databricks.com/aws/en/uc-semantics/metric-views/query" },
    advanced: { label: "Advanced metric-view techniques", url: "https://docs.databricks.com/aws/en/uc-semantics/metric-views/advanced-techniques" },
    parameters: { label: "Metric-view parameters", url: "https://docs.databricks.com/aws/en/uc-semantics/metric-views/use-parameters" },
    materialization: { label: "Metric-view materialization", url: "https://docs.databricks.com/aws/en/uc-semantics/metric-views/materialization" },
    availability: { label: "Metric-view feature availability", url: "https://docs.databricks.com/aws/en/uc-semantics/metric-views/feature-availability" },
    metadata: { label: "Agent metadata in metric views", url: "https://docs.databricks.com/aws/en/uc-semantics/agent-metadata" },
    federation: { label: "Lakehouse Federation", url: "https://docs.databricks.com/aws/en/query-federation" },
    security: { label: "Unity Catalog row filters and masks", url: "https://docs.databricks.com/aws/en/data-governance/unity-catalog/filters-and-masks" },
    constraints: { label: "Primary keys and RELY constraints", url: "https://docs.databricks.com/aws/en/sql/user/queries/query-optimization-constraints" }
  };
  const labels = {
    core: "Metric view + Genie",
    boundary: "Unity Catalog / source boundary",
    unsupported: "Not supported"
  };
  const BUSINESS_OVERRIDES = {
    "case-06": "Daily CSV exports land under an S3 prefix and analysts need governed fields in Genie.",
    "case-07": "Finance publishes CSV extracts in ADLS and needs governed analysis in Databricks.",
    "case-60": "Several Agents and dashboards need the same audited revenue measure with small presentation differences.",
    "case-62": "Metric-view materializations and query results should refresh after lakehouse ETL completes.",
    "case-65": "A large daily materialization should update incrementally while accounting for late events.",
    "case-66": "A semantic change should fail the Agent quality gate when a reviewed finance answer regresses."
  };

  function add(number, support, rule, code, supportNote, caveat, docs = []) {
    const id = `case-${String(number).padStart(2, "0")}`;
    const source = sourceCases.get(id);
    if (!source) throw new Error(`Missing source situation ${id}`);
    cases.push({
      ...source,
      business: BUSINESS_OVERRIDES[id] || source.business,
      rule,
      code: code ? code.trim() : "",
      caveat,
      mode: labels[support],
      support,
      supportNote: supportNote || (support === "core"
        ? "Define deterministic semantics in a Unity Catalog metric view, then add that metric view to the Genie Agent as a data source."
        : ""),
      docs
    });
  }

  // 01–12 · Sources and table shapes
  add(1, "core",
    "Expose the transaction grain as fields and aggregate row-level amounts into named measures with agent-facing metadata.",
    `version: 1.1
source: analytics.core.orders
fields:
  - { name: order_id, expr: order_id, comment: "Unique order key" }
  - { name: order_date, expr: CAST(ordered_at AS DATE) }
measures:
  - name: gross_revenue
    expr: SUM(revenue)
    synonyms: [sales, gross sales]
  - { name: units, expr: SUM(quantity) }`,
    "", "The metric view does not enforce order_id uniqueness. Validate the physical grain in the pipeline and add realistic revenue questions to the Agent benchmark set.", [DOCS.yaml, DOCS.monitor]);

  add(2, "core",
    "Create one measure per wide-table KPI and keep non-additive KPIs out of generic SUM definitions.",
    `version: 1.1
source: analytics.marts.daily_location_kpis
fields:
  - { name: location_id, expr: location_id }
  - { name: day, expr: day }
measures:
  - { name: gross_revenue, expr: SUM(gross_revenue) }
  - { name: orders, expr: SUM(order_count) }
  - { name: units, expr: SUM(units) }`,
    "", "Separate columns do not make every KPI additive. Stored ratios and distinct counts need definitions that preserve their own aggregation behavior.", [DOCS.model]);

  add(3, "core",
    "Filter each measure by metric code so values with different units never flow through one generic aggregate.",
    `version: 1.1
source: analytics.marts.long_kpis
fields:
  - { name: day, expr: day }
measures:
  - name: gross_revenue
    expr: SUM(metric_value) FILTER (WHERE metric_code = 'GROSS_REVENUE')
  - name: units
    expr: SUM(metric_value) FILTER (WHERE metric_code = 'UNITS')`,
    "", "A single SUM(metric_value) mixes currencies, counts, rates, and units. Limit the Agent to curated named measures rather than teaching it to aggregate the value column freely.", [DOCS.yaml, DOCS.tune]);

  add(4, "core",
    "Define each behavior independently and compose ratio measures from earlier measures with MEASURE references.",
    `version: 1.1
source: analytics.marts.metric_events
measures:
  - name: revenue
    expr: SUM(metric_value) FILTER (WHERE metric_code = 'REVENUE')
  - name: orders
    expr: SUM(metric_value) FILTER (WHERE metric_code = 'ORDERS')
  - { name: customers, expr: COUNT(DISTINCT customer_id) }
  - name: average_order_value
    expr: MEASURE(revenue) / NULLIF(MEASURE(orders), 0)`,
    "", "Document units, ownership, and valid grains in comments and Agent instructions. A long-table discriminator does not supply those contracts automatically.", [DOCS.advanced, DOCS.tune]);

  add(5, "core",
    "Aggregate numerator and denominator independently, then divide the aggregated results.",
    `measures:
  - name: clicks
    expr: SUM(metric_value) FILTER (WHERE metric_code = 'CLICKS')
  - name: impressions
    expr: SUM(metric_value) FILTER (WHERE metric_code = 'IMPRESSIONS')
  - name: click_through_rate
    expr: MEASURE(clicks) / NULLIF(MEASURE(impressions), 0)
    format:
      type: percentage
      decimal_places: { type: exact, places: 2 }`,
    "", "Do not average stored daily CTR values unless equal-day weighting is intentional. Decide whether a zero denominator returns NULL or zero.", [DOCS.yaml, DOCS.metadata]);

  add(6, "boundary",
    "Register the S3 files as a governed Unity Catalog table first; expose that table or a cleaned view through a metric view and Genie.",
    `# File parsing and schema evolution live outside the Agent.
version: 1.1
source: lake.external.sales_csv
fields:
  - { name: sold_date, expr: CAST(sold_at AS DATE) }
measures:
  - { name: revenue, expr: SUM(revenue) }`,
    "Genie and metric views consume Unity Catalog assets; they do not define object-store parsers, credentials, Auto Loader checkpoints, or malformed-row policy.", "Validate headers, delimiters, types, partitions, credentials, and schema drift before the table becomes an Agent source.", [DOCS.concepts, DOCS.model]);

  add(7, "boundary",
    "Register or ingest the ADLS files into a stable Unity Catalog relation before adding semantics.",
    `# lake.finance.monthly_extract is registered or populated upstream.
version: 1.1
source: lake.finance.monthly_extract
fields:
  - { name: month, expr: month }
measures:
  - { name: net_revenue, expr: SUM(net_revenue) }`,
    "The Agent does not authenticate to ADLS or own file parsing and ingestion.", "Retain load timestamps and source versions so Genie can answer freshness questions without guessing.", [DOCS.concepts]);

  add(8, "core",
    "Point the metric view at a governed Delta, managed Iceberg, foreign, or external table registered in Unity Catalog.",
    `version: 1.1
source: lakehouse.analytics.events
fields:
  - { name: event_id, expr: event_id }
  - { name: event_date, expr: CAST(occurred_at AS DATE) }
measures:
  - { name: events, expr: COUNT(*) }
  - { name: actors, expr: COUNT(DISTINCT actor_id) }`,
    "", "Table-format maintenance, snapshot selection, credentials, and file pruning remain storage/catalog concerns. Genie only sees the registered asset and its permitted data.", [DOCS.model, DOCS.concepts]);

  add(9, "core",
    "Flatten repeated arrays in a SQL-query source and preserve a stable item grain before defining measures.",
    `version: 1.1
source: |
  SELECT e.event_id, e.occurred_at, item_offset,
         item.sku AS sku, item.quantity AS quantity
  FROM raw.events e
  LATERAL VIEW posexplode(e.payload.items) exploded AS item_offset, item
fields:
  - { name: event_item_id, expr: CONCAT(event_id, ':', item_offset) }
  - { name: sku, expr: sku }
measures:
  - { name: units, expr: SUM(quantity) }`,
    "", "Preserve array position or another collision-safe item key. Test the source SQL separately; the Agent should not invent its own explode pattern.", [DOCS.yaml, DOCS.tune]);

  add(10, "core",
    "Union compatible partitions in the metric-view source, retain provenance, and namespace identifiers when sources can collide.",
    `version: 1.1
source: |
  SELECT 'US' AS source_region, * FROM raw.sales_us
  UNION ALL
  SELECT 'EU' AS source_region, * FROM raw.sales_eu
fields:
  - { name: source_region, expr: source_region }
  - { name: sale_id, expr: sale_id }
measures:
  - { name: revenue, expr: SUM(revenue) }`,
    "", "UNION ALL preserves duplicates. Prove the partitions are disjoint and keep source_region available for reconciliation.", [DOCS.yaml]);

  add(11, "boundary",
    "Ingest API and spreadsheet records into governed tables with extraction metadata, then expose those tables to Genie.",
    `version: 1.1
source: analytics.staging.monthly_targets
fields:
  - { name: team_id, expr: team_id }
  - { name: month, expr: month }
  - { name: loaded_at, expr: loaded_at }
measures:
  - { name: target_revenue, expr: SUM(target_revenue) }`,
    "Genie does not call arbitrary APIs, authenticate to spreadsheets, or schedule ingestion.", "Keep extraction time, source version, rejected rows, and owner visible so conversational answers can be audited.", [DOCS.concepts]);

  add(12, "core",
    "Make local and remote data queryable through Unity Catalog, then define one metric-view SQL source or governed view across them.",
    `version: 1.1
source: |
  SELECT o.order_id, o.customer_id, o.revenue, t.ticket_id
  FROM main.sales.orders o
  LEFT JOIN support_foreign.core.tickets t
    ON o.customer_id = t.customer_id
fields:
  - { name: order_id, expr: order_id }
measures:
  - { name: revenue, expr: SUM(revenue) }
  - { name: tickets, expr: COUNT(DISTINCT ticket_id) }`,
    "", "Lakehouse Federation is read-only for remote sources and performance depends on pushdown, network latency, and remote capacity. Prefer ingestion for high-volume, latency-sensitive domains.", [DOCS.federation, DOCS.yaml]);

  // 13–27 · Aggregation
  add(13, "core",
    "Sum only lowest-grain disjoint contributions and exclude subtotal rows from the source or measure filter.",
    `measures:
  - name: revenue
    expr: SUM(revenue) FILTER (WHERE row_level = 'DETAIL')
    comment: "Additive order-line revenue; subtotal rows excluded."`,
    "", "A mixed detail/subtotal source will double count unless the levels are filtered or modeled separately.", [DOCS.yaml]);

  add(14, "core",
    "Publish row count and distinct entity count as separate, unambiguously named measures.",
    `measures:
  - { name: order_rows, expr: COUNT(*) }
  - name: unique_customers
    expr: COUNT(DISTINCT customer_id)
    synonyms: [customers, customer count]`,
    "", "COUNT(DISTINCT customer_id) ignores NULL. Decide whether anonymous activity is excluded, bucketed, or assigned another identity.", [DOCS.model]);

  add(15, "core",
    "Count customer identities over the selected grouping scope instead of summing location-level counts.",
    `fields:
  - { name: location_id, expr: location_id }
  - { name: region, expr: region }
measures:
  - { name: unique_customers, expr: COUNT(DISTINCT customer_id) }

# Genie-generated metric query:
SELECT region, MEASURE(unique_customers)
FROM analytics.metrics.customer_visits GROUP BY ALL`,
    "", "The source must retain customer identity or mergeable state. A regional exact answer cannot be reconstructed from location totals alone.", [DOCS.query]);

  add(16, "core",
    "Compute distinct identity across the user-selected time interval from event-level data.",
    `fields:
  - { name: activity_date, expr: CAST(activity_at AS DATE) }
  - { name: activity_month, expr: DATE_TRUNC('MONTH', activity_at) }
measures:
  - { name: active_customers, expr: COUNT(DISTINCT customer_id) }`,
    "", "High-cardinality exact counts can be expensive. If you add an approximate version, give it a different name and error contract.", [DOCS.model, DOCS.materialization]);

  add(17, "unsupported",
    "Do not present stored subgroup distinct counts as regroupable customer counts.",
    "",
    "Neither Genie nor a metric view can recover the overlap between precomputed location/day distinct counts when customer identities or mergeable sketches were discarded.", "Retain entity identifiers, store mergeable sketch state, or materialize a separate count for every approved query grain. An Agent instruction is not an enforcement mechanism.", [DOCS.model]);

  add(18, "core",
    "Define additive components first, then divide composed measures so every regrouping recalculates the ratio.",
    `measures:
  - { name: revenue, expr: SUM(revenue) }
  - { name: order_count, expr: COUNT(DISTINCT order_id) }
  - name: average_order_value
    expr: MEASURE(revenue) / NULLIF(MEASURE(order_count), 0)
    synonyms: [AOV, average order]`,
    "", "An equal-weighted average of store AOVs answers a different question. Use benchmarks to catch misleading alternate phrasings.", [DOCS.advanced, DOCS.monitor]);

  add(19, "core",
    "Aggregate extended value and weight separately, then divide the aggregates.",
    `measures:
  - { name: extended_value, expr: SUM(unit_price * units) }
  - { name: total_units, expr: SUM(units) }
  - name: weighted_price
    expr: MEASURE(extended_value) / NULLIF(MEASURE(total_units), 0)`,
    "", "Weights must align to the row grain and normally be non-negative. Do not re-weight values that are already aggregated without their base weights.", [DOCS.yaml]);

  add(20, "core",
    "Calculate percentiles from the lowest-grain observations with an explicit exact or approximate aggregate.",
    `measures:
  - name: p90_response_ms
    expr: percentile(response_ms, 0.90)
    comment: "Exact p90 across eligible request rows"
  - name: approx_p90_response_ms
    expr: approx_percentile(response_ms, 0.90)`,
    "", "Percentiles are non-additive and require an exact materialization match. Never roll up subgroup percentiles as if they were sums.", [DOCS.yaml, DOCS.materialization]);

  add(21, "core",
    "Use MIN and MAX over observations; extrema remain valid over disjoint partitions that cover the selection.",
    `measures:
  - { name: fastest_response_ms, expr: MIN(response_ms) }
  - { name: slowest_response_ms, expr: MAX(response_ms) }`,
    "", "Null handling follows Databricks SQL aggregate semantics. Confirm that the source partitions fully cover the requested population.", [DOCS.yaml]);

  add(22, "core",
    "Use a semi-additive window measure that selects the last snapshot across time and sums across accounts.",
    `version: 1.1
fields:
  - { name: snapshot_date, expr: snapshot_date }
  - { name: account_id, expr: account_id }
measures:
  - name: ending_balance
    expr: SUM(balance)
    window:
      - { order: snapshot_date, range: current, semiadditive: last }`,
    "Requires Databricks Runtime 19 or a current SQL warehouse for the semiadditive option.", "Confirm snapshot completeness, timezone, and missing-account behavior. Last observed is not always the same as period-end certified.", [DOCS.yaml, DOCS.availability]);

  add(23, "core",
    "Give each non-additive axis an explicit window rule; do not imply that a measure can be summed across every exposed field.",
    `fields:
  - { name: snapshot_date, expr: snapshot_date }
  - { name: warehouse_id, expr: warehouse_id }
measures:
  - name: ending_inventory
    expr: SUM(on_hand_quantity)
    window:
      - { order: snapshot_date, range: current, semiadditive: last }`,
    "", "Metric views do not provide a general valid-dimensions constraint. Describe forbidden regroupings and keep unsafe dimensions out of the Agent source when necessary.", [DOCS.yaml, DOCS.tune]);

  add(24, "core",
    "Define the running total as a cumulative window measure ordered by the business date.",
    `fields:
  - { name: order_date, expr: CAST(ordered_at AS DATE) }
measures:
  - { name: revenue, expr: SUM(revenue) }
  - name: running_revenue
    expr: SUM(revenue)
    window:
      - { order: order_date, range: cumulative }`,
    "", "Window results depend on the exact query grain and are not rollup-eligible for materialization. Keep the ordering field in Agent examples.", [DOCS.advanced, DOCS.materialization]);

  add(25, "core",
    "Use a range-all window denominator across the displayed category, then divide the current measure by that total.",
    `fields:
  - { name: category, expr: category }
measures:
  - { name: revenue, expr: SUM(revenue) }
  - name: all_category_revenue
    expr: SUM(revenue)
    window:
      - { order: category, range: all }
  - name: category_share
    expr: MEASURE(revenue) / NULLIF(MEASURE(all_category_revenue), 0)`,
    "", "The denominator follows the metric-view query and filters. For a fixed company total independent of filters, use a separately governed source or trusted SQL function.", [DOCS.advanced, DOCS.tune]);

  add(26, "core",
    "Preserve nullable observations and publish coverage beside any display-safe zero-filled measure.",
    `measures:
  - { name: revenue_reported, expr: SUM(revenue) }
  - { name: revenue_display_zero, expr: COALESCE(SUM(revenue), 0) }
  - { name: reported_rows, expr: COUNT_IF(revenue IS NOT NULL) }
  - { name: missing_rows, expr: COUNT_IF(revenue IS NULL) }`,
    "", "COALESCE can conceal a failed feed. Teach Genie to mention coverage when users ask for zero-filled results.", [DOCS.tune, DOCS.yaml]);

  add(27, "core",
    "Normalize return signs once and expose gross, returns, and net as separately auditable measures.",
    `measures:
  - name: gross_sales
    expr: SUM(amount) FILTER (WHERE event_type = 'SALE')
  - name: returns
    expr: SUM(ABS(amount)) FILTER (WHERE event_type = 'RETURN')
  - name: net_sales
    expr: MEASURE(gross_sales) - MEASURE(returns)`,
    "", "Do not apply ABS when returns are already stored negative and net is defined by addition. Document tax, discount, and cancellation treatment.", [DOCS.yaml]);

  // 28–38 · Relationships and grain
  add(28, "core",
    "Declare primary and foreign keys on the Unity Catalog tables, validate them in the pipeline, and let Genie discover the relationship.",
    `ALTER TABLE analytics.core.order_lines
  ADD CONSTRAINT order_lines_pk
  PRIMARY KEY (order_id, line_number) RELY;

ALTER TABLE analytics.core.order_lines
  ADD CONSTRAINT order_lines_order_fk
  FOREIGN KEY (order_id)
  REFERENCES analytics.core.orders(order_id);`,
    "", "Databricks informational key constraints are not enforced. RELY can enable rewrites that return wrong results when the data violates the promise.", [DOCS.constraints, DOCS.tune]);

  add(29, "boundary",
    "Expose region and location as related fields with clear synonyms; put the intended navigation sequence in Agent instructions.",
    `version: 1.1
source: analytics.core.sales
joins:
  - name: location
    source: analytics.core.locations
    on: source.location_id = location.location_id
    joins:
      - name: region
        source: analytics.core.regions
        on: location.region_id = region.region_id
fields:
  - { name: location, expr: location.location_name }
  - { name: region, expr: location.region.region_name }`,
    "Metric views expose related fields, but neither metric-view YAML nor Genie configuration defines a first-class ordered drill hierarchy.", "Descriptions can guide generation but do not validate that each child has one parent. Test hierarchy uniqueness and historical ownership upstream.", [DOCS.yaml, DOCS.tune]);

  add(30, "core",
    "Join the same dimension twice with distinct aliases, labels, and synonyms for billing and shipping roles.",
    `joins:
  - name: billing_customer
    source: analytics.core.customers
    on: source.billing_customer_id = billing_customer.customer_id
  - name: shipping_customer
    source: analytics.core.customers
    on: source.shipping_customer_id = shipping_customer.customer_id
fields:
  - { name: billing_customer_name, expr: billing_customer.name }
  - { name: shipping_customer_name, expr: shipping_customer.name }`,
    "", "Role aliases are independent join instances. Use explicit names in Agent sample questions so conversational language does not collapse the two roles.", [DOCS.yaml, DOCS.monitor]);

  add(31, "core",
    "Use one-to-many cardinality when a base entity joins a separately aggregated fact source, preserving measures on both grains.",
    `version: 1.1
source: analytics.core.orders
joins:
  - name: lines
    source: analytics.core.order_lines
    on: source.order_id = lines.order_id
    cardinality: one_to_many
fields:
  - { name: order_date, expr: source.order_date }
measures:
  - { name: orders, expr: COUNT(DISTINCT source.order_id) }
  - { name: revenue, expr: SUM(source.order_total) }
  - { name: units, expr: SUM(lines.quantity) }`,
    "Requires YAML 1.1 and Databricks Runtime 18.1 or a current SQL warehouse.", "A one-to-many join cannot contribute fields, and each aggregate must reference one source. Validate the declared cardinality against real data.", [DOCS.yaml, DOCS.availability]);

  add(32, "core",
    "Keep header measures on the base order source and line measures on a one-to-many joined fact source.",
    `source: analytics.core.orders
joins:
  - name: lines
    source: analytics.core.order_lines
    using: [order_id]
    cardinality: one_to_many
measures:
  - { name: order_revenue, expr: SUM(source.order_total) }
  - { name: line_units, expr: SUM(lines.quantity) }`,
    "", "Do not repair repeated header amounts with SUM(DISTINCT order_total); different orders can share the same total. Model the true header grain.", [DOCS.yaml]);

  add(33, "boundary",
    "Prepare a deduplicated or allocated bridge relation, or encapsulate the traversal in a reviewed SQL view/function before giving it to Genie.",
    `# analytics.marts.customer_segment_membership is prepared upstream.
version: 1.1
source: analytics.marts.customer_segment_membership
fields:
  - { name: segment, expr: segment_name }
measures:
  - { name: customers, expr: COUNT(DISTINCT customer_id) }
  - { name: allocated_customers, expr: SUM(allocation_weight) }`,
    "Metric-view joins declare many-to-one or one-to-many, not an unconstrained many-to-many bridge with automatic allocation semantics.", "A customer in two selected segments legitimately appears in both rows. Define the total rule explicitly and benchmark both row and grand-total questions.", [DOCS.yaml, DOCS.tune]);

  add(34, "core",
    "Store a reviewed attribution weight at the conversion-channel grain and sum the allocated value.",
    `source: marketing.marts.conversion_attribution
fields:
  - { name: channel, expr: channel_name }
  - { name: model_version, expr: model_version }
measures:
  - name: attributed_revenue
    expr: SUM(conversion_value * attribution_weight)
  - { name: attribution_weight_total, expr: SUM(attribution_weight) }`,
    "", "Validate that weights sum to the intended amount for each conversion and define unattributed value. Version models rather than overwriting history.", [DOCS.model]);

  add(35, "core",
    "Anchor conformed dimensions on a base entity and add each fact table as a one-to-many source so its measures aggregate independently.",
    `version: 1.1
source: analytics.core.teams
joins:
  - name: actuals
    source: analytics.marts.daily_actuals
    on: source.team_id = actuals.team_id
    cardinality: one_to_many
  - name: targets
    source: analytics.marts.monthly_targets
    on: source.team_id = targets.team_id
    cardinality: one_to_many
measures:
  - { name: actual_revenue, expr: SUM(actuals.revenue) }
  - { name: target_revenue, expr: SUM(targets.target_revenue) }
  - name: variance
    expr: SUM(actuals.revenue) - SUM(targets.target_revenue)`,
    "", "Only compare measures after aligning time, currency, and dimensional scope. One-to-many joined columns cannot be exposed as fields.", [DOCS.yaml]);

  add(36, "core",
    "Join each fact to the single history row whose effective interval contains the event timestamp.",
    `joins:
  - name: customer_history
    source: analytics.core.customer_history
    on: |
      source.customer_id = customer_history.customer_id
      AND source.ordered_at >= customer_history.valid_from
      AND source.ordered_at < COALESCE(customer_history.valid_to,
                                       TIMESTAMP '9999-12-31')
    cardinality: many_to_one
fields:
  - { name: customer_segment_at_order, expr: customer_history.segment }`,
    "", "Enforce non-overlapping validity ranges. A range predicate that matches two versions violates the many-to-one promise and duplicates facts.", [DOCS.yaml]);

  add(37, "boundary",
    "Build a cycle-safe ancestor/descendant closure table upstream, then expose its depth and employee relationship to Genie.",
    `# analytics.core.org_closure is maintained by a recursive pipeline.
version: 1.1
source: analytics.core.org_closure
fields:
  - { name: ancestor_id, expr: ancestor_id }
  - { name: descendant_id, expr: descendant_id }
  - { name: depth, expr: depth }
measures:
  - { name: descendants, expr: COUNT(DISTINCT descendant_id) }`,
    "Metric-view relationships and Agent join instructions do not recursively traverse an arbitrary-depth organization graph.", "The producer owns maximum depth, cycle detection, multiple-parent policy, and history. Add trusted examples for common manager questions.", [DOCS.tune, DOCS.yaml]);

  add(38, "core",
    "Join events to a versioned identity map at the event timestamp and count the resolved stable household key.",
    `joins:
  - name: identity
    source: identity.core.customer_household_history
    on: |
      source.customer_id = identity.customer_id
      AND source.occurred_at >= identity.valid_from
      AND source.occurred_at < COALESCE(identity.valid_to,
                                        TIMESTAMP '9999-12-31')
fields:
  - { name: identity_confidence, expr: identity.confidence }
measures:
  - { name: households, expr: COUNT(DISTINCT identity.household_id) }`,
    "", "Identity resolution can change and can be probabilistic. Expose confidence and model version, and decide whether historical reports restate.", [DOCS.yaml]);

  // 39–48 · Time and behavior
  add(39, "core",
    "Normalize timestamps to the declared business timezone before deriving business dates and periods.",
    `fields:
  - { name: occurred_at_utc, expr: occurred_at }
  - name: business_date
    expr: CAST(from_utc_timestamp(occurred_at, 'America/Los_Angeles') AS DATE)
  - name: business_month
    expr: DATE_TRUNC('MONTH', from_utc_timestamp(occurred_at,
                                                'America/Los_Angeles'))`,
    "", "Timestamp type, session timezone, and daylight-saving transitions interact. Do not convert a timestamp that is already local.", [DOCS.yaml]);

  add(40, "core",
    "Derive a simple month-offset fiscal period as fields and document the year-naming convention for Genie.",
    `fields:
  - name: fiscal_year
    expr: YEAR(add_months(order_date, -6))
  - name: fiscal_month
    expr: MONTH(add_months(order_date, -6))
  - name: fiscal_quarter
    expr: QUARTER(add_months(order_date, -6))`,
    "", "A month offset does not implement 4-4-5 weeks. State whether the fiscal year is named by its starting or ending calendar year.", [DOCS.yaml, DOCS.tune]);

  add(41, "boundary",
    "Join facts to a governed retail calendar that owns fiscal periods, comparable dates, and 53-week rules.",
    `joins:
  - name: retail_calendar
    source: analytics.shared.retail_calendar
    on: source.sold_date = retail_calendar.calendar_date
fields:
  - { name: retail_week, expr: retail_calendar.retail_week }
  - { name: retail_period, expr: retail_calendar.retail_period }
  - { name: comparable_date, expr: retail_calendar.prior_year_date }`,
    "Genie and metric views consume an NRF/4-4-5 calendar but do not generate or govern that calendar.", "Calendar ownership, 53-week mapping, holiday shifts, and restatement policy must be explicit upstream.", [DOCS.yaml]);

  add(42, "core",
    "Use a shifted window measure for the prior period and compose the comparison from current and shifted measures.",
    `fields:
  - { name: order_month, expr: DATE_TRUNC('MONTH', order_date) }
measures:
  - { name: monthly_revenue, expr: SUM(revenue) }
  - name: revenue_prior_year
    expr: SUM(revenue)
    window:
      - { order: order_month, range: current, offset: -12 month }
  - name: year_over_year_change
    expr: |
      (MEASURE(monthly_revenue) - MEASURE(revenue_prior_year)) /
      NULLIF(MEASURE(revenue_prior_year), 0)`,
    "Requires YAML 1.1 and Databricks Runtime 18.1 or a current SQL warehouse for window offset.", "Use a governed period index instead of month arithmetic for retail calendars and irregular business cycles.", [DOCS.advanced, DOCS.availability]);

  add(43, "core",
    "Define a trailing window on a complete business-date axis and state whether the anchor date is included.",
    `dimensions:
  - { name: activity_date, expr: CAST(activity_at AS DATE) }
measures:
  - name: rolling_28_day_active_users
    expr: COUNT(DISTINCT user_id)
    window:
      - { order: activity_date, range: trailing 27 day inclusive }`,
    "", "Missing dates can make business interpretation ambiguous. Densify the calendar when a 28-day series must return a row for every date.", [DOCS.advanced]);

  add(44, "core",
    "Use governed calendar flags for completed periods and a cumulative window for year-to-date values.",
    `joins:
  - name: calendar
    source: analytics.shared.business_calendar
    on: source.order_date = calendar.calendar_date
fields:
  - { name: fiscal_date, expr: calendar.calendar_date }
  - { name: fiscal_year, expr: calendar.fiscal_year }
  - { name: is_completed_period, expr: calendar.is_completed_period }
measures:
  - name: completed_ytd_revenue
    expr: SUM(revenue) FILTER (WHERE calendar.is_completed_period)
    window:
      - { order: fiscal_date, range: cumulative }
      - { order: fiscal_year, range: current }`,
    "", "The business clock and data-completeness cutoff belong in the calendar process, not in an ambiguous phrase such as ‘through today.’", [DOCS.advanced, DOCS.tune]);

  add(45, "core",
    "Use a date parameter in the source query to select the last eligible row for each account.",
    `version: 1.1
parameters:
  - { name: as_of_date, data_type: date, default: '2026-11-01' }
source: |
  SELECT * FROM finance.core.account_snapshots
  WHERE snapshot_date <= as_of_date
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_id ORDER BY snapshot_date DESC) = 1
fields:
  - { name: account_id, expr: account_id }
measures:
  - { name: balance, expr: SUM(balance) }`,
    "Metric-view parameters require Databricks Runtime 18.2 or a current SQL warehouse and prevent metric-view materialization.", "Use a typed parameterized trusted query so Genie binds an explicit date instead of inventing an as-of interpretation.", [DOCS.parameters, DOCS.tune]);

  add(46, "boundary",
    "Prepare one row per cohort and observation period, then expose retained users and cohort size as measures.",
    `version: 1.1
source: product.marts.cohort_retention
fields:
  - { name: cohort_month, expr: cohort_month }
  - { name: months_since_signup, expr: months_since_signup }
measures:
  - { name: retained_users, expr: SUM(retained_users) }
  - { name: cohort_size, expr: MAX(cohort_size) }
  - name: retention_rate
    expr: MEASURE(retained_users) / NULLIF(MEASURE(cohort_size), 0)`,
    "Cohort assignment and ordered activity-state construction are normally prepared upstream; the Agent consumes the resulting entity-period relation.", "Define identity, reactivation, observation windows, and incomplete cohorts before exposing the metric.", [DOCS.tune, DOCS.yaml]);

  add(47, "boundary",
    "Prepare first qualifying timestamps or a funnel entity table, then define stage counts without event-row fanout.",
    `version: 1.1
source: product.marts.user_funnel
fields:
  - { name: signup_date, expr: signup_date }
measures:
  - { name: signed_up, expr: COUNT(DISTINCT user_id) }
  - name: purchased
    expr: COUNT(DISTINCT user_id) FILTER (WHERE purchase_at IS NOT NULL)
  - name: purchase_rate
    expr: MEASURE(purchased) / NULLIF(MEASURE(signed_up), 0)`,
    "Metric views aggregate a prepared relation; they do not by themselves enforce arbitrary event ordering and maximum time-between-stage rules.", "Use a reviewed SQL view or Unity Catalog table function for complex paths, and attach it as a trusted asset.", [DOCS.tune]);

  add(48, "boundary",
    "Calculate calendar-aware business duration upstream, then aggregate the stable duration and SLA flag in the metric view.",
    `version: 1.1
source: support.marts.ticket_sla_facts
fields:
  - { name: priority, expr: priority }
measures:
  - { name: average_business_minutes, expr: AVG(business_minutes) }
  - { name: tickets, expr: COUNT(DISTINCT ticket_id) }
  - name: breached_tickets
    expr: COUNT(DISTINCT ticket_id) FILTER (WHERE breached_sla)`,
    "Genie can calculate elapsed timestamps, but holidays, working hours, pauses, and missing endpoints require a governed calendar process or function.", "Do not let generated SQL substitute wall-clock duration for the certified business-time definition.", [DOCS.tune]);

  // 49–55 · Business transformations
  add(49, "core",
    "Join each fact to one governed FX rate for its currency, business date, and approved rate type before summing converted value.",
    `joins:
  - name: fx
    source: finance.reference.fx_daily
    on: |
      source.currency = fx.from_currency
      AND source.order_date = fx.rate_date
      AND fx.to_currency = 'USD'
      AND fx.rate_type = 'CLOSE'
fields:
  - { name: source_currency, expr: source.currency }
measures:
  - { name: revenue_usd, expr: SUM(source.revenue_local * fx.rate) }`,
    "", "The join must return at most one rate per fact. Define missing rates, triangulation, spot versus average rates, and restatement policy.", [DOCS.yaml]);

  add(50, "core",
    "Join to a context-aware conversion factor and aggregate only after normalizing the row-level quantity.",
    `joins:
  - name: conversion
    source: analytics.reference.unit_conversion
    on: |
      source.unit = conversion.from_unit
      AND source.product_type = conversion.product_type
      AND conversion.to_unit = 'kg'
measures:
  - { name: quantity_kg, expr: SUM(source.quantity * conversion.factor) }`,
    "", "Some conversions depend on density, temperature, package, or item context. A universal factor table can be silently wrong.", [DOCS.yaml]);

  add(51, "core",
    "Store scenario and forecast version at a conformed grain, then publish filtered measures and their variance.",
    `fields:
  - { name: month, expr: month }
  - { name: forecast_version, expr: forecast_version }
measures:
  - name: actual
    expr: SUM(amount) FILTER (WHERE scenario = 'ACTUAL')
  - name: budget
    expr: SUM(amount) FILTER (WHERE scenario = 'BUDGET')
  - name: actual_vs_budget
    expr: MEASURE(actual) - MEASURE(budget)`,
    "", "Facts must share a compatible grain and currency. Keep forecast versions immutable so new submissions do not rewrite earlier reporting.", [DOCS.yaml]);

  add(52, "core",
    "Use a typed metric-view parameter for the simulation and expose a parameterized trusted query to Genie.",
    `# Metric-view YAML
parameters:
  - { name: price_change, data_type: double, default: 0.0 }
measures:
  - name: simulated_revenue
    expr: SUM(quantity * unit_price * (1 + price_change))

# Genie trusted example (price_change is a typed Agent parameter)
SELECT MEASURE(simulated_revenue)
FROM analytics.metrics.sales(price_change => :price_change)`,
    "Requires Databricks Runtime 18.2 or a current SQL warehouse. Parameterized metric views cannot be materialized.", "Clearly label simulated output and bound acceptable values. Parameters are query inputs, not stored plans or forecasts.", [DOCS.parameters, DOCS.tune]);

  add(53, "core",
    "Publish governed named measures and let the user's wording select among them; keep each result's name and format visible.",
    `measures:
  - { name: revenue, expr: SUM(revenue), synonyms: [sales] }
  - { name: orders, expr: COUNT(DISTINCT order_id) }
  - { name: customers, expr: COUNT(DISTINCT customer_id) }

# Benchmark: "Show monthly customers, not orders."
SELECT order_month, MEASURE(customers)
FROM analytics.metrics.orders GROUP BY ALL`,
    "", "A generic selectable-value column can mix units and valid grains. Keep named measures available and benchmark ambiguous terms such as volume.", [DOCS.tune, DOCS.monitor]);

  add(54, "core",
    "Define deterministic segments as fields over stable entity features, with first-match ordering and explicit synonyms.",
    `fields:
  - name: customer_segment
    expr: |
      CASE
        WHEN lifetime_value >= 10000 THEN 'VIP'
        WHEN orders_90d >= 5 THEN 'Frequent'
        WHEN last_order_date < current_date() - INTERVAL 180 DAYS THEN 'Lapsed'
        ELSE 'Standard'
      END
    synonyms: [customer tier, audience]`,
    "", "CASE uses first-match order. Version thresholds and calculate lifetime features at the entity grain, not on a transaction join that can fan out.", [DOCS.yaml, DOCS.tune]);

  add(55, "core",
    "Expose governed geographic identifiers and coordinates as fields, then use Agent examples to establish the intended geography and visualization.",
    `fields:
  - { name: country_code, expr: country_code }
  - { name: region, expr: region_name }
  - { name: postal_code, expr: postal_code }
  - { name: latitude, expr: latitude }
  - { name: longitude, expr: longitude }
measures:
  - { name: customers, expr: COUNT(DISTINCT customer_id) }`,
    "", "Metric views do not define a first-class geographic drill hierarchy. Geocoding quality, privacy, reused postal codes, and changing boundaries remain governance concerns.", [DOCS.yaml, DOCS.tune]);

  // 56–60 · Governance
  add(56, "core",
    "Enforce regional access on the underlying Unity Catalog table with ABAC or a row filter; Genie queries with the requesting user's permissions.",
    `CREATE FUNCTION security.allowed_region(region STRING)
RETURNS BOOLEAN
RETURN is_account_group_member(CONCAT('region-', lower(region)));

ALTER TABLE analytics.core.orders
  SET ROW FILTER security.allowed_region ON (region);`,
    "The security control belongs to Unity Catalog, not to Agent instructions or generated WHERE clauses.", "Test every role and service principal. Tables protected by row filters, column masks, or ABAC cannot back metric-view materializations, and Genie excludes row-filtered tables from prompt matching.", [DOCS.security, DOCS.materialization, DOCS.tune]);

  add(57, "boundary",
    "Secure sensitive values with Unity Catalog masks, privileges, ABAC, or a curated dynamic view; hide them from Agent context as a usability measure only.",
    `CREATE FUNCTION security.mask_email(email STRING)
RETURNS STRING
RETURN CASE WHEN is_account_group_member('pii-readers')
            THEN email ELSE '***' END;

ALTER TABLE analytics.core.customers
  ALTER COLUMN email SET MASK security.mask_email;`,
    "Genie column hiding is not authorization, and metric-view YAML has no per-field grant construct. Enforce the boundary on governed source assets.", "A user with another permitted path to the table can still query an Agent-hidden field. Audit direct SQL, dashboards, functions, and service principals.", [DOCS.security, DOCS.tune]);

  add(58, "core",
    "Use the metric-view top-level filter for a mandatory domain predicate; use query WHERE clauses or typed trusted-query parameters for editable filters.",
    `version: 1.1
source: analytics.core.orders
filter: is_test = false AND deleted_at IS NULL
fields:
  - { name: order_date, expr: order_date }
  - { name: region, expr: region }
measures:
  - { name: revenue, expr: SUM(revenue) }

# Editable user constraint remains in the generated query:
# WHERE region = :region`,
    "", "A metric-view filter is always applied but is not a substitute for user-dependent security. Put identity-aware rules in Unity Catalog policies.", [DOCS.yaml, DOCS.tune]);

  add(59, "boundary",
    "Put definitions, formats, and synonyms on metric-view fields and measures; add trusted examples for the expected detail query.",
    `measures:
  - name: net_revenue
    expr: SUM(net_revenue)
    comment: "Gross sales less returns; excludes tax and shipping."
    synonyms: [net sales]
    format: { type: currency, currency_code: USD }

# Trusted example: "Which orders make up net revenue last week?"
SELECT order_id, order_date, net_revenue
FROM analytics.core.orders
WHERE order_date >= current_date() - INTERVAL 7 DAYS`,
    "Metric views and Genie metadata do not define a first-class governed drill-path object comparable to an ordered BI drill set.", "Descriptions are contractual metadata. Keep ownership and exclusions current, and do not expose sensitive detail through a trusted query.", [DOCS.metadata, DOCS.tune]);

  add(60, "core",
    "Compose measures with MEASURE references and use a metric view as the source of another metric view for cross-domain reuse.",
    `# Base metric view
measures:
  - { name: revenue, expr: SUM(revenue) }
  - { name: orders, expr: COUNT(DISTINCT order_id) }
  - name: average_order_value
    expr: MEASURE(revenue) / NULLIF(MEASURE(orders), 0)

# Composed metric view
version: 1.1
source: analytics.metrics.orders
fields:
  - { expr: source.* }
measures:
  - { expr: source.* }`,
    "Measure references and derived names require a current SQL warehouse or the documented runtime level; verify feature availability for cluster compute.", "Keep composition shallow enough to trace. Changes to the base definition affect every Agent that consumes the composed view.", [DOCS.advanced, DOCS.availability]);

  // 61–68 · Performance and evolution
  add(61, "core",
    "Encapsulate expensive derived SQL in the metric-view source and optionally materialize the unaggregated result for reuse.",
    `version: 1.1
source: |
  SELECT customer_id,
         MAX_BY(status, status_at) AS current_status,
         SUM(order_value) AS lifetime_value
  FROM analytics.core.customer_events
  GROUP BY customer_id
fields:
  - { name: customer_id, expr: customer_id }
  - { name: current_status, expr: current_status }
measures:
  - { name: lifetime_value, expr: SUM(lifetime_value) }
materialization:
  mode: relaxed
  materialized_views:
    - { name: prepared_customers, type: unaggregated }`,
    "", "The derived source must preserve a declared reusable grain. An unaggregated materialization speeds preparation but still requires serverless Lakeflow support and refresh planning.", [DOCS.yaml, DOCS.materialization]);

  add(62, "core",
    "Schedule metric-view materializations explicitly and treat source freshness, pipeline freshness, and SQL result caching as separate layers.",
    `materialization:
  schedule: every 6 hours
  mode: relaxed
  materialized_views:
    - name: monthly_region_metrics
      type: aggregated
      dimensions: [order_month, region]
      measures: [revenue, orders]`,
    "", "A six-hour refresh is a service-level choice, not a semantic truth. Materialization is unavailable when the metric view or its sources use RLS, masks, ABAC, parameters, or invoker-dependent expressions.", [DOCS.materialization]);

  add(63, "core",
    "Declare aggregated materializations for common dimensions and measures; the optimizer performs aggregate-aware exact or rollup matching.",
    `materialization:
  mode: relaxed
  schedule: every 2 hours
  materialized_views:
    - name: region_day
      type: aggregated
      dimensions: [region, order_date]
      measures: [revenue, orders]
    - name: product_month
      type: aggregated
      dimensions: [product, order_month]
      measures: [revenue, units]`,
    "", "Distinct, percentile, multi-aggregate, and window measures are not generally rollup-eligible and may require an exact materialization match. Verify with EXPLAIN or the query profile.", [DOCS.materialization]);

  add(64, "core",
    "Publish approximate distinct as a separately named measure with an explicit accuracy contract.",
    `measures:
  - { name: exact_customers, expr: COUNT(DISTINCT customer_id) }
  - name: approximate_customers
    expr: approx_count_distinct(customer_id, 0.02)
    comment: "Approximate unique customers; target relative SD 2%."
    synonyms: [estimated customers]`,
    "", "Do not silently substitute approximation for billing, compliance, or entitlement counts. Approximate distinct remains non-additive for materialization rollups.", [DOCS.yaml, DOCS.materialization]);

  add(65, "core",
    "Request incremental-strict refresh on a materialization so creation fails when the defined query cannot be maintained incrementally.",
    `materialization:
  schedule: every 1 hour
  mode: relaxed
  materialized_views:
    - name: prepared_orders
      type: unaggregated
      refresh_policy: incremental strict
    - name: daily_revenue
      type: aggregated
      dimensions: [order_date]
      measures: [revenue]
      refresh_policy: incremental strict`,
    "Requires YAML 1.1 and Databricks Runtime 18 LTS or a current SQL warehouse.", "Incremental strict rejects non-incrementalizable definitions; it does not replace late-arrival, deletion, or correction policy in the source pipeline.", [DOCS.yaml, DOCS.materialization, DOCS.availability]);

  add(66, "core",
    "Create Genie benchmark questions with reviewed SQL answers, include alternate phrasings, and rerun them after every semantic or instruction change.",
    `Benchmark question: What was net revenue by region last month?
SQL answer:
  SELECT region, MEASURE(net_revenue)
  FROM analytics.metrics.orders
  WHERE order_month = add_months(DATE_TRUNC('MONTH', current_date()), -1)
  GROUP BY ALL

Alternate phrasing: Break down last month's net sales by region.
Expected answer: reuse the same reviewed SQL result set.`,
    "", "Benchmarks evaluate Agent accuracy; they do not validate source freshness, key uniqueness, or all metric-view invariants. Keep pipeline data-quality tests as a separate control.", [DOCS.monitor]);

  add(67, "boundary",
    "Publish the changed definition under a new governed name, reconcile both versions, and switch Agent sources and trusted examples deliberately.",
    `-- Keep both definitions queryable during migration.
CREATE VIEW analytics.metrics.net_revenue_v1 AS
SELECT order_id, gross_amount - return_amount AS net_revenue
FROM analytics.core.order_finance;

CREATE VIEW analytics.metrics.net_revenue_v2 AS
SELECT order_id,
       gross_amount - return_amount - discount_amount AS net_revenue
FROM analytics.core.order_finance;

-- Agent migration checklist:
-- 1. Reconcile v1 and v2 over an approved historical window.
-- 2. Update source, trusted examples, and benchmarks to v2.
-- 3. Deprecate v1 only after owners approve downstream impact.`,
    "Genie and metric views do not provide first-class effective-dated metric versions or automatically migrate dependent Agent instructions and conversations.", "Renaming a field is not versioning. Track owner, rationale, effective date, lineage, downstream dependencies, and reconciliation evidence.", [DOCS.monitor, DOCS.concepts]);

  add(68, "core",
    "Join predictions to observed outcomes at the evaluation grain and keep model version, prediction cutoff, horizon, and unit visible.",
    `version: 1.1
source: ml.marts.forecast_evaluation
fields:
  - { name: model_version, expr: model_version }
  - { name: forecast_horizon, expr: forecast_horizon }
  - { name: evaluation_date, expr: evaluation_date }
measures:
  - { name: predicted_units, expr: SUM(predicted_units) }
  - { name: observed_units, expr: SUM(observed_units) }
  - name: forecast_error
    expr: MEASURE(observed_units) - MEASURE(predicted_units)
  - { name: mean_absolute_error, expr: AVG(ABS(observed_units - predicted_units)) }`,
    "", "Evaluate the prediction version that existed at the cutoff, not a backfilled model. Predictions and actuals must share item, horizon, unit, and grain.", [DOCS.yaml, DOCS.monitor]);

  if (cases.length !== 68) throw new Error(`Expected 68 Databricks Genie situations, found ${cases.length}`);
  window.DATABRICKS_GENIE_USE_CASES = cases;
})();
