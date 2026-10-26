/* Pure decision copy for the vacancy evidence brief. The browser renders the
 * returned facts, but this file contains no DOM code so every state can be
 * regression-tested without a page or network. */
(function(root){
  function pounds(value){
    return Number(value || 0).toLocaleString('en-GB',{
      style:'currency',currency:'GBP',maximumFractionDigits:0
    });
  }

  function cosAssignmentText(history){
    const record = history && history.skilled_worker;
    if(!Array.isArray(record) || record.length !== 6) return '';
    const minimum = Number(record[4]);
    const maximum = Number(record[5]);
    if(!Number.isFinite(minimum) || !Number.isFinite(maximum)) return '';
    const total = minimum === maximum
      ? minimum.toLocaleString('en-GB')
      : minimum.toLocaleString('en-GB') + '\u2013' + maximum.toLocaleString('en-GB');
    return 'The Home Office FOI records ' + total +
      ' Skilled Worker CoS assignment' + (maximum === 1 ? '' : 's') +
      ' from 2021 to 2024 under this exact employer name. It does not identify occupations or current vacancies.';
  }

  function cosUsageText(usage){
    const count = usage && usage.skilled_worker;
    if(!Number.isInteger(count) || count < 5) return '';
    return 'The Home Office FOI reports ' + count.toLocaleString('en-GB') +
      ' Skilled Worker CoS used in 2025 under this exact employer name. ' +
      'Only employer-route counts of five or more were published. It does not identify occupations or current vacancies.';
  }

  function buildVacancyBrief(input){
    const evidence = input || {};
    const checks = [];
    const hasOccupation = Boolean(evidence.occupationCode && evidence.occupationConfirmed);
    const salaryGap = Number.isFinite(evidence.salaryGap) ? evidence.salaryGap : null;
    const sponsorshipClaim = evidence.sponsorshipClaim || 'unknown';
    const paymentRequest = evidence.paymentRequest || 'unknown';
    const publicRecruiterEmail = /@(gmail|outlook|hotmail|yahoo|icloud)\./i.test(evidence.recruiterEmail || '');
    const hasOfferInput = sponsorshipClaim !== 'unknown' || paymentRequest !== 'unknown' || Boolean(evidence.recruiterEmail);

    checks.push({
      key:'licence', label:'Sponsor licence', kind:'official',
      state:evidence.skilledWorker ? 'checked' : 'review',
      value:evidence.skilledWorker
        ? 'Skilled Worker is shown on the current sponsor record.'
        : 'Skilled Worker is not shown on this sponsor record. Confirm which route the vacancy intends to use.'
    });

    if(evidence.companyState === 'identified'){
      const status = evidence.companyStatus
        ? ' Companies House records the status as ' + evidence.companyStatus + '.' : '';
      checks.push({
        key:'company', label:'Company evidence', kind:'derived',
        state:evidence.companyWarningLabel ? 'review' : 'checked',
        critical:evidence.companyWarningSeverity === 'serious',
        value:evidence.companyWarningLabel
          ? 'A Companies House record is safely attached. Check this signal: ' + evidence.companyWarningLabel + '.' + status
          : 'A Companies House record is safely attached.' + status +
            ' No checked warning is attached. This is not an all-clear.'
      });
    }else if(evidence.companyState === 'ambiguous'){
      checks.push({key:'company',label:'Company evidence',kind:'unknown',state:'unknown',
        value:'Several Companies House records may fit. None was attached because choosing one could transfer the wrong history.'});
    }else{
      checks.push({key:'company',label:'Company evidence',kind:'unknown',state:'unknown',
        value:'No Companies House identity was safely attached. This is a coverage gap, not an all-clear.'});
    }

    checks.push({
      key:'occupation', label:'Occupation', kind:hasOccupation ? 'user' : 'unknown',
      state:!hasOccupation ? 'unknown' : evidence.occupationFresh ? 'checked' : 'review',
      value:!hasOccupation
        ? 'No occupation has been confirmed against the vacancy duties.'
        : 'You confirmed ' + evidence.occupationCode +
          (evidence.occupationTitle ? ' \u00b7 ' + evidence.occupationTitle : '') +
          ' against the vacancy duties.' +
          (evidence.occupationFresh ? '' : ' The checked rates are stale, so no current salary conclusion is shown.')
    });

    let salaryValue = 'Choose and confirm an occupation before comparing the salary.';
    let salaryState = 'unknown';
    if(!evidence.salaryProvided){
      salaryValue = 'No advertised salary was provided. Ask what pay and weekly hours will appear on the Certificate of Sponsorship.';
    }else if(hasOccupation && !evidence.occupationFresh){
      salaryValue = 'The occupation evidence is stale. Open the current GOV.UK rates before relying on the comparison.';
      salaryState = 'review';
    }else if(hasOccupation && salaryGap !== null){
      salaryValue = salaryGap > 0
        ? 'The entered pay is ' + pounds(salaryGap) + ' below the higher usual standard benchmark. A permitted lower-salary rule may change this.'
        : 'The entered pay is ' + pounds(Math.abs(salaryGap)) + ' above the higher usual standard benchmark.';
      salaryState = salaryGap > 0 ? 'review' : 'checked';
    }else if(hasOccupation){
      salaryValue = 'No standard-rate comparison is available for this occupation in the checked GOV.UK table.';
    }
    checks.push({key:'salary',label:'Salary comparison',kind:'derived',state:salaryState,value:salaryValue});

    let vacancyValue = sponsorshipClaim === 'yes'
      ? 'You recorded that the vacancy states sponsorship is available. KnowYourSponsor has not independently verified that statement.'
      : sponsorshipClaim === 'no'
        ? 'The vacancy information you entered says sponsorship is unavailable.'
        : 'Sponsorship was not stated in the information checked, or you have not confirmed the wording.';
    if(paymentRequest === 'yes'){
      vacancyValue += ' You also recorded that payment was requested; genuine UK employers do not charge a worker for a job offer or Certificate of Sponsorship.';
    }else if(publicRecruiterEmail){
      vacancyValue += ' The recruiter address uses a public email provider, so verify it through the employer\'s official website.';
    }
    checks.push({
      key:'vacancy', label:'Vacancy and offer evidence',
      kind:hasOfferInput ? 'user' : 'unknown',
      state:paymentRequest === 'yes' || publicRecruiterEmail || sponsorshipClaim === 'no'
        ? 'review' : sponsorshipClaim === 'yes' ? 'checked' : 'unknown',
      critical:paymentRequest === 'yes', value:vacancyValue
    });

    const assignmentText = cosAssignmentText(evidence.cosHistory);
    const usageText = cosUsageText(evidence.cosUsage2025);
    const cosText = [usageText, assignmentText].filter(Boolean).join(' ');
    checks.push({
      key:'history', label:'Historical sponsorship evidence',
      kind:cosText ? 'derived' : 'unknown', state:cosText ? 'history' : 'unknown',
      value:cosText || 'No safely linked Skilled Worker history is available in the checked FOI dataset. This does not prove that no sponsorship occurred.'
    });

    let state = 'unconfirmed';
    let title = 'Sponsorship is not confirmed for this vacancy';
    let summary = 'The employer can sponsor on the route shown, but a sponsor licence does not mean this vacancy offers sponsorship.';
    let question = 'Will you sponsor this specific vacancy under the Skilled Worker route?';

    if(paymentRequest === 'yes'){
      state = 'review';
      title = 'A payment request needs checking before you continue';
      summary = 'You recorded a request for payment connected with the offer. Stop and verify the vacancy through the employer\'s official contact details.';
      question = 'Can the employer confirm through its official website that this vacancy, recruiter and payment request are genuine?';
    }else if(!evidence.skilledWorker){
      state = 'review';
      title = 'The sponsor record does not show the Skilled Worker route';
      summary = 'Do not rely on the sponsor licence alone. Confirm which route the employer intends to use for this vacancy.';
      question = 'Which visa route will you use to sponsor this specific vacancy?';
    }else if(sponsorshipClaim === 'no'){
      state = 'review';
      title = 'This vacancy says sponsorship is unavailable';
      summary = 'The employer has a sponsor licence, but that does not override the vacancy statement you entered.';
      question = 'Is the written statement that sponsorship is unavailable correct for this vacancy?';
    }else if(evidence.companyWarningSeverity === 'serious'){
      state = 'review';
      title = 'The attached company record needs checking';
      summary = 'The sponsor record remains visible, but the safely attached Companies House record carries a serious signal. Verify the official company record.';
      question = 'Can you confirm the legal employer and current trading status for this vacancy?';
    }else if(salaryGap !== null && salaryGap > 0){
      state = 'review';
      title = 'The entered salary is below a usual standard benchmark';
      summary = 'A permitted lower-salary rule may change the comparison. Confirm the rule and occupation code before relying on this vacancy.';
      question = 'Which occupation code and permitted lower-salary rule, if any, will you use for this vacancy?';
    }else if(!hasOccupation){
      title = 'The occupation is not confirmed for this vacancy';
      summary = 'The job duties need to be matched to an official occupation before the standard salary evidence can be interpreted.';
      question = 'Which four-digit occupation code will be stated on the Certificate of Sponsorship?';
    }else if(!evidence.occupationFresh || salaryGap === null){
      title = 'The standard salary comparison is incomplete';
      summary = 'The checked evidence cannot support a current standard salary comparison for this occupation.';
      question = 'Which occupation code, salary and weekly hours will be stated on the Certificate of Sponsorship?';
    }else if(sponsorshipClaim === 'yes'){
      state = 'checked';
      title = 'No direct conflict was found in the checked evidence';
      summary = 'The licence, user-confirmed vacancy wording and standard salary comparison do not show a direct conflict. This is not an eligibility or safety decision.';
      question = 'Will the Certificate of Sponsorship use the occupation code and salary shown in this vacancy?';
    }

    let evidenceState = 'incomplete';
    let evidenceStateLabel = 'Evidence incomplete';
    let evidenceStateNote = 'One or more facts needed for this vacancy remain unknown.';
    if(state === 'review'){
      evidenceState = 'conflicting';
      evidenceStateLabel = 'Evidence needs checking';
      evidenceStateNote = 'A conflict or warning should be resolved before relying on this vacancy.';
    }else if(state === 'checked' && sponsorshipClaim === 'yes'){
      evidenceState = 'stated';
      evidenceStateLabel = 'Sponsorship stated in the vacancy';
      evidenceStateNote = 'This wording was confirmed by you from the advert; it is not an employer guarantee.';
    }else if(evidence.employerPolicyStatement === 'considers'){
      evidenceState = 'policy';
      evidenceStateLabel = 'Employer policy supports consideration';
      evidenceStateNote = 'A current employer-provided policy exists, but this vacancy is still unconfirmed.';
    }else if(evidence.skilledWorker && hasOccupation && evidence.occupationFresh &&
      evidence.salaryProvided && salaryGap !== null && salaryGap <= 0){
      evidenceState = 'compatible';
      evidenceStateLabel = 'Requirements appear compatible';
      evidenceStateNote = 'The standard checks align, but the vacancy does not confirm sponsorship.';
    }

    return {state,title,summary,checks,question,evidenceState,evidenceStateLabel,evidenceStateNote};
  }

  root.kysJobDecision = {buildVacancyBrief,cosAssignmentText,cosUsageText};
})(typeof globalThis !== 'undefined' ? globalThis : this);
