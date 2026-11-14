const filters = document.querySelector('.filters');
if (filters) {
  const fields = filters.elements;
  const cards = [...document.querySelectorAll('[data-property]')].map(element => ({
    element,
    terms: normalize(element.dataset.terms),
    region: element.dataset.region,
    type: element.dataset.type,
    tags: new Set(element.dataset.tags.split('|')),
    price: element.dataset.price === '' ? null : Number(element.dataset.price),
    beds: element.dataset.beds === '' ? null : Number(element.dataset.beds)
  }));
  const results = document.querySelector('#property-results');
  const count = document.querySelector('#result-count');
  const empty = document.querySelector('.empty-state');
  const facets = [...filters.querySelectorAll('input[name="tag"]')];
  const advanced = filters.querySelector('.advanced-filters');
  const advancedCount = filters.querySelector('[data-advanced-count]');
  const summary = document.querySelector('[data-active-filters]');
  const activeList = summary.querySelector('ul');
  const clear = document.querySelector('#clear-filters');
  const sorter = document.querySelector('select[name="sort"]');
  const priceRange = filters.querySelector('[data-price-range]');
  const lower = filters.querySelector('[data-min-slider]');
  const upper = filters.querySelector('[data-max-slider]');
  const priceError = document.querySelector('#price-error');
  const bars = [...filters.querySelectorAll('.price-histogram span')];
  for (const bar of bars) bar.style.setProperty('--bar-height', bar.dataset.height + '%');
  const ceiling = Number(upper.max);
  const euro = new Intl.NumberFormat('en-IE', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0});
  const quickSearches = [...document.querySelectorAll('[data-quick-search]')].map(link => ({
    link, params: new URL(link.href).searchParams
  }));
  const finderLinks = [...document.querySelectorAll('[data-search-finder], .nav-contact')].map(link => ({
    link, url: new URL(link.href)
  }));
  const criteriaKeys = ['region', 'type', 'minPrice', 'maxPrice', 'beds'];
  const selectKeys = ['region', 'type', 'beds'];
  const urlKeys = ['q', ...criteriaKeys, 'tag', 'sort', 'price'];
  let priceBounds = {minPrice: null, maxPrice: null};
  let summarySignature = '';
  let previousSort = '';
  let dragging = false;

  function normalize(value) {
    return value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  }

  function priceValue(value) {
    return /^\d{1,10}$/.test(value) && Number(value) >= 1 && Number(value) <= 1_000_000_000 ? Number(value) : null;
  }

  function readNumber(key) {
    const input = fields[key];
    if (input.validity.badInput) return {valid: false};
    if (input.value === '' || (key === 'minPrice' && Number(input.value) === 0)) return {valid: true, value: null};
    const value = priceValue(input.value);
    return {valid: value !== null, value};
  }

  function syncSliders() {
    const low = Math.min(ceiling, priceBounds.minPrice ?? 0);
    const high = Math.min(ceiling, priceBounds.maxPrice ?? ceiling);
    lower.value = low;
    upper.value = high;
    const lowPercent = low / ceiling * 100;
    const highPercent = high / ceiling * 100;
    priceRange.style.setProperty('--range-left', lowPercent + '%');
    priceRange.style.setProperty('--range-right', (100 - highPercent) + '%');
    priceRange.classList.toggle('thumbs-close', highPercent - lowPercent <= 7);
    lower.setAttribute('aria-valuetext', priceBounds.minPrice === null ? 'No minimum' : euro.format(priceBounds.minPrice));
    upper.setAttribute('aria-valuetext', priceBounds.maxPrice === null ? 'No maximum' : euro.format(priceBounds.maxPrice));
    lower.setAttribute('aria-valuemax', high);
    upper.setAttribute('aria-valuemin', low);
    bars.forEach((bar, index) => {
      const start = index / bars.length * 100;
      const end = (index + 1) / bars.length * 100;
      bar.classList.toggle('in-range', start <= highPercent && end > lowPercent);
    });
  }

  function readBounds() {
    const low = readNumber('minPrice');
    const high = readNumber('maxPrice');
    const inverted = low.value !== null && high.value !== null && low.value > high.value;
    const message = !low.valid || !high.valid ? 'Enter a whole euro amount between €1 and €1,000,000,000.'
      : inverted ? 'Minimum price must be at or below maximum price.' : '';
    priceError.textContent = message;
    priceError.hidden = !message;
    fields.minPrice.setAttribute('aria-invalid', String(!low.valid || inverted));
    fields.maxPrice.setAttribute('aria-invalid', String(!high.valid || inverted));
    if (message) return false;
    priceBounds = {minPrice: low.value, maxPrice: high.value};
    syncSliders();
    return true;
  }

  function searchState() {
    return {
      q: fields.q.value.trim(),
      region: fields.region.value,
      type: fields.type.value,
      beds: fields.beds.value,
      tags: facets.filter(facet => facet.checked).map(facet => facet.value),
      sort: sorter.value,
      ...priceBounds
    };
  }

  function writeParams(params, state, includeSearchOnly) {
    for (const key of criteriaKeys) {
      if (state[key]) params.set(key, state[key]);
    }
    for (const tag of state.tags) params.append('tag', tag);
    if (includeSearchOnly) {
      if (state.q) params.set('q', state.q);
      if (state.sort) params.set('sort', state.sort);
    }
  }

  function syncQuickLinks({tags, minPrice, maxPrice}) {
    for (const {link, params} of quickSearches) {
      const tag = params.get('tag');
      const selected = tag ? tags.includes(tag) : minPrice === null && maxPrice === Number(params.get('maxPrice'));
      if (selected) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  }

  function removeFilter(key, value) {
    if (key === 'tag') facets.find(facet => facet.value === value).checked = false;
    else fields[key].value = '';
    readBounds();
    apply('pushState');
    (activeList.querySelector('button') ?? fields.q).focus();
  }

  function renderSummary(state) {
    const labels = [
      ['q', state.q, state.q && 'Search: ' + state.q],
      ['region', state.region, state.region],
      ['type', state.type, state.type],
      ['minPrice', state.minPrice, state.minPrice && 'From ' + euro.format(state.minPrice)],
      ['maxPrice', state.maxPrice, state.maxPrice && 'Up to ' + euro.format(state.maxPrice)],
      ['beds', state.beds, state.beds && state.beds + '+ bedrooms'],
      ...state.tags.map(tag => ['tag', tag, tag])
    ].filter(([, value]) => value);
    const signature = JSON.stringify(labels);
    if (signature === summarySignature) return;
    summarySignature = signature;
    activeList.replaceChildren(...labels.map(([key, value, label]) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label + ' ×';
      button.setAttribute('aria-label', 'Remove filter: ' + label);
      button.addEventListener('click', () => removeFilter(key, value));
      item.append(button);
      return item;
    }));
    summary.hidden = labels.length === 0;
  }

  function sortResults(sort) {
    if (sort === previousSort) return;
    previousSort = sort;
    const ordered = [...cards];
    if (sort) {
      const direction = sort === 'price-desc' ? -1 : 1;
      ordered.sort((a, b) => {
        if (a.price === null) return b.price === null ? 0 : 1;
        if (b.price === null) return -1;
        return direction * (a.price - b.price);
      });
    }
    for (const card of ordered) results.insertBefore(card.element, empty);
  }

  function apply(historyMethod) {
    const state = searchState();
    const words = normalize(state.q).split(/\s+/).filter(Boolean);
    let matches = 0;
    for (const card of cards) {
      const match = words.every(word => card.terms.includes(word)) &&
        (!state.region || state.region === card.region) &&
        (!state.type || state.type === card.type) &&
        (!state.beds || (card.beds !== null && card.beds >= Number(state.beds))) &&
        (state.minPrice === null || (card.price !== null && card.price >= state.minPrice)) &&
        (state.maxPrice === null || (card.price !== null && card.price <= state.maxPrice)) &&
        state.tags.every(tag => card.tags.has(tag));
      card.element.hidden = !match;
      if (match) matches++;
    }

    const resultLabel = matches === 1 ? '1 property' : matches + ' properties';
    if (count.textContent !== resultLabel) count.textContent = resultLabel;
    empty.hidden = matches > 0;
    const extra = state.tags.length + Number(Boolean(state.beds));
    advancedCount.hidden = extra === 0;
    advancedCount.textContent = String(extra);
    renderSummary(state);
    sortResults(state.sort);
    syncQuickLinks(state);
    for (const {link, url} of finderLinks) {
      const next = new URL(url);
      writeParams(next.searchParams, state, false);
      link.href = next;
    }

    if (historyMethod) {
      const url = new URL(location.href);
      for (const key of urlKeys) url.searchParams.delete(key);
      writeParams(url.searchParams, state, true);
      if (url.href !== location.href) history[historyMethod](null, '', url);
    }
  }

  function setSelect(select, value) {
    select.value = [...select.options].some(option => option.value === value) ? value : '';
  }

  function restore() {
    const params = new URLSearchParams(location.search);
    fields.q.value = params.get('q') ?? '';
    for (const key of selectKeys) setSelect(fields[key], params.get(key));
    setSelect(sorter, params.get('sort'));
    fields.minPrice.value = priceValue(params.get('minPrice')) ?? '';
    fields.maxPrice.value = priceValue(params.get('maxPrice') ?? params.get('price')) ?? '';
    const selected = new Set(params.getAll('tag'));
    for (const facet of facets) facet.checked = selected.has(facet.value);
    advanced.open = fields.beds.value !== '' || facets.some(facet => facet.checked);
    priceBounds = {minPrice: null, maxPrice: null};
    syncSliders();
    readBounds();
    apply();
  }

  function reset() {
    filters.reset();
    sorter.value = '';
    readBounds();
    apply('pushState');
    fields.q.focus();
  }

  function moveThumb(isLower, value) {
    if (isLower) {
      const limit = Math.min(ceiling, priceBounds.maxPrice ?? ceiling);
      fields.minPrice.value = Math.min(value, limit) || '';
      fields.maxPrice.value = priceBounds.maxPrice ?? '';
    } else {
      const limit = Math.min(ceiling, priceBounds.minPrice ?? 0);
      const amount = Math.max(value, limit);
      fields.maxPrice.value = amount === ceiling ? '' : amount || 1;
      fields.minPrice.value = priceBounds.minPrice ?? '';
    }
    readBounds();
    apply();
  }

  for (const {link, params} of quickSearches) {
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      const tag = params.get('tag');
      if (tag) {
        const facet = facets.find(option => option.value === tag);
        facet.checked = !facet.checked;
        advanced.open = true;
      } else {
        const active = link.hasAttribute('aria-current');
        fields.minPrice.value = '';
        fields.maxPrice.value = active ? '' : params.get('maxPrice');
      }
      readBounds();
      apply('pushState');
    });
  }

  filters.addEventListener('submit', event => {
    event.preventDefault();
    if (readBounds()) apply('pushState');
    else filters.querySelector('[aria-invalid="true"]').focus();
  });
  filters.addEventListener('change', () => { readBounds(); apply('pushState'); });
  fields.q.addEventListener('input', () => apply());
  priceRange.addEventListener('pointerdown', () => { dragging = true; });
  for (const name of ['pointerup', 'pointercancel']) {
    window.addEventListener(name, () => { dragging = false; });
  }
  for (const slider of [lower, upper]) {
    slider.addEventListener('input', () => {
      const value = Number(slider.value);
      moveThumb(slider === lower, dragging ? Math.round(value / 5000) * 5000 : value);
    });
    slider.addEventListener('keydown', event => {
      const increments = {ArrowLeft:-5000, ArrowDown:-5000, ArrowRight:5000, ArrowUp:5000, PageDown:-50000, PageUp:50000};
      const increment = increments[event.key];
      if (typeof increment !== 'number') return;
      event.preventDefault();
      const value = Math.min(ceiling, Math.max(0, Number(slider.value) + increment));
      moveThumb(slider === lower, value);
      apply('pushState');
    });
  }
  sorter.addEventListener('change', () => apply('pushState'));
  clear.addEventListener('click', reset);
  empty.querySelector('[data-clear]').addEventListener('click', reset);
  window.addEventListener('popstate', restore);
  restore();
  filters.hidden = false;
  sorter.closest('label').hidden = false;
}

const dialog = document.querySelector('.lightbox');
if (dialog) {
  const photos = JSON.parse(document.querySelector('#photo-data').textContent);
  const img = dialog.querySelector('img');
  const caption = dialog.querySelector('figcaption');
  const counter = dialog.querySelector('#photo-counter');
  let current = 0;
  let opener;
  function show(index) {
    current = (index + photos.length) % photos.length;
    const photo = photos[current];
    img.src = photo.src;
    img.alt = photo.alt;
    caption.textContent = photo.alt;
    counter.textContent = 'Photo '+(current+1)+' of '+photos.length;
  }
  function open(button,index) { opener=button; show(index); dialog.showModal(); }
  document.querySelector('[data-gallery-open]').addEventListener('click',e=>open(e.currentTarget,0));
  document.querySelectorAll('[data-photo-index]').forEach(button=>button.addEventListener('click',()=>open(button,Number(button.dataset.photoIndex))));
  dialog.querySelector('[data-gallery-close]').addEventListener('click',()=>dialog.close());
  dialog.querySelector('[data-gallery-prev]').addEventListener('click',()=>show(current-1));
  dialog.querySelector('[data-gallery-next]').addEventListener('click',()=>show(current+1));
  dialog.addEventListener('close',()=>opener?.focus());
  dialog.addEventListener('keydown',e=>{
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(current-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(current+1); }
  });
}
