import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
const app=express(), server=http.createServer(app), wss=new WebSocketServer({server});
app.use(express.json()); app.use(express.static("public"));
const defaultPromo="Outros presentes garantem mais votos!";
const defaultSecondary="Apoie seu candidato e ajude a virar o placar!";
let state={connected:true,username:"votação manual",running:false,finished:false,round:1,roundDurationSeconds:600,startedAt:null,endsAt:null,lula:0,flavio:0,history:[],promoMessage:defaultPromo,secondaryMessage:defaultSecondary,message:"Pronto para iniciar a votação manual."};
function pub(){const remaining=state.running&&state.endsAt?Math.max(0,Math.ceil((state.endsAt-Date.now())/1000)):0;return {...state,remaining,winner:state.finished?(state.lula===state.flavio?"draw":state.lula>state.flavio?"lula":"flavio"):null};}
function broadcast(){const m=JSON.stringify({type:"state",state:pub()});wss.clients.forEach(c=>{if(c.readyState===WebSocket.OPEN)c.send(m);});}
function finish(){if(!state.running)return;state.running=false;state.finished=true;const result=state.lula===state.flavio?"Empate":state.lula>state.flavio?"Lula venceu":"Flávio venceu";state.history.push({round:state.round,lula:state.lula,flavio:state.flavio,result,endedAt:new Date().toISOString()});state.message=result+"!";broadcast();}
setInterval(()=>{if(state.running&&Date.now()>=state.endsAt)finish();else if(state.running)broadcast();},1000);
wss.on("connection",c=>c.send(JSON.stringify({type:"state",state:pub()})));
app.get("/api/state",(_,r)=>r.json(pub()));
app.post("/api/start",(_,r)=>{if(state.running)return r.status(400).json({error:"O turno já está em andamento."});state.lula=0;state.flavio=0;state.finished=false;state.running=true;state.startedAt=Date.now();state.endsAt=state.startedAt+600000;state.message="Turno "+state.round+" em andamento!";broadcast();r.json({ok:true,state:pub()});});
app.post("/api/vote",(q,r)=>{if(!state.running)return r.status(400).json({error:"Inicie a votação antes de registrar votos."});const c=String(q.body.candidate||"").toLowerCase(),n=Number(q.body.amount);if(!["lula","flavio"].includes(c))return r.status(400).json({error:"Escolha Lula ou Flávio."});if(!Number.isSafeInteger(n)||n<1||n>1000000)return r.status(400).json({error:"Digite um número inteiro entre 1 e 1.000.000."});state[c]+=n;state.message=n+" voto(s) registrado(s).";broadcast();r.json({ok:true,state:pub()});});
app.post("/api/message",(q,r)=>{state.promoMessage=String(q.body.promoMessage||"").trim().slice(0,100)||defaultPromo;state.secondaryMessage=String(q.body.secondaryMessage||"").trim().slice(0,120)||defaultSecondary;state.message="Mensagens atualizadas.";broadcast();r.json({ok:true,state:pub()});});
app.post("/api/end",(_,r)=>{finish();r.json({ok:true,state:pub()});});
app.post("/api/next",(_,r)=>{if(!state.finished)return r.status(400).json({error:"Finalize o turno atual primeiro."});state.round++;state.lula=0;state.flavio=0;state.finished=false;state.running=false;state.startedAt=null;state.endsAt=null;state.message="Pronto para o turno "+state.round+".";broadcast();r.json({ok:true,state:pub()});});
app.post("/api/reset",(_,r)=>{state.round=1;state.lula=0;state.flavio=0;state.running=false;state.finished=false;state.startedAt=null;state.endsAt=null;state.history=[];state.message="Contagem reiniciada.";broadcast();r.json({ok:true,state:pub()});});
server.listen(process.env.PORT||3000,()=>console.log("Painel manual iniciado"));
