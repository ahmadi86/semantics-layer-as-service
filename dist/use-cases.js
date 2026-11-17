(() => {
  const catalog = document.body.dataset.catalog || "lookml";
  const libraries = {
    lookml: window.LOOKML_USE_CASES || [],
    ossie: window.OSSIE_USE_CASES || [],
    dbt: window.DBT_SEMANTIC_LAYER_USE_CASES || [],
    snowflake: window.SNOWFLAKE_SEMANTIC_VIEW_USE_CASES || [],
    databricks: window.DATABRICKS_GENIE_USE_CASES || [],
    cube: window.CUBE_USE_CASES || []
  };
  const patterns = libraries[catalog] || [];
  const counterpartUrl = document.body.dataset.counterpartUrl || "";
  const counterpartLabel = document.body.dataset.counterpartLabel || "the companion guide";
  const counterparts = (document.body.dataset.counterparts || "")
    .split(";")
    .map(value => {
      const [label, url] = value.split("|");
      return { label, url };
    })
    .filter(item => item.label && item.url);
  if (!counterparts.length && counterpartUrl) counterparts.push({ label: counterpartLabel, url: counterpartUrl });
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const guideCatalog = [
    { id: "lookml", label: "LookML", url: "/technology/lookml/use-cases/" },
    { id: "ossie", label: "Apache Ossie", url: "/technology/apache-ossie/use-cases/" },
    { id: "dbt", label: "dbt + MetricFlow", url: "/technology/dbt-semantic-layer/use-cases/" },
    { id: "snowflake", label: "Snowflake", url: "/technology/snowflake-semantic-views/use-cases/" },
    { id: "databricks", label: "Databricks", url: "/technology/databricks-genie/use-cases/" },
    { id: "cube", label: "Cube", url: "/technology/cube/use-cases/" }
  ];

  function initGuideSwitcher() {
    const switcher = $("#guideSwitcher");
    if (!switcher) return;

    const button = $("#guideSwitcherButton", switcher);
    const panel = $("#guideSwitcherPanel", switcher);
    const currentLabel = $("#guideSwitcherCurrent", switcher);
    const list = $("#guideSwitcherList", switcher);
    const currentGuide = guideCatalog.find(item => item.id === catalog) || guideCatalog[0];
    if (!button || !panel || !currentLabel || !list) return;

    currentLabel.textContent = currentGuide.label;
    button.setAttribute("aria-label", `Choose use-case guide. Current guide: ${currentGuide.label}`);
    list.innerHTML = guideCatalog.map((item, index) => {
      const current = item.id === currentGuide.id;
      return `<a class="guide-switcher-link" href="${esc(item.url)}"${current ? ' aria-current="page"' : ""}>
        <span class="guide-switcher-index">${String(index + 1).padStart(2, "0")}</span>
        <strong>${esc(item.label)}</strong>
        <small>${current ? "Current guide" : "68 situations"}</small>
      </a>`;
    }).join("");

    const setOpen = (open, returnFocus = false) => {
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
      if (!open && returnFocus) button.focus();
    };

    button.addEventListener("click", () => {
      setOpen(button.getAttribute("aria-expanded") !== "true");
    });
    button.addEventListener("keydown", event => {
      if (event.key !== "ArrowDown") return;
      event.preventDefault();
      setOpen(true);
      $("a", list)?.focus();
    });
    list.addEventListener("click", event => {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("click", event => {
      if (!switcher.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
        event.preventDefault();
        setOpen(false, true);
      }
    });
  }

  initGuideSwitcher();
  const categoryOrder = [...new Set(patterns.map(item => item.category))];
  const catalogConfig = {
    ossie: {
      supportLabels: { core: "Core Ossie", boundary: "Source / runtime boundary", unsupported: "Not supported" },
      unsupportedTitle: "Not supported in Apache Ossie core 0.3.0.dev0"
    },
    dbt: {
      supportLabels: { core: "Native MetricFlow", boundary: "dbt / platform boundary", unsupported: "Not supported" },
      unsupportedTitle: "Not supported in dbt Semantic Layer + MetricFlow"
    },
    snowflake: {
      supportLabels: { core: "Native Semantic View", boundary: "Snowflake / source boundary", unsupported: "Not supported" },
      unsupportedTitle: "Not supported in Snowflake Semantic Views"
    },
    databricks: {
      supportLabels: { core: "Metric view + Genie", boundary: "Unity Catalog / source boundary", unsupported: "Not supported" },
      unsupportedTitle: "Not supported by Genie or metric views"
    },
    cube: {
      supportLabels: { core: "Native Cube", boundary: "Source / consumer boundary", unsupported: "Not supported" },
      unsupportedTitle: "Not supported in Cube"
    }
  }[catalog] || {
    supportLabels: { core: "Native", boundary: "Implementation boundary", unsupported: "Not supported" },
    unsupportedTitle: "Not supported"
  };
  const supportOrder = ["core", "boundary", "unsupported"].filter(value => patterns.some(item => item.support === value));
  const supportLabels = catalogConfig.supportLabels;
  let activeCategory = "All";
  let activeSupport = "All";
  let expanded = false;
  let followedHash = false;

  const search = $("#patternSearch");
  const list = $("#patternList");
  const filters = $("#patternFilters");
  const supportFilters = $("#supportFilters");
  const count = $("#patternCount");
  const empty = $("#patternEmpty");
  const clear = $("#clearPatternFilters");
  const expandButton = $("#expandAll");
  const live = $("#patternLive");

  if (!search || !list || !filters || !count || !empty || !clear || !expandButton || !live) return;

  const searchable = item => [item.title, item.category, item.business, item.rule, item.code, item.caveat, item.mode, item.support, item.supportNote].join(" ").toLowerCase();
  const isFiltered = () => activeCategory !== "All" || activeSupport !== "All" || search.value.trim();

  function renderCategoryFilters() {
    const values = ["All", ...categoryOrder];
    filters.innerHTML = values.map(category => {
      const total = category === "All" ? patterns.length : patterns.filter(item => item.category === category).length;
      return `<button type="button" class="filter-chip${category === activeCategory ? " active" : ""}" data-pattern-category="${esc(category)}">${esc(category)} <span>${total}</span></button>`;
    }).join("");
  }

  function renderSupportFilters() {
    if (!supportFilters) return;
    const values = ["All", ...supportOrder];
    supportFilters.innerHTML = values.map(value => {
      const total = value === "All" ? patterns.length : patterns.filter(item => item.support === value).length;
      const label = value === "All" ? "All support" : supportLabels[value];
      return `<button type="button" class="filter-chip support-filter support-${esc(value)}${value === activeSupport ? " active" : ""}" data-pattern-support="${esc(value)}">${esc(label)} <span>${total}</span></button>`;
    }).join("");
  }

  function docsTemplate(item) {
    if (!item.docs?.length) return "";
    return `<div class="pattern-docs"><span>References</span>${item.docs.map((doc, index) => {
      const url = typeof doc === "string" ? doc : doc.url;
      const label = typeof doc === "string" ? `Official docs${item.docs.length > 1 ? ` ${index + 1}` : ""}` : doc.label;
      return `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label)} ↗</a>`;
    }).join("")}</div>`;
  }

  function codeTemplate(item) {
    if (item.support === "unsupported" || !item.code) {
      return `<div class="pattern-unsupported"><b>${esc(catalogConfig.unsupportedTitle)}</b><p>${esc(item.supportNote || item.caveat)}</p></div>`;
    }
    const boundary = item.support === "boundary" && item.supportNote
      ? `<div class="pattern-boundary"><b>Boundary</b><p>${esc(item.supportNote)}</p></div>`
      : "";
    return `${boundary}<div class="pattern-code-head"><span>Implementation template</span><button type="button" data-copy-pattern="${esc(item.id)}">Copy code</button></div><pre><code>${esc(item.code)}</code></pre>`;
  }

  function patternTemplate(item) {
    const supportClass = item.support ? ` support-${item.support}` : "";
    const prep = /prep|engine|federation|calendar|bridge|identity|cohort|entity|contract|lineage|boundary/i.test(item.mode);
    const compare = counterparts.length ? `<div class="pattern-compares">${counterparts.map(counterpart => `<a class="pattern-compare" href="${esc(counterpart.url)}#${esc(item.id)}">Compare in ${esc(counterpart.label)} →</a>`).join("")}</div>` : "";
    return `<details class="pattern-card${supportClass}" id="${esc(item.id)}"${expanded ? " open" : ""}>
      <summary>
        <span class="pattern-number">${esc(item.id.replace("case-", ""))}</span>
        <div><small>${esc(item.category)}</small><h3>${esc(item.title)}</h3><p>${esc(item.business)}</p></div>
        <span class="pattern-mode${prep ? " prep" : ""}${supportClass}">${esc(item.mode)}</span>
        <span class="pattern-toggle" aria-hidden="true"></span>
      </summary>
      <div class="pattern-detail">
        <div class="pattern-rule"><small>Semantic rule</small><p>${esc(item.rule)}</p></div>
        ${codeTemplate(item)}
        <div class="pattern-caveat"><b>!</b><div><small>${item.support === "unsupported" ? "Why" : "Implementation caveat"}</small><p>${esc(item.caveat)}</p></div></div>
        ${docsTemplate(item)}
        ${compare}
      </div>
    </details>`;
  }

  function apply() {
    const query = search.value.trim().toLowerCase();
    const results = patterns.filter(item =>
      (activeCategory === "All" || item.category === activeCategory) &&
      (activeSupport === "All" || item.support === activeSupport) &&
      (!query || searchable(item).includes(query))
    );
    list.innerHTML = results.map(patternTemplate).join("");
    count.textContent = `${results.length} ${results.length === 1 ? "pattern" : "patterns"}`;
    empty.hidden = results.length > 0;
    clear.hidden = !isFiltered();
    live.textContent = `${results.length} implementation patterns shown`;

    const hash = location.hash.slice(1);
    if (hash && !followedHash) {
      const target = document.getElementById(hash);
      if (target) {
        followedHash = true;
        target.open = true;
        requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
      }
    }
  }

  filters.addEventListener("click", event => {
    const button = event.target.closest("[data-pattern-category]");
    if (!button) return;
    activeCategory = button.dataset.patternCategory;
    renderCategoryFilters();
    apply();
  });

  supportFilters?.addEventListener("click", event => {
    const button = event.target.closest("[data-pattern-support]");
    if (!button) return;
    activeSupport = button.dataset.patternSupport;
    renderSupportFilters();
    apply();
  });

  search.addEventListener("input", apply);
  clear.addEventListener("click", () => {
    activeCategory = "All";
    activeSupport = "All";
    search.value = "";
    renderCategoryFilters();
    renderSupportFilters();
    apply();
    search.focus();
  });
  expandButton.addEventListener("click", () => {
    expanded = !expanded;
    $$(".pattern-card").forEach(card => { card.open = expanded; });
    expandButton.textContent = expanded ? "Collapse all" : "Expand all";
  });

  list.addEventListener("click", async event => {
    const button = event.target.closest("[data-copy-pattern]");
    if (!button) return;
    event.preventDefault();
    const item = patterns.find(pattern => pattern.id === button.dataset.copyPattern);
    if (!item?.code) return;
    try {
      await navigator.clipboard.writeText(item.code);
      button.textContent = "Copied";
      live.textContent = `${item.title} code copied`;
      setTimeout(() => { button.textContent = "Copy code"; }, 1400);
    } catch {
      button.textContent = "Select code to copy";
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { event.preventDefault(); search.focus(); }
  });

  renderCategoryFilters();
  renderSupportFilters();
  apply();
})();
