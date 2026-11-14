const euro = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0
});

const normalize = value => String(value ?? '')
  .trim()
  .toLocaleLowerCase('en')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '');

function numberOrUnknown(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readPriceParameter(value) {
  if (!value || !/^\d{1,10}$/u.test(value)) return null;
  const amount = Number(value);
  return amount >= 1 && amount <= 1_000_000_000 ? amount : null;
}

export function readSearchPreferences(search, options) {
  const params = new URLSearchParams(search);
  const allowed = (name, values) => {
    const value = params.get(name);
    return value && values.includes(value) ? value : '';
  };
  return {
    region: allowed('region', options.regions),
    type: allowed('type', options.types),
    minBudget: readPriceParameter(params.get('minPrice')),
    maxBudget: readPriceParameter(params.get('maxPrice')),
    beds: allowed('beds', options.beds),
    must: [...new Set(params.getAll('tag').filter(tag => options.tags.includes(tag)))]
  };
}

function areaValues(property) {
  return [property.region, property.location]
    .filter(Boolean)
    .flatMap(value => [value, ...value.split(/[,·/]/)])
    .map(normalize)
    .filter(Boolean);
}

function labelBedrooms(value) {
  return value === 0 ? 'Studio' : value + (value === 1 ? ' bedroom' : ' bedrooms');
}

function labels(items) {
  return new Set((Array.isArray(items) ? items : []).map(normalize).filter(Boolean));
}

function assess(property, criteria) {
  const confirmed = [];
  const different = [];
  const unverified = [];
  const areas = areaValues(property);
  const tags = labels(property.tags);
  const absent = labels(property.absentTags);
  const recordedPrice = numberOrUnknown(property.price);
  const recordedBeds = numberOrUnknown(property.bedrooms);
  const price = recordedPrice > 0 ? recordedPrice : null;
  const bedrooms = Number.isInteger(recordedBeds) && recordedBeds >= 0 ? recordedBeds : null;
  const location = property.location || property.region;

  if (criteria.areas.length) {
    if (!areas.length) unverified.push('Location');
    else if (criteria.areas.some(area => areas.includes(normalize(area)))) confirmed.push(location);
    else different.push(location + ' is outside your selected areas');
  }

  if (criteria.type) {
    if (!normalize(property.type)) unverified.push('Property type');
    else if (normalize(property.type) === normalize(criteria.type)) confirmed.push(property.type);
    else different.push(property.type + ' differs from your selected type');
  }

  if (criteria.minBudget !== null || criteria.maxBudget !== null) {
    if (price === null) unverified.push('Asking price');
    else if (criteria.minBudget !== null && price < criteria.minBudget) {
      different.push(euro.format(criteria.minBudget - price) + ' below your minimum price');
    } else if (criteria.maxBudget !== null && price > criteria.maxBudget) {
      different.push(euro.format(price - criteria.maxBudget) + ' above your maximum budget');
    } else confirmed.push(euro.format(price) + ' is within budget');
  }

  if (criteria.minBedrooms > 0) {
    if (bedrooms === null) unverified.push('Bedroom count');
    else if (bedrooms >= criteria.minBedrooms) confirmed.push(labelBedrooms(bedrooms));
    else different.push(labelBedrooms(bedrooms) + ' · minimum ' + criteria.minBedrooms);
  }

  for (const item of criteria.must) {
    if (tags.has(normalize(item))) confirmed.push(item);
    else if (absent.has(normalize(item))) different.push(item + ' is listed as unavailable');
    else unverified.push(item);
  }

  const nice = criteria.nice.filter(item => tags.has(normalize(item)));
  const isMatch = different.length === 0 && unverified.length === 0;
  return { property, price, bedrooms, confirmed, different, unverified, nice, isMatch };
}

export function findProperties(properties, criteria) {
  const must = labels(criteria.must);
  const normalized = {
    areas: criteria.areas ?? [],
    type: normalize(criteria.type) === 'any' ? '' : criteria.type,
    minBudget: numberOrUnknown(criteria.minBudget),
    maxBudget: numberOrUnknown(criteria.maxBudget),
    minBedrooms: numberOrUnknown(criteria.minBedrooms),
    must: criteria.must ?? [],
    nice: (criteria.nice ?? []).filter(item => !must.has(normalize(item)))
  };

  const ranked = properties.map(property => assess(property, normalized)).sort((a, b) =>
    a.different.length - b.different.length ||
    a.unverified.length - b.unverified.length ||
    b.nice.length - a.nice.length ||
    (a.price ?? Infinity) - (b.price ?? Infinity) ||
    String(a.property.reference ?? '').localeCompare(String(b.property.reference ?? ''))
  );

  return {
    matches: ranked.filter(result => result.isMatch),
    near: ranked.filter(result => !result.isMatch)
  };
}

function countOf(value, singular, plural = singular + 's') {
  return value + ' ' + (value === 1 ? singular : plural);
}

function listingLine(result) {
  const { property, different, unverified } = result;
  const ref = property.reference ? ' · Ref. ' + property.reference : '';
  const issues = [
    ...(different.length ? ['Outside criteria: ' + different.join(', ')] : []),
    ...(unverified.length ? ['To verify: ' + unverified.join(', ')] : [])
  ];
  return '• ' + (property.title || 'Property') + ref + (issues.length ? ' — ' + issues.join('. ') : '');
}

export function formatProfile(criteria, results) {
  return [
    'Greece Properties | Buyer brief',
    '',
    'Intended use: ' + criteria.use,
    'Preferred areas: ' + (criteria.areas.join(', ') || 'Open to any area'),
    'Property type: ' + (criteria.type || 'Open to any type'),
    ...(criteria.minBudget != null ? ['Minimum price: ' + euro.format(criteria.minBudget)] : []),
    'Maximum budget: ' + (criteria.maxBudget == null ? 'Flexible' : euro.format(criteria.maxBudget)),
    'Minimum bedrooms: ' + (criteria.minBedrooms || 'Flexible'),
    'Must-have features: ' + (criteria.must.join(', ') || 'None selected'),
    'Nice-to-have features: ' + (criteria.nice.join(', ') || 'None selected'),
    'Buying timeline: ' + criteria.timeline,
    'Financing stage: ' + criteria.financing,
    ...(criteria.contactPreference ? ['Preferred way to talk: ' + criteria.contactPreference] : []),
    ...(criteria.note ? ['', 'Notes:', criteria.note] : []),
    '',
    'Matches in the current inventory',
    ...(results.matches.length ? results.matches.map(listingLine) : ['None found']),
    ...(results.near.length ? ['', 'Other listings and what to check', ...results.near.map(listingLine)] : [])
  ].join('\n');
}

// Catch contact details in the optional note before the profile can be shared.
export function containsContactDetails(note) {
  const email = /[\p{L}\d.!#$%&'*+/=?^_\x60{|}~-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)*/iu;
  const link = /\b(?:https?:\/\/|www\.)\S+/iu;
  const phone = /(?:\+?\d[\s().-]*){7,}\d/u;
  return email.test(note) || link.test(note) || phone.test(note);
}

const phoneMethods = new Set(['phone', 'whatsapp', 'viber', 'phone call']);
const emailShape = /^[^\s<>,;:"@]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/iu;

export function validateBuyer(buyer, method) {
  if (!buyer.name || buyer.name.length > 100 || /[\r\n]/u.test(buyer.name)) {
    return { field: 'name', message: 'Enter your name, using up to 100 characters.' };
  }
  if (buyer.email.length > 254 || !emailShape.test(buyer.email) || buyer.email.split('.').at(-1).length < 2) {
    return { field: 'email', message: 'Enter an email address where we can reach you.' };
  }
  if (phoneMethods.has(normalize(method)) && !buyer.phone) {
    return { field: 'phone', message: 'Enter a phone number for your preferred contact method.' };
  }
  if (buyer.phone) {
    const digits = buyer.phone.replace(/\D/gu, '');
    if (buyer.phone.length > 32 || !/^\+?[\d\s().-]+$/u.test(buyer.phone) ||
        digits.length < 7 || digits.length > 15) {
      return { field: 'phone', message: 'Enter a phone number with 7 to 15 digits.' };
    }
  }
  return null;
}

async function requestInquiry(endpoint, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(endpoint, {
      ...options,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    });
    const result = await response.json().catch(() => null);
    return { response, result, timedOut: controller.signal.aborted };
  } catch {
    return { timedOut: controller.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkInquiryAvailability(endpoint, timeout = 6000) {
  const { response, result } = await requestInquiry(endpoint, { method: 'GET' }, timeout);
  return response?.ok === true && result?.ok === true && result.available === true;
}

export async function postInquiry(endpoint, payload, timeout = 15000) {
  const { response, result, timedOut } = await requestInquiry(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }, timeout);
  if (timedOut) return 'timeout';
  if (response?.ok && result?.ok === true) return 'sent';
  if (response?.status === 429 || result?.error === 'rate_limited') return 'rate_limited';
  if (response?.status === 400 || response?.status === 422 || result?.error === 'invalid') return 'invalid';
  if (response?.status === 409) return 'pending';
  if (result?.error === 'delivery_unknown') return 'delivery_unknown';
  return 'unavailable';
}

function inquiryEndpoint(value) {
  if (!value) return null;
  try {
    const url = new URL(value, document.baseURI);
    const loopback = url.protocol === 'http:' && url.origin === location.origin &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!loopback && url.protocol !== 'https:') || url.username || url.password ||
        url.search || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

function propertyReferences(results) {
  return [...new Set(results.map(result => String(result.property.reference ?? '').trim()).filter(Boolean))];
}

function setupInquiry(root, editButton) {
  const form = root.querySelector('[data-inquiry-form]');
  if (!form) return null;
  const endpoint = inquiryEndpoint(root.dataset.endpoint);
  const fields = form.querySelector('[data-inquiry-fields]');
  const button = form.querySelector('[data-inquiry-send]');
  const phoneLabel = form.querySelector('[data-phone-label]');
  const error = root.querySelector('[data-inquiry-error]');
  const status = root.querySelector('[data-inquiry-status]');
  if (!endpoint || !fields || !button || !phoneLabel || !error || !status || !globalThis.crypto?.randomUUID) {
    if (status) status.textContent = 'Sending is unavailable. You can still copy or download your brief.';
    return null;
  }

  const name = form.elements.namedItem('name');
  const email = form.elements.namedItem('email');
  const phone = form.elements.namedItem('phone');
  const website = form.elements.namedItem('website');
  const errorMessages = {
    invalid: 'Check your contact details and quiz answers, then try again.',
    rate_limited: 'Too many requests were sent recently. Wait a minute and try again.',
    pending: 'Your last request may still be processing. Wait a moment and try again.',
    timeout: 'The request timed out. Try again in a moment to check its status.',
    delivery_unknown: 'We couldn’t confirm delivery. Copy or download your brief to keep it.',
    unavailable: 'Sending is temporarily unavailable. Try again or download your brief.'
  };
  let context;
  let contextKey = '';
  let lastRequest;
  let checking = false;
  let available = false;
  let sending = false;
  let sent = false;
  let invalidField;
  let previousDescription;

  function clearError() {
    error.hidden = true;
    error.textContent = '';
    if (!invalidField) return;
    invalidField.removeAttribute('aria-invalid');
    if (previousDescription) invalidField.setAttribute('aria-describedby', previousDescription);
    else invalidField.removeAttribute('aria-describedby');
    invalidField = undefined;
    previousDescription = undefined;
  }

  function showError(message, field) {
    error.hidden = false;
    error.textContent = message;
    if (!field) return;
    invalidField = field;
    previousDescription = field.getAttribute('aria-describedby');
    field.setAttribute('aria-describedby', [previousDescription, error.id].filter(Boolean).join(' '));
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }

  form.addEventListener('input', clearError);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!available || !context || sending || sent) return;
    clearError();
    const buyer = { name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() };
    const invalid = validateBuyer(buyer, context.criteria.contactPreference) ??
      (email.validity.typeMismatch ? { field: 'email', message: 'Enter a valid email address.' } : null);
    if (invalid) {
      showError(invalid.message, form.elements.namedItem(invalid.field));
      return;
    }

    const content = { version: 1, buyer, ...context, website: website.value };
    const key = JSON.stringify(content);
    if (lastRequest?.key !== key) lastRequest = { key, id: globalThis.crypto.randomUUID() };
    const payload = { ...content, submissionId: lastRequest.id };

    sending = true;
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    fields.disabled = true;
    if (editButton) editButton.disabled = true;
    button.textContent = 'Sending…';
    status.textContent = 'Sending your buyer brief…';

    const outcome = await postInquiry(endpoint, payload);

    sending = false;
    form.removeAttribute('aria-busy');
    fields.disabled = false;
    if (editButton) editButton.disabled = false;
    button.disabled = false;
    if (outcome === 'sent') {
      sent = true;
      lastRequest = undefined;
      form.reset();
      form.hidden = true;
      status.textContent = 'Buyer brief sent. Greece Properties can reply using the contact details you provided.';
      status.focus();
      return;
    }
    status.textContent = '';
    button.textContent = 'Try sending again';
    showError(errorMessages[outcome]);
    button.focus();
  });

  return async (criteria, results) => {
    const updated = {
      criteria,
      matches: propertyReferences(results.matches),
      nearMatches: propertyReferences(results.near)
    };
    const key = JSON.stringify(updated);
    if (key !== contextKey) {
      context = updated;
      contextKey = key;
      lastRequest = undefined;
      sent = false;
      status.textContent = '';
      clearError();
      button.textContent = 'Send my buyer brief';
    }
    phone.required = phoneMethods.has(normalize(criteria.contactPreference));
    phoneLabel.textContent = phone.required ? 'Phone number (required)' : 'Phone number (optional)';
    if (available) {
      form.hidden = sent;
      button.disabled = false;
      return;
    }
    if (checking) return;
    checking = true;
    status.textContent = 'Checking whether briefs can be sent…';
    available = await checkInquiryAvailability(endpoint);
    checking = false;
    form.hidden = !available;
    button.disabled = !available;
    status.textContent = available ? '' : 'Sending is currently unavailable. You can still copy or download your brief.';
  };
}

function localUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, document.baseURI);
    if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

function reason(list, label, values) {
  if (values.length) list.append(element('li', label + ': ' + values.join(' · ')));
}

function createResultCard(result) {
  const { property, price, bedrooms, confirmed, different, unverified, nice } = result;
  const card = element('article', '', 'finder-result-card');
  const photoUrl = localUrl(property.photo);

  if (photoUrl) {
    const photo = element('img', '', 'finder-result-photo');
    photo.src = photoUrl;
    photo.alt = property.photoAlt ?? '';
    photo.loading = 'lazy';
    card.append(photo);
  }

  const body = element('div', '', 'finder-result-body');
  const title = property.title || 'Property';
  const heading = element('h4', title);
  const link = localUrl(property.url);
  if (link) {
    const anchor = element('a', title);
    anchor.href = link;
    heading.replaceChildren(anchor);
  }

  const showBedrooms = bedrooms !== null && (bedrooms !== 0 || normalize(property.type) !== 'studio');
  const metadata = [
    property.location || property.region,
    property.type,
    price !== null ? euro.format(price) : null,
    showBedrooms ? labelBedrooms(bedrooms) : null
  ].filter(Boolean);

  body.append(heading);
  if (metadata.length) body.append(element('p', metadata.join(' · '), 'finder-result-meta'));

  const reasons = element('ul', '', 'finder-result-reasons');
  reason(reasons, 'Meets your criteria', confirmed);
  reason(reasons, 'Outside your criteria', different);
  reason(reasons, 'Needs confirmation', unverified);
  reason(reasons, 'Nice to have', nice);
  if (reasons.childElementCount) body.append(reasons);
  card.append(body);
  return card;
}

function readProperties() {
  try {
    const data = JSON.parse(document.querySelector('#finder-data')?.textContent ?? '');
    const properties = Array.isArray(data) ? data : data?.properties;
    return Array.isArray(properties) ? properties.filter(property => property && typeof property === 'object') : null;
  } catch {
    return null;
  }
}

function initFinder(root) {
  const form = root.querySelector('#finder-form');
  const steps = [...root.querySelectorAll('[data-finder-step]')];
  const results = root.querySelector('#finder-results');
  const profile = root.querySelector('[data-profile]');
  const back = root.querySelector('[data-finder-back]');
  const next = root.querySelector('[data-finder-next]');
  const progress = root.querySelector('[data-finder-progress]');
  const progressBar = root.querySelector('[data-finder-bar]');
  const resultsSummary = root.querySelector('[data-results-summary]');
  const matches = root.querySelector('[data-match-list]');
  const near = root.querySelector('[data-near-list]');
  const status = root.querySelector('[data-finder-status]');
  const editButton = root.querySelector('[data-edit-profile]');
  const budgetWrapper = root.querySelector('[data-budget-amount]');
  const searchPrefsNote = root.querySelector('[data-search-prefs]');
  const properties = readProperties();

  if (!form || steps.length !== 4 || !results || !profile || !back || !next ||
      !resultsSummary || !matches || !near) return;
  const showInquiry = setupInquiry(root, editButton);

  const controls = [...form.elements];
  const named = name => controls.filter(control => control.name === name);
  const first = name => named(name)[0];
  const picked = name => {
    const fields = named(name);
    return fields.find(control => control.type === 'radio' ? control.checked : !control.disabled);
  };
  const choice = name => picked(name)?.value.trim() ?? '';
  const checked = name => named(name).filter(control => control.checked && !control.disabled).map(control => control.value.trim());
  const display = name => {
    const control = picked(name);
    if (!control?.value) return '';
    return control.selectedOptions?.[0]?.textContent.trim() ||
      control.dataset.label || control.labels?.[0]?.textContent.trim() || control.value;
  };

  function prefillFromSearch() {
    const options = name => [...(first(name)?.options ?? [])].map(option => option.value);
    const preferences = readSearchPreferences(location.search, {
      regions: named('area').map(control => control.value),
      types: options('type'),
      beds: options('beds'),
      tags: named('must').map(control => control.value)
    });

    if (preferences.region) named('area').find(control => control.value === preferences.region).checked = true;
    if (preferences.type) first('type').value = preferences.type;
    if (preferences.beds) first('beds').value = preferences.beds;
    if (preferences.minBudget !== null) first('min-budget').value = String(preferences.minBudget);
    if (preferences.maxBudget !== null) first('budget').value = String(preferences.maxBudget);

    if (preferences.minBudget !== null || preferences.maxBudget !== null) {
      const mode = preferences.maxBudget === null ? 'flexible' : 'maximum';
      named('budget-mode').find(control => control.value === mode).checked = true;
    }
    const selectedTags = new Set(preferences.must);
    for (const control of named('must')) {
      if (!selectedTags.has(control.value)) continue;
      control.checked = true;
      const disclosure = control.closest('details');
      if (disclosure) disclosure.open = true;
    }

    const carried = preferences.region || preferences.type || preferences.beds ||
      preferences.minBudget !== null || preferences.maxBudget !== null || selectedTags.size;
    if (carried && searchPrefsNote) {
      searchPrefsNote.hidden = false;
      searchPrefsNote.textContent = selectedTags.size
        ? 'We carried over your search filters. Features from search start as must-haves. You can change these answers.'
        : 'We carried over your search filters. You can change these answers.';
    }
  }

  const errors = steps.map((step, index) => {
    const region = step.querySelector('[data-step-error]') || element('p', '', 'finder-step-error');
    region.id ||= 'finder-step-error-' + (index + 1);
    region.setAttribute('role', 'alert');
    if (!region.parentNode) step.append(region);
    return region;
  });

  let stepIndex = 0;
  let invalid;
  let description;
  let readyProfile = '';

  function clearError() {
    const region = errors[stepIndex];
    region.textContent = '';
    region.hidden = true;
    if (!invalid) return;
    invalid.removeAttribute('aria-invalid');
    if (description) invalid.setAttribute('aria-describedby', description);
    else invalid.removeAttribute('aria-describedby');
    invalid = undefined;
    description = undefined;
  }

  function reject(name, message) {
    clearError();
    const region = errors[stepIndex];
    region.hidden = false;
    region.textContent = message;
    invalid = first(name);
    if (invalid) {
      description = invalid.getAttribute('aria-describedby');
      invalid.setAttribute('aria-describedby', [description, region.id].filter(Boolean).join(' '));
      invalid.setAttribute('aria-invalid', 'true');
      invalid.focus();
    }
    return false;
  }

  function focusHeading(heading) {
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus();
  }

  function showStep(index, focus = true) {
    clearError();
    stepIndex = index;
    form.hidden = false;
    results.hidden = true;
    steps.forEach((step, stepNumber) => { step.hidden = stepNumber !== index; });
    if (progress) progress.textContent = 'Step ' + (index + 1) + ' of ' + steps.length;
    if (progressBar) {
      progressBar.max = steps.length;
      progressBar.value = index + 1;
    }
    back.hidden = index === 0;
    next.textContent = index === steps.length - 1 ? 'See my matches' : 'Continue';
    if (focus) focusHeading(steps[index].querySelector('[data-step-title]'));
  }

  function updateBudget() {
    const budget = first('budget');
    const hasMaximum = choice('budget-mode') === 'maximum';
    if (budget) budget.disabled = !hasMaximum;
    if (budgetWrapper) budgetWrapper.hidden = !hasMaximum;
  }

  function updatePriorities() {
    const must = labels(checked('must'));
    for (const checkbox of named('nice')) {
      const locked = must.has(normalize(checkbox.value));
      if (locked) checkbox.checked = false;
      checkbox.disabled = locked;
    }
  }

  function validStep() {
    if (stepIndex === 0 && !choice('use')) return reject('use', 'Choose how you plan to use the property.');

    if (stepIndex === 1) {
      const mode = choice('budget-mode');
      const minimum = choice('min-budget');
      const maximum = choice('budget');
      const lowerBound = readPriceParameter(minimum);
      const upperBound = readPriceParameter(maximum);
      if (!mode) return reject('budget-mode', 'Set a maximum budget or choose a flexible budget.');
      if (first('min-budget')?.validity?.badInput || (minimum && lowerBound === null)) {
        return reject('min-budget', 'Enter a whole euro amount between €1 and €1 billion, or leave the minimum blank.');
      }
      if (mode === 'maximum' && upperBound === null) {
        return reject('budget', 'Enter a maximum price in whole euros between €1 and €1 billion.');
      }
      if (mode === 'maximum' && lowerBound !== null && lowerBound > upperBound) {
        return reject('min-budget', 'The minimum price must be at or below the maximum price.');
      }
    }

    if (stepIndex === 3) {
      if (!choice('timeline')) return reject('timeline', 'Choose a buying timeline.');
      if (!choice('financing')) return reject('financing', 'Choose where you are with financing.');
      if (choice('note').length > 500) return reject('note', 'Keep your note to 500 characters or fewer.');
      if (containsContactDetails(choice('note'))) return reject('note', 'Remove email addresses, phone numbers and links from your note.');
    }

    return true;
  }

  function criteriaFromForm() {
    const type = display('type');
    return {
      use: display('use'),
      areas: checked('area'),
      type: normalize(choice('type')) === 'any' ? '' : type,
      minBudget: readPriceParameter(choice('min-budget')),
      maxBudget: choice('budget-mode') === 'maximum' ? readPriceParameter(choice('budget')) : null,
      minBedrooms: numberOrUnknown(choice('beds')),
      must: checked('must'),
      nice: checked('nice'),
      timeline: display('timeline'),
      financing: display('financing'),
      contactPreference: display('contact-preference'),
      note: choice('note')
    };
  }

  function showResults() {
    const criteria = criteriaFromForm();
    const all = findProperties(properties ?? [], criteria);
    const ranked = {matches:all.matches,near:all.near.slice(0,3)};
    const matched = ranked.matches.length;
    const other = ranked.near.length;
    matches.replaceChildren(...ranked.matches.map(createResultCard));
    near.replaceChildren(...ranked.near.map(createResultCard));
    if (!matched) {
      matches.append(element('p', properties?.length
        ? 'No listing shows every requirement you selected.'
        : 'There are no listings to match against right now.'));
    }
    const nearSection = near.closest('[data-near-section]');
    if (nearSection) nearSection.hidden = other === 0;
    else if (!other) near.append(element('p', 'No other listings to show.'));
    resultsSummary.textContent = properties?.length
      ? countOf(matched, 'match', 'matches') + (other ? ' · ' + countOf(other, 'closest alternative') : '') +
        '. Matches meet your selected area, type, budget, bedroom and must-have filters.'
      : 'Save your buyer brief to keep your preferences for later.';
    readyProfile = formatProfile(criteria, ranked);
    profile.value = readyProfile;
    profile.readOnly = true;
    showInquiry?.(criteria, ranked);
    if (status) status.textContent = '';
    form.hidden = true;
    results.hidden = false;
    focusHeading(results.querySelector('[data-results-title]'));
  }

  form.noValidate = true;
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!validStep()) return;
    if (stepIndex === steps.length - 1) showResults();
    else showStep(stepIndex + 1);
  });

  form.addEventListener('input', clearError);
  form.addEventListener('change', () => {
    updateBudget();
    updatePriorities();
  });

  back.addEventListener('click', () => { if (stepIndex > 0) showStep(stepIndex - 1); });
  editButton?.addEventListener('click', () => showStep(0));

  root.querySelector('[data-copy-profile]')?.addEventListener('click', async () => {
    if (!readyProfile) return;
    try {
      await navigator.clipboard.writeText(readyProfile);
      if (status) status.textContent = 'Buyer brief copied.';
    } catch {
      profile.focus();
      profile.select();
      if (status) status.textContent = 'Buyer brief selected. Use your device’s Copy command.';
    }
  });

  root.querySelector('[data-download-profile]')?.addEventListener('click', () => {
    if (!readyProfile) return;
    const url = URL.createObjectURL(new Blob([readyProfile], { type: 'text/plain;charset=utf-8' }));
    const link = element('a');
    link.href = url;
    link.download = 'greece-properties-buyer-brief.txt';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (status) status.textContent = 'Download requested.';
  });

  prefillFromSearch();
  updateBudget();
  updatePriorities();
  showStep(0, false);
  next.disabled = false;
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('[data-finder]');
  if (root) initFinder(root);
}
