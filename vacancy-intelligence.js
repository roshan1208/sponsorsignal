/* Pure, local vacancy extraction. Every suggestion carries its evidence state
 * and source wording so the UI can ask for review without inventing facts. */
(function(root){
  const FIELD_LABELS = Object.freeze({
    employer:'Employer', role:'Full job title', location:'Vacancy location',
    salary:'Advertised salary', hours:'Weekly hours'
  });

  function cleanLine(value){
    return String(value || '')
      .replace(/^[\s\u2022\u2023\u25E6\u2043\u2219*|>]+/,'')
      .replace(/\s+/g,' ').trim();
  }

  function lines(text){
    return String(text || '').replace(/\r/g,'')
      .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g,'\n')
      .replace(/([a-z0-9)])(?=(?:About\s+(?:the Role|[A-Z][A-Za-z&'. -]{1,70})|Responsibilities|Required Qualifications|Preferred Qualifications|Problem Areas|Why This Role Is Different)\b)/g,'$1\n')
      .replace(/\s+(?=(?:employer|company(?: name)?|organisation|organization|job title|role title|position(?: title)?|job location|work location|location|salary|pay|hours per week)\s*:)/gi,'\n')
      .split('\n').map(cleanLine).filter(Boolean);
  }

  function labelledValue(sourceLines, labels){
    const label = '(?:' + labels.join('|') + ')';
    const sameLine = new RegExp('^' + label + '(?:\\s*:\\s*|\\s+[-\u2013\u2014]\\s+)(.+)$','i');
    const labelOnly = new RegExp('^' + label + '\\s*:?$','i');
    for(let index=0;index<sourceLines.length;index++){
      const match = sourceLines[index].match(sameLine);
      if(match && match[1].trim()) return {value:match[1].trim(),excerpt:sourceLines[index]};
      if(labelOnly.test(sourceLines[index]) && sourceLines[index + 1]){
        return {value:sourceLines[index + 1],excerpt:sourceLines[index] + ': ' + sourceLines[index + 1]};
      }
    }
    return {value:'',excerpt:''};
  }

  function numberValue(value){
    const compact = String(value || '').replace(/,/g,'').trim();
    const number = Number.parseFloat(compact);
    if(!Number.isFinite(number)) return null;
    return /k\b/i.test(compact) ? number * 1000 : number;
  }

  function excerptAround(source, match, limit=180){
    const start = source.lastIndexOf('\n',match.index) + 1;
    const end = source.indexOf('\n',match.index + match[0].length);
    return cleanLine(source.slice(start,end < 0 ? source.length : end)).slice(0,limit);
  }

  function evidence(state, method, excerpt=''){
    return {state,method,excerpt:cleanLine(excerpt).slice(0,180)};
  }

  function dependableHeading(value){
    const words = cleanLine(value).toLowerCase().replace(/[^a-z0-9+#.-]+/g,' ').split(/\s+/).filter(Boolean);
    if(words.length !== 1) return true;
    const word = words[0];
    if(['gp','ceo','cto','cfo','cmo','chef','nurse'].includes(word)) return true;
    const broad = ['it','hr','qa','tech','technology','manager','assistant','officer','worker','staff',
      'consultant','analyst','engineer','admin','administration','care','data','finance','legal',
      'marketing','operations','product','project','sales','software','support'];
    const roles = ['accountant','administrator','advisor','analyst','architect','assistant','carer','chef',
      'consultant','coordinator','designer','developer','director','engineer','manager','nurse','officer',
      'operator','planner','programmer','recruiter','scientist','software','specialist','supervisor',
      'surveyor','teacher','technician','therapist','worker'];
    return word.length >= 4 && !broad.includes(word) && !roles.some(role=>role !== word && role.startsWith(word));
  }

  function extract(text){
    const source = String(text || '').replace(/\r/g,'').replace(/\u00a0/g,' ');
    const sourceLines = lines(source);
    const facts = {
      employer:'',role:'',location:'',salary:null,salaryPeriod:'',hours:null,
      notes:[],confidence:{},evidence:{},version:1
    };
    const labelled = {
      employer:labelledValue(sourceLines,['employer','company(?: name)?','organisation','organization','hiring organisation','hiring organization','posted by']),
      role:labelledValue(sourceLines,['job title','role title','position(?: title)?','vacancy','role']),
      location:labelledValue(sourceLines,['job location','work location','location','based in','workplace'])
    };
    for(const field of ['employer','role','location']){
      facts[field] = labelled[field].value;
      if(facts[field]){
        facts.confidence[field] = 'labelled';
        facts.evidence[field] = evidence('found','Explicitly labelled in the vacancy',labelled[field].excerpt);
      }
    }

    if(!facts.employer){
      const aboutIndex = sourceLines.slice(0,80).findIndex(line=>/^About\s+[A-Z]/.test(line));
      const aboutLine = aboutIndex >= 0 ? sourceLines[aboutIndex] : '';
      const repeatedName = aboutLine.match(/^About\s+(.{2,80}?)\1\s+is\b/i);
      const aboutName = repeatedName ? repeatedName[1].trim() : aboutLine.replace(/^About\s+/i,'').trim();
      const aboutProfile = aboutIndex >= 0 ? cleanLine(sourceLines[aboutIndex + 1] || '').toLowerCase() : '';
      if(aboutName && aboutName.length <= 80 && (repeatedName || aboutProfile.startsWith(aboutName.toLowerCase() + ' is'))){
        facts.employer = aboutName;
        facts.confidence.employer = 'company profile wording';
        facts.evidence.employer = evidence('possible','Inferred from company profile wording',aboutLine);
      }
    }

    if(!facts.employer){
      const companyLine = sourceLines.slice(0,35).find(line=>
        line.length <= 160 && /\b(?:limited|ltd\.?|llp|plc|nhs(?:\s+(?:trust|foundation trust))?|university|council)\b/i.test(line) &&
        !/\b(?:about|experience|benefits|privacy|equal opportunities|terms|similar jobs)\b/i.test(line));
      if(companyLine){
        facts.employer = companyLine.replace(/^(?:at|by|company)\s+/i,'').replace(/\s*[|\u2022].*$/,'').trim();
        facts.confidence.employer = 'company-style name';
        facts.evidence.employer = evidence('possible','Inferred from organisation-style wording',companyLine);
      }
    }

    if(!facts.role){
      const titleCandidate = sourceLines.slice(0,15).find(line=>line.length >= 3 && line.length <= 100 &&
        !/^(?:what|where|accept|continue|find jobs?|company reviews?|salary guide|start of main content|job description|job details|about (?:us|the role)|overview|salary|pay|location|company|employer|posted|promoted|apply|easy apply|save|share|sign in|log in|home|jobs?|careers?|indeed|linkedin)\b/i.test(line) &&
        !/\b(?:applicants?|days?|weeks?|months?)\s+ago\b/i.test(line) &&
        !/[£$€]|https?:\/\//i.test(line) && !/\b(?:limited|ltd\.?|llp|plc)\b/i.test(line) &&
        !/^(?:full[- ]time|part[- ]time|permanent|temporary|contract|hybrid|remote)$/i.test(line));
      if(titleCandidate && !/:/.test(titleCandidate) && dependableHeading(titleCandidate)){
        facts.role = titleCandidate;
        facts.confidence.role = 'job-board heading';
        facts.evidence.role = evidence('possible','Inferred from the vacancy heading',titleCandidate);
      }
    }

    if(!facts.location){
      const locationCandidate = sourceLines.slice(0,25).find(line=>
        cleanLine(line).toLowerCase() !== cleanLine(facts.employer).toLowerCase() &&
        !/\b(?:limited|ltd\.?|llp|plc|nhs(?:\s+(?:trust|foundation trust))?|university|council)\b/i.test(line) &&
        (/^(?:remote|hybrid)(?:\s+(?:in|[-\u2013\u2014]))?\s*[A-Za-z .'-]*$/i.test(line) ||
        (/\b(?:London|Manchester|Birmingham|Leeds|Glasgow|Edinburgh|Liverpool|Bristol|Sheffield|Leicester|Coventry|Nottingham|Cardiff|Belfast|United Kingdom|UK)\b/i.test(line) &&
          line.length <= 100 && !/\b(?:salary|office|registered|company|about)\b/i.test(line))));
      if(locationCandidate){
        facts.location = locationCandidate.replace(/^(?:location|based in|workplace)\s*[:\-]?\s*/i,'')
          .split(/\s*(?:\u00b7|\||\s[-\u2013\u2014]\s)\s*/)[0]
          .replace(/\s+\d+\s+(?:days?|weeks?|months?)\s+ago.*$/i,'')
          .replace(/\s+(?:over\s+)?\d+\s+applicants?.*$/i,'').trim();
        facts.confidence.location = 'location wording';
        facts.evidence.location = evidence('possible','Inferred from location wording',locationCandidate);
      }
    }

    if(/^(?:accept(?: all)?|allow(?: all)?(?: cookies)?|continue|reject(?: all)?|manage cookies|sign in|log in)$/i.test(facts.role)){
      facts.role = '';
      delete facts.confidence.role;
      delete facts.evidence.role;
    }

    const salaryMatch = source.match(/(?:salary|pay|compensation|package|rate)?[^\n£]{0,40}?(?:£|GBP\s*)([0-9][0-9,]*(?:\.[0-9]+)?\s*k?)(?:\s*(?:-|\u2013|\u2014|to)\s*(?:£|GBP\s*)?([0-9][0-9,]*(?:\.[0-9]+)?\s*k?))?/i);
    if(salaryMatch){
      const low = numberValue(salaryMatch[1]);
      const high = numberValue(salaryMatch[2]);
      facts.salary = low;
      const salaryContext = excerptAround(source,salaryMatch);
      if(/(?:per\s*hour|an?\s*hour|hourly|\/\s*h(?:r)?\b)/i.test(salaryContext)) facts.salaryPeriod = 'hour';
      else if(/(?:per\s*week|weekly|\/\s*week\b)/i.test(salaryContext)) facts.salaryPeriod = 'week';
      else if(/(?:per\s*month|monthly|\/\s*month\b)/i.test(salaryContext)) facts.salaryPeriod = 'month';
      else if(/(?:per\s*(?:annum|year)|annual(?:ly)?|p\.?a\.?\b|\/\s*year\b)/i.test(salaryContext) || facts.salary >= 10000) facts.salaryPeriod = 'year';
      else facts.notes.push('Check the salary period; it was not stated clearly.');
      if(high) facts.notes.push('A salary range was found. The lower guaranteed figure has been entered for a conservative check.');
      facts.confidence.salary = high ? 'range minimum' : 'advertised figure';
      facts.evidence.salary = evidence('found',high ? 'Lower guaranteed figure from an advertised range' : 'Advertised salary figure',salaryContext);
    }
    const hoursMatch = source.match(/(?:contracted\s*)?([1-7][0-9](?:\.\d+)?)\s*(?:hours|hrs)(?:\s*(?:per|a|each|\/)\s*week)?/i) ||
      source.match(/(?:hours|hrs)\s*(?:per|a|each|\/)\s*week\s*[:\-]?\s*([1-7][0-9](?:\.\d+)?)/i);
    if(hoursMatch){
      facts.hours = Number(hoursMatch[1]);
      facts.confidence.hours = 'stated hours';
      facts.evidence.hours = evidence('found','Weekly hours stated in the vacancy',excerptAround(source,hoursMatch));
    }
    for(const field of Object.keys(FIELD_LABELS)){
      if(!facts.evidence[field]) facts.evidence[field] = evidence('not_found','Not found in the supplied vacancy');
    }
    return facts;
  }

  function reviewItems(facts){
    return Object.keys(FIELD_LABELS).map(key=>({
      key,label:FIELD_LABELS[key],value:facts[key],...(facts.evidence[key] || evidence('not_found','Not found in the supplied vacancy'))
    }));
  }

  function sourceContains(source, excerpt){
    const haystack = cleanLine(String(source || '').replace(/\r?\n/g,' ')).toLowerCase();
    const needle = cleanLine(excerpt).toLowerCase();
    return Boolean(needle && haystack.includes(needle));
  }

  /* A future challenger may only fill gaps. It cannot overwrite deterministic
   * evidence, and every value must point to wording that is actually present in
   * the vacancy. The public product does not call a model today; this contract
   * makes any later activation fail closed. */
  function reconcile(text, baseline, challenger){
    const result = baseline || extract(text);
    if(!challenger || typeof challenger !== 'object' || challenger.error) return result;
    const merged = {
      ...result,
      notes:[...(result.notes || [])],
      confidence:{...(result.confidence || {})},
      evidence:{...(result.evidence || {})},
    };
    for(const field of Object.keys(FIELD_LABELS)){
      if(result[field] !== '' && result[field] !== null && result[field] !== undefined) continue;
      const candidate = challenger.fields?.[field];
      if(!candidate || candidate.state === 'not_found' || !sourceContains(text,candidate.excerpt)) continue;
      let value = candidate.value;
      if(field === 'salary' || field === 'hours'){
        value = Number(value);
        if(!Number.isFinite(value) || value <= 0) continue;
      }else{
        value = cleanLine(value);
        if(!value || value.length > 160) continue;
      }
      merged[field] = value;
      merged.confidence[field] = 'model-assisted candidate';
      merged.evidence[field] = evidence('possible','Model-assisted suggestion linked to supplied wording',candidate.excerpt);
    }
    if(!merged.salaryPeriod && merged.salary !== null && merged.salary !== ''){
      const period = challenger.fields?.salaryPeriod;
      if(period && ['hour','week','month','year'].includes(period.value) && sourceContains(text,period.excerpt)){
        merged.salaryPeriod = period.value;
      }
    }
    return merged;
  }

  root.kysVacancyIntelligence = {cleanLine,lines,extract,reviewItems,reconcile};
})(typeof window === 'object' ? window : globalThis);
