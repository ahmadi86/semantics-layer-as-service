(() => {
  const sourceCases = new Map((window.LOOKML_USE_CASES || []).map(item => [item.id, item]));
  const cases = [];
  const CORE = { label: "Core specification", url: "https://github.com/apache/ossie/blob/main/core-spec/spec.md" };
  const EXPR = { label: "OSSIE_SQL_2026", url: "https://github.com/apache/ossie/blob/main/core-spec/expression_language.md" };
  const REL = { label: "Relational semantics", url: "https://github.com/apache/ossie/blob/main/core-spec/relational_semantics.md" };
  const SCHEMA = { label: "JSON Schema", url: "https://github.com/apache/ossie/blob/main/core-spec/ossie-schema.json" };
  const ROADMAP = { label: "Apache Ossie roadmap", url: "https://github.com/apache/ossie/blob/main/ROADMAP.md" };
  const labels = { core: "Core Ossie", boundary: "Source / runtime boundary", unsupported: "Not supported" };
  const doc = (name, body) => ["version: 0.3.0.dev0", "name: " + name, body.trim()].join("\n");

  function add(number, support, rule, code, supportNote, caveat, docs) {
    const id = "case-" + String(number).padStart(2, "0");
    const source = sourceCases.get(id);
    if (!source) throw new Error("Missing LookML source situation " + id);
    cases.push({
      ...source,
      rule,
      code: code ? code.trim() : "",
      caveat,
      mode: labels[support],
      support,
      supportNote: supportNote || (support === "core"
        ? "Representable in the Apache Ossie core document without vendor extensions."
        : ""),
      docs
    });
  }

  add(1, "core",
    "Declare the transaction grain with a primary key, expose row-level fields, and define additive metrics over those fields.",
    doc("orders", `
datasets:
  - name: orders
    source: analytics.orders
    primary_key: [order_id]
    fields:
      - name: order_id
        expression: { sql: order_id }
        datatype: String
      - name: customer_id
        expression: { sql: customer_id }
        datatype: String
      - name: ordered_at
        expression: { sql: ordered_at }
        datatype: DateTimeTz
        dimension: { is_time: true }
      - name: revenue
        expression: { sql: revenue }
        datatype: Decimal
      - name: quantity
        expression: { sql: quantity }
        datatype: Decimal
    metrics:
      - name: total_revenue
        expression: { sql: "SUM(revenue)" }
        datatype: Decimal
      - name: total_quantity
        expression: { sql: "SUM(quantity)" }
        datatype: Decimal`),
    "", "The declared key must be non-null and truly unique at the source grain; the interchange file does not repair duplicate rows.", [CORE, SCHEMA]);

  add(2, "core",
    "Expose each KPI as a named field and metric, and document which dimensions preserve additivity.",
    doc("daily_location_kpis", `
datasets:
  - name: daily_location_kpis
    source: analytics.daily_location_kpis
    primary_key: [location_day_key]
    fields:
      - name: location_day_key
        expression: { sql: location_day_key }
      - name: location_id
        expression: { sql: location_id }
      - name: day
        expression: { sql: day }
        datatype: Date
        dimension: { is_time: true }
      - name: gross_revenue
        expression: { sql: gross_revenue }
        datatype: Decimal
      - name: order_count
        expression: { sql: order_count }
        datatype: Integer
      - name: units
        expression: { sql: units }
        datatype: Decimal
    metrics:
      - name: revenue
        expression: { sql: "SUM(gross_revenue)" }
        datatype: Decimal
      - name: orders
        expression: { sql: "SUM(order_count)" }
        datatype: Integer
      - name: units_sold
        expression: { sql: "SUM(units)" }
        datatype: Decimal`),
    "", "A separate column does not make a KPI additive. Consumers still need the source grain and metric description to avoid invalid rollups.", [CORE, EXPR]);

  add(3, "core",
    "Use a discriminator inside each metric expression so unlike values never share one generic aggregate.",
    doc("long_kpis", `
datasets:
  - name: long_kpis
    source: analytics.long_kpis
    fields:
      - name: location_id
        expression: { sql: location_id }
      - name: day
        expression: { sql: day }
        datatype: Date
        dimension: { is_time: true }
      - name: metric_code
        expression: { sql: metric_code }
      - name: metric_value
        expression: { sql: metric_value }
        datatype: Decimal
    metrics:
      - name: revenue
        expression:
          sql: "SUM(metric_value) FILTER (WHERE metric_code = 'REVENUE')"
        datatype: Decimal
      - name: units
        expression:
          sql: "SUM(metric_value) FILTER (WHERE metric_code = 'UNITS')"
        datatype: Decimal`),
    "", "The source must contain at most one compatible contribution for each metric at its declared grain.", [CORE, EXPR]);

  add(4, "core",
    "Define each aggregation behavior independently; recompute ratios from additive components and count identities instead of summing stored distinct counts.",
    doc("mixed_metric_behaviors", `
datasets:
  - name: metric_events
    source: analytics.metric_events
    fields:
      - name: metric_code
        expression: { sql: metric_code }
      - name: metric_value
        expression: { sql: metric_value }
        datatype: Decimal
      - name: customer_id
        expression: { sql: customer_id }
      - name: numerator
        expression: { sql: numerator }
        datatype: Decimal
      - name: denominator
        expression: { sql: denominator }
        datatype: Decimal
    metrics:
      - name: revenue
        expression:
          sql: "SUM(metric_value) FILTER (WHERE metric_code = 'REVENUE')"
      - name: conversion_rate
        expression:
          sql: "SUM(numerator) / CASE WHEN SUM(denominator) = 0 THEN NULL ELSE SUM(denominator) END"
      - name: unique_customers
        expression:
          sql: "COUNT(DISTINCT customer_id)"`),
    "", "Metric expressions cannot reference other metrics, so reusable components must currently be repeated or prepared as fields.", [CORE, EXPR, ROADMAP]);

  add(5, "core",
    "Filter and aggregate the numerator and denominator independently, then divide the aggregate expressions.",
    doc("campaign_ctr", `
datasets:
  - name: campaign_metrics
    source: marketing.campaign_metric_rows
    fields:
      - name: campaign_id
        expression: { sql: campaign_id }
      - name: day
        expression: { sql: day }
        datatype: Date
        dimension: { is_time: true }
      - name: metric_code
        expression: { sql: metric_code }
      - name: metric_value
        expression: { sql: metric_value }
        datatype: Decimal
    metrics:
      - name: click_through_rate
        expression:
          sql: "SUM(metric_value) FILTER (WHERE metric_code = 'CLICKS') / CASE WHEN SUM(metric_value) FILTER (WHERE metric_code = 'IMPRESSIONS') = 0 THEN NULL ELSE SUM(metric_value) FILTER (WHERE metric_code = 'IMPRESSIONS') END"
        datatype: Decimal`),
    "", "Do not average stored daily rates unless equal weighting is the intended definition.", [CORE, EXPR]);

  add(6, "boundary",
    "Register the files as a governed SQL relation first, then point an Ossie dataset at that relation.",
    doc("s3_daily_exports", `
description: S3 CSV files exposed through an Athena or Glue relation
datasets:
  - name: daily_exports
    source: reporting.daily_exports
    description: Prepared relation over the governed S3 prefix
    fields:
      - name: export_date
        expression: { sql: export_date }
        datatype: Date
        dimension: { is_time: true }
      - name: amount
        expression: { sql: amount }
        datatype: Decimal
    metrics:
      - name: total_amount
        expression: { sql: "SUM(amount)" }
        datatype: Decimal`),
    "Apache Ossie identifies a dataset source; Athena, Glue, and the ingestion layer own file paths, parsing, partitions, credentials, and schema drift.",
    "Validate headers, delimiters, types, malformed rows, and partition discovery before publishing the model.", [CORE, ROADMAP]);

  add(7, "boundary",
    "Expose the ADLS files through a stable Synapse or warehouse view and describe that relation as an Ossie dataset.",
    doc("adls_finance_extracts", `
datasets:
  - name: finance_extracts
    source: finance.curated_adls_extracts
    description: Stable SQL view over validated ADLS CSV files
    fields:
      - name: accounting_date
        expression: { sql: accounting_date }
        datatype: Date
        dimension: { is_time: true }
      - name: amount
        expression: { sql: amount }
        datatype: Decimal
    metrics:
      - name: total_amount
        expression: { sql: "SUM(amount)" }`),
    "The storage connector, OPENROWSET configuration, parser, casts, and credentials remain outside Apache Ossie.",
    "Keep the view contract stable and test file-set consistency before consumers import the model.", [CORE, ROADMAP]);

  add(8, "boundary",
    "Point the Ossie dataset at the catalog relation exposed by the selected lakehouse query engine.",
    doc("lakehouse_sales", `
datasets:
  - name: lakehouse_sales
    source: lakehouse.gold.sales
    description: Catalog relation backed by Parquet, Delta, or Iceberg
    fields:
      - name: sale_id
        expression: { sql: sale_id }
      - name: sale_date
        expression: { sql: sale_date }
        datatype: Date
        dimension: { is_time: true }
      - name: revenue
        expression: { sql: revenue }
        datatype: Decimal
    metrics:
      - name: revenue
        expression: { sql: "SUM(revenue)" }`),
    "Apache Ossie does not select the storage reader or manage snapshots, catalog permissions, partition pruning, or table maintenance.",
    "The consuming engine must resolve the source string and support the table format.", [CORE, ROADMAP]);

  add(9, "boundary",
    "Flatten repeated arrays to a declared row grain before exposing the relation through Apache Ossie.",
    doc("event_items", `
datasets:
  - name: event_items
    source: analytics.prepared_event_items
    primary_key: [event_item_key]
    description: One row per event and array offset
    fields:
      - name: event_item_key
        expression: { sql: event_item_key }
      - name: event_id
        expression: { sql: event_id }
      - name: item_offset
        expression: { sql: item_offset }
        datatype: Integer
      - name: sku
        expression: { sql: sku }
      - name: item_revenue
        expression: { sql: item_revenue }
        datatype: Decimal
    metrics:
      - name: item_revenue
        expression: { sql: "SUM(item_revenue)" }`),
    "JSON parsing, UNNEST behavior, and array-offset generation belong to the source preparation or query engine.",
    "Preserve the parent event identifier and a collision-safe item key so event-level values cannot fan out silently.", [CORE, ROADMAP]);

  add(10, "boundary",
    "Union compatible shards upstream, retain provenance, and publish the resulting relation as one dataset.",
    doc("unified_sales", `
datasets:
  - name: unified_sales
    source: analytics.unified_sales
    description: UNION ALL output with non-overlapping shards
    fields:
      - name: sale_key
        expression: { sql: sale_key }
      - name: source_region
        expression: { sql: source_region }
      - name: revenue
        expression: { sql: revenue }
        datatype: Decimal
    metrics:
      - name: revenue
        expression: { sql: "SUM(revenue)" }`),
    "Set operations and source overlap checks are outside the semantic document.",
    "Use UNION ALL when duplicates are meaningful, enforce key uniqueness, and keep shard provenance auditable.", [CORE, EXPR]);

  add(11, "boundary",
    "Ingest API and spreadsheet data into governed relations, then describe those relations and their compatible dimensions.",
    doc("targets_and_actuals", `
datasets:
  - name: monthly_targets
    source: planning.monthly_targets
    fields:
      - name: month
        expression: { sql: month }
        datatype: Date
        dimension: { is_time: true }
      - name: target_amount
        expression: { sql: target_amount }
        datatype: Decimal
    metrics:
      - name: target
        expression: { sql: "SUM(target_amount)" }
  - name: billing_actuals
    source: billing.monthly_actuals
    fields:
      - name: month
        expression: { sql: month }
        datatype: Date
        dimension: { is_time: true }
      - name: actual_amount
        expression: { sql: actual_amount }
        datatype: Decimal
    metrics:
      - name: actual
        expression: { sql: "SUM(actual_amount)" }`),
    "Apache Ossie does not call APIs, authenticate to spreadsheets, or schedule ingestion.",
    "Publish freshness, ownership, rejected-row, and source-version metadata through the surrounding data platform.", [CORE, ROADMAP]);

  add(12, "boundary",
    "Federate or materialize the sources behind an execution layer that can query them together before promising cross-database analysis.",
    doc("federated_service_analysis", `
datasets:
  - name: service_analysis
    source: federation.prepared_service_analysis
    description: Materialized or federated relation combining orders and tickets
    fields:
      - name: customer_id
        expression: { sql: customer_id }
      - name: order_revenue
        expression: { sql: order_revenue }
        datatype: Decimal
      - name: ticket_id
        expression: { sql: ticket_id }
    metrics:
      - name: revenue
        expression: { sql: "SUM(order_revenue)" }
      - name: tickets
        expression: { sql: "COUNT(DISTINCT ticket_id)" }`),
    "A model can name multiple sources, but Apache Ossie does not provide the federation engine, credentials, or a cross-database execution plan.",
    "Latency, cost, join correctness, and security follow the federating or materializing platform.", [CORE, REL, ROADMAP]);

  add(13, "core",
    "Sum the lowest-grain disjoint contribution and keep subtotal rows out of the source dataset.",
    doc("additive_sales", `
datasets:
  - name: sales
    source: analytics.sales
    fields:
      - name: revenue
        expression: { sql: revenue }
        datatype: Decimal
      - name: units
        expression: { sql: units }
        datatype: Decimal
    metrics:
      - name: revenue
        expression: { sql: "SUM(revenue)" }
        datatype: Decimal
      - name: units
        expression: { sql: "SUM(units)" }
        datatype: Decimal`),
    "", "A source containing both detail and subtotal rows will double count; Apache Ossie does not infer which rows are subtotals.", [CORE, EXPR]);

  add(14, "core",
    "Define row count and distinct entity count as separate, explicitly named metrics.",
    doc("order_and_customer_counts", `
datasets:
  - name: orders
    source: analytics.orders
    fields:
      - name: order_id
        expression: { sql: order_id }
      - name: customer_id
        expression: { sql: customer_id }
    metrics:
      - name: order_rows
        expression: { sql: "COUNT(*)" }
        datatype: Integer
      - name: unique_customers
        expression: { sql: "COUNT(DISTINCT customer_id)" }
        datatype: Integer`),
    "", "COUNT(DISTINCT) excludes null identifiers and may be expensive in the consuming engine.", [CORE, EXPR]);

  add(15, "core",
    "Count customer identities over the selected grouping scope rather than summing location-level counts.",
    doc("customers_by_location", `
datasets:
  - name: visits
    source: analytics.customer_visits
    fields:
      - name: customer_id
        expression: { sql: customer_id }
      - name: location_id
        expression: { sql: location_id }
      - name: region
        expression: { sql: region }
    metrics:
      - name: customers
        expression: { sql: "COUNT(DISTINCT customer_id)" }
        datatype: Integer`),
    "", "Exact regional distinctness requires the underlying identity values or a separately modeled mergeable representation.", [CORE, EXPR]);

  add(16, "core",
    "Compute distinctness from customer identity across the complete selected interval.",
    doc("customers_over_time", `
datasets:
  - name: orders
    source: analytics.orders
    fields:
      - name: customer_id
        expression: { sql: customer_id }
      - name: ordered_at
        expression: { sql: ordered_at }
        datatype: DateTimeTz
        dimension: { is_time: true }
    metrics:
      - name: active_customers
        expression: { sql: "COUNT(DISTINCT customer_id)" }
        datatype: Integer`),
    "", "Monthly distinct results remain non-additive across months; the consumer must evaluate the metric over the requested date filter.", [CORE, EXPR]);

  add(17, "boundary",
    "Expose a stored distinct count only at a source relation that already contains the exact supported aggregation level.",
    doc("stored_customer_counts", `
datasets:
  - name: stored_customer_counts
    source: analytics.validated_customer_counts
    description: One row per explicitly materialized aggregation level and period
    fields:
      - name: aggregation_level
        expression: { sql: aggregation_level }
      - name: scope_key
        expression: { sql: scope_key }
      - name: period
        expression: { sql: period }
        datatype: Date
        dimension: { is_time: true }
      - name: unique_customers
        expression: { sql: unique_customers }
        datatype: Integer
    metrics:
      - name: unique_customers
        expression: { sql: "MAX(unique_customers)" }
        datatype: Integer`),
    "Apache Ossie has no core valid-dimensions or required-grain constraint that prevents a consumer from regrouping a stored count incorrectly.",
    "Materialize every supported rollup independently and make the aggregation level unmistakable in the dataset contract.", [CORE, ROADMAP]);

  add(18, "core",
    "Write the ratio directly from aggregate numerator and denominator expressions so regrouping recomputes the result.",
    doc("average_order_value", `
datasets:
  - name: orders
    source: analytics.orders
    fields:
      - name: revenue
        expression: { sql: revenue }
        datatype: Decimal
      - name: order_id
        expression: { sql: order_id }
    metrics:
      - name: average_order_value
        expression:
          sql: "SUM(revenue) / CASE WHEN COUNT(DISTINCT order_id) = 0 THEN NULL ELSE COUNT(DISTINCT order_id) END"
        datatype: Decimal`),
    "", "Metric expressions cannot reference other metrics, so the aggregate components are repeated inside the ratio.", [CORE, EXPR]);

  add(19, "core",
    "Aggregate weighted value and weight inside one metric expression, then divide the two totals.",
    doc("weighted_price", `
datasets:
  - name: sales
    source: analytics.sales
    fields:
      - name: unit_price
        expression: { sql: unit_price }
        datatype: Decimal
      - name: units
        expression: { sql: units }
        datatype: Decimal
    metrics:
      - name: weighted_average_price
        expression:
          sql: "SUM(unit_price * units) / CASE WHEN SUM(units) = 0 THEN NULL ELSE SUM(units) END"
        datatype: Decimal`),
    "", "The weight must be non-negative and defined at the same source-row grain as the value.", [CORE, EXPR]);

  add(20, "core",
    "Use the portable percentile aggregate over row-level duration values.",
    doc("delivery_percentiles", `
datasets:
  - name: deliveries
    source: operations.deliveries
    fields:
      - name: delivery_hours
        expression: { sql: delivery_hours }
        datatype: Decimal
    metrics:
      - name: p90_delivery_hours
        expression:
          sql: "PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY delivery_hours)"
        datatype: Decimal`),
    "", "Percentiles are holistic aggregates; engine algorithms and performance can differ even when the declared result is portable.", [CORE, EXPR]);

  add(21, "core",
    "Apply MIN and MAX to the raw response value rather than summing precomputed extrema.",
    doc("response_extrema", `
datasets:
  - name: responses
    source: operations.responses
    fields:
      - name: response_ms
        expression: { sql: response_ms }
        datatype: Decimal
    metrics:
      - name: fastest_response_ms
        expression: { sql: "MIN(response_ms)" }
      - name: slowest_response_ms
        expression: { sql: "MAX(response_ms)" }`),
    "", "Null behavior follows SQL semantics, and shard extrema are valid only when the selected shards fully cover the requested set.", [CORE, EXPR]);

  add(22, "boundary",
    "Model balances at their snapshot grain and require the consuming query experience to select exactly one eligible snapshot date.",
    doc("account_snapshots", `
datasets:
  - name: account_snapshots
    source: finance.account_snapshots
    primary_key: [account_snapshot_key]
    fields:
      - name: account_snapshot_key
        expression: { sql: account_snapshot_key }
      - name: account_id
        expression: { sql: account_id }
      - name: snapshot_date
        expression: { sql: snapshot_date }
        datatype: Date
        dimension: { is_time: true }
      - name: balance
        expression: { sql: balance }
        datatype: Decimal
    metrics:
      - name: balance
        expression: { sql: "SUM(balance)" }`),
    "Apache Ossie can describe the snapshot field and balance metric, but it has no core mandatory-filter policy that forces a single date.",
    "The consuming runtime must enforce one snapshot or query a prepared as-of relation to prevent summing balances across dates.", [CORE, ROADMAP]);

  add(23, "boundary",
    "Materialize the last eligible observation per entity and reporting period, then expose that additive result.",
    doc("month_end_inventory", `
datasets:
  - name: month_end_inventory
    source: inventory.month_end_inventory
    primary_key: [warehouse_sku_month_key]
    description: One last snapshot per warehouse, SKU, and reporting month
    fields:
      - name: warehouse_sku_month_key
        expression: { sql: warehouse_sku_month_key }
      - name: reporting_month
        expression: { sql: reporting_month }
        datatype: Date
        dimension: { is_time: true }
      - name: on_hand_units
        expression: { sql: on_hand_units }
        datatype: Decimal
    metrics:
      - name: inventory_units
        expression: { sql: "SUM(on_hand_units)" }`),
    "Latest-row selection and period materialization happen upstream; Apache Ossie declares the prepared semantic result.",
    "Test that the prepared source returns one row per entity and period before summing across warehouses.", [CORE, ROADMAP]);

  add(24, "boundary",
    "Expose a prepared running-total relation or let the consuming runtime calculate the post-aggregate window.",
    doc("monthly_running_revenue", `
datasets:
  - name: monthly_running_revenue
    source: finance.monthly_running_revenue
    primary_key: [month]
    description: Prepared monthly series with a deterministic cumulative total
    fields:
      - name: month
        expression: { sql: month }
        datatype: Date
        dimension: { is_time: true }
      - name: monthly_revenue
        expression: { sql: monthly_revenue }
        datatype: Decimal
      - name: running_revenue
        expression: { sql: running_revenue }
        datatype: Decimal
    metrics:
      - name: displayed_running_revenue
        expression: { sql: "MAX(running_revenue)" }`),
    "The expression language contains window syntax, but the core model does not standardize a reusable cumulative metric over the consumer's dynamic result set.",
    "Define the date spine, ordering, reset partition, and filter behavior in the producer or query runtime.", [CORE, EXPR, ROADMAP]);

  add(25, "boundary",
    "Prepare the intended denominator or calculate percent-of-result in the consuming runtime, then describe the resulting field.",
    doc("category_revenue_share", `
datasets:
  - name: category_revenue_share
    source: finance.category_revenue_share
    primary_key: [report_category_key]
    fields:
      - name: report_category_key
        expression: { sql: report_category_key }
      - name: category
        expression: { sql: category }
      - name: revenue
        expression: { sql: revenue }
        datatype: Decimal
      - name: revenue_share
        expression: { sql: revenue_share }
        datatype: Decimal
    metrics:
      - name: revenue
        expression: { sql: "SUM(revenue)" }`),
    "Apache Ossie does not define whether the denominator is the visible result, filtered company total, or another fixed scope.",
    "State the denominator contract explicitly; result-relative shares normally belong to the consuming query or visualization layer.", [CORE, ROADMAP]);

  add(26, "core",
    "Preserve a reporting-presence field and offer a separate coalesced metric only when zero is a useful display convention.",
    doc("reported_activity", `
datasets:
  - name: reported_activity
    source: analytics.reported_activity
    fields:
      - name: activity_value
        expression: { sql: activity_value }
        datatype: Decimal
      - name: was_reported
        expression:
          sql: "activity_value IS NOT NULL"
        datatype: Boolean
    metrics:
      - name: reported_rows
        expression: { sql: "COUNT(activity_value)" }
        datatype: Integer
      - name: activity_zero_filled
        expression: { sql: "SUM(COALESCE(activity_value, 0))" }
        datatype: Decimal`),
    "", "Zero-filling can hide data-quality gaps; keep the presence signal available to consumers and AI tools.", [CORE, EXPR]);

  add(27, "core",
    "Keep gross and return contributions auditable and derive net directly from aggregate expressions with one sign convention.",
    doc("net_sales", `
datasets:
  - name: sales_events
    source: finance.sales_events
    fields:
      - name: gross_sales
        expression: { sql: gross_sales }
        datatype: Decimal
      - name: returns
        expression: { sql: returns }
        datatype: Decimal
    metrics:
      - name: gross_sales
        expression: { sql: "SUM(gross_sales)" }
      - name: returns
        expression: { sql: "SUM(returns)" }
      - name: net_sales
        expression: { sql: "SUM(gross_sales) - SUM(returns)" }`),
    "", "Do not subtract a returns field that already stores negative values; document tax, cancellation, and discount treatment.", [CORE, EXPR]);

  add(28, "core",
    "Declare the dataset's non-null row identity through primary_key and expose every key component as a field.",
    doc("order_lines", `
datasets:
  - name: order_lines
    source: commerce.order_lines
    primary_key: [order_id, line_number]
    unique_keys:
      - [order_id, line_number]
    fields:
      - name: order_id
        expression: { sql: order_id }
      - name: line_number
        expression: { sql: line_number }
        datatype: Integer
      - name: sku
        expression: { sql: sku }`),
    "", "The schema can declare a key but cannot prove it; validate uniqueness and null handling against the source.", [CORE, SCHEMA]);

  add(29, "boundary",
    "Expose every geography level as a field and document the intended drill order, while leaving hierarchy behavior to the consumer.",
    doc("location_geography", `
datasets:
  - name: locations
    source: reference.locations
    primary_key: [location_id]
    description: Drill order is region, market, then location
    fields:
      - name: location_id
        expression: { sql: location_id }
      - name: region
        expression: { sql: region }
        description: Top geography level
      - name: market
        expression: { sql: market }
        description: Child of region
      - name: location_name
        expression: { sql: location_name }
        description: Leaf geography level`),
    "Apache Ossie 0.3.0.dev0 has fields and descriptions but no first-class hierarchy, drill-set, or parent uniqueness construct.",
    "Consuming tools may interpret the documented order differently; validate many-parent and slowly changing geography data upstream.", [CORE, ROADMAP]);

  add(30, "core",
    "Represent each business role as its own logical dataset and connect orders to both roles with distinct relationships.",
    doc("billing_and_shipping_customers", `
datasets:
  - name: orders
    source: commerce.orders
    fields:
      - name: order_id
        expression: { sql: order_id }
      - name: billing_customer_id
        expression: { sql: billing_customer_id }
      - name: shipping_customer_id
        expression: { sql: shipping_customer_id }
  - name: billing_customer
    source: reference.customers
    primary_key: [customer_id]
    fields:
      - name: customer_id
        expression: { sql: customer_id }
      - name: customer_name
        expression: { sql: customer_name }
  - name: shipping_customer
    source: reference.customers
    primary_key: [customer_id]
    fields:
      - name: customer_id
        expression: { sql: customer_id }
      - name: customer_name
        expression: { sql: customer_name }
relationships:
  - name: orders_to_billing_customer
    from: orders
    to: billing_customer
    from_columns: [billing_customer_id]
    to_columns: [customer_id]
  - name: orders_to_shipping_customer
    from: orders
    to: shipping_customer
    from_columns: [shipping_customer_id]
    to_columns: [customer_id]`),
    "", "The duplicated logical datasets intentionally share a physical source; labels and descriptions must make the roles unmistakable.", [CORE]);

  add(31, "boundary",
    "Declare row keys and the many-to-one relationship; require a conforming runtime to preserve measure row identity across fanout.",
    doc("orders_and_lines", `
datasets:
  - name: orders
    source: commerce.orders
    primary_key: [order_id]
    fields:
      - name: order_id
        expression: { sql: order_id }
      - name: revenue
        expression: { sql: revenue }
        datatype: Decimal
    metrics:
      - name: order_revenue
        expression: { sql: "SUM(revenue)" }
  - name: order_lines
    source: commerce.order_lines
    primary_key: [line_id]
    fields:
      - name: line_id
        expression: { sql: line_id }
      - name: order_id
        expression: { sql: order_id }
relationships:
  - name: lines_to_orders
    from: order_lines
    to: orders
    from_columns: [order_id]
    to_columns: [order_id]`),
    "The core model declares keys and a foreign-key relationship; duplication-safe aggregation depends on a runtime implementing Apache Ossie's draft relational semantics.",
    "Dirty keys or an engine that treats the YAML as ordinary joins can still multiply order revenue.", [CORE, REL]);

  add(32, "boundary",
    "Deduplicate repeated headers into an order-grain relation before defining the order total metric.",
    doc("order_headers", `
datasets:
  - name: order_headers
    source: commerce.prepared_order_headers
    primary_key: [order_id]
    description: One validated total per order
    fields:
      - name: order_id
        expression: { sql: order_id }
      - name: order_total
        expression: { sql: order_total }
        datatype: Decimal
    metrics:
      - name: order_total
        expression: { sql: "SUM(order_total)" }`),
    "Apache Ossie has no sum-distinct-by-key construct; SUM(DISTINCT amount) is not equivalent when different orders share the same total.",
    "Reject orders with conflicting repeated totals and publish a separate header dataset whenever possible.", [CORE, EXPR, ROADMAP]);

  add(33, "core",
    "Model the membership bridge as a dataset with one row per membership and connect each foreign key to its unique entity.",
    doc("customer_segment_memberships", `
datasets:
  - name: memberships
    source: marketing.customer_segment_memberships
    primary_key: [customer_id, segment_id]
    fields:
      - name: customer_id
        expression: { sql: customer_id }
      - name: segment_id
        expression: { sql: segment_id }
  - name: customers
    source: reference.customers
    primary_key: [customer_id]
    fields:
      - name: customer_id
        expression: { sql: customer_id }
  - name: segments
    source: reference.segments
    primary_key: [segment_id]
    fields:
      - name: segment_id
        expression: { sql: segment_id }
relationships:
  - name: memberships_to_customers
    from: memberships
    to: customers
    from_columns: [customer_id]
    to_columns: [customer_id]
  - name: memberships_to_segments
    from: memberships
    to: segments
    from_columns: [segment_id]
    to_columns: [segment_id]`),
    "", "A customer legitimately appears once per selected segment; totals across segment rows still require distinct identity or an allocation rule.", [CORE, REL]);

  add(34, "core",
    "Store one allocation row per conversion and channel, require weights to sum to one, and aggregate the allocated contribution.",
    doc("weighted_attribution", `
datasets:
  - name: conversion_attribution
    source: marketing.conversion_attribution
    primary_key: [conversion_id, channel_id]
    fields:
      - name: conversion_id
        expression: { sql: conversion_id }
      - name: channel_id
        expression: { sql: channel_id }
      - name: conversion_value
        expression: { sql: conversion_value }
        datatype: Decimal
      - name: attribution_weight
        expression: { sql: attribution_weight }
        datatype: Decimal
    metrics:
      - name: attributed_value
        expression: { sql: "SUM(conversion_value * attribution_weight)" }
        datatype: Decimal`),
    "", "Weight-sum validation, unattributed conversions, and attribution-model versioning remain producer responsibilities.", [CORE, EXPR]);

  add(35, "boundary",
    "Conform the dimensions and prepare both facts at a compatible reporting grain before exposing comparisons.",
    doc("actual_vs_budget", `
datasets:
  - name: actual_vs_budget
    source: finance.prepared_actual_vs_budget
    primary_key: [month_department_key]
    description: Actual and budget values conformed to month and department
    fields:
      - name: month_department_key
        expression: { sql: month_department_key }
      - name: month
        expression: { sql: month }
        datatype: Date
        dimension: { is_time: true }
      - name: department_id
        expression: { sql: department_id }
      - name: actual
        expression: { sql: actual }
        datatype: Decimal
      - name: budget
        expression: { sql: budget }
        datatype: Decimal
    metrics:
      - name: actual
        expression: { sql: "SUM(actual)" }
      - name: budget
        expression: { sql: "SUM(budget)" }
      - name: variance
        expression: { sql: "SUM(actual) - SUM(budget)" }`),
    "The draft model can name multiple datasets, but canonical multi-fact grain alignment and join planning are not yet standardized.",
    "Currency, calendar, department keys, and aggregation grain must be reconciled before publication.", [CORE, REL, ROADMAP]);

  add(36, "unsupported",
    "Resolve the effective-dated dimension row upstream; core Apache Ossie relationships only express equality between key fields.",
    "",
    "Non-equality joins with effective-from and effective-to predicates are not representable in the 0.3.0.dev0 relationship shape.",
    "Publish a prepared order-to-customer-version key or let a capable semantic runtime own the temporal join.", [CORE, ROADMAP]);

  add(37, "boundary",
    "Flatten the recursive hierarchy into an ancestor-descendant closure relation, then describe that prepared relation.",
    doc("organization_closure", `
datasets:
  - name: organization_closure
    source: hr.organization_closure
    primary_key: [ancestor_id, descendant_id]
    description: Prepared transitive closure with cycle handling completed upstream
    fields:
      - name: ancestor_id
        expression: { sql: ancestor_id }
      - name: descendant_id
        expression: { sql: descendant_id }
      - name: depth
        expression: { sql: depth }
        datatype: Integer
    metrics:
      - name: descendants
        expression: { sql: "COUNT(DISTINCT descendant_id)" }`),
    "Recursive traversal, maximum depth, and cycle detection happen in the producer; Apache Ossie describes the resulting rows.",
    "Regenerate the closure when the organization changes and retain cycle exceptions for audit.", [CORE, ROADMAP]);

  add(38, "boundary",
    "Publish a governed identity-map relation and connect activity to its canonical household key.",
    doc("household_identity", `
datasets:
  - name: orders
    source: commerce.orders
    fields:
      - name: order_id
        expression: { sql: order_id }
      - name: customer_id
        expression: { sql: customer_id }
  - name: identity_map
    source: identity.current_customer_households
    primary_key: [customer_id]
    fields:
      - name: customer_id
        expression: { sql: customer_id }
      - name: household_id
        expression: { sql: household_id }
      - name: confidence
        expression: { sql: confidence }
        datatype: Decimal
    metrics:
      - name: households
        expression: { sql: "COUNT(DISTINCT household_id)" }
relationships:
  - name: orders_to_identity
    from: orders
    to: identity_map
    from_columns: [customer_id]
    to_columns: [customer_id]`),
    "Identity resolution, confidence thresholds, mapping versions, and historical restatement policy are outside the core interchange model.",
    "The published mapping must be unique for the chosen effective view or the relationship contract is invalid.", [CORE, ROADMAP]);

  add(39, "boundary",
    "Compute the governed business timestamp and date in the producer or a named dialect, then expose those fields with explicit temporal types.",
    doc("business_dates", `
datasets:
  - name: sales
    source: commerce.sales_with_business_time
    description: Source relation converts UTC into the approved America/Los_Angeles business clock
    fields:
      - name: sold_at_utc
        expression: { sql: sold_at_utc }
        datatype: DateTimeTz
      - name: business_timestamp
        expression: { sql: business_timestamp }
        datatype: DateTimeTz
        dimension: { is_time: true }
      - name: business_date
        expression: { sql: business_date }
        datatype: Date
        dimension: { is_time: true }`),
    "OSSIE_SQL_2026 does not currently standardize named-time-zone conversion, model query timezone, or user-specific timezone selection.",
    "Test daylight-saving boundaries and never convert a value that is already localized.", [CORE, EXPR, ROADMAP]);

  add(40, "core",
    "Define explicit fiscal-period fields from the source business date and mark the applicable fields as temporal dimensions.",
    doc("offset_fiscal_calendar", `
datasets:
  - name: sales
    source: commerce.sales
    fields:
      - name: order_date
        expression: { sql: order_date }
        datatype: Date
        dimension: { is_time: true }
      - name: fiscal_year
        expression:
          sql: "CASE WHEN MONTH(order_date) = 1 THEN YEAR(order_date) - 1 ELSE YEAR(order_date) END"
        datatype: Integer
        dimension: { is_time: true }
      - name: fiscal_month_number
        expression:
          sql: "CASE WHEN MONTH(order_date) = 1 THEN 12 ELSE MONTH(order_date) - 1 END"
        datatype: Integer
        dimension: { is_time: true }`),
    "", "This encodes a February-start calendar with standard month lengths; it does not implement retail 4-4-5 periods.", [CORE, EXPR]);

  add(41, "boundary",
    "Join facts to a governed retail calendar relation containing the 4-4-5 period and comparable-date fields.",
    doc("retail_calendar_sales", `
datasets:
  - name: sales
    source: commerce.sales
    fields:
      - name: sale_date
        expression: { sql: sale_date }
      - name: revenue
        expression: { sql: revenue }
        datatype: Decimal
    metrics:
      - name: revenue
        expression: { sql: "SUM(revenue)" }
  - name: retail_calendar
    source: reference.retail_calendar
    primary_key: [calendar_date]
    fields:
      - name: calendar_date
        expression: { sql: calendar_date }
        datatype: Date
        dimension: { is_time: true }
      - name: retail_year
        expression: { sql: retail_year }
        datatype: Integer
        dimension: { is_time: true }
      - name: retail_period
        expression: { sql: retail_period }
        datatype: Integer
        dimension: { is_time: true }
      - name: comparable_date
        expression: { sql: comparable_date }
        datatype: Date
relationships:
  - name: sales_to_retail_calendar
    from: sales
    to: retail_calendar
    from_columns: [sale_date]
    to_columns: [calendar_date]`),
    "Calendar construction, 53-week rules, and comparable-day policy are producer responsibilities; first-class calendar semantics remain roadmap work.",
    "Keep the calendar unique by date and version changes that would restate historical comparisons.", [CORE, ROADMAP]);

  add(42, "boundary",
    "Prepare current and comparable-period values or calculate the comparison in the consuming runtime.",
    doc("period_comparisons", `
datasets:
  - name: period_comparisons
    source: finance.period_comparisons
    primary_key: [period_key]
    fields:
      - name: period_key
        expression: { sql: period_key }
      - name: period_start
        expression: { sql: period_start }
        datatype: Date
        dimension: { is_time: true }
      - name: current_revenue
        expression: { sql: current_revenue }
        datatype: Decimal
      - name: prior_year_revenue
        expression: { sql: prior_year_revenue }
        datatype: Decimal
    metrics:
      - name: current_revenue
        expression: { sql: "SUM(current_revenue)" }
      - name: prior_year_revenue
        expression: { sql: "SUM(prior_year_revenue)" }`),
    "The draft model does not define a reusable period-over-period metric that adapts to arbitrary consumer time grains and totals.",
    "Align comparable periods in the prepared source and document fiscal versus calendar behavior.", [CORE, EXPR, ROADMAP]);

  add(43, "boundary",
    "Materialize one rolling-window value per displayed date or calculate the window in the query runtime.",
    doc("daily_active_28d", `
datasets:
  - name: daily_active_28d
    source: product.daily_active_28d
    primary_key: [activity_date]
    description: Prepared trailing 28-day distinct users for every date
    fields:
      - name: activity_date
        expression: { sql: activity_date }
        datatype: Date
        dimension: { is_time: true }
      - name: active_users_28d
        expression: { sql: active_users_28d }
        datatype: Integer
    metrics:
      - name: active_users_28d
        expression: { sql: "MAX(active_users_28d)" }`),
    "A portable reusable rolling distinct requires a date spine and entity-window evaluation not standardized in the core model.",
    "Rolling rows overlap and are non-additive; display the prepared value at its exact date grain.", [CORE, ROADMAP]);

  add(44, "boundary",
    "Use a governed calendar to prepare completed-period flags and comparable-date mappings before defining the reported values.",
    doc("completed_ytd_sales", `
datasets:
  - name: completed_ytd_sales
    source: finance.completed_ytd_sales
    primary_key: [reporting_date]
    fields:
      - name: reporting_date
        expression: { sql: reporting_date }
        datatype: Date
        dimension: { is_time: true }
      - name: current_ytd_revenue
        expression: { sql: current_ytd_revenue }
        datatype: Decimal
      - name: prior_comparable_ytd_revenue
        expression: { sql: prior_comparable_ytd_revenue }
        datatype: Decimal
      - name: is_complete
        expression: { sql: is_complete }
        datatype: Boolean
    metrics:
      - name: current_ytd_revenue
        expression: { sql: "MAX(current_ytd_revenue)" }
      - name: prior_comparable_ytd_revenue
        expression: { sql: "MAX(prior_comparable_ytd_revenue)" }`),
    "The business clock, data-completeness cutoff, and comparison calendar are not managed by Apache Ossie.",
    "Refresh completeness flags with the business cutoff, not merely at midnight.", [CORE, ROADMAP]);

  add(45, "unsupported",
    "Resolve the latest eligible row per entity in the source or consuming runtime before aggregation.",
    "",
    "Apache Ossie core has no query parameter, templated source, or as-of relationship construct that can bind a user-selected date.",
    "A warehouse as-of table, parameter-capable runtime, or generated query must own this behavior.", [CORE, ROADMAP]);

  add(46, "boundary",
    "Materialize cohort membership and activity offset, then expose additive components and the derived retention expression.",
    doc("cohort_retention", `
datasets:
  - name: cohort_activity
    source: product.cohort_activity
    primary_key: [cohort_month, activity_offset, customer_id]
    fields:
      - name: cohort_month
        expression: { sql: cohort_month }
        datatype: Date
        dimension: { is_time: true }
      - name: activity_offset
        expression: { sql: activity_offset }
        datatype: Integer
      - name: customer_id
        expression: { sql: customer_id }
      - name: retained
        expression: { sql: retained }
        datatype: Boolean
    metrics:
      - name: retained_customers
        expression:
          sql: "COUNT(DISTINCT customer_id) FILTER (WHERE retained = TRUE)"
      - name: observed_customers
        expression:
          sql: "COUNT(DISTINCT customer_id)"`),
    "First qualifying events, cohort assignment, and the complete activity-offset spine must be built upstream.",
    "Define reactivation and identity policies before generating the prepared cohort relation.", [CORE, EXPR]);

  add(47, "boundary",
    "Prepare one entity-level record with ordered qualifying timestamps, then expose the reached-step flags and counts.",
    doc("user_funnel", `
datasets:
  - name: user_funnel
    source: product.user_funnel
    primary_key: [user_id]
    fields:
      - name: user_id
        expression: { sql: user_id }
      - name: signed_up_at
        expression: { sql: signed_up_at }
        datatype: DateTimeTz
      - name: activated_at
        expression: { sql: activated_at }
        datatype: DateTimeTz
      - name: purchased_at
        expression: { sql: purchased_at }
        datatype: DateTimeTz
      - name: reached_purchase
        expression:
          sql: "purchased_at IS NOT NULL AND purchased_at >= activated_at AND activated_at >= signed_up_at"
        datatype: Boolean
    metrics:
      - name: signed_up
        expression: { sql: "COUNT(user_id)" }
      - name: purchased
        expression:
          sql: "COUNT(user_id) FILTER (WHERE reached_purchase = TRUE)"`),
    "Event ordering, first-event selection, and conversion windows must be resolved before the entity record is published.",
    "Joining raw event rows cannot guarantee sequence and can multiply users.", [CORE, EXPR]);

  add(48, "core",
    "Define elapsed duration and the SLA predicate directly from source timestamps.",
    doc("support_sla", `
datasets:
  - name: tickets
    source: support.tickets
    fields:
      - name: ticket_id
        expression: { sql: ticket_id }
      - name: opened_at
        expression: { sql: opened_at }
        datatype: DateTimeTz
      - name: first_response_at
        expression: { sql: first_response_at }
        datatype: DateTimeTz
      - name: first_response_hours
        expression:
          sql: "DATEDIFF(hour, opened_at, first_response_at)"
        datatype: Decimal
      - name: met_four_hour_sla
        expression:
          sql: "first_response_at IS NOT NULL AND DATEDIFF(hour, opened_at, first_response_at) <= 4"
        datatype: Boolean
    metrics:
      - name: average_first_response_hours
        expression: { sql: "AVG(first_response_hours)" }
      - name: tickets_meeting_sla
        expression:
          sql: "COUNT(ticket_id) FILTER (WHERE met_four_hour_sla = TRUE)"`),
    "", "Elapsed time is not business time; holidays, working hours, pauses, and missing endpoints need a prepared business-calendar calculation.", [CORE, EXPR]);

  add(49, "core",
    "Model the rate table with a composite unique key, relate facts by currency and date, and define the converted aggregate as a model-scoped metric.",
    doc("currency_conversion", `
datasets:
  - name: orders
    source: commerce.orders
    fields:
      - name: currency_code
        expression: { sql: currency_code }
      - name: rate_date
        expression: { sql: rate_date }
        datatype: Date
      - name: revenue_local
        expression: { sql: revenue_local }
        datatype: Decimal
  - name: fx_rates
    source: finance.fx_daily
    primary_key: [currency_code, rate_date]
    fields:
      - name: currency_code
        expression: { sql: currency_code }
      - name: rate_date
        expression: { sql: rate_date }
        datatype: Date
      - name: usd_rate
        expression: { sql: usd_rate }
        datatype: Decimal
relationships:
  - name: orders_to_fx
    from: orders
    to: fx_rates
    from_columns: [currency_code, rate_date]
    to_columns: [currency_code, rate_date]
metrics:
  - name: revenue_usd
    expression:
      sql: "SUM(orders.revenue_local * fx_rates.usd_rate)"
    datatype: Decimal`),
    "", "Define spot versus average rate, missing-rate behavior, triangulation, and restatement; the rate key must resolve to one row.", [CORE, REL]);

  add(50, "core",
    "Relate each quantity to a unique conversion factor and aggregate the normalized row contribution.",
    doc("unit_conversion", `
datasets:
  - name: inventory
    source: inventory.movements
    fields:
      - name: unit_code
        expression: { sql: unit_code }
      - name: quantity
        expression: { sql: quantity }
        datatype: Decimal
  - name: unit_factors
    source: reference.unit_factors
    primary_key: [unit_code]
    fields:
      - name: unit_code
        expression: { sql: unit_code }
      - name: kg_factor
        expression: { sql: kg_factor }
        datatype: Decimal
relationships:
  - name: inventory_to_unit_factor
    from: inventory
    to: unit_factors
    from_columns: [unit_code]
    to_columns: [unit_code]
metrics:
  - name: quantity_kg
    expression:
      sql: "SUM(inventory.quantity * unit_factors.kg_factor)"
    datatype: Decimal`),
    "", "Conversions that depend on product density, temperature, or packaging require those attributes in the relationship key.", [CORE, REL]);

  add(51, "core",
    "Keep scenario as a field and define stable filtered aggregate expressions for actual, budget, and forecast.",
    doc("planning_scenarios", `
datasets:
  - name: planning
    source: finance.planning
    fields:
      - name: month
        expression: { sql: month }
        datatype: Date
        dimension: { is_time: true }
      - name: cost_center
        expression: { sql: cost_center }
      - name: scenario
        expression: { sql: scenario }
      - name: amount
        expression: { sql: amount }
        datatype: Decimal
    metrics:
      - name: actual
        expression:
          sql: "SUM(amount) FILTER (WHERE scenario = 'ACTUAL')"
      - name: budget
        expression:
          sql: "SUM(amount) FILTER (WHERE scenario = 'BUDGET')"
      - name: forecast
        expression:
          sql: "SUM(amount) FILTER (WHERE scenario = 'FORECAST')"`),
    "", "Facts must share currency and grain. Keep forecast version as a field so new submissions do not silently rewrite prior reporting.", [CORE, EXPR]);

  add(52, "unsupported",
    "Keep what-if inputs and their application in a parameter-capable consuming runtime.",
    "",
    "Apache Ossie core defines static fields and metric expressions; it has no allowed-value query parameter or templating mechanism.",
    "A BI tool, application, or query service must validate the input, apply it, and label the result as simulated.", [CORE, ROADMAP]);

  add(53, "unsupported",
    "Let the consuming interface select among separately governed metrics.",
    "",
    "Apache Ossie core does not define presentation parameters, dynamic field selection, or metric expressions that reference other metrics.",
    "Publish the named metrics independently and implement the switch in the dashboard, agent, or API layer.", [CORE, ROADMAP]);

  add(54, "boundary",
    "Materialize entity-level features, then define an ordered CASE field over those prepared columns.",
    doc("customer_segments", `
datasets:
  - name: customer_features
    source: marketing.customer_features
    primary_key: [customer_id]
    fields:
      - name: customer_id
        expression: { sql: customer_id }
      - name: lifetime_revenue
        expression: { sql: lifetime_revenue }
        datatype: Decimal
      - name: days_since_purchase
        expression: { sql: days_since_purchase }
        datatype: Integer
      - name: customer_segment
        expression:
          sql: "CASE WHEN lifetime_revenue >= 10000 AND days_since_purchase <= 90 THEN 'Strategic' WHEN lifetime_revenue >= 1000 THEN 'Growth' ELSE 'Standard' END"
        datatype: String`),
    "Feature calculation and refresh happen upstream; Apache Ossie can carry the resulting features and deterministic segment expression.",
    "CASE uses first-match order. Version thresholds and avoid joining lifetime features onto transaction rows where they fan out.", [CORE, EXPR]);

  add(55, "unsupported",
    "Carry geographic values as ordinary fields, but rely on a consumer or extension for mapping and spatial semantics.",
    "",
    "Apache Ossie 0.3.0.dev0 has no first-class geographic field type, geometry, spatial relationship, or drill hierarchy.",
    "Coordinates and place names can be exchanged as numeric or string fields, but the core cannot promise map behavior or boundary semantics.", [CORE, ROADMAP]);

  add(56, "unsupported",
    "Enforce row-level security in the warehouse, semantic runtime, or consuming application.",
    "",
    "Apache Ossie core has no user attribute, policy predicate, access-filter, or authorization runtime.",
    "Never treat descriptive metadata or an AI instruction as a security control; enforce and audit the policy in an execution layer.", [CORE, REL, ROADMAP]);

  add(57, "unsupported",
    "Enforce field and metric permissions in the producer, catalog, query runtime, or BI tool.",
    "",
    "Apache Ossie core cannot require a grant for a field or remove it according to the current user.",
    "Hiding a field in a presentation layer is not sufficient; protect the underlying data path and derived values.", [CORE, ROADMAP]);

  add(58, "unsupported",
    "Define mandatory and editable query filters in the consuming query experience.",
    "",
    "The core schema has no default-filter, required-filter, immutable predicate, or conditional-filter construct.",
    "Retention bounds and authorization predicates must be enforced by the runtime; user-editable defaults belong to the UI.", [CORE, ROADMAP]);

  add(59, "boundary",
    "Attach definitions, synonyms, and example questions to the semantic object; define drill navigation in the consuming tool.",
    doc("documented_net_revenue", `
description: Governed finance definitions
ai_context:
  instructions: Use certified finance definitions and preserve return timing
datasets:
  - name: orders
    source: finance.orders
    description: Order-level finance facts owned by Finance Analytics
    ai_context:
      synonyms: [bookings, sales orders]
    fields:
      - name: order_id
        expression: { sql: order_id }
        description: Stable order identifier
      - name: net_revenue
        expression: { sql: net_revenue }
        datatype: Decimal
        description: Gross booked revenue less settled returns and discounts
        ai_context:
          synonyms: [recognized sales]
          examples:
            - Show net revenue by month
    metrics:
      - name: net_revenue
        expression: { sql: "SUM(net_revenue)" }
        datatype: Decimal
        description: Certified net revenue owned by Finance Analytics`),
    "Core descriptions and AI context carry meaning, but owner identity, certification state, and drill paths are not standardized constructs.",
    "Keep definitions current and configure sensitive drill detail in the consuming application.", [CORE, ROADMAP]);

  add(60, "unsupported",
    "Generate repeated metric definitions in the producer or use a platform with inheritance and refinement.",
    "",
    "Apache Ossie core forbids metric-to-metric references and has no inheritance, refinement, include, or reusable metric-template construct.",
    "Converters may repeat equivalent expressions, but the core interchange file cannot guarantee a single reusable definition.", [CORE, ROADMAP]);

  add(61, "boundary",
    "Build the persisted aggregation upstream and expose its smallest reusable additive grain as an Ossie dataset.",
    doc("daily_product_metrics", `
datasets:
  - name: daily_product_metrics
    source: analytics.daily_product_metrics
    primary_key: [day, product_id]
    description: Persisted daily aggregation produced from the event fact
    fields:
      - name: day
        expression: { sql: day }
        datatype: Date
        dimension: { is_time: true }
      - name: product_id
        expression: { sql: product_id }
      - name: revenue
        expression: { sql: revenue }
        datatype: Decimal
      - name: event_count
        expression: { sql: event_count }
        datatype: Integer
    metrics:
      - name: revenue
        expression: { sql: "SUM(revenue)" }
      - name: events
        expression: { sql: "SUM(event_count)" }`),
    "Apache Ossie describes the derived relation but does not create, persist, schedule, or incrementally refresh it.",
    "Do not pre-aggregate non-additive metrics unless the stored state is mergeable for every supported regrouping.", [CORE, ROADMAP]);

  add(62, "unsupported",
    "Configure cache keys, freshness triggers, and invalidation in the query runtime and data platform.",
    "",
    "Apache Ossie core has no cache, datagroup, refresh trigger, or dependency-on-ETL construct.",
    "The surrounding runtime must coordinate semantic-result caching with source freshness.", [CORE, ROADMAP]);

  add(63, "unsupported",
    "Configure aggregate routing and substitution in an execution engine that can prove semantic equivalence.",
    "",
    "Apache Ossie core does not define aggregate tables, matching rules, substitution, or query-planner behavior.",
    "A runtime may consume separately described rollup datasets, but automatic aggregate awareness is not portable core behavior.", [CORE, REL, ROADMAP]);

  add(64, "core",
    "Declare the approximate distinct algorithm in the portable metric expression and describe its accuracy contract.",
    doc("approximate_users", `
datasets:
  - name: events
    source: product.events
    fields:
      - name: user_id
        expression: { sql: user_id }
    metrics:
      - name: approximate_users
        expression:
          sql: "APPROX_COUNT_DISTINCT(user_id)"
        datatype: Integer
        description: Approximate unique users; never use for billing or entitlements`),
    "", "APPROX_COUNT_DISTINCT is recommended rather than required; algorithm and error characteristics depend on the implementing engine.", [CORE, EXPR]);

  add(65, "unsupported",
    "Configure incremental materialization, lookback windows, and late-arrival rebuilding in the data pipeline.",
    "",
    "Apache Ossie core has no persistence schedule, increment key, append policy, or rebuild offset.",
    "After the pipeline updates the relation, the same semantic dataset can continue to describe it.", [CORE, ROADMAP]);

  add(66, "unsupported",
    "Run data assertions in CI or the warehouse alongside structural validation of the Ossie document.",
    "",
    "The core schema and validator check document shape and references; they do not define executable data tests or expected query results.",
    "Keep stable fixtures and semantic regression assertions in the producer repository or runtime test framework.", [SCHEMA, ROADMAP]);

  add(67, "boundary",
    "Publish explicit v1 and v2 metric names during migration and record lifecycle information outside the core document.",
    doc("versioned_net_revenue", `
datasets:
  - name: finance_events
    source: finance.events
    fields:
      - name: gross_revenue
        expression: { sql: gross_revenue }
        datatype: Decimal
      - name: booked_returns
        expression: { sql: booked_returns }
        datatype: Decimal
      - name: settled_returns
        expression: { sql: settled_returns }
        datatype: Decimal
    metrics:
      - name: net_revenue_v1
        expression: { sql: "SUM(gross_revenue) - SUM(booked_returns)" }
        description: Legacy definition using booked returns
      - name: net_revenue_v2
        expression: { sql: "SUM(gross_revenue) - SUM(settled_returns)" }
        description: Current definition using settled returns`),
    "Apache Ossie can exchange both named metrics, but effective dates, deprecation, certification, lineage, and content dependency migration are external governance concerns.",
    "Do not rename v2 over v1 until consumers reconcile historical differences and complete migration.", [CORE, ROADMAP]);

  add(68, "core",
    "Retain result type and model version as fields, then define separate filtered metrics for observed and predicted values.",
    doc("forecast_evaluation", `
datasets:
  - name: demand_results
    source: planning.demand_results
    primary_key: [item_id, target_date, result_type, model_version]
    fields:
      - name: item_id
        expression: { sql: item_id }
      - name: target_date
        expression: { sql: target_date }
        datatype: Date
        dimension: { is_time: true }
      - name: result_type
        expression: { sql: result_type }
      - name: model_version
        expression: { sql: model_version }
      - name: units
        expression: { sql: units }
        datatype: Decimal
    metrics:
      - name: predicted_units
        expression:
          sql: "SUM(units) FILTER (WHERE result_type = 'PREDICTED')"
      - name: observed_units
        expression:
          sql: "SUM(units) FILTER (WHERE result_type = 'OBSERVED')"
      - name: forecast_error
        expression:
          sql: "SUM(units) FILTER (WHERE result_type = 'OBSERVED') - SUM(units) FILTER (WHERE result_type = 'PREDICTED')"`),
    "", "Evaluate the forecast version that existed at the cutoff; predictions and actuals must share item, horizon, unit, and grain.", [CORE, EXPR]);

  window.OSSIE_USE_CASES = cases;
})();
