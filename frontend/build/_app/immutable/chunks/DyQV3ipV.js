import{a}from"./DEKCsKgs.js";const i={login:(o,t)=>a.post("/api/auth/login",{email:o,password:t}),logout:()=>a.post("/api/auth/logout"),me:()=>a.get("/api/auth/me")};export{i as a};
