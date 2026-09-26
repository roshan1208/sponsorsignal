(function(){
  const {jobTitleIssue,occupationWords,suggestionMode,resolvedOccupationTitle} =
    window.kysJobTitleLogic;
  const vacancyIntelligence = window.kysVacancyIntelligence;
  const occupationRanking = window.kysOccupationRanking;
  const ALERT_ENDPOINT =
    'https://assets.mailerlite.com/jsonp/2629594/forms/198316549786830205/subscribe';

  const ANALYTICS_HOSTS = new Set([
    'knowyoursponsor.co.uk', 'www.knowyoursponsor.co.uk'
  ]);
  const analyticsQueue = [];
  let analyticsTimer = null, analyticsAttempts = 0;
  let jobCheckStartedAt = 0, jobCompletionTracked = false;
  const communityPilot = new URLSearchParams(location.search).get('pilot') === 'community';
  const cosHistoryViews = new Set();
  function flushAnalytics(){
    if(!window.goatcounter || typeof window.goatcounter.count !== 'function') return false;
    while(analyticsQueue.length){
      try{ window.goatcounter.count(analyticsQueue.shift()); }
      catch(err){ analyticsQueue.length = 0; break; }
    }
    return true;
  }
  function trackEvent(path, title){
    if(!ANALYTICS_HOSTS.has(location.hostname)) return;
    window.kysProductMetrics?.record(path);
    analyticsQueue.push({path, title, event:true});
    if(flushAnalytics() || analyticsTimer) return;
    analyticsAttempts = 0;
    analyticsTimer = setInterval(()=>{
      analyticsAttempts++;
      if(flushAnalytics() || analyticsAttempts >= 40){
        clearInterval(analyticsTimer); analyticsTimer = null;
      }
    }, 250);
  }
  function trackJobStart(){
    jobCheckStartedAt = Date.now(); jobCompletionTracked = false;
    trackEvent('job_check_started','Job check started');
    if(communityPilot) trackEvent('community_pilot_check_started','Community pilot check started');
  }
  function trackJobCompletion(){
    if(jobCompletionTracked) return;
    jobCompletionTracked = true;
    trackEvent('job_evidence_created','Job evidence created');
    if(communityPilot) trackEvent('community_pilot_report_created','Community pilot report created');
    const seconds = (Date.now() - jobCheckStartedAt) / 1000;
    if(seconds < 60) trackEvent('job_check_completed_under_60s','Job check completed under 60 seconds');
    else if(seconds < 180) trackEvent('job_check_completed_under_3m','Job check completed under 3 minutes');
    else trackEvent('job_check_completed_over_3m','Job check completed over 3 minutes');
  }
  const PAGE = 50;
  let all = [], sponsorByKey = new Map(), sponsorRowsByName = new Map(), newNames = new Set(), filtered = [], shown = 0, loaded = false;
  let browseAllRequested = false, filtersRequested = false;
  let fullLoaded = false, fastKey = '', fastRequest = 0;
  let activeSearchAliases = new Map();
  const searchShardDocuments = new Map(), searchShardRequests = new Map();
  let sortBy = 'relevance';
  let addedRows = [], removedRows = [], view = '', windowDays = 7;
  let currentUpdated = '';
  let downgradedRows = [], ratingChanges = [];
  let licensedSince = {}, licensedBaseline = '';
  let employerPages = {};
  let employerPolicies = new Map();
  let namings = {};
  const comparing = new Set();

  const SAVED_KEY = 'kys.shortlist';
  const VISIT_KEY = 'kys.last-visit.v1';
  const SEARCH_KEY = 'kys.recent-searches.v1';
  const APPLICATION_KEY = 'kys.applications.v1';
  const APPLICATION_EVIDENCE_VERSION = 1;
  let saved = new Set();
  let sharedSaved = new Set();
  let previousVisit = null;
  let recentSearches = [];
  let applications = [];
  let jobEmployerRow = null;
  let checkedJob = null, jobFeedbackRecorded = false, jobFeedbackCategory = '';
  let jobSuggestions = [];
  let vacancyExtractionReview = null;
  let occupationData = null;
  let occupationRequest = null;
  let vacancyRulesets = null;
  let vacancyRulesetRequest = null;
  let occupationSuggestions = [];
  let selectedOccupation = null;
  let selectedOccupationCandidate = null;
  let jobSuggestionEvidence = new Map();
  try{
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    if(Array.isArray(raw)) saved = new Set(raw.filter(k => typeof k === 'string'));
    previousVisit = JSON.parse(localStorage.getItem(VISIT_KEY) || 'null');
    const searches = JSON.parse(localStorage.getItem(SEARCH_KEY) || '[]');
    if(Array.isArray(searches)) recentSearches = searches.slice(0,5);
    const storedApplications = JSON.parse(localStorage.getItem(APPLICATION_KEY) || '[]');
    if(Array.isArray(storedApplications)) applications = storedApplications
      .slice(0,100).map(normaliseStoredApplication).filter(Boolean);
  }catch(err){ /* corrupt or blocked: start empty rather than break */ }

  const savedKey = (name, town) => (name + '|' + town).toLowerCase();
  const visibleSaved = () => new Set([...saved, ...sharedSaved]);

  function refreshSavedCount(){
    const n = visibleSaved().size;
    document.getElementById('nSaved').textContent = n ? `(${n})` : '';
    document.getElementById('viewSaved').hidden = n === 0;
    document.getElementById('viewMobile').querySelector('[value="saved"]').hidden = n === 0;
    document.getElementById('shareShortlist').hidden = saved.size === 0;
    document.getElementById('monitorNudge').hidden = saved.size === 0;
    if(saved.size){
      document.getElementById('monitorNudgeCopy').textContent =
        `Your ${saved.size === 1 ? 'employer is' : saved.size + ' employers are'} saved privately in this browser. ` +
        'Watch checks up to 10 employers every day and emails material changes, even when you are away.';
    }
    // Leaving an empty Saved view selected would show the "nothing saved
    // yet" message under a tab that has just disappeared.
    if(!n && view === 'saved'){ setView(''); }
  }

  function toggleSaved(key){
    if(!key) return;
    const removing = saved.has(key);
    if(removing) saved.delete(key); else saved.add(key);
    persistSaved();
    refreshSavedCount();
    // Re-render so the star, the count and the Saved view all agree, and so
    // un-saving from inside the Saved view removes the row you just cleared.
    apply();
    syncSheetStar();
    const status = $('saveStatus');
    status.textContent = removing
      ? 'Removed from your shortlist.'
      : 'Saved. Choose “Saved shortlist” under Employer status to see it again.';
    status.hidden = false;
    clearTimeout(toggleSaved.timer);
    toggleSaved.timer = setTimeout(()=>{ status.hidden = true; }, 4500);
    if(!removing) trackEvent('shortlist_saved', 'Shortlist saved');
    recordVisitSnapshot();
  }

  function persistSaved(){
    try{
      localStorage.setItem(SAVED_KEY, JSON.stringify([...saved]));
    }catch(err){
      // Private browsing, or the quota is full. The shortlist still works
      // for this visit; it just will not survive a reload. Not worth an
      // error message the visitor can do nothing about.
    }
  }
  // Alert scope mirrors what someone is already looking at, until they set
  // it themselves. Asking again for something they just typed is friction.
  let alertTouched = false, knownTowns = new Set();

  // Companies House warnings, keyed by the employer's name exactly as the
  // register spells it. Loaded separately because it refreshes monthly while
  // the register refreshes daily, and because most employers have no warning.
  let companyFlags = {};
  let companyEvidenceUpdated = '', companyIdentityUpdated = '', cqcEvidenceUpdated = '';
  let cosHistoryExtracted = '', cosHistorySource = '', cosHistoryReference = '';
  let cosUsageYear = null, cosUsageThreshold = null;
  let cosUsageSource = '', cosUsageReference = '';
  // Legal-entity identities are split by the first employer-name character.
  // Only the shard for an opened employer is fetched, so this extra evidence
  // does not slow the initial search.
  const companyIdentities = new Map(), cqcProviders = new Map(), cosHistories = new Map();
  const cosUsageRecords = new Map();
  const identityRequests = new Map();
  let evidenceLoaded = false;
  // '' | 'any' | 'serious'. Two levels rather than a boolean, because the
  // hero card headlines the serious count and clicking it must show that
  // number, not a list four times longer padded out with late filings.
  let warnOnly = '';

  const CH_COMPANY = 'https://find-and-update.company-information.service.gov.uk/company/';

  // Most serious first. Only the worst one is shown on a row; the rest are
  // in the title, so a row never turns into a wall of red.
  //
  // The fourth column is how much it actually means, and it exists because
  // treating every flag alike said "9,501 employers with something worth
  // checking" when 4,905 of those were nothing but a late filing. Somebody
  // who opens three trivial warnings stops believing the fourth, and the
  // fourth is a liquidation. Must stay in step with FLAG_SEVERITY in
  // pipeline/companies.py; a test reads this table and checks that.
  const WARNINGS = [
    ['not_active', null, 'serious',
     'Companies House records this company as no longer active.'],
    ['dormant', 'Dormant', 'notable',
     'This company files accounts as dormant, meaning it reports no significant trading.'],
    ['accounts_overdue', 'Accounts overdue', 'notable',
     'This company has not filed its accounts by the due date.'],
    ['confirmation_statement_overdue', 'Filing overdue', 'context',
     'This company has not filed its confirmation statement by the due date.'],
    // The label is replaced with the exact age at render time, because
    // "incorporated 13 days ago" and "incorporated 11 months ago" are
    // different facts and this said "New company" for both. The youngest
    // sponsor on the register today is 13 days old.
    ['incorporated_recently', 'New company', 'context',
     'This company was incorporated within the last year.'],
  ];

  // Companies House status strings run to 48 characters. Truncating them
  // produced "Live but Receiver Man…", so the ones that actually occur get
  // a proper short label and anything unrecognised still degrades safely.
  const STATUS_LABEL = [
    [/proposal to strike off/i, 'Strike-off proposed'],
    [/voluntary arrangement/i,  'Voluntary arrangement'],
    [/receiver/i,               'Receiver appointed'],
    [/administration/i,         'Administration'],
    [/liquidation/i,            'Liquidation'],
    [/dissolved/i,              'Dissolved'],
  ];
  function shortStatus(status){
    const s = String(status || '');
    for(const [pattern, label] of STATUS_LABEL){
      if(pattern.test(s)) return label;
    }
    const plain = s.replace(/^Active\s*-\s*/i, '');
    return plain.length > 22 ? plain.slice(0, 21) + '…' : (plain || 'Not active');
  }

  // How old the company is. The twin of companies.describe_age() in
  // pipeline/companies.py, which does the same job for the static employer
  // pages. Two copies, deliberately: the alternative is shipping a
  // precomputed phrase per employer in a file rebuilt monthly, and "13 days
  // ago" would then be wrong by up to a month. This is date arithmetic
  // rather than name normalisation, so the two cannot drift in a way that
  // matters, and a test checks both exist.
  function ageDays(iso){
    if(!iso) return null;
    const started = new Date(iso + 'T00:00:00Z');
    if(isNaN(started)) return null;
    const days = Math.floor((Date.now() - started.getTime()) / 86400000);
    return days < 0 ? null : days;
  }

  function ageBadge(iso){
    const days = ageDays(iso);
    if(days === null) return '';
    if(days < 60) return days + (days === 1 ? ' day old' : ' days old');
    const months = Math.max(1, Math.round(days / 30.44));
    return months + (months === 1 ? ' month old' : ' months old');
  }

  function ageSentence(iso){
    const days = ageDays(iso);
    if(days === null) return '';
    // 60, matching companies.DAYS_IN_WORDS.
    if(days < 60){
      return 'This company was incorporated ' + days +
             (days === 1 ? ' day ago.' : ' days ago.');
    }
    const months = Math.max(1, Math.round(days / 30.44));
    return 'This company was incorporated ' + months +
           (months === 1 ? ' month ago.' : ' months ago.');
  }

  function warningFor(name){
    const record = companyFlags[name];
    if(!record || !record.flags || !record.flags.length) return null;
    for(const [flag, label, severity, explanation] of WARNINGS){
      if(!record.flags.includes(flag)) continue;
      const others = WARNINGS
        .filter(w => w[0] !== flag && record.flags.includes(w[0]))
        .map(w => w[3]);
      // "New company" said the same thing about 13 days and 11 months. The
      // exact age is the whole point of the signal, so it replaces the
      // generic label wherever we have the date.
      let shown = label || shortStatus(record.status);
      if(flag === 'incorporated_recently'){
        shown = ageBadge(record.incorporated) || shown;
      }
      return {
        label: shown,
        severity: severity,
        title: [explanation, ...others,
                'Source: Companies House. Click to check the record.'].join(' '),
        href: record.number ? CH_COMPANY + encodeURIComponent(record.number) : '',
      };
    }
    return null;
  }

  const $ = id => document.getElementById(id);
  const rows = $('rows');
  // A saved shortlist can reveal a paid monitoring prompt. Keep that prompt
  // after every visible result and the "Show more" control, never between the
  // search question and its evidence.
  $('more').after($('monitorNudge'));

  function esc(s){const d=document.createElement('span');d.textContent=s;return d.innerHTML;}

  // esc() is safe for element text but NOT for an attribute value: going
  // through textContent escapes < > & and leaves quotes alone. Ten employers
  // have a double quote in their name, e.g. '"K" Line Energy Shipping', and
  // building an attribute with esc() broke out of it, mangling the row and
  // leaving data-name empty so the row could not be opened.
  function attr(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const REVIEWED_SOURCE_ANOMALIES = new Set([
    'R983 Live Test', 'R983 Test V2', 'R983 Test V3'
  ]);
  function isReviewedSourceAnomaly(name){
    const wanted = String(name || '').trim().toLowerCase();
    for(const value of REVIEWED_SOURCE_ANOMALIES){
      if(value.toLowerCase() === wanted) return true;
    }
    return false;
  }

  function isReviewedSourceAnomalyKey(key){
    return isReviewedSourceAnomaly(String(key || '').split('|')[0]);
  }

  // Earlier releases allowed a reviewed source anomaly to be saved or
  // remembered as a search. Removing it from today's results is not enough:
  // browser-local history would otherwise promote it again in "What changed
  // since your last visit". Keep the raw source evidence, but migrate every
  // ordinary discovery surface to the same audit-only boundary.
  function purgeReviewedSourceAnomaliesFromBrowserState(){
    let savedChanged = false;
    for(const key of [...saved]){
      if(!isReviewedSourceAnomalyKey(key)) continue;
      saved.delete(key);
      savedChanged = true;
    }
    for(const key of [...sharedSaved]){
      if(isReviewedSourceAnomalyKey(key)) sharedSaved.delete(key);
    }
    if(previousVisit && previousVisit.employers){
      for(const [key, employer] of Object.entries(previousVisit.employers)){
        if(isReviewedSourceAnomalyKey(key) || isReviewedSourceAnomaly(employer && employer.name)){
          delete previousVisit.employers[key];
        }
      }
    }
    const ordinarySearches = recentSearches.filter(search=>
      !isReviewedSourceAnomaly(search && search.q));
    const searchesChanged = ordinarySearches.length !== recentSearches.length;
    recentSearches = ordinarySearches;
    try{
      if(savedChanged) localStorage.setItem(SAVED_KEY, JSON.stringify([...saved]));
      if(previousVisit) localStorage.setItem(VISIT_KEY, JSON.stringify(previousVisit));
      if(searchesChanged) localStorage.setItem(SEARCH_KEY, JSON.stringify(recentSearches));
    }catch(err){ /* Storage migration must not block public search. */ }
  }
  purgeReviewedSourceAnomaliesFromBrowserState();

  function ordinaryEvidenceRows(values){
    return (values || []).filter(row=>!isReviewedSourceAnomaly(row && row[0]));
  }

  function officialSourceWordingNote(name,town){
    const value = String(name || '').trim();
    const joinedWords = /[a-z][A-Z](?:Limited|Ltd)\b/.test(value);
    if(isReviewedSourceAnomaly(value)){
      return 'This name appears in the official sponsor register but may be a test or administrative record. KnowYourSponsor preserves it for auditability. Do not treat it as evidence of a real employer or vacancy without confirming it independently.';
    }
    if(joinedWords){
      return 'This sponsor name contains unusual spacing in the official register. We preserve the published wording rather than silently correcting or attaching it to a different legal entity.';
    }
    return '';
  }

  // "Global Business Mobility: Senior or Specialist Worker" is 52 characters
  // and forced the routes column wide enough to squash everything else. The
  // table shows the short form with the full name on hover; the detail panel
  // and the CSV keep the official wording.
  const ROUTE_SHORT = [["Global Business Mobility:", "GBM:"]];
  function shortRoute(name){
    let out = String(name || '');
    for(const [long, short] of ROUTE_SHORT) out = out.replace(long, short);
    return out;
  }

  const IDENTITY_ALIAS_LABELS = {
    legal_name:'current legal name',
    trading_name:'trading name shown in the sponsor record',
    company_number:'Companies House number'
  };
  function rowIdentityKey(row){
    return savedKey(row?.[0] || '',row?.[1] || '');
  }
  function setActiveSearchAliases(values){
    activeSearchAliases = new Map();
    for(const item of values || []){
      if(!Array.isArray(item) || item.length < 3 || !Array.isArray(item[2])) continue;
      const [term,kind,row] = item;
      const key = rowIdentityKey(row);
      if(!activeSearchAliases.has(key)) activeSearchAliases.set(key,[]);
      activeSearchAliases.get(key).push({term:String(term || ''),kind,row});
    }
  }
  function matchingIdentityAlias(row,words){
    if(!words.length) return null;
    const sponsorText = comparableEmployerName(row[0]);
    if(words.every(word=>sponsorText.includes(word))) return null;
    return (activeSearchAliases.get(rowIdentityKey(row)) || []).find(alias=>{
      const searchable = comparableEmployerName(alias.term);
      return words.every(word=>searchable.includes(word));
    }) || null;
  }
  function identityAliasHTML(row){
    const words = comparableEmployerName($('q').value).split(/\s+/).filter(Boolean);
    const alias = matchingIdentityAlias(row,words);
    if(!alias) return '';
    const label = IDENTITY_ALIAS_LABELS[alias.kind] || 'source-backed name';
    return '<span class="identity-search-hit"><strong>Found using ' +
      esc(label) + ':</strong> ' + esc(alias.term) +
      '. Confirm the sponsor name and town before relying on it.</span>';
  }

  function render(reset){
    if(reset){ rows.innerHTML=''; shown=0; }
    const slice = filtered.slice(shown, shown+PAGE);
    const focusedSingle = filtersActive() && filtered.length === 1;
    const html = slice.map(s=>{
      const [name,town,county,industry,routes,rating] = s;
      const sourceAnomaly = isReviewedSourceAnomaly(name);
      // 1,683 employers record the same place as both town and county,
      // which rendered as "London, London".
      const loc = [cleanPlace(town), cleanPlace(county)].filter(Boolean)
        .filter((v,i,a)=> a.findIndex(x=>x.toLowerCase()===v.toLowerCase())===i)
        .join(', ');
      // In the "just added" view every row is new, so the tag is only noise.
      const isNew = !sourceAnomaly && view === '' && newNames.has(name.toLowerCase());
      // A removed employer's last rating says nothing about today, and
      // showing "A" next to "no longer licensed" would contradict itself.
      const ratingCell = view === 'removed'
        ? '—'
        : (rating==='A' ? '<span class="rating-a">A</span>'
           : rating==='B' ? '<span class="rating-b">B</span>' : esc(rating||'—'));
      const warn = warningFor(name);
      const warnTag = warn
        ? (warn.href
            ? ` <a class="tag warn sev-${attr(warn.severity)}" href="${attr(warn.href)}" target="_blank"` +
              ` rel="noopener" title="${attr(warn.title)}">${esc(warn.label)}</a>`
            : ` <span class="tag warn sev-${attr(warn.severity)}" title="${attr(warn.title)}">${esc(warn.label)}</span>`)
        : '';
      const listedTag = focusedSingle && view !== 'removed'
        ? ' <span class="tag listed">On latest register</span>' : '';
      const companyRecord = companyFlags[name] || {};
      const identityTag = focusedSingle && evidenceLoaded && !sourceAnomaly
        ? (companyRecord.number
          ? ' <span class="tag listed">Company record linked</span>'
          : ' <span class="tag limitation">Company identity unresolved</span>')
        : '';
      const singleHelp = focusedSingle && sourceAnomaly
        ? '<p class="single-answer"><strong>Official-source anomaly</strong><span>This row is preserved because it appears in the official register. Confirm that it represents a real employer before relying on it.</span></p>' +
          '<span class="single-actions"><button class="view-evidence rowbtn" type="button" data-name="' + attr(name) + '">Review source record</button></span>'
        : focusedSingle
        ? '<p class="single-answer"><strong>Current sponsor record found</strong><span>This confirms the employer appears on the latest register. It does not confirm that this vacancy offers sponsorship.</span></p>' +
          '<span class="single-actions"><button class="view-evidence rowbtn" type="button" data-name="' + attr(name) + '">View evidence</button>' +
          '<button class="check-job-row" type="button" data-job-name="' + attr(name) + '">Check a job</button></span>'
        : '';
      const sourceNote = officialSourceWordingNote(name,town);
      const sourceTag = sourceNote
        ? ' <span class="tag limitation" title="' + attr(sourceNote) + '">' +
          (sourceAnomaly ? 'Official-source anomaly' : 'Source wording') + '</span>' : '';
    const statusTags = listedTag + identityTag + sourceTag + (isNew?' <span class="tag new">First observed</span>':'') + warnTag;
      const saveControl = sourceAnomaly ? '' :
        `<button class="star${saved.has(savedKey(name, town)) ? ' on' : ''}" type="button" data-save="${attr(savedKey(name, town))}"`+
          ` aria-pressed="${saved.has(savedKey(name, town))}"`+
          ` title="Save to your shortlist" aria-label="Save ${attr(cleanDisplayText(name))} to your shortlist">${saved.has(savedKey(name, town)) ? '&#9733;' : '&#9734;'}</button>`;
      return `<tr data-name="${attr(name)}">
        <td class="name">${saveControl}<button class="rowbtn" type="button" data-name="${attr(name)}">${esc(cleanDisplayText(name))}</button><span class="single-statuses">${statusTags}</span>${singleHelp}`+
          identityAliasHTML(s) +
          (sourceAnomaly ? '' : `<button class="compare-row${comparing.has(name) ? ' on' : ''}" type="button" data-compare="${attr(name)}" aria-pressed="${comparing.has(name)}">${comparing.has(name) ? 'Selected' : '+ Compare'}</button>`) + `</td>
        <td data-label="Location">${esc(loc)}</td>
        <td data-label="Estimated industry">${sourceAnomaly ? 'Not classified' : esc(industry)}</td>
        <td data-label="Visa routes">${routes.map(r=>`<span class="tag" title="${attr(r)}">${esc(shortRoute(r))}</span>`).join('')}</td>
        <td data-label="Rating">${ratingCell}</td>
      </tr>`;
    }).join('');
    rows.insertAdjacentHTML('beforeend', html);
    syncCompareUI();
    shown += slice.length;
    $('count').textContent = filtered.length.toLocaleString();
    $('resultNoun').textContent = filtered.length === 1 ? 'sponsor record found' : 'sponsor records found';
    $('sortField').hidden = filtered.length < 2;
    const dl = $('download');
    dl.disabled = !filtered.length;
    dl.textContent = filtered.length
      ? `Download ${filtered.length.toLocaleString()} as CSV`
      : 'Download as CSV';
    const active = filtersActive();
    const choosingFilters = filtersRequested && !active && !browseAllRequested;
    const showResults = active || browseAllRequested;
    $('filterbar').hidden = !active && !browseAllRequested && !filtersRequested;
    $('filterHint').hidden = !choosingFilters;
    $('resultsMeta').hidden = !showResults;
    $('empty').hidden = !showResults || filtered.length>0;
    if(!filtered.length) $('empty').innerHTML = emptyMessage();
    // Hide the table itself when there is nothing in it. A stranded header
    // row above the explanation reads as a failed load rather than as an
    // empty result, which is the opposite of what the message is saying.
    $('resultsTable').hidden = !showResults || !filtered.length;
    $('more').hidden = !showResults || shown >= filtered.length;
    $('clear').hidden = !filtersActive();
    mirrorScope();
  }

  // An empty view must explain itself. "No sponsors match" next to an empty
  // "lost licence" list reads as broken, when in fact it is good news.
  function emptyMessage(){
    if(warnOnly === 'serious'){
      return '<strong>No exact-name-linked company record has a serious non-active status here.</strong>' +
             '<br>That is the good outcome for this checked source. It is not proof that every employer is trading.';
    }
    if(warnOnly){
      return '<strong>No employers here have a company warning.</strong>' +
             '<br>That is the good outcome. Clear the warning filter to see ' +
             'everything again.';
    }
    if(!sourceRows().length){
      if(view === 'added'){
        return `<strong>No sponsor records were first observed in the last ${windowDays} days.</strong>` +
               `<br>The register does not change every day. Check back soon.`;
      }
      if(view === 'removed'){
        return `<strong>No sponsor records stopped appearing in the last ${windowDays} days.</strong>` +
               `<br>The comparison found no removals at exact name-and-town level.`;
      }
      if(view === 'saved'){
        return '<strong>You have not saved any employers yet.</strong>' +
               '<br>Tap the star next to any employer to add it here. It is ' +
               'kept on this device, with no account needed.';
      }
      if(view === 'downgraded'){
        return `<strong>No employer was downgraded to a B rating in the last ${windowDays} days.</strong>` +
               `<br>We check every day. Downgrades are uncommon, so an empty ` +
               `list here is the normal and the good outcome.`;
      }
    }
    return '<strong>Nothing matched that search.</strong>' +
           '<br>Try the employer\'s legal name, trading name or company number. You can also clear the filters.';
  }

  // Filtering without ranking buried what people asked for: a search for
  // "tesco" listed ATESCO CONSULTANCY and Notesco UK above Tesco Stores.
  // Lower rank sorts first. Ranked only when the query has narrowed things
  // enough for it to matter; above the cap, alphabetical is fine and sorting
  // a six-figure list on every keystroke is not.
  const RANK_LIMIT = 20000;

  function relevance(row, needle){
    const name = String(row[0]).toLowerCase();
    if(name === needle) return 0;
    const aliases = activeSearchAliases.get(rowIdentityKey(row)) || [];
    if(aliases.some(alias=>comparableEmployerName(alias.term) === needle)) return 1;
    if(name.startsWith(needle)) return 2;
    if(aliases.some(alias=>comparableEmployerName(alias.term).startsWith(needle))) return 3;
    // A word inside the name starting with the query, so "line" finds
    // "K Line" without also promoting "Airline". Done by scanning rather
    // than by building a RegExp, so the query never has to be escaped.
    let at = name.indexOf(needle);
    while(at !== -1){
      const before = at === 0 ? ' ' : name.charAt(at - 1);
      if(before < '0' || (before > '9' && before < 'a') || before > 'z'){
        return 4;
      }
      at = name.indexOf(needle, at + 1);
    }
    if(name.includes(needle)) return 5;
    if(aliases.some(alias=>comparableEmployerName(alias.term).includes(needle))) return 6;
    return 7;   // matched on town, county or industry only
  }

  function rankByRelevance(list, query){
    const needle = query.trim().toLowerCase();
    if(!needle || list.length > RANK_LIMIT) return list;
    return list
      .map((row, i) => [relevance(row, needle), i, row])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])   // stable within a rank
      .map(entry => entry[2]);
  }

  function cleanPlace(value){
    const text = String(value || '').trim();
    return /^(?:-+|(?:-+\s*)?select(?:\s+one)?(?:\s*-+)?|n\/?a|not\s+(?:given|stated)|unknown|null)$/i.test(text) ? '' : text;
  }

  function cleanDisplayText(value){
    const text = String(value || '');
    return text.replace(/\?+(?:�\?*)+/g, (run, offset, whole)=>{
      const before = offset ? whole.charAt(offset - 1) : '';
      const after = whole.charAt(offset + run.length);
      if(!before && /\s/.test(after)) return '';
      if(/\s/.test(before) && /\s/.test(after)) return '–';
      if(/[a-z0-9]/i.test(before) && (after.toLowerCase() === 's' || /\s/.test(after))) return '’';
      return run;
    }).trim();
  }

  function sortRows(list, query){
    if(sortBy === 'relevance') return rankByRelevance(list, query);
    const column = {name:0, location:1, industry:3, rating:5}[sortBy];
    return list.slice().sort((a,b)=>{
      const left = String(a[column]||''), right = String(b[column]||'');
      if(sortBy === 'name'){
        const leftPoor = /�|\?{2,}/.test(left) || !/^[a-z]/i.test(cleanDisplayText(left));
        const rightPoor = /�|\?{2,}/.test(right) || !/^[a-z]/i.test(cleanDisplayText(right));
        if(leftPoor !== rightPoor) return leftPoor ? 1 : -1;
      }
      return left.localeCompare(right, 'en-GB', {sensitivity:'base'});
    });
  }

  // Removed employers are not in the main register any more, so the views
  // swap the underlying list rather than filtering it.
  function sourceRows(){
    if(view === 'added') return addedRows;
    if(view === 'removed') return removedRows;
    if(view === 'downgraded') return downgradedRows;
    if(view === 'saved'){
      const keys = visibleSaved();
      return all.filter(s => keys.has(savedKey(s[0], s[1])));
    }
    return all;
  }

  // A facet is calculated against every active constraint except itself.
  // That means choosing Croydon and Security & Facilities only offers visa
  // routes which can actually return an employer. The selected value stays
  // visible with a zero count when another control makes it unavailable, so
  // the page never silently changes a visitor's search.
  function matchesFilters(row, words, omit){
    if(warnOnly){
      const warning = warningFor(row[0]);
      if(!warning) return false;
      if(warnOnly === 'serious' && warning.severity !== 'serious') return false;
    }
    if(omit !== 'city' && $('city').value && row[1] !== $('city').value)
      return false;
    if(omit !== 'industry' && $('industry').value && row[3] !== $('industry').value)
      return false;
    if(omit !== 'route' && $('route').value && !row[4].includes($('route').value))
      return false;
    if(words.length){
      const aliases = (activeSearchAliases.get(rowIdentityKey(row)) || [])
        .map(alias=>alias.term).join(' ');
      const hay = (row[0]+' '+row[1]+' '+row[2]+' '+row[3]+' '+aliases).toLowerCase();
      if(!words.every(word=>hay.includes(word))) return false;
    }
    return true;
  }

  function replaceFacetOptions(id, emptyLabel, counts, total, limit){
    const select = $(id);
    const selected = select.value;
    let entries = [...counts.entries()];
    if(limit){
      entries.sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0], 'en-GB'));
      entries = entries.slice(0, limit);
    }
    entries.sort((a,b)=>a[0].localeCompare(b[0], 'en-GB'));

    // A selected location can fall outside the top 60 after another facet
    // changes. Keep it at the top, including when its new count is zero.
    if(selected && !entries.some(([value])=>value === selected))
      entries.unshift([selected, counts.get(selected) || 0]);

    select.replaceChildren();
    select.add(new Option(`${emptyLabel} (${total.toLocaleString()})`, ''));
    for(const [value,count] of entries){
      select.add(new Option(`${value} (${count.toLocaleString()})`, value));
    }
    select.value = selected;
  }

  function updateFacets(words){
    if(!fullLoaded) return;
    const rows = sourceRows();
    for(const [id,label,column,limit] of [
      ['city','Any town or city',1,60],
      ['industry','All industries',3,0],
      ['route','All visa routes',4,0],
    ]){
      const candidates = rows.filter(row=>matchesFilters(row, words, id));
      const counts = new Map();
      for(const row of candidates){
        const values = id === 'route' ? new Set(row[column] || [])
                     : [row[column]];
        for(const value of values){
          if(value) counts.set(value, (counts.get(value) || 0) + 1);
        }
      }
      replaceFacetOptions(id, label, counts, candidates.length, limit);
    }
  }

  function apply(){
    // Typing is allowed before the register arrives; filtering an empty
    // array would just flash "no sponsors match". The load handler calls
    // apply() again once the data is in, honouring whatever was typed.
    if(!loaded){ requestFastPreview(); return; }
    const q = $('q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);

    // Before the complete register arrives, the small deployment-generated
    // shard can answer employer-name searches accurately. Town, industry,
    // route and warning filters wait for the complete register because a
    // partial answer to those would look complete while silently omitting
    // employers.
    if(!fullLoaded){
      const key = quickShardKey(q.join(' ') || 'a');
      if(key !== fastKey){ requestFastPreview(); return; }
      filtered = all.filter(row=>{
        if(isReviewedSourceAnomaly(row[0])) return false;
        const name = String(row[0] || '').toLowerCase();
        return q.every(word=>name.includes(word));
      });
      filtered = sortRows(filtered, $('q').value);
      updateSearchPresentation(filtered.length);
      render(true);
      return;
    }
    filtered = sourceRows().filter(row=>
      !isReviewedSourceAnomaly(row[0]) && matchesFilters(row, q, ''));
    updateFacets(q);
    filtered = sortRows(filtered, $('q').value);
    updateSearchPresentation(filtered.length);
    render(true);
    $('alertSearch').hidden = !($('city').value || $('industry').value ||
      $('route').value);
    renderVisitChanges();
  }

  // Prefill the alert scope from the current search, so someone who just
  // searched "healthcare Manchester" is offered alerts for exactly that.
  function mirrorScope(){
    if(alertTouched) return;
    const ind = $('industry').value;
    if(ind) $('alertIndustry').value = ind;
    const route = $('route').value;
    if(route) $('alertRoute').value = route;
    // The city filter is the reliable signal. A typed search term only
    // counts when it names a town we actually offer alerts for.
    const typed = $('q').value.trim().toLowerCase();
    const want = $('city').value || (knownTowns.has(typed) ? typed : '');
    if(!want) return;
    for(const opt of $('alertCity').options){
      if(opt.value.toLowerCase() === want.toLowerCase()){
        $('alertCity').value = opt.value; return;
      }
    }
  }

  // ----------------------------------------------------- detail sheet --
  const RATING_NOTE = {
    A: 'A-rated on the latest Home Office register. This is not an endorsement of the employer or a vacancy.',
    B: 'Downgraded and working through an action plan. Employers on a B ' +
       'rating usually cannot issue new certificates until they return to an A.',
  };
  let sheetOpener = null;   // so focus can go back where it came from
  // The row the sheet is showing, so the save button knows what to toggle.
  let sheetRow = null;

  // "2026-09-01" -> "1 September 2026". Built from the parts rather than
  // through Date(), which would shift the day in western time zones.
  const MONTHS = ['January','February','March','April','May','June','July',
                  'August','September','October','November','December'];
  function longDate(iso){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if(!m) return String(iso || '');
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  }

  function readableTimestamp(value){
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value || ''));
    if(!match) return String(value || '');
    const date = `${Number(match[3])} ${MONTHS[Number(match[2]) - 1].slice(0,3)} ${match[1]}`;
    return match[4] ? `${date} at ${match[4]}:${match[5]} UTC` : date;
  }

  const EVIDENCE_DATES = [
    ['company_ceased_on', 'Company ceased'],
    ['dormant_period_end', 'Dormant accounts period ended'],
    ['accounts_due_on', 'Accounts were due'],
    ['confirmation_due_on', 'Confirmation statement was due'],
  ];
  function evidenceTimeline(record){
    const dates = (record && record.dates) || {};
    const items = EVIDENCE_DATES
      .filter(([key])=>dates[key])
      .map(([key,label])=>`<li><strong>${esc(longDate(dates[key]))}</strong> — ${esc(label)}</li>`);
    if(!items.length) return '';
    return '<div class="block evidence-timeline"><h3>Dated evidence</h3><ul>' +
      items.join('') + '</ul><p class="caveat">The dormant date is the ' +
      'accounts period end, not the date the document was filed.</p></div>';
  }

  const EVIDENCE_KIND_LABELS = {
    official:'Official', derived:'Derived', employer:'Employer provided', unknown:'Unknown', user:'Your input'
  };
  function evidenceKind(kind){
    const safe = Object.prototype.hasOwnProperty.call(EVIDENCE_KIND_LABELS,kind)
      ? kind : 'unknown';
    return '<span class="evidence-kind ' + safe + '">' +
      EVIDENCE_KIND_LABELS[safe] + '</span>';
  }

  function employerPolicyFor(row){
    const policy = row ? employerPolicies.get(savedKey(row[0],row[1])) || null : null;
    return policy && policy.status === 'current' && Date.parse(policy.expiresAt) >= Date.now() ? policy : null;
  }

  function employerPolicyHTML(row){
    const policy = employerPolicyFor(row);
    if(!policy) return '';
    const statement = policy.statement === 'considers'
      ? 'Currently considers sponsorship' : policy.statement === 'not_currently_considering'
        ? 'Not currently considering sponsorship' : 'Sponsorship is role-dependent';
    const scope = [policy.routes && policy.routes.join(', '),policy.departments,policy.occupations,policy.locations,
      policy.graduatePolicy && policy.graduatePolicy !== 'not_stated' ? 'Graduate policy: ' + policy.graduatePolicy.replaceAll('_',' ') : '',
      policy.switchingPolicy && policy.switchingPolicy !== 'not_stated' ? 'Visa switching: ' + policy.switchingPolicy.replaceAll('_',' ') : '',
      Number.isFinite(policy.minimumSalaryGbp) ? 'Internal minimum salary: £' + Number(policy.minimumSalaryGbp).toLocaleString('en-GB') : '']
      .filter(Boolean).map(esc).join(' · ');
    return '<div class="block employer-policy-evidence"><h3>Employer-provided sponsorship policy ' +
      evidenceKind('employer') + '</h3><p><strong>' + esc(statement) + '.</strong></p>' +
      (scope ? '<p>' + scope + '</p>' : '') + (policy.policyNote ? '<p>' + esc(policy.policyNote) + '</p>' : '') +
      '<p>Verified ' + esc(readableTimestamp(policy.verifiedAt)) + ' · expires ' + esc(readableTimestamp(policy.expiresAt)) +
      '.</p><p><a href="' + attr(policy.officialUrl) + '" target="_blank" rel="noopener">Check the employer source</a>' +
      (policy.candidateContactUrl ? ' · <a href="' + attr(policy.candidateContactUrl) + '" target="_blank" rel="noopener">Contact the employer</a>' : '') +
      '</p><p class="caveat">' +
      esc(policy.limitation) + '</p></div>';
  }
  function evidenceClaimModel(kind,label,value,meta,details={}){
    const safeKind = Object.prototype.hasOwnProperty.call(EVIDENCE_KIND_LABELS,kind)
      ? kind : 'unknown';
    return {
      kind:safeKind, label:String(label || ''), value:String(value || ''),
      meta:String(meta || ''), sourceName:String(details.sourceName || ''),
      sourceUrl:String(details.sourceUrl || ''), checkedAt:String(details.checkedAt || ''),
      matchBasis:String(details.matchBasis || ''), coverage:String(details.coverage || ''),
      limitation:String(details.limitation || '')
    };
  }
  function renderEvidenceClaim(claim){
    return '<div class="evidence-claim">' + evidenceKind(claim.kind) +
      '<div class="evidence-claim-copy"><strong>' + esc(claim.label) + ': ' +
      claim.value + '</strong>' + (claim.meta ? '<span>' + claim.meta + '</span>' : '') +
      '</div></div>';
  }
  function evidenceClaim(kind,label,value,meta,details){
    return renderEvidenceClaim(evidenceClaimModel(kind,label,value,meta,details));
  }
  function companyCorrectionHref(name,identity){
    const number = identity && identity.number || 'Identity unresolved';
    const basis = identity && identity.match_basis === 'previous_name'
      ? 'Exact former-name match'
      : identity && identity.state === 'identified'
        ? 'Exact current-name match'
        : identity && identity.state === 'ambiguous'
          ? 'Several possible Companies House records'
          : 'No safe Companies House match';
    const body = 'Employer: ' + name + '\n' +
      'Companies House number shown: ' + number + '\n' +
      'Match shown: ' + basis + '\n' +
      'Page: ' + location.href + '\n\n' +
      'What looks wrong?\n\n' +
      'Correct Companies House record or supporting link:\n';
    return 'mailto:hello@knowyoursponsor.co.uk?subject=' +
      encodeURIComponent('Priority identity correction: ' + name) +
      '&body=' + encodeURIComponent(body);
  }
  function companyIdentityPassport(name,identity){
    const checked = companyIdentityUpdated
      ? readableTimestamp(companyIdentityUpdated) : '';
    let state = 'unmatched';
    let label = 'Coverage gap';
    let title = 'No safe company match found';
    let detail = 'The sponsor record remains available, but company facts are withheld because no reliable Companies House identity was attached.';
    let facts = '<div><span>Match basis</span><strong>None</strong></div>';
    let official = '';
    if(identity && identity.state === 'identified'){
      state = 'identified';
      label = 'Exact-name match';
      const previous = identity.match_basis === 'previous_name';
      title = previous
        ? 'Linked through an exact former legal name'
        : 'Linked through an exact current legal name';
      detail = previous
        ? 'Companies House records the sponsor name as a former legal name. Check the current legal name before relying on attached company facts.'
        : 'The sponsor name matches the current Companies House legal name. This supports the link, but it is not a verdict about the employer.';
      facts = '<div><span>Match basis</span><strong>' +
        (previous ? 'Exact former name' : 'Exact current name') + '</strong></div>' +
        '<div><span>Company number</span><strong>' + esc(identity.number) + '</strong></div>' +
        (identity.legal_name
          ? '<div><span>Legal name</span><strong>' + esc(identity.legal_name) + '</strong></div>'
          : '');
      official = '<a href="' + CH_COMPANY + encodeURIComponent(identity.number) +
        '" target="_blank" rel="noopener">View official company record</a>';
    }else if(identity && identity.state === 'ambiguous'){
      state = 'ambiguous';
      label = 'Not confirmed';
      title = 'Several company records may fit';
      detail = 'We have not chosen one because that could attach the wrong company history or warning to this sponsor.';
      facts = '<div><span>Match basis</span><strong>Ambiguous name</strong></div>';
    }
    if(checked){
      facts += '<div><span>Evidence checked</span><strong>' + esc(checked) + '</strong></div>';
    }
    return '<section class="identity-passport ' + state +
      '" aria-label="Company identity evidence"><div class="identity-passport-head">' +
      '<div><span class="identity-passport-kicker">Company identity</span><h3>' +
      esc(title) + '</h3></div><span class="identity-passport-status">' +
      esc(label) + '</span></div><p>' + esc(detail) + '</p>' +
      '<div class="identity-passport-facts">' + facts + '</div>' +
      '<div class="identity-passport-actions">' + official +
      '<a href="' + attr(companyCorrectionHref(name,identity)) +
      '">Report the wrong company match</a></div></section>';
  }
  function employerEvidenceReceipt(row,identity,record,cqc,cosHistory,cosUsage){
    const name = row[0], town = row[1], rating = row[5];
    const sourceAnomaly = isReviewedSourceAnomaly(name);
    const registerUrl = 'https://www.gov.uk/government/publications/' +
      'register-of-licensed-sponsors-workers';
    const listed = all.some(s=>savedKey(s[0],s[1])===savedKey(name,town));
    const claims = [evidenceClaim('official','Sponsor register',
      listed ? 'Present · ' + esc(rating || 'rating not published') + ' rating' : 'Not present in the latest snapshot',
      '<a href="' + registerUrl + '" target="_blank" rel="noopener">GOV.UK source</a>' +
      (currentUpdated ? ' · source dated ' + esc(readableTimestamp(currentUpdated)) : ''))];
    if(sourceAnomaly){
      claims.push(evidenceClaim('unknown','Employer identity','Not assessed',
        'Automated company and employer matching is deliberately disabled for this reviewed source anomaly.'));
    }else if(identity && identity.state === 'identified'){
      const basis = identity.match_basis === 'previous_name'
        ? 'Companies House records the sponsor name as a former legal name'
        : 'the sponsor name matches the current Companies House legal name';
      claims.push(evidenceClaim('derived','Legal-entity match',
        'Company ' + esc(identity.number),
        'Matched because ' + basis + '. Verify before relying on attached company facts.' +
        (companyIdentityUpdated ? ' Match data dated ' + esc(readableTimestamp(companyIdentityUpdated)) + '.' : '')));
      claims.push(evidenceClaim('official','Company status',esc(identity.status || 'Not recorded'),
        '<a href="' + CH_COMPANY + encodeURIComponent(identity.number) + '" target="_blank" rel="noopener">Companies House record</a>' +
        (companyIdentityUpdated ? ' · source dated ' + esc(readableTimestamp(companyIdentityUpdated)) : '')));
    }else if(identity && identity.state === 'ambiguous'){
      claims.push(evidenceClaim('unknown','Legal-entity match','Ambiguous',
        'Several company records may fit. None was attached because choosing one could transfer the wrong history.'));
    }else{
      claims.push(evidenceClaim('unknown','Legal-entity match','Not safely matched',
        'Sponsor-register evidence remains available; missing company evidence is not an all-clear.'));
    }
    if(cqc && cqc.state === 'identified'){
      claims.push(evidenceClaim('derived','Care-provider match',esc(cqc.provider_id),
        'Exact provider-name match to CQC.' +
        (cqcEvidenceUpdated ? ' CQC source dated ' + esc(readableTimestamp(cqcEvidenceUpdated)) + '.' : '') +
        ' This is separate from sponsor licensing.'));
    }else if(cqc && cqc.state === 'ambiguous'){
      claims.push(evidenceClaim('unknown','Care-provider match','Ambiguous',
        'More than one CQC provider shares this name; no provider was attached.'));
    }
    if(cosHistory){
      const source = cosHistorySource
        ? '<a href="' + attr(cosHistorySource) + '" target="_blank" rel="noopener">' +
          esc(cosHistoryReference || 'Home Office FOI') + '</a>'
        : esc(cosHistoryReference || 'Home Office FOI');
      claims.push(evidenceClaim('derived','Historical CoS name link',
        'One exact current-register name',
        'The counts are official data. Linking that historical name to this current ' +
        'listing is our exact-name match. ' + source + '.'));
    }
    if(cosUsage){
      const source = cosUsageSource
        ? '<a href="' + attr(cosUsageSource) + '" target="_blank" rel="noopener">' +
          esc(cosUsageReference || 'Home Office FOI') + '</a>'
        : esc(cosUsageReference || 'Home Office FOI');
      claims.push(evidenceClaim('derived','2025 CoS use name link',
        'One exact current-register name',
        'The counts are official data labelled CoS used. The source publishes ' +
        'only employer-route counts of ' + esc(String(cosUsageThreshold || 5)) +
        ' or more. Linking the historical name to this listing is our exact-name match. ' +
        source + '.'));
    }
    if(record && warningFor(name)){
      claims.push(evidenceClaim('derived','Company warning',esc(warningFor(name).label),
        'Calculated from the dated Companies House fields shown below; it is evidence to inspect, not a verdict.' +
        (companyEvidenceUpdated ? ' Source data dated ' + esc(readableTimestamp(companyEvidenceUpdated)) + '.' : '')));
    }
    return '<section class="evidence-receipt" aria-label="Evidence receipt">' +
      '<div class="evidence-receipt-head"><strong>Evidence receipt</strong>' +
      '<span>Facts, joins and gaps kept separate</span></div>' +
      (sourceAnomaly ? '' : companyIdentityPassport(name,identity)) +
      '<div class="evidence-claims">' + claims.join('') + '</div></section>';
  }

  function employerEvidenceModel(row,identity,record,cqc,cosHistory,cosUsage,started){
    const listed = all.some(s=>savedKey(s[0],s[1])===savedKey(row[0],row[1]));
    const sourceAnomaly = isReviewedSourceAnomaly(row[0]);
    const available = [{kind:'official', label:'Current sponsor position',
      detail:sourceAnomaly
        ? 'This wording is present in the latest official snapshot and is retained as source evidence.'
        : listed
        ? 'The employer and published visa routes appear in the latest register snapshot.'
        : 'The listing does not appear in the latest register snapshot.'}];
    const unknowns = listed ? [
      'Whether a current vacancy offers sponsorship.',
      'The occupation code and salary test for a specific role.',
      'Whether the employer is currently hiring.'
    ] : [
      'Why the listing is no longer present; the sponsor register does not publish the reason.'
    ];
    if(sourceAnomaly){
      unknowns.unshift('Whether this wording represents a real operating employer or vacancy.');
    }
    if(started || licensedBaseline){
      available.push({kind:'derived', label:'Observed register history',
        detail:started
          ? 'KnowYourSponsor observed this listing enter the register on ' + longDate(started) + '.'
          : 'The listing was already present when daily tracking began on ' + longDate(licensedBaseline) + '.'});
    }
    if(identity && identity.state === 'identified'){
      available.push({kind:'derived', label:'Company identity',
        detail:'A Companies House record is attached using an exact ' +
          (identity.match_basis === 'previous_name' ? 'former-name' : 'current-name') + ' match.'});
    }else{
      unknowns.push(sourceAnomaly
        ? 'Whether this wording belongs to any operating legal entity.'
        : identity && identity.state === 'ambiguous'
        ? 'Which Companies House legal entity belongs to this sponsor; several records may fit.'
        : 'Which Companies House legal entity belongs to this sponsor listing.');
    }
    if(cqc && cqc.state === 'identified'){
      available.push({kind:'derived', label:'Care-provider identity',
        detail:'An exact provider-name match points to a CQC record for separate verification.'});
    }else if(cqc && cqc.state === 'ambiguous'){
      unknowns.push('Which CQC provider record, if any, belongs to this sponsor.');
    }
    if(cosHistory){
      available.push({kind:'derived', label:'Historical CoS disclosure',
        detail:'Official 2021–2024 counts are linked to this listing by exact sponsor name.'});
    }
    if(cosUsage){
      available.push({kind:'derived', label:'2025 CoS use disclosure',
        detail:'A thresholded official disclosure is linked by exact sponsor name.'});
    }
    if(!cosHistory && !cosUsage){
      unknowns.push('Historical CoS activity for this exact sponsor name; no exact-name-linked disclosure is attached, which is unknown rather than zero.');
    }
    if(record && warningFor(row[0])){
      available.push({kind:'derived', label:'Company-record signal',
        detail:'A dated Companies House signal is available to inspect; it is not a verdict.'});
    }
    return {available, unknowns};
  }

  function employerIntelligenceSummary(model,listingPresent,checked,sourceAnomaly=false){
    const supporting = model.available.filter(item=>item.label !== 'Current sponsor position');
    const available = supporting
      .map(item=>'<li>' + evidenceKind(item.kind) +
      '<div><strong>' + esc(item.label) + '</strong><span>' + esc(item.detail) +
      '</span></div></li>').join('');
    const unknowns = model.unknowns
      .filter(item=>item !== 'Whether a current vacancy offers sponsorship.')
      .map(item=>'<li>' + evidenceKind('unknown') +
      '<span>' + esc(item) + '</span></li>').join('');
    return '<section class="intelligence-summary" aria-label="Employer evidence profile">' +
      '<div class="intelligence-summary-head"><div><span>Employer evidence profile</span>' +
      '<div class="intelligence-verdict"><h3>' +
      (sourceAnomaly ? 'Official-source anomaly in the latest register' :
       listingPresent ? 'Present in the latest sponsor register' :
        'Not present in the latest sponsor register') + '</h3>' + evidenceKind('official') +
      '</div><p>' +
      (checked ? 'Checked ' + esc(checked) + '. ' : '') +
      'Confirm against the official source before acting.</p></div><strong>Current register status + ' +
      supporting.length + ' supporting evidence area' + (supporting.length === 1 ? '' : 's') +
      '</strong></div><div class="sponsorship-boundary" aria-label="Licence and vacancy distinction">' +
      '<div>' + evidenceKind('official') + '<span><strong>Register record</strong>' +
      (sourceAnomaly ? 'Present as published; the operating employer is not verified.' :
       listingPresent ? 'Current sponsor record found.' : 'No current sponsor record found.') + '</span></div>' +
      '<div>' + evidenceKind(listingPresent ? 'unknown' : 'official') + '<span><strong>This vacancy</strong>' +
      (sourceAnomaly ? 'Do not infer a real vacancy or sponsorship offer from this record.' :
       listingPresent ? 'Sponsorship is not confirmed by the register. Check the specific role.' :
        'This listing cannot currently sponsor a vacancy.') + '</span></div></div>' +
      '<div class="intelligence-grid"><div><h4>Supporting evidence</h4>' +
      '<ul>' + (available || '<li><span>No additional public evidence is safely attached.</span></li>') +
      '</ul></div><div class="intelligence-unknown"><h4>Still unknown</h4>' +
      '<ul>' + unknowns + '</ul></div></div><p>Coverage describes source availability, ' +
      'not the chance of sponsorship. Missing evidence is never treated as a negative finding.</p></section>';
  }

  function cosCountHTML(value){
    if(value === '*'){
      return '<strong>1&ndash;5</strong><span>Exact count withheld</span>';
    }
    if(typeof value === 'number'){
      return '<strong>' + value.toLocaleString('en-GB') + '</strong>';
    }
    return '<strong aria-label="No count shown">&mdash;</strong>';
  }

  function cosRouteHTML(label,record){
    if(!Array.isArray(record) || record.length !== 6) return '';
    const years = [2021,2022,2023,2024];
    const cells = years.map((year,index)=>
      '<div class="cos-year" role="listitem"><span>' + year + '</span>' +
      cosCountHTML(record[index]) + '</div>').join('');
    const minimum = record[4], maximum = record[5];
    const total = minimum === maximum
      ? Number(minimum).toLocaleString('en-GB')
      : Number(minimum).toLocaleString('en-GB') + '\u2013' +
        Number(maximum).toLocaleString('en-GB');
    const totalLabel = minimum === maximum ? 'Recorded total' : 'Safe total range';
    return '<section class="cos-route"><div class="cos-route-head"><strong>' +
      esc(label) + '</strong><span>' + esc(totalLabel) + ' <b>' + esc(total) +
      '</b></span></div><div class="cos-years" role="list" aria-label="' +
      attr(label) + ' assignments by year">' + cells + '</div></section>';
  }

  function cosHistoryHTML(history){
    if(!history) return '';
    const routes = [
      cosRouteHTML('Skilled Worker',history.skilled_worker),
      cosRouteHTML('Global Business Mobility and Intra-Company Transfer',
        history.gbm_ict),
    ].filter(Boolean).join('');
    if(!routes) return '';
    const source = cosHistorySource
      ? '<a href="' + attr(cosHistorySource) + '" target="_blank" rel="noopener" data-cos-source>' +
        esc(cosHistoryReference || 'Home Office FOI') + '</a>'
      : esc(cosHistoryReference || 'Home Office FOI');
    const extracted = cosHistoryExtracted
      ? ' Data extracted ' + esc(longDate(cosHistoryExtracted)) + '.' : '';
    return '<div class="block cos-history"><h3>Historical CoS assignments</h3>' +
      '<p class="cos-intro">The Home Office recorded these Certificates of ' +
      'Sponsorship under this exact employer name. They are assignments, not ' +
      'workers or visa grants.</p>' + routes +
      '<p class="caveat"><strong>Historical evidence only.</strong> It does not ' +
      'show current vacancies or whether this employer will sponsor you. Small ' +
      'counts are shown as 1&ndash;5 because the Home Office withheld the exact ' +
      'value. An exact name link does not prove that the legal entity stayed ' +
      'the same throughout this period. ' + source + '.' + extracted + '</p></div>';
  }

  function cosUsageHTML(record){
    if(!record || typeof record !== 'object') return '';
    const routes = [
      ['Skilled Worker and Tier 2',record.skilled_worker],
      ['Global Business Mobility and Intra-Company Transfer',record.gbm_ict],
    ].filter(item=>Number.isInteger(item[1]) && item[1] >= 5).map(item=>
      '<section class="cos-route cos-usage-route"><div class="cos-route-head"><strong>' +
      esc(item[0]) + '</strong><span>CoS used in ' + esc(String(cosUsageYear || 2025)) +
      '<b>' + Number(item[1]).toLocaleString('en-GB') + '</b></span></div></section>'
    ).join('');
    if(!routes) return '';
    const source = cosUsageSource
      ? '<a href="' + attr(cosUsageSource) + '" target="_blank" rel="noopener" data-cos-source>' +
        esc(cosUsageReference || 'Home Office FOI') + '</a>'
      : esc(cosUsageReference || 'Home Office FOI');
    return '<div class="block cos-history"><h3>2025 CoS use disclosure</h3>' +
      '<p class="cos-intro">The Home Office published these counts under this exact employer name. ' +
      'The source labels them as CoS used. We keep them separate from the 2021–2024 assignment history.</p>' +
      routes + '<p class="caveat"><strong>Thresholded disclosure.</strong> Only employer-route counts of ' +
      esc(String(cosUsageThreshold || 5)) + ' or more are included. A route not shown is unknown, not zero. ' +
      'The counts do not identify workers, visa grants, occupations or current vacancies. Figures came from ' +
      'a live operational database and may change. ' + source + '.</p></div>';
  }

  // Alternatives are drawn only from today's register. Similarity is based
  // on the details the Home Office publishes, not a hidden safety score:
  // shared route is required, then place and industry decide the order.
  function similarSponsors(row, limit=4){
    const [name, town, county, industry, routes] = row;
    if(isReviewedSourceAnomaly(name)) return [];
    const sourceName = comparableEmployerName(name);
    const sourceTown = cleanPlace(town).toLowerCase();
    const sourceCounty = cleanPlace(county).toLowerCase();
    const sourceIndustry = String(industry || '').trim().toLowerCase();
    const usefulIndustry = sourceIndustry &&
      sourceIndustry !== 'other' && sourceIndustry !== 'unknown';
    const sourceRoutes = new Set((routes || []).map(route=>
      String(route).trim().toLowerCase()).filter(Boolean));
    const bestByEmployer = new Map();

    for(const candidate of all){
      const [otherName, otherTown, otherCounty, otherIndustry, otherRoutes] = candidate;
      if(isReviewedSourceAnomaly(otherName)) continue;
      const employerKey = comparableEmployerName(otherName);
      if(!employerKey || employerKey === sourceName) continue;

      const candidateRoutes = (otherRoutes || []).map(route=>String(route).trim());
      const sharedRoutes = candidateRoutes.filter(route=>
        sourceRoutes.has(route.toLowerCase()));
      if(sourceRoutes.size && !sharedRoutes.length) continue;

      const sameTown = Boolean(sourceTown) &&
        cleanPlace(otherTown).toLowerCase() === sourceTown;
      const sameCounty = Boolean(sourceCounty) &&
        cleanPlace(otherCounty).toLowerCase() === sourceCounty;
      const sameIndustry = Boolean(usefulIndustry) &&
        String(otherIndustry || '').trim().toLowerCase() === sourceIndustry;
      if(!sameTown && !sameCounty && !sameIndustry) continue;

      const recentlyLicensed = newNames.has(String(otherName).toLowerCase());
      const warning = warningFor(otherName);
      let score = (sameTown ? 9 : 0) + (sameIndustry ? 6 : 0) +
        (sameCounty ? 2 : 0) + Math.min(sharedRoutes.length, 2) * 3 +
        (recentlyLicensed ? 1 : 0);
      // A serious filing signal is still visible if the match is useful,
      // but it should not be the first alternative we put in front of someone.
      if(warning && warning.severity === 'serious') score -= 8;

      const reasons = [];
      if(sameTown) reasons.push('Same town or city');
      else if(sameCounty) reasons.push('Same county');
      if(sameIndustry) reasons.push('Same industry');
      if(sharedRoutes.length === 1){
        reasons.push(shortRoute(sharedRoutes[0]) + ' route');
      }else if(sharedRoutes.length > 1){
        reasons.push(sharedRoutes.length + ' shared visa routes');
      }
      if(recentlyLicensed) reasons.push('Recently licensed');

      const match = {row:candidate, score, reasons, warning};
      const previous = bestByEmployer.get(employerKey);
      if(!previous || previous.score < score) bestByEmployer.set(employerKey, match);
    }

    return [...bestByEmployer.values()]
      .sort((a,b)=>b.score-a.score ||
        cleanDisplayText(a.row[0]).localeCompare(cleanDisplayText(b.row[0])))
      .slice(0, limit);
  }

  function similarSponsorsHTML(row){
    const matches = similarSponsors(row);
    if(!matches.length) return '';
    const cards = matches.map(match=>{
      const [name, town, county, industry] = match.row;
      const location = [cleanPlace(town), cleanPlace(county)].filter(Boolean)
        .filter((value,index,list)=>list.findIndex(item=>
          item.toLowerCase()===value.toLowerCase())===index).join(', ');
      const key = savedKey(name, town);
      const isSaved = saved.has(key);
      const isCompared = comparing.has(name);
      const meta = [location, industry].filter(Boolean).map(esc).join(' &middot; ');
      const warning = match.warning;
      let signal = '';
      if(warning){
        const wording = 'Company record: ' + esc(warning.label) +
          '. Check before applying.';
        signal = '<p class="similar-signal sev-' + attr(warning.severity) + '">' +
          (warning.href
            ? '<a href="' + attr(warning.href) + '" target="_blank" rel="noopener">' +
              wording + '</a>'
            : wording) + '</p>';
      }
      return '<article class="similar-card">' +
        '<span class="similar-name">' + esc(cleanDisplayText(name)) + '</span>' +
        (meta ? '<p class="similar-meta">' + meta + '</p>' : '') +
        signal +
        '<div class="similar-why" aria-label="Why this matched">' +
        match.reasons.map(reason=>'<span>' + esc(reason) + '</span>').join('') +
        '</div><div class="similar-actions">' +
        '<button type="button" data-similar-view="' + attr(name) + '">View</button>' +
        '<button type="button" data-similar-save="' + attr(key) + '" ' +
          'aria-pressed="' + isSaved + '">' + (isSaved ? 'Saved' : 'Save') + '</button>' +
        '<button type="button" data-similar-compare="' + attr(name) + '" ' +
          'aria-pressed="' + isCompared + '">' +
          (isCompared ? 'Selected' : 'Add to comparison') + '</button>' +
        '</div></article>';
    }).join('');
    return '<div class="block similar-sponsors">' +
      '<h3>Similar sponsors worth checking</h3>' +
      '<p class="similar-intro">Currently listed employers that share this ' +
      'location or industry and at least one visa route.</p><div class="similar-list">' + cards +
      '</div><p class="caveat">These are similarity matches, not endorsements ' +
      'or safety rankings. Check each employer before applying.</p></div>';
  }

  function sheetHTML(row){
    const [name, town, county, industry, routes, rating] = row;
    const sourceAnomaly = isReviewedSourceAnomaly(name);
    const locationLabel = [cleanPlace(town), cleanPlace(county)].filter(Boolean)
      .filter((v,i,a)=>a.findIndex(x=>x.toLowerCase()===v.toLowerCase())===i)
      .join(', ');
    // A reviewed source anomaly is evidence about the source itself, not an
    // employer identity. Never attach ordinary enrichment to it even if a
    // future source happens to produce a coincidental name match.
    const record = sourceAnomaly ? null : companyFlags[name];
    const identity = sourceAnomaly ? null : companyIdentities.get(name);
    const listingPresent = all.some(s=>savedKey(s[0],s[1])===savedKey(name,town));
    const checked = readableTimestamp(currentUpdated);
    const cosHistory = sourceAnomaly ? null : cosHistories.get(name);
    const cosUsage = sourceAnomaly ? null : cosUsageRecords.get(name);
    const cqc = sourceAnomaly ? null : cqcProviders.get(name);
    // GOV.UK does not publish a licence start date. This is an observation
    // date only when our own dated register history supports it.
    const started = licensedSince[(name + '|' + town).toLowerCase()];
    const evidenceModel = employerEvidenceModel(
      row,identity,record,cqc,cosHistory,cosUsage,started);
    const parts = ['<p class="check-kicker">KnowYourSponsor Check</p>',
      employerIntelligenceSummary(evidenceModel,listingPresent,checked,sourceAnomaly),
      '<dl>'];
    if(locationLabel) parts.push(`<dt>${sourceAnomaly ? 'Source location wording' : 'Location'}</dt><dd>${esc(locationLabel)}</dd>`);
    if(!sourceAnomaly){
      parts.push(`<dt>Estimated industry</dt><dd>${esc(industry)}<small>Inferred for discovery; not a Home Office register field.</small></dd>`);
    }

    parts.push('</dl>');
    const sourceWording = officialSourceWordingNote(name,town);
    if(sourceWording){
      parts.push('<div class="source-wording-note"><strong>' +
        (sourceAnomaly ? 'Official-source anomaly' : 'Unusual official-source wording') + '</strong>' +
        esc(sourceWording) + '</div>');
    }
    parts.push(employerEvidenceReceipt(
      row,identity,record,cqc,cosHistory,cosUsage));

    if(routes && routes.length){
      parts.push('<div class="block"><h3>' +
        (sourceAnomaly ? 'Visa routes published for this record' : 'Visa routes it can sponsor') + '</h3>' +
        routes.map(r=>`<span class="tag">${esc(r)}</span>`).join('') + '</div>');
    }

    parts.push(cosHistoryHTML(cosHistory));
    parts.push(cosUsageHTML(cosUsage));

    if(record){
      const worst = warningFor(name);
      // known[3] is the explanation. known[2] became the severity when the
      // warnings were tiered, and this line was left pointing at [2], so the
      // sheet printed the word "serious" where a sentence belonged.
      const flags = (record.flags || []).map(f=>{
        // The exact age beats "within the last year" for the same reason
        // it beats "New company" on the row badge.
        if(f === 'incorporated_recently'){
          const exact = ageSentence(record.incorporated);
          if(exact) return exact;
        }
        const known = WARNINGS.find(w=>w[0]===f);
        return known ? known[3] : f;
      });
      const severity = worst ? worst.severity : 'context';
      parts.push('<div class="warnbox sev-' + attr(severity) +
        '"><strong>Companies House says:</strong> ' +
        (record.status ? esc(record.status) + '. ' : '') +
        flags.map(esc).join(' ') +
        '<br>Matched by name, so check the official record before deciding ' +
        'anything.</div>');
      parts.push(employerHistory(record, row, started,
        sourceAnomaly ? 'Source record history' : 'Employer history'));
    }else{
      parts.push(employerHistory(null, row, started,
        sourceAnomaly ? 'Source record history' : 'Employer history'));
    }

    if(cqc && cqc.state === 'identified'){
      const services = (cqc.services || []).slice(0,3).map(esc).join(', ');
      const cqcLink = String(cqc.url || '').startsWith('https://www.cqc.org.uk/')
        ? '<a href="' + attr(cqc.url) + '" target="_blank" rel="noopener">' +
          'open the CQC record</a>' : 'check the CQC directory';
      parts.push('<div class="block"><h3>Care Quality Commission</h3><p>' +
        'Matched by provider name to CQC provider ' + esc(cqc.provider_id) +
        ', with ' + Number(cqc.locations || 0).toLocaleString('en-GB') +
        ' registered location' + (cqc.locations === 1 ? '' : 's') +
        (services ? '. Services include ' + services : '') + '. ' + cqcLink +
        '.</p><p class="caveat">CQC regulates care services in England. ' +
        'This provider match is separate from the sponsor licence and should ' +
        'be verified before use.</p></div>');
    }else if(cqc && cqc.state === 'ambiguous'){
      parts.push('<div class="block"><h3>Care Quality Commission</h3><p>' +
        'More than one CQC provider shares this name, so we have not attached ' +
        'one provider record to this sponsor.</p></div>');
    }

    // Named for minimum wage underpayment. An enforcement finding rather
    // than a filing signal, so it gets its own box and its own wording:
    // what was owed, to how many workers, when, and a link to the
    // government publication. Nothing about what it implies.
    const named = namings[name];
    if(named && named.length){
      const latest = named[0];
      const year = String(latest.round || '').slice(0,4);
      const money = typeof latest.arrears === 'number'
        ? '£' + latest.arrears.toLocaleString('en-GB',
            {minimumFractionDigits:2, maximumFractionDigits:2}) : '';
      const workers = latest.workers
        ? latest.workers.toLocaleString() +
          (latest.workers === 1 ? ' worker' : ' workers') : '';
      const bits = ['<strong>Named for underpaying the minimum wage' +
        (year ? ' in ' + esc(year) : '') + '.</strong>'];
      if(money && workers) bits.push(money + ' was owed to ' + workers + '.');
      else if(money) bits.push(money + ' was owed.');
      if(named.length > 1) bits.push('Named in ' + named.length +
        ' separate rounds.');
      const src = String(latest.source || '');
      if(src.startsWith('https://www.gov.uk/')){
        bits.push('<a href="' + attr(src) + '" target="_blank" ' +
          'rel="noopener">The government publication</a>.');
      }
      bits.push('<br>A published enforcement finding, not an allegation. ' +
        'Arrears named in a round have to be repaid, and being named does ' +
        'not tell you what the employer is like to work for now.');
      parts.push('<div class="warnbox sev-notable">' + bits.join(' ') +
        '</div>');
    }

    // What we can and cannot vouch for, in one place. No competitor shows
    // any of this, and the value is entirely in it being honest about the
    // gap: an employer with no warning has not been vetted, it has either
    // been matched and found clean or not matched at all, and the published
    // file cannot tell those apart without shipping 96,000 more names.
    const checks = [];
    checks.push([sourceAnomaly ? 'Published rating' : 'Home Office rating', sourceAnomaly
      ? (rating ? esc(rating) + '. Part of the source record; not verification of an operating employer.' : 'Not published')
      : rating === 'A'
      ? 'A on the latest register; this is not an endorsement'
      : (rating === 'B'
          ? 'B, so it usually cannot issue new certificates right now'
          : 'Not published')]);
    checks.push(['Sponsor record first observed', started
      ? esc(longDate(started))
      : (licensedBaseline
          ? `At least ${esc(longDate(licensedBaseline))}. It was already on ` +
            'the register when we started keeping a daily record, so the ' +
            'record is older than that.'
          : 'Not known')]);
    if(record){
      const worst = warningFor(name);
      checks.push(['Companies House record',
        (record.status ? esc(record.status) : 'Signal found') +
        (worst && worst.severity === 'serious'
          ? '. This is the serious kind: the company may not be trading.'
          : '. Worth a look, but common and not proof of anything.')]);
    }else{
      checks.push([sourceAnomaly ? 'Company identity' : 'Companies House record',
        sourceAnomaly
          ? 'No company is linked. Automated employer matching is deliberately disabled for this reviewed source anomaly.'
          : 'No signal found. That is not a clean bill of health: we match ' +
            'employers to company records by name, and this one either matched ' +
            'and looked fine or could not be matched at all.']);
    }
    parts.push('<div class="block"><h3>What we can check</h3><dl class="checks">' +
      checks.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('') +
      '</dl></div>');

    const links = [];
    if(record && record.number){
      links.push(`<a href="${CH_COMPANY}${encodeURIComponent(record.number)}"` +
        ` target="_blank" rel="noopener">Company ${esc(record.number)} at ` +
        `Companies House</a>`);
    }
    links.push('<a href="https://www.gov.uk/government/publications/' +
      'register-of-licensed-sponsors-workers" target="_blank" rel="noopener">' +
      'The official GOV.UK register</a>');
    // A page of its own, where one exists. Only some employers have one:
    // a chain, or a licence we watched start.
    const ownPage = employerPages[name];
    if(ownPage){
      links.unshift(`<a href="employer/${encodeURIComponent(ownPage)}/">` +
        `Everything we know about ${esc(name)}</a>`);
    }
    parts.push('<div class="links">' + links.join('') + '</div>');

    // The same employer often holds a licence at several sites. Knowing
    // there is one nearer you is more useful than knowing this one exists.
    const elsewhere = all
      .filter(s => s[0] === name && s[1] && s[1] !== town)
      .map(s => s[1]);
    const towns = [...new Set(elsewhere)].sort();
    if(towns.length){
      parts.push('<div class="block"><h3>Also listed in</h3>' +
        towns.map(t=>`<span class="tag">${esc(t)}</span>`).join('') + '</div>');
    }

    parts.push(similarSponsorsHTML(row));

    // A licence is not an offer. These are the few checks a person can make
    // before giving an employer time, money or documents. The links stay on
    // GOV.UK so this panel does not turn into immigration advice.
    if(!sourceAnomaly){
      parts.push(employerPolicyHTML(row));
      parts.push('<div class="block"><h3>Before you apply</h3>' +
      '<ol class="apply-steps">' +
      '<li>Confirm the vacancy through the employer\'s own website or ' +
        'switchboard.</li>' +
      '<li>Ask whether this specific role will be sponsored.</li>' +
      '<li>For a Skilled Worker application, check the ' +
        '<a href="https://www.gov.uk/skilled-worker-visa/your-job" ' +
        'target="_blank" rel="noopener">job and salary rules on GOV.UK</a>.' +
        '</li>' +
      '<li>Do not pay anyone to secure a job offer or Certificate of ' +
        'Sponsorship. <a href="https://www.gov.uk/government/publications/' +
        'frauds-tricks-and-scams/fraud-tricks-and-scams" target="_blank" ' +
        'rel="noopener">Read the official scam guidance</a>.</li>' +
      '<li><a href="https://www.gov.uk/government/publications/' +
        'register-of-licensed-sponsors-workers" target="_blank" ' +
        'rel="noopener">Check the licence again</a> before sending personal ' +
        'documents.</li>' +
        '</ol></div>');

      const alertParams = new URLSearchParams();
      if(town) alertParams.set('city', cleanPlace(town));
      if(industry) alertParams.set('industry', industry);
      const alertHref = '?' + alertParams.toString() + '#alerts';
      parts.push('<div class="block"><h3>Keep checking</h3>' +
      '<p>Register and company facts can change after today.</p>' +
      '<div class="links"><button type="button" data-follow-employer="' +
      attr(name) + '">Follow this employer</button><a href="' +
      attr(alertHref) + '">' +
        'Get weekly changes for this area</a>' +
        '<a href="start/">Monitor this employer for a business</a></div></div>');

      parts.push('<p class="caveat">Holding a licence means this employer can ' +
        'sponsor a visa on the routes listed. It does not mean they are hiring, ' +
        'and this is not immigration advice.</p>');
    }else{
      parts.push('<div class="block"><h3>What to do with this record</h3>' +
        '<p>Use the official register to verify the published wording. Do not ' +
        'use this entry as evidence of a real employer, vacancy or sponsorship offer.</p></div>');
    }
    return parts.join('');
  }

  function openSheet(name, opener){
    if(!fullLoaded){
      $('loadNote').hidden = false;
      $('loadNote').textContent = 'Complete employer details are still loading.';
      return;
    }
    const row = sourceRows().find(s=>s[0]===name) || all.find(s=>s[0]===name);
    if(!row) return;
    sheetRow = row;
    sheetOpener = opener || null;
    $('sheetName').textContent = cleanDisplayText(name);
    $('sheetBody').innerHTML = sheetHTML(row);
    if((cosHistories.get(name) || cosUsageRecords.get(name)) && !cosHistoryViews.has(name)){
      cosHistoryViews.add(name);
      trackEvent('cos_history_viewed','Historical CoS evidence viewed');
    }
    loadCompanyIdentity(name).then(()=>{
      if(sheetRow && sheetRow[0] === name){
        $('sheetBody').innerHTML = sheetHTML(sheetRow);
        if((cosHistories.get(name) || cosUsageRecords.get(name)) && !cosHistoryViews.has(name)){
          cosHistoryViews.add(name);
          trackEvent('cos_history_viewed','Historical CoS evidence viewed');
        }
      }
    });
    syncSheetStar();
    syncSheetCompare();
    $('sheetBackdrop').hidden = false;
    $('sheet').hidden = false;
    restoreSheetWidth();
    $('sheetClose').focus();
    for(const tr of rows.querySelectorAll('tr.open')) tr.classList.remove('open');
    if(opener) opener.closest('tr').classList.add('open');
    trackEvent('employer_opened', 'Employer details opened');
    syncURL(true);
  }

  const SHEET_WIDTH_KEY = 'kys_employer_panel_width';
  const SHEET_COMPACT_WIDTH = 520;
  const SHEET_EXPANDED_WIDTH = 720;

  function sheetWidthBounds(){
    return {min:420,max:Math.max(420,Math.min(760,window.innerWidth-64))};
  }

  function setSheetWidth(value,persist=true){
    if(window.matchMedia('(max-width:560px)').matches) return;
    const bounds = sheetWidthBounds();
    const width = Math.round(Math.min(bounds.max,Math.max(bounds.min,Number(value)||SHEET_COMPACT_WIDTH)));
    $('sheet').style.setProperty('--sheet-width',width+'px');
    $('sheetResize').setAttribute('aria-valuemin',String(bounds.min));
    $('sheetResize').setAttribute('aria-valuemax',String(bounds.max));
    $('sheetResize').setAttribute('aria-valuenow',String(width));
    $('sheetResize').setAttribute('aria-valuetext',width+' pixels wide');
    const expanded = width > (SHEET_COMPACT_WIDTH+SHEET_EXPANDED_WIDTH)/2;
    $('sheetSize').textContent = expanded ? 'Compact' : 'Expand';
    $('sheetSize').setAttribute('aria-label',(expanded?'Compact':'Expand')+' employer details panel');
    if(persist) localStorage.setItem(SHEET_WIDTH_KEY,String(width));
  }

  function restoreSheetWidth(){
    setSheetWidth(localStorage.getItem(SHEET_WIDTH_KEY)||SHEET_COMPACT_WIDTH,false);
  }

  function toggleSheetWidth(){
    const current = parseFloat(getComputedStyle($('sheet')).width)||SHEET_COMPACT_WIDTH;
    setSheetWidth(current > (SHEET_COMPACT_WIDTH+SHEET_EXPANDED_WIDTH)/2
      ? SHEET_COMPACT_WIDTH : SHEET_EXPANDED_WIDTH);
  }

  function startSheetResize(event){
    if(window.matchMedia('(max-width:560px)').matches) return;
    event.preventDefault();
    const handle = $('sheetResize');
    handle.setPointerCapture(event.pointerId);
    document.body.style.userSelect='none';
    const move = moveEvent=>setSheetWidth(window.innerWidth-moveEvent.clientX,false);
    const finish=()=>{
      handle.removeEventListener('pointermove',move);
      handle.removeEventListener('pointerup',finish);
      handle.removeEventListener('pointercancel',finish);
      document.body.style.userSelect='';
      const width=parseFloat(getComputedStyle($('sheet')).width)||SHEET_COMPACT_WIDTH;
      setSheetWidth(width,true);
    };
    handle.addEventListener('pointermove',move);
    handle.addEventListener('pointerup',finish);
    handle.addEventListener('pointercancel',finish);
  }

  function resizeSheetByKey(event){
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const bounds=sheetWidthBounds();
    const current=parseFloat(getComputedStyle($('sheet')).width)||SHEET_COMPACT_WIDTH;
    const next=event.key==='Home'?bounds.min:event.key==='End'?bounds.max:
      current+(event.key==='ArrowLeft'?24:-24);
    setSheetWidth(next,true);
  }

  function identityShard(name){
    const plain = String(name || '').normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '').replace(/^[^0-9A-Za-z]+/, '')
      .toLowerCase();
    return /^[0-9a-z]/.test(plain) ? plain[0] : '_';
  }

  function loadCompanyIdentity(name){
    if(companyIdentities.has(name)) return Promise.resolve();
    const key = identityShard(name);
    if(!identityRequests.has(key)){
      identityRequests.set(key, fetch('data/identity/' + key + '.json',
        {cache:'no-cache'})
        .then(response=>response.ok ? response.json() : {employers:{}})
        .then(document=>{
          if(document && document.updated) companyIdentityUpdated = document.updated;
          if(document && document.cqcUpdated) cqcEvidenceUpdated = document.cqcUpdated;
          if(document && document.cosExtracted) cosHistoryExtracted = document.cosExtracted;
          if(document && document.cosSource) cosHistorySource = document.cosSource;
          if(document && document.cosReference) cosHistoryReference = document.cosReference;
          if(document && document.cosUsageYear) cosUsageYear = document.cosUsageYear;
          if(document && document.cosUsageThreshold) cosUsageThreshold = document.cosUsageThreshold;
          if(document && document.cosUsageSource) cosUsageSource = document.cosUsageSource;
          if(document && document.cosUsageReference) cosUsageReference = document.cosUsageReference;
          const values = document && document.employers || {};
          for(const [employer, evidence] of Object.entries(values)){
            // Wrapper is the current format. The fallback accepts the first
            // identity-only shard deployment without breaking old caches.
            const wrapped = evidence && ('company' in evidence || 'cqc' in evidence ||
              'cos' in evidence || 'cosUsage2025' in evidence);
            companyIdentities.set(employer, wrapped ? evidence.company : evidence);
            if(wrapped && evidence.cqc) cqcProviders.set(employer, evidence.cqc);
            if(wrapped && evidence.cos) cosHistories.set(employer, evidence.cos);
            if(wrapped && evidence.cosUsage2025) cosUsageRecords.set(employer, evidence.cosUsage2025);
          }
        }).catch(()=>{}));
    }
    return identityRequests.get(key).then(()=>{
      if(!companyIdentities.has(name)) companyIdentities.set(name, null);
    });
  }

  function closeSheet(){
    if($('sheet').hidden) return;
    sheetRow = null;
    $('sheet').hidden = true;
    $('sheetBackdrop').hidden = true;
    for(const tr of rows.querySelectorAll('tr.open')) tr.classList.remove('open');
    // Send focus back to the row that opened it, not to the top of the page.
    if(sheetOpener && document.contains(sheetOpener)) sheetOpener.focus();
    sheetOpener = null;
    syncURL(true);
  }

  function sheetOpenName(){
    return $('sheet').hidden ? '' : $('sheetName').textContent;
  }

  // --------------------------------------------------------- actions --
  function filtersActive(){
    return Boolean($('q').value.trim() || $('city').value ||
                   $('industry').value || $('route').value || view || warnOnly);
  }

  function updateSearchPresentation(resultCount){
    const focused = filtersActive();
    const single = focused && resultCount === 1;
    document.body.classList.toggle('search-focused', focused);
    document.body.classList.toggle('single-result', single);
    if(!single){
      document.body.classList.remove('refine-open');
      $('refineSearch').setAttribute('aria-expanded','false');
    }
  }

  $('browseAll').addEventListener('click',()=>{
    browseAllRequested = true;
    apply();
    $('resultsMeta').scrollIntoView({block:'start',behavior:'smooth'});
  });
  $('filterEmployers').addEventListener('click',()=>{
    filtersRequested = true;
    apply();
    $('filterbar').scrollIntoView({block:'start',behavior:'smooth'});
  });
  $('showRecent').addEventListener('click',()=>{
    $('viewAdded').click();
    $('resultsMeta').scrollIntoView({block:'start',behavior:'smooth'});
  });

  function setWarnOnly(level){
    warnOnly = (level === 'serious' || level === 'any') ? level
             : (level ? 'any' : '');
    $('warnOnly').setAttribute('aria-pressed', String(warnOnly === 'any'));
    $('riskOnly').setAttribute('aria-pressed', String(warnOnly === 'serious'));
    $('statWarnBox').setAttribute('aria-pressed', String(warnOnly === 'serious'));
  }

  function clearFilters(){
    $('q').value = '';
    $('city').value = '';
    $('industry').value = '';
    $('route').value = '';
    setWarnOnly(false);
    setView('');
    setSort('relevance');
    apply();
    syncURL(true);
    $('q').focus();
  }

  // Sharing a filtered view is the cheapest growth this site has: someone
  // pastes "sponsors in Leeds" into a group chat. Copying the address bar
  // by hand is enough friction to stop most people doing it.
  async function copyLink(){
    const btn = $('copyLink');
    const label = btn.textContent;
    try{
      await navigator.clipboard.writeText(location.href);
      btn.textContent = 'Link copied';
    }catch(err){
      // Clipboard access can be blocked; select the URL so Ctrl+C still works.
      btn.textContent = 'Press Ctrl+C to copy';
    }
    setTimeout(()=>{ btn.textContent = label; }, 1800);
  }

  async function shareOrCopy(btn, title, text, url){
    const label = btn.textContent;
    let completed = false;
    try{
      if(navigator.share){
        await navigator.share({title, text, url});
        btn.textContent = 'Shared';
        completed = true;
      }else{
        await navigator.clipboard.writeText(url);
        btn.textContent = 'Link copied';
        completed = true;
      }
    }catch(err){
      // Cancelling the native share sheet is not an error the visitor needs
      // to see. Clipboard failures still leave the address bar available.
      if(err && err.name !== 'AbortError') btn.textContent = 'Copy from address bar';
    }
    setTimeout(()=>{ btn.textContent = label; }, 1800);
    return completed;
  }

  function shortlistURL(){
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('view', 'saved');
    for(const key of [...saved].slice(0,25)) url.searchParams.append('shortlist', key);
    return url.href;
  }

  async function shareShortlist(){
    if(!saved.size) return;
    if(saved.size > 25){
      $('saveStatus').textContent = 'A shareable shortlist can contain up to 25 employers.';
      $('saveStatus').hidden = false;
      return;
    }
    const completed = await shareOrCopy($('shareShortlist'), 'KnowYourSponsor shortlist',
      'Employers saved for a closer look. Check each one against the official sources.',
      shortlistURL());
    if(completed) trackEvent('shortlist_shared', 'Shortlist shared');
  }

  function normaliseStoredApplication(value){
    if(!value || typeof value !== 'object' || !value.id || !value.employer) return null;
    const snapshot = value.evidenceSnapshot;
    const evidenceSnapshot = snapshot && typeof snapshot === 'object' &&
      snapshot.version === APPLICATION_EVIDENCE_VERSION && snapshot.capturedAt
      ? snapshot : null;
    return {...value,evidenceSnapshot};
  }

  function persistApplications(){
    try{ localStorage.setItem(APPLICATION_KEY, JSON.stringify(applications)); }
    catch(err){
      $('jobResult').hidden = false;
      $('jobResult').innerHTML = '<h3>This application could not be saved.</h3>' +
        '<p>Browser storage is blocked or full. Download your applications before leaving this page.</p>';
    }
    renderApplications();
  }

  function cleanVacancyLine(value){
    return String(value || '')
      .replace(/^[\s\u2022\u2023\u25E6\u2043\u2219*|>]+/,'')
      .replace(/\s+/g,' ').trim();
  }

  function vacancyLines(text){
    return String(text || '').replace(/\r/g,'')
      .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g,'\n')
      .replace(/([a-z0-9)])(?=(?:About\s+(?:the Role|[A-Z][A-Za-z&'. -]{1,70})|Responsibilities|Required Qualifications|Preferred Qualifications|Problem Areas|Why This Role Is Different)\b)/g,'$1\n')
      .replace(/\s+(?=(?:employer|company(?: name)?|organisation|organization|job title|role title|position(?: title)?|job location|work location|location|salary|pay|hours per week)\s*:)/gi,'\n')
      .split('\n').map(cleanVacancyLine).filter(Boolean);
  }

  function labelledVacancyValue(lines, labels){
    const label = '(?:' + labels.join('|') + ')';
    const sameLine = new RegExp('^' + label + '(?:\\s*:\\s*|\\s+[-\u2013\u2014]\\s+)(.+)$','i');
    const labelOnly = new RegExp('^' + label + '\\s*:?$','i');
    for(let index=0;index<lines.length;index++){
      const match = lines[index].match(sameLine);
      if(match && match[1].trim()) return match[1].trim();
      if(labelOnly.test(lines[index]) && lines[index + 1]) return lines[index + 1];
    }
    return '';
  }

  function vacancyNumber(value){
    const compact = String(value || '').replace(/,/g,'').trim();
    const number = Number.parseFloat(compact);
    if(!Number.isFinite(number)) return null;
    return /k\b/i.test(compact) ? number * 1000 : number;
  }

  function extractVacancyFacts(text){
    if(vacancyIntelligence) return vacancyIntelligence.extract(text);
    const source = String(text || '').replace(/\r/g,'').replace(/\u00a0/g,' ');
    const lines = vacancyLines(source);
    const facts = {employer:'',role:'',location:'',salary:null,salaryPeriod:'',hours:null,notes:[],confidence:{}};
    facts.employer = labelledVacancyValue(lines,['employer','company(?: name)?','organisation','organization','hiring organisation','hiring organization','posted by']);
    facts.role = labelledVacancyValue(lines,['job title','role title','position(?: title)?','vacancy','role']);
    facts.location = labelledVacancyValue(lines,['job location','work location','location','based in','workplace']);
    if(facts.employer) facts.confidence.employer = 'labelled';
    if(facts.role) facts.confidence.role = 'labelled';
    if(facts.location) facts.confidence.location = 'labelled';

    if(!facts.employer){
      const aboutIndex = lines.slice(0,80).findIndex(line=>/^About\s+[A-Z]/.test(line));
      const aboutLine = aboutIndex >= 0 ? lines[aboutIndex] : '';
      const repeatedName = aboutLine.match(/^About\s+(.{2,80}?)\1\s+is\b/i);
      const aboutName = repeatedName ? repeatedName[1].trim() : aboutLine.replace(/^About\s+/i,'').trim();
      const aboutProfile = aboutIndex >= 0 ? comparableEmployerName(lines[aboutIndex + 1] || '') : '';
      if(aboutName && aboutName.length <= 80 && (repeatedName || aboutProfile.startsWith(comparableEmployerName(aboutName) + ' is'))){
        facts.employer = aboutName;
        facts.confidence.employer = 'company profile wording';
      }
    }

    if(!facts.employer){
      const companyLine = lines.slice(0,35).find(line=>
        line.length <= 160 && /\b(?:limited|ltd\.?|llp|plc|nhs(?:\s+(?:trust|foundation trust))?|university|council)\b/i.test(line) &&
        !/\b(?:about|experience|benefits|privacy|equal opportunities|terms|similar jobs)\b/i.test(line));
      if(companyLine){
        facts.employer = companyLine.replace(/^(?:at|by|company)\s+/i,'').replace(/\s*[|\u2022].*$/,'').trim();
        facts.confidence.employer = 'company-style name';
      }
    }

    if(!facts.role){
      const titleCandidate = lines.slice(0,15).find(line=>line.length >= 3 && line.length <= 100 &&
        !/^(?:what|where|accept|continue|find jobs?|company reviews?|salary guide|start of main content|job description|job details|about (?:us|the role)|overview|salary|pay|location|company|employer|posted|promoted|apply|easy apply|save|share|sign in|log in|home|jobs?|careers?|indeed|linkedin)\b/i.test(line) &&
        !/\b(?:applicants?|days?|weeks?|months?)\s+ago\b/i.test(line) &&
        !/[£$€]|https?:\/\//i.test(line) && !/\b(?:limited|ltd\.?|llp|plc)\b/i.test(line) &&
        !/^(?:full[- ]time|part[- ]time|permanent|temporary|contract|hybrid|remote)$/i.test(line));
      if(titleCandidate && !/:/.test(titleCandidate)){
        facts.role = titleCandidate;
        facts.confidence.role = 'job-board heading';
      }
    }
    if(!facts.location){
      const locationCandidate = lines.slice(0,25).find(line=>
        comparableEmployerName(line) !== comparableEmployerName(facts.employer) &&
        !/\b(?:limited|ltd\.?|llp|plc|nhs(?:\s+(?:trust|foundation trust))?|university|council)\b/i.test(line) &&
        (/^(?:remote|hybrid)(?:\s+(?:in|[-\u2013\u2014]))?\s*[A-Za-z .'-]*$/i.test(line) ||
        (/\b(?:London|Manchester|Birmingham|Leeds|Glasgow|Edinburgh|Liverpool|Bristol|Sheffield|Leicester|Coventry|Nottingham|Cardiff|Belfast|United Kingdom|UK)\b/i.test(line) &&
          line.length <= 100 && !/\b(?:salary|office|registered|company|about)\b/i.test(line))));
      if(locationCandidate){
        facts.location = locationCandidate.replace(/^(?:location|based in|workplace)\s*[:\-]?\s*/i,'')
          .split(/\s*(?:\u00c2?\u00b7|\||\s[-–—]\s)\s*/)[0]
          .replace(/\s+\d+\s+(?:days?|weeks?|months?)\s+ago.*$/i,'')
          .replace(/\s+(?:over\s+)?\d+\s+applicants?.*$/i,'').trim();
        facts.confidence.location = 'location wording';
      }
    }

    if(/^(?:accept(?: all)?|allow(?: all)?(?: cookies)?|continue|reject(?: all)?|manage cookies|sign in|log in)$/i.test(facts.role)) {
      facts.role = '';
      delete facts.confidence.role;
    }

    const salaryMatch = source.match(/(?:salary|pay|compensation|package|rate)?[^\n£]{0,40}(?:£|GBP\s*)([0-9][0-9,]*(?:\.[0-9]+)?\s*k?)(?:\s*(?:-|–|—|to)\s*(?:£|GBP\s*)?([0-9][0-9,]*(?:\.[0-9]+)?\s*k?))?/i);
    if(salaryMatch){
      const low = vacancyNumber(salaryMatch[1]);
      const high = vacancyNumber(salaryMatch[2]);
      facts.salary = low;
      const salaryLineStart = source.lastIndexOf('\n',salaryMatch.index) + 1;
      const salaryLineEnd = source.indexOf('\n',salaryMatch.index + salaryMatch[0].length);
      const salaryContext = source.slice(salaryLineStart,salaryLineEnd < 0 ? source.length : salaryLineEnd);
      if(/(?:per\s*hour|an?\s*hour|hourly|\/\s*h(?:r)?\b)/i.test(salaryContext)) facts.salaryPeriod = 'hour';
      else if(/(?:per\s*week|weekly|\/\s*week\b)/i.test(salaryContext)) facts.salaryPeriod = 'week';
      else if(/(?:per\s*month|monthly|\/\s*month\b)/i.test(salaryContext)) facts.salaryPeriod = 'month';
      else if(/(?:per\s*(?:annum|year)|annual(?:ly)?|p\.?a\.?\b|\/\s*year\b)/i.test(salaryContext) || facts.salary >= 10000) facts.salaryPeriod = 'year';
      else facts.notes.push('Check the salary period; it was not stated clearly.');
      if(high) facts.notes.push('A salary range was found. The lower guaranteed figure has been entered for a conservative check.');
      facts.confidence.salary = high ? 'range minimum' : 'advertised figure';
    }
    const hoursMatch = source.match(/(?:contracted\s*)?([1-7][0-9](?:\.\d+)?)\s*(?:hours|hrs)(?:\s*(?:per|a|each|\/)\s*week)?/i) ||
      source.match(/(?:hours|hrs)\s*(?:per|a|each|\/)\s*week\s*[:\-]?\s*([1-7][0-9](?:\.\d+)?)/i);
    if(hoursMatch){ facts.hours = Number(hoursMatch[1]); facts.confidence.hours = 'stated hours'; }
    return facts;
  }

  function renderVacancyEvidenceReview(facts){
    const review = $('vacancyEvidenceReview');
    if(!review || !vacancyIntelligence){
      if(review) review.hidden = true;
      return;
    }
    const targetByField = {
      employer:'jobEmployerInput',role:'jobRole',location:'jobLocation',
      salary:'jobSalary',hours:'jobHours'
    };
    const displayValue = item=>{
      if(item.key === 'salary' && Number.isFinite(item.value)){
        return pounds(item.value) + (facts.salaryPeriod ? ' per ' + facts.salaryPeriod : '');
      }
      if(item.key === 'hours' && Number.isFinite(item.value)) return item.value + ' hours';
      return String(item.value || 'Not found');
    };
    review.innerHTML = '<div class="vacancy-evidence-head"><div><span>Extraction evidence</span>' +
      '<h3>Review what was found before continuing</h3></div><strong>Nothing is auto-confirmed</strong></div>' +
      '<div class="vacancy-evidence-grid">' + vacancyIntelligence.reviewItems(facts).map(item=>{
        const state = item.state === 'found' ? 'FOUND' : item.state === 'possible' ? 'POSSIBLE' : 'NOT FOUND';
        const action = item.state === 'not_found' ? '' :
          '<button type="button" data-review-job="' + targetByField[item.key] + '">Review field</button>';
        const quote = item.excerpt ? '<q>' + esc(item.excerpt) + '</q>' :
          '<p>No dependable wording for this field was detected.</p>';
        return '<article class="vacancy-evidence-item is-' + item.state + '">' +
          '<div><span class="vacancy-evidence-state">' + state + '</span><strong>' + esc(item.label) + '</strong></div>' +
          '<p class="vacancy-evidence-value">' + esc(displayValue(item)) + '</p>' + quote +
          '<small>' + esc(item.method) + '</small>' + action + '</article>';
      }).join('') + '</div><p class="vacancy-evidence-limit">Found means the wording appeared in the supplied advert. Possible means the value was inferred from its layout or wording. Neither confirms the employer, occupation code or sponsorship offer.</p>';
    review.hidden = false;
  }

  function exactVacancyEmployer(name){
    if(!name) return null;
    const wanted = comparableEmployerName(name);
    const matches = all.filter(row=>!isReviewedSourceAnomaly(row[0]) &&
      comparableEmployerName(cleanDisplayText(row[0])) === wanted);
    return matches.length === 1 ? matches[0] : null;
  }

  function findEmployerInVacancy(lines){
    for(const line of lines.slice(0,40)){
      const candidate = line.replace(/^(?:employer|company|organisation|organization|hiring organisation|hiring organization)\s*[:\-]\s*/i,'').trim();
      const row = exactVacancyEmployer(candidate);
      if(row) return row;
    }
    const useful = lines.slice(0,40).map(line=>comparableEmployerName(line)).filter(line=>line.length > 3);
    const embedded = all.filter(row=>{
      if(isReviewedSourceAnomaly(row[0])) return false;
      const name = comparableEmployerName(cleanDisplayText(row[0]));
      return name.length >= 6 && useful.some(line=>line === name || line.startsWith(name + ' ') ||
        line.endsWith(' ' + name) || line.includes(' ' + name + ' '));
    });
    if(embedded.length === 1) return embedded[0];
    return null;
  }

  async function fillFromVacancy(){
    const text = $('jobAdvertText').value.trim();
    const status = $('jobAdvertStatus');
    $('vacancyEvidenceReview').hidden = true;
    if(text.length < 40){
      status.textContent = 'Paste more of the vacancy so there is enough evidence to extract.';
      status.hidden = false;
      $('jobAdvertDetails').open = true;
      $('jobAdvertText').focus();
      return false;
    }
    jobEmployerRow = null;
    $('jobEmployerInput').value = '';
    $('jobEmployer').hidden = true;
    $('jobEmployerSuggestions').hidden = true;
    $('jobRole').value = '';
    $('jobLocation').value = '';
    $('jobSalary').value = '';
    $('jobSalaryPeriod').value = 'year';
    $('jobHours').value = '37.5';
    window.kysOfferEvidence.reset();
    ['jobEmployerInput','jobRole','jobLocation','jobSalary','jobHours'].forEach(id=>$(id).removeAttribute('data-imported'));
    clearOccupationSelection(true);
    setOccupationSuggestionsOpen(false);
    const facts = extractVacancyFacts(text);
    vacancyExtractionReview = {
      tracked:false,
      values:{
        employer:facts.employer || '', role:facts.role || '', location:facts.location || '',
        salary:facts.salary ?? '', salaryPeriod:facts.salary === null ? null : (facts.salaryPeriod || ''),
        hours:facts.hours ?? ''
      }
    };
    renderVacancyEvidenceReview(facts);
    window.kysOfferEvidence.detect(text);
    const lines = vacancyLines(text);
    const row = facts.employer ? exactVacancyEmployer(facts.employer) : findEmployerInVacancy(lines);
    const found = [];
    if(row){ selectJobEmployer(row,true); found.push('exact sponsor'); }
    else if(facts.employer){
      $('jobEmployerInput').value = facts.employer;
      $('jobEmployerInput').dataset.imported = 'true';
      showEmployerSuggestions(facts.employer);
      found.push('employer name (choose the exact sponsor)');
    }
    const extractedTitleIssue = facts.role ? jobTitleIssue(facts.role) : '';
    if(facts.role){
      $('jobRole').value = facts.role;
      $('jobRole').dataset.imported = 'true';
      found.push(extractedTitleIssue ? 'partial job title (review needed)' : 'job title');
      if(extractedTitleIssue) facts.notes.push('The extracted title looks incomplete. Enter the full title shown on the vacancy.');
    }
    if(facts.location){ $('jobLocation').value = facts.location; $('jobLocation').dataset.imported = 'true'; found.push('location'); }
    if(facts.salary){ $('jobSalary').value = facts.salary; $('jobSalary').dataset.imported = 'true'; found.push('salary'); }
    if(facts.salaryPeriod) $('jobSalaryPeriod').value = facts.salaryPeriod;
    if(facts.hours){ $('jobHours').value = facts.hours; $('jobHours').dataset.imported = 'true'; found.push('weekly hours'); }
    if(facts.role) showOccupationSuggestions(facts.role);
    const missing = [];
    if(!row && !facts.employer) missing.push('employer');
    if(!facts.role || extractedTitleIssue) missing.push('full job title');
    if(!facts.salary) missing.push('salary');
    const reviewTarget = !row ? 'jobEmployerInput' : (!facts.role || extractedTitleIssue ? 'jobRole' : (!facts.salary ? 'jobSalary' : 'jobRole'));
    status.innerHTML = found.length
      ? '<strong>Extracted, not confirmed:</strong> ' + esc(found.join(', ')) + '. Highlighted fields came from the advert.' +
        (missing.length ? ' <strong>Still needed:</strong> ' + esc(missing.join(', ')) + '.' : ' Confirm each field before checking.') +
        (facts.notes.length ? ' ' + esc(facts.notes.join(' ')) : '') +
        ' <button class="review-import" type="button" data-review-job="' + reviewTarget + '">Review now</button>'
      : '<strong>No dependable facts were found.</strong> This copy may contain too little of the advert. Add the employer, job title and salary below; nothing has been guessed.';
    status.hidden = false;
    $('vacancyImportDetails').open = false;
    if(found.length) $('jobAdvertDetails').open = false;
    $('jobResult').hidden = true;
    $('saveApplicationPanel').hidden = true;
    trackEvent('vacancy_details_extracted','Vacancy details extracted');
    return found.length > 0;
  }

  function normalizedReviewValue(value){
    return String(value ?? '').replace(/\s+/g,' ').trim().toLowerCase();
  }

  function trackVacancyReviewChanged(field){
    if(field === 'employer') trackEvent('vacancy_review_changed_employer','Vacancy extraction employer changed');
    else if(field === 'role') trackEvent('vacancy_review_changed_role','Vacancy extraction role changed');
    else if(field === 'location') trackEvent('vacancy_review_changed_location','Vacancy extraction location changed');
    else if(field === 'salary') trackEvent('vacancy_review_changed_salary','Vacancy extraction salary changed');
    else if(field === 'salaryPeriod') trackEvent('vacancy_review_changed_salary_period','Vacancy extraction salary period changed');
    else if(field === 'hours') trackEvent('vacancy_review_changed_hours','Vacancy extraction hours changed');
  }

  function trackVacancyReviewFilled(field){
    if(field === 'employer') trackEvent('vacancy_review_filled_employer','Vacancy extraction employer completed');
    else if(field === 'role') trackEvent('vacancy_review_filled_role','Vacancy extraction role completed');
    else if(field === 'location') trackEvent('vacancy_review_filled_location','Vacancy extraction location completed');
    else if(field === 'salary') trackEvent('vacancy_review_filled_salary','Vacancy extraction salary completed');
    else if(field === 'salaryPeriod') trackEvent('vacancy_review_filled_salary_period','Vacancy extraction salary period completed');
    else if(field === 'hours') trackEvent('vacancy_review_filled_hours','Vacancy extraction hours completed');
  }

  function trackVacancyExtractionReview(){
    const review = vacancyExtractionReview;
    if(!review || review.tracked) return;
    review.tracked = true;
    const current = {
      employer:$('jobEmployerInput').value, role:$('jobRole').value,
      location:$('jobLocation').value, salary:$('jobSalary').value,
      salaryPeriod:$('jobSalaryPeriod').value, hours:$('jobHours').value
    };
    let changed = false;
    for(const field of Object.keys(review.values)){
      if(review.values[field] === null) continue;
      const suggested = normalizedReviewValue(review.values[field]);
      const confirmed = normalizedReviewValue(current[field]);
      if(!suggested && confirmed){
        trackVacancyReviewFilled(field);
        changed = true;
      }else if(suggested && suggested !== confirmed){
        trackVacancyReviewChanged(field);
        changed = true;
      }
    }
    if(changed) trackEvent('vacancy_review_changed','Vacancy extraction reviewed with changes');
    else trackEvent('vacancy_review_unchanged','Vacancy extraction reviewed unchanged');
  }

  async function pasteVacancyFromClipboard(){
    const status = $('jobAdvertStatus');
    if(!navigator.clipboard || !navigator.clipboard.readText){
      $('jobAdvertDetails').open = true;
      status.textContent = 'Your browser does not allow one-click paste here. Choose Paste vacancy text manually, then press Ctrl+V or Paste.';
      status.hidden = false;
      $('jobAdvertText').focus();
      return;
    }
    try{
      const text = await navigator.clipboard.readText();
      if(!text || text.trim().length < 40){
        $('jobAdvertDetails').open = true;
        status.textContent = 'The clipboard does not contain enough vacancy text. Copy the full advert, then try again.';
        status.hidden = false;
        $('jobAdvertText').focus();
        return;
      }
      $('jobAdvertText').value = text.slice(0,30000);
      await fillFromVacancy();
    }catch(error){
      $('jobAdvertDetails').open = true;
      status.textContent = 'Clipboard access was not available. Paste the advert below instead; extraction will start automatically.';
      status.hidden = false;
      $('jobAdvertText').focus();
    }
  }

  function vacancyUrlFromInput(value){
    const entered = String(value || '').trim();
    const markdownTarget = entered.match(/\]\((https:\/\/[^)\s]+)\)/i);
    const urlText = (markdownTarget ? markdownTarget[1] : entered).replace(/\\([&_=])/g,'$1');
    try{ return new URL(urlText); }catch{ return null; }
  }

  function vacancyLinkPolicy(url){
    const host = url.hostname.toLowerCase();
    if(/(^|\.)indeed\.com$/i.test(host)){
      const jobKey = url.searchParams.get('vjk') || url.searchParams.get('jk');
      if(/^[a-f0-9]{16}$/i.test(jobKey || '')) return {
        mode:'copy', provider:'Indeed', jobUrl:'https://uk.indeed.com/viewjob?jk=' + jobKey
      };
    }
    return {mode:'automatic',provider:'public vacancy site',jobUrl:url.href};
  }

  function syncVacancyUrlAction(){
    const button = $('readVacancyUrl');
    const help = $('vacancyUrlHelp');
    const url = vacancyUrlFromInput($('jobVacancyUrl').value);
    const policy = url ? vacancyLinkPolicy(url) : null;
    if(policy?.mode === 'copy'){
      button.textContent = 'Open Indeed vacancy';
      help.textContent = 'Indeed protects vacancy pages from automated readers. We will open the exact job so you can copy it securely.';
    }else{
      button.textContent = 'Read vacancy';
      help.textContent = 'We send only this public link to our server. LinkedIn and some job boards may block automatic reading.';
    }
  }

  async function importVacancyFromUrl(){
    const input = $('jobVacancyUrl');
    const button = $('readVacancyUrl');
    const status = $('jobAdvertStatus');
    $('vacancyEvidenceReview').hidden = true;
    let url;
    url = vacancyUrlFromInput(input.value);
    if(!url){
      status.innerHTML = '<strong>Enter a complete vacancy link.</strong> It should begin with https://';
      status.hidden = false;
      input.focus();
      return;
    }
    if(url.protocol !== 'https:' || url.username || url.password){
      status.innerHTML = '<strong>Use a public HTTPS vacancy link.</strong> Private or signed-in links should be copied with Paste from clipboard instead.';
      status.hidden = false;
      input.focus();
      return;
    }
    const policy = vacancyLinkPolicy(url);
    if(policy.mode === 'copy'){
      window.open(policy.jobUrl,'_blank','noopener');
      status.innerHTML = '<strong>We opened the exact Indeed vacancy.</strong> Copy the job details ' +
        '(<strong>Ctrl+A</strong>, then <strong>Ctrl+C</strong>), return here and choose <strong>Paste from clipboard</strong>. ' +
        '<a href="' + esc(policy.jobUrl) + '" target="_blank" rel="noopener">Open it again</a>.';
      status.hidden = false;
      trackEvent('vacancy_copy_flow_opened','Indeed copy flow opened');
      return;
    }
    button.disabled = true;
    button.textContent = 'Reading…';
    status.textContent = 'Reading the public vacancy page…';
    status.hidden = false;
    try{
      const response = await fetch('https://app.knowyoursponsor.co.uk/v1/public/vacancy-extract',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:url.href})
      });
      let data={};
      try{ data=await response.json(); }catch{}
      if(!response.ok || !data.text) throw new Error(data.error || 'This website did not provide readable vacancy text.');
      $('jobAdvertText').value = String(data.text).slice(0,30000);
      const extracted = await fillFromVacancy();
      if(extracted){
        status.innerHTML = '<strong>Public vacancy page read.</strong> ' + status.innerHTML;
        trackEvent('vacancy_link_read','Vacancy link read');
      }
    }catch(error){
      trackEvent('vacancy_link_fallback_shown','Vacancy link fallback shown');
      $('jobAdvertDetails').open = true;
      const message = String(error.message || 'This website did not provide readable vacancy text.');
      const linkedIn = /(^|\.)linkedin\.com$/i.test(url.hostname);
      const indeed = /(^|\.)indeed\.com$/i.test(url.hostname);
      if(linkedIn){
        const jobId = url.searchParams.get('currentJobId') || url.pathname.match(/(?:-|\/)(\d{6,20})\/?$/)?.[1];
        const jobUrl = jobId ? 'https://www.linkedin.com/jobs/view/' + jobId + '/' : url.href;
        status.innerHTML = '<strong>Your LinkedIn link is valid, but LinkedIn did not allow automated access.</strong> ' +
          '<a href="' + esc(jobUrl) + '" target="_blank" rel="noopener">Open this job</a>, copy the visible page ' +
          '(<strong>Ctrl+A</strong>, then <strong>Ctrl+C</strong>), return here and choose <strong>Paste from clipboard</strong>.';
      }else if(indeed){
        const jobKey = url.searchParams.get('vjk') || url.searchParams.get('jk');
        const jobUrl = /^[a-f0-9]{16}$/i.test(jobKey || '')
          ? 'https://uk.indeed.com/viewjob?jk=' + jobKey
          : url.href;
        status.innerHTML = '<strong>Your Indeed link is valid, but Indeed did not allow automated access.</strong> ' +
          '<a href="' + esc(jobUrl) + '" target="_blank" rel="noopener">Open the exact vacancy</a>, copy the visible job ' +
          '(<strong>Ctrl+A</strong>, then <strong>Ctrl+C</strong>), return here and choose <strong>Paste from clipboard</strong>.';
      }else{
        const guidance = /paste from clipboard/i.test(message)
          ? ''
          : ' Copy the vacancy on that page, then use <strong>Paste from clipboard</strong> above.';
        status.innerHTML = '<strong>We could not read this page automatically.</strong> ' + esc(message) + guidance;
      }
      status.hidden = false;
    }finally{
      button.disabled = false;
      syncVacancyUrlAction();
    }
  }

  function annualSalary(amount, period, hours){
    if(period === 'hour') return amount * hours * 52;
    if(period === 'week') return amount * 52;
    if(period === 'month') return amount * 12;
    return amount;
  }

  function loadOccupationData(){
    if(occupationData) return Promise.resolve(occupationData);
    if(!occupationRequest){
      occupationRequest = fetchJSON('data/occupations.json').then(document=>{
        if(!document || !Array.isArray(document.occupations) || !document.checkedAt ||
          Number(document.verifiedCodeCount) < 250) throw new Error('Occupation data unavailable');
        occupationData = document;
        return document;
      }).catch(error=>{
        occupationRequest = null;
        throw error;
      });
    }
    return occupationRequest;
  }

  function loadVacancyRulesets(){
    if(vacancyRulesets) return Promise.resolve(vacancyRulesets);
    if(!vacancyRulesetRequest){
      vacancyRulesetRequest = fetchJSON('data/vacancy_rulesets.json').then(document=>{
        if(!document || document.schemaVersion !== 1 || !Array.isArray(document.rulesets) ||
          !document.rulesets.length) throw new Error('Vacancy rulesets unavailable');
        vacancyRulesets = document;
        return document;
      }).catch(error=>{
        vacancyRulesetRequest = null;
        throw error;
      });
    }
    return vacancyRulesetRequest;
  }

  function createVacancyRuleAssessment(application,occupation){
    if(!window.kysVacancyRules || !vacancyRulesets) return null;
    const ruleset = window.kysVacancyRules.selectRuleset(vacancyRulesets,new Date().toISOString());
    return window.kysVacancyRules.assess({
      ruleset,occupation,basis:application.ruleBasis || 'standard',
      salary:application.salary,salaryPeriod:application.salaryPeriod,
      annualSalary:application.annualSalary,hours:application.hours,
      occupationConfirmed:application.occupationConfirmed,
    });
  }

  function occupationEligibility(record){
    if(record.eligibility === 'Higher Skilled') return 'Higher Skilled';
    if(record.eligibility === 'Medium Skilled') return 'Medium Skilled. Extra conditions apply';
    return record.eligibility || 'Check current eligibility';
  }

  function occupationCheckedDate(){
    return new Date(occupationData.checkedAt + 'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  }

  function occupationEvidenceFresh(){
    return occupationData && Date.now() - Date.parse(occupationData.checkedAt + 'T23:59:59Z') < 4 * 86400000;
  }

  function clearOccupationSelection(clearCode=true){
    selectedOccupation = null;
    selectedOccupationCandidate = null;
    $('jobOccupationConfirmed').checked = false;
    $('jobOccupationSelection').hidden = true;
    if(clearCode) $('jobSoc').value = '';
  }

  function setOccupationSuggestionsOpen(open){
    $('jobOccupationSuggestions').hidden = !open;
    $('jobRole').setAttribute('aria-expanded', String(open));
    $('browseOccupations').setAttribute('aria-expanded', String(open));
    $('browseOccupations').textContent = open ? 'Hide suggestions' : 'Find official occupation';
  }

  function chooseOccupation(record, keepRole=true, confirmed=false, candidate=null){
    selectedOccupation = record;
    selectedOccupationCandidate = candidate;
    $('jobSoc').value = record.code;
    const enteredTitle = $('jobRole').value.trim();
    const resolvedTitle = resolvedOccupationTitle(enteredTitle,candidate?.completionLabel || record.jobType);
    if(!keepRole || resolvedTitle !== enteredTitle) $('jobRole').value = resolvedTitle;
    $('jobRole').setCustomValidity('');
    $('jobOccupationName').textContent = record.code + ' · ' + record.jobType;
    $('jobOccupationConfirmed').checked = confirmed;
    $('jobOccupationEvidence').textContent = occupationEligibility(record) +
      (record.standardAnnual ? ' · standard going rate ' + pounds(record.standardAnnual) : '') +
      ' · rates page dated ' + occupationData.sourceUpdated + ' · rules checked ' + occupationCheckedDate();
    $('jobOccupationWhy').textContent = candidate?.reasons?.[0] ||
      'This code was entered directly. Compare the official occupation wording with the vacancy duties.';
    $('jobOccupationGap').textContent = candidate?.gaps?.[0] ||
      'KnowYourSponsor cannot confirm which code the employer will use.';
    $('jobOccupationSelection').hidden = false;
    setOccupationSuggestionsOpen(false);
  }

  function showOccupationSuggestions(value, browseAll=false){
    const query = String(value || '').trim();
    const titleIssue = jobTitleIssue(value);
    const mode = suggestionMode(value);
    if(['empty','short'].includes(mode) && !browseAll){
      setOccupationSuggestionsOpen(false);
      return;
    }
    if(['empty','short'].includes(mode)){
      $('jobOccupationSuggestions').innerHTML = '<span class="application-empty"><strong>Enter the full vacancy title.</strong> ' + esc(titleIssue) + ' We do not know which jobs this employer offers.</span>';
      setOccupationSuggestionsOpen(true);
      return;
    }
    $('jobOccupationSuggestions').innerHTML = '<span class="application-empty">Loading official occupations.</span>';
    setOccupationSuggestionsOpen(true);
    loadOccupationData().then(document=>{
      occupationSuggestions = occupationRanking
        ? (mode === 'guided'
          ? occupationRanking.complete(document.occupations,{title:query},5)
          : occupationRanking.rank(document.occupations,{title:query,advert:$('jobAdvertText').value},5))
        : [];
      if(!occupationSuggestions.length){
        $('jobOccupationSuggestions').innerHTML = mode === 'guided'
          ? '<span class="application-empty"><strong>Keep typing to narrow the occupation.</strong> Add the full title shown on the vacancy, such as IT service manager or software developer. We leave the code empty until you choose a complete title.</span>'
          : '<span class="application-empty"><strong>No defensible candidate was found.</strong> Add a more specific title or compare the duties with the official list. We leave the code empty rather than force a weak match.</span>';
        return;
      }
      const guidance = mode === 'guided'
        ? '<span class="application-empty"><strong>Possible title completions</strong> These are official occupation titles containing your partial word—not evidence that any code is correct. Choose one only if it matches the full vacancy title and duties.</span>'
        : '<span class="application-empty"><strong>Ranked occupation candidates</strong> Compare the evidence and gaps with the actual duties. Position reflects wording support, not the likelihood of sponsorship.</span>';
      $('jobOccupationSuggestions').innerHTML = guidance + occupationSuggestions.map((candidate,index)=>{
        const record = candidate.record;
        const completion = candidate.level === 'completion';
        const label = completion ? 'Suggested official title' : candidate.level === 'exact' ? 'Exact official wording' :
          candidate.level === 'strong' ? 'Strong wording match' : 'Possible wording match';
        return '<button class="occupation-suggestion" type="button" role="option" data-occupation-suggestion="' + index + '">' +
          '<span class="occupation-suggestion-head"><strong>' + esc(completion ? candidate.completionLabel : record.code + ' · ' + record.jobType) +
          '</strong><b>' + esc(completion ? 'Title option ' + (index + 1) : index === 0 ? 'Best supported' : 'Candidate ' + (index + 1)) + '</b></span>' +
          '<span class="occupation-suggestion-level">' + esc(label) + '</span>' +
          '<span><strong>Why it appears:</strong> ' + esc(candidate.reasons.join(' ')) + '</span>' +
          '<span class="occupation-suggestion-gap"><strong>What is not resolved:</strong> ' + esc(candidate.gaps.join(' ')) + '</span>' +
          (candidate.excerpt ? '<q>' + esc(candidate.excerpt) + '</q>' : '') +
          '<span><strong>Official conditions:</strong> ' + esc(occupationEligibility(record)) +
          (record.standardAnnual ? ' · standard rate ' + esc(pounds(record.standardAnnual)) : ' · no standard rate published') +
          '</span><span class="occupation-suggestion-action">' + (completion ? 'Use this title and review' : 'Review this candidate') + '</span></button>';
      }
      ).join('');
    }).catch(()=>{
      $('jobOccupationSuggestions').innerHTML = '<span class="application-empty">Occupation suggestions could not load. Enter a confirmed code or use the official list below.</span>';
    });
  }

  function exactEmployerRow(name, town=''){
    const wanted = comparableEmployerName(name);
    const matches = all.filter(row=>comparableEmployerName(cleanDisplayText(row[0])) === wanted);
    return matches.find(row=>!town || row[1] === town) ||
      (matches.length === 1 ? matches[0] : null);
  }

  async function resolveImportedEmployer(name,town=''){
    const direct = exactEmployerRow(name,town);
    if(direct) return direct;
    const wanted = comparableEmployerName(name);
    if(!wanted) return null;
    const data = await fetchSearchShard(quickShardKey(name));
    const candidates = new Map();
    const add = row=>{
      if(Array.isArray(row)) candidates.set(rowIdentityKey(row),row);
    };
    for(const row of data.sponsors || []){
      if(comparableEmployerName(cleanDisplayText(row[0])) === wanted) add(row);
    }
    for(const item of data.aliases || []){
      if(Array.isArray(item) && Array.isArray(item[2]) &&
          comparableEmployerName(item[0]) === wanted) add(item[2]);
    }
    const matches = [...candidates.values()];
    return matches.find(row=>town && row[1] === town) ||
      (matches.length === 1 ? matches[0] : null);
  }

  function setJobMode(mode, focus=true){
    const checking = mode === 'check';
    $('jobCheckTab').setAttribute('aria-selected', String(checking));
    $('applicationsTab').setAttribute('aria-selected', String(!checking));
    $('jobCheckPane').hidden = !checking;
    $('applicationsPane').hidden = checking;
    $('jobTitle').textContent = checking ? 'Check a job before you apply' : 'My applications';
    $('jobIntro').textContent = checking
      ? 'Use current public evidence to find what is confirmed and what you still need to check.'
      : 'Keep checked jobs private in this browser and see when the public evidence changes.';
    if(!checking && applications.length){
      loadOccupationData().then(renderApplications).catch(renderApplications);
    }
    if(focus) setTimeout(()=>focusJobMode(mode),0);
  }

  function focusJobMode(mode){
    const target = mode === 'check'
      ? $('jobEmployerInput')
      : (applications.length ? $('addApplication') : $('applicationList').querySelector('[data-application-add]'));
    if(target) target.focus();
  }

  function showEmployerSuggestions(value){
    const query = comparableEmployerName(value);
    if(query.length < 2){
      $('jobEmployerSuggestions').hidden = true;
      return;
    }
    if(!all.length){
      $('jobEmployerSuggestions').innerHTML = '<span class="application-empty">Loading the employer list. This takes a few seconds.</span>';
      $('jobEmployerSuggestions').hidden = false;
      return;
    }
    const shardKey = quickShardKey(value);
    const aliasDocument = searchShardDocuments.get(shardKey);
    if(!aliasDocument){
      fetchSearchShard(shardKey).then(()=>{
        if(comparableEmployerName($('jobEmployerInput').value) === query)
          showEmployerSuggestions($('jobEmployerInput').value);
      }).catch(()=>{});
    }
    const candidates = new Map();
    const addCandidate = (row,rank,alias=null)=>{
      if(isReviewedSourceAnomaly(row[0])) return;
      const key = rowIdentityKey(row);
      const existing = candidates.get(key);
      if(!existing || rank < existing.rank) candidates.set(key,{row,rank,alias});
    };
    for(const row of sponsorRowsByName.get(query) || []) addCandidate(row,0);
    let startsAdded = 0, containsAdded = 0;
    for(const row of all){
      const name = comparableEmployerName(cleanDisplayText(row[0]));
      if(name === query){
        if(!sponsorRowsByName.size) addCandidate(row,0);
      }else if(name.startsWith(query) && startsAdded < 12){
        addCandidate(row,2);
        startsAdded += 1;
      }else if(name.includes(query) && containsAdded < 12){
        addCandidate(row,4);
        containsAdded += 1;
      }
      if(startsAdded >= 12 && containsAdded >= 12 && sponsorRowsByName.size) break;
    }
    for(const item of aliasDocument?.aliases || []){
      if(!Array.isArray(item) || !Array.isArray(item[2])) continue;
      const alias = {term:String(item[0] || ''),kind:item[1],row:item[2]};
      const searchable = comparableEmployerName(alias.term);
      if(searchable === query) addCandidate(alias.row,1,alias);
      else if(searchable.startsWith(query)) addCandidate(alias.row,3,alias);
      else if(searchable.includes(query)) addCandidate(alias.row,5,alias);
    }
    const ranked = [...candidates.values()].sort((left,right)=>
      left.rank-right.rank || String(left.row[0]).localeCompare(String(right.row[0]),'en-GB'));
    jobSuggestions = ranked.slice(0,6).map(item=>item.row);
    jobSuggestionEvidence = new Map(ranked.slice(0,6).filter(item=>item.alias)
      .map(item=>[rowIdentityKey(item.row),item.alias]));
    if(!jobSuggestions.length){
      $('jobEmployerSuggestions').innerHTML = '<span class="application-empty">' +
        (fullLoaded
          ? 'No sponsor match found. Try the legal name, trading name or company number.'
          : 'The complete employer list is still loading. Try again in a few seconds.') + '</span>';
      $('jobEmployerSuggestions').hidden = false;
      return;
    }
    $('jobEmployerSuggestions').innerHTML = jobSuggestions.map((row,index)=>
      '<button type="button" role="option" data-job-suggestion="' + index + '"><strong>' +
      esc(cleanDisplayText(row[0])) + '</strong><span>' + esc(cleanPlace(row[1]) || 'Town not published') +
      ' · ' + esc((row[4] || []).join(', ') || 'Visa route not published') + '</span></button>'
    ).join('');
    jobSuggestions.forEach((row,index)=>{
      const alias = jobSuggestionEvidence.get(rowIdentityKey(row));
      if(!alias) return;
      const button = $('jobEmployerSuggestions').querySelector(
        '[data-job-suggestion="' + index + '"]');
      if(!button) return;
      const label = IDENTITY_ALIAS_LABELS[alias.kind] || 'source-backed name';
      button.insertAdjacentHTML('beforeend','<span><strong>Found using ' +
        esc(label) + ':</strong> ' + esc(alias.term) + '</span>');
    });
    $('jobEmployerSuggestions').hidden = false;
  }

  function selectJobEmployer(row, imported=false){
    jobEmployerRow = row;
    if(!imported) pendingBrowserJob = null;
    $('jobEmployerInput').value = cleanDisplayText(row[0]);
    if(imported) $('jobEmployerInput').dataset.imported = 'true';
    else $('jobEmployerInput').removeAttribute('data-imported');
    $('jobEmployerName').textContent = cleanDisplayText(row[0]);
    $('jobEmployerEvidence').textContent = cleanPlace(row[1]) + ' · ' +
      ((row[4] || []).join(', ') || 'Visa route not published') + ' · Rating ' + (row[5] || 'not published');
    $('jobEmployer').hidden = false;
    $('jobEmployerSuggestions').hidden = true;
    loadCompanyIdentity(row[0]).then(()=>{
      if(checkedJob && checkedJob.employer === row[0] && jobEmployerRow === row &&
          !$('jobResult').hidden){
        renderJobResult(checkedJob,row);
      }
    }).catch(()=>{});
  }

  function pounds(value){
    return Number(value || 0).toLocaleString('en-GB',{
      style:'currency',currency:'GBP',maximumFractionDigits:0
    });
  }

  function salaryComparison(application, occupation){
    const assessment = application.ruleAssessment;
    if(assessment && assessment.ruleset){
      const rule = assessment.ruleset;
      const version = esc(rule.version || rule.id || 'version not recorded');
      const sourceDate = esc(rule.sourceUpdated || 'source date not recorded');
      if(assessment.state === 'unresolved'){
        return '<div class="salary-comparison"><strong>' + esc(assessment.basisLabel || 'Salary basis unresolved') + ': not calculated</strong>' +
          '<p>' + esc(assessment.reason) + '</p><dl><dt>Ruleset</dt><dd>' + version + '</dd>' +
          '<dt>Source update</dt><dd>' + sourceDate + '</dd><dt>Weekly hours</dt><dd>' +
          esc(String(assessment.inputs?.hours || 'Not provided')) + '</dd></dl>' +
          '<p>This unresolved state is intentional. KnowYourSponsor does not infer personal eligibility, list membership, transitional dates or national pay-scale evidence.</p></div>';
      }
      const calculation = assessment.calculation;
      const difference = Number(calculation.difference || 0);
      const summary = difference >= 0 ? 'The pay entered clears both standard benchmarks' :
        'The pay entered is ' + pounds(-difference) + ' below the higher standard benchmark';
      const answer = difference > 0
        ? 'The salary entered is <span class="salary-key">' + esc(pounds(difference)) + '</span> above the higher standard benchmark of ' + esc(pounds(calculation.requiredBenchmark)) + '.'
        : difference < 0
          ? 'The salary entered is <span class="salary-key">' + esc(pounds(-difference)) + '</span> below the higher standard benchmark of ' + esc(pounds(calculation.requiredBenchmark)) + '.'
          : 'The salary entered matches the higher standard benchmark of <span class="salary-key">' + esc(pounds(calculation.requiredBenchmark)) + '</span>.';
      return '<div class="salary-comparison"><strong>' + esc(summary) + '</strong>' +
        '<p class="salary-answer' + (difference < 0 ? ' below' : '') + '">' + answer + '</p><dl>' +
        '<dt>Annual salary used</dt><dd>' + esc(pounds(assessment.inputs.annualSalary)) + '</dd>' +
        '<dt>Usual general threshold</dt><dd>' + esc(pounds(calculation.generalThreshold)) + '</dd>' +
        '<dt>' + esc(assessment.inputs.occupationCode) + ' rate at ' + esc(String(calculation.weeklyHours)) + ' hours</dt><dd>' + esc(pounds(calculation.goingRate)) + '</dd>' +
        '<dt>Formula</dt><dd><code>' + esc(calculation.formula) + '</code></dd>' +
        '<dt>Higher required benchmark</dt><dd>' + esc(pounds(calculation.requiredBenchmark)) + '</dd></dl>' +
        '<p><strong>Rules receipt:</strong> ' + version + ', source updated ' + sourceDate +
        '. The occupation was confirmed by you. Non-standard rules were not applied. This receipt stays with a saved report so the calculation can be reproduced after current rates change.</p></div>';
    }
    if(!Number(application.annualSalary || 0)){
      return '<div class="salary-comparison"><strong>Salary comparison unavailable</strong>' +
        '<p>No advertised salary was provided. The sponsor and company evidence can still be reviewed, but pay cannot be compared with an occupation benchmark.</p></div>';
    }
    if(!occupationData || !occupation || !application.occupationConfirmed){
      return '<div class="salary-comparison"><strong>Salary converted, not compared</strong>' +
        '<p>Choose an official occupation and confirm it against the vacancy duties before comparing pay.</p></div>';
    }
    const annual = Number(application.annualSalary || 0);
    const general = Number(occupationData.generalThreshold || 0);
    const hoursBasis = Number(occupationData.hoursBasis || 37.5);
    if(!occupationEvidenceFresh()) return '<div class="salary-comparison"><strong>Salary comparison paused</strong><p>Our latest automated source check is older than four days. Open the current GOV.UK rates before relying on a figure.</p></div>';
    if(!occupation.standardAnnual){
      return '<div class="salary-comparison"><strong>No standard-rate comparison available</strong>' +
        '<dl><dt>Salary entered</dt><dd>' + esc(pounds(annual)) + '</dd>' +
        '<dt>Occupation</dt><dd>' + esc(occupation.code) + '</dd></dl>' +
        '<p>The GOV.UK table says this occupation is not eligible for standard-rate applications. Other routes or transitional rules may differ. This is not a visa decision.</p></div>';
    }
    const going = Math.round(Number(occupation.standardAnnual) * Number(application.hours || hoursBasis) / hoursBasis);
    const required = Math.max(general, going);
    const difference = annual - required;
    const summary = difference >= 0 ? 'The pay entered clears both standard benchmarks' :
      'The pay entered is ' + pounds(-difference) + ' below the higher standard benchmark';
    const answer = difference > 0
      ? 'The salary entered is <span class="salary-key">' + esc(pounds(difference)) + '</span> above the higher standard benchmark of ' + esc(pounds(required)) + '.'
      : difference < 0
        ? 'The salary entered is <span class="salary-key">' + esc(pounds(-difference)) + '</span> below the higher standard benchmark of ' + esc(pounds(required)) + '.'
        : 'The salary entered matches the higher standard benchmark of <span class="salary-key">' + esc(pounds(required)) + '</span>.';
    const differenceLabel = difference > 0 ? 'Amount above benchmark' : difference < 0 ? 'Shortfall against benchmark' : 'Difference';
    return '<div class="salary-comparison"><strong>' + esc(summary) + '</strong>' +
      '<p class="salary-answer' + (difference < 0 ? ' below' : '') + '">' + answer + '</p><dl>' +
      '<dt>Salary entered</dt><dd>' + esc(pounds(annual)) + '</dd>' +
      '<dt>Usual general threshold</dt><dd>' + esc(pounds(general)) + '</dd>' +
      '<dt>' + esc(occupation.code) + ' going rate at ' + esc(String(application.hours)) + ' hours</dt><dd>' + esc(pounds(going)) + '</dd>' +
      '<dt>Higher required benchmark</dt><dd>' + esc(pounds(required)) + '</dd>' +
      '<dt>' + differenceLabel + '</dt><dd class="salary-key">' + esc(pounds(Math.abs(difference))) + '</dd></dl>' +
      '<p>Based on occupation ' + esc(occupation.code) + ', confirmed by you. Rates page dated ' + esc(occupationData.sourceUpdated) +
      '; figures automatically cross-checked against the current Immigration Rules on ' + esc(occupationCheckedDate()) + '. Special and lower-salary rules and personal circumstances are not assessed. This is not a visa decision.</p></div>';
  }

  function jobDecisionBrief(application,row,occupation,salaryGap,warning,identity,cosHistory,cosUsage){
    const employerPolicy = employerPolicyFor(row);
    const brief = window.kysJobDecision.buildVacancyBrief({
      skilledWorker:(row[4] || []).some(route=>/skilled worker/i.test(route)),
      companyState:identity && identity.state || 'unmatched',
      companyStatus:identity && identity.status || '',
      companyWarningLabel:warning && warning.label || '',
      companyWarningSeverity:warning && warning.severity || '',
      occupationCode:occupation && occupation.code || '',
      occupationTitle:occupation && occupation.jobType || '',
      occupationConfirmed:Boolean(occupation && application.occupationConfirmed),
      occupationFresh:occupationEvidenceFresh(),
      salaryProvided:Boolean(Number(application.annualSalary || 0)),
      salaryGap,
      sponsorshipClaim:application.sponsorshipClaim || 'unknown',
      paymentRequest:application.paymentRequest || 'unknown',
      recruiterEmail:application.recruiterEmail || '',
      employerPolicyStatement:employerPolicy && employerPolicy.statement || '',
      cosHistory,
      cosUsage2025:cosUsage,
    });
    if(application.ruleAssessment?.state === 'unresolved'){
      const assessment = application.ruleAssessment;
      const salaryCheck = brief.checks.find(check=>check.key === 'salary');
      if(salaryCheck){
        salaryCheck.state = 'unknown';
        salaryCheck.kind = 'unknown';
        salaryCheck.value = assessment.reason;
      }
      brief.state = 'unconfirmed';
      brief.title = (assessment.basisLabel || 'Selected salary rule') + ' needs supporting evidence';
      brief.summary = assessment.reason;
      brief.evidenceState = 'incomplete';
      brief.evidenceStateLabel = 'Evidence incomplete';
      brief.evidenceStateNote = 'The selected salary basis was recorded but not inferred.';
      brief.question = assessment.basis === 'standard'
        ? 'Which occupation code, salary and weekly hours will be stated on the Certificate of Sponsorship?'
        : 'Which official rule and supporting evidence will the employer rely on for this salary basis?';
    }
    const stateLabel = {checked:'Checked',review:'Check first',unknown:'Unknown',history:'History found'};
    const checks = brief.checks.map(check=>
      '<div class="job-decision-check ' + esc(check.state) +
        (check.critical ? ' critical' : '') + '">' +
        '<div class="job-decision-check-head"><strong>' + esc(check.label) + '</strong>' +
        '<span>' + esc(stateLabel[check.state] || 'Unknown') + '</span></div>' +
        '<p>' + esc(check.value) + '</p>' + evidenceKind(check.kind) + '</div>'
    ).join('');
    return '<section class="job-decision-brief ' + esc(brief.state) +
      '" aria-labelledby="jobDecisionTitle"><div class="job-decision-overview ' + esc(brief.evidenceState) + '" id="jobEvidenceState">' +
      '<span>Evidence state</span><strong>' + esc(brief.evidenceStateLabel) + '</strong>' +
      '<small>' + esc(brief.evidenceStateNote) + '</small></div>' +
      '<span class="eyebrow">What the evidence says</span>' +
      '<h4 id="jobDecisionTitle">' + esc(brief.title) + '</h4><p class="job-decision-summary">' +
      esc(brief.summary) + '</p><div class="job-decision-checks">' + checks + '</div>' +
      '<div class="job-decision-action"><strong>Ask the employer</strong><span>' +
      esc(brief.question) + '</span></div></section>';
  }

  function renderJobResult(application, row){
    jobFeedbackRecorded = false;
    jobFeedbackCategory = '';
    const titleIssue = jobTitleIssue(application && application.role);
    if(titleIssue){
      checkedJob = null;
      $('jobResult').innerHTML = '<h3>Enter the full job title.</h3><p>' + esc(titleIssue) +
        ' This saved or imported check cannot produce a report until the title is corrected.</p>';
      $('jobResult').hidden = false;
      $('saveApplicationPanel').hidden = true;
      return false;
    }
    const routes = row[4] || [];
    const skilled = routes.some(route=>/skilled worker/i.test(route));
    const warning = warningFor(row[0]);
    const identity = companyIdentities.get(row[0]);
    const cosHistory = cosHistories.get(row[0]);
    const cosUsage = cosUsageRecords.get(row[0]);
    const salary = Number(application.annualSalary || 0);
    const occupation = occupationData && application.soc
      ? occupationData.occupations.find(record=>record.code === application.soc) : null;
    const hoursBasis = Number(occupationData && occupationData.hoursBasis || 37.5);
    const goingRate = occupation && occupation.standardAnnual
      ? Math.round(Number(occupation.standardAnnual) * Number(application.hours || hoursBasis) / hoursBasis) : null;
    const generalRate = Number(occupationData && occupationData.generalThreshold || 0);
    const hasPinnedAssessment = Boolean(application.ruleAssessment);
    const pinnedDifference = application.ruleAssessment?.calculation?.difference;
    const salaryGap = hasPinnedAssessment
      ? (Number.isFinite(pinnedDifference) ? -pinnedDifference : null)
      : salary && goingRate && application.occupationConfirmed && occupationEvidenceFresh()
        ? Math.max(generalRate,goingRate) - salary : null;
    const official = [
      'Exact sponsor record: ' + esc(cleanDisplayText(row[0])) + ' in ' + esc(cleanPlace(row[1]) || 'town not published') + '.',
      'Sponsor register checked ' + esc(readableTimestamp(currentUpdated) || 'on the source date shown above') + '.'
    ];
    if(skilled) official.push('This sponsor record includes the Skilled Worker route.');
    if(occupation) official.push('GOV.UK lists ' + esc(occupation.code + ' - ' + occupation.jobType) + ' with a standard rate of ' + esc(pounds(occupation.standardAnnual)) + '.');
    const inputs = [salary
      ? 'Advertised pay entered by you: about ' + esc(pounds(salary)) + ' a year.'
      : 'No advertised pay was provided; no salary comparison was made.',
      occupation && application.occupationConfirmed
        ? 'Occupation ' + esc(occupation.code) + ' confirmed by you from the vacancy duties; KnowYourSponsor has not verified the employer’s intended code.'
        : 'No occupation has been confirmed against the vacancy duties.'];
    if(application.location) inputs.push('Advertised work location entered by you: ' + esc(application.location) + '.');
    const offerEvidence=window.kysOfferEvidence.analyse(application);
    inputs.push(...offerEvidence.inputs.map(esc));
    const employerPolicy = employerPolicyFor(row);
    const employerPolicyEvidence = employerPolicy ? [
      (employerPolicy.statement === 'considers' ? 'The employer states that it currently considers sponsorship.' :
        employerPolicy.statement === 'not_currently_considering' ? 'The employer states that it is not currently considering sponsorship.' :
          'The employer states that sponsorship is role-dependent.'),
      'Scope published by the employer: ' + esc([employerPolicy.routes?.join(', '),employerPolicy.departments,
        employerPolicy.occupations,employerPolicy.locations,
        employerPolicy.graduatePolicy && employerPolicy.graduatePolicy !== 'not_stated' ? 'Graduate policy: ' + employerPolicy.graduatePolicy.replaceAll('_',' ') : '',
        employerPolicy.switchingPolicy && employerPolicy.switchingPolicy !== 'not_stated' ? 'Visa switching: ' + employerPolicy.switchingPolicy.replaceAll('_',' ') : '',
        Number.isFinite(employerPolicy.minimumSalaryGbp) ? 'Internal minimum salary: £' + Number(employerPolicy.minimumSalaryGbp).toLocaleString('en-GB') : ''].filter(Boolean).join(' · ') || 'No narrower scope stated.'),
      'Last verified ' + esc(readableTimestamp(employerPolicy.verifiedAt)) + '; expires ' +
        esc(readableTimestamp(employerPolicy.expiresAt)) + '. ' + esc(employerPolicy.limitation)
    ] : [];
    const conflicts = [];
    if(!skilled) conflicts.push('Skilled Worker is not shown on this sponsor record. Check which route the vacancy intends to use.');
    if(warning) conflicts.push('Companies House signal: ' + esc(warning.label) + '. Verify the linked company record before relying on it.');
    if(salaryGap !== null && salaryGap > 0) conflicts.push('The entered pay is ' + esc(pounds(salaryGap)) + ' below the higher usual standard benchmark. A permitted lower-salary rule may change this.');
    conflicts.push(...offerEvidence.conflicts.map(esc));
    const remaining = [
      'Confirm that this specific vacancy offers sponsorship; a sponsor licence does not mean every vacancy is sponsored.',
      occupation ? 'Ask the employer to confirm the occupation code that will appear on the Certificate of Sponsorship.' : 'The job title alone is not enough. Find and confirm the four-digit occupation code from the vacancy duties.',
      'Check personal circumstances and any lower-salary, healthcare, education or transitional rules on GOV.UK.'
    ];
    if(!salary) remaining.push('The advert did not provide pay. Ask what salary and weekly hours will appear on the Certificate of Sponsorship.');
    if(!evidenceLoaded) remaining.push('Company evidence is still loading. Open the employer evidence before relying on this check.');
    else if(identity && identity.state === 'identified' && !warning) remaining.push('No Companies House warning is attached, but that does not guarantee financial health or active recruitment.');
    else if(!identity || identity.state !== 'identified') remaining.push('No Companies House identity was safely attached. This is a coverage gap, not an all-clear.');
    const questions = [
      'Will you sponsor this specific role under the Skilled Worker route?',
      'What four-digit occupation code will be stated on the Certificate of Sponsorship?',
      'What salary and weekly hours will be stated on the Certificate of Sponsorship?'
    ];
    if(salaryGap !== null && salaryGap > 0) questions.push('Which permitted lower-salary rule, if any, do you expect to apply?');
    questions.push(...offerEvidence.questions.map(esc));
    const occupationCandidateEvidence = application.occupationCandidate &&
      Array.isArray(application.occupationCandidate.reasons) && Array.isArray(application.occupationCandidate.gaps)
      ? ['Why this candidate appeared: ' + esc(application.occupationCandidate.reasons.join(' ')),
        'What the ranking did not resolve: ' + esc(application.occupationCandidate.gaps.join(' '))]
      : [occupation
        ? 'The code was entered directly or restored from a saved check. No candidate-ranking explanation is attached.'
        : 'No occupation candidate was selected.'];
    const section = (title,kind,items)=>'<section class="job-evidence-section"><h4>' + title + ' ' + evidenceKind(kind) + '</h4><ul>' +
      items.map(item=>'<li>' + item + '</li>').join('') + '</ul></section>';
    const identityCard = '<section class="job-report-identity" aria-label="Vacancy checked"><span class="eyebrow">Vacancy checked</span>' +
      '<h4>' + esc(application.role) + '</h4><dl><dt>Employer</dt><dd>' + esc(cleanDisplayText(row[0])) + '</dd>' +
      '<dt>Vacancy location</dt><dd>' + esc(application.location || 'Not entered') + '</dd>' +
      '<dt>Advertised pay</dt><dd>' + (salary ? esc(pounds(salary)) + ' a year' : 'Not provided') + '</dd>' +
      '<dt>Selected occupation</dt><dd>' + (occupation ? esc(occupation.code + ' · ' + occupation.jobType) :
        application.ruleAssessment?.ruleset?.occupation ? esc(application.ruleAssessment.ruleset.occupation.code + ' · ' + application.ruleAssessment.ruleset.occupation.jobType) : 'Not confirmed') + '</dd>' +
      '<dt>Assessment basis</dt><dd>' + esc(application.ruleAssessment?.basisLabel || 'Legacy check · ruleset not pinned') + '</dd></dl></section>';
    $('jobResult').innerHTML = '<h3>Your vacancy evidence report</h3>' +
      jobDecisionBrief(application,row,occupation,salaryGap,warning,identity,cosHistory,cosUsage) +
      identityCard +
      companyIdentityPassport(row[0],identity) +
      '<p>Official records and your inputs are kept separate. This is not an eligibility or safety decision.</p>' +
      salaryComparison(application,occupation) +
      '<div class="job-evidence-grid">' + section('Official evidence','official',official) + section('Your inputs','user',inputs) +
      (employerPolicyEvidence.length ? section('Employer-provided policy','employer',employerPolicyEvidence) : '') +
      section('Occupation candidate explanation','derived',occupationCandidateEvidence) +
      section('Possible conflicts','derived',conflicts.length ? conflicts : ['No direct conflict was found in the evidence currently attached. This is not an all-clear.']) +
      section('Still needs checking','unknown',remaining) + section('Questions to ask the employer','unknown',questions) + '</div>' +
      '<div class="next-checks"><strong>Official sources</strong><div class="job-result-actions">' +
      '<a href="https://www.gov.uk/skilled-worker-visa/your-job" target="_blank" rel="noopener">Job and salary rules</a>' +
      '<a href="https://www.gov.uk/skilled-worker-visa/when-you-can-be-paid-less" target="_blank" rel="noopener">Lower salary rules</a>' +
      '<a href="https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-skilled-occupations" target="_blank" rel="noopener">Current occupation rates</a>' +
      '<a href="https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers" target="_blank" rel="noopener">Sponsor register</a>' +
      (cosHistory && cosHistorySource
        ? '<a href="' + attr(cosHistorySource) + '" target="_blank" rel="noopener" data-cos-source>Historical CoS source</a>'
        : '') +
      (cosUsage && cosUsageSource
        ? '<a href="' + attr(cosUsageSource) + '" target="_blank" rel="noopener" data-cos-source>2025 CoS use source</a>'
        : '') + '</div></div>' +
      '<div class="job-result-actions"><button class="download" id="copyJobEvidence" type="button">Copy non-personal summary</button>' +
      '<button class="download" id="printJobEvidence" type="button">Print or save as PDF</button></div>' +
      '<p class="caveat">This organises public evidence. It does not decide whether the role or applicant qualifies for a visa.</p>' +
      '<section class="job-feedback" aria-labelledby="jobFeedbackTitle"><strong id="jobFeedbackTitle">Did this report help?</strong>' +
      '<div class="job-feedback-actions"><button class="download" type="button" data-job-feedback="useful">Yes</button>' +
      '<button class="download" type="button" data-job-feedback="not-yet">Not yet</button></div>' +
      '<div class="job-feedback-reasons" id="jobFeedbackReasons" hidden><strong>What should be clearer?</strong>' +
      '<div class="job-feedback-actions"><button class="download" type="button" data-job-feedback="employer">Employer match</button>' +
      '<button class="download" type="button" data-job-feedback="occupation">Occupation</button>' +
      '<button class="download" type="button" data-job-feedback="salary">Salary comparison</button>' +
      '<button class="download" type="button" data-job-feedback="details">Missing job details</button></div></div>' +
      '<form class="job-feedback-form" id="jobFeedbackForm" hidden>' +
      '<label>What was unclear or incorrect? <span class="job-optional">Optional</span>' +
      '<textarea id="jobFeedbackComment" maxlength="300" rows="3" placeholder="A short example helps us understand the problem."></textarea></label>' +
      '<label class="job-feedback-consent"><input id="jobFeedbackContact" type="checkbox"> You may email me about this feedback</label>' +
      '<label id="jobFeedbackEmailLabel" hidden>Email address<input id="jobFeedbackEmail" type="email" autocomplete="email" maxlength="254"></label>' +
      '<p class="job-privacy">We send only the category and anything you enter here. Your employer, vacancy, salary and report are not sent.</p>' +
      '<button class="download" id="submitJobFeedback" type="submit">Send feedback</button></form>' +
      '<p class="job-feedback-status" id="jobFeedbackStatus" role="status" aria-live="polite"></p></section>';
    $('jobResult').hidden = false;
    $('saveApplicationPanel').hidden = false;
    return true;
  }

  function copyJobEvidence(){
    const result = $('jobResult');
    if(!result || result.hidden) return;
    const copy = result.cloneNode(true);
    copy.querySelectorAll('button,.job-feedback').forEach(node=>node.remove());
    const text = copy.innerText.trim();
    navigator.clipboard.writeText(text).then(()=>{
      const button = $('copyJobEvidence');
      if(!button) return;
      button.textContent = 'Summary copied';
      setTimeout(()=>{ if(button) button.textContent = 'Copy non-personal summary'; },1600);
    }).catch(()=>{});
    trackEvent('job_evidence_copied','Job evidence copied');
  }

  function printJobEvidence(){
    const previous = $('jobPrintRoot');
    if(previous) previous.remove();
    const root = document.createElement('main');
    root.id = 'jobPrintRoot';
    const result = $('jobResult').cloneNode(true);
    result.hidden = false;
    result.removeAttribute('id');
    result.querySelectorAll('button,.job-feedback').forEach(node=>node.remove());
    root.append(result);
    document.body.append(root);
    document.body.classList.add('print-job-evidence');
    trackEvent('job_pdf_report_opened','Job evidence report opened');
    const clean = ()=>{ root.remove(); document.body.classList.remove('print-job-evidence'); };
    window.addEventListener('afterprint',clean,{once:true});
    void root.offsetHeight;
    window.print();
  }

  function recordJobFeedback(value){
    if(jobFeedbackRecorded) return;
    const reasons = $('jobFeedbackReasons');
    const form = $('jobFeedbackForm');
    const status = $('jobFeedbackStatus');
    if(value === 'not-yet'){
      reasons.hidden = false;
      status.textContent = 'Choose the part that needs work.';
      reasons.querySelector('button').focus();
      return;
    }
    if(value === 'useful'){
      trackEvent('job_feedback_useful','Job report was useful');
      if(communityPilot) trackEvent('community_pilot_feedback_useful','Community pilot report was useful');
      jobFeedbackRecorded = true;
      reasons.hidden = true;
      $('jobResult').querySelectorAll('[data-job-feedback]').forEach(button=>{ button.disabled = true; });
      status.textContent = 'Thank you. This helps us protect what works.';
      return;
    }
    if(!['employer','occupation','salary','details'].includes(value)) return;
    jobFeedbackCategory = value;
    form.hidden = false;
    status.textContent = 'Add a note if useful, then send. The note is optional.';
    reasons.querySelectorAll('[data-job-feedback]').forEach(button=>{
      button.setAttribute('aria-pressed',String(button.dataset.jobFeedback === value));
    });
    $('jobFeedbackComment').focus();
  }

  function trackNegativeJobFeedback(value){
    if(value === 'employer') trackEvent('job_feedback_employer_match','Job report employer match needs work');
    else if(value === 'occupation') trackEvent('job_feedback_occupation','Job report occupation needs work');
    else if(value === 'salary') trackEvent('job_feedback_salary','Job report salary comparison needs work');
    else if(value === 'details') trackEvent('job_feedback_missing_details','Job report missing vacancy details');
    if(communityPilot) trackEvent('community_pilot_feedback_needs_work','Community pilot report needs work');
  }

  async function submitJobFeedback(){
    if(jobFeedbackRecorded || !jobFeedbackCategory) return;
    const form = $('jobFeedbackForm');
    const button = $('submitJobFeedback');
    const status = $('jobFeedbackStatus');
    const contactConsent = $('jobFeedbackContact').checked;
    const email = $('jobFeedbackEmail').value.trim();
    if(contactConsent && !$('jobFeedbackEmail').checkValidity()){
      $('jobFeedbackEmail').reportValidity();
      return;
    }
    button.disabled = true;
    status.textContent = 'Sending feedback…';
    try{
      if(ANALYTICS_HOSTS.has(location.hostname)){
        const response = await fetch('https://app.knowyoursponsor.co.uk/v1/public/product-feedback',{
          method:'POST',credentials:'omit',headers:{'content-type':'application/json'},
          body:JSON.stringify({category:jobFeedbackCategory,source:communityPilot?'community_pilot':'job_report',
            comment:$('jobFeedbackComment').value,contactConsent,email:contactConsent?email:''})
        });
        if(!response.ok) throw new Error('Feedback could not be sent');
      }
      trackNegativeJobFeedback(jobFeedbackCategory);
      jobFeedbackRecorded = true;
      form.hidden = true;
      $('jobFeedbackReasons').hidden = true;
      $('jobResult').querySelectorAll('[data-job-feedback]').forEach(item=>{ item.disabled = true; });
      status.textContent = 'Thank you. Your feedback was sent without the vacancy or report details.';
    }catch(error){
      status.textContent = 'Your feedback could not be sent. Please try again.';
      button.disabled = false;
    }
  }

  function currentApplicationRow(application){
    const key = savedKey(application.employer || '',application.town || '');
    return sponsorByKey.get(key) || null;
  }

  function salaryEvidenceSnapshot(application){
    if(application.ruleAssessment){
      const assessment = application.ruleAssessment;
      return {state:assessment.state === 'unresolved' ? 'unresolved' : 'current',
        rulesetId:assessment.ruleset?.id || '',rulesetVersion:assessment.ruleset?.version || '',
        sourceUpdated:assessment.ruleset?.sourceUpdated || '',checkedAt:assessment.ruleset?.checkedAt || '',
        occupationCode:assessment.inputs?.occupationCode || '',annualSalary:Number(assessment.inputs?.annualSalary || 0),
        standardAnnual:Number(assessment.calculation?.occupationAnnualRate || 0),
        generalThreshold:Number(assessment.calculation?.generalThreshold || 0),
        goingRate:Number(assessment.calculation?.goingRate || 0),
        requiredBenchmark:Number(assessment.calculation?.requiredBenchmark || 0)};
    }
    const code = String(application.soc || '');
    const occupation = occupationData && code
      ? occupationData.occupations.find(record=>record.code === code) : null;
    const base = {
      state:!application.occupationConfirmed ? 'unconfirmed' : !occupationData ? 'unavailable' :
        !occupation ? 'occupation_not_found' : !occupationEvidenceFresh() ? 'stale' : 'current',
      occupationCode:code,annualSalary:Number(application.annualSalary || 0),
      sourceUpdated:occupationData?.sourceUpdated || '',checkedAt:occupationData?.checkedAt || ''
    };
    if(base.state !== 'current' || !occupation.standardAnnual) return base;
    const hoursBasis = Number(occupationData.hoursBasis || 37.5);
    const goingRate = Math.round(Number(occupation.standardAnnual) *
      Number(application.hours || hoursBasis) / hoursBasis);
    return {...base,standardAnnual:Number(occupation.standardAnnual),
      generalThreshold:Number(occupationData.generalThreshold || 0),goingRate,
      requiredBenchmark:Math.max(Number(occupationData.generalThreshold || 0),goingRate)};
  }

  function applicationEvidenceSnapshot(application,row){
    const employerName = row ? row[0] : application.employer;
    const companyRecord = companyFlags[employerName] || null;
    const warning = warningFor(employerName);
    return {
      version:APPLICATION_EVIDENCE_VERSION,capturedAt:new Date().toISOString(),
      register:{state:row ? 'present' : 'not_present',rating:row?.[5] || '',
        routes:row ? [...(row[4] || [])].sort() : [],sourceUpdated:currentUpdated || ''},
      company:{state:!evidenceLoaded ? 'unavailable' : warning ? 'warning' : 'no_warning_found',
        flags:companyRecord?.flags ? [...companyRecord.flags].sort() : [],
        status:companyRecord?.status || '',warningLabel:warning?.label || '',
        warningSeverity:warning?.severity || '',sourceUpdated:companyEvidenceUpdated || ''},
      salary:salaryEvidenceSnapshot(application)
    };
  }

  function sameEvidenceList(left,right){
    return JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
  }

  function applicationEvidenceReview(application){
    const baseline = application.evidenceSnapshot;
    if(!baseline) return {state:'baseline',label:'No earlier evidence baseline',
      summary:'This application was saved before evidence history was available. Record today’s evidence before tracking future changes.',
      changes:[],baseline:null};
    if(!fullLoaded) return {state:'loading',label:'Checking current evidence',
      summary:'The latest sponsor register is still loading.',changes:[],baseline};
    const current = applicationEvidenceSnapshot(application,currentApplicationRow(application));
    const changes = [];
    let critical = false;
    const beforeRegister = baseline.register || {};
    const nowRegister = current.register;
    if(beforeRegister.state === 'present' && nowRegister.state === 'not_present'){
      changes.push('This exact employer and town are not present in the latest sponsor-register snapshot.');
      critical = true;
    }else if(beforeRegister.state === 'not_present' && nowRegister.state === 'present'){
      changes.push('This exact employer and town now appear in the sponsor register.');
    }else if(beforeRegister.state === 'present' && nowRegister.state === 'present'){
      if(String(beforeRegister.rating || '') !== String(nowRegister.rating || '')){
        changes.push('Sponsor rating changed from ' + (beforeRegister.rating || 'not published') +
          ' to ' + (nowRegister.rating || 'not published') + '.');
        if(String(beforeRegister.rating).toUpperCase() === 'A' &&
          String(nowRegister.rating).toUpperCase() === 'B') critical = true;
      }
      if(!sameEvidenceList(beforeRegister.routes,nowRegister.routes)){
        const beforeSkilled = (beforeRegister.routes || []).some(route=>/skilled worker/i.test(route));
        const nowSkilled = nowRegister.routes.some(route=>/skilled worker/i.test(route));
        changes.push(beforeSkilled && !nowSkilled
          ? 'The Skilled Worker route no longer appears on this sponsor record.'
          : 'The visa routes on this sponsor record changed.');
        if(beforeSkilled && !nowSkilled) critical = true;
      }
    }
    const beforeCompany = baseline.company || {state:'unavailable'};
    const nowCompany = current.company;
    if(evidenceLoaded && beforeCompany.state !== 'unavailable'){
      if(!sameEvidenceList(beforeCompany.flags,nowCompany.flags)){
        if(nowCompany.state === 'warning'){
          changes.push('Current Companies House evidence now shows: ' +
            (nowCompany.warningLabel || 'a company warning') + '.');
          if(nowCompany.warningSeverity === 'serious') critical = true;
        }else{
          changes.push('A previously recorded Companies House warning no longer appears in the current snapshot.');
        }
      }else if(String(beforeCompany.status || '') !== String(nowCompany.status || '')){
        changes.push('The linked Companies House status changed from ' +
          (beforeCompany.status || 'not recorded') + ' to ' + (nowCompany.status || 'not recorded') + '.');
      }
    }
    const beforeSalary = baseline.salary || {state:'unavailable'};
    const nowSalary = current.salary;
    if(occupationData && beforeSalary.state === 'current' && nowSalary.state === 'current' &&
       Number(beforeSalary.requiredBenchmark || 0) !== Number(nowSalary.requiredBenchmark || 0)){
      changes.push('The higher standard salary benchmark changed from ' +
        pounds(beforeSalary.requiredBenchmark) + ' to ' + pounds(nowSalary.requiredBenchmark) + '.');
      if(Number(application.annualSalary || 0) < Number(nowSalary.requiredBenchmark || 0)) critical = true;
    }
    if(changes.length) return {state:critical ? 'critical' : 'changed',
      label:critical ? 'Important evidence changed' : 'Evidence changed since you saved this',
      summary:'Review the current sources before your next decision. Saving the reviewed check creates a new baseline.',
      changes,baseline,current};
    const incomplete = beforeCompany.state === 'unavailable' || beforeSalary.state === 'unavailable' ||
      beforeSalary.state === 'stale' || beforeSalary.state === 'occupation_not_found';
    if(!evidenceLoaded || (application.occupationConfirmed && !occupationData)){
      return {state:'loading',label:'Finishing the evidence recheck',
        summary:'Sponsor evidence is ready; company or occupation evidence is still loading.',changes:[],baseline,current};
    }
    if(incomplete) return {state:'limited',label:'Earlier baseline was incomplete',
      summary:'No change can be proved for evidence that was unavailable when this application was saved. Record a fresh baseline to continue.',
      changes:[],baseline,current};
    return {state:'current',label:'No material evidence change found',
      summary:'The tracked sponsor, company-warning and salary-benchmark fields match the saved baseline. This is not an all-clear.',
      changes:[],baseline,current};
  }

  function applicationEvidenceHTML(application,review){
    const date = review.baseline?.capturedAt
      ? '<time datetime="' + attr(review.baseline.capturedAt) + '">Baseline ' +
        esc(readableTimestamp(review.baseline.capturedAt)) + '</time>' : '';
    const changes = review.changes.length ? '<ul>' + review.changes.map(change=>
      '<li>' + esc(change) + '</li>').join('') + '</ul>' : '';
    return '<section class="application-evidence ' + review.state + '">' +
      '<div class="application-evidence-head"><strong>' + esc(review.label) + '</strong>' + date + '</div>' +
      '<p>' + esc(review.summary) + '</p>' + changes +
      '<p class="application-evidence-note">Compared fields only. A sponsor licence still does not prove this vacancy offers sponsorship.</p></section>';
  }

  function renderApplications(){
    const evidenceReviews = new Map(applications.map(item=>[item.id,applicationEvidenceReview(item)]));
    const needsReview = [...evidenceReviews.values()].filter(review=>
      ['critical','changed','baseline','limited'].includes(review.state)).length;
    $('applicationCount').textContent = applications.length ? '(' + applications.length + ')' : '';
    $('dialogApplicationCount').textContent = applications.length ? '(' + applications.length + ')' : '';
    $('navApplicationCount').textContent = applications.length || '';
    $('navApplicationCount').hidden = applications.length === 0;
    $('navJobTools').setAttribute('aria-label', applications.length
      ? 'Job tools, ' + applications.length + (applications.length === 1 ? ' saved application' : ' saved applications')
      : 'Job tools');
    $('exportApplications').hidden = applications.length === 0;
    $('addApplication').hidden = applications.length === 0;
    $('applicationSummary').textContent = applications.length
      ? applications.length + (applications.length === 1 ? ' application saved in this browser.' : ' applications saved in this browser.') +
        (needsReview ? ' ' + needsReview + (needsReview === 1 ? ' needs' : ' need') + ' evidence review.' : '')
      : 'No applications saved in this browser.';
    if(!applications.length){
      $('applicationList').innerHTML = '<div class="application-empty"><strong>No applications yet</strong>' +
        '<p>Check a job to review its sponsor evidence and yearly pay. Save it here only if you want to track it.</p>' +
        '<button class="job-primary" type="button" data-application-add>Check your first job</button></div>';
      return;
    }
    $('applicationList').innerHTML = applications.map(item=>{
      const salary = Number(item.annualSalary || 0).toLocaleString('en-GB',{
        style:'currency',currency:'GBP',maximumFractionDigits:0
      });
      const review = evidenceReviews.get(item.id);
      const baselineAction = ['baseline','limited'].includes(review.state) &&
        fullLoaded && evidenceLoaded
        ? '<button type="button" data-application-baseline="' + attr(item.id) + '">Record current baseline</button>'
        : '';
      return '<article class="application-card"><div><strong>' + esc(item.role) +
        ' at ' + esc(cleanDisplayText(item.employer)) + '</strong><span>' +
        esc(item.status) + ' · ' + (Number(item.annualSalary || 0) ? esc(salary) + ' a year' : 'salary not provided') +
        (item.soc ? ' · occupation code ' + esc(item.soc) : ' · occupation code not recorded') +
        '</span></div><div class="application-card-actions">' +
        '<button type="button" data-application-edit="' + attr(item.id) + '">Review check</button>' +
        baselineAction +
        '<button type="button" data-application-remove="' + attr(item.id) + '">Remove</button>' +
        '</div>' + applicationEvidenceHTML(item,review) + '</article>';
    }).join('');
  }

  function openJobChecker(row, application, mode='check'){
    pendingBrowserJob = null;
    jobEmployerRow = row || null;
    checkedJob = null;
    selectedOccupation = null;
    selectedOccupationCandidate = null;
    if(mode === 'check' && !application) trackJobStart();
    else{ jobCheckStartedAt = 0; jobCompletionTracked = true; }
    $('jobForm').reset();
    $('jobHours').value = '37.5';
    $('jobEditId').value = application ? application.id : '';
    $('jobEmployerInput').value = application ? application.employer : (row ? row[0] : '');
    $('jobRole').value = application ? application.role : '';
    $('jobLocation').value = application ? (application.location || '') : '';
    $('jobSalary').value = application ? application.salary : '';
    $('jobSalaryPeriod').value = application ? application.salaryPeriod : 'year';
    $('jobHours').value = application ? application.hours : '37.5';
    $('jobRuleBasis').value = application ? (application.ruleBasis || application.ruleAssessment?.basis || 'standard') : 'standard';
    $('jobSoc').value = application ? application.soc : '';
    window.kysOfferEvidence.hydrate(application);
    $('jobStatus').value = application ? application.status : 'Considering';
    $('jobNotes').value = application ? application.notes : '';
    $('jobResult').hidden = true;
    $('saveApplicationPanel').hidden = true;
    $('jobEmployerSuggestions').hidden = true;
    setOccupationSuggestionsOpen(false);
    $('jobOccupationSelection').hidden = true;
    $('jobAdvertText').value = '';
    $('jobAdvertDetails').open = false;
    $('vacancyImportDetails').open = false;
    $('jobAdvertStatus').hidden = true;
    $('vacancyEvidenceReview').hidden = true;
    if(row){
      selectJobEmployer(row);
    }else{
      $('jobEmployer').hidden = true;
    }
    renderApplications();
    setJobMode(mode,false);
    const dialog = $('jobDialog');
    if(!dialog.open){
      if(typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open','');
    }
    if(application && row){
      checkedJob = {...application};
      renderJobResult(checkedJob,row);
    }
    Promise.all([loadOccupationData(),loadVacancyRulesets()]).then(([document])=>{
      const code = $('jobSoc').value.trim();
      const occupation = code ? document.occupations.find(record=>record.code === code) : null;
      if(occupation) chooseOccupation(occupation,true,Boolean(application && application.occupationConfirmed),
        application?.occupationCandidate || null);
      if(application && row) renderJobResult(checkedJob,row);
    }).catch(()=>{});
    setTimeout(()=>{
      if(mode === 'applications') focusJobMode(mode);
      else $(row ? 'jobRole' : 'jobEmployerInput').focus();
    },0);
  }

  function closeJobChecker(){
    if(document.body.classList.contains('job-route')){
      location.assign('/');
      return;
    }
    const dialog = $('jobDialog');
    if(typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function applicationCSV(){
    const head = ['Employer','Sponsor register town','Vacancy location','Job title','Advertised salary','Salary period',
      'Annual equivalent','Occupation code','Status','Notes','Saved','Evidence baseline captured',
      'Evidence review','Evidence changes','Sponsor snapshot','Company snapshot','Occupation rates snapshot'];
    return [head.join(','), ...applications.map(item=>{
      const review = applicationEvidenceReview(item), snapshot = item.evidenceSnapshot || {};
      return [item.employer,item.town,item.location || '',item.role,item.salary,item.salaryPeriod,item.annualSalary,
        item.soc,item.status,item.notes,item.savedAt,snapshot.capturedAt || '',review.label,
        review.changes.join('; '),snapshot.register?.sourceUpdated || '',
        snapshot.company?.sourceUpdated || '',snapshot.salary?.sourceUpdated || ''];
    }).map(values=>values.map(csvCell).join(','))].join('\r\n');
  }

  function downloadApplications(){
    if(!applications.length) return;
    const blob = new Blob(['\ufeff' + applicationCSV()],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'knowyoursponsor-applications-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    trackEvent('application_tracker_exported','Application tracker exported');
  }

  function primeSearchAlert(){
    alertTouched = true;
    clearEmployerFollow();
    $('alertCity').value = $('city').value;
    $('alertIndustry').value = $('industry').value;
    $('alertRoute').value = $('route').value;
    trackEvent('alert_started', 'Search alert started');
    $('alerts').scrollIntoView({behavior:'smooth', block:'center'});
    alertForm.email.focus({preventScroll:true});
  }

  function followEmployer(name){
    alertTouched = true;
    // An employer watch replaces broad search filters and follows this exact
    // published name across locations, so an address move remains visible.
    for(const id of ['alertCity','alertIndustry','alertRoute']) $(id).value = '';
    $('alertEmployer').value = name;
    $('followName').textContent = cleanDisplayText(name);
    $('followScope').hidden = false;
    document.querySelector('.alert-scope').hidden = true;
    trackEvent('employer_follow_started', 'Employer follow started');
    $('alerts').scrollIntoView({behavior:'smooth', block:'center'});
    alertForm.email.focus({preventScroll:true});
  }

  function clearEmployerFollow(){
    $('alertEmployer').value = '';
    $('followScope').hidden = true;
    document.querySelector('.alert-scope').hidden = false;
  }

  function syncSheetCompare(){
    const btn = $('sheetCompare');
    if(!btn || !sheetRow) return;
    btn.hidden = isReviewedSourceAnomaly(sheetRow[0]);
    if(btn.hidden) return;
    const on = comparing.has(sheetRow[0]);
    btn.textContent = on ? 'Remove from comparison' : 'Add to comparison';
    btn.setAttribute('aria-pressed', String(on));
  }

  function syncCompareUI(){
    const count = comparing.size;
    $('compareTray').hidden = count === 0;
    $('compareCount').textContent = `${count} of 3`;
    $('compareOpen').disabled = count < 2;
    document.querySelectorAll('[data-compare]').forEach(btn=>{
      const on = comparing.has(btn.dataset.compare);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? 'Selected' : '+ Compare';
    });
    syncSheetCompare();
  }

  function toggleCompare(name){
    if(isReviewedSourceAnomaly(name)) return;
    if(comparing.has(name)) comparing.delete(name);
    else if(comparing.size < 3) comparing.add(name);
    else{
      $('saveStatus').hidden = false;
      $('saveStatus').textContent = 'You can compare up to three employers. Remove one first.';
      setTimeout(()=>{ $('saveStatus').hidden = true; }, 2600);
      return;
    }
    syncCompareUI();
    syncURL(true);
    if($('compareDialog').open) renderComparison();
  }

  function comparableEmployerName(value){
    return cleanDisplayText(value).replace(/\s+/g,' ').trim().toLowerCase();
  }

  function employerHistory(record, row, started, heading='Employer history'){
    const dates = (record && record.dates) || {};
    const events = EVIDENCE_DATES
      .filter(([key])=>dates[key])
      .map(([key,label])=>({date:dates[key], label,
        note:key === 'dormant_period_end'
          ? 'This is the accounts period end, not the filing date.' : ''}));
    if(record && record.incorporated){
      events.push({date:record.incorporated, label:'Company incorporated', note:''});
    }
    const [name,town] = row;
    for(const change of ratingChanges){
      if(change.name === name && (!change.town || change.town === town)){
        events.push({date:change.date, label:'Sponsor rating changed from ' +
          change.from + ' to ' + change.to,
          note:'Observed in the Home Office register.'});
      }
    }
    if(started){
      events.push({date:started, label:'First observed on the sponsor register',
        note:'This is when our daily records first saw the listing.'});
    }else if(licensedBaseline){
      events.push({date:licensedBaseline,
        label:'Already present when daily tracking began',
        note:'The record was already present on this date; its earlier history and licence grant date are not published.'});
    }
    const checkedDate = String(currentUpdated || '').slice(0,10);
    if(checkedDate){
      events.push({date:checkedDate, label:'Present in the latest register',
        note:'Latest check by KnowYourSponsor.'});
    }
    if(!events.length) return '';
    events.sort((a,b)=>String(b.date).localeCompare(String(a.date)) ||
      a.label.localeCompare(b.label));
    const items = events.map(event=>'<li><strong>' + esc(longDate(event.date)) +
      '</strong> &mdash; ' + esc(event.label) + (event.note
        ? '<span class="event-note">' + esc(event.note) + '</span>' : '') + '</li>');
    return '<div class="block evidence-timeline"><h3>' + esc(heading) + '</h3><ul>' +
      items.join('') + '</ul></div>';
  }

  function visitSnapshot(){
    const employers = {};
    for(const key of saved){
      const row = all.find(item=>savedKey(item[0], item[1])===key);
      const old = previousVisit && previousVisit.employers &&
        previousVisit.employers[key];
      const name = row ? row[0] : (old && old.name) || key.split('|')[0];
      const town = row ? row[1] : (old && old.town) || key.split('|').slice(1).join('|');
      const warning = warningFor(name);
      employers[key] = {
        name, town, present:Boolean(row), rating:row ? row[5] || '' : '',
        warning:warning ? warning.label : '',
        warningSeverity:warning ? warning.severity : '',
      };
    }
    return {updated:currentUpdated, employers};
  }

  function recordVisitSnapshot(){
    if(!fullLoaded || !evidenceLoaded || !currentUpdated) return;
    try{ localStorage.setItem(VISIT_KEY, JSON.stringify(visitSnapshot())); }
    catch(err){ /* This convenience must never stop search in private mode. */ }
  }

  function rowMatchesCurrentSearch(row){
    const words = $('q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if($('city').value && row[1] !== $('city').value) return false;
    if($('industry').value && row[3] !== $('industry').value) return false;
    if($('route').value && !(row[4] || []).includes($('route').value)) return false;
    if(words.length){
      const hay = (row[0]+' '+row[1]+' '+row[2]+' '+row[3]).toLowerCase();
      if(!words.every(word=>hay.includes(word))) return false;
    }
    return true;
  }

  function rowMatchesRememberedSearch(row, search){
    const words = String(search.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if(search.city && row[1] !== search.city) return false;
    if(search.industry && row[3] !== search.industry) return false;
    if(search.route && !(row[4] || []).includes(search.route)) return false;
    const hay = (row[0]+' '+row[1]+' '+row[2]+' '+row[3]).toLowerCase();
    return words.every(word=>hay.includes(word));
  }

  function searchLabel(search){
    const parts = [search.q, search.city, search.industry, search.route].filter(Boolean);
    return parts.join(' · ');
  }

  function rememberSearch(){
    if(!fullLoaded) return;
    const search = {q:$('q').value.trim(), city:$('city').value,
      industry:$('industry').value, route:$('route').value,
      updated:currentUpdated};
    const label = searchLabel(search);
    if(!label) return;
    recentSearches = [search, ...recentSearches.filter(item=>
      searchLabel(item) !== label)].slice(0,5);
    try{ localStorage.setItem(SEARCH_KEY, JSON.stringify(recentSearches)); }
    catch(err){ /* Search still works when browser storage is blocked. */ }
  }

  function renderVisitChanges(){
    const box = $('visitChanges');
    if(!fullLoaded || !previousVisit || !previousVisit.updated ||
       previousVisit.updated === currentUpdated){
      box.hidden = true; return;
    }
    const items = [];
    const before = previousVisit.employers || {};
    const now = visitSnapshot().employers;
    for(const [key, old] of Object.entries(before)){
      if(!saved.has(key)) continue;
      const current = now[key];
      const label = esc(cleanDisplayText(old.name || key.split('|')[0]));
      if(old.present && current && !current.present){
        items.push(`<li><strong>${label}</strong> is no longer in the current register.</li>`);
      }else if(current && old.rating && current.rating && old.rating !== current.rating){
        items.push(`<li><strong>${label}</strong> changed from rating ${esc(old.rating)} to ${esc(current.rating)}.</li>`);
      }
      if(current && current.warning && current.warning !== old.warning){
        items.push(`<li><strong>${label}</strong> now has a Companies House signal: ${esc(current.warning)}.</li>`);
      }
    }

    const scoped = Boolean($('q').value.trim() || $('city').value ||
      $('industry').value || $('route').value);
    if(scoped){
      const added = addedRows.filter(rowMatchesCurrentSearch).length;
      const removed = removedRows.filter(rowMatchesCurrentSearch).length;
      const downgraded = downgradedRows.filter(rowMatchesCurrentSearch).length;
      if(added) items.push(`<li>${added.toLocaleString()} matching ${added===1?'employer is':'employers are'} newly listed.</li>`);
      if(removed) items.push(`<li>${removed.toLocaleString()} matching ${removed===1?'employer is':'employers are'} no longer listed.</li>`);
      if(downgraded) items.push(`<li>${downgraded.toLocaleString()} matching ${downgraded===1?'employer was':'employers were'} downgraded.</li>`);
    }
    for(const search of recentSearches){
      if(!search.updated || search.updated === currentUpdated) continue;
      const added = addedRows.filter(row=>rowMatchesRememberedSearch(row, search)).length;
      const removed = removedRows.filter(row=>rowMatchesRememberedSearch(row, search)).length;
      const downgraded = downgradedRows.filter(row=>rowMatchesRememberedSearch(row, search)).length;
      if(!added && !removed && !downgraded) continue;
      const changes = [added && `${added} new`, removed && `${removed} removed`,
        downgraded && `${downgraded} downgraded`].filter(Boolean).join(', ');
      items.push('<li><strong>' + esc(searchLabel(search)) + '</strong>: ' +
        esc(changes) + ' since this search was last viewed.</li>');
    }
    box.hidden = !items.length;
    if(!items.length) return;
    $('visitSummary').textContent = 'Compared with the register data you last saw on ' +
      readableTimestamp(previousVisit.updated) + '.';
    $('visitItems').innerHTML = items.slice(0,8).join('');
  }

  function rowsForEmployer(name){
    const comparableName = comparableEmployerName(name);
    const sameName = row=>row[0]===name ||
      comparableEmployerName(row[0])===comparableName;
    const current = all.filter(sameName);
    if(current.length) return current;
    return [...removedRows, ...addedRows, ...downgradedRows]
      .filter(sameName);
  }

  function employerComparison(name){
    const records = rowsForEmployer(name);
    const actualName = records[0] ? records[0][0] : name;
    const current = all.filter(row=>row[0]===actualName);
    const locations = [...new Set(records.map(row=>
      [cleanPlace(row[1]),cleanPlace(row[2])].filter(Boolean).join(', '))
      .filter(Boolean))].sort();
    const industries = [...new Set(records.map(row=>row[3]).filter(Boolean))].sort();
    const routes = [...new Set(records.flatMap(row=>row[4]||[]))].sort();
    const ratings = [...new Set(current.map(row=>row[5]).filter(Boolean))].sort();
    const starts = Object.entries(licensedSince)
      .filter(([key])=>key.startsWith(actualName.toLowerCase()+'|'))
      .map(([,date])=>date).filter(Boolean).sort();
    const flag = companyFlags[actualName];
    let change = `No recorded change in the last ${windowDays} days`;
    if(removedRows.some(row=>row[0]===actualName)) change = 'A listing was no longer present';
    else if(downgradedRows.some(row=>row[0]===actualName)) change = 'Rating moved from A to B';
    else if(addedRows.some(row=>row[0]===actualName)) change = 'Newly present in the register';
    const company = flag
      ? (flag.status || 'Signal found') + '. Matched by name; verify the official record.'
      : 'No signal found. This is not a clean bill of health.';
    const first = starts[0] || '';
    const row = records[0] || [actualName,'','','',[],ratings[0]||''];
    const identity = companyIdentities.get(actualName);
    const cosHistory = cosHistories.get(actualName);
    const cosUsage = cosUsageRecords.get(actualName);
    const intelligence = employerEvidenceModel(row,identity,flag,cqcProviders.get(actualName),
      cosHistory,cosUsage,first);
    return {name:actualName, current:current.length>0, locations, industries, routes,
      ratings, first, observedDays:first ? ageDays(first) : null, change, company,
      incorporated:flag&&flag.incorporated, number:flag&&flag.number, identity,
      cosHistory, cosUsage, intelligence};
  }

  function comparisonIdentity(item){
    if(item.identity && item.identity.state === 'identified') return 'Verified legal-entity link';
    if(item.identity && item.identity.state === 'ambiguous') return 'Coverage gap — several companies may fit';
    return 'Coverage gap — no safe company link';
  }

  function comparisonCosHistory(history){
    if(!history) return 'Unknown — no exact-name-linked disclosure';
    const routes=[['Skilled Worker',history.skilled_worker],['GBM / ICT',history.gbm_ict]]
      .filter(([,value])=>Array.isArray(value)&&value.length===6)
      .map(([label,value])=>label+' '+(value[4]===value[5]
        ? Number(value[4]).toLocaleString('en-GB')
        : Number(value[4]).toLocaleString('en-GB')+'–'+Number(value[5]).toLocaleString('en-GB')));
    return routes.join('; ')||'Unknown — no exact-name-linked disclosure';
  }

  function comparisonCosUsage(usage){
    if(!usage) return 'Unknown — no exact-name-linked published count';
    const routes=[['Skilled Worker',usage.skilled_worker],['GBM / ICT',usage.gbm_ict]]
      .filter(([,value])=>Number.isInteger(value)&&value>=5)
      .map(([label,value])=>label+' '+Number(value).toLocaleString('en-GB'));
    return routes.join('; ')||'Unknown — no exact-name-linked published count';
  }

  function renderComparison(){
    const items = [...comparing].map(employerComparison);
    const cell = value=>`<td>${value}</td>`;
    const values = fn=>items.map(item=>cell(fn(item))).join('');
    const checked = readableTimestamp(currentUpdated);
    $('compareBody').innerHTML = '<table class="compare-table"><thead><tr><th>Evidence</th>' +
      items.map(item=>`<th>${esc(cleanDisplayText(item.name))}</th>`).join('') +
      '</tr></thead><tbody>' +
      '<tr><td>Latest register</td>' + values(item=>item.current
        ? '<span class="rating-a">Present</span>'
        : '<span class="rating-b">Not present</span>') + '</tr>' +
      '<tr><td>Checked</td>' + values(()=>esc(checked||'Not available')) + '</tr>' +
      '<tr><td>Location</td>' + values(item=>esc(item.locations.join('; ')||'Not given')) + '</tr>' +
      '<tr><td>Estimated industry</td>' + values(item=>esc(item.industries.join('; ')||'Other')) + '</tr>' +
      '<tr><td>Visa routes</td>' + values(item=>esc(item.routes.join('; ')||'Not currently published')) + '</tr>' +
      '<tr><td>Rating</td>' + values(item=>esc(item.ratings.join(', ')||'Not currently published')) + '</tr>' +
      '<tr><td>Days observed</td>' + values(item=>item.observedDays === null
        ? 'Not known' : esc(item.observedDays.toLocaleString()) + ' days') + '</tr>' +
      '<tr><td>First observed</td>' + values(item=>item.first
        ? esc(longDate(item.first))
        : (licensedBaseline ? 'Already present when daily records began' : 'Not known')) + '</tr>' +
      '<tr><td>Evidence coverage</td>' + values(item=>esc(item.intelligence.available.length+
        ' public evidence area'+(item.intelligence.available.length===1?'':'s'))) + '</tr>' +
      '<tr><td>Company identity</td>' + values(item=>esc(comparisonIdentity(item))) + '</tr>' +
      '<tr><td>Historical CoS, 2021–24</td>' + values(item=>esc(comparisonCosHistory(item.cosHistory))) + '</tr>' +
      '<tr><td>Published 2025 CoS use</td>' + values(item=>esc(comparisonCosUsage(item.cosUsage))) + '</tr>' +
      `<tr><td>Recent change</td>${values(item=>esc(item.change))}</tr>` +
      '<tr><td>Incorporated</td>' + values(item=>item.incorporated
        ? esc(longDate(item.incorporated)) : 'Not available') + '</tr>' +
      `<tr><td>Company warning</td>${values(item=>esc(item.company) +
        (item.number ? ` <a href="${CH_COMPANY}${encodeURIComponent(item.number)}" target="_blank" rel="noopener">Official record</a>` : ''))}</tr>` +
      '</tbody></table><p class="caveat"><strong>Still unknown for every employer:</strong> whether a current vacancy offers sponsorship, whether the role and salary qualify, and whether the employer is hiring. Historical CoS figures are employer-name disclosures, not vacancy evidence or a ranking. Companies House matches are pointers, not verdicts.</p>';
  }

  async function openComparison(){
    if(comparing.size < 2) return;
    const button=$('compareOpen'),label=button.textContent;
    button.disabled=true;button.textContent='Loading evidence…';
    try{
      await Promise.all([...comparing].map(loadCompanyIdentity));
      renderComparison();
      const dialog = $('compareDialog');
      if(typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open','');
      trackEvent('comparison_created', 'Employer comparison created');
    }finally{
      button.textContent=label;
      syncCompareUI();
    }
  }

  function closeComparison(){
    const dialog = $('compareDialog');
    if(typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function clearPrintView(){
    const employerPrintRoot = $('employerPrintRoot');
    if(employerPrintRoot) employerPrintRoot.remove();
    document.body.classList.remove('print-check','print-job-evidence');
  }

  function printEmployerReport(){
    if(!sheetRow) return;
    clearPrintView();
    const root = document.createElement('main');
    root.id = 'employerPrintRoot';
    root.setAttribute('aria-label',`Employer evidence report for ${sheetRow[0]}`);
    const report = $('sheet').cloneNode(true);
    report.hidden = false;
    report.removeAttribute('id');
    report.removeAttribute('role');
    report.removeAttribute('aria-modal');
    report.removeAttribute('aria-labelledby');
    report.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    report.querySelectorAll('.sheet-close,.sheet-foot,.similar-sponsors,button')
      .forEach(node=>node.remove());
    root.append(report);
    document.body.append(root);
    document.body.classList.add('print-check');
    trackEvent('pdf_report_opened', 'Employer report opened');
    void root.offsetHeight;
    window.print();
  }

  function printComparisonReport(){
    trackEvent('pdf_report_opened', 'Comparison report opened');
    const doc = document;
    const dialog = $('compareDialog');
    const head = dialog.querySelector('.compare-dialog-head').cloneNode(true);
    const body = dialog.querySelector('.compare-dialog-body').cloneNode(true);
    const originalTitle = doc.title;
    const originalBodyClass = doc.body.className;
    const originalBodyNodes = Array.from(doc.body.childNodes);
    const originalScrollY = window.scrollY;
    const comparisonWasOpen = dialog.open;
    const employerNames = Array.from(body.querySelectorAll('.compare-table thead th'))
      .slice(1).map(node=>node.textContent.trim()).filter(Boolean);
    const namesForTitle = employerNames.length > 1
      ? employerNames.slice(0,-1).join(', ') + ' and ' + employerNames.at(-1)
      : (employerNames[0] || 'employers');
    const reportDate = new Intl.DateTimeFormat('en-GB',{
      day:'2-digit',month:'short',year:'numeric'
    }).format(new Date());
    const reportTitle = (`Employer comparison - ${namesForTitle} - ${reportDate} - KnowYourSponsor`)
      .replace(/[\\/:*?"<>|]/g,'-').slice(0,180);
    doc.title = reportTitle;
    doc.documentElement.lang = 'en';
    const style = doc.createElement('style');
    style.id = 'comparisonReportStyles';
    style.textContent = `
      @page{size:A4 portrait;margin:12mm}
      *{box-sizing:border-box}
      html{color:#17233b;background:#fff;color-scheme:light!important;font-family:Arial,sans-serif}
      body.comparison-report-page{margin:0;padding:0 12px 24px;background:#fff;color:#17233b;overflow:auto}
      .report{width:100%;max-width:900px;margin:0 auto;border:1.5px solid #17233b;background:#fff}
      .compare-dialog-head{display:flex;padding:14px 16px;border-bottom:2px solid #17233b}
      .compare-dialog-head>div{flex:1}.compare-dialog-head h2{font-size:18pt;margin:0}
      .compare-dialog-head p{font-size:9pt;color:#506078;margin:4px 0 0}
      .check-kicker{font-size:8pt!important;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
      .compare-dialog-body{padding:12px 16px;overflow:visible}
      .compare-table{border-collapse:collapse;min-width:0;width:100%;table-layout:fixed;font-size:8.5pt}
      .compare-table th,.compare-table td{padding:7px 8px;border-bottom:1px solid #d9e0eb;
        color:#17233b;background:#fff;text-align:left;vertical-align:top;overflow-wrap:anywhere}
      .compare-table th{background:#f5f7fb}
      .compare-table th:first-child{position:static;width:112px;box-shadow:none}.compare-table td:first-child{position:static;font-weight:700;color:#506078;box-shadow:none}
      .report .compare-table th:last-child,.report .compare-table td:last-child{
        width:auto;max-width:none;white-space:normal;text-align:left;padding-left:8px}
      .status-ok{color:#087a4b;font-weight:700}.status-warn{color:#a42e24;font-weight:700}
      a{color:#1548d3}.caveat{font-size:8.5pt;line-height:1.45;margin:10px 0 0}
      .sheet-close{display:none!important}
      .print-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;
        max-width:900px;margin:14px auto;padding:0 12px;font:14px Arial,sans-serif;color:#17233b}
      .print-actions{display:flex;gap:8px}
      .print-tools button{border:1.5px solid #17233b;border-radius:6px;background:#1548d3;color:#fff;
        padding:10px 16px;font-weight:700;cursor:pointer}
      .print-tools .back{background:#fff;color:#17233b}
      @media(max-width:600px){.print-tools{align-items:flex-start;flex-direction:column}
        .print-actions{width:100%}.print-tools button{flex:1}}
      @media print{body.comparison-report-page{padding:0}.print-tools{display:none!important}
        .report{max-width:none;border:1.5px solid #17233b}}
    `;
    doc.head.append(style);

    const tools = doc.createElement('div');
    tools.className = 'print-tools';
    const note = doc.createElement('span');
    note.textContent = 'Your comparison report is ready.';
    const actions = doc.createElement('div');
    actions.className = 'print-actions';
    const backButton = doc.createElement('button');
    backButton.type = 'button';
    backButton.className = 'back';
    backButton.textContent = 'Back to comparison';
    backButton.addEventListener('click',()=>{
      style.remove();
      doc.title = originalTitle;
      doc.body.className = originalBodyClass;
      doc.body.replaceChildren(...originalBodyNodes);
      window.scrollTo(0,originalScrollY);
      if(comparisonWasOpen){
        if(typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open','');
      }
      requestAnimationFrame(()=>$('comparePrint').focus({preventScroll:true}));
    });
    const printButton = doc.createElement('button');
    printButton.type = 'button';
    printButton.textContent = 'Print or save as PDF';
    printButton.addEventListener('click',()=>window.print());
    actions.append(backButton,printButton);
    tools.append(note,actions);

    const printable = doc.createElement('main');
    printable.className = 'report';
    printable.append(head,body);
    printable.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    printable.querySelectorAll('.sheet-close').forEach(node=>node.remove());
    if(comparisonWasOpen && typeof dialog.close === 'function') dialog.close();
    doc.body.className = 'comparison-report-page';
    doc.body.replaceChildren(tools,printable);
    window.scrollTo(0,0);
    void printable.offsetHeight;
  }

  // ------------------------------------------------------------ csv --
  // Exports exactly what is on screen, filters and all. Built here rather
  // than served as a file so it always matches the current view and costs
  // no bandwidth.
  function csvCell(value){
    const s = String(value == null ? '' : value);
    // Quote if the value could break a row, and double any inner quotes.
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCSV(records){
    const head = ['Employer','Town','County','Industry','Visa routes','Rating',
                  'Company status','Company number','Companies House warnings'];
    const lines = [head.join(',')];
    for(const [name,town,county,industry,routes,rating] of records){
      const record = companyFlags[name] || {};
      lines.push([name, town, county, industry,
                  (routes||[]).join('; '),
                  view === 'removed' ? '' : rating,
                  record.status || '', record.number || '',
                  (record.flags || []).join('; ')].map(csvCell).join(','));
    }
    // CRLF is what the CSV spec says and what Excel is happiest with.
    return lines.join('\r\n');
  }

  function csvFilename(){
    const bits = ['knowyoursponsor'];
    // view already covers 'saved', so a shortlist export is named as one.
    if(view) bits.push(view);
    const ct = $('city').value, ind = $('industry').value, rt = $('route').value;
    const q = $('q').value.trim();
    for(const part of [ct, ind, rt, q]){
      if(part) bits.push(part.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''));
    }
    bits.push(new Date().toISOString().slice(0,10));
    return bits.join('-').slice(0, 120) + '.csv';
  }

  function downloadCSV(){
    if(!filtered.length) return;
    // A BOM so Excel reads the accents in employer names as UTF-8.
    const blob = new Blob(['﻿' + buildCSV(filtered)],
                          {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    trackEvent('csv_downloaded', 'CSV downloaded');
    // Revoke on the next tick; revoking immediately can cancel the download.
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  // ----------------------------------------------------------- views --
  const VIEW_BUTTONS = {'':'viewAll', 'added':'viewAdded', 'removed':'viewRemoved',
                        'downgraded':'viewDowngraded', 'saved':'viewSaved'};

  function setView(next){
    view = VIEW_BUTTONS[next] ? next : '';
    for(const [name,id] of Object.entries(VIEW_BUTTONS)){
      $(id).setAttribute('aria-pressed', String(name === view));
    }
    $('viewMobile').value = view;
    const el = $('viewNotice');
    if(view === 'removed'){
      el.className = 'notice warn';
      el.innerHTML = '<strong>These exact sponsor records are no longer observed.</strong> ' +
        `The recorded name-and-town row appeared within the last ${windowDays} days ` +
        'but is absent now. The same sponsor name may remain elsewhere, and the ' +
        'public register does not state why a row changed.';
      el.hidden = false;
    }else if(view === 'added'){
      // Newly licensed AND already carrying a Companies House signal. This
      // cross-signal needs both datasets, which is why nobody else can show
      // it: a company incorporated weeks ago, already licensed to sponsor,
      // and already behind on its filings is worth a second look.
      const flagged = addedRows.filter(s=>warningFor(s[0]));
      const serious = flagged.filter(s=>{
        const w = warningFor(s[0]);
        return w && w.severity === 'serious';
      }).length;
      let extra = '';
      if(flagged.length){
        extra = ` <strong>${flagged.length} of them already have a ` +
          `Companies House signal</strong>` +
          (serious ? `, ${serious} of the serious kind` : '') +
          '. Newly observed record, existing question: worth checking before you apply.';
      }
      el.className = 'notice';
      el.innerHTML = '<strong>Sponsor records first observed.</strong> ' +
        `These exact name-and-town rows appeared in comparisons during the last ${windowDays} days. ` +
        'This does not establish when the underlying licence was granted.' + extra;
      el.hidden = false;
    }else if(view === 'saved'){
      el.className = 'notice';
      const shared = sharedSaved.size
        ? ' This link includes a shared shortlist. <button class="clear" ' +
          'type="button" id="saveShared">Save it on this device</button>'
        : '';
      el.innerHTML = '<strong>Your shortlist.</strong> ' +
        'Saved on this device only, with no account or browsing profile. ' +
        'Clearing your browser data clears it too.' + shared;
      el.hidden = false;
    }else if(view === 'downgraded'){
      el.className = 'notice warn';
      el.innerHTML = '<strong>These employers have just dropped to a B rating.</strong> ' +
        `Their rating moved from A to B in the last ${windowDays} days. A B-rated ` +
        'sponsor is working through a Home Office action plan and usually ' +
        'cannot issue new certificates of sponsorship until it is back to an A, ' +
        'so a job there may not come with a visa for now.';
      el.hidden = false;
    }else{
      el.hidden = true;
    }
  }

  function setSort(next){
    sortBy = ['relevance','name','location','industry','rating'].includes(next)
      ? next : 'relevance';
    $('sort').value = sortBy;
    document.querySelectorAll('.sorthead').forEach(button=>{
      button.classList.toggle('active', button.dataset.sort === sortBy);
    });
  }

  // ------------------------------------------------------- url state --
  // Filter state lives in the query string so any view is shareable.
  function stateToQuery(){
    const p = new URLSearchParams();
    const q = $('q').value.trim();
    if(q) p.set('q', q);
    if($('city').value) p.set('city', $('city').value);
    if($('industry').value) p.set('industry', $('industry').value);
    if($('route').value) p.set('route', $('route').value);
    if(view) p.set('view', view);
    if(warnOnly) p.set('warn', warnOnly === 'serious' ? 'serious' : '1');
    if(sortBy !== 'relevance') p.set('sort', sortBy);
    if(view === 'saved'){
      for(const key of [...sharedSaved].slice(0,25)) p.append('shortlist', key);
    }
    for(const name of [...comparing].slice(0,3)) p.append('compare', name);
    const open = sheetOpenName();
    if(open) p.set('employer', open);
    return p.toString();
  }

  // push=true for discrete control changes (so Back steps through them);
  // push=false while typing, otherwise every pause would add a history entry.
  function syncURL(push){
    const qs = stateToQuery();
    const url = location.pathname + (qs ? '?'+qs : '');
    if(url === location.pathname + location.search) return;
    history[push ? 'pushState' : 'replaceState'](null, '', url);
  }

  // Restoring is split in two. The text/toggle half runs immediately so the
  // controls are correct while the data is still downloading; the select half
  // has to wait for the <option>s to be built from the data, otherwise
  // assigning .value silently falls back to "".
  function restoreInputs(){
    const p = new URLSearchParams(location.search);
    $('q').value = p.get('q') || '';
    sharedSaved = new Set(p.getAll('shortlist').slice(0,25)
      .filter(key=>key && key.includes('|')).map(key=>key.toLowerCase()));
    // ?new=1 was the old spelling; links using it are still out there.
    setView(p.get('view') || (sharedSaved.size ? 'saved' :
      (p.get('new')==='1' ? 'added' : '')));
    // ?warn=1 kept working: it was already a shareable link before
    // severity existed, and it means "any warning".
    const wanted = p.get('warn');
    setWarnOnly(wanted === 'serious' ? 'serious' : (wanted === '1' ? 'any' : ''));
    setSort(p.get('sort') || 'relevance');
    comparing.clear();
    p.getAll('compare').slice(0,3).filter(name=>
      Boolean(name) && !isReviewedSourceAnomaly(name)).forEach(name=>comparing.add(name));
    syncCompareUI();
    updateSearchPresentation(null);
  }
  function restoreSelects(){
    const p = new URLSearchParams(location.search);
    for(const id of ['city','industry','route']){
      const want = p.get(id) || '';
      $(id).value = want;
      if($(id).value !== want) $(id).value = '';   // unknown value → "All"
    }
  }

  // events
  let t;
  $('q').addEventListener('input',()=>{
    updateSearchPresentation(null);
    clearTimeout(t);
    t=setTimeout(()=>{
      apply(); syncURL(false);
      if($('q').value.trim().length >= 2) trackEvent('search_used', 'Search used');
    },150);
  });
  document.querySelector('.searchbox').addEventListener('submit',event=>{
    event.preventDefault();
    clearTimeout(t);
    apply(); rememberSearch(); syncURL(true);
    trackEvent('search_used', 'Search used');
    if(matchMedia('(pointer:coarse)').matches || innerWidth <= 700) $('q').blur();
  });
  // Example queries. They fill the box rather than filtering silently, so
  // the reader sees what was typed and can edit it.
  document.querySelectorAll('.tryline .try').forEach(b=>{
    b.addEventListener('click',()=>{
      $('q').value=b.dataset.q;
      apply(); rememberSearch(); syncURL(true);
      trackEvent('search_used', 'Search used');
      $('q').focus();
    });
  });
  $('city').addEventListener('change',()=>{
    apply(); rememberSearch(); syncURL(true); trackEvent('search_used', 'Search used');
  });
  $('industry').addEventListener('change',()=>{
    apply(); rememberSearch(); syncURL(true); trackEvent('search_used', 'Search used');
  });
  $('route').addEventListener('change',()=>{
    apply(); rememberSearch(); syncURL(true); trackEvent('search_used', 'Search used');
  });
  $('viewMobile').addEventListener('change',()=>{ setView($('viewMobile').value); apply(); syncURL(true); });
  $('sort').addEventListener('change',()=>{ setSort($('sort').value); apply(); syncURL(true); });
  document.querySelectorAll('.sorthead').forEach(button=>button.addEventListener('click',()=>{
    setSort(button.dataset.sort); apply(); syncURL(true);
  }));
  $('more').addEventListener('click',()=>render(false));
  $('download').addEventListener('click',downloadCSV);
  $('copyLink').addEventListener('click',copyLink);
  $('shareShortlist').addEventListener('click',shareShortlist);
  $('watchNudgeCta').addEventListener('click', () =>
    trackEvent('watch_pilot_from_shortlist', 'Watch pilot from free shortlist'));
  $('startJobCheck').addEventListener('click',()=>{
    location.assign('/check-a-job/');
  });
  $('navJobTools').addEventListener('click',event=>{
    if(document.body.classList.contains('job-route')){
      event.preventDefault();
      openJobChecker(null,null,'check');
    }
  });
  $('alertSearch').addEventListener('click',primeSearchAlert);
  $('clearFollow').addEventListener('click',clearEmployerFollow);
  const watchedEmployer = new URLSearchParams(location.search).get('watch');
  if(watchedEmployer) followEmployer(watchedEmployer);
  $('clear').addEventListener('click',clearFilters);
  $('refineSearch').addEventListener('click',()=>{
    const open = document.body.classList.toggle('refine-open');
    $('refineSearch').setAttribute('aria-expanded',String(open));
  });
  $('viewNotice').addEventListener('click',event=>{
    if(!event.target.closest('#saveShared')) return;
    for(const key of sharedSaved) saved.add(key);
    sharedSaved.clear();
    persistSaved();
    refreshSavedCount();
    setView('saved');
    apply();
    syncURL(true);
    $('saveStatus').textContent = 'Shared shortlist saved on this device.';
    $('saveStatus').hidden = false;
  });

  document.addEventListener('keydown',e=>{
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if(e.key === 'Escape' && $('jobDialog').open){
      closeJobChecker();
      return;
    }
    if(e.key === 'Escape' && !$('sheet').hidden){
      closeSheet();
      return;
    }
    if(e.key === '/' && !typing){
      e.preventDefault();
      $('q').focus();
      $('q').select();
    }else if(e.key === 'Escape' && document.activeElement === $('q')){
      $('q').value = '';
      apply();
      syncURL(false);
    }
  });
  for(const id of ['alertCity','alertIndustry','alertRoute']){
    $(id).addEventListener('change',()=>{ alertTouched = true; });
  }
  for(const [name,id] of Object.entries(VIEW_BUTTONS)){
    $(id).addEventListener('click',()=>{ setView(name); apply(); syncURL(true); });
  }
  $('warnOnly').addEventListener('click',()=>{
    setWarnOnly(warnOnly === 'any' ? '' : 'any'); apply(); syncURL(true);
  });
  $('riskOnly').addEventListener('click',()=>{
    setWarnOnly(warnOnly === 'serious' ? '' : 'serious'); apply(); syncURL(true);
  });

  rows.addEventListener('click',e=>{
    if(e.target.closest('a')) return;
    const star = e.target.closest('.star');
    if(star){ toggleSaved(star.dataset.save); return; }
    const compare = e.target.closest('.compare-row');
    if(compare){ toggleCompare(compare.dataset.compare); return; }
    const checkJob = e.target.closest('.check-job-row');
    if(checkJob){
      const row = exactEmployerRow(checkJob.dataset.jobName);
      if(row) openJobChecker(row,null);
      return;
    }
    const btn = e.target.closest('.rowbtn');
    if(btn){ openSheet(btn.dataset.name, btn); return; }
    const tr = e.target.closest('tr[data-name]');
    if(tr) openSheet(tr.dataset.name, tr);
  });
  // Keeps the sheet's save button showing the truth, including when the
  // star for the same employer is toggled in the row behind it.
  function syncSheetStar(){
    const btn = $('sheetSave');
    const row = sheetRow;
    if(!btn || !row){ return; }
    const guarded = isReviewedSourceAnomaly(row[0]);
    btn.hidden = guarded;
    $('sheetJob').hidden = guarded;
    if(guarded) return;
    const on = saved.has(savedKey(row[0], row[1]));
    btn.textContent = on ? 'Saved. Tap to remove' : 'Save to shortlist';
    btn.setAttribute('aria-pressed', String(on));
  }

  $('sheetSave').addEventListener('click',()=>{
    if(sheetRow && !isReviewedSourceAnomaly(sheetRow[0])){
      toggleSaved(savedKey(sheetRow[0], sheetRow[1]));
    }
  });
  $('sheetCompare').addEventListener('click',()=>{
    if(sheetRow) toggleCompare(sheetRow[0]);
  });
  $('sheetJob').addEventListener('click',()=>{
    if(!sheetRow || isReviewedSourceAnomaly(sheetRow[0])) return;
    const row = sheetRow;
    closeSheet();
    openJobChecker(row,null);
  });
  $('sheetBody').addEventListener('click',event=>{
    if(event.target.closest('[data-cos-source]')){
      trackEvent('cos_history_source_opened','Historical CoS official source opened');
      return;
    }
    const followButton = event.target.closest('[data-follow-employer]');
    if(followButton){
      const employer = followButton.dataset.followEmployer;
      closeSheet();
      followEmployer(employer);
      return;
    }
    const viewButton = event.target.closest('[data-similar-view]');
    if(viewButton){
      openSheet(viewButton.dataset.similarView, null);
      return;
    }
    const saveButton = event.target.closest('[data-similar-save]');
    if(saveButton){
      toggleSaved(saveButton.dataset.similarSave);
      if(sheetRow) $('sheetBody').innerHTML = sheetHTML(sheetRow);
      return;
    }
    const compareButton = event.target.closest('[data-similar-compare]');
    if(compareButton){
      toggleCompare(compareButton.dataset.similarCompare);
      if(sheetRow) $('sheetBody').innerHTML = sheetHTML(sheetRow);
    }
  });

  $('sheetClose').addEventListener('click',closeSheet);
  $('sheetSize').addEventListener('click',toggleSheetWidth);
  $('sheetResize').addEventListener('pointerdown',startSheetResize);
  $('sheetResize').addEventListener('keydown',resizeSheetByKey);
  window.addEventListener('resize',()=>{if(!$('sheet').hidden) restoreSheetWidth()});
  $('sheetShare').addEventListener('click',()=>{
    if(!sheetRow) return;
    shareOrCopy($('sheetShare'), `KnowYourSponsor check: ${sheetRow[0]}`,
      'Public-source sponsor and company evidence. Verify against the official sources before acting.',
      location.href);
  });
  $('sheetPrint').addEventListener('click',printEmployerReport);
  $('compareClear').addEventListener('click',()=>{
    comparing.clear();
    closeComparison();
    syncCompareUI();
    syncURL(true);
  });
  $('compareOpen').addEventListener('click',openComparison);
  $('compareClose').addEventListener('click',closeComparison);
  $('compareDialog').addEventListener('click',e=>{
    if(e.target === $('compareDialog')) closeComparison();
  });
  $('compareShare').addEventListener('click',()=>{
    syncURL(true);
    shareOrCopy($('compareShare'), 'KnowYourSponsor employer comparison',
      'Public-source employer evidence shown side by side. Verify against the official sources before acting.',
      location.href);
  });
  $('comparePrint').addEventListener('click',printComparisonReport);
  $('jobClose').addEventListener('click',closeJobChecker);
  $('jobCheckTab').addEventListener('click',()=>setJobMode('check'));
  $('applicationsTab').addEventListener('click',()=>setJobMode('applications'));
  $('addApplication').addEventListener('click',()=>{
    openJobChecker(null,null,'check');
  });
  $('viewApplicationsAfterSave').addEventListener('click',()=>setJobMode('applications'));
  $('readVacancyUrl').addEventListener('click',importVacancyFromUrl);
  $('jobVacancyUrl').addEventListener('input',syncVacancyUrlAction);
  $('jobVacancyUrl').addEventListener('keydown',event=>{
    if(event.key === 'Enter'){ event.preventDefault(); importVacancyFromUrl(); }
  });
  $('pasteJobClipboard').addEventListener('click',pasteVacancyFromClipboard);
  $('extractJobAdvert').addEventListener('click',fillFromVacancy);
  $('jobAdvertText').addEventListener('paste',()=>{
    setTimeout(()=>{ if($('jobAdvertText').value.trim().length >= 40) fillFromVacancy(); },0);
  });
  $('clearJobAdvert').addEventListener('click',()=>{
    $('jobAdvertText').value = '';
    $('jobAdvertStatus').hidden = true;
    $('vacancyEvidenceReview').hidden = true;
    vacancyExtractionReview = null;
    $('jobAdvertText').focus();
  });
  function focusImportedField(event){
    const button = event.target.closest('[data-review-job]');
    if(button) $(button.dataset.reviewJob).focus();
  }
  $('jobAdvertStatus').addEventListener('click',focusImportedField);
  $('vacancyEvidenceReview').addEventListener('click',focusImportedField);
  $('jobForm').addEventListener('input',event=>event.target.removeAttribute('data-imported'));
  $('jobEmployerInput').addEventListener('input',event=>{
    pendingBrowserJob = null;
    jobEmployerRow = null;
    checkedJob = null;
    $('jobEmployer').hidden = true;
    $('jobResult').hidden = true;
    $('saveApplicationPanel').hidden = true;
    showEmployerSuggestions(event.target.value);
  });
  $('jobEmployerInput').addEventListener('keydown',event=>{
    if(event.key === 'Escape' && !$('jobEmployerSuggestions').hidden){
      event.stopPropagation();
      $('jobEmployerSuggestions').hidden = true;
      return;
    }
    if(event.key === 'ArrowDown' && !$('jobEmployerSuggestions').hidden){
      const first = $('jobEmployerSuggestions').querySelector('button');
      if(first){ event.preventDefault(); first.focus(); }
    }
  });

  window.jh=[()=>all,exactEmployerRow,selectJobEmployer,showEmployerSuggestions,showOccupationSuggestions,trackEvent,openJobChecker,resolveImportedEmployer];
  if(communityPilot){
    $('communityPilot').hidden = false;
    trackEvent('community_pilot_opened','Community pilot opened');
  }
  startBrowserJob();
  $('jobRole').addEventListener('input',event=>{
    checkedJob = null;
    event.target.setCustomValidity('');
    if(selectedOccupation) clearOccupationSelection(true);
    $('jobResult').hidden = true;
    $('saveApplicationPanel').hidden = true;
    showOccupationSuggestions(event.target.value);
  });
  $('jobRole').addEventListener('keydown',event=>{
    if(event.key === 'Escape' && !$('jobOccupationSuggestions').hidden){
      event.stopPropagation();
      setOccupationSuggestionsOpen(false);
      return;
    }
    if(event.key === 'ArrowDown' && !$('jobOccupationSuggestions').hidden){
      const first = $('jobOccupationSuggestions').querySelector('button');
      if(first){ event.preventDefault(); first.focus(); }
    }
  });
  $('browseOccupations').addEventListener('click',()=>{
    if(!$('jobOccupationSuggestions').hidden){
      setOccupationSuggestionsOpen(false);
      $('jobRole').focus();
      return;
    }
    showOccupationSuggestions($('jobRole').value, true);
  });
  $('jobSoc').addEventListener('input',event=>{
    const code = event.target.value.trim();
    if(selectedOccupation && selectedOccupation.code !== code) clearOccupationSelection(false);
    if(/^\d{4}$/.test(code)){
      loadOccupationData().then(document=>{
        const occupation = document.occupations.find(record=>record.code === code);
        if(occupation) chooseOccupation(occupation,true);
      }).catch(()=>{});
    }
  });
  $('jobOccupationConfirmed').addEventListener('change',()=>{
    checkedJob = null;
    $('jobResult').hidden = true;
    $('saveApplicationPanel').hidden = true;
  });
  $('jobModeTabs').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const checking = event.target.id === 'jobCheckTab';
    const nextMode = checking ? 'applications' : 'check';
    setJobMode(nextMode,false);
    $(nextMode === 'check' ? 'jobCheckTab' : 'applicationsTab').focus();
  });
  $('jobEmployerSuggestions').addEventListener('click',event=>{
    const button = event.target.closest('[data-job-suggestion]');
    if(!button) return;
    const row = jobSuggestions[Number(button.dataset.jobSuggestion)];
    if(row){
      selectJobEmployer(row);
      $('jobRole').focus();
    }
  });
  $('jobOccupationSuggestions').addEventListener('click',event=>{
    const button = event.target.closest('[data-occupation-suggestion]');
    if(!button) return;
    const candidate = occupationSuggestions[Number(button.dataset.occupationSuggestion)];
    if(candidate){
      chooseOccupation(candidate.record,true,false,candidate);
      $('jobSalary').focus();
    }
  });
  $('jobDialog').addEventListener('click',event=>{
    if(event.target === $('jobDialog')) closeJobChecker();
  });
  $('jobResult').addEventListener('click',event=>{
    if(event.target.closest('#copyJobEvidence')) copyJobEvidence();
    if(event.target.closest('#printJobEvidence')) printJobEvidence();
    const feedback = event.target.closest('[data-job-feedback]');
    if(feedback) recordJobFeedback(feedback.dataset.jobFeedback);
  });
  $('jobResult').addEventListener('change',event=>{
    if(event.target.id !== 'jobFeedbackContact') return;
    $('jobFeedbackEmailLabel').hidden = !event.target.checked;
    $('jobFeedbackEmail').required = event.target.checked;
    if(event.target.checked) $('jobFeedbackEmail').focus();
    else $('jobFeedbackEmail').value = '';
  });
  $('jobResult').addEventListener('submit',event=>{
    if(event.target.id !== 'jobFeedbackForm') return;
    event.preventDefault();
    submitJobFeedback();
  });
  $('jobForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const employer = $('jobEmployerInput').value.trim();
    const role = $('jobRole').value.trim();
    const matches = all.filter(row=>!isReviewedSourceAnomaly(row[0]) &&
      comparableEmployerName(cleanDisplayText(row[0])) === comparableEmployerName(employer));
    let row = jobEmployerRow && comparableEmployerName(cleanDisplayText(jobEmployerRow[0])) === comparableEmployerName(employer)
      ? jobEmployerRow : null;
    if(row && isReviewedSourceAnomaly(row[0])) row = null;
    if(!row && matches.length === 1) row = matches[0];
    if(!row){
      $('jobResult').hidden = false;
      $('jobResult').innerHTML = matches.length > 1
        ? '<h3>Choose the exact employer from search.</h3><p>More than one sponsor record uses this name. Search it, check the town, then open the right result.</p>'
        : '<h3>This employer was not matched exactly.</h3><p>Search the sponsor list, open the correct employer, then choose “Check a job at this employer”.</p>';
      return;
    }
    const titleIssue = jobTitleIssue(role);
    if(titleIssue){
      $('jobRole').setCustomValidity(titleIssue);
      $('jobRole').reportValidity();
      $('jobResult').hidden = false;
      $('jobResult').innerHTML = '<h3>Enter the full job title.</h3><p>' + esc(titleIssue) + ' We will not calculate against an occupation guessed from a broad term.</p>';
      $('saveApplicationPanel').hidden = true;
      showOccupationSuggestions(role,true);
      $('jobRole').focus();
      return;
    }
    $('jobRole').setCustomValidity('');
    const salaryEntered = $('jobSalary').value.trim() !== '';
    const amount = salaryEntered ? Number($('jobSalary').value) : null;
    const hours = Number($('jobHours').value || 37.5);
    const soc = $('jobSoc').value.trim();
    if((salaryEntered && (!Number.isFinite(amount) || amount <= 0)) || !Number.isFinite(hours) || hours <= 0){
      $('jobResult').hidden = false;
      $('jobResult').innerHTML = '<h3>Check the salary and hours.</h3><p>If salary is entered, use a number greater than zero and check the pay period. Otherwise leave it blank.</p>';
      return;
    }
    if(soc && !/^\d{4}$/.test(soc)){
      $('jobSoc').setCustomValidity('Enter a four-digit occupation code or leave it blank.');
      $('jobSoc').reportValidity();
      return;
    }
    $('jobSoc').setCustomValidity('');
    try{
      const document = await loadOccupationData();
      selectedOccupation = soc ? document.occupations.find(record=>record.code === soc) || null : null;
    }catch(error){ selectedOccupation = null; selectedOccupationCandidate = null; }
    if(soc && !selectedOccupation){
      $('jobResult').hidden = false;
      $('jobResult').innerHTML = '<h3>Choose a current official occupation.</h3><p>This code is not in the checked GOV.UK dataset. Search by the full job title or open the official occupation list.</p>';
      return;
    }
    if(selectedOccupation && !$('jobOccupationConfirmed').checked){
      $('jobResult').hidden = false;
      $('jobResult').innerHTML = '<h3>Confirm the occupation before comparing pay.</h3><p>Check it against the vacancy duties, or ask the employer which code will appear on the Certificate of Sponsorship.</p>';
      $('jobOccupationConfirmed').focus();
      return;
    }
    try{
      await loadVacancyRulesets();
    }catch(error){
      $('jobResult').hidden = false;
      $('jobResult').innerHTML = '<h3>The versioned salary rules could not load.</h3><p>No comparison was produced. Refresh and try again; we will not calculate against an unrecorded ruleset.</p>';
      return;
    }
    const editId = $('jobEditId').value;
    checkedJob = {
      id:editId || String(Date.now()) + '-' + Math.random().toString(36).slice(2,8),
      employer:row[0],town:row[1],location:$('jobLocation').value.trim(),role,salary:amount,
      salaryPeriod:$('jobSalaryPeriod').value,hours,
      annualSalary:salaryEntered ? Math.round(annualSalary(amount,$('jobSalaryPeriod').value,hours)) : null,
      soc,occupationConfirmed:Boolean(selectedOccupation && $('jobOccupationConfirmed').checked),
      ruleBasis:$('jobRuleBasis').value,
      occupationCandidate:selectedOccupationCandidate ? {
        level:selectedOccupationCandidate.level,
        reasons:[...selectedOccupationCandidate.reasons],gaps:[...selectedOccupationCandidate.gaps]
      } : null,
      ...window.kysOfferEvidence.collect(),
      status:$('jobStatus').value,notes:$('jobNotes').value.trim(),
      savedAt:new Date().toISOString()
    };
    checkedJob.ruleAssessment = createVacancyRuleAssessment(checkedJob,selectedOccupation);
    trackVacancyExtractionReview();
    jobEmployerRow = row;
    const checkButton = $('jobCheckSubmit');
    checkButton.disabled = true;
    checkButton.textContent = 'Checking evidence…';
    $('jobResult').hidden = false;
    $('jobResult').innerHTML = '<h3>Checking official evidence</h3><p>This takes a few seconds.</p>';
    try{
      await Promise.race([
        loadCompanyIdentity(row[0]),
        new Promise(resolve=>setTimeout(resolve,2500)),
      ]);
    }finally{
      checkButton.disabled = false;
      checkButton.textContent = 'Check this job';
    }
    renderJobResult(checkedJob,row);
    trackJobCompletion();
    $('jobResult').scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  $('saveApplication').addEventListener('click',()=>{
    if(!checkedJob || !jobEmployerRow) return;
    const application = {
      ...checkedJob,status:$('jobStatus').value,notes:$('jobNotes').value.trim(),
      savedAt:new Date().toISOString()
    };
    application.evidenceSnapshot = applicationEvidenceSnapshot(application,jobEmployerRow);
    applications = [application,...applications.filter(item=>item.id !== application.id)].slice(0,100);
    checkedJob = application;
    $('jobEditId').value = application.id;
    persistApplications();
    $('saveApplication').textContent = 'Saved';
    setTimeout(()=>{ $('saveApplication').textContent = 'Save changes'; },1400);
    trackEvent('application_saved','Application saved');
  });
  $('applicationList').addEventListener('click',async event=>{
    if(event.target.closest('[data-application-add]')){
      openJobChecker(null,null,'check');
      return;
    }
    const baselineButton = event.target.closest('[data-application-baseline]');
    if(baselineButton){
      const item = applications.find(application=>application.id === baselineButton.dataset.applicationBaseline);
      if(!item || !fullLoaded || !evidenceLoaded) return;
      baselineButton.disabled = true;
      if(item.occupationConfirmed && !occupationData){
        try{ await loadOccupationData(); }
        catch(error){
          baselineButton.disabled = false;
          baselineButton.textContent = 'Occupation evidence unavailable';
          return;
        }
      }
      item.evidenceSnapshot = applicationEvidenceSnapshot(item,currentApplicationRow(item));
      item.savedAt = new Date().toISOString();
      persistApplications();
      trackEvent('application_baseline_recorded','Application evidence baseline recorded');
      return;
    }
    const edit = event.target.closest('[data-application-edit]');
    if(edit){
      const item = applications.find(application=>application.id === edit.dataset.applicationEdit);
      if(item) openJobChecker(exactEmployerRow(item.employer,item.town),item,'check');
      return;
    }
    const remove = event.target.closest('[data-application-remove]');
    if(!remove) return;
    const item = applications.find(application=>application.id === remove.dataset.applicationRemove);
    if(!item || !window.confirm('Remove this application from this browser?')) return;
    applications = applications.filter(application=>application.id !== item.id);
    persistApplications();
  });
  $('exportApplications').addEventListener('click',downloadApplications);
  renderApplications();
  window.addEventListener('afterprint',clearPrintView);
  $('sheetBackdrop').addEventListener('click',closeSheet);

  $('statWarnBox').addEventListener('click',e=>{
    e.preventDefault();
    setWarnOnly('serious');
    apply();
    syncURL(true);
    $('filterbar').scrollIntoView({block:'start'});
  });

  // Lift the sticky bar only once it is actually stuck, so the shadow is a
  // signal rather than decoration. rootMargin watches the line it sticks to.
  if('IntersectionObserver' in window){
    const sentinel = document.createElement('div');
    $('filterbar').before(sentinel);
    new IntersectionObserver(
      ([entry])=>$('filterbar').classList.toggle('stuck', !entry.isIntersecting),
      {threshold:0}
    ).observe(sentinel);
  }
  window.addEventListener('popstate',()=>{ restoreInputs(); restoreSelects(); apply(); });

  // Reflect the URL in the controls straight away, so someone landing on a
  // shared link sees the right filters while the register downloads.
  restoreInputs();
  // ----------------------------------------------------------- alerts --
  const alertForm = $('alertForm');
  function alertError(msg){
    const el = $('alertErr');
    el.textContent = msg;
    el.style.display = 'block';
  }
  // Prefer the provider's own message ("that address is already subscribed")
  // over a generic one, when it sends a usable one.
  function firstFieldError(data){
    const fields = data && data.errors && data.errors.fields;
    if(!fields) return '';
    const first = Object.values(fields)[0];
    return Array.isArray(first) ? first[0] : '';
  }
  alertForm.addEventListener('submit', async e => {
    e.preventDefault();
    $('alertErr').style.display = 'none';

    if(!ALERT_ENDPOINT){
      alertError("Email alerts aren't running yet. Please check back soon.");
      return;
    }

    const email = alertForm.email.value.trim();
    if(!email) return;
    const btn = alertForm.querySelector('button');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending…';

    try{
      const body = new FormData();
      body.append('fields[email]', email);
      // Scope is what makes the weekly email worth opening: 124 new
      // employers nationwide is noise, 3 in your city is not. MailerLite
      // ignores a field it does not know, so these are only stored if the
      // matching custom fields exist in the account (see README).
      if($('alertCity').value) body.append('fields[city]', $('alertCity').value);
      if($('alertIndustry').value) body.append('fields[industry]', $('alertIndustry').value);
      if($('alertRoute').value) body.append('fields[route]', $('alertRoute').value);
      if($('alertEmployer').value) body.append('fields[employer]', $('alertEmployer').value);
      body.append('ml-submit', '1');
      body.append('anticsrf', 'true');
      const res = await fetch(ALERT_ENDPOINT, {method:'POST', body});

      // A rejected address still comes back as HTTP 200 with
      // {"success":false,...}, so the body decides, not the status code.
      const data = await res.json().catch(()=>null);
      if(!res.ok || !data || data.success !== true){
        btn.disabled = false; btn.textContent = label;
        alertError(firstFieldError(data) ||
          'That address was not accepted. Please check it and try again.');
        return;
      }

      alertForm.style.display = 'none';
      $('alertDone').style.display = 'block';
      trackEvent('alert_signup_completed', 'Search alert signup completed');
    }catch(err){
      btn.disabled = false; btn.textContent = label;
      alertError("That didn't send. Please check your connection and try again.");
    }
  });

  // One retry, because the register is 2MB gzipped and a single failed
  // request should not be a dead end. Two real causes, both seen:
  //
  //   A phone on a weak connection drops a long download. That is our actual
  //   audience, so treating one failure as fatal fails the people the site
  //   is for.
  //
  //   A service worker upgrade can abort a request that is already in
  //   flight. Renaming the cache did exactly that on the live site: the
  //   small files finished, the 2MB one was aborted, and the whole load
  //   failed with "the list could not be loaded".
  //
  // 'reload' on the second attempt so a poisoned cache entry cannot be
  // handed back twice.
  async function fetchJSON(url, attempts=2){
    let last;
    for(let i=0; i<attempts; i++){
      try{
        const res = await fetch(url, i ? {cache:'reload'} : undefined);
        if(!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      }catch(err){ last = err; }
    }
    throw last;
  }

  function quickShardKey(value){
    const ascii = String(value || '').normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^[^0-9A-Za-z]+/, '')
      .toLowerCase();
    const compact = ascii.replace(/[^0-9a-z]/g,'');
    if(/^\d{3}/.test(compact) || /^[a-z]{2}\d/.test(compact))
      return compact.slice(0,3);
    return /^[0-9a-z]/.test(ascii) ? ascii.charAt(0) : '_';
  }

  function fetchSearchShard(key){
    if(searchShardDocuments.has(key))
      return Promise.resolve(searchShardDocuments.get(key));
    if(!searchShardRequests.has(key)){
      searchShardRequests.set(key,fetchJSON(`data/search/${key}.json`).then(data=>{
        searchShardDocuments.set(key,data);
        return data;
      }).finally(()=>searchShardRequests.delete(key)));
    }
    return searchShardRequests.get(key);
  }

  function rowsFromSearchShard(data){
    const unique = new Map();
    for(const row of data.sponsors || []) unique.set(rowIdentityKey(row),row);
    for(const item of data.aliases || []){
      if(Array.isArray(item) && Array.isArray(item[2]))
        unique.set(rowIdentityKey(item[2]),item[2]);
    }
    return [...unique.values()];
  }

  async function requestFastPreview(){
    const query = $('q').value.trim();
    const key = quickShardKey(query || 'a');
    if(loaded && key === fastKey){ apply(); return; }
    const request = ++fastRequest;
    $('loadNote').hidden = false;
    $('loadNote').textContent = query
      ? 'Finding employer-name matches while the complete register loads.'
      : 'Showing the first employers while the complete register loads.';
    $('download').disabled = true;
    try{
      const data = await fetchSearchShard(key);
      if(request !== fastRequest || key !== quickShardKey($('q').value.trim() || 'a')) return;
      setActiveSearchAliases(data.aliases || []);
      if(!fullLoaded) all = rowsFromSearchShard(data);
      fastKey = key;
      loaded = true;
      $('loading').hidden = true;
      $('resultsTable').hidden = false;
      $('resultsMeta').hidden = false;
      apply();
    }catch(err){
      // The complete register starts when this request settles. Keep the
      // existing loading state rather than making an optional speed-up fatal.
      if(fullLoaded && request === fastRequest){
        setActiveSearchAliases([]);
        fastKey = key;
        apply();
      }else if(!loaded) $('loadNote').hidden = true;
    }
  }

  // The publisher puts the verified snapshot into the first HTML paint.
  // Re-read the tiny metadata file here so a long-open or offline-cached
  // page can reconcile its headline figures before the register arrives.
  //
  // Everything below went through one Promise.all, so the three headline
  // figures and the "updated" line once sat at an em dash until the slowest
  // fetch finished. That is sponsors.json: 11.4MB raw, 2.04MB gzipped.
  // meta.json holds the same totals and is 164 bytes gzipped, so it lands
  // more or less immediately. Publication-time rendering removes that delay;
  // this fetch is now a cheap freshness check while the register arrives.
  //
  // The values are authoritative either way: meta.json is written by the
  // same run that writes sponsors.json. Promise.all sets them again below
  // from the register itself, which is the count of what actually loaded,
  // so a half-written meta.json cannot leave a wrong number on screen.
  fetchJSON('data/meta.json').then(meta => {
    if (typeof meta.total === 'number' && !all.length) {
      $('total').textContent = meta.total.toLocaleString();
    }
    if (meta.updated) {
      currentUpdated = meta.updated;
      $('updated').textContent = readableTimestamp(meta.updated);
    }
    if (typeof meta.added_recently === 'number') {
      $('statAdded').textContent = meta.added_recently.toLocaleString();
    }
  }).catch(()=>{});

  // Start the slower enrichment downloads at the same time, but do not make
  // the sponsor search wait for them. The register answers the visitor's
  // first question. Company and enforcement evidence can paint onto the
  // results as soon as it arrives.
  const enrichment = Promise.all([
    fetchJSON('data/company_flags.json').catch(()=>({companies:{}})),
    fetchJSON('data/nmw.json').catch(()=>({employers:{}})),
    fetchJSON('data/employer_policies.json').catch(()=>({policies:[]}))
  ]);

  // Paint an accurate first page or employer-name match from a small shard.
  // The complete register still follows so every town, industry, route and
  // substring search keeps the same coverage it has always had.
  let completeRequested = false;
  function loadCompleteRegister(){
    if(completeRequested) return;
    completeRequested = true;

    // Load the files needed to search and describe the current register.
    Promise.all([
    fetchJSON('data/sponsors.json'),
    fetchJSON('data/new_sponsors.json').catch(()=>({new:[]})),
    fetchJSON('data/meta.json').catch(()=>({})),
    fetchJSON('data/removed_sponsors.json').catch(()=>({removed:[]})),
    // Optional in the same way: the file only appears once the pipeline has
    // seen two consecutive runs, so its absence is normal, not an error.
    fetchJSON('data/rating_changes.json').catch(()=>({changes:[]})),
    // Optional too: absent until the history log has recorded a day.
    fetchJSON('data/licensed_since.json').catch(()=>({since:{}})),
    // Optional: absent until the employer pages have been generated once.
    fetchJSON('data/employer_pages.json').catch(()=>({pages:{}}))
    ]).then(([main,recent,meta,gone,ratings,since,pageIndex])=>{
    fullLoaded = true;
    $('download').disabled = false;
    employerPages = pageIndex.pages || {};
    licensedSince = since.since || {};
    licensedBaseline = since.baseline || '';
    all = main.sponsors||[];
    sponsorByKey = new Map(all.map(s=>[savedKey(s[0],s[1]),s]));
    sponsorRowsByName = new Map();
    all.forEach(row=>{
      const name = comparableEmployerName(cleanDisplayText(row[0]));
      if(!sponsorRowsByName.has(name)) sponsorRowsByName.set(name,[]);
      sponsorRowsByName.get(name).push(row);
    });
    resolveBrowserJobEmployer();
    currentUpdated = main.updated || meta.updated || currentUpdated;
    addedRows = ordinaryEvidenceRows(recent.new);
    removedRows = ordinaryEvidenceRows(gone.removed);
    windowDays = recent.window_days || meta.window_days || 7;
    addedRows.forEach(s=>newNames.add(s[0].toLowerCase()));
    $('total').textContent = all.length.toLocaleString();
    $('updated').textContent = readableTimestamp(main.updated)||'—';
    $('sampleNote').textContent = meta.sample
      ? 'Temporary preview data is shown. Do not treat it as the complete current register.'
      : '';
    $('sampleNote').hidden = !meta.sample;

    // Counts on the buttons: they tell someone whether a view is worth a click.
    $('nAdded').textContent = addedRows.length ? `(${addedRows.length})` : '';
    $('nRemoved').textContent = removedRows.length ? `(${removedRows.length})` : '';

    // Match each downgrade back to its register row by name and town, the
    // same identity the pipeline uses. An employer that was downgraded and
    // then left the register entirely finds no row and is dropped: it belongs
    // in "lost licence", which is the worse news and already covers it.
    const byKey = sponsorByKey;
    ratingChanges = ratings.changes || [];
    downgradedRows = ratingChanges
      .filter(c=>c.action === 'downgraded')
      .map(c=>byKey.get(((c.name||'')+'|'+(c.town||'')).toLowerCase()))
      .filter(Boolean)
      // The row must still say B. Otherwise this view could announce "just
      // dropped to a B rating" above a column reading A, which destroys
      // trust in the one screen that exists to warn somebody off.
      .filter(s=>String(s[5]||'').trim().toUpperCase() === 'B');
    if(downgradedRows.length){
      $('nDowngraded').textContent = `(${downgradedRows.length})`;
      $('viewDowngraded').hidden = false;
      $('viewMobile').querySelector('[value="downgraded"]').hidden = false;
    }

    // A number on the nav link is the difference between "another page" and
    // "something happened this week". Hidden when there is nothing to report.
    const moved = addedRows.length + removedRows.length + downgradedRows.length;
    if(moved){
      $('navChanges').textContent = moved.toLocaleString();
      $('navChanges').hidden = false;
    }

    // Proof strip. Warning counts arrive with the optional enrichment below.
    $('statAdded').textContent = addedRows.length.toLocaleString();
    // A shortlist saved on an earlier visit only becomes visible once the
    // register is in memory, because the Saved view filters it.
    refreshSavedCount();
    setView(view);   // re-render the notice now that windowDays is known

    // Alert scope choices are stable. Search facets are built by apply() and
    // then recalculate whenever another active constraint changes.
    const inds=[...new Set(all.map(s=>s[3]))].sort();
    const alertRoutes=[...new Set(all.flatMap(s=>s[4]||[]))].sort();
    const townCount = {};
    for(const s of all){ if(s[1]) townCount[s[1]] = (townCount[s[1]]||0) + 1; }
    const bySize = Object.keys(townCount).sort((a,b)=>townCount[b]-townCount[a]);
    const alertTowns = bySize.slice(0,30).sort();
    knownTowns = new Set(alertTowns.map(t=>t.toLowerCase()));

    $('alertCity').insertAdjacentHTML('beforeend',
      alertTowns.map(t=>`<option>${esc(t)}</option>`).join(''));
    $('alertIndustry').insertAdjacentHTML('beforeend',
      inds.map(i=>`<option>${esc(i)}</option>`).join(''));
    $('alertRoute').insertAdjacentHTML('beforeend',
      alertRoutes.map(route=>`<option>${esc(route)}</option>`).join(''));

    // Swap the loading state for the results, then render the first page.
    // Note restoreInputs() is deliberately NOT called again here: anything
    // typed into the search box while the data downloaded must survive.
    $('loading').hidden = true;
    $('loadNote').hidden = true;
    $('resultsTable').hidden = false;
    $('resultsMeta').hidden = false;
    loaded = true;
    updateFacets([]);
    restoreSelects();
    apply();
    renderApplications();

    enrichment.then(([flags,nmw,policies])=>{
      companyFlags = flags.companies || {};
      companyEvidenceUpdated = flags.updated || '';
      namings = nmw.employers || {};
      employerPolicies = new Map((policies.policies || []).map(policy=>[
        savedKey(policy.employerName,policy.town),policy
      ]));
      evidenceLoaded = true;

      // Two counts, because they say different things. The card headlines
      // safely linked non-active company records; the pill offers every flag.
      let warnCount = 0, seriousCount = 0;
      for(const s of all){
        const warning = warningFor(s[0]);
        if(!warning) continue;
        warnCount++;
        if(warning.severity === 'serious') seriousCount++;
      }
      if(seriousCount){
        $('statWarn').textContent = seriousCount.toLocaleString();
        $('statWarnBox').hidden = false;
        $('nRisk').textContent = `(${seriousCount.toLocaleString()})`;
        $('riskOnly').hidden = false;
      }
      if(warnCount){
        $('nWarn').textContent = `(${warnCount.toLocaleString()})`;
        $('warnOnly').hidden = false;
      }

      // Refresh visible evidence and an open sheet without moving focus.
      apply();
      renderApplications();
      recordVisitSnapshot();
      rememberSearch();
      if(!$('sheet').hidden && sheetRow){
        $('sheetBody').innerHTML = sheetHTML(sheetRow);
      }
    });

    // A shared ?employer= link opens straight onto that employer.
    const wanted = new URLSearchParams(location.search).get('employer');
    if(wanted) openSheet(wanted, null);
    if(comparing.size >= 2) openComparison();
  }).catch(()=>{
    $('loading').hidden = true;
    if(loaded){
      $('loadNote').hidden = false;
      $('loadNote').textContent = 'Employer-name search is available, but town, industry and route filters could not load. Refresh to try again.';
    }else{
      $('empty').hidden=false;
      const lastReceipt = readableTimestamp(currentUpdated);
      $('empty').innerHTML='<strong>The current sponsor list could not be loaded.</strong><br>' +
        (lastReceipt
          ? 'The latest source receipt available on this page is dated ' + esc(lastReceipt) + '. Refresh or check the GOV.UK register before relying on it.'
          : 'No current source receipt could be confirmed. Refresh or check the GOV.UK register before relying on this page.');
    }
    });
  }

  // Give the small name shard the first network turn. If a browser, blocker
  // or transient CDN problem holds that request open, the complete register
  // still starts after 1.5 seconds rather than waiting indefinitely.
  Promise.race([
    requestFastPreview(),
    new Promise(resolve=>setTimeout(resolve, 1500))
  ]).finally(loadCompleteRegister);
  // Progressive enhancement only — the site works identically without it.
  // updateViaCache:'none' makes the browser revalidate sw.js itself on every
  // navigation, so a new worker is picked up on the next visit after a push.
  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{
      navigator.serviceWorker
        .register('sw.js',{updateViaCache:'none'})
        .catch(()=>{});
    });
  }
})();
