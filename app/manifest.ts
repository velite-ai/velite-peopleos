import type { MetadataRoute } from "next";

export default function manifest():MetadataRoute.Manifest{return{name:'Velite PeopleOS',short_name:'PeopleOS',description:'Velite employee lifecycle, attendance, payroll and performance workspace',start_url:'/',display:'standalone',background_color:'#f6f7f5',theme_color:'#17231d',orientation:'any',icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]};}
