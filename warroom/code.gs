/*******************************************************
 * 許瑞興機台狀態回報系統 ／ 智慧製造戰情室 - 後端 API (Google Apps Script Web App)
 *
 * 試算表結構（都會自動建立／自動補欄位，不用手動改）：
 *   回報資料表（第一個工作表）：
 *     Timestamp, Machine_ID, Operator, Status, Produced_Qty, Error_Code, Notes,
 *     Dept, IP, Device_ID, Browser, OS, Device_Type, Record_ID, Updated_At, Updated_By
 *     → 前 7 欄跟舊版一樣，舊資料不受影響；後面的欄位第一次執行時自動加在標題列最後面
 *   DropdownConfig：歷史選單資料庫（機台編號／異常代碼／部門），前台「⚙️ 管理歷史選單」維護
 *   AdminLog：管理員編輯／刪除回報資料的稽核紀錄
 *
 * 部署：修改後務必「部署 → 管理部署作業 → 編輯 → 版本選『新版本』→ 部署」，前端才會用到新程式。
 *       瀏覽器打開「API網址?action=ping」可看到目前部署的後端版本。
 *
 * 管理員密碼：必須到「專案設定 → 指令碼屬性」新增 ADMIN_PASSWORD（程式碼裡沒有預設密碼，沒設定就無法登入管理員），
 *             密碼就不用寫在程式碼裡（上課分享程式碼時比較安全）。
 *             同一台電腦連續輸錯 ADMIN_MAX_FAILS 次只鎖那台電腦（裝置 ID + 內網 IP 辨識），不連累管理員。
 *
 * v2.6.0（2026-10-13）
 *   - 安全：移除程式碼內建的預設管理員密碼，只讀指令碼屬性 ADMIN_PASSWORD（沒設定就無法登入管理員）
 *   - 效能：doGet 預設只回傳最近 days 天（預設 60；days=all 為全部），支援 since=（毫秒）增量查詢；
 *           讀取不再整張表上鎖、不再於讀取路徑補 Record_ID（改在寫入時補；舊資料可手動執行 migrateRecordIds）
 *   - 效能：資料回應以 CacheService 快取（分段，DATA_CACHE_TTL_SEC 秒；有新回報／編輯／刪除即作廢）
 *   - 效能：歷史選單改用 CacheService，回報時選單沒有新項目就不再讀寫試算表
 *   - 線上人數：TTL 延長為 130 秒，配合前端每 60 秒回報一次、背景分頁暫停
 *
 * v2.5.0（2026-10-02）
 *   - 新增故障照片上傳：機台回報送出時可附帶照片（前端 Canvas 壓縮後送出），後端自動儲存至 Google Drive「機台故障照片」資料夾
 *   - 回報資料新增 Photo_URL 欄位，戰情室大螢幕與管理後台可直接點擊預覽現場照片
 *   - Telegram 通知升級：故障報工若有附帶照片，訊息內自動加入現場照片超連結
 *   - 支援手機 QR Code 掃描報工與備註語音轉文字辨識
 *
 * v2.4.0（2026-10-02）
 *   - 新增 Telegram 通知：機台回報送出後，自動推播到 Telegram 群組（跟圖面查詢系統同一個 Bot、同一個群組）
 *   - 新增 doGet action=telegramInfo：前端「加入群組」按鈕、QR Code、「什麼時候會收到通知」說明用
 *   - 新增 testTelegram()：在編輯器選這個函式按「執行」，群組會收到一則測試訊息
 *   ※ 第一次部署 v2.4.0 時 Google 會要求重新授權（多了「連線到外部服務」權限，用來呼叫 Telegram），按允許即可
 *   ※ 必填「指令碼屬性」：TG_TOKEN、TG_CHAT_ID（跟圖面查詢系統 config.nas.json 相同；不寫在程式碼裡，避免分享程式碼時外洩）
 *     選填：TG_GROUP_LINK（群組加入連結）、TG_NOTIFY（例如 故障停機,例行保養；ALL=全部；OFF=關閉）
 *
 * v2.3.0（2026-10-02）
 *   - 管理員閒置自動登出改為 30 分鐘（通行證效期 30 分鐘，跟圖面查詢系統一致）
 *   - 新增 adminPing：前端偵測到有操作（含移動滑鼠）時每分鐘延長一次通行證，避免只在看資料時被後端判定逾時
 *
 * v2.2.0（2026-10-02）
 *   - 管理員登入改用「臨時通行證」：密碼只在解鎖時送一次，後端驗證通過後發一組隨機通行證（存 CacheService，
 *     15 分鐘沒操作自動失效），之後的編輯／刪除／清除都用通行證，前端不再保留密碼
 *   - 管理員名稱固定為 ADMIN_NAME（資訊課-Kenny），稽核紀錄由後端寫入，前端無法冒用其他名稱
 *   - 歷史選單的新增／編輯／刪除／重新掃描改成只有管理員可以（回報時自動加入新機台、新代碼不受影響）
 *   - 新增 logoutAdmin：前端按「鎖定退出」時立即作廢通行證
 *
 * v2.1.0（2026-10-02）
 *   - 管理員「一鍵清除數據」（測試數據快速刪除）：可清除全部或指定日期範圍；清除前自動把資料備份到
 *     新工作表「備份_日期時間」，清錯了可以從備份貼回；寫入 AdminLog
 *
 * v2.0.0（2026-10-02）
 *   - 回報資料新增：部門、IP、瀏覽器裝置 ID、瀏覽器、作業系統、裝置類型（手機／平板／電腦）
 *   - 每筆回報有固定的 Record_ID（舊資料第一次讀取時自動補上），管理員可用來編輯／刪除
 *   - 線上人數 presence（CacheService，不寫試算表；每 30 秒回報，75 秒沒回報視為離線）
 *   - 歷史選單資料庫：讀取／儲存／從回報資料重新掃描；新回報的機台、異常代碼自動加入
 *   - 管理員：驗證、編輯回報、刪除回報（後端驗證密碼，寫入 AdminLog）
 *******************************************************/

const API_TOKEN = "ITRI_2026";            // 前端必須帶入此 Token 才能存取 API
// 管理員密碼不再寫在程式碼裡：請到「專案設定 → 指令碼屬性」新增 ADMIN_PASSWORD（沒設定時任何人都無法登入管理員）
const ADMIN_MAX_FAILS = 5;                // 同一台電腦連續輸錯幾次就暫時鎖住
const ADMIN_LOCK_MINUTES = 15;            // 鎖住幾分鐘
const ADMIN_NAME = "資訊課-Kenny";         // 管理員名稱（寫進稽核紀錄、修改人欄位）
const ADMIN_SESSION_MINUTES = 30;         // 管理員通行證：幾分鐘沒操作就失效
const BACKEND_VERSION = "v2.6.0";

// 讀取效能：回報資料預設只回傳最近 N 天；結果以 CacheService 快取數十秒
const DEFAULT_DATA_DAYS = 60;             // 前端沒帶 days 時的預設天數
const MAX_DATA_DAYS = 3650;               // days 上限（days=all 才是全部）
const DATA_CACHE_TTL_SEC = 20;            // 資料回應快取秒數（有新回報／編輯時會立即作廢）
const DROPDOWN_CACHE_TTL_SEC = 21600;     // 歷史選單快取秒數

// Telegram 通知（跟圖面查詢系統同一個 Bot 與群組）
// ⚠ Bot Token 與 Chat ID 不寫在程式碼裡（上課會分享程式碼、網頁放在 Public repo），
//   請到「專案設定 → 指令碼屬性」新增 TG_TOKEN、TG_CHAT_ID（數值跟圖面查詢系統 config.nas.json 的 telegram 區塊相同）
const TG_GROUP_LINK = "https://t.me/+W-WyULzZt0JkYjZl";
const TG_NOTIFY_STATUSES = ["正常報工", "故障停機", "例行保養"]; // 哪些狀態要通知（空陣列 = 全部不通知）
const PRESENCE_TTL_SEC = 130;

const DATA_HEADERS = ["Timestamp", "Machine_ID", "Operator", "Status", "Produced_Qty", "Error_Code", "Notes",
  "Dept", "IP", "Device_ID", "Browser", "OS", "Device_Type", "Record_ID", "Updated_At", "Updated_By", "Photo_URL"];
const EDITABLE_FIELDS = ["Machine_ID", "Operator", "Dept", "Status", "Produced_Qty", "Error_Code", "Notes", "Photo_URL"];
const DROPDOWN_SHEET = "DropdownConfig";
const ADMINLOG_SHEET = "AdminLog";
const DROPDOWN_FIELDS = ["Machine_ID", "Error_Code", "Dept"];
const DROPDOWN_DEFAULTS = {
  Machine_ID: ["CNC-001", "CNC-002", "CNC-003"],
  Error_Code: ["無", "E01卡料", "E02過熱", "E03刀具"],
  Dept: ["現場廠務", "工務課", "生技課", "品管課", "資訊課", "倉庫"]
};

// ================= 共用 =================
function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function nowStr_() {
  return Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function newRecordId_() {
  return "R" + new Date().getTime().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase();
}
function str_(v, max) { return String(v == null ? "" : v).trim().slice(0, max || 200); }

// 回報資料表：維持舊版「第一個工作表」的位置（舊版用 getActiveSheet，就是第一個工作表）
function getDataSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

// 確保標題列有全部欄位，回傳 { 欄位名: 欄位索引(0起) }
// 前 7 欄若標題名稱被改過（例如改成中文），仍沿用舊版固定位置，舊資料不會錯位
function ensureHeaders_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getLastRow() >= 1 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  if (headers.every(h => h === "")) headers = [];
  const map = {};
  headers.forEach((h, i) => { if (h) map[h.trim()] = i; });
  let changed = false;
  DATA_HEADERS.forEach((h, i) => {
    if (map[h] != null) return;
    if (i < 7 && headers.length > i && headers[i]) { map[h] = i; return; } // 舊欄位位置相容
    headers.push(h);
    map[h] = headers.length - 1;
    changed = true;
  });
  if (changed) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return map;
}

// 讀全部回報，順便替沒有 Record_ID 的舊資料補上（只給已在鎖內的管理操作使用，例如重新掃描歷史選單；doGet 不用它）
function readAllRecords_() {
  const sheet = getDataSheet_();
  const map = ensureHeaders_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const width = sheet.getLastColumn();
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const idCol = map.Record_ID;
  const missing = [];
  values.forEach((row, i) => {
    if (!row[idCol]) { row[idCol] = newRecordId_(); missing.push(i); }
  });
  if (missing.length) {
    sheet.getRange(2, idCol + 1, values.length, 1).setValues(values.map(r => [r[idCol]]));
  }
  return values.map(row => {
    const o = {};
    DATA_HEADERS.forEach(h => { o[h] = row[map[h]]; });
    return o;
  });
}

// 替沒有 Record_ID 的舊資料補上（要在鎖內呼叫）
function repairMissingIds_(sheet, map) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const rng = sheet.getRange(2, map.Record_ID + 1, lastRow - 1, 1);
  const ids = rng.getValues();
  let fixed = 0;
  ids.forEach(r => { if (!r[0]) { r[0] = newRecordId_(); fixed++; } });
  if (fixed) rng.setValues(ids);
  return fixed;
}
// 手動一次性遷移：在編輯器選這個函式按「執行」，替所有舊資料補上 Record_ID
function migrateRecordIds() {
  return withLock_(() => { const s = getDataSheet_(); return repairMissingIds_(s, ensureHeaders_(s)); });
}

// 只讀「最近 days 天」或「Timestamp >= since（毫秒）」的回報。
// 先只讀 Timestamp 那一欄找出起點，再只讀起點之後的列，資料量大時比整張表讀取快很多，而且不用上鎖。
// opts：{ days: 天數（0 = 全部）, since: 毫秒時間戳（優先於 days）}
function readRecords_(opts) {
  opts = opts || {};
  const sheet = getDataSheet_();
  const map = ensureHeaders_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const n = lastRow - 1;
  const cutoff = opts.since ? Number(opts.since) : (opts.days ? Date.now() - opts.days * 86400000 : 0);
  const tsOf = v => (v instanceof Date ? v : new Date(v)).getTime();
  let startIdx = 0;
  if (cutoff) {
    const ts = sheet.getRange(2, map.Timestamp + 1, n, 1).getValues();
    startIdx = n;
    for (let i = 0; i < n; i++) {
      const t = tsOf(ts[i][0]);
      if (!isNaN(t) && t >= cutoff) { startIdx = i; break; }
    }
  }
  const cnt = n - startIdx;
  if (cnt <= 0) return [];
  const width = sheet.getLastColumn();
  const read = () => sheet.getRange(2 + startIdx, 1, cnt, width).getValues();
  let values = read();
  if (values.some(r => !r[map.Record_ID])) { // 舊資料還沒有 Record_ID：補一次（之後就不會再進來）
    withLock_(() => repairMissingIds_(sheet, map));
    values = read();
  }
  if (cutoff) values = values.filter(r => { const t = tsOf(r[map.Timestamp]); return !isNaN(t) && t >= cutoff; });
  return values.map(row => {
    const o = {};
    DATA_HEADERS.forEach(h => { o[h] = row[map[h]]; });
    return o;
  });
}

// ----- 資料版本號與快取（戰情室很多人同時開時，大部分請求直接吃快取，不碰試算表）-----
// data 版本：任何新增／修改／刪除都會變；edit 版本：只有編輯／刪除／清除會變（增量查詢遇到 edit 變動時要整批重抓）
function getRev_(name) {
  const cache = CacheService.getScriptCache();
  let v = cache.get("rev_" + name);
  if (!v) {
    v = PropertiesService.getScriptProperties().getProperty("REV_" + name) || "0";
    cache.put("rev_" + name, v, 21600);
  }
  return v;
}
function bumpRev_(names) {
  const v = String(new Date().getTime());
  const props = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  names.forEach(n => { props.setProperty("REV_" + n, v); cache.put("rev_" + n, v, 21600); });
}
// CacheService 單一值上限 100KB，所以長字串切成小段存
const CACHE_CHUNK_CHARS = 30000;
function cachePutBig_(key, str, ttl) {
  try {
    const n = Math.ceil(str.length / CACHE_CHUNK_CHARS);
    if (n > 40) return; // 太大就不快取
    const obj = {};
    for (let i = 0; i < n; i++) obj[key + "_" + i] = str.substr(i * CACHE_CHUNK_CHARS, CACHE_CHUNK_CHARS);
    obj[key + "_n"] = String(n);
    CacheService.getScriptCache().putAll(obj, ttl);
  } catch (e) {}
}
function cacheGetBig_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get(key + "_n") || 0);
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + "_" + i);
    const got = cache.getAll(keys);
    let s = "";
    for (let i = 0; i < n; i++) { const part = got[key + "_" + i]; if (part == null) return null; s += part; }
    return s;
  } catch (e) { return null; }
}

function findRowById_(sheet, map, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, map.Record_ID + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

// ================= doGet =================
// .../exec?token=ITRI_2026                      → 最近 60 天回報資料（戰情室用）
// .../exec?token=...&days=30 | days=all         → 指定天數 | 全部
// .../exec?token=...&since=毫秒&drev=編輯版本    → 增量：只回傳 Timestamp >= since 的回報（drev 不符時自動整批回傳 full:true）
// .../exec?action=ping                          → 後端版本
// .../exec?action=getDropdown&token=ITRI_2026   → 歷史選單
// .../exec?action=telegramInfo&token=ITRI_2026  → Telegram 群組連結與通知設定
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === "ping") {
    return createJsonResponse({ status: "success", ok: true, version: BACKEND_VERSION, time: nowStr_() });
  }
  if (!p.token || p.token !== API_TOKEN) {
    return createJsonResponse({ status: "error", message: "Unauthorized: Token Invalid" });
  }
  try {
    if (p.action === "getDropdown") {
      return createJsonResponse({ status: "success", dropdown: getDropdown_() });
    }
    if (p.action === "telegramInfo") {
      const tg = tgConfig_();
      return createJsonResponse({ status: "success", telegram: { link: tg.link, enabled: tg.ready, notify: tg.notify, all: TG_NOTIFY_STATUSES } });
    }
    const days = String(p.days || "").toLowerCase() === "all" ? 0
      : Math.min(Math.max(parseInt(p.days, 10) || DEFAULT_DATA_DAYS, 1), MAX_DATA_DAYS);
    const rev = getRev_("data");
    const editRev = getRev_("edit");
    const since = Number(p.since) || 0;
    const incremental = since > 0 && String(p.drev || "") === editRev;
    const key = "dc_" + rev + "_" + (days || "all") + "_" + (incremental ? since : "full");
    let body = cacheGetBig_(key);
    if (!body) {
      const data = readRecords_({ days: days, since: incremental ? since : 0 });
      body = JSON.stringify({ status: "success", version: BACKEND_VERSION, data: data, full: !incremental, days: days, drev: editRev, serverTime: new Date().getTime() });
      cachePutBig_(key, body, DATA_CACHE_TTL_SEC);
    }
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return createJsonResponse({ status: "error", message: String(err) });
  }
}


// ================= doPost =================
// 前端一律用 Content-Type: text/plain;charset=utf-8 送 JSON（避免 CORS 預檢）
function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return createJsonResponse({ status: "error", message: "請求格式錯誤（非合法 JSON）" });
  }
  if (!body.token || body.token !== API_TOKEN) {
    return createJsonResponse({ status: "error", message: "Unauthorized: Token Invalid" });
  }
  const action = body.action || "report";
  try {
    if (action === "presence") return createJsonResponse(presence_(body));
    if (action === "report") {
      const res = withLock_(() => addReport_(body));
      // 寫入成功後才通知（在鎖外面發送，不拖慢其他人回報；通知失敗不影響回報結果）
      if (res && res.status === "success" && res._tg) {
        try { res.telegram = notifyReportTelegram_(res._tg, body.pageUrl); } catch (e) { res.telegram = "error: " + e; }
      }
      if (res) delete res._tg;
      return createJsonResponse(res);
    }
    if (action === "verifyAdmin") {
      const auth = withLock_(() => adminAuth_(body, true));
      return createJsonResponse(auth.ok ? { status: "success", ok: true, adminToken: auth.adminToken, adminName: ADMIN_NAME, sessionMinutes: ADMIN_SESSION_MINUTES }
        : { status: "error", ok: false, locked: auth.locked, expired: auth.expired, message: auth.error, error: auth.error });
    }
    if (action === "adminPing") {
      const auth = adminAuth_({ adminToken: body.adminToken, sid: body.sid }, false);
      return createJsonResponse(auth.ok ? { status: "success", ok: true } : { status: "error", ok: false, expired: true, message: auth.error });
    }
    if (action === "logoutAdmin") {
      if (body.adminToken) CacheService.getScriptCache().remove("admsess_" + str_(body.adminToken, 80));
      return createJsonResponse({ status: "success", ok: true });
    }
    // 以下都需要管理員（通行證或密碼）
    const ADMIN_ACTIONS = ["saveDropdown", "rescanDropdown", "clearData", "updateRecord", "deleteRecord"];
    if (ADMIN_ACTIONS.indexOf(action) >= 0) {
      if (action === "clearData" && body.confirm !== "CLEAR_DATA") return createJsonResponse({ status: "error", message: "缺少清除確認碼" });
      const auth = withLock_(() => adminAuth_(body, false));
      if (!auth.ok) return createJsonResponse({ status: "error", ok: false, locked: auth.locked, expired: auth.expired, needAdmin: true, message: auth.error });
      body.adminName = ADMIN_NAME; // 名稱由後端決定，前端傳什麼都不採用
      if (action === "saveDropdown") return createJsonResponse(withLock_(() => saveDropdown_(body.field, body.list)));
      if (action === "rescanDropdown") return createJsonResponse(withLock_(rescanDropdown_));
      if (action === "clearData") return createJsonResponse(withLock_(() => clearData_(body)));
      if (action === "updateRecord") return createJsonResponse(withLock_(() => updateRecord_(body)));
      return createJsonResponse(withLock_(() => deleteRecord_(body)));
    }
    return createJsonResponse({ status: "error", message: "未知的 action：" + action });
  } catch (err) {
    return createJsonResponse({ status: "error", message: String(err) });
  }
}

// ================= 照片存檔（Google Drive） =================
function savePhotoToDrive_(photoBase64, machineId, recordId) {
  if (!photoBase64 || typeof photoBase64 !== "string") return "";
  try {
    const parts = photoBase64.split(",");
    let mimeType = "image/jpeg";
    let base64Data = photoBase64;
    if (parts.length > 1) {
      const match = parts[0].match(/:(.*?);/);
      if (match) mimeType = match[1];
      base64Data = parts[1];
    }
    const bytes = Utilities.base64Decode(base64Data);
    const fileName = (recordId || "REC") + "_" + (machineId || "MACH") + "_" + Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd_HHmmss") + ".jpg";
    const blob = Utilities.newBlob(bytes, mimeType, fileName);

    const folderName = "機台故障照片";
    let folder;
    const folders = DriveApp.getFoldersByName(folderName);
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder(folderName);
    }
    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (eShare) {}
    return file.getUrl();
  } catch (err) {
    console.error("savePhotoToDrive_ 失敗：" + err);
    return "";
  }
}

// ================= 回報寫入 =================
function addReport_(b) {
  const sheet = getDataSheet_();
  const map = ensureHeaders_(sheet);
  const width = sheet.getLastColumn();
  const row = new Array(width).fill("");
  const id = newRecordId_();
  let photoUrl = "";
  if (b.photoBase64) {
    photoUrl = savePhotoToDrive_(b.photoBase64, b.Machine_ID, id);
  }
  const vals = {
    Timestamp: new Date(),
    Machine_ID: str_(b.Machine_ID, 60),
    Operator: str_(b.Operator, 40) || "未填寫",
    Status: str_(b.Status, 20),
    Produced_Qty: Number(b.Produced_Qty) || 0,
    Error_Code: str_(b.Error_Code, 60),
    Notes: str_(b.Notes, 1000),
    Dept: str_(b.Dept, 40),
    IP: str_(b.IP, 80),
    Device_ID: str_(b.Device_ID, 64),
    Browser: str_(b.Browser, 60),
    OS: str_(b.OS, 60),
    Device_Type: str_(b.Device_Type, 20),
    Record_ID: id,
    Photo_URL: photoUrl
  };
  Object.keys(vals).forEach(k => { row[map[k]] = vals[k]; });
  sheet.appendRow(row);
  bumpRev_(["data"]);
  // 新的機台／異常代碼／部門自動加入歷史選單
  try { autoAddDropdown_({ Machine_ID: vals.Machine_ID, Error_Code: vals.Error_Code, Dept: vals.Dept }); } catch (e) {}
  vals.Timestamp = nowStr_();
  return { status: "success", message: "Data saved successfully", recordId: id, photoUrl: photoUrl, _tg: vals };
}

// ================= 歷史選單資料庫 =================
function getDropdownSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(DROPDOWN_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DROPDOWN_SHEET);
    sh.appendRow(["Field", "Items(JSON)", "UpdatedAt"]);
    DROPDOWN_FIELDS.forEach(f => sh.appendRow([f, JSON.stringify(DROPDOWN_DEFAULTS[f] || []), nowStr_()]));
    sh.setFrozenRows(1);
  }
  return sh;
}
function getDropdown_() {
  const cache = CacheService.getScriptCache();
  try {
    const hit = cache.get("dd_cache");
    if (hit) return JSON.parse(hit);
  } catch (e) {}
  const sh = getDropdownSheet_();
  const vals = sh.getDataRange().getValues().slice(1);
  const out = {};
  DROPDOWN_FIELDS.forEach(f => { out[f] = []; });
  vals.forEach(r => {
    const f = String(r[0]);
    if (DROPDOWN_FIELDS.indexOf(f) < 0) return;
    try { out[f] = JSON.parse(r[1] || "[]") || []; } catch (e) { out[f] = []; }
  });
  try { cache.put("dd_cache", JSON.stringify(out), DROPDOWN_CACHE_TTL_SEC); } catch (e) {}
  return out;
}
function cleanList_(list) {
  const seen = {};
  return (Array.isArray(list) ? list : []).map(v => str_(v, 60)).filter(v => v && !seen[v] && (seen[v] = true)).slice(0, 500);
}
function saveDropdown_(field, list) {
  if (DROPDOWN_FIELDS.indexOf(field) < 0) return { status: "error", message: "不支援的欄位：" + field };
  const sh = getDropdownSheet_();
  const vals = sh.getDataRange().getValues();
  const clean = cleanList_(list);
  const done = () => { try { CacheService.getScriptCache().remove("dd_cache"); } catch (e) {} return { status: "success", field: field, list: clean }; };
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === field) {
      sh.getRange(i + 1, 2, 1, 2).setValues([[JSON.stringify(clean), nowStr_()]]);
      return done();
    }
  }
  sh.appendRow([field, JSON.stringify(clean), nowStr_()]);
  return done();
}
function autoAddDropdown_(vals) {
  const dd = getDropdown_();
  Object.keys(vals).forEach(f => {
    const v = vals[f];
    if (!v || (f === "Error_Code" && v === "無")) return;
    if ((dd[f] || []).indexOf(v) < 0) saveDropdown_(f, (dd[f] || []).concat([v]));
  });
}
// 從所有回報資料重新掃描，跟目前選單合併（不會刪掉手動新增的項目）
function rescanDropdown_() {
  const dd = getDropdown_();
  const recs = readAllRecords_();
  DROPDOWN_FIELDS.forEach(f => {
    const list = (dd[f] || []).slice();
    recs.forEach(r => { const v = str_(r[f], 60); if (v && list.indexOf(v) < 0) list.push(v); });
    saveDropdown_(f, list);
  });
  return { status: "success", dropdown: getDropdown_() };
}

// ================= 線上人數 =================
// payload：{ token, action:'presence', sid, ip, os, browser, deviceType, page, who, leave }
function presence_(b) {
    var b=b,sid=String(b.sid||'').slice(0,64),tab=String(b.tabId||'legacy').slice(0,80),page=String(b.page||'dashboard');
    var lock=LockService.getScriptLock(),got=lock.tryLock(2000);if(!got)return {ok:false,error:'在線服務忙碌'};
    try{
      var cache=CacheService.getScriptCache(),now=Math.floor(Date.now()/1000),map=JSON.parse(cache.get('PRESENCE_TABS_V2')||'{}');
      Object.keys(map).forEach(function(k){if(!map[k]||now-map[k].last>PRESENCE_TTL_SEC)delete map[k];});
      var key=sid+'|'+tab;
      if(sid){if(b.leave){delete map[key];}else{var prior=map[key]||{},entry={device:sid,tabId:tab,since:prior.since||now,last:now,page:page};['ip','os','browser','deviceType','who','department','deviceName','computerName','localInfoSource'].forEach(function(k){entry[k]=String(b[k]||'').slice(0,160);});map[key]=entry;}}
      cache.put('PRESENCE_TABS_V2',JSON.stringify(map),300);
      var grouped=Object.create(null);
      Object.keys(map).forEach(function(k){var e=map[k];var prev=grouped[e.device];if(!prev)grouped[e.device]=Object.assign({},e,{tabs:1});else{var tabs=prev.tabs+1,since=Math.min(prev.since,e.since);if(e.last>=prev.last)grouped[e.device]=Object.assign({},e,{tabs:tabs,since:since});else{prev.tabs=tabs;prev.since=since;}}});
      var users=Object.keys(grouped).map(function(k){var r=Object.assign({},grouped[k]);delete r.tabId;return r;}).sort(function(a,b){return a.since-b.since;});
      return {ok:true,status:'success',count:users.length,users:users,now:now};
    }catch(e){return {ok:false,error:'在線回報失敗',message:'在線回報失敗'};}finally{lock.releaseLock();}
  }

// ================= 管理員 =================
function checkAdmin_(pw) {
  const real = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD");
  return !!real && String(pw || "").trim() === String(real).trim();
}
// 管理員驗證：
//   1. 帶 adminToken（通行證）且有效 → 通過，並延長效期（不用再送密碼）
//   2. 帶 adminPassword → 驗證密碼；通過時發新通行證（issueToken=true 時）
//   密碼錯誤只鎖輸錯的那台電腦：裝置 ID 與內網 IP（偵測得到才用）分別計次
function adminAuth_(b, issueToken) {
  const cache = CacheService.getScriptCache();
  const sessTtl = ADMIN_SESSION_MINUTES * 60;
  if (b.adminToken && !b.adminPassword) {
    const key = "admsess_" + str_(b.adminToken, 80);
    const sid = cache.get(key);
    if (sid && sid === str_(b.sid || "unknown", 64)) {
      cache.put(key, sid, sessTtl);
      return { ok: true, adminToken: b.adminToken };
    }
    return { ok: false, expired: true, error: "管理員登入已逾時或已在別處登出，請重新輸入密碼解鎖" };
  }
  if (!String(b.adminPassword || "").trim()) return { ok: false, error: "這個操作需要管理員權限，請先輸入管理員密碼解鎖" };
  if (!PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD")) return { ok: false, error: "後端尚未設定管理員密碼：請到 Apps Script「專案設定 → 指令碼屬性」新增 ADMIN_PASSWORD" };
  const keys = ["admfail_dev_" + str_(b.sid || "unknown", 64)];
  const lan = (String(b.ip || "").match(/內:([0-9.]+)/) || [])[1];
  if (lan) keys.push("admfail_lan_" + lan);
  const now = new Date().getTime();
  const ttl = ADMIN_LOCK_MINUTES * 60;
  const recs = keys.map(k => { try { return JSON.parse(cache.get(k) || "{}") || {}; } catch (e) { return {}; } });
  const until = Math.max.apply(null, recs.map(r => r.until || 0));
  if (until > now) {
    return { ok: false, locked: true, error: "這台電腦密碼錯誤次數過多，已暫時鎖住，請 " + Math.ceil((until - now) / 60000) + " 分鐘後再試" };
  }
  if (checkAdmin_(b.adminPassword)) {
    keys.forEach(k => cache.remove(k));
    let token = "";
    if (issueToken) {
      token = Utilities.getUuid().replace(/-/g, "") + Math.random().toString(36).slice(2, 10);
      cache.put("admsess_" + token, str_(b.sid || "unknown", 64), sessTtl); // 通行證綁定這台裝置 ID
    }
    return { ok: true, status: "success", adminToken: token };
  }
  let maxN = 0;
  recs.forEach(r => { r.n = (r.n || 0) + 1; if (r.n > maxN) maxN = r.n; });
  const locked = maxN >= ADMIN_MAX_FAILS;
  keys.forEach((k, i) => cache.put(k, JSON.stringify(locked ? { n: 0, until: now + ttl * 1000 } : recs[i]), ttl));
  if (locked) return { ok: false, locked: true, error: "管理員密碼連續輸錯 " + ADMIN_MAX_FAILS + " 次，這台電腦暫時鎖住 " + ADMIN_LOCK_MINUTES + " 分鐘" };
  return { ok: false, remaining: ADMIN_MAX_FAILS - maxN, error: "管理員密碼不正確（再錯 " + (ADMIN_MAX_FAILS - maxN) + " 次這台電腦會暫時鎖住）" };
}

function getAdminLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ADMINLOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ADMINLOG_SHEET);
    sh.appendRow(["Time", "Action", "Record_ID", "Admin", "IP", "Device_ID", "Before(JSON)", "After(JSON)"]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function rowToObj_(row, map) {
  const o = {};
  DATA_HEADERS.forEach(h => { o[h] = row[map[h]] instanceof Date ? Utilities.formatDate(row[map[h]], "Asia/Taipei", "yyyy-MM-dd HH:mm:ss") : row[map[h]]; });
  return o;
}

function updateRecord_(b) {
  const sheet = getDataSheet_();
  const map = ensureHeaders_(sheet);
  const r = findRowById_(sheet, map, b.recordId);
  if (r < 0) return { status: "error", message: "找不到這筆回報（可能已被刪除），請重新同步" };
  const width = sheet.getLastColumn();
  const row = sheet.getRange(r, 1, 1, width).getValues()[0];
  const before = rowToObj_(row, map);
  const ch = b.changes || {};
  EDITABLE_FIELDS.forEach(f => {
    if (!(f in ch)) return;
    row[map[f]] = f === "Produced_Qty" ? (Number(ch[f]) || 0) : str_(ch[f], f === "Notes" ? 1000 : 60);
  });
  const who = str_(b.adminName, 40) || "管理員";
  row[map.Updated_At] = nowStr_();
  row[map.Updated_By] = who;
  sheet.getRange(r, 1, 1, width).setValues([row]);
  bumpRev_(["data", "edit"]);
  getAdminLogSheet_().appendRow([nowStr_(), "編輯", b.recordId, who, str_(b.ip, 80), str_(b.sid, 64), JSON.stringify(before), JSON.stringify(rowToObj_(row, map))]);
  return { status: "success", ok: true };
}

function deleteRecord_(b) {
  const sheet = getDataSheet_();
  const map = ensureHeaders_(sheet);
  const ids = Array.isArray(b.recordIds) ? b.recordIds : [b.recordId];
  const who = str_(b.adminName, 40) || "管理員";
  const log = getAdminLogSheet_();
  let deleted = 0;
  ids.forEach(id => {
    const r = findRowById_(sheet, map, id);
    if (r < 0) return;
    const before = rowToObj_(sheet.getRange(r, 1, 1, sheet.getLastColumn()).getValues()[0], map);
    sheet.deleteRow(r);
    log.appendRow([nowStr_(), "刪除", id, who, str_(b.ip, 80), str_(b.sid, 64), JSON.stringify(before), ""]);
    deleted++;
  });
  if (deleted) bumpRev_(["data", "edit"]);
  return { status: "success", ok: true, deleted: deleted };
}

// ================= 一鍵清除數據（測試數據快速刪除） =================
// body.from / body.to：'yyyy-MM-dd'（台灣時間，含當天）；都沒給 = 清除全部
// 清除前先把要刪的資料複製到新工作表「備份_yyyyMMdd_HHmmss」，標題列保留，歷史選單與 AdminLog 不動
function clearData_(b) {
  const sheet = getDataSheet_();
  const map = ensureHeaders_(sheet);
  const lastRow = sheet.getLastRow();
  const width = sheet.getLastColumn();
  if (lastRow < 2) return { status: "success", ok: true, cleared: 0, kept: 0, backup: "" };
  const header = sheet.getRange(1, 1, 1, width).getValues()[0];
  const rows = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(b.from || "") ? b.from : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(b.to || "") ? b.to : "";
  const dayOf = v => {
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? "" : Utilities.formatDate(d, "Asia/Taipei", "yyyy-MM-dd");
  };
  const hit = r => {
    if (!from && !to) return true;
    const day = dayOf(r[map.Timestamp]);
    if (!day) return false;
    return (!from || day >= from) && (!to || day <= to);
  };
  const del = rows.filter(hit);
  const keep = rows.filter(r => !hit(r));
  if (!del.length) return { status: "success", ok: true, cleared: 0, kept: keep.length, backup: "" };

  // 備份
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bkBase = "備份_" + Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd_HHmmss");
  let bkName = bkBase;
  for (let i = 2; ss.getSheetByName(bkName); i++) bkName = bkBase + "-" + i; // 同一秒清兩次時避免重名
  const bk = ss.insertSheet(bkName);
  bk.getRange(1, 1, 1, width).setValues([header]);
  bk.getRange(2, 1, del.length, width).setValues(del);
  bk.setFrozenRows(1);

  // 刪除：先清空資料區、寫回要保留的，再刪掉多出來的空白列
  // （不能一次 deleteRows 刪光：有凍結標題列時 Google 不允許刪除所有未凍結的列）
  sheet.getRange(2, 1, rows.length, width).clearContent();
  if (keep.length) sheet.getRange(2, 1, keep.length, width).setValues(keep);
  const firstExtra = Math.max(keep.length, 1) + 2;
  const maxRows = sheet.getMaxRows();
  if (maxRows >= firstExtra && lastRow >= firstExtra) sheet.deleteRows(firstExtra, Math.min(lastRow, maxRows) - firstExtra + 1);

  const scope = (from || to) ? (from || "最早") + " ~ " + (to || "最新") : "全部";
  bumpRev_(["data", "edit"]);
  getAdminLogSheet_().appendRow([nowStr_(), "一鍵清除（" + scope + "）", del.length + " 筆", str_(b.adminName, 40) || "管理員",
    str_(b.ip, 80), str_(b.sid, 64), "備份工作表：" + bkName, ""]);
  return { status: "success", ok: true, cleared: del.length, kept: keep.length, backup: bkName };
}


// ================= Telegram 通知 =================
function tgConfig_() {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty("TG_TOKEN") || "").trim();
  const chatId = String(props.getProperty("TG_CHAT_ID") || "").trim();
  let link = String(props.getProperty("TG_GROUP_LINK") || TG_GROUP_LINK || "").trim();
  if (!/^https?:\/\/\S+$/.test(link)) link = "";
  let notify = TG_NOTIFY_STATUSES.slice();
  const np = props.getProperty("TG_NOTIFY");
  if (np != null && String(np).trim() !== "") {
    const v = String(np).trim();
    notify = /^all$/i.test(v) ? TG_NOTIFY_STATUSES.slice() : /^(off|none|0)$/i.test(v) ? [] : v.split(/[,，、\s]+/).filter(String);
  }
  const ready = /^\d+:[\w-]{20,}$/.test(token) && /^-?\d+$/.test(chatId);
  return { token: token, chatId: chatId, link: link, notify: notify, ready: ready };
}

function tgEsc_(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tgSend_(html, plain) {
  const tg = tgConfig_();
  if (!tg.ready) return "skip: not configured";
  const url = "https://api.telegram.org/bot" + tg.token + "/sendMessage";
  const opt = (payload) => ({ method: "post", payload: payload, muteHttpExceptions: true });
  let r = UrlFetchApp.fetch(url, opt({ chat_id: tg.chatId, text: html, parse_mode: "HTML", disable_web_page_preview: "true" }));
  if (r.getResponseCode() === 200) return "sent";
  // HTML 格式有問題時改用純文字重送（跟圖面查詢系統同樣做法）
  r = UrlFetchApp.fetch(url, opt({ chat_id: tg.chatId, text: plain || html.replace(/<[^>]+>/g, ""), disable_web_page_preview: "true" }));
  if (r.getResponseCode() === 200) return "sent(plain)";
  console.error("Telegram 發送失敗：" + r.getResponseCode() + " " + r.getContentText());
  return "fail: " + r.getResponseCode();
}

// 回報送出後的群組通知
function notifyReportTelegram_(v, pageUrl) {
  const tg = tgConfig_();
  if (!tg.ready) return "skip: not configured";
  const st = String(v.Status || "");
  if (tg.notify.indexOf(st) < 0) return "skip: status " + st;
  const icon = st.indexOf("故障") >= 0 || st.indexOf("停機") >= 0 ? "🔴" : st.indexOf("保養") >= 0 ? "🟡" : "🟢";
  const devIcon = String(v.Device_Type || "").indexOf("手機") >= 0 ? "📱" : String(v.Device_Type || "").indexOf("平板") >= 0 ? "📟" : "💻";
  const who = (v.Dept ? "[" + v.Dept + "] " : "") + (v.Operator || "未填寫");
  const lines = [
    ["🏭 機台", v.Machine_ID || "--"],
    ["👷 回報人", who],
    ["📦 生產數量", String(v.Produced_Qty == null ? 0 : v.Produced_Qty)]
  ];
  if (v.Error_Code && v.Error_Code !== "無") lines.push(["⚠️ 異常代碼", v.Error_Code]);
  if (v.Notes) lines.push(["📝 備註", String(v.Notes).slice(0, 300)]);
  if (v.Photo_URL) lines.push(["📸 現場照片", '<a href="' + tgEsc_(v.Photo_URL) + '">點此檢視故障照片</a>']);
  const dev = [v.Device_Type, v.OS, v.Browser].filter(String).join(" · ");
  if (dev) lines.push([devIcon + " 裝置", dev]);
  lines.push(["🕒 時間", v.Timestamp || nowStr_()]);

  // 戰情室連結：由回報頁的網址推算（同資料夾的 index.html），只接受 http(s)
  let warroom = "";
  const pu = String(pageUrl || "").trim();
  if (/^https?:\/\/[^\s"<>]+$/.test(pu)) warroom = pu.split("#")[0].split("?")[0].replace(/[^\/]*$/, "") + "index.html";

  const title = icon + " 機台狀態回報｜" + st;
  const html = "<b>" + tgEsc_(title) + "</b>\n" +
    lines.map(l => tgEsc_(l[0]) + "：" + (l[0].indexOf("機台") >= 0 ? "<b>" + tgEsc_(l[1]) + "</b>" : tgEsc_(l[1]))).join("\n") +
    (warroom ? '\n\n<a href="' + tgEsc_(warroom) + '">查看許瑞興機台回報戰情室</a>' : "");
  const plain = title + "\n" + lines.map(l => l[0] + "：" + l[1]).join("\n") + (warroom ? "\n\n戰情室：" + warroom : "");
  return tgSend_(html, plain);
}

// 在 Apps Script 編輯器選這個函式按「執行」→ 群組會收到一則測試訊息（也會順便完成「連線到外部服務」授權）
function testTelegram() {
  const tg = tgConfig_();
  if (!tg.ready) throw new Error("Telegram 尚未設定：請到「專案設定 → 指令碼屬性」新增 TG_TOKEN、TG_CHAT_ID");
  const res = notifyReportTelegram_({
    Machine_ID: "CNC-TEST", Operator: "測試", Dept: "資訊課", Status: tg.notify[0] || "正常報工",
    Produced_Qty: 0, Error_Code: "", Notes: "這是測試訊息（testTelegram），可以忽略", Device_Type: "電腦", OS: "", Browser: "",
    Timestamp: nowStr_()
  }, "");
  console.log("testTelegram：" + res);
  return res;
}


// Telegram 共用群組唯讀授權檢查（2026-10-15）
// 在這個專案的 Apps Script 編輯器選 authorizeTelegramConnection 執行。
// 只讀取 Bot／群組資訊，不發送訊息、不設定 Webhook、不修改任何資料或設定。
function authorizeTelegramConnection() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ['https://www.googleapis.com/auth/script.external_request']);
  const props=PropertiesService.getScriptProperties();
  const token=String(props.getProperty('TG_TOKEN')||'').trim();
  const chatId=String(props.getProperty('TG_CHAT_ID')||'').trim();
  if(!token || !chatId)throw new Error('請先設定指令碼屬性 TG_TOKEN 與 TG_CHAT_ID；不會自動套用其他專案的設定。');
  const clean=value=>String(value).split(token).join('[Token已遮蔽]').replace(/https:\/\/api\.telegram\.org\/bot[^\s"'<>]+/gi,'[Telegram網址已遮蔽]').slice(0,700);
  function read(method,payload) {
    let response;
    try {response=UrlFetchApp.fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'post',contentType:'application/json',payload:JSON.stringify(payload),muteHttpExceptions:true});}
    catch(err){throw new Error(clean(err && err.message || err));}
    let body;try{body=JSON.parse(response.getContentText());}catch(err){throw new Error('Telegram 回應格式不正確。');}
    if(response.getResponseCode()!==200 || body.ok!==true) {
      const migration=body.parameters && body.parameters.migrate_to_chat_id;
      throw new Error('Telegram '+method+' 檢查失敗：'+clean(body.description||('HTTP '+response.getResponseCode()))+(migration?'；群組已升級，請將 TG_CHAT_ID 更新為 '+migration:''));
    }
    if(!body.result)throw new Error('Telegram '+method+' 未提供檢查資料。');
    return body.result;
  }
  const bot=read('getMe',{}),chat=read('getChat',{chat_id:chatId});
  const member=read('getChatMember',{chat_id:chatId,user_id:bot.id});
  if(['left','kicked'].includes(member.status) || (member.status==='restricted' && (!member.is_member || member.can_send_messages===false)))throw new Error('Bot 不在群組內或已被限制發言，請檢查群組權限。');
  const admin=['administrator','creator'].includes(member.status);
  if(!admin && chat.permissions && chat.permissions.can_send_messages===false)throw new Error('群組禁止一般成員發言，請允許 Bot 發訊息或設定適當群組權限。');
  if(chat.type==='channel' && (!admin || (member.status!=='creator' && member.can_post_messages!==true)))throw new Error('Bot 沒有此頻道的發文權限。');
  const sameGroup=String(chat.id)==='-5524528569';
  const result={ok:true,system:'機台回報戰情室',bot:bot.username||'',group:chat.title||'',sameSharedGroup:sameGroup,memberStatus:member.status,
    message:'Google 授權、Bot 與群組成員權限檢查通過。'+(sameGroup?'目前是本次共用群組。':'目前設定為其他群組，未變更設定。')+'未發送訊息；此結果不等於實際推播送達，請更新既有部署後再使用。'};
  Logger.log(JSON.stringify(result));return result;
}
