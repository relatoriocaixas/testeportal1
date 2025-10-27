import {
  auth, db, onAuthStateChanged, signOut,
  getDocs, addDoc, updateDoc, deleteDoc, getDoc,
  collection, query, where, orderBy, limit, Timestamp
} from "../firebaseConfig.js";

const ADMIN_MATS = ["6266", "6414", "70029", "4144"];
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const el = (id) => document.getElementById(id);
const qsel = (sel) => document.querySelectorAll(sel);

let CURRENT_USER = null;
let CURRENT_USER_DATA = null;
let IS_ADMIN = false;

// ===== Receber dados do portal via postMessage =====
window.addEventListener("message", (event) => {
  if(event.data?.type === "syncAuth"){
    const usuario = event.data.usuario;
    CURRENT_USER_DATA = { matricula: usuario.matricula, nome: usuario.nome };
    IS_ADMIN = ADMIN_MATS.includes(usuario.matricula);

    // Atualiza visibilidade
    qsel(".admin-only").forEach(e => e.hidden = !IS_ADMIN);
    qsel(".user-only").forEach(e => e.hidden = IS_ADMIN);

    carregarListaPadrao();
    popularMatriculasSelects();
  }
});

// ===== Botoes logout e alterar senha =====
el("btnLogout")?.addEventListener("click", async () => {
  await signOut(auth);
  window.parent.location.href = '../login.html';
});

el("btnAlterarSenha")?.addEventListener("click", async () => {
  const nova = prompt("Nova senha:");
  if(!nova) return;
  try { await auth.currentUser.updatePassword(nova); alert("Senha alterada."); }
  catch(e){ alert("Erro: " + e.message); }
});

// ===== Helpers =====
function formatDateBR(ts){
  const d = ts instanceof Date ? ts : ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('pt-BR');
}
function parseDateInput(val){
  if(!val) return null;
  const [y,m,d] = val.split('-').map(Number);
  return new Date(y,m-1,d);
}

// ===== Carregar selects de matrícula =====
async function popularMatriculasSelects(){
  const snap = await getDocs(collection(db,"usuarios"));
  const users = snap.docs.map(d => d.data()).sort((a,b)=> (a.matricula||"").localeCompare(b.matricula||""));
  const options = users.map(u => `<option value="${u.matricula}">${u.matricula} — ${u.nome||""}</option>`).join("");
  if(el("matriculaForm")) el("matriculaForm").innerHTML = options;
  if(el("filtroMatricula")) el("filtroMatricula").innerHTML = '<option value="">Selecione...</option>' + options;
  if(el("selectMatriculas")) el("selectMatriculas").innerHTML = options;
}

// ===== Salvar relatório (apenas admin) =====
el("btnSalvarRelatorio")?.addEventListener("click", async ()=>{
  if(!IS_ADMIN){ alert("Apenas admins podem criar."); return; }

  const matricula = el("matriculaForm").value;
  const data = parseDateInput(el("dataCaixa").value);
  const vf = parseFloat(el("valorFolha").value||0);
  const vd = parseFloat(el("valorDinheiro").value||0);
  const obs = el("observacao").value||"";

  if(!matricula||!data){ alert("Preencha matrícula e data"); return; }

  try{
    const sobra = vd-vf;
    await addDoc(collection(db,"relatorios"),{
      matricula, dataCaixa: Timestamp.fromDate(data),
      valorFolha: vf, valorDinheiro: vd, sobraFalta: sobra,
      observacao: obs, posTexto:"", posEditado:false,
      imagemPath:"", criadoEm: Timestamp.now(),
      createdBy: CURRENT_USER_DATA.matricula
    });
    alert("Relatório salvo");
    ["dataCaixa","valorFolha","valorDinheiro","observacao","sobraFalta"].forEach(id=>el(id).value="");
    carregarListaPadrao();
  }catch(e){ alert("Erro ao salvar: "+e.message); }
});

// ===== Carregar lista =====
async function carregarListaPadrao(){
  let qy;
  if(IS_ADMIN){
    qy = query(collection(db,"relatorios"), orderBy("dataCaixa","desc"));
  } else {
    qy = query(collection(db,"relatorios"),
      where("matricula","==",CURRENT_USER_DATA.matricula),
      orderBy("dataCaixa","desc"), limit(31));
  }
  const snap = await getDocs(qy);
  renderLista(snap.docs.map(d=>({id:d.id,...d.data()})));
}

// ===== Renderização =====
function renderLista(rows){
  const lista = el("listaRelatorios");
  lista.innerHTML="";
  rows.forEach(r=>{
    const wrap = document.createElement("div");
    wrap.className="item";
    const hasPos = r.posTexto && r.posTexto.trim().length>0;
    const warn = hasPos ? '<span class="badge warn">⚠️ pós conferência</span>' : "";
    wrap.innerHTML=`
      <div class="item-header">
        <div class="item-title">${formatDateBR(r.dataCaixa)} — Matrícula ${r.matricula} ${warn}</div>
        <div class="controls">
          <button class="btn outline btnToggle">Esconder/Exibir</button>
          <button class="btn outline btnPos">Pós Conferência</button>
          ${IS_ADMIN?'<button class="btn outline btnEdit">Editar</button>':""}
          ${IS_ADMIN?'<button class="btn danger btnDelete">Excluir</button>':""}
        </div>
      </div>
      <div class="item-body collapsed">
        <div class="field"><div>Data do Caixa</div><div>${formatDateBR(r.dataCaixa)}</div></div>
        <div class="field"><div>Valor Folha</div><div>${BRL.format(r.valorFolha||0)}</div></div>
        <div class="field"><div>Valor Dinheiro</div><div>${BRL.format(r.valorDinheiro||0)}</div></div>
        <div class="field"><div>Sobra/Falta</div><div>${BRL.format((r.valorDinheiro||0)-(r.valorFolha||0))}</div></div>
        <div class="field"><div>Observação</div><div>${(r.observacao||"").replace(/[<>&]/g,"")}</div></div>
      </div>
    `;
    wrap.querySelector(".btnToggle").addEventListener("click",()=>wrap.querySelector(".item-body").classList.toggle("collapsed"));
    if(IS_ADMIN){
      wrap.querySelector(".btnEdit").addEventListener("click",()=>editRelatorio(r));
      wrap.querySelector(".btnDelete").addEventListener("click",()=>deleteRelatorio(r));
    }
    lista.appendChild(wrap);
  });
}

// ===== Editar / Excluir =====
async function editRelatorio(r){
  el("matriculaForm").value=r.matricula;
  el("dataCaixa").value=r.dataCaixa.toDate ? r.dataCaixa.toDate().toISOString().split('T')[0] : r.dataCaixa;
  el("valorFolha").value=r.valorFolha||0;
  el("valorDinheiro").value=r.valorDinheiro||0;
  el("observacao").value=r.observacao||"";
}

async function deleteRelatorio(r){
  if(confirm("Deseja realmente excluir este relatório?")){
    await deleteDoc(doc(db,"relatorios",r.id));
    carregarListaPadrao();
  }
}

// ===== Sobra/Falta automático =====
["valorFolha","valorDinheiro"].forEach(id=>{
  const i = el(id);
  i && i.addEventListener("input", ()=>{
    const vf = parseFloat(el("valorFolha").value||0);
    const vd = parseFloat(el("valorDinheiro").value||0);
    el("sobraFalta").value=BRL.format(vd-vf);
  });
});

// ===== Filtros =====
el("btnAplicarFiltroMatricula")?.addEventListener("click", async ()=>{
  if(!IS_ADMIN) return;
  const mat = el("filtroMatricula").value;
  if(!mat){ alert("Selecione uma matrícula"); return; }
  const snap = await getDocs(query(collection(db,"relatorios"), where("matricula","==",mat), orderBy("dataCaixa","desc"), limit(31)));
  renderLista(snap.docs.map(d=>({id:d.id,...d.data()})));
  el("selectMatriculas").value=mat;
});

el("btnFiltrarPorData")?.addEventListener("click", async ()=>{
  const val = el("filtroDataGlobal").value;
  if(!val){ alert("Escolha uma data"); return; }
  const d = parseDateInput(val);
  const start = new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,0,0,0);
  const end = new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59,999);
  let qy = query(collection(db,"relatorios"), where("dataCaixa",">=",Timestamp.fromDate(start)), where("dataCaixa","<=",Timestamp.fromDate(end)), orderBy("dataCaixa","desc"));
  const snap = await getDocs(qy);
  let docs = snap.docs.map(d=>({id:d.id,...d.data()}));
  if(!IS_ADMIN) docs = docs.filter(r=>r.matricula===CURRENT_USER_DATA.matricula);
  renderLista(docs);
});

// ===== Resumo =====
el("btnCarregarResumo")?.addEventListener("click", async ()=>{
  if(!IS_ADMIN) return;
  const mat = el("selectMatriculas").value;
  const [y,m] = (el("mesResumo").value||new Date().toISOString().slice(0,7)).split("-").map(Number);
  const start = new Date(y,m-1,1,0,0,0,0);
  const end = new Date(y,m,0,23,59,59,999);
  const snap = await getDocs(query(collection(db,"relatorios"), where("matricula","==",mat), where("dataCaixa",">=",Timestamp.fromDate(start)), where("dataCaixa","<=",Timestamp.fromDate(end)), orderBy("dataCaixa","desc")));
  const rows = snap.docs.map(d=>({id:d.id,...d.data()}));
  const totalFolha = rows.reduce((acc,r)=>acc+(r.valorFolha||0),0);
  const saldo = rows.reduce((acc,r)=>acc+((r.valorDinheiro||0)-(r.valorFolha||0)),0);
  el("resumoTotalFolha").textContent=BRL.format(totalFolha);
  el("resumoSaldo").textContent=BRL.format(saldo);
  el("resumoSituacao").textContent=saldo>=0?"POSITIVO":"NEGATIVO";

  const tipo = el("filtroPositivosNegativos").value;
  const filtrados = rows.filter(r=>{
    const sf = (r.valorDinheiro||0)-(r.valorFolha||0);
    if(tipo==="positivos") return sf>0;
    if(tipo==="negativos") return sf<0;
    return true;
  });
  const cont = el("resumoLista");
  cont.innerHTML="";
  filtrados.forEach(r=>{
    const sf = (r.valorDinheiro||0)-(r.valorFolha||0);
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML=`<div class="item-header">
      <div class="item-title">${formatDateBR(r.dataCaixa)} — Matrícula ${r.matricula}</div>
      <span class="badge">${BRL.format(r.valorFolha||0)} | ${BRL.format(r.valorDinheiro||0)} | <strong>${BRL.format(sf)}</strong></span>
    </div>`;
    cont.appendChild(div);
  });
});
