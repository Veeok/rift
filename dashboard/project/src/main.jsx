import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import Dashboard from './Dashboard.jsx';
import {startDashboard} from './controller.js';
import {createPreviewTransport} from './preview-runtime.js';
import '../style.css';
import './preview.css';

function App(){
 useEffect(()=>{
  try{return startDashboard({fetchImpl:import.meta.env.MODE==='preview'?createPreviewTransport({origin:location.origin}):globalThis.fetch});}
  catch(error){
   const notice=document.getElementById('global-error');
   if(notice){notice.textContent='Dashboard startup failed. Refresh the page and inspect the browser console.';notice.hidden=false;}
   console.error('Dashboard startup failed:',error);
  }
 },[]);
 return <><Dashboard />{import.meta.env.MODE==='preview'&&<aside role="status" className="synthetic-preview-marker">Synthetic preview — no live Rift requests. Dummy token: preview-only.</aside>}</>;
}
createRoot(document.getElementById('root')).render(<App />);
