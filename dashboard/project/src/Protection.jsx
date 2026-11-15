import React from 'react';
import './protection.css';

export default function Protection(){return (
 <section id="extra-protection" className="protection-settings" aria-labelledby="protection-title">
  <h3 id="protection-title">Extra protection</h3>
  <p id="protection-help" className="muted">Save a request for future runs. Only the exact reviewed factory workload can use scoped UI placement; arbitrary source and prior asset history are not covered.</p>
  <form id="protection-form" aria-describedby="protection-help">
   <label className="check" htmlFor="preload-request"><input id="preload-request" name="preload-request" type="checkbox" autoComplete="off" disabled />Request Preload protection</label>
   <dl className="facts"><div><dt>Runtime</dt><dd id="preload-runtime">Not loaded</dd></div></dl>
   <fieldset disabled><legend>Not available yet</legend><span>Memory · Virtual · Unlocker</span></fieldset>
   <div className="actions"><button type="submit" disabled>Save Preferences</button><button id="protection-reload" type="button" disabled>Reload Saved Choice</button></div>
  </form>
  <p id="protection-status" role="status" aria-live="polite">Unlock to load the saved choice.</p>
 </section>
);}
