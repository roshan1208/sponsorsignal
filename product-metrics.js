(function(){
  'use strict';
  const endpoint='https://app.knowyoursponsor.co.uk/v1/public/product-event';
  const production=/^(?:www\.)?knowyoursponsor\.co\.uk$/i.test(location.hostname);
  const allowed=new Set([
    'search_used','employer_opened','shortlist_saved','shortlist_shared','comparison_created',
    'alert_started','alert_signup_completed','csv_downloaded','pdf_report_opened','job_pdf_report_opened','job_check_started',
    'vacancy_details_extracted','vacancy_link_read','vacancy_link_fallback_shown','vacancy_copy_flow_opened',
    'vacancy_review_unchanged','vacancy_review_changed',
    'vacancy_review_changed_employer','vacancy_review_changed_role','vacancy_review_changed_location',
    'vacancy_review_changed_salary','vacancy_review_changed_salary_period','vacancy_review_changed_hours',
    'vacancy_review_filled_employer','vacancy_review_filled_role','vacancy_review_filled_location',
    'vacancy_review_filled_salary','vacancy_review_filled_salary_period','vacancy_review_filled_hours',
    'job_evidence_created','job_check_completed_under_60s','job_check_completed_under_3m',
    'job_check_completed_over_3m','job_evidence_copied','application_saved',
    'application_baseline_recorded','application_tracker_exported','job_feedback_useful',
    'job_feedback_employer_match','job_feedback_occupation','job_feedback_salary',
    'job_feedback_missing_details','employer_follow_started','watch_pilot_from_shortlist',
    'community_pilot_opened','community_pilot_check_started','community_pilot_report_created',
    'community_pilot_feedback_useful','community_pilot_feedback_needs_work',
    'business_pricing_viewed','business_portfolio_scan_started',
    'business_portfolio_scan_opened','business_portfolio_scan_prepared',
    'cos_history_viewed','cos_history_source_opened',
    'extension_chrome_link_job_tools','extension_chrome_link_guide',
    'vital_lcp_good','vital_lcp_needs_improvement','vital_lcp_poor',
    'vital_inp_good','vital_inp_needs_improvement','vital_inp_poor',
    'vital_cls_good','vital_cls_needs_improvement','vital_cls_poor'
  ]);
  function send(event){
    if(!production||!allowed.has(event)) return;
    fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event}),credentials:'omit',keepalive:true}).catch(()=>undefined);
  }
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('[data-product-event]');
    if(link) send(link.dataset.productEvent);
  },{capture:true});
  function bucket(name,value,good,poor){
    const rating=value<=good?'good':value<=poor?'needs_improvement':'poor';
    const event='vital_'+name+'_'+rating;
    send(event);
  }
  if(production&&'PerformanceObserver' in window){
    let lcp,cls=0,sent=false;const interactions=new Map();
    try{new PerformanceObserver(list=>{for(const entry of list.getEntries())lcp=entry.startTime}).observe({type:'largest-contentful-paint',buffered:true})}catch(error){void error}
    try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.interactionId)interactions.set(entry.interactionId,Math.max(interactions.get(entry.interactionId)||0,entry.duration))}).observe({type:'event',buffered:true,durationThreshold:40})}catch(error){void error}
    try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput)cls+=entry.value}).observe({type:'layout-shift',buffered:true})}catch(error){void error}
    const flush=()=>{if(sent)return;sent=true;if(Number.isFinite(lcp))bucket('lcp',lcp,2500,4000);const latencies=[...interactions.values()].sort((a,b)=>b-a);const inp=latencies[Math.min(latencies.length-1,Math.floor(latencies.length/50))];if(Number.isFinite(inp))bucket('inp',inp,200,500);bucket('cls',cls,0.1,0.25)};
    addEventListener('pagehide',flush,{once:true});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush()},{once:true});
  }
  window.kysProductMetrics={record:send};
})();
