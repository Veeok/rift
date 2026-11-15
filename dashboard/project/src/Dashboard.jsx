import React from 'react';
import {IconSprite,SeaWaves,AirlockScene} from './Scenery.jsx';
import Protection from './Protection.jsx';

export function CommandBar(){return (
<header className="commandbar">
    <div className="commandbar-inner">
      <div className="masthead">
        <span className="brand" translate="no">RIFT</span>
      </div>
      <nav aria-label="Inspection views" className="nav">
        <a href="#activity" data-view="activity"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-activity"/></svg>Activity</a>
        <a href="#source" data-view="source"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-code"/></svg>Source &amp; Widgets</a>
        <a href="#visuals" data-view="visuals"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-eye"/></svg>Visuals</a>
        <a href="#diagnostics" data-view="diagnostics"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-gauge"/></svg>Diagnostics</a>
      </nav>
      <label className="theme-switch"><input id="theme-toggle" name="theme" type="checkbox" role="switch" autoComplete="off" defaultChecked={typeof document!=='undefined'&&document.documentElement.dataset.theme==='light'} /><span className="theme-track" aria-hidden="true"><svg className="od-icon theme-moon" aria-hidden="true" focusable="false"><use href="#i-moon"/></svg><svg className="od-icon theme-sun" aria-hidden="true" focusable="false"><use href="#i-sun"/></svg></span><span className="sr-only">Light mode</span></label>
    </div>
  </header>
);}

export function Unlock(){return (
<section id="unlock" className="airlock" aria-labelledby="unlock-title" hidden>
    <AirlockScene />
    <div className="airlock-card panel">
      <p className="airlock-mark" translate="no" aria-hidden="true">RIFT</p>
      <h1 id="unlock-title">Unlock local inspection</h1>
      <form id="login-form">
        <label htmlFor="token">Local token</label>
        <div className="token-row">
          <span className="input-icon"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-key"/></svg><input id="token" name="token" type="password" required autoComplete="off" spellCheck="false" /></span>
          <button type="submit"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-unlock"/></svg>Unlock</button>
        </div>
      </form>
      <p className="airlock-hint">Use your local Rift token. It is sent only to this origin and is never saved by this page.</p>
      <p id="login-message" role="status"></p>
    </div>
  </section>
);}

export function Overview(){return (
<section className="overview panel" aria-labelledby="overview-title">
      <div className="overview-row">
        <div className="overview-id">
          <h1 id="overview-title">No current client</h1>
        </div>
        <div className="toolbar">
          <label htmlFor="session">Inspection session</label>
          <span id="health" className="badge">Connecting</span>
          <span className="select"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-layers"/></svg><select id="session"><option value="">Choose a session.</option></select></span>
          <span className="refresh-wrap"><button id="refresh" type="button" aria-describedby="refresh-note"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-refresh"/></svg>Refresh</button><span id="refresh-note" className="refresh-note">Updates automatically every 1.5 s</span></span>
          <span id="busy" role="status"></span>
        </div>
      </div>
      <p id="connection-note" role="status">Checking the local service.</p>
      <details className="disclosure">
        <summary><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-info"/></svg>Session details</summary>
        <dl id="identity" className="facts"></dl>
        <label className="adv-toggle"><input name="session-advanced" type="checkbox" autoComplete="off" /><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-more"/></svg>Advanced details</label>
        <details className="disclosure">
          <summary><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-terminal"/></svg>Reported capabilities · not independently verified</summary>
          <pre id="capabilities" translate="no">No current client</pre>
        </details>
      </details>
    </section>
);}

export function Activity(){return (
<section id="activity" className="view" aria-labelledby="activity-title">
      <div className="section-head">
        <div>
          <h2 id="activity-title">Activity</h2>
        </div>
        <div className="counts-wrap"><p id="counts">No current activity</p></div>
      </div>
      <p id="log-notice" className="warning" role="status"></p>
      <div className="split console">
        <section className="panel stream" aria-label="Recent events">
          <div className="pane-head">
            <div className="toolbar">
              <label htmlFor="severity">Show</label>
              <span className="select select-sm"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-filter"/></svg><select id="severity"><option value="all">All events</option><option value="error">Errors only</option></select></span>
              <button id="newest" type="button"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-newest"/></svg>Newest Event</button>
              <button id="latest-error" type="button"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-alert"/></svg>Latest Error</button>
            </div>
          </div>
          <div className="empty-state"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-inbox"/></svg><p id="log-empty" className="empty">Waiting for a current session.</p></div>
          <ol id="events" className="events" aria-label="Events, most recent first"></ol>
        </section>
        <section className="panel detail" aria-labelledby="event-title">
          <h3 id="event-title">Event detail</h3>
          <div className="empty-state empty-framed"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-pointer"/></svg><p id="event-placeholder" className="empty">Select an event to inspect its full evidence.</p></div>
          <pre id="event-message" className="slab" translate="no"></pre>
          <pre id="event-details" className="slab" translate="no"></pre>
          <details className="disclosure meta">
            <summary><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-tag"/></svg>Event metadata</summary>
            <dl id="event-facts" className="facts"></dl>
            <label className="adv-toggle"><input name="event-advanced" type="checkbox" autoComplete="off" /><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-more"/></svg>Advanced details</label>
          </details>
        </section>
      </div>
    </section>
);}

export function Source(){return (
<section id="source" className="view" aria-labelledby="source-title" hidden>
      <div className="section-head">
        <div>
          <h2 id="source-title">Source &amp; Widgets</h2>
          <p className="caveat">Connection heartbeat does not establish source or widget freshness.</p>
        </div>
        <fieldset className="switch">
          <legend className="sr-only">Search type</legend>
          <label><input type="radio" name="search-mode" value="source" autoComplete="off" defaultChecked /><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-code"/></svg>Source</label>
          <label><input type="radio" name="search-mode" value="widgets" autoComplete="off" /><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-box"/></svg>Widgets</label>
        </fieldset>
      </div>
      <section className="panel search-pane pane-source">
        <h3>Literal source search</h3>
        <form id="source-form">
          <div className="form-fields">
            <div className="field field-wide">
              <label htmlFor="query">Literal text</label>
              <span className="input-icon"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-search"/></svg><input id="query" name="query" required maxLength="2000" autoComplete="off" spellCheck="false" placeholder="e.g. RemoteEvent…" /></span>
            </div>
            <div className="field">
              <label htmlFor="path-filter">Path filter (optional)</label>
              <span className="input-icon"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-folder"/></svg><input id="path-filter" name="path-filter" autoComplete="off" spellCheck="false" placeholder="e.g. ServerScriptService/…" /></span>
            </div>
          </div>
          <div className="form-actions">
            <label className="check"><input id="case-sensitive" name="case-sensitive" type="checkbox" autoComplete="off" />Case sensitive</label>
            <button type="submit" data-current><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-search"/></svg>Search Source</button>
          </div>
        </form>
        <p id="source-notice" role="status"></p>
        <div className="result-grid">
          <div className="result-list">
            <ul id="source-results" className="results"></ul>
            <button id="source-more" type="button" hidden><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-more"/></svg>Load More Matches</button>
          </div>
          <div className="result-detail">
            <h4>Selected source</h4>
            <pre id="source-detail" className="slab" translate="no">No source selected.</pre>
          </div>
        </div>
      </section>
      <section className="panel search-pane pane-widgets">
        <h3>Widget / instance search</h3>
        <form id="widget-form">
          <div className="form-fields">
            <div className="field field-wide">
              <label htmlFor="widget-name">Instance name</label>
              <span className="input-icon"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-search"/></svg><input id="widget-name" name="widget-name" required autoComplete="off" spellCheck="false" placeholder="e.g. MainMenu…" /></span>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" data-current><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-box"/></svg>Find Instances</button>
          </div>
        </form>
        <p id="widget-notice" role="status"></p>
        <div className="result-grid">
          <div className="result-list">
            <ul id="widget-results" className="results"></ul>
          </div>
          <div className="result-detail">
            <h4>Properties, attributes &amp; tags</h4>
            <pre id="widget-detail" className="slab" translate="no">No instance selected.</pre>
          </div>
        </div>
      </section>
    </section>
);}

export function Visuals(){return (
<section id="visuals" className="view" aria-labelledby="visuals-title" hidden>
      <div className="section-head">
        <div>
          <h2 id="visuals-title">Visuals</h2>
        </div>
      </div>
      <p className="warning">Session match unverified; historical local preview. A window capture is not proof of the selected session's state.</p>
      <div className="split">
        <section className="panel">
          <h3>Choose a window</h3>
          <button id="windows-refresh" type="button"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-refresh"/></svg>Refresh Candidate Windows</button>
          <p id="windows-notice" role="status">Refresh to list available windows. No window is selected automatically.</p>
          <form id="capture-form">
            <label htmlFor="window">Capture target</label>
            <span className="select"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-window"/></svg><select id="window" required><option value="">Choose a window.</option></select></span>
            <details className="disclosure crop-toggle">
              <summary><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-crop"/></svg>Optional crop</summary>
              <fieldset>
                <legend>Optional crop · window-relative integer pixels</legend>
                <p>Leave all four fields empty for the whole window.</p>
                <div className="crop">
                  <label>X<input id="crop-x" name="crop-x" type="number" min="0" step="1" autoComplete="off" /></label>
                  <label>Y<input id="crop-y" name="crop-y" type="number" min="0" step="1" autoComplete="off" /></label>
                  <label>Width<input id="crop-width" name="crop-width" type="number" min="1" step="1" autoComplete="off" /></label>
                  <label>Height<input id="crop-height" name="crop-height" type="number" min="1" step="1" autoComplete="off" /></label>
                </div>
              </fieldset>
            </details>
            <button type="submit" data-current><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-camera"/></svg>Capture Local Preview</button>
          </form>
          <p id="capture-notice" role="status">Not captured. Nothing is shared.</p>
        </section>
        <section className="panel viewfinder">
          <h3>Historical local preview</h3>
          <div className="empty-state empty-framed viewfinder-empty"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-image"/></svg><p className="empty">No local preview captured yet.</p></div>
          <img id="capture-image" alt="Local window capture for manual review; session match is unverified" hidden />
          <pre id="capture-meta" translate="no"></pre>
          <button id="review-capture" type="button" hidden><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-check"/></svg>I Reviewed This Local Preview</button>
          <div id="share-panel" hidden>
            <p className="warning">Not shared yet. Sharing is MCP-only and requires your explicit confirmation. Review the window content for private information first.</p>
            <label htmlFor="share-request"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-share"/></svg>Copyable MCP request (select and copy)</label>
            <textarea id="share-request" readOnly rows="5" spellCheck="false"></textarea>
          </div>
        </section>
      </div>
    </section>
);}

export function Diagnostics(){return (
<section id="diagnostics" className="view panel" aria-labelledby="diagnostics-title" hidden>
      <h2 id="diagnostics-title">Diagnostics</h2>
      <button id="doctor" type="button"><svg className="od-icon" aria-hidden="true" focusable="false"><use href="#i-play"/></svg>Run Read-Only Diagnostics</button>
      <p id="doctor-notice" role="status">Diagnostics have not been requested.</p>
      <label className="check doctor-popup-setting" htmlFor="doctor-popup-setting"><input id="doctor-popup-setting" name="doctor-popup-setting" type="checkbox" role="switch" autoComplete="off" defaultChecked />Show a popup when diagnostics report an error</label>
      <pre id="doctor-result" className="slab" translate="no"></pre>
      <Protection />
    </section>
);}

export default function Dashboard(){return (<>
  <IconSprite />
  <SeaWaves />
  <a className="skip" href="#main">Skip to inspection</a>
  <CommandBar />
  <Unlock />
  <main id="main" tabIndex={-1}>
    <Overview />
    <p id="global-error" className="warning" role="alert" hidden />
    <Activity />
    <Source />
    <Visuals />
    <Diagnostics />
  </main>
  <label className="wave-pause" title="Pause background animation"><input id="wave-pause" name="waves-paused" type="checkbox" autoComplete="off" defaultChecked={typeof document!=='undefined'&&document.documentElement.dataset.waves==='paused'} /><span className="wave-pause-icon" aria-hidden="true" /><span className="sr-only">Pause background animation</span></label>
</>);}
