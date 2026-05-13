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

function getPos(){
  return new Promise((res,rej)=>{
    if(!navigator.geolocation){rej(new Error("no geo"));return;}
    navigator.geolocation.getCurrentPosition(
      p=>res({lat:p.coords.latitude,lng:p.coords.longitude,acc:Math.round(p.coords.accuracy)}),
      err=>{rej(err)},
      {timeout:10000}
    );
  });
}

function locStr(l){if(!l)return"—";return`${l.lat?.toFixed(5)||"?"}, ${l.lng?.toFixed(5)||"?"}`;}

let dbInstance=null;

const initDB=async()=>{
  if(dbInstance) return dbInstance;
  return new Promise((resolve)=>{
    try{
      const req=indexedDB.open("ZeitTrackerDB",1);
      req.onerror=()=>{
        console.error("DB open error:",req.error);
        resolve(null);
      };
      req.onsuccess=()=>{
        dbInstance=req.result;
        resolve(dbInstance);
      };
      req.onupgradeneeded=(e)=>{
        try{
          const db=e.target.result;
          if(!db.objectStoreNames.contains("data")) {
            db.createObjectStore("data");
          }
        }catch(e2){
          console.error("DB upgrade error:",e2);
        }
      };
    }catch(e){
      console.error("DB error:",e);
      resolve(null);
    }
  });
};

const saveToStorage=async(key,data)=>{
  try{
    localStorage.setItem(key,JSON.stringify(data));
    const db=await initDB();
    if(db){
      try{
        const tx=db.transaction("data","readwrite");
        tx.objectStore("data").put(data,key);
      }catch(e){}
    }
  }catch(e){}
};

const loadFromStorage=async(key,def=null)=>{
  try{
    const db=await initDB();
    if(db){
      return new Promise((resolve)=>{
        try{
          const tx=db.transaction("data","readonly");
          const req=tx.objectStore("data").get(key);
          req.onsuccess=()=>resolve(req.result||def);
          req.onerror=()=>{
            const local=localStorage.getItem(key);
            resolve(local?JSON.parse(local):def);
          };
        }catch(e){
          const local=localStorage.getItem(key);
          resolve(local?JSON.parse(local):def);
        }
      });
    }
  }catch(e){}
  const local=localStorage.getItem(key);
  return local?JSON.parse(local):def;
};

const isPWA=()=>window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;

const requestPersistentStorage=async()=>{
  if(navigator.storage?.persist){
    try{
      await navigator.storage.persist();
      localStorage.setItem("persistentStorageGranted",JSON.stringify({ts:Date.now()}));
    }catch(e){}
  }
};

export default function App(){
  const [dark,setDark]=useState(true);
  const [transparent,setTransparent]=useState(false);
  const [view,setView]=useState("tracker");
  const [gpsInterval,setGpsInterval]=useState(10);
  const [drivepauseModal,setDrivepauseModal]=useState(false);
  const [driveExpanded,setDriveExpanded]=useState(false);
  const [ruleDialogOpen,setRuleDialogOpen]=useState(false);
  const [selectedRule,setSelectedRule]=useState("standard");
  const [ruleManagerOpen,setRuleManagerOpen]=useState(false);
  const [notificationEnabled,setNotificationEnabled]=useState(true);
  const [triggeredRules,setTriggeredRules]=useState([]);
  const [showPersistentPrompt,setShowPersistentPrompt]=useState(false);

  const [taetigkeitModal,setTaetigkeitModal]=useState(false);
  const [taetigkeitInput,setTaetigkeitInput]=useState("");

  const [work,setWork]=useState(null);
  const [drive,setDrive]=useState(null);
  const [workSessions,setWorkSessions]=useState([]);
  const [driveSessions,setDriveSessions]=useState([]);
  const [rules,setRules]=useState([]);
  const [newRuleHours,setNewRuleHours]=useState(1);
  const [newRuleMinutes,setNewRuleMinutes]=useState(0);
  const [newRuleText,setNewRuleText]=useState("");

  const [confirmStop,setConfirmStop]=useState(false);
  const [ratingModal,setRatingModal]=useState(false);
  const [dayStars,setDayStars]=useState(0);

  const [notes,setNotes]=useState([]);
  const [showInlineNote,setShowInlineNote]=useState(false);
  const [inlineNoteText,setInlineNoteText]=useState("");

  const [curLoc,setCurLoc]=useState(null);
  const [gpsLog,setGpsLog]=useState([]);
  const [showWorkDot,setShowWorkDot]=useState(true);
  const [showDriveDot,setShowDriveDot]=useState(true);
  const [now,setNow]=useState(Date.now());
  const tickRef=useRef(null);
  const gpsRef=useRef(null);

  const [exportModal,setExportModal]=useState(false);
  const [deleteModal,setDeleteModal]=useState(false);
  const [deleteConfirm,setDeleteConfirm]=useState(false);

  const pwaActive=isPWA();

  useEffect(()=>{
    (async()=>{
      try{
        await initDB();
        const w=await loadFromStorage("work");
        const d=await loadFromStorage("drive");
        const ws=await loadFromStorage("workSessions",[]);
        const ds=await loadFromStorage("driveSessions",[]);
        const n=await loadFromStorage("notes",[]);
        const gl=await loadFromStorage("gpsLog",[]);
        const gi=await loadFromStorage("gpsInterval",10);
        const r=await loadFromStorage("rules",[]);
        const ne=await loadFromStorage("notificationEnabled",true);
        const tr=await loadFromStorage("triggeredRules",[]);

        if(w) setWork(w);
        if(d) setDrive(d);
        setWorkSessions(ws||[]);
        setDriveSessions(ds||[]);
        setNotes(n||[]);
        setGpsLog(gl||[]);
        setGpsInterval(gi||10);
        setRules(r||[]);
        setNotificationEnabled(ne!==false);
        setTriggeredRules(tr||[]);

        const persistGranted=localStorage.getItem("persistentStorageGranted");
        if(!persistGranted) setShowPersistentPrompt(true);

        if("serviceWorker" in navigator){
          navigator.serviceWorker.register("/sw.js").catch(err=>console.log("SW fail"));
        }
      }catch(e){
        console.error("Init:",e);
      }
    })();
  },[]);

  useEffect(()=>{if(work) saveToStorage("work",work); else localStorage.removeItem("work")}, [work]);
  useEffect(()=>{if(drive) saveToStorage("drive",drive); else localStorage.removeItem("drive")}, [drive]);
  useEffect(()=>saveToStorage("workSessions",workSessions),[workSessions]);
  useEffect(()=>saveToStorage("driveSessions",driveSessions),[driveSessions]);
  useEffect(()=>saveToStorage("notes",notes),[notes]);
  useEffect(()=>saveToStorage("gpsLog",gpsLog),[gpsLog]);
  useEffect(()=>saveToStorage("gpsInterval",gpsInterval),[gpsInterval]);
  useEffect(()=>saveToStorage("rules",rules),[rules]);
  useEffect(()=>saveToStorage("notificationEnabled",notificationEnabled),[notificationEnabled]);
  useEffect(()=>saveToStorage("triggeredRules",triggeredRules),[triggeredRules]);

  const logA=(action,detail="",loc=null)=>{
    // Logging
  };

  const sendNotification=(title,options={})=>{
    if(!notificationEnabled||!("Notification" in window)) return;
    if(Notification.permission==="granted"){
      new Notification(title,options);
    }else if(Notification.permission!=="denied"){
      Notification.requestPermission().then(permission=>{
        if(permission==="granted") new Notification(title,options);
      });
    }
  };

  useEffect(()=>{
    const active=(work&&!work.paused)||(drive&&!drive.paused);
    if(active){
      tickRef.current=setInterval(()=>setNow(Date.now()),1000);
    }else{
      clearInterval(tickRef.current);
    }
    return()=>clearInterval(tickRef.current);
  },[work?.paused,drive?.paused]);

  useEffect(()=>{
    if(!work || gpsInterval===0){
      clearInterval(gpsRef.current);
      return;
    }
    const doGps=async()=>{
      try{
        const p=await getPos();
        setCurLoc(p);
        setGpsLog(g=>[...g,{ts:Date.now(),...p}]);
      }catch(err){}
    };
    doGps();
    gpsRef.current=setInterval(doGps,gpsInterval*60*1000);
    return()=>clearInterval(gpsRef.current);
  },[work,gpsInterval]);

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
    setNow(Date.now());
    setShowWorkDot(true);
    logA("EINSTEMPELN",ta,curLoc);
    setTaetigkeitModal(false);
    setTaetigkeitInput("");
  };

  const handleWorkPause=()=>{
    const ts=Date.now();
    setWork(w=>{
      if(!w.paused){
        logA("PAUSE_START","Arbeitszeit",curLoc);
        return{...w,paused:true,pauses:[...w.pauses,{start:ts}]};
      }
      logA("PAUSE_ENDE","Arbeitszeit",curLoc);
      return{...w,paused:false,pauses:w.pauses.map((p,i)=>i===w.pauses.length-1?{...p,end:ts}:p)};
    });
  };

  const handleDrivePause=()=>{
    const ts=Date.now();
    if(!drive.paused){
      setDrivepauseModal(true);
    }else{
      const pauseWork=drive.workAlsoPaused||false;
      logA("PAUSE_ENDE","Lenkzeit",curLoc);
      setDrive(d=>({...d,paused:false,pauses:d.pauses.map((p,i)=>i===d.pauses.length-1?{...p,end:ts}:p)}));
      if(pauseWork){
        setWork(w=>({...w,paused:false,pauses:w.pauses.map((p,i)=>i===w.pauses.length-1?{...p,end:ts}:p)}));
      }
    }
  };

  const confirmDrivePause=(pauseWork)=>{
    const ts=Date.now();
    logA("PAUSE_START","Lenkzeit",curLoc);
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
    setDriveSessions(p=>[...p,{...d,end:ts,netMs:net,location:curLoc}]);
    logA("FAHRT_ENDE",`${toH(net).toFixed(2)}h`,curLoc);
    setDrive(null);
    setShowDriveDot(true);
  };

  const finalizeStop=(stars)=>{
    const ts=Date.now();
    if(drive){
      let d=drive;
      if(d.paused)d={...d,paused:false,pauses:d.pauses.map((p,i)=>i===d.pauses.length-1?{...p,end:ts}:p)};
      setDriveSessions(p=>[...p,{...d,end:ts,netMs:calcNet({...d,end:ts},ts),location:curLoc}]);
      setDrive(null);
      setShowDriveDot(true);
    }
    let w=work;
    if(w.paused)w={...w,paused:false,pauses:w.pauses.map((p,i)=>i===w.pauses.length-1?{...p,end:ts}:p)};
    setWorkSessions(p=>[...p,{...w,end:ts,netMs:calcNet({...w,end:ts},ts),location:curLoc,stars}]);
    logA("AUSSTEMPELN",`★${stars}`,curLoc);
    setWork(null);
    setShowWorkDot(true);
    setShowInlineNote(false);
    setInlineNoteText("");
    setRatingModal(false);
    setDayStars(0);
  };

  const saveInlineNote=()=>{
    if(!inlineNoteText.trim())return;
    setNotes(n=>[...n,{id:Date.now(),text:inlineNoteText.trim(),ts:Date.now(),loc:curLoc}]);
    setInlineNoteText("");
    setShowInlineNote(false);
  };

  const createRule=()=>{
    if(!newRuleText.trim()) return;
    setRules(r=>[...r,{id:Date.now(),text:newRuleText,hours:newRuleHours,minutes:newRuleMinutes}]);
    setNewRuleText("");
  };

  const deleteRule=(ruleId)=>{
    setRules(r=>r.filter(ru=>ru.id!==ruleId));
    if(selectedRule===ruleId) setSelectedRule("standard");
  };

  const exportCSV=()=>{
    const hdr="type,datum,start_time,end_time,netto_hours,activity,rating,location_lat,location_lng";
    const rows=[
      ...workSessions.map(s=>{
        const locData=s.location?`"${s.location.lat}","${s.location.lng}"`:'"",""';
        return `"Arbeit","${fmtDate(s.start)}","${fmtTime(s.start)}","${fmtTime(s.end)}","${toH(s.netMs).toFixed(3)}","${s.taetigkeit||""}","${s.stars||0}",${locData}`;
      }),
      ...driveSessions.map(s=>{
        const locData=s.location?`"${s.location.lat}","${s.location.lng}"`:'"",""';
        return `"Fahrt","${fmtDate(s.start)}","${fmtTime(s.start)}","${fmtTime(s.end)}","${toH(s.netMs).toFixed(3)}","","","",${locData}`;
      })
    ];
    const blob=new Blob([[hdr,...rows].join("\n")],{type:"text/csv"});
    Object.assign(document.createElement("a"),{href:URL.createObjectURL(blob),download:"zeiterfassung.csv"}).click();
    setExportModal(false);
  };

  const deleteData=()=>{
    setWorkSessions([]);
    setDriveSessions([]);
    setNotes([]);
    setGpsLog([]);
    setDeleteModal(false);
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
        <div style={{fontWeight:600,fontSize:15,display:"flex",alignItems:"center",gap:8}}>⏱ ZeitTracker</div>
        <div style={{display:"flex",gap:4}}>
          {[["tracker","Tracker"],["notizen","Notizen"],["dashboard","Dashboard"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{padding:"5px 13px",borderRadius:8,border:view===v?"none":`0.5px solid ${t.border}`,background:view===v?"#6366f1":"transparent",color:view===v?"white":t.muted,fontSize:12,cursor:"pointer"}}>{l}</button>
          ))}
        </div>
      </nav>

      {showPersistentPrompt&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:9998}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto"}}>
            <div style={{fontWeight:600,fontSize:16,marginBottom:8}}>🔒 Daten schützen</div>
            <div style={{fontSize:13,color:t.muted,marginBottom:20}}>IndexedDB + Persistent Storage = Daten bleiben auch nach Handy-Reinigung!</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowPersistentPrompt(false)} style={{padding:"12px",flex:1,borderRadius:8,border:`0.5px solid ${t.border}`,background:"transparent",color:t.text,cursor:"pointer"}}>⏭ Später</button>
              <button onClick={async()=>{await requestPersistentStorage();setShowPersistentPrompt(false);}} style={{padding:"12px",flex:1,borderRadius:8,background:"#6366f1",color:"white",cursor:"pointer"}}>✅ Erlauben</button>
            </div>
          </div>
        </div>
      )}

      <div style={{padding:"18px 18px 90px",maxWidth:660,margin:"0 auto"}}>
        {view==="tracker"&&(
          <>
            <div style={C(work?wCol+"50":t.border)}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:work?14:0}}>
                <span style={{fontSize:11,fontWeight:500,color:t.hint}}>ARBEITSZEIT{work&&work.taetigkeit?` · ${work.taetigkeit}`:""}</span>
                {work&&showWorkDot&&<button onClick={()=>setShowWorkDot(false)} style={{background:"none",border:"none",cursor:"pointer"}}><div className="dp" style={{width:9,height:9,borderRadius:"50%",background:wCol}}/></button>}
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
                  {drive&&showDriveDot&&<button onClick={()=>setShowDriveDot(false)} style={{background:"none",border:"none",cursor:"pointer"}}><div className="dp" style={{width:9,height:9,borderRadius:"50%",background:dCol}}/></button>}
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

      {ruleDialogOpen&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto"}}>
            <div style={{fontWeight:500,marginBottom:16}}>Regel wählen</div>
            {[{id:"standard",name:"Keine"},...rules].map(opt=>(
              <button key={opt.id} onClick={()=>{setSelectedRule(opt.id);setRuleDialogOpen(false);setDrive({start:Date.now(),pauses:[],paused:false});}} style={{width:"100%",padding:"12px",borderRadius:8,border:`2px solid ${selectedRule===opt.id?"#6366f1":t.border}`,background:selectedRule===opt.id?"#6366f114":"transparent",color:t.text,fontSize:13,cursor:"pointer",marginBottom:8}}>{selectedRule===opt.id?"✓ ":""}  {opt.name||opt.text}</button>
            ))}
            <button onClick={()=>setRuleDialogOpen(false)} style={{width:"100%",padding:"10px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      )}

      {ruleManagerOpen&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",maxHeight:"80vh",overflowY:"auto"}}>
            <div style={{fontWeight:500,marginBottom:16}}>Regeln</div>
            <div style={{marginBottom:16,padding:12,background:t.s2,borderRadius:8}}>
              <div style={{fontSize:12,color:t.hint,marginBottom:8}}>Neue Regel</div>
              <div style={{display:"flex",gap:8,marginBottom:8}}>
                <input type="number" value={newRuleHours} onChange={e=>setNewRuleHours(Math.max(0,parseInt(e.target.value)||0))} min="0" style={{width:"50px",padding:"8px",background:t.bg,border:`0.5px solid ${t.border}`,borderRadius:6,color:t.text}}/>
                <span>:</span>
                <input type="number" value={newRuleMinutes} onChange={e=>setNewRuleMinutes(Math.min(59,Math.max(0,parseInt(e.target.value)||0)))} min="0" max="59" style={{width:"50px",padding:"8px",background:t.bg,border:`0.5px solid ${t.border}`,borderRadius:6,color:t.text}}/>
              </div>
              <input type="text" value={newRuleText} onChange={e=>setNewRuleText(e.target.value)} placeholder="Text" style={{width:"100%",padding:"8px",background:t.bg,border:`0.5px solid ${t.border}`,borderRadius:6,color:t.text,marginBottom:8,boxSizing:"border-box"}}/>
              <button onClick={createRule} disabled={!newRuleText.trim()} style={{width:"100%",padding:"8px",background:newRuleText.trim()?"#6366f1":"#6366f140",border:"none",borderRadius:6,color:"white",fontSize:12,cursor:"pointer"}}>+ Add</button>
            </div>
            {rules.map(r=>(
              <div key={r.id} style={{padding:10,background:t.s2,borderRadius:8,display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <div><div style={{fontWeight:500,fontSize:12}}>{r.text}</div><div style={{color:t.hint,fontSize:11}}>{pad(r.hours)}:{pad(r.minutes)}</div></div>
                <button onClick={()=>deleteRule(r.id)} style={{padding:"4px 8px",background:"#ef444414",border:"none",borderRadius:6,color:"#ef4444",fontSize:11,cursor:"pointer"}}>Delete</button>
              </div>
            ))}
            <button onClick={()=>setRuleManagerOpen(false)} style={{width:"100%",marginTop:16,padding:"10px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,cursor:"pointer"}}>Close</button>
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
              <button onClick={exportCSV} style={Btn("#6366f1","white")}>✓ Export</button>
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
                <div style={{fontSize:13,color:"#ef4444",marginBottom:16}}>Alle Daten werden unwiederbringlich gelöscht!</div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setDeleteConfirm(false)} style={Btn(t.s2,t.muted)}>Zurück</button>
                  <button onClick={deleteData} style={Btn("#ef4444","white")}>✓ Löschen</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
        <button onClick={()=>setRuleManagerOpen(true)} style={{padding:"8px 18px",borderRadius:99,background:t.card,border:`0.5px solid ${t.border}`,color:t.muted,cursor:"pointer"}}>⚙</button>
      </div>
    </div>
  );
}
