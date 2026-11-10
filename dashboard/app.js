'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = { generation: 0, session: null, identity: null, events: new Map(), cursor: undefined,
    selected: null, locked: false, polling: false, suspended: false, timer: null, controller: new AbortController(),
    requests: {}, sourceArgs: null, sourceCursor: null, capture: null, blob: null, selecting: false };
  const text = (id, value) => { $(id).textContent = value == null ? 'Not reported' : String(value); };
  const pretty = value => JSON.stringify(value, null, 2) ?? 'Not reported';
  const stamp = value => value == null ? 'Not reported' : String(value);
  const errorText = error => typeof error === 'string' ? error : [error?.message, error?.recovery].filter(Boolean).join(' · ') || pretty(error);
  const stale = () => new DOMException('Superseded request', 'AbortError');
  function facts(id, entries) {
    $(id).replaceChildren(...entries.map(([name, value]) => {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = name; dd.textContent = value == null ? 'Not reported' : String(value); row.append(dt, dd); return row;
    }));
  }
  function report(error) {
    if (error?.name === 'AbortError') return;
    text('global-error', errorText(error)); $('global-error').hidden = false;
  }
  function clearCapture() {
    if (state.blob) URL.revokeObjectURL(state.blob);
    state.blob = null; state.capture = null;
    $('capture-image').hidden = true; $('capture-image').removeAttribute('src');
    text('capture-meta', ''); text('share-request', ''); $('share-request').value = '';
    $('review-capture').hidden = true; $('share-panel').hidden = true;
  }
  function invalidate() {
    const evidenceHadFocus = ['events', 'source-results', 'widget-results', 'share-panel'].some(id => $(id).contains(document.activeElement));
    state.generation++; state.controller.abort(); state.controller = new AbortController(); state.requests = {};
    state.session = null; state.identity = null; state.cursor = undefined; state.events.clear(); state.selected = null;
    state.sourceArgs = null; state.sourceCursor = null;
    for (const id of ['events', 'event-facts', 'source-results', 'widget-results']) $(id).replaceChildren();
    for (const id of ['event-message', 'event-details', 'source-notice', 'widget-notice', 'log-notice']) text(id, '');
    text('source-detail', 'No current source selected.'); text('widget-detail', 'No current instance selected.');
    text('event-placeholder', 'Select an event to inspect its full evidence.'); $('event-placeholder').hidden = false;
    text('log-empty', 'Waiting for a current session.'); $('log-empty').hidden = false;
    text('counts', 'No current activity'); $('source-more').hidden = true;
    clearCapture(); text('capture-notice', 'Current evidence cleared. Nothing is shared.');
    $('window').replaceChildren(new Option('Choose a window…', ''));
    text('windows-notice', 'Refresh candidate windows before capturing.');
    text('doctor-result', ''); text('doctor-notice', 'Diagnostics have not been requested for this connection.');
    currentControls();
    if (evidenceHadFocus) $('refresh').focus({ preventScroll: true });
  }
  function currentControls() {
    document.querySelectorAll('[data-current]').forEach(button => { button.disabled = !state.session || state.selecting; });
  }
  function disconnected(message, health = 'bridge_offline') {
    if (state.session || state.identity) invalidate();
    text('overview-title', 'No current client'); text('health', health); text('connection-note', message);
    facts('identity', []); text('capabilities', 'No current client'); sessionOptions([], null); currentControls();
  }
  async function request(path, body, blob = false) {
    const generation = state.generation;
    const parentSignal = state.controller.signal, controller = new AbortController();
    const abort = () => controller.abort(); parentSignal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new DOMException('Local request timed out; retry when the service is ready.', 'TimeoutError')), 30000);
    try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (generation !== state.generation) throw stale();
    if (response.status === 401) {
      state.locked = true; invalidate(); disconnected('Unlock to inspect the local service.', 'locked'); $('unlock').hidden = false;
      throw new Error('Authentication required. Unlock with your local token.');
    }
    const data = blob && response.ok ? await response.blob() : await response.json();
    if (generation !== state.generation) throw stale();
    if (!response.ok) throw new Error(errorText(data.error ?? data));
    return data;
    } finally { clearTimeout(timeout); parentSignal.removeEventListener('abort', abort); }
  }
  async function tool(name, args, includeTextBlocks = false) {
    const result = await request('/api/tools/' + name, args);
    const block = result.content?.find(item => item.type === 'text');
    let data;
    try { data = JSON.parse(block?.text ?? 'null'); } catch { data = block?.text; }
    if (result.isError) throw new Error(errorText(data ?? 'Tool request failed.'));
    if (data?.error) throw new Error(errorText(data.error));
    return includeTextBlocks ? { metadata: data, textBlocks: result.content?.filter(item => item.type === 'text').slice(1).map(item => item.text) ?? [] } : data;
  }
  // Each interaction has its own ticket, in addition to the session generation.
  function ticket(key) {
    const generation = state.generation, serial = (state.requests[key] ?? 0) + 1;
    state.requests[key] = serial;
    return () => { if (generation !== state.generation || state.requests[key] !== serial) throw stale(); };
  }
  async function action(key, statusId, operation) {
    const valid = ticket(key); text(statusId, 'Working…');
    try { await operation(valid); } catch (error) { try { valid(); } catch { return; } if (error.name !== 'AbortError') text(statusId, errorText(error)); }
  }
  function sessionOptions(items, selectedId) {
    const select = $('session'), signature = pretty([items, selectedId]);
    if (select.dataset.signature === signature) return;
    select.dataset.signature = signature;
    select.replaceChildren(new Option('Choose a session…', ''), ...items.map(item => new Option(`${item.name || item.clientName || 'Session'} · ${item.id}`, item.id)));
    select.value = selectedId ?? '';
  }
  function applyStatus(status) {
    const session = status.session;
    const usable = session && !['no_client', 'bridge_offline', 'selection_required'].includes(status.state);
    const identity = usable ? `${session.id}/${session.connectionId ?? ''}` : null;
    if (state.identity !== identity) invalidate();
    state.session = usable ? session.id : null; state.identity = identity;
    text('overview-title', usable ? session.name || session.clientName || 'Current client' : 'No current client');
    text('health', status.state); text('connection-note', status.error ? errorText(status.error) : usable ? 'Connection freshness only; source, widgets and captures are separate evidence.' : 'Select or connect a client to inspect current evidence.');
    facts('identity', [ ['Client', usable ? session.clientName || session.name : 'None'], ['Session ID', state.session ?? 'None'],
      ['Connection', usable ? session.connectionId : 'None'], ['Service build', status.build?.serviceBuild],
      ['Reported reader build', status.build?.reportedReaderBuild], ['Expected reader build', status.build?.expectedReaderBuild],
      ['Connection last update', status.freshness?.lastUpdate ?? session?.lastUpdate], ['Status observed at', status.observedAt],
      ['Connection age (ms)', status.freshness?.ageMs], ['Stale threshold (ms)', status.freshness?.staleAfterMs],
      ['Source kind (reported)', usable ? session.sourceKind : 'None'], ['Place ID', usable ? session.placeId : 'None'] ]);
    text('capabilities', usable ? pretty(session.capabilities) : 'No current client');
    sessionOptions(status.sessions ?? [], state.session);
    text('counts', `${status.activity?.retainedEvents ?? '—'} retained events on service · ${status.activity?.pendingRequests ?? '—'} pending requests`);
    currentControls();
  }
  function eventKey(event) { return `${event.sessionId}:${event.seq}`; }
  function orderedEvents() { return [...state.events.values()].sort((a, b) => b.seq - a.seq); }
  function selectEvent(event, focus = false) {
    state.selected = eventKey(event); $('event-placeholder').hidden = true;
    facts('event-facts', [['Timestamp', event.timestamp], ['Received at', event.receivedAt], ['Severity', event.severity],
      ['Source', event.source], ['Session', event.sessionId], ['Sequence', event.seq], ['Run ID', event.runId ?? 'None'],
      ['Attribution', event.attribution], ['Message truncated by service', event.truncated ? 'Yes — retained evidence is incomplete' : 'No']]);
    text('event-message', event.message); text('event-details', pretty(event.details));
    for (const button of $('events').querySelectorAll('button')) {
      const selected = button.dataset.key === state.selected; button.setAttribute('aria-pressed', String(selected));
      if (selected && focus) { button.focus(); button.scrollIntoView({ block: 'nearest' }); }
    }
  }
  function renderEvents() {
    const list = $('events'), filter = $('severity').value;
    const focusedKey = list.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    const events = orderedEvents().filter(event => filter !== 'error' || event.severity === 'error');
    const wanted = new Set(events.map(eventKey));
    // Keyed updates preserve the actual focused DOM node while new events arrive.
    for (const li of [...list.children]) if (!wanted.has(li.firstChild.dataset.key)) li.remove();
    const existing = new Map([...list.children].map(li => [li.firstChild.dataset.key, li]));
    let previous = null;
    for (const event of events) {
      const key = eventKey(event); let li = existing.get(key);
      if (!li) {
        li = document.createElement('li'); const button = document.createElement('button');
        button.type = 'button'; button.className = 'event ' + (['warn', 'error'].includes(event.severity) ? event.severity : 'info'); button.dataset.key = key;
        const line = document.createElement('span'), preview = document.createElement('span');
        line.className = 'event-line'; preview.className = 'event-preview';
        line.textContent = `${stamp(event.timestamp)} · ${event.severity} · ${event.source} · #${event.seq}`;
        preview.textContent = event.message; button.append(line, preview); li.append(button);
        button.addEventListener('click', () => selectEvent(event));
      }
      li.firstChild.setAttribute('aria-pressed', String(key === state.selected));
      const expected = previous ? previous.nextSibling : list.firstChild;
      if (expected !== li) list.insertBefore(li, expected);
      previous = li;
    }
    $('log-empty').hidden = events.length > 0;
    text('log-empty', state.session ? filter === 'error' ? 'No retained errors in the loaded evidence.' : 'No events reported for this session.' : 'No current client. Connect or select a session.');
    if (focusedKey && !wanted.has(focusedKey)) (list.querySelector('button') || $('newest')).focus({ preventScroll: true });
  }
  async function logs() {
    const session = state.session, generation = state.generation; let pages = 0, more = false;
    do {
      const page = await tool('get_logs', { sessionId: session, ...(state.cursor == null ? {} : { cursor: state.cursor }), limit: 200 });
      if (state.generation !== generation || session !== state.session) throw stale();
      if (page.sessionId !== session || page.current === false) {
        disconnected('The inspection session changed or disconnected; previous evidence was cleared.', 'selection_required');
        renderEvents();
        text('log-notice', page.notice || 'The service returned historical evidence; it was not displayed as current.'); return;
      }
      if (page.gap) text('log-notice', `Retention gap: sequences ${page.gap.fromSeq}–${page.gap.toSeq} are unavailable. ${page.notice || ''}`);
      else if (page.notice) text('log-notice', page.notice);
      for (const event of page.items ?? []) if (event.sessionId === session) state.events.set(eventKey(event), event);
      const ordered = orderedEvents(); for (const event of ordered.slice(1000)) state.events.delete(eventKey(event));
      if (state.selected && !state.events.has(state.selected)) {
        state.selected = null; $('event-facts').replaceChildren(); text('event-message', ''); text('event-details', '');
        text('event-placeholder', 'Selected event left the 1,000-event local retention window.'); $('event-placeholder').hidden = false;
      }
      more = Boolean(page.hasMore && page.nextCursor != null && page.nextCursor !== state.cursor);
      state.cursor = page.nextCursor ?? state.cursor; pages++;
    } while (more && pages < 20);
    renderEvents();
    if (more) text('log-notice', 'Catching up with retained pages. Newest / Latest Error refer only to loaded evidence until catch-up finishes.');
  }
  async function poll() {
    if (state.polling || state.selecting || state.locked || state.suspended) return;
    clearTimeout(state.timer); state.polling = true; text('busy', 'Refreshing…'); $('events').setAttribute('aria-busy', 'true');
    try {
      const status = await request('/api/status'); applyStatus(status); $('global-error').hidden = true;
      if (state.session) await logs(); else renderEvents();
    } catch (error) {
      if (error.name !== 'AbortError') { if (!state.locked) disconnected('Service unavailable. Retry when the local service is ready.'); report(error); }
    } finally {
      state.polling = false; text('busy', ''); $('events').setAttribute('aria-busy', 'false');
      if (!state.locked && !state.suspended) state.timer = setTimeout(poll, 1500);
    }
  }
  function navigate() {
    const view = location.hash.slice(1).split('?')[0]; const active = ['activity', 'source', 'visuals', 'diagnostics'].includes(view) ? view : 'activity';
    document.querySelectorAll('.view').forEach(section => { section.hidden = section.id !== active; });
    document.querySelectorAll('[data-view]').forEach(link => { if (link.dataset.view === active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    if (active === 'activity') {
      $('severity').value = new URLSearchParams(location.hash.split('?')[1]).get('severity') === 'error' ? 'error' : 'all';
      renderEvents();
    }
  }
  window.addEventListener('hashchange', navigate); navigate();
  $('severity').addEventListener('change', () => { history.replaceState(null, '', '#activity' + ($('severity').value === 'error' ? '?severity=error' : '')); renderEvents(); });
  $('refresh').addEventListener('click', () => { void poll(); });
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); let token = $('token').value; $('token').value = '';
    const button = event.submitter; button.disabled = true; text('login-message', 'Unlocking…');
    try { const pending = request('/api/login', { token }); token = ''; await pending; state.locked = false; $('unlock').hidden = true; text('login-message', ''); $('main').focus({ preventScroll: true }); await poll(); }
    catch (error) { if (error.name !== 'AbortError') { text('login-message', errorText(error)); $('token').focus({ preventScroll: true }); } }
    finally { token = ''; button.disabled = false; }
  });
  $('session').addEventListener('change', async () => {
    const sessionId = $('session').value; invalidate(); clearTimeout(state.timer);
    disconnected('Inspection target changing; previous evidence cleared.', 'selection_required');
    if (!sessionId) { void poll(); return; }
    state.selecting = true; $('session').disabled = true;
    try { await tool('select_session', { sessionId }); } catch (error) { report(error); }
    finally { state.selecting = false; $('session').disabled = false; currentControls(); void poll(); }
  });
  for (const [id, errorsOnly] of [['newest', false], ['latest-error', true]]) $(id).addEventListener('click', () => {
    const event = orderedEvents().find(item => !errorsOnly || item.severity === 'error');
    if (!event) { text('log-notice', errorsOnly ? 'No errors in loaded retained evidence.' : 'No events in loaded retained evidence.'); return; }
    if (!errorsOnly) { $('severity').value = 'all'; history.replaceState(null, '', '#activity'); }
    renderEvents(); selectEvent(event, true);
  });
  $('events').addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const buttons = [...$('events').querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    if (index < 0) return; event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
  });
  function resultButton(list, label, callback) {
    const li = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', callback); li.append(button); $(list).append(li);
  }
  async function searchSource(more) {
    if (!state.session) return;
    if (!more) {
      state.sourceArgs = { query: $('query').value, caseSensitive: $('case-sensitive').checked, ...($('path-filter').value ? { pathFilter: $('path-filter').value } : {}), limit: 50 };
      state.sourceCursor = null; $('source-results').replaceChildren(); text('source-detail', 'No source selected.'); ticket('read-source');
    }
    const args = { ...state.sourceArgs, ...(more ? { cursor: state.sourceCursor } : {}) }; $('source-more').hidden = true;
    await action('source', 'source-notice', async valid => {
      const result = await tool('search_source', args); valid();
      if (result.sessionId !== state.session) throw stale();
      const c = result.coverage ?? {};
      text('source-notice', `Coverage: ${c.searchedScripts ?? '—'} / ${c.eligibleScripts ?? '—'} eligible scripts searched · ${c.missingSource ?? '—'} missing source · ${c.staleSource ?? '—'} stale source. Partial: ${Boolean(result.partial)}. Truncated: ${Boolean(result.truncated)}. ${result.notice || ''}${!result.items?.length ? ' No matches on this page.' : ''}`);
      for (const hit of result.items ?? []) resultButton('source-results', `${hit.path || hit.name} : ${hit.line} · revision ${hit.revision ?? 'unknown'} · ${hit.sourceKind ?? 'unknown'} · freshness ${typeof hit.freshness === 'object' ? pretty(hit.freshness) : hit.freshness ?? 'not reported'}${hit.observedAt ? ' · observed ' + hit.observedAt : ''}\n${hit.excerpt}`, () => {
        void action('read-source', 'source-detail', async current => {
          const data = await tool('read_script', { script: { id: hit.scriptId }, startLine: hit.line, maxLines: 30 }, true); current();
          text('source-detail', `Search evidence revision: ${hit.revision ?? 'unknown'}\nRead result (freshness and revision as reported; not inferred from heartbeat):\n${pretty(data.metadata)}\n\n${data.textBlocks.join('\n\n')}`);
        });
      });
      state.sourceCursor = result.nextCursor; $('source-more').hidden = !result.nextCursor;
    });
  }
  $('source-form').addEventListener('submit', event => { event.preventDefault(); void searchSource(false); });
  $('source-more').addEventListener('click', () => { void searchSource(true); });
  $('widget-form').addEventListener('submit', event => {
    event.preventDefault(); if (!state.session) return; $('widget-results').replaceChildren(); text('widget-detail', 'No instance selected.'); ticket('inspect');
    void action('widgets', 'widget-notice', async valid => {
      const result = await tool('search_instances', { name: $('widget-name').value }); valid();
      const items = result.items ?? result.results ?? (Array.isArray(result) ? result : []);
      text('widget-notice', `${items.length} returned instances. Freshness not inferred from connection heartbeat. ${result.notice || ''}${result.observedAt ? ' Observed: ' + result.observedAt : ''}${result.freshness ? ' Freshness: ' + pretty(result.freshness) : ''}${result.partial ? ' Partial snapshot: ' + (result.partialReason || 'coverage incomplete') + '.' : ''}${result.hasMore ? ' Additional results exist; narrow the name search.' : ''}`);
      for (const item of items) resultButton('widget-results', `${item.path || item.name} · ${item.className} · ${item.id}`, () => {
        void action('inspect', 'widget-detail', async current => { const data = await tool('inspect_instance', { target: { id: item.id } }); current(); text('widget-detail', pretty(data)); });
      });
    });
  });
  $('windows-refresh').addEventListener('click', () => {
    ticket('capture'); clearCapture(); $('window').replaceChildren(new Option('Choose a window…', ''));
    text('capture-notice', 'Preview cleared. Choose a window and capture again. Nothing is shared.');
    void action('windows', 'windows-notice', async valid => {
      const result = await tool('list_windows', {}); valid();
      for (const item of result.items ?? []) $('window').append(new Option(`${item.title} · ${item.processName} / PID ${item.pid} · ${item.width}×${item.height}${item.minimized ? ' · minimized' : ''}`, item.id));
      text('windows-notice', `${result.items?.length ?? 0} candidate windows. ${result.notice || ''}${!result.items?.length ? ' No candidate windows available.' : ' Choose explicitly; titles do not verify session identity.'}`);
    });
  });
  $('window').addEventListener('change', () => { ticket('capture'); clearCapture(); text('capture-notice', 'Window changed. Capture and review a new preview.'); });
  $('capture-form').addEventListener('submit', event => {
    event.preventDefault(); if (!state.session || !$('window').value) return;
    void action('capture', 'capture-notice', async valid => {
      clearCapture(); const values = ['x', 'y', 'width', 'height'].map(key => $('crop-' + key).value);
      let crop;
      if (values.some(value => value !== '')) {
        const numbers = values.map(Number);
        if (values.some(value => value === '') || numbers.some(value => !Number.isSafeInteger(value)) || numbers[0] < 0 || numbers[1] < 0 || numbers[2] < 1 || numbers[3] < 1) throw new Error('Crop needs all four integer fields: nonnegative X/Y and positive width/height.');
        crop = Object.fromEntries(['x', 'y', 'width', 'height'].map((key, i) => [key, numbers[i]]));
      }
      const capture = await tool('preview_capture', { windowId: $('window').value, sessionId: state.session, ...(crop ? { crop } : {}) }); valid();
      const blob = await request('/api/captures/' + encodeURIComponent(capture.captureId), undefined, true); valid();
      state.capture = capture; state.blob = URL.createObjectURL(blob);
      const image = $('capture-image'); image.src = state.blob; image.width = capture.width; image.height = capture.height; image.hidden = false;
      text('capture-meta', pretty(capture)); text('capture-notice', 'Session match unverified; historical local preview. Not shared. Review the image before preparing an MCP request.');
      // Review is enabled only after the browser has decoded the preview.
      try { await image.decode(); valid(); $('review-capture').hidden = false; }
      catch (error) { valid(); clearCapture(); throw new Error('Preview could not be decoded. Capture again; sharing request was not prepared.'); }
    });
  });
  $('review-capture').addEventListener('click', () => {
    if (!state.capture || !state.session) return;
    $('share-request').value = 'share_capture ' + pretty({ captureId: state.capture.captureId, sessionId: state.session, confirm: true });
    $('share-panel').hidden = false; $('share-request').focus(); $('share-request').select();
  });
  $('doctor').addEventListener('click', () => { void action('doctor', 'doctor-notice', async valid => {
    const result = await request('/api/doctor'); valid(); text('doctor-result', pretty(result)); text('doctor-notice', 'Read-only diagnostics returned. This is a snapshot, not continuous verification.');
  }); });
  window.addEventListener('pagehide', () => { state.suspended = true; clearTimeout(state.timer); state.controller.abort(); clearCapture(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { state.suspended = false; invalidate(); void poll(); } });
  currentControls(); void poll();
})();
