(function(){
  'use strict';

  const root = document.getElementById('marketPulse');
  if(!root) return;

  const byId = id => document.getElementById(id);
  const number = value => Number(value || 0).toLocaleString('en-GB');
  const signed = value => `${Number(value) > 0 ? '+' : ''}${Number(value || 0).toLocaleString('en-GB')}`;
  const dayFormat = new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  const shortFormat = new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
  const parseDay = value => new Date(`${value}T00:00:00Z`);
  const isoDay = value => value.toISOString().slice(0,10);

  let report = null;
  let period = '7';
  let appearedVisible = true;
  let departedVisible = true;
  let selectedDate = '';
  let latestObservedDate = '';

  function scaleCeiling(value){
    const raw = Math.max(1,Number(value || 0));
    const order = 10 ** Math.floor(Math.log10(raw));
    const step = Math.max(1,order / 2);
    return Math.ceil(raw / step) * step;
  }

  function calendarRows(data){
    const coverage = data.coverage || {};
    const daily = data.daily || [];
    if(!daily.length) return [];
    const known = new Map(daily.map(row => [row.date,row]));
    const missing = new Set(coverage.missingDays || []);
    const rows = [];
    /* Only fill gaps inside the published daily window. Coverage can eventually
       span further back than the bounded public daily series. */
    for(let cursor=parseDay(daily[0].date), last=parseDay(daily[daily.length-1].date);
        cursor <= last; cursor=new Date(cursor.getTime()+86400000)){
      const date = isoDay(cursor);
      rows.push(known.get(date) || {
        date,missing:missing.has(date),appeared:0,noLongerAppeared:0,net:0,
        downgraded:0,upgraded:0,recordsAfterComparison:null,
      });
    }
    return rows;
  }

  function rowsShown(){
    const rows = calendarRows(report);
    return period === '7' ? rows.slice(-7) : rows;
  }

  function summary(rows){
    return rows.reduce((totals,row)=>{
      if(row.missing) return totals;
      totals.appeared += Number(row.appeared || 0);
      totals.departed += Number(row.noLongerAppeared || 0);
      totals.downgraded += Number(row.downgraded || 0);
      totals.upgraded += Number(row.upgraded || 0);
      totals.observed += 1;
      return totals;
    },{appeared:0,departed:0,downgraded:0,upgraded:0,observed:0});
  }

  function detailText(row){
    const date = dayFormat.format(parseDay(row.date));
    if(row.missing) return `${date}. No verified observation is available for this day.`;
    const downgraded = Number(row.downgraded || 0);
    const upgraded = Number(row.upgraded || 0);
    const ratings = downgraded + upgraded;
    const quiet = !row.appeared && !row.noLongerAppeared && !ratings;
    if(quiet) return `${date}. Observed. No register movement was recorded.`;
    return `${date}. ${number(row.appeared)} appeared. ${number(row.noLongerAppeared)} no longer appeared. ` +
      `Net ${signed(row.net)}. ${number(downgraded)} downgraded. ${number(upgraded)} upgraded.`;
  }

  function selectedDetail(row){
    const detail = byId('pulseDetail');
    if(row.missing){
      detail.textContent = detailText(row);
      return;
    }
    const date = dayFormat.format(parseDay(row.date));
    const downgraded = Number(row.downgraded || 0);
    const upgraded = Number(row.upgraded || 0);
    const ratings = downgraded + upgraded;
    const quiet = !row.appeared && !row.noLongerAppeared && !ratings;
    if(quiet){
      detail.textContent = `${date}. Observed. No register movement was recorded.`;
      return;
    }
    const total = row.recordsAfterComparison == null ? '' : ` ${number(row.recordsAfterComparison)} records after comparison.`;
    detail.innerHTML = `<strong>${date}</strong> &middot; ${number(row.appeared)} appeared &middot; ` +
      `${number(row.noLongerAppeared)} no longer appeared &middot; Net ${signed(row.net)} &middot; ` +
      `${number(downgraded)} downgraded &middot; ${number(upgraded)} upgraded.${total}`;
  }

  function renderLatest(){
    const latest = [...calendarRows(report)].reverse().find(row=>!row.missing);
    if(!latest) return;
    latestObservedDate = latest.date;
    byId('pulseLatestDate').textContent = dayFormat.format(parseDay(latest.date));
    byId('pulseLatestSummary').innerHTML =
      `<strong>${number(latest.appeared)}</strong> appeared &middot; ` +
      `<strong>${number(latest.noLongerAppeared)}</strong> no longer appeared &middot; ` +
      `<strong>Net ${signed(latest.net)}</strong>`;
  }

  function hideTooltip(){ byId('pulseTooltip').hidden = true; }

  function showTooltip(button,row){
    const tip = byId('pulseTooltip');
    tip.textContent = detailText(row);
    tip.hidden = false;
    const wrap = button.closest('.pulse-chart-wrap').getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    const half = Math.min(95,tip.offsetWidth / 2);
    const centre = rect.left - wrap.left + rect.width / 2;
    tip.style.left = `${Math.max(half+4,Math.min(wrap.width-half-4,centre))}px`;
  }

  function dayButton(row,index,count,peak){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pulse-day';
    button.setAttribute('role','listitem');
    button.setAttribute('aria-label',detailText(row));
    if(row.date === selectedDate) button.setAttribute('aria-current','date');
    if(row.missing) button.classList.add('is-missing');
    if(row.date === latestObservedDate){
      button.classList.add('is-latest');
      const marker = document.createElement('span');
      marker.className = 'pulse-latest-marker';
      marker.textContent = 'Latest';
      marker.setAttribute('aria-hidden','true');
      button.append(marker);
    }

    const appeared = document.createElement('span');
    appeared.className = 'pulse-bar appeared';
    appeared.hidden = !appearedVisible || row.missing;
    appeared.style.height = row.appeared
      ? `${Math.max(5,Number(row.appeared) / peak * 100)}%` : '0';
    appeared.setAttribute('aria-hidden','true');

    const departed = document.createElement('span');
    departed.className = 'pulse-bar departed';
    departed.hidden = !departedVisible || row.missing;
    departed.style.height = row.noLongerAppeared
      ? `${Math.max(5,Number(row.noLongerAppeared) / peak * 100)}%` : '0';
    departed.setAttribute('aria-hidden','true');

    const label = document.createElement('span');
    label.className = 'pulse-day-label';
    label.textContent = (count <= 8 || index === 0 || index === count-1 || index % 4 === 0)
      ? shortFormat.format(parseDay(row.date)) : '';
    label.setAttribute('aria-hidden','true');

    button.append(appeared,departed,label);
    button.addEventListener('mouseenter',()=>showTooltip(button,row));
    button.addEventListener('mouseleave',hideTooltip);
    button.addEventListener('focus',()=>showTooltip(button,row));
    button.addEventListener('blur',hideTooltip);
    button.addEventListener('click',()=>{
      selectedDate = row.date;
      selectedDetail(row);
      root.querySelectorAll('.pulse-day').forEach(day=>day.removeAttribute('aria-current'));
      button.setAttribute('aria-current','date');
      showTooltip(button,row);
    });
    return button;
  }

  function render(){
    const rows = rowsShown();
    if(!rows.length) return unavailable();
    const totals = summary(rows);
    const observedLabel = `${totals.observed} of ${rows.length} days observed`;
    byId('pulseAppearedTotal').textContent = number(totals.appeared);
    byId('pulseDepartedTotal').textContent = number(totals.departed);
    byId('pulseNet').textContent = signed(totals.appeared - totals.departed);
    byId('pulseRatings').textContent = number(totals.downgraded + totals.upgraded);
    byId('pulseCoverage').textContent = observedLabel;
    byId('pulseCoverageDates').textContent = `${shortFormat.format(parseDay(rows[0].date))} to ${shortFormat.format(parseDay(rows[rows.length-1].date))}`;

    const values = [];
    for(const row of rows){
      if(appearedVisible) values.push(Number(row.appeared || 0));
      if(departedVisible) values.push(Number(row.noLongerAppeared || 0));
    }
    const peak = scaleCeiling(Math.max(1,...values));
    byId('pulseScaleMax').textContent = number(peak);
    byId('pulseScaleMid').textContent = number(peak / 2);
    const chart = byId('pulseChart');
    chart.replaceChildren();
    chart.style.minWidth = rows.length > 10 ? `${rows.length * 40}px` : '100%';
    if(!rows.some(row=>row.date === selectedDate)) selectedDate = rows[rows.length-1].date;
    rows.forEach((row,index)=>chart.append(dayButton(row,index,rows.length,peak)));
    selectedDetail(rows.find(row=>row.date === selectedDate) || rows[rows.length-1]);
    hideTooltip();
    const scroll = byId('pulseChartScroll');
    requestAnimationFrame(()=>{
      scroll.scrollLeft = period === 'all' ? scroll.scrollWidth : 0;
    });
  }

  function unavailable(){
    byId('pulseLoading').hidden = true;
    byId('pulseContent').hidden = true;
    byId('pulseUnavailable').hidden = false;
    byId('pulseStatus').textContent = 'Unavailable';
  }

  function selectPeriod(next){
    period = next;
    byId('pulseLast7').setAttribute('aria-pressed',String(next === '7'));
    byId('pulseAll').setAttribute('aria-pressed',String(next === 'all'));
    selectedDate = '';
    render();
  }

  byId('pulseLast7').addEventListener('click',()=>selectPeriod('7'));
  byId('pulseAll').addEventListener('click',()=>selectPeriod('all'));
  root.querySelectorAll('[data-series]').forEach(control=>control.addEventListener('click',()=>{
    const appeared = control.dataset.series === 'appeared';
    if(appeared && !departedVisible && appearedVisible) return;
    if(!appeared && !appearedVisible && departedVisible) return;
    if(appeared) appearedVisible = !appearedVisible; else departedVisible = !departedVisible;
    control.setAttribute('aria-pressed',String(appeared ? appearedVisible : departedVisible));
    render();
  }));

  fetch('data/market_trends.json',{cache:'no-cache'})
    .then(response=>response.ok ? response.json() : Promise.reject(new Error('unavailable')))
    .then(data=>{
      if(!data || data.status === 'unavailable' || !Array.isArray(data.daily) || !data.daily.length){
        unavailable(); return;
      }
      report = data;
      renderLatest();
      byId('pulseAll').textContent = `All ${calendarRows(data).length} days`;
      byId('pulseStatus').textContent = data.status === 'established' ? 'Established series' : 'Collecting history';
      byId('pulseSource').textContent = `${data.source}. Last rebuilt ${data.updated}.`;
      byId('pulseLoading').hidden = true;
      byId('pulseContent').hidden = false;
      selectPeriod(period);
    })
    .catch(unavailable);
})();
