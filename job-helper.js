/* Builds the drag-to-bookmarks job helper. Kept separate so the main search
 * remains inside its strict HTML budget. The saved helper runs on the vacancy
 * page and transfers only a small set of reviewable facts in a URL fragment. */
let pendingBrowserJob = null;

const OFFER_DEFAULT = 'unknown';
const PUBLIC_EMAIL_DOMAIN = /^(gmail|outlook|hotmail|yahoo|icloud|protonmail)\./;

function offerNode(id){ return document.getElementById(id); }

function mountOfferEvidence(){
  const actions = document.querySelector('#jobForm .job-actions');
  if(!actions || offerNode('jobSponsorshipClaim')) return;
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'offer-evidence';
  fieldset.innerHTML = '<legend>Offer evidence (optional)</legend><div class="offer-evidence-grid">' +
    '<label>Does the vacancy promise sponsorship?<select id="jobSponsorshipClaim"><option value="unknown">Not stated or not sure</option><option value="yes">Yes, stated in writing</option><option value="no">No, or it says sponsorship is unavailable</option></select></label>' +
    '<label>Were you asked to pay for the job or CoS?<select id="jobPaymentRequest"><option value="unknown">Not asked or not sure</option><option value="yes">Yes</option><option value="no">No</option></select></label>' +
    '<label>Recruiter email (optional)<input id="jobRecruiterEmail" type="email" maxlength="180" autocomplete="email" placeholder="name@company.co.uk"></label></div>' +
    '<small>These are your inputs, not verified facts. We flag direct conflicts and questions to ask; we do not produce a scam or safety score.</small>';
  actions.before(fieldset);
}

const offerEvidence = {
  mount: mountOfferEvidence,
  reset(){
    offerNode('jobSponsorshipClaim').value = OFFER_DEFAULT;
    offerNode('jobPaymentRequest').value = OFFER_DEFAULT;
    offerNode('jobRecruiterEmail').value = '';
  },
  hydrate(application){
    offerNode('jobSponsorshipClaim').value = application?.sponsorshipClaim || OFFER_DEFAULT;
    offerNode('jobPaymentRequest').value = application?.paymentRequest || OFFER_DEFAULT;
    offerNode('jobRecruiterEmail').value = application?.recruiterEmail || '';
  },
  detect(text){
    const vacancy = String(text || '').toLowerCase();
    if(/(?:visa|skilled worker) sponsorship (?:is )?(?:not available|cannot be provided|is not offered)/.test(vacancy)) offerNode('jobSponsorshipClaim').value = 'no';
    else if(/(?:visa|skilled worker) sponsorship (?:is )?(?:available|offered|provided)/.test(vacancy)) offerNode('jobSponsorshipClaim').value = 'yes';
  },
  collect(){
    return {
      sponsorshipClaim: offerNode('jobSponsorshipClaim').value,
      paymentRequest: offerNode('jobPaymentRequest').value,
      recruiterEmail: offerNode('jobRecruiterEmail').value.trim().toLowerCase(),
    };
  },
  analyse(application){
    const inputs = [], conflicts = [], questions = [];
    if(application.sponsorshipClaim === 'yes') inputs.push('You recorded that the vacancy states sponsorship is available.');
    if(application.sponsorshipClaim === 'no'){
      inputs.push('You recorded that the vacancy does not offer sponsorship.');
      conflicts.push('The vacancy information you entered says sponsorship is unavailable. A sponsor licence does not override that vacancy statement.');
    }
    if(application.recruiterEmail) inputs.push('Recruiter email entered by you: ' + application.recruiterEmail + '.');
    if(application.paymentRequest === 'yes') conflicts.push('You recorded a request for payment for the job or Certificate of Sponsorship. GOV.UK says you should not pay UK recruitment fees to secure a job and a sponsor must not pass the Certificate of Sponsorship fee to the worker. Stop and verify independently before sending money or documents.');
    const domain = String(application.recruiterEmail || '').split('@')[1]?.toLowerCase() || '';
    if(domain && PUBLIC_EMAIL_DOMAIN.test(domain)) conflicts.push('The recruiter address uses a public email service. This does not prove fraud, but it does not independently connect the sender to the employer. Verify through contact details published by the employer.');
    if(application.sponsorshipClaim === OFFER_DEFAULT) questions.push('Is sponsorship confirmed for this vacancy in writing, not only for the employer generally?');
    if(application.recruiterEmail) questions.push('Can the employer confirm this recruiter and email address through its independently published contact details?');
    return { inputs, conflicts, questions };
  },
};

mountOfferEvidence();
window.kysOfferEvidence = offerEvidence;

function jobBrowserBookmarklet(){
  function run(){
    function clean(value,limit){
      return String(value || '').replace(/\s+/g,' ').trim().slice(0,limit);
    }
    function first(selectors){
      for(const selector of selectors){
        const node = document.querySelector(selector);
        const value = clean(node && (node.innerText || node.textContent),180);
        if(value) return value;
      }
      return '';
    }
    function cleanLocation(value){
      return clean(value,180).split(/\s*(?:·|\|)\s*/)[0]
        .replace(/\s+\d+\s+(?:days?|weeks?|months?)\s+ago.*$/i,'')
        .replace(/\s+(?:over\s+)?\d+\s+applicants?.*$/i,'').trim();
    }
    function collect(value,records){
      if(Array.isArray(value)){ value.forEach(item=>collect(item,records)); return; }
      if(!value || typeof value !== 'object') return;
      const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
      if(types.includes('JobPosting')) records.push(value);
      Object.values(value).forEach(item=>collect(item,records));
    }
    function locationFrom(record){
      if(record.jobLocationType === 'TELECOMMUTE') return 'Remote';
      const locations = Array.isArray(record.jobLocation) ? record.jobLocation : [record.jobLocation];
      for(const place of locations){
        const address = place && (place.address || place);
        if(!address) continue;
        const parts = [address.addressLocality,address.addressRegion,address.addressCountry]
          .map(item=>clean(item && (item.name || item),60)).filter(Boolean);
        if(parts.length) return [...new Set(parts)].join(', ');
      }
      return '';
    }
    function salaryFrom(record){
      const base = record.baseSalary || record.estimatedSalary;
      if(!base) return {};
      const currency = clean(base.currency || record.salaryCurrency,8).toUpperCase();
      if(currency && currency !== 'GBP') return {};
      const value = base.value && typeof base.value === 'object' ? base.value : base;
      const amount = Number(value.minValue ?? value.value ?? value.maxValue ?? value);
      if(!Number.isFinite(amount) || amount <= 0) return {};
      const units = clean(value.unitText || base.unitText,20).toUpperCase();
      const periods = {HOUR:'hour',WEEK:'week',MONTH:'month',YEAR:'year'};
      return {salary:amount,salaryPeriod:periods[units] || (amount >= 10000 ? 'year' : '')};
    }
    const records = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script=>{
      try{ collect(JSON.parse(script.textContent),records); }catch(error){}
    });
    const record = records[0] || {};
    const hiring = record.hiringOrganization || {};
    const host = location.hostname.toLowerCase();
    const linkedin = host.includes('linkedin.com');
    const indeed = host.includes('indeed.');
    let employer = clean(hiring.name,180);
    let role = clean(record.title,120);
    let place = locationFrom(record);
    if(!role) role = first(linkedin
      ? ['.job-details-jobs-unified-top-card__job-title','.top-card-layout__title','h1']
      : indeed ? ['h1[data-testid="jobsearch-JobInfoHeader-title"]','h1'] : ['h1']);
    if(!employer) employer = first(linkedin
      ? ['.job-details-jobs-unified-top-card__company-name','.topcard__org-name-link','[data-test-job-details-company-name]']
      : indeed ? ['[data-testid="inlineHeader-companyName"]','[data-company-name="true"]'] :
        ['[itemprop="hiringOrganization"]','[itemprop="name"]']);
    if(!place) place = cleanLocation(first(linkedin
      ? ['.job-details-jobs-unified-top-card__tertiary-description-container','.topcard__flavor--bullet']
      : indeed ? ['[data-testid="job-location"]','#jobLocationText'] : ['[itemprop="jobLocation"]']));
    let salary = salaryFrom(record);
    if(!salary.salary){
      const salaryText = first(indeed
        ? ['#salaryInfoAndJobType','[data-testid="attribute_snippet_testid"]']
        : ['[itemprop="baseSalary"]','[class*="salary"]']);
      const match = salaryText.match(/(?:£|GBP\s*)([0-9][0-9,]*(?:\.\d+)?)/i);
      if(match){
        const amount = Number(match[1].replace(/,/g,''));
        salary = {salary:amount,salaryPeriod:/hour|\/hr/i.test(salaryText) ? 'hour' : /week/i.test(salaryText) ? 'week' : /month/i.test(salaryText) ? 'month' : amount >= 10000 ? 'year' : ''};
      }
    }
    const payload = {v:1,employer:clean(employer,180),role:clean(role,120),location:clean(place,180),
      salary:salary.salary || null,salaryPeriod:salary.salaryPeriod || '',sourceHost:clean(host,120)};
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    bytes.forEach(byte=>{ binary += String.fromCharCode(byte); });
    const encoded = btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    window.open('https://knowyoursponsor.co.uk/check-a-job/#job=' + encoded,'_blank','noopener');
  }
  return 'javascript:(' + run.toString() + ')()';
}

function initializeJobBrowserHelper(){
  const byId = id=>document.getElementById(id);
  byId('jobBrowserHelperMount').innerHTML = '<details class="job-browser-helper" id="jobBrowserHelper">' +
    '<summary>Check jobs with one click on desktop</summary><div class="job-browser-helper-body">' +
    '<p><strong>Drag this button to your bookmarks bar once.</strong> On a vacancy page, press it to bring the job facts here.</p>' +
    '<a class="download" id="jobHelperLink" href="#" draggable="true" title="Drag this button to your bookmarks bar">Check with KnowYourSponsor</a>' +
    '<small>It reads only the employer, title, location and advertised pay exposed by the page. It does not send the full advert. You review every field before checking.</small>' +
    '</div></details>';
  byId('jobHelperLink').href = jobBrowserBookmarklet();
  byId('jobHelperLink').addEventListener('click',event=>{
    event.preventDefault();
    const status = byId('jobAdvertStatus');
    status.innerHTML = '<strong>Drag the button to your bookmarks bar.</strong> Then open a vacancy and press the saved bookmark there.';
    status.hidden = false;
  });
}

initializeJobBrowserHelper();

function readBrowserJobPayload(){
  if(!location.hash.startsWith('#job=')) return null;
  const encoded = location.hash.slice(5);
  history.replaceState(null,'',location.pathname + location.search);
  if(!encoded || encoded.length > 2400) return null;
  try{
    const base64 = encoded.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(encoded.length / 4) * 4,'=');
    const bytes = Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if(value?.v !== 1 || typeof value !== 'object') return null;
    const safeText = (text,limit)=>typeof text === 'string' && text.length <= limit && !/[\u0000-\u001f]/.test(text) ? text.trim() : '';
    const salary = Number(value.salary);
    return {
      employer:safeText(value.employer,180), role:safeText(value.role,120), location:safeText(value.location,180),
      salary:Number.isFinite(salary) && salary > 0 && salary <= 10000000 ? salary : null,
      salaryPeriod:['year','month','week','hour'].includes(value.salaryPeriod) ? value.salaryPeriod : '',
      sourceHost:safeText(value.sourceHost,120)
    };
  }catch(error){ return null; }
}

async function resolveBrowserJobEmployer(){
  const api = window.jh;
  const employers = api ? api[0]() : [];
  if(!pendingBrowserJob?.employer) return false;
  const row = api[7]
    ? await api[7](pendingBrowserJob.employer,pendingBrowserJob.location)
    : (employers.length ? api[1](pendingBrowserJob.employer) : null);
  if(row){
    api[2](row,true);
    renderBrowserJobStatus(true);
    return true;
  }
  api[3](pendingBrowserJob.employer);
  return false;
}

function renderBrowserJobStatus(exact=false){
  const payload = pendingBrowserJob || {};
  const partialTitle = payload.role && window.kysJobTitleLogic.jobTitleIssue(payload.role);
  const found = [payload.employer && 'employer',payload.role && (partialTitle ? 'partial job title (review needed)' : 'job title'),payload.location && 'location',payload.salary && 'salary'].filter(Boolean);
  const status = document.getElementById('jobAdvertStatus');
  status.innerHTML = found.length
    ? '<strong>Filled from the vacancy page, not confirmed.</strong> Review the highlighted fields. ' +
      (exact ? 'The employer matched one sponsor record. ' : 'Choose the exact sponsor and occupation before checking. ') +
      (partialTitle ? 'Enter the full title shown on the vacancy. ' : '') +
      '<button class="review-import" type="button" data-review-job="' + (exact ? 'jobRole' : 'jobEmployerInput') + '">Review now</button>'
    : '<strong>This page did not expose dependable job facts.</strong> Copy the visible vacancy and use Paste from clipboard.';
  status.hidden = false;
}

async function applyBrowserJobPayload(payload){
  pendingBrowserJob = payload;
  const byId = id=>document.getElementById(id);
  if(payload.employer){ byId('jobEmployerInput').value = payload.employer; byId('jobEmployerInput').dataset.imported = 'true'; }
  if(payload.role){ byId('jobRole').value = payload.role; byId('jobRole').dataset.imported = 'true'; window.jh[4](payload.role); }
  if(payload.location){ byId('jobLocation').value = payload.location; byId('jobLocation').dataset.imported = 'true'; }
  if(payload.salary){ byId('jobSalary').value = payload.salary; byId('jobSalary').dataset.imported = 'true'; }
  if(payload.salaryPeriod) byId('jobSalaryPeriod').value = payload.salaryPeriod;
  const exact = await resolveBrowserJobEmployer();
  renderBrowserJobStatus(exact);
  window.jh[5]('vacancy_browser_helper_imported','Browser helper vacancy imported');
}

function startBrowserJob(){
  const requestedTool = new URLSearchParams(location.search).get('tool');
  const browserJob = readBrowserJobPayload();
  const dedicatedRoute = location.pathname.replace(/\/+$/, '') === '/check-a-job';
  if(browserJob || dedicatedRoute || requestedTool === 'job' || requestedTool === 'applications'){
    window.jh[6](null,null,browserJob ? 'check' : (requestedTool === 'applications' ? 'applications' : 'check'));
    if(browserJob) applyBrowserJobPayload(browserJob).catch(()=>renderBrowserJobStatus(false));
    const cleanToolURL = new URL(location.href);
    cleanToolURL.searchParams.delete('tool');
    history.replaceState(null,'',cleanToolURL.pathname + cleanToolURL.search + cleanToolURL.hash);
  }
}
