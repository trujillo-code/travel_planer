// @ts-nocheck
import { useState, useEffect, useRef } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

// ─── Date helpers ────────────────────────────────────────────────────────────
const addDays  = (s, n) => { if (!s) return ""; const d = new Date(s+"T00:00:00"); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
const diffDays = (a, b) => { if (!a||!b) return 0; return Math.round((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/86400000); };
const fmtDate  = (s) => { if (!s) return ""; return new Date(s+"T00:00:00").toLocaleDateString("es-ES",{weekday:"short",day:"numeric",month:"short"}); };
const fmtShort = (s) => { if (!s) return ""; return new Date(s+"T00:00:00").toLocaleDateString("es-ES",{day:"numeric",month:"short"}); };

// ─── Constants ───────────────────────────────────────────────────────────────
const DEST_COLORS = ["#E8845A","#5AB4E8","#7EC87E","#E8C45A","#B87EE8","#E85A8A","#5AE8C8","#E8A05A","#8AB85A","#5A8AE8"];
const ITEM_TYPES  = {
  activity:{ label:"Actividad", icon:"🎯", color:"#5AB4E8" },
  hotel:   { label:"Hospedaje",  icon:"🏨", color:"#7EC87E" },
  food:    { label:"Comida",     icon:"🍽️", color:"#E8845A" },
  note:    { label:"Nota",       icon:"📝", color:"#B87EE8" },
};
const TRANSIT_TYPES = [
  { key:"flight",    label:"Vuelo",          icon:"✈️",  color:"#5AB4E8" },
  { key:"bus",       label:"Bus / Autobús",  icon:"🚌",  color:"#7EC87E" },
  { key:"train",     label:"Tren",           icon:"🚄",  color:"#B87EE8" },
  { key:"car",       label:"Auto alquilado", icon:"🚗",  color:"#E8C45A" },
  { key:"ferry",     label:"Ferry / Barco",  icon:"⛴️",  color:"#5AE8C8" },
  { key:"transfer",  label:"Transfer",       icon:"🚐",  color:"#E8A05A" },
  { key:"other",     label:"Otro",           icon:"🛣️",  color:"#8AB85A" },
];
const uid   = () => Math.random().toString(36).slice(2,9);
const EMOJIS = ["🌍","🌎","🌏","✈️","🗺️","🏖️","🏔️","🎒","🏝️","🚀","🗼","🏰","🗡","🎭","🎪","🎠","🐚","🌅","🌵","🏠","🛕","🧳","🎑","🎸","🌸","🍜","☀️","❄️","🌊","⭐","🎿","🏴","🟠","🟡","🟢","🔵","🟣"];

// ─── App ─────────────────────────────────────────────────────────────────────
export default function TravelPlanner({ user, onSignOut }) {
  const [trips,          setTrips]          = useState([]);
  const [activeTrip,     setActiveTrip]     = useState(null);
  const [view,           setView]           = useState("home");
  const [tripView,       setTripView]       = useState("dest"); // dest | transits | summary
  const [modal,          setModal]          = useState(null);
  const [editingItem,    setEditingItem]    = useState(null);
  const [editingTransit, setEditingTransit] = useState(null);
  const [activeDestId,   setActiveDestId]   = useState(null);
  const [dayFilter,      setDayFilter]      = useState(null);
  const [form,           setForm]           = useState({});
  const [dataLoaded,     setDataLoaded]     = useState(false);
  const [saving,         setSaving]         = useState(false);
  const saveTimer = useRef(null);

  // ── Load trips from Firestore on mount ─────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "userData", user.uid));
        if (snap.exists()) {
          setTrips(snap.data().trips || []);
        }
      } catch (err) {
        console.error("Error loading data:", err);
      }
      setDataLoaded(true);
    };
    load();
  }, [user?.uid]);

  // ── Save trips to Firestore when they change (debounced) ───────────────────
  useEffect(() => {
    if (!dataLoaded || !user?.uid) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await setDoc(doc(db, "userData", user.uid), { trips, updatedAt: Date.now() });
      } catch (err) {
        console.error("Error saving data:", err);
      }
      setSaving(false);
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [trips, dataLoaded, user?.uid]);

  const trip       = trips.find(t => t.id === activeTrip);
  const activeDest = trip?.destinations.find(d => d.id === activeDestId);

  // ── Computed ───────────────────────────────────────────────────────────────
  const itemsCost    = trip?.destinations.reduce((s,d)=>s+d.items.reduce((ss,i)=>ss+(i.cost||0),0),0)||0;
  const transitsCost = trip?.transits?.reduce((s,t)=>s+(t.cost||0),0)||0;
  const totalCost    = itemsCost + transitsCost;
  const tripDays     = trip
    ? (trip.startDate&&trip.endDate ? diffDays(trip.startDate,trip.endDate)+1 : trip.destinations.reduce((s,d)=>s+d.days,0))
    : 0;

  // ── Smart date suggest for new dest ────────────────────────────────────────
  const suggestDates = () => {
    if (!trip) return { startDate:"", endDate:"", days:3 };
    const dests = trip.destinations;
    let start = dests.length===0 ? (trip.startDate||"")
      : (dests[dests.length-1].endDate ? addDays(dests[dests.length-1].endDate,1)
         : dests[dests.length-1].startDate ? addDays(dests[dests.length-1].startDate, dests[dests.length-1].days) : "");
    return { startDate:start, endDate:start?addDays(start,2):"", days:3 };
  };

  // Linked date/days handlers
  const setDestStart = sd => setForm(p=>({...p,startDate:sd,endDate:sd?addDays(sd,(Number(p.days)||3)-1):p.endDate}));
  const setDestEnd   = ed => setForm(p=>({...p,endDate:ed,days:Math.max(1,p.startDate&&ed?diffDays(p.startDate,ed)+1:p.days||3)}));
  const setDestDays  = n  => { const days=Math.max(1,Number(n)||1); setForm(p=>({...p,days,endDate:p.startDate?addDays(p.startDate,days-1):p.endDate})); };

  // Real date for local day in dest
  const dayToDate = (dest, localDay) => dest?.startDate ? addDays(dest.startDate, localDay-1) : null;

  // ── CRUD: Trips ────────────────────────────────────────────────────────────
  const closeModal = () => { setModal(null); setForm({}); setEditingItem(null); setEditingTransit(null); };

  const createTrip = () => {
    if (!form.name?.trim()) return;
    const t = { id:uid(), name:form.name, emoji:form.emoji||"🌍",
      startDate:form.startDate||"", endDate:form.endDate||"",
      budget:Number(form.budget)||0, destinations:[], transits:[], created:Date.now() };
    setTrips(p=>[...p,t]); setActiveTrip(t.id); setView("trip"); setTripView("dest"); closeModal();
  };
  const deleteTrip = id => { setTrips(p=>p.filter(t=>t.id!==id)); if(activeTrip===id){setActiveTrip(null);setView("home");} };

  // ── CRUD: Destinations ─────────────────────────────────────────────────────
  const openNewDest = () => { setForm({emoji:"📍",...suggestDates()}); setModal("newDest"); };

  const addDestination = () => {
    if (!form.name?.trim()||!activeTrip) return;
    const dest = { id:uid(), name:form.name, country:form.country||"", emoji:form.emoji||"📍",
      startDate:form.startDate||"", endDate:form.endDate||"", days:Number(form.days)||1,
      color:DEST_COLORS[trip.destinations.length%DEST_COLORS.length], items:[] };
    setTrips(p=>p.map(t=>t.id===activeTrip?{...t,destinations:[...t.destinations,dest]}:t));
    setActiveDestId(dest.id); setDayFilter(null); closeModal();
  };
  const deleteDest = destId => {
    setTrips(p=>p.map(t=>t.id===activeTrip?{...t,destinations:t.destinations.filter(d=>d.id!==destId)}:t));
    if(activeDestId===destId) setActiveDestId(null);
  };

  // ── CRUD: Items (inside destination) ───────────────────────────────────────
  const addItem = () => {
    if (!form.type||!activeDestId) return;
    const item = { id:uid(), type:form.type, title:form.title||"", time:form.time||"",
      day:Number(form.day)||1, duration:form.duration||"", cost:Number(form.cost)||0,
      address:form.address||"", notes:form.notes||"", confirmed:false };
    setTrips(p=>p.map(t=>t.id===activeTrip?{...t,destinations:t.destinations.map(d=>d.id===activeDestId?{...d,items:[...d.items,item]}:d)}:t));
    closeModal();
  };
  const saveItem = () => {
    if (!editingItem) return;
    setTrips(p=>p.map(t=>t.id===activeTrip?{...t,destinations:t.destinations.map(d=>({...d,items:d.items.map(i=>i.id===editingItem.id?{...i,...form}:i)}))}:t));
    closeModal();
  };
  const deleteItem = (destId,itemId) => setTrips(p=>p.map(t=>t.id===activeTrip?{...t,destinations:t.destinations.map(d=>d.id===destId?{...d,items:d.items.filter(i=>i.id!==itemId)}:d)}:t));
  const toggleConfirm = (destId,itemId) => setTrips(p=>p.map(t=>t.id===activeTrip?{...t,destinations:t.destinations.map(d=>d.id===destId?{...d,items:d.items.map(i=>i.id===itemId?{...i,confirmed:!i.confirmed}:i)}:d)}:t));
  const openEditItem = (destId,item) => { setActiveDestId(destId); setEditingItem(item); setForm({...item}); setModal("editItem"); };

  // ── CRUD: Transits ─────────────────────────────────────────────────────────
  const openNewTransit = () => {
    const dests = trip?.destinations || [];
    const pre = {
      transitType: "flight",
      fromDestId:  dests[0]?.id || "",
      toDestId:    dests[1]?.id || "",
      date:        dests[0]?.endDate || dests[0]?.startDate || "",
      cost: 0, confirmed: false,
    };
    setForm(pre); setModal("newTransit");
  };
  const openEditTransit = (transit) => { setEditingTransit(transit); setForm({...transit}); setModal("editTransit"); };

  const addTransit = () => {
    if (!form.transitType||!activeTrip) return;
    const tr = {
      id:uid(), transitType:form.transitType,
      fromDestId:  form.fromDestId  || "",
      toDestId:    form.toDestId    || "",
      viaDestIds:  form.viaDestIds  || [],
      title:       form.title       || "",
      date:        form.date        || "",
      returnDate:  form.returnDate  || "",
      departTime:  form.departTime  || "",
      arriveTime:  form.arriveTime  || "",
      provider:    form.provider    || "",
      confirmation:form.confirmation|| "",
      cost:        Number(form.cost)||0,
      notes:       form.notes       || "",
      confirmed:   false,
    };
    setTrips(p=>p.map(t=>t.id===activeTrip?{...t,transits:[...(t.transits||[]),tr]}:t));
    closeModal();
  };
  const saveTransit = () => {
    if (!editingTransit) return;
    setTrips(p=>p.map(t=>t.id===activeTrip?{...t,transits:(t.transits||[]).map(tr=>tr.id===editingTransit.id?{...tr,...form}:tr)}:t));
    closeModal();
  };
  const deleteTransit = id => setTrips(p=>p.map(t=>t.id===activeTrip?{...t,transits:(t.transits||[]).filter(tr=>tr.id!==id)}:t));
  const toggleTransitConfirm = id => setTrips(p=>p.map(t=>t.id===activeTrip?{...t,transits:(t.transits||[]).map(tr=>tr.id===id?{...tr,confirmed:!tr.confirmed}:tr)}:t));

  // ── Filtered items for current dest ────────────────────────────────────────
  const filteredItems = activeDest
    ? (dayFilter?activeDest.items.filter(i=>i.day===dayFilter):activeDest.items)
        .sort((a,b)=>a.day-b.day||(a.time||"").localeCompare(b.time||""))
    : [];

  // ── Build full itinerary for summary ───────────────────────────────────────
  const buildItinerary = () => {
    if (!trip) return [];
    let abs=1, rows=[];
    trip.destinations.forEach(dest=>{
      for(let d=1;d<=dest.days;d++){
        rows.push({ abs, dest, localDay:d,
          items:dest.items.filter(i=>i.day===d).sort((a,b)=>(a.time||"99").localeCompare(b.time||"99")),
          transits:(trip.transits||[]).filter(tr=>tr.fromDestId===dest.id && (
            !tr.date || tr.date===addDays(dest.startDate,d-1) || (!tr.date && d===dest.days)
          ))
        });
        abs++;
      }
    });
    return rows;
  };

  // ── Helpers for transit display ────────────────────────────────────────────
  const destName  = id => trip?.destinations.find(d=>d.id===id);
  const ttInfo    = key => TRANSIT_TYPES.find(t=>t.key===key)||TRANSIT_TYPES[6];
  const isRental  = key => key==="car";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#F7F4EF",color:"#1C1C1E",fontFamily:"Palatino,serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&family=DM+Sans:wght@300;400;500&display=swap');
        *{box-sizing:border-box}
        :root{--sand:#F7F4EF;--ink:#1C1C1E;--muted:#8A8580;--accent:#C4622D;--line:rgba(28,28,30,0.1)}
        body{margin:0}
        button,input,textarea,select{font-family:'DM Sans',sans-serif}
        .hov-dest:hover{background:rgba(196,98,45,0.06)!important}
        .hov-row:hover{background:rgba(28,28,30,0.025)!important}
        .hov-card:hover{transform:translateY(-3px);box-shadow:0 14px 44px rgba(28,28,30,.13)!important}
        .hov-ghost:hover{background:rgba(28,28,30,.06)!important}
        .hov-icon:hover{background:rgba(28,28,30,.08)!important}
        .hov-add:hover{border-color:var(--accent)!important;color:var(--accent)!important}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-thumb{background:rgba(28,28,30,.15);border-radius:2px}
        input:focus,textarea:focus,select:focus{outline:none;border-color:var(--accent)!important}
        .hint{font-size:.68rem;color:var(--accent);margin-top:-.5rem;margin-bottom:.75rem;font-family:'DM Sans',sans-serif}
        .transit-card:hover{box-shadow:0 4px 20px rgba(28,28,30,.1)!important;transform:translateY(-1px)}
      `}</style>

      {/* ── NAV ── */}
      <nav style={{position:"sticky",top:0,zIndex:200,background:"#F7F4EF",borderBottom:"1px solid var(--line)",height:"52px",display:"flex",alignItems:"center",padding:"0 1.5rem",gap:".75rem"}}>
        <button onClick={()=>setView("home")} style={{background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:".5rem"}}>
          <span style={{fontSize:"1.2rem"}}>🧭</span>
          <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",fontWeight:600,color:"var(--ink)"}}>Wanderplan</span>
        </button>
        {view==="trip"&&trip&&<>
          <span style={{color:"var(--line)",fontSize:"1.1rem"}}>›</span>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".85rem",color:"var(--muted)"}}>{trip.emoji} {trip.name}</span>
          {trip.startDate&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)",background:"rgba(28,28,30,.05)",padding:".15rem .6rem",borderRadius:"10px"}}>
            {fmtShort(trip.startDate)} → {fmtShort(trip.endDate||addDays(trip.startDate,tripDays-1))} · {tripDays}d
          </span>}
        </>}
        <div style={{flex:1}}/>
        {view==="trip"&&trip&&(
          <div style={{display:"flex",gap:".2rem",background:"rgba(28,28,30,.06)",borderRadius:"7px",padding:".2rem"}}>
            {[["dest","📍 Destinos"],["transits","🚀 Trayectos"],["summary","📋 Resumen"]].map(([v,l])=>(
              <button key={v} onClick={()=>setTripView(v)} style={{background:tripView===v?"#fff":"transparent",border:"none",color:tripView===v?"var(--ink)":"var(--muted)",padding:".3rem .8rem",borderRadius:"5px",cursor:"pointer",fontSize:".76rem",fontWeight:tripView===v?500:400,boxShadow:tripView===v?"0 1px 4px rgba(28,28,30,.1)":"none",transition:"all .15s",whiteSpace:"nowrap"}}>{l}</button>
            ))}
          </div>
        )}
        {saving&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".65rem",color:"var(--muted)",padding:".2rem .5rem",background:"rgba(28,28,30,.05)",borderRadius:"10px"}}>💾 Guardando...</span>}
        {view==="home"&&<button onClick={()=>{setForm({emoji:"🌍"});setModal("newTrip");}} style={{background:"var(--accent)",border:"none",color:"#fff",padding:".45rem 1.1rem",borderRadius:"6px",fontSize:".8rem",fontWeight:500,cursor:"pointer"}}>+ Nuevo viaje</button>}
        {view==="trip"&&tripView==="dest"&&<button onClick={openNewDest} style={{background:"var(--accent)",border:"none",color:"#fff",padding:".45rem 1.1rem",borderRadius:"6px",fontSize:".8rem",fontWeight:500,cursor:"pointer"}}>+ Destino</button>}
        {view==="trip"&&tripView==="transits"&&<button onClick={openNewTransit} style={{background:"var(--accent)",border:"none",color:"#fff",padding:".45rem 1.1rem",borderRadius:"6px",fontSize:".8rem",fontWeight:500,cursor:"pointer"}}>+ Trayecto</button>}
        {/* User menu */}
        <div style={{display:"flex",alignItems:"center",gap:".5rem",marginLeft:".5rem"}}>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)",maxWidth:"100px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user?.displayName || user?.email}</span>
          <button onClick={onSignOut} title="Cerrar sesión" style={{background:"rgba(28,28,30,.06)",border:"none",color:"var(--muted)",padding:".3rem .6rem",borderRadius:"5px",cursor:"pointer",fontSize:".72rem",fontFamily:"'DM Sans',sans-serif"}}>Salir</button>
        </div>
      </nav>

      {/* ── HOME ────────────────────────────────────────────────────────────── */}
      {view==="home"&&<div style={{maxWidth:"900px",margin:"0 auto",padding:"3rem 1.5rem"}}>
        <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"clamp(2.2rem,5vw,3.5rem)",fontWeight:300,margin:"0 0 .5rem",lineHeight:1.15}}>Tus <em>aventuras</em>,<br/>organizadas.</h1>
        <p style={{color:"var(--muted)",fontSize:".95rem",fontFamily:"'DM Sans',sans-serif",margin:"0 0 2.5rem"}}>Planifica destinos, actividades, trayectos entre ciudades y mucho más.</p>
        {trips.length===0
          ?<div style={{border:"2px dashed rgba(28,28,30,.15)",borderRadius:"12px",padding:"4rem 2rem",textAlign:"center"}}>
            <div style={{fontSize:"3.5rem",marginBottom:"1rem"}}>✈️</div>
            <p style={{color:"var(--muted)",fontFamily:"'DM Sans',sans-serif",margin:"0 0 1.5rem"}}>No tienes viajes aún. ¡Crea el primero!</p>
            <button onClick={()=>{setForm({emoji:"🌍"});setModal("newTrip");}} style={{background:"var(--accent)",border:"none",color:"#fff",padding:".7rem 2rem",borderRadius:"8px",fontSize:".9rem",fontWeight:500,cursor:"pointer"}}>Crear mi primer viaje</button>
          </div>
          :<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:"1rem"}}>
            {trips.map(t=>{
              const cost=t.destinations.reduce((s,d)=>s+d.items.reduce((ss,i)=>ss+(i.cost||0),0),0)+(t.transits||[]).reduce((s,tr)=>s+(tr.cost||0),0);
              const days=t.startDate&&t.endDate?diffDays(t.startDate,t.endDate)+1:t.destinations.reduce((s,d)=>s+d.days,0);
              return <div key={t.id} className="hov-card" onClick={()=>{setActiveTrip(t.id);setActiveDestId(t.destinations[0]?.id||null);setView("trip");setTripView("dest");}} style={{background:"#fff",border:"1px solid var(--line)",borderRadius:"12px",padding:"1.5rem",cursor:"pointer",transition:"all .25s",boxShadow:"0 2px 12px rgba(28,28,30,.06)"}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:"2.2rem"}}>{t.emoji}</span>
                  <button onClick={e=>{e.stopPropagation();deleteTrip(t.id);}} className="hov-icon" style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",padding:".2rem .4rem",borderRadius:"4px",fontSize:".85rem"}}>✕</button>
                </div>
                <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.3rem",fontWeight:600,margin:".75rem 0 .25rem"}}>{t.name}</h3>
                <div style={{fontSize:".75rem",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif",marginBottom:"1rem"}}>{t.startDate?`${fmtShort(t.startDate)} → ${fmtShort(t.endDate)}`:`${days} días`}</div>
                <div style={{display:"flex",gap:".5rem",flexWrap:"wrap",marginBottom:".75rem"}}>
                  <span style={{fontSize:".72rem",padding:".2rem .6rem",background:"rgba(28,28,30,.05)",borderRadius:"20px",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif"}}>📍 {t.destinations.length} destinos</span>
                  {(t.transits||[]).length>0&&<span style={{fontSize:".72rem",padding:".2rem .6rem",background:"rgba(90,180,232,.1)",borderRadius:"20px",color:"#5AB4E8",fontFamily:"'DM Sans',sans-serif"}}>🚀 {t.transits.length} trayectos</span>}
                  {cost>0&&<span style={{fontSize:".72rem",padding:".2rem .6rem",background:"rgba(196,98,45,.08)",borderRadius:"20px",color:"var(--accent)",fontFamily:"'DM Sans',sans-serif"}}>💰 ${cost.toLocaleString()}</span>}
                </div>
                <div style={{display:"flex",gap:".3rem",flexWrap:"wrap"}}>
                  {t.destinations.slice(0,4).map(d=><span key={d.id} style={{fontSize:".7rem",padding:".15rem .5rem",background:d.color+"20",borderRadius:"4px",color:d.color,fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>{d.emoji} {d.name}</span>)}
                  {t.destinations.length>4&&<span style={{fontSize:".7rem",color:"var(--muted)"}}>+{t.destinations.length-4}</span>}
                </div>
              </div>;
            })}
            <div onClick={()=>{setForm({emoji:"🌍"});setModal("newTrip");}} className="hov-add" style={{border:"2px dashed rgba(28,28,30,.12)",borderRadius:"12px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:".5rem",minHeight:"160px",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif",fontSize:".85rem",transition:"all .2s"}}>
              <span style={{fontSize:"1.8rem"}}>+</span>Nuevo viaje
            </div>
          </div>
        }
      </div>}

      {/* ── TRIP VIEW ────────────────────────────────────────────────────────── */}
      {view==="trip"&&trip&&<div style={{display:"flex",height:"calc(100vh - 52px)"}}>

        {/* SIDEBAR */}
        <aside style={{width:"224px",flexShrink:0,borderRight:"1px solid var(--line)",background:"#fff",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{padding:"1rem 1rem .75rem",borderBottom:"1px solid var(--line)"}}>
            <div style={{fontSize:"1.5rem",marginBottom:".2rem"}}>{trip.emoji}</div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1rem",fontWeight:600,lineHeight:1.2,marginBottom:".2rem"}}>{trip.name}</div>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"var(--muted)",marginBottom:".3rem"}}>
              {trip.startDate?`${fmtShort(trip.startDate)} → ${fmtShort(trip.endDate||addDays(trip.startDate,tripDays-1))} · ${tripDays}d`:`${tripDays} días`}
            </div>
            {totalCost>0&&<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"var(--accent)",marginBottom:".6rem"}}>💰 ${totalCost.toLocaleString()}</div>}
            {trip.destinations.length>0&&<div style={{display:"flex",height:"5px",borderRadius:"3px",overflow:"hidden",marginBottom:".5rem",gap:"2px"}}>
              {trip.destinations.map(d=>(
                <div key={d.id} onClick={()=>{setActiveDestId(d.id);setDayFilter(null);setTripView("dest");}} title={`${d.name} · ${d.days}d`}
                  style={{flex:d.days,background:d.color,opacity:activeDestId===d.id&&tripView==="dest"?1:.4,cursor:"pointer",transition:"opacity .15s",borderRadius:"2px"}}/>
              ))}
            </div>}
          </div>

          {/* dest list */}
          <div style={{flex:1,overflowY:"auto",padding:".4rem 0"}}>
            {trip.destinations.length===0
              ?<div style={{padding:"1rem",textAlign:"center",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif",fontSize:".75rem"}}>Añade tu primer destino →</div>
              :trip.destinations.map(d=>(
                <div key={d.id} className="hov-dest" onClick={()=>{setActiveDestId(d.id);setDayFilter(null);setTripView("dest");}}
                  style={{display:"flex",alignItems:"center",gap:".6rem",padding:".55rem 1rem",cursor:"pointer",transition:"background .15s",background:activeDestId===d.id&&tripView==="dest"?"rgba(196,98,45,.07)":"transparent",borderLeft:activeDestId===d.id&&tripView==="dest"?`3px solid ${d.color}`:"3px solid transparent"}}>
                  <span style={{fontSize:"1rem",flexShrink:0}}>{d.emoji}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".8rem",fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.name}</div>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".64rem",color:"var(--muted)"}}>
                      {d.startDate?`${fmtShort(d.startDate)}→${fmtShort(d.endDate)}`:`${d.days}d`} · {d.items.length} items
                    </div>
                  </div>
                  <button onClick={e=>{e.stopPropagation();deleteDest(d.id);}} className="hov-icon" style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",padding:".1rem .25rem",borderRadius:"3px",fontSize:".7rem",flexShrink:0}}>✕</button>
                </div>
              ))
            }
            {(trip.transits||[]).length>0&&<>
              <div style={{padding:".4rem 1rem .2rem",fontFamily:"'DM Sans',sans-serif",fontSize:".65rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em"}}>Trayectos</div>
              {(trip.transits||[]).map(tr=>{
                const tt=ttInfo(tr.transitType);
                const from=destName(tr.fromDestId);
                const to=destName(tr.toDestId);
                return <div key={tr.id} className="hov-dest" onClick={()=>setTripView("transits")}
                  style={{display:"flex",alignItems:"center",gap:".5rem",padding:".4rem 1rem",cursor:"pointer",transition:"background .15s"}}>
                  <span style={{fontSize:".95rem",flexShrink:0}}>{tt.icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".75rem",fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",color:tt.color}}>{tr.title||tt.label}</div>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".62rem",color:"var(--muted)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {from?.name||"?"} → {to?.name||"?"}
                    </div>
                  </div>
                </div>;
              })}
            </>}
          </div>

          <div style={{padding:".6rem",borderTop:"1px solid var(--line)",display:"flex",flexDirection:"column",gap:".4rem"}}>
            <button onClick={openNewDest} className="hov-add" style={{width:"100%",background:"none",border:"1.5px dashed rgba(28,28,30,.18)",borderRadius:"6px",padding:".4rem",color:"var(--muted)",cursor:"pointer",fontSize:".75rem",transition:"all .2s"}}>📍 Destino</button>
            <button onClick={()=>{openNewTransit();}} className="hov-add" style={{width:"100%",background:"none",border:"1.5px dashed rgba(90,180,232,.5)",borderRadius:"6px",padding:".4rem",color:"#5AB4E8",cursor:"pointer",fontSize:".75rem",transition:"all .2s"}}>🚀 Trayecto</button>
          </div>
        </aside>

        {/* MAIN */}
        <main style={{flex:1,overflowY:"auto",background:"#F7F4EF"}}>

          {/* ── TRANSITS VIEW ───────────────────────────────────────────────── */}
          {tripView==="transits"&&<div style={{padding:"1.5rem 2rem",maxWidth:"860px"}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"1.75rem"}}>
              <div>
                <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.9rem",fontWeight:600,margin:"0 0 .3rem"}}>Trayectos</h2>
                <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:".8rem",color:"var(--muted)",margin:0}}>
                  Conecta tus destinos con vuelos, trenes, buses, alquileres y más.
                  {(trip.transits||[]).length>0&&` · ${(trip.transits||[]).length} trayectos · $${transitsCost.toLocaleString()}`}
                </p>
              </div>
              <button onClick={openNewTransit} style={{background:"var(--accent)",border:"none",color:"#fff",padding:".55rem 1.2rem",borderRadius:"8px",fontSize:".82rem",fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>+ Agregar</button>
            </div>

            {trip.destinations.length>=2&&<div style={{marginBottom:"2rem",padding:"1.25rem 1.5rem",background:"#fff",border:"1px solid var(--line)",borderRadius:"12px"}}>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:"1rem"}}>Ruta del viaje</div>
              <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:0}}>
                {trip.destinations.map((d,i)=>{
                  const transitBetween = (trip.transits||[]).filter(tr=>tr.fromDestId===d.id&&tr.toDestId===trip.destinations[i+1]?.id);
                  return <div key={d.id} style={{display:"flex",alignItems:"center"}}>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"0 .5rem"}}>
                      <div style={{width:"38px",height:"38px",borderRadius:"50%",background:d.color+"20",border:`2px solid ${d.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.1rem"}}>{d.emoji}</div>
                      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",fontWeight:600,color:d.color,marginTop:".25rem",maxWidth:"70px",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                      {d.startDate&&<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".58rem",color:"var(--muted)"}}>{fmtShort(d.startDate)}</div>}
                    </div>
                    {i<trip.destinations.length-1&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",minWidth:"60px"}}>
                      {transitBetween.length>0
                        ?transitBetween.map(tr=>{
                          const tt=ttInfo(tr.transitType);
                          return <div key={tr.id} style={{display:"flex",alignItems:"center",gap:".25rem",padding:".15rem .5rem",background:tt.color+"15",borderRadius:"10px",border:`1px solid ${tt.color}40`,cursor:"pointer"}} onClick={()=>openEditTransit(tr)}>
                            <span style={{fontSize:".85rem"}}>{tt.icon}</span>
                            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".62rem",color:tt.color,fontWeight:500}}>{tr.title||tt.label}</span>
                          </div>;
                        })
                        :<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:".15rem"}}>
                          <div style={{height:"2px",width:"40px",background:"rgba(28,28,30,.1)",borderRadius:"1px"}}/>
                          <button onClick={()=>{setForm({transitType:"flight",fromDestId:d.id,toDestId:trip.destinations[i+1]?.id||"",date:d.endDate||""});setModal("newTransit");}} style={{fontFamily:"'DM Sans',sans-serif",fontSize:".6rem",color:"var(--accent)",background:"none",border:"1px dashed rgba(196,98,45,.3)",padding:".1rem .4rem",borderRadius:"8px",cursor:"pointer"}}>+ añadir</button>
                        </div>
                      }
                    </div>}
                  </div>;
                })}
              </div>
            </div>}

            {(trip.transits||[]).length===0
              ?<div style={{border:"2px dashed rgba(28,28,30,.12)",borderRadius:"12px",padding:"3rem 2rem",textAlign:"center",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif"}}>
                <div style={{fontSize:"3rem",marginBottom:"1rem"}}>🚀</div>
                <p style={{margin:"0 0 1.25rem",fontSize:".9rem"}}>No hay trayectos aún.<br/>Agrega vuelos, trenes, alquileres y más para conectar tus destinos.</p>
                <div style={{display:"flex",gap:".5rem",justifyContent:"center",flexWrap:"wrap"}}>
                  {TRANSIT_TYPES.map(tt=>(
                    <button key={tt.key} onClick={()=>{setForm({transitType:tt.key,fromDestId:trip.destinations[0]?.id||"",toDestId:trip.destinations[1]?.id||""});setModal("newTransit");}} style={{background:"none",border:`1px solid ${tt.color}50`,color:tt.color,padding:".4rem .8rem",borderRadius:"6px",fontSize:".75rem",cursor:"pointer"}}>{tt.icon} {tt.label}</button>
                  ))}
                </div>
              </div>
              :<div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
                {(trip.transits||[]).map(tr=>{
                  const tt=ttInfo(tr.transitType);
                  const from=destName(tr.fromDestId);
                  const to=destName(tr.toDestId);
                  const vias=(tr.viaDestIds||[]).map(id=>destName(id)).filter(Boolean);
                  const rental=isRental(tr.transitType);
                  return <div key={tr.id} className="transit-card" style={{background:"#fff",border:`1px solid ${tr.confirmed?"#7EC87E40":"var(--line)"}`,borderLeft:`4px solid ${tt.color}`,borderRadius:"10px",padding:"1.1rem 1.25rem",transition:"all .2s",opacity:tr.confirmed?.8:1}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:"1rem"}}>
                      <div style={{width:"40px",height:"40px",borderRadius:"10px",background:tt.color+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.4rem",flexShrink:0}}>{tt.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:".5rem",flexWrap:"wrap",marginBottom:".3rem"}}>
                          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".92rem",fontWeight:600,color:"var(--ink)",textDecoration:tr.confirmed?"line-through":"none"}}>{tr.title||tt.label}</span>
                          <span style={{fontSize:".65rem",padding:".1rem .5rem",background:tt.color+"18",color:tt.color,borderRadius:"10px",fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>{tt.label}</span>
                          {tr.confirmed&&<span style={{fontSize:".65rem",color:"#7EC87E",fontFamily:"'DM Sans',sans-serif",background:"#7EC87E15",padding:".1rem .45rem",borderRadius:"10px"}}>✓ Confirmado</span>}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:".4rem",marginBottom:".4rem",flexWrap:"wrap"}}>
                          {from&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".8rem",padding:".2rem .6rem",background:from.color+"18",borderRadius:"6px",color:from.color,fontWeight:500}}>{from.emoji} {from.name}</span>}
                          {vias.map(v=><span key={v.id} style={{fontFamily:"'DM Sans',sans-serif",fontSize:".75rem",color:"var(--muted)"}}>→ <span style={{padding:".15rem .5rem",background:v.color+"18",borderRadius:"5px",color:v.color}}>{v.emoji} {v.name}</span></span>)}
                          {to&&<><span style={{color:"var(--muted)",fontSize:".8rem"}}>→</span><span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".8rem",padding:".2rem .6rem",background:to.color+"18",borderRadius:"6px",color:to.color,fontWeight:500}}>{to.emoji} {to.name}</span></>}
                        </div>
                        <div style={{display:"flex",gap:".75rem",flexWrap:"wrap"}}>
                          {tr.date&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)"}}>📅 {fmtDate(tr.date)}{rental&&tr.returnDate?` → ${fmtDate(tr.returnDate)}`:""}</span>}
                          {tr.departTime&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)"}}>🕐 {tr.departTime}{tr.arriveTime?` → ${tr.arriveTime}`:""}</span>}
                          {tr.provider&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)"}}>🏢 {tr.provider}</span>}
                          {tr.confirmation&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)"}}>📋 {tr.confirmation}</span>}
                          {tr.cost>0&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--accent)",fontWeight:500}}>💶 ${tr.cost.toLocaleString()}</span>}
                        </div>
                        {tr.notes&&<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)",marginTop:".3rem",fontStyle:"italic"}}>{tr.notes}</div>}
                      </div>
                      <div style={{display:"flex",gap:".25rem",flexShrink:0}}>
                        <button onClick={()=>toggleTransitConfirm(tr.id)} className="hov-icon" title="Confirmar" style={{background:tr.confirmed?"#7EC87E20":"none",border:`1px solid ${tr.confirmed?"#7EC87E":"var(--line)"}`,color:tr.confirmed?"#7EC87E":"var(--muted)",padding:".25rem .45rem",borderRadius:"5px",cursor:"pointer",fontSize:".74rem"}}>✓</button>
                        <button onClick={()=>openEditTransit(tr)} className="hov-icon" style={{background:"none",border:"1px solid var(--line)",color:"var(--muted)",padding:".25rem .45rem",borderRadius:"5px",cursor:"pointer",fontSize:".74rem"}}>✏️</button>
                        <button onClick={()=>deleteTransit(tr.id)} className="hov-icon" style={{background:"none",border:"1px solid var(--line)",color:"#e87575",padding:".25rem .45rem",borderRadius:"5px",cursor:"pointer",fontSize:".74rem"}}>🗑</button>
                      </div>
                    </div>
                  </div>;
                })}
                {transitsCost>0&&<div style={{display:"flex",justifyContent:"flex-end",padding:".5rem .25rem",fontFamily:"'DM Sans',sans-serif",fontSize:".82rem",color:"var(--accent)",fontWeight:500}}>
                  Total trayectos: ${transitsCost.toLocaleString()}
                </div>}
              </div>
            }
          </div>}

          {/* ── SUMMARY VIEW ────────────────────────────────────────────────── */}
          {tripView==="summary"&&<div style={{padding:"1.5rem 2rem",maxWidth:"860px"}}>
            <div style={{marginBottom:"1.75rem"}}>
              <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.9rem",fontWeight:600,margin:"0 0 .3rem"}}>Resumen del itinerario</h2>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:".8rem",color:"var(--muted)",margin:0}}>
                {trip.destinations.length} destinos · {(trip.transits||[]).length} trayectos · {tripDays} días
                {trip.startDate&&` · desde ${fmtDate(trip.startDate)}`}
                {totalCost>0&&` · $${totalCost.toLocaleString()} estimado`}
              </p>
            </div>

            {trip.destinations.length>0&&<div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:".2rem",marginBottom:"1.5rem",padding:"1rem 1.25rem",background:"#fff",border:"1px solid var(--line)",borderRadius:"10px",overflowX:"auto"}}>
              {trip.destinations.map((d,i)=>{
                const trs=(trip.transits||[]).filter(tr=>tr.fromDestId===d.id&&tr.toDestId===trip.destinations[i+1]?.id);
                return <div key={d.id} style={{display:"flex",alignItems:"center",gap:".2rem"}}>
                  <div style={{padding:".3rem .7rem",background:d.color+"18",borderRadius:"20px",border:`1px solid ${d.color}40`}}>
                    <div style={{display:"flex",alignItems:"center",gap:".35rem"}}>
                      <span style={{fontSize:".9rem"}}>{d.emoji}</span>
                      <div>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".75rem",fontWeight:500,color:d.color}}>{d.name}</span>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".62rem",color:d.color+"aa",marginLeft:".3rem"}}>{d.days}d</span>
                        {d.startDate&&<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".6rem",color:d.color+"88"}}>{fmtShort(d.startDate)}→{fmtShort(d.endDate)}</div>}
                      </div>
                    </div>
                  </div>
                  {i<trip.destinations.length-1&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:".1rem",padding:"0 .1rem"}}>
                    {trs.length>0
                      ?trs.map(tr=>{const tt=ttInfo(tr.transitType);return <span key={tr.id} title={tr.title||tt.label} style={{fontSize:".9rem"}}>{tt.icon}</span>;})
                      :<span style={{color:"var(--muted)",fontSize:".8rem"}}>→</span>
                    }
                  </div>}
                </div>;
              })}
            </div>}

            {(()=>{
              const all=trip.destinations.flatMap(d=>d.items);
              const conf=all.filter(i=>i.confirmed).length;
              const tconf=(trip.transits||[]).filter(t=>t.confirmed).length;
              return <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:".75rem",marginBottom:"2rem"}}>
                {[["📅","Días",tripDays],["📍","Destinos",trip.destinations.length],["🚀","Trayectos",`${tconf}/${(trip.transits||[]).length}`],["🎯","Actividades",all.filter(i=>i.type==="activity").length],["🏨","Hospedajes",all.filter(i=>i.type==="hotel").length],["✓","Confirmados",`${conf}/${all.length}`],["💰","Total",`$${totalCost.toLocaleString()}`]].map(([ic,lb,vl])=>(
                  <div key={lb} style={{background:"#fff",border:"1px solid var(--line)",borderRadius:"8px",padding:".9rem 1rem"}}>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.1rem",fontWeight:600,color:"var(--accent)"}}>{vl}</div>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".65rem",color:"var(--muted)",marginTop:".1rem",textTransform:"uppercase",letterSpacing:".05em"}}>{ic} {lb}</div>
                  </div>
                ))}
              </div>;
            })()}

            {trip.destinations.length===0
              ?<div style={{textAlign:"center",padding:"3rem",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif"}}><div style={{fontSize:"2.5rem",marginBottom:".75rem"}}>🏝️</div><p>Añade destinos para ver el itinerario.</p></div>
              :buildItinerary().map(({abs,dest,localDay,items,transits:dayTransits})=>{
                const realDate=dayToDate(dest,localDay);
                const isLastDay=localDay===dest.days;
                const nextDest=trip.destinations[trip.destinations.indexOf(dest)+1];
                const outboundTransits=(trip.transits||[]).filter(tr=>tr.fromDestId===dest.id&&(isLastDay||tr.date===realDate));
                return <div key={abs} style={{display:"flex",gap:"1.25rem",position:"relative"}}>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0,width:"42px"}}>
                    <div style={{width:"34px",height:"34px",borderRadius:"50%",background:dest.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:".7rem",fontFamily:"'DM Sans',sans-serif",fontWeight:700,color:"#fff",flexShrink:0,zIndex:1}}>{abs}</div>
                    <div style={{width:"2px",flex:1,background:dest.color+"30",minHeight:"16px"}}/>
                  </div>
                  <div style={{flex:1,paddingBottom:"1rem"}}>
                    <div style={{display:"flex",alignItems:"center",gap:".55rem",paddingTop:".45rem",marginBottom:".45rem",flexWrap:"wrap"}}>
                      <span style={{fontSize:".95rem"}}>{dest.emoji}</span>
                      <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".86rem",fontWeight:600,color:dest.color}}>{dest.name}</span>
                      <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".7rem",color:"var(--muted)"}}>Día {localDay}/{dest.days}</span>
                      {realDate&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"var(--muted)",marginLeft:"auto",background:"rgba(28,28,30,.05)",padding:".15rem .55rem",borderRadius:"10px",whiteSpace:"nowrap"}}>{fmtDate(realDate)}</span>}
                    </div>
                    {items.length===0
                      ?<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".76rem",color:"var(--muted)",fontStyle:"italic",padding:".4rem .75rem",background:"rgba(28,28,30,.03)",borderRadius:"6px",border:"1px dashed rgba(28,28,30,.1)"}}>Sin actividades · <button onClick={()=>{setActiveDestId(dest.id);setTripView("dest");setDayFilter(localDay);setForm({type:"activity",day:localDay});setModal("newItem");}} style={{background:"none",border:"none",color:"var(--accent)",cursor:"pointer",fontSize:"inherit",fontFamily:"inherit",padding:0}}>Añadir</button></div>
                      :<div style={{display:"flex",flexDirection:"column",gap:".3rem"}}>
                        {items.map(item=>{
                          const T=ITEM_TYPES[item.type]||ITEM_TYPES.activity;
                          return <div key={item.id} style={{display:"flex",alignItems:"flex-start",gap:".7rem",background:"#fff",border:`1px solid var(--line)`,borderLeft:`3px solid ${T.color}`,borderRadius:"7px",padding:".5rem .8rem",opacity:item.confirmed?.72:1}}>
                            <span style={{fontSize:".9rem",flexShrink:0,marginTop:".05rem"}}>{T.icon}</span>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".83rem",fontWeight:500,textDecoration:item.confirmed?"line-through":"none",color:item.confirmed?"var(--muted)":"var(--ink)"}}>{item.title||"(sin título)"}</div>
                              <div style={{display:"flex",gap:".6rem",marginTop:".1rem",flexWrap:"wrap"}}>
                                {item.time&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"var(--muted)"}}>🕐 {item.time}</span>}
                                {item.duration&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"var(--muted)"}}>⏱ {item.duration}</span>}
                                {item.cost>0&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"var(--accent)"}}>💶 ${item.cost.toLocaleString()}</span>}
                              </div>
                            </div>
                            <button onClick={()=>openEditItem(dest.id,item)} className="hov-icon" style={{background:"none",border:"1px solid var(--line)",color:"var(--muted)",padding:".2rem .35rem",borderRadius:"4px",cursor:"pointer",fontSize:".65rem",flexShrink:0}}>✏️</button>
                          </div>;
                        })}
                      </div>
                    }
                    {isLastDay&&outboundTransits.length>0&&<div style={{marginTop:".5rem",display:"flex",flexDirection:"column",gap:".3rem"}}>
                      {outboundTransits.map(tr=>{
                        const tt=ttInfo(tr.transitType);
                        const to=destName(tr.toDestId);
                        return <div key={tr.id} style={{display:"flex",alignItems:"center",gap:".6rem",padding:".45rem .8rem",background:tt.color+"10",border:`1px solid ${tt.color}30`,borderRadius:"7px",cursor:"pointer"}} onClick={()=>openEditTransit(tr)}>
                          <span style={{fontSize:"1rem"}}>{tt.icon}</span>
                          <div style={{flex:1,fontFamily:"'DM Sans',sans-serif",fontSize:".78rem",fontWeight:500,color:tt.color}}>{tr.title||tt.label}</div>
                          {to&&<div style={{display:"flex",alignItems:"center",gap:".3rem",fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)"}}>→ <span style={{color:to.color,fontWeight:500}}>{to.emoji} {to.name}</span></div>}
                          {tr.departTime&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"var(--muted)"}}>🕐{tr.departTime}</span>}
                          {tr.cost>0&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"var(--accent)"}}>💶${tr.cost.toLocaleString()}</span>}
                        </div>;
                      })}
                    </div>}
                    {items.some(i=>i.cost>0)&&<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".7rem",color:"var(--accent)",textAlign:"right",marginTop:".3rem"}}>Día: ${items.reduce((s,i)=>s+(i.cost||0),0).toLocaleString()}</div>}
                  </div>
                </div>;
              })
            }

            {totalCost>0&&<div style={{marginTop:"1.5rem",padding:"1.25rem 1.5rem",background:"#fff",border:"1px solid var(--line)",borderRadius:"10px"}}>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:"1rem"}}>Desglose de gastos</div>
              {trip.destinations.map(d=>{const c=d.items.reduce((s,i)=>s+(i.cost||0),0);if(!c)return null;const p=totalCost>0?(c/totalCost)*100:0;return <div key={d.id} style={{display:"flex",alignItems:"center",gap:".75rem",marginBottom:".55rem"}}>
                <span style={{fontSize:".85rem"}}>{d.emoji}</span>
                <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".78rem",flex:"0 0 95px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</span>
                <div style={{flex:1,height:"5px",background:"rgba(28,28,30,.06)",borderRadius:"3px",overflow:"hidden"}}><div style={{height:"100%",width:`${p}%`,background:d.color,borderRadius:"3px"}}/></div>
                <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".75rem",color:d.color,flex:"0 0 65px",textAlign:"right"}}>${c.toLocaleString()}</span>
              </div>;})}
              {(trip.transits||[]).filter(tr=>tr.cost>0).map(tr=>{const tt=ttInfo(tr.transitType);const p=totalCost>0?(tr.cost/totalCost)*100:0;return <div key={tr.id} style={{display:"flex",alignItems:"center",gap:".75rem",marginBottom:".55rem"}}>
                <span style={{fontSize:".85rem"}}>{tt.icon}</span>
                <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".78rem",flex:"0 0 95px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:tt.color}}>{tr.title||tt.label}</span>
                <div style={{flex:1,height:"5px",background:"rgba(28,28,30,.06)",borderRadius:"3px",overflow:"hidden"}}><div style={{height:"100%",width:`${p}%`,background:tt.color,borderRadius:"3px"}}/></div>
                <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".75rem",color:tt.color,flex:"0 0 65px",textAlign:"right"}}>${tr.cost.toLocaleString()}</span>
              </div>;})}
              <div style={{borderTop:"1px solid var(--line)",paddingTop:".75rem",display:"flex",justifyContent:"space-between",fontFamily:"'DM Sans',sans-serif",fontSize:".82rem"}}>
                <span style={{color:"var(--muted)"}}>Total estimado</span><span style={{color:"var(--accent)",fontWeight:600}}>${totalCost.toLocaleString()}</span>
              </div>
              {trip.budget>0&&<div style={{marginTop:".5rem"}}>
                <div style={{display:"flex",justifyContent:"space-between",fontFamily:"'DM Sans',sans-serif",fontSize:".73rem",color:"var(--muted)",marginBottom:".3rem"}}>
                  <span>Presupuesto: ${trip.budget.toLocaleString()}</span>
                  <span style={{color:totalCost>trip.budget?"#E85A5A":"#7EC87E"}}>{totalCost>trip.budget?`Excede $${(totalCost-trip.budget).toLocaleString()}`:`Disponible $${(trip.budget-totalCost).toLocaleString()}`}</span>
                </div>
                <div style={{height:"5px",background:"rgba(28,28,30,.06)",borderRadius:"3px",overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(100,(totalCost/trip.budget)*100)}%`,background:totalCost>trip.budget?"#E85A5A":"var(--accent)",borderRadius:"3px"}}/></div>
              </div>}
            </div>}
          </div>}

          {/* ── DEST VIEW ───────────────────────────────────────────────────── */}
          {tripView==="dest"&&(!activeDest
            ?<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif"}}>
              <div style={{fontSize:"3rem",marginBottom:"1rem"}}>🗺</div><p>Selecciona o crea un destino</p>
            </div>
            :<div style={{padding:"1.5rem 2rem",maxWidth:"860px"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"1.5rem"}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:".75rem",marginBottom:".25rem"}}>
                    <span style={{fontSize:"2rem"}}>{activeDest.emoji}</span>
                    <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.8rem",fontWeight:600,margin:0}}>{activeDest.name}</h2>
                    {activeDest.country&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".78rem",color:"var(--muted)",padding:".2rem .6rem",background:"rgba(28,28,30,.06)",borderRadius:"20px"}}>{activeDest.country}</span>}
                  </div>
                  <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".76rem",color:"var(--muted)",paddingLeft:"2.75rem"}}>
                    {activeDest.startDate?<><span style={{color:"var(--accent)",fontWeight:500}}>{fmtDate(activeDest.startDate)}</span> → <span style={{color:"var(--accent)",fontWeight:500}}>{fmtDate(activeDest.endDate)}</span> · {activeDest.days} días</>:`${activeDest.days} días`}
                    {" · "}{activeDest.items.length} elementos
                    {activeDest.items.some(i=>i.cost>0)&&" · $"+activeDest.items.reduce((s,i)=>s+(i.cost||0),0).toLocaleString()}
                  </div>
                </div>
                <button onClick={()=>{setForm({type:"activity",day:dayFilter||1});setModal("newItem");}} style={{background:"var(--accent)",border:"none",color:"#fff",padding:".55rem 1.2rem",borderRadius:"8px",fontSize:".82rem",fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>+ Agregar</button>
              </div>

              <div style={{display:"flex",gap:".4rem",marginBottom:"1.25rem",overflowX:"auto",paddingBottom:".25rem"}}>
                <button onClick={()=>setDayFilter(null)} style={{background:dayFilter===null?"var(--ink)":"rgba(28,28,30,.06)",border:"none",color:dayFilter===null?"#fff":"var(--muted)",padding:".35rem .9rem",borderRadius:"20px",fontSize:".74rem",cursor:"pointer",whiteSpace:"nowrap",transition:"all .15s"}}>Todos</button>
                {Array.from({length:activeDest.days},(_,i)=>i+1).map(d=>{
                  const rd=dayToDate(activeDest,d);
                  return <button key={d} onClick={()=>setDayFilter(d)} style={{background:dayFilter===d?activeDest.color:"rgba(28,28,30,.06)",border:"none",color:dayFilter===d?"#fff":"var(--muted)",padding:".3rem .8rem",borderRadius:"20px",fontSize:".73rem",cursor:"pointer",whiteSpace:"nowrap",transition:"all .15s",lineHeight:1.3,display:"flex",flexDirection:"column",alignItems:"center"}}>
                    <span>Día {d}</span>
                    {rd&&<span style={{fontSize:".6rem",opacity:.8}}>{fmtShort(rd)}</span>}
                  </button>;
                })}
              </div>

              {filteredItems.length===0
                ?<div style={{border:"2px dashed rgba(28,28,30,.12)",borderRadius:"10px",padding:"3rem 2rem",textAlign:"center",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif"}}>
                  <div style={{fontSize:"2.5rem",marginBottom:".75rem"}}>📋</div>
                  <p style={{margin:"0 0 1.25rem",fontSize:".9rem"}}>No hay elementos aún.</p>
                  <div style={{display:"flex",gap:".5rem",justifyContent:"center",flexWrap:"wrap"}}>
                    {Object.entries(ITEM_TYPES).map(([k,t])=>(
                      <button key={k} onClick={()=>{setForm({type:k,day:dayFilter||1});setModal("newItem");}} style={{background:"none",border:`1px solid ${t.color}50`,color:t.color,padding:".4rem .8rem",borderRadius:"6px",fontSize:".75rem",cursor:"pointer"}}>{t.icon} {t.label}</button>
                    ))}
                  </div>
                </div>
                :<div>
                  {(dayFilter?[dayFilter]:[...new Set(filteredItems.map(i=>i.day))].sort((a,b)=>a-b)).map(day=>{
                    const dayItems=filteredItems.filter(i=>i.day===day);
                    if(!dayItems.length)return null;
                    const rd=dayToDate(activeDest,day);
                    return <div key={day} style={{marginBottom:"1.5rem"}}>
                      <div style={{display:"flex",alignItems:"center",gap:".75rem",marginBottom:".75rem"}}>
                        <div style={{display:"flex",alignItems:"center",gap:".4rem"}}>
                          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",fontWeight:600,color:"#fff",background:activeDest.color,padding:".2rem .7rem",borderRadius:"20px"}}>DÍA {day}</div>
                          {rd&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".7rem",color:"var(--muted)"}}>{fmtDate(rd)}</span>}
                        </div>
                        <div style={{flex:1,height:"1px",background:"var(--line)"}}/>
                        <button onClick={()=>{setForm({type:"activity",day});setModal("newItem");}} className="hov-ghost" style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:".74rem",padding:".2rem .5rem",borderRadius:"4px"}}>+ añadir</button>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:".4rem"}}>
                        {dayItems.map(item=>{
                          const T=ITEM_TYPES[item.type]||ITEM_TYPES.activity;
                          return <div key={item.id} className="hov-row" style={{background:"#fff",border:"1px solid var(--line)",borderRadius:"8px",padding:".75rem 1rem",display:"flex",alignItems:"center",gap:".75rem",transition:"background .15s",opacity:item.confirmed?.7:1}}>
                            <span style={{fontSize:"1.2rem",flexShrink:0}}>{T.icon}</span>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:".5rem",flexWrap:"wrap"}}>
                                <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".87rem",fontWeight:500,textDecoration:item.confirmed?"line-through":"none",color:item.confirmed?"var(--muted)":"var(--ink)"}}>{item.title||"(sin título)"}</span>
                                <span style={{fontSize:".64rem",padding:".1rem .45rem",background:T.color+"18",color:T.color,borderRadius:"3px",fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>{T.label}</span>
                                {item.confirmed&&<span style={{fontSize:".64rem",color:"#7EC87E",fontFamily:"'DM Sans',sans-serif"}}>✓ Confirmado</span>}
                              </div>
                              <div style={{display:"flex",gap:".75rem",marginTop:".2rem",flexWrap:"wrap"}}>
                                {item.time&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".71rem",color:"var(--muted)"}}>🕐 {item.time}</span>}
                                {item.duration&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".71rem",color:"var(--muted)"}}>⏱ {item.duration}</span>}
                                {item.address&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".71rem",color:"var(--muted)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"180px"}}>📍 {item.address}</span>}
                                {item.cost>0&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".71rem",color:"var(--accent)"}}>💶 ${item.cost.toLocaleString()}</span>}
                              </div>
                              {item.notes&&<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".71rem",color:"var(--muted)",marginTop:".2rem",fontStyle:"italic"}}>{item.notes}</div>}
                            </div>
                            <div style={{display:"flex",gap:".25rem",flexShrink:0}}>
                              <button onClick={()=>toggleConfirm(activeDest.id,item.id)} className="hov-icon" style={{background:item.confirmed?"#7EC87E20":"none",border:`1px solid ${item.confirmed?"#7EC87E":"var(--line)"}`,color:item.confirmed?"#7EC87E":"var(--muted)",padding:".25rem .45rem",borderRadius:"5px",cursor:"pointer",fontSize:".74rem"}}>✓</button>
                              <button onClick={()=>openEditItem(activeDest.id,item)} className="hov-icon" style={{background:"none",border:"1px solid var(--line)",color:"var(--muted)",padding:".25rem .45rem",borderRadius:"5px",cursor:"pointer",fontSize:".74rem"}}>✏️</button>
                              <button onClick={()=>deleteItem(activeDest.id,item.id)} className="hov-icon" style={{background:"none",border:"1px solid var(--line)",color:"#e87575",padding:".25rem .45rem",borderRadius:"5px",cursor:"pointer",fontSize:".74rem"}}>🗑</button>
                            </div>
                          </div>;
                        })}
                      </div>
                    </div>;
                  })}
                  <button onClick={()=>{setForm({type:"activity",day:dayFilter||activeDest.days});setModal("newItem");}} className="hov-ghost" style={{width:"100%",background:"none",border:"1.5px dashed rgba(28,28,30,.15)",borderRadius:"8px",padding:".7rem",color:"var(--muted)",cursor:"pointer",fontSize:".82rem",marginTop:".5rem",transition:"all .2s"}}>
                    + Agregar al día {dayFilter||activeDest.days}
                  </button>
                </div>
              }
              <div style={{marginTop:"2rem",padding:"1rem 1.5rem",background:"#fff",border:"1px solid var(--line)",borderRadius:"10px",display:"flex",gap:"2rem",flexWrap:"wrap"}}>
                {Object.entries(ITEM_TYPES).map(([k,T])=>{const c=activeDest.items.filter(i=>i.type===k).length;if(!c)return null;return <div key={k} style={{fontFamily:"'DM Sans',sans-serif",fontSize:".78rem"}}><span style={{color:T.color}}>{T.icon} {T.label}</span><span style={{color:"var(--muted)",marginLeft:".3rem"}}>{c}</span></div>;})}
                <div style={{flex:1}}/>
                {activeDest.items.some(i=>i.cost>0)&&<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".78rem",color:"var(--accent)",fontWeight:500}}>Total: ${activeDest.items.reduce((s,i)=>s+(i.cost||0),0).toLocaleString()}</div>}
              </div>
            </div>
          )}
        </main>
      </div>}

      {/* ── MODALS ──────────────────────────────────────────────────────────── */}
      {modal&&<div onClick={closeModal} style={{position:"fixed",inset:0,background:"rgba(28,28,30,.5)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
        <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:"14px",padding:"2rem",width:"100%",maxWidth:modal==="newTransit"||modal==="editTransit"?"540px":"420px",boxShadow:"0 24px 80px rgba(28,28,30,.22)",maxHeight:"90vh",overflowY:"auto"}}>

          {modal==="newTrip"&&<>
            <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.5rem",fontWeight:600,margin:"0 0 1.5rem"}}>Nuevo viaje</h3>
            <Lbl>Emoji</Lbl><EmojiPick value={form.emoji||"🌍"} onChange={v=>setForm(p=>({...p,emoji:v}))}/>
            <Lbl>Nombre *</Lbl><Inp placeholder="Ej. Verano en Asia" value={form.name||""} onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:".75rem"}}>
              <div><Lbl>Inicio</Lbl><Inp type="date" value={form.startDate||""} onChange={e=>setForm(p=>({...p,startDate:e.target.value,endDate:p.endDate&&p.endDate<e.target.value?"":p.endDate}))}/></div>
              <div><Lbl>Fin</Lbl><Inp type="date" min={form.startDate||""} value={form.endDate||""} onChange={e=>setForm(p=>({...p,endDate:e.target.value}))}/></div>
            </div>
            {form.startDate&&form.endDate&&<p className="hint">📅 {diffDays(form.startDate,form.endDate)+1} días en total</p>}
            <Lbl>Presupuesto ($)</Lbl><Inp type="number" placeholder="0" value={form.budget||""} onChange={e=>setForm(p=>({...p,budget:e.target.value}))}/>
            <Btns onCancel={closeModal} onOk={createTrip} label="Crear viaje"/>
          </>}

          {modal==="newDest"&&<>
            <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.5rem",fontWeight:600,margin:"0 0 .3rem"}}>Nuevo destino</h3>
            {(()=>{const dests=trip?.destinations||[];if(dests.length===0&&trip?.startDate)return <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:".75rem",color:"var(--accent)",margin:"0 0 1.25rem",background:"rgba(196,98,45,.07)",padding:".5rem .75rem",borderRadius:"6px"}}>📍 Primer destino — desde <strong>{fmtDate(trip.startDate)}</strong></p>;if(dests.length>0){const last=dests[dests.length-1];const e=last.endDate||(last.startDate?addDays(last.startDate,last.days-1):null);if(e)return <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:".75rem",color:"var(--accent)",margin:"0 0 1.25rem",background:"rgba(196,98,45,.07)",padding:".5rem .75rem",borderRadius:"6px"}}>📍 Continuando desde <strong>{last.emoji} {last.name}</strong> — llegada sugerida <strong>{fmtDate(addDays(e,1))}</strong></p>;}return null;})()}
            <Lbl>Emoji</Lbl><EmojiPick value={form.emoji||"📍"} onChange={v=>setForm(p=>({...p,emoji:v}))}/>
            <Lbl>Ciudad *</Lbl><Inp placeholder="Ej. Tokio" value={form.name||""} onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
            <Lbl>País</Lbl><Inp placeholder="Ej. Japón" value={form.country||""} onChange={e=>setForm(p=>({...p,country:e.target.value}))}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:".75rem"}}>
              <div><Lbl>Llegada</Lbl><Inp type="date" value={form.startDate||""} onChange={e=>setDestStart(e.target.value)}/></div>
              <div><Lbl>Salida</Lbl><Inp type="date" min={form.startDate||""} value={form.endDate||""} onChange={e=>setDestEnd(e.target.value)}/></div>
              <div><Lbl>Días</Lbl><Inp type="number" min="1" value={form.days||3} onChange={e=>setDestDays(e.target.value)}/></div>
            </div>
            {form.startDate&&form.endDate&&<p className="hint">📅 {fmtDate(form.startDate)} → {fmtDate(form.endDate)} · {form.days} días</p>}
            <Btns onCancel={closeModal} onOk={addDestination} label="Agregar destino"/>
          </>}

          {(modal==="newTransit"||modal==="editTransit")&&<>
            <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.5rem",fontWeight:600,margin:"0 0 1.25rem"}}>{modal==="editTransit"?"Editar trayecto":"Nuevo trayecto"}</h3>
            <Lbl>Tipo de trayecto</Lbl>
            <div style={{display:"flex",gap:".4rem",flexWrap:"wrap",marginBottom:"1.1rem"}}>
              {TRANSIT_TYPES.map(tt=>(
                <button key={tt.key} onClick={()=>setForm(p=>({...p,transitType:tt.key}))} style={{background:form.transitType===tt.key?tt.color:"rgba(28,28,30,.05)",border:"none",color:form.transitType===tt.key?"#fff":"var(--muted)",padding:".4rem .75rem",borderRadius:"6px",cursor:"pointer",fontSize:".77rem",transition:"all .15s"}}>{tt.icon} {tt.label}</button>
              ))}
            </div>
            <Lbl>Nombre / Descripción</Lbl>
            <Inp placeholder={form.transitType==="flight"?"Ej. Vuelo LAX-CDG":form.transitType==="car"?"Ej. Alquiler Hertz":form.transitType==="train"?"Ej. Tren AVE Madrid-Barcelona":"Ej. Traslado al hotel"} value={form.title||""} onChange={e=>setForm(p=>({...p,title:e.target.value}))}/>
            <Lbl>Origen → Destino</Lbl>
            <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:".5rem",alignItems:"center",marginBottom:"1rem"}}>
              <select value={form.fromDestId||""} onChange={e=>setForm(p=>({...p,fromDestId:e.target.value}))} style={{border:"1px solid rgba(28,28,30,.12)",borderRadius:"6px",padding:".55rem .7rem",fontSize:".85rem",color:"#1C1C1E",background:"#F7F4EF",cursor:"pointer"}}>
                <option value="">— Origen</option>
                {(trip?.destinations||[]).map(d=><option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
              </select>
              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1rem",color:"var(--muted)",textAlign:"center"}}>→</span>
              <select value={form.toDestId||""} onChange={e=>setForm(p=>({...p,toDestId:e.target.value}))} style={{border:"1px solid rgba(28,28,30,.12)",borderRadius:"6px",padding:".55rem .7rem",fontSize:".85rem",color:"#1C1C1E",background:"#F7F4EF",cursor:"pointer"}}>
                <option value="">— Destino</option>
                {(trip?.destinations||[]).map(d=><option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
              </select>
            </div>
            {(trip?.destinations||[]).length>2&&<>
              <Lbl>Escalas / Paradas intermedias (opcional)</Lbl>
              <div style={{display:"flex",flexWrap:"wrap",gap:".4rem",marginBottom:"1rem"}}>
                {(trip?.destinations||[]).filter(d=>d.id!==form.fromDestId&&d.id!==form.toDestId).map(d=>{
                  const via=form.viaDestIds||[];
                  const sel=via.includes(d.id);
                  return <button key={d.id} onClick={()=>setForm(p=>({...p,viaDestIds:sel?via.filter(id=>id!==d.id):[...via,d.id]}))} style={{padding:".3rem .7rem",borderRadius:"6px",border:`1px solid ${sel?d.color+"80":"rgba(28,28,30,.12)"}`,background:sel?d.color+"18":"transparent",color:sel?d.color:"var(--muted)",cursor:"pointer",fontSize:".75rem",fontFamily:"'DM Sans',sans-serif"}}>{d.emoji} {d.name}</button>;
                })}
              </div>
            </>}
            {isRental(form.transitType)
              ?<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:".75rem"}}>
                <div><Lbl>Fecha recogida</Lbl><Inp type="date" value={form.date||""} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/></div>
                <div><Lbl>Fecha devolución</Lbl><Inp type="date" min={form.date||""} value={form.returnDate||""} onChange={e=>setForm(p=>({...p,returnDate:e.target.value}))}/></div>
              </div>
              :<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:".75rem"}}>
                <div><Lbl>Fecha</Lbl><Inp type="date" value={form.date||""} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/></div>
                <div><Lbl>Hora salida</Lbl><Inp type="time" value={form.departTime||""} onChange={e=>setForm(p=>({...p,departTime:e.target.value}))}/></div>
                <div><Lbl>Hora llegada</Lbl><Inp type="time" value={form.arriveTime||""} onChange={e=>setForm(p=>({...p,arriveTime:e.target.value}))}/></div>
              </div>
            }
            {form.date&&isRental(form.transitType)&&form.returnDate&&<p className="hint">📅 {fmtDate(form.date)} → {fmtDate(form.returnDate)} · {diffDays(form.date,form.returnDate)+1} días de alquiler</p>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:".75rem"}}>
              <div><Lbl>Proveedor / Aerolínea</Lbl><Inp placeholder="Ej. Avianca" value={form.provider||""} onChange={e=>setForm(p=>({...p,provider:e.target.value}))}/></div>
              <div><Lbl>N° Confirmación / Reserva</Lbl><Inp placeholder="Ej. ABC123" value={form.confirmation||""} onChange={e=>setForm(p=>({...p,confirmation:e.target.value}))}/></div>
            </div>
            <Lbl>Costo ($)</Lbl><Inp type="number" min="0" placeholder="0" value={form.cost||""} onChange={e=>setForm(p=>({...p,cost:+e.target.value}))}/>
            <Lbl>Notas</Lbl>
            <textarea placeholder="Detalles, equipaje, instrucciones..." value={form.notes||""} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} style={{width:"100%",border:"1px solid var(--line)",borderRadius:"6px",padding:".6rem .8rem",fontSize:".85rem",color:"var(--ink)",resize:"vertical",minHeight:"60px",background:"#F7F4EF",marginBottom:"1rem"}}/>
            <Btns onCancel={closeModal} onOk={modal==="editTransit"?saveTransit:addTransit} label={modal==="editTransit"?"Guardar cambios":"Agregar trayecto"}/>
          </>}

          {(modal==="newItem"||modal==="editItem")&&<>
            <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.5rem",fontWeight:600,margin:"0 0 1.5rem"}}>{modal==="editItem"?"Editar elemento":"Nuevo elemento"}</h3>
            <Lbl>Tipo</Lbl>
            <div style={{display:"flex",gap:".4rem",flexWrap:"wrap",marginBottom:"1rem"}}>
              {Object.entries(ITEM_TYPES).map(([k,T])=>(
                <button key={k} onClick={()=>setForm(p=>({...p,type:k}))} style={{background:form.type===k?T.color:"rgba(28,28,30,.05)",border:"none",color:form.type===k?"#fff":"var(--muted)",padding:".4rem .8rem",borderRadius:"6px",cursor:"pointer",fontSize:".78rem",transition:"all .15s"}}>{T.icon} {T.label}</button>
              ))}
            </div>
            <Lbl>Título *</Lbl>
            <Inp placeholder={form.type==="hotel"?"Ej. Hotel Marriott":form.type==="food"?"Ej. Cena local":"Ej. Visita al museo"} value={form.title||""} onChange={e=>setForm(p=>({...p,title:e.target.value}))}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:".75rem"}}>
              <div>
                <Lbl>Día</Lbl>
                <Inp type="number" min="1" max={activeDest?.days||99} value={form.day||1} onChange={e=>setForm(p=>({...p,day:+e.target.value}))}/>
                {activeDest?.startDate&&form.day&&<p className="hint" style={{marginTop:"-.5rem"}}>{fmtDate(dayToDate(activeDest,Number(form.day)))}</p>}
              </div>
              <div><Lbl>Hora</Lbl><Inp type="time" value={form.time||""} onChange={e=>setForm(p=>({...p,time:e.target.value}))}/></div>
              <div><Lbl>Duración</Lbl><Inp placeholder="2h" value={form.duration||""} onChange={e=>setForm(p=>({...p,duration:e.target.value}))}/></div>
            </div>
            <Lbl>Dirección / Lugar</Lbl><Inp placeholder="Ej. Av. Principal 123" value={form.address||""} onChange={e=>setForm(p=>({...p,address:e.target.value}))}/>
            <Lbl>Costo ($)</Lbl><Inp type="number" min="0" placeholder="0" value={form.cost||""} onChange={e=>setForm(p=>({...p,cost:+e.target.value}))}/>
            <Lbl>Notas</Lbl>
            <textarea placeholder="Reserva, detalles..." value={form.notes||""} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} style={{width:"100%",border:"1px solid var(--line)",borderRadius:"6px",padding:".6rem .8rem",fontSize:".85rem",color:"var(--ink)",resize:"vertical",minHeight:"60px",background:"#F7F4EF",marginBottom:"1rem"}}/>
            <Btns onCancel={closeModal} onOk={modal==="editItem"?saveItem:addItem} label={modal==="editItem"?"Guardar cambios":"Agregar"}/>
          </>}
        </div>
      </div>}
    </div>
  );
}

// ── Micro-components ─────────────────────────────────────────────────────────
function Lbl({children}){return <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",fontWeight:500,color:"#8A8580",textTransform:"uppercase",letterSpacing:".08em",marginBottom:".35rem"}}>{children}</div>;}
function Inp({...p}){return <input {...p} style={{width:"100%",border:"1px solid rgba(28,28,30,.12)",borderRadius:"6px",padding:".6rem .8rem",fontSize:".88rem",color:"#1C1C1E",background:"#F7F4EF",marginBottom:"1rem",...(p.style||{})}}/>;}
function Btns({onCancel,onOk,label}){return <div style={{display:"flex",gap:".75rem",justifyContent:"flex-end",marginTop:".5rem"}}><button onClick={onCancel} style={{background:"rgba(28,28,30,.06)",border:"none",padding:".6rem 1.3rem",borderRadius:"7px",cursor:"pointer",fontSize:".85rem",color:"#1C1C1E"}}>Cancelar</button><button onClick={onOk} style={{background:"#C4622D",border:"none",color:"#fff",padding:".6rem 1.5rem",borderRadius:"7px",cursor:"pointer",fontSize:".85rem",fontWeight:500}}>{label}</button></div>;}
function EmojiPick({value,onChange}){
  const [open,setOpen]=useState(false);
  return <div style={{position:"relative",marginBottom:"1rem"}}>
    <button onClick={()=>setOpen(p=>!p)} style={{background:"rgba(28,28,30,.05)",border:"1px solid rgba(28,28,30,.12)",borderRadius:"6px",padding:".4rem .9rem",fontSize:"1.3rem",cursor:"pointer"}}>{value}</button>
    {open&&<div style={{position:"absolute",top:"110%",left:0,background:"#fff",border:"1px solid rgba(28,28,30,.12)",borderRadius:"8px",padding:".6rem",zIndex:10,display:"flex",flexWrap:"wrap",gap:".2rem",maxWidth:"220px",boxShadow:"0 8px 30px rgba(28,28,30,.12)"}}>
      {EMOJIS.map(e=><button key={e} onClick={()=>{onChange(e);setOpen(false);}} style={{background:"none",border:"none",fontSize:"1.2rem",cursor:"pointer",padding:".2rem",borderRadius:"4px",lineHeight:1}}>{e}</button>)}
    </div>}
  </div>;
}
