return(
  isPWA()?(
    // ← APP NUR WENN INSTALLIERT
    <div style={{fontFamily:"system-ui,-apple-system,sans-serif",background:t.bg,minHeight:"100vh",color:t.text}}>
      <style>{`@keyframes dp{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(1.5)}}.dp{animation:dp 2s ease-in-out infinite}.dpf{animation:dp 1.4s ease-in-out infinite}body{margin:0;padding:0}`}</style>

      {/* NAV + REST DER APP - kompletter bisheriger Code */}
      <nav style={{background:t.card,borderBottom:`0.5px solid ${t.border}`,padding:"11px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",backdropFilter:t.backdrop}}>
        {/* ... alles wie bisherig ... */}
      </nav>
      
      {/* Rest der App hier */}
    </div>
  ):(
    // ← NUR DOWNLOAD WENN NICHT INSTALLIERT
    <div style={{fontFamily:"system-ui,-apple-system,sans-serif",background:t.bg,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:t.text,padding:"20px"}}>
      <style>{`body{margin:0;padding:0}`}</style>
      
      <div style={{textAlign:"center",maxWidth:400}}>
        <div style={{fontSize:80,marginBottom:20}}>⏱</div>
        
        <h1 style={{fontSize:32,fontWeight:600,marginBottom:12}}>ZeitTracker</h1>
        <p style={{fontSize:14,color:t.muted,marginBottom:30,lineHeight:1.6}}>Arbeitszeiterfassung mit GPS, Fahrtmodus & intelligenten Regeln</p>
        
        <button onClick={()=>{const a=document.createElement("a");a.href=window.location.href;a.download="ZeitTracker.html";a.click();}} style={{width:"100%",padding:"16px",background:"#6366f1",border:"none",borderRadius:12,color:"white",fontSize:16,fontWeight:600,cursor:"pointer",marginBottom:12}}>
          ⬇ App Installieren
        </button>
        
        <div style={{fontSize:12,color:t.hint,padding:"20px",background:t.s2,borderRadius:10,marginTop:20}}>
          <p style={{marginBottom:10}}><strong>So geht's:</strong></p>
          <ol style={{textAlign:"left",lineHeight:1.8}}>
            <li>Klick auf "App Installieren"</li>
            <li>Datei speichern (ZeitTracker.html)</li>
            <li>Datei öffnen → Zur App hinzufügen</li>
            <li>Vom Homescreen aus starten</li>
          </ol>
        </div>

        <div style={{fontSize:11,color:t.muted,marginTop:20}}>
          Oder: Android/iPhone Browser → <br/> Menu → "App installieren"
        </div>
      </div>
    </div>
  )
);
