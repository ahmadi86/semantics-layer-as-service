(() => {
  const tech = window.SEMANTIC_TECH || [];
  const meta = window.ATLAS_META || {};
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const profileUrl = slug => `/technology/${encodeURIComponent(slug)}/`;
  const maturityRank = { Established: 3, Scaling: 2, Emerging: 1 };

  $$('[data-reviewed]').forEach(el => el.textContent = `Reviewed ${meta.reviewed || ""}`);
  $$('[data-methodology]').forEach(el => el.textContent = meta.methodology || "");

  const getShortlist = () => {
    try { return JSON.parse(localStorage.getItem("sla-shortlist") || "[]").filter(slug => tech.some(item => item.slug === slug)).slice(0, 3); }
    catch { return []; }
  };
  let shortlist = getShortlist();
  const saveShortlist = () => {
    try { localStorage.setItem("sla-shortlist", JSON.stringify(shortlist)); } catch {}
    updateShortlistUI();
  };

  function updateShortlistUI() {
    $$('[data-shortlist-count]').forEach(el => el.textContent = shortlist.length);
    $$('.shortlist-check').forEach(button => {
      const selected = shortlist.includes(button.dataset.slug);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = selected ? '✓' : '+';
      button.setAttribute('aria-label', `${selected ? 'Remove' : 'Add'} ${button.dataset.name} ${selected ? 'from' : 'to'} shortlist`);
    });
    const items = $('#shortlistItems');
    if (!items) return;
    if (!shortlist.length) {
      items.innerHTML = '<div class="shortlist-empty"><b>No candidates yet.</b><p>Add up to three technologies from the directory to compare their fit.</p></div>';
    } else {
      items.innerHTML = shortlist.map((slug, index) => {
        const item = tech.find(entry => entry.slug === slug);
        return `<div class="shortlist-item"><span>0${index + 1}</span><div><b>${esc(item.name)}</b><small>${esc(item.category)}</small></div><button type="button" data-remove-shortlist="${esc(slug)}" aria-label="Remove ${esc(item.name)}">×</button></div>`;
      }).join('');
    }
    const compare = $('#compareButton');
    if (compare) { compare.disabled = shortlist.length < 2; compare.textContent = shortlist.length < 2 ? 'Select at least two' : `Compare ${shortlist.length} technologies`; }
  }

  function toggleShortlist(slug) {
    if (shortlist.includes(slug)) shortlist = shortlist.filter(value => value !== slug);
    else if (shortlist.length < 3) shortlist.push(slug);
    else { openShortlist(); flashMessage('The comparison holds three technologies. Remove one to add another.'); return; }
    saveShortlist();
  }

  function flashMessage(message) {
    let live = $('#atlasLive');
    if (!live) { live = document.createElement('div'); live.id = 'atlasLive'; live.className = 'sr-only'; live.setAttribute('aria-live', 'polite'); document.body.append(live); }
    live.textContent = message;
  }

  function openShortlist() {
    const panel = $('#shortlistPanel'); const scrim = $('#scrim');
    if (!panel) return;
    panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
    if (scrim) scrim.hidden = false;
    $('[data-close-shortlist]', panel)?.focus();
  }
  function closeShortlist() {
    const panel = $('#shortlistPanel'); const scrim = $('#scrim');
    panel?.classList.remove('open'); panel?.setAttribute('aria-hidden', 'true');
    if (scrim) scrim.hidden = true;
  }

  function renderComparison() {
    const selected = shortlist.map(slug => tech.find(item => item.slug === slug)).filter(Boolean);
    if (selected.length < 2) return;
    const row = (label, render) => `<tr><td>${esc(label)}</td>${selected.map(item => `<td>${render(item)}</td>`).join('')}</tr>`;
    const list = items => `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
    $('#compareContent').innerHTML = `<table class="compare-table"><thead><tr><th>Signal</th>${selected.map(item => `<th><a href="${profileUrl(item.slug)}">${esc(item.name)}</a><br><small>${esc(item.vendor)}</small></th>`).join('')}</tr></thead><tbody>
      ${row('Pattern', item => `${esc(item.category)}<br><small>${esc(item.type)}</small>`)}
      ${row('Market', item => `${esc(item.since)}<br><small>${esc(item.maturity)}</small>`)}
      ${row('Best for', item => esc(item.bestFor))}
      ${row('Model surface', item => list(item.dimensions.slice(0, 5)))}
      ${row('Primary strengths', item => list(item.pros.slice(0, 3)))}
      ${row('Primary trade-offs', item => list(item.cons.slice(0, 3)))}
      ${row('Interoperability', item => esc(item.interoperability))}
      ${row('Editorial view', item => `<b>${esc(item.verdict)}</b>`)}
    </tbody></table>`;
    closeShortlist();
    $('#compareDialog').showModal();
  }

  document.addEventListener('click', event => {
    const add = event.target.closest('[data-shortlist]');
    if (add) { event.preventDefault(); toggleShortlist(add.dataset.shortlist); }
    const remove = event.target.closest('[data-remove-shortlist]');
    if (remove) { toggleShortlist(remove.dataset.removeShortlist); }
    if (event.target.closest('[data-open-shortlist]')) openShortlist();
    if (event.target.closest('[data-close-shortlist]') || event.target.id === 'scrim') closeShortlist();
    if (event.target.closest('[data-close-compare]')) $('#compareDialog')?.close();
  });
  $('#clearShortlist')?.addEventListener('click', () => { shortlist = []; saveShortlist(); });
  $('#compareButton')?.addEventListener('click', renderComparison);

  function cardTemplate(item, index) {
    const tags = [item.type.split(' ')[0], ...item.dimensions.slice(0, 2).map(value => value.split(' ').slice(0, 2).join(' '))];
    return `<article class="tech-card">
      <div class="card-top"><span class="category-badge">${esc(item.category)}</span><button class="shortlist-check" type="button" data-shortlist="${esc(item.slug)}" data-slug="${esc(item.slug)}" data-name="${esc(item.name)}" aria-pressed="false">+</button></div>
      <span class="card-index">${String(index + 1).padStart(2, '0')} / ${String(tech.length).padStart(2, '0')}</span>
      <h3>${esc(item.name)}</h3><p class="card-vendor">${esc(item.vendor)}</p>
      <p class="card-summary">${esc(item.summary)}</p>
      <div class="card-tags">${tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>
      <div class="card-footer"><span>${esc(item.maturity)} · ${esc(item.since.split('·')[0].trim())}</span><a href="${profileUrl(item.slug)}" aria-label="Read ${esc(item.name)} profile">Open profile</a></div>
    </article>`;
  }

  function initDirectory() {
    const grid = $('#cardGrid');
    if (!grid) return;
    const search = $('#search'); const sort = $('#sort'); const filters = $('#filters');
    let active = 'All';
    const categories = ['All', ...new Set(tech.map(item => item.category))];
    filters.innerHTML = categories.map(category => `<button type="button" class="filter-chip${category === 'All' ? ' active' : ''}" data-category="${esc(category)}">${esc(category)} <span>${category === 'All' ? tech.length : tech.filter(item => item.category === category).length}</span></button>`).join('');

    const apply = () => {
      const query = search.value.trim().toLowerCase();
      let results = tech.filter(item => (active === 'All' || item.category === active) && (!query || JSON.stringify(item).toLowerCase().includes(query)));
      if (sort.value === 'name') results.sort((a,b) => a.name.localeCompare(b.name));
      if (sort.value === 'maturity') results.sort((a,b) => maturityRank[b.maturity] - maturityRank[a.maturity] || a.name.localeCompare(b.name));
      if (sort.value === 'openness') results.sort((a,b) => b.scores.openness - a.scores.openness || a.name.localeCompare(b.name));
      grid.innerHTML = results.map((item, index) => cardTemplate(item, index)).join('');
      $('#resultCount').textContent = `${results.length} ${results.length === 1 ? 'technology' : 'technologies'}`;
      $('#emptyState').hidden = results.length > 0;
      $('#clearFilters').hidden = active === 'All' && !query;
      updateShortlistUI();
    };

    filters.addEventListener('click', event => {
      const button = event.target.closest('[data-category]'); if (!button) return;
      active = button.dataset.category;
      $$('.filter-chip', filters).forEach(chip => chip.classList.toggle('active', chip === button));
      apply();
    });
    search.addEventListener('input', apply); sort.addEventListener('change', apply);
    $('#clearFilters').addEventListener('click', () => { active = 'All'; search.value = ''; $$('.filter-chip', filters).forEach(chip => chip.classList.toggle('active', chip.dataset.category === 'All')); apply(); });
    document.addEventListener('keydown', event => { if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { event.preventDefault(); search.focus(); } if (event.key === 'Escape') closeShortlist(); });
    apply();
  }

  const listTemplate = items => `<ul class="coverage-list">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
  const bulletTemplate = (title, icon, items, tone) => `<article class="bullet-card ${tone}"><h3><span>${icon}</span>${title}</h3><ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul></article>`;

  function initTechnology() {
    const root = $('#techMain'); if (!root) return;
    const parts = location.pathname.split('/').filter(Boolean);
    const slug = document.body.dataset.tech || (parts[0] === 'technology' ? parts[1] : '') || new URLSearchParams(location.search).get('tech');
    const item = tech.find(entry => entry.slug === slug);
    if (!item) {
      root.innerHTML = '<section class="not-found wrap"><div><p class="kicker"><span></span>Profile not found</p><h1>Lost in the model.</h1><p>This technology profile does not exist.</p><a class="button primary" href="/">Return to directory →</a></div></section>';
      return;
    }
    document.title = `${item.name} — Semantic Layer Atlas`;
    const description = $('meta[name="description"]'); if (description) description.content = item.summary;
    const initials = item.name.split(/\s+/).filter(word => !word.startsWith('(')).slice(0,2).map(word => word[0]).join('').toUpperCase();
    const scoreLabels = { expressiveness: 'Expressiveness', interoperability: 'Interoperability', governance: 'Governance', ai: 'AI readiness', openness: 'Openness' };
    const scores = Object.entries(item.scores).map(([key,value]) => `<div class="score-row"><label>${scoreLabels[key]}</label><span class="score-track"><i style="width:${value * 20}%"></i></span><b>${value}/5</b></div>`).join('');
    const related = [...tech.filter(entry => entry.slug !== item.slug && entry.category === item.category), ...tech.filter(entry => entry.slug !== item.slug && entry.category !== item.category)].slice(0,3);
    const implementationLibrary = item.implementationLibrary ? `<a class="implementation-cta" href="${esc(item.implementationLibrary.url)}"><span><small>Implementation library</small><strong>${esc(item.implementationLibrary.count)} ${esc(item.implementationLibrary.label)}</strong><p>${esc(item.implementationLibrary.description)}</p></span><b>Open field guide →</b></a>` : '';
    root.innerHTML = `
      <section class="tech-hero"><div class="wrap tech-hero-inner"><div>
        <div class="breadcrumb"><a href="/">Directory</a><span>→</span>${esc(item.category)}<span>→</span>Profile</div>
        <span class="category-badge">${esc(item.category)}</span><h1>${esc(item.name)}</h1><p class="tech-vendor">${esc(item.vendor)} · ${esc(item.type)}</p><p class="tech-deck">${esc(item.summary)}</p>
      </div><div class="tech-seal"><i>Technology profile</i><span>${esc(initials)}</span></div></div>
      <div class="wrap tech-meta-strip"><div><small>Market age</small><b>${esc(item.since)}</b></div><div><small>Maturity</small><b>${esc(item.maturity)}</b></div><div><small>License posture</small><b>${esc(item.license)}</b></div><div><small>Deployment</small><b>${esc(item.deployment)}</b></div></div></section>
      <div class="wrap profile-body"><article class="profile-content">
        <section class="profile-section" id="overview"><div class="profile-section-head"><span>01</span><h2>What it is</h2></div><p class="profile-lead">${esc(item.description)}</p><div class="verdict-box"><small>Atlas verdict</small><p>${esc(item.verdict)}</p></div>${implementationLibrary}</section>
        <section class="profile-section" id="fit"><div class="profile-section-head"><span>02</span><h2>Fit & market context</h2></div><div class="two-col"><div class="info-panel"><h3>Best fit</h3><p>${esc(item.bestFor)}</p></div><div class="info-panel"><h3>Time in market</h3><p>${esc(item.marketNote)}</p></div></div></section>
        <section class="profile-section" id="scope"><div class="profile-section-head"><span>03</span><h2>Semantic scope</h2></div><div class="coverage-grid"><div class="coverage-block"><h3>Business domains</h3>${listTemplate(item.domains)}</div><div class="coverage-block"><h3>Dimensions & model objects</h3>${listTemplate(item.dimensions)}</div></div></section>
        <section class="profile-section" id="operation"><div class="profile-section-head"><span>04</span><h2>How it operates</h2></div><div class="flow-grid"><div class="flow-card"><small>Authoring plane</small><h3>Define & govern</h3>${item.authoring.map(value => `<span>${esc(value)}</span>`).join('')}</div><div class="flow-arrow">→</div><div class="flow-card"><small>Consumption plane</small><h3>Query & experience</h3>${item.consumption.map(value => `<span>${esc(value)}</span>`).join('')}</div></div></section>
        <section class="profile-section" id="tradeoffs"><div class="profile-section-head"><span>05</span><h2>Strengths & trade-offs</h2></div><div class="bullet-columns">${bulletTemplate('Where it shines','+',item.pros,'good')}${bulletTemplate('Watch carefully','!',item.cons,'caution')}</div></section>
        <section class="profile-section" id="signals"><div class="profile-section-head"><span>06</span><h2>Capability signals</h2></div><div class="score-card">${scores}<p class="score-note">${esc(meta.scoreNote || '')}</p></div></section>
        <section class="profile-section" id="interoperability"><div class="profile-section-head"><span>07</span><h2>Interoperability</h2></div><div class="interop-box">${esc(item.interoperability)}</div></section>
        <section class="profile-section" id="sources"><div class="profile-section-head"><span>08</span><h2>Primary sources</h2></div><ol class="source-list">${item.sources.map((source,index) => `<li><span>0${index+1}</span><a href="${esc(source[1])}" target="_blank" rel="noreferrer">${esc(source[0])}</a><small>↗</small></li>`).join('')}</ol></section>
      </article><aside class="profile-sidebar"><nav class="profile-nav" aria-label="On this page"><small>On this page</small><a href="#overview">What it is</a><a href="#fit">Fit & market</a><a href="#scope">Semantic scope</a><a href="#operation">Operating model</a><a href="#tradeoffs">Trade-offs</a><a href="#signals">Capability signals</a><a href="#interoperability">Interoperability</a><a href="#sources">Sources</a></nav></aside></div>
      <section class="related-block"><div class="wrap"><div class="related-head"><div><p class="eyebrow">Continue exploring</p><h2>Related technologies</h2></div><a href="/">View full directory →</a></div><div class="related-grid">${related.map(entry => `<a class="related-card" href="${profileUrl(entry.slug)}"><small>${esc(entry.category)}</small><h3>${esc(entry.name)}</h3><p>${esc(entry.summary)}</p></a>`).join('')}</div></div></section>`;
  }

  if (document.body.dataset.page === 'directory') initDirectory();
  if (document.body.dataset.page === 'technology') initTechnology();
  updateShortlistUI();
})();
