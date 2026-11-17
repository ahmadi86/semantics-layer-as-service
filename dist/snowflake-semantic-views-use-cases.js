(() => {
  const sourceCases = new Map((window.LOOKML_USE_CASES || []).map(item => [item.id, item]));
  const cases = [];
  const DOCS = {
    overview: { label: "Semantic Views overview", url: "https://docs.snowflake.com/en/user-guide/views-semantic/overview" },
    yaml: { label: "YAML specification", url: "https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec" },
    ddl: { label: "CREATE SEMANTIC VIEW", url: "https://docs.snowflake.com/en/sql-reference/sql/create-semantic-view" },
    query: { label: "Querying semantic views", url: "https://docs.snowflake.com/en/user-guide/views-semantic/querying" },
    inline: { label: "SQL-query logical tables", url: "https://docs.snowflake.com/en/user-guide/views-semantic/inline-view" },
    validation: { label: "Validation rules", url: "https://docs.snowflake.com/en/user-guide/views-semantic/validation-rules" },
    filters: { label: "Semantic filters", url: "https://docs.snowflake.com/en/user-guide/views-semantic/filters" },
    variables: { label: "Variables", url: "https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec#variables" },
    materializations: { label: "Materializations", url: "https://docs.snowflake.com/en/user-guide/views-semantic/materializations" },
    security: { label: "Development and security practices", url: "https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-dev" },
    authoring: { label: "YAML vs DDL", url: "https://docs.snowflake.com/en/user-guide/views-semantic/yaml-vs-ddl" }
  };
  const labels = {
    core: "Native Semantic View",
    boundary: "Snowflake / source boundary",
    unsupported: "Not supported"
  };

  function add(number, support, rule, code, supportNote, caveat, docs = []) {
    const id = `case-${String(number).padStart(2, "0")}`;
    const source = sourceCases.get(id);
    if (!source) throw new Error(`Missing LookML source situation ${id}`);
    cases.push({
      ...source,
      rule,
      code: code ? code.trim() : "",
      caveat,
      mode: labels[support],
      support,
      supportNote: supportNote || (support === "core"
        ? "Expressible in a Snowflake Semantic View and queryable with Semantic SQL."
        : ""),
      docs
    });
  }

  // 01–12 · Sources and table shapes
  add(1, "core",
    "Declare the transaction entity and its key, keep row-level amounts as facts, and aggregate those facts into named metrics.",
    `name: orders_sv
tables:
  - name: orders
    base_table: { database: ANALYTICS, schema: CORE, table: ORDERS }
    primary_key: { columns: [order_id] }
    dimensions:
      - { name: order_id, expr: order_id, data_type: NUMBER }
    time_dimensions:
      - { name: ordered_at, expr: ordered_at, data_type: TIMESTAMP_TZ }
    facts:
      - { name: revenue, expr: revenue, data_type: NUMBER }
      - { name: quantity, expr: quantity, data_type: NUMBER }
    metrics:
      - { name: gross_revenue, expr: "SUM(revenue)" }
      - { name: units, expr: "SUM(quantity)" }`,
    "", "The declared primary key must be non-null and unique at the physical row grain. A semantic declaration does not repair duplicate order rows.", [DOCS.yaml, DOCS.validation]);

  add(2, "core",
    "Define one named metric for each wide-table KPI and state which dimensions preserve additivity.",
    `tables:
  - name: daily_location_kpis
    base_table: { database: ANALYTICS, schema: MARTS, table: DAILY_LOCATION_KPIS }
    primary_key: { columns: [location_id, day] }
    dimensions:
      - { name: location_id, expr: location_id, data_type: NUMBER }
    time_dimensions:
      - { name: day, expr: day, data_type: DATE }
    metrics:
      - { name: gross_revenue, expr: "SUM(gross_revenue)" }
      - { name: orders, expr: "SUM(order_count)" }
      - { name: units, expr: "SUM(units)" }`,
    "", "Separate columns do not make every KPI additive. Ratios and stored distinct counts need different definitions from sums.", [DOCS.yaml]);

  add(3, "core",
    "Use a discriminator inside each metric so values with different units never flow through one generic aggregate.",
    `tables:
  - name: long_kpis
    base_table: { database: ANALYTICS, schema: MARTS, table: LONG_KPIS }
    dimensions:
      - { name: metric_code, expr: metric_code, data_type: TEXT }
    time_dimensions:
      - { name: day, expr: day, data_type: DATE }
    metrics:
      - name: gross_revenue
        expr: "SUM(IFF(metric_code = 'GROSS_REVENUE', metric_value, 0))"
      - name: units
        expr: "SUM(IFF(metric_code = 'UNITS', metric_value, 0))"`,
    "", "A generic SUM(metric_value) mixes currencies, counts, rates, and units. Enforce one compatible contribution per metric and declared grain.", [DOCS.yaml, DOCS.validation]);

  add(4, "core",
    "Model additive, ratio, and distinct behaviors independently; derived metrics can reuse other metrics at compatible grains.",
    `tables:
  - name: metric_events
    base_table: { database: ANALYTICS, schema: MARTS, table: METRIC_EVENTS }
    metrics:
      - name: revenue
        expr: "SUM(IFF(metric_code = 'REVENUE', metric_value, 0))"
      - name: orders
        expr: "SUM(IFF(metric_code = 'ORDERS', metric_value, 0))"
      - name: unique_customers
        expr: "COUNT(DISTINCT customer_id)"
metrics:
  - name: average_order_value
    expr: "metric_events.revenue / NULLIF(metric_events.orders, 0)"`,
    "", "A metric registry still needs units, owners, valid dimensions, and source-grain documentation. The engine cannot infer those contracts from metric_code.", [DOCS.yaml, DOCS.validation]);

  add(5, "core",
    "Aggregate numerator and denominator rows separately, then divide the resulting metrics.",
    `tables:
  - name: campaign_rows
    base_table: { database: MARKETING, schema: MARTS, table: CAMPAIGN_METRIC_ROWS }
    metrics:
      - name: clicks
        expr: "SUM(IFF(metric_code = 'CLICKS', metric_value, 0))"
      - name: impressions
        expr: "SUM(IFF(metric_code = 'IMPRESSIONS', metric_value, 0))"
metrics:
  - name: click_through_rate
    expr: "campaign_rows.clicks / NULLIF(campaign_rows.impressions, 0)"`,
    "", "Do not average stored daily CTR values unless equal-day weighting is the intended definition. Decide whether a zero denominator returns NULL or zero.", [DOCS.yaml]);

  add(6, "boundary",
    "Create a governed Snowflake table, external table, or view over the S3 files first; point the semantic logical table at that relation.",
    `# File format, stage, parsing, and partitions are defined outside the semantic view.
tables:
  - name: sales_csv
    base_table: { database: LAKE, schema: EXTERNAL, table: SALES_CSV }
    time_dimensions:
      - { name: sold_at, expr: sold_at, data_type: TIMESTAMP_TZ }
    metrics:
      - { name: revenue, expr: "SUM(revenue)" }`,
    "Semantic Views do not parse S3 objects or manage external-table refresh metadata.", "Validate file-format options, credentials, partition discovery, malformed rows, and schema drift in the Snowflake ingestion or external-table layer.", [DOCS.yaml]);

  add(7, "boundary",
    "Land or expose the ADLS files through a Snowflake-supported ingestion/external-access path, then model the stable Snowflake relation.",
    `# ANALYTICS.STAGING.FINANCE_EXTRACT is populated from ADLS upstream.
tables:
  - name: finance_extract
    base_table: { database: ANALYTICS, schema: STAGING, table: FINANCE_EXTRACT }
    primary_key: { columns: [row_id] }
    metrics:
      - { name: net_revenue, expr: "SUM(net_revenue)" }`,
    "The semantic view begins at a Snowflake relation; it does not authenticate to ADLS or implement file readers.", "Keep storage credentials, COPY/Snowpipe behavior, parser settings, and type normalization outside the semantic definition.", [DOCS.overview, DOCS.yaml]);

  add(8, "boundary",
    "Register an Iceberg or other supported external relation in Snowflake, or materialize the lakehouse data into Snowflake, before adding semantics.",
    `tables:
  - name: lakehouse_events
    base_table: { database: LAKEHOUSE, schema: ANALYTICS, table: EVENTS_ICEBERG }
    primary_key: { columns: [event_id] }
    time_dimensions:
      - { name: occurred_at, expr: occurred_at, data_type: TIMESTAMP_TZ }
    metrics:
      - { name: events, expr: "COUNT(event_id)" }`,
    "A Semantic View cannot query an arbitrary Databricks, Trino, or Athena catalog directly.", "Snapshot selection, catalog integration, file pruning, permissions, and format-specific maintenance belong to the registered Snowflake table or upstream engine.", [DOCS.overview]);

  add(9, "core",
    "Use a SQL-query logical table to flatten repeated arrays to a declared row grain, retaining a collision-safe event-item key.",
    `tables:
  - name: event_items
    base_table:
      definition: |
        SELECT e.event_id, e.occurred_at,
               i.index AS item_offset,
               i.value:sku::STRING AS sku,
               i.value:quantity::NUMBER AS quantity
        FROM RAW.EVENTS e, LATERAL FLATTEN(input => e.payload:items) i
    primary_key: { columns: [event_id, item_offset] }
    metrics:
      - { name: units, expr: "SUM(quantity)" }`,
    "", "The SQL query is part of the logical-table contract. Preserve array position or another stable item key; SKU alone might repeat within one event.", [DOCS.inline, DOCS.yaml]);

  add(10, "core",
    "Union compatible sources with UNION ALL in a SQL-query logical table, retain provenance, and key identifiers by source when necessary.",
    `tables:
  - name: unified_sales
    base_table:
      definition: |
        SELECT 'US' AS source_region, * FROM RAW.SALES_US
        UNION ALL
        SELECT 'EU' AS source_region, * FROM RAW.SALES_EU
    primary_key: { columns: [source_region, sale_id] }
    dimensions:
      - { name: source_region, expr: source_region, data_type: TEXT }
    metrics:
      - { name: revenue, expr: "SUM(revenue)" }`,
    "", "UNION removes duplicates and can hide upstream defects; UNION ALL preserves them. Confirm that partitions do not overlap.", [DOCS.inline]);

  add(11, "boundary",
    "Ingest API and spreadsheet data to governed Snowflake tables with load metadata, then relate and model those tables normally.",
    `tables:
  - name: monthly_targets
    base_table: { database: ANALYTICS, schema: STAGING, table: MONTHLY_TARGETS }
    primary_key: { columns: [team_id, month] }
    time_dimensions:
      - { name: month, expr: month, data_type: DATE }
      - { name: loaded_at, expr: loaded_at, data_type: TIMESTAMP_TZ }
    metrics:
      - { name: target_revenue, expr: "SUM(target_revenue)" }`,
    "Semantic Views do not call source APIs, authenticate to spreadsheets, or schedule ingestion.", "Retain source version, extraction timestamp, rejected-row counts, and ownership so Cortex users can assess freshness and trust.", [DOCS.overview]);

  add(12, "boundary",
    "Bring both data sets behind queryable Snowflake relations—through replication, sharing, ingestion, or federation outside the semantic view—before defining relationships.",
    `tables:
  - name: orders
    base_table: { database: SALES, schema: CORE, table: ORDERS }
    primary_key: { columns: [order_id] }
  - name: support_tickets
    base_table: { database: SUPPORT_REPLICA, schema: CORE, table: TICKETS }
    primary_key: { columns: [ticket_id] }
relationships:
  - name: tickets_to_orders_customer
    left_table: support_tickets
    right_table: orders
    relationship_columns:
      - { left_column: customer_id, right_column: customer_id }`,
    "A Semantic View does not execute a live join between Snowflake and an unrelated BigQuery connection.", "Cost, latency, identity mapping, and security follow the replication or federation layer. Make customer_id uniqueness and data currency explicit.", [DOCS.yaml]);

  // 13–27 · Aggregation
  add(13, "core",
    "Sum the lowest-grain disjoint contribution and never mix subtotal rows with their children.",
    `facts:
  - { name: revenue_value, expr: revenue, data_type: NUMBER }
metrics:
  - name: revenue
    expr: "SUM(revenue_value)"
    description: "Additive order-line revenue; excludes subtotal rows."`,
    "", "Additivity depends on grain. A source containing detail and subtotal rows will double count unless the levels are separated or filtered.", [DOCS.yaml]);

  add(14, "core",
    "Publish row count and entity distinct count as separate metrics with unambiguous names.",
    `metrics:
  - { name: order_rows, expr: "COUNT(*)" }
  - { name: unique_customers, expr: "COUNT(DISTINCT customer_id)" }`,
    "", "COUNT(DISTINCT customer_id) ignores NULL. Confirm whether anonymous activity should be excluded, bucketed, or assigned another identity.", [DOCS.validation]);

  add(15, "core",
    "Count customer identities at the selected grouping scope and model location as a keyed related entity.",
    `relationships:
  - name: visits_to_locations
    left_table: visits
    right_table: locations
    relationship_columns:
      - { left_column: location_id, right_column: location_id }
tables:
  - name: visits
    metrics:
      - { name: customers, expr: "COUNT(DISTINCT customer_id)" }`,
    "", "If the source retains only L1=2 and L2=2, no semantic expression can recover the regional answer of 3. Retain identities, a mergeable sketch, or a regional result.", [DOCS.yaml, DOCS.query]);

  add(16, "core",
    "Compute distinct customer identity over the time interval selected by the query instead of summing stored period counts.",
    `time_dimensions:
  - { name: ordered_date, expr: "ordered_at::DATE", data_type: DATE }
  - { name: ordered_month, expr: "DATE_TRUNC('MONTH', ordered_at)", data_type: DATE }
metrics:
  - { name: active_customers, expr: "COUNT(DISTINCT customer_id)" }`,
    "", "Query cost can grow with high-cardinality identities. An approximate metric is a separate business contract and should not silently replace an exact count.", [DOCS.yaml]);

  add(17, "boundary",
    "Do not expose one stored distinct count as universally additive. Retain identities or provide separate source rows for every approved rollup grain.",
    `# The source publishes an explicit row for each approved aggregation level.
dimensions:
  - { name: aggregation_level, expr: aggregation_level, data_type: TEXT }
metrics:
  - name: customers_at_published_scope
    expr: "SUM(IFF(aggregation_level = 'LOCATION_DAY', unique_customers, NULL))"
    description: "Valid only when location and day are both selected."`,
    "Semantic Views have no required-dimensions constraint that prevents a consumer from regrouping a stored distinct count incorrectly.", "A description or Cortex instruction is not an enforcement mechanism. Prefer customer identities or independently materialized rollups with separate metrics.", [DOCS.validation]);

  add(18, "core",
    "Define additive component metrics first, then divide them in a derived metric so regrouping recalculates the ratio.",
    `tables:
  - name: orders
    metrics:
      - { name: revenue, expr: "SUM(revenue)" }
      - { name: order_count, expr: "COUNT(order_id)" }
metrics:
  - name: average_order_value
    expr: "orders.revenue / NULLIF(orders.order_count, 0)"`,
    "", "An equal-weighted average of store-level AOVs answers a different question. Make zero-denominator behavior explicit.", [DOCS.validation]);

  add(19, "core",
    "Aggregate extended value and weight separately, then divide the aggregates.",
    `tables:
  - name: sales_lines
    metrics:
      - { name: extended_value, expr: "SUM(unit_price * units)" }
      - { name: total_units, expr: "SUM(units)" }
metrics:
  - name: weighted_price
    expr: "sales_lines.extended_value / NULLIF(sales_lines.total_units, 0)"`,
    "", "Weights must be non-negative and aligned to the row grain. Do not weight values that are already aggregated without understanding their base.", [DOCS.yaml]);

  add(20, "core",
    "Calculate the percentile from lowest-grain observations with a Snowflake aggregate, not from precomputed subgroup percentiles.",
    `metrics:
  - name: p95_response_ms
    expr: "APPROX_PERCENTILE(response_ms, 0.95)"
    description: "Approximate 95th percentile across eligible request rows."`,
    "", "Approximate and exact percentile functions have different cost and error contracts. Percentiles cannot be rolled up from subgroup percentiles without mergeable state.", [DOCS.validation]);

  add(21, "core",
    "Use MIN and MAX over the underlying observations; extrema remain valid across disjoint partitions that fully cover the selection.",
    `metrics:
  - { name: fastest_response_ms, expr: "MIN(response_ms)" }
  - { name: slowest_response_ms, expr: "MAX(response_ms)" }`,
    "", "Null handling follows Snowflake aggregate semantics. A maximum of shard maxima is valid only when the shards cover the requested set.", [DOCS.yaml]);

  add(22, "core",
    "Declare snapshot balance as semi-additive so query processing takes the last eligible snapshot across time before summing accounts.",
    `time_dimensions:
  - { name: snapshot_date, expr: snapshot_date, data_type: DATE }
metrics:
  - name: account_balance
    expr: "SUM(balance)"
    non_additive_dimensions:
      - table: account_snapshots
        dimension: snapshot_date
        sort_direction: ascending
        null_order: first`,
    "", "The latest row is selected by the declared ordering. Confirm snapshot completeness, timezone, and whether missing accounts mean zero or missing data.", [DOCS.yaml, DOCS.ddl]);

  add(23, "core",
    "List every dimension across which the metric must take a last snapshot instead of being summed.",
    `time_dimensions:
  - { name: snapshot_date, expr: snapshot_date, data_type: DATE }
  - { name: snapshot_time, expr: snapshot_time, data_type: TIMESTAMP_TZ }
metrics:
  - name: ending_inventory
    expr: "SUM(on_hand_quantity)"
    non_additive_dimensions:
      - { table: inventory, dimension: snapshot_date, sort_direction: ascending }
      - { table: inventory, dimension: snapshot_time, sort_direction: ascending }`,
    "", "NON ADDITIVE BY has last-value semantics, not a general valid-dimensions policy. The ordering and dimension order determine which snapshot survives.", [DOCS.ddl, DOCS.yaml]);

  add(24, "core",
    "Define a window-function metric over the additive metric and make its ordering dimension required in semantic queries.",
    `metrics:
  - name: running_revenue
    expr: >-
      SUM(orders.revenue) OVER (
        PARTITION BY EXCLUDING orders.order_date
        ORDER BY orders.order_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )`,
    "", "Queries must return every dimension named in PARTITION BY or ORDER BY. Window metrics cannot feed another metric and cannot be materialized.", [DOCS.query, DOCS.validation]);

  add(25, "core",
    "Use a level-of-detail denominator that excludes the displayed category, then divide the current-grain revenue by that denominator.",
    `metrics:
  - name: category_share_of_region
    expr: >-
      SUM(orders.order_amount) /
      AVG(SUM(orders.order_amount)
          EXCLUDE DIMENSIONS (orders.category))`,
    "Available in Semantic SQL through the current LOD preview; Cortex Analyst and Cortex Agents do not yet consume LOD metrics.", "EXCLUDE respects filters before calculating the denominator. Use FIXED when the denominator must ignore those filters, and test totals deliberately.", [DOCS.query, DOCS.authoring]);

  add(26, "core",
    "Keep the nullable observation visible and publish a separate display-safe metric or coverage metric instead of erasing missingness.",
    `facts:
  - { name: reported_revenue, expr: revenue, data_type: NUMBER }
dimensions:
  - { name: was_reported, expr: "revenue IS NOT NULL", data_type: BOOLEAN, labels: [filter] }
metrics:
  - { name: revenue_reported, expr: "SUM(revenue)" }
  - { name: revenue_display_zero, expr: "COALESCE(SUM(revenue), 0)" }
  - { name: reporting_rows, expr: "COUNT_IF(revenue IS NOT NULL)" }`,
    "", "COALESCE can conceal a failed feed. Keep coverage and expected-versus-received checks beside any zero-filled presentation metric.", [DOCS.filters, DOCS.yaml]);

  add(27, "core",
    "Normalize return signs once and define gross, returns, and net as separately auditable metrics.",
    `metrics:
  - { name: gross_sales, expr: "SUM(IFF(event_type = 'SALE', amount, 0))" }
  - { name: returns, expr: "SUM(IFF(event_type = 'RETURN', ABS(amount), 0))" }
  - name: net_sales
    expr: "sales.gross_sales - sales.returns"`,
    "", "Do not apply ABS when the warehouse already stores returns as negative and net is defined by addition. Document tax, discount, and cancellation treatment.", [DOCS.validation]);

  // 28–38 · Relationships and grain
  add(28, "core",
    "Declare the true primary or unique key for every entity that relationships reference; use composite columns rather than concatenated pseudo-keys.",
    `tables:
  - name: order_lines
    base_table: { database: ANALYTICS, schema: CORE, table: ORDER_LINES }
    primary_key: { columns: [order_id, line_number] }
    unique_keys:
      - { columns: [source_system, source_line_id] }`,
    "", "Snowflake validates the semantic definition, not the truth of existing source rows. Test uniqueness and non-nullness in the data pipeline.", [DOCS.yaml, DOCS.validation]);

  add(29, "core",
    "Model location and region as separate keyed entities connected by a relationship, then expose the dimensions at their natural grains.",
    `tables:
  - name: locations
    base_table: { database: ANALYTICS, schema: CORE, table: LOCATIONS }
    primary_key: { columns: [location_id] }
    dimensions:
      - { name: location_name, expr: location_name, data_type: TEXT }
  - name: regions
    base_table: { database: ANALYTICS, schema: CORE, table: REGIONS }
    primary_key: { columns: [region_id] }
    dimensions:
      - { name: region_name, expr: region_name, data_type: TEXT }
relationships:
  - name: locations_to_regions
    left_table: locations
    right_table: regions
    relationship_columns:
      - { left_column: region_id, right_column: region_id }`,
    "", "The relationship supports grouping at either level but does not create an ordered BI drill path. Validate that each location has one current region or model history explicitly.", [DOCS.yaml]);

  add(30, "core",
    "Alias the same physical dimension as two logical tables so billing and shipping each have an independent relationship path and business name.",
    `tables:
  - name: billing_customer
    base_table: { database: ANALYTICS, schema: CORE, table: CUSTOMERS }
    primary_key: { columns: [customer_id] }
    dimensions:
      - { name: customer_name, expr: customer_name, data_type: TEXT }
  - name: shipping_customer
    base_table: { database: ANALYTICS, schema: CORE, table: CUSTOMERS }
    primary_key: { columns: [customer_id] }
relationships:
  - name: orders_to_billing
    left_table: orders
    right_table: billing_customer
    relationship_columns: [{ left_column: billing_customer_id, right_column: customer_id }]
  - name: orders_to_shipping
    left_table: orders
    right_table: shipping_customer
    relationship_columns: [{ left_column: shipping_customer_id, right_column: customer_id }]`,
    "", "Each alias is an independent logical entity. Use distinct descriptions and synonyms so Cortex does not confuse the two roles.", [DOCS.yaml]);

  add(31, "core",
    "Declare keys and relationships at their real cardinalities so the semantic query planner can protect entity-level metrics from fanout.",
    `tables:
  - name: orders
    primary_key: { columns: [order_id] }
    metrics:
      - { name: order_revenue, expr: "SUM(order_total)" }
  - name: order_lines
    primary_key: { columns: [order_id, line_number] }
relationships:
  - name: lines_to_orders
    left_table: order_lines
    right_table: orders
    relationship_columns:
      - { left_column: order_id, right_column: order_id }`,
    "", "The planner relies on the declared grain. Dirty or incomplete keys still produce wrong results, and facts-only many-to-many queries do not receive metric deduplication.", [DOCS.query, DOCS.validation]);

  add(32, "core",
    "Keep the header amount on the keyed order entity and define its metric there rather than summing a repeated value from line rows.",
    `tables:
  - name: orders
    primary_key: { columns: [order_id] }
    facts:
      - { name: order_total, expr: order_total, data_type: NUMBER }
    metrics:
      - { name: revenue, expr: "SUM(order_total)" }
  - name: order_lines
    primary_key: { columns: [order_id, line_number] }
relationships:
  - name: lines_to_orders
    left_table: order_lines
    right_table: orders
    relationship_columns: [{ left_column: order_id, right_column: order_id }]`,
    "", "Do not use SUM(DISTINCT order_total): two different orders can legitimately share the same amount. Separate header and line entities whenever possible.", [DOCS.validation]);

  add(33, "core",
    "Model a bridge as its own keyed logical table with two relationships; Snowflake can traverse and deduplicate many-to-many metric paths.",
    `tables:
  - name: customer_segments
    base_table: { database: ANALYTICS, schema: CORE, table: CUSTOMER_SEGMENTS }
    primary_key: { columns: [customer_id, segment_id] }
  - name: customers
    primary_key: { columns: [customer_id] }
  - name: segments
    primary_key: { columns: [segment_id] }
relationships:
  - name: bridge_to_customer
    left_table: customer_segments
    right_table: customers
    relationship_columns: [{ left_column: customer_id, right_column: customer_id }]
  - name: bridge_to_segment
    left_table: customer_segments
    right_table: segments
    relationship_columns: [{ left_column: segment_id, right_column: segment_id }]`,
    "Available through the current many-to-many preview.", "A customer in two selected segments is repeated across segment rows by design. Many-to-many paths cannot currently be combined with LOD or USING-relationship metrics.", [DOCS.query, DOCS.ddl]);

  add(34, "core",
    "Store an explicit allocation weight at the conversion-channel grain and aggregate allocated value through the bridge.",
    `tables:
  - name: attribution
    base_table: { database: MARKETING, schema: MARTS, table: CONVERSION_ATTRIBUTION }
    primary_key: { columns: [conversion_id, channel_id] }
    facts:
      - { name: allocated_value, expr: "conversion_value * attribution_weight", data_type: NUMBER }
    metrics:
      - { name: attributed_revenue, expr: "SUM(allocated_value)" }
  - name: channels
    primary_key: { columns: [channel_id] }
relationships:
  - name: attribution_to_channel
    left_table: attribution
    right_table: channels
    relationship_columns: [{ left_column: channel_id, right_column: channel_id }]`,
    "", "Validate that weights sum to the intended total for each conversion and define unattributed value. Version attribution models rather than overwriting history.", [DOCS.yaml]);

  add(35, "core",
    "Model actuals and targets as separate entities related through conformed dimensions, then combine their metrics in a view-level derived metric.",
    `tables:
  - name: actuals
    base_table: { database: ANALYTICS, schema: MARTS, table: DAILY_ACTUALS }
    metrics:
      - { name: revenue, expr: "SUM(revenue)" }
  - name: targets
    base_table: { database: ANALYTICS, schema: MARTS, table: MONTHLY_TARGETS }
    metrics:
      - { name: target_revenue, expr: "SUM(target_revenue)" }
metrics:
  - name: revenue_variance
    expr: "actuals.revenue - targets.target_revenue"`,
    "", "The dimensions requested with both metrics must connect through valid relationship paths. Do not join daily facts directly to monthly targets without a conformed grain.", [DOCS.yaml, DOCS.validation]);

  add(36, "core",
    "Use an ASOF or range relationship to select the dimension version valid at the fact timestamp.",
    `relationships:
  - name: orders_to_customer_history
    left_table: orders
    right_table: customer_history
    relationship_columns:
      - { left_column: customer_id, right_column: customer_id }
      - left_column: ordered_at
        right_column: valid_from
        type: range
        right_range:
          start_column: valid_from
          end_column: valid_to`,
    "Range relationships are currently preview; an ASOF relationship is available when the most recent prior row is sufficient.", "Enforce non-overlapping validity ranges and decide how to treat open-ended rows. The declared constraint must match the historical data.", [DOCS.yaml, DOCS.ddl]);

  add(37, "boundary",
    "Build a cycle-safe organization closure relation with ancestor, descendant, and depth, then expose that result as a logical table.",
    `# ANALYTICS.CORE.ORG_CLOSURE is maintained by a recursive SQL/dbt task.
tables:
  - name: org_closure
    base_table: { database: ANALYTICS, schema: CORE, table: ORG_CLOSURE }
    primary_key: { columns: [ancestor_id, descendant_id] }
    dimensions:
      - { name: depth, expr: depth, data_type: NUMBER }
relationships:
  - name: closure_to_employee
    left_table: org_closure
    right_table: employees
    relationship_columns: [{ left_column: descendant_id, right_column: employee_id }]`,
    "Semantic relationships are not recursive and do not perform graph traversal.", "The producing process owns maximum depth, cycle detection, multiple-parent policy, and historical restatement.", [DOCS.yaml]);

  add(38, "core",
    "Treat the identity map as a versioned entity and relate events to its stable household identifier at the intended effective time.",
    `tables:
  - name: identity_map
    base_table: { database: ANALYTICS, schema: IDENTITY, table: CUSTOMER_HOUSEHOLD_MAP }
    primary_key: { columns: [customer_id, valid_from] }
    dimensions:
      - { name: household_id, expr: household_id, data_type: TEXT }
    metrics:
      - { name: households, expr: "COUNT(DISTINCT household_id)" }
relationships:
  - name: events_to_identity
    left_table: events
    right_table: identity_map
    relationship_columns:
      - { left_column: customer_id, right_column: customer_id }
      - { left_column: occurred_at, right_column: valid_from, type: asof }`,
    "", "Identity resolution can be probabilistic and can change. Expose confidence and model version, and choose explicitly whether historical reporting restates.", [DOCS.yaml]);

  // 39–48 · Time and behavior
  add(39, "core",
    "Normalize each event to the declared business timezone before deriving business-date dimensions.",
    `time_dimensions:
  - name: occurred_at_utc
    expr: occurred_at
    data_type: TIMESTAMP_TZ
  - name: business_date
    expr: "CONVERT_TIMEZONE('UTC', 'America/Los_Angeles', occurred_at)::DATE"
    data_type: DATE`,
    "", "Session timezone, timestamp type, and daylight-saving transitions interact. Do not convert a value that is already stored in local time.", [DOCS.yaml]);

  add(40, "core",
    "Derive a simple month-offset fiscal period in dimensions; use a calendar table when week or year naming rules are more complex.",
    `dimensions:
  - name: fiscal_year
    expr: "YEAR(DATEADD(month, -6, order_date))"
    data_type: NUMBER
  - name: fiscal_month
    expr: "MONTH(DATEADD(month, -6, order_date))"
    data_type: NUMBER`,
    "", "A month offset does not implement 4-4-5 weeks. Confirm whether the fiscal year is named by its starting or ending calendar year.", [DOCS.yaml]);

  add(41, "boundary",
    "Join facts to a governed retail calendar that owns fiscal week, period, comparable date, and 53-week rules.",
    `tables:
  - name: retail_calendar
    base_table: { database: ANALYTICS, schema: SHARED, table: RETAIL_CALENDAR }
    primary_key: { columns: [calendar_date] }
    dimensions:
      - { name: retail_week, expr: retail_week, data_type: NUMBER }
      - { name: retail_period, expr: retail_period, data_type: NUMBER }
    time_dimensions:
      - { name: comparable_date, expr: prior_year_comparable_date, data_type: DATE }
relationships:
  - name: sales_to_calendar
    left_table: sales
    right_table: retail_calendar
    relationship_columns: [{ left_column: sold_date, right_column: calendar_date }]`,
    "Semantic Views consume but do not generate an NRF/4-4-5 calendar.", "Calendar ownership, 53-week mapping, holiday shifts, and restatement policy must be explicit and version-controlled upstream.", [DOCS.yaml]);

  add(42, "core",
    "Define current-period revenue and a window metric that retrieves the prior comparable period at the declared calendar grain.",
    `metrics:
  - { name: revenue, expr: "SUM(revenue)" }
  - name: prior_period_revenue
    expr: >-
      LAG(sales.revenue, 1) OVER (
        PARTITION BY EXCLUDING calendar.fiscal_period
        ORDER BY calendar.fiscal_period
      )
  - name: period_over_period_change
    expr: >-
      (sales.revenue - LAG(sales.revenue, 1) OVER (
        PARTITION BY EXCLUDING calendar.fiscal_period
        ORDER BY calendar.fiscal_period
      )) / NULLIF(LAG(sales.revenue, 1) OVER (
        PARTITION BY EXCLUDING calendar.fiscal_period
        ORDER BY calendar.fiscal_period
      ), 0)`,
    "", "Window metrics require their ordering dimensions in the query and cannot feed another metric. For irregular calendars, order on a stable period sequence.", [DOCS.query, DOCS.validation]);

  add(43, "core",
    "Use a window-function metric with a time-based frame over an additive base metric.",
    `metrics:
  - { name: daily_revenue, expr: "SUM(revenue)" }
  - name: rolling_28_day_revenue
    expr: >-
      SUM(sales.daily_revenue) OVER (
        PARTITION BY EXCLUDING calendar.calendar_date
        ORDER BY calendar.calendar_date
        RANGE BETWEEN INTERVAL '27 days' PRECEDING AND CURRENT ROW
      )`,
    "", "A row frame counts rows, while a range frame represents elapsed dates. Missing dates, timezone boundaries, and required query dimensions can change the answer.", [DOCS.query]);

  add(44, "core",
    "Use governed calendar flags as semantic filters so YTD and completed-period logic follows the business clock and data cutoff.",
    `dimensions:
  - name: current_ytd
    expr: "calendar_date BETWEEN fiscal_year_start AND data_complete_through"
    data_type: BOOLEAN
    labels: [filter]
  - name: completed_period
    expr: "period_end_date <= data_complete_through"
    data_type: BOOLEAN
    labels: [filter]
module_custom_instructions:
  sql_generation: "For YTD questions, filter current_ytd = TRUE."`,
    "", "Cortex instructions guide SQL generation but do not constrain every Semantic SQL caller. Refresh the data-completeness cutoff from the authoritative pipeline.", [DOCS.filters, DOCS.yaml]);

  add(45, "core",
    "Combine a typed as-of variable, an eligible-row filter, and a semi-additive balance metric that selects the last snapshot.",
    `variables:
  - { name: as_of_date, data_type: DATE, description: "Inclusive reporting cutoff" }
tables:
  - name: account_snapshots
    time_dimensions:
      - { name: snapshot_date, expr: snapshot_date, data_type: DATE }
    dimensions:
      - name: eligible_as_of
        expr: "snapshot_date <= as_of_date"
        data_type: BOOLEAN
        labels: [filter]
    metrics:
      - name: balance
        expr: "SUM(balance)"
        non_additive_dimensions:
          - { table: account_snapshots, dimension: snapshot_date, sort_direction: ascending }`,
    "", "The caller must apply eligible_as_of. A variable does not make that filter mandatory, so provide a verified query or application guardrail for as-of workflows.", [DOCS.variables, DOCS.filters, DOCS.ddl]);

  add(46, "boundary",
    "Materialize or define a customer-period cohort relation with cohort date, activity period, cohort size, and retained identity; model those stable columns semantically.",
    `tables:
  - name: cohort_activity
    base_table: { database: ANALYTICS, schema: MARTS, table: COHORT_ACTIVITY }
    primary_key: { columns: [customer_id, activity_month] }
    time_dimensions:
      - { name: cohort_month, expr: cohort_month, data_type: DATE }
    dimensions:
      - { name: months_since_cohort, expr: months_since_cohort, data_type: NUMBER }
    metrics:
      - { name: retained_customers, expr: "COUNT(DISTINCT IFF(is_active, customer_id, NULL))" }
      - { name: cohort_customers, expr: "COUNT(DISTINCT customer_id)" }`,
    "Cohort assignment, dense period generation, and reactivation policy are generally source transformations rather than semantic relationships.", "Do not sum cohort sizes across activity periods. Define identity, late-arriving event, and restatement rules before publishing retention.", [DOCS.yaml]);

  add(47, "boundary",
    "Prepare one row per funnel entity with first qualifying timestamps or step flags, then count identities conditionally in the semantic view.",
    `tables:
  - name: user_funnel
    base_table: { database: PRODUCT, schema: MARTS, table: USER_FUNNEL }
    primary_key: { columns: [user_id] }
    metrics:
      - { name: reached_signup, expr: "COUNT_IF(signed_up_at IS NOT NULL)" }
      - { name: reached_activation, expr: "COUNT_IF(activated_at IS NOT NULL)" }
      - { name: reached_purchase, expr: "COUNT_IF(purchased_at IS NOT NULL)" }`,
    "Semantic expressions do not by themselves enforce event sequence, first occurrence, or conversion windows across arbitrary event rows.", "The prepared entity table must encode ordering, qualification windows, identity stitching, and reactivation rules.", [DOCS.yaml]);

  add(48, "boundary",
    "Calculate simple elapsed duration natively, but prepare calendar-aware business duration when SLAs exclude nights, weekends, holidays, or paused states.",
    `facts:
  - name: resolution_hours_elapsed
    expr: "DATEDIFF('second', opened_at, resolved_at) / 3600.0"
    data_type: NUMBER
metrics:
  - { name: average_resolution_hours, expr: "AVG(resolution_hours_elapsed)" }
  - { name: p95_resolution_hours, expr: "APPROX_PERCENTILE(resolution_hours_elapsed, 0.95)" }`,
    "Elapsed time is native; business-time clocks require a prepared calendar-aware fact or UDF.", "Define missing endpoints, reopened tickets, paused states, timezone, and calendar version. Avoid calling elapsed hours an SLA duration when exclusions apply.", [DOCS.yaml]);

  // 49–55 · Business transformations
  add(49, "core",
    "Relate each transaction to exactly one governed FX rate by currency and effective date, then aggregate the converted row value.",
    `tables:
  - name: fx_daily
    primary_key: { columns: [from_currency, rate_date] }
    facts:
      - { name: usd_rate, expr: usd_rate, data_type: NUMBER }
  - name: orders
    facts:
      - { name: revenue_usd_value, expr: "revenue_local * fx_daily.usd_rate", data_type: NUMBER }
    metrics:
      - { name: revenue_usd, expr: "SUM(revenue_usd_value)" }
relationships:
  - name: orders_to_fx
    left_table: orders
    right_table: fx_daily
    relationship_columns:
      - { left_column: currency_code, right_column: from_currency }
      - { left_column: order_date, right_column: rate_date }`,
    "", "Define spot versus average rate, triangulation, missing-rate behavior, and restatement. The relationship must return at most one rate per fact row.", [DOCS.yaml, DOCS.validation]);

  add(50, "core",
    "Join each measurement to the conversion factor valid for its item and unit, then aggregate only the converted base-unit fact.",
    `tables:
  - name: measurements
    facts:
      - { name: quantity_kg_value, expr: "quantity * unit_conversion.factor_to_kg", data_type: NUMBER }
    metrics:
      - { name: quantity_kg, expr: "SUM(quantity_kg_value)" }
  - name: unit_conversion
    facts:
      - { name: factor_to_kg, expr: factor_to_kg, data_type: NUMBER }
relationships:
  - name: measurement_to_conversion
    left_table: measurements
    right_table: unit_conversion
    relationship_columns:
      - { left_column: item_id, right_column: item_id }
      - { left_column: unit_code, right_column: from_unit }`,
    "", "Some conversions depend on density, temperature, packaging, or effective date. Include that context in the key instead of treating the factor as universal.", [DOCS.yaml]);

  add(51, "core",
    "Keep actual, budget, and forecast as separately versioned metrics at conformed grains, then combine them in view-level derived metrics.",
    `tables:
  - name: actuals
    metrics:
      - { name: amount, expr: "SUM(amount)" }
  - name: plans
    dimensions:
      - { name: scenario, expr: scenario, data_type: TEXT }
      - { name: plan_version, expr: plan_version, data_type: TEXT }
    metrics:
      - { name: budget, expr: "SUM(IFF(scenario = 'BUDGET', amount, 0))" }
      - { name: forecast, expr: "SUM(IFF(scenario = 'FORECAST', amount, 0))" }
metrics:
  - { name: actual_vs_budget, expr: "actuals.amount - plans.budget" }`,
    "", "Facts must share compatible period, entity, currency, and unit grains. Retain plan_version so a new submission does not rewrite historical reporting.", [DOCS.yaml, DOCS.validation]);

  add(52, "core",
    "Use a typed variable in the metric expression and pass the scenario value in the Semantic SQL VARIABLES clause.",
    `variables:
  - name: price_change_pct
    data_type: NUMBER(7,4)
    default_value: "0"
tables:
  - name: order_lines
    metrics:
      - name: simulated_revenue
        expr: "SUM(quantity * unit_price * (1 + price_change_pct))"

# Query with: VARIABLES price_change_pct => 0.05`,
    "", "Variables are query inputs, not stored plans. Validate sensible ranges in the consuming app and label simulated results distinctly from observations.", [DOCS.variables, DOCS.query]);

  add(53, "core",
    "Use a typed selector variable and a derived metric that returns one of the governed named metrics.",
    `variables:
  - name: metric_choice
    data_type: STRING
    default_value: "REVENUE"
metrics:
  - name: selected_metric
    expr: >-
      CASE metric_choice
        WHEN 'REVENUE' THEN orders.revenue
        WHEN 'ORDERS' THEN orders.order_count
        WHEN 'CUSTOMERS' THEN orders.unique_customers
        ELSE NULL
      END`,
    "", "Variables do not declare an enum of allowed values. Selected metrics can also have incompatible units, formats, and valid dimensions, so keep the named metrics available for governed reuse.", [DOCS.variables, DOCS.validation]);

  add(54, "core",
    "Calculate stable segmentation features at the customer grain and expose a deterministic CASE dimension with versioned thresholds.",
    `dimensions:
  - name: customer_segment
    expr: >-
      CASE
        WHEN lifetime_value >= 10000 AND days_since_order <= 30 THEN 'Champions'
        WHEN days_since_order > 180 THEN 'At risk'
        ELSE 'Core'
      END
    data_type: TEXT
    is_enum: true
    sample_values: [Champions, At risk, Core]`,
    "", "CASE uses first-match order. Version thresholds and calculate lifetime features at the entity grain, not through a transaction join that can fan out.", [DOCS.yaml]);

  add(55, "boundary",
    "Expose governed coordinates, geographic keys, and any Snowflake GEOGRAPHY value as dimensions; let the consuming experience own map rendering and drill behavior.",
    `dimensions:
  - { name: country_code, expr: country_code, data_type: TEXT }
  - { name: region_name, expr: region_name, data_type: TEXT }
  - { name: latitude, expr: latitude, data_type: FLOAT }
  - { name: longitude, expr: longitude, data_type: FLOAT }
  - { name: geography, expr: geography, data_type: GEOGRAPHY }`,
    "Semantic Views do not define a portable map visualization or ordered geographic drill path.", "Geocoding quality, privacy, postal-code reuse, and changing administrative boundaries remain data-governance concerns.", [DOCS.yaml]);

  // 56–60 · Governance
  add(56, "boundary",
    "Attach a Snowflake row access policy to an underlying table; owner-rights semantic queries propagate and enforce that policy.",
    `CREATE OR REPLACE ROW ACCESS POLICY account_region_policy
  AS (policy_region_id NUMBER) RETURNS BOOLEAN ->
    EXISTS (
      SELECT 1 FROM SECURITY.ROLE_REGION_ACCESS a
      WHERE a.role_name = CURRENT_ROLE()
        AND a.region_id = policy_region_id
    );

ALTER TABLE ANALYTICS.CORE.ACCOUNTS
  ADD ROW ACCESS POLICY account_region_policy ON (region_id);`,
    "Row security is a Snowflake data-protection policy, not an expression embedded in the Semantic View.", "Test direct Semantic SQL, Cortex Agents, service roles, shared objects, and policy-owner permissions. Do not rely on a generated WHERE clause for security.", [DOCS.security]);

  add(57, "boundary",
    "Use masking or projection policies on underlying columns for role-sensitive protection; use PRIVATE only for helpers that no caller may query directly.",
    `CREATE OR REPLACE MASKING POLICY margin_mask
  AS (value NUMBER) RETURNS NUMBER ->
    IFF(IS_ROLE_IN_SESSION('FINANCE_ANALYST'), value, NULL);

ALTER TABLE ANALYTICS.CORE.ORDERS
  MODIFY COLUMN GROSS_MARGIN SET MASKING POLICY margin_mask;

# Semantic YAML helper (globally hidden, not role-sensitive):
facts:
  - { name: internal_cost, expr: internal_cost, data_type: NUMBER,
      access_modifier: private_access }`,
    "A Semantic View access_modifier is public or private for everyone; it is not a per-role field grant.", "Masking can still permit inference through related metrics. For true surface separation, publish different semantic views and grant SELECT deliberately.", [DOCS.security, DOCS.yaml]);

  add(58, "boundary",
    "Define editable boolean filters in the semantic model, but enforce immutable retention or tenancy limits with row access policies or secured source views.",
    `dimensions:
  - name: completed_only
    expr: "status = 'COMPLETE'"
    data_type: BOOLEAN
    labels: [filter]
module_custom_instructions:
  sql_generation: >-
    Default to completed_only = TRUE unless the user explicitly requests
    another status. Never query events older than the approved retention view.`,
    "Semantic Views have named filters and Cortex instructions, but no native required-filter constraint for every Semantic SQL query.", "Instructions guide Cortex rather than enforce authorization. Put non-negotiable bounds in a row access policy or a secured underlying view.", [DOCS.filters, DOCS.security]);

  add(59, "boundary",
    "Put definitions, ownership, synonyms, and verified questions beside the metric; document the intended detail query because ordered drill paths are consumer-owned.",
    `metrics:
  - name: net_revenue
    expr: "orders.gross_sales - orders.returns"
    description: >-
      Captured sales less posted returns; excludes tax.
      Owner: Finance Analytics.
    synonyms: [recognized net sales]
verified_queries:
  - name: net_revenue_order_detail
    question: "Which orders make up net revenue this month?"
    sql: >-
      SELECT order_id, ordered_date, AGG(net_revenue)
      FROM ANALYTICS.SEMANTIC.ORDERS_SV
      GROUP BY order_id, ordered_date`,
    "Metric metadata and verified queries are native; a first-class ordered drill_fields path is not.", "A verified query is guidance and documentation, not a field-level security boundary. Protect any sensitive detail at the data-policy layer.", [DOCS.yaml]);

  add(60, "core",
    "Define audited component metrics once and reference them from derived metrics instead of copying aggregate SQL.",
    `tables:
  - name: orders
    metrics:
      - { name: gross_sales, expr: "SUM(gross_sales)" }
      - { name: returns, expr: "SUM(returns)" }
metrics:
  - name: net_revenue
    expr: "orders.gross_sales - orders.returns"
    description: "Certified finance definition; owner Finance Analytics."`,
    "", "Metric references must obey entity-grain validation. Keep dependency chains understandable and use DESCRIBE/SHOW metadata in review tooling.", [DOCS.validation, DOCS.yaml]);

  // 61–68 · Performance and evolution
  add(61, "core",
    "Materialize the reusable daily product dimensions and additive metrics so Semantic SQL can scan the maintained aggregate instead of raw events.",
    `ALTER SEMANTIC VIEW event_metrics
  SET MAX_STALENESS = '1 hour';

ALTER SEMANTIC VIEW event_metrics
  ADD MATERIALIZATION daily_product_metrics
  WAREHOUSE = TRANSFORM_WH
  REFRESH_MODE = AUTO
  AS
    DIMENSIONS events.event_date, products.product_id
    METRICS events.revenue, events.event_count;`,
    "", "Pre-aggregate additive components, not arbitrary ratios or percentiles. Materializations accelerate Semantic SQL, not Cortex requests that generate physical SQL against base tables.", [DOCS.materializations]);

  add(62, "core",
    "Set an explicit maximum staleness for semantic materializations and monitor refresh history; let the query-result cache remain a separate Snowflake concern.",
    `ALTER SEMANTIC VIEW orders_sv
  SET MAX_STALENESS = '2 hours';

ALTER SEMANTIC VIEW orders_sv
  ADD MATERIALIZATION orders_by_day
  WAREHOUSE = SEMANTIC_REFRESH_WH
  AS
    DIMENSIONS orders.order_date
    METRICS orders.revenue, orders.order_count;`,
    "", "MAX_STALENESS is a freshness bound, not proof that upstream ETL succeeded. Snowflake can suspend a materialization whose refresh cannot keep up.", [DOCS.materializations]);

  add(63, "core",
    "Add a materialization covering the common query dimensions and metrics; Snowflake automatically chooses an eligible lower-cost materialization.",
    `ALTER SEMANTIC VIEW orders_sv
  ADD MATERIALIZATION monthly_region
  WAREHOUSE = SEMANTIC_REFRESH_WH
  AS
    DIMENSIONS calendar.order_month, locations.region
    METRICS orders.revenue, orders.order_count;

SELECT SYSTEM$CHECK_SEMANTIC_VIEW_MATERIALIZATION_REWRITE(
  $$SELECT * FROM SEMANTIC_VIEW(
      orders_sv
      DIMENSIONS calendar.order_month, locations.region
      METRICS orders.revenue)$$,
  'orders_sv', 'monthly_region');`,
    "", "Rewrite requires compatible dimensions, metrics, filters, policies, and freshness. Non-additive metrics cannot always be reaggregated from a finer materialization.", [DOCS.materializations]);

  add(64, "core",
    "Publish an explicitly approximate metric with a documented algorithm and error contract; keep the exact metric separately named.",
    `metrics:
  - name: users_exact
    expr: "COUNT(DISTINCT user_id)"
  - name: users_approx
    expr: "APPROX_COUNT_DISTINCT(user_id)"
    description: >-
      Approximate unique users for exploratory dashboards;
      never use for billing, compliance, or entitlements.`,
    "", "Semantic Views do not silently convert an exact distinct metric to approximate. Validate expected error and do not present both fields with interchangeable labels.", [DOCS.validation]);

  add(65, "core",
    "Use an incrementally refreshed materialization and mark an immutable historical region so late-arriving data is recomputed only where needed.",
    `ALTER SEMANTIC VIEW flights_sv
  ADD MATERIALIZATION flights_daily
  WAREHOUSE = SEMANTIC_REFRESH_WH
  REFRESH_MODE = INCREMENTAL
  IMMUTABLE WHERE (departure_date < '2026-11-14')
  AS
    DIMENSIONS flights.departure_date, flights.carrier
    METRICS flights.flight_count;`,
    "", "Incremental refresh is not supported for every metric or multi-entity shape; Snowflake may require a full recomputation. Advance the explicit immutable boundary only after the late-arrival watermark is safe.", [DOCS.materializations]);

  add(66, "boundary",
    "Run stable Semantic SQL assertions in CI and compare results or metadata to approved fixtures; keep verified queries as usage examples, not test assertions.",
    `-- CI assertion query; fail the pipeline unless this returns zero rows.
WITH actual AS (
  SELECT AGG(net_revenue) AS value
  FROM ANALYTICS.SEMANTIC.FINANCE_SV
  WHERE fiscal_year = 2026
)
SELECT value
FROM actual
WHERE value <> 204259;

-- Also validate the deployed object:
DESCRIBE SEMANTIC VIEW ANALYTICS.SEMANTIC.FINANCE_SV;`,
    "Semantic Views do not contain an embedded data-test or assertion object.", "Use immutable fixtures or approved closed periods. Exact-value tests against mutable facts create noise; also validate privileges and generated Cortex SQL.", [DOCS.query, DOCS.validation]);

  add(67, "boundary",
    "Publish a new metric name, preserve the legacy definition during migration, and encode owner/effective-date context in descriptions or governance tags.",
    `metrics:
  - name: net_revenue_v1
    expr: "orders.gross_sales - orders.booked_returns"
    description: "Legacy: booked returns. Deprecated after FY2026 close."
    access_modifier: public_access
  - name: net_revenue_v2
    expr: "orders.gross_sales - orders.settled_returns"
    description: "Current: settled returns. Effective FY2027. Owner: Finance."
    access_modifier: public_access`,
    "Semantic Views can carry both definitions and tags, but do not natively enforce effective dates, deprecation workflows, or consumer migration.", "Renaming is not versioning. Reconcile both metrics, inventory dependencies, communicate the cutover, and only later remove or privatize v1.", [DOCS.yaml]);

  add(68, "core",
    "Retain outcome type, model version, forecast origin, and horizon as dimensions; aggregate observed and predicted values separately before calculating error.",
    `dimensions:
  - { name: result_type, expr: result_type, data_type: TEXT }
  - { name: model_version, expr: model_version, data_type: TEXT }
time_dimensions:
  - { name: forecast_origin, expr: forecast_origin, data_type: DATE }
metrics:
  - name: observed_units
    expr: "SUM(IFF(result_type = 'OBSERVED', units, 0))"
  - name: predicted_units
    expr: "SUM(IFF(result_type = 'PREDICTED', units, 0))"
  - name: forecast_error
    expr: "forecasts.observed_units - forecasts.predicted_units"`,
    "", "Evaluate the forecast version that existed at the cutoff, not a backfilled model. Actuals and predictions must share item, horizon, unit, and grain.", [DOCS.yaml, DOCS.validation]);

  window.SNOWFLAKE_SEMANTIC_VIEW_USE_CASES = cases;
})();
