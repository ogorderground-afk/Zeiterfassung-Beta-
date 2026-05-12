import { useState, useEffect, useRef, useCallback } from "react";
import { checkStorageAndWarn, logPageLoad, logCSVExport, rateLimiter } from "./utils/rateLimiter";

const GPS_INTERVAL = 10 * 60 * 1000;
const ARV_WORK  = [{h:5.5,label:"15 Min. Pause"},{h:7,label:"30 Min. Pause"},{h:9,label:"1 Std. Pause"}];
const ARV_DRIVE = [{h:4.5,label:"45 Min. Pflichtpause (ARV 1)"},{h:9,label:"Tageslimit Lenkzeit"}];

function pad(n){return String(n).padStart(2,"0");}
function fmtMs(ms){const s=Math.floor(Math.max(0,ms)/1000);return`${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`;}
function fmtTime(ts){return new Date(ts).toLocaleTimeString("de-CH",{hour:"2-digit",minute:"2-digit"});}
function fmtDate(ts){return new Date(ts).toLocaleDateString("de-CH");}
function fmtFull(ts){return new Date(ts).toLocaleString("de-CH",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});}
function toH(ms){return ms/3600000;}
function calcNet(s,now){if(!s)return 0;const pm=s.pauses.reduce((a,p)=>a+((p.end||now)-p.start),0);return Math.max(0,(s.end||now)-s.start-pm);}
function calcPMs(s,now){if(!s)return 0;return s.pauses.reduce((a,p)=>a+((p.end||now)-p.start),0);}

function getPos(){
  return new Promise((res,rej)=>{
    if(!navigator.geolocation){rej(new Error("Geolocation nicht verfügbar"));return;}
    navigator.geolocation.getCurrentPosition(
      p=>res({lat:p.coords.latitude,lng:p.coords.longitude,acc:Math.round(p.coords.accuracy)}),
      err=>{
        console.warn("GPS-Fehler:",err.message);
        rej(err);
      },
      {timeout:10000,enableHighAccuracy:false}
    );
  });
}

function locStr(l){if(!l)return"—";if(typeof l==="string")return l;return`${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`;}

// localStorage Funktionen mit Validierung
const saveToStorage=(key,data)=>{
  try {
    localStorage.setItem(key,JSON.stringify(data));
  } catch(e) {
    if(e.name==="QuotaExceededError"){
      console.error("localStorage voll! Alte Sessions werden gelöscht...");
      rateLimiter.autoCleanupOldSessions();
      localStorage.setItem(key,JSON.stringify(data));
    }else{
      console.error("localStorage Fehler:",e);
    }
  }
};

const loadFromStorage=(key,def=null)=>{
  try{
    const v=localStorage.getItem(key);
    return v?JSON.parse(v):def;
  }catch(e){
    console.error("localStorage Parse-Fehler bei",key,e);
    return def;
  }
};

export default function App(){
  const [dark,setDark]=useState(true);
  const [view,setView]=useState("tracker");
  const [storageWarning,setStorageWarning]=useState(null);

  const [taetigkeitModal,setTaetigkeitModal]=useState(false);
  const [taetigkeitInput,setTaetigkeitInput]=useState("");

  const [work,setWork]=useState(null);
  const [drive,setDrive]=useState(null);
  const [workSessions,setWorkSessions]=useState([]);
  const [driveSessions,setDriveSessions]=useState([]);

  const [confirmStop,setConfirmStop]=useState(false);
  const [ratingModal,setRatingModal]=useState(false);
  const [dayStars,setDayStars]=useState(0);
  const [dayComment,setDayComment]=useState("");

  const [notes,setNotes]=useState([]);
  const [editNoteId,setEditNoteId]=useState(null);
  const [editNoteText,setEditNoteText]=useState("");
  const [showInlineNote,setShowInlineNote]=useState(false);
  const [inlineNoteText,setInlineNoteText]=useState("");

  const [actionLog,setActionLog]=useState([]);
  const [curLoc,setCurLoc]=useState(null);
  const [gpsLog,setGpsLog]=useState([]);
  const [showWorkDot,setShowWorkDot]=useState(true);
  const [showDriveDot,setShowDriveDot]=useState(true);
  const [now,setNow]=useState(Date.now());
  const tickRef=useRef(null);
  const gpsRef=useRef(null);

  const [exportModal,setExportModal]=useState(false);
  const [exportFromDate,setExportFromDate]=useState("");
  const [exportToDate,setExportToDate]=useState("");

  const [deleteModal,setDeleteModal]=useState(false);
  const [deleteConfirm,setDeleteConfirm]=useState(false);
  const [deleteFromDate,setDeleteFromDate]=useState("");
  const [deleteToDate,setDeleteToDate]=useState("");
  const [deleteAll,setDeleteAll]=useState(false);

  // 🚀 WICHTIG: Beim Komponenten-Mount: Daten laden + Rate-Limit checken
  useEffect(()=>{
    // Rate-Limit logging
    const limitCheck=logPageLoad();
    if(limitCheck.blocked){
      setStorageWarning("❌ Zu viele Anfragen. Service wird momentan begrenzt.");
      return;
    }

    // Storage-Quota prüfen
    const quota=checkStorageAndWarn();
    if(quota.warning){
      setStorageWarning(quota.warning);
    }

    // Daten aus localStorage laden
    const w=loadFromStorage("work");
    const d=loadFromStorage("drive");
    const ws=loadFromStorage("workSessions",[]);
    const ds=loadFromStorage("driveSessions",[]);
    const n=loadFromStorage("notes",[]);
    const al=loadFromStorage("actionLog",[]);
    const gl=loadFromStorage("gpsLog",[]);

    if(w){
      w._lastSave=Date.now();
      setWork(w);
    }
    if(d){
      d._lastSave=Date.now();
      setDrive(d);
    }
    setWorkSessions(ws);
    setDriveSessions(ds);
    setNotes(n);
    setActionLog(al);
    setGpsLog(gl);

    setNow(Date.now());

    // Service Worker registrieren
    if("serviceWorker" in navigator){
      navigator.serviceWorker.register("/sw.js").catch(err=>console.log("SW registration failed:",err));
    }
  },[]);

  // Alle States in localStorage speichern wenn sich was ändert
  useEffect(()=>{
    if(work){
      const toSave={...work,_lastSave:Date.now()};
      saveToStorage("work",toSave);
    }else{
      localStorage.removeItem("work");
    }
  },[work]);

  useEffect(()=>{
    if(drive){
      const toSave={...drive,_lastSave:Date.now()};
      saveToStorage("drive",toSave);
    }else{
      localStorage.removeItem("drive");
    }
  },[drive]);

  useEffect(()=>saveToStorage("workSessions",workSessions),[workSessions]);
  useEffect(()=>saveToStorage("driveSessions",driveSessions),[driveSessions]);
  useEffect(()=>saveToStorage("notes",notes),[notes]);
  useEffect(()=>saveToStorage("actionLog",actionLog),[actionLog]);
  useEffect(()=>saveToStorage("gpsLog",gpsLog),[gpsLog]);

  const logA=useCallback((action,detail="",loc=null)=>{
    setActionLog(p=>[...p,{ts:Date.now(),action,detail,loc}]);
  },[]);

  useEffect(()=>{
    const active=(work&&!work.paused)||(drive&&!drive.paused);
    if(active){tickRef.current=setInterval(()=>setNow(Date.now()),1000);}
    else{clearInterval(tickRef.current);}
    return()=>clearInterval(tickRef.current);
  },[!!work,work?.paused,!!drive,drive?.paused]);

  const logGps=useCallback(async()=>{
    try{
      const p=await getPos();
      setCurLoc(p);
      setGpsLog(g=>[...g,{ts:Date.now(),...p}]);
      logA("GPS","",p);
    }catch(err){
      console.log("GPS-Fehler:",err.message);
    }
  },[logA]);

  useEffect(()=>{
    if(!work){clearInterval(gpsRef.current);return;}
    logGps();
    gpsRef.current=setInterval(logGps,GPS_INTERVAL);
    return()=>clearInterval(gpsRef.current);
  },[!!work,logGps]);

  const wNet=calcNet(work,now),wPMs=calcPMs(work,now);
  const dNet=calcNet(drive,now),dPMs=calcPMs(drive,now);
  const wH=toH(wNet),dH=toH(dNet);

  const wWarn=ARV_WORK.filter(r=>wH>=r.h-0.25&&wH<r.h);
  const wOver=ARV_WORK.filter(r=>wH>=r.h);
  const dWarn=ARV_DRIVE.filter(r=>dH>=r.h-0.25&&dH<r.h);
  const dOver=ARV_DRIVE.filter(r=>dH>=r.h);
  const nextW=ARV_WORK.find(r=>wH<r.h);

  const wCol=wH>=9?"#ef4444":wH>=7?"#f97316":wH>=5.5?"#eab308":"#22c55e";
  const dCol=dH>=4.5?"#ef4444":dH>=4.25?"#f97316":"#3b82f6";

  const startWork=()=>{
    const ta=taetigkeitInput.trim()||"—";
    setWork({start:Date.now(),pauses:[],paused:false,taetigkeit:ta});
    setNow(Date.now());setShowWorkDot(true);
    logA("EINSTEMPELN",ta,curLoc);
    setTaetigkeitModal(false);setTaetigkeitInput("");
  };

  const handleWorkPause=()=>{
    const ts=Date.now();
    setWork(w=>{
      if(!w.paused){logA("PAUSE_START","Arbeitszeit",curLoc);return{...w,paused:true,pauses:[...w.pauses,{start:ts}]};}
      logA("PAUSE_ENDE","Arbeitszeit",curLoc);
      return{...w,paused:false,pauses:w.pauses.map((p,i)=>i===w.pauses.length-1?{...p,end:ts}:p)};
    });
  };

  const handleDrivePause=()=>{
    const ts=Date.now();
    if(!drive.paused){
      logA("PAUSE_START","Lenkzeit",curLoc);
      setDrive(d=>({...d,paused:true,pauses:[...d.pauses,{start:ts}]}));
      setWork(w=>({...w,paused:true,pauses:[...w.pauses,{start:ts}]}));
    }else{
      logA("PAUSE_ENDE","Lenkzeit",curLoc);
      setDrive(d=>({...d,paused:false,pauses:d.pauses.map((p,i)=>i===d.pauses.length-1?{...p,end:ts}:p)}));
      setWork(w=>({...w,paused:false,pauses:w.pauses.map((p,i)=>i===w.pauses.length-1?{...p,end:ts}:p)}));
    }
  };

  const stopDrive=()=>{
    const ts=Date.now();let d=drive;
    if(d.paused){
      d={...d,paused:false,pauses:d.pauses.map((p,i)=>i===d.pauses.length-1?{...p,end:ts}:p)};
      setWork(w=>({...w,paused:false,pauses:w.pauses.map((p,i)=>i===w.pauses.length-1?{...p,end:ts}:p)}));
    }
    const net=calcNet({...d,end:ts},ts),pm=calcPMs({...d,end:ts},ts);
    setDriveSessions(p=>[...p,{...d,end:ts,netMs:net,pauseMs:pm,location:curLoc}]);
    logA("FAHRT_ENDE",`${toH(net).toFixed(2)}h`,curLoc);
    setDrive(null);setShowDriveDot(true);
  };

  const finalizeStop=(stars,comment)=>{
    const ts=Date.now();
    if(drive){
      let d=drive;
      if(d.paused)d={...d,paused:false,pauses:d.pauses.map((p,i)=>i===d.pauses.length-1?{...p,end:ts}:p)};
      setDriveSessions(p=>[...p,{...d,end:ts,netMs:calcNet({...d,end:ts},ts),pauseMs:calcPMs({...d,end:ts},ts),location:curLoc}]);
      setDrive(null);setShowDriveDot(true);
    }
    let w=work;
    if(w.paused)w={...w,paused:false,pauses:w.pauses.map((p,i)=>i===w.pauses.length-1?{...p,end:ts}:p)};
    setWorkSessions(p=>[...p,{...w,end:ts,netMs:calcNet({...w,end:ts},ts),pauseMs:calcPMs({...w,end:ts},ts),location:curLoc,stars,comment}]);
    logA("AUSSTEMPELN",`★${stars}${comment?" | "+comment:""}`,curLoc);
    setWork(null);setShowWorkDot(true);
    setShowInlineNote(false);setInlineNoteText("");
    if(view==="notizen")setView("tracker");
    setRatingModal(false);setDayStars(0);setDayComment("");
  };

  const saveInlineNote=()=>{
    if(!inlineNoteText.trim())return;
    setNotes(n=>[...n,{id:Date.now(),text:inlineNoteText.trim(),ts:Date.now(),loc:curLoc}]);
    logA("NOTIZ",inlineNoteText.trim().slice(0,60),curLoc);
    setInlineNoteText("");setShowInlineNote(false);
  };

  const saveEditNote=()=>{
    if(!editNoteText.trim())return;
    setNotes(ns=>ns.map(n=>n.id===editNoteId?{...n,text:editNoteText,edited:Date.now()}:n));
    logA("NOTIZ_BEARBEITET",editNoteText.trim().slice(0,60),curLoc);
    setEditNoteId(null);setEditNoteText("");
  };

  const exportCSV=(fromStr,toStr)=>{
    // Rate-Limit für CSV-Export
    const exportLimit=logCSVExport();
    if(exportLimit.blocked){
      alert("Zu viele CSV-Exporte! Bitte später versuchen.");
      return;
    }

    const from=fromStr?new Date(fromStr).getTime():0;
    const to=toStr?new Date(toStr).getTime()+86400000:Date.now();

    const filteredWorks=workSessions.filter(s=>s.start>=from&&s.start<to);
    const filteredDrives=driveSessions.filter(s=>s.start>=from&&s.start<to);
    const filteredNotes=notes.filter(n=>n.ts>=from&&n.ts<to);

    const hdr="Typ,Datum,Start,Ende,Netto (h),Pausen (Min),Detail,Bewertung,Standort";
    const rows=[
      ...filteredWorks.map(s=>["Arbeit",fmtDate(s.start),fmtTime(s.start),fmtTime(s.end),toH(s.netMs).toFixed(2),Math.round(s.pauseMs/60000),s.taetigkeit||"",s.stars?`★${s.stars}`:"",locStr(s.location)].join(",")),
      ...filteredDrives.map(s=>["Fahrt",fmtDate(s.start),fmtTime(s.start),fmtTime(s.end),toH(s.netMs).toFixed(2),Math.round(s.pauseMs/60000),"","",locStr(s.location)].join(",")),
      ...filteredNotes.map(n=>`"Notiz","${fmtDate(n.ts)}","${fmtTime(n.ts)}","","","","${n.text.replace(/"/g,'""')}","","${locStr(n.loc)}"`),
    ];
    const blob=new Blob([[hdr,...rows].join("\n")],{type:"text/csv;charset=utf-8;"});
    Object.assign(document.createElement("a"),{href:URL.createObjectURL(blob),download:`zeiterfassung_${fromStr||"alle"}_bis_${toStr||"heute"}.csv`}).click();
    setExportModal(false);
    setExportFromDate("");
    setExportToDate("");
  };

  const deleteData=(fromStr,toStr)=>{
    const from=fromStr?new Date(fromStr).getTime():0;
    const to=toStr?new Date(toStr).getTime()+86400000:Date.now();

    setWorkSessions(ws=>ws.filter(s=>!(s.start>=from&&s.start<to)));
    setDriveSessions(ds=>ds.filter(s=>!(s.start>=from&&s.start<to)));
    setNotes(ns=>ns.filter(n=>!(n.ts>=from&&n.ts<to)));
    setActionLog(al=>al.filter(a=>!(a.ts>=from&&a.ts<to)));

    logA("DATEN_GELÖSCHT",`${fromStr||"Anfang"} bis ${toStr||"Heute"}`,null);
    setDeleteModal(false);
    setDeleteConfirm(false);
    setDeleteFromDate("");
    setDeleteToDate("");
    setDeleteAll(false);
  };

  const ws2=new Date();ws2.setDate(ws2.getDate()-ws2.getDay()+1);ws2.setHours(0,0,0,0);
  const weekMs=workSessions.filter(s=>s.start>=ws2).reduce((s,x)=>s+x.netMs,0);
  const navItems=[["tracker","Tracker"],["notizen","Notizen"],["dashboard","Dashboard"]].filter(([v])=>v!=="notizen"||!!work);

  const t=dark
    ?{bg:"#0f1117",card:"#1a1d27",s2:"#23263a",border:"#2d314840",text:"#e2e8f0",muted:"#94a3b8",hint:"#475569"}
    :{bg:"#f4f5f7",card:"#ffffff",s2:"#f1f2f6",border:"#e2e4ed",text:"#0f172a",muted:"#475569",hint:"#94a3b8"};
  const C=(bc)=>({background:t.card,borderRadius:14,border:`1px solid ${bc||t.border}`,padding:"18px 20px",marginBottom:12});
  const Btn=(bg,col,bd)=>({padding:"10px",borderRadius:8,border:bd||"none",background:bg,color:col,fontSize:13,fontWeight:500,cursor:"pointer",flex:1});

  return(
    <div style={{fontFamily:"system-ui,-apple-system,sans-serif",background:t.bg,minHeight:"100vh",color:t.text}}>
      <style>{`@keyframes dp{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(1.5)}}.dp{animation:dp 2s ease-in-out infinite}.dpf{animation:dp 1.4s ease-in-out infinite}`}</style>

      {/* STORAGE WARNING */}
      {storageWarning&&(
        <div style={{background:storageWarning.includes("❌")?"#ef444414":"#f9731614",borderBottom:`1px solid ${storageWarning.includes("❌")?"#ef444440":"#f9731640"}`,padding:"12px 18px",color:storageWarning.includes("❌")?"#ef4444":"#f97316",fontSize:12}}>
          {storageWarning}
        </div>
      )}

      <nav style={{background:t.card,borderBottom:`0.5px solid ${t.border}`,padding:"11px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontWeight:600,fontSize:15,display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:26,height:26,background:"#6366f1",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:13}}>⏱</div>
          ZeitTracker
        </div>
        <div style={{display:"flex",gap:4}}>
          {navItems.map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{padding:"5px 13px",borderRadius:8,border:view===v?"none":`0.5px solid ${t.border}`,background:view===v?"#6366f1":"transparent",color:view===v?"white":t.muted,fontSize:12,fontWeight:500,cursor:"pointer"}}>{l}</button>
          ))}
        </div>
      </nav>

      <div style={{padding:"18px 18px 90px",maxWidth:660,margin:"0 auto"}}>
        {/* REST DES CODES WIE IN index_new.tsx - nur gekürzt zur Übersicht */}
        {view==="tracker"&&(
          <>
            <div style={C(work?wCol+"50":t.border)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:work?14:0}}>
                <span style={{fontSize:11,fontWeight:500,color:t.hint,textTransform:"uppercase",letterSpacing:"0.07em"}}>
                  Arbeitszeit{work&&work.taetigkeit?` · ${work.taetigkeit}`:""}
                </span>
                {work&&showWorkDot&&(
                  <button onClick={()=>setShowWorkDot(false)} style={{background:"none",border:"none",cursor:"pointer",padding:2}}>
                    <div className="dp" style={{width:9,height:9,borderRadius:"50%",background:wCol}}/>
                  </button>
                )}
              </div>
              {work?(
                <>
                  <div style={{textAlign:"center",padding:"6px 0 14px"}}>
                    <div style={{fontSize:58,fontWeight:400,fontVariantNumeric:"tabular-nums",letterSpacing:"-0.03em",color:wCol,lineHeight:1}}>{fmtMs(wNet)}</div>
                    {wPMs>0&&<div style={{fontSize:12,color:t.hint,marginTop:5}}>Pausen {fmtMs(wPMs)}</div>}
                  </div>
                  {wOver.map(r=><div key={r.h} style={{background:"#ef444414",border:"0.5px solid #ef444450",borderRadius:8,padding:"7px 12px",fontSize:12,color:"#ef4444",marginBottom:6}}>⚠ {r.label} fällig</div>)}
                  {wWarn.map(r=><div key={r.h} style={{background:"#f9731612",border:"0.5px solid #f9731640",borderRadius:8,padding:"7px 12px",fontSize:12,color:"#f97316",marginBottom:6}}>⏰ {r.label} in Kürze</div>)}
                  <div style={{display:"flex",gap:8,marginTop:4}}>
                    {!drive&&<button onClick={handleWorkPause} style={Btn(t.s2,t.text,`0.5px solid ${t.border}`)}>{work.paused?"▶ Weiter":"⏸ Pause"}</button>}
                    <button onClick={()=>setConfirmStop(true)} style={Btn("#ef444414","#ef4444","0.5px solid #ef444440")}>⏹ Ausstempeln</button>
                  </div>
                </>
              ):(
                <div style={{paddingTop:14}}>
                  <button onClick={()=>{setTaetigkeitModal(true);setTaetigkeitInput("");}} style={{width:"100%",padding:"13px",background:"#6366f1",border:"none",borderRadius:10,color:"white",fontSize:15,fontWeight:500,cursor:"pointer"}}>▶ Einstempeln</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal-Code wie in index_new.tsx - gekürzt */}
      {taetigkeitModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box"}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>Tätigkeit</div>
            <input
              autoFocus value={taetigkeitInput} onChange={e=>setTaetigkeitInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")startWork();}}
              placeholder="z.B. Fahrer, Lager, Disposition..."
              style={{width:"100%",padding:"12px 14px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:9,color:t.text,fontSize:14,boxSizing:"border-box",outline:"none"}}
            />
            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button onClick={()=>setTaetigkeitModal(false)} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Abbrechen</button>
              <button onClick={startWork} style={Btn("#6366f1","white")}>Starten</button>
            </div>
          </div>
        </div>
      )}

      <div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",zIndex:100}}>
        <button onClick={()=>setDark(d=>!d)} style={{display:"flex",alignItems:"center",gap:7,padding:"8px 18px",borderRadius:99,background:t.card,border:`0.5px solid ${t.border}`,color:t.muted,fontSize:13,fontWeight:500,cursor:"pointer",boxShadow:dark?"0 2px 16px #00000060":"0 2px 12px #00000018"}}>
          {dark?"☀ Hell":"🌙 Dunkel"}
        </button>
      </div>
    </div>
  );
}
