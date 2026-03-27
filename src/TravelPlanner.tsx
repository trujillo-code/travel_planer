// @ts-nocheck
import { useState, useEffect, useRef, useMemo } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { City, Country } from "country-state-city";

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
const destEnd  = (d) => d.endDate || (d.startDate ? addDays(d.startDate, (d.days||1)-1) : "");
const sortDests = (dests) => [...dests].sort((a,b) => {
  const sa = a.startDate || "9999"; const sb = b.startDate || "9999";
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ea = destEnd(a) || "9999"; const eb = destEnd(b) || "9999";
  return ea < eb ? -1 : ea > eb ? 1 : 0;
});
const EMOJIS = ["🌍","🌎","🌏","✈️","🗺️","🏖️","🏔️","🎒","🏝️","🚀","🗼","🏰","🗡","🎭","🎪","🎠","🐚","🌅","🌵","🏠","🛕","🧳","🎑","🎸","🌸","🍜","☀️","❄️","🌊","⭐","🎿","🏴","🟠","🟡","🟢","🔵","🟣"];
const CURRENCIES = [
  { code:"USD", symbol:"US$", name:"Dólar americano", flag:"🇺🇸" },
  { code:"EUR", symbol:"€",   name:"Euro",            flag:"🇪🇺" },
  { code:"COP", symbol:"COP$",name:"Peso colombiano", flag:"🇨🇴" },
];
// Costs stored in their original currency (costCurrency field: "COP" or trip currency)
// toCOP converts any amount to COP using the trip's rate
const toCOP = (amount, costCurrency, tripCurrency, rate) => {
  if (!costCurrency || costCurrency==="COP") return amount;
  if (costCurrency===tripCurrency && rate>0) return amount * rate;
  return amount;
};
const toAlt = (amount, costCurrency, tripCurrency, rate) => {
  if (!tripCurrency || tripCurrency==="COP" || !rate || rate<=0) return null;
  if (costCurrency===tripCurrency) return amount;
  return amount / rate; // COP to alt
};
const fmtCOP = (a) => `COP$${Math.round(a).toLocaleString()}`;
const fmtAltVal = (a, currency) => {
  const c = CURRENCIES.find(cc=>cc.code===currency);
  return `${c?.symbol||currency}${a.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2})}`;
};
// Show dual: COP + alt currency
const fmtDual = (copAmount, altAmount, tripCurrency) => {
  const cop = fmtCOP(copAmount);
  if (!tripCurrency || tripCurrency==="COP" || altAmount===null || altAmount===undefined) return cop;
  return `${cop} (${fmtAltVal(altAmount, tripCurrency)})`;
};
const fmtAlt = (amount, currency, rate) => {
  if (!currency || currency==="COP" || !rate || rate<=0) return null;
  return fmtAltVal(amount / rate, currency);
};

// ─── App ─────────────────────────────────────────────────────────────────────
export default function TravelPlanner({ user, onSignOut }) {
  const [trips,          setTrips]          = useState([]);
  const [activeTrip,     setActiveTrip]     = useState(null);
  const [view,           setView]           = useState("home");
  const [tripView,       setTripView]       = useState("dest"); // dest | transits | summary
  const [showEstimates,  setShowEstimates]  = useState(false);
  const [budgetView,     setBudgetView]     = useState("general"); // general | detail
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

  const _rawTrip   = trips.find(t => t.id === activeTrip);
  const trip       = _rawTrip ? { ..._rawTrip, destinations: sortDests(_rawTrip.destinations) } : undefined;
  const activeDest = trip?.destinations.find(d => d.id === activeDestId);

  // ── Computed ───────────────────────────────────────────────────────────────
  const cur = trip?.currency || "COP";
  const rate = trip?.copRate || 0;
  const _toCOP = (cost, costCur) => toCOP(cost||0, costCur||"COP", cur, rate);
  const itemsCost    = trip?.destinations.reduce((s,d)=>s+d.items.reduce((ss,i)=>ss+_toCOP(i.cost,i.costCurrency),0),0)||0;
  const transitsCost = trip?.transits?.reduce((s,t)=>s+_toCOP(t.cost,t.costCurrency),0)||0;
  // fmt: takes COP amount, shows dual
  const fmt = (copAmount) => {
    const altAmt = (cur!=="COP" && rate>0) ? copAmount/rate : null;
    return fmtDual(copAmount, altAmt, cur);
  };
  // fmtI: format an individual item/transit cost (stored in its original currency)
  const fmtI = (cost, costCur) => {
    const copAmt = _toCOP(cost, costCur);
    return fmt(copAmt);
  };
  // sumCOP: sum items converting each to COP
  const sumCOP = (items) => items.reduce((s,i)=>s+_toCOP(i.cost,i.costCurrency),0);
  const tripDays     = trip
    ? (trip.startDate&&trip.endDate ? diffDays(trip.startDate,trip.endDate)+1 : trip.destinations.reduce((s,d)=>s+d.days,0))
    : 0;

  // ── Estimates helper (trip-level) ─────────────────────────────────────────
  const estHotelRaw    = Number(trip?.estHotel) || 0;
  const estFoodRaw     = Number(trip?.estFood) || 0;
  const estActivityRaw = Number(trip?.estActivity) || 0;
  const estCur         = trip?.estCurrency || "COP";
  const estHotelCOP    = _toCOP(estHotelRaw, estCur);
  const estFoodCOP     = _toCOP(estFoodRaw, estCur);
  const estActivityCOP = _toCOP(estActivityRaw, estCur);
  const hasEstimates   = estHotelCOP>0||estFoodCOP>0||estActivityCOP>0;

  // Build date overlap map: date -> how many dests share that date
  const dateOverlap = {};
  if (trip) {
    trip.destinations.forEach(d => {
      if (!d.startDate) return;
      for (let i = 0; i < d.days; i++) {
        const dt = addDays(d.startDate, i);
        dateOverlap[dt] = (dateOverlap[dt] || 0) + 1;
      }
    });
  }

  const calcEstimates = (d) => {
    const nights = Math.max(0, d.days - 1);
    const hotelItems = d.items.filter(i => i.type === "hotel");
    let coveredNights = 0;
    hotelItems.forEach(h => {
      if (h.dayEnd && h.dayEnd > h.day) coveredNights += (h.dayEnd - h.day);
      else coveredNights += 1;
    });
    const uncoveredNights = Math.max(0, nights - coveredNights);

    // Weighted days: divide by number of dests sharing each date (for food/activities)
    // Nights: NOT shared — you sleep in one place per night
    let weightedDays = 0;
    if (d.startDate) {
      for (let i = 0; i < d.days; i++) {
        const dt = addDays(d.startDate, i);
        weightedDays += 1 / (dateOverlap[dt] || 1);
      }
    } else {
      weightedDays = d.days;
    }

    const estHotelTotal = uncoveredNights * estHotelCOP;
    const actualFoodCOP = d.items.filter(i => i.type === "food").reduce((s, i) => s + _toCOP(i.cost, i.costCurrency), 0);
    const estFoodRemaining = Math.max(0, weightedDays * estFoodCOP - actualFoodCOP);
    const actualActivityCOP = d.items.filter(i => i.type === "activity").reduce((s, i) => s + _toCOP(i.cost, i.costCurrency), 0);
    const estActivityRemaining = Math.max(0, weightedDays * estActivityCOP - actualActivityCOP);
    const total = estHotelTotal + estFoodRemaining + estActivityRemaining;
    return { weightedDays: Math.round(weightedDays*10)/10, uncoveredNights, estHotelTotal, estFoodRemaining, estActivityRemaining, total };
  };

  const estimatesCost = hasEstimates ? (trip?.destinations.reduce((s,d)=>s+calcEstimates(d).total,0)||0) : 0;
  const totalCost    = itemsCost + transitsCost + estimatesCost;

  // ── Smart date suggest for new dest ────────────────────────────────────────
  const suggestDates = () => {
    if (!trip) return { startDate:"", endDate:"", days:3 };
    const dests = sortDests(trip.destinations);
    if (dests.length === 0) {
      const start = trip.startDate || "";
      return { startDate: start, endDate: start ? addDays(start, 2) : "", days: 3 };
    }
    // Find the latest end date among all destinations
    let latestEnd = "";
    let latestDest = null;
    for (const d of dests) {
      const e = destEnd(d);
      if (e && e > latestEnd) { latestEnd = e; latestDest = d; }
    }
    return { startDate: latestEnd, endDate: latestEnd ? addDays(latestEnd, 2) : "", days: 3, _prevDest: latestDest };
  };

  // Linked date/days handlers
  const setDestStart = sd => setForm(p=>({...p,startDate:sd,endDate:sd?addDays(sd,(Number(p.days)||3)-1):p.endDate}));
  const setDestEnd   = ed => setForm(p=>({...p,endDate:ed,days:Math.max(1,p.startDate&&ed?diffDays(p.startDate,ed)+1:p.days||3)}));
  const setDestDays  = n  => { if(n===""||n===null||n===undefined)return setForm(p=>({...p,days:""})); const days=Math.max(1,Number(n)||1); setForm(p=>({...p,days,endDate:p.startDate?addDays(p.startDate,days-1):p.endDate})); };

  // Real date for local day in dest
  const dayToDate = (dest, localDay) => dest?.startDate ? addDays(dest.startDate, localDay-1) : null;

  // ── CRUD: Trips ────────────────────────────────────────────────────────────
  const closeModal = () => { setModal(null); setForm({}); setEditingItem(null); setEditingTransit(null); };

  const createTrip = () => {
    if (!form.name?.trim()) return;
    const t = { id:uid(), name:form.name, emoji:form.emoji||"🌍",
      startDate:form.startDate||"", endDate:form.endDate||"",
      budget:Number(form.budget)||0, currency:form.currency||"COP",
      copRate:Number(form.copRate)||0,
      destinations:[], transits:[], created:Date.now() };
    setTrips(p=>[...p,t]); setActiveTrip(t.id); setView("trip"); setTripView("dest"); closeModal();
  };
  const updateTrip = (patch) => { setTrips(p=>p.map(t=>t.id===activeTrip?{...t,...patch}:t)); };
  const deleteTrip = id => { setTrips(p=>p.filter(t=>t.id!==id)); if(activeTrip===id){setActiveTrip(null);setView("home");} };

  // ── CRUD: Destinations ─────────────────────────────────────────────────────
  const openNewDest = () => { setForm({emoji:"📍",...suggestDates()}); setModal("newDest"); };

  const addDestination = () => {
    if (!form.name?.trim()||!activeTrip) return;
    const dest = { id:uid(), name:form.name, country:form.country||"", emoji:form.emoji||"📍",
      startDate:form.startDate||"", endDate:form.endDate||"", days:Number(form.days)||1,
      color:DEST_COLORS[trip.destinations.length%DEST_COLORS.length], items:[] };
    setTrips(p=>p.map(t=>t.id===activeTrip?{...t,destinations:sortDests([...t.destinations,dest])}:t));
    setActiveDestId(dest.id); setDayFilter(null); closeModal();
  };
  const updateDest = (destId, patch) => {
    setTrips(p=>p.map(t=>t.id===activeTrip?{...t,destinations:t.destinations.map(d=>d.id===destId?{...d,...patch}:d)}:t));
  };
  const deleteDest = destId => {
    setTrips(p=>p.map(t=>t.id===activeTrip?{...t,destinations:t.destinations.filter(d=>d.id!==destId)}:t));
    if(activeDestId===destId) setActiveDestId(null);
  };

  // ── CRUD: Items (inside destination) ───────────────────────────────────────
  const addItem = () => {
    if (!form.type||!activeDestId) return;
    const item = { id:uid(), type:form.type, title:form.title||"", time:form.time||"",
      day:Number(form.day)||1, dayEnd:form.dayEnd?Number(form.dayEnd):undefined,
      duration:form.duration||"", cost:Number(form.cost)||0,
      costCurrency:form.costCurrency||"COP",
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
  const togglePaidItem = (destId,itemId) => setTrips(p=>p.map(t=>t.id===activeTrip?{...t,destinations:t.destinations.map(d=>d.id===destId?{...d,items:d.items.map(i=>i.id===itemId?{...i,paid:!i.paid}:i)}:d)}:t));
  const togglePaidTransit = (trId) => setTrips(p=>p.map(t=>t.id===activeTrip?{...t,transits:(t.transits||[]).map(tr=>tr.id===trId?{...tr,paid:!tr.paid}:tr)}:t));
  const openEditItem = (destId,item) => {
    setActiveDestId(destId);setEditingItem(item);
    const destDays = (activeDest?.id===destId?activeDest:trip?.destinations.find(d=>d.id===destId))?.days||1;
    const allDays = item.day===1 && item.dayEnd>=destDays ? true : item.dayEnd ? false : false;
    setForm({...item, _allDays: item.dayEnd ? allDays : false, dayEnd: item.dayEnd || undefined });
    setModal("editItem");
  };

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
      costCurrency:form.costCurrency||"COP",
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
    ? (dayFilter
        ? activeDest.items.filter(i => i.day===dayFilter || (i.dayEnd && i.day<=dayFilter && i.dayEnd>=dayFilter))
        : activeDest.items
      ).sort((a,b)=>a.day-b.day||(a.time||"").localeCompare(b.time||""))
    : [];

  // ── Build full itinerary for summary (date-based, supports overlapping dests) ──
  const buildItinerary = () => {
    if (!trip) return [];
    const dateMap = {};
    trip.destinations.forEach(dest=>{
      for(let d=1;d<=dest.days;d++){
        const realDate = dest.startDate ? addDays(dest.startDate, d-1) : `_nodate_${dest.id}_${d}`;
        if(!dateMap[realDate]) dateMap[realDate] = [];
        // Items for this day: direct day match + hotels spanning into this day
        const dayItems = dest.items.filter(i => i.day===d || (i.dayEnd && i.day<=d && i.dayEnd>=d))
          .sort((a,b)=>(a.type==="hotel"?0:1)-(b.type==="hotel"?0:1)||(a.time||"99").localeCompare(b.time||"99"));
        dateMap[realDate].push({ dest, localDay:d, items:dayItems,
          transits:(trip.transits||[]).filter(tr=>tr.fromDestId===dest.id && (
            !tr.date || tr.date===addDays(dest.startDate,d-1) || (!tr.date && d===dest.days)
          ))
        });
      }
    });
    const sortedDates = Object.keys(dateMap).sort();
    let abs=1, rows=[];
    sortedDates.forEach(date=>{
      dateMap[date].forEach(entry=>{
        rows.push({ abs, date, ...entry });
        abs++;
      });
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
        @media(max-width:1024px){
          .sidebar-mobile{width:180px!important}
          .content-padding{padding:1.25rem 1.25rem!important}
        }
        @media(max-width:768px){
          .mobile-hide{display:none!important}
          .nav-mobile{flex-wrap:wrap;height:auto!important;min-height:52px;padding:.5rem 1rem!important;gap:.4rem!important}
          .nav-tabs-mobile{width:100%;order:10;justify-content:center}
          .trip-layout{flex-direction:column!important;height:auto!important}
          .sidebar-mobile{width:100%!important;max-height:none;border-right:none!important;border-bottom:1px solid var(--line)}
          .sidebar-dests{max-height:150px;overflow-y:auto;-webkit-overflow-scrolling:touch}
          .main-content{min-height:calc(100vh - 52px)}
          .modal-inner{max-width:95vw!important;padding:1.25rem!important;margin:.5rem}
          .content-padding{padding:1rem .75rem!important}
          .form-grid-2{grid-template-columns:1fr!important}
          .form-grid-3{grid-template-columns:1fr!important}
          .est-grid{grid-template-columns:1fr!important}
          .calendar-grid>div{min-height:65px!important;padding:.25rem!important}
          .budget-label{flex:0 0 60px!important;font-size:.68rem!important}
          .trip-cards{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))!important}
          .stats-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr))!important}
          .stats-grid .span-2{grid-column:span 1!important}
          .route-vis{overflow-x:auto!important;-webkit-overflow-scrolling:touch;flex-wrap:nowrap!important}
          .day-filters{-webkit-overflow-scrolling:touch}
          .dest-header{flex-direction:column!important;align-items:flex-start!important;gap:.75rem!important}
          .sidebar-actions{flex-direction:row!important}
          .sidebar-actions>button{flex:1}
          .transit-route-grid{grid-template-columns:1fr!important;gap:.5rem!important}
          .transit-route-grid>.transit-arrow{display:none!important}
        }
        @media(max-width:480px){
          .nav-mobile{padding:.4rem .5rem!important;gap:.3rem!important}
          .modal-overlay{padding:0!important;align-items:flex-end!important}
          .modal-inner{max-width:100vw!important;padding:1rem!important;margin:0!important;border-radius:12px 12px 0 0!important;max-height:92vh!important}
          .content-padding{padding:.75rem .5rem!important}
          .trip-cards{grid-template-columns:1fr!important}
          .stats-grid{grid-template-columns:1fr 1fr!important}
          .calendar-grid>div{min-height:50px!important;padding:.15rem!important}
          .calendar-grid>div *{font-size:.5rem!important}
          .calendar-grid>div>div:first-child span:first-child{font-size:.7rem!important}
          .sidebar-dests{max-height:120px}
          .day-filters>button{font-size:.68rem!important;padding:.25rem .5rem!important;min-width:50px}
        }
      `}</style>

      {/* ── NAV ── */}
      <nav className="nav-mobile" style={{position:"sticky",top:0,zIndex:200,background:"#F7F4EF",borderBottom:"1px solid var(--line)",height:"52px",display:"flex",alignItems:"center",padding:"0 1.5rem",gap:".75rem"}}>
        <button onClick={()=>setView("home")} style={{background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:".5rem"}}>
          <span style={{fontSize:"1.2rem"}}>🧭</span>
          <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",fontWeight:600,color:"var(--ink)"}}>Travel Planner</span>
        </button>
        {view==="trip"&&trip&&<>
          <span className="mobile-hide" style={{color:"var(--line)",fontSize:"1.1rem"}}>›</span>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".85rem",color:"var(--muted)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"120px"}}>{trip.emoji} {trip.name}</span>
          {trip.startDate&&<span className="mobile-hide" style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)",background:"rgba(28,28,30,.05)",padding:".15rem .6rem",borderRadius:"10px"}}>
            {fmtShort(trip.startDate)} → {fmtShort(trip.endDate||addDays(trip.startDate,tripDays-1))} · {tripDays}d
          </span>}
        </>}
        <div style={{flex:1}}/>
        {view==="trip"&&trip&&(
          <div className="nav-tabs-mobile" style={{display:"flex",gap:".2rem",background:"rgba(28,28,30,.06)",borderRadius:"7px",padding:".2rem"}}>
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
          <span className="mobile-hide" style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)",maxWidth:"100px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user?.displayName || user?.email}</span>
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
          :<div className="trip-cards" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:"1rem"}}>
            {trips.map(t=>{
              const _r=t.copRate||0;const _c=t.currency||"COP";const _tc=(amt,cc)=>toCOP(amt||0,cc||"COP",_c,_r);
              const cost=t.destinations.reduce((s,d)=>s+d.items.reduce((ss,i)=>ss+_tc(i.cost,i.costCurrency),0),0)+(t.transits||[]).reduce((s,tr)=>s+_tc(tr.cost,tr.costCurrency),0);
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
                  {cost>0&&<span style={{fontSize:".72rem",padding:".2rem .6rem",background:"rgba(196,98,45,.08)",borderRadius:"20px",color:"var(--accent)",fontFamily:"'DM Sans',sans-serif"}}>💰 {fmtDual(cost,(_c!=="COP"&&_r>0)?cost/_r:null,_c)}</span>}
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
      {view==="trip"&&trip&&<div className="trip-layout" style={{display:"flex",height:"calc(100vh - 52px)"}}>

        {/* SIDEBAR */}
        <aside className="sidebar-mobile" style={{width:"224px",flexShrink:0,borderRight:"1px solid var(--line)",background:"#fff",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{padding:"1rem 1rem .75rem",borderBottom:"1px solid var(--line)"}}>
            <div style={{fontSize:"1.5rem",marginBottom:".2rem"}}>{trip.emoji}</div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1rem",fontWeight:600,lineHeight:1.2,marginBottom:".2rem"}}>{trip.name}</div>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"var(--muted)",marginBottom:".3rem"}}>
              {trip.startDate?`${fmtShort(trip.startDate)} → ${fmtShort(trip.endDate||addDays(trip.startDate,tripDays-1))} · ${tripDays}d`:`${tripDays} días`}
            </div>
            {totalCost>0&&<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"var(--accent)",marginBottom:".6rem"}}>💰 {fmt(totalCost)}</div>}
            {trip.destinations.length>0&&<div style={{display:"flex",height:"5px",borderRadius:"3px",overflow:"hidden",marginBottom:".5rem",gap:"2px"}}>
              {trip.destinations.map(d=>(
                <div key={d.id} onClick={()=>{setActiveDestId(d.id);setDayFilter(null);setTripView("dest");}} title={`${d.name} · ${d.days}d`}
                  style={{flex:d.days,background:d.color,opacity:activeDestId===d.id&&tripView==="dest"?1:.4,cursor:"pointer",transition:"opacity .15s",borderRadius:"2px"}}/>
              ))}
            </div>}
          </div>

          {/* dest list */}
          <div className="sidebar-dests" style={{flex:1,overflowY:"auto",padding:".4rem 0",WebkitOverflowScrolling:"touch"}}>
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

          <div className="sidebar-actions" style={{padding:".6rem",borderTop:"1px solid var(--line)",display:"flex",flexDirection:"column",gap:".4rem"}}>
            <button onClick={openNewDest} className="hov-add" style={{width:"100%",background:"none",border:"1.5px dashed rgba(28,28,30,.18)",borderRadius:"6px",padding:".4rem",color:"var(--muted)",cursor:"pointer",fontSize:".75rem",transition:"all .2s"}}>📍 Destino</button>
            <button onClick={()=>{openNewTransit();}} className="hov-add" style={{width:"100%",background:"none",border:"1.5px dashed rgba(90,180,232,.5)",borderRadius:"6px",padding:".4rem",color:"#5AB4E8",cursor:"pointer",fontSize:".75rem",transition:"all .2s"}}>🚀 Trayecto</button>
          </div>
        </aside>

        {/* MAIN */}
        <main className="main-content" style={{flex:1,overflowY:"auto",background:"#F7F4EF"}}>

          {/* ── TRANSITS VIEW ───────────────────────────────────────────────── */}
          {tripView==="transits"&&<div className="content-padding" style={{padding:"1.5rem 2rem",maxWidth:"860px"}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"1.75rem"}}>
              <div>
                <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.9rem",fontWeight:600,margin:"0 0 .3rem"}}>Trayectos</h2>
                <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:".8rem",color:"var(--muted)",margin:0}}>
                  Conecta tus destinos con vuelos, trenes, buses, alquileres y más.
                  {(trip.transits||[]).length>0&&` · ${(trip.transits||[]).length} trayectos · {fmt(transitsCost)}`}
                </p>
              </div>
              <button onClick={openNewTransit} style={{background:"var(--accent)",border:"none",color:"#fff",padding:".55rem 1.2rem",borderRadius:"8px",fontSize:".82rem",fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>+ Agregar</button>
            </div>

            {trip.destinations.length>=2&&(()=>{
              // Build rental coverage: for each rental, find which dest indices it covers
              const dests = trip.destinations;
              const rentalCoverage = {};
              (trip.transits||[]).filter(tr=>isRental(tr.transitType)).forEach(tr=>{
                const fromIdx = dests.findIndex(d=>d.id===tr.fromDestId);
                const toIdx   = dests.findIndex(d=>d.id===tr.toDestId);
                if(fromIdx<0||toIdx<0) return;
                const lo=Math.min(fromIdx,toIdx), hi=Math.max(fromIdx,toIdx);
                for(let i=lo;i<hi;i++){
                  if(!rentalCoverage[i]) rentalCoverage[i]=[];
                  rentalCoverage[i].push(tr);
                }
              });

              return <div style={{marginBottom:"2rem",padding:"1.25rem 1.5rem",background:"#fff",border:"1px solid var(--line)",borderRadius:"12px"}}>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:"1rem"}}>Ruta del viaje</div>

                {/* Rental bars */}
                {(()=>{
                  const rentals = (trip.transits||[]).filter(tr=>isRental(tr.transitType));
                  if(!rentals.length) return null;
                  return <div style={{marginBottom:".75rem",display:"flex",flexDirection:"column",gap:".4rem"}}>
                    {rentals.map(tr=>{
                      const tt=ttInfo(tr.transitType);
                      const fromIdx=dests.findIndex(d=>d.id===tr.fromDestId);
                      const toIdx=dests.findIndex(d=>d.id===tr.toDestId);
                      if(fromIdx<0||toIdx<0) return null;
                      const lo=Math.min(fromIdx,toIdx), hi=Math.max(fromIdx,toIdx);
                      const covered=dests.slice(lo,hi+1);
                      return <div key={tr.id} onClick={()=>openEditTransit(tr)} style={{display:"flex",alignItems:"center",gap:".4rem",padding:".4rem .7rem",background:tt.color+"10",border:`1px solid ${tt.color}35`,borderRadius:"8px",cursor:"pointer"}}>
                        <span style={{fontSize:"1rem"}}>{tt.icon}</span>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".75rem",fontWeight:600,color:tt.color}}>{tr.title||tt.label}</span>
                        <div style={{display:"flex",alignItems:"center",gap:".2rem",flex:1,flexWrap:"wrap"}}>
                          {covered.map((d,ci)=><span key={d.id} style={{display:"flex",alignItems:"center",gap:".15rem"}}>
                            {ci>0&&<span style={{color:tt.color,fontSize:".7rem",margin:"0 .1rem"}}>→</span>}
                            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",padding:".1rem .4rem",background:d.color+"18",borderRadius:"4px",color:d.color,fontWeight:500}}>{d.emoji} {d.name}</span>
                          </span>)}
                        </div>
                        {tr.date&&tr.returnDate&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".6rem",color:"var(--muted)",whiteSpace:"nowrap"}}>{fmtShort(tr.date)}→{fmtShort(tr.returnDate)}</span>}
                        {tr.cost>0&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".65rem",color:"var(--accent)",fontWeight:500}}>{fmtI(tr.cost,tr.costCurrency)}</span>}
                      </div>;
                    })}
                  </div>;
                })()}

                <div className="route-vis" style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:0}}>
                  {dests.map((d,i)=>{
                    // Non-rental transits between consecutive dests
                    const transitBetween = (trip.transits||[]).filter(tr=>!isRental(tr.transitType)&&tr.fromDestId===d.id&&tr.toDestId===dests[i+1]?.id);
                    // Rental connecting this gap
                    const rentalHere = rentalCoverage[i] || [];
                    return <div key={d.id} style={{display:"flex",alignItems:"center"}}>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"0 .5rem"}}>
                        <div style={{width:"38px",height:"38px",borderRadius:"50%",background:d.color+"20",border:`2px solid ${d.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.1rem"}}>{d.emoji}</div>
                        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",fontWeight:600,color:d.color,marginTop:".25rem",maxWidth:"70px",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                        {d.startDate&&<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".58rem",color:"var(--muted)"}}>{fmtShort(d.startDate)}</div>}
                      </div>
                      {i<dests.length-1&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",minWidth:"60px"}}>
                        {transitBetween.length>0
                          ?transitBetween.map(tr=>{
                            const tt=ttInfo(tr.transitType);
                            return <div key={tr.id} style={{display:"flex",alignItems:"center",gap:".25rem",padding:".15rem .5rem",background:tt.color+"15",borderRadius:"10px",border:`1px solid ${tt.color}40`,cursor:"pointer"}} onClick={()=>openEditTransit(tr)}>
                              <span style={{fontSize:".85rem"}}>{tt.icon}</span>
                              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".62rem",color:tt.color,fontWeight:500}}>{tr.title||tt.label}</span>
                            </div>;
                          })
                          :rentalHere.length>0
                            ?<div style={{display:"flex",alignItems:"center",gap:".2rem",padding:".1rem .4rem",background:"#E8C45A15",borderRadius:"8px",border:"1px solid #E8C45A35"}}>
                              <span style={{fontSize:".75rem"}}>🚗</span>
                              <div style={{height:"2px",width:"25px",background:"#E8C45A",borderRadius:"1px"}}/>
                            </div>
                            :<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:".15rem"}}>
                              <div style={{height:"2px",width:"40px",background:"rgba(28,28,30,.1)",borderRadius:"1px"}}/>
                              <button onClick={()=>{setForm({transitType:"flight",fromDestId:d.id,toDestId:dests[i+1]?.id||"",date:d.endDate||""});setModal("newTransit");}} style={{fontFamily:"'DM Sans',sans-serif",fontSize:".6rem",color:"var(--accent)",background:"none",border:"1px dashed rgba(196,98,45,.3)",padding:".1rem .4rem",borderRadius:"8px",cursor:"pointer"}}>+ añadir</button>
                            </div>
                        }
                      </div>}
                    </div>;
                  })}
                </div>
              </div>;
            })()}

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
                          {tr.date&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)"}}>📅 {fmtDate(tr.date)}{tr.returnDate&&tr.returnDate!==tr.date?` → ${fmtDate(tr.returnDate)}`:""}</span>}
                          {tr.departTime&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)"}}>🕐 {tr.departTime}{tr.arriveTime?` → ${tr.arriveTime}`:""}</span>}
                          {tr.provider&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)"}}>🏢 {tr.provider}</span>}
                          {tr.confirmation&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)"}}>📋 {tr.confirmation}</span>}
                          {tr.cost>0&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--accent)",fontWeight:500}}>💶 {fmtI(tr.cost,tr.costCurrency)}</span>}
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
                  Total trayectos: {fmt(transitsCost)}
                </div>}
              </div>
            }
          </div>}

          {/* ── SUMMARY VIEW ────────────────────────────────────────────────── */}
          {tripView==="summary"&&<div className="content-padding" style={{padding:"1.5rem 2rem",maxWidth:"860px"}}>
            <div style={{marginBottom:"1.75rem"}}>
              <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.9rem",fontWeight:600,margin:"0 0 .3rem"}}>Resumen del itinerario</h2>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:".8rem",color:"var(--muted)",margin:0}}>
                {trip.destinations.length} destinos · {(trip.transits||[]).length} trayectos · {tripDays} días
                {trip.startDate&&` · desde ${fmtDate(trip.startDate)}`}
                {totalCost>0&&` · ${fmt(totalCost)} estimado`}
              </p>
            </div>

            {trip.destinations.length>0&&(()=>{
              const dests=trip.destinations;
              const rentalCov={};
              (trip.transits||[]).filter(tr=>isRental(tr.transitType)).forEach(tr=>{
                const fi=dests.findIndex(d=>d.id===tr.fromDestId),ti=dests.findIndex(d=>d.id===tr.toDestId);
                if(fi<0||ti<0)return;const lo=Math.min(fi,ti),hi=Math.max(fi,ti);
                for(let i=lo;i<hi;i++){if(!rentalCov[i])rentalCov[i]=[];rentalCov[i].push(tr);}
              });
              const rentals=(trip.transits||[]).filter(tr=>isRental(tr.transitType));

              return <div style={{marginBottom:"1.5rem",padding:"1rem 1.25rem",background:"#fff",border:"1px solid var(--line)",borderRadius:"10px"}}>
                {rentals.length>0&&<div style={{display:"flex",flexDirection:"column",gap:".35rem",marginBottom:".75rem"}}>
                  {rentals.map(tr=>{
                    const tt=ttInfo(tr.transitType);
                    const fi=dests.findIndex(d=>d.id===tr.fromDestId),ti=dests.findIndex(d=>d.id===tr.toDestId);
                    if(fi<0||ti<0)return null;
                    const covered=dests.slice(Math.min(fi,ti),Math.max(fi,ti)+1);
                    return <div key={tr.id} style={{display:"flex",alignItems:"center",gap:".35rem",padding:".3rem .6rem",background:tt.color+"10",border:`1px solid ${tt.color}30`,borderRadius:"8px",fontSize:".7rem",fontFamily:"'DM Sans',sans-serif"}}>
                      <span style={{fontSize:".85rem"}}>{tt.icon}</span>
                      <span style={{fontWeight:600,color:tt.color}}>{tr.title||tt.label}</span>
                      {covered.map((cd,ci)=><span key={cd.id} style={{display:"flex",alignItems:"center",gap:".1rem"}}>
                        {ci>0&&<span style={{color:tt.color,fontSize:".65rem"}}>→</span>}
                        <span style={{color:cd.color,fontWeight:500}}>{cd.emoji}{cd.name}</span>
                      </span>)}
                      {tr.date&&tr.returnDate&&<span style={{color:"var(--muted)",fontSize:".6rem",marginLeft:"auto"}}>{fmtShort(tr.date)}→{fmtShort(tr.returnDate)}</span>}
                    </div>;
                  })}
                </div>}
                <div className="route-vis" style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:".2rem",overflowX:"auto"}}>
                  {dests.map((d,i)=>{
                    const trs=(trip.transits||[]).filter(tr=>!isRental(tr.transitType)&&tr.fromDestId===d.id&&tr.toDestId===dests[i+1]?.id);
                    const hasRental=!!rentalCov[i];
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
                      {i<dests.length-1&&<div style={{display:"flex",alignItems:"center",gap:".1rem",padding:"0 .1rem"}}>
                        {trs.length>0
                          ?trs.map(tr=>{const tt=ttInfo(tr.transitType);return <span key={tr.id} title={tr.title||tt.label} style={{fontSize:".9rem"}}>{tt.icon}</span>;})
                          :hasRental
                            ?<span style={{fontSize:".75rem",color:"#E8C45A"}} title="Auto alquilado">🚗</span>
                            :<span style={{color:"var(--muted)",fontSize:".8rem"}}>→</span>
                        }
                      </div>}
                    </div>;
                  })}
                </div>
              </div>;
            })()}

            {(()=>{
              const all=trip.destinations.flatMap(d=>d.items);
              const conf=all.filter(i=>i.confirmed).length;
              const tconf=(trip.transits||[]).filter(t=>t.confirmed).length;
              return <div className="stats-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:".75rem",marginBottom:"2rem"}}>
                {[["📅","Días",tripDays],["📍","Destinos",trip.destinations.length],["🚀","Trayectos",`${tconf}/${(trip.transits||[]).length}`],["🎯","Actividades",all.filter(i=>i.type==="activity").length],["🏨","Hospedajes",all.filter(i=>i.type==="hotel").length],["✓","Confirmados",`${conf}/${all.length}`]].map(([ic,lb,vl])=>(
                  <div key={lb} style={{background:"#fff",border:"1px solid var(--line)",borderRadius:"8px",padding:".9rem 1rem"}}>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.1rem",fontWeight:600,color:"var(--accent)"}}>{vl}</div>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".65rem",color:"var(--muted)",marginTop:".1rem",textTransform:"uppercase",letterSpacing:".05em"}}>{ic} {lb}</div>
                  </div>
                ))}
                {totalCost>0&&<div className="span-2" style={{background:"#fff",border:"1px solid var(--line)",borderRadius:"8px",padding:".9rem 1rem",gridColumn:"span 2"}}>
                  <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".95rem",fontWeight:600,color:"var(--accent)"}}>{fmt(totalCost)}</div>
                  <div style={{display:"flex",gap:".75rem",marginTop:".2rem",fontFamily:"'DM Sans',sans-serif",fontSize:".62rem"}}>
                    <span style={{color:"var(--muted)",textTransform:"uppercase",letterSpacing:".05em"}}>💰 Total</span>
                    {itemsCost+transitsCost>0&&<span style={{color:"var(--ink)"}}>Registrado: {fmt(itemsCost+transitsCost)}</span>}
                    {estimatesCost>0&&<span style={{color:"var(--muted)"}}>+ Est: {fmt(estimatesCost)}</span>}
                  </div>
                </div>}
              </div>;
            })()}

            {/* ── Trip-level estimates ── */}
            {(()=>{
              const eCur = trip.estCurrency||"COP";
              const curBtn = (field) => <div style={{display:"flex",gap:".2rem",flexShrink:0}}>
                <button onClick={()=>updateTrip({estCurrency:"COP"})} style={{background:eCur==="COP"?"var(--accent)":"rgba(28,28,30,.06)",border:"none",color:eCur==="COP"?"#fff":"var(--muted)",padding:".3rem .45rem",borderRadius:"5px",cursor:"pointer",fontSize:".65rem"}}>COP</button>
                {cur!=="COP"&&<button onClick={()=>updateTrip({estCurrency:cur})} style={{background:eCur===cur?"var(--accent)":"rgba(28,28,30,.06)",border:"none",color:eCur===cur?"#fff":"var(--muted)",padding:".3rem .45rem",borderRadius:"5px",cursor:"pointer",fontSize:".65rem"}}>{(CURRENCIES.find(c=>c.code===cur)||{}).symbol||cur}</button>}
              </div>;
              const inp = (val,key) => <input type="number" min="0" placeholder="0" value={val||""} onChange={e=>updateTrip({[key]:+e.target.value})}
                style={{flex:1,minWidth:0,border:"1px solid rgba(28,28,30,.12)",borderRadius:"6px",padding:".45rem .6rem",fontSize:".82rem",color:"#1C1C1E",background:"#F7F4EF"}}/>;
              return <div style={{marginBottom:"2rem",padding:"1rem 1.5rem",background:"#fff",border:"1px solid var(--line)",borderRadius:"10px"}}>
                <div onClick={()=>setShowEstimates(p=>!p)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",userSelect:"none"}}>
                  <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em"}}>
                    Estimados diarios {hasEstimates&&<span style={{color:"var(--accent)",fontWeight:500,textTransform:"none",letterSpacing:0}}>· pendiente {fmt(estimatesCost)}</span>}
                  </div>
                  <span style={{fontSize:".8rem",color:"var(--muted)",transition:"transform .2s",transform:showEstimates?"rotate(180deg)":"rotate(0)"}}>{showEstimates?"▾":"▸"}</span>
                </div>
                {showEstimates&&<><div className="est-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:".75rem",marginTop:"1rem",marginBottom:".75rem"}}>
                  <div>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"#7EC87E",fontWeight:500,marginBottom:".3rem"}}>🏨 Hospedaje/noche</div>
                    <div style={{display:"flex",gap:".3rem",alignItems:"center"}}>{inp(trip.estHotel,"estHotel")}{curBtn()}</div>
                  </div>
                  <div>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"#E8845A",fontWeight:500,marginBottom:".3rem"}}>🍽️ Comida/día</div>
                    <div style={{display:"flex",gap:".3rem",alignItems:"center"}}>{inp(trip.estFood,"estFood")}{curBtn()}</div>
                  </div>
                  <div>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".68rem",color:"#5AB4E8",fontWeight:500,marginBottom:".3rem"}}>🎯 Actividades/día</div>
                    <div style={{display:"flex",gap:".3rem",alignItems:"center"}}>{inp(trip.estActivity,"estActivity")}{curBtn()}</div>
                  </div>
                </div>
                {hasEstimates&&trip.destinations.length>0&&<div style={{padding:".6rem .75rem",background:"rgba(28,28,30,.02)",borderRadius:"8px",border:"1px solid rgba(28,28,30,.06)"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'DM Sans',sans-serif",fontSize:".72rem"}}>
                    <thead><tr style={{color:"var(--muted)",fontSize:".62rem",textTransform:"uppercase",letterSpacing:".05em"}}>
                      <th style={{textAlign:"left",padding:".2rem 0",fontWeight:500}}>Destino</th>
                      {estHotelCOP>0&&<th style={{textAlign:"center",padding:".2rem",fontWeight:500}}>🏨</th>}
                      {estFoodCOP>0&&<th style={{textAlign:"center",padding:".2rem",fontWeight:500}}>🍽️</th>}
                      {estActivityCOP>0&&<th style={{textAlign:"center",padding:".2rem",fontWeight:500}}>🎯</th>}
                      <th style={{textAlign:"right",padding:".2rem 0",fontWeight:500}}>Pend.</th>
                    </tr></thead>
                    <tbody>{trip.destinations.map(d=>{
                      const est=calcEstimates(d);
                      if(!est.total) return null;
                      return <tr key={d.id} style={{borderTop:"1px solid rgba(28,28,30,.04)"}}>
                        <td style={{padding:".3rem 0"}}>{d.emoji} {d.name}</td>
                        {estHotelCOP>0&&<td style={{textAlign:"center",color:"#7EC87E",padding:".3rem .2rem"}}>{est.uncoveredNights>0?`${est.uncoveredNights}n`:"✓"}</td>}
                        {estFoodCOP>0&&<td style={{textAlign:"center",color:"#E8845A",padding:".3rem .2rem"}}>{est.estFoodRemaining>0?`${est.weightedDays}d`:"✓"}</td>}
                        {estActivityCOP>0&&<td style={{textAlign:"center",color:"#5AB4E8",padding:".3rem .2rem"}}>{est.estActivityRemaining>0?`${est.weightedDays}d`:"✓"}</td>}
                        <td style={{textAlign:"right",color:"var(--accent)",fontWeight:500,padding:".3rem 0"}}>{fmt(est.total)}</td>
                      </tr>;
                    })}</tbody>
                    <tfoot><tr style={{borderTop:"1px solid rgba(28,28,30,.1)"}}>
                      <td colSpan={1+(estHotelCOP>0?1:0)+(estFoodCOP>0?1:0)+(estActivityCOP>0?1:0)} style={{padding:".4rem 0",fontWeight:500,color:"var(--muted)"}}>Total pendiente</td>
                      <td style={{textAlign:"right",padding:".4rem 0",fontWeight:600,color:"var(--accent)"}}>{fmt(estimatesCost)}</td>
                    </tr></tfoot>
                  </table>
                </div>}
                </>}
              </div>;
            })()}

            {/* ── Calendar Grid ── */}
            {trip.startDate&&trip.destinations.length>0&&(()=>{
              const itinerary=buildItinerary();
              if(itinerary.length===0) return null;
              // Group by date for calendar cells
              const byDate={};
              itinerary.forEach(row=>{
                const rd=row.date&&!row.date.startsWith("_")?row.date:null;
                if(!rd) return;
                if(!byDate[rd]) byDate[rd]=[];
                byDate[rd].push(row);
              });
              const dates=Object.keys(byDate).sort();
              if(dates.length===0) return null;
              const startD=new Date(dates[0]+"T00:00:00");
              const firstDow=startD.getDay();
              // Find transits by date
              const transitsByDate={};
              (trip.transits||[]).forEach(tr=>{
                if(tr.date){if(!transitsByDate[tr.date])transitsByDate[tr.date]=[];transitsByDate[tr.date].push(tr);}
                if(tr.returnDate&&tr.returnDate!==tr.date){if(!transitsByDate[tr.returnDate])transitsByDate[tr.returnDate]=[];transitsByDate[tr.returnDate].push(tr);}
              });

              return <div style={{marginBottom:"2rem",background:"#fff",border:"1px solid var(--line)",borderRadius:"10px",padding:"1.25rem 1.5rem"}}>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:"1rem"}}>Calendario</div>
                <div className="calendar-grid" style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:".4rem",marginBottom:".5rem"}}>
                  {["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"].map(d=><div key={d} style={{textAlign:"center",fontFamily:"'DM Sans',sans-serif",fontSize:".7rem",color:"var(--muted)",fontWeight:600,padding:".35rem 0"}}>{d}</div>)}
                </div>
                <div className="calendar-grid" style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:".4rem"}}>
                  {Array.from({length:firstDow}).map((_,i)=><div key={"e"+i}/>)}
                  {dates.map(date=>{
                    const entries=byDate[date];
                    const dayNum=new Date(date+"T00:00:00").getDate();
                    const monthStr=new Date(date+"T00:00:00").toLocaleDateString("es-ES",{month:"short"});
                    const allItems=entries.flatMap(e=>e.items);
                    const multi=entries.length>1;
                    const first=entries[0];
                    const dayTransits=transitsByDate[date]||[];
                    const hotels=allItems.filter(i=>i.type==="hotel");
                    const activities=allItems.filter(i=>i.type==="activity");
                    const foods=allItems.filter(i=>i.type==="food");
                    const notes=allItems.filter(i=>i.type==="note");
                    const bg=multi
                      ?`linear-gradient(135deg, ${entries.map((e,i)=>`${e.dest.color}15 ${(i/entries.length)*100}%, ${e.dest.color}15 ${((i+1)/entries.length)*100}%`).join(", ")})`
                      :first.dest.color+"10";
                    const itemClick=(e,destId,localDay)=>{e.stopPropagation();setActiveDestId(destId);setDayFilter(localDay);setTripView("dest");};
                    return <div key={date}
                      style={{background:bg,border:`1.5px solid ${multi?"var(--accent)40":first.dest.color+"25"}`,borderRadius:"8px",padding:".4rem",minHeight:"100px",cursor:"default",transition:"all .15s",display:"flex",flexDirection:"column",gap:"3px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"2px",padding:"0 .1rem"}}>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".85rem",fontWeight:700,color:multi?"var(--ink)":first.dest.color}}>{dayNum}</span>
                        {dayNum===1&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".58rem",color:"var(--muted)",textTransform:"uppercase",fontWeight:500}}>{monthStr}</span>}
                      </div>
                      {entries.map(e=><div key={e.dest.id}
                        onClick={(ev)=>itemClick(ev,e.dest.id,e.localDay)}
                        style={{display:"flex",alignItems:"center",gap:"3px",padding:".15rem .25rem",borderRadius:"4px",cursor:"pointer",background:e.dest.color+"12",transition:"background .1s"}}
                        onMouseEnter={ev=>ev.currentTarget.style.background=e.dest.color+"25"}
                        onMouseLeave={ev=>ev.currentTarget.style.background=e.dest.color+"12"}>
                        <span style={{fontSize:".65rem",flexShrink:0}}>{e.dest.emoji}</span>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".6rem",fontWeight:600,color:e.dest.color,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.dest.name}</span>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".52rem",color:e.dest.color+"90",marginLeft:"auto",flexShrink:0}}>d{e.localDay}</span>
                      </div>)}
                      {hotels.map(h=><div key={h.id}
                        onClick={(ev)=>{ev.stopPropagation();const dest=entries.find(e=>e.items.includes(h));if(dest){openEditItem(dest.dest.id,h);}}}
                        style={{display:"flex",alignItems:"center",gap:"3px",padding:".12rem .25rem",borderRadius:"4px",cursor:"pointer",background:"#7EC87E10",transition:"background .1s"}}
                        onMouseEnter={ev=>ev.currentTarget.style.background="#7EC87E22"}
                        onMouseLeave={ev=>ev.currentTarget.style.background="#7EC87E10"}>
                        <span style={{fontSize:".6rem"}}>🏨</span>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".56rem",color:"#7EC87E",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.title||"Hospedaje"}</span>
                      </div>)}
                      {activities.map(a=><div key={a.id}
                        onClick={(ev)=>{ev.stopPropagation();const dest=entries.find(e=>e.items.includes(a));if(dest){openEditItem(dest.dest.id,a);}}}
                        style={{display:"flex",alignItems:"center",gap:"3px",padding:".12rem .25rem",borderRadius:"4px",cursor:"pointer",background:"#5AB4E810",transition:"background .1s"}}
                        onMouseEnter={ev=>ev.currentTarget.style.background="#5AB4E822"}
                        onMouseLeave={ev=>ev.currentTarget.style.background="#5AB4E810"}>
                        <span style={{fontSize:".6rem"}}>🎯</span>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".56rem",color:"#5AB4E8",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.title||"Actividad"}</span>
                      </div>)}
                      {foods.map(f=><div key={f.id}
                        onClick={(ev)=>{ev.stopPropagation();const dest=entries.find(e=>e.items.includes(f));if(dest){openEditItem(dest.dest.id,f);}}}
                        style={{display:"flex",alignItems:"center",gap:"3px",padding:".12rem .25rem",borderRadius:"4px",cursor:"pointer",background:"#E8845A10",transition:"background .1s"}}
                        onMouseEnter={ev=>ev.currentTarget.style.background="#E8845A22"}
                        onMouseLeave={ev=>ev.currentTarget.style.background="#E8845A10"}>
                        <span style={{fontSize:".6rem"}}>🍽️</span>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".56rem",color:"#E8845A",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.title||"Comida"}</span>
                      </div>)}
                      {notes.map(n=><div key={n.id}
                        onClick={(ev)=>{ev.stopPropagation();const dest=entries.find(e=>e.items.includes(n));if(dest){openEditItem(dest.dest.id,n);}}}
                        style={{display:"flex",alignItems:"center",gap:"3px",padding:".12rem .25rem",borderRadius:"4px",cursor:"pointer",background:"#B87EE810"}}
                        onMouseEnter={ev=>ev.currentTarget.style.background="#B87EE822"}
                        onMouseLeave={ev=>ev.currentTarget.style.background="#B87EE810"}>
                        <span style={{fontSize:".6rem"}}>📝</span>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".56rem",color:"#B87EE8",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{n.title||"Nota"}</span>
                      </div>)}
                      {dayTransits.map(tr=>{
                        const tt=ttInfo(tr.transitType);
                        return <div key={tr.id}
                          onClick={(ev)=>{ev.stopPropagation();openEditTransit(tr);}}
                          style={{display:"flex",alignItems:"center",gap:"3px",padding:".12rem .25rem",borderRadius:"4px",cursor:"pointer",background:tt.color+"10",transition:"background .1s"}}
                          onMouseEnter={ev=>ev.currentTarget.style.background=tt.color+"22"}
                          onMouseLeave={ev=>ev.currentTarget.style.background=tt.color+"10"}>
                          <span style={{fontSize:".6rem"}}>{tt.icon}</span>
                          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".56rem",color:tt.color,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tr.title||tt.label}</span>
                        </div>;
                      })}
                    </div>;
                  })}
                </div>
              </div>;
            })()}

            {trip.destinations.length===0&&<div style={{textAlign:"center",padding:"3rem",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif"}}><div style={{fontSize:"2.5rem",marginBottom:".75rem"}}>🏝️</div><p>Añade destinos para ver el itinerario.</p></div>}

            {(()=>{
              const allItems=trip.destinations.flatMap(d=>d.items.map(i=>({...i,_destId:d.id,_destName:d.name,_destEmoji:d.emoji,_destColor:d.color})));
              const allTransits=(trip.transits||[]).filter(tr=>tr.cost>0);
              const registered=itemsCost+transitsCost;
              const paidItemsCOP=allItems.filter(i=>i.paid&&i.cost>0).reduce((s,i)=>s+_toCOP(i.cost,i.costCurrency),0);
              const paidTransitsCOP=allTransits.filter(t=>t.paid).reduce((s,t)=>s+_toCOP(t.cost,t.costCurrency),0);
              const totalPaid=paidItemsCOP+paidTransitsCOP;
              const pending=registered-totalPaid;
              if(!registered&&!estimatesCost) return null;

              // Group items by type for "rubro" view
              const byType={};
              allItems.filter(i=>i.cost>0).forEach(i=>{
                if(!byType[i.type])byType[i.type]=[];
                byType[i.type].push(i);
              });

              const rowStyle={display:"flex",alignItems:"center",gap:".5rem",padding:".4rem .6rem",borderRadius:"6px",fontFamily:"'DM Sans',sans-serif",fontSize:".76rem",transition:"background .1s"};
              const paidBtn=(paid,onClick)=><button onClick={onClick} style={{background:paid?"#7EC87E":"rgba(28,28,30,.06)",border:`1px solid ${paid?"#7EC87E":"rgba(28,28,30,.15)"}`,color:paid?"#fff":"var(--muted)",padding:".2rem .4rem",borderRadius:"4px",cursor:"pointer",fontSize:".65rem",flexShrink:0,minWidth:"22px",textAlign:"center"}}>{paid?"✓":"$"}</button>;

              return <div style={{marginTop:"1.5rem",padding:"1.25rem 1.5rem",background:"#fff",border:"1px solid var(--line)",borderRadius:"10px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem"}}>
                  <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em"}}>Desglose de gastos</div>
                  <div style={{display:"flex",gap:".2rem",background:"rgba(28,28,30,.06)",borderRadius:"5px",padding:".15rem"}}>
                    {[["general","General"],["detail","Detalle"]].map(([k,l])=>(
                      <button key={k} onClick={()=>setBudgetView(k)} style={{background:budgetView===k?"#fff":"transparent",border:"none",color:budgetView===k?"var(--ink)":"var(--muted)",padding:".2rem .6rem",borderRadius:"4px",cursor:"pointer",fontSize:".68rem",fontWeight:budgetView===k?500:400,boxShadow:budgetView===k?"0 1px 3px rgba(0,0,0,.08)":"none"}}>{l}</button>
                    ))}
                  </div>
                </div>

                {/* Paid summary bar */}
                {(registered>0||estimatesCost>0)&&<div style={{marginBottom:"1rem",padding:".6rem .8rem",background:"rgba(28,28,30,.02)",borderRadius:"8px",border:"1px solid rgba(28,28,30,.06)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontFamily:"'DM Sans',sans-serif",fontSize:".73rem",marginBottom:".35rem",flexWrap:"wrap",gap:".3rem"}}>
                    <span style={{color:"#7EC87E",fontWeight:500}}>✓ Pagado: {fmt(totalPaid)}</span>
                    {pending>0&&<span style={{color:"var(--accent)",fontWeight:500}}>Por pagar: {fmt(pending)}</span>}
                    {estimatesCost>0&&<span style={{color:"var(--muted)",fontWeight:500}}>Estimados: {fmt(estimatesCost)}</span>}
                  </div>
                  <div style={{height:"6px",background:"rgba(28,28,30,.06)",borderRadius:"3px",overflow:"hidden",display:"flex"}}>
                    {totalPaid>0&&<div style={{height:"100%",width:`${totalCost>0?(totalPaid/totalCost)*100:0}%`,background:"#7EC87E",transition:"width .3s"}}/>}
                    {pending>0&&<div style={{height:"100%",width:`${totalCost>0?(pending/totalCost)*100:0}%`,background:"rgba(196,98,45,.35)",transition:"width .3s"}}/>}
                    {estimatesCost>0&&<div style={{height:"100%",width:`${totalCost>0?(estimatesCost/totalCost)*100:0}%`,background:"rgba(138,133,128,.2)",transition:"width .3s"}}/>}
                  </div>
                </div>}

                {budgetView==="general"&&(()=>{
                  // Group all dest items by type
                  const destItemsCost = itemsCost;
                  const typeGroups = {};
                  trip.destinations.forEach(d=>d.items.filter(i=>i.cost>0).forEach(i=>{
                    const k=i.type;if(!typeGroups[k])typeGroups[k]={items:[],total:0,paid:0};
                    const cop=_toCOP(i.cost,i.costCurrency);
                    typeGroups[k].items.push(i);typeGroups[k].total+=cop;if(i.paid)typeGroups[k].paid+=cop;
                  }));
                  const destP = totalCost>0?(destItemsCost+estimatesCost)/totalCost*100:0;
                  const trP = totalCost>0?transitsCost/totalCost*100:0;

                  return <>
                    {/* Destinos */}
                    {(destItemsCost>0||estimatesCost>0)&&<div style={{marginBottom:"1rem"}}>
                      <div style={{display:"flex",alignItems:"center",gap:".75rem",marginBottom:".5rem"}}>
                        <span style={{fontSize:".85rem"}}>📍</span>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".82rem",fontWeight:600,flex:"0 1 95px",minWidth:"60px"}}>Destinos</span>
                        <div style={{flex:1,height:"5px",background:"rgba(28,28,30,.06)",borderRadius:"3px",overflow:"hidden"}}><div style={{height:"100%",width:`${destP}%`,background:"var(--accent)",borderRadius:"3px"}}/></div>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".78rem",color:"var(--accent)",fontWeight:600}}>{fmt(destItemsCost+estimatesCost)}</span>
                      </div>
                      <div style={{paddingLeft:"2rem",display:"flex",flexDirection:"column",gap:".35rem"}}>
                        {Object.entries(typeGroups).map(([type,g])=>{
                          const T=ITEM_TYPES[type]||ITEM_TYPES.activity;
                          const p=totalCost>0?g.total/totalCost*100:0;
                          return <div key={type} style={{display:"flex",alignItems:"center",gap:".6rem"}}>
                            <span style={{fontSize:".75rem"}}>{T.icon}</span>
                            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".73rem",color:T.color,fontWeight:500,flex:"0 1 80px",minWidth:"50px"}}>{T.label}</span>
                            <div style={{flex:1,height:"4px",background:"rgba(28,28,30,.05)",borderRadius:"2px",overflow:"hidden"}}><div style={{height:"100%",width:`${p}%`,background:T.color,borderRadius:"2px"}}/></div>
                            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:T.color,fontWeight:500}}>{fmt(g.total)}</span>
                            {g.paid>0&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".58rem",color:"#7EC87E"}}>✓{Math.round(g.paid/g.total*100)}%</span>}
                          </div>;
                        })}
                        {estimatesCost>0&&<div style={{display:"flex",alignItems:"center",gap:".6rem"}}>
                          <span style={{fontSize:".75rem"}}>📊</span>
                          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".73rem",color:"var(--muted)",fontWeight:500,flex:"0 1 80px",minWidth:"50px"}}>Estimados</span>
                          <div style={{flex:1,height:"4px",background:"rgba(28,28,30,.05)",borderRadius:"2px",overflow:"hidden"}}><div style={{height:"100%",width:`${totalCost>0?estimatesCost/totalCost*100:0}%`,background:"rgba(138,133,128,.3)",borderRadius:"2px"}}/></div>
                          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:"var(--muted)",fontWeight:500}}>{fmt(estimatesCost)}</span>
                        </div>}
                      </div>
                    </div>}
                    {/* Trayectos */}
                    {transitsCost>0&&<div>
                      <div style={{display:"flex",alignItems:"center",gap:".75rem",marginBottom:".5rem"}}>
                        <span style={{fontSize:".85rem"}}>🚀</span>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".82rem",fontWeight:600,flex:"0 1 95px",minWidth:"60px"}}>Trayectos</span>
                        <div style={{flex:1,height:"5px",background:"rgba(28,28,30,.06)",borderRadius:"3px",overflow:"hidden"}}><div style={{height:"100%",width:`${trP}%`,background:"#5AB4E8",borderRadius:"3px"}}/></div>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".78rem",color:"#5AB4E8",fontWeight:600}}>{fmt(transitsCost)}</span>
                      </div>
                      <div style={{paddingLeft:"2rem",display:"flex",flexDirection:"column",gap:".35rem"}}>
                        {(()=>{
                          const trGroups={};
                          allTransits.forEach(tr=>{const k=tr.transitType;if(!trGroups[k])trGroups[k]={items:[],total:0,paid:0};const c=_toCOP(tr.cost,tr.costCurrency);trGroups[k].items.push(tr);trGroups[k].total+=c;if(tr.paid)trGroups[k].paid+=c;});
                          return Object.entries(trGroups).map(([type,g])=>{
                            const tt=ttInfo(type);
                            return <div key={type} style={{display:"flex",alignItems:"center",gap:".6rem"}}>
                              <span style={{fontSize:".75rem"}}>{tt.icon}</span>
                              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".73rem",color:tt.color,fontWeight:500,flex:"0 1 80px",minWidth:"50px"}}>{tt.label}</span>
                              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".65rem",color:"var(--muted)"}}>{g.items.length}</span>
                              <span style={{marginLeft:"auto",fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",color:tt.color,fontWeight:500}}>{fmt(g.total)}</span>
                              {g.paid>0&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".58rem",color:"#7EC87E"}}>✓{Math.round(g.paid/g.total*100)}%</span>}
                            </div>;
                          });
                        })()}
                      </div>
                    </div>}
                  </>;
                })()}

                {budgetView==="detail"&&<>
                  {/* By destination with item details */}
                  {trip.destinations.map(d=>{
                    const destItems=d.items.filter(i=>i.cost>0);
                    if(!destItems.length)return null;
                    return <div key={d.id} style={{marginBottom:"1rem"}}>
                      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",fontWeight:600,color:d.color,marginBottom:".4rem",display:"flex",alignItems:"center",gap:".4rem"}}>
                        <span>{d.emoji}</span> {d.name}
                        <span style={{marginLeft:"auto",fontSize:".7rem",color:"var(--accent)"}}>{fmt(sumCOP(destItems))}</span>
                      </div>
                      {destItems.map(i=>{
                        const T=ITEM_TYPES[i.type]||ITEM_TYPES.activity;
                        return <div key={i.id} style={{...rowStyle,background:i.paid?"#7EC87E08":"transparent",borderLeft:`3px solid ${T.color}`}}>
                          {paidBtn(i.paid,()=>togglePaidItem(d.id,i.id))}
                          <span style={{fontSize:".8rem"}}>{T.icon}</span>
                          <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textDecoration:i.paid?"line-through":"none",color:i.paid?"var(--muted)":"var(--ink)"}}>{i.title||T.label}</span>
                          {i.dayEnd&&i.dayEnd>i.day&&<span style={{fontSize:".6rem",color:T.color,flexShrink:0}}>{i.type==="hotel"?`${i.dayEnd-i.day}n`:`${i.dayEnd-i.day+1}d`}</span>}
                          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".75rem",color:i.paid?"#7EC87E":"var(--accent)",fontWeight:500,flexShrink:0}}>{fmtI(i.cost,i.costCurrency)}</span>
                        </div>;
                      })}
                    </div>;
                  })}
                  {/* Transits */}
                  {allTransits.length>0&&<div style={{marginBottom:"1rem"}}>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".72rem",fontWeight:600,color:"var(--muted)",marginBottom:".4rem"}}>🚀 Trayectos
                      <span style={{marginLeft:"auto",float:"right",fontSize:".7rem",color:"var(--accent)"}}>{fmt(transitsCost)}</span>
                    </div>
                    {allTransits.map(tr=>{
                      const tt=ttInfo(tr.transitType);
                      const from=destName(tr.fromDestId);const to=destName(tr.toDestId);
                      return <div key={tr.id} style={{...rowStyle,background:tr.paid?"#7EC87E08":"transparent",borderLeft:`3px solid ${tt.color}`}}>
                        {paidBtn(tr.paid,()=>togglePaidTransit(tr.id))}
                        <span style={{fontSize:".8rem"}}>{tt.icon}</span>
                        <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textDecoration:tr.paid?"line-through":"none",color:tr.paid?"var(--muted)":"var(--ink)"}}>{tr.title||tt.label} {from&&to?`(${from.name}→${to.name})`:""}</span>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".75rem",color:tr.paid?"#7EC87E":"var(--accent)",fontWeight:500,flexShrink:0}}>{fmtI(tr.cost,tr.costCurrency)}</span>
                      </div>;
                    })}
                  </div>}
                  {/* By type summary */}
                  {Object.keys(byType).length>0&&<div style={{padding:".6rem .75rem",background:"rgba(28,28,30,.02)",borderRadius:"8px",border:"1px solid rgba(28,28,30,.06)",marginBottom:".5rem"}}>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".65rem",fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".05em",marginBottom:".4rem"}}>Por rubro</div>
                    {Object.entries(byType).map(([type,items])=>{
                      const T=ITEM_TYPES[type]||ITEM_TYPES.activity;
                      const total=items.reduce((s,i)=>s+_toCOP(i.cost,i.costCurrency),0);
                      const paid=items.filter(i=>i.paid).reduce((s,i)=>s+_toCOP(i.cost,i.costCurrency),0);
                      return <div key={type} style={{display:"flex",alignItems:"center",gap:".5rem",fontFamily:"'DM Sans',sans-serif",fontSize:".74rem",marginBottom:".3rem"}}>
                        <span>{T.icon}</span><span style={{color:T.color,fontWeight:500,flex:"0 1 80px",minWidth:"50px"}}>{T.label}</span>
                        <span style={{color:"var(--muted)"}}>{items.length} items</span>
                        <span style={{marginLeft:"auto",color:"var(--accent)",fontWeight:500}}>{fmt(total)}</span>
                        {paid>0&&<span style={{fontSize:".62rem",color:"#7EC87E"}}>✓{fmt(paid)}</span>}
                      </div>;
                    })}
                    {allTransits.length>0&&<div style={{display:"flex",alignItems:"center",gap:".5rem",fontFamily:"'DM Sans',sans-serif",fontSize:".74rem"}}>
                      <span>🚀</span><span style={{color:"var(--muted)",fontWeight:500,flex:"0 1 80px",minWidth:"50px"}}>Trayectos</span>
                      <span style={{color:"var(--muted)"}}>{allTransits.length} items</span>
                      <span style={{marginLeft:"auto",color:"var(--accent)",fontWeight:500}}>{fmt(transitsCost)}</span>
                      {paidTransitsCOP>0&&<span style={{fontSize:".62rem",color:"#7EC87E"}}>✓{fmt(paidTransitsCOP)}</span>}
                    </div>}
                  </div>}
                </>}

                {/* Totals */}
                {estimatesCost>0&&<div style={{display:"flex",justifyContent:"space-between",fontFamily:"'DM Sans',sans-serif",fontSize:".73rem",color:"var(--muted)",marginBottom:".5rem",paddingBottom:".5rem",borderBottom:"1px dashed rgba(28,28,30,.08)"}}>
                  <span>Registrado: {fmt(registered)}</span>
                  <span style={{color:"#8A8580"}}>+ Estimados: {fmt(estimatesCost)}</span>
                </div>}
                <div style={{borderTop:"1px solid var(--line)",paddingTop:".75rem",fontFamily:"'DM Sans',sans-serif"}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:".82rem",marginBottom:".4rem"}}>
                    <span style={{color:"var(--muted)"}}>Total</span><span style={{color:"var(--accent)",fontWeight:600}}>{fmt(totalCost)}</span>
                  </div>
                  {registered>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:".73rem"}}>
                    <span style={{color:"#7EC87E"}}>✓ Pagado</span><span style={{color:"#7EC87E",fontWeight:500}}>{fmt(totalPaid)}</span>
                  </div>}
                  {pending>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:".73rem"}}>
                    <span style={{color:"var(--accent)"}}>Por pagar (registrado)</span><span style={{color:"var(--accent)",fontWeight:500}}>{fmt(pending)}</span>
                  </div>}
                  {estimatesCost>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:".73rem"}}>
                    <span style={{color:"var(--muted)"}}>+ Estimados pendientes</span><span style={{color:"var(--muted)"}}>{fmt(estimatesCost)}</span>
                  </div>}
                </div>
                {trip.budget>0&&<div style={{marginTop:".5rem"}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontFamily:"'DM Sans',sans-serif",fontSize:".73rem",color:"var(--muted)",marginBottom:".3rem"}}>
                    <span>Presupuesto: {fmt(trip.budget)}</span>
                    <span style={{color:totalCost>trip.budget?"#E85A5A":"#7EC87E"}}>{totalCost>trip.budget?`Excede ${fmt(totalCost-trip.budget)}`:`Disponible ${fmt(trip.budget-totalCost)}`}</span>
                  </div>
                  <div style={{height:"5px",background:"rgba(28,28,30,.06)",borderRadius:"3px",overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(100,(totalCost/trip.budget)*100)}%`,background:totalCost>trip.budget?"#E85A5A":"var(--accent)",borderRadius:"3px"}}/></div>
                </div>}
              </div>;
            })()}
          </div>}

          {/* ── DEST VIEW ───────────────────────────────────────────────────── */}
          {tripView==="dest"&&(!activeDest
            ?<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif"}}>
              <div style={{fontSize:"3rem",marginBottom:"1rem"}}>🗺</div><p>Selecciona o crea un destino</p>
            </div>
            :<div className="content-padding" style={{padding:"1.5rem 2rem",maxWidth:"860px"}}>
              <div className="dest-header" style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"1.5rem"}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:".75rem",marginBottom:".25rem"}}>
                    <span style={{fontSize:"2rem"}}>{activeDest.emoji}</span>
                    <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.8rem",fontWeight:600,margin:0}}>{activeDest.name}</h2>
                    {activeDest.country&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".78rem",color:"var(--muted)",padding:".2rem .6rem",background:"rgba(28,28,30,.06)",borderRadius:"20px"}}>{activeDest.country}</span>}
                  </div>
                  <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".76rem",color:"var(--muted)",paddingLeft:"2.75rem"}}>
                    {activeDest.startDate?<><span style={{color:"var(--accent)",fontWeight:500}}>{fmtDate(activeDest.startDate)}</span> → <span style={{color:"var(--accent)",fontWeight:500}}>{fmtDate(activeDest.endDate)}</span> · {activeDest.days} días</>:`${activeDest.days} días`}
                    {" · "}{activeDest.items.length} elementos
                    {activeDest.items.some(i=>i.cost>0)&&" · "+fmt(sumCOP(activeDest.items))}
                  </div>
                </div>
                <button onClick={()=>{setForm({type:"activity",day:dayFilter||1});setModal("newItem");}} style={{background:"var(--accent)",border:"none",color:"#fff",padding:".55rem 1.2rem",borderRadius:"8px",fontSize:".82rem",fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>+ Agregar</button>
              </div>

              <div className="day-filters" style={{display:"flex",gap:".4rem",marginBottom:"1.25rem",overflowX:"auto",paddingBottom:".25rem",WebkitOverflowScrolling:"touch"}}>
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
                  {(dayFilter?[dayFilter]:[...new Set(filteredItems.flatMap(i=>i.dayEnd?Array.from({length:i.dayEnd-i.day+1},(_,k)=>i.day+k):[i.day]))].sort((a,b)=>a-b)).map(day=>{
                    const dayItems=filteredItems.filter(i=>(i.day===day && !i.dayEnd) || (i.dayEnd && i.day<=day && i.dayEnd>=day));
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
                          const isSpan = item.dayEnd && item.dayEnd > item.day;
                          const isHotel = item.type==="hotel";
                          const spanDays = isSpan ? item.dayEnd - item.day + (isHotel?0:1) : 0;
                          const spanLabel = isHotel ? `${item.dayEnd-item.day} noche${item.dayEnd-item.day!==1?"s":""}` : `${spanDays} día${spanDays!==1?"s":""}`;
                          const unitLabel = isHotel?"noche":"día";
                          const isCont = isSpan && item.day < day;
                          if (isCont && isHotel && day >= item.dayEnd) return null;
                          if (isCont) {
                            const totalSpan = isHotel ? item.dayEnd-item.day : item.dayEnd-item.day+1;
                            const current = day-item.day+(isHotel?1:1);
                            const perUnit = item.cost>0?_toCOP(item.cost,item.costCurrency)/totalSpan:0;
                            return <div key={item.id+"-"+day} style={{display:"flex",alignItems:"center",gap:".6rem",padding:".45rem .8rem",background:T.color+"10",border:`1px solid ${T.color}30`,borderLeft:`3px solid ${T.color}`,borderRadius:"7px",opacity:item.confirmed?.65:1}}>
                              <span style={{fontSize:".9rem"}}>{T.icon}</span>
                              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".78rem",color:T.color,fontWeight:500}}>{item.title||T.label}</span>
                              {perUnit>0&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".65rem",color:"var(--accent)"}}>{fmt(perUnit)}/{unitLabel}</span>}
                              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".65rem",color:"var(--muted)",marginLeft:"auto"}}>{unitLabel} {current}/{totalSpan}</span>
                            </div>;
                          }
                          return <div key={item.id} className="hov-row" style={{background:isSpan?T.color+"08":"#fff",border:`1px solid ${isSpan?T.color+"30":"var(--line)"}`,borderLeft:`3px solid ${T.color}`,borderRadius:"8px",padding:".75rem 1rem",display:"flex",alignItems:"center",gap:".75rem",transition:"background .15s",opacity:item.confirmed?.7:1}}>
                            <span style={{fontSize:"1.2rem",flexShrink:0}}>{T.icon}</span>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:".5rem",flexWrap:"wrap"}}>
                                <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".87rem",fontWeight:500,textDecoration:item.confirmed?"line-through":"none",color:item.confirmed?"var(--muted)":"var(--ink)"}}>{item.title||"(sin título)"}</span>
                                <span style={{fontSize:".64rem",padding:".1rem .45rem",background:T.color+"18",color:T.color,borderRadius:"3px",fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>{T.label}</span>
                                {isSpan&&<span style={{fontSize:".64rem",padding:".1rem .45rem",background:T.color+"18",color:T.color,borderRadius:"3px",fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>{spanLabel}</span>}
                                {item.confirmed&&<span style={{fontSize:".64rem",color:"#7EC87E",fontFamily:"'DM Sans',sans-serif"}}>✓ Confirmado</span>}
                              </div>
                              <div style={{display:"flex",gap:".75rem",marginTop:".2rem",flexWrap:"wrap"}}>
                                {isSpan&&activeDest?.startDate&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".71rem",color:T.color}}>📅 {fmtShort(dayToDate(activeDest,item.day))} → {fmtShort(dayToDate(activeDest,item.dayEnd))}</span>}
                                {item.time&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".71rem",color:"var(--muted)"}}>🕐 {item.time}</span>}
                                {item.duration&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".71rem",color:"var(--muted)"}}>⏱ {item.duration}</span>}
                                {item.address&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".71rem",color:"var(--muted)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"180px"}}>📍 {item.address}</span>}
                                {item.cost>0&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:".71rem",color:"var(--accent)"}}>💶 {fmtI(item.cost,item.costCurrency)}{isSpan?` total · ${fmt(_toCOP(item.cost,item.costCurrency)/(isHotel?item.dayEnd-item.day:spanDays))}/${unitLabel}`:""}</span>}
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
                {activeDest.items.some(i=>i.cost>0)&&<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:".78rem",color:"var(--accent)",fontWeight:500}}>Total: {fmt(sumCOP(activeDest.items))}</div>}
              </div>

              {/* ── Estimates read-only for this dest ── */}
              {hasEstimates&&(()=>{
                const est = calcEstimates(activeDest);
                if(!est.total) return null;
                return <div style={{marginTop:"1rem",padding:".6rem 1.25rem",background:"rgba(28,28,30,.02)",border:"1px solid rgba(28,28,30,.06)",borderRadius:"8px",fontFamily:"'DM Sans',sans-serif",fontSize:".73rem",display:"flex",alignItems:"center",gap:".75rem",flexWrap:"wrap"}}>
                  <span style={{fontSize:".62rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".06em",fontWeight:600}}>Estimados</span>
                  {est.estHotelTotal>0&&<span style={{color:"#7EC87E"}}>🏨 {est.uncoveredNights}n {fmt(est.estHotelTotal)}</span>}
                  {est.estFoodRemaining>0&&<span style={{color:"#E8845A"}}>🍽️ {fmt(est.estFoodRemaining)}</span>}
                  {est.estActivityRemaining>0&&<span style={{color:"#5AB4E8"}}>🎯 {fmt(est.estActivityRemaining)}</span>}
                  <span style={{marginLeft:"auto",color:"var(--accent)",fontWeight:500}}>{fmt(est.total)}</span>
                </div>;
              })()}
            </div>
          )}
        </main>
      </div>}

      {/* ── MODALS ──────────────────────────────────────────────────────────── */}
      {modal&&<div className="modal-overlay" onClick={closeModal} style={{position:"fixed",inset:0,background:"rgba(28,28,30,.5)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
        <div className="modal-inner" onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:"14px",padding:"2rem",width:"100%",maxWidth:modal==="newTransit"||modal==="editTransit"?"540px":"420px",boxShadow:"0 24px 80px rgba(28,28,30,.22)",maxHeight:"90vh",overflowY:"auto"}}>

          {modal==="newTrip"&&<>
            <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.5rem",fontWeight:600,margin:"0 0 1.5rem"}}>Nuevo viaje</h3>
            <Lbl>Emoji</Lbl><EmojiPick value={form.emoji||"🌍"} onChange={v=>setForm(p=>({...p,emoji:v}))}/>
            <Lbl>Nombre *</Lbl><Inp placeholder="Ej. Verano en Asia" value={form.name||""} onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
            <Lbl>Fechas del viaje</Lbl>
            <DateRangePicker startDate={form.startDate||""} endDate={form.endDate||""} onChange={(s,e)=>setForm(p=>({...p,startDate:s,endDate:e}))} startLabel="Inicio" endLabel="Fin"/>
            <Lbl>Mostrar también en otra moneda (opcional)</Lbl>
            <div style={{display:"flex",gap:".4rem",flexWrap:"wrap",marginBottom:"1rem"}}>
              <button onClick={()=>setForm(p=>({...p,currency:"COP",copRate:0}))} style={{background:(form.currency||"COP")==="COP"?"var(--accent)":"rgba(28,28,30,.05)",border:"none",color:(form.currency||"COP")==="COP"?"#fff":"var(--muted)",padding:".4rem .8rem",borderRadius:"6px",cursor:"pointer",fontSize:".78rem",transition:"all .15s"}}>🇨🇴 Solo COP</button>
              {CURRENCIES.filter(c=>c.code!=="COP").map(c=>(
                <button key={c.code} onClick={()=>setForm(p=>({...p,currency:c.code}))} style={{background:(form.currency||"COP")===c.code?"var(--accent)":"rgba(28,28,30,.05)",border:"none",color:(form.currency||"COP")===c.code?"#fff":"var(--muted)",padding:".4rem .8rem",borderRadius:"6px",cursor:"pointer",fontSize:".78rem",transition:"all .15s"}}>{c.flag} COP + {c.code} ({c.symbol})</button>
              ))}
            </div>
            {(form.currency||"COP")!=="COP"&&<>
              <Lbl>Tasa de cambio: 1 {(CURRENCIES.find(c=>c.code===form.currency)||{}).symbol} = ¿cuántos COP?</Lbl>
              <Inp type="number" min="0" step="any" placeholder={form.currency==="USD"?"Ej. 4200":"Ej. 4600"} value={form.copRate||""} onChange={e=>setForm(p=>({...p,copRate:+e.target.value}))}/>
              {form.copRate>0&&<p className="hint">Ejemplo: COP$100,000 = {fmtAlt(100000,form.currency,form.copRate)}</p>}
            </>}
            <Lbl>Presupuesto (COP$)</Lbl><Inp type="number" placeholder="0" value={form.budget||""} onChange={e=>setForm(p=>({...p,budget:e.target.value}))}/>
            <Btns onCancel={closeModal} onOk={createTrip} label="Crear viaje"/>
          </>}

          {modal==="newDest"&&<>
            <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"1.5rem",fontWeight:600,margin:"0 0 .3rem"}}>Nuevo destino</h3>
            {(()=>{const dests=trip?.destinations||[];if(dests.length===0&&trip?.startDate)return <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:".75rem",color:"var(--accent)",margin:"0 0 1.25rem",background:"rgba(196,98,45,.07)",padding:".5rem .75rem",borderRadius:"6px"}}>📍 Primer destino — desde <strong>{fmtDate(trip.startDate)}</strong></p>;if(dests.length>0){const sorted=sortDests(dests);let latestEnd="";let latestD=null;for(const d of sorted){const e=destEnd(d);if(e&&e>latestEnd){latestEnd=e;latestD=d;}}if(latestD&&latestEnd)return <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:".75rem",color:"var(--accent)",margin:"0 0 1.25rem",background:"rgba(196,98,45,.07)",padding:".5rem .75rem",borderRadius:"6px"}}>📍 Continuando desde <strong>{latestD.emoji} {latestD.name}</strong> — llegada sugerida <strong>{fmtDate(latestEnd)}</strong></p>;}return null;})()}
            <Lbl>Destino *</Lbl>
            <CitySearch
              value={form.name||""}
              country={form.country||""}
              emoji={form.emoji||"📍"}
              onSelect={(city,country,flag)=>setForm(p=>({...p,name:city,country,emoji:flag}))}
              onChange={(v)=>setForm(p=>({...p,name:v}))}
              onCountryChange={(v)=>setForm(p=>({...p,country:v}))}
            />
            <Lbl>Fechas</Lbl>
            <DateRangePicker startDate={form.startDate||""} endDate={form.endDate||""} onChange={(s,e)=>{setDestStart(s);if(e)setDestEnd(e);}} startLabel="Llegada" endLabel="Salida"/>
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
            <Lbl>Origen → Destino</Lbl>
            <div className="transit-route-grid" style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:".5rem",alignItems:"center",marginBottom:"1rem"}}>
              <select value={form.fromDestId||""} onChange={e=>setForm(p=>({...p,fromDestId:e.target.value}))} style={{border:"1px solid rgba(28,28,30,.12)",borderRadius:"6px",padding:".55rem .7rem",fontSize:".85rem",color:"#1C1C1E",background:"#F7F4EF",cursor:"pointer"}}>
                <option value="">— Origen</option>
                {(trip?.destinations||[]).map(d=><option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
              </select>
              <span className="transit-arrow" style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1rem",color:"var(--muted)",textAlign:"center"}}>→</span>
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
              ?<>
                <Lbl>Fechas de alquiler</Lbl>
                <DateRangePicker startDate={form.date||""} endDate={form.returnDate||""} onChange={(s,e)=>setForm(p=>({...p,date:s,returnDate:e}))} startLabel="Recogida" endLabel="Devolución"/>
              </>
              :<>
                <Lbl>Fechas del trayecto</Lbl>
                <DateRangePicker startDate={form.date||""} endDate={form.returnDate||""} onChange={(s,e)=>setForm(p=>({...p,date:s,returnDate:e}))} startLabel="Salida" endLabel="Llegada"/>
                <div className="form-grid-2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:".75rem"}}>
                  <div><Lbl>Hora salida</Lbl><Inp type="time" value={form.departTime||""} onChange={e=>setForm(p=>({...p,departTime:e.target.value}))}/></div>
                  <div><Lbl>Hora llegada</Lbl><Inp type="time" value={form.arriveTime||""} onChange={e=>setForm(p=>({...p,arriveTime:e.target.value}))}/></div>
                </div>
              </>
            }
            <div className="form-grid-2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:".75rem"}}>
              <div><Lbl>Proveedor / Aerolínea</Lbl><Inp placeholder="Ej. Avianca" value={form.provider||""} onChange={e=>setForm(p=>({...p,provider:e.target.value}))}/></div>
              <div><Lbl>N° Confirmación / Reserva</Lbl><Inp placeholder="Ej. ABC123" value={form.confirmation||""} onChange={e=>setForm(p=>({...p,confirmation:e.target.value}))}/></div>
            </div>
            <Lbl>Costo</Lbl>
            <div style={{display:"flex",gap:".5rem",alignItems:"center",marginBottom:"1rem"}}>
              <Inp type="number" min="0" placeholder="0" value={form.cost||""} onChange={e=>setForm(p=>({...p,cost:+e.target.value}))} style={{flex:1,marginBottom:0}}/>
              <div style={{display:"flex",gap:".25rem",flexShrink:0}}>
                <button onClick={()=>setForm(p=>({...p,costCurrency:"COP"}))} style={{background:(form.costCurrency||"COP")==="COP"?"var(--accent)":"rgba(28,28,30,.06)",border:"none",color:(form.costCurrency||"COP")==="COP"?"#fff":"var(--muted)",padding:".4rem .6rem",borderRadius:"5px",cursor:"pointer",fontSize:".72rem"}}>COP$</button>
                {cur!=="COP"&&<button onClick={()=>setForm(p=>({...p,costCurrency:cur}))} style={{background:(form.costCurrency||"COP")===cur?"var(--accent)":"rgba(28,28,30,.06)",border:"none",color:(form.costCurrency||"COP")===cur?"#fff":"var(--muted)",padding:".4rem .6rem",borderRadius:"5px",cursor:"pointer",fontSize:".72rem"}}>{(CURRENCIES.find(c=>c.code===cur)||{}).symbol}</button>}
              </div>
            </div>
            {form.cost>0&&rate>0&&cur!=="COP"&&<p className="hint">{(form.costCurrency||"COP")==="COP"?`= ${fmtAltVal(form.cost/rate,cur)}`:`= ${fmtCOP(form.cost*rate)}`}</p>}
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
            {(()=>{
              const isHotel = form.type==="hotel";
              const multiLabel = isHotel ? `Todas las noches (${(activeDest?.days||2)-1})` : `Todos los días (${activeDest?.days||1})`;
              const multiIcon = isHotel ? "🏨" : "📅";
              return <div style={{marginBottom:"1rem"}}>
                <div style={{display:"flex",gap:".4rem",flexWrap:"wrap",marginBottom:".75rem"}}>
                  <button onClick={()=>setForm(p=>({...p,day:1,dayEnd:activeDest?.days||2,_allDays:true}))} style={{background:form._allDays===true?"var(--accent)":"rgba(28,28,30,.05)",border:"none",color:form._allDays===true?"#fff":"var(--muted)",padding:".4rem .8rem",borderRadius:"6px",cursor:"pointer",fontSize:".78rem",transition:"all .15s"}}>{multiIcon} {multiLabel}</button>
                  <button onClick={()=>setForm(p=>({...p,day:p.day||1,dayEnd:undefined,_allDays:false}))} style={{background:form._allDays===false&&!form.dayEnd?"var(--accent)":"rgba(28,28,30,.05)",border:"none",color:form._allDays===false&&!form.dayEnd?"#fff":"var(--muted)",padding:".4rem .8rem",borderRadius:"6px",cursor:"pointer",fontSize:".78rem",transition:"all .15s"}}>1️⃣ Un día</button>
                  <button onClick={()=>setForm(p=>({...p,day:p.day||1,dayEnd:Math.max((p.day||1)+1,p.dayEnd||((p.day||1)+1)),_allDays:false}))} style={{background:form._allDays===false&&form.dayEnd?"var(--accent)":"rgba(28,28,30,.05)",border:"none",color:form._allDays===false&&form.dayEnd?"#fff":"var(--muted)",padding:".4rem .8rem",borderRadius:"6px",cursor:"pointer",fontSize:".78rem",transition:"all .15s"}}>📅 Elegir días</button>
                </div>
                {form._allDays===false&&!form.dayEnd&&<div className="form-grid-3" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:".75rem"}}>
                  <div>
                    <Lbl>Día</Lbl>
                    <Inp type="number" min="1" max={activeDest?.days||99} value={form.day||1} onChange={e=>setForm(p=>({...p,day:+e.target.value}))}/>
                    {activeDest?.startDate&&form.day&&<p className="hint" style={{marginTop:"-.5rem"}}>{fmtDate(dayToDate(activeDest,Number(form.day)))}</p>}
                  </div>
                  <div><Lbl>Hora</Lbl><Inp type="time" value={form.time||""} onChange={e=>setForm(p=>({...p,time:e.target.value}))}/></div>
                  <div><Lbl>Duración</Lbl><Inp placeholder="2h" value={form.duration||""} onChange={e=>setForm(p=>({...p,duration:e.target.value}))}/></div>
                </div>}
                {form._allDays===false&&form.dayEnd&&<div className="form-grid-2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:".75rem"}}>
                  <div>
                    <Lbl>Desde día</Lbl>
                    <Inp type="number" min="1" max={activeDest?.days||99} value={form.day||1} onChange={e=>setForm(p=>({...p,day:+e.target.value,dayEnd:Math.max(+e.target.value+1,p.dayEnd||+e.target.value+1)}))}/>
                    {activeDest?.startDate&&form.day&&<p className="hint" style={{marginTop:"-.5rem"}}>{fmtDate(dayToDate(activeDest,Number(form.day)))}</p>}
                  </div>
                  <div>
                    <Lbl>Hasta día</Lbl>
                    <Inp type="number" min={(form.day||1)+1} max={activeDest?.days||99} value={form.dayEnd||""} onChange={e=>setForm(p=>({...p,dayEnd:+e.target.value}))}/>
                    {activeDest?.startDate&&form.dayEnd&&<p className="hint" style={{marginTop:"-.5rem"}}>{fmtDate(dayToDate(activeDest,Number(form.dayEnd)))}</p>}
                  </div>
                </div>}
                {form.day&&form.dayEnd&&form.dayEnd>form.day&&activeDest?.startDate&&<p className="hint">
                  {isHotel
                    ?`🏨 ${form.dayEnd-form.day} noche${form.dayEnd-form.day!==1?"s":""}: check-in ${fmtDate(dayToDate(activeDest,form.day))} → check-out ${fmtDate(dayToDate(activeDest,form.dayEnd))}`
                    :`📅 ${form.dayEnd-form.day+1} días: ${fmtDate(dayToDate(activeDest,form.day))} → ${fmtDate(dayToDate(activeDest,form.dayEnd))}`
                  }
                </p>}
              </div>;
            })()}
            <Lbl>Dirección / Lugar</Lbl><Inp placeholder="Ej. Av. Principal 123" value={form.address||""} onChange={e=>setForm(p=>({...p,address:e.target.value}))}/>
            <Lbl>Costo</Lbl>
            <div style={{display:"flex",gap:".5rem",alignItems:"center",marginBottom:"1rem"}}>
              <Inp type="number" min="0" placeholder="0" value={form.cost||""} onChange={e=>setForm(p=>({...p,cost:+e.target.value}))} style={{flex:1,marginBottom:0}}/>
              <div style={{display:"flex",gap:".25rem",flexShrink:0}}>
                <button onClick={()=>setForm(p=>({...p,costCurrency:"COP"}))} style={{background:(form.costCurrency||"COP")==="COP"?"var(--accent)":"rgba(28,28,30,.06)",border:"none",color:(form.costCurrency||"COP")==="COP"?"#fff":"var(--muted)",padding:".4rem .6rem",borderRadius:"5px",cursor:"pointer",fontSize:".72rem"}}>COP$</button>
                {cur!=="COP"&&<button onClick={()=>setForm(p=>({...p,costCurrency:cur}))} style={{background:(form.costCurrency||"COP")===cur?"var(--accent)":"rgba(28,28,30,.06)",border:"none",color:(form.costCurrency||"COP")===cur?"#fff":"var(--muted)",padding:".4rem .6rem",borderRadius:"5px",cursor:"pointer",fontSize:".72rem"}}>{(CURRENCIES.find(c=>c.code===cur)||{}).symbol}</button>}
              </div>
            </div>
            {form.cost>0&&rate>0&&cur!=="COP"&&<p className="hint">{(form.costCurrency||"COP")==="COP"?`= ${fmtAltVal(form.cost/rate,cur)}`:`= ${fmtCOP(form.cost*rate)}`}</p>}
            <Lbl>Notas</Lbl>
            <textarea placeholder="Reserva, detalles..." value={form.notes||""} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} style={{width:"100%",border:"1px solid var(--line)",borderRadius:"6px",padding:".6rem .8rem",fontSize:".85rem",color:"var(--ink)",resize:"vertical",minHeight:"60px",background:"#F7F4EF",marginBottom:"1rem"}}/>
            <Btns onCancel={closeModal} onOk={modal==="editItem"?saveItem:addItem} label={modal==="editItem"?"Guardar cambios":"Agregar"}/>
          </>}
        </div>
      </div>}
    </div>
  );
}

// ── City autocomplete ────────────────────────────────────────────────────────
const _allCountries = Country.getAllCountries();
const _countryMap = Object.fromEntries(_allCountries.map(c => [c.isoCode, c]));
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Spanish country names by ISO code
const _countryES: Record<string,string> = {"AF":"Afganistán","AL":"Albania","DE":"Alemania","AD":"Andorra","AO":"Angola","AG":"Antigua y Barbuda","SA":"Arabia Saudí","DZ":"Argelia","AR":"Argentina","AM":"Armenia","AU":"Australia","AT":"Austria","AZ":"Azerbaiyán","BS":"Bahamas","BD":"Bangladés","BB":"Barbados","BH":"Baréin","BE":"Bélgica","BZ":"Belice","BJ":"Benín","BY":"Bielorrusia","BO":"Bolivia","BA":"Bosnia y Herzegovina","BW":"Botsuana","BR":"Brasil","BN":"Brunéi","BG":"Bulgaria","BF":"Burkina Faso","BI":"Burundi","BT":"Bután","CV":"Cabo Verde","KH":"Camboya","CM":"Camerún","CA":"Canadá","QA":"Catar","TD":"Chad","CZ":"Chequia","CL":"Chile","CN":"China","CY":"Chipre","CO":"Colombia","KM":"Comoras","CG":"Congo","KP":"Corea del Norte","KR":"Corea del Sur","CR":"Costa Rica","HR":"Croacia","CU":"Cuba","DK":"Dinamarca","EC":"Ecuador","EG":"Egipto","SV":"El Salvador","AE":"Emiratos Árabes Unidos","ER":"Eritrea","SK":"Eslovaquia","SI":"Eslovenia","ES":"España","US":"Estados Unidos","EE":"Estonia","ET":"Etiopía","PH":"Filipinas","FI":"Finlandia","FJ":"Fiyi","FR":"Francia","GA":"Gabón","GM":"Gambia","GE":"Georgia","GH":"Ghana","GR":"Grecia","GT":"Guatemala","GN":"Guinea","GY":"Guyana","HT":"Haití","HN":"Honduras","HU":"Hungría","IN":"India","ID":"Indonesia","IQ":"Irak","IR":"Irán","IE":"Irlanda","IS":"Islandia","IL":"Israel","IT":"Italia","JM":"Jamaica","JP":"Japón","JO":"Jordania","KZ":"Kazajistán","KE":"Kenia","KG":"Kirguistán","KW":"Kuwait","LA":"Laos","LS":"Lesoto","LV":"Letonia","LB":"Líbano","LR":"Liberia","LY":"Libia","LI":"Liechtenstein","LT":"Lituania","LU":"Luxemburgo","MK":"Macedonia del Norte","MG":"Madagascar","MY":"Malasia","MW":"Malaui","MV":"Maldivas","ML":"Mali","MT":"Malta","MA":"Marruecos","MU":"Mauricio","MR":"Mauritania","MX":"México","FM":"Micronesia","MD":"Moldavia","MC":"Mónaco","MN":"Mongolia","ME":"Montenegro","MZ":"Mozambique","MM":"Myanmar","NA":"Namibia","NR":"Nauru","NP":"Nepal","NI":"Nicaragua","NE":"Níger","NG":"Nigeria","NO":"Noruega","NZ":"Nueva Zelanda","NL":"Países Bajos","PK":"Pakistán","PA":"Panamá","PG":"Papúa Nueva Guinea","PY":"Paraguay","PE":"Perú","PF":"Polinesia Francesa","PL":"Polonia","PT":"Portugal","PR":"Puerto Rico","GB":"Reino Unido","CF":"República Centroafricana","CD":"República Democrática del Congo","DO":"República Dominicana","RW":"Ruanda","RO":"Rumanía","RU":"Rusia","WS":"Samoa","SM":"San Marino","SN":"Senegal","RS":"Serbia","SC":"Seychelles","SL":"Sierra Leona","SG":"Singapur","SY":"Siria","SO":"Somalia","LK":"Sri Lanka","ZA":"Sudáfrica","SD":"Sudán","SE":"Suecia","CH":"Suiza","SR":"Surinam","TH":"Tailandia","TW":"Taiwán","TZ":"Tanzania","TJ":"Tayikistán","TL":"Timor-Leste","TG":"Togo","TO":"Tonga","TT":"Trinidad y Tobago","TN":"Túnez","TM":"Turkmenistán","TR":"Turquía","TV":"Tuvalu","UA":"Ucrania","UG":"Uganda","UY":"Uruguay","UZ":"Uzbekistán","VU":"Vanuatu","VE":"Venezuela","VN":"Vietnam","YE":"Yemen","DJ":"Yibuti","ZM":"Zambia","ZW":"Zimbabue","HK":"Hong Kong"};

// Spanish city names: English library name -> Spanish display name
const _cityES: Record<string,string> = {
  // Europe
  "Lisbon":"Lisboa","Porto":"Oporto","London":"Londres","Edinburgh":"Edimburgo","Paris":"París","Nice":"Niza","Lyon":"Lyon","Marseille":"Marsella","Bordeaux":"Burdeos","Strasbourg":"Estrasburgo",
  "Rome":"Roma","Milan":"Milán","Florence":"Florencia","Venice":"Venecia","Naples":"Nápoles","Turin":"Turín","Genoa":"Génova","Bologna":"Bolonia",
  "Berlin":"Berlín","Munich":"Múnich","Hamburg":"Hamburgo","Cologne":"Colonia","Frankfurt":"Fráncfort","Nuremberg":"Núremberg","Dresden":"Dresde","Leipzig":"Leipzig",
  "Vienna":"Viena","Salzburg":"Salzburgo","Innsbruck":"Innsbruck","Graz":"Graz",
  "Prague":"Praga","Brno":"Brno","Warsaw":"Varsovia","Krakow":"Cracovia","Gdańsk":"Gdansk","Wrocław":"Breslavia",
  "Brussels":"Bruselas","Bruges":"Brujas","Antwerp":"Amberes","Ghent":"Gante",
  "Amsterdam":"Ámsterdam","Rotterdam":"Róterdam","The Hague":"La Haya","Utrecht":"Utrecht",
  "Zurich":"Zúrich","Geneva":"Ginebra","Bern":"Berna","Lucerne":"Lucerna","Basel":"Basilea","Interlaken":"Interlaken",
  "Athens":"Atenas","Thessaloniki":"Salónica","Heraklion":"Heraclión",
  "Istanbul":"Estambul","Ankara":"Ankara","Antalya":"Antalya",
  "Copenhagen":"Copenhague","Stockholm":"Estocolmo","Gothenburg":"Gotemburgo",
  "Helsinki":"Helsinki","Rovaniemi":"Rovaniemi","Oslo":"Oslo","Bergen":"Bergen","Tromsø":"Tromsø",
  "Reykjavik":"Reikiavik","Dublin":"Dublín","Bucharest":"Bucarest","Sofia":"Sofía","Belgrade":"Belgrado",
  "Budapest":"Budapest","Ljubljana":"Liubliana","Bratislava":"Bratislava","Zagreb":"Zagreb",
  "Tallinn":"Tallin","Riga":"Riga","Vilnius":"Vilna",
  "Moscow":"Moscú","Saint Petersburg":"San Petersburgo","Kyiv":"Kiev",
  "Seville":"Sevilla","Malaga":"Málaga","Zaragoza":"Zaragoza","Bilbao":"Bilbao",
  // Americas
  "New York":"Nueva York","Los Angeles":"Los Ángeles","New Orleans":"Nueva Orleans","Philadelphia":"Filadelfia","Chicago":"Chicago",
  "Mexico City":"Ciudad de México","Havana":"La Habana","Guatemala City":"Ciudad de Guatemala","Panama City":"Ciudad de Panamá",
  "Rio de Janeiro":"Río de Janeiro","Salvador":"Salvador de Bahía","Brasilia":"Brasilia",
  "Bogota":"Bogotá","Medellin":"Medellín","Barranquilla":"Barranquilla",
  "Beijing":"Pekín","Shanghai":"Shanghái","Guangzhou":"Cantón","Taipei":"Taipéi",
  "Tokyo":"Tokio","Kyoto":"Kioto","Osaka":"Osaka","Seoul":"Seúl","Busan":"Busan",
  "Bangkok":"Bangkok","Hanoi":"Hanói","Ho Chi Minh City":"Ho Chi Minh",
  "Singapore":"Singapur","Jakarta":"Yakarta","Kuala Lumpur":"Kuala Lumpur",
  "New Delhi":"Nueva Delhi","Mumbai":"Bombay","Kolkata":"Calcuta","Chennai":"Madrás",
  "Kathmandu":"Katmandú","Colombo":"Colombo",
  "Dubai":"Dubái","Abu Dhabi":"Abu Dabi","Doha":"Doha","Riyadh":"Riad",
  "Tel Aviv":"Tel Aviv","Jerusalem":"Jerusalén","Amman":"Ammán","Beirut":"Beirut",
  "Cairo":"El Cairo","Alexandria":"Alejandría","Marrakesh":"Marrakech","Fes":"Fez",
  "Cape Town":"Ciudad del Cabo","Johannesburg":"Johannesburgo",
  "Sydney":"Sídney","Melbourne":"Melbourne","Auckland":"Auckland","Wellington":"Wellington",
};
// Build reverse: Spanish name -> English library name (for search)
const _esToEng: Record<string,string> = {};
for (const [eng, es] of Object.entries(_cityES)) {
  _esToEng[normalize(es)] = eng;
}

function CitySearch({ value, country, emoji, onSelect, onChange, onCountryChange }) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const ref = useRef(null);
  const allCities = useMemo(() => City.getAllCities(), []);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const search = (q: string) => {
    setQuery(q);
    onChange(q);
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    const nq = normalize(q);
    // If user types Spanish name, also search the English equivalent
    const engFromES = Object.entries(_esToEng).find(([es]) => es.startsWith(nq))?.[1];
    const nqEng = engFromES ? normalize(engFromES) : null;

    const exact = [];    // exact match on city name
    const starts = [];   // starts with query
    const contains = []; // contains query or country match
    const seen = new Set();
    for (const c of allCities) {
      if (exact.length >= 8 && starts.length >= 20) break;
      const nc = normalize(c.name);
      const co = _countryMap[c.countryCode];
      if (!co) continue;
      const cityES = _cityES[c.name] || c.name;
      const countryES = _countryES[c.countryCode] || co.name;
      const nES = normalize(cityES);
      const nCountryES = normalize(countryES);
      const key = nES + "|" + c.countryCode;
      if (seen.has(key)) continue;
      const isExact = nc === nq || nES === nq || (nqEng && nc === nqEng);
      const isStart = nc.startsWith(nq) || nES.startsWith(nq) || (nqEng && nc.startsWith(nqEng));
      const isContains = nc.includes(nq) || nES.includes(nq) || nCountryES.startsWith(nq);
      if (!isExact && !isStart && !isContains) continue;
      seen.add(key);
      const entry = { city: cityES, country: countryES, flag: co.flag, code: c.countryCode };
      if (isExact) exact.push(entry);
      else if (isStart) starts.push(entry);
      else if (contains.length < 20) contains.push(entry);
    }
    const matched = [...exact, ...starts, ...contains].slice(0, 8);
    setResults(matched);
    setOpen(matched.length > 0);
    setHighlight(-1);
  };

  const pick = (r) => {
    setQuery(r.city);
    onSelect(r.city, r.country, r.flag);
    setOpen(false);
  };

  const onKey = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(p => Math.min(p + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(p => Math.max(p - 1, 0)); }
    else if (e.key === "Enter" && highlight >= 0) { e.preventDefault(); pick(results[highlight]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative", marginBottom: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: ".5rem", alignItems: "start" }}>
        <div style={{ position: "relative" }}>
          <input
            placeholder="Buscar ciudad... Ej. Tokio, París, Bogotá"
            value={query}
            onChange={e => search(e.target.value)}
            onFocus={() => { if (results.length > 0) setOpen(true); }}
            onKeyDown={onKey}
            style={{ width: "100%", border: "1px solid rgba(28,28,30,.12)", borderRadius: "6px", padding: ".6rem .8rem", fontSize: ".88rem", color: "#1C1C1E", background: "#F7F4EF" }}
          />
          {open && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid rgba(28,28,30,.12)", borderRadius: "0 0 8px 8px", boxShadow: "0 8px 30px rgba(28,28,30,.12)", zIndex: 20, maxHeight: "220px", overflowY: "auto" }}>
              {results.map((r, i) => (
                <div
                  key={r.city + r.code + i}
                  onClick={() => pick(r)}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    padding: ".55rem .8rem",
                    cursor: "pointer",
                    fontSize: ".85rem",
                    fontFamily: "'DM Sans',sans-serif",
                    background: i === highlight ? "rgba(196,98,45,.08)" : "transparent",
                    borderBottom: i < results.length - 1 ? "1px solid rgba(28,28,30,.06)" : "none",
                    display: "flex", alignItems: "center", gap: ".5rem",
                  }}
                >
                  <span style={{ fontSize: "1.1rem" }}>{r.flag}</span>
                  <span><strong>{r.city}</strong> <span style={{ color: "#8A8580" }}>— {r.country}</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
        {country && (
          <div style={{ background: "rgba(196,98,45,.08)", borderRadius: "6px", padding: ".5rem .7rem", fontSize: ".78rem", color: "var(--accent)", fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap", marginTop: "1px" }}>
            {emoji && emoji !== "📍" ? emoji : "📍"} {country}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Date Range Picker ────────────────────────────────────────────────────────
function DateRangePicker({ startDate, endDate, onChange, startLabel="Inicio", endLabel="Fin" }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => {
    if (startDate) return new Date(startDate + "T00:00:00");
    return new Date();
  });
  const [picking, setPicking] = useState("start"); // "start" | "end"
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target) && triggerRef.current && !triggerRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const openCalendar = (pickMode) => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const calH = 340;
      const calW = Math.min(300, window.innerWidth - 16);
      const spaceBelow = window.innerHeight - rect.bottom;
      setPos({
        top: spaceBelow >= calH ? rect.bottom + 4 : Math.max(8, rect.top - calH - 4),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - calW - 8)),
        width: calW,
      });
    }
    setPicking(pickMode);
    setOpen(true);
  };

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const DAYS_ES = ["Lu","Ma","Mi","Ju","Vi","Sá","Do"];

  const firstDay = new Date(year, month, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const toISO = (y, m, d) => `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  const isInRange = (day) => {
    if (!day || !startDate || !endDate) return false;
    const iso = toISO(year, month, day);
    return iso > startDate && iso < endDate;
  };
  const isStart = (day) => day && startDate && toISO(year, month, day) === startDate;
  const isEnd = (day) => day && endDate && toISO(year, month, day) === endDate;

  const handleClick = (day) => {
    if (!day) return;
    const iso = toISO(year, month, day);
    if (picking === "start") {
      onChange(iso, endDate && endDate >= iso ? endDate : "");
      setPicking("end");
    } else {
      if (startDate && iso < startDate) {
        onChange(iso, "");
        setPicking("end");
      } else {
        onChange(startDate, iso);
        setPicking("start");
        setOpen(false);
      }
    }
  };

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const displayStart = startDate ? fmtDate(startDate) : startLabel;
  const displayEnd = endDate ? fmtDate(endDate) : endLabel;

  return (
    <div style={{ marginBottom: "1rem" }}>
      <div
        ref={triggerRef}
        onClick={() => { openCalendar("start"); if (startDate) setViewDate(new Date(startDate + "T00:00:00")); }}
        style={{
          display: "flex", alignItems: "center", gap: ".5rem",
          border: "1px solid rgba(28,28,30,.12)", borderRadius: "8px",
          padding: ".6rem .9rem", cursor: "pointer", background: "#F7F4EF",
          fontFamily: "'DM Sans',sans-serif", fontSize: ".85rem",
        }}
      >
        <span style={{ fontSize: "1rem" }}>📅</span>
        <span
          onClick={(e) => { e.stopPropagation(); openCalendar("start"); if (startDate) setViewDate(new Date(startDate + "T00:00:00")); }}
          style={{ padding: ".2rem .5rem", borderRadius: "5px", background: picking === "start" && open ? "rgba(196,98,45,.12)" : "transparent", color: startDate ? "#1C1C1E" : "#8A8580", fontWeight: startDate ? 500 : 400, cursor: "pointer", transition: "all .15s" }}
        >{displayStart}</span>
        <span style={{ color: "#8A8580", fontSize: ".9rem" }}>→</span>
        <span
          onClick={(e) => { e.stopPropagation(); openCalendar("end"); if (endDate) setViewDate(new Date(endDate + "T00:00:00")); else if (startDate) setViewDate(new Date(startDate + "T00:00:00")); }}
          style={{ padding: ".2rem .5rem", borderRadius: "5px", background: picking === "end" && open ? "rgba(196,98,45,.12)" : "transparent", color: endDate ? "#1C1C1E" : "#8A8580", fontWeight: endDate ? 500 : 400, cursor: "pointer", transition: "all .15s" }}
        >{displayEnd}</span>
        {startDate && endDate && (
          <span style={{ marginLeft: "auto", fontSize: ".75rem", color: "var(--accent)", fontWeight: 500 }}>
            {diffDays(startDate, endDate) + 1}d
          </span>
        )}
      </div>

      {open && (
        <div ref={ref} style={{
          position: "fixed", top: pos.top, left: pos.left, zIndex: 9999,
          background: "#fff", border: "1px solid rgba(28,28,30,.12)", borderRadius: "12px",
          boxShadow: "0 12px 40px rgba(28,28,30,.18)", padding: ".8rem", width: pos.width || 300, maxWidth: "calc(100vw - 16px)",
          fontFamily: "'DM Sans',sans-serif",
        }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".6rem" }}>
            <button onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1rem", padding: ".2rem .5rem", borderRadius: "4px", color: "#1C1C1E" }}>‹</button>
            <span style={{ fontWeight: 600, fontSize: ".88rem" }}>{MONTHS_ES[month]} {year}</span>
            <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1rem", padding: ".2rem .5rem", borderRadius: "4px", color: "#1C1C1E" }}>›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "2px", marginBottom: ".3rem" }}>
            {DAYS_ES.map(d => (
              <div key={d} style={{ textAlign: "center", fontSize: ".65rem", color: "#8A8580", fontWeight: 500, padding: ".2rem 0", textTransform: "uppercase" }}>{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "2px" }}>
            {cells.map((day, i) => {
              const start = isStart(day);
              const end = isEnd(day);
              const inRange = isInRange(day);
              return (
                <div
                  key={i}
                  onClick={() => handleClick(day)}
                  style={{
                    textAlign: "center", padding: ".38rem 0", fontSize: ".8rem",
                    borderRadius: start && end ? "6px" : start ? "6px 0 0 6px" : end ? "0 6px 6px 0" : inRange ? "0" : "6px",
                    background: start || end ? "#C4622D" : inRange ? "rgba(196,98,45,.12)" : "transparent",
                    color: start || end ? "#fff" : day ? "#1C1C1E" : "transparent",
                    cursor: day ? "pointer" : "default",
                    fontWeight: start || end ? 600 : 400,
                    transition: "all .1s",
                  }}
                  onMouseEnter={(e) => { if (day) e.currentTarget.style.background = start || end ? "#B5551F" : "rgba(196,98,45,.18)"; }}
                  onMouseLeave={(e) => { if (day) e.currentTarget.style.background = start || end ? "#C4622D" : inRange ? "rgba(196,98,45,.12)" : "transparent"; }}
                >
                  {day || ""}
                </div>
              );
            })}
          </div>

          {/* Footer hint */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: ".6rem", paddingTop: ".5rem", borderTop: "1px solid rgba(28,28,30,.08)" }}>
            <span style={{ fontSize: ".7rem", color: "#8A8580" }}>
              {picking === "start" ? "Selecciona fecha de inicio" : "Selecciona fecha de fin"}
            </span>
            {(startDate || endDate) && (
              <button
                onClick={() => { onChange("", ""); setPicking("start"); }}
                style={{ background: "none", border: "none", fontSize: ".7rem", color: "var(--accent)", cursor: "pointer", textDecoration: "underline" }}
              >Limpiar</button>
            )}
          </div>
        </div>
      )}
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
