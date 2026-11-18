import React from 'react';
import './explorer.css';

export default function Explorer(){return (
 <section id="explorer" className="view explorer-view" aria-labelledby="explorer-title" hidden>
  <div className="section-head"><div><h2 id="explorer-title">Explorer</h2><p className="caveat">Current client hierarchy and typed properties. Changes are local to this client, not server authority.</p></div><span id="explorer-mode" className="badge">No client</span></div>
  <div className="explorer-workspace">
   <section className="panel explorer-hierarchy" aria-labelledby="explorer-tree-title">
    <div className="explorer-pane-head"><h3 id="explorer-tree-title">Hierarchy</h3><button id="explorer-refresh" type="button">Refresh tree</button></div>
    <form id="explorer-search" className="explorer-search"><label className="sr-only" htmlFor="explorer-query">Search instance names</label><input id="explorer-query" name="explorer-query" placeholder="Search names…" autoComplete="off" /><label className="sr-only" htmlFor="explorer-class">Class filter</label><input id="explorer-class" name="explorer-class" placeholder="Class (optional)" autoComplete="off" /><button type="submit">Find</button><button id="explorer-clear-search" type="button" hidden>Clear</button></form>
    <p id="explorer-tree-notice" className="explorer-notice" role="status">Connect a matching reader, then open the explorer.</p>
    <div id="explorer-tree-scroll" className="explorer-tree-scroll"><div id="explorer-tree" role="tree" aria-label="Client hierarchy" tabIndex={0}></div></div>
    <button id="explorer-root-more" type="button" hidden>Load more roots</button>
    <div className="explorer-footer"><span id="explorer-cache-count">0 instances loaded</span><span>Lazy loading · no full-game snapshot</span></div>
   </section>
   <section className="panel explorer-inspector" aria-labelledby="explorer-selection">
    <div className="explorer-pane-head"><div><h3 id="explorer-selection">No selection</h3><p id="explorer-breadcrumb" className="explorer-path" translate="no"></p></div><button id="explorer-property-refresh" type="button" disabled>Refresh values</button></div>
    <div className="explorer-inspector-tools"><label className="sr-only" htmlFor="explorer-property-filter">Filter properties</label><input id="explorer-property-filter" name="property-filter" autoComplete="off" placeholder="Filter properties…" /><button id="explorer-copy-reference" type="button" disabled>Copy reference</button><button id="explorer-copy-path" type="button" disabled>Copy path</button><button id="explorer-source" type="button" hidden>Read source</button></div>
    <p id="explorer-property-notice" className="explorer-notice" role="status">Values are explicit observations, not continuously live.</p>
    <div id="explorer-properties" className="explorer-properties"><p className="empty">Select an instance to inspect its properties.</p></div>
    <div id="explorer-attributes" className="explorer-properties"></div>
    <form id="explorer-add-attribute" className="explorer-attribute-add" hidden><label htmlFor="explorer-attribute-name">New attribute</label><input id="explorer-attribute-name" name="attribute-name" autoComplete="off" placeholder="Name" maxLength={100} required /><label className="sr-only" htmlFor="explorer-attribute-type">Attribute type</label><select id="explorer-attribute-type" name="attribute-type"><option value="string">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="Color3">Color3</option><option value="Vector2">Vector2</option><option value="Vector3">Vector3</option></select><label className="sr-only" htmlFor="explorer-attribute-value">Attribute value</label><input id="explorer-attribute-value" name="attribute-value" autoComplete="off" placeholder="Value or numeric array" /><button type="submit">Review addition</button></form>
    <div id="explorer-tags" className="explorer-tags"></div>
    <details className="explorer-raw"><summary>Structured evidence for AI</summary><p className="muted">Use explorer_read for compact observations; explorer_write applies one confirmed typed edit with an expected value.</p><pre id="explorer-reference" className="slab" translate="no"></pre></details>
    <p id="explorer-edit-notice" className="explorer-edit-notice" role="status"></p>
   </section>
  </div>
  <dialog id="explorer-confirm" className="explorer-confirm" aria-labelledby="explorer-confirm-title">
   <form id="explorer-confirm-form"><h3 id="explorer-confirm-title">Review one client edit</h3><p id="explorer-confirm-target"></p><pre id="explorer-confirm-values" className="slab" translate="no"></pre><p className="muted">The reader rechecks the old value before applying. Other scripts may change it again. This does not change server-owned state.</p><label className="check"><input id="explorer-confirm-check" name="confirm-edit" type="checkbox" autoComplete="off" />Apply this exact change to the selected client instance</label><div className="explorer-confirm-actions"><button id="explorer-cancel" type="button">Cancel</button><button id="explorer-apply" type="submit" disabled>Apply edit</button></div></form>
  </dialog>
 </section>
);}
