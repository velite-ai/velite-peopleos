"use client";
/* API payloads vary by HR module; server-side validation remains authoritative. */
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

import { FormEvent,useCallback,useEffect,useState } from "react";
import { OperationsWorkspace } from "@/components/operations-workspace";
import { PerformanceWorkspace } from "@/components/performance-workspace";
import { HrCalendarWorkspace } from "@/components/hr-calendar-workspace";
import { EmployeeRecordDrawer } from "@/components/employee-record-drawer";
import { PayrollWorkspace } from "@/components/payroll-workspace";
import { AdministrationWorkspace } from "@/components/administration-workspace";
import { EngagementWorkspace } from "@/components/engagement-workspace";

type Module = "Overview" | "My Workspace" | "People" | "Recruitment" | "Onboarding" | "Daily Attendance" | "Leave & Shifts" | "Payroll" | "Performance" | "Engagement" | "HR Calendar" | "Learning" | "Helpdesk" | "Separation" | "Reports" | "Administration";

type BusinessHead = { id: string; code: string; name: string };

/* Plain-English names shown on screen. The Module keys stay unchanged because
   search results and saved links refer to them. */
const LABEL: Record<Module, string> = {
  "Overview": "Home", "My Workspace": "My page", "People": "Staff", "Recruitment": "Hiring",
  "Onboarding": "Joining", "Daily Attendance": "Attendance", "Leave & Shifts": "Leave & shifts",
  "Payroll": "Salary", "Performance": "Appraisals", "Engagement": "Surveys & recognition",
  "HR Calendar": "Calendar", "Learning": "Training", "Helpdesk": "Help desk", "Separation": "Leaving",
  "Reports": "Reports", "Administration": "Settings",
};
const ICON: Record<Module, IconName> = {
  "Overview": "home", "My Workspace": "user", "People": "users", "Recruitment": "userPlus",
  "Onboarding": "doorIn", "Daily Attendance": "check", "Leave & Shifts": "sun",
  "Payroll": "rupee", "Performance": "star", "Engagement": "heart", "HR Calendar": "calendar",
  "Learning": "book", "Helpdesk": "help", "Separation": "doorOut", "Reports": "chart", "Administration": "settings",
};
/* Everyday work is always visible; the rest sits under "More". */
const nav: { group: string; more?: boolean; items: Module[] }[] = [
  { group: "", items: ["Overview", "People", "Daily Attendance", "Leave & Shifts", "Payroll", "Reports"] },
  { group: "Joining & leaving", more: true, items: ["Recruitment", "Onboarding", "Separation"] },
  { group: "Growth & support", more: true, items: ["Performance", "Learning", "Engagement", "HR Calendar", "Helpdesk"] },
  { group: "Your account", more: true, items: ["My Workspace", "Administration"] },
];

type IconName = "home"|"user"|"users"|"userPlus"|"doorIn"|"doorOut"|"check"|"sun"|"rupee"|"star"|"heart"|"calendar"|"book"|"help"|"chart"|"settings"|"shield"|"logout"|"chevron"|"search"|"bell"|"plus"|"alert";
const ICON_PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 10a6 6 0 0 1 12 0M16 3.5a4 4 0 0 1 0 7.5M18 15a6 6 0 0 1 3 5",
  userPlus: "M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 12.5-4.3M19 14v6M16 17h6",
  doorIn: "M14 3h5a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-5M3 12h11M10 8l4 4-4 4",
  doorOut: "M10 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h5M10 12h11M17 8l4 4-4 4",
  check: "M4 12.5 9 17.5 20 6.5",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  rupee: "M6 4h12M6 9h12M9 4c6 0 6 10 0 10H6l8 7",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9L12 3Z",
  heart: "M12 20s-8-4.7-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.3 12 20 12 20Z",
  calendar: "M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6ZM4 10h16M8 3v4M16 3v4",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5ZM4 21a2 2 0 0 1 2-2h13v2",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.3 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.8 1.7 1l.3 2.5h4l.3-2.5c.6-.2 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6Z",
  shield: "M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z",
  logout: "M15 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11",
  chevron: "m6 9 6 6 6-6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2ZM10 21h4",
  plus: "M12 5v14M5 12h14",
  alert: "M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
};
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON_PATHS[name]} /></svg>;
}

type Person = { id:string; name:string; code:string; role:string; dept:string; head:string; businessHeadId:string; departmentId:string|null; joined:string; joinedIso:string; status:string; initials:string; color:string; probationEnd:string|null };

/* Counts gathered in the background for the home screen and menu badges.
   null means "not available to this user" — never shown as zero. */
type WorkCounts = { pendingLeave:number|null; openHelpdesk:number|null; payrollThisMonth:boolean|null };

/* Probation rule used across the app: an entered end date wins; otherwise six months after joining. */
const PROBATION_MONTHS = 6;
function probationDue(person:Person){ if(person.probationEnd) return new Date(`${person.probationEnd}T00:00:00`); const d=new Date(`${person.joinedIso}T00:00:00`); d.setMonth(d.getMonth()+PROBATION_MONTHS); return d; }
function monthsBetween(a:Date,b:Date){ return Math.max(0,Math.floor((b.getTime()-a.getTime())/(30.44*86400000))); }
function joiningDateLooksWrong(person:Person){ const y=Number(person.joinedIso.slice(0,4)); return !y || y<1970 || new Date(`${person.joinedIso}T00:00:00`).getTime()>Date.now()+31*86400000; }
function needsDepartment(person:Person){ return !person.departmentId || person.dept==='—' || /^misc\.?$/i.test(person.dept.trim()); }
const plural=(n:number,one:string,many=`${one}s`)=>`${n} ${n===1?one:many}`;

type AttendanceRow = { id:string; employeeId?:string; name:string; sub:string; in:string; out:string; hours:string; status:string; locked:boolean };

type CalendarDisplay={id:string;eventDate:string;day:string;month:string;title:string;who:string;type:string;tone:string};
type GlobalSearchItem={id:string;kind:string;title:string;subtitle:string;status:string|null;module:Module;businessHeadId:string|null};
type GlobalSearchGroup={key:string;label:string;items:GlobalSearchItem[]};

const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
async function downloadExport(report:'workforce'|'attendance'|'payroll'|'performance'|'recruitment',businessHeadId:string,reason:string){const response=await fetch('/api/reports/export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({report,businessHeadId:businessHeadId==='all'?null:businessHeadId,reason})});if(!response.ok)throw new Error((await response.json().catch(()=>null))?.error?.message||'Export failed');const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`velite-${report}-${new Date().toISOString().slice(0,10)}.csv`;link.click();URL.revokeObjectURL(url);}

export default function Home() {
  const [active, setActive] = useState<Module>("Overview");
  const [heads, setHeads] = useState<BusinessHead[]>([]);
  const [head, setHead] = useState("all");
  const [query, setQuery] = useState("");
  const [searchGroups,setSearchGroups]=useState<GlobalSearchGroup[]>([]);
  const [searchBusy,setSearchBusy]=useState(false);
  const [searchOpen,setSearchOpen]=useState(false);
  const [searchError,setSearchError]=useState("");
  const [toast, setToast] = useState("");
  const [showQuick, setShowQuick] = useState(false);
  const [showMobileNav,setShowMobileNav]=useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [calendarEvents,setCalendarEvents]=useState<CalendarDisplay[]>([]);
  const [sessionUser,setSessionUser]=useState<{fullName:string;mustChangePassword:boolean;mfaEnrollmentRequired:boolean;roles:{code:string;businessHeadId:string|null;departmentId:string|null}[]} | null>(null);
  const [notifications,setNotifications]=useState<{unread:number;items:{id:string}[]}>({unread:0,items:[]});
  const [loading, setLoading] = useState(true);
  const [showMore,setShowMore]=useState(false);
  const [counts,setCounts]=useState<WorkCounts>({pendingLeave:null,openHelpdesk:null,payrollThisMonth:null});
  const [peopleFilter,setPeopleFilter]=useState<PeopleFilter>('all');
  const openPeople=useCallback((filter:PeopleFilter)=>{setPeopleFilter(filter);setActive('People')},[]);
  const headName = head === "all" ? "All Velite" : heads.find(item => item.id === head)?.name || "Velite";
  const canViewAll = Boolean(sessionUser?.roles?.some(role => role.code === "SUPER_ADMIN" || (role.code !== "EMPLOYEE" && !role.businessHeadId && !role.departmentId)));
  const employeeOnly = Boolean(sessionUser?.roles?.length && sessionUser.roles.every(role => role.code === "EMPLOYEE"));
  const canAdmin = Boolean(sessionUser?.roles?.some(role => ["SUPER_ADMIN", "HR_ADMIN"].includes(role.code)));
  const flash=useCallback((message:string)=>{setToast(message);window.setTimeout(()=>setToast(""),2600)},[]);

  useEffect(() => {
    Promise.all([fetch("/api/business-heads"),fetch("/api/auth/me"),fetch('/api/notifications')]).then(async ([response,userResponse,notificationResponse]) => {
      let broadAccess=false;if(userResponse.ok){const userBody=await userResponse.json();if(userBody.data?.mustChangePassword){window.location.assign('/change-password');return;}if(userBody.data?.mfaEnrollmentRequired){window.location.assign('/security');return;}setSessionUser(userBody.data);broadAccess=Boolean(userBody.data?.roles?.some((role:any)=>role.code==='SUPER_ADMIN'||(role.code!=='EMPLOYEE'&&!role.businessHeadId&&!role.departmentId)));if(userBody.data?.roles?.length&&userBody.data.roles.every((role:any)=>role.code==='EMPLOYEE'))setActive('My Workspace');}
      if (response.status === 401) { window.location.assign("/login"); return; }
      if (!response.ok) throw new Error("Unable to load business heads");
      const body = await response.json(); const available = body.data as BusinessHead[]; setHeads(available);
      if(notificationResponse.ok){const notificationBody=await notificationResponse.json();setNotifications(notificationBody.data);}
      if (available.length && !broadAccess) setHead(available[0].id);
    }).catch(() => flash("The company list could not be loaded. Please refresh.")).finally(() => setLoading(false));
  }, [flash]);

  useEffect(() => {
    if (!sessionUser || employeeOnly) return;
    const departmentScope=sessionUser.roles.find(role=>role.departmentId&&role.businessHeadId===head)?.departmentId||null;
    const scope = head === "all" ? "" : `?businessHeadId=${encodeURIComponent(head)}${departmentScope?`&departmentId=${encodeURIComponent(departmentScope)}`:''}`;
    const today = new Date().toISOString().slice(0,10);
    /* Each list loads on its own, so one slow or failing screen can never blank another. */
    const json=(url:string)=>fetch(url).then(response=>response.ok?response.json():Promise.reject(new Error(url)));
    Promise.allSettled([
      json(`/api/employees${scope}`),
      json(`/api/attendance?date=${today}${head === "all" ? "" : `&businessHeadId=${encodeURIComponent(head)}${departmentScope?`&departmentId=${encodeURIComponent(departmentScope)}`:''}`}`),
      json(`/api/calendar?from=${today}&to=${new Date(Date.now()+90*86400000).toISOString().slice(0,10)}${head === "all" ? "" : `&businessHeadId=${encodeURIComponent(head)}`}`),
    ]).then(([employees,attendanceResult,calendarResult]) => {
      const colors=["lilac","mint","blue","peach","yellow"];
      if(employees.status==='fulfilled') setPeople(employees.value.data.map((row:any,index:number)=>({id:row.id,name:[row.first_name,row.last_name].filter(Boolean).join(" ").replace(/\s+/g," ").trim(),code:row.employee_code,role:row.position,dept:row.department||"—",head:row.business_head,businessHeadId:row.business_head_id,departmentId:row.department_id||null,joined:new Intl.DateTimeFormat("en-IN",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(row.date_joined)),joinedIso:String(row.date_joined).slice(0,10),status:String(row.status).replaceAll("_"," ").replace(/\b\w/g,(c:string)=>c.toUpperCase()),initials:`${row.first_name?.trim()?.[0]||""}${row.last_name?.trim()?.[0]||""}`.toUpperCase(),color:colors[index%colors.length],probationEnd:row.probation_end_date?String(row.probation_end_date).slice(0,10):null})));
      else flash("The staff list could not be loaded. Please refresh the page.");
      if(attendanceResult.status==='fulfilled') setAttendance(attendanceResult.value.data.map((row:any)=>{const minutes=Number(row.worked_minutes||0);return{id:row.id||row.employee_id,employeeId:row.employee_id,name:[row.first_name,row.last_name].filter(Boolean).join(" "),sub:`${row.position} · ${row.employee_code}`,in:row.first_in?new Date(row.first_in).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:false}):"—",out:row.last_out?new Date(row.last_out).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:false}):"—",hours:minutes?`${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,"0")}m`:"—",status:String(row.status).replaceAll("_"," ").replace(/\b\w/g,(c:string)=>c.toUpperCase()),locked:Boolean(row.locked_at)}}));
      if(calendarResult.status==='fulfilled'){const tones=['violet','blue','green','orange'];setCalendarEvents(calendarResult.value.data.map((row:any,index:number)=>{const date=new Date(`${String(row.event_date).slice(0,10)}T00:00:00`);return{id:row.id,eventDate:String(row.event_date).slice(0,10),day:String(date.getDate()).padStart(2,'0'),month:date.toLocaleString('en-IN',{month:'short'}).toUpperCase(),title:row.title,who:row.employee_name||row.business_head||'All Velite',type:String(row.event_type).replaceAll('_',' ').replace(/\b\w/g,(c:string)=>c.toUpperCase()),tone:tones[index%tones.length]}}))}
    }).finally(() => setLoading(false));
  }, [head,flash,sessionUser,employeeOnly]);

  /* Background counts for the home screen and menu badges. Anything this user
     is not allowed to see simply stays hidden. */
  useEffect(() => {
    if (!sessionUser || employeeOnly) return;
    const q = head === "all" ? "" : `?businessHeadId=${encodeURIComponent(head)}`;
    const rows=(url:string)=>fetch(url).then(response=>response.ok?response.json():Promise.reject()).then(body=>Array.isArray(body?.data)?body.data as any[]:Promise.reject());
    const month=new Date().toISOString().slice(0,7);
    Promise.allSettled([rows(`/api/leave/requests${q}`),rows(`/api/helpdesk${q}`),rows(`/api/payroll/periods${q}`)]).then(([leave,help,payroll])=>setCounts({
      pendingLeave: leave.status==='fulfilled' ? leave.value.filter(row=>row.status==='pending').length : null,
      openHelpdesk: help.status==='fulfilled' ? help.value.filter(row=>!['resolved','closed','cancelled'].includes(String(row.status))).length : null,
      payrollThisMonth: payroll.status==='fulfilled' ? payroll.value.some(row=>String(row.period_month||row.period_start||'').slice(0,7)===month) : null,
    }));
  }, [head,sessionUser,employeeOnly]);

  useEffect(()=>{
    const value=query.trim();
    if(value.length<2){setSearchGroups([]);setSearchBusy(false);setSearchError("");return;}
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      setSearchBusy(true);setSearchError("");
      const params=new URLSearchParams({q:value});if(head!=="all")params.set("businessHeadId",head);
      fetch(`/api/search?${params}`,{signal:controller.signal})
        .then(response=>response.ok?response.json():Promise.reject())
        .then(body=>setSearchGroups((body.data?.groups||[]).filter((group:GlobalSearchGroup)=>group.items.length)))
        .catch(error=>{if(error?.name!=="AbortError"){setSearchGroups([]);setSearchError("Search is temporarily unavailable.")}})
        .finally(()=>{if(!controller.signal.aborted)setSearchBusy(false)});
    },250);
    return()=>{window.clearTimeout(timer);controller.abort()};
  },[query,head]);

  async function logout(){await fetch('/api/auth/logout',{method:'POST'});window.location.assign('/login');}
  async function openNotifications(){const ids=notifications.items.filter(Boolean).map(item=>item.id);if(ids.length)await fetch('/api/notifications',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({ids})});setNotifications(current=>({...current,unread:0}));setActive('HR Calendar');}
  function openSearchResult(result:GlobalSearchItem){if(result.businessHeadId&&heads.some(item=>item.id===result.businessHeadId))setHead(result.businessHeadId);setActive(result.module);setQuery("");setSearchGroups([]);setSearchOpen(false);flash(`${result.title} opened in ${result.module}.`)}

  return (
    <div className="app-shell">
      <aside className={`sidebar ${showMobileNav?'mobile-open':''}`}>
        <div className="brand"><div className="brand-mark">V</div><div><strong>Velite</strong><span>PeopleOS</span></div></div>
        <div className="org-switch"><span>Showing company</span><select value={head} onChange={e => setHead(e.target.value)} aria-label="Company">{canViewAll&&<option value="all">All Velite companies</option>}{heads.map(h => <option value={h.id} key={h.id}>{h.name}</option>)}</select></div>
        <nav>{(()=>{
          const badge=(item:Module)=>item==='Helpdesk'?counts.openHelpdesk:item==='Leave & Shifts'?counts.pendingLeave:null;
          const button=(item:Module)=>{const count=badge(item);return <button className={active === item ? "active" : ""} onClick={() => {setActive(item);if(item==='People')setPeopleFilter('all');setShowMobileNav(false)}} key={item}><Icon name={ICON[item]} />{LABEL[item]}{count?<b title={`${count} waiting`}>{count}</b>:null}</button>};
          if(employeeOnly) return <div className="nav-group">{button('My Workspace')}</div>;
          const visible=(section:typeof nav[number])=>section.items.filter(item=>item!=='Administration'||canAdmin);
          const moreOpen=showMore||nav.some(section=>section.more&&section.items.includes(active));
          return <>{nav.filter(section=>!section.more).map(section=><div className="nav-group" key="main">{visible(section).map(button)}</div>)}
            <button className="nav-more" onClick={()=>setShowMore(value=>!value)} aria-expanded={moreOpen}><span style={{transform:moreOpen?'rotate(180deg)':'none',display:'inline-flex'}}><Icon name="chevron" size={16} /></span>{moreOpen?'Less':'More'}</button>
            {moreOpen&&nav.filter(section=>section.more).map(section=>{const items=visible(section);return items.length?<div className="nav-group" key={section.group}><label>{section.group}</label>{items.map(button)}</div>:null})}</>;
        })()}</nav>
        <div className="sidebar-foot"><button onClick={() => window.location.assign('/security')}><Icon name="shield" /> Password & security</button><div className="admin"><div className="avatar dark">{sessionUser?.fullName?.split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase()||'V'}</div><div><strong>{sessionUser?.fullName||'Velite user'}</strong><span>{sessionUser?.roles?.map(role=>role.code.replaceAll('_',' ').toLowerCase().replace(/^\w/,c=>c.toUpperCase())).join(', ')||'…'}</span></div><button aria-label="Sign out" title="Sign out" onClick={logout}><Icon name="logout" /></button></div></div>
      </aside>

      <main>
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open navigation" onClick={()=>setShowMobileNav(value=>!value)}>☰</button><div className="mobile-brand"><div className="brand-mark">V</div><strong>Velite PeopleOS</strong></div>
          <div className="global-search"><span>⌕</span><input value={query} onChange={e=>{setQuery(e.target.value);setSearchOpen(true)}} onFocus={()=>setSearchOpen(true)} onBlur={()=>window.setTimeout(()=>setSearchOpen(false),120)} onKeyDown={event=>{if(event.key==='Escape'){setSearchOpen(false);event.currentTarget.blur()}}} placeholder="Search staff by name or code…" role="combobox" aria-autocomplete="list" aria-expanded={searchOpen&&query.trim().length>=2} aria-controls="global-search-results" />
            {searchOpen&&query.trim().length>=2&&<div className="search-results" id="global-search-results" role="listbox" onMouseDown={event=>event.preventDefault()}>{searchBusy?<div className="search-message">Searching…</div>:searchError?<div className="search-message error">{searchError}</div>:searchGroups.length?searchGroups.map(group=><section key={group.key}><header>{group.label}<small>{group.items.length}</small></header>{group.items.map(result=><button key={`${result.kind}-${result.id}`} role="option" aria-selected="false" onClick={()=>openSearchResult(result)}><i>{group.label.slice(0,1)}</i><span><strong>{result.title}</strong><small>{result.subtitle}</small></span>{result.status&&<em>{result.status.replaceAll('_',' ')}</em>}</button>)}</section>):<div className="search-message">Nothing found for “{query.trim()}”.</div>}</div>}
          </div>
          <div className="top-actions"><button aria-label="Notifications" title="Notifications" onClick={openNotifications}><Icon name="bell" />{notifications.unread>0&&<em>{notifications.unread}</em>}</button><button className="quick" onClick={() => setShowQuick(!showQuick)}>＋ New</button></div>
          {showQuick && <div className="quick-menu"><button onClick={() => { openPeople('all'); setShowQuick(false); }}>Add a staff member</button><button onClick={() => { setActive("Daily Attendance"); setShowQuick(false); }}>Mark attendance</button><button onClick={() => { setActive("Leave & Shifts"); setShowQuick(false); }}>Record leave</button><button onClick={() => { setActive("Payroll"); setShowQuick(false); }}>Start this month's salary</button><button onClick={() => { setActive("Recruitment"); setShowQuick(false); }}>Start hiring for a job</button></div>}
        </header>
        <div className="content">
          {loading ? <section className="panel loading-panel">Loading…</section> : active === "Overview" ? <HomeView head={headName} firstName={(sessionUser?.fullName||'').trim().split(/\s+/)[0]||''} people={people} attendance={attendance} calendar={calendarEvents} counts={counts} setActive={setActive} openPeople={openPeople} /> :
           active === "My Workspace" ? <SelfServiceView flash={flash} /> :
           active === "People" ? <PeopleView key={peopleFilter} initialFilter={peopleFilter} people={people} heads={heads} businessHeadId={head} head={headName} flash={flash} /> :
           active === "Daily Attendance" ? <AttendanceView rows={attendance} people={people} businessHeadId={head} head={headName} flash={flash} /> :
           active === "Payroll" ? <PayrollWorkspace businessHeadId={head} head={headName} heads={heads} flash={flash} /> :
           active === "Performance" ? <PerformanceWorkspace businessHeadId={head} head={headName} heads={heads} people={people} flash={flash} /> :
           active === "Engagement" ? <EngagementWorkspace businessHeadId={head} head={headName} heads={heads} people={people} flash={flash} /> :
           active === "HR Calendar" ? <HrCalendarWorkspace businessHeadId={head} head={headName} flash={flash} /> :
           active === "Administration" ? <AdministrationWorkspace businessHeadId={head} head={headName} heads={heads} flash={flash} /> :
           <OperationsWorkspace active={active} businessHeadId={head} head={headName} heads={heads} people={people} flash={flash} />}
        </div>
      </main>
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function PageHead({ eyebrow, title, text, action, onAction }: { eyebrow: string; title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="page-head"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{action && <button className="primary" onClick={onAction}>＋ {action}</button>}</div>;
}

/* Names are stored in capitals; show them the way people write them. */
const nice=(name:string)=>name.toLowerCase().replace(/\s+/g,' ').trim().replace(/(^|[\s.'-])\p{L}/gu,c=>c.toUpperCase());
type Insight={ key:string; tone:'red'|'amber'|'info'; title:string; detail:string; action:string; onClick:()=>void };

function HomeView({ head, firstName, people, attendance, calendar, counts, setActive, openPeople }: { head:string; firstName:string; people:Person[]; attendance:AttendanceRow[]; calendar:CalendarDisplay[]; counts:WorkCounts; setActive:(m:Module)=>void; openPeople:(f:PeopleFilter)=>void }) {
  const now=new Date(); const hour=now.getHours();
  const greeting=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
  const today=new Intl.DateTimeFormat('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(now);
  const monthName=new Intl.DateTimeFormat('en-IN',{month:'long'}).format(now);

  const badDates=people.filter(joiningDateLooksWrong);
  const probation=people.filter(p=>p.status==='Probation');
  const confirmed=people.filter(p=>p.status==='Active').length;
  const overdue=probation.filter(p=>!joiningDateLooksWrong(p)&&probationDue(p).getTime()<now.getTime()).map(p=>({p,months:monthsBetween(probationDue(p),now)})).sort((a,b)=>b.months-a.months);
  const endingSoon=probation.filter(p=>{const due=probationDue(p).getTime();return !joiningDateLooksWrong(p)&&due>=now.getTime()&&due<=now.getTime()+30*86400000});
  const noDept=people.filter(p=>!p.departmentId||p.dept==='—').length;
  const misc=people.filter(p=>p.departmentId&&/^misc\.?$/i.test(p.dept.trim())).length;
  const present=attendance.filter(r=>["Present","Work From Home","On Duty","Half Day"].includes(r.status)).length;
  const onLeave=attendance.filter(r=>r.status.includes('Leave')).length;
  const absent=attendance.filter(r=>r.status==='Absent').length;
  const notMarked=attendance.filter(r=>r.status==='Missing').length;
  const month=now.toISOString().slice(0,7);
  const joinedThisMonth=people.filter(p=>p.joinedIso.slice(0,7)===month);
  const newest=[...people].filter(p=>!joiningDateLooksWrong(p)).sort((a,b)=>b.joinedIso.localeCompare(a.joinedIso));

  const insights:Insight[]=[];
  if(overdue.length){const top=overdue[0];const longWait=overdue.filter(o=>o.months>=6).length;insights.push({key:'overdue',tone:longWait?'red':'amber',title:`${plural(overdue.length,'staff member is','staff are')} past their probation date`,detail:`Each one should be confirmed or have probation extended.${longWait?` ${plural(longWait,'person has','people have')} waited more than 6 months extra.`:''} Longest waiting: ${nice(top.p.name)}, ${plural(top.months,'month')} overdue.`,action:'Review list',onClick:()=>openPeople('overdue')})}
  if(attendance.length&&notMarked===attendance.length)insights.push({key:'attendance',tone:hour>=12?'red':'amber',title:"Today's attendance has not been marked",detail:`None of the ${attendance.length} staff have been marked present, absent or on leave yet.`,action:'Mark attendance',onClick:()=>setActive('Daily Attendance')});
  else if(notMarked)insights.push({key:'attendance',tone:'amber',title:`${plural(notMarked,'staff member is','staff are')} not marked for today`,detail:'Mark them present, absent or on leave so salary is calculated correctly.',action:'Mark attendance',onClick:()=>setActive('Daily Attendance')});
  if(counts.pendingLeave)insights.push({key:'leave',tone:'amber',title:`${plural(counts.pendingLeave,'leave request is','leave requests are')} waiting for approval`,detail:'Staff are waiting to hear back.',action:'Review requests',onClick:()=>setActive('Leave & Shifts')});
  if(badDates.length)insights.push({key:'dates',tone:'amber',title:`${plural(badDates.length,'joining date looks','joining dates look')} wrong`,detail:`${badDates.slice(0,2).map(p=>`${nice(p.name)} — ${p.joined}`).join('; ')}${badDates.length>2?` and ${badDates.length-2} more`:''}. Please check and correct.`,action:'Check dates',onClick:()=>openPeople('dates')});
  /* Staff codes may repeat across companies (by design), but never within one company. */
  const byCode:Record<string,Person[]>={};people.forEach(p=>{const key=`${p.businessHeadId}|${String(p.code).trim().toUpperCase()}`;(byCode[key]=byCode[key]||[]).push(p)});
  const dupes=Object.values(byCode).filter(group=>group.length>1);
  if(dupes.length)insights.push({key:'dupes',tone:'amber',title:`${plural(dupes.length,'staff code is','staff codes are')} used twice in the same company`,detail:`${dupes.slice(0,2).map(group=>`Code ${group[0].code}: ${group.map(p=>nice(p.name)).join(' and ')}`).join('; ')}. Each person needs their own code so attendance and salary match up.`,action:'See staff',onClick:()=>openPeople('all')});
  if(counts.payrollThisMonth===false)insights.push({key:'salary',tone:now.getDate()>=25?'amber':'info',title:`${monthName} salary has not been started`,detail:'Start it once attendance for the month is complete.',action:'Open salary',onClick:()=>setActive('Payroll')});
  if(noDept+misc)insights.push({key:'dept',tone:'info',title:`${plural(noDept+misc,'staff member does not','staff do not')} have a proper department`,detail:`${[noDept?`${noDept} have none`:'',misc?`${misc} are filed under "Misc."`:''].filter(Boolean).join(' and ')}. Real departments make headcount and reports by department accurate.`,action:'Assign departments',onClick:()=>openPeople('department')});
  if(endingSoon.length)insights.push({key:'soon',tone:'info',title:`${plural(endingSoon.length,'person finishes','people finish')} probation in the next 30 days`,detail:`Plan their confirmation review: ${endingSoon.slice(0,3).map(p=>nice(p.name)).join(', ')}${endingSoon.length>3?'…':''}.`,action:'See who',onClick:()=>openPeople('probation')});
  if(counts.openHelpdesk)insights.push({key:'help',tone:'info',title:`${plural(counts.openHelpdesk,'staff question is','staff questions are')} open in the help desk`,detail:'Reply or close them when resolved.',action:'Open help desk',onClick:()=>setActive('Helpdesk')});
  const order={red:0,amber:1,info:2};insights.sort((a,b)=>order[a.tone]-order[b.tone]);

  const groups=Object.entries(people.reduce<Record<string,number>>((out,person)=>{out[person.head]=(out[person.head]||0)+1;return out},{})).sort((a,b)=>b[1]-a[1]);
  const allUnmarked=attendance.length>0&&notMarked===attendance.length;

  return <>
    <div className="home-greeting"><div><span className="eyebrow">{today}</span><h1>{greeting}{firstName?`, ${nice(firstName)}`:''}</h1><p>{head} · Here is what needs your attention today.</p></div><div className="actions"><button className="secondary" onClick={()=>setActive('Daily Attendance')}>Mark attendance</button><button className="primary" onClick={()=>openPeople('add')}>＋ Add staff</button></div></div>

    <div className="home-stats">
      <button className="home-stat" onClick={()=>openPeople('all')}><span>Total staff</span><strong>{people.length}</strong><small>{confirmed} confirmed · {probation.length} on probation</small></button>
      <button className={`home-stat ${allUnmarked?'warn':''}`} onClick={()=>setActive('Daily Attendance')}><span>Present today</span><strong>{attendance.length?present:'—'}</strong><small>{!attendance.length?'Attendance not available':allUnmarked?'Not marked yet today':`of ${attendance.length} staff · ${absent} absent`}</small></button>
      <button className="home-stat" onClick={()=>setActive('Leave & Shifts')}><span>On leave today</span><strong>{attendance.length?onLeave:'—'}</strong><small>{counts.pendingLeave?`${counts.pendingLeave} request(s) waiting`:'Paid and unpaid leave'}</small></button>
      <button className="home-stat" onClick={()=>openPeople('new')}><span>Joined this month</span><strong>{joinedThisMonth.length}</strong><small>{joinedThisMonth.length?`Newest: ${nice([...joinedThisMonth].sort((a,b)=>b.joinedIso.localeCompare(a.joinedIso))[0].name)}`:'No one new yet'}</small></button>
    </div>

    <section className="insights">
      <header><h2>Needs your attention</h2><p>{insights.length?`${plural(insights.length,'item')}, most important first`:'Checked just now'}</p></header>
      {insights.map(item=><div className={`insight ${item.tone}`} key={item.key}><i /><div><strong>{item.title}</strong><span>{item.detail}</span></div><button onClick={item.onClick}>{item.action}</button></div>)}
      {!insights.length&&<div className="all-clear"><Icon name="check" size={24} /> All clear. Nothing needs your attention today.</div>}
    </section>

    <div className="home-panels">
      <section className="panel"><div className="panel-head padded"><div><h2>Staff by company</h2><p>{people.length} staff in this view</p></div><button onClick={() => setActive("Reports")}>More in Reports</button></div><div className="bar-list">
        {groups.map(([name,value],index) => {const percent=people.length?Math.round(value/people.length*100):0;return <div key={name}><div><span>{name}</span><strong>{value} <small>{percent}%</small></strong></div><i><b className={['purple','blue','green','orange','grey'][index%5]} style={{width:`${percent}%`}} /></i></div>})}{!groups.length&&<div className="empty-state">No staff in this view.</div>}
      </div></section>
      <section className="panel"><div className="panel-head padded"><div><h2>Newest staff</h2><p>Most recent joiners first</p></div><button onClick={() => openPeople('new')}>See all new staff</button></div><div className="joiners">{newest.slice(0,5).map(p => <div key={p.id}><div className={`avatar ${p.color}`}>{p.initials}</div><div><strong>{nice(p.name)}</strong><span>{p.role}{p.dept!=='—'?` · ${p.dept}`:''}</span></div><small>{p.joined}</small></div>)}{!people.length&&<div className="empty-state">No staff in this view.</div>}</div></section>
    </div>
    {calendar.length>0&&<section className="panel calendar-card" style={{marginTop:16}}><div className="panel-head padded"><div><h2>Coming up</h2><p>Next 90 days</p></div><button onClick={() => setActive("HR Calendar")}>Open calendar</button></div>{calendar.slice(0,4).map(c => <CalendarItem key={c.id} {...c} />)}</section>}
  </>;
}

function Metric({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon: string; tone: string }) { return <div className="metric"><div className={`metric-icon ${tone}`}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function CalendarItem(c: { day: string; month: string; title: string; who: string; type: string; tone: string }) { return <div className="calendar-item"><div className={`datebox ${c.tone}`}><strong>{c.day}</strong><span>{c.month}</span></div><div><strong>{c.title}</strong><span>{c.who}</span></div><b>{c.type}</b></div>; }

function SelfServiceView({flash}:{flash:(message:string)=>void}) {
  const [data,setData]=useState<any>(null);const [busy,setBusy]=useState(true);const [action,setAction]=useState<'profile'|'leave'|'expense'|'tax'|'survey'|null>(null);const[selectedSurvey,setSelectedSurvey]=useState<any>(null);
  const load=useCallback(()=>{setBusy(true);Promise.all(['/api/self/overview','/api/self/surveys','/api/self/tax-declarations'].map(path=>fetch(path).then(response=>response.ok?response.json():Promise.reject()))).then(([overview,surveys,tax])=>setData({...overview.data,surveys:surveys.data,taxDeclarations:tax.data})).catch(()=>flash('Your page could not be loaded. Please refresh.')).finally(()=>setBusy(false))},[flash]);
  useEffect(()=>load(),[load]);
  if(busy)return <section className="panel loading-panel">Loading…</section>;
  if(!data)return <section className="panel loading-panel">No employee record is linked to this account.</section>;
  const profile=data.profile||{};const present=(data.attendance||[]).filter((row:any)=>['present','work_from_home','on_duty'].includes(row.status)).length;const leaveBalance=(data.leaveBalances||[]).reduce((sum:number,row:any)=>sum+Number(row.balance||0),0);const latestPay=data.payroll?.[0];
  return <><PageHead eyebrow="My page" title={`Welcome, ${profile.first_name?nice(profile.first_name):'colleague'}`} text={`${profile.position||'Employee'} · ${profile.department||profile.business_head||'Velite'} · ${profile.employee_code||''}`} action="Update contact details" onAction={()=>setAction('profile')}/>
    <div className="metrics compact"><Metric label="PRESENT · 31 DAYS" value={String(present)} note="Recorded work days" icon="✓" tone="green"/><Metric label="LEAVE BALANCE" value={String(leaveBalance)} note="Across active policies" icon="◷" tone="blue"/><Metric label="LATEST NET PAY" value={latestPay?money(Number(latestPay.net_pay)):"—"} note={latestPay?String(latestPay.period_month).slice(0,7):'No published payroll'} icon="₹" tone="purple"/><Metric label="OPEN GOALS" value={String((data.performance?.goals||[]).filter((goal:any)=>goal.status==='active').length)} note="Current performance goals" icon="☆" tone="orange"/></div>
    <div className="grid halves"><section className="panel"><div className="panel-head padded"><div><h2>My requests</h2><p>Leave and expense claims</p></div><div><button onClick={()=>setAction('leave')}>Request leave</button><button onClick={()=>setAction('expense')}>Claim expense</button></div></div><div className="joiners">{[...(data.leaveRequests||[]).map((item:any)=>({id:`leave-${item.id}`,title:item.leave_type,detail:`${String(item.start_date).slice(0,10)} · ${item.days} day(s)`,status:item.status})),...(data.expenses||[]).map((item:any)=>({id:`expense-${item.id}`,title:item.claim_number,detail:`${item.category} · ${money(Number(item.amount))}`,status:item.status}))].slice(0,8).map((item:any)=><div key={item.id}><div className="avatar blue">↗</div><div><strong>{item.title}</strong><span>{item.detail}</span></div><em className={`status ${item.status}`}>{String(item.status).replaceAll('_',' ')}</em></div>)}</div></section>
      <section className="panel"><div className="panel-head padded"><div><h2>My development</h2><p>Goals, learning and policies</p></div></div><div className="joiners">{(data.performance?.goals||[]).slice(0,4).map((goal:any)=><div key={goal.id}><div className="avatar lilac">☆</div><div><strong>{goal.title}</strong><span>{goal.cycle_name} · {goal.progress}% complete</span></div><small>{goal.weight}%</small></div>)}{(data.learning||[]).slice(0,3).map((course:any)=><div key={course.id}><div className="avatar mint">△</div><div><strong>{course.title}</strong><span>{course.status} · {course.progress}%</span></div><small>{course.due_date?String(course.due_date).slice(0,10):'Open'}</small></div>)}</div></section></div>
    <section className="panel table-panel"><div className="panel-head padded"><div><h2>Recent attendance</h2><p>Request a correction when a daily record is not accurate</p></div></div><div className="data-table payroll-table"><div className="tr th"><span>DATE</span><span>STATUS</span><span>IN</span><span>OUT</span><span>WORKED</span><span>LOCK</span></div>{(data.attendance||[]).slice(0,10).map((row:any)=><div className="tr" key={row.id}><span>{String(row.attendance_date).slice(0,10)}</span><span>{String(row.status).replaceAll('_',' ')}</span><span>{row.first_in?new Date(row.first_in).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'—'}</span><span>{row.last_out?new Date(row.last_out).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'—'}</span><span>{Math.floor(Number(row.worked_minutes||0)/60)}h {Number(row.worked_minutes||0)%60}m</span><span>{row.locked_at?'Locked':'Open'}</span></div>)}</div></section>
    <div className="grid halves"><section className="panel worklist operations-list"><div className="panel-head padded"><div><h2>Tax declarations</h2><p>Regime, deductions and proof review</p></div><button onClick={()=>setAction('tax')}>Add declaration</button></div>{(data.taxDeclarations||[]).map((item:any,index:number)=><div className="self-record" key={item.id}><i>{index+1}</i><div><b>{item.financial_year} · {String(item.regime).toUpperCase()} regime</b><span>{item.proofs?.length||0} proof(s) · submitted {item.submitted_at?String(item.submitted_at).slice(0,10):'not yet'}</span></div><em className={`status ${item.status}`}>{String(item.status).replaceAll('_',' ')}</em></div>)}</section><section className="panel worklist operations-list"><div className="panel-head padded"><div><h2>Listening surveys</h2><p>Your response is protected by the selected anonymity setting</p></div></div>{(data.surveys||[]).map((item:any,index:number)=><button key={item.id} disabled={item.responded} onClick={()=>{setSelectedSurvey(item);setAction('survey')}}><i>{index+1}</i><div><b>{item.title}</b><span>{item.anonymous?'Anonymous':'Identified'} · closes {String(item.closes_at).slice(0,10)}</span></div><em className={`status ${item.responded?'completed':'approved'}`}>{item.responded?'Responded':'Open'}</em><strong>›</strong></button>)}</section></div>
    {action&&<SelfActionForm action={action} profile={profile} policies={data.leaveBalances||[]} survey={selectedSurvey} onClose={()=>{setAction(null);setSelectedSurvey(null)}} onSaved={()=>{setAction(null);setSelectedSurvey(null);flash('Your request has been sent.');load()}}/>}
  </>;
}

function SelfActionForm({action,profile,policies,survey,onClose,onSaved}:{action:'profile'|'leave'|'expense'|'tax'|'survey';profile:any;policies:any[];survey:any;onClose:()=>void;onSaved:()=>void}){const[error,setError]=useState('');const[busy,setBusy]=useState(false);async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);const form=new FormData(event.currentTarget);let endpoint='/api/self/profile',method='PATCH',payload:any={personalEmail:form.get('personalEmail')||null,phone:form.get('phone')||null};if(action==='leave'){endpoint='/api/self/leave';method='POST';payload={leavePolicyId:form.get('leavePolicyId'),startDate:form.get('startDate'),endDate:form.get('endDate'),days:Number(form.get('days')),reason:form.get('reason')}}if(action==='expense'){endpoint='/api/self/expenses';method='POST';payload={category:form.get('category'),claimDate:form.get('claimDate'),amount:Number(form.get('amount')),description:form.get('description')}}if(action==='tax'){endpoint='/api/self/tax-declarations';method='POST';payload={financialYear:form.get('financialYear'),regime:form.get('regime'),declarations:{section80C:Number(form.get('section80C')||0),section80D:Number(form.get('section80D')||0),houseRent:Number(form.get('houseRent')||0),other:Number(form.get('other')||0)},submit:form.get('submit')==='on',reason:form.get('reason')}}if(action==='survey'){endpoint=`/api/self/surveys/${survey.id}/respond`;method='POST';payload={answers:{score:Number(form.get('score'))}}}const response=await fetch(endpoint,{method,headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const body=await response.json().catch(()=>null);if(!response.ok){setError(body?.error?.message||'The request could not be saved.');setBusy(false);return}onSaved()}const title=action==='profile'?'Update contact details':action==='leave'?'Request leave':action==='expense'?'Claim an expense':action==='tax'?'Tax declaration':survey?.title||'Survey response';return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true"><div className="modal-head"><div><span className="eyebrow">My page</span><h2>{title}</h2></div><button onClick={onClose}>×</button></div><form onSubmit={submit} className="form-grid">{action==='profile'?<><label>Personal email<input name="personalEmail" type="email" defaultValue={profile.personal_email||''}/></label><label>Phone<input name="phone" defaultValue={profile.phone||''}/></label></>:action==='leave'?<><label className="span-two">Leave policy<select name="leavePolicyId" required>{policies.map(policy=><option key={policy.policy_id} value={policy.policy_id}>{policy.name} · {policy.balance} available</option>)}</select></label><label>From<input name="startDate" type="date" required/></label><label>To<input name="endDate" type="date" required/></label><label>Days<input name="days" type="number" min="0.5" step="0.5" required/></label><label>Reason<input name="reason" required/></label></>:action==='expense'?<><label>Category<input name="category" required/></label><label>Claim date<input name="claimDate" type="date" required/></label><label>Amount<input name="amount" type="number" min="1" step="0.01" required/></label><label>Description<input name="description" required/></label></>:action==='tax'?<><label>Financial year<input name="financialYear" placeholder="2026-27" pattern="20[0-9]{2}-[0-9]{2}" required/></label><label>Tax regime<select name="regime"><option value="new">New regime</option><option value="old">Old regime</option></select></label><label>Section 80C<input name="section80C" type="number" min="0" defaultValue="0"/></label><label>Section 80D<input name="section80D" type="number" min="0" defaultValue="0"/></label><label>House rent<input name="houseRent" type="number" min="0" defaultValue="0"/></label><label>Other declarations<input name="other" type="number" min="0" defaultValue="0"/></label><label className="span-two">Reason<input name="reason" defaultValue="Annual employee tax declaration" required/></label><label className="check-label span-two"><input name="submit" type="checkbox"/> Submit now for payroll review</label></>:<><label className="span-two">{survey?.questions?.[0]?.prompt||'Your rating'}<select name="score" required><option value="">Select</option>{[1,2,3,4,5].map(value=><option key={value}>{value}</option>)}</select></label><div className="form-hint span-two">{survey?.anonymous?'Your employee identity will not be stored with the response.':'This survey records your identity.'}</div></>}{error&&<div className="form-error span-two">{error}</div>}<div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Submit'}</button></div></form></section></div>}

type PeopleFilter='all'|'new'|'probation'|'overdue'|'department'|'dates'|'notice'|'add';

function PeopleView({ people,heads,businessHeadId,head,flash,initialFilter='all' }: { people:Person[];heads:BusinessHead[];businessHeadId:string;head:string;flash:(s:string)=>void;initialFilter?:PeopleFilter }) {
  const[adding,setAdding]=useState(initialFilter==='add');
  const[selected,setSelected]=useState<Person|null>(null);
  const[filter,setFilter]=useState<Exclude<PeopleFilter,'add'>>(initialFilter==='add'?'all':initialFilter);
  const[newJoinerCutoff]=useState(()=>Date.now()-90*86400000);
  const[now]=useState(()=>Date.now());
  const active=people.filter(person=>person.status==='Active').length,probation=people.filter(person=>person.status==='Probation').length,notice=people.filter(person=>person.status==='Notice Period').length;
  const isOverdue=(person:Person)=>person.status==='Probation'&&!joiningDateLooksWrong(person)&&probationDue(person).getTime()<now;
  const test:Record<Exclude<PeopleFilter,'add'>,(p:Person)=>boolean>={
    all:()=>true,
    new:p=>new Date(`${p.joinedIso}T00:00:00`).getTime()>=newJoinerCutoff&&!joiningDateLooksWrong(p),
    probation:p=>p.status==='Probation',
    overdue:isOverdue,
    department:needsDepartment,
    dates:joiningDateLooksWrong,
    notice:p=>p.status==='Notice Period',
  };
  const tabs:[Exclude<PeopleFilter,'add'>,string][]=[['all','Everyone'],['new','Joined in last 90 days'],['probation','On probation'],['overdue','Probation overdue'],['department','Needs a department'],['dates','Check joining date'],['notice','Leaving (notice period)']];
  const visible=people.filter(test[filter]).sort((a,b)=>filter==='overdue'?probationDue(a).getTime()-probationDue(b).getTime():0);
  return <><PageHead eyebrow="Staff" title="All staff" text={`${head} · Click a name to see or change that person's full record.`} action="Add staff" onAction={() => setAdding(true)} />
    <div className="metrics compact"><Metric label="TOTAL STAFF" value={String(people.length)} note={head} icon="◎" tone="purple" /><Metric label="CONFIRMED" value={String(active)} note="Probation completed" icon="✓" tone="green" /><Metric label="ON PROBATION" value={String(probation)} note={`${people.filter(isOverdue).length} past their probation date`} icon="◷" tone="orange" /><Metric label="SERVING NOTICE" value={String(notice)} note="Leaving the company" icon="↙" tone="blue" /></div>
    <section className="panel table-panel"><div className="table-tools"><div className="tabs">{tabs.map(([key,label])=>{const n=people.filter(test[key]).length;return (key==='all'||n>0)?<button key={key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}{key!=='all'?` (${n})`:''}</button>:null})}</div><button className="secondary" onClick={() => downloadExport('workforce',businessHeadId,'Staff list download').then(()=>flash('Staff list downloaded.')).catch(error=>flash(error.message))}>⇩ Download list</button></div>
      <div className="data-table people-table"><div className="tr th"><span>NAME</span><span>JOB AND DEPARTMENT</span><span>COMPANY</span><span>{filter==='overdue'?'PROBATION ENDED':'JOINED'}</span><span>STATUS</span><span></span></div>{visible.map(p => <button className="tr" key={p.id} onClick={() => setSelected(p)}><span className="person-cell"><i className={`avatar ${p.color}`}>{p.initials}</i><b>{nice(p.name)}<small>Code {p.code}</small></b></span><span>{p.role}<small>{p.dept==='—'?'No department':p.dept}</small></span><span>{p.head}</span><span>{filter==='overdue'?new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(probationDue(p)):p.joined}{filter==='overdue'&&<small>{plural(monthsBetween(probationDue(p),new Date(now)),'month')} ago</small>}</span><span><em className={`status ${p.status.toLowerCase().replace(' ','-')}`}>{p.status==='Active'?'Confirmed':p.status}</em></span><span>›</span></button>)}</div>{!visible.length&&<div className="empty-state padded">No staff in this list.</div>}
    </section>{adding&&<EmployeeForm heads={heads} selectedHead={businessHeadId} onClose={()=>setAdding(false)} onCreated={()=>{setAdding(false);flash('Staff member added.');window.location.reload()}}/>}{selected&&<EmployeeRecordDrawer person={selected} people={people} onClose={()=>setSelected(null)} onChanged={()=>undefined} onDeleted={()=>{setSelected(null);window.location.reload()}} flash={flash}/>}</>;
}
function AttendanceView({ rows:initialRows,people,businessHeadId,head,flash }: { rows:AttendanceRow[];people:Person[];businessHeadId:string;head:string;flash:(s:string)=>void }) {
  const [day, setDay] = useState(new Date().toISOString().slice(0,10));
  const [rows,setRows]=useState(initialRows);
  const[marking,setMarking]=useState(false);
  const[markFor,setMarkFor]=useState('');
  const[refresh,setRefresh]=useState(0);
  const[monthSummary,setMonthSummary]=useState<any>(null);
  useEffect(()=>{setRows(initialRows)},[initialRows]);
  useEffect(()=>{const scope=businessHeadId==='all'?'':`&businessHeadId=${encodeURIComponent(businessHeadId)}`;fetch(`/api/attendance?date=${day}${scope}`).then(r=>r.ok?r.json():Promise.reject()).then(body=>setRows(body.data.map((row:any)=>{const minutes=Number(row.worked_minutes||0);return{id:row.id||row.employee_id,employeeId:row.employee_id,name:[row.first_name,row.last_name].filter(Boolean).join(' '),sub:`${row.position} · ${row.employee_code}`,in:row.first_in?new Date(row.first_in).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false}):'—',out:row.last_out?new Date(row.last_out).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false}):'—',hours:minutes?`${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,'0')}m`:'—',status:String(row.status).replaceAll('_',' ').replace(/\b\w/g,(c:string)=>c.toUpperCase()),locked:Boolean(row.locked_at)}}))).catch(()=>flash('Attendance could not be loaded for that date.'))},[day,businessHeadId,refresh]);
  useEffect(()=>{if(businessHeadId==='all'){setMonthSummary(null);return;}fetch(`/api/attendance/months?businessHeadId=${encodeURIComponent(businessHeadId)}&periodMonth=${day.slice(0,7)}-01`).then(response=>response.ok?response.json():({data:[]})).then(body=>setMonthSummary(body.data?.[0]||null))},[businessHeadId,day,refresh]);
  const present=rows.filter(row=>["Present","Work From Home","On Duty","Half Day"].includes(row.status)).length;const absent=rows.filter(row=>row.status==="Absent").length;const leave=rows.filter(row=>row.status.includes("Leave")).length;const notMarked=rows.filter(row=>row.status==="Missing").length;
  async function lockDay(){if(businessHeadId==='all'){flash('Select one business head before locking attendance.');return;}const reason=window.prompt('Reason for locking this attendance register:','Daily attendance cut-off');if(!reason)return;const response=await fetch('/api/attendance/lock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({businessHeadId,date:day,reason})});if(!response.ok){const body=await response.json().catch(()=>null);flash(body?.error?.message||'Attendance could not be locked.');return;}const body=await response.json();setRows(current=>current.map(row=>({...row,locked:true})));flash(`${body.data.locked} attendance records locked with an audit entry.`)}
  async function advanceMonth(){if(businessHeadId==='all'){flash('Select one business head before reviewing the month.');return;}const action=!monthSummary?'summarize':monthSummary.status==='open'?'review':monthSummary.status==='review'?'lock':'reopen';const reason=window.prompt(`Reason to ${action} this attendance month:`,`Monthly attendance ${action}`);if(!reason)return;const response=await fetch('/api/attendance/months',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({businessHeadId,periodMonth:`${day.slice(0,7)}-01`,action,reason})});const body=await response.json().catch(()=>null);if(!response.ok){flash(body?.error?.message||'Monthly attendance could not be updated.');return;}setMonthSummary(body.data);setRefresh(value=>value+1);flash(`Monthly attendance is now ${body.data.status}.`)}
  return <><PageHead eyebrow="Attendance" title="Daily attendance" text={`${head} · Mark who is present, absent or on leave. Salary is worked out from this.`} action="Mark attendance" onAction={() => {setMarkFor('');setMarking(true)}} />
    <div className="metrics compact"><Metric label="PRESENT" value={String(present)} note={rows.length?`${Math.round(present/rows.length*100)}% of ${rows.length} staff`:'No staff in view'} icon="✓" tone="green" /><Metric label="ABSENT" value={String(absent)} note="Marked absent" icon="×" tone="red" /><Metric label="ON LEAVE" value={String(leave)} note="Paid and unpaid" icon="◷" tone="blue" /><Metric label="NOT MARKED YET" value={String(notMarked)} note={notMarked?'Still to be marked':'Everyone is marked'} icon="!" tone="orange" /></div>
    <section className="panel table-panel"><div className="table-tools attendance-tools"><div><input type="date" value={day} onChange={e => setDay(e.target.value)} aria-label="Attendance date"/><em className={`status ${monthSummary?.status||'open'}`}>This month: {monthSummary?.status||'still open'}{monthSummary?` · ${monthSummary.exception_count} to check`:''}</em></div><div><button className="secondary" title="Bring in punches from the attendance machine" onClick={() => flash("Punches from the attendance machine are brought in automatically once it is connected.")}>⇧ Import from machine</button><button className="secondary" onClick={advanceMonth} title="Work through the month: prepare, check, then finalise for salary">{!monthSummary?'Prepare month summary':monthSummary.status==='open'?'Send month for checking':monthSummary.status==='review'?'Finalise month for salary':'Reopen month'}</button><button className="primary" title="No further changes can be made to this day" onClick={lockDay}>Lock this day</button></div></div>
      <div className="data-table attendance-table"><div className="tr th"><span>NAME</span><span>IN</span><span>OUT</span><span>HOURS</span><span>STATUS</span><span></span></div>{rows.map(a => <div className="tr" key={a.id}><span><b>{nice(a.name)}<small>{a.sub}</small></b></span><span>{a.in}</span><span>{a.out}</span><span>{a.hours}</span><span><em className={`status ${a.status.toLowerCase().replaceAll(' ','-')}`}>{a.status==='Missing'?'Not marked':a.status}</em></span><span><button className="link" disabled={a.locked} onClick={() => {if(a.locked){flash('This day is locked.');return;}setMarkFor(a.employeeId||'');setMarking(true)}}>{a.locked?'Locked':'Mark'}</button></span></div>)}</div>
      <div className="table-foot"><span>{rows.length} staff</span></div>
    </section>{marking&&<AttendanceForm people={people} date={day} defaultEmployee={markFor} onClose={()=>setMarking(false)} onSaved={()=>{setMarking(false);setRefresh(value=>value+1);flash('Attendance saved.')}}/>}</>;
}

function EmployeeForm({heads,selectedHead,onClose,onCreated}:{heads:BusinessHead[];selectedHead:string;onClose:()=>void;onCreated:()=>void}){const[headId,setHeadId]=useState(selectedHead==='all'?(heads[0]?.id||''):selectedHead);const[departments,setDepartments]=useState<{id:string;name:string}[]>([]);const[error,setError]=useState('');const[busy,setBusy]=useState(false);useEffect(()=>{if(!headId)return;fetch(`/api/departments?businessHeadId=${headId}`).then(r=>r.ok?r.json():({data:[]})).then(body=>setDepartments(body.data))},[headId]);async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);const response=await fetch('/api/employees',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employeeCode:form.get('employeeCode'),businessHeadId:headId,departmentId:form.get('departmentId')||null,firstName:form.get('firstName'),lastName:form.get('lastName')||undefined,position:form.get('position'),dateJoined:form.get('dateJoined'),workEmail:form.get('workEmail')||undefined,employmentType:form.get('employmentType')})});const body=await response.json().catch(()=>null);if(!response.ok){setError(body?.error?.message||'This staff member could not be added. Please check the details.');setBusy(false);return;}onCreated()}return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-employee-title"><div className="modal-head"><div><span className="eyebrow">Staff</span><h2 id="add-employee-title">Add a staff member</h2></div><button onClick={onClose} aria-label="Close">×</button></div><form onSubmit={submit} className="form-grid"><label>Company<select value={headId} onChange={e=>setHeadId(e.target.value)} required>{heads.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Staff code<input name="employeeCode" required placeholder="For example 053"/></label><label>First name<input name="firstName" required/></label><label>Last name<input name="lastName"/></label><label>Job title<input name="position" required placeholder="For example Worker, Chemist"/></label><label>Department<select name="departmentId"><option value="">Choose a department…</option>{departments.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Date joined<input name="dateJoined" type="date" required min="1970-01-01" max={new Date(Date.now()+31*86400000).toISOString().slice(0,10)} title="Must be a real date — not in the far past or future"/></label><label>Employment type<select name="employmentType" defaultValue="permanent"><option value="permanent">Permanent</option><option value="contract">Contract</option><option value="consultant">Consultant</option><option value="intern">Intern</option></select></label><label className="span-two">Work email<input name="workEmail" type="email"/></label>{error&&<div className="form-error span-two">{error}</div>}<div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy||!headId}>{busy?'Adding…':'Add staff member'}</button></div></form></section></div>}

function AttendanceForm({people,date,defaultEmployee='',onClose,onSaved}:{people:Person[];date:string;defaultEmployee?:string;onClose:()=>void;onSaved:()=>void}){const[error,setError]=useState('');const[busy,setBusy]=useState(false);async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);const form=new FormData(event.currentTarget);const worked=Number(form.get('workedHours')||0)*60;const response=await fetch('/api/attendance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employeeId:form.get('employeeId'),attendanceDate:date,status:form.get('status'),workedMinutes:worked,overtimeMinutes:Number(form.get('overtimeMinutes')||0),remarks:form.get('remarks')||undefined})});const body=await response.json().catch(()=>null);if(!response.ok){setError(body?.error?.message||'Attendance could not be saved');setBusy(false);return;}onSaved()}return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true"><div className="modal-head"><div><span className="eyebrow">Attendance for {date}</span><h2>Mark attendance</h2></div><button onClick={onClose}>×</button></div><form onSubmit={submit} className="form-grid"><label className="span-two">Staff member<select name="employeeId" required defaultValue={defaultEmployee||undefined}>{people.map(person=><option value={person.id} key={person.id}>{nice(person.name)} · {person.code}</option>)}</select></label><label>Status<select name="status" defaultValue="present"><option value="present">Present</option><option value="absent">Absent</option><option value="half_day">Half day</option><option value="paid_leave">Paid leave</option><option value="unpaid_leave">Unpaid leave</option><option value="weekly_off">Weekly off</option><option value="holiday">Holiday</option><option value="work_from_home">Work from home</option><option value="on_duty">On duty</option></select></label><label>Hours worked<input name="workedHours" type="number" min="0" max="24" step="0.25" defaultValue="8"/></label><label>Extra time (minutes)<input name="overtimeMinutes" type="number" min="0" max="1440" defaultValue="0"/></label><label>Note (optional)<input name="remarks"/></label>{error&&<div className="form-error span-two">{error}</div>}<div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy||!people.length}>{busy?'Saving…':'Save attendance'}</button></div></form></section></div>}
