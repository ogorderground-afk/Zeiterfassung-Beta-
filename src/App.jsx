import { useState, useEffect, useRef } from "react";

const ARV_WORK  = [{h:5.5,label:"15 Min. Pause"},{h:7,label:"30 Min. Pause"},{h:9,label:"1 Std. Pause"}];
const ARV_DRIVE = [{h:4.5,label:"45 Min. Pflichtpause"},{h:9,label:"Tageslimit Lenkzeit"}];

function pad(n){return String(n).padStart(2,"0");}
function fmtMs(ms){const s=Math.floor(Math.max(0,ms)/1000);return`${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`;}
function fmtTime(ts){return new Date(ts).toLocaleTimeString("de-CH",{hour:"2-digit",minute:"2-digit"});}
function fmtDate(ts){return new Date(ts).toLocaleDateString("de-CH");}
function toH(ms){return ms/3600000;}
function calcNet(s,now){if(!s)return 0;const pm=s.pauses.reduce((a,p)=>a+((p.end||now)-p.start),0);return Math.max(0,(s.end||now)-s.start-pm);}
function calcPMs(s,now){if(!s)return 0;return s.pauses.reduce((a,p)=>a+((p.end||now)-p.start),0);}

const isPWA=()=>window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;

export default function App(){
  const [dark,setDark]=useState(true);
  const [transparent,setTransparent]=useState(false);
  const [view,setView]=useState("tracker");
  const [gpsInterval,setGpsInterval]=useState(10);

  const [taetigkeitModal,setTaetigkeitModal]=useState(false);
  const [taetigkeitInput,setTaetigkeitInput]=useState("");

  const [work,setWork]=useState(null);
  const [drive,setDrive]=useState(null);
  const [workSessions,setWorkSessions]=useState([]);
  const [driveSessions,setDriveSessions]=useState([]);
  const [rules,setRules]=useState([]);
  const [newRuleText,setNewRuleText]=useState("");

  const [confirmStop,setConfirmStop]=useState(false);
  const [ratingModal,setRatingModal]=useState(false);
  const [dayStars,setDayStars]=useState(0);

  const [notes,setNotes]=useState([]);
  const [showInlineNote,setShowInlineNote]=useState(false);
  const [inlineNoteText,setInlineNoteText]=useState("");

  const [now,setNow]=useState(Date.now());
  const tickRef=useRef(null);

  const [exportModal,setExportModal]=useState(false);
  const [deleteModal,setDeleteModal]=useState(false);
  const [deleteConfirm,setDeleteConfirm]=useState(false);
  const [ruleDialogOpen,setRuleDialogOpen]=useState(false);
  const [ruleManagerOpen,setRuleManagerOpen]=useState(false);
  const [drivepauseModal,setDrivepauseModal]=useState(false);

  const pwaActive=isPWA();

  // ONLY localStorage - NO IndexedDB
  useEffect(()=>{
    try{
      const w=localStorage.getItem("work");
      if(w) setWork(JSON.parse(w));
      
      const d=localStorage.getItem("drive");
      if(d) setDrive(JSON.parse(d));
      
      const ws=localStorage.getItem("workSessions");
      if(ws) setWorkSessions(JSON.parse(ws));
      
      const ds=localStorage.getItem("driveSessions");
      if(ds) setDriveSessions(JSON.parse(ds));
      
      const n=localStorage.getItem("notes");
      if(n) setNotes(JSON.parse(n));
      
      const r=localStorage.getItem("rules");
      if(r) setRules(JSON.parse(r));
    }catch(e){
      console.error("Load error:",e);
    }
  },[]);

  useEffect(()=>{
    try{
      if(work) localStorage.setItem("work",JSON.stringify(work));
      else localStorage.removeItem("work");
    }catch(e){}
  },[work]);

  useEffect(()=>{
    try{
      if(drive) localStorage.setItem("drive",JSON.stringify(drive));
      else localStorage.removeItem("drive");
    }catch(e){}
  },[drive]);

  useEffect(()=>{
    try{
      localStorage.setItem("workSessions",JSON.stringify(workSessions));
    }catch(e){}
  },[workSessions]);

  useEffect(()=>{
    try{
      localStorage.setItem("driveSessions",JSON.stringify(driveSessions));
    }catch(e){}
  },[driveSessions]);

  useEffect(()=>{
    try{
      localStorage.setItem("notes",JSON.stringify(notes));
    }catch(e){}
  },[notes]);

  useEffect(()=>{
    try{
      localStorage.setItem("rules",JSON.stringify(rules));
    }catch(e){}
  },[rules]);

  useEffect(()=>{
    const active=(work&&!work.paused)||(drive&&!drive.paused);
    if(active){
      tickRef.current=setInterval(()=>setNow(Date.now()),1000);
    }else{
      if(tickRef.current) clearInterval(tickRef.current);
    }
    return()=>{if(tickRef.current) clearInterval(tickRef.current);};
  },[work?.paused,drive?.paused]);

  const wNet=calcNet(work,now),wPMs=calcPMs(work,now);
  const dNet=calcNet(drive,now),dPMs=calcPMs(drive,now);
  const wH=toH(wNet),dH=toH(dNet);

  const wWarn=ARV_WORK.filter(r=>wH>=r.h-0.25&&wH<r.h);
  const wOver=ARV_WORK.filter(r=>wH>=r.h);
  const dWarn=ARV_DRIVE.filter(r=>dH>=r.h-0.25&&dH<r.h);
  const dOver=ARV_DRIVE.filter(r=>dH>=r.h);

  const wCol=wH>=9?"#ef4444":wH>=7?"#f97316":wH>=5.5?"#eab308":"#22c55e";
  const dCol=dH>=4.5?"#ef4444":dH>=4.25?"#f97316":"#3b82f6";

  const startWork=()=>{
    const ta=taetigkeitInput.trim()||"—";
    setWork({start:Date.now(),pauses:[],paused:false,taetigkeit:ta});
    setTaetigkeitModal(false);
    setTaetigkeitInput("");
  };

  const handleWorkPause=()=>{
    const ts=Date.now();
    setWork(w=>{
      if(!w.paused) return{...w,paused:true,pauses:[...w.pauses,{start:ts}]};
      return{...w,paused:false,pauses:w.pauses.map((p,i)=>i===w.pauses.length-1?{...p,end:ts}:p)};
    });
  };

  const handleDrivePause=()=>{
    const ts=Date.now();
    if(!drive.paused){
      setDrivepauseModal(true);
    }else{
      const pauseWork=drive.workAlsoPaused||false;
      setDrive(d=>({...d,paused:false,pauses:d.pauses.map((p,i)=>i===d.pauses.length-1?{...p,end:ts}:p)}));
      if(pauseWork){
        setWork(w=>({...w,paused:false,pauses:w.pauses.map((p,i)=>i===w.pauses.length-1?{...p,end:ts}:p)}));
      }
    }
  };

  const confirmDrivePause=(pauseWork)=>{
    const ts=Date.now();
    setDrive(d=>({...d,paused:true,pauses:[...d.pauses,{start:ts}],workAlsoPaused:pauseWork}));
    if(pauseWork){
      setWork(w=>({...w,paused:true,pauses:[...w.pauses,{start:ts}]}));
    }
    setDrivepauseModal(false);
  };

  const stopDrive=()=>{
    const ts=Date.now();
    let d=drive;
    if(d.paused){
      d={...d,paused:false,pauses:d.pauses.map((p,i)=>i===d.pauses.length-1?{...p,end:ts}:p)};
    }
    const net=calcNet({...d,end:ts},ts);
    setDriveSessions(p=>[...p,{...d,end:ts,netMs:net,location:null}]);
    setDrive(null);
  };

  const finalizeStop=(stars)=>{
    const ts=Date.now();
    if(drive){
      let d=drive;
      if(d.paused)d={...d,paused:false,pauses:d.pauses.map((p,i)=>i===d.pauses.length-1?{...p,end:ts}:p)};
      setDriveSessions(p=>[...p,{...d,end:ts,netMs:calcNet({...d,end:ts},ts),location:null}]);
      setDrive(null);
    }
    let w=work;
    if(w.paused)w={...w,paused:false,pauses:w.pauses.map((p,i)=>i===w.pauses.length-1?{...p,end:ts}:p)};
    setWorkSessions(p=>[...p,{...w,end:ts,netMs:calcNet({...w,end:ts},ts),location:null,stars}]);
    setWork(null);
    setRatingModal(false);
    setDayStars(0);
  };

  const saveInlineNote=()=>{
    if(!inlineNoteText.trim())return;
    setNotes(n=>[...n,{id:Date.now(),text:inlineNoteText.trim(),ts:Date.now()}]);
    setInlineNoteText("");
    setShowInlineNote(false);
  };

  const getThemeColors=()=>{
    if(transparent&&dark) return{bg:"rgba(15,17,23,0.7)",card:"rgba(26,29,39,0.5)",s2:"rgba(35,38,58,0.4)",border:"rgba(45,49,72,0.3)",text:"#e2e8f0",muted:"#94a3b8",hint:"#475569"};
    if(transparent) return{bg:"rgba(244,245,247,0.7)",card:"rgba(255,255,255,0.6)",s2:"rgba(241,242,246,0.5)",border:"rgba(226,228,237,0.4)",text:"#0f172a",muted:"#475569",hint:"#94a3b8"};
    if(dark) return{bg:"#0f1117",card:"#1a1d27",s2:"#23263a",border:"#2d314840",text:"#e2e8f0",muted:"#94a3b8",hint:"#475569"};
    return{bg:"#f4f5f7",card:"#ffffff",s2:"#f1f2f6",border:"#e2e4ed",text:"#0f172a",muted:"#475569",hint:"#94a3b8"};
  };

  const t=getThemeColors();
  const C=(bc)=>({background:t.card,borderRadius:14,border:`1px solid ${bc||t.border}`,padding:"18px 20px",marginBottom:12});
  const Btn=(bg,col)=>({padding:"10px",borderRadius:8,border:"none",background:bg,color:col,fontSize:13,fontWeight:500,cursor:"pointer",flex:1});

  return(
    <div style={{fontFamily:"system-ui,-apple-system,sans-serif",background:t.bg,minHeight:"100vh",color:t.text}}>
      <style>{`@keyframes dp{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(1.5)}}.dp{animation:dp 2s infinite}body{margin:0;padding:0}`}</style>

      {!pwaActive&&<div style={{position:"fixed",top:0,left:0,right:0,background:"#ef4444",color:"white",padding:"16px",fontSize:"16px",fontWeight:"600",textAlign:"center",zIndex:9999}}>🚨 BROWSER: Installiere die App zuerst!</div>}

      <nav style={{background:t.card,borderBottom:`0.5px solid ${t.border}`,padding:"11px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:pwaActive?0:"50px"}}>
        <div style={{fontWeight:600,fontSize:15}}>⏱ ZeitTracker</div>
        <div style={{display:"flex",gap:4}}>
          {[["tracker","Tracker"],["notizen","Notizen"],["dashboard","Dashboard"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{padding:"5px 13px",borderRadius:8,border:view===v?"none":`0.5px solid ${t.border}`,background:view===v?"#6366f1":"transparent",color:view===v?"white":t.muted,fontSize:12,cursor:"pointer"}}>{l}</button>
          ))}
        </div>
      </nav>

      <div style={{padding:"18px 18px 90px",maxWidth:660,margin:"0 auto"}}>
        {view==="tracker"&&(
          <>
            <div style={C(work?wCol+"50":t.border)}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:work?14:0}}>
                <span style={{fontSize:11,fontWeight:500,color:t.hint}}>ARBEITSZEIT{work&&work.taetigkeit?` · ${work.taetigkeit}`:""}</span>
              </div>
              {work?(
                <>
                  <div style={{textAlign:"center",padding:"6px 0 14px"}}>
                    <div style={{fontSize:58,fontWeight:400,color:wCol}}>{fmtMs(wNet)}</div>
                    {wPMs>0&&<div style={{fontSize:12,color:t.hint,marginTop:5}}>Pausen {fmtMs(wPMs)}</div>}
                  </div>
                  {wOver.map(r=><div key={r.h} style={{background:"#ef444414",border:"0.5px solid #ef444450",borderRadius:8,padding:"7px 12px",fontSize:12,color:"#ef4444",marginBottom:6}}>⚠ {r.label}</div>)}
                  {wWarn.map(r=><div key={r.h} style={{background:"#f9731612",border:"0.5px solid #f9731640",borderRadius:8,padding:"7px 12px",fontSize:12,color:"#f97316",marginBottom:6}}>⏰ {r.label}</div>)}
                  <div style={{display:"flex",gap:8}}>
                    {!drive&&<button onClick={handleWorkPause} style={Btn(t.s2,t.text)}>{work.paused?"▶":"⏸"}</button>}
                    <button onClick={()=>setConfirmStop(true)} style={Btn("#ef4444","white")}>⏹ Stop</button>
                  </div>
                </>
              ):(
                <button onClick={()=>{if(pwaActive){setTaetigkeitModal(true);}}} disabled={!pwaActive} style={{width:"100%",padding:"13px",background:pwaActive?"#6366f1":"#6366f140",border:"none",borderRadius:10,color:"white",fontSize:15,fontWeight:500,cursor:pwaActive?"pointer":"not-allowed"}}>▶ Start</button>
              )}
            </div>

            {work&&(
              <div style={C(drive?dCol+"50":t.border)}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
                  <span style={{fontSize:11,fontWeight:500,color:t.hint}}>LENKZEIT</span>
                </div>
                {!drive?(
                  <button onClick={()=>{if(pwaActive)setRuleDialogOpen(true);}} disabled={!pwaActive||work.paused} style={{width:"100%",padding:"11px",background:pwaActive&&!work.paused?"#3b82f6":"#3b82f640",border:"none",borderRadius:8,color:"white",fontSize:13,cursor:pwaActive&&!work.paused?"pointer":"not-allowed"}}>🚗 Fahrt</button>
                ):(
                  <>
                    <div style={{textAlign:"center",padding:"6px 0 14px"}}>
                      <div style={{fontSize:58,fontWeight:400,color:dCol}}>{fmtMs(dNet)}</div>
                      {dPMs>0&&<div style={{fontSize:12,color:t.hint,marginTop:5}}>Pausen {fmtMs(dPMs)}</div>}
                    </div>
                    {dOver.map(r=><div key={r.h} style={{background:"#ef444414",border:"0.5px solid #ef444450",borderRadius:8,padding:"7px 12px",fontSize:12,color:"#ef4444",marginBottom:6}}>⚠ {r.label}</div>)}
                    {dWarn.map(r=><div key={r.h} style={{background:"#f9731612",border:"0.5px solid #f9731640",borderRadius:8,padding:"7px 12px",fontSize:12,color:"#f97316",marginBottom:6}}>⏰ {r.label}</div>)}
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={handleDrivePause} style={Btn(t.s2,t.text)}>{drive.paused?"▶":"⏸"}</button>
                      <button onClick={stopDrive} style={Btn("#ef4444","white")}>Ende</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {work&&(
              !showInlineNote?(
                <button onClick={()=>setShowInlineNote(true)} style={{width:"100%",padding:"10px",background:"transparent",border:`0.5px solid ${t.border}`,borderRadius:10,color:t.hint,fontSize:13,cursor:"pointer"}}>✏ Notiz</button>
              ):(
                <div style={C()}>
                  <textarea autoFocus value={inlineNoteText} onChange={e=>setInlineNoteText(e.target.value)} placeholder="Notiz..." style={{width:"100%",minHeight:72,background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,padding:"9px 12px",color:t.text,fontSize:14,resize:"none",boxSizing:"border-box",marginBottom:8}}/>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{setShowInlineNote(false);setInlineNoteText("");}} style={Btn(t.s2,t.muted)}>Cancel</button>
                    <button onClick={saveInlineNote} style={Btn("#6366f1","white")}>Save</button>
                  </div>
                </div>
              )
            )}
          </>
        )}

        {view==="notizen"&&(
          <>
            <div style={{fontWeight:500,marginBottom:14,fontSize:15}}>Notizen ({notes.length})</div>
            {notes.length===0?(
              <div style={{textAlign:"center",padding:"50px 0",color:t.hint}}>Keine Notizen</div>
            ):[...notes].reverse().map(n=>(
              <div key={n.id} style={C()}>
                <div style={{fontSize:14,marginBottom:8}}>{n.text}</div>
                <div style={{fontSize:11,color:t.hint,display:"flex",justifyContent:"space-between"}}>
                  <span>{fmtDate(n.ts)} {fmtTime(n.ts)}</span>
                  <button onClick={()=>setNotes(ns=>ns.filter(x=>x.id!==n.id))} style={{border:"none",background:"none",color:"#ef4444",cursor:"pointer"}}>✕</button>
                </div>
              </div>
            ))}
          </>
        )}

        {view==="dashboard"&&(
          <>
            <div style={{fontWeight:500,marginBottom:12}}>Dashboard</div>
            <div style={C()}>
              <div style={{display:"flex",gap:8,marginBottom:12}}>
                <button onClick={()=>setExportModal(true)} style={{padding:"6px 12px",borderRadius:7,border:`0.5px solid ${t.border}`,background:"transparent",color:t.muted,fontSize:12,cursor:"pointer"}}>↓ CSV Export</button>
                <button onClick={()=>setDeleteModal(true)} style={{padding:"6px 12px",borderRadius:7,border:"0.5px solid #ef444440",background:"transparent",color:"#ef4444",fontSize:12,cursor:"pointer"}}>🗑 Delete All</button>
              </div>
              {workSessions.length===0?(
                <div style={{textAlign:"center",color:t.hint,padding:"30px"}}>Keine Einträge</div>
              ):workSessions.slice(-15).reverse().map((s,i)=>(
                <div key={i} style={{padding:"10px 0",borderBottom:`0.5px solid ${t.border}`,fontSize:12}}>
                  <div style={{color:t.text}}>📋 {fmtDate(s.start)} {fmtTime(s.start)}–{fmtTime(s.end)} ({toH(s.netMs).toFixed(2)}h) {s.taetigkeit}</div>
                  {s.stars&&<div style={{color:t.hint}}>★{s.stars}</div>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {taetigkeitModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto"}}>
            <div style={{fontWeight:500,marginBottom:16}}>Tätigkeit?</div>
            <input autoFocus value={taetigkeitInput} onChange={e=>setTaetigkeitInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")startWork();}} placeholder="z.B. Fahrer, Lager..." style={{width:"100%",padding:"12px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:9,color:t.text,marginBottom:12,boxSizing:"border-box"}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setTaetigkeitModal(false)} style={Btn(t.s2,t.muted)}>Cancel</button>
              <button onClick={startWork} style={Btn("#6366f1","white")}>Start</button>
            </div>
          </div>
        </div>
      )}

      {ruleDialogOpen&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto"}}>
            <div style={{fontWeight:500,marginBottom:16}}>Regel</div>
            <button onClick={()=>{setRuleDialogOpen(false);setDrive({start:Date.now(),pauses:[],paused:false});}} style={{width:"100%",padding:"12px",borderRadius:8,background:"#6366f114",border:"2px solid #6366f1",color:t.text,fontSize:13,cursor:"pointer"}}>Ohne Regel</button>
            <button onClick={()=>setRuleDialogOpen(false)} style={{width:"100%",marginTop:8,padding:"10px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      )}

      {drivepauseModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto"}}>
            <div style={{fontWeight:500,marginBottom:16}}>Arbeitszeit auch pausieren?</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>confirmDrivePause(false)} style={Btn(t.s2,t.muted)}>Nur Fahrt</button>
              <button onClick={()=>confirmDrivePause(true)} style={Btn("#6366f1","white")}>Beide</button>
            </div>
          </div>
        </div>
      )}

      {exportModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto"}}>
            <div style={{fontWeight:500,marginBottom:16}}>CSV exportieren?</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setExportModal(false)} style={Btn(t.s2,t.muted)}>Cancel</button>
              <button onClick={()=>setExportModal(false)} style={Btn("#6366f1","white")}>✓ Export</button>
            </div>
          </div>
        </div>
      )}

      {deleteModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto"}}>
            {!deleteConfirm?(
              <>
                <div style={{fontWeight:500,marginBottom:16}}>⚠️ Alle Daten löschen?</div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setDeleteModal(false)} style={Btn(t.s2,t.muted)}>Cancel</button>
                  <button onClick={()=>setDeleteConfirm(true)} style={Btn("#ef4444","white")}>Weiter</button>
                </div>
              </>
            ):(
              <>
                <div style={{fontWeight:500,marginBottom:16}}>BESTÄTIGUNG</div>
                <div style={{fontSize:13,color:"#ef4444",marginBottom:16}}>Alle Daten werden gelöscht!</div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setDeleteConfirm(false)} style={Btn(t.s2,t.muted)}>Zurück</button>
                  <button onClick={()=>{setWorkSessions([]);setDriveSessions([]);setNotes([]);setDeleteModal(false);}} style={Btn("#ef4444","white")}>✓ Löschen</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {confirmStop&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto"}}>
            <div style={{fontWeight:500,marginBottom:16}}>Schicht beenden?</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setConfirmStop(false)} style={Btn(t.s2,t.muted)}>Nein</button>
              <button onClick={()=>{setConfirmStop(false);setRatingModal(true);}} style={Btn("#6366f1","white")}>Ja</button>
            </div>
          </div>
        </div>
      )}

      {ratingModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto"}}>
            <div style={{fontWeight:500,marginBottom:16}}>Wie war dein Tag?</div>
            <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:18}}>
              {[1,2,3,4,5].map(s=>(
                <button key={s} onClick={()=>setDayStars(s)} style={{background:"none",border:`2px solid ${s<=dayStars?"#6366f1":t.border}`,borderRadius:8,fontSize:32,cursor:"pointer",opacity:s<=dayStars?1:0.3,padding:"8px"}}>★</button>
              ))}
            </div>
            <button onClick={()=>finalizeStop(dayStars)} style={{width:"100%",padding:"12px",background:"#6366f1",border:"none",borderRadius:9,color:"white",fontWeight:500,cursor:"pointer"}}>Abschließen</button>
          </div>
        </div>
      )}

      <div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",zIndex:100,display:"flex",gap:8}}>
        <button onClick={()=>setDark(d=>!d)} style={{padding:"8px 18px",borderRadius:99,background:t.card,border:`0.5px solid ${t.border}`,color:t.muted,cursor:"pointer"}}>☀/🌙</button>
        <button onClick={()=>setTransparent(tr=>!tr)} style={{padding:"8px 18px",borderRadius:99,background:t.card,border:`0.5px solid ${t.border}`,color:t.muted,cursor:"pointer"}}>🔷</button>
      </div>
    </div>
  );
}
