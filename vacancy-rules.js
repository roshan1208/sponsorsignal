/* Versioned, deterministic vacancy-rule assessment.
 *
 * The engine deliberately evaluates only the standard salary basis. Other
 * bases depend on applicant facts or separately governed evidence and remain
 * unresolved until those inputs are available. Every assessment carries the
 * rules and occupation figures needed to reproduce it later. */
(function(root){
  const BASIS_LABELS = {
    standard:'Standard salary rules',
    lower_salary:'Lower salary or new entrant',
    transitional:'Transitional arrangement',
    health_education:'Health or education national pay scale',
  };

  function finite(value){
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function roundMoney(value){
    return Math.round(Number(value || 0));
  }

  function annualise(amount,period,hours){
    const value = finite(amount);
    const weeklyHours = finite(hours);
    if(value === null || value <= 0) return null;
    if(period === 'hour') return weeklyHours && weeklyHours > 0 ? roundMoney(value * weeklyHours * 52) : null;
    if(period === 'week') return roundMoney(value * 52);
    if(period === 'month') return roundMoney(value * 12);
    return roundMoney(value);
  }

  function rulesetSnapshot(ruleset,occupation){
    if(!ruleset) return null;
    return {
      schemaVersion:1,
      id:String(ruleset.id || ''),
      version:String(ruleset.version || ''),
      sourceUpdated:String(ruleset.sourceUpdated || ''),
      checkedAt:String(ruleset.checkedAt || ''),
      effectiveFrom:ruleset.effectiveFrom || null,
      effectiveTo:ruleset.effectiveTo || null,
      effectiveDateStatus:String(ruleset.effectiveDateStatus || 'unknown'),
      generalThreshold:finite(ruleset.generalThreshold),
      hoursBasis:finite(ruleset.hoursBasis),
      sources:{...(ruleset.sources || {})},
      lists:{...(ruleset.lists || {})},
      governedExceptions:{...(ruleset.governedExceptions || {})},
      occupation:occupation ? {
        code:String(occupation.code || ''),
        jobType:String(occupation.jobType || ''),
        eligibility:String(occupation.eligibility || ''),
        standardAnnual:finite(occupation.standardAnnual),
        lowerAnnual:finite(occupation.lowerAnnual),
      } : null,
    };
  }

  function selectRuleset(document,assessmentDate){
    const rulesets = Array.isArray(document?.rulesets) ? document.rulesets : [];
    const wanted = String(assessmentDate || '').slice(0,10);
    const eligible = rulesets.filter(item=>{
      if(!item || !item.id) return false;
      if(!wanted || !item.effectiveFrom) return true;
      return item.effectiveFrom <= wanted && (!item.effectiveTo || item.effectiveTo >= wanted);
    });
    return eligible.sort((a,b)=>String(b.effectiveFrom || b.sourceUpdated || '').localeCompare(
      String(a.effectiveFrom || a.sourceUpdated || '')))[0] || rulesets[0] || null;
  }

  function unresolved(snapshot,basis,reason,inputs={}){
    return {
      schemaVersion:1,state:'unresolved',basis,basisLabel:BASIS_LABELS[basis] || basis,
      reason,assessedAt:new Date().toISOString(),ruleset:snapshot,inputs,
      calculation:null,decisions:[reason],
    };
  }

  function assess(input){
    const data = input || {};
    const basis = BASIS_LABELS[data.basis] ? data.basis : 'standard';
    const occupation = data.occupation || null;
    const snapshot = data.rulesetSnapshot || rulesetSnapshot(data.ruleset,occupation);
    const hours = finite(data.hours) || finite(snapshot?.hoursBasis) || 37.5;
    const annualSalary = finite(data.annualSalary) || annualise(data.salary,data.salaryPeriod,hours);
    const inputs = {
      salary:finite(data.salary),salaryPeriod:String(data.salaryPeriod || 'year'),
      annualSalary,hours,occupationCode:String(occupation?.code || snapshot?.occupation?.code || ''),
      occupationConfirmed:Boolean(data.occupationConfirmed),basis,
    };
    if(!snapshot) return unresolved(null,basis,'No versioned ruleset was available.',inputs);
    if(!inputs.occupationConfirmed || !snapshot.occupation){
      return unresolved(snapshot,basis,'The occupation remains unresolved until the user confirms it against the vacancy duties.',inputs);
    }
    if(!annualSalary){
      return unresolved(snapshot,basis,'No advertised salary was provided, so pay cannot be compared.',inputs);
    }
    if(basis !== 'standard'){
      const messages = {
        lower_salary:'Lower-salary and new-entrant rules require applicant-specific evidence and are not inferred from a vacancy.',
        transitional:'Transitional rules require qualifying dates and immigration history that are not available from the vacancy.',
        health_education:'National pay-scale cases require the relevant public-sector pay evidence and cannot be inferred from the job title.',
      };
      return unresolved(snapshot,basis,messages[basis],inputs);
    }
    const general = finite(snapshot.generalThreshold);
    const standardAnnual = finite(snapshot.occupation.standardAnnual);
    const hoursBasis = finite(snapshot.hoursBasis) || 37.5;
    if(!general || !standardAnnual){
      return unresolved(snapshot,basis,'The pinned ruleset does not contain a standard benchmark for this occupation.',inputs);
    }
    const goingRate = roundMoney(standardAnnual * hours / hoursBasis);
    const requiredBenchmark = Math.max(general,goingRate);
    const difference = roundMoney(annualSalary - requiredBenchmark);
    return {
      schemaVersion:1,state:difference >= 0 ? 'meets_standard_benchmarks' : 'below_standard_benchmarks',
      basis,basisLabel:BASIS_LABELS[basis],reason:'Standard salary calculation completed.',
      assessedAt:new Date().toISOString(),ruleset:snapshot,inputs,
      calculation:{generalThreshold:general,occupationAnnualRate:standardAnnual,hoursBasis,
        weeklyHours:hours,goingRate,requiredBenchmark,difference,
        formula:`max(${general}, round(${standardAnnual} × ${hours} ÷ ${hoursBasis}))`},
      decisions:[
        'The occupation was confirmed by the user, not by KnowYourSponsor or the employer.',
        'Sponsor-route evidence is separate from whether this vacancy offers sponsorship.',
        'Lower salary, new entrant, transitional and national pay-scale rules were not applied.',
      ],
    };
  }

  function replay(assessment){
    if(!assessment?.ruleset) return null;
    return assess({...assessment.inputs,rulesetSnapshot:assessment.ruleset,
      occupation:assessment.ruleset.occupation,basis:assessment.basis});
  }

  root.kysVacancyRules = {BASIS_LABELS,annualise,rulesetSnapshot,selectRuleset,assess,replay};
})(typeof globalThis !== 'undefined' ? globalThis : this);
