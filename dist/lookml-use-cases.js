(() => {
  const cases = [];
  const add = (category, title, business, rule, code, caveat, mode = "LookML", docs = []) => cases.push({ id: `case-${String(cases.length + 1).padStart(2, "0")}`, category, title, business, rule, code: code.replaceAll("\\${", "${"), caveat, mode, docs });
  const measureDocs = "https://docs.cloud.google.com/looker/docs/reference/param-measure-types";
  const joinDocs = "https://docs.cloud.google.com/looker/docs/working-with-joins";
  const pdtDocs = "https://docs.cloud.google.com/looker/docs/derived-tables";

  // 01–12 · Sources and table shapes
  add("Sources & table shapes", "Simple transaction table", "Each order row has revenue, quantity, customer, and an order timestamp.", "Declare the row key, expose raw columns as dimensions, and aggregate only measures whose contributions are disjoint at the row grain.", String.raw`view: orders {
  sql_table_name: analytics.orders ;;
  dimension: order_id { primary_key: yes sql: \${TABLE}.order_id ;; }
  dimension: revenue_value { hidden: yes type: number sql: \${TABLE}.revenue ;; }
  measure: gross_revenue { type: sum sql: \${revenue_value} ;; }
  measure: orders { type: count }
}`, "The primary key must truly be unique. If one order repeats across line items, model the line grain or separate the order header.", "LookML", [measureDocs]);

  add("Sources & table shapes", "Wide KPI table", "A location/day row stores gross_revenue, order_count, units, and returns in separate columns.", "Create a named measure per business concept; column width does not guarantee that every metric is additive across every dimension.", String.raw`dimension: revenue_value { hidden: yes type: number sql: \${TABLE}.gross_revenue ;; }
dimension: orders_value  { hidden: yes type: number sql: \${TABLE}.order_count ;; }

measure: gross_revenue { type: sum sql: \${revenue_value} ;; }
measure: orders        { type: sum sql: \${orders_value} ;; }`, "These sums require non-overlapping location/day contributions. Do not sum a wide-table ratio or distinct count merely because it has its own column.", "LookML", [measureDocs]);

  add("Sources & table shapes", "Long KPI table", "Rows contain location_id, day, metric_code, and metric_value.", "Use a discriminator on every named measure so incompatible quantities never flow through one generic sum.", String.raw`dimension: metric_code  { sql: \${TABLE}.metric_code ;; }
dimension: metric_value { hidden: yes type: number sql: \${TABLE}.metric_value ;; }

measure: gross_revenue {
  type: sum
  sql: \${metric_value} ;;
  filters: [metric_code: "GROSS_REVENUE"]
}
measure: units {
  type: sum
  sql: \${metric_value} ;;
  filters: [metric_code: "UNITS"]
}`, "A generic SUM(metric_value) mixes currencies, counts, rates, and units. Filtered measures also assume one row per metric at the declared grain.", "LookML", ["https://docs.cloud.google.com/looker/docs/reference/param-field-filters"]);

  add("Sources & table shapes", "Mixed metric behaviors in one long table", "One metric_code column contains revenue, unique customers, average price, and conversion rate.", "Model each behavior separately. Re-aggregate additive values, recompute ratios from components, and reject stored distinct counts outside their valid scope.", String.raw`measure: revenue { type: sum sql: \${metric_value} ;; filters: [metric_code: "REVENUE"] }
measure: orders  { type: sum sql: \${metric_value} ;; filters: [metric_code: "ORDERS"] }
measure: aov {
  type: number
  sql: 1.0 * \${revenue} / NULLIF(\${orders}, 0) ;;
}

# Do not expose SUM(metric_value) as a universal measure.`, "A metric registry should record aggregation behavior, unit, valid dimensions, and source grain. LookML cannot infer those properties from metric_code.", "LookML + contract", [measureDocs]);

  add("Sources & table shapes", "Numerator and denominator rows", "A campaign/day table stores CLICKS and IMPRESSIONS as separate metric rows.", "Filter the two additive components, aggregate each, then divide the aggregates.", String.raw`measure: clicks {
  type: sum sql: \${metric_value} ;;
  filters: [metric_code: "CLICKS"]
}
measure: impressions {
  type: sum sql: \${metric_value} ;;
  filters: [metric_code: "IMPRESSIONS"]
}
measure: click_through_rate {
  type: number
  sql: 1.0 * \${clicks} / NULLIF(\${impressions}, 0) ;;
  value_format_name: percent_2
}`, "Never average stored daily CTR values unless equal-day weighting is the intended business definition.", "LookML", [measureDocs]);

  add("Sources & table shapes", "CSV files in Amazon S3", "Daily CSV exports land under an S3 prefix and analysts need governed fields in Looker.", "Register files as a SQL relation in Athena/Glue; LookML models the relation, not object-storage paths or parsers.", String.raw`connection: "athena_reporting"

view: sales_csv {
  sql_table_name: lake.sales_csv ;;
  dimension_group: sold { type: time timeframes: [date, week, month] sql: \${TABLE}.sold_at ;; }
  measure: revenue { type: sum sql: \${TABLE}.revenue ;; }
}`, "Define headers, delimiters, types, partitions, credentials, and malformed-row behavior in Athena/Glue. Validate partition discovery and schema drift upstream.", "Source prep + LookML", ["https://docs.cloud.google.com/looker/docs/db-config-amazon-athena"]);

  add("Sources & table shapes", "CSV files in Azure Blob or ADLS", "Finance publishes CSV extracts in ADLS and serves them through Synapse serverless SQL.", "Expose the file query as a stable SQL view, then map LookML to that view.", String.raw`# Synapse view owns OPENROWSET, path, parser, and casts.
view: finance_extract {
  sql_table_name: reporting.sales_csv ;;
  dimension: row_id { primary_key: yes sql: \${TABLE}.row_id ;; }
  measure: net_revenue { type: sum sql: \${TABLE}.net_revenue ;; }
}`, "Connector support and endpoint behavior vary. Keep credentials and file parsing outside LookML; test type inference and file-set consistency.", "Source prep + LookML");

  add("Sources & table shapes", "Parquet, Delta, or Iceberg tables", "Lakehouse facts are stored in an open table format and queried through Databricks, Trino, Athena, or another SQL engine.", "Point LookML at the catalog relation exposed by the active Looker connection.", String.raw`connection: "lakehouse_sql"

view: events {
  sql_table_name: catalog.analytics.events ;;
  dimension: event_id { primary_key: yes sql: \${TABLE}.event_id ;; }
  dimension_group: occurred { type: time timeframes: [raw, date, month] sql: \${TABLE}.occurred_at ;; }
}`, "LookML does not choose the storage reader. Catalog permissions, snapshots, partition pruning, and dialect behavior belong to the SQL engine.", "Engine + LookML");

  add("Sources & table shapes", "JSON objects and repeated arrays", "An event payload contains nested device properties and an array of purchased items.", "Flatten arrays to a declared grain before joining; preserve the event key so repeated records cannot multiply event-level measures.", String.raw`view: event_items {
  derived_table: {
    sql: SELECT e.event_id, e.occurred_at, i.sku, i.quantity
         FROM raw.events e
         CROSS JOIN UNNEST(e.items) AS i ;;
  }
  dimension: item_row_key { primary_key: yes sql: CONCAT(\${TABLE}.event_id, '|', \${TABLE}.sku) ;; }
  measure: units { type: sum sql: \${TABLE}.quantity ;; }
}`, "UNNEST syntax is dialect-specific. If SKU can repeat inside one event, use a real array offset or generated row key—not the illustrative concatenation.", "SQL PDT + LookML", [pdtDocs]);

  add("Sources & table shapes", "Partitioned and unioned sources", "Monthly shards or regional tables share a schema and must appear as one fact set.", "Union with UNION ALL, retain provenance, and ensure partitions do not overlap before defining additive measures.", String.raw`view: unified_sales {
  derived_table: {
    sql: SELECT 'us' AS source_region, * FROM raw.sales_us
         UNION ALL
         SELECT 'eu' AS source_region, * FROM raw.sales_eu ;;
  }
  dimension: source_region { sql: \${TABLE}.source_region ;; }
  dimension: sale_id { primary_key: yes sql: CONCAT(\${source_region}, '|', \${TABLE}.sale_id) ;; }
}`, "UNION removes duplicates and may hide upstream defects; UNION ALL preserves them. Build a composite key when identifiers collide across shards.", "SQL PDT + LookML", [pdtDocs]);

  add("Sources & table shapes", "APIs and spreadsheets", "Targets come from Google Sheets while actuals come from a billing API.", "Ingest both sources to governed warehouse tables, attach freshness metadata, then model them normally.", String.raw`view: monthly_targets {
  sql_table_name: staging.monthly_targets ;;
  dimension: target_key { primary_key: yes sql: CONCAT(\${TABLE}.team_id, '|', \${TABLE}.month) ;; }
  dimension_group: month { type: time timeframes: [month, year] sql: \${TABLE}.month ;; }
  measure: target_revenue { type: sum sql: \${TABLE}.target_revenue ;; }
  dimension_group: loaded { type: time timeframes: [time, date] sql: \${TABLE}.loaded_at ;; }
}`, "LookML is not an ingestion scheduler. Preserve source version, load timestamp, rejected rows, and ownership so users can assess freshness and trust.", "Ingestion + LookML");

  add("Sources & table shapes", "Cross-database analysis", "Orders live in Snowflake and support tickets live in BigQuery.", "Federate or materialize data behind one queryable connection before joining it in an Explore.", String.raw`connection: "federated_analytics"

explore: orders {
  join: support_tickets {
    type: left_outer
    relationship: one_to_many
    sql_on: \${orders.customer_id} = \${support_tickets.customer_id} ;;
  }
}`, "A Looker Explore runs on one model connection; it cannot issue a native join across unrelated Looker connections. Cost, latency, and security follow the federation layer.", "Federation + LookML", [joinDocs]);

  // 13–27 · Aggregation
  add("Aggregation", "Additive values", "Revenue and units can be summed across products, stores, and days.", "Sum the lowest-grain disjoint contribution and never sum a subtotal back into its children.", String.raw`dimension: revenue_value { hidden: yes type: number sql: \${TABLE}.revenue ;; }
measure: revenue { type: sum sql: \${revenue_value} ;; value_format_name: usd }`, "Additivity depends on grain. A source containing both detail rows and subtotal rows will double count unless levels are separated.", "LookML", [measureDocs]);

  add("Aggregation", "Row count versus entity count", "A customer may place many orders; the business asks for both order rows and unique customers.", "Name row counts and entity counts separately so users understand the grain.", String.raw`measure: order_rows { type: count }
measure: customers {
  type: count_distinct
  sql: \${customer_id} ;;
}`, "count_distinct requires the entity identifier at query grain. A null identifier is not counted.", "LookML", [measureDocs]);

  add("Aggregation", "Distinct customers across locations", "C1 visits L1 and L2; L1 has 2 customers, L2 has 2, but their region has 3—not 4.", "Count customer identities at the user's grouping scope and declare location cardinality accurately.", String.raw`measure: customers { type: count_distinct sql: \${customer_id} ;; }

explore: visits {
  join: locations {
    type: left_outer
    relationship: many_to_one
    sql_on: \${visits.location_id} = \${locations.location_id} ;;
  }
}`, "If only L1=2 and L2=2 survive, the exact regional distinct cannot be recovered. Retain IDs, a mergeable sketch, or a separately computed regional result.", "LookML", [measureDocs, joinDocs]);

  add("Aggregation", "Distinct customers across time", "The same customer buys in January and February; monthly counts are 1 and 1, while the two-month count is 1.", "Compute distinctness from customer identity over the selected interval.", String.raw`dimension_group: ordered { type: time timeframes: [date, month, quarter, year] sql: \${TABLE}.ordered_at ;; }
measure: active_customers { type: count_distinct sql: \${customer_id} ;; }`, "Summing monthly distinct counts overstates longer periods. Query cost can grow; consider dialect-supported sketches only when approximation is acceptable.", "LookML", [measureDocs]);

  add("Aggregation", "Precomputed distinct counts", "A feed contains unique_customers by location/day but omits customer IDs.", "Expose the stored count only at its valid grain, or materialize every required rollup independently.", String.raw`dimension: aggregation_level { sql: \${TABLE}.aggregation_level ;; }
measure: customers_at_stored_scope {
  type: sum
  sql: \${TABLE}.unique_customers ;;
  filters: [aggregation_level: "LOCATION_DAY"]
}`, "This measure is not safe across locations or days with overlap. Sum is correct only for disjoint scopes; otherwise gate access or supply higher-grain rows.", "Source contract + LookML");

  add("Aggregation", "Ratios that must be recalculated", "Average order value should respond correctly when stores or months are regrouped.", "Divide aggregate numerator by aggregate denominator.", String.raw`measure: average_order_value {
  type: number
  sql: 1.0 * \${gross_revenue} / NULLIF(\${orders}, 0) ;;
  value_format_name: usd
}`, "An equal-weighted average of store-level AOVs answers a different question. Make zero-denominator behavior explicit.", "LookML", [measureDocs]);

  add("Aggregation", "Weighted averages", "Average selling price must weight each SKU's price by units sold.", "Store or derive additive weighted value and weight, aggregate both, then divide.", String.raw`measure: extended_value { type: sum sql: \${unit_price} * \${units} ;; }
measure: total_units    { type: sum sql: \${units} ;; }
measure: weighted_price {
  type: number
  sql: 1.0 * \${extended_value} / NULLIF(\${total_units}, 0) ;;
}`, "Confirm the weight is non-negative and at the same row grain. Do not weight a value that is already aggregated without understanding its base.", "LookML", [measureDocs]);

  add("Aggregation", "Percentiles", "Operations needs the 90th percentile delivery time, not the average.", "Use the dialect-backed percentile measure over row-level durations.", String.raw`dimension: delivery_hours { type: number sql: \${TABLE}.delivery_hours ;; }
measure: delivery_p90 {
  type: percentile
  percentile: 90
  sql: \${delivery_hours} ;;
}`, "Dialect support and exact/approximate algorithms vary. Fanout may require percentile_distinct and a valid sql_distinct_key.", "LookML", [measureDocs]);

  add("Aggregation", "Minimum and maximum", "A service dashboard needs earliest response and worst latency in the selected group.", "Use min or max over the raw value; do not sum stored extrema.", String.raw`measure: fastest_response_ms { type: min sql: \${response_ms} ;; }
measure: slowest_response_ms { type: max sql: \${response_ms} ;; }`, "The maximum of shard maxima is valid only when shards fully cover the selected set. Null handling follows the database.", "LookML", [measureDocs]);

  add("Aggregation", "Periodic snapshots", "Account balance is captured every night and is additive across accounts, but not across dates.", "Require one snapshot date for point-in-time totals; sum entities within that date.", String.raw`dimension_group: snapshot { type: time timeframes: [date, month] sql: \${TABLE}.snapshot_at ;; }
measure: balance { type: sum sql: \${TABLE}.balance ;; }

explore: account_snapshots {
  always_filter: { filters: [snapshot_date: "1 day"] }
}`, "A relative default is editable and not a true as-of engine. For latest-per-period semantics, prepare one eligible snapshot per entity/period upstream.", "LookML + policy");

  add("Aggregation", "Dimension-dependent additivity", "Inventory may be summed across warehouses but should use the latest observation across time.", "Materialize the last snapshot for each reporting period and entity before summing across entities.", String.raw`view: month_end_inventory {
  derived_table: {
    sql: SELECT * FROM (
      SELECT i.*, ROW_NUMBER() OVER (
        PARTITION BY warehouse_id, sku, DATE_TRUNC('month', snapshot_at)
        ORDER BY snapshot_at DESC) AS rn
      FROM inventory_snapshots i) x WHERE rn = 1 ;;
  }
  measure: on_hand { type: sum sql: \${TABLE}.on_hand ;; }
}`, "DATE_TRUNC syntax is dialect-specific. State the valid additive dimensions in descriptions and test that only one row survives per entity/period.", "SQL PDT + LookML", [pdtDocs]);

  add("Aggregation", "Running totals", "Finance wants cumulative revenue by month in the current result set.", "Build a post-SQL running total from an aggregate measure.", String.raw`measure: revenue { type: sum sql: \${TABLE}.revenue ;; }
measure: cumulative_revenue {
  type: running_total
  sql: \${revenue} ;;
  direction: "column"
}`, "Results depend on sort order and are calculated after SQL. They cannot be filtered like database aggregates or safely referenced by another measure.", "LookML post-SQL", [measureDocs]);

  add("Aggregation", "Share of total", "Each product category should show its fraction of displayed revenue.", "Use a post-SQL percent-of-total measure when the denominator is the displayed result set.", String.raw`measure: revenue { type: sum sql: \${TABLE}.revenue ;; }
measure: revenue_share {
  type: percent_of_total
  sql: \${revenue} ;;
  value_format_name: percent_2
}`, "The denominator changes with filters and displayed rows. For a fixed company total, model an explicit denominator instead.", "LookML post-SQL", [measureDocs]);

  add("Aggregation", "Missing versus zero", "No row may mean 'not reported'; a row with 0 means reported and none occurred.", "Preserve a reporting-presence signal before offering a coalesced convenience measure.", String.raw`measure: reported_rows { type: count }
measure: reported_revenue { type: sum sql: \${TABLE}.revenue ;; }
measure: revenue_or_zero {
  type: number
  sql: COALESCE(\${reported_revenue}, 0) ;;
}
dimension: was_reported { type: yesno sql: \${TABLE}.revenue IS NOT NULL ;; }`, "COALESCE can erase data-quality information. Expose coverage or expected-versus-received checks alongside the metric.", "LookML");

  add("Aggregation", "Gross, returns, and net", "Orders and returns are separate signed business events.", "Keep components separately auditable and derive net from aggregate measures with one sign convention.", String.raw`measure: gross_sales { type: sum sql: \${TABLE}.gross_sales ;; }
measure: returns      { type: sum sql: ABS(\${TABLE}.return_amount) ;; }
measure: net_sales {
  type: number
  sql: \${gross_sales} - \${returns} ;;
}`, "Do not apply ABS if the warehouse already stores returns as negative and net is defined by addition. Document tax, discount, and cancellation treatment.", "LookML");

  // 28–38 · Relationships and grain
  add("Relationships & grain", "Primary keys", "One order row should remain identifiable after joins and symmetric aggregation.", "Declare a non-null, truly unique dimension as primary_key.", String.raw`dimension: order_id {
  primary_key: yes
  hidden: yes
  sql: \${TABLE}.order_id ;;
}`, "Concatenated keys need collision-safe delimiters and null handling. A false primary key can produce silently incorrect aggregates.", "LookML", ["https://docs.cloud.google.com/looker/docs/reference/param-field-primary-key"]);

  add("Relationships & grain", "Region and location hierarchy", "Users drill from region to market to location while retaining one governed geography path.", "Model each level as a dimension and reuse a field set for drill paths.", String.raw`dimension: region   { sql: \${TABLE}.region ;; }
dimension: market   { sql: \${TABLE}.market ;; }
dimension: location { sql: \${TABLE}.location_name ;; }

set: geography_drill { fields: [region, market, location] }
measure: revenue { type: sum sql: \${TABLE}.revenue ;; drill_fields: [geography_drill*] }`, "A field set organizes navigation; it does not validate hierarchy uniqueness. Model slowly changing or many-parent structures explicitly.", "LookML");

  add("Relationships & grain", "Billing versus shipping dimensions", "The same customer table plays two roles on an order.", "Join the same view twice with aliases and distinct labels.", String.raw`explore: orders {
  join: billing_customer {
    from: customers
    view_label: "Billing customer"
    relationship: many_to_one
    sql_on: \${orders.billing_customer_id} = \${billing_customer.customer_id} ;;
  }
  join: shipping_customer {
    from: customers
    view_label: "Shipping customer"
    relationship: many_to_one
    sql_on: \${orders.shipping_customer_id} = \${shipping_customer.customer_id} ;;
  }
}`, "Aliases are separate join instances. Ensure fields and labels make the business role unmistakable.", "Model LookML", [joinDocs]);

  add("Relationships & grain", "Join fanout", "One order joins to many line items; order revenue must not multiply by line count.", "Declare keys and relationship cardinality so symmetric aggregates can protect eligible measures.", String.raw`explore: orders {
  join: order_items {
    type: left_outer
    relationship: one_to_many
    sql_on: \${orders.order_id} = \${order_items.order_id} ;;
  }
}`, "relationship describes cardinality from the base view. It does not fix dirty keys or arbitrary SQL; validate uniqueness and inspect generated SQL.", "Model LookML", [joinDocs]);

  add("Relationships & grain", "Repeated header amounts", "Order total repeats on every item row in a denormalized export.", "Identify the order key and use a distinct aggregate only when each repeated order has one stable value.", String.raw`dimension: order_id { primary_key: no sql: \${TABLE}.order_id ;; }
measure: order_total {
  type: sum_distinct
  sql: \${TABLE}.order_total ;;
  sql_distinct_key: \${order_id} ;;
}`, "If one order_id has different totals, sum_distinct is undefined for the business. Prefer separate order-header and line-item views when possible.", "LookML", [measureDocs]);

  add("Relationships & grain", "Many-to-many bridge", "Customers belong to multiple segments and segments contain multiple customers.", "Model the bridge at one row per membership and expose facts through a deliberate base grain.", String.raw`explore: customer_segment_memberships {
  join: customers {
    relationship: many_to_one
    sql_on: \${customer_segment_memberships.customer_id} = \${customers.customer_id} ;;
  }
  join: segments {
    relationship: many_to_one
    sql_on: \${customer_segment_memberships.segment_id} = \${segments.segment_id} ;;
  }
}`, "A customer counted in two selected segments is legitimately repeated across segment rows. Grand totals need distinct customer IDs or an allocation rule.", "Model LookML", [joinDocs]);

  add("Relationships & grain", "Attribution weights", "One conversion is credited 40% to paid search and 60% to email.", "Store bridge weights that sum to one per conversion and aggregate the allocated contribution.", String.raw`dimension: attribution_weight { type: number sql: \${TABLE}.weight ;; }
dimension: conversion_value  { type: number sql: \${conversions.value} ;; }
measure: attributed_value {
  type: sum
  sql: \${conversion_value} * \${attribution_weight} ;;
}`, "Test weight totals and define behavior for unattributed conversions. Changing attribution models should be versioned, not overwritten silently.", "Bridge + LookML");

  add("Relationships & grain", "Multiple fact tables and aggregation levels", "Actual orders are daily while budgets are monthly by department.", "Conform shared dimensions and aggregate each fact to a compatible grain before combining.", String.raw`view: actual_vs_budget {
  derived_table: {
    explore_source: monthly_actuals {
      column: month { field: monthly_actuals.order_month }
      column: department_id {}
      column: actual_revenue { field: monthly_actuals.revenue }
    }
  }
}
# Join a monthly budget view on month + department, not raw orders.`, "A raw fact-to-fact join multiplies rows. A native derived table may need a warehouse view when both facts must be combined in one durable relation.", "NDT + model", [pdtDocs]);

  add("Relationships & grain", "Historical dimensions (SCD Type 2)", "An order should use the customer's segment that was effective on the order date.", "Join on entity key plus effective-time range.", String.raw`explore: orders {
  join: customer_history {
    relationship: many_to_one
    sql_on: \${orders.customer_id} = \${customer_history.customer_id}
      AND \${orders.ordered_raw} >= \${customer_history.valid_from_raw}
      AND \${orders.ordered_raw} < COALESCE(\${customer_history.valid_to_raw}, '9999-12-31') ;;
  }
}`, "Overlapping history windows break many_to_one. Validate non-overlap and adapt the open-ended timestamp literal to the SQL dialect.", "Model LookML", [joinDocs]);

  add("Relationships & grain", "Recursive organizational hierarchy", "A manager should see rollups for all descendants at any depth.", "Flatten ancestor/descendant paths with a recursive warehouse query, then model the bridge.", String.raw`view: org_closure {
  sql_table_name: analytics.org_closure ;;
  dimension: ancestor_employee_id   { sql: \${TABLE}.ancestor_id ;; }
  dimension: descendant_employee_id { sql: \${TABLE}.descendant_id ;; }
  dimension: depth                  { type: number sql: \${TABLE}.depth ;; }
}
# org_closure is prepared with a recursive CTE or graph process upstream.`, "Recursive CTE syntax and cycle handling are dialect-specific. Enforce acyclic data or record cycle exceptions during preparation.", "Source prep + LookML");

  add("Relationships & grain", "Customer and household identity", "Several customer accounts resolve to one household for reach reporting.", "Join a versioned identity map and count the canonical household key.", String.raw`explore: orders {
  join: identity_map {
    relationship: many_to_one
    sql_on: \${orders.customer_id} = \${identity_map.customer_id} ;;
  }
}
measure: households { type: count_distinct sql: \${identity_map.household_id} ;; }`, "Identity resolution changes over time and can be probabilistic. Version mappings, expose confidence, and decide whether historical reports restate.", "Identity map + LookML");

  // 39–48 · Time and behavior
  add("Time & behavior", "Time zones and business dates", "A sale at 01:00 UTC belongs to the prior Los Angeles business day.", "Set model query timezone and expose converted business timeframes deliberately.", String.raw`# model file
connection: "warehouse"
query_timezone: "America/Los_Angeles"

dimension_group: sold {
  type: time
  timeframes: [raw, date, week, month]
  convert_tz: yes
  sql: \${TABLE}.sold_at_utc ;;
}`, "Database, connection, application, and user timezones interact. Test daylight-saving transitions and do not convert an already-local timestamp twice.", "Model + view LookML");

  add("Time & behavior", "Offset fiscal calendar", "The fiscal year starts in February and standard month lengths still apply.", "Set fiscal_month_offset in the model and expose fiscal timeframes.", String.raw`# model file: February is one month after January
fiscal_month_offset: 1

dimension_group: booked {
  type: time
  timeframes: [date, month, fiscal_quarter, fiscal_year]
  sql: \${TABLE}.booked_at ;;
}`, "An offset calendar does not implement 4-4-5 retail weeks. Verify the organization's fiscal-year naming convention.", "Model + view LookML");

  add("Time & behavior", "NRF or 4-4-5 calendar", "Retail periods follow 4, 4, and 5 weeks with occasional 53rd weeks.", "Join a governed date dimension containing retail week, period, quarter, and comparable-day keys.", String.raw`explore: sales {
  join: retail_calendar {
    relationship: many_to_one
    sql_on: \${sales.sold_date} = \${retail_calendar.calendar_date} ;;
  }
}
dimension: retail_period { sql: \${TABLE}.retail_period_label ;; sort_field: retail_period_index }
dimension: comparable_date { type: date sql: \${TABLE}.prior_year_comparable_date ;; }`, "Do not emulate 4-4-5 with fiscal_month_offset. Calendar ownership, 53-week rules, and restatement policy must be explicit.", "Calendar table + LookML");

  add("Time & behavior", "Period-over-period comparison", "Users need current revenue and the previous year's comparable period.", "Use a period_over_period measure based on an aggregate and a compatible time field.", String.raw`measure: revenue_last_year {
  type: period_over_period
  based_on: revenue
  based_on_time: ordered_month
  period: year
  kind: previous
  value_to_date: no
}`, "Requires the new LookML runtime and supported dialect. PoP measures have limitations with totals, aggregate awareness, rolling calculations, and mixed fiscal/non-fiscal timeframes.", "LookML", ["https://docs.cloud.google.com/looker/docs/period-over-period"]);

  add("Time & behavior", "Rolling window", "Product wants trailing 28-day active users for every displayed day.", "Precompute the date spine and window at the intended entity/date grain when the measure must be reusable and filterable.", String.raw`view: daily_active_28d {
  sql_table_name: analytics.daily_active_28d ;;
  dimension_group: activity { type: time timeframes: [date] sql: \${TABLE}.activity_date ;; }
  measure: active_users_28d { type: max sql: \${TABLE}.active_users_28d ;; }
}`, "A post-SQL running total is not a distinct rolling window. Overlapping window rows are non-additive; max is valid here only because one stored value exists per displayed date.", "Source prep + LookML");

  add("Time & behavior", "YTD and completed periods", "Executives compare current YTD only with the same completed days last year.", "Use a calendar dimension with completed-period flags and comparable-date mappings.", String.raw`measure: revenue_completed_ytd {
  type: sum
  sql: \${sales.revenue_value} ;;
  filters: [calendar.is_in_completed_ytd: "yes"]
}
measure: revenue_prior_completed_ytd {
  type: sum
  sql: \${sales.revenue_value} ;;
  filters: [calendar.is_in_prior_completed_ytd: "yes"]
}`, "Relative flags must refresh with the business clock and data-completeness cutoff—not merely midnight. A calendar join is required.", "Calendar + LookML");

  add("Time & behavior", "As-of balances", "A user selects 31 March and expects each account's latest balance on or before that date.", "Resolve the latest eligible row per entity before aggregation, using a parameterized PDT or a warehouse as-of table.", String.raw`filter: as_of_date { type: date }

derived_table: {
  sql: SELECT * FROM account_snapshots s
       WHERE s.snapshot_at = (
         SELECT MAX(s2.snapshot_at) FROM account_snapshots s2
         WHERE s2.account_id = s.account_id
         AND {% condition as_of_date %} s2.snapshot_at {% endcondition %}) ;;
}
measure: balance { type: sum sql: \${TABLE}.balance ;; }`, "Templated filters can change caching and SQL shape. The illustrative correlated query may be expensive; prefer an optimized warehouse model for large histories.", "Templated SQL + LookML");

  add("Time & behavior", "Cohorts and retention", "Customers are grouped by first-purchase month and tracked for return activity by months since acquisition.", "Materialize cohort membership and activity offset, then calculate retained users over cohort size.", String.raw`dimension: cohort_month { type: date_month sql: \${TABLE}.cohort_month ;; }
dimension: months_since_cohort { type: number sql: \${TABLE}.months_since_cohort ;; }
measure: retained_customers { type: count_distinct sql: \${customer_id} ;; }
measure: cohort_size { type: max sql: \${TABLE}.cohort_size ;; }
measure: retention_rate { type: number sql: 1.0 * \${retained_customers} / NULLIF(\${cohort_size}, 0) ;; }`, "cohort_size is non-additive across cohort rows; max assumes the value repeats consistently inside each cohort. Define reactivation and identity rules.", "Cohort table + LookML");

  add("Time & behavior", "Funnels", "A user moves from signup to activation to purchase, and steps must occur in order.", "Build one entity-level funnel record with ordered step timestamps before exposing conversion measures.", String.raw`dimension: reached_activation { type: yesno sql: \${activated_at_raw} >= \${signed_up_at_raw} ;; }
dimension: reached_purchase { type: yesno sql: \${purchased_at_raw} >= \${activated_at_raw} ;; }
measure: signups   { type: count_distinct sql: \${user_id} ;; }
measure: activated { type: count_distinct sql: \${user_id} ;; filters: [reached_activation: "yes"] }
measure: purchased { type: count_distinct sql: \${user_id} ;; filters: [reached_purchase: "yes"] }`, "Prepare first qualifying timestamps and enforce window rules upstream. Event-row joins can overcount and cannot guarantee ordering by themselves.", "Entity table + LookML");

  add("Time & behavior", "Durations and SLA calculations", "Support tracks hours from ticket open to first response and whether it met a 4-hour SLA.", "Use a duration group for units and a separate yes/no rule for the SLA boundary.", String.raw`dimension_group: first_response {
  type: duration
  intervals: [minute, hour, day]
  sql_start: \${TABLE}.opened_at ;;
  sql_end: \${TABLE}.first_response_at ;;
}
dimension: met_first_response_sla {
  type: yesno
  sql: \${first_response_minutes} <= 240 ;;
}`, "Elapsed time is not business time. Holidays, working hours, paused states, and missing endpoints require a calendar-aware upstream calculation.", "LookML");

  // 49–55 · Business transformations
  add("Business transformations", "Currency conversion", "Orders in EUR, GBP, and USD must roll up in a selected reporting currency.", "Join the governed FX rate by currency, rate date, and rate type; aggregate converted row values.", String.raw`explore: orders {
  join: fx_daily {
    relationship: many_to_one
    sql_on: \${orders.currency_code} = \${fx_daily.from_currency}
      AND \${orders.ordered_date} = \${fx_daily.rate_date}
      AND \${fx_daily.to_currency} = 'USD' ;;
  }
}
measure: revenue_usd { type: sum sql: \${revenue_local} * \${fx_daily.rate} ;; }`, "Define spot versus average rate, missing-rate behavior, triangulation, and restatement. The join must return at most one rate per fact row.", "Join + LookML");

  add("Business transformations", "Units of measure", "Inventory arrives in kilograms, pounds, and tonnes but reports in kilograms.", "Join a versioned conversion table and aggregate the normalized base quantity.", String.raw`explore: inventory_movements {
  join: unit_conversion {
    relationship: many_to_one
    sql_on: \${inventory_movements.unit_code} = \${unit_conversion.from_unit}
      AND \${unit_conversion.to_unit} = 'KG' ;;
  }
}
measure: quantity_kg { type: sum sql: \${quantity} * \${unit_conversion.factor} ;; }`, "Some conversions depend on product density or temperature and are not universal factors. Include item context where required.", "Join + LookML");

  add("Business transformations", "Actual, budget, and forecast", "A planning report compares three scenarios across month and cost center.", "Keep scenario as a dimension and define named filtered measures for stable comparisons.", String.raw`dimension: scenario { sql: \${TABLE}.scenario ;; }
measure: actual   { type: sum sql: \${TABLE}.amount ;; filters: [scenario: "ACTUAL"] }
measure: budget   { type: sum sql: \${TABLE}.amount ;; filters: [scenario: "BUDGET"] }
measure: forecast { type: sum sql: \${TABLE}.amount ;; filters: [scenario: "FORECAST"] }
measure: actual_vs_budget { type: number sql: \${actual} - \${budget} ;; }`, "Facts must share a compatible grain and currency. Version forecasts so a new submission does not silently rewrite old reporting.", "LookML");

  add("Business transformations", "What-if parameter", "A planner changes a discount assumption without modifying source data.", "Use an allowed-value parameter and apply it in a clearly labeled simulated measure.", String.raw`parameter: discount_scenario {
  type: unquoted
  allowed_value: { label: "0%" value: "0" }
  allowed_value: { label: "5%" value: "0.05" }
  allowed_value: { label: "10%" value: "0.10" }
}
measure: simulated_revenue {
  type: number
  sql: \${gross_revenue} * (1 - {% parameter discount_scenario %}) ;;
}`, "Parameters are query inputs, not stored plans. Restrict values to avoid injection and distinguish simulations visually from observed metrics.", "LookML + Liquid");

  add("Business transformations", "Selectable metric", "A dashboard tile switches between revenue, orders, and units.", "Use a controlled unquoted parameter and a type:number measure that selects existing aggregate measures.", String.raw`parameter: metric_picker {
  type: unquoted
  allowed_value: { label: "Revenue" value: "revenue" }
  allowed_value: { label: "Orders" value: "orders" }
  allowed_value: { label: "Units" value: "units" }
}
measure: selected_metric {
  type: number
  sql: {% if metric_picker._parameter_value == 'orders' %} \${orders}
       {% elsif metric_picker._parameter_value == 'units' %} \${units}
       {% else %} \${revenue} {% endif %} ;;
}`, "Selected metrics may have different formats and valid dimensions. One generic field can obscure meaning; keep named measures available for governed reuse.", "LookML + Liquid");

  add("Business transformations", "Customer segments", "Customers are grouped into strategic tiers using lifetime revenue and activity.", "Materialize entity-level features, then define mutually exclusive, ordered segment rules.", String.raw`dimension: customer_segment {
  type: string
  case: {
    when: { sql: \${lifetime_revenue} >= 100000 ;; label: "Enterprise" }
    when: { sql: \${lifetime_revenue} >= 10000  ;; label: "Growth" }
    else: "Core"
  }
}`, "CASE uses first-match order. Version thresholds and avoid recalculating lifetime features on a transaction-row join that can fan out.", "Entity features + LookML");

  add("Business transformations", "Geographic dimensions", "Users map stores and drill through country, region, city, postal code, and coordinates.", "Assign semantic geo types and expose a stable location object.", String.raw`dimension: country { type: country sql: \${TABLE}.country_code ;; }
dimension: city    { type: string  sql: \${TABLE}.city ;; }
dimension: postal_code { type: zipcode sql: \${TABLE}.postal_code ;; }
dimension: location {
  type: location
  sql_latitude: \${TABLE}.latitude ;;
  sql_longitude: \${TABLE}.longitude ;;
}`, "Geocoding quality, privacy, postal-code reuse, and changing boundaries are data-governance concerns. Coordinates should represent the intended object, not an arbitrary centroid.", "LookML");

  // 56–60 · Governance
  add("Governance", "Row-level security", "Regional managers may query only rows assigned to their region.", "Apply an Explore access_filter backed by a controlled user attribute.", String.raw`explore: orders {
  access_filter: {
    field: orders.region_code
    user_attribute: allowed_region
  }
}`, "Secure the user attribute and test all roles, scheduled deliveries, APIs, and service accounts. Do not rely on a dashboard filter for security.", "Model LookML", ["https://docs.cloud.google.com/looker/docs/reference/param-explore-access-filter"]);

  add("Governance", "Field-level permissions", "Only finance users may see margin and cost measures.", "Define an access grant from a user attribute and require it on sensitive fields.", String.raw`access_grant: can_view_margin {
  user_attribute: department
  allowed_values: ["finance"]
}
measure: gross_margin {
  type: sum
  sql: \${TABLE}.gross_margin ;;
  required_access_grants: [can_view_margin]
}`, "Hiding a field is not security. Protect underlying warehouse access and audit alternate paths that could derive the same sensitive value.", "LookML", ["https://docs.cloud.google.com/looker/docs/reference/param-model-access-grant"]);

  add("Governance", "Mandatory versus editable filters", "Every query must stay inside the retention window, while the default status should remain editable.", "Use always_filter for the enforced bound and conditionally_filter for a default that disappears when users choose an alternative field.", String.raw`explore: events {
  always_filter: { filters: [events.occurred_date: "12 months"] }
  conditionally_filter: {
    filters: [events.status: "complete"]
    unless: [events.status, events.event_id]
  }
}`, "always_filter values can still be changed by users; it guarantees a filter exists, not an immutable predicate. Use access_filter or sql_always_where for non-editable enforcement.", "Model LookML");

  add("Governance", "Definitions and drill paths", "A metric needs business meaning, owner context, and a useful route from summary to detail.", "Put definition metadata and curated drills beside the field.", String.raw`measure: net_revenue {
  label: "Net revenue"
  description: "Captured sales less posted returns; excludes tax. Owner: Finance Analytics."
  type: number
  sql: \${gross_sales} - \${returns} ;;
  drill_fields: [order_id, ordered_date, customer_name, net_revenue]
}`, "Descriptions are part of the contract. Keep ownership and change notes current; do not expose sensitive detail through a drill path.", "LookML");

  add("Governance", "Reusable metric definitions", "Several Explores need the same audited revenue measure with small presentation differences.", "Define a base view once and extend or refine it instead of copying SQL.", String.raw`view: financial_metrics_base {
  measure: net_revenue { type: sum sql: \${TABLE}.net_revenue ;; }
}

view: orders {
  extends: [financial_metrics_base]
  sql_table_name: analytics.orders ;;
}

view: +orders {
  measure: net_revenue { value_format_name: usd }
}`, "Inheritance can become difficult to trace. Keep the chain shallow, validate compiled fields, and use refinements for intentional project-level changes.", "LookML composition");

  // 61–68 · Performance and evolution
  add("Performance & evolution", "Derived aggregation", "A billion-row event table repeatedly serves daily product metrics.", "Build a persisted derived table at the smallest reusable grain and expose only additive components.", String.raw`view: daily_product_metrics {
  derived_table: {
    sql: SELECT event_date, product_id,
                SUM(revenue) AS revenue, COUNT(*) AS events
         FROM analytics.events GROUP BY 1, 2 ;;
    datagroup_trigger: events_freshness
  }
  dimension: daily_product_key { primary_key: yes sql: CONCAT(\${TABLE}.event_date, '|', \${TABLE}.product_id) ;; }
  measure: revenue { type: sum sql: \${TABLE}.revenue ;; }
}`, "Do not pre-aggregate non-additive metrics without mergeable state. The example key and SQL functions must be adapted to the dialect.", "SQL PDT + LookML", [pdtDocs]);

  add("Performance & evolution", "Caching and refresh", "Explore cache and PDTs should refresh after the warehouse ETL completes.", "Tie cache and persistence to one datagroup signal.", String.raw`datagroup: orders_freshness {
  sql_trigger: SELECT MAX(batch_id) FROM analytics.etl_audit WHERE pipeline = 'orders' ;;
  max_cache_age: "24 hours"
}

explore: orders { persist_with: orders_freshness }

derived_table: {
  explore_source: orders { column: order_id {} }
  datagroup_trigger: orders_freshness
}`, "The trigger query must be cheap, stable, and permissioned. max_cache_age is a safety bound, not proof that ETL succeeded.", "Model + PDT", ["https://docs.cloud.google.com/looker/docs/reference/param-model-datagroup"]);

  add("Performance & evolution", "Aggregate awareness", "Common monthly region queries should route to a smaller rollup automatically.", "Define a persisted aggregate_table containing the exact dimensions and measures Looker may substitute.", String.raw`explore: orders {
  aggregate_table: monthly_region {
    query: {
      dimensions: [ordered_month, region]
      measures: [revenue, orders]
    }
    materialization: { datagroup_trigger: orders_freshness }
  }
}`, "The aggregate must preserve query semantics. Unsupported fields, filters, or post-SQL measures can force the base table; inspect which table each query uses.", "Model LookML", ["https://docs.cloud.google.com/looker/docs/reference/param-explore-aggregate-table"]);

  add("Performance & evolution", "Approximate distinct optimization", "A dashboard accepts approximate unique-user counts to reduce warehouse cost.", "Opt an eligible count_distinct measure into approximate aggregate-table optimization.", String.raw`measure: users {
  type: count_distinct
  sql: \${user_id} ;;
  allow_approximate_optimization: yes
}`, "Approximation is dialect- and aggregate-table-dependent. Document expected error and never use it where exact billing, compliance, or entitlement counts are required.", "LookML", ["https://docs.cloud.google.com/looker/docs/reference/param-field-allow-approximate-optimization"]);

  add("Performance & evolution", "Incremental updates", "A large daily PDT should append new data and rebuild three days for late events.", "Use a time-based increment key, late-arrival offset, and an independent persistence trigger.", String.raw`view: flights_incremental {
  derived_table: {
    explore_source: flights {
      column: id {}
      column: departure_date {}
      column: carrier {}
    }
    increment_key: "departure_date"
    increment_offset: 3
    datagroup_trigger: flights_freshness
  }
  dimension: id { primary_key: yes type: number }
  dimension: departure_date { type: date }
}`, "Supported dialects only. The offset is measured in increment-key periods; choose it from observed lateness and remember the trigger controls when increments run.", "Incremental NDT", ["https://docs.cloud.google.com/looker/docs/reference/param-view-increment-key"]);

  add("Performance & evolution", "Regression tests", "A finance definition should fail CI if historical revenue changes unexpectedly.", "Create a small explore_source query and a yes/no assert.", String.raw`test: historic_revenue_is_accurate {
  explore_source: orders {
    column: total_revenue { field: orders.total_revenue }
    filters: [orders.created_date: "2024"]
  }
  assert: revenue_is_expected_value {
    expression: \${orders.total_revenue} = 204259 ;;
  }
}`, "Use stable fixtures or approved historical windows. Exact-value tests on mutable data will create noise; run model, SQL, content, and assert validation in CI.", "LookML data test", ["https://docs.cloud.google.com/looker/docs/ci-assert-validator"]);

  add("Performance & evolution", "Metric versioning", "Finance changes net revenue from booked returns to settled returns without erasing prior logic.", "Publish an explicit new field, preserve the prior version during migration, and label both definitions.", String.raw`measure: net_revenue_v1 {
  label: "Net revenue (legacy—booked returns)"
  description: "Deprecated after FY2026 close."
  type: number sql: \${gross_sales} - \${booked_returns} ;;
}
measure: net_revenue_v2 {
  label: "Net revenue"
  description: "v2: gross sales less settled returns. Effective FY2027."
  type: number sql: \${gross_sales} - \${settled_returns} ;;
}`, "Renaming a field is not versioning. Track effective dates, content dependencies, owners, and reconciliation before hiding the old field.", "LookML contract");

  add("Performance & evolution", "Predictions versus observed outcomes", "A table contains forecast demand and later actual demand for the same item/date.", "Retain scenario and model-version dimensions; expose forecast and actual as distinct measures.", String.raw`dimension: result_type   { sql: \${TABLE}.result_type ;; }
dimension: model_version { sql: \${TABLE}.model_version ;; }
measure: observed_units  { type: sum sql: \${TABLE}.units ;; filters: [result_type: "OBSERVED"] }
measure: predicted_units { type: sum sql: \${TABLE}.units ;; filters: [result_type: "PREDICTED"] }
measure: forecast_error  { type: number sql: \${observed_units} - \${predicted_units} ;; }`, "Compare the forecast version that existed at the evaluation cutoff, not a backfilled model. Actuals and predictions must share item, horizon, unit, and grain.", "LookML + lineage");

  window.LOOKML_USE_CASES = cases;
})();
