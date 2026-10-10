/* Pure vacancy-title rules shared by the browser UI and release tests. */
(function(root){
  const MIN_JOB_TITLE_LETTERS = 4;
  const COMPLETE_SHORT_JOB_TITLES = new Set(['gp','ceo','cto','cfo','cmo']);
  const AMBIGUOUS_JOB_TITLES = new Set([
    'it','hr','qa','tech','technology','manager','assistant','officer','worker','staff',
    'consultant','analyst','engineer','admin','administration','care','data','finance',
    'legal','marketing','operations','product','project','sales','software','support'
  ]);
  const JOB_TITLE_WORDS = [
    'accountant','administrator','advisor','analyst','architect','assistant','carer',
    'chef','consultant','coordinator','designer','developer','director','engineer',
    'manager','nurse','officer','operator','planner','programmer','recruiter',
    'scientist','software','specialist','supervisor','surveyor','teacher','technician',
    'therapist','worker'
  ];

  function titleWords(value){
    return String(value || '').trim().toLowerCase()
      .replace(/[^a-z0-9+#.-]+/g,' ').trim().split(/\s+/).filter(Boolean);
  }

  function ambiguousSingleWord(word){
    if(AMBIGUOUS_JOB_TITLES.has(word)) return true;
    return word.length >= 3 && JOB_TITLE_WORDS.some(titleWord=>
      titleWord !== word && titleWord.startsWith(word));
  }

  function jobTitleIssue(value){
    const title = String(value || '').trim();
    const words = titleWords(title);
    if(!title) return 'Enter the full title shown on the vacancy.';
    const letters = title.replace(/[^a-z0-9]/gi,'').length;
    const recognisedShortTitle = words.length === 1 && COMPLETE_SHORT_JOB_TITLES.has(words[0]);
    if((letters < MIN_JOB_TITLE_LETTERS && !recognisedShortTitle) ||
      (words.length === 1 && ambiguousSingleWord(words[0]))){
      return 'This title is too broad or incomplete to identify an occupation. Enter the full vacancy title, such as IT service manager.';
    }
    return '';
  }

  function occupationWords(value){
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/)
      .filter(word=>word && !['senior','junior','lead','principal','head','chief'].includes(word))
      .map(word=>word.endsWith('ies') ? word.slice(0,-3) + 'y' :
        (word.endsWith('s') && word.length > 4 ? word.slice(0,-1) : word));
  }

  function suggestionMode(value){
    const letters = String(value || '').replace(/[^a-z0-9]/gi,'').length;
    if(!letters) return 'empty';
    if(letters < 3) return 'short';
    return jobTitleIssue(value) ? 'guided' : 'normal';
  }

  function resolvedOccupationTitle(value, officialTitle){
    const entered = String(value || '').trim();
    return !entered || jobTitleIssue(entered) ? String(officialTitle || '').trim() : entered;
  }

  root.kysJobTitleLogic = {
    jobTitleIssue, occupationWords, suggestionMode, resolvedOccupationTitle
  };
})(typeof window === 'object' ? window : globalThis);
