import { useState, useEffect, useRef, useCallback } from "react";
import { checkStorageAndWarn, logPageLoad, logCSVExport, rateLimiter } from "./utils/rateLimiter";
import { db, getSetting, setSetting } from "./db";
import { migrateFromLocalStorage } from "./utils/migration";

const ARV_WORK  = [{h:5.5,label:"15 Min. Pause"},{h:7,label:"30 Min. Pause"},{h:9,label:"1 Std. Pause"}];
const ARV_DRIVE = [{h:4.5,label:"45 Min. Pflichtpause (ARV 1)"},{h:9,label:"Tageslimit Lenkzeit"}];

function pad(n){return String(n).padStart(2,"0");}
function fmtMs(ms){const s=Math.floor(Math.max(0,ms)/1000);return`${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`;}
function fmtTime(ts){return new Date(ts).toLocaleTimeString("de-CH",{hour:"2-digit",minute:"2-digit"});}
function fmtDate(ts){return new Date(ts).toLocaleDateString("de-CH");}
function fmtFull(ts){return new Date(ts).toLocaleString("de-CH",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});}
function toH(ms){return ms/3600000;}
function toDatetimeLocal(ts){const d=new Date(ts);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);}
const EXTRA_COLORS=["#8b5cf6","#ec4899","#14b8a6","#f59e0b","#84cc16"];
function calcNet(s,now){if(!s)return 0;const pm=s.pauses.reduce((a,p)=>a+((p.end||now)-p.start),0);return Math.max(0,(s.end||now)-s.start-pm);}
function calcPMs(s,now){if(!s)return 0;return s.pauses.reduce((a,p)=>a+((p.end||now)-p.start),0);}

function getPos(){
  return new Promise((res,rej)=>{
    if(!navigator.geolocation){rej(new Error("Geolocation nicht verfügbar"));return;}
    navigator.geolocation.getCurrentPosition(
      p=>res({lat:p.coords.latitude,lng:p.coords.longitude,acc:Math.round(p.coords.accuracy),speed:p.coords.speed,altitude:p.coords.altitude}),
      err=>{console.warn("GPS-Fehler:",err.message);rej(err);},
      {timeout:10000,enableHighAccuracy:false}
    );
  });
}

function locStr(l){if(!l)return"—";if(typeof l==="string")return l;return`${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`;}

const isPWA=()=>window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;

export default function App(){
  const [dark,setDark]=useState(true);
  const [view,setView]=useState("tracker");
  const [storageWarning,setStorageWarning]=useState(null);
  const [gpsInterval,setGpsInterval]=useState(10);
  const [drivepauseModal,setDrivepauseModal]=useState(false);
  const [driveExpanded,setDriveExpanded]=useState(false); // ← STARTS COLLAPSED!
  const [ruleDialogOpen,setRuleDialogOpen]=useState(false);
  const [selectedRule,setSelectedRule]=useState("standard");
  const [ruleManagerOpen,setRuleManagerOpen]=useState(false);
  const [notificationEnabled,setNotificationEnabled]=useState(true);
  const [triggeredRules,setTriggeredRules]=useState([]);
  const [dashboardFilters,setDashboardFilters]=useState({gps:false,notes:false,daysBack:7});

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
  const [dayComment,setDayComment]=useState("");

  const [notes,setNotes]=useState([]);
  const [editNoteId,setEditNoteId]=useState(null);
  const [editNoteText,setEditNoteText]=useState("");
  const [showInlineNote,setShowInlineNote]=useState(false);
  const [inlineNoteText,setInlineNoteText]=useState("");

  const [editSession,setEditSession]=useState(null);
  const [editStart,setEditStart]=useState("");
  const [editEnd,setEditEnd]=useState("");
  const [editTaetigkeit,setEditTaetigkeit]=useState("");
  const [editStars,setEditStars]=useState(0);

  const [extraTrackers,setExtraTrackers]=useState([]);
  const [customSessions,setCustomSessions]=useState([]);
  const [extraTrackerModal,setExtraTrackerModal]=useState(false);
  const [extraTrackerInput,setExtraTrackerInput]=useState("");
  const [extraTrackerRule,setExtraTrackerRule]=useState("standard");

  const [actionLog,setActionLog]=useState([]);
  const [curLoc,setCurLoc]=useState(null);
  const [gpsLog,setGpsLog]=useState([]);
  const [showWorkDot,setShowWorkDot]=useState(true);
  const [showDriveDot,setShowDriveDot]=useState(true);
  const [now,setNow]=useState(Date.now());
  const tickRef=useRef(null);
  const gpsRef=useRef(null);
  const ruleCheckRef=useRef(null);

  const [exportModal,setExportModal]=useState(false);
  const [exportFromDate,setExportFromDate]=useState("");
  const [exportToDate,setExportToDate]=useState("");

  const [deleteModal,setDeleteModal]=useState(false);
  const [deleteConfirm,setDeleteConfirm]=useState(false);
  const [deleteFromDate,setDeleteFromDate]=useState("");
  const [deleteToDate,setDeleteToDate]=useState("");
  const [deleteAll,setDeleteAll]=useState(false);
  const [appLoading, setAppLoading] = useState(true);
  const [installPrompt,setInstallPrompt]=useState(null);

  useEffect(()=>{
    const init=async()=>{
      await migrateFromLocalStorage();

      const quota=await checkStorageAndWarn();
      if(quota.warning){setStorageWarning(quota.warning);}

      const [ws,ds,n,gi,r,ne,de,tr,w,d,et,cs]=await Promise.all([
        db.workSessions.toArray(),
        db.driveSessions.toArray(),
        db.notes.orderBy('ts').toArray(),
        getSetting('gpsInterval',10),
        getSetting('rules',[]),
        getSetting('notificationEnabled',false),
        getSetting('driveExpanded',false),
        getSetting('triggeredRules',[]),
        getSetting('work',null),
        getSetting('drive',null),
        getSetting('extraTrackers',[]),
        getSetting('customSessions',[]),
      ]);
      const [al,gl]=await Promise.all([
        db.actionLog.orderBy('ts').toArray().then(items=>items.map(({id,...rest})=>rest)),
        db.gpsLog.orderBy('ts').toArray().then(items=>items.map(({id,...rest})=>rest)),
      ]);

      if(w){w._lastSave=Date.now();setWork(w);}
      if(d){d._lastSave=Date.now();setDrive(d);}
      setWorkSessions(ws);
      setDriveSessions(ds);
      setNotes(n);
      setActionLog(al);
      setGpsLog(gl);
      setGpsInterval(gi);
      setRules(r);
      setNotificationEnabled(ne);
      setDriveExpanded(de);
      setTriggeredRules(tr);
      setExtraTrackers(et);
      setCustomSessions(cs);
      setNow(Date.now());
      setAppLoading(false);
    };
    init();

    const onBeforeInstall=(e)=>{e.preventDefault();setInstallPrompt(e);};
    window.addEventListener("beforeinstallprompt",onBeforeInstall);
    window.addEventListener("appinstalled",()=>setInstallPrompt(null));
    return()=>window.removeEventListener("beforeinstallprompt",onBeforeInstall);
  },[]);

  useEffect(()=>{if(work){setSetting('work',{...work,_lastSave:Date.now()});}else{db.settings.delete('work');}},[work]);
  useEffect(()=>{if(drive){setSetting('drive',{...drive,_lastSave:Date.now()});}else{db.settings.delete('drive');}},[drive]);
  useEffect(()=>{setSetting('gpsInterval',gpsInterval);},[gpsInterval]);
  useEffect(()=>{setSetting('rules',rules);},[rules]);
  useEffect(()=>{setSetting('notificationEnabled',notificationEnabled);},[notificationEnabled]);
  useEffect(()=>{setSetting('driveExpanded',driveExpanded);},[driveExpanded]);
  useEffect(()=>{setSetting('triggeredRules',triggeredRules);},[triggeredRules]);
  useEffect(()=>{setSetting('extraTrackers',extraTrackers);},[extraTrackers]);
  useEffect(()=>{setSetting('customSessions',customSessions);},[customSessions]);

  const logA=useCallback((action,detail="",loc=null)=>{
    const entry={ts:Date.now(),action,detail,loc};
    db.actionLog.add(entry);
    setActionLog(p=>[...p,entry]);
  },[]);

  const sendNotification=(title,options={})=>{
    if(!notificationEnabled||!("Notification" in window)||Notification.permission!=="granted") return;
    new Notification(title,{...options,icon:"/manifest.json"});
  };

  const toggleNotifications=async()=>{
    if(notificationEnabled){setNotificationEnabled(false);return;}
    if(!("Notification" in window)) return;
    if(Notification.permission==="granted"){setNotificationEnabled(true);return;}
    if(Notification.permission==="denied"){alert("Benachrichtigungen sind im Browser blockiert. Bitte in den Einstellungen freigeben.");return;}
    const perm=await Notification.requestPermission();
    if(perm==="granted"){setNotificationEnabled(true);new Notification("ZeitTracker",{body:"Benachrichtigungen aktiviert ✓"});}
  };

  useEffect(()=>{
    const active=(work&&!work.paused)||(drive&&!drive.paused)||extraTrackers.some(et=>!et.paused);
    if(active){tickRef.current=setInterval(()=>setNow(Date.now()),1000);}
    else{clearInterval(tickRef.current);}
    return()=>clearInterval(tickRef.current);
  },[!!work,work?.paused,!!drive,drive?.paused,extraTrackers]);

  const logGps=useCallback(async()=>{
    try{
      const p=await getPos();
      setCurLoc(p);
      const gpsEntry={ts:Date.now(),...p,context:{session_type:drive?"Fahrt":"Arbeit",session_start:drive?.start||work?.start,activity:work?.taetigkeit||"",rule_applied:selectedRule}};
      db.gpsLog.add(gpsEntry);
      setGpsLog(g=>[...g,gpsEntry]);
      logA("GPS",locStr(p),p);
    }catch(err){console.log("GPS-Fehler:",err.message);}
  },[logA,drive,work,selectedRule]);

  useEffect(()=>{
    if(!work || gpsInterval===0){clearInterval(gpsRef.current);return;}
    logGps();
    gpsRef.current=setInterval(logGps,gpsInterval*60*1000);
    return()=>clearInterval(gpsRef.current);
  },[!!work,gpsInterval,logGps]);

  useEffect(()=>{
    if(!work || !rules.length){clearInterval(ruleCheckRef.current);return;}
    ruleCheckRef.current=setInterval(()=>{
      const rule=rules.find(r=>r.id===selectedRule);
      if(!rule) return;
      if(triggeredRules.includes(rule.id)) return;
      
      const elapsed=Date.now()-work.start-calcPMs(work,Date.now());
      const ruleMs=((rule.hours*60)+rule.minutes)*60*1000;
      
      if(elapsed>=ruleMs){
        sendNotification("⏱ Regel: "+rule.text,{body:rule.text,icon:"⏱"});
        logA("REGEL_TRIGGER",rule.text,curLoc);
        setTriggeredRules(t=>[...t,rule.id]);
      }
    },30000);
    return()=>clearInterval(ruleCheckRef.current);
  },[work,rules,selectedRule,curLoc,triggeredRules]);

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
    setWork({start:Date.now(),pauses:[],paused:false,taetigkeit:ta,ruleType:selectedRule});
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
    if(drive.paused){
      // Resuming: no modal needed
      const ts=Date.now();
      logA("PAUSE_ENDE","Lenkzeit",curLoc);
      setDrive(d=>({...d,paused:false,pauses:d.pauses.map((p,i)=>i===d.pauses.length-1?{...p,end:ts}:p)}));
    }else{
      // Pausing: ask if work should pause too
      setDrivepauseModal(true);
    }
  };

  const confirmDrivePause=()=>{
    const ts=Date.now();
    logA("PAUSE_START","Lenkzeit",curLoc);
    setDrive(d=>({...d,paused:true,pauses:[...d.pauses,{start:ts}]}));
    setDrivepauseModal(false);
  };

  const confirmDrivePauseBoth=()=>{
    const ts=Date.now();
    logA("PAUSE_START","Lenkzeit+Arbeit",curLoc);
    setDrive(d=>({...d,paused:true,pauses:[...d.pauses,{start:ts}]}));
    setWork(w=>({...w,paused:true,pauses:[...w.pauses,{start:ts}]}));
    setDrivepauseModal(false);
  };

  const stopDrive=()=>{
    const ts=Date.now();let d=drive;
    if(d.paused){
      d={...d,paused:false,pauses:d.pauses.map((p,i)=>i===d.pauses.length-1?{...p,end:ts}:p)};
    }
    const net=calcNet({...d,end:ts},ts),pm=calcPMs({...d,end:ts},ts);
    const newDriveSession={...d,end:ts,netMs:net,pauseMs:pm,location:curLoc};
    db.driveSessions.put(newDriveSession);
    setDriveSessions(p=>[...p,newDriveSession]);
    logA("FAHRT_ENDE",`${toH(net).toFixed(2)}h`,curLoc);
    setDrive(null);setShowDriveDot(true);
  };

  const finalizeStop=(stars,comment)=>{
    const ts=Date.now();
    if(drive){
      let d=drive;
      if(d.paused)d={...d,paused:false,pauses:d.pauses.map((p,i)=>i===d.pauses.length-1?{...p,end:ts}:p)};
      const finDrive={...d,end:ts,netMs:calcNet({...d,end:ts},ts),pauseMs:calcPMs({...d,end:ts},ts),location:curLoc};
      db.driveSessions.put(finDrive);
      setDriveSessions(p=>[...p,finDrive]);
      setDrive(null);setShowDriveDot(true);
    }
    let w=work;
    if(w.paused)w={...w,paused:false,pauses:w.pauses.map((p,i)=>i===w.pauses.length-1?{...p,end:ts}:p)};
    const finWork={...w,end:ts,netMs:calcNet({...w,end:ts},ts),pauseMs:calcPMs({...w,end:ts},ts),location:curLoc,stars,comment};
    db.workSessions.put(finWork);
    setWorkSessions(p=>[...p,finWork]);
    logA("AUSSTEMPELN",`★${stars}${comment?" | "+comment:""}`,curLoc);
    setWork(null);setShowWorkDot(true);
    setTriggeredRules([]);
    setShowInlineNote(false);setInlineNoteText("");
    if(view==="notizen")setView("tracker");
    setRatingModal(false);setDayStars(0);setDayComment("");
  };

  const saveInlineNote=()=>{
    if(!inlineNoteText.trim())return;
    const note={id:Date.now(),text:inlineNoteText.trim(),ts:Date.now(),loc:curLoc,images:[]};
    db.notes.put(note);
    setNotes(n=>[...n,note]);
    logA("NOTIZ",inlineNoteText.trim().slice(0,60),curLoc);
    setInlineNoteText("");setShowInlineNote(false);
  };

  const openEditSession=(session,type)=>{
    setEditSession({data:session,type});
    setEditStart(toDatetimeLocal(session.start));
    setEditEnd(toDatetimeLocal(session.end));
    setEditTaetigkeit(session.taetigkeit||"");
    setEditStars(session.stars||0);
  };

  const saveEditedSession=()=>{
    if(!editSession) return;
    const {data,type}=editSession;
    const newStart=new Date(editStart).getTime();
    const newEnd=new Date(editEnd).getTime();
    const newNetMs=Math.max(0,newEnd-newStart-(data.pauseMs||0));
    if(type==="Arbeit"){
      const updated={...data,start:newStart,end:newEnd,netMs:newNetMs,taetigkeit:editTaetigkeit,stars:editStars};
      db.workSessions.delete(data.start);
      db.workSessions.put(updated);
      setWorkSessions(ws=>ws.map(s=>s.start===data.start?updated:s));
    }else{
      const updated={...data,start:newStart,end:newEnd,netMs:newNetMs};
      db.driveSessions.delete(data.start);
      db.driveSessions.put(updated);
      setDriveSessions(ds=>ds.map(s=>s.start===data.start?updated:s));
    }
    setEditSession(null);
  };

  const startExtraTracker=()=>{
    if(!extraTrackerInput.trim()) return;
    const colorIdx=extraTrackers.length%EXTRA_COLORS.length;
    const et={id:Date.now(),label:extraTrackerInput.trim(),start:Date.now(),pauses:[],paused:false,rule:extraTrackerRule,color:EXTRA_COLORS[colorIdx]};
    setExtraTrackers(p=>[...p,et]);
    logA("EXTRA_START",et.label,curLoc);
    setExtraTrackerModal(false);setExtraTrackerInput("");setExtraTrackerRule("standard");
  };

  const pauseExtraTracker=(id)=>{
    const ts=Date.now();
    setExtraTrackers(ets=>ets.map(et=>{
      if(et.id!==id) return et;
      if(et.paused) return{...et,paused:false,pauses:et.pauses.map((p,i)=>i===et.pauses.length-1?{...p,end:ts}:p)};
      return{...et,paused:true,pauses:[...et.pauses,{start:ts}]};
    }));
  };

  const stopExtraTracker=(id)=>{
    const ts=Date.now();
    const et=extraTrackers.find(e=>e.id===id);
    if(!et) return;
    let finished={...et};
    if(finished.paused) finished={...finished,paused:false,pauses:finished.pauses.map((p,i)=>i===finished.pauses.length-1?{...p,end:ts}:p)};
    const netMs=calcNet({...finished,end:ts},ts);
    const session={...finished,end:ts,netMs,pauseMs:calcPMs({...finished,end:ts},ts)};
    setCustomSessions(p=>[...p,session]);
    setExtraTrackers(ets=>ets.filter(e=>e.id!==id));
    logA("EXTRA_STOP",`${et.label} ${toH(netMs).toFixed(2)}h`,curLoc);
  };

  const createRule=()=>{
    if(!newRuleText.trim()) return;
    const newRule={id:Date.now(),text:newRuleText,hours:newRuleHours,minutes:newRuleMinutes};
    setRules(r=>[...r,newRule]);
    setNewRuleText("");
    setNewRuleHours(1);
    setNewRuleMinutes(0);
  };

  const deleteRule=(ruleId)=>{
    setRules(r=>r.filter(ru=>ru.id!==ruleId));
    if(selectedRule===ruleId) setSelectedRule("standard");
  };

  const exportCSV=(fromStr,toStr)=>{
    const exportLimit=logCSVExport();
    if(exportLimit.blocked){alert("Zu viele CSV-Exporte!");return;}

    const from=fromStr?new Date(fromStr).getTime():0;
    const to=toStr?new Date(toStr).getTime()+86400000:Date.now();

    const filteredWorks=workSessions.filter(s=>s.start>=from&&s.start<to);
    const filteredDrives=driveSessions.filter(s=>s.start>=from&&s.start<to);
    const filteredNotes=notes.filter(n=>n.ts>=from&&n.ts<to&&(!n.images||n.images.length===0));
    const filteredGps=gpsLog.filter(g=>g.ts>=from&&g.ts<to);

    const hdr="type,datum,start_time,end_time,netto_hours,pause_minutes,activity,rating,location_lat,location_lng,location_accuracy,gps_count,comment,rule_type,altitude,speed";
    
    const rows=[
      ...filteredWorks.map(s=>{
        const locData=s.location?`"${s.location.lat}","${s.location.lng}","${s.location.acc}"`:'"","",""';
        const gpsForSession=filteredGps.filter(g=>g.ts>=s.start&&g.ts<=(s.end||now)).length;
        return `"Arbeit","${fmtDate(s.start)}","${fmtTime(s.start)}","${fmtTime(s.end)}","${toH(s.netMs).toFixed(3)}","${Math.round(s.pauseMs/60000)}","${s.taetigkeit||""}","${s.stars||0}",${locData},"${gpsForSession}","${s.comment||""}","${s.ruleType||"standard"}","",""`;
      }),
      ...filteredDrives.map(s=>{
        const locData=s.location?`"${s.location.lat}","${s.location.lng}","${s.location.acc}"`:'"","",""';
        const gpsForSession=filteredGps.filter(g=>g.ts>=s.start&&g.ts<=(s.end||now)).length;
        return `"Fahrt","${fmtDate(s.start)}","${fmtTime(s.start)}","${fmtTime(s.end)}","${toH(s.netMs).toFixed(3)}","${Math.round(s.pauseMs/60000)}","","","",${locData},"${gpsForSession}",""`;
      }),
      ...filteredNotes.map(n=>{
        const locData=n.loc?`"${n.loc.lat}","${n.loc.lng}","${n.loc.acc}"`:'"","",""';
        return `"Notiz","${fmtDate(n.ts)}","${fmtTime(n.ts)}","","","","${n.text.replace(/"/g,'""')}","",${locData},"0",""`;
      }),
      ...filteredGps.map(g=>`"GPS","${fmtDate(g.ts)}","${fmtTime(g.ts)}","","","","","","${g.lat}","${g.lng}","${g.acc}","1","","${g.context?.rule_applied||""}","${g.altitude||""}","${g.speed||""}"`)
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
    db.workSessions.where('start').between(from,to,true,false).delete();
    db.driveSessions.where('start').between(from,to,true,false).delete();
    db.notes.where('ts').between(from,to,true,false).delete();
    db.actionLog.where('ts').between(from,to,true,false).delete();
    db.gpsLog.where('ts').between(from,to,true,false).delete();
    logA("DATEN_GELÖSCHT",`${fromStr||"Anfang"} bis ${toStr||"Heute"}`,null);
    setDeleteModal(false);
    setDeleteConfirm(false);
    setDeleteFromDate("");
    setDeleteToDate("");
    setDeleteAll(false);
  };

  const ws2=new Date();ws2.setDate(ws2.getDate()-ws2.getDay()+1);ws2.setHours(0,0,0,0);
  const weekMs=workSessions.filter(s=>s.start>=ws2).reduce((s,x)=>s+x.netMs,0);

  const getThemeColors=()=>{
    if(dark) return{bg:"#0f1117",card:"#1a1d27",s2:"#23263a",border:"#2d314840",text:"#e2e8f0",muted:"#94a3b8",hint:"#475569",backdrop:""};
    return{bg:"#f4f5f7",card:"#ffffff",s2:"#f1f2f6",border:"#e2e4ed",text:"#0f172a",muted:"#475569",hint:"#94a3b8",backdrop:""};
  };

  const t=getThemeColors();
  const C=(bc)=>({background:t.card,borderRadius:14,border:`1px solid ${bc||t.border}`,padding:"18px 20px",marginBottom:12,backdropFilter:t.backdrop});
  const Btn=(bg,col,bd)=>({padding:"10px",borderRadius:8,border:bd||"none",background:bg,color:col,fontSize:13,fontWeight:500,cursor:"pointer",flex:1});

  return(
    <div style={{fontFamily:"system-ui,-apple-system,sans-serif",background:t.bg,minHeight:"100vh",color:t.text}}>
      {appLoading&&<div style={{position:"fixed",inset:0,background:"#0f1117",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,color:"#94a3b8",fontSize:14}}>Laden…</div>}
      <style>{`@keyframes dp{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(1.5)}}.dp{animation:dp 2s ease-in-out infinite}.dpf{animation:dp 1.4s ease-in-out infinite}@keyframes banana{0%{transform:rotate(-20deg) scale(1.1)}50%{transform:rotate(20deg) scale(1.1)}100%{transform:rotate(-20deg) scale(1.1)}}.banana{animation:banana 0.5s ease-in-out infinite;display:inline-block;font-size:72px;line-height:1}body{margin:0;padding:0}`}</style>

      {!isPWA()&&installPrompt&&(
        <div style={{background:"#6366f1",color:"white",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:14,fontWeight:500}}>📱 Zum Homescreen hinzufügen</span>
          <button onClick={async()=>{await installPrompt.prompt();const r=await installPrompt.userChoice;if(r.outcome==="accepted")setInstallPrompt(null);}} style={{background:"white",color:"#6366f1",border:"none",padding:"10px 20px",borderRadius:8,fontSize:14,fontWeight:600,cursor:"pointer"}}>Installieren</button>
        </div>
      )}

      <nav style={{background:t.card,borderBottom:`0.5px solid ${t.border}`,padding:"11px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",backdropFilter:t.backdrop}}>
        <div style={{fontWeight:600,fontSize:15,display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:26,height:26,background:"#6366f1",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:13}}>⏱</div>
          ZeitTracker
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center"}}>
          {work&&(
            <>
              <button onClick={()=>setView(view==="gps"?"tracker":"gps")} style={{padding:"5px 11px",borderRadius:8,border:`0.5px solid ${t.border}`,background:view==="gps"?"#6366f1":"transparent",color:view==="gps"?"white":t.muted,fontSize:11,fontWeight:500,cursor:"pointer"}}>📍 GPS</button>
              <button onClick={()=>setRuleManagerOpen(true)} style={{padding:"5px 11px",borderRadius:8,border:`0.5px solid ${t.border}`,background:"transparent",color:t.muted,fontSize:11,fontWeight:500,cursor:"pointer"}}>⚙ Regel</button>
            </>
          )}
          {[["tracker","Tracker"],["notizen","Notizen"],["dashboard","Dashboard"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{padding:"5px 13px",borderRadius:8,border:view===v?"none":`0.5px solid ${t.border}`,background:view===v?"#6366f1":"transparent",color:view===v?"white":t.muted,fontSize:12,fontWeight:500,cursor:"pointer"}}>{l}</button>
          ))}
        </div>
      </nav>

      <div style={{padding:"18px 18px 90px",maxWidth:660,margin:"0 auto"}}>

        <div style={{textAlign:"center",padding:"24px 0 8px"}}>
          <span className="banana">🍌</span>
        </div>

        {view==="tracker"&&(
          <>
            <div style={C(work?wCol+"50":t.border)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:work?14:0}}>
                <span style={{fontSize:11,fontWeight:500,color:t.hint,textTransform:"uppercase",letterSpacing:"0.07em"}}>Arbeitszeit{work&&work.taetigkeit?` · ${work.taetigkeit}`:""}</span>
                {work&&showWorkDot&&(<button onClick={()=>setShowWorkDot(false)} style={{background:"none",border:"none",cursor:"pointer",padding:2}}><div className="dp" style={{width:9,height:9,borderRadius:"50%",background:wCol}}/></button>)}
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

            {work&&(
              <>
                {!driveExpanded?<div style={C(drive?dCol+"50":t.border,0,0)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>setDriveExpanded(true)}>
                    <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                      <span style={{fontSize:20}}>🚗</span>
                      <div>
                        <div style={{fontSize:12,fontWeight:500,color:t.text}}>Fahrt-Modus</div>
                        {drive?<div style={{fontSize:14,fontWeight:500,color:dCol}}>{fmtMs(dNet)}</div>:<div style={{fontSize:12,color:t.hint}}>Tippen zum Starten</div>}
                      </div>
                    </div>
                    {drive&&showDriveDot&&(<button onClick={e=>{e.stopPropagation();setShowDriveDot(false);}} style={{background:"none",border:"none",cursor:"pointer",padding:2}}><div className="dpf" style={{width:9,height:9,borderRadius:"50%",background:dCol}}/></button>)}
                    <span style={{fontSize:16}}>▼</span>
                  </div>
                  {drive&&<div style={{display:"flex",gap:6,marginTop:10}}>
                    <button onClick={e=>{e.stopPropagation();handleDrivePause();}} style={{padding:"6px 12px",borderRadius:6,border:`0.5px solid ${t.border}`,background:"transparent",fontSize:12,cursor:"pointer",flex:1}}>{drive.paused?"▶":"⏸"}</button>
                    <button onClick={e=>{e.stopPropagation();stopDrive();}} style={{padding:"6px 12px",borderRadius:6,background:"#ef444414",border:"0.5px solid #ef444440",fontSize:12,color:"#ef4444",cursor:"pointer",flex:1}}>⏹</button>
                  </div>}
                </div>:<div style={C(dCol+"50")}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <span style={{fontSize:11,fontWeight:500,color:t.hint,textTransform:"uppercase"}}>Lenkzeit</span>
                    {drive&&showDriveDot&&(<button onClick={()=>setShowDriveDot(false)} style={{background:"none",border:"none",cursor:"pointer",padding:2}}><div className="dpf" style={{width:9,height:9,borderRadius:"50%",background:dCol}}/></button>)}
                  </div>
                  {drive?(
                    <>
                      <div style={{textAlign:"center",padding:"6px 0 14px"}}>
                        <div style={{fontSize:58,fontWeight:400,fontVariantNumeric:"tabular-nums",letterSpacing:"-0.03em",color:dCol,lineHeight:1}}>{fmtMs(dNet)}</div>
                        {dPMs>0&&<div style={{fontSize:12,color:t.hint,marginTop:5}}>Pausen {fmtMs(dPMs)}</div>}
                      </div>
                      {dOver.map(r=><div key={r.h} style={{background:"#ef444414",border:"0.5px solid #ef444450",borderRadius:8,padding:"7px 12px",fontSize:12,color:"#ef4444",marginBottom:6}}>⚠ {r.label}</div>)}
                      {dWarn.map(r=><div key={r.h} style={{background:"#f9731612",border:"0.5px solid #f9731640",borderRadius:8,padding:"7px 12px",fontSize:12,color:"#f97316",marginBottom:6}}>⏰ {r.label}</div>)}
                      <div style={{display:"flex",gap:8,marginTop:4}}>
                        <button onClick={handleDrivePause} style={Btn(t.s2,t.text,`0.5px solid ${t.border}`)}>{drive.paused?"▶":"⏸"}</button>
                        <button onClick={stopDrive} style={Btn("#3b82f614","#3b82f6","0.5px solid #3b82f640")}>⏹ Ende</button>
                        <button onClick={()=>setDriveExpanded(false)} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>⬇ Einklappen</button>
                      </div>
                    </>
                  ):(
                    <div style={{paddingTop:14}}>
                      <button onClick={()=>setRuleDialogOpen(true)} disabled={work.paused} style={{width:"100%",padding:"11px",background:work.paused?"#3b82f608":"#3b82f614",border:"0.5px solid #3b82f640",borderRadius:8,color:work.paused?"#3b82f650":"#3b82f6",fontSize:13,fontWeight:500,cursor:work.paused?"default":"pointer"}}>🚗 Fahrt starten</button>
                    </div>
                  )}
                </div>}
              </>
            )}

            {work&&(
              <>
                {extraTrackers.map(et=>{
                  const etNet=calcNet(et,now),etPMs=calcPMs(et,now);
                  return(
                    <div key={et.id} style={{...C(et.color+"60"),marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                        <span style={{fontSize:11,fontWeight:500,color:et.color,textTransform:"uppercase",letterSpacing:"0.07em"}}>{et.label}</span>
                        {!et.paused&&<div style={{width:8,height:8,borderRadius:"50%",background:et.color,animation:"dp 2s ease-in-out infinite"}}/>}
                      </div>
                      <div style={{textAlign:"center",padding:"4px 0 10px"}}>
                        <div style={{fontSize:44,fontWeight:400,fontVariantNumeric:"tabular-nums",color:et.color,lineHeight:1}}>{fmtMs(etNet)}</div>
                        {etPMs>0&&<div style={{fontSize:11,color:t.hint,marginTop:4}}>Pausen {fmtMs(etPMs)}</div>}
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>pauseExtraTracker(et.id)} style={Btn(t.s2,t.text,`0.5px solid ${t.border}`)}>{et.paused?"▶ Weiter":"⏸ Pause"}</button>
                        <button onClick={()=>stopExtraTracker(et.id)} style={Btn("#ef444414","#ef4444","0.5px solid #ef444440")}>⏹ Stop</button>
                      </div>
                    </div>
                  );
                })}
                <button onClick={()=>setExtraTrackerModal(true)} style={{width:"100%",padding:"8px",background:"transparent",border:`0.5px dashed ${t.border}`,borderRadius:10,color:t.hint,fontSize:13,cursor:"pointer",marginBottom:8}}>+ Weiterer Tracker</button>
              </>
            )}

            {work&&(
              !showInlineNote?(
                <button onClick={()=>setShowInlineNote(true)} style={{width:"100%",padding:"10px 14px",background:"transparent",border:`0.5px solid ${t.border}`,borderRadius:10,color:t.hint,fontSize:13,cursor:"pointer",textAlign:"left"}}>✏ Notiz erfassen...</button>
              ):(
                <div style={C()}>
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

        {view==="gps"&&work&&(
          <div style={C()}>
            <div style={{fontWeight:500,fontSize:14,marginBottom:14}}>GPS-Intervall</div>
            {[{v:10,l:"Alle 10 Min"},{v:30,l:"Alle 30 Min"},{v:60,l:"Alle 60 Min"},{v:0,l:"Aus"}].map(opt=>(
              <button key={opt.v} onClick={()=>setGpsInterval(opt.v)} style={{width:"100%",padding:"12px",borderRadius:8,border:`2px solid ${gpsInterval===opt.v?"#6366f1":t.border}`,background:gpsInterval===opt.v?"#6366f114":"transparent",color:gpsInterval===opt.v?"#6366f1":t.text,fontSize:13,fontWeight:500,cursor:"pointer",marginBottom:8,textAlign:"left"}}>{gpsInterval===opt.v?"✓ ":""}{opt.l}</button>
            ))}
          </div>
        )}

        {view==="notizen"&&(
          <>
            <div style={{fontWeight:500,marginBottom:14,fontSize:15}}>Notizen</div>
            {notes.length===0?(
              <div style={{textAlign:"center",padding:"50px 0",color:t.hint,fontSize:13}}>Keine Notizen</div>
            ):[...notes].reverse().map(n=>(
              <div key={n.id} style={C()}>
                <div style={{fontSize:14,lineHeight:1.6,marginBottom:8}}>{n.text}</div>
                {n.images&&n.images.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginBottom:8}}>
                  {n.images.map(img=><img key={img.id} src={img.dataUrl} alt="note" style={{width:"100%",borderRadius:6,maxHeight:150,objectFit:"cover"}}/>)}
                </div>}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11,color:t.hint}}>
                  <span>{fmtDate(n.ts)} {fmtTime(n.ts)}{n.images&&n.images.length>0&&` · ${n.images.length} Bilder`}</span>
                  <button onClick={()=>{setNotes(ns=>ns.filter(x=>x.id!==n.id));db.notes.delete(n.id);}} style={{border:"none",background:"none",color:"#ef4444",cursor:"pointer"}}>✕</button>
                </div>
              </div>
            ))}
          </>
        )}

        {view==="dashboard"&&(
          <>
            <div style={{fontWeight:500,marginBottom:12,fontSize:15}}>Dashboard</div>
            <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",fontSize:12}}>
              <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                <input type="checkbox" checked={dashboardFilters.gps} onChange={e=>setDashboardFilters(f=>({...f,gps:e.target.checked}))} style={{cursor:"pointer"}}/>
                GPS
              </label>
              <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                <input type="checkbox" checked={dashboardFilters.notes} onChange={e=>setDashboardFilters(f=>({...f,notes:e.target.checked}))} style={{cursor:"pointer"}}/>
                Notizen
              </label>
              <select value={dashboardFilters.daysBack} onChange={e=>setDashboardFilters(f=>({...f,daysBack:parseInt(e.target.value)}))} style={{padding:"6px 10px",borderRadius:6,border:`0.5px solid ${t.border}`,background:t.s2,color:t.text,fontSize:12,cursor:"pointer"}}>
                <option value={7}>7 Tage</option>
                <option value={30}>30 Tage</option>
                <option value={90}>90 Tage</option>
                <option value={999}>Alle</option>
              </select>
            </div>

            <div style={C()}>
              <div style={{display:"flex",gap:8,marginBottom:12}}>
                <button onClick={()=>{setExportModal(true);}} style={{padding:"6px 12px",borderRadius:7,border:`0.5px solid ${t.border}`,background:"transparent",color:t.muted,fontSize:12,cursor:"pointer"}}>↓ CSV</button>
                <button onClick={()=>{setDeleteModal(true);}} style={{padding:"6px 12px",borderRadius:7,border:`0.5px solid #ef444440`,background:"transparent",color:"#ef4444",fontSize:12,cursor:"pointer"}}>🗑 Löschen</button>
              </div>

              {(() => {
                const filterDate=new Date();filterDate.setDate(filterDate.getDate()-dashboardFilters.daysBack);
                let entries=[
                  ...workSessions.map(s=>({...s,type:"Arbeit"})),
                  ...driveSessions.map(s=>({...s,type:"Fahrt"})),
                  ...customSessions.map(s=>({...s,type:"Extra"})),
                ];
                if(dashboardFilters.gps) entries=[...entries,...gpsLog.map(g=>({ts:g.ts,type:"GPS",lat:g.lat,lng:g.lng}))];
                if(dashboardFilters.notes) entries=[...entries,...notes.map(n=>({...n,type:"Notiz"}))];
                entries=entries.filter(e=>new Date(e.ts||e.start)>=filterDate);
                if(entries.length===0) return <div style={{textAlign:"center",padding:"30px",color:t.hint}}>Keine Einträge</div>;
                const typeColor={Arbeit:"#6366f1",Fahrt:"#3b82f6",Extra:"#8b5cf6",GPS:"#f97316",Notiz:"#94a3b8"};
                return entries.sort((a,b)=>(b.ts||b.start)-(a.ts||a.start)).map((s,i)=>(
                  <div key={i} style={{padding:"10px 0",borderBottom:`0.5px solid ${t.border}`,fontSize:12}}>
                    <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4,justifyContent:"space-between"}}>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:(typeColor[s.type]||"#6366f1")+"14",color:typeColor[s.type]||"#6366f1"}}>{s.type==="Extra"?s.label||"Extra":s.type}</span>
                        {s.taetigkeit&&<span style={{color:t.hint}}>{s.taetigkeit}</span>}
                        {s.netMs&&<span style={{color:t.hint}}>{toH(s.netMs).toFixed(2)}h</span>}
                        {s.stars>0&&<span style={{color:"#eab308"}}>{"★".repeat(s.stars)}</span>}
                      </div>
                      {(s.type==="Arbeit"||s.type==="Fahrt")&&s.end&&(
                        <button onClick={()=>openEditSession(s,s.type)} style={{padding:"2px 8px",border:`0.5px solid ${t.border}`,borderRadius:5,background:"transparent",color:t.muted,fontSize:11,cursor:"pointer"}}>✎ Edit</button>
                      )}
                    </div>
                    <div style={{color:t.hint}}>{fmtDate(s.ts||s.start)} {fmtTime(s.ts||s.start)}{s.type!=="GPS"&&s.type!=="Notiz"&&s.end?`–${fmtTime(s.end)}`:""}</div>
                    {s.comment&&<div style={{color:t.hint,marginTop:2,fontStyle:"italic"}}>{s.comment}</div>}
                  </div>
                ));
              })()}
            </div>
          </>
        )}
      </div>

      {ruleDialogOpen&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box",backdropFilter:t.backdrop}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>Regel auswählen</div>
            {[{id:"standard",name:"Ohne Regel"},{id:"arv1",name:"Nach ARV1"},...rules].map(opt=>(
              <button key={opt.id} onClick={()=>{setSelectedRule(opt.id);setRuleDialogOpen(false);setDrive({start:Date.now(),pauses:[],paused:false});setNow(Date.now());logA("FAHRT_START",opt.name||opt.text,curLoc);}} style={{width:"100%",padding:"12px",borderRadius:8,border:`2px solid ${selectedRule===opt.id?"#6366f1":t.border}`,background:selectedRule===opt.id?"#6366f114":"transparent",color:selectedRule===opt.id?"#6366f1":t.text,fontSize:13,fontWeight:500,cursor:"pointer",marginBottom:8,textAlign:"left"}}>
                {selectedRule===opt.id?"✓ ":""}  {opt.name||opt.text}
              </button>
            ))}
            <button onClick={()=>setRuleDialogOpen(false)} style={{width:"100%",padding:"10px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,fontSize:13,cursor:"pointer"}}>Abbrechen</button>
          </div>
        </div>
      )}

      {ruleManagerOpen&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box",maxHeight:"80vh",overflowY:"auto",backdropFilter:t.backdrop}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>Regeln verwalten</div>
            <div style={{marginBottom:16,padding:12,background:t.s2,borderRadius:8}}>
              <div style={{fontSize:12,color:t.hint,marginBottom:8}}>Neue Regel</div>
              <div style={{display:"flex",gap:8,marginBottom:8}}>
                <input type="number" value={newRuleHours} onChange={e=>setNewRuleHours(Math.max(0,parseInt(e.target.value)||0))} placeholder="Std" min="0" style={{width:"50px",padding:"8px",background:t.bg,border:`0.5px solid ${t.border}`,borderRadius:6,color:t.text}}/>
                <span>:</span>
                <input type="number" value={newRuleMinutes} onChange={e=>setNewRuleMinutes(Math.min(59,Math.max(0,parseInt(e.target.value)||0)))} placeholder="Min" min="0" max="59" style={{width:"50px",padding:"8px",background:t.bg,border:`0.5px solid ${t.border}`,borderRadius:6,color:t.text}}/>
              </div>
              <input type="text" value={newRuleText} onChange={e=>setNewRuleText(e.target.value)} placeholder="Meldungstext" style={{width:"100%",padding:"8px",background:t.bg,border:`0.5px solid ${t.border}`,borderRadius:6,color:t.text,boxSizing:"border-box",marginBottom:8}}/>
              <button onClick={createRule} disabled={!newRuleText.trim()} style={{width:"100%",padding:"8px",background:newRuleText.trim()?"#6366f1":"#6366f140",border:"none",borderRadius:6,color:"white",fontSize:12,cursor:"pointer"}}>+ Hinzufügen</button>
            </div>
            {rules.map(r=>(
              <div key={r.id} style={{padding:10,background:t.s2,borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,fontSize:12}}>
                <div><div style={{fontWeight:500}}>{r.text}</div><div style={{color:t.hint}}>{pad(r.hours)}:{pad(r.minutes)}</div></div>
                <button onClick={()=>deleteRule(r.id)} style={{padding:"4px 8px",background:"#ef444414",border:"none",borderRadius:6,color:"#ef4444",fontSize:11,cursor:"pointer"}}>Löschen</button>
              </div>
            ))}
            <button onClick={()=>setRuleManagerOpen(false)} style={{width:"100%",marginTop:16,padding:"10px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,cursor:"pointer"}}>Schließen</button>
          </div>
        </div>
      )}

      {drivepauseModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box"}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>Lenkzeit pausieren</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={confirmDrivePause} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Nur Fahrt</button>
              <button onClick={confirmDrivePauseBoth} style={Btn("#6366f1","white")}>Fahrt + Arbeit</button>
            </div>
          </div>
        </div>
      )}

      {editSession&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box",maxHeight:"85vh",overflowY:"auto"}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>Eintrag bearbeiten · {editSession.type}</div>
            <div style={{fontSize:12,color:t.hint,marginBottom:4}}>Start</div>
            <input type="datetime-local" value={editStart} onChange={e=>setEditStart(e.target.value)} style={{width:"100%",padding:"10px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,marginBottom:12,boxSizing:"border-box"}}/>
            <div style={{fontSize:12,color:t.hint,marginBottom:4}}>Ende</div>
            <input type="datetime-local" value={editEnd} onChange={e=>setEditEnd(e.target.value)} style={{width:"100%",padding:"10px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,marginBottom:12,boxSizing:"border-box"}}/>
            {editSession.type==="Arbeit"&&<>
              <div style={{fontSize:12,color:t.hint,marginBottom:4}}>Tätigkeit</div>
              <input type="text" value={editTaetigkeit} onChange={e=>setEditTaetigkeit(e.target.value)} style={{width:"100%",padding:"10px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,marginBottom:12,boxSizing:"border-box"}}/>
              <div style={{fontSize:12,color:t.hint,marginBottom:8}}>Bewertung</div>
              <div style={{display:"flex",gap:8,marginBottom:16}}>
                {[1,2,3,4,5].map(s=>(
                  <button key={s} onClick={()=>setEditStars(s)} style={{background:"none",border:`2px solid ${s<=editStars?"#6366f1":t.border}`,borderRadius:8,fontSize:24,cursor:"pointer",opacity:s<=editStars?1:0.3,padding:"6px",flex:1}}>★</button>
                ))}
              </div>
            </>}
            <div style={{fontSize:11,color:t.hint,marginBottom:14}}>
              Netto: {toH(Math.max(0,new Date(editEnd).getTime()-new Date(editStart).getTime()-(editSession.data.pauseMs||0))).toFixed(2)}h (Pausen bleiben erhalten)
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setEditSession(null)} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Abbrechen</button>
              <button onClick={saveEditedSession} style={Btn("#6366f1","white")}>Speichern</button>
            </div>
          </div>
        </div>
      )}

      {extraTrackerModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box",maxHeight:"80vh",overflowY:"auto"}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>Weiterer Tracker</div>
            <input autoFocus value={extraTrackerInput} onChange={e=>setExtraTrackerInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")startExtraTracker();}} placeholder="z.B. Besprechung, Ladezeit..." style={{width:"100%",padding:"12px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:9,color:t.text,boxSizing:"border-box",marginBottom:14}}/>
            <div style={{fontSize:12,color:t.hint,marginBottom:8}}>Regel</div>
            {[{id:"standard",name:"Ohne Regel"},...rules].map(opt=>(
              <button key={opt.id} onClick={()=>setExtraTrackerRule(opt.id)} style={{width:"100%",padding:"10px",borderRadius:8,border:`2px solid ${extraTrackerRule===opt.id?"#6366f1":t.border}`,background:extraTrackerRule===opt.id?"#6366f114":"transparent",color:extraTrackerRule===opt.id?"#6366f1":t.text,fontSize:12,cursor:"pointer",marginBottom:6,textAlign:"left"}}>
                {extraTrackerRule===opt.id?"✓ ":""}{opt.name||opt.text}
              </button>
            ))}
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <button onClick={()=>{setExtraTrackerModal(false);setExtraTrackerInput("");}} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Abbrechen</button>
              <button onClick={startExtraTracker} disabled={!extraTrackerInput.trim()} style={Btn(extraTrackerInput.trim()?"#6366f1":"#6366f140","white")}>Starten</button>
            </div>
          </div>
        </div>
      )}

      {exportModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box",backdropFilter:t.backdrop}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>CSV exportieren</div>
            <input type="date" value={exportFromDate} onChange={e=>setExportFromDate(e.target.value)} style={{width:"100%",padding:"10px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,marginBottom:10,boxSizing:"border-box"}}/>
            <input type="date" value={exportToDate} onChange={e=>setExportToDate(e.target.value)} style={{width:"100%",padding:"10px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,marginBottom:12,boxSizing:"border-box"}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setExportModal(false)} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Abbrechen</button>
              <button onClick={()=>exportCSV(exportFromDate,exportToDate)} style={Btn("#6366f1","white")}>↓ Exportieren</button>
            </div>
          </div>
        </div>
      )}

      {deleteModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box",backdropFilter:t.backdrop}}>
            {!deleteConfirm?(
              <>
                <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>Daten löschen</div>
                <input type="date" value={deleteFromDate} onChange={e=>setDeleteFromDate(e.target.value)} disabled={deleteAll} style={{width:"100%",padding:"10px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,marginBottom:10,boxSizing:"border-box"}}/>
                <input type="date" value={deleteToDate} onChange={e=>setDeleteToDate(e.target.value)} disabled={deleteAll} style={{width:"100%",padding:"10px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:8,color:t.text,marginBottom:12,boxSizing:"border-box"}}/>
                <label style={{display:"flex",gap:8,alignItems:"center",marginBottom:16,padding:"12px",background:t.s2,borderRadius:8,cursor:"pointer"}}>
                  <input type="checkbox" checked={deleteAll} onChange={e=>setDeleteAll(e.target.checked)} style={{cursor:"pointer"}}/>
                  <span style={{fontSize:13}}>Alles löschen</span>
                </label>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setDeleteModal(false)} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Abbrechen</button>
                  <button onClick={()=>setDeleteConfirm(true)} style={Btn("#ef4444","white")}>Weiter</button>
                </div>
              </>
            ):(
              <>
                <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>Bestätigung</div>
                <div style={{fontSize:13,color:"#ef4444",background:"#ef444414",border:"0.5px solid #ef444440",borderRadius:8,padding:12,marginBottom:16}}>
                  {deleteAll?"Alle Daten werden gelöscht!":`Daten von ${deleteFromDate||"Anfang"} bis ${deleteToDate||"Heute"}`}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setDeleteConfirm(false)} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Zurück</button>
                  <button onClick={()=>deleteData(deleteAll?null:deleteFromDate,deleteAll?null:deleteToDate)} style={Btn("#ef4444","white")}>✓ Löschen</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {taetigkeitModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box",backdropFilter:t.backdrop}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>Tätigkeit</div>
            <input autoFocus value={taetigkeitInput} onChange={e=>setTaetigkeitInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")startWork();}} placeholder="z.B. Fahrer, Lager, Disposition..." style={{width:"100%",padding:"12px",background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:9,color:t.text,boxSizing:"border-box",marginBottom:12}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setTaetigkeitModal(false)} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Abbrechen</button>
              <button onClick={startWork} style={Btn("#6366f1","white")}>Starten</button>
            </div>
          </div>
        </div>
      )}

      {confirmStop&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box",backdropFilter:t.backdrop}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>Schicht beenden?</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setConfirmStop(false)} style={Btn(t.s2,t.muted,`0.5px solid ${t.border}`)}>Nein</button>
              <button onClick={()=>{setConfirmStop(false);setRatingModal(true);}} style={Btn("#6366f1","white")}>Ja</button>
            </div>
          </div>
        </div>
      )}

      {ratingModal&&(
        <div style={{position:"fixed",inset:0,background:"#00000070",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:t.card,borderRadius:"16px 16px 0 0",padding:"22px 20px",maxWidth:660,margin:"0 auto",boxSizing:"border-box",backdropFilter:t.backdrop}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:16}}>Wie war dein Tag?</div>
            <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:18}}>
              {[1,2,3,4,5].map(s=>(
                <button key={s} onClick={()=>setDayStars(s)} style={{background:"none",border:`2px solid ${s<=dayStars?"#6366f1":t.border}`,borderRadius:8,fontSize:32,cursor:"pointer",opacity:s<=dayStars?1:0.3,padding:"8px",color:s<=dayStars?"#6366f1":t.text}}>★</button>
              ))}
            </div>
            <textarea value={dayComment} onChange={e=>setDayComment(e.target.value)} placeholder="Bemerkungen (optional)..." style={{width:"100%",minHeight:72,background:t.s2,border:`0.5px solid ${t.border}`,borderRadius:9,padding:"10px",color:t.text,resize:"none",boxSizing:"border-box",marginBottom:12}}/>
            <button onClick={()=>finalizeStop(dayStars,dayComment.trim())} style={{width:"100%",padding:"12px",background:"#6366f1",border:"none",borderRadius:9,color:"white",fontWeight:500,cursor:"pointer"}}>Abschliessen</button>
          </div>
        </div>
      )}

      <div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",zIndex:100,display:"flex",gap:8}}>
        <button onClick={()=>setDark(d=>!d)} style={{padding:"8px 18px",borderRadius:99,background:t.card,border:`0.5px solid ${t.border}`,color:t.muted,fontSize:13,cursor:"pointer"}}>
          {dark?"☀ Hell":"🌙 Dunkel"}
        </button>
        <button onClick={toggleNotifications} title={notificationEnabled?"Benachrichtigungen aus":"Benachrichtigungen ein"} style={{padding:"8px 18px",borderRadius:99,background:t.card,border:`0.5px solid ${notificationEnabled?"#6366f1":t.border}`,color:notificationEnabled?"#6366f1":t.muted,fontSize:13,cursor:"pointer"}}>
          {notificationEnabled?"🔔":"🔕"}
        </button>
      </div>
    </div>
  );
}
