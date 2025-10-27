// Importa Firebase do portal
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
} from "../firebaseConfig.js"; // ajuste caminho se necessário

import { ref, uploadBytes, getDownloadURL, deleteObject } 
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

// ===== Config local =====
const ADMIN_MATS = ["6266", "4144", "70029"];
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const el = (id) => document.getElementById(id);
const qsel = (sel) => document.querySelectorAll(sel);

let CURRENT_USER = null;
let CURRENT_USER_DATA = null;
let IS_ADMIN = false;

// ===== Helpers =====
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
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}`;
}

// ===== DASHBOARD =====
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Você precisa estar logado no portal para acessar o dashboard.");
    location.href = "/"; // volta para portal
    return;
  }

  CURRENT_USER = user;
  const us = await getDoc(doc(db, "usuarios", user.uid));
  CURRENT_USER_DATA = us.exists() ? us.data() : { matricula: (user.email||"").split("@")[0], nome:"" };
  IS_ADMIN = ADMIN_MATS.includes(CURRENT_USER_DATA.matricula);

  // Roles UI
  qsel(".admin-only").forEach(b => b.hidden = !IS_ADMIN);
  qsel(".user-only").forEach(b => b.hidden = IS_ADMIN);

  // binds
  el("btnLogout")?.addEventListener("click", async () => { await signOut(auth); location.href="/"; });
  el("btnAlterarSenha")?.addEventListener("click", async () => {
    const nova = prompt("Nova senha:");
    if (!nova) return;
    try { await updatePassword(auth.currentUser, nova); alert("Senha alterada."); }
    catch(e){ alert("Erro: "+e.message); }
  });

  el("btnResumoRecebedor")?.addEventListener("click", () => el("resumoWrap").classList.toggle("collapsed"));
  el("btnToggleResumo")?.addEventListener("click", () => el("resumoWrap").classList.toggle("collapsed"));
  el("mesResumo").value = getCurrentMonthValue();
  el("btnCarregarResumo")?.addEventListener("click", carregarResumoAdmin);

  ["valorFolha","valorDinheiro"].forEach(id=>{
    const i = el(id); i && i.addEventListener("input", ()=>{
      const vf = parseFloat(el("valorFolha").value||0);
      const vd = parseFloat(el("valorDinheiro").value||0);
      el("sobraFalta").value = BRL.format(vd-vf);
    });
  });

  el("btnSalvarRelatorio")?.addEventListener("click", salvarRelatorioAdmin);

  el("btnAplicarFiltroMatricula")?.addEventListener("click", filtrarPorMatricula);
  el("btnFiltrarPorData")?.addEventListener("click", filtrarPorData);

  await popularMatriculasSelects();
  await carregarListaPadrao();
});

// ===== Preencher selects (admin) =====
async function popularMatriculasSelects() {
  if(!IS_ADMIN) return;
  const snap = await getDocs(collection(db,"usuarios"));
  const users = snap.docs.map(d=>d.data()).sort((a,b)=>(a.matricula||"").localeCompare(b.matricula||""));
  const options = users.map(u=>`<option value="${u.matricula}">${u.matricula} — ${u.nome||""}</option>`).join("");
  el("matriculaForm") && (el("matriculaForm").innerHTML = options);
  el("filtroMatricula") && (el("filtroMatricula").innerHTML = '<option value="">Selecione...</option>'+options);
  el("selectMatriculas") && (el("selectMatriculas").innerHTML = options);
}

// ===== Salvar Relatório =====
async function salvarRelatorioAdmin() {
  if(!IS_ADMIN){ alert("Apenas admins podem criar relatórios."); return; }
  const matricula = el("matriculaForm").value;
  const data = parseDateInput(el("dataCaixa").value);
  const vf = parseFloat(el("valorFolha").value||0);
  const vd = parseFloat(el("valorDinheiro").value||0);
  const obs = el("observacao").value||"";
  if(!matricula || !data){ alert("Preencha matrícula e data."); return; }
  try{
    const sobra = vd-vf;
    await addDoc(collection(db,"relatorios"),{
      matricula, dataCaixa: Timestamp.fromDate(data),
      valorFolha: vf, valorDinheiro: vd, sobraFalta: sobra,
      observacao: obs, posTexto:"", posEditado:false, imagemPath:"",
      criadoEm: Timestamp.now(), createdBy: CURRENT_USER.uid
    });
    alert("Relatório salvo.");
    ["dataCaixa","valorFolha","valorDinheiro","observacao","sobraFalta"].forEach(id=>el(id).value="");
    await carregarListaPadrao();
  }catch(e){ alert("Erro: "+e.message); }
}

// ===== Carregar Lista =====
async function carregarListaPadrao() {
  let qy;
  if(IS_ADMIN){
    qy = query(collection(db,"relatorios"), orderBy("dataCaixa","desc"));
  }else{
    qy = query(collection(db,"relatorios"), where("matricula","==",CURRENT_USER_DATA.matricula),
      orderBy("dataCaixa","desc"), limit(31));
  }
  const snap = await getDocs(qy);
  renderLista(snap.docs.map(d=>({id:d.id, ...d.data()})));
}

// ===== Filtros =====
async function filtrarPorMatricula(){
  if(!IS_ADMIN) return;
  const mat = el("filtroMatricula").value;
  if(!mat){ alert("Selecione uma matrícula."); return; }
  const qy = query(collection(db,"relatorios"), where("matricula","==",mat),
    orderBy("dataCaixa","desc"), limit(31));
  const snap = await getDocs(qy);
  renderLista(snap.docs.map(d=>({id:d.id, ...d.data()})));
  el("selectMatriculas").value = mat;
}

async function filtrarPorData(){
  const val = el("filtroDataGlobal").value;
  if(!val){ alert("Escolha uma data."); return; }
  const d = parseDateInput(val);
  const start = new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,0,0,0);
  const end = new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59,999);
  let qy = query(collection(db,"relatorios"),
    where("dataCaixa",">=",Timestamp.fromDate(start)),
    where("dataCaixa","<=",Timestamp.fromDate(end)),
    orderBy("dataCaixa","desc"));
  const snap = await getDocs(qy);
  let docs = snap.docs.map(d=>({id:d.id,...d.data()}));
  if(!IS_ADMIN) docs = docs.filter(r=>r.matricula===CURRENT_USER_DATA.matricula);
  renderLista(docs);
}

// ===== Render Lista =====
function renderLista(rows){
  const lista = el("listaRelatorios"); lista.innerHTML="";
  rows.forEach(r=>{
    const wrap = document.createElement("div");
    wrap.className="item";
    const hasPos = r.posTexto && r.posTexto.trim().length>0;
    const warn = hasPos ? '<span class="badge warn">⚠️ verificar pós conferência</span>':"";
    wrap.innerHTML = `
      <div class="item-header">
        <div class="item-title">${formatDateBR(r.dataCaixa)} — Matrícula ${r.matricula} ${warn}</div>
        <div class="controls">
          <button class="btn outline btnToggle">Esconder/Exibir</button>
          <button class="btn outline btnPos">Pós Conferência</button>
          ${IS_ADMIN ? '<button class="btn outline btnEdit">Editar</button>':""}
          ${IS_ADMIN ? '<button class="btn danger btnDelete">Excluir</button>':""}
        </div>
      </div>
      <div class="item-body collapsed">
        <div class="field"><div>Data do Caixa</div><div>${formatDateBR(r.dataCaixa)}</div></div>
        <div class="field"><div>Valor Folha</div><div class="money">${BRL.format(r.valorFolha||0)}</div></div>
        <div class="field"><div>Valor Dinheiro</div><div class="money">${BRL.format(r.valorDinheiro||0)}</div></div>
        <div class="field"><div>Sobra/Falta</div><div class="money">${BRL.format((r.valorDinheiro||0)-(r.valorFolha||0))}</div></div>
        <div class="field"><div>Observação</div><div>${(r.observacao||"").replace(/[<>&]/g,'')}</div></div>
      </div>
    `;
    const body = wrap.querySelector(".item-body");
    wrap.querySelector(".btnToggle").addEventListener("click",()=>body.classList.toggle("collapsed"));
    // Pós Conferência e edição podem ser adicionados aqui
    lista.appendChild(wrap);
  });
}
