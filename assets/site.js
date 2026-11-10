const filters = document.querySelector('.filters');
if (filters) {
  const inputs = Object.fromEntries([...filters.elements].filter(el => el.name).map(el => [el.name,el]));
  const cards = [...document.querySelectorAll('[data-property]')];
  const count = document.querySelector('#result-count');
  const empty = document.querySelector('.empty-state');
  const clear = document.querySelector('#clear-filters');
  const normalize = value => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
  const apply = (updateURL = false, replace = false) => {
    const values = Object.fromEntries(Object.entries(inputs).map(([key,el])=>[key,el.value.trim()]));
    const words = normalize(values.q).split(/\s+/).filter(Boolean);
    let matches = 0;
    for (const card of cards) {
      const data = card.dataset;
      const ok = words.every(w => normalize(data.terms).includes(w)) && (!values.type || values.type === data.type) && (!values.price || Number(data.price) <= Number(values.price)) && (!values.beds || Number(data.beds) >= Number(values.beds));
      card.hidden = !ok;
      if(ok) matches++;
    }
    count.textContent = matches === 1 ? '1 property' : matches + ' properties';
    empty.hidden = matches > 0;
    clear.hidden = !Object.values(values).some(Boolean);
    if (updateURL) {
      const url = new URL(location.href);
      for (const [key,value] of Object.entries(values)) value ? url.searchParams.set(key,value) : url.searchParams.delete(key);
      if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState'](null,'',url);
    }
  };
  const restore = () => {
    const params = new URLSearchParams(location.search);
    for (const [key,el] of Object.entries(inputs)) {
      const value = params.get(key) ?? '';
      el.value = el.tagName === 'SELECT' && ![...el.options].some(o=>o.value===value) ? '' : value;
    }
    apply();
  };
  const reset = () => {
    filters.reset();
    apply(true);
    inputs.q.focus();
  };
  filters.addEventListener('submit', event => { event.preventDefault(); apply(true); });
  filters.addEventListener('change', event => { if (event.target.tagName === 'SELECT') apply(true); });
  inputs.q.addEventListener('input', () => apply(true,true));
  clear.addEventListener('click', reset);
  document.querySelector('[data-clear]').addEventListener('click', reset);
  window.addEventListener('popstate', restore);
  restore();
  filters.hidden = false;
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
