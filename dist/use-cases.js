(() => {
  const patterns = window.LOOKML_USE_CASES || [];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const categoryOrder = [...new Set(patterns.map(item => item.category))];
  let activeCategory = "All";
  let expanded = false;

  const search = $("#patternSearch");
  const list = $("#patternList");
  const filters = $("#patternFilters");
  const count = $("#patternCount");
  const empty = $("#patternEmpty");
  const clear = $("#clearPatternFilters");
  const expandButton = $("#expandAll");
  const live = $("#patternLive");

  const searchable = item => [item.title, item.category, item.business, item.rule, item.code, item.caveat, item.mode].join(" ").toLowerCase();

  function renderFilters() {
    const values = ["All", ...categoryOrder];
    filters.innerHTML = values.map(category => {
      const total = category === "All" ? patterns.length : patterns.filter(item => item.category === category).length;
      return `<button type="button" class="filter-chip${category === activeCategory ? " active" : ""}" data-pattern-category="${esc(category)}">${esc(category)} <span>${total}</span></button>`;
    }).join("");
  }

  function patternTemplate(item, index) {
    const docs = item.docs?.length ? `<div class="pattern-docs"><span>Reference</span>${item.docs.map((url, docIndex) => `<a href="${esc(url)}" target="_blank" rel="noreferrer">Official docs${item.docs.length > 1 ? ` ${docIndex + 1}` : ""} ↗</a>`).join("")}</div>` : "";
    const prep = /prep|engine|federation|calendar|bridge|identity|cohort|entity|contract|lineage/i.test(item.mode);
    return `<details class="pattern-card" id="${esc(item.id)}"${expanded ? " open" : ""}>
      <summary>
        <span class="pattern-number">${String(index + 1).padStart(2, "0")}</span>
        <div><small>${esc(item.category)}</small><h3>${esc(item.title)}</h3><p>${esc(item.business)}</p></div>
        <span class="pattern-mode${prep ? " prep" : ""}">${esc(item.mode)}</span>
        <span class="pattern-toggle" aria-hidden="true"></span>
      </summary>
      <div class="pattern-detail">
        <div class="pattern-rule"><small>Semantic rule</small><p>${esc(item.rule)}</p></div>
        <div class="pattern-code-head"><span>Implementation template</span><button type="button" data-copy-pattern="${esc(item.id)}">Copy code</button></div>
        <pre><code>${esc(item.code)}</code></pre>
        <div class="pattern-caveat"><b>!</b><div><small>Implementation caveat</small><p>${esc(item.caveat)}</p></div></div>
        ${docs}
      </div>
    </details>`;
  }

  function apply() {
    const query = search.value.trim().toLowerCase();
    const results = patterns.filter(item => (activeCategory === "All" || item.category === activeCategory) && (!query || searchable(item).includes(query)));
    list.innerHTML = results.map((item, index) => patternTemplate(item, index)).join("");
    count.textContent = `${results.length} ${results.length === 1 ? "pattern" : "patterns"}`;
    empty.hidden = results.length > 0;
    clear.hidden = activeCategory === "All" && !query;
    live.textContent = `${results.length} implementation patterns shown`;

    const hash = location.hash.slice(1);
    if (hash) {
      const target = document.getElementById(hash);
      if (target) { target.open = true; requestAnimationFrame(() => target.scrollIntoView({ block: "start" })); }
    }
  }

  filters.addEventListener("click", event => {
    const button = event.target.closest("[data-pattern-category]");
    if (!button) return;
    activeCategory = button.dataset.patternCategory;
    renderFilters();
    apply();
  });

  search.addEventListener("input", apply);
  clear.addEventListener("click", () => { activeCategory = "All"; search.value = ""; renderFilters(); apply(); search.focus(); });
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
    if (!item) return;
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

  renderFilters();
  apply();
})();
