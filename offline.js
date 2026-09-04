const DB_NAME = "varma-offline-v1";
const DB_VERSION = 1;
const COLLECTIONS = ["products", "sales"];
let db;

function openDb(){
return new Promise((resolve, reject) => {
const request = indexedDB.open(DB_NAME, DB_VERSION);
request.onupgradeneeded = () => {
const database = request.result;
COLLECTIONS.forEach(name => {
if(!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: "id" });
});
};
request.onsuccess = () => resolve(request.result);
request.onerror = () => reject(request.error);
});
}

function store(name, mode = "readonly"){
return db.transaction(name, mode).objectStore(name);
}
function all(name){
return new Promise((resolve, reject) => {
const request = store(name).getAll();
request.onsuccess = () => resolve(request.result || []);
request.onerror = () => reject(request.error);
});
}
function put(name, value){
return new Promise((resolve, reject) => {
const request = store(name, "readwrite").put(value);
request.onsuccess = () => resolve();
request.onerror = () => reject(request.error);
});
}
function remove(name, id){
return new Promise((resolve, reject) => {
const request = store(name, "readwrite").delete(id);
request.onsuccess = () => resolve();
request.onerror = () => reject(request.error);
});
}
function id(){ return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function now(){ return new Date().toISOString(); }
function clean(value){ return String(value || "").trim(); }
function status(message, error = false){
const element = document.querySelector("#status");
if(element) element.textContent = message;
if(element) element.style.color = error ? "#ffb4a9" : "#f0cc79";
}

async function render(){
const products = (await all("products")).filter(row => !row.deleted).sort((a,b) => a.name.localeCompare(b.name));
const sales = (await all("sales")).filter(row => !row.deleted).sort((a,b) => String(b.dateISO).localeCompare(String(a.dateISO)));
const productRows = document.querySelector("#productRows");
productRows.innerHTML = products.map(product => `<tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.size)}</td><td>${product.qty}</td><td><button data-delete="${product.id}" type="button">Delete</button></td></tr>`).join("") || `<tr><td colspan="4">No products stored yet.</td></tr>`;
const select = document.querySelector("#saleProduct");
select.innerHTML = `<option value="">Choose product</option>${products.map(product => `<option value="${product.id}">${escapeHtml(product.name)} (${escapeHtml(product.size)}) - ${product.qty}</option>`).join("")}`;
document.querySelector("#saleRows").innerHTML = sales.map(sale => {
const item = sale.items?.[0] || {};
return `<tr><td>${escapeHtml(sale.date || sale.dateISO || "")}</td><td>${escapeHtml(sale.customer)}</td><td>${escapeHtml(item.dev || "")}</td><td>${item.qty || 0}</td><td>${Number(sale.total || 0).toFixed(2)}</td></tr>`;
}).join("") || `<tr><td colspan="5">No sales stored yet.</td></tr>`;
const stock = products.reduce((sum, product) => sum + (Number(product.qty) || 0), 0);
document.querySelector("#summaryText").textContent = `${products.length} products | ${stock} total stock | ${sales.length} sales`;
}

function escapeHtml(value){
return String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[character]));
}

async function saveProduct(event){
event.preventDefault();
const name = clean(document.querySelector("#productName").value);
const size = clean(document.querySelector("#productSize").value);
const qty = Number(document.querySelector("#productQty").value);
if(!name || !size || !Number.isFinite(qty) || qty < 0){ status("Enter a valid product, size, and quantity.", true); return; }
const products = await all("products");
const existing = products.find(product => !product.deleted && product.name.toLowerCase() === name.toLowerCase() && product.size.toLowerCase() === size.toLowerCase());
await put("products", { id: existing?.id || id(), name, size, qty, updatedAt: now(), dirty: true });
event.target.reset();
status("Saved offline. Press Sync now when internet is available.");
await render();
}

async function saveSale(event){
event.preventDefault();
const customer = clean(document.querySelector("#customer").value);
const productId = document.querySelector("#saleProduct").value;
const qty = Number(document.querySelector("#saleQty").value);
const rate = Number(document.querySelector("#saleRate").value);
const products = await all("products");
const product = products.find(row => row.id === productId && !row.deleted);
if(!customer || !product || !Number.isFinite(qty) || qty <= 0 || qty > Number(product.qty) || !Number.isFinite(rate) || rate < 0){ status("Check customer, product, quantity, stock, and rate.", true); return; }
const date = new Date();
product.qty = Number(product.qty) - qty;
product.updatedAt = now();
product.dirty = true;
await put("products", product);
await put("sales", { id: id(), customer, date: date.toLocaleDateString("en-GB"), dateISO: date.toISOString().slice(0,10), total: qty * rate, items: [{ dev: `${product.name} (${product.size})`, qty, rate, total: qty * rate }], updatedAt: now(), dirty: true });
event.target.reset();
status("Sale saved offline and stock reduced locally.");
await render();
}

async function deleteProduct(event){
const productId = event.target.dataset.delete;
if(!productId) return;
const products = await all("products");
const product = products.find(row => row.id === productId);
if(!product) return;
product.deleted = true;
product.updatedAt = now();
product.dirty = true;
await put("products", product);
status("Product marked for deletion. Sync to apply it online.");
await render();
}

async function firebase(){
const appModule = await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js");
const authModule = await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js");
const firestore = await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js");
const app = appModule.initializeApp({ apiKey: "AIzaSyDKoULVGoUMuLtl5Pk79Q6VV95NAFDbKPE", authDomain: "varma-jewelerys.firebaseapp.com", projectId: "varma-jewelerys" }, "offline-sync");
const auth = authModule.getAuth(app);
await authModule.signInAnonymously(auth);
return { db: firestore.getFirestore(app), ...firestore };
}

async function sync(){
const button = document.querySelector("#syncButton");
button.disabled = true;
status("Connecting to Firebase...");
try{
const remote = await firebase();
for(const name of COLLECTIONS){
const localRows = await all(name);
for(const row of localRows){
if(!row.dirty) continue;
const { id: recordId, dirty, ...data } = row;
await remote.setDoc(remote.doc(remote.db, name, recordId), { ...data, offlineId: recordId });
await put(name, { ...row, dirty: false });
}
const snapshot = await remote.getDocs(remote.collection(remote.db, name));
for(const document of snapshot.docs){
const data = document.data();
const recordId = data.offlineId || document.id;
const localRowsNow = await all(name);
const local = localRowsNow.find(row => row.id === recordId);
const remoteTime = Date.parse(data.updatedAt || "") || 0;
const localTime = Date.parse(local?.updatedAt || "") || 0;
if(!local?.dirty && (!local || remoteTime >= localTime)) await put(name, { ...data, id: recordId, dirty: false });
}
}
await render();
status("Sync complete.");
} catch(error){
console.error(error);
status(error.message.includes("permission") ? "Firebase denied access. Check Firestore rules and authentication." : "Sync unavailable. Your offline data is safe.", true);
} finally { button.disabled = false; }
}

async function start(){
try{
db = await openDb();
document.querySelector("#productForm").addEventListener("submit", saveProduct);
document.querySelector("#saleForm").addEventListener("submit", saveSale);
document.querySelector("#productRows").addEventListener("click", deleteProduct);
document.querySelector("#syncButton").addEventListener("click", sync);
window.addEventListener("online", sync);
document.querySelector("#connection").textContent = navigator.onLine ? "Online" : "Offline mode";
window.addEventListener("online", () => { document.querySelector("#connection").textContent = "Online"; });
window.addEventListener("offline", () => { document.querySelector("#connection").textContent = "Offline mode"; });
await render();
status("Ready. Data is stored on this device.");
} catch(error){ status("This browser cannot open local storage.", true); console.error(error); }
}
start();
