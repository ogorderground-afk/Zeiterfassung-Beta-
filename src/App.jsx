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

  useEffect(()=>{
    const limitCheck=logPageLoad();
    if(limitCheck.blocked){
      setStorageWarning("❌ Zu viele Anfragen. Service wird momentan begrenzt.");
      return;
    }

    const quota=checkStorageAndWarn();
    if(quota.warning){
      setStorageWarning(quota.warning);
    }

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

    if("serviceWorker" in navigator){
      navigator.serviceWorker.register("/sw.js").catch(err=>console.log("SW registration failed:",err));
    }
  },[]);

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
                    {nextW&&!work.paused&&<div style={{fontSize:11,color:t.hint,marginTop:3}}>Pausenpflicht in {fmtMs(Math.max(0,nextW.h*3600000-wNet))}</div>}
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

            {work&&(
              <div style={C(drive?dCol+"50":t.border)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:drive?14:0}}>
                  <span style={{fontSize:11,fontWeight:500,color:t.hint,textTransform:"uppercase",letterSpacing:"0.07em"}}>Lenkzeit</span>
                  {drive&&showDriveDot&&(
                    <button onClick={()=>setShowDriveDot(false)} style={{background:"none",border:"none",cursor:"pointer",padding:2}}>
                      <div className="dpf" style={{width:9,height:9,borderRadius:"50%",background:dCol}}/>
                    </button>
                  )}
                </div>
                {drive?(
                  <>
                    <div style={{textAlign:"center",padding:"6px 0 14px"}}>
                      <div style={{fontSize:58,fontWeight:400,fontVariantNumeric:"tabular-nums",letterSpacing:"-0.03em",color:dCol,lineHeight:1}}>{fmtMs(dNet)}</div>
                      {dPMs>0&&<div style={{fontSize:12,color:t.hint,marginTop:5}}>Pausen {fmtMs(dPMs)} <span style={{opacity:.5}}>(= Arbeitsp.)</span></div>}
                    </div>
                    {dOver.map(r=><div key={r.h} style={{background:"#ef444414",border:"0.5px solid #ef444450",borderRadius:8,padding:"7px 12px",fontSize:12,color:"#ef4444",marginBottom:6}}>⚠ {r.label} fällig</div>)}
                    {dWarn.map(r=><div key={r.h} style={{background:"#f9731612",border:"0.5px solid #f9731640",borderRadius:8,padding:"7px 12px",fontSize:12,color:"#f97316",marginBottom:6}}>⏰ {r.label} in Kürze</div>)}
                    <div style={{display:"flex",gap:8,marginTop:4}}>
                      <button onClick={handleDrivePause} style={Btn(t.s2,t.text,`0.5px solid ${t.border}`)}>{drive.paused?"▶ Weiter":"⏸ Pause"}</button>
                      <button onClick={stopDrive} style={Btn("#3b82f614","#3b82f6","0.5px solid #3b82f640")}>⏹ Fahrt Ende</button>
                    </div>
                  </>
                ):(
                  <div style={{paddingTop:14}}>
                    <button
                      onClick={()=>{setDrive({start:Date.now(),pauses:[],paused:false});setNow(Date.now());setShowDriveDot(true);logA("FAHRT_START","",curLoc);}}
                      disabled={work.paused}
                      style={{width:"100%",padding:"11px",background:work.paused?"#3b82f608":"#3b82f614",border:"0.5px solid #3b82f640",borderRadius:8,color:work.paused?"#3b82f650":"#3b82f6",fontSize:13,fontWeight:500,cursor:work.paused?"default":"pointer"}}
                    >🚗 Fahrt starten{work.paused?" (Arbeitszeit pausiert)":""}</button>
                  </div>
                )}
              </div>
            )}

            {work&&(
              !showInlineNote?(
                <button onClick={()=>setShowInlineNote(true)} style={{width:"100%",padding:"10px 14px",background:"transparent",border:`0.5px solid ${t.border}`,borderRadius:10,color:t.hint,fontSize:13,cursor:"pointer",textAlign:"left"}}>
                  ✏ Notiz erfassen...
                </button>
              ):(
                <div style={C()}>
                  <div style={{fontSize:11,color:t.hint,marginBottom:8}}>{fmtTime(Date.now())} · {curLoc?`${curLoc.lat.toFixed(4)}, ${curLoc.lng.toFixed(4)}`:"kein GPS"}</div>
                  <textarea autoFocus value={inlineNoteText} onChange={e=>setInlineNoteText(e.target.value)} placeholder="Notiz eingeben..." style={{width:"100%",minHeight:72,background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,padding:"9px 12px",color:t.text,fontSize:14,resize:"none",boxSizing:"border-box"}}/>
                  <div style={{display:"flex",gap:8,marginTop:8}}>
                    <button onClick={()=>{setShowInlineNote(false);setInlineNoteText("");}} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Abbrechen</button>
                    <button onClick={saveInlineNote} disabled={!inlineNoteText.trim()} style={Btn(inlineNoteText.trim()?"#6366f1":"#6366f140","white")}>Speichern</button>
                  </div>
                </div>
              )
            )}
          </>
        )}

        {view==="notizen"&&work&&(
          <>
            <div style={{fontWeight:500,marginBottom:14,fontSize:15}}>Notizen</div>
            {notes.length===0?(
              <div style={{textAlign:"center",padding:"50px 0",color:t.hint,fontSize:13}}>Keine Notizen vorhanden</div>
            ):[...notes].reverse().map(n=>(
              <div key={n.id} style={C()}>
                {editNoteId===n.id?(
                  <>
                    <textarea value={editNoteText} onChange={e=>setEditNoteText(e.target.value)} style={{width:"100%",minHeight:70,background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,padding:"9px 11px",color:t.text,fontSize:14,resize:"none",boxSizing:"border-box"}}/>
                    <div style={{display:"flex",gap:8,marginTop:8}}>
                      <button onClick={()=>{setEditNoteId(null);setEditNoteText("");}} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Abbrechen</button>
                      <button onClick={saveEditNote} style={Btn("#6366f1","white")}>Speichern</button>
                    </div>
                  </>
                ):(
                  <>
                    <div style={{fontSize:14,lineHeight:1.6,marginBottom:8}}>{n.text}</div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:11,color:t.hint}}>
                        {fmtDate(n.ts)} {fmtTime(n.ts)}{n.loc&&` · ${n.loc.lat.toFixed(4)}, ${n.loc.lng.toFixed(4)}`}{n.edited&&" · bearb."}
                      </div>
                      <div style={{display:"flex",gap:5}}>
                        <button onClick={()=>{setEditNoteId(n.id);setEditNoteText(n.text);}} style={{padding:"3px 9px",borderRadius:6,border:`0.5px solid ${t.border}`,background:"transparent",color:t.muted,fontSize:12,cursor:"pointer"}}>✎</button>
                        <button onClick={()=>setNotes(ns=>ns.filter(x=>x.id!==n.id))} style={{padding:"3px 9px",borderRadius:6,border:"0.5px solid #ef444440",background:"transparent",color:"#ef4444",fontSize:12,cursor:"pointer"}}>✕</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </>
        )}

        {view==="dashboard"&&(
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:12}}>
              {[["Woche",toH(weekMs).toFixed(1)+"h","von 45h"],["Schichten",workSessions.length,driveSessions.length+" Fahrten"],["Notizen",notes.length,gpsLog.length+" GPS-Pings"]].map(([l,v,s])=>(
                <div key={l} style={{background:t.s2,borderRadius:10,padding:"13px 14px"}}>
                  <div style={{fontSize:10,color:t.hint,textTransform:"uppercase",letterSpacing:"0.06em"}}>{l}</div>
                  <div style={{fontSize:24,fontWeight:500,marginTop:5}}>{v}</div>
                  <div style={{fontSize:11,color:t.hint,marginTop:2}}>{s}</div>
                </div>
              ))}
            </div>

            <div style={C()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <span style={{fontWeight:500,fontSize:14}}>Einträge</span>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{setExportFromDate("");setExportToDate("");setExportModal(true);}} disabled={!workSessions.length&&!driveSessions.length} style={{padding:"6px 12px",borderRadius:7,border:`0.5px solid ${t.border}`,background:"transparent",color:t.muted,fontSize:12,cursor:"pointer"}}>↓ CSV</button>
                  <button onClick={()=>{setDeleteFromDate("");setDeleteToDate("");setDeleteAll(false);setDeleteConfirm(false);setDeleteModal(true);}} disabled={!workSessions.length&&!driveSessions.length} style={{padding:"6px 12px",borderRadius:7,border:`0.5px solid #ef444440`,background:"transparent",color:"#ef4444",fontSize:12,cursor:"pointer"}}>🗑 Löschen</button>
                </div>
              </div>
              {workSessions.length===0&&driveSessions.length===0?(
                <div style={{textAlign:"center",padding:"30px",color:t.hint,fontSize:13}}>Noch keine Einträge</div>
              ):[...workSessions.map(s=>({...s,type:"Arbeit"})),...driveSessions.map(s=>({...s,type:"Fahrt"}))].sort((a,b)=>b.start-a.start).map((s,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:`0.5px solid ${t.border}`}}>
                  <div>
                    <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:s.type==="Fahrt"?"#3b82f614":"#6366f114",color:s.type==="Fahrt"?"#3b82f6":"#6366f1"}}>{s.type}</span>
                      {s.taetigkeit&&<span style={{fontSize:11,color:t.hint}}>{s.taetigkeit}</span>}
                      {s.stars>0&&<span style={{fontSize:12}}>{Array.from({length:5},(_,i)=>i<s.stars?"★":"☆").join("")}</span>}
                    </div>
                    <div style={{fontSize:12,color:t.hint,marginTop:4}}>{fmtDate(s.start)} · {fmtTime(s.start)}–{fmtTime(s.end)}</div>
                    {s.comment&&<div style={{fontSize:11,color:t.hint,marginTop:2,fontStyle:"italic"}}>"{s.comment}"</div>}
                  </div>
                  <div style={{textAlign:"right",flexShrink:0,marginLeft:10}}>
                    <div style={{fontSize:14,fontWeight:500}}>{toH(s.netMs).toFixed(2)}h</div>
                    <div style={{fontSize:11,color:t.hint}}>{Math.round(s.pauseMs/60000)} Min. Pause</div>
                  </div>
                </div>
              ))}
            </div>

            {actionLog.length>0&&(
              <div style={C()}>
                <div style={{fontWeight:500,fontSize:14,marginBottom:12}}>Aktivitätsprotokoll</div>
                <div style={{maxHeight:180,overflowY:"auto",display:"flex",flexDirection:"column",gap:5}}>
                  {[...actionLog].reverse().map((a,i)=>(
                    <div key={i} style={{display:"flex",gap:10,fontSize:12}}>
                      <span style={{color:t.hint,flexShrink:0,fontVariantNumeric:"tabular-nums"}}>{fmtFull(a.ts)}</span>
                      <span style={{color:t.muted,flexShrink:0}}>{a.action}</span>
                      {a.detail&&<span style={{color:t.hint,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.detail}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {exportModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box"}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>CSV exportieren</div>
            <div style={{marginBottom:12}}>
              <label style={{display:"block",fontSize:12,color:t.muted,marginBottom:6}}>Von Datum:</label>
              <input type="date" value={exportFromDate} onChange={e=>setExportFromDate(e.target.value)} style={{width:"100%",padding:"10px 12px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,fontSize:14,boxSizing:"border-box"}}/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{display:"block",fontSize:12,color:t.muted,marginBottom:6}}>Bis Datum:</label>
              <input type="date" value={exportToDate} onChange={e=>setExportToDate(e.target.value)} style={{width:"100%",padding:"10px 12px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,fontSize:14,boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setExportModal(false)} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Abbrechen</button>
              <button onClick={()=>exportCSV(exportFromDate,exportToDate)} style={Btn("#6366f1","white")}>↓ Exportieren</button>
            </div>
          </div>
        </div>
      )}

      {deleteModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box"}}>
            {!deleteConfirm?(
              <>
                <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>Daten löschen</div>
                <div style={{marginBottom:12}}>
                  <label style={{display:"block",fontSize:12,color:t.muted,marginBottom:6}}>Von Datum:</label>
                  <input type="date" value={deleteFromDate} onChange={e=>setDeleteFromDate(e.target.value)} disabled={deleteAll} style={{width:"100%",padding:"10px 12px",background:deleteAll?t.s2+"88":t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,fontSize:14,boxSizing:"border-box"}}/>
                </div>
                <div style={{marginBottom:16}}>
                  <label style={{display:"block",fontSize:12,color:t.muted,marginBottom:6}}>Bis Datum:</label>
                  <input type="date" value={deleteToDate} onChange={e=>setDeleteToDate(e.target.value)} disabled={deleteAll} style={{width:"100%",padding:"10px 12px",background:deleteAll?t.s2+"88":t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,fontSize:14,boxSizing:"border-box"}}/>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:16,padding:"12px",background:t.s2,borderRadius:8}}>
                  <input type="checkbox" checked={deleteAll} onChange={e=>setDeleteAll(e.target.checked)} style={{cursor:"pointer"}}/>
                  <label style={{fontSize:13,cursor:"pointer"}}>Alles löschen</label>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setDeleteModal(false)} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Abbrechen</button>
                  <button onClick={()=>setDeleteConfirm(true)} style={Btn("#ef4444","white")}>Weiter</button>
                </div>
              </>
            ):(
              <>
                <div style={{fontWeight:500,fontSize:15,marginBottom:6}}>Bestätigung erforderlich</div>
                <div style={{fontSize:13,color:t.muted,marginBottom:22}}>Diese Aktion kann nicht rückgängig gemacht werden!</div>
                <div style={{fontSize:13,color:"#ef4444",background:"#ef444414",border:"0.5px solid #ef444440",borderRadius:8,padding:12,marginBottom:16}}>
                  {deleteAll?"Alle Daten werden gelöscht!":`Daten von ${deleteFromDate||"Anfang"} bis ${deleteToDate||"Heute"} werden gelöscht!`}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setDeleteConfirm(false)} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Zurück</button>
                  <button onClick={()=>deleteData(deleteAll?null:deleteFromDate,deleteAll?null:deleteToDate)} style={Btn("#ef4444","white")}>✓ Wirklich löschen</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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

      {confirmStop&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box"}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:6}}>Schicht beenden?</div>
            <div style={{fontSize:13,color:t.muted,marginBottom:22}}>Alle laufenden Zeiten werden gestoppt.</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setConfirmStop(false)} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Nein</button>
              <button onClick={()=>{setConfirmStop(false);setRatingModal(true);}} style={Btn("#6366f1","white")}>Ja</button>
            </div>
          </div>
        </div>
      )}

      {ratingModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box"}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:4}}>Wie war dein Tag?</div>
            <div style={{fontSize:13,color:t.muted,marginBottom:18}}>Kurze Bewertung der Schicht</div>
            <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:18}}>
              {[1,2,3,4,5].map(s=>(
                <button key={s} onClick={()=>setDayStars(s)} style={{background:"none",border:"none",fontSize:38,cursor:"pointer",opacity:s<=dayStars?1:0.2,transition:"opacity .12s",padding:"0 4px"}}>★</button>
              ))}
            </div>
            <textarea
              value={dayComment} onChange={e=>setDayComment(e.target.value)}
              placeholder="Bemerkungen (optional)..."
              style={{width:"100%",minHeight:72,background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:9,padding:"10px 12px",color:t.text,fontSize:14,resize:"none",boxSizing:"border-box"}}
            />
            <button onClick={()=>finalizeStop(dayStars,dayComment.trim())} style={{width:"100%",padding:"12px",background:"#6366f1",border:"none",borderRadius:9,color:"white",fontSize:14,fontWeight:500,cursor:"pointer",marginTop:12}}>
              Abschliessen
            </button>
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
