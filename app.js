import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
getFirestore,
collection,
getDocs as fbGetDocs,
getDoc as fbGetDoc,
addDoc as fbAddDoc,
updateDoc as fbUpdateDoc,
increment,
doc,
deleteDoc as fbDeleteDoc,
query,
where
}
from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const firebaseConfig = {
apiKey: "AIzaSyDKoULVGoUMuLtl5Pk79Q6VV95NAFDbKPE",
authDomain: "varma-jewelerys.firebaseapp.com",
projectId: "varma-jewelerys"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let billItems = [];
let quickRows = [];
let stockQuickRows = [];
let productSizeMap = new Map();
let lastFinalizedBill = null;
const AUTH_KEY = "varma_auth_users_v1";
const DEFAULT_USERNAME = "v";
const DEFAULT_PASSWORD = "v";
const LOW_STOCK_LIMIT = 50;
const UNDO_TIMEOUT_MS = 15000;
const REPORT_PAGE_SIZE = 20;
const ONE_TIME_SALES_RESET_KEY = "sales_reset_20260315_manual";
const ONE_TIME_PRODUCTS_SEED_KEY = "products_seed_20260315_master_v2";
const ONE_TIME_PRODUCTS_DEDUPE_KEY = "products_dedupe_20260316_v1";
const DEFAULT_SIZES = ["2gm", "3gm", "5gm Small", "5gm Big", "10gm", "3D DEV", "Sada Small", "Sada Large"];
const DEFAULT_PRODUCT_MASTER = [
"KHANDOBA",
"BHAIROBA",
"AAI",
"VADIL",
"TULZAPUR",
"DAITYAVARCHI",
"RENUKA",
"MAHUTA",
"SRAPTSUNGI",
"MUNJOBA",
"VEER",
"JANAI",
"LAXMI",
"SATIAASARA UBHI",
"SATIAASARA AADVI",
"PALANGAVARCHI",
"VAGHAVARCHI",
"AAI-VADIL",
"JYOTIBA",
"GANPATI",
"MARUTI",
"SHIVAJI",
"KALUBAI",
"UNNAPURNA"
];
let lastDeletedProduct = null;
let lastDeletedSale = null;
let undoHideTimer = null;
let reportRowsCache = [];
let reportColumnsCount = 0;
let reportCurrentPage = 1;
let reportEmptyMessage = "No report data found.";
let reportDebounceTimer = null;
let startupWarmupStarted = false;
let firestoreQuotaBlocked = false;
let stockBatchInFlight = false;
const READ_CACHE_TTL_MS = 30000;
const collectionReadCache = new Map();

const EMPTY_QUERY_SNAPSHOT = Object.freeze({
empty: true,
size: 0,
docs: [],
forEach(){ }
});

const EMPTY_DOC_SNAPSHOT = Object.freeze({
id: "",
exists(){ return false; },
data(){ return {}; }
});

function isQuotaExceededError(error){
const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
return text.includes("quota") ||
text.includes("resource-exhausted") ||
text.includes("resource exhausted") ||
text.includes("too many requests") ||
text.includes("429");
}

function notifyFirestoreError(error){
console.error(error);
if(!isQuotaExceededError(error)) return;
firestoreQuotaBlocked = true;
showStatus("Firebase quota exceeded. Sync paused. Quota reset hone ke baad data normal chalega.", "error");
}

async function getDocs(ref){
if(firestoreQuotaBlocked) return EMPTY_QUERY_SNAPSHOT;
try{
return await fbGetDocs(ref);
} catch(error){
notifyFirestoreError(error);
if(isQuotaExceededError(error)) return EMPTY_QUERY_SNAPSHOT;
throw error;
}
}

async function getDoc(ref){
if(firestoreQuotaBlocked) return EMPTY_DOC_SNAPSHOT;
try{
return await fbGetDoc(ref);
} catch(error){
notifyFirestoreError(error);
if(isQuotaExceededError(error)) return EMPTY_DOC_SNAPSHOT;
throw error;
}
}

function throwQuotaBlockedWriteError(){
const err = new Error("Firebase quota exceeded");
err.code = "resource-exhausted";
throw err;
}

async function addDoc(ref, data){
if(firestoreQuotaBlocked){
showStatus("Write blocked: Firebase quota exceeded.", "error");
throwQuotaBlockedWriteError();
}
try{
const created = await fbAddDoc(ref, data);
invalidateCollectionCache(readCollectionNameFromCollectionRef(ref));
return created;
} catch(error){
notifyFirestoreError(error);
throw error;
}
}

async function updateDoc(ref, data){
if(firestoreQuotaBlocked){
showStatus("Write blocked: Firebase quota exceeded.", "error");
throwQuotaBlockedWriteError();
}
try{
const updated = await fbUpdateDoc(ref, data);
invalidateCollectionCache(readCollectionNameFromDocRef(ref));
return updated;
} catch(error){
notifyFirestoreError(error);
throw error;
}
}

async function deleteDoc(ref){
if(firestoreQuotaBlocked){
showStatus("Write blocked: Firebase quota exceeded.", "error");
throwQuotaBlockedWriteError();
}
try{
const removed = await fbDeleteDoc(ref);
invalidateCollectionCache(readCollectionNameFromDocRef(ref));
return removed;
} catch(error){
notifyFirestoreError(error);
throw error;
}
}

function invalidateCollectionCache(collectionName){
if(!collectionName) return;
collectionReadCache.delete(collectionName);
}

function readCollectionNameFromDocRef(ref){
return ref?.parent?.id || "";
}

function readCollectionNameFromCollectionRef(ref){
return ref?.id || "";
}

async function fetchCollectionRows(collectionName, force = false){
const key = String(collectionName || "").trim();
if(!key) return [];
const now = Date.now();
const cached = collectionReadCache.get(key);
if(!force && cached && (now - cached.fetchedAt) < READ_CACHE_TTL_MS){
return cached.rows;
}

const snap = await getDocs(collection(db, key));
const rows = [];
snap.forEach(d => {
rows.push({ id: d.id, data: d.data() });
});
collectionReadCache.set(key, { fetchedAt: now, rows });
return rows;
}

function getEl(id){ return document.getElementById(id); }
function setValue(id, value){ const el = getEl(id); if(el) el.value = value; }
function setText(id, value){ const el = getEl(id); if(el) el.innerText = value; }

function showStatus(message, type = "success"){
const el = getEl("statusMessage");
if(!el) return;
el.className = `status-message ${type}`;
el.innerText = message;
}

function clearStatus(){
const el = getEl("statusMessage");
if(!el) return;
el.className = "status-message";
el.innerText = "";
}

async function safeUiLoad(task){
try{
await task();
} catch(error){
if(isQuotaExceededError(error)){
showStatus("Firebase quota exceeded. Please wait for quota reset.", "error");
return;
}
console.error(error);
showStatus("Data load failed. Check network/Firestore rules.", "error");
}
}

function hideUndoBar(){
const bar = getEl("undoBar");
if(bar) bar.style.display = "none";
}

function clearUndoState(){
lastDeletedProduct = null;
lastDeletedSale = null;
if(undoHideTimer){
clearTimeout(undoHideTimer);
undoHideTimer = null;
}
hideUndoBar();
}

function showUndoBarForDelete(payload){
const bar = getEl("undoBar");
const text = getEl("undoText");
if(!bar || !text) return;

if(undoHideTimer){
clearTimeout(undoHideTimer);
undoHideTimer = null;
}

if(payload?.type === "sale"){
const customer = payload?.customer || "Customer";
text.innerText = `Sale for ${customer} deleted. Undo?`;
} else {
const name = payload?.name || "Product";
const size = payload?.size || "-";
text.innerText = `${name} (${size}) deleted. Undo?`;
}
bar.style.display = "flex";

undoHideTimer = setTimeout(() => {
clearUndoState();
}, UNDO_TIMEOUT_MS);
}

async function loadCustomerSuggestions(){
const list = getEl("customerSuggestions");
if(!list) return;

const rows = await fetchCollectionRows("sales");
const customerSet = new Set();
list.innerHTML = "";

rows.forEach(row => {
const data = row.data || {};
const name = (data.customer || "").trim();
if(name) customerSet.add(name);
});

Array.from(customerSet)
.sort((a, b) => a.localeCompare(b))
.forEach(name => {
const opt = document.createElement("option");
opt.value = name;
list.appendChild(opt);
});
}

function getUsers(){
try{
const raw = localStorage.getItem(AUTH_KEY);
const parsed = raw ? JSON.parse(raw) : {};
if(typeof parsed === "object" && parsed) return parsed;
return {};
} catch { return {}; }
}

function saveUsers(users){ localStorage.setItem(AUTH_KEY, JSON.stringify(users)); }

function resolveUserKey(users, username){
const typed = String(username || "").trim();
if(!typed) return "";
if(Object.prototype.hasOwnProperty.call(users, typed)) return typed;
const typedLower = typed.toLowerCase();
for(const key of Object.keys(users)){
if(String(key).toLowerCase() === typedLower) return key;
}
return "";
}

function setAuthMessage(message, isError = true){
const el = getEl("authMessage");
if(!el) return;
el.style.color = isError ? "#bb2f2f" : "#1d7a36";
el.innerText = message;
}

function showAppShell(){
const authPage = getEl("authPage");
const appShell = getEl("appShell");
if(authPage) authPage.style.display = "none";
if(appShell) appShell.style.display = "block";
}

function showAuthPage(){
const authPage = getEl("authPage");
const appShell = getEl("appShell");
if(appShell) appShell.style.display = "none";
if(authPage) authPage.style.display = "flex";
setValue("loginUser", "");
setValue("loginPass", "");
}

window.loginUser = function(){
const username = (getEl("loginUser")?.value || "").trim();
const password = (getEl("loginPass")?.value || "").trim();
if(!username || !password){ setAuthMessage("Please enter user and password."); return; }
const users = getUsers();
const matchedUserKey = resolveUserKey(users, username);
const isSavedUserValid = !!matchedUserKey && users[matchedUserKey] === password;
const isDefaultValid = username.toLowerCase() === DEFAULT_USERNAME.toLowerCase() &&
password.toLowerCase() === DEFAULT_PASSWORD.toLowerCase();
if(!isSavedUserValid && !isDefaultValid){ setAuthMessage("Invalid credentials."); return; }
const loginAs = isSavedUserValid ? matchedUserKey : DEFAULT_USERNAME;
localStorage.setItem("varma_logged_in_user", loginAs);
showAppShell();
show("dashboard");
setAuthMessage("", false);
runStartupWarmup();
};

window.logoutUser = function(){
localStorage.removeItem("varma_logged_in_user");
showAuthPage();
setValue("loginUser", "");
setValue("loginPass", "");
setAuthMessage("Logged out successfully.", false);
};

window.show = function(id){
document.querySelectorAll(".section").forEach(s => s.style.display = "none");
const section = getEl(id);
if(section) section.style.display = "block";

clearStatus();
if(id === "products") void safeUiLoad(() => loadProducts(true));
if(id === "sales") void safeUiLoad(loadProductOptions);
if(id === "stock"){
void safeUiLoad(() => loadStock(true));
void safeUiLoad(loadStockBatchOptions);
}
if(id === "report") void safeUiLoad(loadSales);
if(id === "dashboard"){
void safeUiLoad(updateDashboard);
void safeUiLoad(loadLowStock);
}
};

window.addProduct = async function(){
try{
const name = (getEl("prodName")?.value || "").trim();
const size = (getEl("prodSize")?.value || "").trim();
const qty = Number(getEl("prodQty")?.value || 0);

if(!name || !size){ showStatus("Enter product name and size.", "error"); return; }
if(!Number.isFinite(qty) || qty <= 0){ showStatus("Enter quantity greater than 0.", "error"); return; }

const allProducts = await fetchCollectionRows("products");
const existing = allProducts.find(row => {
const rowName = String(row.data?.name || "").trim().toLowerCase();
const rowSize = String(row.data?.size || "").trim().toLowerCase();
return rowName === name.toLowerCase() && rowSize === size.toLowerCase();
});

if(existing){
await updateDoc(doc(db, "products", existing.id), { name, size, qty: increment(qty) });
} else {
await addDoc(collection(db, "products"), { name, size, qty });
}

setValue("prodName", "");
setValue("prodSize", "");
setValue("prodQty", "");
await loadProducts();
await loadProductOptions();
await loadStockBatchOptions();
await updateDashboard();
await loadLowStock();
showStatus("Product saved successfully.");
} catch(error){
if(isQuotaExceededError(error)){
showStatus("Add Product blocked: Firebase quota exceeded.", "error");
return;
}
console.error(error);
showStatus("Add Product failed.", "error");
}
};

async function tryAddToBill(customer, productName, size, qty, rate, options = {}){
const silent = Boolean(options.silent);
const fail = (message) => {
if(!silent) showStatus(message, "error");
return { ok: false, reason: message };
};
if(!customer) return fail("Enter customer name.");

const safeProductName = (productName || "").trim();
const safeSize = (size || "").trim();
const safeQty = Number(qty || 0);
const safeRate = Number(rate || 0);

if(!safeProductName || !safeSize || safeQty <= 0 || safeRate <= 0){
return fail("Select product, size and enter valid qty and rate.");
}

let productDoc = null;
const allProducts = await fetchCollectionRows("products");
const wantedName = safeProductName.toLowerCase();
const wantedSize = safeSize.toLowerCase();

const matchingByName = allProducts.filter(p => String(p.data?.name || "").trim().toLowerCase() === wantedName);
if(matchingByName.length === 0){
return fail("Selected product not found in stock.");
}

const matched = matchingByName.find(p => String(p.data?.size || "").trim().toLowerCase() === wantedSize) || null;
if(!matched){
const availableSizes = Array.from(new Set(matchingByName.map(p => String(p.data?.size || "").trim()).filter(Boolean)));
const sizesText = availableSizes.length > 0 ? ` Available: ${availableSizes.join(", ")}` : "";
return fail(`Selected size not available for ${safeProductName}.${sizesText}`);
}

productDoc = {
id: matched.id,
data: () => matched.data || {}
};

const alreadyInBill = billItems
.filter(i => i.productId === productDoc.id)
.reduce((s, i) => s + Number(i.qty || 0), 0);
const available = Number(productDoc.data().qty) || 0;
if((alreadyInBill + safeQty) > available){
return fail(`Only ${available} in stock for ${safeProductName} (${safeSize}).`);
}

const total = safeQty * safeRate;
billItems.push({
customer,
product: safeProductName,
size: safeSize,
dev: `${safeProductName} (${safeSize})`,
productId: productDoc.id,
qty: safeQty,
rate: safeRate,
total
});
return { ok: true };
}

window.addItem = async function(){
await addQuickRowsToBill();
};

function renderSalesRowsTable(){
const table = getEl("quickRowsTable");
if(!table) return;
table.innerHTML = "";

let billTotal = 0;
billItems.forEach((item, index) => {
const lineTotal = (Number(item.qty || 0) * Number(item.rate || 0));
item.total = lineTotal;
billTotal += lineTotal;
table.innerHTML += `
<tr>
<td>${item.product || item.dev || ""}</td>
<td>${item.size || "-"}</td>
<td>${item.qty}</td>
<td>${item.rate}</td>
<td>${lineTotal}</td>
<td><button onclick="deleteItem(${index})">X</button></td>
</tr>`;
});

let previewTotal = 0;
quickRows.forEach((row, index) => {
const commonSize = (getEl("quickCommonSize")?.value || "").trim();
const commonRate = Number(getEl("quickCommonRate")?.value || 0);
const displaySize = row.size || commonSize || "";
const displayRate = Number(row.rate || commonRate || 0);
const lineTotal = (Number(row.qty) || 0) * displayRate;
previewTotal += lineTotal;
table.innerHTML += `
<tr>
<td>${row.product}</td>
<td>${displaySize || "-"}</td>
<td><input type="number" value="${row.qty || 0}" min="0" onchange="updateQuickRow(${index}, 'qty', this.value)"></td>
<td><input type="number" value="${displayRate || 0}" min="0" onchange="updateQuickRow(${index}, 'rate', this.value)"></td>
<td>${lineTotal}</td>
<td><button onclick="deleteQuickRow(${index})">X</button></td>
</tr>`;
});

setText("billGrandTotal", billItems.length > 0 ? billTotal : previewTotal);
}

function renderBill(){
renderSalesRowsTable();
}

function cloneBillItems(items){
return (items || []).map(item => ({
customer: item.customer || "",
product: item.product || "",
size: item.size || "",
dev: item.dev || "",
productId: item.productId || "",
qty: Number(item.qty) || 0,
rate: Number(item.rate) || 0,
total: Number(item.total) || ((Number(item.qty) || 0) * (Number(item.rate) || 0))
}));
}

function getBillSourceForOutput(){
if(billItems.length > 0){
const customer = (getEl("customer")?.value || billItems[0]?.customer || "").trim() || "Walk-in";
const items = cloneBillItems(billItems);
const total = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
return {
customer,
date: new Date().toLocaleDateString("en-GB"),
items,
total
};
}
if(quickRows.length > 0){
const customer = (getEl("customer")?.value || "").trim() || "Walk-in";
const commonSize = (getEl("quickCommonSize")?.value || "").trim();
const commonRate = Number(getEl("quickCommonRate")?.value || 0);
const items = quickRows
.map(row => {
const size = (row.size || commonSize || "").trim();
const rate = Number(row.rate || ((commonRate > 0) ? commonRate : 0));
const qty = Number(row.qty || 0);
if(!size || qty <= 0 || rate <= 0) return null;
return {
customer,
product: row.product || "",
size,
dev: `${row.product || ""} (${size})`,
productId: "",
qty,
rate,
total: qty * rate
};
})
.filter(Boolean);
if(items.length > 0){
const total = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
return {
customer,
date: new Date().toLocaleDateString("en-GB"),
items,
total
};
}
}
if(lastFinalizedBill && Array.isArray(lastFinalizedBill.items) && lastFinalizedBill.items.length > 0){
return {
customer: lastFinalizedBill.customer || "Walk-in",
date: lastFinalizedBill.date || new Date().toLocaleDateString("en-GB"),
items: cloneBillItems(lastFinalizedBill.items),
total: Number(lastFinalizedBill.total) || 0
};
}
return null;
}

window.deleteItem = function(index){ billItems.splice(index, 1); renderSalesRowsTable(); };

window.updateQuickRow = function(index, field, value){
if(!quickRows[index]) return;
quickRows[index][field] = (field === "qty" || field === "rate") ? Number(value || 0) : value;
renderSalesRowsTable();
};

window.deleteQuickRow = function(index){ quickRows.splice(index, 1); renderSalesRowsTable(); };

window.addQuickRowsToBill = async function(){
if(quickRows.length === 0){ showStatus("Add at least one row first.", "error"); return false; }
const customer = (getEl("customer")?.value || "").trim();
if(!customer){ showStatus("Enter customer name first.", "error"); return false; }
const commonSize = (getEl("quickCommonSize")?.value || "").trim();
if(!commonSize){ showStatus("Select common size first.", "error"); return false; }
const commonRate = Number(getEl("quickCommonRate")?.value || 0);
const commonQty = Number(getEl("quickCommonQty")?.value || 0);

quickRows = quickRows.map(row => ({
...row,
size: commonSize,
rate: (Number.isFinite(commonRate) && commonRate > 0) ? commonRate : Number(row.rate || 0),
qty: (Number.isFinite(commonQty) && commonQty > 0) ? commonQty : Number(row.qty || 0)
}));

if(quickRows.some(row => Number(row.qty || 0) <= 0)){
showStatus("Quantity fill karo: common qty dalo ya row-wise qty dalo.", "error");
renderQuickRows();
return false;
}
if(quickRows.some(row => Number(row.rate || 0) <= 0)){
showStatus("Rate fill karo: common rate dalo ya row-wise rate dalo.", "error");
renderQuickRows();
return false;
}

let addedCount = 0;
let failedCount = 0;
const failedReasons = [];
for(const row of quickRows){
const result = await tryAddToBill(
customer,
row.product,
row.size,
Number(row.qty),
Number(row.rate),
{ silent: true }
);
if(result.ok){
addedCount++;
} else {
failedCount++;
failedReasons.push(`${row.product}: ${result.reason}`);
}
}

if(addedCount === 0){
const reasonText = failedReasons.length ? ` ${failedReasons.slice(0, 2).join(" | ")}` : "";
showStatus(`Koi item bill me add nahi hua.${reasonText}`, "error");
return false;
}
quickRows = [];
Array.from(document.querySelectorAll("#productCheckboxList input[type='checkbox']")).forEach(chk => {
chk.checked = false;
});
renderQuickRows();
renderBill();
if(failedCount > 0){
const reasonText = failedReasons.length ? ` ${failedReasons.slice(0, 2).join(" | ")}` : "";
showStatus(`${addedCount} item add hue, ${failedCount} item add nahi hue.${reasonText}`, "error");
} else {
showStatus("All selected rows added to bill.");
}
return true;
};

function renderQuickRows(){
renderSalesRowsTable();
}

window.toggleProductCheckbox = function(productName, checked){
const commonSize = (getEl("quickCommonSize")?.value || "").trim();
const commonRate = Number(getEl("quickCommonRate")?.value || 0);
const commonQty = Number(getEl("quickCommonQty")?.value || 0);
if(!commonSize){
showStatus("Pehle common size select karo, phir product select karo.", "error");
const checks = Array.from(document.querySelectorAll("#productCheckboxList input[type='checkbox']"));
const target = checks.find(chk => chk.value === productName);
if(target) target.checked = false;
return;
}

if(checked){
const exists = quickRows.some(row => row.product === productName);
if(!exists) quickRows.push({ product: productName, size: commonSize, qty: (Number.isFinite(commonQty) && commonQty > 0) ? commonQty : 0, rate: (Number.isFinite(commonRate) && commonRate > 0) ? commonRate : 0 });
} else {
quickRows = quickRows.filter(row => row.product !== productName);
}
renderQuickRows();
};

window.applyCommonSizeToRows = function(){
const commonSize = (getEl("quickCommonSize")?.value || "").trim();
quickRows = quickRows.map(row => ({ ...row, size: commonSize }));
renderQuickRows();
};

window.applyCommonRateToRows = function(){
const commonRate = Number(getEl("quickCommonRate")?.value || 0);
quickRows = quickRows.map(row => ({ ...row, rate: commonRate }));
renderQuickRows();
};

window.applyCommonQtyToRows = function(){
const commonQty = Number(getEl("quickCommonQty")?.value || 0);
if(!Number.isFinite(commonQty) || commonQty < 0) return;
quickRows = quickRows.map(row => ({ ...row, qty: commonQty }));
renderQuickRows();
};

window.toggleStockProductCheckbox = function(productName, checked){
const commonSize = (getEl("stockCommonSize")?.value || "").trim();
const commonQty = Number(getEl("stockCommonQty")?.value || 0);
if(!commonSize){
showStatus("Pehle stock common size select karo.", "error");
const checks = Array.from(document.querySelectorAll("#stockProductCheckboxList input[type='checkbox']"));
const target = checks.find(chk => chk.value === productName);
if(target) target.checked = false;
return;
}

if(checked){
const exists = stockQuickRows.some(row => row.product === productName);
if(!exists){
stockQuickRows.push({
product: productName,
size: commonSize,
qty: (Number.isFinite(commonQty) && commonQty > 0) ? commonQty : 0
});
}
} else {
stockQuickRows = stockQuickRows.filter(row => row.product !== productName);
}
renderStockQuickRows();
};

window.applyStockCommonSizeToRows = function(){
const commonSize = (getEl("stockCommonSize")?.value || "").trim();
stockQuickRows = stockQuickRows.map(row => ({ ...row, size: commonSize }));
renderStockQuickRows();
};

window.applyStockCommonQtyToRows = function(){
const commonQty = Number(getEl("stockCommonQty")?.value || 0);
if(!Number.isFinite(commonQty) || commonQty < 0) return;
stockQuickRows = stockQuickRows.map(row => ({ ...row, qty: commonQty }));
renderStockQuickRows();
};

window.updateStockQuickQty = function(index, value){
if(!stockQuickRows[index]) return;
stockQuickRows[index].qty = Number(value || 0);
renderStockQuickRows();
};

window.deleteStockQuickRow = function(index){
const row = stockQuickRows[index];
stockQuickRows.splice(index, 1);
if(row){
const checks = Array.from(document.querySelectorAll("#stockProductCheckboxList input[type='checkbox']"));
const target = checks.find(chk => chk.value === row.product);
if(target) target.checked = false;
}
renderStockQuickRows();
};

function renderStockQuickRows(){
const table = getEl("stockQuickRowsTable");
if(!table) return;
table.innerHTML = "";
stockQuickRows.forEach((row, index) => {
table.innerHTML += `
<tr>
<td>${row.product}</td>
<td>${row.size || "-"}</td>
<td><input type="number" value="${row.qty || 0}" min="0" onchange="updateStockQuickQty(${index}, this.value)"></td>
<td><button onclick="deleteStockQuickRow(${index})">X</button></td>
</tr>`;
});
}

async function loadStockBatchOptions(){
const checklist = getEl("stockProductCheckboxList");
if(!checklist) return;
checklist.innerHTML = "";

const rows = await fetchCollectionRows("products");
const productNames = new Set();
rows.forEach(row => {
const data = row.data || {};
const name = (data.name || "").trim();
if(name) productNames.add(name);
});

Array.from(productNames).sort((a, b) => a.localeCompare(b)).forEach(name => {
checklist.innerHTML += `<label class="product-check-item"><input type="checkbox" value="${name}" onchange="toggleStockProductCheckbox(decodeURIComponent('${encodeURIComponent(name)}'), this.checked)"><span>${name}</span></label>`;
});
renderStockQuickRows();
}

window.addStockBatch = async function(){
if(stockBatchInFlight){
showStatus("Stock update already running. Please wait.", "error");
return;
}
stockBatchInFlight = true;
try{
if(stockQuickRows.length === 0){
showStatus("Stock ke liye products select karo.", "error");
return;
}
const commonSize = (getEl("stockCommonSize")?.value || "").trim();
if(!commonSize){
showStatus("Stock common size select karo.", "error");
return;
}
const commonQty = Number(getEl("stockCommonQty")?.value || 0);

stockQuickRows = stockQuickRows.map(row => ({
...row,
size: commonSize,
qty: (Number.isFinite(commonQty) && commonQty > 0) ? commonQty : Number(row.qty || 0)
}));

if(stockQuickRows.some(row => Number(row.qty || 0) <= 0)){
showStatus("Stock qty fill karo: common qty dalo ya row-wise qty dalo.", "error");
renderStockQuickRows();
return;
}

let updated = 0;
const keyOf = (name, size) => `${String(name || "").trim().toLowerCase()}__${String(size || "").trim().toLowerCase()}`;
const allProducts = await fetchCollectionRows("products");
const productIndex = new Map();
allProducts.forEach(row => {
const data = row.data || {};
productIndex.set(keyOf(data.name, data.size), row);
});

for(const row of stockQuickRows){
const key = keyOf(row.product, row.size);
const existing = productIndex.get(key);
if(!existing){
const created = await addDoc(collection(db, "products"), {
name: row.product,
size: row.size,
qty: Number(row.qty)
});
productIndex.set(key, {
id: created.id,
data: { name: row.product, size: row.size, qty: Number(row.qty) }
});
} else {
await updateDoc(doc(db, "products", existing.id), {
qty: increment(Number(row.qty))
});
}
updated++;
}

stockQuickRows = [];
Array.from(document.querySelectorAll("#stockProductCheckboxList input[type='checkbox']")).forEach(chk => {
chk.checked = false;
});
setValue("stockCommonQty", "");
renderStockQuickRows();
await loadStock();
await loadProducts();
await loadProductOptions();
await loadStockBatchOptions();
await updateDashboard();
await loadLowStock();
showStatus(`Stock updated for ${updated} products.`);
} catch(error){
if(isQuotaExceededError(error)){
showStatus("Add Stock blocked: Firebase quota exceeded.", "error");
return;
}
console.error(error);
showStatus("Add Stock failed.", "error");
} finally {
stockBatchInFlight = false;
}
};

window.generateBill = async function(){
if(billItems.length === 0 && quickRows.length > 0){
const added = await addQuickRowsToBill();
if(!added) return;
}
if(billItems.length === 0){ showStatus("Add at least one item before generating bill.", "error"); return; }
try{
const requiredByProduct = new Map();
for(const item of billItems){
requiredByProduct.set(item.productId, (requiredByProduct.get(item.productId) || 0) + Number(item.qty || 0));
}

const allProducts = await fetchCollectionRows("products");
const productById = new Map();
allProducts.forEach(row => {
productById.set(row.id, row.data || {});
});

for(const [productId, requiredQty] of requiredByProduct.entries()){
const productData = productById.get(productId);
if(!productData){ showStatus("Product not found in bill.", "error"); return; }
const available = Number(productData.qty) || 0;
if(requiredQty > available){ showStatus(`Not enough stock. Available ${available}, required ${requiredQty}.`, "error"); return; }
}

for(const item of billItems){
await updateDoc(doc(db, "products", item.productId), { qty: increment(-Number(item.qty || 0)) });
}

const billTotal = billItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
const saleNow = new Date();
const saleDateISO = saleNow.toISOString().slice(0, 10);
const currentBillSnapshot = {
customer: billItems[0]?.customer || (getEl("customer")?.value || "").trim() || "Walk-in",
date: saleNow.toLocaleDateString("en-GB"),
items: cloneBillItems(billItems),
total: billTotal
};
await addDoc(collection(db, "sales"), {
customer: billItems[0].customer || "",
date: saleNow.toLocaleDateString("en-GB"),
dateISO: saleDateISO,
total: billTotal,
items: billItems.map(item => ({ dev: item.dev, qty: item.qty, rate: item.rate, total: item.total }))
});
lastFinalizedBill = currentBillSnapshot;

billItems = [];
quickRows = [];
renderQuickRows();
renderBill();
setValue("quickCommonSize", "");
setValue("quickCommonRate", "");
setValue("quickCommonQty", "");
setValue("customer", "");
setValue("saleQty", "");
setValue("saleRate", "");
await loadSales();
await loadCustomerSuggestions();
await loadStock();
await updateDashboard();
await loadLowStock();
showStatus("Bill generated successfully.");
} catch(error){
console.error(error);
showStatus(`Failed to generate bill: ${error.message || "unknown error"}`, "error");
}
};

async function loadProductOptions(){
const checklist = getEl("productCheckboxList");
if(!checklist) return;
if(checklist) checklist.innerHTML = "";
productSizeMap = new Map();

const rows = await fetchCollectionRows("products");
rows.forEach(row => {
const data = row.data || {};
const name = (data.name || "").trim();
const size = (data.size || "").trim();
if(!name || !size) return;

if(!productSizeMap.has(name)){
productSizeMap.set(name, new Set());
}
productSizeMap.get(name).add(size);
});

Array.from(productSizeMap.keys()).sort((a, b) => a.localeCompare(b)).forEach(name => {
checklist.innerHTML += `<label class="product-check-item"><input type="checkbox" value="${name}" onchange="toggleProductCheckbox(decodeURIComponent('${encodeURIComponent(name)}'), this.checked)"><span>${name}</span></label>`;
});

const normalizedMap = new Map();
productSizeMap.forEach((sizeSet, name) => {
normalizedMap.set(name, Array.from(sizeSet));
});
productSizeMap = normalizedMap;
renderQuickRows();
}

window.loadProducts = async function(forceRefresh = false){
const table = getEl("productTable");
if(!table) return;
const rowsData = await fetchCollectionRows("products", forceRefresh);
table.innerHTML = "";

const sizeOrder = ["2gm", "3gm", "5gm Small", "5gm Big", "10gm", "3D DEV", "Sada Small", "Sada Large"];
const sizeRank = new Map(sizeOrder.map((size, index) => [size, index]));
const groupedBySize = new Map();

rowsData.forEach(row => {
const data = row.data || {};
const size = (data.size || "No Size").trim() || "No Size";
if(!groupedBySize.has(size)) groupedBySize.set(size, []);
groupedBySize.get(size).push({ id: row.id, data });
});

if(groupedBySize.size === 0){
table.innerHTML = `<tr><td colspan="4">No products found.</td></tr>`;
return;
}

const sortedSizes = Array.from(groupedBySize.keys()).sort((a, b) => {
const aRank = sizeRank.has(a) ? sizeRank.get(a) : 999;
const bRank = sizeRank.has(b) ? sizeRank.get(b) : 999;
if(aRank !== bRank) return aRank - bRank;
return a.localeCompare(b);
});

sortedSizes.forEach(size => {
const rows = groupedBySize.get(size) || [];
rows.sort((a, b) => {
const aName = (a.data.name || "").toString();
const bName = (b.data.name || "").toString();
return aName.localeCompare(bName);
});

table.innerHTML += `<tr class="size-group-row"><td colspan="4">${size} (${rows.length})</td></tr>`;
rows.forEach(row => {
const data = row.data;
table.innerHTML += `
<tr>
<td>${data.name || ""}</td>
<td>${data.size || ""}</td>
<td>${data.qty || 0}</td>
<td>
<button onclick="editProduct('${row.id}')">Edit</button>
<button onclick="deleteProduct('${row.id}')">Delete</button>
</td>
</tr>`;
});
});
};

window.editProduct = async function(id){
try{
const productRef = doc(db, "products", id);
const row = await getDoc(productRef);
if(!row.exists()){ showStatus("Product not found for editing.", "error"); return; }
const current = row.data() || {};
const nextName = prompt("Product Name", current.name || "");
if(nextName === null) return;
const nextSize = prompt("Size", current.size || "");
if(nextSize === null) return;
const nextQty = prompt("Quantity", String(current.qty ?? 0));
if(nextQty === null) return;

await updateDoc(productRef, { name: nextName.trim(), size: nextSize.trim(), qty: Number(nextQty) || 0 });
await loadProducts();
await loadProductOptions();
await loadStockBatchOptions();
await loadStock();
await updateDashboard();
await loadLowStock();
showStatus("Product updated.");
} catch(error){
if(isQuotaExceededError(error)){
showStatus("Edit blocked: Firebase quota exceeded.", "error");
return;
}
console.error(error);
showStatus("Product update failed.", "error");
}
};

window.loadStock = async function(forceRefresh = false){
const table = getEl("stockTable");
if(!table) return;
const search = (getEl("searchStock")?.value || "").toLowerCase();
const rowsData = await fetchCollectionRows("products", forceRefresh);
table.innerHTML = "";

const sizeOrder = ["2gm", "3gm", "5gm Small", "5gm Big", "10gm", "3D DEV", "Sada Small", "Sada Large"];
const sizeRank = new Map(sizeOrder.map((size, index) => [size, index]));
const groupedBySize = new Map();

rowsData.forEach(row => {
const data = row.data || {};
const label = `${data.name || ""} ${data.size || ""}`.toLowerCase();
if(search && !label.includes(search)) return;
const size = (data.size || "No Size").trim() || "No Size";
if(!groupedBySize.has(size)) groupedBySize.set(size, []);
groupedBySize.get(size).push({ id: row.id, data });
});

if(groupedBySize.size === 0){
table.innerHTML = `<tr><td colspan="4">No stock rows found.</td></tr>`;
return;
}

const sortedSizes = Array.from(groupedBySize.keys()).sort((a, b) => {
const aRank = sizeRank.has(a) ? sizeRank.get(a) : 999;
const bRank = sizeRank.has(b) ? sizeRank.get(b) : 999;
if(aRank !== bRank) return aRank - bRank;
return a.localeCompare(b);
});

sortedSizes.forEach(size => {
const rows = groupedBySize.get(size) || [];
rows.sort((a, b) => {
const aName = (a.data.name || "").toString();
const bName = (b.data.name || "").toString();
return aName.localeCompare(bName);
});

table.innerHTML += `<tr class="size-group-row"><td colspan="4">${size} (${rows.length})</td></tr>`;
rows.forEach(row => {
const data = row.data;
table.innerHTML += `
<tr>
<td>${data.name || ""}</td>
<td>${data.size || ""}</td>
<td><input type="number" id="stockQtyInput-${row.id}" value="${Number(data.qty) || 0}" min="0"></td>
<td>
<button type="button" onclick="saveStockQtyInline('${row.id}')">Save</button>
</td>
</tr>`;
});
});
};

window.saveStockQtyInline = async function(productId){
try{
const input = getEl(`stockQtyInput-${productId}`);
if(!input){ showStatus("Qty input not found.", "error"); return; }
const nextQty = Number(input.value);
if(!Number.isFinite(nextQty) || nextQty < 0){
showStatus("Enter a valid quantity (0 or more).", "error");
return;
}
await updateDoc(doc(db, "products", productId), { qty: nextQty });
await loadStock();
await loadProducts();
await updateDashboard();
await loadLowStock();
await loadStockBatchOptions();
showStatus("Stock quantity updated.");
} catch(error){
if(isQuotaExceededError(error)){
showStatus("Stock save blocked: Firebase quota exceeded.", "error");
return;
}
console.error(error);
showStatus("Stock quantity save failed.", "error");
}
};

function getSelectedReportType(){
const selected = document.querySelector("input[name='reportType']:checked");
return selected ? selected.value : "sales";
}

function toISODate(value){
if(!value) return "";
if(typeof value === "string"){
const raw = value.trim();
if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
const normalized = raw.replace(/[.\-]/g, "/");
const parts = normalized.split("/");
if(parts.length === 3 && parts[2].length === 4){
const day = String(Number(parts[0] || 0)).padStart(2, "0");
const month = String(Number(parts[1] || 0)).padStart(2, "0");
const year = parts[2];
if(Number(day) >= 1 && Number(day) <= 31 && Number(month) >= 1 && Number(month) <= 12){
return `${year}-${month}-${day}`;
}
}
}
const dt = new Date(value);
if(Number.isNaN(dt.getTime())) return "";
return dt.toISOString().slice(0, 10);
}

function formatDisplayDate(isoDate){
if(!isoDate || !isoDate.includes("-")) return "-";
const [y, m, d] = isoDate.split("-");
return `${d}/${m}/${y}`;
}

function formatInputDate(isoDate){
if(!isoDate || !isoDate.includes("-")) return "";
const [y, m, d] = isoDate.split("-");
return `${d}/${m}/${y}`;
}

window.formatDateInput = function(inputEl){
if(!inputEl) return;
const digits = String(inputEl.value || "").replace(/\D/g, "").slice(0, 8);
if(!digits){
inputEl.value = "";
return;
}
let next = digits.slice(0, 2);
if(digits.length > 2){
next += `/${digits.slice(2, 4)}`;
}
if(digits.length > 4){
next += `/${digits.slice(4, 8)}`;
}
inputEl.value = next;
};

window.normalizeDateInput = function(inputEl){
if(!inputEl) return;
window.formatDateInput(inputEl);
const raw = String(inputEl.value || "").trim();
if(!raw) return;
const iso = toISODate(raw);
if(iso){
inputEl.value = formatInputDate(iso);
}
};

function isDateInRange(isoDate, fromDate, toDate){
if(!isoDate) return false;
if(fromDate && isoDate < fromDate) return false;
if(toDate && isoDate > toDate) return false;
return true;
}

function parseDevLabel(devLabel){
const txt = String(devLabel || "").trim();
const match = txt.match(/^(.*)\((.*)\)$/);
if(match){
return {
product: (match[1] || "").trim(),
size: (match[2] || "").trim()
};
}
return { product: txt, size: "-" };
}

function getSilverWeightBySize(sizeLabel){
const txt = String(sizeLabel || "").trim().toLowerCase();
if(!txt) return 0;
if(txt.includes("10gm")) return 10;
if(txt.includes("5gm")) return 5;
if(txt.includes("3gm")) return 3;
if(txt.includes("2gm")) return 2;
return 0;
}

function calculateSilverUsageFromSales(sales){
let totalSilverGm = 0;
sales.forEach(sale => {
const items = Array.isArray(sale.data?.items) ? sale.data.items : [];
items.forEach(item => {
const parsed = parseDevLabel(item.dev);
const gramsPerPiece = getSilverWeightBySize(parsed.size);
if(gramsPerPiece <= 0) return;
const qty = Number(item.qty) || 0;
if(qty <= 0) return;
totalSilverGm += qty * gramsPerPiece;
});
});
return totalSilverGm;
}

function calculateSilverAvailableFromStock(productRows){
let totalSilverGm = 0;
(productRows || []).forEach(row => {
const data = row.data || {};
const gramsPerPiece = getSilverWeightBySize(data.size);
if(gramsPerPiece <= 0) return;
const qty = Number(data.qty) || 0;
if(qty <= 0) return;
totalSilverGm += qty * gramsPerPiece;
});
return totalSilverGm;
}

function setReportHead(columns){
const head = getEl("reportTableHead");
if(!head) return;
reportColumnsCount = columns.length || 1;
head.innerHTML = `<tr>${columns.map(col => `<th>${col}</th>`).join("")}</tr>`;
}

function setReportSummary({ bills = 0, qty = 0, amount = 0, lowStock = 0, silverUsed = 0, silverAvailable = 0 }){
const available = Number.isFinite(Number(silverAvailable)) ? Number(silverAvailable) : 0;
const used = Number.isFinite(Number(silverUsed)) ? Number(silverUsed) : 0;
const delta = available - used;
const balanceLabel = delta >= 0 ? `${delta.toFixed(2)} balance` : `${Math.abs(delta).toFixed(2)} need`;
setText("reportTotalBills", bills);
setText("reportTotalQty", qty);
setText("reportTotalAmount", amount);
setText("reportLowStockCount", lowStock);
setText("reportSilverUsed", used.toFixed(2));
setText("reportSilverBalance", balanceLabel);
}

function updateReportPaginationUi(){
const info = getEl("reportPageInfo");
const prevBtn = getEl("reportPrevBtn");
const nextBtn = getEl("reportNextBtn");
const totalPages = Math.max(1, Math.ceil(reportRowsCache.length / REPORT_PAGE_SIZE));
if(reportCurrentPage > totalPages) reportCurrentPage = totalPages;
if(reportCurrentPage < 1) reportCurrentPage = 1;
if(info) info.innerText = `Page ${reportCurrentPage} / ${totalPages}`;
if(prevBtn) prevBtn.disabled = reportCurrentPage <= 1;
if(nextBtn) nextBtn.disabled = reportCurrentPage >= totalPages;
}

function renderReportPage(){
const body = getEl("salesTable");
if(!body) return;
const totalRows = reportRowsCache.length;
if(totalRows === 0){
body.innerHTML = `<tr><td colspan="${reportColumnsCount || 1}">${reportEmptyMessage}</td></tr>`;
updateReportPaginationUi();
return;
}

const start = (reportCurrentPage - 1) * REPORT_PAGE_SIZE;
const end = start + REPORT_PAGE_SIZE;
body.innerHTML = reportRowsCache.slice(start, end).join("");
updateReportPaginationUi();
}

function setReportRows(rows, emptyMessage){
reportRowsCache = Array.isArray(rows) ? rows : [];
reportCurrentPage = 1;
reportEmptyMessage = emptyMessage || "No report data found.";
renderReportPage();
}

window.prevReportPage = function(){
if(reportCurrentPage <= 1) return;
reportCurrentPage -= 1;
renderReportPage();
};

window.nextReportPage = function(){
const totalPages = Math.max(1, Math.ceil(reportRowsCache.length / REPORT_PAGE_SIZE));
if(reportCurrentPage >= totalPages) return;
reportCurrentPage += 1;
renderReportPage();
};

function toggleReportCustomerField(){
const reportType = getSelectedReportType();
const labelEl = getEl("reportCustomerLabel");
const inputEl = getEl("reportCustomer");
if(!labelEl || !inputEl) return;
const show = reportType === "customer";
labelEl.style.display = show ? "block" : "none";
inputEl.style.display = show ? "block" : "none";
if(!show) inputEl.value = "";
}

function initializeReportFilters(){
const fromEl = getEl("reportFromDate");
const toEl = getEl("reportToDate");
if(!fromEl || !toEl) return;

const today = new Date();
const todayISO = today.toISOString().slice(0, 10);
const past = new Date(today);
past.setDate(past.getDate() - 30);
const pastISO = past.toISOString().slice(0, 10);

if(!toEl.value) toEl.value = formatInputDate(todayISO);
if(!fromEl.value) fromEl.value = formatInputDate(pastISO);
}

async function loadReportCustomers(){
const list = getEl("reportCustomerSuggestions");
const input = getEl("reportCustomer");
if(!list || !input) return;
const previous = input.value || "";
const rows = await fetchCollectionRows("sales");
const customerSet = new Set();

rows.forEach(row => {
const customer = (row.data?.customer || "").trim();
if(customer) customerSet.add(customer);
});

list.innerHTML = "";
Array.from(customerSet)
.sort((a, b) => a.localeCompare(b))
.forEach(customer => {
const option = document.createElement("option");
option.value = customer;
list.appendChild(option);
});
if(previous && customerSet.has(previous)){
input.value = previous;
}
}

window.debouncedRunReport = function(){
if(reportDebounceTimer){
clearTimeout(reportDebounceTimer);
reportDebounceTimer = null;
}
reportDebounceTimer = setTimeout(() => {
window.runReport();
}, 350);
};

window.runReport = async function(){
const body = getEl("salesTable");
if(!body) return;
initializeReportFilters();
toggleReportCustomerField();
body.innerHTML = "";

const reportType = getSelectedReportType();
const fromDateRaw = (getEl("reportFromDate")?.value || "").trim();
const toDateRaw = (getEl("reportToDate")?.value || "").trim();
const customer = (getEl("reportCustomer")?.value || "").trim();
const availableSilverGm = Number(getEl("reportAvailableSilverGm")?.value || 0);
const fromDate = toISODate(fromDateRaw);
const toDate = toISODate(toDateRaw);

if(fromDateRaw && !fromDate){
showStatus("From Date format invalid. Use dd/mm/yyyy.", "error");
return;
}
if(toDateRaw && !toDate){
showStatus("To Date format invalid. Use dd/mm/yyyy.", "error");
return;
}

if(fromDate && toDate && fromDate > toDate){
showStatus("From Date should be before To Date.", "error");
return;
}

const allProductsRows = await fetchCollectionRows("products");
const silverAvailableFromStock = calculateSilverAvailableFromStock(allProductsRows);
if(!(Number(getEl("reportAvailableSilverGm")?.value || 0) > 0)){
setValue("reportAvailableSilverGm", silverAvailableFromStock.toFixed(2));
}
let lowStockCount = 0;
allProductsRows.forEach(row => {
const qty = Number(row.data?.qty) || 0;
if(qty < LOW_STOCK_LIMIT) lowStockCount++;
});

if(reportType === "lowStock"){
const lowRows = [];
allProductsRows.forEach(row => {
const data = row.data || {};
const qty = Number(data.qty) || 0;
if(qty < LOW_STOCK_LIMIT){
lowRows.push({
name: data.name || "",
size: data.size || "",
qty
});
}
});

lowRows.sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name));
setReportHead(["Product", "Size", "Qty", "Status"]);
const rows = lowRows.map(row => `<tr><td>${row.name}</td><td>${row.size}</td><td>${row.qty}</td><td>Low</td></tr>`);
setReportRows(rows, "No low stock items.");
setReportSummary({ bills: 0, qty: 0, amount: 0, lowStock: lowRows.length, silverUsed: 0, silverAvailable: availableSilverGm });
return;
}

const salesRows = await fetchCollectionRows("sales");
const saleDocs = [];
salesRows.forEach(row => {
const data = row.data || {};
const saleDateISO = toISODate(data.dateISO || data.date || "");
const saleCustomer = (data.customer || "").trim();
saleDocs.push({ id: row.id, data, saleDateISO, saleCustomer });
});

let filteredSales = saleDocs.filter(sale => isDateInRange(sale.saleDateISO, fromDate, toDate));
if(reportType === "customer" && customer){
filteredSales = filteredSales.filter(sale => sale.saleCustomer.toLowerCase().includes(customer.toLowerCase()));
}
const silverUsedGm = calculateSilverUsageFromSales(filteredSales);

filteredSales.sort((a, b) => (b.saleDateISO || "").localeCompare(a.saleDateISO || ""));

if(reportType === "daily"){
setReportHead(["Date", "Bills", "Qty", "Amount"]);
const dailyMap = new Map();

filteredSales.forEach(sale => {
const key = sale.saleDateISO || "No Date";
if(!dailyMap.has(key)){
dailyMap.set(key, { bills: 0, qty: 0, amount: 0 });
}
const row = dailyMap.get(key);
row.bills += 1;
const items = Array.isArray(sale.data.items) ? sale.data.items : [];
const itemQty = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
row.qty += itemQty;
row.amount += Number(sale.data.total) || 0;
});

const dailyRows = Array.from(dailyMap.entries()).sort((a, b) => (b[0] || "").localeCompare(a[0] || ""));
let totalBills = 0;
let totalQty = 0;
let totalAmount = 0;
const rows = [];
dailyRows.forEach(([dateISO, row]) => {
totalBills += row.bills;
totalQty += row.qty;
totalAmount += row.amount;
rows.push(`<tr><td>${formatDisplayDate(dateISO)}</td><td>${row.bills}</td><td>${row.qty}</td><td>${row.amount}</td></tr>`);
});
setReportRows(rows, "No daily sales found for selected dates.");
setReportSummary({ bills: totalBills, qty: totalQty, amount: totalAmount, lowStock: lowStockCount, silverUsed: silverUsedGm, silverAvailable: availableSilverGm });
return;
}

if(reportType === "customer"){
setReportHead(["Customer", "Bills", "Products", "Qty", "Amount"]);
const customerMap = new Map();

filteredSales.forEach(sale => {
const customerKey = sale.saleCustomer || "Walk-in";
if(!customerMap.has(customerKey)){
customerMap.set(customerKey, { bills: 0, productSet: new Set(), qty: 0, amount: 0 });
}
const row = customerMap.get(customerKey);
row.bills += 1;

const items = Array.isArray(sale.data.items) ? sale.data.items : [];
if(items.length === 0){
row.amount += Number(sale.data.total) || 0;
return;
}

items.forEach(item => {
const qty = Number(item.qty) || 0;
const amount = Number(item.total) || (qty * (Number(item.rate) || 0));
const parsed = parseDevLabel(item.dev);
const productName = (parsed.product || "").trim();
if(productName) row.productSet.add(productName.toLowerCase());
row.qty += qty;
row.amount += amount;
});
});

const customerRows = Array.from(customerMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
let totalBills = 0;
let totalProducts = 0;
let totalQty = 0;
let totalAmount = 0;
const rows = [];

customerRows.forEach(([name, row]) => {
const uniqueProducts = row.productSet.size;
totalBills += row.bills;
totalProducts += uniqueProducts;
totalQty += row.qty;
totalAmount += row.amount;
rows.push(`<tr><td>${name}</td><td>${row.bills}</td><td>${uniqueProducts}</td><td>${row.qty}</td><td>${row.amount}</td></tr>`);
});

setReportRows(rows, "No customer sales found for selected filter.");
setReportSummary({ bills: totalBills, qty: totalQty, amount: totalAmount, lowStock: lowStockCount, silverUsed: silverUsedGm, silverAvailable: availableSilverGm });
return;
}

setReportHead(["Date", "Customer", "Product", "Size", "Qty", "Rate", "Amount", "Actions"]);
let totalQty = 0;
let totalAmount = 0;
let totalBills = filteredSales.length;
const rows = [];

filteredSales.forEach(sale => {
const items = Array.isArray(sale.data.items) ? sale.data.items : [];
const deleteBtn = `<button type="button" onclick="deleteSaleFromReport('${sale.id}')">Delete</button>`;
if(items.length === 0){
rows.push(`<tr><td>${formatDisplayDate(sale.saleDateISO)}</td><td>${sale.saleCustomer || "-"}</td><td>-</td><td>-</td><td>0</td><td>0</td><td>${Number(sale.data.total) || 0}</td><td>${deleteBtn}</td></tr>`);
totalAmount += Number(sale.data.total) || 0;
return;
}
items.forEach((item, itemIndex) => {
const parsed = parseDevLabel(item.dev);
const qty = Number(item.qty) || 0;
const rate = Number(item.rate) || 0;
const amount = Number(item.total) || (qty * rate);
totalQty += qty;
totalAmount += amount;
rows.push(`<tr><td>${formatDisplayDate(sale.saleDateISO)}</td><td>${sale.saleCustomer || "-"}</td><td>${parsed.product}</td><td>${parsed.size}</td><td>${qty}</td><td>${rate}</td><td>${amount}</td><td>${itemIndex === 0 ? deleteBtn : "-"}</td></tr>`);
});
});

setReportRows(rows, "No sales found for selected filter.");
if(rows.length === 0) totalBills = 0;
setReportSummary({ bills: totalBills, qty: totalQty, amount: totalAmount, lowStock: lowStockCount, silverUsed: silverUsedGm, silverAvailable: availableSilverGm });
};

window.loadSales = async function(){
initializeReportFilters();
await loadReportCustomers();
toggleReportCustomerField();
await runReport();
};

window.deleteSaleFromReport = async function(saleId){
const id = String(saleId || "").trim();
if(!id){
showStatus("Invalid sale id.", "error");
return;
}
if(!window.confirm("Is sale ko delete karna hai? Stock wapas add ho jayega.")) return;

try{
const saleRef = doc(db, "sales", id);
const saleSnap = await getDoc(saleRef);
if(!saleSnap.exists()){
showStatus("Sale not found.", "error");
return;
}

const saleData = saleSnap.data() || {};
const items = Array.isArray(saleData.items) ? saleData.items : [];

for(const item of items){
const qty = Number(item.qty) || 0;
if(qty <= 0) continue;
const parsed = parseDevLabel(item.dev);
const name = (parsed.product || "").trim();
const size = (parsed.size || "").trim();
if(!name || !size || size === "-") continue;

const existingQ = query(
collection(db, "products"),
where("name", "==", name),
where("size", "==", size)
);
const existingSnap = await getDocs(existingQ);
if(existingSnap.empty){
await addDoc(collection(db, "products"), { name, size, qty });
} else {
await updateDoc(doc(db, "products", existingSnap.docs[0].id), { qty: increment(qty) });
}
}

await deleteDoc(saleRef);
lastDeletedProduct = null;
lastDeletedSale = {
type: "sale",
customer: (saleData.customer || "").trim() || "Walk-in",
data: saleData
};
showUndoBarForDelete(lastDeletedSale);
await loadProductOptions();
await loadStockBatchOptions();
await loadStock();
await updateDashboard();
await loadLowStock();
await loadReportCustomers();
await runReport();
showStatus("Sale deleted and stock restored. Undo available for 15 seconds.");
} catch(error){
if(isQuotaExceededError(error)){
showStatus("Delete sale blocked: Firebase quota exceeded.", "error");
return;
}
console.error(error);
showStatus("Sale delete failed.", "error");
}
};

async function clearSalesForFreshStartOneTime(){
try{
const markerQ = query(
collection(db, "system_flags"),
where("key", "==", ONE_TIME_SALES_RESET_KEY)
);
const markerSnap = await getDocs(markerQ);
if(!markerSnap.empty) return false;

const salesSnap = await getDocs(collection(db, "sales"));
for(const row of salesSnap.docs){
await deleteDoc(doc(db, "sales", row.id));
}

billItems = [];
quickRows = [];
lastFinalizedBill = null;
renderQuickRows();
renderBill();

await addDoc(collection(db, "system_flags"), {
key: ONE_TIME_SALES_RESET_KEY,
createdAt: new Date().toISOString()
});

showStatus("Sales data cleared for fresh start.");
return true;
} catch(error){
console.error(error);
showStatus("Sales clear failed. Check Firestore connection/rules.", "error");
return false;
}
}

function getProductSizeKey(name, size){
return `${String(name || "").trim().toLowerCase()}__${String(size || "").trim().toLowerCase()}`;
}

async function seedDefaultProductsOneTime(){
const markerQ = query(
collection(db, "system_flags"),
where("key", "==", ONE_TIME_PRODUCTS_SEED_KEY)
);
const markerSnap = await getDocs(markerQ);
if(!markerSnap.empty) return false;

const existingSnap = await getDocs(collection(db, "products"));
const existingKeys = new Set();
existingSnap.forEach(d => {
const data = d.data();
existingKeys.add(getProductSizeKey(data.name, data.size));
});

let createdCount = 0;
for(const rawName of DEFAULT_PRODUCT_MASTER){
const name = String(rawName || "").trim();
if(!name) continue;
for(const rawSize of DEFAULT_SIZES){
const size = String(rawSize || "").trim();
if(!size) continue;
const key = getProductSizeKey(name, size);
if(existingKeys.has(key)) continue;
await addDoc(collection(db, "products"), {
name,
size,
qty: 0
});
existingKeys.add(key);
createdCount++;
}
}

await addDoc(collection(db, "system_flags"), {
key: ONE_TIME_PRODUCTS_SEED_KEY,
createdAt: new Date().toISOString(),
createdCount
});

return createdCount > 0;
}

async function mergeDuplicateProductsOneTime(){
const markerQ = query(
collection(db, "system_flags"),
where("key", "==", ONE_TIME_PRODUCTS_DEDUPE_KEY)
);
const markerSnap = await getDocs(markerQ);
if(!markerSnap.empty) return 0;

const rows = await fetchCollectionRows("products", true);
const grouped = new Map();

rows.forEach(row => {
const data = row.data || {};
const key = getProductSizeKey(data.name, data.size);
if(!grouped.has(key)) grouped.set(key, []);
grouped.get(key).push(row);
});

let mergedGroups = 0;
for(const groupRows of grouped.values()){
if(groupRows.length <= 1) continue;

const primary = groupRows[0];
const totalQty = groupRows.reduce((sum, item) => sum + (Number(item.data?.qty) || 0), 0);
await updateDoc(doc(db, "products", primary.id), { qty: totalQty });

for(let i = 1; i < groupRows.length; i++){
await deleteDoc(doc(db, "products", groupRows[i].id));
}
mergedGroups++;
}

await addDoc(collection(db, "system_flags"), {
key: ONE_TIME_PRODUCTS_DEDUPE_KEY,
createdAt: new Date().toISOString(),
mergedGroups
});

return mergedGroups;
}

async function runStartupWarmup(){
if(startupWarmupStarted) return;
startupWarmupStarted = true;
try{
const dedupedGroups = await mergeDuplicateProductsOneTime();
const productsSeededNow = await seedDefaultProductsOneTime();
await Promise.all([
loadProductOptions(),
loadStockBatchOptions(),
loadCustomerSuggestions()
]);
if(dedupedGroups > 0){
await Promise.all([
loadProducts(),
loadStock(),
updateDashboard(),
loadLowStock()
]);
showStatus(`Duplicate products merged for ${dedupedGroups} groups.`);
}
if(productsSeededNow){
await Promise.all([
loadProducts(),
updateDashboard(),
loadLowStock()
]);
showStatus("Default products added for all sizes. Qty set to 0.");
}
} catch(error){
console.error(error);
showStatus("Sync slow or blocked. Check internet/Firestore rules.", "error");
}
}

window.loadLowStock = async function(){
const table = getEl("lowStockTable");
if(!table) return;
const rows = await fetchCollectionRows("products");
table.innerHTML = "";
let lowCount = 0;
rows.forEach(row => {
const data = row.data || {};
const qty = Number(data.qty) || 0;
if(qty < LOW_STOCK_LIMIT){
lowCount++;
table.innerHTML += `<tr><td>${data.name || ""} (${data.size || ""})</td><td>${qty}</td></tr>`;
}
});
setText("lowStock", lowCount);
};

async function updateDashboard(){
const productRows = await fetchCollectionRows("products");
const salesRows = await fetchCollectionRows("sales");
let totalStock = 0;
productRows.forEach(row => totalStock += Number(row.data?.qty) || 0);
const totalSilverAvailable = calculateSilverAvailableFromStock(productRows);
setText("totalProducts", productRows.length);
setText("totalStock", totalStock);
setText("totalSilverAvailable", totalSilverAvailable.toFixed(2));
setText("totalSales", salesRows.length);
}

window.deleteProduct = async function(id){
try{
const ref = doc(db, "products", id);
const productSnap = await getDoc(ref);
if(!productSnap.exists()){
showStatus("Product not found.", "error");
return;
}

const data = productSnap.data();
lastDeletedSale = null;
lastDeletedProduct = {
name: (data.name || "").trim(),
size: (data.size || "").trim(),
qty: Number(data.qty) || 0
};

await deleteDoc(ref);
showUndoBarForDelete(lastDeletedProduct);
await loadProducts();
await loadProductOptions();
await loadStockBatchOptions();
await loadStock();
await updateDashboard();
await loadLowStock();
showStatus("Product deleted. Undo available for 15 seconds.");
} catch(error){
if(isQuotaExceededError(error)){
showStatus("Delete blocked: Firebase quota exceeded.", "error");
return;
}
console.error(error);
showStatus("Delete failed.", "error");
}
};

window.undoLastDeletedProduct = async function(){
if(lastDeletedSale){
const restoreSale = JSON.parse(JSON.stringify(lastDeletedSale));
clearUndoState();
try{
const items = Array.isArray(restoreSale.data?.items) ? restoreSale.data.items : [];
for(const item of items){
const qty = Number(item.qty) || 0;
if(qty <= 0) continue;
const parsed = parseDevLabel(item.dev);
const name = (parsed.product || "").trim();
const size = (parsed.size || "").trim();
if(!name || !size || size === "-") continue;

const existingQ = query(
collection(db, "products"),
where("name", "==", name),
where("size", "==", size)
);
const existingSnap = await getDocs(existingQ);
if(existingSnap.empty){
await addDoc(collection(db, "products"), { name, size, qty: -qty });
} else {
await updateDoc(doc(db, "products", existingSnap.docs[0].id), { qty: increment(-qty) });
}
}

await addDoc(collection(db, "sales"), restoreSale.data);
await loadProducts();
await loadProductOptions();
await loadStockBatchOptions();
await loadStock();
await updateDashboard();
await loadLowStock();
await loadReportCustomers();
await runReport();
showStatus("Deleted sale restored.");
} catch(error){
console.error(error);
showStatus("Sale undo failed. Try again.", "error");
}
return;
}

if(!lastDeletedProduct){
showStatus("Undo available nahi hai.", "error");
return;
}

const restoreItem = { ...lastDeletedProduct };
clearUndoState();

const safeName = (restoreItem.name || "").trim();
const safeSize = (restoreItem.size || "").trim();
const safeQty = Number(restoreItem.qty) || 0;

if(!safeName || !safeSize){
showStatus("Deleted product data invalid tha, undo nahi ho paya.", "error");
return;
}

try{
const existingQ = query(
collection(db, "products"),
where("name", "==", safeName),
where("size", "==", safeSize)
);
const existingSnap = await getDocs(existingQ);

if(existingSnap.empty){
await addDoc(collection(db, "products"), {
name: safeName,
size: safeSize,
qty: safeQty
});
} else if(safeQty > 0) {
await updateDoc(doc(db, "products", existingSnap.docs[0].id), {
qty: increment(safeQty)
});
}

await loadProducts();
await loadProductOptions();
await loadStockBatchOptions();
await loadStock();
await updateDashboard();
await loadLowStock();
showStatus("Deleted product restored.");
} catch(error){
console.error(error);
showStatus("Undo failed. Try again.", "error");
}
};

window.dismissUndoDelete = function(){
if(!lastDeletedProduct && !lastDeletedSale){
hideUndoBar();
return;
}
clearUndoState();
showStatus("Delete confirmed.");
};

window.printReport = function(){
const head = getEl("reportTableHead");
const body = getEl("salesTable");
if(!head || !body){ showStatus("Report not ready.", "error"); return; }
if(reportRowsCache.length === 0){ showStatus("No report data to print.", "error"); return; }

const reportType = getSelectedReportType();
const labelMap = {
sales: "Sales Date Wise",
customer: "Customer Wise Sales",
daily: "Daily Sales Summary",
lowStock: "Low Stock"
};
const fromDateRaw = (getEl("reportFromDate")?.value || "").trim();
const toDateRaw = (getEl("reportToDate")?.value || "").trim();
const fromDate = fromDateRaw || "-";
const toDate = toDateRaw || "-";
const customer = (getEl("reportCustomer")?.value || "").trim() || "All";

const w = window.open("", "_blank", "width=1000,height=700");
if(!w){ showStatus("Popup blocked. Allow popups to print report.", "error"); return; }

w.document.write(`<!doctype html><html><head><title>Report Print</title><style>
body{font-family:Arial;padding:20px;color:#111}
h1{margin:0 0 10px;font-size:28px}
.meta{margin:4px 0 14px;font-size:15px}
table{width:100%;border-collapse:collapse;margin-top:10px}
th,td{border:1px solid #333;padding:8px;text-align:left;font-size:14px}
th{background:#efefef}
</style></head><body>
<h1>Varma Jewellers Report</h1>
<div class="meta"><b>Type:</b> ${labelMap[reportType] || "Report"}</div>
<div class="meta"><b>From:</b> ${fromDate} &nbsp;&nbsp; <b>To:</b> ${toDate}</div>
<div class="meta"><b>Customer:</b> ${customer}</div>
<table><thead>${head.innerHTML}</thead><tbody>${reportRowsCache.join("")}</tbody></table>
</body></html>`);
w.document.close();
w.focus();
w.print();
};

window.printCurrentBill = function(){
const bill = getBillSourceForOutput();
if(!bill){ showStatus("No bill data to print. Add item or generate bill first.", "error"); return; }
const customer = bill.customer;
const date = bill.date;
const rows = bill.items.map(item => `<tr><td>${item.dev}</td><td>${item.qty}</td><td>${item.rate}</td><td>${item.total}</td></tr>`).join("");
const total = Number(bill.total) || 0;
const w = window.open("", "_blank", "width=900,height=700");
if(!w){ showStatus("Popup blocked. Allow popups to print.", "error"); return; }
w.document.write(`<!doctype html><html><head><title>Bill Print</title><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #222;padding:8px}th{background:#f3f3f3}.total{margin-top:12px;font-weight:700}</style></head><body><h1>Varma Jewelerys - Bill</h1><div><b>Date:</b> ${date}</div><div><b>Customer:</b> ${customer}</div><table><thead><tr><th>Product</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Grand Total: ${total}</div></body></html>`);
w.document.close();
w.focus();
w.print();
};

window.saveBillAsImage = function(){
const bill = getBillSourceForOutput();
if(!bill){ showStatus("No bill data to save. Add item or generate bill first.", "error"); return; }
const customer = bill.customer;
const date = bill.date;
const total = Number(bill.total) || 0;
const width = 1100;
const rowHeight = 42;
const top = 210;
const bottom = 80;
const height = top + (bill.items.length * rowHeight) + bottom;
const canvas = document.createElement("canvas");
canvas.width = width;
canvas.height = height;
const ctx = canvas.getContext("2d");
if(!ctx){ showStatus("Unable to create image.", "error"); return; }
ctx.fillStyle = "#fff";
ctx.fillRect(0,0,width,height);
ctx.fillStyle = "#111";
ctx.font = "bold 42px Arial";
ctx.fillText("Varma Jewelerys - Bill",40,60);
ctx.font = "24px Arial";
ctx.fillText(`Date: ${date}`,40,105);
ctx.fillText(`Customer: ${customer}`,40,140);
ctx.font = "bold 22px Arial";
ctx.fillText("Product",40,190); ctx.fillText("Qty",660,190); ctx.fillText("Rate",760,190); ctx.fillText("Total",900,190);
ctx.beginPath(); ctx.moveTo(40,200); ctx.lineTo(1060,200); ctx.strokeStyle="#333"; ctx.stroke();
ctx.font = "20px Arial";
bill.items.forEach((item, index) => {
const y = 230 + (index * rowHeight);
ctx.fillText(item.dev,40,y); ctx.fillText(String(item.qty),660,y); ctx.fillText(String(item.rate),760,y); ctx.fillText(String(item.total),900,y);
});
ctx.beginPath(); ctx.moveTo(40,height-55); ctx.lineTo(1060,height-55); ctx.strokeStyle="#333"; ctx.stroke();
ctx.font = "bold 30px Arial";
ctx.fillText(`Grand Total: ${total}`,740,height-15);
const link = document.createElement("a");
link.href = canvas.toDataURL("image/png");
link.download = `bill-${Date.now()}.png`;
document.body.appendChild(link);
link.click();
document.body.removeChild(link);
showStatus("Bill image saved.");
};

window.onload = async function(){
const users = getUsers();
if(!users[DEFAULT_USERNAME]){ users[DEFAULT_USERNAME] = DEFAULT_PASSWORD; saveUsers(users); }
setAuthMessage("", false);

const loggedInRaw = localStorage.getItem("varma_logged_in_user") || "";
const loggedInKey = resolveUserKey(users, loggedInRaw);

if(loggedInKey){
localStorage.setItem("varma_logged_in_user", loggedInKey);
showAppShell();
show("dashboard");
runStartupWarmup();
return;
}

localStorage.removeItem("varma_logged_in_user");
showAuthPage();

const userEl = getEl("loginUser");
const passEl = getEl("loginPass");
[userEl, passEl].forEach(el => {
if(!el) return;
el.addEventListener("keydown", (e) => {
if(e.key === "Enter"){
e.preventDefault();
window.loginUser();
}
});
});
};

window.addEventListener("unhandledrejection", (event) => {
const reason = event.reason;
if(!isQuotaExceededError(reason)) return;
event.preventDefault();
showStatus("Firebase quota exceeded. Abhi write/read slow ya blocked hoga.", "error");
});
