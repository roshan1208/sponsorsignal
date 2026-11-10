(() => {
  'use strict';

  const MAX_EMPLOYERS = 20;
  const COMPANY_FLAGS_URL = '../data/company_flags.json';
  const APP_URL = 'https://app.knowyoursponsor.co.uk/?plan=monitor&source=portfolio-baseline';
  const $ = id => document.getElementById(id);
  const form = $('portfolio-form');
  if (!form) return;

  const area = $('employers');
  const count = $('employer-count');
  const status = $('scan-status');
  const resultsSection = $('baseline-results');
  const resultsList = $('baseline-list');
  const search = $('employer-search');
  const pickerResults = $('employer-results');
  const pickerStatus = $('picker-status');
  const directoryPromises = new Map();
  const identityPromises = new Map();
  let companyFlagsPromise;
  let matches = [];
  let activeIndex = -1;
  let searchTimer;

  function record(event) {
    if (window.kysProductMetrics) window.kysProductMetrics.record(event);
  }

  function normalise(value) {
    return String(value || '').normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en-GB')
      .match(/[a-z0-9]+/g)?.join(' ') || '';
  }

  function shardKey(value) {
    const ascii = String(value || '').normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^[^0-9A-Za-z]+/, '')
      .toLocaleLowerCase('en-GB');
    return /^[0-9a-z]/.test(ascii) ? ascii.charAt(0) : '_';
  }

  function sponsorFromRow(row) {
    return {
      row,
      name: String(row?.[0] || ''),
      town: String(row?.[1] || ''),
      county: String(row?.[2] || ''),
      industry: String(row?.[3] || ''),
      routes: Array.isArray(row?.[4]) ? row[4].map(String) : [],
      rating: String(row?.[5] || ''),
    };
  }

  function uniqueLines() {
    const values = area.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    return [...new Map(values.map(value => [normalise(value), value])).values()];
  }

  function updateCount() {
    const values = uniqueLines();
    count.textContent = `${values.length} of ${MAX_EMPLOYERS} employers`;
    count.classList.toggle('over', values.length > MAX_EMPLOYERS);
    return values;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('The current evidence could not be loaded. Refresh and try again.');
    return response.json();
  }

  function loadDirectory(value) {
    const key = shardKey(value);
    if (!directoryPromises.has(key)) {
      directoryPromises.set(key, fetchJson(`../data/search/${key}.json`)
        .catch(error => { directoryPromises.delete(key); throw error; }));
    }
    return directoryPromises.get(key);
  }

  function loadIdentity(name) {
    const key = shardKey(name);
    if (!identityPromises.has(key)) {
      identityPromises.set(key, fetchJson(`../data/identity/${key}.json`)
        .catch(() => ({ employers: {} })));
    }
    return identityPromises.get(key);
  }

  function loadCompanyFlags() {
    if (!companyFlagsPromise) {
      companyFlagsPromise = fetchJson(COMPANY_FLAGS_URL).catch(() => ({ companies: {} }));
    }
    return companyFlagsPromise;
  }

  function exactCandidates(rows, value) {
    const wanted = normalise(value);
    return (rows || []).map(sponsorFromRow).filter(item => normalise(item.name) === wanted);
  }

  function splitTownHint(raw, rows) {
    const comma = raw.lastIndexOf(',');
    if (comma < 1) return null;
    const possibleName = raw.slice(0, comma).trim();
    const possibleTown = raw.slice(comma + 1).trim();
    if (!possibleName || !possibleTown) return null;
    const candidates = exactCandidates(rows, possibleName);
    return candidates.length ? { name: possibleName, town: possibleTown, candidates } : null;
  }

  function deDuplicateSponsors(items) {
    const seen = new Set();
    return items.filter(item => {
      const key = [item.name, item.town, item.county, item.rating, item.routes.join('|')]
        .map(normalise).join('::');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function suggestions(rows, value) {
    const wanted = normalise(value);
    if (wanted.length < 3) return [];
    const starts = [], contains = [];
    for (const row of rows || []) {
      const item = sponsorFromRow(row);
      const name = normalise(item.name);
      if (name.startsWith(wanted) && starts.length < 3) starts.push(item);
      else if (name.includes(wanted) && contains.length < 3) contains.push(item);
      if (starts.length + contains.length >= 5) break;
    }
    return deDuplicateSponsors(starts.concat(contains)).slice(0, 3);
  }

  async function resolveName(raw) {
    const shard = await loadDirectory(raw);
    const rows = Array.isArray(shard.sponsors) ? shard.sponsors : [];
    const aliases = Array.isArray(shard.aliases) ? shard.aliases : [];
    let exact = deDuplicateSponsors(exactCandidates(rows, raw));
    let townHint = null;

    if (!exact.length) {
      townHint = splitTownHint(raw, rows);
      if (townHint) {
        const town = normalise(townHint.town);
        const located = deDuplicateSponsors(townHint.candidates.filter(item =>
          normalise(item.town) === town || normalise(item.county) === town));
        if (located.length === 1) exact = located;
        else if (located.length > 1) {
          return { input: raw, state: 'review', reason: 'Several current records share that name and place.', candidates: located };
        } else {
          return { input: raw, state: 'review', reason: 'The name exists, but the supplied place does not identify one exact record.', candidates: townHint.candidates.slice(0, 4) };
        }
      }
    }

    if (exact.length === 1) return { input: raw, state: 'confirmed', sponsor: exact[0] };
    if (exact.length > 1) {
      return { input: raw, state: 'review', reason: 'This exact sponsor name appears in more than one place.', candidates: exact.slice(0, 4) };
    }

    const wanted = normalise(raw);
    const aliasMatches = deDuplicateSponsors(aliases
      .filter(alias => normalise(alias?.[0]) === wanted && Array.isArray(alias?.[2]))
      .map(alias => sponsorFromRow(alias[2])));
    if (aliasMatches.length) {
      return {
        input: raw,
        state: 'review',
        reason: 'A source-backed legal or trading name points to a sponsor record. Confirm it before monitoring.',
        candidates: aliasMatches.slice(0, 4),
      };
    }

    return { input: raw, state: 'not-found', reason: 'No exact current sponsor record was found.', candidates: suggestions(rows, townHint?.name || raw) };
  }

  async function attachCompanyEvidence(result, flagsDocument) {
    if (result.state !== 'confirmed') return result;
    const identityDocument = await loadIdentity(result.sponsor.name);
    const identityEntry = identityDocument.employers?.[result.sponsor.name] || {};
    const company = identityEntry.company || null;
    const warning = flagsDocument.companies?.[result.sponsor.name] || null;
    const safe = company?.state === 'identified' && company.number;
    const warningSafe = safe && warning && (!warning.number || warning.number === company.number);
    return {
      ...result,
      company: safe ? company : null,
      companyState: safe ? 'identified' : String(company?.state || 'unmatched'),
      warning: warningSafe ? warning : null,
    };
  }

  function textElement(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  }

  function sponsorMeta(sponsor) {
    const place = [sponsor.town, sponsor.county].filter(Boolean).join(', ') || 'Location not listed';
    const routes = sponsor.routes.length ? sponsor.routes.join(', ') : 'Route not listed';
    return `${place} · ${routes} · ${sponsor.rating ? `${sponsor.rating}-rated` : 'Rating not listed'}`;
  }

  function candidateList(result) {
    if (!result.candidates?.length) return null;
    const list = document.createElement('ul');
    list.className = 'candidate-list';
    for (const candidate of result.candidates) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `../?employer=${encodeURIComponent(candidate.name)}`;
      link.textContent = candidate.name;
      item.append(link, document.createTextNode(` — ${sponsorMeta(candidate)}`));
      list.append(item);
    }
    return list;
  }

  function renderResult(result) {
    const card = document.createElement('article');
    card.className = `evidence-row state-${result.state}`;
    const head = document.createElement('div');
    head.className = 'evidence-head';
    head.append(textElement('strong', 'input-name', result.input));
    const label = result.state === 'confirmed' ? 'Exact current record'
      : result.state === 'review' ? 'Needs review' : 'Not found exactly';
    head.append(textElement('span', 'state-label', label));
    card.append(head);

    if (result.state === 'confirmed') {
      const sponsorLink = document.createElement('a');
      sponsorLink.className = 'sponsor-name';
      sponsorLink.href = `../?employer=${encodeURIComponent(result.sponsor.name)}`;
      sponsorLink.textContent = result.sponsor.name;
      card.append(sponsorLink, textElement('p', 'evidence-meta', sponsorMeta(result.sponsor)));

      const companyLine = document.createElement('p');
      companyLine.className = 'company-line';
      if (result.warning?.severity === 'serious') {
        companyLine.classList.add('company-serious');
        companyLine.append(textElement('strong', '', 'Company warning: '), document.createTextNode(result.warning.status || 'The linked company record is not active.'));
      } else if (result.company) {
        companyLine.append(textElement('strong', '', 'Safely linked company: '), document.createTextNode(`${result.company.status || 'Status available'} · ${result.company.number}`));
      } else {
        companyLine.append(textElement('strong', '', 'Company identity: '), document.createTextNode('No safe legal-entity match is attached.'));
      }
      card.append(companyLine);
      if (result.company?.number) {
        const official = document.createElement('a');
        official.className = 'official-link';
        official.href = `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(result.company.number)}`;
        official.target = '_blank';
        official.rel = 'noopener';
        official.textContent = 'Open official company record';
        card.append(official);
      }
    } else {
      card.append(textElement('p', 'evidence-reason', result.reason));
      const list = candidateList(result);
      if (list) card.append(list);
    }
    return card;
  }

  function setMetric(id, value) {
    $(id).textContent = String(value);
  }

  function renderBaseline(results, updated) {
    resultsList.replaceChildren(...results.map(renderResult));
    const confirmed = results.filter(item => item.state === 'confirmed');
    const review = results.filter(item => item.state === 'review');
    const missing = results.filter(item => item.state === 'not-found');
    const serious = confirmed.filter(item => item.warning?.severity === 'serious');
    const safeCompanies = confirmed.filter(item => item.company);
    setMetric('metric-total', results.length);
    setMetric('metric-confirmed', confirmed.length);
    setMetric('metric-review', review.length + missing.length);
    setMetric('metric-warnings', serious.length);
    setMetric('metric-companies', safeCompanies.length);
    $('baseline-date').textContent = updated ? `Register checked ${updated}.` : 'Current register evidence loaded.';
    $('baseline-summary').textContent = serious.length
      ? `${serious.length} safely linked company warning${serious.length === 1 ? '' : 's'} need attention before this portfolio is monitored.`
      : review.length + missing.length
        ? `${review.length + missing.length} name${review.length + missing.length === 1 ? '' : 's'} need confirmation. Nothing uncertain was silently merged.`
        : 'Every supplied name resolved to one exact current sponsor record. Company coverage remains labelled separately.';
    resultsSection.hidden = false;
    resultsSection.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function closePicker() {
    pickerResults.hidden = true;
    pickerResults.replaceChildren();
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
    matches = [];
    activeIndex = -1;
  }

  function findPickerMatches(shard, query) {
    const wanted = normalise(query);
    const prefix = [], contains = [];
    for (const row of shard.sponsors || []) {
      const sponsor = sponsorFromRow(row);
      const name = normalise(sponsor.name);
      if (name.startsWith(wanted) && prefix.length < 8) prefix.push(sponsor);
      else if (name.includes(wanted) && contains.length < 8) contains.push(sponsor);
    }
    return deDuplicateSponsors(prefix.concat(contains)).slice(0, 8);
  }

  function renderPicker(found) {
    matches = found;
    activeIndex = -1;
    pickerResults.replaceChildren();
    found.forEach((employer, index) => {
      const option = document.createElement('li');
      option.className = 'picker-option';
      option.id = `employer-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.dataset.index = String(index);
      option.append(textElement('span', 'picker-name', employer.name),
        textElement('span', 'picker-industry', employer.industry || 'Industry not listed'),
        textElement('span', 'picker-place', [employer.town, employer.county].filter(Boolean).join(', ') || 'Location not listed'));
      pickerResults.append(option);
    });
    pickerResults.hidden = !found.length;
    search.setAttribute('aria-expanded', String(Boolean(found.length)));
  }

  function setActive(index) {
    if (!matches.length) return;
    activeIndex = (index + matches.length) % matches.length;
    [...pickerResults.children].forEach((option, optionIndex) => {
      const active = optionIndex === activeIndex;
      option.classList.toggle('active', active);
      option.setAttribute('aria-selected', String(active));
      if (active) option.scrollIntoView({ block: 'nearest' });
    });
    search.setAttribute('aria-activedescendant', `employer-option-${activeIndex}`);
  }

  function addEmployer(employer) {
    const entry = employer.town ? `${employer.name}, ${employer.town}` : employer.name;
    const current = uniqueLines();
    if (current.some(value => normalise(value) === normalise(entry))) {
      pickerStatus.textContent = `${employer.name} is already in the list.`;
      closePicker();
      return;
    }
    if (current.length >= MAX_EMPLOYERS) {
      pickerStatus.textContent = `The instant baseline covers ${MAX_EMPLOYERS} employers. Start a pilot for a larger portfolio.`;
      closePicker();
      return;
    }
    area.value = current.concat(entry).join('\n');
    updateCount();
    pickerStatus.textContent = `Added ${employer.name}${employer.town ? ` in ${employer.town}` : ''}.`;
    search.value = '';
    closePicker();
  }

  async function runPickerSearch() {
    const query = search.value.trim();
    if (normalise(query).length < 3) {
      closePicker();
      pickerStatus.textContent = query ? 'Type at least three characters.' : '';
      return;
    }
    try {
      pickerStatus.textContent = 'Checking the current register…';
      const shard = await loadDirectory(query);
      if (query !== search.value.trim()) return;
      const found = findPickerMatches(shard, query);
      renderPicker(found);
      pickerStatus.textContent = found.length
        ? `${found.length} matching employers. Choose one or keep typing.`
        : 'No matching employer found. Check the spelling or paste the legal name.';
    } catch (error) {
      closePicker();
      pickerStatus.textContent = error.message;
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const employers = updateCount();
    resultsSection.hidden = true;
    status.className = 'status';
    if (!employers.length) {
      area.setCustomValidity('Add at least one employer.');
      form.reportValidity();
      area.setCustomValidity('');
      area.focus();
      return;
    }
    if (employers.length > MAX_EMPLOYERS) {
      status.textContent = `Use up to ${MAX_EMPLOYERS} employer names for the instant baseline.`;
      status.classList.add('bad');
      area.focus();
      return;
    }
    record('business_portfolio_baseline_started');
    status.textContent = `Checking ${employers.length} employer${employers.length === 1 ? '' : 's'} against current evidence…`;
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      const resolved = await Promise.all(employers.map(resolveName));
      const flags = resolved.some(item => item.state === 'confirmed') ? await loadCompanyFlags() : { companies: {} };
      const withEvidence = await Promise.all(resolved.map(item => attachCompanyEvidence(item, flags)));
      const updated = [...directoryPromises.values()].length
        ? (await [...directoryPromises.values()][0]).updated || '' : '';
      renderBaseline(withEvidence, updated);
      status.textContent = 'Baseline ready. Employer names stayed in this browser.';
      status.classList.add('good');
      record('business_portfolio_baseline_completed');
    } catch (error) {
      status.textContent = error.message || 'The current evidence could not be checked. Refresh and try again.';
      status.classList.add('bad');
    } finally {
      form.querySelector('button[type="submit"]').disabled = false;
    }
  });

  area.addEventListener('input', updateCount);
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runPickerSearch, 180);
  });
  search.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(activeIndex + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(activeIndex - 1); }
    else if (event.key === 'Enter' && matches.length) { event.preventDefault(); addEmployer(matches[activeIndex < 0 ? 0 : activeIndex]); }
    else if (event.key === 'Escape') closePicker();
  });
  pickerResults.addEventListener('click', event => {
    const option = event.target.closest('[data-index]');
    if (option) addEmployer(matches[Number(option.dataset.index)]);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.picker')) closePicker();
  });
  $('print-baseline').addEventListener('click', () => window.print());
  $('check-another').addEventListener('click', () => {
    resultsSection.hidden = true;
    area.focus();
    scrollTo({ top: form.offsetTop - 20, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  $('start-pilot').href = APP_URL;
  $('start-pilot').addEventListener('click', () => record('business_portfolio_pilot_opened'));
  record('business_portfolio_scan_opened');
  updateCount();
})();
