/* Explainable occupation candidates. Rankings organise official occupation
 * wording for review. They never confirm the code an employer will use. */
(function(root){
  const GENERIC = new Set([
    'a','an','and','at','for','in','of','on','or','the','to','with','uk','role','job',
    'full','time','part','senior','junior','lead','head','assistant','associate'
  ]);
  const NORMAL = Object.freeze({
    analyses:'analysis',analyst:'analyst',analysts:'analyst',businesses:'business',
    developers:'developer',development:'develop',engineers:'engineer',engineering:'engineer',
    facilities:'facility',managers:'manager',management:'manager',operations:'operation',
    programmers:'programmer',programming:'programmer',services:'service',systems:'system',
    technicians:'technician',workers:'worker'
  });

  function clean(value){
    return String(value || '').toLowerCase().normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  }

  function stem(word){
    if(NORMAL[word]) return NORMAL[word];
    if(word.length > 5 && word.endsWith('ies')) return word.slice(0,-3) + 'y';
    if(word.length > 5 && word.endsWith('ing')) return word.slice(0,-3);
    if(word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0,-1);
    return word;
  }

  function words(value, includeGeneric=false){
    const result = clean(value).split(' ').filter(Boolean).map(stem);
    return [...new Set(includeGeneric ? result : result.filter(word=>word.length > 1 && !GENERIC.has(word)))];
  }

  function labels(record){
    return [record.jobType,...(record.titles || [])].filter(Boolean);
  }

  function sentences(value){
    return String(value || '').replace(/\r/g,'').split(/\n+|(?<=[.!?])\s+/)
      .map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,120);
  }

  function termFrequencies(records){
    const counts = new Map();
    for(const record of records){
      const recordWords = new Set(labels(record).flatMap(label=>words(label)));
      for(const word of recordWords) counts.set(word,(counts.get(word) || 0) + 1);
    }
    return counts;
  }

  function titleEvidence(record,title,frequencies,total){
    const queryWords = words(title);
    const normalTitle = clean(title);
    let best = {score:0,matched:[],missing:queryWords,label:record.jobType,exact:false};
    for(const label of labels(record)){
      const labelWords = words(label);
      const matched = queryWords.filter(word=>labelWords.includes(word));
      const missing = queryWords.filter(word=>!labelWords.includes(word));
      const rarity = matched.reduce((sum,word)=>sum + Math.log2((total + 1) / ((frequencies.get(word) || total) + 1)),0);
      const exact = Boolean(normalTitle && normalTitle === clean(label));
      const coverage = queryWords.length ? matched.length / queryWords.length : 0;
      const precision = labelWords.length ? matched.length / labelWords.length : 0;
      const score = exact ? 1000 : matched.length ? 120 + coverage * 320 + precision * 110 + rarity * 18 : 0;
      if(score > best.score) best = {score,matched,missing,label,exact,coverage,precision};
    }
    if(String(record.code) === normalTitle) best = {score:1100,matched:[record.code],missing:[],label:record.jobType,exact:true,coverage:1,precision:1};
    return best;
  }

  function advertEvidence(record,advert,titleWords){
    const useful = new Set(labels(record).flatMap(label=>words(label)).filter(word=>!titleWords.includes(word)));
    if(!advert || !useful.size) return {terms:[],excerpt:''};
    let best = {terms:[],excerpt:''};
    for(const sentence of sentences(advert)){
      const sentenceWords = words(sentence);
      const terms = [...useful].filter(word=>sentenceWords.includes(word));
      if(terms.length > best.terms.length) best = {terms,excerpt:sentence.slice(0,220)};
    }
    return best;
  }

  function candidate(record,titleEvidenceResult,advertEvidenceResult,hasAdvert){
    const {score,matched,missing,label,exact,coverage} = titleEvidenceResult;
    const advertScore = Math.min(advertEvidenceResult.terms.length,3) * 22;
    const totalScore = score + advertScore;
    let level = 'possible';
    if(exact) level = 'exact';
    else if(matched.length >= 2 && coverage >= .66) level = 'strong';
    const reasons = [];
    if(exact) reasons.push('The entered title exactly matches the official wording “' + label + '”.');
    else if(matched.length){
      reasons.push('The title shares ' + matched.map(word=>'“' + word + '”').join(', ') + ' with the official wording “' + label + '”.');
    }
    if(advertEvidenceResult.terms.length){
      reasons.push('The supplied vacancy also uses ' + advertEvidenceResult.terms.map(word=>'“' + word + '”').join(', ') + '.');
    }
    const gaps = [];
    if(missing.length) gaps.push('The official wording does not account for ' + missing.map(word=>'“' + word + '”').join(', ') + ' in the entered title.');
    if(!hasAdvert) gaps.push('No vacancy duties were supplied, so this candidate is ranked from the title only.');
    else if(!advertEvidenceResult.terms.length) gaps.push('No additional distinguishing wording for this candidate was found in the supplied vacancy.');
    if(!gaps.length) gaps.push('Wording support cannot confirm which occupation code the employer will use.');
    return {record,score:totalScore,level,reasons,gaps,excerpt:advertEvidenceResult.excerpt,matchedTerms:matched};
  }

  function rank(records,input={},limit=5){
    const title = String(input.title || '').trim();
    const advert = String(input.advert || '').trim();
    if(!Array.isArray(records) || !title) return [];
    const frequencies = termFrequencies(records);
    const titleWords = words(title);
    const ranked = records.map(record=>{
      const titleResult = titleEvidence(record,title,frequencies,records.length);
      return candidate(record,titleResult,advertEvidence(record,advert,titleWords),Boolean(advert));
    }).filter(item=>item.score >= 155)
      .sort((left,right)=>right.score-left.score || left.record.jobType.localeCompare(right.record.jobType));
    return ranked.slice(0,Math.max(1,Math.min(Number(limit) || 5,7))).map((item,index)=>({...item,position:index + 1}));
  }

  function complete(records,input={},limit=5){
    const title = clean(input.title);
    const titleParts = title.split(' ').filter(Boolean);
    if(!Array.isArray(records) || titleParts.length !== 1 || title.length < 3) return [];
    const prefix = titleParts[0];
    const matches = [];
    for(const record of records){
      let best = null;
      for(const label of labels(record)){
        const labelText = clean(label);
        const matchedWord = labelText.split(' ').find(word=>word.startsWith(prefix));
        if(!matchedWord) continue;
        const startsWithPrefix = labelText.startsWith(prefix);
        const exactWord = matchedWord === prefix;
        const score = (startsWithPrefix ? 200 : 0) + (exactWord ? 30 : 0) - labelText.length / 100;
        if(!best || score > best.score) best = {label,matchedWord,score};
      }
      if(best) matches.push({record,...best});
    }
    return matches.sort((left,right)=>right.score-left.score ||
      left.label.length-right.label.length || left.label.localeCompare(right.label))
      .slice(0,Math.max(1,Math.min(Number(limit) || 5,7)))
      .map((match,index)=>({
        record:match.record,
        position:index + 1,
        level:'completion',
        completionLabel:match.label.replace(/[.]$/,''),
        reasons:['The official occupation wording includes a title word beginning with “' + prefix + '”.'],
        gaps:['“' + input.title.trim() + '” is incomplete and cannot identify an occupation code by itself. Review the full vacancy title and duties before confirming this option.'],
        excerpt:'',
        matchedTerms:[match.matchedWord]
      }));
  }

  root.kysOccupationRanking = {clean,words,rank,complete};
})(typeof window === 'object' ? window : globalThis);
