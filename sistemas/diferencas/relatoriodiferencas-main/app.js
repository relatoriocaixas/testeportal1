import {
  auth,
  db,
  storage,
  onAuthStateChanged,
  signOut,
  updatePassword,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  Timestamp
} from "./relatoriodiferencas-main/firebaseConfig.js";

import { ref, uploadBytes, getDownloadURL, deleteObject } 
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const ADMIN_MATS = ["6266", "6414", "70029", "4144"];
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const el = (id) => document.getElementById(id);
const qsel = (sel) => document.querySelectorAll(sel);

let CURRENT_USER = null;
let CURRENT_USER_DATA = null;
let IS_ADMIN = false;

function formatDateBR(ts) {
  const d = ts instanceof Date ? ts : ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('pt-BR');
}
function parseDateInput(value) {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function getMonthRange(year, monthIdx) {
  const start = new Date(year, monthIdx, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);
  return { start, end };
}
function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ===== DASHBOARD =====
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "../login.html";
    return;
  }

  CURRENT_USER = user;
  const us = await getDoc(doc(db, "usuarios", user.uid));
  if (us.exists()) {
    CURRENT_USER_DATA = us.data();
  } else {
    CURRENT_USER_DATA = { matricula: (user.email || "").split("@")[0], nome: "" };
  }

  IS_ADMIN = ADMIN_MATS.includes(CURRENT_USER_DATA.matricula);

  el("formRelatorio").style.display = IS_ADMIN ? "block" : "none";
  el("resumoWrap").style.display = IS_ADMIN ? "block" : "none";

  await popularMatriculasSelects();
  await carregarListaPadrao();

  // Sobra/Falta
  ["valorFolha","valorDinheiro"].forEach(id=>{
    const i = el(id);
    i && i.addEventListener("input",()=>{
      const vf = parseFloat(el("valorFolha").value||0);
      const vd = parseFloat(el("valorDinheiro").value||0);
      el("sobraFalta").value = BRL.format(vd-vf);
    });
  });

  el("btnSalvarRelatorio")?.addEventListener("click", salvarRelatorioAdmin);
  el("btnAplicarFiltroMatricula")?.addEventListener("click", filtrarPorMatricula);
  el("btnFiltrarPorData")?.addEventListener("click", filtrarPorData);
  el("btnCarregarResumo")?.addEventListener("click", carregarResumoAdmin);

  el("btnLogout")?.addEventListener("click", async ()=>{
    await signOut(auth);
    location.href="../login.html";
  });

  el("btnAlterarSenha")?.addEventListener("click", async ()=>{
    const nova = prompt("Nova senha:");
    if(!nova) return;
    try{ await updatePassword(auth.currentUser, nova); alert("Senha alterada."); }
    catch(e){ alert("Erro: "+e.message); }
  });
});

// ===== Preencher selects =====
async function popularMatriculasSelects(){
  const snap = await getDocs(collection(db,"usuarios"));
  const users = snap.docs.map(d=>d.data()).sort((a,b)=> (a.matricula||"").localeCompare(b.matricula||""));
  const options = users.map(u=>`<option value="${u.matricula}">${u.matricula} — ${u.nome||""}</option>`).join("");
  ["matriculaForm","filtroMatricula","selectMatriculas"].forEach(id=>{
    const sel=el(id); if(sel) sel.innerHTML = id==="filtroMatricula" ? '<option value="">Selecione...</option>'+options : options;
  });
}

// ===== Salvar Relatório =====
async function salvarRelatorioAdmin(){
  if(!IS_ADMIN){ alert("Apenas administradores podem criar relatórios."); return; }
  const matricula = el("matriculaForm").value;
  const data = parseDateInput(el("dataCaixa").value);
  const vf = parseFloat(el("valorFolha").value||0);
  const vd = parseFloat(el("valorDinheiro").value||0);
  const obs = el("observacao").value||"";
  if(!matricula||!data){ alert("Preencha matrícula e data."); return; }
  try{
    const sobra = vd - vf;
    await addDoc(collection(db,"relatorios"),{
      matricula, dataCaixa: Timestamp.fromDate(data),
      valorFolha:vf, valorDinheiro:vd, sobraFalta:sobra,
      observacao:obs, posTexto:"", posEditado:false,
      imagemPath:"", criadoEm:Timestamp.now(),
      createdBy:CURRENT_USER.uid
    });
    alert("Relatório salvo.");
    ["dataCaixa","valorFolha","valorDinheiro","observacao","sobraFalta"].forEach(id=>el(id).value="");
    await carregarListaPadrao();
  } catch(e){ alert("Erro ao salvar: "+e.message); }
}

// ===== Listagem =====
async function carregarListaPadrao(){
  let qy;
  if(IS_ADMIN) qy=query(collection(db,"relatorios"),orderBy("dataCaixa","desc"));
  else qy=query(collection(db,"relatorios"),where("matricula","==",CURRENT_USER_DATA.matricula),orderBy("dataCaixa","desc"),limit(31));
  const snap = await getDocs(qy);
  renderLista(snap.docs.map(d=>({id:d.id,...d.data()})));
}

// ===== Filtros =====
async function filtrarPorMatricula(){
  if(!IS_ADMIN) return;
  const mat = el("filtroMatricula").value;
  if(!mat){ alert("Selecione uma matrícula."); return; }
  const qy=query(collection(db,"relatorios"),where("matricula","==",mat),orderBy("dataCaixa","desc"),limit(31));
  const snap = await getDocs(qy);
  renderLista(snap.docs.map(d=>({id:d.id,...d.data()})));
  el("selectMatriculas").value=mat;
}

async function filtrarPorData(){
  const val = el("filtroDataGlobal").value;
  if(!val){ alert("Escolha uma data."); return; }
  const d=parseDateInput(val);
  const start=new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,0,0,0);
  const end=new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59,999);
  const qy=query(collection(db,"relatorios"),where("dataCaixa",">=",Timestamp.fromDate(start)),where("dataCaixa","<=",Timestamp.fromDate(end)),orderBy("dataCaixa","desc"));
  const snap = await getDocs(qy);
  let docs = snap.docs.map(d=>({id:d.id,...d.data()}));
  if(!IS_ADMIN) docs=docs.filter(r=>r.matricula===CURRENT_USER_DATA.matricula);
  renderLista(docs);
}

// ===== Resumo =====
async function carregarResumoAdmin(){
  if(!IS_ADMIN) return;
  const mat=el("selectMatriculas").value;
  const [y,m] = (el("mesResumo").value||getCurrentMonthValue()).split("-").map(Number);
  const {start,end}=getMonthRange(y,m-1);
  const qy=query(collection(db,"relatorios"),where("matricula","==",mat),where("dataCaixa",">=",Timestamp.fromDate(start)),where("dataCaixa","<=",Timestamp.fromDate(end)),orderBy("dataCaixa","desc"));
  const snap=await getDocs(qy);
  const rows = snap.docs.map(d=>({id:d.id,...d.data()}));
  const totalFolha = rows.reduce((acc,r)=>acc+(r.valorFolha||0),0);
  const saldo = rows.reduce((acc,r)=>acc+((r.valorDinheiro||0)-(r.valorFolha||0)),0);
  el("resumoTotalFolha").textContent=BRL.format(totalFolha);
  el("resumoSaldo").textContent=BRL.format(saldo);
  el("resumoSituacao").textContent=saldo>=0?"POSITIVO":"NEGATIVO";

  const tipo=el("filtroPositivosNegativos").value;
  const filtrados = rows.filter(r=>{
    const sf=(r.valorDinheiro||0)-(r.valorFolha||0);
    if(tipo==="positivos") return sf>0;
    if(tipo==="negativos") return sf<0;
    return true;
  });
  const cont=el("resumoLista"); cont.innerHTML="";
  filtrados.forEach(r=>{
    const sf=(r.valorDinheiro||0)-(r.valorFolha||0);
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`<div class="item-header"><div class="item-title">${formatDateBR(r.dataCaixa)} — Matrícula ${r.matricula}</div><span class="badge">${BRL.format(r.valorFolha||0)} | ${BRL.format(r.valorDinheiro||0)} | <strong>${BRL.format(sf)}</strong></span></div>`;
    cont.appendChild(div);
  });
}

// ===== Render Lista =====
function renderLista(rows){
  const lista=el("listaRelatorios"); lista.innerHTML="";
  rows.forEach(r=>{
    const wrap=document.createElement("div");
    wrap.className="item";
    const hasPos=r.posTexto && r.posTexto.trim().length>0;
    const warn=hasPos?'<span class="badge warn">⚠️ verificar pós conferência</span>':"";
    wrap.innerHTML=`<div class="item-header"><div class="item-title">${formatDateBR(r.dataCaixa)} — Matrícula ${r.matricula} ${warn}</div><div class="controls"><button class="btn outline btnToggle">Esconder/Exibir</button><button class="btn outline btnPos">Pós Conferência</button>${IS_ADMIN?'<button class="btn outline btnEdit">Editar</button>':""}${IS_ADMIN?'<button class="btn danger btnDelete">Excluir</button>':""}</div></div><div class="item-body collapsed"><div class="field"><div>Data do Caixa</div><div>${formatDateBR(r.dataCaixa)}</div></div><div class="field"><div>Valor Folha</div><div class="money">${BRL.format(r.valorFolha||0)}</div></div><div class="field"><div>Valor Dinheiro</div><div class="money">${BRL.format(r.valorDinheiro||0)}</div></div><div class="field"><div>Sobra/Falta</div><div class="money">${BRL.format((r.valorDinheiro||0)-(r.valorFolha||0))}</div></div><div class="field"><div>Observação</div><div>${(r.observacao||"").replace(/[<>&]/g,"")}</div></div></div>`;

    const body=wrap.querySelector(".item-body");
    wrap.querySelector(".btnToggle").addEventListener("click",()=>body.classList.toggle("collapsed"));
    wrap.querySelector(".btnPos").addEventListener("click",()=>alert("Pós conferência"));
    if(IS_ADMIN){
      wrap.querySelector(".btnEdit").addEventListener("click",()=>alert("Editar relatório"));
      wrap.querySelector(".btnDelete").addEventListener("click",()=>alert("Excluir relatório"));
    }
    lista.appendChild(wrap);
  });
}
