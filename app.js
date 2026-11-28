'use strict';
/* =====================================================================
   IT Asset Manager — runs fully in the browser (Chrome / Edge).
   Data lives in IndexedDB + optional linked JSON file (auto-save).
   ===================================================================== */

// ---------------- utils ----------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const low = s => norm(s).toLowerCase();
const normTag = s => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
const normKey = s => low(s).replace(/[^a-z0-9]/g, '');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON_N = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDate(s) {
  s = norm(s);
  if (!s || s === '-' || /^n\/?a$/i.test(s)) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[\s\-\/.]+([A-Za-z]+|\d{1,2})[\s\-\/.,]+(\d{2,4})$/);
  if (m) {
    const d = +m[1];
    const mo = /\d/.test(m[2]) ? +m[2] : MON[m[2].toLowerCase().slice(0, 3)];
    let y = +m[3]; if (y < 100) y += 2000;
    if (mo && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  if (/^\d{5}$/.test(s)) { // Excel serial date
    const dt = new Date(Date.UTC(1899, 11, 30) + (+s) * 864e5);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  return s; // keep as typed if not understood
}
function fmtDate(s) { if (!isISO(s)) return s || ''; const [y, m, d] = s.split('-'); return `${d} ${MON_N[+m - 1]} ${y}`; }
function daysSince(s) { if (!isISO(s)) return null; return Math.floor((Date.now() - new Date(s + 'T00:00:00')) / 864e5); }
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
  return fmtDate(iso.slice(0, 10));
}
const tidySize = s => norm(s).replace(/(\d)\s*(gb|tb|mb)\b/ig, (_, d, u) => `${d} ${u.toUpperCase()}`);
const matchQ = (hay, q) => { const t = low(q).split(' ').filter(Boolean); return t.every(x => hay.includes(x)); };
const initials = n => norm(n).split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?';
const natCmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
const uniqSorted = arr => [...new Set((arr || []).map(norm).filter(Boolean))].sort(natCmp);

function readImageFile(file, maxDim = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Please select an image file'));
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function renderBrand() {
  const s = (db && db.settings) || {};
  const org = s.org || 'IT';
  const sub = s.sub !== undefined ? s.sub : 'Assets · Employees · Software';
  const logo = s.logo || '';

  const orgEl = $('#org-name');
  if (orgEl) orgEl.textContent = org + ' · IT Assets';

  const subEl = $('#org-sub');
  if (subEl) subEl.textContent = sub;

  const logoEl = $('#brand-logo');
  if (logoEl) {
    if (logo) {
      logoEl.innerHTML = `<img src="${esc(logo)}" alt="${esc(org)}" style="width:100%;height:100%;object-fit:contain;border-radius:8px">`;
    } else {
      logoEl.textContent = initials(org) || 'IT';
    }
  }
}



// ---------------- constants ----------------
const ASSET_TYPES = ['Laptop', 'Desktop', 'Monitor', 'Mobile', 'SIM', 'Tablet', 'Mouse', 'Keyboard', 'Headphone', 'Camera', 'Lens', 'Drone', 'Gimbal', 'Mic', 'Storage', 'Network', 'Printer', 'Accessory', 'Other'];
const TYPE_ICON = { Laptop: '💻', Desktop: '🖥️', Monitor: '📺', Mobile: '📱', SIM: '📶', Tablet: '📲', Mouse: '🖱️', Keyboard: '⌨️', Headphone: '🎧', Camera: '📷', Lens: '🔭', Drone: '🛸', Gimbal: '🎥', Mic: '🎙️', Storage: '💾', Network: '🌐', Printer: '🖨️', Accessory: '🔌', Other: '📦' };
const TYPE_PREFIX = { Laptop: 'LAP', Desktop: 'CPU', Monitor: 'SCR', Mobile: 'MOB', SIM: 'SIM', Tablet: 'TAB', Mouse: 'MOU', Keyboard: 'KBD', Headphone: 'HPH', Camera: 'CAM', Lens: 'LNS', Drone: 'DRN', Gimbal: 'GMB', Mic: 'MIC', Storage: 'STG', Network: 'NET', Printer: 'PRN', Accessory: 'ACC', Other: 'OTH' };
const STATUSES = ['In Use', 'In Stock', 'Under Repair', 'Lost', 'Scrapped'];
const STATUS_CLS = { 'In Use': 'b-acc', 'In Stock': 'b-ok', 'Under Repair': 'b-warn', 'Lost': 'b-err', 'Scrapped': '' };
const EMP_STATUSES = ['Active', 'Notice Period', 'Exited', 'Blocked'];
const EMP_STATUS_CLS = { Active: 'b-ok', 'Notice Period': 'b-warn', Exited: 'b-err', Blocked: '' };
const LIC_TYPES = ['Paid', 'Subscription', 'Free', 'Open Source', 'Trial', 'Pirated'];
const MAINT_TYPES = ['RAM Upgrade', 'Storage Upgrade', 'Repair', 'OS Reinstall', 'Battery Replacement', 'Screen Replacement', 'Keyboard Replacement', 'Service / Cleaning', 'Other'];
const DEFAULT_LOCATIONS = ['Noida Sec-9', 'Noida Sec-4', 'Alwar', 'Jaipur', 'Nawabganj'];
const BAD_SERIALS = new Set(['', 'assemblesystem', 'na', 'none', 'nil', 'notavailable', 'no']);

function sanitizeLocations(locs) {
  if (!Array.isArray(locs)) locs = (typeof locs === 'string' ? locs.split(/[\r\n,;]+/) : DEFAULT_LOCATIONS);
  const out = [];
  locs.forEach(l => {
    l = norm(l);
    if (!l) return;
    if (l.includes('Noida Sec-9') && l.includes('Noida Sec-4')) {
      const parts = l.split(/(?=\b(?:Noida\s+Sec-\d+|Noida|Alwar|Jaipur|Nawabganj|Delhi|Gurgaon)\b)/i)
                     .map(s => norm(s)).filter(Boolean);
      out.push(...parts);
    } else {
      out.push(l);
    }
  });
  return uniqSorted(out.length ? out : DEFAULT_LOCATIONS);
}

function parseLocationInput(str) {
  if (!str) return [];
  let raw = String(str).split(/[\r\n,;]+/);
  const result = [];
  for (let item of raw) {
    item = norm(item);
    if (!item) continue;
    if (item.includes('Noida Sec-9') && item.includes('Noida Sec-4')) {
      const parts = item.split(/(?=\b(?:Noida\s+Sec-\d+|Noida|Alwar|Jaipur|Nawabganj|Delhi|Gurgaon|Mumbai|Bangalore)\b)/i)
                        .map(s => norm(s)).filter(Boolean);
      result.push(...parts);
    } else {
      result.push(item);
    }
  }
  return uniqSorted(result);
}

function getLocations() {
  const fromSettings = sanitizeLocations(db.settings?.locations);
  const fromEmps = (db.employees || []).map(e => norm(e.location)).filter(Boolean);
  const fromAssets = (db.assets || []).map(a => norm(a.location)).filter(Boolean);
  return uniqSorted([...fromSettings, ...fromEmps, ...fromAssets]);
}

const DEFAULT_DEPARTMENTS = [
  'Technology', 'Product & Design', 'Marketing & Content', 'Human Resources',
  'Finance', 'Sales', 'Retail', 'Operations', 'Procurement', 'Call Centre',
  'IT & Admin', 'SEO', 'Content', 'Business Operations', 'Auction'
];

const DEFAULT_COMPANIES = [
  'FarmJunction', 'AgroWheels', 'BikeJunction', 'Dhanrise', 'Yellowtork', 'FinJ'
];

function getDepartments() {
  const fromSettings = Array.isArray(db.settings?.departments) && db.settings.departments.length ? db.settings.departments : DEFAULT_DEPARTMENTS;
  const fromEmps = (db.employees || []).map(e => norm(e.department)).filter(Boolean);
  const fromAssets = (db.assets || []).map(a => norm(a.department)).filter(Boolean);
  return uniqSorted([...fromSettings, ...fromEmps, ...fromAssets]);
}

function getCompanies() {
  const fromSettings = Array.isArray(db.settings?.companies) && db.settings.companies.length ? db.settings.companies : DEFAULT_COMPANIES;
  const fromEmps = (db.employees || []).map(e => norm(e.company)).filter(Boolean);
  return uniqSorted([...fromSettings, ...fromEmps]);
}

function getAssetTypes() {
  const fromSettings = Array.isArray(db.settings?.assetTypes) && db.settings.assetTypes.length ? db.settings.assetTypes : ASSET_TYPES;
  const fromAssets = (db.assets || []).map(a => norm(a.type)).filter(Boolean);
  return uniqSorted([...fromSettings, ...fromAssets]);
}

function getActiveFields(baseFields, target) {
  const custom = (target === 'employee' ? db.settings?.customEmpFields : db.settings?.customAssetFields) || [];
  if (!custom.length) return baseFields;
  const extra = custom.map(cf => ({
    k: cf.k,
    l: cf.l,
    t: cf.t || 'text',
    opts: cf.opts || [],
    full: !!cf.full,
    isCustom: true
  }));
  return [...baseFields, { title: 'Custom / Extra Fields' }, ...extra];
}

const EMP_FIELDS = [
  { k: 'empCode', l: 'Emp Code' }, { k: 'name', l: 'Full Name', req: true }, { k: 'email', l: 'Email', t: 'email' },
  { k: 'phone', l: 'Mobile Number' }, { k: 'designation', l: 'Designation', list: 'designation' }, 
  { k: 'department', l: 'Department', t: 'select', opts: () => getDepartments() },
  { k: 'location', l: 'Location', t: 'select', opts: () => getLocations() }, 
  { k: 'company', l: 'Company / Payroll', t: 'select', opts: () => getCompanies() }, 
  { k: 'doj', l: 'Date of Joining', t: 'date' },
  { k: 'band', l: 'Band / Grade' }, { k: 'status', l: 'Status', t: 'select', opts: EMP_STATUSES }, { k: 'exitDate', l: 'Exit Date', t: 'date' },
  { k: 'notes', l: 'Notes', t: 'textarea', full: true },
];
const ASSET_FIELDS = [
  { title: 'Device' },
  { k: 'tag', l: 'Asset Tag', req: true, suggest: true }, 
  { k: 'type', l: 'Type', t: 'select', opts: () => getAssetTypes() }, 
  { k: 'status', l: 'Status', t: 'select', opts: STATUSES },
  { k: 'make', l: 'Make / Brand', list: 'make' }, { k: 'model', l: 'Model' }, { k: 'serialNo', l: 'Serial No' },
  { k: 'hostname', l: 'Hostname' }, { k: 'processor', l: 'Processor', list: 'processor' }, { k: 'ram', l: 'RAM' }, { k: 'storage', l: 'Storage (HDD/SSD)' },
  { k: 'os', l: 'OS', list: 'os' }, { k: 'osLicense', l: 'OS Licence', t: 'select', opts: ['', 'Genuine', 'Not Genuine', 'Open Source', 'NA'] }, { k: 'domainJoin', l: 'Domain Join', t: 'select', opts: ['', 'Yes', 'No', 'NA'] },
  { k: 'imei', l: 'IMEI (mobiles)' }, { k: 'simNumber', l: 'SIM Number(s)' }, { k: 'screenTag', l: 'Screen / Monitor Tag' },
  { k: 'accessories', l: 'Accessories given (charger, mouse…)', full: true },
  { k: 'condition', l: 'Working Condition', t: 'select', opts: ['Good', 'Fair', 'Poor', 'Dead'] }, { k: 'physical', l: 'Physical Status' }, { k: 'qsync', l: 'Backup (QSync)' },
  { title: 'Assignment' },
  { k: 'empCode', l: 'Assigned To (Emp Code)', list: 'emp' }, { k: 'holderName', l: 'Holder Name' }, { k: 'holderEmail', l: 'Holder Email' },
  { k: 'department', l: 'Department', t: 'select', opts: () => getDepartments() }, 
  { k: 'location', l: 'Location', t: 'select', opts: () => getLocations() }, 
  { k: 'allocatedDate', l: 'Allocated Date', t: 'date' },
  { title: 'Purchase, Warranty & Depreciation' },
  { k: 'cost', l: 'Purchase Cost (₹)', t: 'number' }, { k: 'purchaseDate', l: 'Purchase Date', t: 'date' }, { k: 'vendor', l: 'Vendor' },
  { k: 'invoiceNo', l: 'Invoice / Bill No' }, { k: 'warrantyEnd', l: 'Warranty Ends', t: 'date' },
  { k: 'deprecRate', l: 'Depreciation (%/yr)', t: 'number' }, { k: 'engineer', l: 'Engineer', list: 'engineer' },
  { k: 'extra', l: 'Extra device / GPU' }, { k: 'remarks', l: 'Remarks', t: 'textarea', full: true },
];
const SW_FIELDS = [
  { k: 'name', l: 'Software Name', req: true }, { k: 'version', l: 'Version / Edition' }, { k: 'category', l: 'Category', list: 'swcat' },
  { k: 'licenseType', l: 'Licence Type', t: 'select', opts: LIC_TYPES }, { k: 'vendor', l: 'Vendor' }, { k: 'totalSeats', l: 'Total Seats / Licences', t: 'number' },
  { k: 'cost', l: 'Cost (₹ / year)', t: 'number' }, { k: 'expiry', l: 'Renewal / Expiry', t: 'date' }, { k: 'departments', l: 'Departments using it', full: true },
  { k: 'notes', l: 'Notes (PO, licence reference — no passwords)', t: 'textarea', full: true },
];

const DEFAULT_IT_TEAM = [
  'Ashay Jain (Manager)',
  'Mo Vaseem',
  'Anis Singh Solanki',
  'Vikash Meena'
];

const DEFAULT_ROLE_PERMS = {
  it_admin: {
    name: 'IT Admin',
    badgeCls: 'role-it',
    icon: '👑',
    desc: 'Full administrative access to all modules and configurations',
    pages: ['dashboard', 'tickets', 'employees', 'assets', 'software', 'maintenance', 'onboarding', 'history', 'issues', 'import', 'settings'],
    actions: {
      canRaiseTicket: true,
      canViewAllTickets: true,
      canAssignTicket: true,
      canResolveTicket: true,
      canAddEditEmp: true,
      canViewAssetsInEmp: true,
      canAddEditAsset: true,
      canAssignAsset: true,
      canDelete: true,
      canExportCSV: true,
      canManageSoftware: true,
      canManageMaint: true,
      canManageOnboarding: true
    }
  },
  employee: {
    name: 'Employee (Self-Service)',
    badgeCls: 'role-emp',
    icon: '👤',
    desc: 'Self-service IT helpdesk portal: raise tickets, track SLA countdown, view assigned assets',
    pages: ['tickets'],
    actions: {
      canRaiseTicket: true,
      canViewAllTickets: false,
      canAssignTicket: false,
      canResolveTicket: false,
      canAddEditEmp: false,
      canViewAssetsInEmp: true,
      canAddEditAsset: false,
      canAssignAsset: false,
      canDelete: false,
      canExportCSV: false,
      canManageSoftware: false,
      canManageMaint: false,
      canManageOnboarding: false
    }
  },
  hr: {
    name: 'HR Team',
    badgeCls: 'role-hr',
    icon: '👤',
    desc: 'Manages employee directory and submits new joining IT email requests',
    pages: ['employees', 'onboarding', 'tickets'],
    actions: {
      canRaiseTicket: true,
      canViewAllTickets: false,
      canAssignTicket: false,
      canResolveTicket: false,
      canAddEditEmp: true,
      canViewAssetsInEmp: false,
      canAddEditAsset: false,
      canAssignAsset: false,
      canDelete: false,
      canExportCSV: true,
      canManageSoftware: false,
      canManageMaint: false,
      canManageOnboarding: false
    }
  },
  viewer: {
    name: 'Read-Only Viewer',
    badgeCls: 'role-viewer',
    icon: '👁️',
    desc: 'Can view dashboard, employees, and assets without making any modifications',
    pages: ['dashboard', 'tickets', 'employees', 'assets'],
    actions: {
      canRaiseTicket: false,
      canViewAllTickets: true,
      canAssignTicket: false,
      canResolveTicket: false,
      canAddEditEmp: false,
      canViewAssetsInEmp: true,
      canAddEditAsset: false,
      canAssignAsset: false,
      canDelete: false,
      canExportCSV: false,
      canManageSoftware: false,
      canManageMaint: false,
      canManageOnboarding: false
    }
  },
  finance: {
    name: 'Finance / Auditor',
    badgeCls: 'role-finance',
    icon: '💼',
    desc: 'Access to Asset counts, Software licenses & costs for financial auditing',
    pages: ['dashboard', 'tickets', 'assets', 'software'],
    actions: {
      canRaiseTicket: false,
      canViewAllTickets: true,
      canAssignTicket: false,
      canResolveTicket: false,
      canAddEditEmp: false,
      canViewAssetsInEmp: true,
      canAddEditAsset: false,
      canAssignAsset: false,
      canDelete: false,
      canExportCSV: true,
      canManageSoftware: false,
      canManageMaint: false,
      canManageOnboarding: false
    }
  }
};

const ALL_PAGES = ['dashboard', 'tickets', 'onboarding', 'employees', 'assets', 'software', 'maintenance', 'history', 'issues', 'import', 'settings'];

const ALL_PAGES_META = [
  { k: 'dashboard', l: '📊 Dashboard', desc: 'Overview metrics, charts & health alerts' },
  { k: 'tickets', l: '🎫 IT Helpdesk & Tickets', desc: 'Employee issue resolution, IT assignment & SLA management' },
  { k: 'employees', l: '👥 Employees', desc: 'Employee directory & profiles' },
  { k: 'assets', l: '💻 Assets', desc: 'All hardware (Laptops, Desktops, Mobiles, SIMs)' },
  { k: 'software', l: '🧩 Software', desc: 'Software applications & licenses' },
  { k: 'maintenance', l: '🛠️ Maintenance', desc: 'Repair logs & upgrade history' },
  { k: 'onboarding', l: '📋 New Joining Requests', desc: 'HR email requests & IT provisioning' },
  { k: 'history', l: '🕒 Audit History', desc: 'Log of all additions, edits & allocations' },
  { k: 'issues', l: '⚠️ Data Issues', desc: 'Data integrity checks & missing tags' },
  { k: 'import', l: '📥 Import / Export', desc: 'Bulk data upload and system backups' }
];

const ALL_ACTIONS_META = [
  { k: 'canRaiseTicket', l: '🎫 Raise IT Support Tickets', desc: 'Submit helpdesk queries and issue requests' },
  { k: 'canViewAllTickets', l: '👁️ View All Company Tickets', desc: 'IT Team access to view all employee tickets' },
  { k: 'canAssignTicket', l: '🎯 Assign Tickets to IT Team', desc: 'IT Manager capability to delegate tickets to team members' },
  { k: 'canResolveTicket', l: '✅ Resolve & Close Tickets', desc: 'Update ticket status and provide technical resolution' },
  { k: 'canAddEditEmp', l: '👤 Add & Edit Employees', desc: 'Create new employee profiles or update existing ones' },
  { k: 'canViewAssetsInEmp', l: '💻 View Assets in Employee Profile', desc: 'Show assigned asset tags & specs in employee drawer & list' },
  { k: 'canAddEditAsset', l: '➕ Add & Edit Assets', desc: 'Create new asset records, edit specifications & status' },
  { k: 'canAssignAsset', l: '🔄 Assign & Return Assets', desc: 'Allocate hardware to employees, transfer, or return to stock' },
  { k: 'canDelete', l: '🗑️ Delete Records', desc: 'Delete employees, assets, or software records' },
  { k: 'canExportCSV', l: '📥 Export CSV Data', desc: 'Download CSV reports for employees, assets, etc.' },
  { k: 'canManageSoftware', l: '🧩 Manage Software Licenses', desc: 'Add, edit, or allocate software licenses to employees' },
  { k: 'canManageMaint', l: '🛠️ Manage Maintenance', desc: 'Log maintenance, hardware upgrades & repair status' },
  { k: 'canManageOnboarding', l: '✉️ Process IT Email Provisioning', desc: 'Create official work emails & mark onboarding completed' }
];

// --- Helpdesk & SLA Engine Constants ---
const TICKET_SLA_HOURS = {
  'Critical': 4,
  'High': 8,
  'Medium': 24,
  'Low': 48
};

const TICKET_CATEGORIES = [
  'Hardware / Laptop Issue',
  'Software / Application Issue',
  'Network / Wi-Fi / VPN',
  'Email & Google Workspace',
  'Peripherals (Mouse, Keyboard, Screen)',
  'Access & Permissions',
  'Other / General IT Query'
];

const TICKET_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const TICKET_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed', 'Cancelled'];

const TICKET_PRIORITY_CLS = {
  'Critical': 'b-err',
  'High': 'b-warn',
  'Medium': 'b-acc',
  'Low': 'badge'
};

const TICKET_STATUS_CLS = {
  'Open': 'b-warn',
  'In Progress': 'b-acc',
  'Resolved': 'b-ok',
  'Closed': 'badge',
  'Cancelled': 'muted'
};

function getTicketSLA(t) {
  const created = t.createdAt ? new Date(t.createdAt).getTime() : Date.now();
  const slaHours = t.slaHours || TICKET_SLA_HOURS[t.priority] || 24;
  const due = t.slaDueAt ? new Date(t.slaDueAt).getTime() : (created + slaHours * 3600 * 1000);
  const isFinished = t.status === 'Resolved' || t.status === 'Closed';

  if (isFinished) {
    const end = t.resolvedAt ? new Date(t.resolvedAt).getTime() : Date.now();
    const durationHours = Math.max(0.1, ((end - created) / (3600 * 1000))).toFixed(1);
    if (end <= due) {
      return {
        status: 'ok',
        badgeCls: 'sla-badge ok',
        label: `🟢 Met SLA (${durationHours}h)`,
        detail: `Resolved on time in ${durationHours} hrs (Target: ${slaHours}h)`
      };
    } else {
      const overdueHours = Math.max(0.1, ((end - due) / (3600 * 1000))).toFixed(1);
      return {
        status: 'breached',
        badgeCls: 'sla-badge err',
        label: `🔴 Breached (+${overdueHours}h)`,
        detail: `Resolved after SLA breach by ${overdueHours} hrs`
      };
    }
  }

  const now = Date.now();
  const diffMs = due - now;
  const diffHrs = diffMs / (3600 * 1000);

  if (diffMs <= 0) {
    const overdueHrs = Math.abs(diffHrs).toFixed(1);
    return {
      status: 'breached',
      badgeCls: 'sla-badge err',
      label: `🔴 Breached (${overdueHrs}h overdue)`,
      detail: `SLA Overdue by ${overdueHrs} hours`
    };
  } else if (diffHrs <= 2) {
    const mins = Math.max(1, Math.round(diffMs / (60 * 1000)));
    return {
      status: 'warn',
      badgeCls: 'sla-badge warn',
      label: `🟡 Due Soon (${mins}m)`,
      detail: `Only ${mins} minutes left before SLA breach!`
    };
  } else {
    const leftHrs = Math.round(diffHrs);
    return {
      status: 'ok',
      badgeCls: 'sla-badge ok',
      label: `🟢 Within SLA (${leftHrs}h left)`,
      detail: `${leftHrs} hours remaining (Target: ${slaHours}h)`
    };
  }
}

// ---------------- data ----------------
function emptyDb() {
  return {
    version: 1, employees: [], assets: [], software: [], swAssign: [], maint: [], history: [], onboarding: [], tickets: [], handovers: [],
    settings: {
      org: 'TractorJunction',
      sub: 'Assets · Employees · Software',
      logo: '',
      engineer: 'Mo Vaseem',
      itTeam: [...DEFAULT_IT_TEAM],
      rolePermissions: JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMS)),
      userRoleOverrides: {},
      knownUsers: [],
      orgDomain: 'tractorjunction.com',
      deprecRateDefault: 20,
      webhookUrl: '',
      theme: '',
      lastBackup: '',
      locations: [...DEFAULT_LOCATIONS],
      departments: [...DEFAULT_DEPARTMENTS],
      companies: [...DEFAULT_COMPANIES],
      assetTypes: [...ASSET_TYPES],
      customEmpFields: [],
      customAssetFields: []
    },
  };
}
let db = emptyDb();
let IX = {};

function getITTeam() {
  if (Array.isArray(db.settings.itTeam) && db.settings.itTeam.length) {
    return db.settings.itTeam;
  }
  return [...DEFAULT_IT_TEAM];
}
function suggestEmail(name) {
  if (!name) return '';
  const parts = low(name).trim().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const domain = db.settings.orgDomain || 'tractorjunction.com';
  if (parts.length === 1) return `${parts[0]}@${domain}`;
  return `${parts[0]}.${parts[parts.length - 1]}@${domain}`;
}
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pass = 'TJ@';
  for (let i = 0; i < 5; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  return pass + '#26';
}
function updateEmailTaskBadge() {
  const list = db.onboarding || [];
  const pending = list.filter(r => r.status === 'Pending' || r.status === 'In Progress').length;
  const isUrgent = list.some(r => r.status === 'Pending' && r.priority === 'Urgent');
  
  const topCount = $('#top-email-count');
  if (topCount) {
    topCount.textContent = pending || '';
    topCount.classList.toggle('urgent', isUrgent);
  }
  const topBtn = $('#top-email-req');
  if (topBtn) {
    topBtn.classList.toggle('has-tasks', pending > 0);
  }
  const navCount = $('#email-req-count');
  if (navCount) {
    navCount.textContent = pending || '';
    navCount.classList.toggle('urgent', isUrgent);
  }
}
function updateTicketBadge() {
  const tickets = db.tickets || [];
  const activeTickets = tickets.filter(t => t.status === 'Open' || t.status === 'In Progress');
  const count = activeTickets.length;
  const isBreached = activeTickets.some(t => getTicketSLA(t).status === 'breached');
  
  const navBadge = $('#ticket-badge');
  if (navBadge) {
    navBadge.textContent = count || '';
    navBadge.classList.toggle('urgent', isBreached);
  }
}
function calcAssetValuation(a) {
  const cost = +a.cost || +a.purchaseCost || 0;
  if (!cost) return { cost: 0, bookValue: 0, deprec: 0, ageYears: 0 };
  const pDate = a.purchaseDate ? new Date(a.purchaseDate) : null;
  const now = new Date();
  const ageYears = pDate && !isNaN(pDate) ? Math.max(0, (now - pDate) / (1000 * 60 * 60 * 24 * 365.25)) : 0;
  const rate = (+a.deprecRate || +db.settings.deprecRateDefault || 20) / 100;
  const bookValue = Math.max(0, Math.round(cost * Math.pow(Math.max(0, 1 - rate), ageYears)));
  const deprec = cost - bookValue;
  return { cost, bookValue, deprec, ageYears: +ageYears.toFixed(1) };
}
async function getQRCodeDataURL(text, size = 180) {
  if (window.QRCode && typeof window.QRCode.toDataURL === 'function') {
    try {
      return await window.QRCode.toDataURL(text, { width: size, margin: 1 });
    } catch (_) {}
  }
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
}
function sendWhatsApp(phone, message) {
  const raw = String(phone || '').replace(/[^0-9]/g, '');
  if (!raw) return toast('Phone number not available for WhatsApp', 'warn');
  const num = raw.length === 10 ? '91' + raw : raw;
  const url = `https://api.whatsapp.com/send?phone=${num}&text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}
function initSigPad(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth || 500;
  canvas.height = canvas.offsetHeight || 150;
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let drawing = false, drawn = false;

  const getPos = e => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: cx - rect.left, y: cy - rect.top };
  };
  const start = e => {
    e.preventDefault();
    drawing = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = e => {
    if (!drawing) return;
    e.preventDefault();
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    drawn = true;
  };
  const stop = e => {
    if (drawing) {
      drawing = false;
      ctx.closePath();
    }
  };
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', stop);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', stop);

  return {
    clear: () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawn = false;
    },
    toDataURL: () => drawn ? canvas.toDataURL('image/png') : '',
    isEmpty: () => !drawn
  };
}

function empKeys(e) { return [e.empCode, e.email, e.name].filter(Boolean).map(low); }
function holderKey(a) { return a.empCode || a.holderEmail || a.holderName || ''; }
function hasHolder(a) { return !!(a.empCode || a.holderName || a.holderEmail); }
function simList(s) { return (String(s || '').replace(/[\s-]/g, '').match(/\d{10,13}/g) || []).map(x => x.slice(-10)); }
function imeiList(s) { return (String(s || '').match(/\d{14,16}/g) || []); }
function serialKey(s) { const k = normKey(s); return BAD_SERIALS.has(k) || k.length < 5 ? '' : k; }

function indexAsset(a) {
  IX.assetId.set(a.id, a); IX.tag.set(normTag(a.tag), a);
  const sk = serialKey(a.serialNo); if (sk) IX.serial.set(sk, a);
  imeiList(a.imei).forEach(x => IX.imei.set(x, a));
  simList(a.simNumber).forEach(x => IX.sim.set(x, a));
}
function indexEmp(e) {
  IX.empId.set(e.id, e);
  if (e.empCode) IX.empCode.set(normTag(e.empCode), e);
  if (e.email) IX.empEmail.set(low(e.email), e);
}
function holderOf(a) {
  if (a.empCode) { const e = IX.empCode.get(normTag(a.empCode)); if (e) return e; }
  if (a.holderEmail) { const e = IX.empEmail.get(low(a.holderEmail)); if (e) return e; }
  return null;
}
function reindex() {
  IX = { empId: new Map(), empCode: new Map(), empEmail: new Map(), assetId: new Map(), tag: new Map(), serial: new Map(), imei: new Map(), sim: new Map(), byEmp: new Map(), swId: new Map() };
  db.employees.forEach(indexEmp);
  db.assets.forEach(indexAsset);
  db.software.forEach(s => IX.swId.set(s.id, s));
  for (const a of db.assets) {
    if (!hasHolder(a)) continue;
    const h = holderOf(a); if (!h) continue;
    if (!IX.byEmp.has(h.id)) IX.byEmp.set(h.id, []);
    IX.byEmp.get(h.id).push(a);
  }
}
const assetsOf = e => IX.byEmp.get(e.id) || [];
const holderName = a => { const h = holderOf(a); return h ? h.name : (a.holderName || a.holderEmail || a.empCode || ''); };
function log(tag, action, detail, who = []) {
  const h = { id: uid(), ts: new Date().toISOString(), tag: tag || '', action, detail: detail || '', who: who.filter(Boolean).map(low), by: db.settings.engineer || '' };
  db.history.unshift(h);
  if (db.history.length > 20000) db.history.length = 20000;
  markDirty('history', h);
}
const hayEmp = e => low([e.empCode, e.name, e.email, e.phone, e.designation, e.department, e.location, e.company].join(' '));
const hayAsset = a => low([a.tag, a.type, a.make, a.model, a.serialNo, a.imei, a.simNumber, a.hostname, a.screenTag, a.holderName, a.holderEmail, a.empCode, holderName(a), a.department, a.processor, a.os, a.ram, a.status, a.remarks, a.location, a.accessories].join(' '));
function osFamily(os) {
  const s = low(os); if (!s || s === '-') return 'Unknown';
  if (/mac/.test(s)) return 'macOS'; if (/ubuntu|linux/.test(s)) return 'Ubuntu / Linux';
  if (/win/.test(s)) { const v = (s.match(/\d+/) || [''])[0]; return `Windows ${v}${/pro/.test(s) ? ' Pro' : /home/.test(s) ? ' Home' : ''}`.replace(/\s+/g, ' ').trim(); }
  return norm(os);
}
function typeFromTag(tag) {
  const t = normTag(tag);
  if (t.startsWith('EXT-SCR') || t.startsWith('SCR')) return 'Monitor';
  const p = t.split('-')[0];
  return Object.keys(TYPE_PREFIX).find(k => TYPE_PREFIX[k] === p) || '';
}
const TYPE_ALIASES = [[/laptop|notebook|macbook/i, 'Laptop'], [/desktop|cpu|^pc$/i, 'Desktop'], [/monitor|moniter|^screen/i, 'Monitor'], [/^sim\b/i, 'SIM'],
  [/phone|mobile|iphone/i, 'Mobile'], [/tablet|ipad/i, 'Tablet'], [/mouse/i, 'Mouse'], [/keyboard/i, 'Keyboard'], [/head ?phone/i, 'Headphone'],
  [/^camera$|action cam|^camera\b(?! ?(bag|battery))/i, 'Camera'], [/^lens$/i, 'Lens'], [/drone/i, 'Drone'], [/gimbal/i, 'Gimbal'], [/^mic$/i, 'Mic'],
  [/hard ?disk|memory card|ssd|hdd|pen ?drive|storage/i, 'Storage'], [/router|switch|network|access point/i, 'Network'], [/printer/i, 'Printer']];
function normType(s, fallback = 'Other') {
  const v = norm(s); if (!v) return '';
  const exact = ASSET_TYPES.find(t => t.toLowerCase() === v.toLowerCase()); if (exact) return exact;
  for (const [re, t] of TYPE_ALIASES) if (re.test(v)) return t;
  return fallback;
}
function nextTag(type) {
  const p = TYPE_PREFIX[type] || 'AST'; let max = 0;
  for (const a of db.assets) { const m = normTag(a.tag).match(new RegExp('^' + p + '-(\\d+)$')); if (m) max = Math.max(max, +m[1]); }
  return `${p}-${String(max + 1).padStart(max >= 100 ? 1 : 3, '0')}`;
}
const validEmpCode = c => /^[A-Z]{1,4}-?[A-Z]?\d{2,}$/i.test(norm(c));

// ---------------- validation (duplicate checks) ----------------
function validateEmployee(r, selfId) {
  const errs = [], warns = [];
  if (!norm(r.name)) errs.push('Name is required.');
  if (r.empCode) {
    const ex = IX.empCode.get(normTag(r.empCode));
    if (ex && ex.id !== selfId) errs.push(`Duplicate Emp Code: ${r.empCode} already belongs to ${ex.name}.`);
    if (!validEmpCode(r.empCode)) warns.push(`Emp Code "${r.empCode}" looks unusual.`);
  }
  if (r.email) {
    if (!EMAIL_RE.test(r.email)) errs.push(`Email "${r.email}" is not a valid email address.`);
    const ex = IX.empEmail.get(low(r.email));
    if (ex && ex.id !== selfId) errs.push(`Duplicate Email: ${r.email} already belongs to ${ex.name} (${ex.empCode || 'no code'}).`);
  }
  return { errs, warns };
}
function validateAsset(r, selfId) {
  const errs = [], warns = [];
  const tag = normTag(r.tag);
  if (!tag) errs.push('Asset Tag is required.');
  else if (!/\d/.test(tag)) errs.push(`Asset Tag "${r.tag}" is incomplete (no number).`);
  const desc = a => `${a.tag} (${a.type || 'asset'}${hasHolder(a) ? ', with ' + holderName(a) : ', ' + (a.status || '')})`;
  const exT = IX.tag.get(tag);
  if (tag && exT && exT.id !== selfId) errs.push(`Duplicate Asset Tag: ${tag} already exists → ${desc(exT)}.`);
  const sk = serialKey(r.serialNo);
  if (sk) { const ex = IX.serial.get(sk); if (ex && ex.id !== selfId) errs.push(`Duplicate Serial No "${r.serialNo}" — already on ${desc(ex)}.`); }
  for (const x of imeiList(r.imei)) { const ex = IX.imei.get(x); if (ex && ex.id !== selfId) errs.push(`Duplicate IMEI ${x} — already on ${desc(ex)}.`); }
  for (const x of simList(r.simNumber)) { const ex = IX.sim.get(x); if (ex && ex.id !== selfId) errs.push(`Duplicate SIM number ${x} — already on ${desc(ex)}.`); }
  if (r.holderEmail && !EMAIL_RE.test(r.holderEmail)) warns.push(`Holder email "${r.holderEmail}" looks invalid.`);
  if (hasHolder(r)) {
    const h = holderOf(r);
    if (!h) warns.push(`Holder "${r.holderName || r.empCode || r.holderEmail}" is not in the employee master.`);
    else {
      if (h.status === 'Exited') warns.push(`${h.name} is marked as Exited.`);
      const same = assetsOf(h).filter(a => a.id !== selfId && a.type === r.type && ['Laptop', 'Desktop', 'Mobile'].includes(r.type));
      if (same.length) warns.push(`${h.name} already holds ${same.map(a => a.tag).join(', ')} (${r.type}).`);
    }
  }
  return { errs, warns };
}
function validateSoftware(r, selfId) {
  const errs = [];
  if (!norm(r.name)) errs.push('Software name is required.');
  const k = normKey(r.name) + '|' + normKey(r.version);
  const ex = db.software.find(s => s.id !== selfId && normKey(s.name) + '|' + normKey(s.version) === k);
  if (ex) errs.push(`Duplicate: "${ex.name}${ex.version ? ' ' + ex.version : ''}" already exists in the catalogue.`);
  return { errs, warns: [] };
}

// ---------------- storage & Supabase cloud sync ----------------
const SUPABASE_CONFIG = {
  url: 'https://sjvaxlydywtlmumbbolq.supabase.co',
  anonKey: 'sb_publishable_rvFCvCCIQpiYr7RkHdK8Ew_ImATC2OE'
};

const INITIAL_AUTH_URL = window.location.href;
let sbClient = null;
let sbOnline = false;
let sbSyncInProgress = false;
let sbCloudSyncTimer = null;

const deletedQueue = {
  employees: new Set(),
  assets: new Set(),
  software: new Set(),
  sw_assign: new Set(),
  maint: new Set()
};

const dirtyQueue = {
  employees: new Map(),
  assets: new Map(),
  software: new Map(),
  sw_assign: new Map(),
  maint: new Map(),
  history: new Map(),
  settings: false,
  fullSync: false
};

function queueDelete(table, id) {
  if (deletedQueue[table]) deletedQueue[table].add(id);
  if (dirtyQueue[table]) dirtyQueue[table].delete(id);
}

function markDirty(table, item) {
  if (dirtyQueue[table] && item && item.id) dirtyQueue[table].set(item.id, item);
}

function initSupabase() {
  try {
    if (window.supabase && SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey) {
      sbClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
      return sbClient;
    }
  } catch (err) {
    console.error('Supabase init failed:', err);
  }
  return null;
}

// ---------------- User Roles & Dynamic Permissions ----------------
let currentUser = null; // { id: string, email: string, role: string }

function getUserRole() {
  if (!currentUser) return 'employee'; // unauthenticated fallback
  const email = (currentUser.email || '').toLowerCase().trim();

  // 1. PRIMARY SUPER ADMIN / ENGINEER: Mo Vaseem is ALWAYS it_admin! (Can NEVER be demoted)
  const phone = cleanPhone(currentUser?.phone || '');
  if (phone === '8881709248') return 'it_admin';
  const eng = (db.settings?.engineer || '').toLowerCase();
  if (
    email.includes('vaseem') || 
    email === 'movaseem@tractorjunction.com' ||
    (eng && (email === eng || eng.includes(email.split('@')[0])))
  ) {
    return 'it_admin';
  }

  // 2. Custom role overrides assigned by IT Admin for other users
  if (db.settings && db.settings.userRoleOverrides && db.settings.userRoleOverrides[email]) {
    return db.settings.userRoleOverrides[email];
  }

  if (currentUser.role) return currentUser.role;
  if (email.includes('hr')) return 'hr';
  const isIT = (db.settings?.itTeam || []).some(t => {
    const tLow = t.toLowerCase();
    const namePart = email.split('@')[0].replace(/[._-]/g, ' ');
    return tLow.includes(email) || tLow.includes(namePart);
  });
  if (isIT) return 'it_admin';
  return 'employee';
}

function isUserAuthorized(email) {
  if (currentUser && currentUser.phone && findUserByMobile(currentUser.phone)) return true;
  if (!email) return false;
  const e = email.toLowerCase().trim();
  const eng = (db.settings?.engineer || '').toLowerCase();
  if (eng && (e.includes('vaseem') || eng.includes(e.split('@')[0]))) return true;
  if (e.includes('vaseem') || e === 'movaseem@tractorjunction.com') return true;
  if (db.settings?.userRoleOverrides && db.settings.userRoleOverrides[e]) return true;
  if (Array.isArray(db.settings?.knownUsers) && db.settings.knownUsers.some(u => (u || '').toLowerCase().trim() === e)) return true;
  if (Array.isArray(db.settings?.itTeam) && db.settings.itTeam.some(t => {
    const tLow = t.toLowerCase();
    return tLow.includes(e) || e.includes(tLow.replace(/[^a-z0-9]/g, ''));
  })) return true;
  if (Array.isArray(db.employees) && db.employees.some(emp => (emp.email || '').toLowerCase().trim() === e)) return true;
  return false;
}

function getUserRoleName(r) {
  const role = r || getUserRole();
  const def = DEFAULT_ROLE_PERMS[role];
  return def ? `${def.icon} ${def.name}` : role;
}

function getRolePerms(r) {
  const role = r || getUserRole();
  const stored = (db.settings && db.settings.rolePermissions && db.settings.rolePermissions[role]);
  const def = DEFAULT_ROLE_PERMS[role] || DEFAULT_ROLE_PERMS.hr;
  if (!stored) return def;
  return {
    ...def,
    ...stored,
    pages: Array.isArray(stored.pages) ? stored.pages : def.pages,
    actions: { ...(def.actions || {}), ...(stored.actions || {}) }
  };
}

const isITAdmin = () => getUserRole() === 'it_admin';
const isHR = () => getUserRole() === 'hr';

function canAccessPage(p) {
  if (isITAdmin()) return true;
  if (p === 'settings') return false; // Settings is strictly IT Admin only
  const perms = getRolePerms();
  return Boolean(perms.pages && perms.pages.includes(p));
}

function canDo(actionKey) {
  if (isITAdmin()) return true;
  const perms = getRolePerms();
  return Boolean(perms.actions && perms.actions[actionKey]);
}

function getAllowedSyncTables() {
  if (isITAdmin()) return ['employees', 'assets', 'software', 'sw_assign', 'maint', 'history', 'settings'];
  const tables = ['settings'];
  if (canAccessPage('employees')) tables.push('employees');
  if (canAccessPage('assets')) tables.push('assets');
  if (canAccessPage('software')) { tables.push('software'); tables.push('sw_assign'); }
  if (canAccessPage('maintenance')) tables.push('maint');
  if (canAccessPage('history')) tables.push('history');
  return tables;
}

function trackUserLogin(email) {
  if (!email) return;
  const em = email.toLowerCase().trim();
  if (!Array.isArray(db.settings.knownUsers)) db.settings.knownUsers = [];
  if (!db.settings.knownUsers.includes(em)) {
    db.settings.knownUsers.push(em);
    dirtyQueue.settings = true;
    save();
  }
}

function updateAuthUI() {
  const overlay = $('#auth-overlay');
  const appEl = $('.app');
  const userCard = $('#user-card');

  if (!currentUser) {
    if (overlay) {
      overlay.removeAttribute('hidden');
      overlay.hidden = false;
      overlay.classList.remove('hidden');
      overlay.style.setProperty('display', 'flex', 'important');
    }
    if (appEl) {
      appEl.style.setProperty('display', 'none', 'important');
    }
    if (userCard) userCard.hidden = true;
    return;
  }

  trackUserLogin(currentUser.email);

  if (overlay) {
    overlay.setAttribute('hidden', '');
    overlay.hidden = true;
    overlay.classList.add('hidden');
    overlay.style.setProperty('display', 'none', 'important');
  }
  if (appEl) {
    appEl.style.setProperty('display', 'flex', 'important');
  }

  if (userCard) {
    userCard.hidden = false;
    const emailEl = $('#user-email');
    const avatarEl = $('#user-avatar');
    const badgeEl = $('#user-role-badge');
    const role = getUserRole();
    const rInfo = DEFAULT_ROLE_PERMS[role] || { name: role, icon: '👤', badgeCls: 'role-hr' };

    if (emailEl) emailEl.textContent = currentUser.email;
    if (avatarEl) avatarEl.textContent = initials(currentUser.email.split('@')[0]);
    if (badgeEl) {
      badgeEl.textContent = `${rInfo.icon} ${rInfo.name}`;
      badgeEl.className = 'user-role-badge ' + (rInfo.badgeCls || 'role-hr');
    }
  }

  applyRoleNavRestrictions();
}

function applyRoleNavRestrictions() {
  const nav = $('#nav');
  if (!nav) return;

  ALL_PAGES.forEach(p => {
    const link = nav.querySelector(`a[data-page="${p}"]`);
    if (link) {
      link.style.display = canAccessPage(p) ? '' : 'none';
    }
  });

  const addAssetBtn = $('[data-act="add-asset"]');
  if (addAssetBtn) addAssetBtn.style.display = canDo('canAddEditAsset') ? '' : 'none';

  const addEmpBtn = $('[data-act="add-emp"]');
  if (addEmpBtn) addEmpBtn.style.display = canDo('canAddEditEmp') ? '' : 'none';

  const topTicketBtn = $('#top-ticket-btn');
  if (topTicketBtn) topTicketBtn.style.display = canDo('canRaiseTicket') ? '' : 'none';

  const topEmailBtn = $('#top-email-req');
  if (topEmailBtn) topEmailBtn.style.display = canAccessPage('onboarding') ? '' : 'none';

  const hrEmailBtn = $('[data-act="req-email"]');
  if (hrEmailBtn) hrEmailBtn.style.display = canAccessPage('onboarding') ? '' : 'none';

  const topExportBtn = $('#top-export');
  if (topExportBtn) topExportBtn.style.display = canDo('canExportCSV') ? '' : 'none';

  const gs = $('#gsearch');
  if (gs) {
    gs.placeholder = !canAccessPage('assets') 
      ? 'Search employee name, code, email, designation… (Ctrl+K)'
      : 'Search employee, asset tag, serial, IMEI, SIM no, email… (Ctrl+K)';
  }

  const curPage = page();
  if (!canAccessPage(curPage)) {
    const firstAllowed = ALL_PAGES.find(p => canAccessPage(p)) || 'tickets';
    location.hash = '#/' + firstAllowed;
  }
}

// ---------------- Mobile & User Resolution Helpers ----------------

function cleanPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function findUserByMobile(phoneInput) {
  const p = cleanPhone(phoneInput);
  if (!p || p.length !== 10) return null;

  // 1. Primary IT Admin (Mo Vaseem) - by phone
  const adminPhones = ['8881709248'];
  if (db.settings && db.settings.engineerPhone) adminPhones.push(cleanPhone(db.settings.engineerPhone));
  if (db.settings && db.settings.userPhones) {
    Object.keys(db.settings.userPhones).forEach(em => {
      if (em.toLowerCase().includes('vaseem')) {
        adminPhones.push(cleanPhone(db.settings.userPhones[em]));
      }
    });
  }
  if (adminPhones.includes(p)) {
    return {
      id: 'admin-vaseem',
      name: 'Mo Vaseem',
      email: 'movaseem@tractorjunction.com',
      phone: p,
      role: 'it_admin'
    };
  }

  // 2. Check userPhones mapping in db.settings
  if (db.settings && db.settings.userPhones) {
    for (const [email, userPhone] of Object.entries(db.settings.userPhones)) {
      if (cleanPhone(userPhone) === p) {
        const em = email.toLowerCase().trim();
        const role = (db.settings.userRoleOverrides && db.settings.userRoleOverrides[em]) || (em.includes('hr') ? 'hr' : 'employee');
        const emp = (db.employees || []).find(e => (e.email || '').toLowerCase().trim() === em);
        return {
          id: emp?.id || ('user-' + p),
          name: emp?.name || email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          email: em,
          phone: p,
          role: role,
          empCode: emp?.empCode || ''
        };
      }
    }
  }

  // 3. Check employees list (e.phone, e.contact, e.mobile)
  if (Array.isArray(db.employees)) {
    const emp = db.employees.find(e => {
      const ph = cleanPhone(e.phone || e.contact || e.mobile);
      return ph === p;
    });
    if (emp) {
      const em = (emp.email || '').toLowerCase().trim() || `${emp.name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@tractorjunction.com`;
      const role = (db.settings?.userRoleOverrides && db.settings.userRoleOverrides[em]) || (em.includes('hr') ? 'hr' : (emp.role || 'employee'));
      return {
        id: emp.id || ('emp-' + (emp.empCode || p)),
        name: emp.name || 'Employee',
        email: em,
        phone: p,
        role: role,
        empCode: emp.empCode || ''
      };
    }
  }

  return null;
}

function getPortalRedirectUrl() {
  const isLocal = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.protocol === 'file:';
  return isLocal ? 'https://movaseem.github.io/IT-Assets-Management/' : window.location.href.split('#')[0];
}

function setupAuthListeners() {
  const form = $('#auth-form');
  const submitBtn = $('#auth-submit-btn');
  const errBox = $('#auth-error');
  const succBox = $('#auth-success');

  const togglePassBtn = $('#toggle-auth-pass');
  if (togglePassBtn) {
    togglePassBtn.onclick = () => {
      const inp = $('#auth-password');
      if (!inp) return;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      togglePassBtn.textContent = show ? '🙈' : '👁️';
      togglePassBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    };
  }

  const forgotBtn = $('#btn-forgot-password');
  if (forgotBtn) {
    forgotBtn.onclick = async () => {
      const raw = $('#auth-email')?.value.trim() || '';
      let email = raw;
      const cleanNum = cleanPhone(raw);
      if (cleanNum && cleanNum.length === 10) {
        const found = findUserByMobile(cleanNum);
        if (found && found.email) email = found.email;
        else if (cleanNum === '8881709248') email = 'movaseem@tractorjunction.com';
      }
      if (!email || !EMAIL_RE.test(email)) {
        if (errBox) {
          errBox.textContent = 'Kripya apna valid Work Email ya registered Mobile Number upar enter karein, fir "Forgot password" par click karein.';
          errBox.style.display = 'block';
        }
        return;
      }
      try {
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending link...'; }
        if (!sbClient) initSupabase();
        const { error } = await sbClient.auth.resetPasswordForEmail(email, {
          redirectTo: getPortalRedirectUrl()
        });
        if (error) throw error;
        if (succBox) {
          succBox.textContent = `Password reset / login link ${email} par bhej diya gaya hai! (Kripya apna Inbox aur Spam / Junk folder check karein).`;
          succBox.style.display = 'block';
        }
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message || 'Failed to send password reset email';
          errBox.style.display = 'block';
        }
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sign In'; }
      }
    };
  }

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (errBox) errBox.style.display = 'none';
      if (succBox) succBox.style.display = 'none';
      const rawInput = $('#auth-email')?.value.trim() || '';
      const password = $('#auth-password')?.value;
      if (!rawInput || !password) return;

      let email = rawInput;
      const cleanNum = cleanPhone(rawInput);
      if (cleanNum && cleanNum.length === 10) {
        const found = findUserByMobile(cleanNum);
        if (found && found.email) {
          email = found.email;
        } else if (cleanNum === '8881709248') {
          email = 'movaseem@tractorjunction.com';
        }
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying access…';
      }

      try {
        if (!sbClient) initSupabase();
        if (!sbClient) throw new Error('Supabase is not connected. Check network connection.');

        const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const userEmail = (data.user?.email || email).toLowerCase().trim();

        // Ensure cloud settings/employees are loaded before rejecting on a fresh device
        if (!isUserAuthorized(userEmail) && (!db.employees.length && !(db.settings?.knownUsers?.length))) {
          await syncFromSupabase().catch(() => {});
        }

        // STRICT SECURITY GATE: Only users authorized / invited by IT Admin can sign in
        if (!isUserAuthorized(userEmail)) {
          console.warn('Unauthorized login attempt:', userEmail);
          try { await sbClient.auth.signOut(); } catch (_) {}
          currentUser = null;
          updateAuthUI();
          if (errBox) {
            errBox.innerHTML = `
              <div style="text-align:left;line-height:1.5;">
                <b style="color:var(--err);font-size:13px;">🚫 Access Denied: Account Not Invited</b><br>
                Aapka work email (<code>${esc(userEmail)}</code>) IT Asset Management Portal ke liye authorized nahi hai.<br>
                Is system me sirf wahi users login kar sakte hain jinhe IT Admin ne portal se invite link bheja hai.<br>
                <div style="margin-top:6px;font-size:11.5px;color:var(--muted);">Kripya access lene ke liye apne IT Administrator se contact karein.</div>
              </div>`;
            errBox.style.display = 'block';
          }
          return;
        }

        const role = (db.settings.userRoleOverrides && db.settings.userRoleOverrides[userEmail]) || data.user.user_metadata?.role || '';
        currentUser = { id: data.user.id, email: data.user.email, role };
        const finalRole = getUserRole();
        updateAuthUI();
        toast(`Logged in as ${getUserRoleName(finalRole)}`, 'ok');
        render();
        syncFromSupabase().then(() => render()).catch(console.warn);
      } catch (err) {
        console.error('Auth error:', err);
        if (errBox) {
          let msg = err.message || 'Authentication failed.';
          if (msg.includes('Email not confirmed')) {
            msg = 'Email confirm nahi hua hai. Supabase Dashboard ➔ Users me jakar is email ko "Confirm User" karein ya Confirm email setting OFF karein.';
          } else if (msg.includes('Invalid login credentials')) {
            msg = 'Email/Mobile ya Password galat hai. Kripya check karke dobara try karein, ya IT Admin se invite link lein.';
          }
          errBox.textContent = msg;
          errBox.style.display = 'block';
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In';
        }
      }
    };
  }

  try {
    if (sbClient && sbClient.auth && sbClient.auth.onAuthStateChange) {
      sbClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_OUT') {
          currentUser = null;
          updateAuthUI();
        } else if (event === 'PASSWORD_RECOVERY') {
          showSetNewPasswordModal(session?.user?.email, true);
        } else if (event === 'SIGNED_IN' && session && session.user) {
          const userEmail = (session.user.email || '').toLowerCase().trim();
          if (!isUserAuthorized(userEmail) && (!db.employees.length && !(db.settings?.knownUsers?.length))) {
            await syncFromSupabase().catch(() => {});
          }
          if (!isUserAuthorized(userEmail)) {
            try { await sbClient.auth.signOut(); } catch (_) {}
            currentUser = null;
            updateAuthUI();
            return;
          }
          const role = session.user.user_metadata?.role || (db.settings.userRoleOverrides && db.settings.userRoleOverrides[userEmail]) || '';
          currentUser = { id: session.user.id, email: session.user.email, role };
          updateAuthUI();
        }
      });
    }
  } catch (_) {}
}

async function checkAuthOnLoad() {
  localStorage.removeItem('tj_mobile_auth');
  if (!sbClient) initSupabase();
  if (!sbClient) {
    updateAuthUI();
    return;
  }
  const hash = window.location.hash || '';
  const isRecovery = hash.includes('type=recovery') || hash.includes('type=invite')
    || INITIAL_AUTH_URL.includes('type=recovery') || INITIAL_AUTH_URL.includes('type=invite') || INITIAL_AUTH_URL.includes('code=');

  try {
    const { data: { session } } = await sbClient.auth.getSession();
    if (session && session.user) {
      const email = (session.user.email || '').toLowerCase().trim();
      if (!isUserAuthorized(email) && (!db.employees.length && !(db.settings?.knownUsers?.length))) {
        await syncFromSupabase().catch(() => {});
      }
      // Guard against unauthorized session
      if (!isUserAuthorized(email)) {
        console.warn('Unauthorized session detected on load, signing out:', email);
        try { await sbClient.auth.signOut(); } catch (_) {}
        currentUser = null;
        updateAuthUI();
        return;
      }
      const role = session.user.user_metadata?.role || (db.settings.userRoleOverrides && db.settings.userRoleOverrides[email]) || '';
      currentUser = { id: session.user.id, email, role };
      if (isRecovery) {
        setTimeout(() => showSetNewPasswordModal(email, true), 250);
      }
    } else {
      currentUser = null;
    }
  } catch (err) {
    console.warn('Session check:', err);
    currentUser = null;
  }
  updateAuthUI();
}

function showSetNewPasswordModal(userEmail = '', force = false) {
  if ($('#set-pass-form')) return;
  const isRecoveryHash = force || window.location.hash.includes('type=recovery') || window.location.hash.includes('type=invite') || window.location.hash.includes('access_token=')
    || INITIAL_AUTH_URL.includes('type=recovery') || INITIAL_AUTH_URL.includes('type=invite') || INITIAL_AUTH_URL.includes('code=');
  if (isITAdmin() && !isRecoveryHash) {
    return;
  }

  const body = `
    <div style="padding:4px 0;">
      <p class="hint" style="margin-top:0;">Welcome <b>${esc(userEmail || 'User')}</b>! Kripya apna naya password create karein taaki aap aage is password se direct login kar sakein:</p>
      <form id="set-pass-form" class="form-grid" style="gap:12px;margin-top:12px;">
        <label class="full"><b>New Password (Minimum 6 characters) *</b>
          <input type="password" id="new-auth-pass" required placeholder="Enter new strong password" minlength="6">
        </label>
        <label class="full"><b>Confirm New Password *</b>
          <input type="password" id="confirm-auth-pass" required placeholder="Re-enter password" minlength="6">
        </label>
      </form>
    </div>
  `;

  const root = modal('🔑 Create / Set Your Password', body, [
    {
      label: 'Save Password & Enter Portal',
      cls: 'primary',
      onClick: async (rootEl, closeFn) => {
        const p1 = rootEl.querySelector('#new-auth-pass')?.value;
        const p2 = rootEl.querySelector('#confirm-auth-pass')?.value;
        if (!p1 || p1.length < 6) {
          rootEl.err(['Password kam se kam 6 characters ka hona chahiye']);
          return false;
        }
        if (p1 !== p2) {
          rootEl.err(['Passwords match nahi kar rahe hain']);
          return false;
        }

        const submitBtn = rootEl.querySelector('footer .btn.primary');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

        try {
          if (!sbClient) initSupabase();
          const { data, error } = await sbClient.auth.updateUser({ password: p1 });
          if (error) {
            rootEl.err([error.message || 'Password update failed']);
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Password & Enter Portal'; }
            return false;
          }
          toast('✅ Password set successfully! Welcome to TractorJunction Portal.', 'ok');
          if (window.location.hash.includes('access_token') || window.location.hash.includes('type=')) {
            history.replaceState(null, '', window.location.pathname + '#/' + (page() || 'dashboard'));
          }
          if (data && data.user) {
            const email = (data.user.email || '').toLowerCase().trim();
            const role = (db.settings.userRoleOverrides && db.settings.userRoleOverrides[email]) || data.user.user_metadata?.role || '';
            currentUser = { id: data.user.id, email: data.user.email, role };
            updateAuthUI();
            render();
            syncFromSupabase().then(() => render()).catch(console.warn);
          }
          if (typeof closeFn === 'function') closeFn();
          rootEl.remove();
          return true;
        } catch (err) {
          rootEl.err([err.message || 'Password update failed']);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Password & Enter Portal'; }
          return false;
        }
      }
    }
  ], 'sm');

  // If user clicks Cancel or Close, clean up the recovery hash from URL
  const closeBtn = root.querySelector('[data-x]');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (window.location.hash.includes('type=recovery') || window.location.hash.includes('type=invite')) {
        history.replaceState(null, '', window.location.pathname + '#/' + (page() || 'dashboard'));
      }
    });
  }
}

function getRoleAccessSummaryHTML(role) {
  const roleMeta = DEFAULT_ROLE_PERMS[role] || { name: role, icon: '👤', badgeCls: 'role-hr' };
  let allowed = [];
  let blocked = [];
  let rights = [];

  if (role === 'employee') {
    allowed = ['🎫 IT Helpdesk & Tickets (Self-Service Only)'];
    blocked = [
      '💻 Assets (Hardware & Devices)',
      '👥 Employees (Company Directory)',
      '🧩 Software & License Inventory',
      '🛠️ Maintenance & Repairs',
      '🕘 History & Audit Trail',
      '⚠️ Data Issues',
      '📥 Import / Export & DB',
      '⚙️ Settings & Administration',
      '✉️ Work Email Requests'
    ];
    rights = [
      '✅ Apni IT problem/complaint ke liye ticket raise kar sakte hain (Laptop, Wi-Fi, Software, Access)',
      '✅ Real-time SLA countdown timer aur assigned IT engineer live dekh sakte hain',
      '✅ Ticket comments me updates/replies likh sakte hain',
      '🚫 Confidential company assets, laptops ya doosre employees ka data nahi dekh sakte (All Hidden)',
      '🚫 System records me koi change ya deletion karne ka adhikaar nahi hai'
    ];
  } else if (role === 'hr') {
    allowed = ['👥 Employees Directory', '✉️ Work Email Requests', '🎫 Helpdesk & Tickets', '📊 Dashboard'];
    blocked = ['💻 Hardware Assets', '🧩 Software Licenses', '🛠️ Maintenance', '📥 Import / Export', '⚙️ Settings'];
    rights = [
      '✅ Naye employees ka record create aur edit kar sakte hain',
      '✅ New Joinee work email creation task generate kar sakte hain',
      '✅ Offboarding exit clearance process initiate kar sakte hain',
      '🚫 Asset purchase price, procurement cost aur IT configs hidden rahengi'
    ];
  } else if (role === 'it_admin') {
    allowed = ['👑 All 11 Modules (Complete IT Administrative Access)'];
    blocked = ['None (Unrestricted Super Admin)'];
    rights = [
      '✅ Assets, Softwares, Employees, Maintenance, Tickets sabhi par full read/write rights',
      '✅ Naye users ko invite karna aur unke roles / module permissions assign karna',
      '✅ Cloud Supabase sync, backup export aur restore karna',
      '✅ IT tickets assign karna, solve karna aur SLA policies manage karna'
    ];
  } else if (role === 'viewer') {
    allowed = ['📊 Dashboard', '💻 Assets', '👥 Employees', '🎫 Helpdesk', '🕘 History'];
    blocked = ['⚙️ Settings', '📥 Import / Export', '🛠️ Maintenance'];
    rights = [
      '✅ Company assets aur employee records search aur view kar sakte hain',
      '🚫 Read-only access: Kisi bhi record ko add, edit ya delete nahi kar sakte'
    ];
  } else if (role === 'finance') {
    allowed = ['📊 Dashboard', '💻 Assets (Valuation)', '🧩 Software (Licenses)', '🕘 History'];
    blocked = ['⚙️ Settings', '🛠️ Maintenance', '✉️ Email Requests', '👥 Employees'];
    rights = [
      '✅ Asset purchase cost, depreciation rate aur current book value audit kar sakte hain',
      '✅ Software license consumption aur renewals verify kar sakte hain',
      '🚫 Hardware specifications ya asset assignments change nahi kar sakte'
    ];
  }

  return `
    <div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:12px;margin-top:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:12px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:6px;">
          <span>🛡️ Permitted Access for:</span>
          <span class="user-role-badge ${roleMeta.badgeCls}">${roleMeta.icon} ${esc(roleMeta.name)}</span>
        </span>
      </div>

      <div style="margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--ok, #22c55e);margin-bottom:4px;">🟢 Allowed Modules / Windows (User inko dekh payega):</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          ${allowed.map(m => `<span style="font-size:11px;background:rgba(34,197,94,0.12);color:var(--ok, #22c55e);border:1px solid rgba(34,197,94,0.3);padding:2px 8px;border-radius:4px;font-weight:600;">${esc(m)}</span>`).join('')}
        </div>
      </div>

      ${blocked.length && blocked[0] !== 'None (Unrestricted Super Admin)' ? `
      <div style="margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--err, #ef4444);margin-bottom:4px;">🔴 Restricted / Blocked Windows (User se bilkul HIDDEN rahenge):</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          ${blocked.map(m => `<span style="font-size:11px;background:rgba(239,68,68,0.1);color:var(--err, #ef4444);border:1px solid rgba(239,68,68,0.25);padding:2px 8px;border-radius:4px;">${esc(m)}</span>`).join('')}
        </div>
      </div>` : ''}

      <div>
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px;">📋 Operational Rights &amp; Security Capabilities:</div>
        <ul style="margin:0;padding-left:18px;font-size:11.5px;color:var(--text);line-height:1.5;">
          ${rights.map(r => `<li>${esc(r)}</li>`).join('')}
        </ul>
      </div>
    </div>
  `;
}

function getRoleHintText(r) {
  if (r === 'employee') {
    return '🛡️ <b>Access:</b> <span class="badge b-acc">IT Helpdesk Only</span> (All other modules completely hidden)';
  } else if (r === 'hr') {
    return '🛡️ <b>Access:</b> <span class="badge b-acc">Employees, Email Tasks &amp; Helpdesk</span>';
  } else if (r === 'it_admin') {
    return '👑 <b>Access:</b> <span class="badge b-ok">Full Super Admin</span> (All 11 modules permitted)';
  } else if (r === 'viewer') {
    return '👁️ <b>Access:</b> <span class="badge b-info">Read-Only Viewer</span>';
  } else if (r === 'finance') {
    return '💼 <b>Access:</b> <span class="badge b-warn">Assets &amp; Software Auditing</span>';
  }
  return '';
}

function openInviteUserModal() {
  const el = $('#assign-role-email');
  if (el) {
    el.focus();
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.5)';
    setTimeout(() => { el.style.boxShadow = ''; }, 1500);
  }
}

function getIsolatedAuthClient() {
  if (!window.supabase) return null;
  const cfg = db.settings?.supabase || SUPABASE_CONFIG;
  const url = cfg?.url || SUPABASE_CONFIG?.url;
  const key = cfg?.anonKey || SUPABASE_CONFIG?.anonKey;
  if (!url || !key) return null;
  try {
    return window.supabase.createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'sb_isolated_invite_session'
      }
    });
  } catch (e) {
    console.warn('Isolated client error:', e);
    return null;
  }
}

async function showUserInviteModal(email, role, phone = '', name = '', tempPass = '') {
  const roleMeta = DEFAULT_ROLE_PERMS[role] || { name: role, icon: '👤', badgeCls: 'role-hr' };
  const origin = window.location.origin + window.location.pathname;
  const isLocal = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  const ghPagesOrigin = 'https://movaseem.github.io/IT-Assets-Management/';
  
  // ALWAYS use live GitHub Pages URL for invitations so links work seamlessly on all phones, PCs & networks
  const effectiveOrigin = ghPagesOrigin;

  const password = tempPass || ('TJ@' + Math.floor(1000 + Math.random() * 9000) + '#' + new Date().getFullYear().toString().slice(-2));
  const userName = name || email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Format phone number for WhatsApp
  let phoneDigits = (phone || '').replace(/\D/g, '');
  if (phoneDigits.length === 10) {
    phoneDigits = '91' + phoneDigits;
  }

  let accessSummaryLine = '';
  if (role === 'employee') {
    accessSummaryLine = '• 🎫 IT Helpdesk & Tickets (Raise & track IT issues, live SLA timer)';
  } else if (role === 'hr') {
    accessSummaryLine = '• 👥 Employee Management, Email Creation Tasks & IT Helpdesk';
  } else if (role === 'it_admin') {
    accessSummaryLine = '• 👑 Full System Admin Access (All modules, assets, users & cloud settings)';
  } else if (role === 'viewer') {
    accessSummaryLine = '• 👁️ Read-Only access to company assets & employee records';
  } else if (role === 'finance') {
    accessSummaryLine = '• 💼 Finance & Auditing (Asset book values & software license audits)';
  }

  const shareText = `👋 Welcome to TractorJunction IT Portal!
Hi ${userName},

Aapka account IT Portal ke liye authorize kar diya gaya hai:
👤 Assigned Role: ${roleMeta.icon} ${roleMeta.name}
📧 Work Email: ${email}
🔑 Temporary Password: ${password}
🌐 Portal Login Link: ${effectiveOrigin}

📱 What access you have:
${accessSummaryLine}

Kripya upar diye gaye link par jakar sign in karein aur apna password update kar lein.
- IT Administrator, TractorJunction`;

  const waLink = phoneDigits 
    ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(shareText)}`
    : `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  // Open WhatsApp Web/App immediately in new tab so browser popup blocker doesn't block it
  if (phoneDigits) {
    try {
      window.open(waLink, '_blank');
    } catch (_) {}
  }

  let emailStatus = '⏳ Sending password setup email via Supabase...';
  let emailOk = false;
  let userAlreadyExists = false;

  const isolatedClient = getIsolatedAuthClient();
  if (isolatedClient) {
    // 1. Create user in Supabase Auth using ISOLATED client (never touches Admin session!)
    try {
      const { data: suData, error: suErr } = await isolatedClient.auth.signUp({
        email,
        password,
        options: { data: { role }, emailRedirectTo: effectiveOrigin }
      });
      if ((suErr && /already registered/i.test(suErr.message)) || (suData?.user && Array.isArray(suData.user.identities) && suData.user.identities.length === 0)) {
        userAlreadyExists = true;
      }
    } catch (_) {}

    // 2. Dispatch password setup & recovery email
    try {
      const { error } = await isolatedClient.auth.resetPasswordForEmail(email, { redirectTo: effectiveOrigin });
      if (error) {
        if (error.message && error.message.toLowerCase().includes('rate limit')) {
          emailStatus = '⚠️ Supabase email rate limit reached. Thodi der baad "Re-send Email" ya "Forgot password" use karein.';
        } else {
          emailStatus = `⚠️ Supabase email status: ${error.message}`;
        }
      } else {
        emailOk = true;
        emailStatus = `✅ Password setup & recovery email dispatched to ${email}! (Kripya Spam / Junk folder bhi check karein)`;
      }
      if (userAlreadyExists) {
        emailStatus += '<br><span style="color:var(--warn);font-size:11.5px;">ℹ️ Note: Ye account pehle se Supabase me registered hai, isliye upar wala naya Temporary Password kaam nahi karega — user ko email reset link ya purana password use karna hoga.</span>';
      }
    } catch (e) {
      emailStatus = `⚠️ ${e.message}`;
    }
  } else {
    emailStatus = '⚠️ Supabase auth offline. Share invitation via WhatsApp or direct copy below.';
  }

  const body = `
    <div style="padding:4px 0;">
      ${phoneDigits ? `
      <div style="background:linear-gradient(135deg, #075e54, #128c7e);border-radius:8px;padding:12px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,0.2);">
        <div>
          <div style="font-weight:700;color:#fff;font-size:13.5px;display:flex;align-items:center;gap:6px;">
            <span>💬 WhatsApp Invite Ready</span>
            <span style="background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:12px;font-size:11px;">+${phoneDigits}</span>
          </div>
          <div style="color:rgba(255,255,255,0.9);font-size:12px;margin-top:2px;">Agar WhatsApp tab apne aap open nahi hua ho to yahan click karein:</div>
        </div>
        <a href="${waLink}" target="_blank" class="btn" style="background:#25D366;color:#fff;font-weight:700;font-size:12.5px;padding:7px 16px;border:none;text-decoration:none;display:inline-flex;align-items:center;gap:6px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.15);">
          🚀 Send on WhatsApp →
        </a>
      </div>
      ` : `
      <div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div>
          <div style="font-weight:700;color:var(--text);font-size:13px;">💬 WhatsApp Direct Share</div>
          <div style="color:var(--muted);font-size:12px;">Mobile number enter nahi tha, par aap direct WhatsApp par share kar sakte hain:</div>
        </div>
        <a href="${waLink}" target="_blank" class="btn" style="background:#25D366;color:#fff;font-weight:700;font-size:12.5px;padding:7px 14px;border:none;text-decoration:none;display:inline-flex;align-items:center;gap:6px;border-radius:6px;">
          💬 Open WhatsApp
        </a>
      </div>
      `}

      <div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div>
            <b style="font-size:14px;color:var(--text);">${esc(userName)}</b>
            <div style="font-size:12px;color:var(--muted);">${esc(email)}${phone ? ` · 📱 ${esc(phone)}` : ''}</div>
          </div>
          <span class="user-role-badge ${roleMeta.badgeCls}">${roleMeta.icon} ${esc(roleMeta.name)}</span>
        </div>
        <div style="font-size:12px;color:${emailOk ? 'var(--ok, #22c55e)' : 'var(--warn, #f59e0b)'};display:flex;align-items:center;gap:6px;padding-top:6px;border-top:1px dashed var(--line);font-weight:600;">
          ${emailStatus}
        </div>
      </div>

      <div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;">PROVISIONED ACCESS LEVEL:</div>
        <div style="font-size:12px;color:var(--text);line-height:1.45;">
          ${accessSummaryLine}
        </div>
      </div>

      <div style="background:rgba(37,99,235,0.1);border:1px solid rgba(37,99,235,0.3);padding:10px 12px;border-radius:8px;font-size:12px;color:#93c5fd;margin-bottom:12px;">
        🌐 <b>Live Portal Link:</b> Invite link me live URL (<code>${ghPagesOrigin}</code>) set hai, taaki user apne mobile phone ya kisi bhi device par direct open kar sake.
      </div>

      <div style="position:relative;margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <label style="font-size:11px;font-weight:700;color:var(--muted);">INVITATION MESSAGE (EMAIL + WHATSAPP):</label>
        </div>
        <textarea id="invite-share-msg" rows="7" style="width:100%;font-size:12px;font-family:monospace;background:rgba(0,0,0,0.25);padding:10px;border-radius:6px;border:1px solid var(--line);color:var(--text);resize:vertical;" readonly>${esc(shareText)}</textarea>
      </div>

      <div class="toolbar" style="margin:0;gap:8px;flex-wrap:wrap;">
        ${phoneDigits ? `
          <a href="${waLink}" target="_blank" class="btn primary sm" style="background:#25D366;border-color:#25D366;color:#fff;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">
            💬 Send to WhatsApp (+${phoneDigits})
          </a>
        ` : `
          <a href="${waLink}" target="_blank" class="btn primary sm" style="background:#25D366;border-color:#25D366;color:#fff;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">
            💬 Open WhatsApp to Share
          </a>
        `}
        <button type="button" class="btn sm" id="btn-copy-invite-msg">📋 Copy Invitation Text</button>
        <button type="button" class="btn sm" id="btn-resend-invite-email" data-email="${esc(email)}">📧 Re-send Email</button>
      </div>
    </div>
  `;

  modal(`✉️ Invite & Access Details — ${email}`, body, [
    { label: 'Done', cls: 'primary', onClick: () => true }
  ], 'md');

  setTimeout(() => {
    const copyBtn = document.getElementById('btn-copy-invite-msg');
    if (copyBtn) {
      copyBtn.onclick = () => {
        const txt = document.getElementById('invite-share-msg')?.value;
        if (txt) {
          navigator.clipboard.writeText(txt).then(() => toast('📋 Invitation message copied to clipboard!', 'ok'));
        }
      };
    }
    const resendBtn = document.getElementById('btn-resend-invite-email');
    if (resendBtn) {
      resendBtn.onclick = async () => {
        try {
          resendBtn.disabled = true;
          resendBtn.textContent = 'Sending...';
          const iso = getIsolatedAuthClient();
          const client = iso || sbClient;
          const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: effectiveOrigin });
          if (error) throw error;
          toast('✅ Invite / Password reset email re-sent!', 'ok');
        } catch (e) {
          toast(e.message || 'Resend failed', 'err');
        } finally {
          resendBtn.disabled = false;
          resendBtn.textContent = '📧 Re-send Email';
        }
      };
    }
  }, 100);
}

function unpackCustomFieldsFromRow(table, row) {
  if (!row || typeof row !== 'object') return row;
  if (table === 'employees' && row.notes && row.notes.includes('<!--CF:')) {
    const m = row.notes.match(/<!--CF:(.*?)-->/);
    if (m) {
      try { Object.assign(row, JSON.parse(m[1])); } catch (_) {}
      row.notes = row.notes.replace(/<!--CF:.*?-->/s, '').trim();
    }
  } else if (table === 'assets' && row.remarks && row.remarks.includes('<!--CF:')) {
    const m = row.remarks.match(/<!--CF:(.*?)-->/);
    if (m) {
      try { Object.assign(row, JSON.parse(m[1])); } catch (_) {}
      row.remarks = row.remarks.replace(/<!--CF:.*?-->/s, '').trim();
    }
  }
  return row;
}

function sanitizeForSupabase(table, row) {
  if (!row || typeof row !== 'object') return null;
  const clean = {};
  switch (table) {
    case 'employees': {
      const cols = ['id', 'createdAt', 'empCode', 'name', 'email', 'phone', 'designation', 'department', 'location', 'company', 'doj', 'band', 'status', 'exitDate', 'notes'];
      cols.forEach(c => { if (row[c] !== undefined) clean[c] = row[c] === '' ? null : String(row[c]); });
      const customVals = {};
      Object.keys(row).forEach(k => { if (k.startsWith('cf_') && row[k] != null && row[k] !== '') customVals[k] = row[k]; });
      let baseNotes = (clean.notes || '').replace(/<!--CF:.*?-->/s, '').trim();
      if (Object.keys(customVals).length > 0) {
        clean.notes = (baseNotes ? baseNotes + '\n' : '') + `<!--CF:${JSON.stringify(customVals)}-->`;
      } else {
        clean.notes = baseNotes || null;
      }
      if (!clean.id) clean.id = uid();
      if (!clean.name) clean.name = 'Unnamed';
      return clean;
    }
    case 'assets': {
      const cols = ['id', 'createdAt', 'tag', 'type', 'status', 'make', 'model', 'serialNo', 'hostname', 'processor', 'ram', 'storage', 'os', 'osLicense', 'domainJoin', 'imei', 'simNumber', 'screenTag', 'accessories', 'condition', 'physical', 'qsync', 'empCode', 'holderName', 'holderEmail', 'department', 'location', 'allocatedDate', 'vendor', 'purchaseDate', 'warrantyEnd', 'cost', 'engineer', 'adobeId', 'extra', 'remarks'];
      cols.forEach(c => {
        if (row[c] !== undefined) {
          if (c === 'cost') {
            const num = parseFloat(row[c]);
            clean[c] = isNaN(num) ? null : num;
          } else {
            clean[c] = row[c] === '' ? null : String(row[c]);
          }
        }
      });
      const customVals = {};
      Object.keys(row).forEach(k => { if (k.startsWith('cf_') && row[k] != null && row[k] !== '') customVals[k] = row[k]; });
      let baseRemarks = (clean.remarks || '').replace(/<!--CF:.*?-->/s, '').trim();
      if (Object.keys(customVals).length > 0) {
        clean.remarks = (baseRemarks ? baseRemarks + '\n' : '') + `<!--CF:${JSON.stringify(customVals)}-->`;
      } else {
        clean.remarks = baseRemarks || null;
      }
      if (!clean.id) clean.id = uid();
      if (!clean.tag) clean.tag = 'TAG-' + uid().slice(-4).toUpperCase();
      if (!clean.type) clean.type = 'Other';
      return clean;
    }
    case 'software': {
      const cols = ['id', 'name', 'version', 'category', 'licenseType', 'vendor', 'totalSeats', 'cost', 'expiry', 'departments', 'notes'];
      cols.forEach(c => {
        if (row[c] !== undefined) {
          if (c === 'totalSeats' || c === 'cost') {
            const num = parseFloat(row[c]);
            clean[c] = isNaN(num) ? null : num;
          } else {
            clean[c] = row[c] === '' ? null : String(row[c]);
          }
        }
      });
      if (!clean.id) clean.id = uid();
      if (!clean.name) clean.name = 'Unnamed Software';
      return clean;
    }
    case 'sw_assign': {
      const cols = ['id', 'empId', 'swId', 'name', 'tag'];
      cols.forEach(c => { if (row[c] !== undefined) clean[c] = row[c] === '' ? null : String(row[c]); });
      if (!clean.id) clean.id = uid();
      return clean;
    }
    case 'maint': {
      const cols = ['id', 'tag', 'type', 'cost', 'engineer', 'date', 'note', 'before', 'after'];
      cols.forEach(c => {
        if (row[c] !== undefined) {
          if (c === 'cost') {
            const num = parseFloat(row[c]);
            clean[c] = isNaN(num) ? null : num;
          } else {
            clean[c] = row[c] === '' ? null : String(row[c]);
          }
        }
      });
      if (!clean.id) clean.id = uid();
      if (!clean.tag) clean.tag = 'UNKNOWN';
      return clean;
    }
    case 'history': {
      const cols = ['id', 'ts', 'tag', 'action', 'detail', 'who', 'by'];
      cols.forEach(c => {
        if (row[c] !== undefined) {
          if (c === 'who') clean[c] = Array.isArray(row[c]) ? row[c] : [];
          else clean[c] = row[c] === '' ? null : String(row[c]);
        }
      });
      if (!clean.id) clean.id = uid();
      return clean;
    }
    case 'settings': {
      return {
        id: 'global',
        org: row.org || 'TractorJunction',
        engineer: row.engineer || '',
        locations: {
          sub: row.sub !== undefined ? row.sub : 'Assets · Employees · Software',
          logo: row.logo || '',
          list: Array.isArray(row.locations) ? row.locations : DEFAULT_LOCATIONS,
          departments: Array.isArray(row.departments) ? row.departments : DEFAULT_DEPARTMENTS,
          companies: Array.isArray(row.companies) ? row.companies : DEFAULT_COMPANIES,
          assetTypes: Array.isArray(row.assetTypes) ? row.assetTypes : ASSET_TYPES,
          customEmpFields: Array.isArray(row.customEmpFields) ? row.customEmpFields : [],
          customAssetFields: Array.isArray(row.customAssetFields) ? row.customAssetFields : [],
          itTeam: Array.isArray(row.itTeam) ? row.itTeam : [...DEFAULT_IT_TEAM],
          rolePermissions: row.rolePermissions || db.settings.rolePermissions || DEFAULT_ROLE_PERMS,
          userRoleOverrides: row.userRoleOverrides || db.settings.userRoleOverrides || {},
          knownUsers: Array.isArray(row.knownUsers) ? row.knownUsers : (db.settings.knownUsers || []),
          onboarding: Array.isArray(db.onboarding) ? db.onboarding.slice(0, 500) : [],
          tickets: Array.isArray(db.tickets) ? db.tickets.slice(0, 1000) : []
        },
        theme: row.theme || '',
        lastBackup: row.lastBackup || ''
      };
    }
    default:
      return row;
  }
}

async function sbBatchUpsert(table, rows) {
  if (!sbClient || !rows || !rows.length) return;
  const CHUNK_SIZE = 100;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE).map(r => sanitizeForSupabase(table, r)).filter(Boolean);
    const { error } = await sbClient.from(table).upsert(chunk, { onConflict: 'id' });
    if (error) throw error;
  }
}

async function syncToSupabaseFull(silent = false) {
  if (!sbClient) return;
  sbSyncInProgress = true;
  setSaveStatus('☁️ Uploading to Supabase...');
  try {
    await sbBatchUpsert('employees', db.employees);
    await sbBatchUpsert('assets', db.assets);
    await sbBatchUpsert('software', db.software);
    await sbBatchUpsert('sw_assign', db.swAssign);
    await sbBatchUpsert('maint', db.maint);
    await sbBatchUpsert('history', db.history.slice(0, 1000));
    const cleanSettings = sanitizeForSupabase('settings', db.settings);
    await sbClient.from('settings').upsert([cleanSettings], { onConflict: 'id' });

    sbOnline = true;
    dirtyQueue.fullSync = false;
    for (const k in dirtyQueue) {
      if (dirtyQueue[k] instanceof Map) dirtyQueue[k].clear();
    }
    for (const k in deletedQueue) {
      if (deletedQueue[k] instanceof Set) deletedQueue[k].clear();
    }
    if (!silent) toast(`☁️ Uploaded to Supabase (${db.employees.length} emps, ${db.assets.length} assets)`, 'ok');
    setSaveStatus(`✔ Synced to Supabase (${new Date().toLocaleTimeString()})`);
  } catch (err) {
    console.error('Full cloud sync error:', err);
    if (!silent) toast('Cloud upload failed: ' + err.message, 'err');
    setSaveStatus('⚠ Cloud upload error: ' + err.message, true);
  } finally {
    sbSyncInProgress = false;
  }
}

async function syncFromSupabase() {
  if (!sbClient) return false;
  sbSyncInProgress = true;
  setSaveStatus('☁️ Connecting to Supabase...');

  // Restricted security sandbox: If role cannot access hardware/software, only sync employees
  const canAssets = canAccessPage('assets');
  const canSw = canAccessPage('software');
  const canMaint = canAccessPage('maintenance');
  const canHist = canAccessPage('history');

  if (!canAssets && !canSw && !canMaint && !canHist) {
    try {
      const empRes = await sbClient.from('employees').select('*').limit(10000);
      if (empRes.error) throw empRes.error;
      db.employees = (empRes.data || []).map(e => unpackCustomFieldsFromRow('employees', e));
      db.assets = [];
      db.software = [];
      db.swAssign = [];
      db.maint = [];
      db.history = [];
      reindex();
      render();
      sbOnline = true;
      setSaveStatus(`✔ Connected to Supabase (${new Date().toLocaleTimeString()})`);
      setupSupabaseRealtime();
      return true;
    } catch (err) {
      console.warn('Supabase sync (Restricted role):', err);
      sbOnline = false;
      setSaveStatus('⚠ Supabase sync failed');
      return false;
    } finally {
      sbSyncInProgress = false;
    }
  }

  try {
    const [empRes, assetRes, swRes, swAssignRes, maintRes, histRes, setRes] = await Promise.all([
      sbClient.from('employees').select('*').limit(10000),
      sbClient.from('assets').select('*').limit(10000),
      sbClient.from('software').select('*').limit(10000),
      sbClient.from('sw_assign').select('*').limit(10000),
      sbClient.from('maint').select('*').limit(10000),
      sbClient.from('history').select('*').order('ts', { ascending: false }).limit(2000),
      sbClient.from('settings').select('*').eq('id', 'global').maybeSingle()
    ]);

    if (empRes.error) throw empRes.error;
    if (assetRes.error) throw assetRes.error;

    const cloudHasData = (empRes.data && empRes.data.length > 0) || (assetRes.data && assetRes.data.length > 0);

    if (!cloudHasData) {
      const localTotal = (db.employees?.length || 0) + (db.assets?.length || 0);
      if (localTotal > 0) {
        toast(`Supabase ready. Uploading ${localTotal} local records to Cloud...`, 'ok');
        await syncToSupabaseFull(true);
        toast(`Cloud populated with ${localTotal} records! ☁️`, 'ok');
        return true;
      }
      sbOnline = true;
      setSaveStatus(`✔ Connected to Supabase (Cloud is empty)`);
      setupSupabaseRealtime();
      return false;
    }

    db.employees = (empRes.data || []).map(e => unpackCustomFieldsFromRow('employees', e));
    db.assets = (assetRes.data || []).map(a => unpackCustomFieldsFromRow('assets', a));
    db.software = swRes.data || [];
    db.swAssign = swAssignRes.data || [];
    db.maint = maintRes.data || [];
    db.history = histRes.data || [];
    if (setRes.data) {
      const locData = setRes.data.locations;
      let locs = DEFAULT_LOCATIONS;
      let depts = DEFAULT_DEPARTMENTS;
      let comps = DEFAULT_COMPANIES;
      let types = ASSET_TYPES;
      let cEmp = [];
      let cAsset = [];

      if (Array.isArray(locData)) {
        locs = locData;
      } else if (locData && typeof locData === 'object') {
        locs = Array.isArray(locData.list) ? locData.list : (Array.isArray(locData.locations) ? locData.locations : DEFAULT_LOCATIONS);
        if (Array.isArray(locData.departments)) depts = locData.departments;
        if (Array.isArray(locData.companies)) comps = locData.companies;
        if (Array.isArray(locData.assetTypes)) types = locData.assetTypes;
        if (Array.isArray(locData.customEmpFields)) cEmp = locData.customEmpFields;
        if (Array.isArray(locData.customAssetFields)) cAsset = locData.customAssetFields;
        if (Array.isArray(locData.itTeam)) db.settings.itTeam = locData.itTeam;
        if (Array.isArray(locData.onboarding)) db.onboarding = locData.onboarding;
        if (Array.isArray(locData.tickets)) db.tickets = locData.tickets;
        if (locData.rolePermissions) db.settings.rolePermissions = locData.rolePermissions;
        if (locData.userRoleOverrides) db.settings.userRoleOverrides = locData.userRoleOverrides;
        if (Array.isArray(locData.knownUsers)) db.settings.knownUsers = locData.knownUsers;
        if (Array.isArray(locData.onboarding)) db.onboarding = locData.onboarding;
        if (Array.isArray(locData.tickets)) db.tickets = locData.tickets;
      }

      db.settings = {
        org: setRes.data.org || 'TractorJunction',
        sub: (locData && locData.sub !== undefined) ? locData.sub : (db.settings.sub || 'Assets · Employees · Software'),
        logo: (locData && locData.logo !== undefined) ? locData.logo : (db.settings.logo || ''),
        engineer: setRes.data.engineer || '',
        locations: sanitizeLocations(locs),
        departments: depts,
        companies: comps,
        assetTypes: types,
        customEmpFields: cEmp,
        customAssetFields: cAsset,
        itTeam: db.settings.itTeam,
        rolePermissions: db.settings.rolePermissions,
        userRoleOverrides: db.settings.userRoleOverrides,
        knownUsers: db.settings.knownUsers,
        theme: setRes.data.theme || '',
        lastBackup: setRes.data.lastBackup || ''
      };
    }
    db.savedAt = new Date().toISOString();
    await IDB.set('db', db);
    cleanCorruptedDataLocations();
    reindex();
    applyTheme();
    render();
    sbOnline = true;
    setSaveStatus(`✔ Connected to Supabase (${new Date().toLocaleTimeString()})`);
    setupSupabaseRealtime();
    toast(`☁️ Loaded ${db.employees.length} employees & ${db.assets.length} assets from Supabase`, 'ok');
    return true;
  } catch (err) {
    console.error('Supabase load error:', err);
    sbOnline = false;
    if (err.message && err.message.includes('relation') && err.message.includes('does not exist')) {
      toast('Supabase tables missing! Run schema.sql in Supabase SQL Editor.', 'err');
      setSaveStatus('⚠ Run schema.sql in Supabase SQL Editor', true);
    } else {
      setSaveStatus('⚠ Cloud offline (using local storage)', true);
    }
    return false;
  } finally {
    sbSyncInProgress = false;
  }
}

async function syncChangedToCloud() {
  if (!sbClient || sbSyncInProgress) return;
  try {
    for (const [tbl, idSet] of Object.entries(deletedQueue)) {
      if (idSet.size > 0) {
        const ids = Array.from(idSet);
        idSet.clear();
        await sbClient.from(tbl).delete().in('id', ids);
      }
    }

    if (dirtyQueue.fullSync) {
      await syncToSupabaseFull(true);
      return;
    }

    for (const tbl of ['employees', 'assets', 'software', 'sw_assign', 'maint', 'history']) {
      const q = dirtyQueue[tbl];
      if (q && q.size > 0) {
        const records = Array.from(q.values());
        q.clear();
        await sbBatchUpsert(tbl, records);
      }
    }

    if (dirtyQueue.settings) {
      dirtyQueue.settings = false;
      const cleanSettings = sanitizeForSupabase('settings', db.settings);
      await sbClient.from('settings').upsert([cleanSettings], { onConflict: 'id' });
    }

    sbOnline = true;
    setSaveStatus(`✔ Saved (browser + Supabase ☁️) ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.warn('Incremental cloud sync failed:', err);
    sbOnline = false;
  }
}

function triggerCloudSyncDebounced() {
  if (!sbClient) return;
  clearTimeout(sbCloudSyncTimer);
  sbCloudSyncTimer = setTimeout(syncChangedToCloud, 600);
}

// ---------------- Supabase Realtime (Live Collaboration) ----------------
let sbRealtimeChannel = null;
let sbRealtimeActive = false;
let realtimeDebounceTimer = null;

function setupSupabaseRealtime() {
  if (!sbClient) return;
  if (sbRealtimeChannel) {
    try { sbClient.removeChannel(sbRealtimeChannel); } catch (_) {}
    sbRealtimeChannel = null;
  }

  try {
    sbRealtimeChannel = sbClient.channel('it-asset-realtime');
    const tables = getAllowedSyncTables();
    tables.forEach(table => {
      sbRealtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        handleRealtimeChange(table, payload);
      });
    });

    sbRealtimeChannel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        sbRealtimeActive = true;
        console.log('⚡ Supabase Realtime live collaboration active');
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        sbRealtimeActive = false;
        if (err) console.warn('Supabase Realtime status:', status, err);
      }
    });
  } catch (err) {
    console.warn('Failed to initialize Supabase Realtime:', err);
  }
}

function handleRealtimeChange(table, payload) {
  if (!payload) return;
  if (!getAllowedSyncTables().includes(table)) return;
  const { eventType, new: newRec, old: oldRec } = payload;
  const id = (newRec && newRec.id) || (oldRec && oldRec.id);
  if (!id && table !== 'settings') return;

  // Avoid clobbering in-progress local unsaved edits
  if (table !== 'settings' && dirtyQueue[table] && dirtyQueue[table].has(id)) {
    return;
  }

  let changed = false;
  let summary = '';

  if (table === 'employees') {
    if (eventType === 'DELETE') {
      const before = db.employees.length;
      db.employees = db.employees.filter(e => e.id !== id);
      changed = db.employees.length !== before;
      if (changed) summary = 'Employee removed';
    } else {
      const rec = unpackCustomFieldsFromRow('employees', { ...newRec });
      const idx = db.employees.findIndex(e => e.id === rec.id);
      if (idx >= 0) {
        if (JSON.stringify(db.employees[idx]) !== JSON.stringify(rec)) {
          db.employees[idx] = Object.assign(db.employees[idx], rec);
          changed = true;
          summary = `Employee ${rec.name || rec.empCode} updated`;
        }
      } else {
        db.employees.unshift(rec);
        changed = true;
        summary = `Employee ${rec.name || rec.empCode} added`;
      }
    }
  } else if (table === 'assets') {
    if (eventType === 'DELETE') {
      const before = db.assets.length;
      db.assets = db.assets.filter(a => a.id !== id);
      changed = db.assets.length !== before;
      if (changed) summary = 'Asset removed';
    } else {
      const rec = unpackCustomFieldsFromRow('assets', { ...newRec });
      const idx = db.assets.findIndex(a => a.id === rec.id);
      if (idx >= 0) {
        if (JSON.stringify(db.assets[idx]) !== JSON.stringify(rec)) {
          db.assets[idx] = Object.assign(db.assets[idx], rec);
          changed = true;
          summary = `Asset ${rec.tag} updated`;
        }
      } else {
        db.assets.unshift(rec);
        changed = true;
        summary = `Asset ${rec.tag} added`;
      }
    }
  } else if (table === 'software') {
    if (eventType === 'DELETE') {
      db.software = db.software.filter(s => s.id !== id);
      changed = true;
    } else {
      const idx = db.software.findIndex(s => s.id === newRec.id);
      if (idx >= 0) db.software[idx] = Object.assign(db.software[idx], newRec);
      else db.software.unshift(newRec);
      changed = true;
      summary = `Software ${newRec.name} updated`;
    }
  } else if (table === 'sw_assign') {
    if (eventType === 'DELETE') {
      db.swAssign = db.swAssign.filter(s => s.id !== id);
      changed = true;
    } else {
      const idx = db.swAssign.findIndex(s => s.id === newRec.id);
      if (idx >= 0) db.swAssign[idx] = Object.assign(db.swAssign[idx], newRec);
      else db.swAssign.unshift(newRec);
      changed = true;
    }
  } else if (table === 'maint') {
    if (eventType === 'DELETE') {
      db.maint = db.maint.filter(m => m.id !== id);
      changed = true;
    } else {
      const idx = db.maint.findIndex(m => m.id === newRec.id);
      if (idx >= 0) db.maint[idx] = Object.assign(db.maint[idx], newRec);
      else db.maint.unshift(newRec);
      changed = true;
      summary = `Maintenance log for ${newRec.tag} updated`;
    }
  } else if (table === 'history') {
    if (eventType === 'INSERT') {
      if (!db.history.some(h => h.id === newRec.id)) {
        db.history.unshift(newRec);
        if (db.history.length > 2000) db.history.pop();
        changed = true;
      }
    }
  } else if (table === 'settings') {
    if (newRec && newRec.id === 'global') {
      const locData = newRec.locations;
      if (locData && typeof locData === 'object') {
        if (Array.isArray(locData.list)) db.settings.locations = sanitizeLocations(locData.list);
        if (Array.isArray(locData.departments)) db.settings.departments = locData.departments;
        if (Array.isArray(locData.companies)) db.settings.companies = locData.companies;
        if (Array.isArray(locData.assetTypes)) db.settings.assetTypes = locData.assetTypes;
        if (Array.isArray(locData.customEmpFields)) db.settings.customEmpFields = locData.customEmpFields;
        if (Array.isArray(locData.customAssetFields)) db.settings.customAssetFields = locData.customAssetFields;
        if (locData.rolePermissions) db.settings.rolePermissions = locData.rolePermissions;
        if (locData.userRoleOverrides) db.settings.userRoleOverrides = locData.userRoleOverrides;
        if (Array.isArray(locData.knownUsers)) db.settings.knownUsers = locData.knownUsers;
        if (Array.isArray(locData.onboarding)) db.onboarding = locData.onboarding;
        if (Array.isArray(locData.tickets)) db.tickets = locData.tickets;
      }
      if (newRec.org) db.settings.org = newRec.org;
      if (newRec.engineer) db.settings.engineer = newRec.engineer;
      changed = true;
      summary = 'Settings updated from cloud';
    }
  }

  if (changed) {
    IDB.set('db', db);
    reindex();
    clearTimeout(realtimeDebounceTimer);
    realtimeDebounceTimer = setTimeout(() => {
      renderBrand();
      const p = page();
      if (LISTS[p]) LISTS[p]();
      else if (PAGES[p]) PAGES[p]();
      if (summary) toast(`⚡ Live sync: ${summary}`, 'ok');
    }, 250);
  }
}

const IDB = {
  h: null,
  async open() {
    if (this.h) return this.h;
    this.h = await new Promise((res, rej) => { const r = indexedDB.open('it-asset-manager', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return this.h;
  },
  async req(mode, fn) { const d = await this.open(); return new Promise((res, rej) => { const t = d.transaction('kv', mode); const r = fn(t.objectStore('kv')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); },
  get(k) { return this.req('readonly', s => s.get(k)); },
  set(k, v) { return this.req('readwrite', s => s.put(v, k)); },
  del(k) { return this.req('readwrite', s => s.delete(k)); },
  keys() { return this.req('readonly', s => s.getAllKeys()); },
};
let fileHandle = null, fileOk = false, saveTimer = null;
function setSaveStatus(t, bad) { const el = $('#save-status'); el.textContent = t; el.classList.toggle('bad', !!bad); }
function save() { reindex(); setSaveStatus('Saving…'); clearTimeout(saveTimer); saveTimer = setTimeout(persist, 250); }
async function persist() {
  try {
    db.savedAt = new Date().toISOString();
    await IDB.set('db', db);
    let where = 'browser';
    if (fileHandle && fileOk) {
      const w = await fileHandle.createWritable(); await w.write(JSON.stringify(db)); await w.close();
      where = 'browser + ' + fileHandle.name;
    }
    if (sbClient) {
      where += (sbOnline ? (sbRealtimeActive ? ' + Supabase ⚡' : ' + Supabase ☁️') : ' + Supabase');
      triggerCloudSyncDebounced();
    }
    setSaveStatus(`✔ Saved (${where}) ${new Date().toLocaleTimeString()}`);
  } catch (e) { console.error(e); setSaveStatus('⚠ Save failed: ' + e.message, true); toast('Save failed: ' + e.message, 'err'); }
}
async function snapshotToday() {
  try {
    const k = 'snap-' + today();
    if (db.employees.length + db.assets.length && !(await IDB.get(k))) await IDB.set(k, structuredClone(db));
    const snaps = (await IDB.keys()).filter(x => String(x).startsWith('snap-')).sort();
    while (snaps.length > 14) await IDB.del(snaps.shift());
  } catch (e) { console.warn(e); }
}
function migrate(d) {
  const e = emptyDb();
  const out = Object.assign(e, d);
  out.settings = Object.assign(emptyDb().settings, d.settings || {});
  out.settings.locations = sanitizeLocations(d.settings?.locations);
  if (!Array.isArray(out.settings.departments) || !out.settings.departments.length) out.settings.departments = [...DEFAULT_DEPARTMENTS];
  if (!Array.isArray(out.settings.companies) || !out.settings.companies.length) out.settings.companies = [...DEFAULT_COMPANIES];
  if (!Array.isArray(out.settings.assetTypes) || !out.settings.assetTypes.length) out.settings.assetTypes = [...ASSET_TYPES];
  if (!Array.isArray(out.settings.customEmpFields)) out.settings.customEmpFields = [];
  if (!Array.isArray(out.settings.customAssetFields)) out.settings.customAssetFields = [];
  if (!Array.isArray(out.settings.itTeam) || !out.settings.itTeam.length || out.settings.itTeam.includes('IT Support') || !out.settings.itTeam.some(t => /ashay/i.test(t))) {
    out.settings.itTeam = [...DEFAULT_IT_TEAM];
  }
  if (!out.settings.rolePermissions || typeof out.settings.rolePermissions !== 'object') {
    out.settings.rolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMS));
  }
  if (!out.settings.userRoleOverrides || typeof out.settings.userRoleOverrides !== 'object') {
    out.settings.userRoleOverrides = {};
  } else {
    // Mo Vaseem must never be overridden
    Object.keys(out.settings.userRoleOverrides).forEach(k => {
      if (k.toLowerCase().includes('vaseem')) delete out.settings.userRoleOverrides[k];
    });
  }
  if (!Array.isArray(out.settings.knownUsers)) {
    out.settings.knownUsers = [];
  }
  for (const k of ['employees', 'assets', 'software', 'swAssign', 'maint', 'history', 'onboarding', 'tickets', 'handovers', 'clearances']) if (!Array.isArray(out[k])) out[k] = [];
  return out;
}

// ---------------- UI helpers ----------------
function toast(msg, cls = '') { const t = document.createElement('div'); t.className = 'toast ' + cls; t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), cls === 'err' ? 6000 : 3000); }
const badge = (t, cls = '') => t ? `<span class="badge ${cls}">${esc(t)}</span>` : '';
const statusBadge = s => badge(s, STATUS_CLS[s] || '');
const empStatusBadge = s => badge(s || 'Active', EMP_STATUS_CLS[s || 'Active'] || '');
const tagPill = a => `<span class="tagpill" data-act="open-asset" data-id="${a.id}" title="${esc(a.type + ' ' + (a.make || ''))}">${TYPE_ICON[a.type] || '📦'} ${esc(a.tag)}</span>`;

function modal(title, body, buttons, size = '') {
  const root = document.createElement('div'); root.className = 'modal-back';
  root.innerHTML = `<div class="modal ${size}"><header><h3>${esc(title)}</h3><button class="icon-btn" data-x>✕</button></header>
    <div class="m-body"><div class="errbox"></div>${body}</div><footer></footer></div>`;
  const close = () => root.remove();
  root.querySelector('[data-x]').onclick = close;
  root.addEventListener('mousedown', e => { if (e.target === root) close(); });
  const foot = root.querySelector('footer');
  const btns = [{ label: 'Cancel', onClick: close }, ...buttons];
  btns.forEach(b => {
    const el = document.createElement('button'); el.className = 'btn ' + (b.cls || ''); el.textContent = b.label;
    el.onclick = async () => { const r = await b.onClick(root, close); if (r === true) close(); };
    foot.append(el);
  });
  root.err = msgs => { root.querySelector('.errbox').innerHTML = (msgs || []).map(esc).join('<br>'); if (msgs && msgs.length) root.querySelector('.m-body').scrollTop = 0; };
  $('#modal-root').append(root);
  const first = root.querySelector('input:not([type=hidden]),select,textarea'); if (first) setTimeout(() => first.focus(), 30);
  return root;
}
function confirmBox(title, html, okLabel = 'Confirm', cls = 'primary') {
  return new Promise(res => {
    const m = modal(title, `<div>${html}</div>`, [{ label: okLabel, cls, onClick: () => { res(true); return true; } }], 'sm');
    m.querySelector('[data-x]').addEventListener('click', () => res(false));
    m.querySelector('footer .btn').addEventListener('click', () => res(false));
    m.addEventListener('mousedown', e => { if (e.target === m) res(false); });
  });
}
function formHTML(fields, rec) {
  return '<div class="form-grid">' + fields.map(f => {
    if (f.title) return `<div class="form-title">${esc(f.title)}</div>`;
    const v = rec[f.k] ?? '';
    let input;
    if (f.t === 'select') {
      const rawOpts = typeof f.opts === 'function' ? f.opts() : (f.opts || []);
      const opts = rawOpts.slice();
      const hasEmpty = opts.some(o => o === '' || o == null);
      let extraOpt = '';
      if (f.k === 'location') {
        extraOpt = `<option value="__new__">➕ Add new location...</option>`;
      } else if (f.k === 'department') {
        extraOpt = `<option value="__new_dept__">➕ Add new department...</option>`;
      } else if (f.k === 'company') {
        extraOpt = `<option value="__new_comp__">➕ Add new company...</option>`;
      } else if (f.k === 'type') {
        extraOpt = `<option value="__new_type__">➕ Add new asset type...</option>`;
      }
      const emptyOpt = (!hasEmpty) ? `<option value="">— Select ${esc(f.l)} —</option>` : '';
      input = `<select name="${f.k}" data-smart-select="${f.k}" ${f.k === 'location' ? 'data-location-select' : ''}>`
        + emptyOpt
        + opts.map(o => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(o || '—')}</option>`).join('')
        + (v && !opts.includes(v) && !String(v).startsWith('__new') ? `<option value="${esc(v)}" selected>${esc(v)}</option>` : '')
        + extraOpt
        + `</select>`;
    }
    else if (f.t === 'textarea') input = `<textarea name="${f.k}" rows="2">${esc(v)}</textarea>`;
    else {
      const type = f.t === 'date' ? (v && !isISO(v) ? 'text' : 'date') : (f.t || 'text');
      input = `<input name="${f.k}" type="${type}" value="${esc(v)}" ${f.list ? `list="dl_${f.list}"` : ''} autocomplete="off">`;
      if (f.suggest) input = `<div class="inline">${input}<button type="button" class="btn sm" data-suggest>Next free</button></div>`;
    }
    return `<label class="${f.full ? 'full' : ''}"><span>${esc(f.l)}${f.req ? ' *' : ''}</span>${input}</label>`;
  }).join('') + '</div>';
}
function readForm(root) { const o = {}; $$('[name]', root).forEach(el => { o[el.name] = el.type === 'checkbox' ? el.checked : norm(el.value); }); return o; }

function refreshDatalists() {
  const uniq = arr => [...new Set(arr.map(norm).filter(Boolean))].sort(natCmp);
  const opt = arr => arr.map(v => `<option value="${esc(v)}">`).join('');
  const lists = {
    department: uniq([...db.employees.map(e => e.department), ...db.assets.map(a => a.department)]),
    designation: uniq(db.employees.map(e => e.designation)),
    location: getLocations(),
    company: uniq(['FarmJunction', 'AgroWheels', 'Dhanrise', 'Yellowtork', 'FinJ', ...db.employees.map(e => e.company)]),
    make: uniq(db.assets.map(a => a.make)), processor: uniq(db.assets.map(a => a.processor)), os: uniq(db.assets.map(a => a.os)),
    engineer: uniq([db.settings.engineer, ...db.assets.map(a => a.engineer), ...db.maint.map(m => m.engineer)]),
    swcat: uniq(['Design', 'Development', 'Office', 'Finance', 'Communication', 'Utility', 'OS', ...db.software.map(s => s.category)]),
  };
  let html = Object.entries(lists).map(([k, v]) => `<datalist id="dl_${k}">${opt(v)}</datalist>`).join('');
  html += `<datalist id="dl_emp">${db.employees.filter(e => e.status !== 'Exited').map(e => `<option value="${esc(e.empCode || e.email)}">${esc(e.name)} · ${esc(e.department || '')}</option>`).join('')}</datalist>`;
  html += `<datalist id="dl_emppick">${db.employees.filter(e => e.status !== 'Exited').map(e => `<option value="${esc((e.empCode || e.email) + ' — ' + e.name)}">`).join('')}</datalist>`;
  html += `<datalist id="dl_stock">${db.assets.filter(a => a.status === 'In Stock').sort((a, b) => natCmp(a.tag, b.tag)).map(a => `<option value="${esc(a.tag + ' — ' + a.type + ' ' + (a.make || ''))}">`).join('')}</datalist>`;
  html += `<datalist id="dl_alltags">${db.assets.map(a => `<option value="${esc(a.tag)}">${esc(a.type + ' · ' + holderName(a))}</option>`).join('')}</datalist>`;
  $('#datalists').innerHTML = html;
}
function resolveEmp(str) {
  const s = norm(String(str).split(' — ')[0]); if (!s) return null;
  return IX.empCode.get(normTag(s)) || IX.empEmail.get(low(s)) || db.employees.find(e => low(e.name) === low(str)) || null;
}
const resolveAsset = str => IX.tag.get(normTag(String(str).split(' — ')[0])) || null;

// ---------------- router ----------------
const ui = {
  tickets: { q: '', status: '', priority: '', category: '', sla: '', assignedTo: '', sort: 'createdAt', dir: -1, page: 1, pageSize: 10 },
  assets: { q: '', type: '', status: '', dept: '', make: '', os: '', sort: 'tag', dir: 1, page: 1, pageSize: 10 },
  employees: { q: '', dept: '', company: '', status: 'Active', has: '', sort: 'empCode', dir: 1, page: 1, pageSize: 10 },
  onboarding: { q: '', status: '', assignedTo: '', company: '', sort: 'createdAt', dir: -1, page: 1, pageSize: 10 },
  software: { q: '', lic: '', sort: 'name', dir: 1, page: 1, pageSize: 10 },
  maintenance: { q: '', type: '', sort: 'date', dir: -1, page: 1, pageSize: 10 },
  history: { q: '', action: '', sort: 'ts', dir: -1, page: 1, pageSize: 10 },
  importTab: 'paste',
  selectedPermRole: 'hr',
  openSettingsPanels: new Set(['alerts', 'roles']),
};
const page = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');
function render() {
  if (!currentUser) {
    updateAuthUI();
    return;
  }
  const curPage = page();
  if (!canAccessPage(curPage)) {
    const fallback = ALL_PAGES.find(p => canAccessPage(p)) || 'tickets';
    location.hash = '#/' + fallback;
    return;
  }
  const p = PAGES[curPage] ? curPage : (ALL_PAGES.find(pg => canAccessPage(pg)) || 'tickets');
  document.body.classList.toggle('on-dashboard', p === 'dashboard');
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.page === p));
  renderBrand();
  refreshDatalists();
  updateEmailTaskBadge();
  updateTicketBadge();
  if (PAGES[p]) PAGES[p]();
  const n = computeIssues().filter(i => i.sev !== 'info').length; $('#issue-count').textContent = n || '';
  renderBanner();
  renderNavSub(p);
  // Export CSV lives in the top bar on the Employees and Assets pages (when topbar is visible)
  const tx = $('#top-export');
  if (tx) {
    tx.hidden = !['employees', 'assets'].includes(p);
    tx.dataset.act = p === 'assets' ? 'export-assets' : 'export-emps';
  }
  applyRoleNavRestrictions();
}
// ---- sidebar sub-menu under "Employees" (status / department / company / assets) ----
const navOpen = { employees: true, assets: true };
const navGroups = {}; // expanded sub-headings, keyed "page.group"
const NAV_PAGES = ['employees', 'assets'];
function renderNavSub(p) {
  $$('#nav .nav-sub').forEach(x => x.remove());
  NAV_PAGES.forEach(pg => $(`#nav > a[data-page="${pg}"]`)?.classList.toggle('open', p === pg && navOpen[pg]));
  if (!NAV_PAGES.includes(p) || !navOpen[p]) return;
  const link = $(`#nav > a[data-page="${p}"]`); if (!link) return;
  const st = ui[p];
  const gopen = g => navGroups[p + '.' + g] === true;
  const group = (g, t) => `<div class="sub-title ${gopen(g) ? 'open' : ''}" data-act="nav-group" data-g="${p}.${g}"><span>${t}</span><i>▸</i></div>`;
  const body = (g, inner) => gopen(g) ? `<div class="sub-body">${inner}</div>` : '';
  const item = (label, k, v, n) => `<a href="javascript:void 0" class="subitem ${st[k] === v ? 'on' : ''}" data-act="nav" data-page="${p}" data-f='${esc(JSON.stringify({ [k]: v }))}'><span>${esc(label)}</span><b>${n}</b></a>`;
  const allItem = (label, keys, n) => `<a href="javascript:void 0" class="subitem ${keys.every(k => !st[k]) ? 'on' : ''}" data-act="nav" data-page="${p}" data-f='${esc(JSON.stringify(Object.fromEntries(keys.map(k => [k, '']))))}'><span>${label}</span><b>${n}</b></a>`;
  const list = (arr, k) => arr.map(([v, n]) => item(v, k, v, n)).join('');
  const byName = arr => arr.sort((a, b) => natCmp(a[0], b[0]));
  let html = '';
  if (p === 'employees') {
    const E = db.employees, cnt = fn => E.filter(fn).length;
    const has = e => assetsOf(e).length, lap = e => assetsOf(e).some(a => ['Laptop', 'Desktop'].includes(a.type));
    const depts = byName(countBy(E.filter(e => norm(e.department)), e => norm(e.department), 80));
    const comps = byName(countBy(E.filter(e => norm(e.company)), e => norm(e.company), 30));
    html = allItem('All employees', ['q', 'status', 'dept', 'company', 'has'], E.length)
      + group('status', 'Status') + body('status', EMP_STATUSES.map(s => item(s, 'status', s, cnt(e => (e.status || 'Active') === s))).join(''))
      + group('dept', 'Department') + body('dept', list(depts, 'dept'))
      + (comps.length ? group('company', 'Company') + body('company', list(comps, 'company')) : '')
      + (canDo('canViewAssetsInEmp') ? (group('has', 'Assets') + body('has', item('Has assets', 'has', 'yes', cnt(has)) + item('No assets', 'has', 'no', cnt(e => !has(e))) + item('No laptop / desktop', 'has', 'nolap', cnt(e => !lap(e))))) : '');
  } else {
    const A = db.assets;
    const types = countBy(A, a => a.type, 40);
    const stat = STATUSES.map(s => [s, A.filter(a => a.status === s).length]);
    const depts = byName(countBy(A.filter(a => norm((holderOf(a) || a).department)), a => norm((holderOf(a) || a).department), 80));
    const makes = byName(countBy(A.filter(a => norm(a.make)), a => norm(a.make).toUpperCase(), 40));
    const oss = byName(countBy(A.filter(a => a.os), a => osFamily(a.os), 20));
    html = allItem('All assets', ['q', 'type', 'status', 'dept', 'make', 'os'], A.length)
      + group('type', 'Type') + body('type', types.map(([t, n]) => item((TYPE_ICON[t] || '') + ' ' + t, 'type', t, n)).join(''))
      + group('status', 'Status') + body('status', list(stat, 'status'))
      + group('dept', 'Department') + body('dept', list(depts, 'dept'))
      + group('make', 'Make') + body('make', list(makes, 'make'))
      + group('os', 'OS') + body('os', list(oss, 'os'));
  }
  link.insertAdjacentHTML('afterend', `<div class="nav-sub">${html}</div>`);
}
function closeSide() { $('#sidebar').classList.remove('open'); const b = $('#side-backdrop'); if (b) b.hidden = true; }
function changed() { save(); render(); refreshDrawer(); }
function go(p, filters) {
  if (filters && ui[p]) Object.assign(ui[p], filters);
  if (ui[p] && ui[p].page) ui[p].page = 1;
  if (page() === p) render(); else location.hash = '#/' + p;
}
function renderBanner() {
  let h = '';
  if (fileHandle && !fileOk) h += `<div class="bn">🔌 Auto-save file <b>${esc(fileHandle.name)}</b> needs permission again. <button class="btn sm" data-act="reconnect-file">Reconnect</button></div>`;
  const total = db.employees.length + db.assets.length;
  if (!total && page() !== 'import') h += `<div class="bn">👋 No data yet. <a href="#/import">Import your Excel sheets</a> (copy–paste works) or add records with the + buttons.</div>`;
  $('#banner').innerHTML = h;
}

// ---------------- generic table ----------------
function getAutoPageSize() {
  const vh = window.innerHeight || 800;
  const listEl = $('#list');
  let topOffset = 0;
  if (listEl) {
    const rect = listEl.getBoundingClientRect();
    topOffset = rect.top;
  }
  if (!topOffset || topOffset < 10) {
    const isMobile = window.innerWidth <= 900;
    const topbarH = isMobile ? 50 : 0;
    const bannerH = $('#banner')?.offsetHeight || 0;
    const pageHeadH = $('.page-head')?.offsetHeight || 0;
    const toolbarH = $('.toolbar')?.offsetHeight || 44;
    topOffset = topbarH + bannerH + pageHeadH + toolbarH + 20;
  }
  const bottomSpace = 90;
  const availHeight = vh - topOffset - bottomSpace;
  const rowHeight = 36;
  const count = Math.floor(availHeight / rowHeight);
  return Math.max(8, Math.min(count, 45));
}

function tableHTML(pg, cols, rows, rowAttr) {
  const st = ui[pg] || {};
  const head = cols.map(c => `<th data-sort="${pg}:${c.k}" class="${st.sort === c.k ? 'sorted' : ''}">${esc(c.l)}${st.sort === c.k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');

  const total = rows.length;
  const autoSize = getAutoPageSize();
  const rawSize = st.pageSize;
  const isAuto = !rawSize || rawSize === 'auto';
  const pageSizeVal = isAuto ? 'auto' : rawSize;
  st.pageSize = pageSizeVal;
  const ps = pageSizeVal === 'all' ? (total || 1) : (pageSizeVal === 'auto' ? autoSize : (parseInt(pageSizeVal, 10) || autoSize));
  const totalPages = Math.max(1, Math.ceil(total / ps));
  const curPage = Math.min(Math.max(1, st.page || 1), totalPages);
  st.page = curPage;

  const startIdx = total ? (curPage - 1) * ps : 0;
  const endIdx = total ? Math.min(startIdx + ps, total) : 0;
  const pageRows = total ? rows.slice(startIdx, endIdx) : [];

  const body = pageRows.map(r => `<tr ${rowAttr(r)} draggable="false">${cols.map(c => `<td data-label="${esc(c.l)}">${c.render ? c.render(r) : esc(r[c.k] ?? '')}</td>`).join('')}</tr>`).join('');

  const rangeText = total === 0 ? 'Showing <b>0</b> records' : `Showing <b>${startIdx + 1}–${endIdx}</b> of <b>${total}</b> records`;

  const paginationBar = `
    <div class="pagination-bar">
      <div class="page-info">${rangeText}</div>
      <div class="page-controls">
        <div class="page-size">
          <label>Rows per page:</label>
          <select data-act="page-size" data-pg="${pg}">
            <option value="auto" ${pageSizeVal === 'auto' ? 'selected' : ''}>Auto (Fit screen: ${ps})</option>
            <option value="10" ${pageSizeVal == 10 ? 'selected' : ''}>10</option>
            <option value="14" ${pageSizeVal == 14 ? 'selected' : ''}>14</option>
            <option value="16" ${pageSizeVal == 16 ? 'selected' : ''}>16</option>
            <option value="20" ${pageSizeVal == 20 ? 'selected' : ''}>20</option>
            <option value="30" ${pageSizeVal == 30 ? 'selected' : ''}>30</option>
            <option value="50" ${pageSizeVal == 50 ? 'selected' : ''}>50</option>
            <option value="100" ${pageSizeVal == 100 ? 'selected' : ''}>100</option>
            <option value="all" ${pageSizeVal === 'all' ? 'selected' : ''}>All (${total})</option>
          </select>
        </div>
        <div class="page-nav">
          <button class="btn sm" data-act="page-go" data-pg="${pg}" data-page="1" ${curPage <= 1 ? 'disabled' : ''} title="First page">« First</button>
          <button class="btn sm" data-act="page-go" data-pg="${pg}" data-page="${curPage - 1}" ${curPage <= 1 ? 'disabled' : ''} title="Previous page">‹ Prev</button>
          <span class="page-num">Page <b>${curPage}</b> of <b>${totalPages}</b></span>
          <button class="btn sm" data-act="page-go" data-pg="${pg}" data-page="${curPage + 1}" ${curPage >= totalPages ? 'disabled' : ''} title="Next page">Next ›</button>
          <button class="btn sm" data-act="page-go" data-pg="${pg}" data-page="${totalPages}" ${curPage >= totalPages ? 'disabled' : ''} title="Last page">Last »</button>
        </div>
      </div>
    </div>`;

  const emptyMsg = sbSyncInProgress ? '⏳ Loading records from cloud…' : 'No records found';
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="empty">${emptyMsg}</td></tr>`}</tbody></table></div>
    ${paginationBar}`;
}
function sortRows(pg, rows, cols) {
  const st = ui[pg]; const c = cols.find(c => c.k === st.sort); if (!c) return rows;
  const val = c.sortVal || (r => r[c.k]);
  return rows.slice().sort((a, b) => natCmp(val(a), val(b)) * st.dir);
}
const opts = (arr, sel, all = 'All') => `<option value="">${all}</option>` + arr.map(v => `<option ${v === sel ? 'selected' : ''} value="${esc(v)}">${esc(v)}</option>`).join('');
function countBy(arr, fn, top = 10) { const m = new Map(); for (const x of arr) { const k = fn(x) || '—'; m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]).slice(0, top); }

// ---------------- pages ----------------
const PAGES = {};

PAGES.dashboard = () => {
  const A = db.assets, E = db.employees;
  const active = E.filter(e => (e.status || 'Active') === 'Active').length;
  const by = s => A.filter(a => a.status === s).length;
  const issues = computeIssues();
  const errs = issues.filter(i => i.sev === 'err').length, warns = issues.filter(i => i.sev === 'warn').length;
  const pendingEmails = (db.onboarding || []).filter(r => r.status === 'Pending' || r.status === 'In Progress').length;
  const allTickets = db.tickets || [];
  const openTickets = allTickets.filter(t => t.status === 'Open' || t.status === 'In Progress').length;
  const breachedTickets = allTickets.filter(t => (t.status === 'Open' || t.status === 'In Progress') && getTicketSLA(t).status === 'breached').length;
  const kpi = (v, l, act, cls = '') => `<div class="kpi ${cls}" ${act}><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const bars = (title, entries, nav) => {
    const max = Math.max(1, ...entries.map(e => e[1]));
    return `<div class="card"><h3>${esc(title)}</h3>${entries.length ? entries.map(([k, v]) => `<div class="bar-row" ${nav ? `data-act="nav" data-page="assets" data-f='${esc(JSON.stringify(nav(k)))}'` : ''}><span class="bar-label" title="${esc(k)}">${esc(k)}</span><span class="bar"><i style="width:${v / max * 100}%"></i></span><span class="bar-val">${v}</span></div>`).join('') : '<div class="muted">No data</div>'}</div>`;
  };
  const comps = A.filter(a => ['Laptop', 'Desktop'].includes(a.type));
  $('#main').innerHTML = `
  <div class="grid kpis">
    ${kpi(active, 'Active employees', 'data-act="nav" data-page="employees" data-f=\'{"status":"Active"}\'')}
    ${kpi(openTickets, 'IT Tickets' + (breachedTickets ? ` (${breachedTickets} overdue)` : ''), 'data-act="nav" data-page="tickets"', breachedTickets ? 'err' : (openTickets ? 'warn' : 'ok'))}
    ${kpi(pendingEmails, 'Email tasks (HR)', 'data-act="nav" data-page="onboarding"', pendingEmails ? 'warn' : 'ok')}
    ${kpi(A.length, 'Total assets', 'data-act="nav" data-page="assets" data-f=\'{"type":"","status":""}\'')}
    ${kpi(by('In Use'), 'In use', 'data-act="nav" data-page="assets" data-f=\'{"status":"In Use","type":""}\'')}
    ${kpi(by('In Stock'), 'In stock (free)', 'data-act="nav" data-page="assets" data-f=\'{"status":"In Stock","type":""}\'', 'ok')}
    ${kpi(by('Under Repair'), 'Under repair', 'data-act="nav" data-page="assets" data-f=\'{"status":"Under Repair","type":""}\'', 'warn')}
    ${kpi(errs, 'Critical issues', 'data-act="nav" data-page="issues"', errs ? 'err' : 'ok')}
  </div>
  <div class="grid cards">
    ${bars('Assets by type', countBy(A, a => a.type, 12), k => ({ type: k, status: '' }))}
    ${bars('Laptop / Desktop make', countBy(comps, a => norm(a.make).toUpperCase(), 10), k => ({ make: k, type: '' }))}
    ${bars('Operating systems', countBy(comps, a => osFamily(a.os), 10), k => ({ os: k, type: '' }))}
    ${bars('RAM in computers', countBy(comps, a => tidySize(a.ram).toUpperCase(), 8), null)}
    ${bars('Assets in use by department', countBy(A.filter(a => a.status === 'In Use'), a => { const h = holderOf(a); return norm(h ? h.department : a.department); }, 10), k => ({ dept: k, status: 'In Use', type: '' }))}
    ${bars('Free stock by type', countBy(A.filter(a => a.status === 'In Stock'), a => a.type, 10), k => ({ type: k, status: 'In Stock' }))}
  </div>`;
};

PAGES.assets = () => {
  const st = ui.assets;
  $('#main').innerHTML = `
  <div class="toolbar">
   <input type="search" data-filter="assets.q" value="${esc(st.q)}" placeholder="Filter by tag, user, serial, make, processor…">
   <select data-filter="assets.status">${opts(STATUSES, st.status, 'All status')}</select>
   <select data-filter="assets.dept">${opts(uniqSorted(db.assets.map(a => norm((holderOf(a) || a).department))), st.dept, 'All departments')}</select>
   <select data-filter="assets.make">${opts(uniqSorted(db.assets.map(a => norm(a.make).toUpperCase())), st.make, 'All makes')}</select>
   <select data-filter="assets.os">${opts(uniqSorted(db.assets.filter(a => a.os).map(a => osFamily(a.os))), st.os, 'All OS')}</select>
   <button class="btn" data-act="export-assets">⬇ Export CSV</button>
   <button class="btn primary" data-act="add-asset">+ Add Asset</button>
  </div><div id="list"></div>`;
  LISTS.assets();
};
const ASSET_COLS = [
  { k: 'tag', l: 'Tag', render: a => `<b>${TYPE_ICON[a.type] || '📦'} ${esc(a.tag)}</b>` },
  { k: 'type', l: 'Type' },
  { k: 'make', l: 'Make / Model', render: a => esc(norm(`${a.make || ''} ${a.model || ''}`)) + (a.processor ? `<div class="muted">${esc(a.processor)}</div>` : '') },
  { k: 'holder', l: 'Assigned To', sortVal: a => holderName(a), render: a => { const h = holderOf(a); return hasHolder(a) ? `<b>${esc(holderName(a))}</b><div class="muted">${esc(h ? h.empCode : a.empCode || '')}${h ? '' : ' · <span style="color:var(--warn)">not in master</span>'}</div>` : '<span class="muted">—</span>'; } },
  { k: 'department', l: 'Dept', sortVal: a => (holderOf(a) || a).department, render: a => esc((holderOf(a) || a).department || '') },
  { k: 'os', l: 'OS', render: a => esc(a.os || '') },
  { k: 'ram', l: 'RAM / Storage', render: a => esc([a.ram, a.storage].filter(Boolean).join(' · ')) },
  { k: 'simNumber', l: 'SIM / IMEI', render: a => esc([a.simNumber, a.imei].filter(Boolean).join(' · ')) },
  { k: 'status', l: 'Status', render: a => statusBadge(a.status) },
  { k: 'allocatedDate', l: 'Allocated', render: a => esc(fmtDate(a.allocatedDate)) },
];
function filteredAssets() {
  const st = ui.assets;
  return db.assets.filter(a => (!st.type || a.type === st.type) && (!st.status || a.status === st.status)
    && (!st.dept || norm((holderOf(a) || a).department) === st.dept) && (!st.make || norm(a.make).toUpperCase() === st.make)
    && (!st.os || osFamily(a.os) === st.os) && (!st.q || matchQ(hayAsset(a), st.q)));
}
const LISTS = {};
LISTS.assets = () => { $('#list').innerHTML = tableHTML('assets', ASSET_COLS, sortRows('assets', filteredAssets(), ASSET_COLS), a => `data-act="open-asset" data-id="${a.id}"`); };

PAGES.employees = () => {
  const st = ui.employees;
  $('#main').innerHTML = `
  <div class="toolbar">
   ${!isITAdmin() ? `<span class="hr-mode-badge" style="margin:0 4px 0 0">${esc(getUserRoleName())}</span>` : ''}
   <input type="search" data-filter="employees.q" value="${esc(st.q)}" placeholder="Filter by name, code, email, designation…">
   <select data-filter="employees.status">${opts(EMP_STATUSES, st.status, 'All status')}</select>
   <select data-filter="employees.dept">${opts(uniqSorted(db.employees.map(e => norm(e.department))), st.dept, 'All departments')}</select>
   <select data-filter="employees.company">${opts(uniqSorted(db.employees.map(e => norm(e.company))), st.company, 'All companies')}</select>
   ${canDo('canViewAssetsInEmp') ? `<select data-filter="employees.has"><option value="">Any assets</option><option value="yes" ${st.has === 'yes' ? 'selected' : ''}>Has assets</option><option value="no" ${st.has === 'no' ? 'selected' : ''}>No assets</option><option value="nolap" ${st.has === 'nolap' ? 'selected' : ''}>No laptop/desktop</option></select>` : ''}
   ${canDo('canExportCSV') ? `<button class="btn" data-act="export-emps">⬇ Export CSV</button>` : ''}
   <button class="btn" data-act="req-email" style="border-color:var(--accent);color:var(--accent);font-weight:600">✉️ Request Work Email (HR)</button>
   ${canDo('canAddEditEmp') ? `<button class="btn primary" data-act="add-emp">+ Add Employee</button>` : ''}
  </div><div id="list"></div>`;
  LISTS.employees();
};
const getEmpCols = () => {
  const st = ui.employees;
  const filterStatus = st ? st.status : '';
  const dateLabel = filterStatus === 'Active'
    ? 'Joined'
    : (filterStatus === 'Notice Period' ? 'LWD / Exit' : (filterStatus === 'Exited' ? 'Exit Date' : 'Joined / Exit'));

  return [
    { k: 'empCode', l: 'Code', render: e => `<b class="mono">${esc(e.empCode || '—')}</b>` },
    { k: 'name', l: 'Name', render: e => `<b>${esc(e.name)}</b><div class="muted">${esc(e.email || '')}</div>` },
    { k: 'designation', l: 'Designation' },
    { k: 'department', l: 'Department' },
    { k: 'location', l: 'Location' },
    { k: 'company', l: 'Company' },
    {
      k: 'date',
      l: dateLabel,
      sortVal: e => {
        const s = e.status || 'Active';
        if (s === 'Notice Period' || s === 'Exited') return e.exitDate || e.doj || '';
        return e.doj || '';
      },
      render: e => {
        const s = e.status || 'Active';
        if (s === 'Notice Period') {
          return e.exitDate
            ? `<span style="color:var(--warn);font-weight:600" title="Notice Period / Last Working Day">🚪 ${esc(fmtDate(e.exitDate))}</span>`
            : (e.doj ? `<span class="muted" title="Joined: ${esc(fmtDate(e.doj))} (Exit date pending)">${esc(fmtDate(e.doj))}</span>` : '—');
        }
        if (s === 'Exited') {
          return e.exitDate
            ? `<span style="color:var(--err);font-weight:600" title="Exit Date">🚪 ${esc(fmtDate(e.exitDate))}</span>`
            : (e.doj ? `<span class="muted" title="Joined: ${esc(fmtDate(e.doj))} (Exit date pending)">${esc(fmtDate(e.doj))}</span>` : '—');
        }
        return e.doj ? `<span title="Date of Joining">${esc(fmtDate(e.doj))}</span>` : '—';
      }
    },
    ...(canDo('canViewAssetsInEmp') ? [{ k: 'assets', l: 'Assets', sortVal: e => assetsOf(e).length, render: e => assetsOf(e).map(tagPill).join('') || '<span class="muted">—</span>' }] : []),
    { k: 'status', l: 'Status', render: e => empStatusBadge(e.status) }
  ];
};
const EMP_COLS = getEmpCols();
function filteredEmps() {
  const st = ui.employees;
  return db.employees.filter(e => {
    if (st.status && (e.status || 'Active') !== st.status) return false;
    if (st.dept && norm(e.department) !== st.dept) return false;
    if (st.company && norm(e.company) !== st.company) return false;
    const as = assetsOf(e);
    if (canDo('canViewAssetsInEmp')) {
      if (st.has === 'yes' && !as.length) return false; if (st.has === 'no' && as.length) return false;
      if (st.has === 'nolap' && as.some(a => ['Laptop', 'Desktop'].includes(a.type))) return false;
    }
    const qStr = canDo('canViewAssetsInEmp') ? (hayEmp(e) + ' ' + low(as.map(a => a.tag).join(' '))) : hayEmp(e);
    return !st.q || matchQ(qStr, st.q);
  });
}
LISTS.employees = () => { 
  const cols = getEmpCols();
  $('#list').innerHTML = tableHTML('employees', cols, sortRows('employees', filteredEmps(), cols), e => `data-act="open-emp" data-id="${e.id}"`); 
};

PAGES.software = () => {
  const st = ui.software;
  $('#main').innerHTML = `
  <div class="page-head"><div><h1>Software & Licences</h1><p class="sub">Software catalogue, licence type, seats used and who has it.</p></div>
   <div class="toolbar" style="margin:0"><button class="btn" data-act="export-sw">⬇ Export CSV</button><button class="btn primary" data-act="add-sw">+ Add Software</button></div></div>
  <div class="toolbar"><input type="search" data-filter="software.q" value="${esc(st.q)}" placeholder="Filter software…">
   <select data-filter="software.lic">${opts(LIC_TYPES, st.lic, 'All licence types')}</select></div><div id="list"></div>`;
  LISTS.software();
};
const seatsUsed = s => db.swAssign.filter(x => x.swId === s.id).length;
const SW_COLS = [
  { k: 'name', l: 'Software', render: s => `<b>${esc(s.name)}</b> ${esc(s.version || '')}` },
  { k: 'category', l: 'Category' },
  { k: 'licenseType', l: 'Licence', render: s => badge(s.licenseType, s.licenseType === 'Pirated' ? 'b-err' : ['Free', 'Open Source'].includes(s.licenseType) ? 'b-ok' : 'b-acc') },
  { k: 'departments', l: 'Departments' },
  { k: 'seats', l: 'Seats used', sortVal: seatsUsed, render: s => { const u = seatsUsed(s), t = +s.totalSeats || 0; return `${u}${t ? ' / ' + t : ''} ${t && u > t ? badge('Over-used', 'b-err') : ''}`; } },
  { k: 'expiry', l: 'Renewal', render: s => { const d = daysSince(s.expiry); return esc(fmtDate(s.expiry)) + (d !== null && d > -30 ? ' ' + badge(d > 0 ? 'Expired' : 'Due soon', d > 0 ? 'b-err' : 'b-warn') : ''); } },
];
LISTS.software = () => {
  const st = ui.software;
  const rows = db.software.filter(s => (!st.lic || s.licenseType === st.lic) && (!st.q || matchQ(low(Object.values(s).join(' ')), st.q)));
  $('#list').innerHTML = tableHTML('software', SW_COLS, sortRows('software', rows, SW_COLS), s => `data-act="open-sw" data-id="${s.id}"`);
};

PAGES.maintenance = () => {
  const st = ui.maintenance;
  $('#main').innerHTML = `
  <div class="page-head"><div><h1>Maintenance & Upgrades</h1><p class="sub">RAM / storage upgrades, repairs, OS reinstalls — linked to assets & employees.</p></div>
   <div class="toolbar" style="margin:0"><button class="btn" data-act="export-maint">⬇ Export CSV</button><button class="btn primary" data-act="add-maint">+ Add Entry</button></div></div>
  <div class="toolbar"><input type="search" data-filter="maintenance.q" value="${esc(st.q)}" placeholder="Filter by tag, employee, engineer…">
   <select data-filter="maintenance.type">${opts(MAINT_TYPES, st.type, 'All types')}</select></div><div id="list"></div>`;
  LISTS.maintenance();
};
const MAINT_COLS = [
  { k: 'date', l: 'Date', sortVal: m => m.date, render: m => esc(fmtDate(m.date)) }, { k: 'type', l: 'Type', render: m => badge(m.type, 'b-info') },
  { k: 'tag', l: 'Asset', render: m => { const a = IX.tag.get(normTag(m.tag)); return a ? tagPill(a) : esc(m.tag || '—'); } },
  { k: 'name', l: 'Employee', render: m => esc(m.name || m.empCode || '') },
  { k: 'change', l: 'Before → After', render: m => esc([m.before, m.added ? '+' + m.added : '', m.after ? '→ ' + m.after : ''].filter(Boolean).join(' ')) },
  { k: 'engineer', l: 'Engineer' }, { k: 'notes', l: 'Notes' },
];
LISTS.maintenance = () => {
  const st = ui.maintenance;
  const rows = db.maint.filter(m => (!st.type || m.type === st.type) && (!st.q || matchQ(low(Object.values(m).join(' ')), st.q)));
  $('#list').innerHTML = tableHTML('maintenance', MAINT_COLS, sortRows('maintenance', rows, MAINT_COLS), m => `data-act="edit-maint" data-id="${m.id}"`);
};

PAGES.history = () => {
  const st = ui.history;
  const actions = uniqSorted(db.history.map(h => h.action));
  $('#main').innerHTML = `
  <div class="page-head"><div><h1>History / Audit log</h1><p class="sub">Every create, assign, transfer, return, edit and delete — who did it and when.</p></div>
   <div class="toolbar" style="margin:0"><button class="btn" data-act="export-history">⬇ Export CSV</button></div></div>
  <div class="toolbar"><input type="search" data-filter="history.q" value="${esc(st.q)}" placeholder="Filter by tag, employee, action…">
   <select data-filter="history.action">${opts(actions, st.action, 'All actions')}</select></div><div id="list"></div>`;
  LISTS.history();
};
const HIST_COLS = [
  { k: 'ts', l: 'When', sortVal: h => h.ts, render: h => esc(new Date(h.ts).toLocaleString()) },
  { k: 'action', l: 'Action', render: h => badge(h.action, /Delete|Lost/.test(h.action) ? 'b-err' : /Return/.test(h.action) ? 'b-ok' : 'b-acc') },
  { k: 'tag', l: 'Asset / record', render: h => `<b>${esc(h.tag)}</b>` },
  { k: 'detail', l: 'Details' },
  { k: 'by', l: 'By' },
];
LISTS.history = () => {
  const st = ui.history;
  const rows = db.history.filter(h => (!st.action || h.action === st.action) && (!st.q || matchQ(low(`${h.tag} ${h.action} ${h.detail} ${h.by} ${(h.who || []).join(' ')}`), st.q)));
  $('#list').innerHTML = tableHTML('history', HIST_COLS, sortRows('history', rows, HIST_COLS), h => `data-act="open-tag" data-tag="${esc(h.tag)}"`);
};

// ---------------- IT Helpdesk & Ticketing System ----------------
const TICKET_COLS = [
  {
    k: 'id',
    l: 'Ticket ID',
    sortVal: t => t.id,
    render: t => `
      <div style="display:flex;align-items:center;gap:6px">
        <b class="mono" style="color:var(--accent);font-size:13px">#${esc(t.id)}</b>
      </div>
      <div class="muted" style="font-size:11px">${ago(t.createdAt)}</div>
    `
  },
  {
    k: 'empName',
    l: 'Raised By',
    sortVal: t => t.empName,
    render: t => `
      <b>${esc(t.empName || 'Employee')}</b>
      <div class="muted" style="font-size:11px">
        ${esc(t.empCode ? t.empCode + ' · ' : '')}${esc(t.department || '')} ${t.location ? '(' + esc(t.location) + ')' : ''}
      </div>
    `
  },
  {
    k: 'title',
    l: 'Subject & Category',
    render: t => `
      <div style="font-weight:600;color:var(--text)">${esc(t.title)}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
        <span class="badge" style="font-size:11px;font-weight:500">${esc(t.category)}</span>
        ${t.description ? `<span class="muted" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;" title="${esc(t.description)}">${esc(t.description)}</span>` : ''}
      </div>
    `
  },
  {
    k: 'assetTag',
    l: 'Linked Hardware',
    render: t => {
      if (!t.assetTag) return '<span class="muted">—</span>';
      return `
        <span class="tagpill" data-act="open-tag" data-tag="${esc(t.assetTag)}" title="Click to view hardware details">
          💻 <b>${esc(t.assetTag)}</b>
        </span>
        ${t.assetDetails ? `<div class="muted" style="font-size:11px;margin-top:2px">${esc(t.assetDetails)}</div>` : ''}
      `;
    }
  },
  {
    k: 'priority',
    l: 'Priority',
    render: t => badge(t.priority || 'Medium', TICKET_PRIORITY_CLS[t.priority || 'Medium'])
  },
  {
    k: 'slaDueAt',
    l: 'SLA Engine',
    sortVal: t => (t.slaDueAt ? new Date(t.slaDueAt).getTime() : 0),
    render: t => {
      const sla = getTicketSLA(t);
      return `<span class="${sla.badgeCls}" title="${esc(sla.detail)}">${sla.label}</span>`;
    }
  },
  {
    k: 'assignedTo',
    l: 'Assigned IT Person',
    render: t => {
      const isUnassigned = !t.assignedTo || t.assignedTo === 'Unassigned';
      return isUnassigned
        ? `<span class="badge b-warn" style="font-weight:600">⚠️ Unassigned</span>`
        : `<span class="badge b-acc" style="font-weight:600">👤 ${esc(t.assignedTo)}</span>`;
    }
  },
  {
    k: 'status',
    l: 'Status',
    render: t => badge(t.status || 'Open', TICKET_STATUS_CLS[t.status || 'Open'])
  },
  {
    k: 'action',
    l: 'Action',
    sortVal: () => 0,
    render: t => {
      const isFinished = t.status === 'Resolved' || t.status === 'Closed';
      const isIT = canDo('canAssignTicket') || canDo('canResolveTicket') || isITAdmin();
      if (!isIT) {
        return `<button class="btn sm" data-act="open-ticket" data-id="${t.id}">👁️ View Status</button>`;
      }
      return isFinished
        ? `<button class="btn sm" data-act="open-ticket" data-id="${t.id}">View Details</button>`
        : `<button class="btn sm primary" data-act="open-ticket" data-id="${t.id}">⚡ Process / Assign</button>`;
    }
  }
];

function filteredTickets() {
  const st = ui.tickets || {};
  const isEmployeeOnly = !canDo('canViewAllTickets') && !isITAdmin();
  const myEmail = (currentUser?.email || '').toLowerCase().trim();
  const myEmp = db.employees.find(e => (e.email || '').toLowerCase().trim() === myEmail);
  const myEmpCode = myEmp ? myEmp.empCode : '';
  const myEmpName = myEmp ? myEmp.name.toLowerCase() : '';

  return (db.tickets || []).filter(t => {
    if (isEmployeeOnly) {
      const tEmail = (t.empEmail || '').toLowerCase().trim();
      const tCode = t.empCode || '';
      const tName = (t.empName || '').toLowerCase().trim();
      const match = (tEmail && tEmail === myEmail) || (myEmpCode && tCode === myEmpCode) || (myEmpName && tName === myEmpName);
      if (!match) return false;
    }

    if (st.status && t.status !== st.status) return false;
    if (st.priority && t.priority !== st.priority) return false;
    if (st.category && t.category !== st.category) return false;
    if (st.assignedTo && t.assignedTo !== st.assignedTo) return false;
    if (st.sla) {
      const sla = getTicketSLA(t);
      if (st.sla === 'breached' && sla.status !== 'breached') return false;
      if (st.sla === 'warn' && sla.status !== 'warn') return false;
      if (st.sla === 'ok' && sla.status !== 'ok') return false;
    }
    if (st.q) {
      const hay = low(`${t.id} ${t.empName} ${t.empEmail} ${t.empCode} ${t.empPhone || ''} ${t.department || ''} ${t.location || ''} ${t.category} ${t.title} ${t.description} ${t.assetTag || ''} ${t.assetDetails || ''} ${t.assignedTo || ''} ${t.resolutionNotes || ''}`);
      if (!matchQ(hay, st.q)) return false;
    }
    return true;
  });
}

LISTS.tickets = () => {
  const rows = sortRows('tickets', filteredTickets(), TICKET_COLS);
  $('#list').innerHTML = tableHTML('tickets', TICKET_COLS, rows, t => `data-act="open-ticket" data-id="${t.id}"`);
};

PAGES.tickets = () => {
  const st = ui.tickets;
  const allList = db.tickets || [];
  const isEmployeeOnly = !canDo('canViewAllTickets') && !isITAdmin();
  const myEmail = (currentUser?.email || '').toLowerCase().trim();
  const myEmp = db.employees.find(e => (e.email || '').toLowerCase().trim() === myEmail);
  const myEmpCode = myEmp ? myEmp.empCode : '';
  const myEmpName = myEmp ? myEmp.name : (currentUser?.email?.split('@')[0] || 'Employee');

  // Employee's held assets
  const myAssets = db.assets.filter(a => {
    if (!myEmail && !myEmpCode) return false;
    const matchEmail = a.holderEmail && a.holderEmail.toLowerCase().trim() === myEmail;
    const matchCode = myEmpCode && a.empCode === myEmpCode;
    return matchEmail || matchCode;
  });

  if (isEmployeeOnly) {
    const myTickets = allList.filter(t => {
      const tEmail = (t.empEmail || '').toLowerCase().trim();
      const tCode = t.empCode || '';
      return (tEmail && tEmail === myEmail) || (myEmpCode && tCode === myEmpCode);
    });
    const myActive = myTickets.filter(t => t.status === 'Open' || t.status === 'In Progress').length;
    const myDone = myTickets.filter(t => t.status === 'Resolved' || t.status === 'Closed').length;

    $('#main').innerHTML = `
      <div class="emp-helpdesk-banner">
        <div>
          <h2><span>👋</span> Namaste, ${esc(myEmpName)}!</h2>
          <p>Welcome to TractorJunction IT Helpdesk. Any laptop issue, software request, network difficulty, or Google Workspace problem? Raise a ticket below and our IT engineers will resolve it within guaranteed SLA hours.</p>
          ${myAssets.length ? `
            <div class="emp-asset-summary-pill">
              <span>💻 Your Issued Assets:</span>
              <b>${myAssets.map(a => `${esc(a.tag)} (${esc(a.type)} - ${esc(a.make || '')} ${esc(a.model || '')})`).join(', ')}</b>
            </div>
          ` : ''}
        </div>
        <div>
          <button class="btn primary" data-act="raise-ticket" style="font-size:14px;padding:12px 20px;font-weight:700;box-shadow:0 4px 14px rgba(37,99,235,0.4)">
            🎫 + Raise New IT Ticket
          </button>
        </div>
      </div>

      <div class="grid kpis" style="margin-bottom:16px">
        <div class="kpi ${myActive ? 'warn' : 'ok'}" data-act="filter-ticket" data-status="${myActive ? 'Open' : ''}">
          <div class="v">${myActive}</div>
          <div class="l">Active Support Tickets</div>
        </div>
        <div class="kpi ok" data-act="filter-ticket" data-status="Resolved">
          <div class="v">${myDone}</div>
          <div class="l">Resolved Tickets</div>
        </div>
        <div class="kpi" data-act="filter-ticket" data-status="">
          <div class="v">${myTickets.length}</div>
          <div class="l">Total Raised By You</div>
        </div>
      </div>

      <div class="toolbar">
        <input type="search" data-filter="tickets.q" value="${esc(st.q || '')}" placeholder="Search my tickets (subject, description, ticket ID…)">
        <select data-filter="tickets.status">
          <option value="">All Status (${myTickets.length})</option>
          <option value="Open" ${st.status === 'Open' ? 'selected' : ''}>Open</option>
          <option value="In Progress" ${st.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
          <option value="Resolved" ${st.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
          <option value="Closed" ${st.status === 'Closed' ? 'selected' : ''}>Closed</option>
        </select>
        <button class="btn primary" data-act="raise-ticket">+ Raise Ticket</button>
      </div>

      <div id="list"></div>
    `;
    LISTS.tickets();
    return;
  }

  // IT Team / IT Admin Queue View
  const openCount = allList.filter(t => t.status === 'Open').length;
  const inProgCount = allList.filter(t => t.status === 'In Progress').length;
  const breachedCount = allList.filter(t => (t.status === 'Open' || t.status === 'In Progress') && getTicketSLA(t).status === 'breached').length;
  const resolvedCount = allList.filter(t => t.status === 'Resolved' || t.status === 'Closed').length;
  const itPersons = uniqSorted([...getITTeam(), ...allList.map(t => t.assignedTo).filter(Boolean)]);

  const kpiBox = (label, count, cls, stat, sla = '') => `
    <div class="kpi ${cls}" data-act="filter-ticket" data-status="${stat}" data-sla="${sla}" style="cursor:pointer">
      <div class="v">${count}</div>
      <div class="l">${label}</div>
    </div>`;

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <h1>🎫 IT Helpdesk &amp; Support Tickets</h1>
        <p class="sub">Central support queue: manage employee requests, delegate to IT engineers, track SLA deadlines &amp; send instant WhatsApp updates.</p>
      </div>
      <div class="toolbar" style="margin:0">
        <button class="btn primary" data-act="raise-ticket" style="font-weight:600">🎫 + Raise Ticket</button>
      </div>
    </div>

    <div class="grid kpis" style="margin-bottom:14px">
      ${kpiBox('Open / Unresolved', openCount, openCount ? 'warn' : 'ok', 'Open')}
      ${kpiBox('In Progress', inProgCount, inProgCount ? 'b-acc' : '', 'In Progress')}
      ${kpiBox('SLA Breached / Overdue', breachedCount, breachedCount ? 'err' : 'ok', '', 'breached')}
      ${kpiBox('Resolved & Closed', resolvedCount, 'ok', 'Resolved')}
      ${kpiBox('Total Tickets', allList.length, '', '')}
    </div>

    <div class="toolbar">
      <input type="search" data-filter="tickets.q" value="${esc(st.q || '')}" placeholder="Search by Ticket ID, Employee, Subject, Laptop Tag, Issue…">
      <select data-filter="tickets.status">
        <option value="">All Status (${allList.length})</option>
        <option value="Open" ${st.status === 'Open' ? 'selected' : ''}>Open (${openCount})</option>
        <option value="In Progress" ${st.status === 'In Progress' ? 'selected' : ''}>In Progress (${inProgCount})</option>
        <option value="Resolved" ${st.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
        <option value="Closed" ${st.status === 'Closed' ? 'selected' : ''}>Closed</option>
      </select>
      <select data-filter="tickets.priority">
        <option value="">All Priorities</option>
        <option value="Critical" ${st.priority === 'Critical' ? 'selected' : ''}>Critical (4h SLA)</option>
        <option value="High" ${st.priority === 'High' ? 'selected' : ''}>High (8h SLA)</option>
        <option value="Medium" ${st.priority === 'Medium' ? 'selected' : ''}>Medium (24h SLA)</option>
        <option value="Low" ${st.priority === 'Low' ? 'selected' : ''}>Low (48h SLA)</option>
      </select>
      <select data-filter="tickets.sla">
        <option value="">All SLA Status</option>
        <option value="breached" ${st.sla === 'breached' ? 'selected' : ''}>🔴 Overdue / Breached</option>
        <option value="warn" ${st.sla === 'warn' ? 'selected' : ''}>🟡 Due Soon (&lt;2h)</option>
        <option value="ok" ${st.sla === 'ok' ? 'selected' : ''}>🟢 Within SLA Target</option>
      </select>
      <select data-filter="tickets.category">
        <option value="">All Categories</option>
        ${TICKET_CATEGORIES.map(c => `<option value="${esc(c)}" ${st.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
      <select data-filter="tickets.assignedTo">
        <option value="">All Assigned Engineers</option>
        <option value="Unassigned" ${st.assignedTo === 'Unassigned' ? 'selected' : ''}>⚠️ Unassigned</option>
        ${itPersons.filter(p => p !== 'Unassigned').map(p => `<option value="${esc(p)}" ${st.assignedTo === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
      </select>
      <button class="btn" data-act="export-tickets">⬇ Export CSV</button>
    </div>

    <div id="list"></div>
  `;
  LISTS.tickets();
};

function raiseTicketModal(preset = {}) {
  const depts = getDepartments();
  const locs = getLocations();
  const myEmail = (currentUser?.email || '').toLowerCase().trim();
  const isEmployeeOnly = !canDo('canViewAllTickets') && !isITAdmin();

  let defaultEmp = preset.emp || null;
  if (!defaultEmp && myEmail) {
    defaultEmp = db.employees.find(e => (e.email || '').toLowerCase().trim() === myEmail);
  }

  // Determine assets held by selected employee
  const getAssetsForEmp = (emp) => {
    if (!emp) return [];
    const empEmail = (emp.email || '').toLowerCase().trim();
    const empCode = emp.empCode || '';
    return db.assets.filter(a => {
      const matchEmail = empEmail && (a.holderEmail || '').toLowerCase().trim() === empEmail;
      const matchCode = empCode && a.empCode === empCode;
      return matchEmail || matchCode;
    });
  };

  const initialAssets = getAssetsForEmp(defaultEmp);
  const attachments = [];

  const body = `
    <form id="raise-ticket-form" class="form-grid">
      <div style="grid-column:1 / -1;margin-bottom:4px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <h4 style="margin:0;font-size:14px;color:var(--text)">👤 Employee &amp; Contact Details</h4>
          <span class="badge b-acc" style="font-size:11px">Guaranteed IT SLA</span>
        </div>
      </div>

      <label><b>Employee Name *</b>
        <input name="empName" value="${esc(defaultEmp?.name || (isEmployeeOnly ? currentUser?.email?.split('@')[0] : ''))}" required placeholder="Full Name" ${isEmployeeOnly ? 'readonly' : ''}>
      </label>

      <label><b>Work Email *</b>
        <input name="empEmail" type="email" value="${esc(defaultEmp?.email || myEmail)}" required placeholder="name@tractorjunction.com" ${isEmployeeOnly ? 'readonly' : ''}>
      </label>

      <label><b>Employee Code</b>
        <input name="empCode" value="${esc(defaultEmp?.empCode || '')}" placeholder="e.g. TJ0023" ${isEmployeeOnly ? 'readonly' : ''}>
      </label>

      <label><b>Contact / WhatsApp Phone *</b>
        <input name="empPhone" value="${esc(defaultEmp?.phone || '')}" required placeholder="e.g. 9876543210" pattern="[0-9+ -]{8,15}">
      </label>

      <label><b>Department</b>
        <select name="department" ${isEmployeeOnly ? 'disabled' : ''}>
          <option value="">Select Department</option>
          ${depts.map(d => `<option value="${esc(d)}" ${defaultEmp?.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
        </select>
      </label>

      <label><b>Office Location / Branch</b>
        <select name="location" ${isEmployeeOnly ? 'disabled' : ''}>
          <option value="">Select Location</option>
          ${locs.map(l => `<option value="${esc(l)}" ${defaultEmp?.location === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
      </label>

      <div style="grid-column:1 / -1;margin-top:10px;margin-bottom:4px">
        <h4 style="margin:0;font-size:14px;color:var(--text)">🛠️ Issue &amp; Hardware Details</h4>
      </div>

      <label><b>Issue Category *</b>
        <select name="category" required>
          ${TICKET_CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
      </label>

      <label><b>Priority &amp; Guaranteed SLA *</b>
        <select name="priority" id="tck-priority-select" required>
          <option value="Critical">🔴 Critical (4 Hours SLA - Complete Work Stopper)</option>
          <option value="High">🟠 High (8 Hours SLA / 1 Working Day)</option>
          <option value="Medium" selected>🟡 Medium (24 Hours SLA - Standard Issue)</option>
          <option value="Low">🟢 Low (48 Hours SLA - General Query / Request)</option>
        </select>
      </label>

      <label style="grid-column:1 / -1"><b>Select Related Hardware / Laptop</b>
        <select name="assetTag" id="tck-asset-select">
          <option value="">— None / General Issue (No specific hardware) —</option>
          ${initialAssets.map(a => `<option value="${esc(a.tag)}">💻 ${esc(a.tag)} · ${esc(a.type)} (${esc(a.make || '')} ${esc(a.model || '')} - Serial: ${esc(a.serialNo || '—')}) [Assigned to You]</option>`).join('')}
        </select>
        <span class="muted" style="font-size:11px;display:block;margin-top:4px">Linking your laptop/desktop allows the IT engineer to instantly inspect hardware specs, serial number &amp; warranty.</span>
      </label>

      <label style="grid-column:1 / -1"><b>Issue Title / Subject *</b>
        <input name="title" required placeholder="e.g. Laptop screen flickering and freezing randomly" maxlength="150">
      </label>

      <label style="grid-column:1 / -1"><b>Detailed Description of Issue *</b>
        <textarea name="description" rows="4" required placeholder="Please describe what happens, any error message shown, and when the issue started…"></textarea>
      </label>

      <div class="tck-photo-box">
        <b style="font-size:12px;">📷 Attach Photos / Screenshots (Optional, Max 4)</b>
        <div class="tck-photo-actions">
          <button type="button" class="btn sm" id="tck-btn-upload">📁 Upload Photo</button>
          <button type="button" class="btn sm" id="tck-btn-camera">📷 Take Photo (Camera)</button>
          <span class="muted" style="font-size:11px;">Laptop error screen ya damage ki photo lagayein</span>
          <input type="file" id="tck-file-upload" accept="image/*" multiple hidden>
          <input type="file" id="tck-file-camera" accept="image/*" capture="environment" hidden>
        </div>
        <div id="tck-photo-previews" class="tck-photo-grid" style="display:none;"></div>
      </div>

      <div style="grid-column:1 / -1;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:12px;font-size:12px;">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:16px">⏱️</span>
          <b>SLA Commitment:</b>
          <span id="tck-sla-guarantee" style="color:var(--accent);font-weight:600">Based on Priority [Medium], IT Team will resolve this within 24 Hours.</span>
        </div>
      </div>
    </form>
  `;

  modal('🎫 Raise IT Helpdesk Ticket', body, [
    {
      label: 'Submit Ticket 🚀',
      cls: 'primary',
      onClick: async () => {
        const form = $('#raise-ticket-form');
        if (!form || !form.reportValidity()) return false;
        const fd = new FormData(form);
        const priority = fd.get('priority') || 'Medium';
        const slaHours = TICKET_SLA_HOURS[priority] || 24;
        const now = new Date();
        const dueAt = new Date(now.getTime() + slaHours * 3600 * 1000);

        const assetTag = norm(fd.get('assetTag') || '');
        let assetDetails = '';
        if (assetTag) {
          const a = IX.tag.get(normTag(assetTag));
          if (a) assetDetails = `${a.type} ${a.make || ''} ${a.model || ''} (S/N: ${a.serialNo || '—'})`;
        }

        const tckNum = db.tickets.length 
          ? Math.max(...db.tickets.map(t => +(String(t.id).replace(/\D/g, '')) || 1000)) + 1 
          : 1001;

        const ticket = {
          id: 'TCK-' + tckNum,
          createdAt: now.toISOString(),
          empName: norm(fd.get('empName')),
          empEmail: norm(fd.get('empEmail')).toLowerCase(),
          empCode: norm(fd.get('empCode')),
          empPhone: norm(fd.get('empPhone')),
          department: norm(fd.get('department') || defaultEmp?.department || ''),
          location: norm(fd.get('location') || defaultEmp?.location || ''),
          category: norm(fd.get('category')),
          priority,
          slaHours,
          slaDueAt: dueAt.toISOString(),
          assetTag,
          assetDetails,
          title: norm(fd.get('title')),
          description: norm(fd.get('description')),
          attachments: attachments.slice(),
          status: 'Open',
          assignedTo: 'Unassigned',
          assignedAt: '',
          resolvedAt: '',
          resolvedBy: '',
          resolutionNotes: '',
          activity: [
            { at: now.toISOString(), by: norm(fd.get('empName')), text: `Ticket raised (${priority} - ${slaHours}h SLA)` }
          ]
        };

        if (!Array.isArray(db.tickets)) db.tickets = [];
        db.tickets.unshift(ticket);
        dirtyQueue.settings = true;
        save();
        updateTicketBadge();
        log(ticket.id, 'Ticket Raised', `${ticket.title} [${ticket.priority}]`, [ticket.empName, ticket.assetTag]);
        toast(`🎫 Ticket #${ticket.id} raised! SLA: ${slaHours}h.`, 'ok');
        changed();
        return true;
      }
    }
  ], 'md');

  setTimeout(() => {
    const pSelect = $('#tck-priority-select');
    const gText = $('#tck-sla-guarantee');
    if (pSelect && gText) {
      pSelect.addEventListener('change', () => {
        const p = pSelect.value;
        const h = TICKET_SLA_HOURS[p] || 24;
        gText.textContent = `Based on Priority [${p}], IT Team will resolve this within ${h} Hours.`;
      });
    }

    const prevBox = $('#tck-photo-previews');
    const upInp = $('#tck-file-upload');
    const camInp = $('#tck-file-camera');
    const renderPreviews = () => {
      if (!prevBox) return;
      if (!attachments.length) { prevBox.style.display = 'none'; prevBox.innerHTML = ''; return; }
      prevBox.style.display = 'flex';
      prevBox.innerHTML = attachments.map((att, i) => `
        <div class="tck-photo-thumb" title="${esc(att.name)}">
          <img src="${att.dataUrl}" alt="Issue photo ${i + 1}">
          <button type="button" class="tck-photo-rm" data-rm-photo="${i}" title="Remove photo">✕</button>
        </div>`).join('');
      prevBox.querySelectorAll('[data-rm-photo]').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          attachments.splice(+btn.dataset.rmPhoto, 1);
          renderPreviews();
        };
      });
    };
    const handleFiles = async (files) => {
      for (const file of [...(files || [])]) {
        if (attachments.length >= 4) { toast('Maximum 4 photos attach kar sakte hain', 'warn'); break; }
        try {
          const dataUrl = await readImageFile(file, 1024);
          attachments.push({ name: file.name || 'photo.png', dataUrl });
        } catch (err) {
          toast(err.message || 'Image read failed', 'err');
        }
      }
      renderPreviews();
    };
    $('#tck-btn-upload')?.addEventListener('click', () => upInp?.click());
    $('#tck-btn-camera')?.addEventListener('click', () => camInp?.click());
    upInp?.addEventListener('change', async () => { await handleFiles(upInp.files); upInp.value = ''; });
    camInp?.addEventListener('change', async () => { await handleFiles(camInp.files); camInp.value = ''; });
  }, 50);
}

function processTicketModal(ticket) {
  const isIT = canDo('canAssignTicket') || canDo('canResolveTicket') || isITAdmin();
  const sla = getTicketSLA(ticket);
  const itTeam = getITTeam();
  const asset = ticket.assetTag ? IX.tag.get(normTag(ticket.assetTag)) : null;

  const getWaUrl = (phone, text) => {
    const clean = String(phone || '').replace(/\D/g, '');
    const num = clean.startsWith('91') ? clean : (clean.length === 10 ? '91' + clean : clean);
    return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  };

  const employeeWaText = `Hello ${ticket.empName},\nRegarding your TractorJunction IT Support Ticket #${ticket.id} [${ticket.title}]:`;

  const body = `
    <div style="background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <b class="mono" style="font-size:18px;color:var(--accent)">#${esc(ticket.id)}</b>
            ${badge(ticket.category, 'badge')}
            ${badge(ticket.priority, TICKET_PRIORITY_CLS[ticket.priority])}
            ${badge(ticket.status || 'Open', TICKET_STATUS_CLS[ticket.status || 'Open'])}
          </div>
          <h3 style="margin:6px 0 2px;font-size:16px">${esc(ticket.title)}</h3>
          <span class="muted" style="font-size:12px">Raised ${ago(ticket.createdAt)} (${fmtDate(ticket.createdAt)})</span>
        </div>
        <div>
          <span class="${sla.badgeCls}" style="font-size:12px;padding:5px 12px" title="${esc(sla.detail)}">${sla.label}</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;font-size:12px;background:var(--panel);padding:12px;border-radius:8px;border:1px solid var(--line)">
        <div><span class="muted">Requester:</span> <b>${esc(ticket.empName)}</b> ${ticket.empCode ? `(${esc(ticket.empCode)})` : ''}</div>
        <div><span class="muted">Department:</span> ${esc(ticket.department || '—')}</div>
        <div><span class="muted">Location:</span> ${esc(ticket.location || '—')}</div>
        <div><span class="muted">Work Email:</span> <a href="mailto:${esc(ticket.empEmail)}">${esc(ticket.empEmail)}</a></div>
        <div><span class="muted">Phone / WA:</span> <b>${esc(ticket.empPhone || '—')}</b> 
          ${ticket.empPhone ? `<a href="${getWaUrl(ticket.empPhone, employeeWaText)}" target="_blank" class="tagpill" style="margin-left:6px;background:rgba(34,197,94,0.15);color:#4ade80;border-color:rgba(74,222,128,0.3)">💬 WhatsApp</a>` : ''}
        </div>
        <div><span class="muted">SLA Deadline:</span> <b>${fmtDate(ticket.slaDueAt)}</b> (${ticket.slaHours}h target)</div>
      </div>

      ${ticket.assetTag ? `
        <div style="margin-top:10px;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.25);border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div>
            <span style="font-size:12px;color:var(--muted)">Assigned Hardware:</span>
            <div style="font-weight:600;font-size:13px;margin-top:2px">
              💻 ${esc(ticket.assetTag)} ${asset ? `· ${esc(asset.type)} ${esc(asset.make || '')} ${esc(asset.model || '')} (S/N: ${esc(asset.serialNo || '—')})` : esc(ticket.assetDetails || '')}
            </div>
          </div>
          ${asset ? `<button type="button" class="btn sm" data-act="open-asset" data-id="${asset.id}">Inspect Asset Specs</button>` : ''}
        </div>
      ` : ''}

      <div style="margin-top:12px;font-size:13px;line-height:1.5;background:var(--panel);padding:12px;border-radius:8px;border:1px solid var(--line)">
        <b style="color:var(--muted);display:block;font-size:11px;text-transform:uppercase;margin-bottom:4px">Problem Description:</b>
        ${esc(ticket.description)}
        ${Array.isArray(ticket.attachments) && ticket.attachments.length ? `
          <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);">
            <b style="color:var(--muted);display:block;font-size:11px;text-transform:uppercase;margin-bottom:6px">Attached Photos (${ticket.attachments.length}):</b>
            <div class="tck-photo-grid" style="margin-top:0;">
              ${ticket.attachments.map((att, i) => `
                <div class="tck-photo-thumb" data-view-photo="${i}" title="Click to view full photo">
                  <img src="${att.dataUrl}" alt="${esc(att.name || 'Issue photo')}">
                </div>`).join('')}
            </div>
          </div>` : ''}
      </div>

      ${ticket.resolutionNotes ? `
        <div style="margin-top:12px;background:rgba(34,197,94,0.08);border:1px solid rgba(74,222,128,0.3);border-radius:8px;padding:12px;">
          <b style="color:#4ade80;font-size:12px;display:flex;align-items:center;gap:6px">
            ✅ Technical Resolution by ${esc(ticket.resolvedBy || 'IT Engineer')} ${ticket.resolvedAt ? `(${ago(ticket.resolvedAt)})` : ''}:
          </b>
          <div style="font-size:13px;margin-top:4px;color:var(--text)">${esc(ticket.resolutionNotes)}</div>
        </div>
      ` : ''}

      ${Array.isArray(ticket.activity) && ticket.activity.length ? `
        <div class="ticket-activity-box">
          <b style="font-size:11px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:6px">Audit &amp; Action Log</b>
          ${ticket.activity.map(a => `
            <div class="ticket-act-row">
              <span class="ticket-act-time">${ago(a.at)}</span>
              <div><b>${esc(a.by || 'System')}:</b> ${esc(a.text)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>

    ${isIT ? `
      <form id="tck-process-form" class="form-grid">
        <div style="grid-column:1 / -1;margin-bottom:4px">
          <h4 style="margin:0;font-size:14px;color:var(--text)">🛠️ IT Management &amp; Assignment</h4>
        </div>

        <label><b>Assign IT Engineer</b>
          <select name="assignedTo" id="tck-assignee-select">
            <option value="Unassigned">⚠️ Unassigned</option>
            ${itTeam.map(t => {
              const isMgr = /manager/i.test(t);
              return `<option value="${esc(t)}" ${t === ticket.assignedTo ? 'selected' : ''}>${isMgr ? '👑' : '👤'} ${esc(t)}</option>`;
            }).join('')}
          </select>
        </label>

        <label><b>Ticket Status</b>
          <select name="status" id="tck-status-select">
            ${TICKET_STATUSES.map(s => `<option value="${esc(s)}" ${s === ticket.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>
        </label>

        <label style="grid-column:1 / -1"><b>Resolution Notes (Work Performed / Root Cause)</b>
          <textarea name="resolutionNotes" rows="3" placeholder="e.g. Replaced RAM module, tested Windows memory diagnostics, boots smoothly. Verified with employee.">${esc(ticket.resolutionNotes || '')}</textarea>
        </label>

        <div style="grid-column:1 / -1;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:4px">
          <button type="button" class="btn" id="btn-wa-it-delegate" style="font-size:12px">
            📲 WhatsApp Assigned Engineer
          </button>
          <button type="button" class="btn ok" id="btn-wa-emp-resolve" style="font-size:12px">
            💬 1-Click WhatsApp Resolution to Employee
          </button>
        </div>
      </form>
    ` : ''}
  `;

  const buttons = [{ label: 'Close', act: 'close' }];
  if (isIT) {
    buttons.push({
      label: 'Save & Update Ticket ✔',
      cls: 'primary',
      act: async () => {
        const form = $('#tck-process-form');
        if (!form) return true;
        const fd = new FormData(form);
        const newAssignee = norm(fd.get('assignedTo') || 'Unassigned');
        const newStatus = norm(fd.get('status') || 'Open');
        const newNotes = norm(fd.get('resolutionNotes') || '');
        const now = new Date();

        const oldAssignee = ticket.assignedTo;
        const oldStatus = ticket.status;

        ticket.assignedTo = newAssignee;
        ticket.status = newStatus;
        ticket.resolutionNotes = newNotes;

        if (!Array.isArray(ticket.activity)) ticket.activity = [];

        if (oldAssignee !== newAssignee) {
          ticket.assignedAt = now.toISOString();
          ticket.activity.unshift({
            at: now.toISOString(),
            by: currentUser?.email?.split('@')[0] || 'IT Admin',
            text: `Assigned to ${newAssignee}`
          });
        }

        if (oldStatus !== newStatus) {
          if (newStatus === 'Resolved' || newStatus === 'Closed') {
            ticket.resolvedAt = now.toISOString();
            ticket.resolvedBy = currentUser?.email?.split('@')[0] || 'IT Engineer';
          }
          ticket.activity.unshift({
            at: now.toISOString(),
            by: currentUser?.email?.split('@')[0] || 'IT Admin',
            text: `Status changed from ${oldStatus} to ${newStatus}`
          });
        }

        if (newNotes && newNotes !== ticket.resolutionNotes) {
          ticket.activity.unshift({
            at: now.toISOString(),
            by: currentUser?.email?.split('@')[0] || 'IT Engineer',
            text: `Added resolution notes: ${newNotes.slice(0, 60)}…`
          });
        }

        dirtyQueue.settings = true;
        save();
        updateTicketBadge();
        log(ticket.id, `Ticket ${newStatus}`, `${ticket.title} (${newAssignee})`, [ticket.empName, newAssignee]);
        toast(`Ticket #${ticket.id} updated! Status: ${newStatus}`, 'ok');
        changed();
        return true;
      }
    });
  }

  const tckModal = modal(`Ticket Details: #${ticket.id}`, body, buttons, 'md');
  tckModal.querySelectorAll('[data-view-photo]').forEach(el => {
    el.onclick = () => {
      const att = (ticket.attachments || [])[+el.dataset.viewPhoto];
      if (!att) return;
      modal(`📷 ${att.name || 'Issue Photo'}`, `<div style="text-align:center;"><img src="${att.dataUrl}" style="max-width:100%;max-height:70vh;border-radius:10px;border:1px solid var(--line);"></div>`, [], 'md');
    };
  });

  setTimeout(() => {
    const btnWaDelegate = $('#btn-wa-it-delegate');
    if (btnWaDelegate) {
      btnWaDelegate.onclick = () => {
        const assignee = $('#tck-assignee-select')?.value || ticket.assignedTo;
        const text = `TractorJunction IT Helpdesk\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nHello ${assignee},\nTicket #${ticket.id} [${ticket.priority} - ${ticket.slaHours}h SLA] has been assigned to you:\n👤 Requester: ${ticket.empName} (${ticket.department})\n💻 Hardware : ${ticket.assetTag || 'General'}\n⚠️ Issue    : ${ticket.title}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPlease inspect and resolve within SLA.`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      };
    }

    const btnWaEmp = $('#btn-wa-emp-resolve');
    if (btnWaEmp) {
      btnWaEmp.onclick = () => {
        const status = $('#tck-status-select')?.value || ticket.status;
        const notes = $('textarea[name="resolutionNotes"]')?.value || ticket.resolutionNotes || 'Resolved successfully.';
        const text = `TractorJunction IT Helpdesk\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nHello ${ticket.empName},\nYour IT Support Ticket #${ticket.id} status is now: ${status} ✅\n\nIssue   : ${ticket.title}\nEngineer: ${ticket.assignedTo || 'IT Team'}\nNotes   : ${notes}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nThank you for contacting TractorJunction IT Support!`;
        const phone = ticket.empPhone;
        if (phone) {
          window.open(getWaUrl(phone, text), '_blank');
        } else {
          window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
        }
      };
    }
  }, 50);
}

function exportTicketsCSV() {
  const CSV_TICKETS = [
    ['Ticket ID', 'id'],
    ['Created At', 'createdAt'],
    ['Employee Name', 'empName'],
    ['Employee Code', 'empCode'],
    ['Work Email', 'empEmail'],
    ['Phone', 'empPhone'],
    ['Department', 'department'],
    ['Location', 'location'],
    ['Category', 'category'],
    ['Priority', 'priority'],
    ['SLA Hours', 'slaHours'],
    ['SLA Deadline', 'slaDueAt'],
    ['Linked Hardware', 'assetTag'],
    ['Hardware Details', 'assetDetails'],
    ['Subject', 'title'],
    ['Description', 'description'],
    ['Assigned To', 'assignedTo'],
    ['Status', 'status'],
    ['Resolved At', 'resolvedAt'],
    ['Resolved By', 'resolvedBy'],
    ['Resolution Notes', 'resolutionNotes']
  ];
  download(`it-helpdesk-tickets-${today()}.csv`, toCSV(filteredTickets(), CSV_TICKETS), 'text/csv');
}

// ---------------- onboarding & email requests ----------------
const ONBOARD_PRIORITY_CLS = {
  'Urgent': 'b-err',
  'High': 'b-warn',
  'Normal': 'b-info'
};
const ONBOARD_STATUS_CLS = {
  'Pending': 'b-warn',
  'In Progress': 'b-info',
  'Completed': 'b-ok',
  'Cancelled': 'muted'
};

const ONBOARD_COLS = [
  { k: 'priority', l: 'Priority', render: r => badge(r.priority || 'Normal', ONBOARD_PRIORITY_CLS[r.priority || 'Normal']) },
  { k: 'name', l: 'Employee (New Joiner)', render: r => `<b>${esc(r.name)}</b><div class="muted">${esc(r.personalEmail || r.phone || '—')}</div>` },
  { k: 'designation', l: 'Role / Dept', render: r => `${esc(r.designation || '—')}<div class="muted">${esc(r.department || '')} · ${esc(r.location || '')}</div>` },
  { k: 'company', l: 'Payroll Group', render: r => `<span class="chip" style="font-size:11px;font-weight:600;">🏛️ ${esc(r.company || '—')}</span>` },
  { k: 'doj', l: 'Joining Date', sortVal: r => r.doj, render: r => `<b>${esc(fmtDate(r.doj))}</b>` },
  { k: 'assignedTo', l: 'Assigned IT Person', render: r => `<span class="badge b-acc" style="font-weight:600">👤 ${esc(r.assignedTo || 'Unassigned')}</span>` },
  { k: 'proposedEmail', l: 'Work Email', render: r => r.createdEmail ? `<b class="mono" style="color:var(--ok)">${esc(r.createdEmail)}</b>` : `<span class="mono muted">${esc(r.proposedEmail || 'Not created yet')}</span>` },
  { k: 'status', l: 'Status', render: r => badge(r.status || 'Pending', ONBOARD_STATUS_CLS[r.status || 'Pending']) },
  { k: 'action', l: 'Action', sortVal: () => 0, render: r => r.status === 'Completed' 
      ? `<button class="btn sm" data-act="open-onboard" data-id="${r.id}">View / Handover</button>` 
      : `<button class="btn sm primary" data-act="open-onboard" data-id="${r.id}">⚡ Process Email</button>` 
  }
];

function filteredOnboarding() {
  const st = ui.onboarding || {};
  return (db.onboarding || []).filter(r => {
    if (st.status && r.status !== st.status) return false;
    if (st.assignedTo && r.assignedTo !== st.assignedTo) return false;
    if (st.company && norm(r.company) !== st.company) return false;
    if (st.q) {
      const hay = low(`${r.name} ${r.personalEmail} ${r.phone} ${r.department} ${r.designation} ${r.company || ''} ${r.location || ''} ${r.assignedTo} ${r.createdEmail || ''} ${r.proposedEmail || ''} ${r.requestedBy || ''}`);
      if (!matchQ(hay, st.q)) return false;
    }
    return true;
  });
}

LISTS.onboarding = () => {
  const rows = sortRows('onboarding', filteredOnboarding(), ONBOARD_COLS);
  $('#list').innerHTML = tableHTML('onboarding', ONBOARD_COLS, rows, r => `data-act="open-onboard" data-id="${r.id}"`);
};

PAGES.onboarding = () => {
  const st = ui.onboarding;
  const list = db.onboarding || [];
  const pending = list.filter(r => r.status === 'Pending').length;
  const inProg = list.filter(r => r.status === 'In Progress').length;
  const done = list.filter(r => r.status === 'Completed').length;
  const itPersons = uniqSorted([...getITTeam(), ...list.map(r => r.assignedTo).filter(Boolean)]);
  const payrollGroups = uniqSorted(list.map(r => r.company).filter(Boolean));

  const kpiBox = (label, count, cls, stat) => `
    <div class="kpi ${cls}" data-act="filter-onboard" data-status="${stat}" style="cursor:pointer">
      <div class="v">${count}</div>
      <div class="l">${label}</div>
    </div>`;

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <h1>✉️ New Joining &amp; Work Email Requests</h1>
        <p class="sub">HR new employee onboarding portal: request official work email, tag IT engineer, and track provisioning.</p>
      </div>
      <div class="toolbar" style="margin:0">
        <button class="btn primary" data-act="req-email" style="font-weight:600">✉️ + New Joining / Request Email (HR)</button>
      </div>
    </div>

    <div class="grid kpis" style="margin-bottom:14px">
      ${kpiBox('Pending IT Action', pending, pending ? 'warn' : 'ok', 'Pending')}
      ${kpiBox('In Progress', inProg, inProg ? 'warn' : '', 'In Progress')}
      ${kpiBox('Completed / Email Created', done, 'ok', 'Completed')}
      ${kpiBox('All Requests', list.length, '', '')}
    </div>

    <div class="toolbar">
      <input type="search" data-filter="onboarding.q" value="${esc(st.q || '')}" placeholder="Filter by employee name, personal email, role, IT person, payroll…">
      <select data-filter="onboarding.status">
        <option value="">All Status (${list.length})</option>
        <option value="Pending" ${st.status === 'Pending' ? 'selected' : ''}>Pending (${pending})</option>
        <option value="In Progress" ${st.status === 'In Progress' ? 'selected' : ''}>In Progress (${inProg})</option>
        <option value="Completed" ${st.status === 'Completed' ? 'selected' : ''}>Completed (${done})</option>
      </select>
      <select data-filter="onboarding.company">
        <option value="">All Payroll Groups</option>
        ${payrollGroups.map(c => `<option value="${esc(c)}" ${st.company === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
      <select data-filter="onboarding.assignedTo">
        <option value="">All Assigned IT Persons</option>
        ${itPersons.map(p => `<option value="${esc(p)}" ${st.assignedTo === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
      </select>
      <button class="btn" data-act="export-onboarding">⬇ Export CSV</button>
    </div>
    <div id="list"></div>
  `;
  LISTS.onboarding();
};

function requestEmailModal(preset = {}) {
  const depts = getDepartments();
  const locs = getLocations();
  const comps = getCompanies();
  const itTeam = getITTeam();
  const defIT = db.settings.engineer || itTeam[0] || 'Mo Vaseem';

  const body = `
    <form id="onboard-req-form" class="form-grid" style="gap:12px">
      <label><b>Full Name *</b>
        <input name="name" required placeholder="e.g. Rohit Sharma" value="${esc(preset.name || '')}">
      </label>
      <label><b>Personal Email (Credentials receive karne ke liye) *</b>
        <input type="email" name="personalEmail" required placeholder="e.g. rohit.sharma@gmail.com" value="${esc(preset.personalEmail || '')}">
      </label>

      <label><b>Department *</b>
        <select name="department" data-smart-select required>
          ${opts(depts, preset.department || depts[0], 'Select department')}
          <option value="__new_dept__">➕ Add new department...</option>
        </select>
      </label>
      <label><b>Designation / Role</b>
        <input name="designation" placeholder="e.g. Backend Developer" value="${esc(preset.designation || '')}">
      </label>

      <label><b>Mobile Number</b>
        <input name="phone" placeholder="e.g. 9876543210" value="${esc(preset.phone || '')}">
      </label>
      <label><b>Date of Joining *</b>
        <input type="date" name="doj" value="${preset.doj || today()}">
      </label>

      <label><b>Payroll Group / Company *</b>
        <select name="company" data-smart-select required>
          ${opts(comps, preset.company || comps[0] || 'AgroWheels', 'Select payroll group')}
          <option value="__new_comp__">➕ Add new payroll group / company...</option>
        </select>
      </label>
      <label><b>Location / Branch</b>
        <select name="location" data-smart-select>
          ${opts(locs, preset.location || locs[0], 'Select location')}
          <option value="__new__">➕ Add new location...</option>
        </select>
      </label>

      <label class="full"><b>Assign IT Person *</b>
        <select name="assignedTo" required style="font-weight:600">
          ${itTeam.map(t => {
            const isMgr = /manager/i.test(t);
            return `<option value="${esc(t)}" ${t === defIT || t.includes('Vaseem') ? 'selected' : ''}>${isMgr ? '👑' : '👤'} ${esc(t)}</option>`;
          }).join('')}
        </select>
      </label>

      <div class="full" style="display:flex;align-items:center;gap:24px;padding:10px 14px;background:var(--panel2);border-radius:8px;border:1px solid var(--line);margin:2px 0">
        <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;margin:0;font-weight:600">
          <input type="checkbox" name="acc_laptop" ${preset.acc_laptop ? 'checked' : ''}> 💻 Laptop / Computer Required
        </label>
        <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;margin:0">
          <input type="checkbox" name="is_urgent"> 🚨 Urgent Joining (Today / Tomorrow)
        </label>
      </div>

      <label class="full"><b>Notes / Special Instructions (Optional)</b>
        <input name="notes" placeholder="e.g. Needs developer tools, joining Noida office 10 AM..." value="${esc(preset.notes || '')}">
      </label>
    </form>`;

  const m = modal('✉️ New Joining & Work Email Request', body, [
    {
      label: 'Submit Request to IT Team',
      cls: 'primary',
      onClick: async root => {
        const r = readForm(root);
        if (!norm(r.name)) return root.err(['Employee Full Name is required']), false;
        if (!r.personalEmail || !EMAIL_RE.test(r.personalEmail)) return root.err(['Valid Personal Email is required']), false;

        const accounts = ['Google Workspace', 'Slack'];
        if (r.acc_laptop) accounts.push('Laptop');

        const req = {
          id: uid(),
          createdAt: new Date().toISOString(),
          name: norm(r.name),
          personalEmail: low(r.personalEmail),
          phone: norm(r.phone),
          doj: r.doj || today(),
          department: norm(r.department),
          designation: norm(r.designation),
          company: norm(r.company) || comps[0] || 'AgroWheels',
          location: norm(r.location) || locs[0] || 'Noida',
          assignedTo: norm(r.assignedTo) || defIT,
          priority: r.is_urgent ? 'Urgent' : 'Normal',
          proposedEmail: suggestEmail(r.name),
          requestedBy: currentUser?.email?.split('@')[0] || 'HR Team',
          accounts,
          notes: norm(r.notes),
          status: 'Pending',
          createdEmail: '',
          tempPassword: '',
          completedAt: '',
          completedBy: ''
        };

        if (!Array.isArray(db.onboarding)) db.onboarding = [];
        db.onboarding.unshift(req);
        dirtyQueue.settings = true;
        save();
        updateEmailTaskBadge();
        log(req.name, 'Email requested by HR', `Assigned to: ${req.assignedTo} (${req.priority}) [${req.company}]`, [req.name, req.assignedTo, req.personalEmail]);
        toast(`✉️ Request submitted! Assigned to ${req.assignedTo}.`, 'ok');
        changed();
        return true;
      }
    }
  ], 'md');
}

function processOnboardingModal(req) {
  const itTeam = getITTeam();
  const defaultEmail = req.createdEmail || req.proposedEmail || suggestEmail(req.name);
  const defaultPass = req.tempPassword || generateTempPassword();

  const getHandoverText = (email, pass) => {
    return `✅ Official Work Email Created!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Employee Name : ${req.name}
💼 Designation   : ${req.designation || 'Team Member'}
🏢 Department    : ${req.department || 'General'} (${req.location || 'HQ'})
🏛️ Payroll Group : ${req.company || '—'}
📧 Official Email: ${email}
🔑 Temp Password : ${pass}
🌐 Webmail Login : https://mail.google.com
🛠️ Configured By : ${req.assignedTo || db.settings.engineer || 'IT Team'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Please share these credentials with the employee. They will be prompted to change their password on first sign-in.`;
  };

  const body = `
    <div style="background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:gap:8px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:18px">👤</span>
          <div>
            <h3 style="margin:0">${esc(req.name)}</h3>
            <span class="muted" style="font-size:12px">Requested ${ago(req.createdAt)} by <b>${esc(req.requestedBy || 'HR')}</b></span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          ${badge(req.priority || 'Normal', ONBOARD_PRIORITY_CLS[req.priority || 'Normal'])}
          ${badge(req.status || 'Pending', ONBOARD_STATUS_CLS[req.status || 'Pending'])}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;font-size:12px;color:var(--text)">
        <div><span class="muted">Personal Email:</span> <a href="mailto:${esc(req.personalEmail)}">${esc(req.personalEmail)}</a></div>
        <div><span class="muted">Phone:</span> ${esc(req.phone || '—')}</div>
        <div><span class="muted">Department:</span> ${esc(req.department || '—')}</div>
        <div><span class="muted">Designation:</span> ${esc(req.designation || '—')}</div>
        <div><span class="muted">Payroll Group:</span> <b style="color:var(--accent)">${esc(req.company || '—')}</b></div>
        <div><span class="muted">Location:</span> ${esc(req.location || '—')}</div>
        <div><span class="muted">Joining Date:</span> <b>${fmtDate(req.doj)}</b></div>
        <div><span class="muted">Accounts:</span> ${(req.accounts || ['Google Workspace']).join(', ')}</div>
      </div>
      ${req.notes ? `<div style="margin-top:8px;font-size:12px;background:rgba(255,255,255,0.03);padding:8px 10px;border-radius:6px;border-left:3px solid var(--accent)"><b>HR Notes:</b> ${esc(req.notes)}</div>` : ''}
    </div>

    <form id="onboard-process-form" class="form-grid">
      <div style="grid-column:1 / -1;margin-bottom:4px">
        <h4 style="margin:0;font-size:13px;color:var(--text)">🛠️ IT Provisioning &amp; Credentials</h4>
      </div>

      <label><b>Assigned IT Engineer</b>
        <select name="assignedTo">
          ${itTeam.map(t => {
            const isMgr = /manager/i.test(t);
            return `<option value="${esc(t)}" ${t === req.assignedTo ? 'selected' : ''}>${isMgr ? '👑' : '👤'} ${esc(t)}</option>`;
          }).join('')}
        </select>
      </label>

      <label><b>Task Status</b>
        <select name="status">
          <option value="Pending" ${req.status === 'Pending' ? 'selected' : ''}>⏳ Pending (Awaiting Email Creation)</option>
          <option value="In Progress" ${req.status === 'In Progress' ? 'selected' : ''}>⚙️ In Progress (Creating Accounts...)</option>
          <option value="Completed" ${req.status === 'Completed' ? 'selected' : ''}>✅ Completed (Email Created &amp; Shared)</option>
          <option value="Cancelled" ${req.status === 'Cancelled' ? 'selected' : ''}>✕ Cancelled</option>
        </select>
      </label>

      <label><b>Created Work Email *</b>
        <input type="email" name="createdEmail" required value="${esc(defaultEmail)}" placeholder="e.g. rohit.sharma@tractorjunction.com">
      </label>

      <label><b>Temporary Password *</b>
        <div class="inline">
          <input name="tempPassword" id="proc-temp-pass" value="${esc(defaultPass)}" style="flex:1" placeholder="Temporary password">
          <button type="button" class="btn sm" id="btn-gen-pass" title="Generate Random Strong Password">🎲 Gen</button>
        </div>
      </label>

      <label><b>Emp Code (Optional)</b>
        <input name="empCode" placeholder="e.g. TJ00312" value="${esc(req.empCode || '')}">
      </label>

      <label><b>IT Remarks / Handover Notes</b>
        <input name="itNotes" placeholder="e.g. Google Workspace licence allocated, welcome email sent" value="${esc(req.itNotes || '')}">
      </label>

      <div style="grid-column:1 / -1;margin-top:6px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <b style="font-size:12px;color:var(--text)">📋 WhatsApp / Slack Handover Message for HR:</b>
          <button type="button" class="btn sm" id="btn-copy-handover" style="border-color:var(--accent);color:var(--accent)">📋 Copy Message</button>
        </div>
        <div class="handover-box" id="handover-preview">${esc(getHandoverText(defaultEmail, defaultPass))}</div>
      </div>
    </form>`;

  const m = modal(`⚡ Process Email Request — ${req.name}`, body, [
    {
      label: '✨ Complete & Add to Employee Master',
      cls: 'primary',
      onClick: async root => {
        const r = readForm(root);
        if (!r.createdEmail || !EMAIL_RE.test(r.createdEmail)) return root.err(['Valid Created Work Email is required']), false;
        if (!r.tempPassword) return root.err(['Temporary Password is required']), false;

        req.assignedTo = norm(r.assignedTo);
        req.status = 'Completed';
        req.createdEmail = low(r.createdEmail);
        req.tempPassword = norm(r.tempPassword);
        req.empCode = normTag(r.empCode);
        req.itNotes = norm(r.itNotes);
        req.completedAt = new Date().toISOString();
        req.completedBy = norm(r.assignedTo);

        // Auto-add or update in Employee master if not exists
        let emp = IX.empEmail.get(req.createdEmail) || (req.empCode && IX.empCode.get(req.empCode)) || db.employees.find(e => low(e.name) === low(req.name));
        if (!emp) {
          emp = {
            id: uid(),
            createdAt: new Date().toISOString(),
            name: req.name,
            email: req.createdEmail,
            phone: req.phone || '',
            department: req.department || '',
            designation: req.designation || '',
            location: req.location || '',
            company: req.company || '',
            doj: req.doj || today(),
            empCode: req.empCode || '',
            status: 'Active',
            notes: `Created via HR Onboarding Email Request. Configured by ${req.assignedTo}. Alternate: ${req.personalEmail}`
          };
          db.employees.push(emp);
          markDirty('employees', emp);
          log(emp.empCode || emp.name, 'Employee created from Onboarding', `Work Email: ${emp.email}`, [emp.name, emp.email, emp.empCode]);
        } else {
          emp.email = req.createdEmail;
          if (req.empCode && !emp.empCode) emp.empCode = req.empCode;
          markDirty('employees', emp);
        }

        dirtyQueue.settings = true;
        save();
        updateEmailTaskBadge();
        toast(`✅ Work email created and ${req.name} synced to Employee Directory!`, 'ok');
        changed();
        return true;
      }
    },
    {
      label: 'Save Progress',
      cls: '',
      onClick: async root => {
        const r = readForm(root);
        req.assignedTo = norm(r.assignedTo);
        req.status = r.status || req.status;
        req.createdEmail = low(r.createdEmail);
        req.tempPassword = norm(r.tempPassword);
        req.empCode = normTag(r.empCode);
        req.itNotes = norm(r.itNotes);
        if (req.status === 'Completed' && !req.completedAt) {
          req.completedAt = new Date().toISOString();
          req.completedBy = req.assignedTo;
        }
        dirtyQueue.settings = true;
        save();
        updateEmailTaskBadge();
        toast('Request updated', 'ok');
        changed();
        return true;
      }
    },
    {
      label: 'Delete Request',
      cls: 'danger',
      onClick: async () => {
        if (!(await confirmBox('Delete request?', `Delete onboarding request for <b>${esc(req.name)}</b>?`, 'Delete', 'danger'))) return false;
        db.onboarding = (db.onboarding || []).filter(x => x.id !== req.id);
        dirtyQueue.settings = true;
        save();
        updateEmailTaskBadge();
        toast('Request deleted', 'ok');
        changed();
        return true;
      }
    }
  ], 'lg');

  const emailInp = m.querySelector('input[name="createdEmail"]');
  const passInp = m.querySelector('#proc-temp-pass');
  const btnGen = m.querySelector('#btn-gen-pass');
  const btnCopy = m.querySelector('#btn-copy-handover');
  const preview = m.querySelector('#handover-preview');

  const updatePreview = () => {
    if (preview) preview.textContent = getHandoverText(emailInp?.value || '—', passInp?.value || '—');
  };

  if (emailInp) emailInp.addEventListener('input', updatePreview);
  if (passInp) passInp.addEventListener('input', updatePreview);

  if (btnGen && passInp) {
    btnGen.addEventListener('click', () => {
      passInp.value = generateTempPassword();
      updatePreview();
      toast('Generated new password 🎲', 'ok');
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener('click', async () => {
      const text = getHandoverText(emailInp?.value || '—', passInp?.value || '—');
      try {
        await navigator.clipboard.writeText(text);
        toast('Copied handover message to clipboard! 📋', 'ok');
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        toast('Copied handover message! 📋', 'ok');
      }
    });
  }
}

// ---------------- Digital Handover with E-Signature ----------------
function handoverWithSigModal(emp, asset = null) {
  if (!emp && !asset) return toast('Please select an employee or asset to create handover.', 'warn');
  const e = emp || (asset ? holderOf(asset) : null);
  if (!e) return toast('No employee associated with this asset.', 'warn');
  const assets = asset ? [asset] : assetsOf(e);
  if (!assets.length) return toast(`${e.name} has no assets assigned.`, 'warn');

  const terms = [
    'The company IT asset(s) listed below are issued solely for official work purposes.',
    'I acknowledge receiving the device in clean, operational, undamaged condition with all accessories.',
    'I will adhere to company IT policies, and will not install pirated, unlicensed, or unauthorized software.',
    'I will promptly report any accidental damage, loss, or theft to the IT Department.',
    'I agree to return all devices, chargers, and accessories in proper condition upon transfer or separation from the company.'
  ];

  const body = `
    <div style="font-size:13px;line-height:1.4">
      <div style="background:var(--panel2);padding:12px 16px;border-radius:8px;margin-bottom:14px;border:1px solid var(--line);display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><span class="muted">Employee Name:</span> <b>${esc(e.name)}</b></div>
        <div><span class="muted">Employee Code:</span> <b>${esc(e.empCode || '—')}</b></div>
        <div><span class="muted">Designation:</span> ${esc(e.designation || '—')}</div>
        <div><span class="muted">Department:</span> ${esc(e.department || '—')}</div>
        <div><span class="muted">Location:</span> ${esc(e.location || '—')}</div>
        <div><span class="muted">Phone / WhatsApp:</span> <b>${esc(e.phone || '—')}</b></div>
      </div>

      <h4 style="margin:8px 0 6px">📦 Assets Handed Over (${assets.length})</h4>
      <table class="table" style="font-size:12px;margin-bottom:14px">
        <thead>
          <tr>
            <th>Tag</th><th>Type</th><th>Make / Model</th><th>Serial No / Specs</th><th>Accessories</th>
          </tr>
        </thead>
        <tbody>
          ${assets.map(a => `
            <tr>
              <td><b class="mono" style="color:var(--accent)">${esc(a.tag)}</b></td>
              <td>${esc(a.type)}</td>
              <td>${esc(norm((a.make || '') + ' ' + (a.model || '')))}</td>
              <td>${esc([a.serialNo, a.processor, a.ram, a.storage].filter(Boolean).join(' · '))}</td>
              <td>${esc(a.accessories || 'Bag, Charger, Power Cable')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.25);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px">
        <b>Acknowledgement &amp; Terms:</b>
        <ol style="margin:4px 0 0;padding-left:18px">
          ${terms.map(t => `<li style="margin-bottom:3px">${t}</li>`).join('')}
        </ol>
      </div>

      <div style="margin-top:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <label style="font-weight:700">✍️ Employee Digital Signature (Finger or Mouse):</label>
          <button type="button" class="btn sm" id="btn-clear-sig">Clear Signature</button>
        </div>
        <div class="sig-canvas-wrap">
          <canvas id="handover-canvas" class="sig-canvas" height="140"></canvas>
        </div>
        <div class="muted" style="font-size:11px;margin-top:4px">Please sign inside the box above. Mobile touch &amp; desktop mouse supported.</div>
      </div>
    </div>
  `;

  let sigPad = null;
  const m = modal('✍️ Digital IT Asset Handover & E-Signature', body, [
    {
      label: '✓ Accept & Save Signed Handover',
      cls: 'primary',
      onClick: () => {
        const sigUrl = sigPad ? sigPad.toDataURL() : '';
        if (!sigUrl || sigPad.isEmpty()) {
          toast('Please ask the employee to sign on the pad before saving.', 'warn');
          return false;
        }

        const handoverRec = {
          id: uid(),
          ts: new Date().toISOString(),
          empId: e.id,
          empName: e.name,
          empCode: e.empCode || '',
          empEmail: e.email || '',
          phone: e.phone || '',
          tags: assets.map(a => a.tag),
          signature: sigUrl,
          engineer: db.settings.engineer || 'Mo Vaseem',
          org: db.settings.org || 'Farm junction Marketing Pvt Ltd.'
        };

        if (!db.handovers) db.handovers = [];
        db.handovers.unshift(handoverRec);
        assets.forEach(a => {
          log(a.tag, 'Signed Handover', `Digitally signed by ${e.name} (${e.empCode || ''})`, [e.name, e.email, e.empCode]);
        });

        dirtyQueue.settings = true;
        save();
        toast('✅ Digital handover successfully saved!', 'ok');
        changed();

        showHandoverSuccessModal(handoverRec, e, assets);
        return true;
      }
    }
  ], 'lg');

  setTimeout(() => {
    const canvas = m.querySelector('#handover-canvas');
    if (canvas) {
      sigPad = initSigPad(canvas);
      m.querySelector('#btn-clear-sig')?.addEventListener('click', () => sigPad?.clear());
    }
  }, 50);
}

function showHandoverSuccessModal(rec, e, assets) {
  const body = `
    <div style="text-align:center;padding:10px 0">
      <div style="font-size:42px;margin-bottom:8px">🎉</div>
      <h3 style="margin:0 0 6px">Asset Handover Successfully Completed!</h3>
      <p class="muted" style="font-size:13px;max-width:480px;margin:0 auto 16px">Digital receipt recorded with timestamp <b>${fmtDate(rec.ts)}</b> and verified digital signature.</p>

      <div class="cert-sheet no-print" style="text-align:left;max-height:260px;overflow-y:auto;border:1px solid var(--line);background:var(--panel2)">
        <div style="font-weight:700;font-size:14px">${esc(rec.org)}</div>
        <div class="muted" style="font-size:11px">Handover Receipt #${esc(rec.id.slice(0, 8).toUpperCase())}</div>
        <div style="margin:8px 0;font-size:12px">Employee: <b>${esc(rec.empName)}</b> (${esc(rec.empCode || 'No Code')})</div>
        <div style="margin-bottom:8px;font-size:12px">Assets: <b>${esc(rec.tags.join(', '))}</b></div>
        <div style="border-top:1px dashed var(--line);padding-top:6px">
          <span class="muted" style="font-size:11px">Saved Employee Signature:</span><br>
          <img src="${rec.signature}" style="max-height:48px;margin-top:4px;border:1px solid #cbd5e1;background:#fff;border-radius:4px;padding:2px 8px" alt="Signature">
        </div>
      </div>
    </div>
  `;

  modal('✅ Handover Receipt', body, [
    {
      label: '🖨 Print Official Handover Certificate',
      cls: 'primary',
      onClick: () => {
        printSignedHandoverDoc(rec, e, assets);
        return false;
      }
    },
    ...(e.phone ? [{
      label: '💬 Send WhatsApp Confirmation',
      cls: '',
      onClick: () => {
        const msg = `Dear ${e.name},\nYour IT asset handover for *${rec.tags.join(', ')}* has been successfully processed and digitally signed on ${fmtDate(rec.ts)}.\nIT Engineer: ${rec.engineer}\nOrganization: ${rec.org}\nThank you!`;
        sendWhatsApp(e.phone, msg);
        return false;
      }
    }] : [])
  ], 'md');
}

function printSignedHandoverDoc(rec, e, assets) {
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print', 'err');
  const logoHtml = db.settings.logo ? `<img src="${esc(db.settings.logo)}" alt="Logo" style="height:44px;max-width:140px;object-fit:contain;margin-bottom:6px;display:block">` : '';
  const rows = assets.map((a, i) => `<tr><td>${i + 1}</td><td><b>${esc(a.tag)}</b></td><td>${esc(a.type)}</td><td>${esc(norm((a.make || '') + ' ' + (a.model || '')))}</td><td>${esc([a.serialNo, a.imei, a.simNumber].filter(Boolean).join(' / '))}</td><td>${esc([a.processor, a.ram, a.storage, a.os].filter(Boolean).join(', '))}</td><td>${esc(a.accessories || 'Bag, Charger')}</td></tr>`).join('');

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Handover Certificate - ${esc(e.name)}</title><style>
   body{font:13px/1.5 Segoe UI,Arial,sans-serif;color:#111;margin:36px}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px}
   table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px 8px;text-align:left;vertical-align:top;font-size:12px}th{background:#f3f4f6}
   .head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
   .sig-row{display:flex;justify-content:space-between;align-items:flex-end;margin-top:40px}
   .sig-box{width:30%;text-align:center;border-top:1px solid #000;padding-top:6px;font-size:12px}
   .sig-box img{max-height:48px;display:block;margin:0 auto 4px}
   ol{padding-left:18px;margin:6px 0;font-size:12px}li{margin-bottom:4px}
   @media print{button{display:none}}
  </style></head><body>
   <div class="head">
     <div>${logoHtml}<h1>${esc(rec.org)}</h1><div style="font-size:13px;font-weight:600;margin-top:2px">Official IT Asset Handover &amp; Acceptance Certificate</div></div>
     <div style="text-align:right"><div>Receipt: <b>#${esc(rec.id.slice(0, 8).toUpperCase())}</b></div><div>Date: ${fmtDate(rec.ts)}</div></div>
   </div>
   <table>
     <tr><th>Employee Name</th><td><b>${esc(e.name)}</b></td><th>Emp Code</th><td>${esc(e.empCode || '—')}</td></tr>
     <tr><th>Designation</th><td>${esc(e.designation || '—')}</td><th>Department</th><td>${esc(e.department || '—')}</td></tr>
     <tr><th>Email</th><td>${esc(e.email || '—')}</td><th>Location</th><td>${esc(e.location || '—')}</td></tr>
   </table>
   <h2>Assets Issued &amp; Acknowledged</h2>
   <table>
     <tr><th>#</th><th>Asset Tag</th><th>Type</th><th>Make / Model</th><th>Serial No / IMEI</th><th>Configuration</th><th>Accessories</th></tr>
     ${rows}
   </table>
   <h2>Terms &amp; Conditions</h2>
   <ol>
     <li>The above company assets are issued for official use only and remain company property.</li>
     <li>I will take reasonable care of the assets and report loss, theft or damage to IT immediately.</li>
     <li>I will not install unlicensed software or remove security / management tools.</li>
     <li>All assets and accessories will be returned in working condition at exit or when asked by IT.</li>
   </ol>
   <div class="sig-row">
     <div class="sig-box">
       ${rec.signature ? `<img src="${rec.signature}" alt="Employee Signature">` : ''}
       <b>${esc(e.name)}</b><br>Employee Signature (Digital)
     </div>
     <div class="sig-box">
       <div style="height:36px"></div>
       <b>${esc(rec.engineer)}</b><br>IT Engineer
     </div>
     <div class="sig-box">
       <div style="height:36px"></div>
       <b>Authorized Signatory</b><br>HR Department
     </div>
   </div>
   <script>setTimeout(()=>print(),350)<\/script></body></html>`);
  w.document.close();
}

// ---------------- Offboarding & Digital Clearance Wizard ----------------
function offboardingWizardModal(emp) {
  if (!emp) return toast('Employee not found', 'err');
  const assets = assetsOf(emp);
  const sw = db.swAssign.filter(x => x.empId === emp.id);

  const body = `
    <div style="font-size:13px">
      <div style="background:var(--panel2);padding:12px 14px;border-radius:8px;margin-bottom:14px;border:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
        <div>
          <h3 style="margin:0">${esc(emp.name)}</h3>
          <div class="muted">${esc([emp.empCode, emp.designation, emp.department, emp.location].filter(Boolean).join(' · '))}</div>
        </div>
        <div>${empStatusBadge(emp.status)}</div>
      </div>

      <div style="margin-bottom:16px">
        <h4 style="margin:0 0 8px;display:flex;justify-content:space-between">
          <span>Phase 1: Hardware Assets Return</span>
          <span class="badge ${assets.length ? 'b-warn' : 'b-ok'}">${assets.length ? `${assets.length} Assets Held` : '✓ All Assets Returned'}</span>
        </h4>
        ${assets.length ? `
          <div style="border:1px solid var(--line);border-radius:8px;padding:8px 12px;background:rgba(245,158,11,0.06)">
            ${assets.map(a => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
                <div>
                  <b>${TYPE_ICON[a.type] || '📦'} ${esc(a.tag)}</b> · ${esc(a.type)} (${esc(a.make || '')} ${esc(a.model || '')})
                  <div class="muted" style="font-size:11px">Serial: ${esc(a.serialNo || '—')}${a.accessories ? ' · ' + esc(a.accessories) : ''}</div>
                </div>
                <button type="button" class="btn sm" data-offboard-return="${a.id}">↩ Return to Stock</button>
              </div>
            `).join('')}
          </div>
        ` : `<div style="background:rgba(16,185,129,0.08);color:var(--ok);padding:10px 14px;border-radius:8px;font-weight:600">✓ No pending hardware assets. All devices have been returned to IT stock.</div>`}
      </div>

      <div style="margin-bottom:16px">
        <h4 style="margin:0 0 8px">Phase 2: Accounts Revocation &amp; De-provisioning</h4>
        <div class="checklist-row">
          <input type="checkbox" id="chk-email" checked>
          <div>
            <div class="check-title">Suspend Google Workspace / Microsoft 365 Work Email</div>
            <div class="check-desc">Change password, revoke active sessions, and suspend mailbox: <b>${esc(emp.email || '—')}</b></div>
          </div>
        </div>
        <div class="checklist-row">
          <input type="checkbox" id="chk-chat" checked>
          <div>
            <div class="check-title">Deactivate Slack / Microsoft Teams &amp; Group Chats</div>
            <div class="check-desc">Remove from company channels, shared drives, and user groups.</div>
          </div>
        </div>
        <div class="checklist-row">
          <input type="checkbox" id="chk-erp" checked>
          <div>
            <div class="check-title">Revoke Internal ERP / CRM / HRMS / GitHub Access</div>
            <div class="check-desc">Disable portal logins, admin permissions, and API tokens.</div>
          </div>
        </div>
        <div class="checklist-row">
          <input type="checkbox" id="chk-sw" checked>
          <div>
            <div class="check-title">Unassign Paid Software Licenses (${sw.length} assigned)</div>
            <div class="check-desc">${sw.length ? `Licenses to free: ${sw.map(x => IX.swId.get(x.swId)?.name || 'Software').join(', ')}` : 'No specific software licenses assigned.'}</div>
          </div>
        </div>
        <div class="checklist-row">
          <input type="checkbox" id="chk-badge" checked>
          <div>
            <div class="check-title">Collect Physical ID Card, Access Fob &amp; Company SIM</div>
            <div class="check-desc">Ensure all physical building access materials are handed over.</div>
          </div>
        </div>
      </div>

      <div>
        <h4 style="margin:0 0 8px">Phase 3: Digital No-Dues Clearance Signoff</h4>
        <div class="form-grid">
          <label><b>Exit Date</b>
            <input type="date" id="offboard-exit-date" value="${emp.exitDate || today()}">
          </label>
          <label><b>IT Clearance Officer</b>
            <input id="offboard-officer" value="${esc(db.settings.engineer || 'Mo Vaseem')}">
          </label>
          <label class="full"><b>IT Clearance Remarks / Handover Notes</b>
            <input id="offboard-notes" placeholder="e.g. All hardware returned in working order, mailbox archived...">
          </label>
        </div>
      </div>
    </div>
  `;

  const m = modal(`🚪 Offboarding & IT Clearance: ${emp.name}`, body, [
    {
      label: 'Complete Clearance & Mark Exited',
      cls: 'primary',
      onClick: () => {
        const remaining = assetsOf(emp);
        if (remaining.length) {
          toast(`Cannot complete clearance: ${remaining.length} asset(s) are still held by ${emp.name}. Please return them to stock first.`, 'err');
          return false;
        }

        const exitDate = m.querySelector('#offboard-exit-date')?.value || today();
        const officer = norm(m.querySelector('#offboard-officer')?.value || db.settings.engineer || 'IT Admin');
        const notes = norm(m.querySelector('#offboard-notes')?.value || '');

        if (m.querySelector('#chk-sw')?.checked) {
          db.swAssign.filter(x => x.empId === emp.id).forEach(x => {
            queueDelete('sw_assign', x.id);
            log(x.tag || 'Software', 'License freed on offboarding', `${x.name}`, [emp.name]);
          });
          db.swAssign = db.swAssign.filter(x => x.empId !== emp.id);
        }

        emp.status = 'Exited';
        emp.exitDate = exitDate;
        emp.notes = [emp.notes, `IT Clearance completed on ${exitDate} by ${officer}. ${notes}`].filter(Boolean).join(' | ');

        markDirty('employees', emp);
        dirtyQueue.settings = true;
        save();
        log(emp.empCode || emp.name, 'Offboarding completed', `Exited on ${exitDate}. IT clearance certified by ${officer}.`, empKeys(emp));
        toast(`✅ IT Clearance completed for ${emp.name}!`, 'ok');
        changed();

        printClearance(emp);
        return true;
      }
    },
    {
      label: '🖨 Print Clearance Certificate',
      cls: '',
      onClick: () => {
        printClearance(emp);
        return false;
      }
    }
  ], 'lg');

  m.querySelectorAll('[data-offboard-return]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const assetId = btn.dataset.offboardReturn;
      const a = IX.assetId.get(assetId);
      if (!a) return;
      a.status = 'In Stock';
      a.holderName = '';
      a.holderEmail = '';
      a.empCode = '';
      a.allocatedDate = '';
      markDirty('assets', a);
      log(a.tag, 'Returned', `Returned to stock during Exit clearance of ${emp.name}`, [holderKey(a), ...empKeys(emp)]);
      save();
      reindex();
      toast(`Asset ${a.tag} returned to stock!`, 'ok');
      changed();
      closeModal();
      offboardingWizardModal(emp);
    });
  });
}

// ---------------- QR Code Label Sticker & Scanner ----------------
async function qrStickerModal(asset) {
  if (!asset) return toast('Asset not found', 'err');
  const org = db.settings.org || 'Farm junction Marketing Pvt Ltd.';
  const qrUrl = await getQRCodeDataURL(`ASSET:${asset.tag}`, 200);

  const body = `
    <div style="text-align:center;padding:10px 0">
      <p class="muted" style="margin:0 0 14px;font-size:13px">Official asset identification label sticker. Print and paste on the physical device.</p>
      <div class="sticker-label">
        <div class="sticker-qr">
          <img src="${qrUrl}" alt="QR Code">
        </div>
        <div class="sticker-info">
          <div class="sticker-brand">${esc(org)}</div>
          <div class="sticker-tag">${esc(asset.tag)}</div>
          <div class="sticker-sub"><b>${esc(asset.type)}</b> · ${esc(norm((asset.make || '') + ' ' + (asset.model || '')))}</div>
          ${asset.serialNo ? `<div class="sticker-sub" style="font-family:monospace;font-size:10px">S/N: ${esc(asset.serialNo)}</div>` : ''}
          <div class="sticker-footer">Property of IT Dept · Contact IT if found</div>
        </div>
      </div>
      <div class="muted" style="font-size:12px;margin-top:14px">Label size: 3.5" x 1.5" (Standard thermal/label printer compatible)</div>
    </div>
  `;

  modal(`🏷️ Asset Sticker: ${asset.tag}`, body, [
    {
      label: '🖨 Print QR Sticker',
      cls: 'primary',
      onClick: () => {
        window.print();
        return false;
      }
    }
  ], 'sm');
}

async function bulkQRStickersModal() {
  const assets = (ui.assets && filteredAssets().length) ? filteredAssets() : db.assets.filter(a => a.status === 'In Stock' || a.status === 'In Use').slice(0, 30);
  if (!assets.length) return toast('No assets found to print stickers.', 'warn');
  const org = db.settings.org || 'Farm junction Marketing Pvt Ltd.';

  toast('Generating QR codes for stickers...', 'info');
  const qrList = await Promise.all(assets.map(async a => ({
    asset: a,
    qrUrl: await getQRCodeDataURL(`ASSET:${a.tag}`, 160)
  })));

  const body = `
    <div style="padding:10px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="muted" style="font-size:13px">Printing <b>${assets.length}</b> asset label stickers. Formatted for A4 / label sheet printing.</div>
        <button class="btn primary" onclick="window.print()">🖨 Print All Labels</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-height:480px;overflow-y:auto;padding:10px;background:var(--panel2);border-radius:8px">
        ${qrList.map(({ asset: a, qrUrl }) => `
          <div class="sticker-label" style="margin:6px">
            <div class="sticker-qr">
              <img src="${qrUrl}" alt="QR">
            </div>
            <div class="sticker-info">
              <div class="sticker-brand">${esc(org)}</div>
              <div class="sticker-tag">${esc(a.tag)}</div>
              <div class="sticker-sub"><b>${esc(a.type)}</b> · ${esc(norm((a.make || '') + ' ' + (a.model || '')))}</div>
              ${a.serialNo ? `<div class="sticker-sub" style="font-family:monospace;font-size:10px">S/N: ${esc(a.serialNo)}</div>` : ''}
              <div class="sticker-footer">Property of IT Dept</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  modal(`🏷️ Bulk QR Label Print (${assets.length} Assets)`, body, [
    {
      label: '🖨 Print Label Sheet',
      cls: 'primary',
      onClick: () => {
        window.print();
        return false;
      }
    }
  ], 'lg');
}


// ---------------- Bulk Asset Allocation Wizard ----------------
function bulkAssignModal(preselectedEmp = null) {
  const stockAssets = db.assets.filter(a => a.status === 'In Stock').slice().sort((a, b) => natCmp(a.tag, b.tag));
  if (!stockAssets.length) return toast('No assets are currently "In Stock" to assign.', 'warn');

  const body = `
    <div style="font-size:13px">
      <div style="background:var(--accent-soft);padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:12px;border:1px solid rgba(59,130,246,0.25)">
        💡 <b>Batch Allocation:</b> Ek saath multiple devices (Laptop + Mouse + Monitor etc.) ek employee ko assign karein.
      </div>

      <div class="form-grid" style="margin-bottom:14px">
        <label class="full"><b>Select Employee *</b>
          <input name="bulkEmp" id="bulk-emp-in" list="dl_emppick" value="${preselectedEmp ? esc(preselectedEmp.name) : ''}" placeholder="Type employee name or emp code...">
        </label>
        <label><b>Allocation Date</b>
          <input type="date" id="bulk-alloc-date" value="${today()}">
        </label>
        <label><b>Common Accessories / Remarks</b>
          <input id="bulk-alloc-notes" placeholder="e.g. Laptop bag, wireless charger, HDMI converter">
        </label>
      </div>

      <h4 style="margin:8px 0 6px">Select Assets from In-Stock Hardware (${stockAssets.length} available):</h4>
      <div style="max-height:280px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:6px 10px;background:var(--panel2)">
        ${stockAssets.map(a => `
          <label style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer">
            <input type="checkbox" name="bulkAssetPick" value="${a.id}" style="transform:scale(1.15)">
            <div style="flex:1">
              <b>${TYPE_ICON[a.type] || '📦'} ${esc(a.tag)}</b> · ${esc(a.type)} (${esc(norm((a.make || '') + ' ' + (a.model || '')))})
              <div class="muted" style="font-size:11px">${esc([a.processor, a.ram, a.storage, a.serialNo].filter(Boolean).join(' · '))}</div>
            </div>
            <span class="badge b-ok">In Stock</span>
          </label>
        `).join('')}
      </div>
    </div>
  `;

  modal('📦 Bulk Asset Allocation Wizard', body, [
    {
      label: 'Allocate Selected Assets',
      cls: 'primary',
      onClick: root => {
        const empVal = root.querySelector('#bulk-emp-in')?.value;
        const e = resolveEmp(empVal);
        if (!e) return root.err(['Please choose a valid employee from the directory.']), false;

        const date = root.querySelector('#bulk-alloc-date')?.value || today();
        const notes = norm(root.querySelector('#bulk-alloc-notes')?.value || '');
        const pickedIds = [...root.querySelectorAll('input[name="bulkAssetPick"]:checked')].map(cb => cb.value);

        if (!pickedIds.length) return root.err(['Please select at least one asset to assign.']), false;

        const assigned = [];
        for (const aid of pickedIds) {
          const a = IX.assetId.get(aid);
          if (!a) continue;
          a.status = 'In Use';
          a.empCode = e.empCode || '';
          a.holderName = e.name;
          a.holderEmail = e.email || '';
          a.allocatedDate = date;
          if (notes) a.accessories = [a.accessories, notes].filter(Boolean).join(', ');
          markDirty('assets', a);
          log(a.tag, 'Bulk Assigned', `Assigned to ${e.name} (${e.empCode || ''})`, [e.empCode, e.email, e.name]);
          assigned.push(a);
        }

        save();
        reindex();
        toast(`✅ Successfully allocated ${assigned.length} asset(s) to ${e.name}!`, 'ok');
        changed();

        setTimeout(() => {
          handoverWithSigModal(e);
        }, 200);
        return true;
      }
    }
  ], 'lg');
}

// ---------------- issues ----------------
function namesMatch(a, b) {
  const x = low(a).replace(/[^a-z ]/g, ''), y = low(b).replace(/[^a-z ]/g, '');
  if (!x || !y) return true;
  return x.split(' ')[0] === y.split(' ')[0] || x.includes(y) || y.includes(x);
}
function computeIssues() {
  const out = [];
  const add = (sev, cat, text, act, id) => out.push({ sev, cat, text, act, id });
  for (const a of db.assets) {
    if (hasHolder(a)) {
      const h = holderOf(a);
      if (!h) {
        const guess = a.holderName ? db.employees.filter(e => low(e.name) === low(a.holderName)) : [];
        add('warn', 'Asset holder not found in employee master', `${a.tag} → ${a.holderName || ''} ${a.empCode || ''} ${a.holderEmail || ''}${guess.length ? `  ⟶ did you mean ${guess.map(g => g.empCode || g.email).join(' / ')}?` : ''}`, 'open-asset', a.id);
      }
      else {
        if (a.holderName && !namesMatch(a.holderName, h.name)) add('warn', 'Name on asset differs from employee master', `${a.tag}: "${a.holderName}" vs ${h.empCode || ''} "${h.name}"`, 'open-asset', a.id);
        if (h.status === 'Exited') add('err', 'Exited employee still holding asset', `${h.name} (${h.empCode || ''}) → ${a.tag}`, 'open-asset', a.id);
        if (a.status !== 'In Use' && !['Lost', 'Under Repair'].includes(a.status)) add('warn', 'Status not "In Use" but holder set', `${a.tag} is "${a.status}" but assigned to ${h.name}`, 'open-asset', a.id);
      }
      if (!a.empCode) add('info', 'Assigned asset has no Emp Code', `${a.tag} → ${holderName(a)}`, 'open-asset', a.id);
      if (a.holderEmail && !EMAIL_RE.test(a.holderEmail)) add('warn', 'Invalid email on asset', `${a.tag}: ${a.holderEmail}`, 'open-asset', a.id);
    } else if (a.status === 'In Use') add('warn', 'Status "In Use" but nobody assigned', a.tag, 'open-asset', a.id);
    if (/not\s*gen/i.test(a.osLicense)) add('err', 'Windows not genuine', `${a.tag} (${holderName(a)})`, 'open-asset', a.id);
    const w = daysSince(a.warrantyEnd); if (w !== null && w > -30 && w <= 0) add('info', 'Warranty ending within 30 days', `${a.tag} — ${fmtDate(a.warrantyEnd)}`, 'open-asset', a.id);
    if (['Laptop', 'Desktop'].includes(a.type) && !a.serialNo) add('info', 'Computer without serial number', a.tag, 'open-asset', a.id);
  }
  for (const [eid, list] of IX.byEmp) {
    const e = IX.empId.get(eid);
    for (const t of ['Laptop', 'Mobile', 'Desktop']) {
      const l = list.filter(a => a.type === t && a.status === 'In Use');
      if (l.length > 1) add('warn', `Employee holds more than one ${t}`, `${e.name} (${e.empCode || ''}): ${l.map(a => a.tag).join(', ')}`, 'open-emp', eid);
    }
  }
  for (const e of db.employees) {
    if (e.email && !EMAIL_RE.test(e.email)) add('warn', 'Invalid employee email', `${e.name}: ${e.email}`, 'open-emp', e.id);
    if (!e.empCode && (e.status || 'Active') === 'Active') add('info', 'Active employee without Emp Code', e.name, 'open-emp', e.id);
  }
  for (const s of db.software) {
    if (s.licenseType === 'Pirated') add('err', 'Pirated / unlicensed software', `${s.name} — used by: ${s.departments || 'unknown'}`, 'open-sw', s.id);
    const u = seatsUsed(s); if (+s.totalSeats && u > +s.totalSeats) add('warn', 'Software licences over-used', `${s.name}: ${u} used / ${s.totalSeats} bought`, 'open-sw', s.id);
    const d = daysSince(s.expiry); if (d !== null && d > -30) add(d > 0 ? 'err' : 'warn', d > 0 ? 'Software licence expired' : 'Software renewal due in 30 days', `${s.name} — ${fmtDate(s.expiry)}`, 'open-sw', s.id);
  }
  return out;
}
PAGES.issues = () => {
  const iss = computeIssues();
  const groups = new Map(); iss.forEach(i => { if (!groups.has(i.cat)) groups.set(i.cat, []); groups.get(i.cat).push(i); });
  const order = { err: 0, warn: 1, info: 2 };
  const g = [...groups].sort((a, b) => order[a[1][0].sev] - order[b[1][0].sev] || b[1].length - a[1].length);
  $('#main').innerHTML = `<div class="page-head"><div><h1>Data Issues</h1><p class="sub">Automatic checks for mistakes and risks in your data. Click any line to open and fix it.</p></div></div>
   ${g.length ? g.map(([cat, list]) => `<details class="issue" ${list[0].sev === 'err' ? 'open' : ''}><summary>${badge(list[0].sev === 'err' ? 'Critical' : list[0].sev === 'warn' ? 'Warning' : 'Info', list[0].sev === 'err' ? 'b-err' : list[0].sev === 'warn' ? 'b-warn' : 'b-info')} ${esc(cat)} <span class="muted">(${list.length})</span></summary>
     <div class="rows">${list.slice(0, 300).map(i => `<div data-act="${i.act}" data-id="${i.id}">${esc(i.text)}</div>`).join('')}</div></details>`).join('') : '<div class="okbox">No issues found 🎉</div>'}`;
};

// ---------------- drawer: employee / asset / software ----------------
let drawerCtx = null;
function openDrawer(html) { $('#drawer-body').innerHTML = html; $('#drawer').classList.add('open'); $('#overlay').hidden = false; $('#drawer').scrollTop = 0; }
function closeDrawer() { drawerCtx = null; $('#drawer').classList.remove('open'); $('#overlay').hidden = true; }
function refreshDrawer() {
  if (!drawerCtx) return; const { kind, id } = drawerCtx; const st = $('#drawer').scrollTop;
  if (kind === 'emp') showEmp(id); else if (kind === 'asset') showAsset(id); else if (kind === 'sw') showSw(id);
  $('#drawer').scrollTop = st;
}
const kvGrid = pairs => `<div class="kv">${pairs.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join('')}</div>`;
function timelineHTML(list) {
  return list.length ? `<div class="timeline">${list.slice(0, 60).map(h => `<div class="tl"><b>${esc(h.action)}</b> ${esc(h.tag)} — ${esc(h.detail)}<small>${esc(new Date(h.ts).toLocaleString())}${h.by ? ' · by ' + esc(h.by) : ''}</small></div>`).join('')}</div>` : '<div class="muted">No history yet.</div>';
}

function showEmp(id) {
  const e = IX.empId.get(id); if (!e) return closeDrawer();
  drawerCtx = { kind: 'emp', id };
  const assets = assetsOf(e).slice().sort((a, b) => natCmp(a.type, b.type));
  const keys = empKeys(e);
  const hist = db.history.filter(h => h.who.some(w => keys.includes(w)));
  const sw = db.swAssign.filter(x => x.empId === e.id);
  const tags = new Set(assets.map(a => normTag(a.tag)));
  const maint = db.maint.filter(m => (e.empCode && normTag(m.empCode) === normTag(e.empCode)) || tags.has(normTag(m.tag)));
  const tenure = daysSince(e.doj);
  const itTeam = getITTeam();
  const matchedIT = itTeam.find(t => low(t).includes(low(e.name)) || low(e.name).includes(low(t.replace(/\(.*\)/, '').trim())));
  const isITMember = Boolean(matchedIT);
  const dateKVs = [];
  if (e.doj) dateKVs.push(['Date of joining', esc(fmtDate(e.doj)) + (tenure !== null ? ` <span class="muted">(${(tenure / 365).toFixed(1)} yrs)</span>` : '')]);
  if (e.status === 'Notice Period' || e.status === 'Exited' || e.exitDate) {
    const lbl = e.status === 'Notice Period' ? 'LWD / Exit date' : 'Exit date';
    const cls = e.status === 'Notice Period' ? 'b-warn' : 'b-err';
    dateKVs.push([lbl, e.exitDate ? badge(fmtDate(e.exitDate), cls) : '<span class="muted">—</span>']);
  }
  openDrawer(`
    <div class="d-head"><div class="avatar">${esc(initials(e.name))}</div><div><h2>${esc(e.name)}</h2>
      <div class="muted">${esc(e.designation || '')}${e.department ? ' · ' + esc(e.department) : ''}</div>
      <div style="margin-top:4px">${badge(e.empCode || 'No code', 'b-acc')} ${empStatusBadge(e.status)} ${isITMember ? '<span class="badge b-ok" style="font-weight:600">🛠️ IT Person</span>' : ''}</div></div></div>
    <div class="d-actions">
      ${canDo('canAssignAsset') ? `<button class="btn primary sm" data-act="assign" data-emp="${e.id}">+ Assign asset</button>` : ''}
      ${canDo('canAssignAsset') ? `<button class="btn sm" data-act="bulk-assign" data-emp="${e.id}">📦 Bulk Assign</button>` : ''}
      ${canDo('canManageSoftware') ? `<button class="btn sm" data-act="assign-sw" data-emp="${e.id}">+ Assign software</button>` : ''}
      ${canDo('canAddEditEmp') ? `<button class="btn ${!canDo('canAssignAsset') ? 'primary' : ''} sm" data-act="edit-emp" data-id="${e.id}">✎ Edit</button>` : ''}
      ${isITAdmin() ? (isITMember 
        ? `<button class="btn sm" data-act="del-it-member" data-val="${esc(matchedIT)}" title="Currently in IT Team (Click to remove)" style="color:var(--ok)">✔ IT Person</button>` 
        : `<button class="btn sm" data-act="add-emp-to-it" data-name="${esc(e.name)}" title="Add this employee as an IT Team Person">🛠️ + Add to IT Team</button>`
      ) : ''}
      ${isITAdmin() && e.email ? `<button class="btn sm" data-act="invite-emp-user" data-id="${e.id}" title="Invite this employee to Portal (Email + WhatsApp)">✉️ Invite to Portal</button>` : ''}
      ${canDo('canAssignAsset') ? `<button class="btn sm" data-act="handover-sig" data-emp="${e.id}">✍ E-Handover</button>` : ''}
      ${canDo('canAssignAsset') ? `<button class="btn sm" data-act="print-handover" data-emp="${e.id}">🖨 Handover form</button>` : ''}
      ${(e.status || 'Active') !== 'Exited' ? `<button class="btn sm" data-act="offboard-wizard" data-id="${e.id}">${canDo('canAssignAsset') ? '🚪 Exit Clearance' : '🚪 Mark Exited'}</button>` : `<button class="btn sm" data-act="print-clearance" data-id="${e.id}">🖨 Clearance letter</button>`}
      ${canDo('canDelete') ? `<button class="btn sm danger" data-act="del-emp" data-id="${e.id}">Delete</button>` : ''}
    </div>
    ${kvGrid([['Email', esc(e.email)], ['Phone', esc(e.phone)], ['Location', esc(e.location)], ['Company / Payroll', esc(e.company)],
      ...dateKVs, ['Band', esc(e.band)], ['Notes', esc(e.notes)],
      ...((db.settings?.customEmpFields || []).map(cf => [cf.l, esc(e[cf.k])]))])}
    ${canDo('canViewAssetsInEmp') ? `
    <div class="section"><h4>Assets held (${assets.length})</h4>
      ${assets.map(a => `<div class="asset-card"><span class="ic">${TYPE_ICON[a.type] || '📦'}</span><div class="grow" data-act="open-asset" data-id="${a.id}">
         <b>${esc(a.tag)}</b> · ${esc(a.type)} ${statusBadge(a.status)}<div class="muted">${esc([a.make, a.model, a.processor, a.ram, a.storage, a.os, a.simNumber, a.imei].filter(Boolean).join(' · '))}</div>
         <div class="muted">Since ${esc(fmtDate(a.allocatedDate) || '—')}${a.accessories ? ' · ' + esc(a.accessories) : ''}</div></div>
         ${canDo('canAssignAsset') ? `<button class="btn sm" data-act="return" data-id="${a.id}">Return</button>` : ''}</div>`).join('') || '<div class="muted">No assets assigned.</div>'}
    </div>
    <div class="section"><h4>Software (${sw.length})</h4>
      ${sw.map(x => { const s = IX.swId.get(x.swId); return `<div class="asset-card"><span class="ic">🧩</span><div class="grow" data-act="open-sw" data-id="${x.swId}"><b>${esc(s ? s.name : '(deleted)')}</b> ${s ? badge(s.licenseType) : ''}<div class="muted">${esc([x.tag, x.account, fmtDate(x.date)].filter(Boolean).join(' · '))}</div></div>${canDo('canManageSoftware') ? `<button class="btn sm" data-act="unassign-sw" data-id="${x.id}">Remove</button>` : ''}</div>`; }).join('') || '<div class="muted">No software recorded.</div>'}
    </div>
    ${maint.length ? `<div class="section"><h4>Maintenance (${maint.length})</h4>${maint.map(m => `<div class="list-item" data-act="edit-maint" data-id="${m.id}">${badge(m.type, 'b-info')} ${esc(m.tag)} ${esc([m.before, m.after ? '→ ' + m.after : ''].join(' '))}<span class="when">${esc(fmtDate(m.date))}</span></div>`).join('')}</div>` : ''}
    <div class="section"><h4>Timeline</h4>${timelineHTML(hist)}</div>` : ''}
  `);
}
function showAsset(id) {
  const a = IX.assetId.get(id); if (!a) return closeDrawer();
  drawerCtx = { kind: 'asset', id };
  const h = holderOf(a);
  const hist = db.history.filter(x => normTag(x.tag) === normTag(a.tag));
  const maint = db.maint.filter(m => normTag(m.tag) === normTag(a.tag));
  const sw = db.swAssign.filter(x => normTag(x.tag) === normTag(a.tag));
  const held = daysSince(a.allocatedDate);
  const holderCard = hasHolder(a) ? `<div class="holder"><div class="avatar">${esc(initials(holderName(a)))}</div><div style="flex:1">
      <b ${h ? `data-act="open-emp" data-id="${h.id}" style="cursor:pointer;color:var(--accent)"` : ''}>${esc(holderName(a))}</b> ${h ? empStatusBadge(h.status) : badge('Not in employee master', 'b-warn')}
      <div class="muted">${esc([h ? h.empCode : a.empCode, h ? h.email : a.holderEmail, h ? h.designation : '', h ? h.department : a.department].filter(Boolean).join(' · '))}</div>
      <div class="muted">Allocated ${esc(fmtDate(a.allocatedDate) || '—')}${held !== null ? ` · held for ${held} days` : ''}</div></div></div>`
    : `<div class="holder"><div class="avatar">📦</div><div><b>Not assigned</b><div class="muted">${esc(a.status)}${a.location ? ' · ' + esc(a.location) : ''}</div></div></div>`;
  openDrawer(`
   <div class="d-head"><div class="avatar">${TYPE_ICON[a.type] || '📦'}</div><div><h2>${esc(a.tag)}</h2>
     <div class="muted">${esc(a.type)} · ${esc(norm((a.make || '') + ' ' + (a.model || '')))}</div><div style="margin-top:4px">${statusBadge(a.status)} ${a.osLicense ? badge('OS: ' + a.osLicense, /not/i.test(a.osLicense) ? 'b-err' : '') : ''}</div></div></div>
   <div class="d-actions">
     ${canDo('canAssignAsset') ? `<button class="btn primary sm" data-act="assign" data-asset="${a.id}">${hasHolder(a) ? '⇄ Transfer' : '+ Assign'}</button>` : ''}
     ${hasHolder(a) && canDo('canAssignAsset') ? `<button class="btn sm" data-act="return" data-id="${a.id}">↩ Return to stock</button>` : ''}
     <button class="btn sm" data-act="print-qr" data-id="${a.id}">🏷️ QR Sticker</button>
     ${canDo('canAddEditAsset') ? `<button class="btn sm" data-act="status" data-id="${a.id}">Change status</button>` : ''}
     ${canDo('canAddEditAsset') ? `<button class="btn sm" data-act="edit-asset" data-id="${a.id}">✎ Edit</button>` : ''}
     ${canDo('canManageMaint') ? `<button class="btn sm" data-act="add-maint" data-tag="${esc(a.tag)}">🛠 Maintenance</button>` : ''}
     ${hasHolder(a) && h ? `<button class="btn sm" data-act="handover-sig" data-emp="${h.id}" data-asset="${a.id}">✍ E-Handover</button>` : ''}
     ${hasHolder(a) && h ? `<button class="btn sm" data-act="print-handover" data-emp="${h.id}" data-asset="${a.id}">🖨 Handover</button>` : ''}
     ${canDo('canAddEditAsset') ? `<button class="btn sm" data-act="dup-asset" data-id="${a.id}">⧉ Copy as new</button>` : ''}
     ${canDo('canDelete') ? `<button class="btn sm danger" data-act="del-asset" data-id="${a.id}">Delete</button>` : ''}
   </div>
   <div class="section"><h4>Current holder</h4>${holderCard}</div>
   <div class="section"><h4>Specifications</h4>${kvGrid([['Serial No', esc(a.serialNo)], ['Hostname', esc(a.hostname)], ['Processor', esc(a.processor)], ['RAM', esc(a.ram)], ['Storage', esc(a.storage)],
     ['OS', esc(a.os)], ['Domain join', esc(a.domainJoin)], ['IMEI', esc(a.imei)], ['SIM', esc(a.simNumber)], ['Screen tag', esc(a.screenTag)], ['Accessories', esc(a.accessories)],
     ['Condition', esc(a.condition)], ['Physical', esc(a.physical)], ['Backup', esc(a.qsync)], ['Location', esc(a.location)], ['Engineer', esc(a.engineer)], ['Vendor', esc(a.vendor)],
     ['Purchase', esc(fmtDate(a.purchaseDate))], ['Warranty ends', esc(fmtDate(a.warrantyEnd))], ['Cost', a.cost ? '₹ ' + Number(a.cost).toLocaleString('en-IN') : ''], ['Book value (est.)', a.cost ? '₹ ' + calcAssetValuation(a).bookValue.toLocaleString('en-IN') : ''], ['Account ID', esc(a.adobeId)], ['Extra', esc(a.extra)], ['Remarks', esc(a.remarks)],
     ...((db.settings?.customAssetFields || []).map(cf => [cf.l, esc(a[cf.k])]))])}</div>
   ${sw.length ? `<div class="section"><h4>Software on this device</h4>${sw.map(x => { const s = IX.swId.get(x.swId); return `<div class="list-item" data-act="open-sw" data-id="${x.swId}">🧩 ${esc(s ? s.name : '?')} ${s ? badge(s.licenseType) : ''}</div>`; }).join('')}</div>` : ''}
   <div class="section"><h4>Maintenance (${maint.length})</h4>${maint.map(m => `<div class="list-item" data-act="edit-maint" data-id="${m.id}">${badge(m.type, 'b-info')} ${esc([m.before, m.added ? '+' + m.added : '', m.after ? '→ ' + m.after : '', m.notes].filter(Boolean).join(' '))}<span class="when">${esc(fmtDate(m.date))}</span></div>`).join('') || '<div class="muted">None</div>'}</div>
   <div class="section"><h4>Ownership history</h4>${timelineHTML(hist)}</div>`);
}

function showSw(id) {
  const s = IX.swId.get(id); if (!s) return closeDrawer();
  drawerCtx = { kind: 'sw', id };
  const list = db.swAssign.filter(x => x.swId === id);
  openDrawer(`
   <div class="d-head"><div class="avatar">🧩</div><div><h2>${esc(s.name)} ${esc(s.version || '')}</h2><div class="muted">${esc(s.category || '')}</div>
    <div style="margin-top:4px">${badge(s.licenseType, s.licenseType === 'Pirated' ? 'b-err' : 'b-acc')}</div></div></div>
   ${s.licenseType === 'Pirated' ? '<div class="warnbox">⚠ Pirated / cracked software is a legal and security risk. Plan a licensed or open-source replacement.</div>' : ''}
   <div class="d-actions">
     ${canDo('canManageSoftware') ? `<button class="btn primary sm" data-act="assign-sw" data-sw="${s.id}">+ Assign to employee</button>` : ''}
     ${canDo('canManageSoftware') ? `<button class="btn sm" data-act="edit-sw" data-id="${s.id}">✎ Edit</button>` : ''}
     ${canDo('canDelete') ? `<button class="btn sm danger" data-act="del-sw" data-id="${s.id}">Delete</button>` : ''}
   </div>
   ${kvGrid([['Vendor', esc(s.vendor)], ['Seats', `${list.length}${s.totalSeats ? ' used of ' + esc(s.totalSeats) : ' used'}`], ['Cost', s.cost ? '₹ ' + esc(s.cost) : ''], ['Renewal', esc(fmtDate(s.expiry))], ['Departments', esc(s.departments)], ['Notes', esc(s.notes)]])}
   <div class="section"><h4>Assigned to (${list.length})</h4>${list.map(x => { const e = IX.empId.get(x.empId); return `<div class="asset-card"><span class="ic">👤</span><div class="grow" ${e ? `data-act="open-emp" data-id="${e.id}"` : ''}><b>${esc(e ? e.name : x.name || '?')}</b><div class="muted">${esc([e && e.empCode, x.tag, x.account, fmtDate(x.date)].filter(Boolean).join(' · '))}</div></div>${canDo('canManageSoftware') ? `<button class="btn sm" data-act="unassign-sw" data-id="${x.id}">Remove</button>` : ''}</div>`; }).join('') || '<div class="muted">Nobody yet.</div>'}</div>`);
}

// ---------------- actions ----------------
function assignAsset(a, e, date, note) {
  const prev = hasHolder(a) ? holderName(a) : '', prevKey = holderKey(a);
  if (prev && holderOf(a) === e) return;
  a.empCode = e.empCode || ''; a.holderName = e.name; a.holderEmail = e.email || '';
  a.department = e.department || a.department; a.location = e.location || a.location;
  a.allocatedDate = date || today(); a.status = 'In Use';
  markDirty('assets', a);
  log(a.tag, prev ? 'Transferred' : 'Assigned', (prev ? `${prev} → ${e.name}` : `to ${e.name} (${e.empCode || e.email || ''})`) + (note ? ` · ${note}` : ''), [prevKey, e.empCode || e.email || e.name]);
}
function returnAsset(a, { condition, note, status = 'In Stock' } = {}) {
  const prev = holderName(a), key = holderKey(a);
  log(a.tag, 'Returned', `from ${prev}` + (condition ? ` · condition ${condition}` : '') + (note ? ` · ${note}` : ''), [key]);
  a.empCode = ''; a.holderName = ''; a.holderEmail = ''; a.allocatedDate = ''; a.status = status;
  if (condition) a.condition = condition;
  markDirty('assets', a);
}

function employeeForm(e) {
  const isNew = !e; const rec = e ? { ...e } : { status: 'Active', company: '' };
  const fields = getActiveFields(EMP_FIELDS, 'employee');
  const m = modal(isNew ? 'Add Employee' : `Edit ${e.name}`, formHTML(fields, rec) + '<div class="hint" style="margin-top:10px">Duplicate Emp Code or Email is blocked automatically. Passwords are intentionally not stored.</div>', [{
    label: isNew ? 'Add Employee' : 'Save', cls: 'primary', onClick: async root => {
      const r = readForm(root); r.email = low(r.email); r.empCode = normTag(r.empCode);
      if (r.status === 'Active') r.exitDate = '';
      const { errs, warns } = validateEmployee(r, e && e.id);
      if (errs.length) return root.err(errs), false;
      if (warns.length && !(await confirmBox('Please check', warns.map(esc).join('<br>'), 'Save anyway'))) return false;
      if (isNew) { const ne = { id: uid(), createdAt: new Date().toISOString(), ...r }; db.employees.push(ne); markDirty('employees', ne); log(r.empCode || r.name, 'Employee added', r.name, [r.empCode, r.email, r.name]); toast('Employee added', 'ok'); changed(); showEmp(ne.id); }
      else {
        const old = { ...e };
        Object.assign(e, r);
        markDirty('employees', e);
        // keep linked asset records in sync if code/email changed
        db.assets.forEach(a => { if ((old.empCode && normTag(a.empCode) === normTag(old.empCode)) || (old.email && low(a.holderEmail) === low(old.email))) { a.empCode = e.empCode; a.holderEmail = e.email; a.holderName = e.name; markDirty('assets', a); } });
        const diff = Object.keys(r).filter(k => (old[k] || '') !== (r[k] || '')).map(k => `${k}: ${old[k] || '—'} → ${r[k] || '—'}`).join('; ');
        if (diff) log(e.empCode || e.name, 'Employee edited', diff, [e.empCode, e.email, e.name]);
        toast('Saved', 'ok'); changed();
      }
      return true;
    }
  }]);

  const statusSel = m.querySelector('[name="status"]');
  const exitInp = m.querySelector('[name="exitDate"]');
  const dojInp = m.querySelector('[name="doj"]');
  const exitLabel = exitInp ? exitInp.closest('label') : null;
  const dojLabel = dojInp ? dojInp.closest('label') : null;

  const syncStatusVisibility = () => {
    const s = statusSel ? (statusSel.value || 'Active') : 'Active';
    if (exitLabel) {
      if (s === 'Notice Period' || s === 'Exited') {
        exitLabel.style.display = '';
        const span = exitLabel.querySelector('span');
        if (span) span.textContent = (s === 'Notice Period' ? 'Exit Date / LWD' : 'Exit Date');
      } else {
        exitLabel.style.display = 'none';
      }
    }
    if (dojLabel) {
      dojLabel.style.display = '';
    }
  };

  if (statusSel) {
    statusSel.addEventListener('change', syncStatusVisibility);
    syncStatusVisibility();
  }
}

function assetForm(a, preset = {}) {
  const isNew = !a;
  const rec = a ? { ...a } : { type: 'Laptop', status: 'In Stock', condition: 'Good', location: 'Noida Sec-9', engineer: db.settings.engineer, ...preset };
  const fields = getActiveFields(ASSET_FIELDS, 'asset');
  const m = modal(isNew ? 'Add Asset' : `Edit ${a.tag}`, formHTML(fields, rec) + '<div class="hint" style="margin-top:10px">Duplicate Asset Tag, Serial No, IMEI and SIM numbers are blocked. Fill “Assigned To” with an Emp Code to link the employee automatically.</div>', [{
    label: isNew ? 'Add Asset' : 'Save', cls: 'primary', onClick: async root => {
      const r = readForm(root); r.tag = normTag(r.tag); r.empCode = normTag(r.empCode); r.holderEmail = low(r.holderEmail); r.ram = tidySize(r.ram); r.storage = tidySize(r.storage);
      const emp = r.empCode ? IX.empCode.get(r.empCode) : null;
      if (emp) { r.holderName = r.holderName || emp.name; r.holderEmail = r.holderEmail || emp.email || ''; r.department = r.department || emp.department || ''; }
      if (hasHolder(r) && r.status === 'In Stock') r.status = 'In Use';
      if (!hasHolder(r) && r.status === 'In Use') return root.err(['Status is "In Use" but no employee is assigned. Fill "Assigned To" or change status.']), false;
      if (hasHolder(r) && !r.allocatedDate) r.allocatedDate = today();
      const { errs, warns } = validateAsset(r, a && a.id);
      if (errs.length) return root.err(errs), false;
      if (warns.length && !(await confirmBox('Please check', warns.map(esc).join('<br>'), 'Save anyway'))) return false;
      if (isNew) {
        const na = { id: uid(), createdAt: new Date().toISOString(), ...r }; db.assets.push(na); markDirty('assets', na);
        log(na.tag, 'Created', `${na.type} ${na.make || ''}${hasHolder(na) ? ' · assigned to ' + na.holderName : ''}`, [holderKey(na)]);
        toast(`${na.tag} added`, 'ok'); changed(); showAsset(na.id);
      } else {
        const old = { ...a };
        const holderChanged = holderKey(old) !== holderKey(r);
        Object.assign(a, r);
        markDirty('assets', a);
        const diff = Object.keys(r).filter(k => (old[k] || '') !== (r[k] || '')).map(k => `${k}: ${old[k] || '—'} → ${r[k] || '—'}`).join('; ');
        if (old.tag !== a.tag) { db.history.forEach(h => { if (normTag(h.tag) === normTag(old.tag)) h.tag = a.tag; }); db.maint.forEach(x => { if (normTag(x.tag) === normTag(old.tag)) x.tag = a.tag; }); }
        if (diff) log(a.tag, holderChanged ? 'Transferred' : 'Edited', diff, [holderKey(old), holderKey(a)]);
        toast('Saved', 'ok'); changed();
      }
      return true;
    }
  }]);
  m.querySelector('[data-suggest]')?.addEventListener('click', () => { m.querySelector('[name=tag]').value = nextTag(m.querySelector('[name=type]').value); });
  const codeIn = m.querySelector('[name=empCode]');
  codeIn.addEventListener('change', () => {
    const e = IX.empCode.get(normTag(codeIn.value)) || IX.empEmail.get(low(codeIn.value));
    if (e) { codeIn.value = e.empCode || ''; m.querySelector('[name=holderName]').value = e.name; m.querySelector('[name=holderEmail]').value = e.email || ''; m.querySelector('[name=department]').value = e.department || ''; if (!m.querySelector('[name=allocatedDate]').value) m.querySelector('[name=allocatedDate]').value = today(); m.querySelector('[name=status]').value = 'In Use'; }
  });
}

function assignModal({ asset, emp }) {
  const body = `<div class="form-grid">
    ${asset ? `<div class="full"><b>${TYPE_ICON[asset.type] || ''} ${esc(asset.tag)}</b> · ${esc(asset.type)} ${esc(asset.make || '')} ${hasHolder(asset) ? `<div class="warnbox" style="margin-top:8px">Currently with <b>${esc(holderName(asset))}</b> — this will be recorded as a transfer.</div>` : ''}</div>`
      : `<label class="full"><span>Asset (free stock) *</span><input name="asset" list="dl_stock" placeholder="Type tag e.g. LAP-512"><span class="hint">Only “In Stock” assets are suggested; you can also type any tag.</span></label>`}
    ${emp ? `<div class="full">To <b>${esc(emp.name)}</b> (${esc(emp.empCode || emp.email || '')})</div>`
      : `<label class="full"><span>Employee *</span><input name="emp" list="dl_emppick" placeholder="Type name or Emp Code"></label>`}
    <label><span>Allocation date</span><input type="date" name="date" value="${today()}"></label>
    <label><span>Accessories given</span><input name="acc" value="${esc(asset ? asset.accessories || '' : '')}" placeholder="Charger, mouse, bag…"></label>
    <label class="full"><span>Note</span><input name="note" placeholder="optional"></label></div><div id="assign-warn"></div>`;
  modal('Assign asset', body, [{
    label: 'Assign', cls: 'primary', onClick: async root => {
      const r = readForm(root);
      const a = asset || resolveAsset(r.asset);
      const e = emp || resolveEmp(r.emp);
      const errs = [];
      if (!a) errs.push(`Asset "${r.asset || ''}" not found. Add it first from + Asset.`);
      if (!e) errs.push(`Employee "${r.emp || ''}" not found in employee master.`);
      if (e && e.status === 'Exited') errs.push(`${e.name} is marked Exited.`);
      if (a && ['Lost', 'Scrapped'].includes(a.status)) errs.push(`${a.tag} is marked ${a.status}.`);
      if (errs.length) return root.err(errs), false;
      if (holderOf(a) === e) return root.err([`${a.tag} is already with ${e.name}.`]), false;
      const warns = [];
      if (hasHolder(a)) warns.push(`${a.tag} is currently with ${holderName(a)}. It will be transferred.`);
      const same = assetsOf(e).filter(x => x.type === a.type && ['Laptop', 'Desktop', 'Mobile'].includes(a.type));
      if (same.length) warns.push(`${e.name} already has ${same.map(x => x.tag).join(', ')} (${a.type}).`);
      if (warns.length && !(await confirmBox('Please confirm', warns.map(esc).join('<br>'), 'Continue'))) return false;
      if (r.acc) a.accessories = r.acc;
      assignAsset(a, e, r.date, r.note);
      toast(`${a.tag} assigned to ${e.name}`, 'ok'); changed(); return true;
    }
  }]);
}
function returnModal(a) {
  modal(`Return ${a.tag}`, `<p>Returning from <b>${esc(holderName(a))}</b> to IT stock.</p><div class="form-grid">
    <label><span>Condition</span><select name="condition">${['Good', 'Fair', 'Poor', 'Dead'].map(c => `<option ${c === a.condition ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label><span>Put into</span><select name="status"><option>In Stock</option><option>Under Repair</option><option>Scrapped</option></select></label>
    <label class="full"><span>Note</span><input name="note" placeholder="e.g. charger missing"></label></div>`, [{
    label: 'Return', cls: 'primary', onClick: root => { const r = readForm(root); returnAsset(a, r); toast(`${a.tag} returned`, 'ok'); changed(); return true; }
  }], 'sm');
}
function statusModal(a) {
  modal(`Change status — ${a.tag}`, `<div class="form-grid"><label><span>Status</span><select name="status">${STATUSES.map(s => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label class="full"><span>Reason / note</span><input name="note"></label></div><p class="hint">To give it back to stock from a user use “Return”. Lost devices keep the last holder recorded.</p>`, [{
    label: 'Update', cls: 'primary', onClick: root => {
      const r = readForm(root); if (r.status === a.status) return true;
      if (r.status === 'In Use' && !hasHolder(a)) return root.err(['Use “Assign” to give it to someone.']), false;
      if (r.status === 'In Stock' && hasHolder(a)) { returnAsset(a, { note: r.note }); }
      else { log(a.tag, 'Status: ' + r.status, `${a.status} → ${r.status}${r.note ? ' · ' + r.note : ''}`, [holderKey(a)]); a.status = r.status; markDirty('assets', a); }
      changed(); return true;
    }
  }], 'sm');
}
function offboardModal(e) {
  if (!canDo('canAssignAsset')) {
    modal(`Mark Exited — ${e.name}`, `
     <p>Update employee status to <b>Exited</b>.</p>
     <div class="form-grid">
       <label><span>Exit date</span><input type="date" name="exitDate" value="${e.exitDate && isISO(e.exitDate) ? e.exitDate : today()}"></label>
       <label class="full"><span>Exit Note / Reason</span><input name="note" placeholder="Handover notes, reason for exit…"></label>
     </div>`, [{
      label: 'Mark Exited', cls: 'primary', onClick: async root => {
        const r = readForm(root);
        if (!(await confirmBox('Confirm Exit', `Mark <b>${esc(e.name)}</b> as Exited?`, 'Mark Exited'))) return false;
        e.status = 'Exited';
        e.exitDate = r.exitDate || today();
        if (r.note) e.notes = (e.notes ? e.notes + ' · ' : '') + `Exit: ${r.note}`;
        markDirty('employees', e);
        log(e.empCode || e.name, 'Marked Exited by HR', r.note || '', empKeys(e));
        changed();
        toast(`${e.name} marked as Exited`, 'ok');
        return true;
      }
    }], 'sm');
    return;
  }
  const assets = assetsOf(e);
  const sw = db.swAssign.filter(x => x.empId === e.id);
  modal(`Exit clearance — ${e.name}`, `
   <p>Tick the items received back. Unticked items stay with the employee and are flagged as <b>pending recovery</b>.</p>
   ${assets.map(a => `<label class="asset-card" style="cursor:pointer"><input type="checkbox" name="r_${a.id}" checked> <span class="ic">${TYPE_ICON[a.type] || '📦'}</span><div class="grow"><b>${esc(a.tag)}</b> · ${esc(a.type)} ${esc(a.make || '')}<div class="muted">${esc(a.accessories || '')}</div></div>
      <select name="c_${a.id}"><option>Good</option><option>Fair</option><option>Poor</option><option>Dead</option></select></label>`).join('') || '<div class="okbox">No assets with this employee.</div>'}
   ${sw.length ? `<label class="asset-card"><input type="checkbox" name="sw" checked> Remove ${sw.length} software licence(s) (${esc(sw.map(x => (IX.swId.get(x.swId) || {}).name).join(', '))})</label>` : ''}
   <div class="form-grid"><label><span>Exit date</span><input type="date" name="exitDate" value="${e.exitDate && isISO(e.exitDate) ? e.exitDate : today()}"></label><label class="full"><span>Note</span><input name="note"></label></div>`, [{
    label: 'Complete clearance', cls: 'primary', onClick: async root => {
      const r = readForm(root);
      let pending = 0;
      assets.forEach(a => { if (!r['r_' + a.id]) pending++; });

      const msg = pending
        ? `Are you sure you want to complete exit clearance for <b>${esc(e.name)}</b>?<br><br><span style="color:var(--warn)">Note: ${pending} asset(s) are not marked as returned and will remain pending recovery.</span>`
        : `Are you sure you want to complete exit clearance for <b>${esc(e.name)}</b>?`;

      if (!(await confirmBox('Confirm Exit Clearance', msg, 'Complete Clearance'))) return false;

      assets.forEach(a => {
        if (r['r_' + a.id]) returnAsset(a, { condition: r['c_' + a.id], note: 'Exit clearance' + (r.note ? ' · ' + r.note : '') });
      });
      if (r.sw) {
        db.swAssign.filter(x => x.empId === e.id).forEach(x => queueDelete('sw_assign', x.id));
        db.swAssign = db.swAssign.filter(x => x.empId !== e.id);
      }
      e.exitDate = r.exitDate;
      e.status = pending ? 'Notice Period' : 'Exited';
      markDirty('employees', e);
      log(e.empCode || e.name, pending ? 'Exit (pending recovery)' : 'Exited', `${e.name}: ${assets.length - pending} returned, ${pending} pending`, [e.empCode, e.email, e.name]);
      changed();
      toast(pending ? `${pending} asset(s) still pending` : 'Clearance complete', pending ? 'err' : 'ok');
      return true;
    }
  }]);
}
function swForm(s) {
  const isNew = !s;
  modal(isNew ? 'Add Software' : `Edit ${s.name}`, formHTML(SW_FIELDS, s ? { ...s } : { licenseType: 'Paid' }), [{
    label: 'Save', cls: 'primary', onClick: root => {
      const r = readForm(root); const { errs } = validateSoftware(r, s && s.id);
      if (errs.length) return root.err(errs), false;
      if (isNew) { const n = { id: uid(), ...r }; db.software.push(n); markDirty('software', n); log(r.name, 'Software added', r.licenseType); changed(); showSw(n.id); }
      else { Object.assign(s, r); markDirty('software', s); log(s.name, 'Software edited', ''); changed(); }
      return true;
    }
  }]);
}
function swAssignModal({ sw, emp }) {
  modal('Assign software', `<div class="form-grid">
   ${sw ? `<div class="full">🧩 <b>${esc(sw.name)}</b></div>` : `<label class="full"><span>Software *</span><select name="sw">${db.software.slice().sort((a, b) => natCmp(a.name, b.name)).map(s => `<option value="${s.id}">${esc(s.name + ' ' + (s.version || ''))}</option>`).join('')}</select></label>`}
   ${emp ? `<div class="full">To <b>${esc(emp.name)}</b></div>` : `<label class="full"><span>Employee *</span><input name="emp" list="dl_emppick"></label>`}
   <label><span>Device tag</span><input name="tag" list="dl_alltags" value="${emp ? esc((assetsOf(emp).find(a => ['Laptop', 'Desktop'].includes(a.type)) || {}).tag || '') : ''}"></label>
   <label><span>Account / licence ID</span><input name="account" placeholder="login email or licence ref"></label>
   <label><span>Date</span><input type="date" name="date" value="${today()}"></label></div>`, [{
    label: 'Assign', cls: 'primary', onClick: root => {
      const r = readForm(root); const s = sw || IX.swId.get(r.sw); const e = emp || resolveEmp(r.emp);
      const errs = []; if (!s) errs.push('Choose a software (add it on the Software page first).'); if (!e) errs.push('Employee not found.');
      if (s && e && db.swAssign.some(x => x.swId === s.id && x.empId === e.id)) errs.push(`Duplicate: ${s.name} is already assigned to ${e.name}.`);
      if (s && +s.totalSeats && seatsUsed(s) >= +s.totalSeats) errs.push(`All ${s.totalSeats} seats of ${s.name} are used. Increase seats or free one first.`);
      if (errs.length) return root.err(errs), false;
      const as = { id: uid(), swId: s.id, empId: e.id, name: e.name, tag: normTag(r.tag), account: r.account, date: r.date };
      db.swAssign.push(as);
      markDirty('sw_assign', as);
      log(r.tag || s.name, 'Software assigned', `${s.name} → ${e.name}`, [e.empCode, e.email, e.name]);
      changed(); return true;
    }
  }], 'sm');
}
function maintForm(m, presetTag) {
  const isNew = !m;
  const rec = m ? { ...m } : { type: 'RAM Upgrade', date: today(), engineer: db.settings.engineer, tag: presetTag || '' };
  const fields = [{ k: 'type', l: 'Type', t: 'select', opts: MAINT_TYPES }, { k: 'tag', l: 'Asset Tag *', list: 'alltags' }, { k: 'date', l: 'Date', t: 'date' },
    { k: 'before', l: 'Before (e.g. 8 GB)' }, { k: 'added', l: 'Added / part (e.g. 8 GB DDR4)' }, { k: 'after', l: 'After (e.g. 16 GB)' },
    { k: 'engineer', l: 'Engineer', list: 'engineer' }, { k: 'cost', l: 'Cost (₹)', t: 'number' }, { k: 'notes', l: 'Notes', t: 'textarea', full: true }];
  modal(isNew ? 'Add maintenance entry' : 'Edit maintenance entry', formHTML(fields, rec) + (isNew ? '<label style="display:block;margin-top:10px"><input type="checkbox" name="updRam" checked> For RAM / Storage upgrades, update the asset’s RAM / Storage to the “After” value</label>' : ''), [
    ...(isNew ? [] : [{ label: 'Delete', cls: 'danger', onClick: async () => { if (!(await confirmBox('Delete entry?', 'This maintenance entry will be removed.', 'Delete', 'danger'))) return false; queueDelete('maint', m.id); db.maint = db.maint.filter(x => x.id !== m.id); changed(); return true; } }]),
    {
      label: 'Save', cls: 'primary', onClick: root => {
        const r = readForm(root); r.tag = normTag(r.tag); const a = IX.tag.get(r.tag);
        if (!r.tag) return root.err(['Asset Tag is required.']), false;
        if (!a && isNew) return root.err([`Asset ${r.tag} not found. Add the asset first.`]), false;
        const upd = r.updRam; delete r.updRam;
        if (a) { const h = holderOf(a); r.empCode = h ? h.empCode : a.empCode; r.name = holderName(a); }
        if (isNew && db.maint.some(x => normTag(x.tag) === r.tag && x.type === r.type && x.date === r.date && (x.after || '') === (r.after || ''))) return root.err(['Duplicate: the same entry already exists for this asset & date.']), false;
        if (isNew) {
          const nm = { id: uid(), ...r };
          db.maint.unshift(nm);
          markDirty('maint', nm);
          if (upd && a && r.after) {
            if (r.type === 'RAM Upgrade') a.ram = tidySize(r.after);
            if (r.type === 'Storage Upgrade') a.storage = tidySize(r.after);
            markDirty('assets', a);
          }
          log(r.tag, r.type, [r.before, r.added && '+' + r.added, r.after && '→ ' + r.after, r.notes].filter(Boolean).join(' '), [a ? holderKey(a) : '']);
        } else {
          Object.assign(m, r);
          markDirty('maint', m);
        }
        changed(); return true;
      }
    }]);
}

// ---------------- printing ----------------
function printDoc(title, inner) {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', 'err');
  const logoHtml = db.settings.logo ? `<img src="${esc(db.settings.logo)}" alt="Logo" style="height:44px;max-width:140px;object-fit:contain;margin-bottom:6px;display:block">` : '';
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
   body{font:13px/1.5 Segoe UI,Arial,sans-serif;color:#111;margin:32px}h1{font-size:20px;margin:0}h2{font-size:15px;margin:22px 0 8px}
   table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f0f0f0}
   .head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:16px}.sig{display:flex;justify-content:space-between;margin-top:60px}
   .sig div{border-top:1px solid #111;width:30%;text-align:center;padding-top:6px}ol{padding-left:18px}@media print{button{display:none}}</style></head><body>
   <div class="head"><div>${logoHtml}<h1>${esc(db.settings.org || '')}</h1><div>${esc(title)}</div></div><div>Date: ${fmtDate(today())}</div></div>${inner}
   <script>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
}
function empTable(e) { return `<table><tr><th>Name</th><td>${esc(e.name)}</td><th>Emp Code</th><td>${esc(e.empCode || '')}</td></tr><tr><th>Designation</th><td>${esc(e.designation || '')}</td><th>Department</th><td>${esc(e.department || '')}</td></tr><tr><th>Email</th><td>${esc(e.email || '')}</td><th>Location</th><td>${esc(e.location || '')}</td></tr></table>`; }
function assetRows(list) { return `<table><tr><th>#</th><th>Asset Tag</th><th>Type</th><th>Make / Model</th><th>Serial / IMEI / SIM</th><th>Config</th><th>Accessories</th><th>Allocated</th></tr>${list.map((a, i) => `<tr><td>${i + 1}</td><td><b>${esc(a.tag)}</b></td><td>${esc(a.type)}</td><td>${esc(norm((a.make || '') + ' ' + (a.model || '')))}</td><td>${esc([a.serialNo, a.imei, a.simNumber].filter(Boolean).join(' / '))}</td><td>${esc([a.processor, a.ram, a.storage, a.os].filter(Boolean).join(', '))}</td><td>${esc(a.accessories || '')}</td><td>${esc(fmtDate(a.allocatedDate))}</td></tr>`).join('')}</table>`; }
function printHandover(e, only) {
  const list = only ? [only] : assetsOf(e);
  if (!list.length) return toast('No assets to print', 'err');
  printDoc('IT Asset Handover / Acknowledgement Form', `${empTable(e)}<h2>Assets issued</h2>${assetRows(list)}
   <h2>Terms</h2><ol><li>The above company assets are issued for official use only and remain company property.</li><li>I will take reasonable care of the assets and report loss, theft or damage to IT immediately.</li>
   <li>I will not install unlicensed software or remove security / management tools.</li><li>All assets and accessories will be returned in working condition at exit or when asked by IT.</li></ol>
   <div class="sig"><div>Employee signature</div><div>IT Engineer${db.settings.engineer ? ' (' + esc(db.settings.engineer) + ')' : ''}</div><div>Reporting Manager</div></div>`);
}
function printClearance(e) {
  const returned = db.history.filter(h => h.action === 'Returned' && h.who.some(w => empKeys(e).includes(w)) && /Exit clearance/.test(h.detail));
  printDoc('IT Clearance / No-Dues Certificate', `${empTable(e)}<p>This is to certify that <b>${esc(e.name)}</b> (${esc(e.empCode || '')}) has returned all IT assets issued to them and has no IT dues as on ${fmtDate(e.exitDate || today())}.</p>
   <h2>Assets received back</h2><table><tr><th>Asset</th><th>Details</th><th>Date</th></tr>${returned.map(h => `<tr><td>${esc(h.tag)}</td><td>${esc(h.detail)}</td><td>${esc(new Date(h.ts).toLocaleDateString())}</td></tr>`).join('') || '<tr><td colspan="3">No assets were assigned</td></tr>'}</table>
   <div class="sig"><div>IT Engineer</div><div>IT Head</div><div>HR</div></div>`);
}

// ---------------- export ----------------
function download(name, content, type = 'text/plain') { const b = new Blob([content], { type }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }
function toCSV(rows, cols) { const q = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }; return '﻿' + [cols.map(c => q(c[0])).join(','), ...rows.map(r => cols.map(c => q(typeof c[1] === 'function' ? c[1](r) : r[c[1]])).join(','))].join('\r\n'); }
const CSV_ASSET = [['Asset Tag', 'tag'], ['Type', 'type'], ['Status', 'status'], ['Make', 'make'], ['Model', 'model'], ['Serial No', 'serialNo'], ['Hostname', 'hostname'], ['Processor', 'processor'], ['RAM', 'ram'], ['Storage', 'storage'], ['OS', 'os'], ['OS Licence', 'osLicense'], ['Domain Join', 'domainJoin'], ['IMEI', 'imei'], ['SIM', 'simNumber'], ['Screen Tag', 'screenTag'], ['Accessories', 'accessories'], ['Emp Code', 'empCode'], ['Holder', a => holderName(a)], ['Holder Email', 'holderEmail'], ['Department', a => (holderOf(a) || a).department], ['Allocated Date', 'allocatedDate'], ['Location', 'location'], ['Condition', 'condition'], ['Physical', 'physical'], ['Engineer', 'engineer'], ['Vendor', 'vendor'], ['Purchase Date', 'purchaseDate'], ['Warranty End', 'warrantyEnd'], ['Cost', 'cost'], ['Account ID', 'adobeId'], ['Backup', 'qsync'], ['Extra', 'extra'], ['Remarks', 'remarks']];
const CSV_EMP = [['EmpCode', 'empCode'], ['Name', 'name'], ['Email', 'email'], ['Phone', 'phone'], ['Designation', 'designation'], ['Department', 'department'], ['Location', 'location'], ['Company', 'company'], ['Date of Joining', 'doj'], ['Band', 'band'], ['Status', 'status'], ['Exit Date', 'exitDate'], ['Assets', e => assetsOf(e).map(a => a.tag).join(' ')], ['Notes', 'notes']];

function getEmpExportCols() {
  const custom = (db.settings?.customEmpFields || []).map(cf => [cf.l, cf.k]);
  const base = canDo('canViewAssetsInEmp') ? CSV_EMP : CSV_EMP.filter(c => c[0] !== 'Assets');
  return [...base, ...custom];
}
function getAssetExportCols() {
  const custom = (db.settings?.customAssetFields || []).map(cf => [cf.l, cf.k]);
  return [...CSV_ASSET, ...custom];
}

const CSV_SW = [['Software', 'name'], ['Version', 'version'], ['Category', 'category'], ['Licence', 'licenseType'], ['Vendor', 'vendor'], ['Seats', 'totalSeats'], ['Used', s => seatsUsed(s)], ['Cost', 'cost'], ['Expiry', 'expiry'], ['Departments', 'departments'], ['Notes', 'notes']];
const CSV_MAINT = [['Date', 'date'], ['Type', 'type'], ['Asset', 'tag'], ['Emp Code', 'empCode'], ['Employee', 'name'], ['Before', 'before'], ['Added', 'added'], ['After', 'after'], ['Engineer', 'engineer'], ['Cost', 'cost'], ['Notes', 'notes']];
const CSV_HIST = [['When', h => new Date(h.ts).toLocaleString()], ['Action', 'action'], ['Record', 'tag'], ['Details', 'detail'], ['By', 'by']];
function backup() {
  db.settings.lastBackup = new Date().toISOString(); save();
  download(`it-assets-backup-${today()}.json`, JSON.stringify(db, null, 1), 'application/json'); toast('Backup downloaded', 'ok'); render();
}
let xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return xlsxPromise ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => { xlsxPromise = null; rej(new Error('Could not load the Excel reader (needs internet once). Use copy-paste instead.')); }; document.head.append(s); });
}
async function exportExcel() {
  try {
    const X = await loadXLSX(); const wb = X.utils.book_new();
    const sheet = (rows, cols) => X.utils.aoa_to_sheet([cols.map(c => c[0]), ...rows.map(r => cols.map(c => typeof c[1] === 'function' ? c[1](r) : r[c[1]] ?? ''))]);
    const empCols = getEmpExportCols();
    const assetCols = getAssetExportCols();
    X.utils.book_append_sheet(wb, sheet(db.employees, empCols), 'Employees');
    for (const t of uniqSorted(db.assets.map(a => a.type))) X.utils.book_append_sheet(wb, sheet(db.assets.filter(a => a.type === t), assetCols), t.slice(0, 30));
    X.utils.book_append_sheet(wb, sheet(db.software, CSV_SW), 'Software');
    X.utils.book_append_sheet(wb, sheet(db.maint, CSV_MAINT), 'Maintenance');
    X.utils.book_append_sheet(wb, sheet(db.history.slice(0, 5000), CSV_HIST), 'History');
    X.writeFile(wb, `IT-Assets-${today()}.xlsx`);
  } catch (e) { toast(e.message, 'err'); }
}

// ---------------- IMPORT ----------------
function parseDelimited(text) {
  const delim = text.includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(x => x.trim()));
}
const EMP_MAP = { empcode: 'empCode', employeecode: 'empCode', ecode: 'empCode', employeefirstname: 'name', employeename: 'name', fullname: 'name', name: 'name', dateofjoining: 'doj', doj: 'doj', designation: 'designation', department: 'department', calendar: '_calendar', location: 'location', payrollgroup: 'company', company: 'company', emailid: 'email', email: 'email', password: '_ignore', band: 'band', grade: '_grade', phone: 'phone', mobile: 'phone', status: 'status' };
const ASSET_MAP = { type: 'type', category: 'type', hostname: 'hostname', assettag: 'tag', assets: 'tag', asset: 'tag', tag: 'tag', screentag: 'screenTag', srno: '_srno', sno: '_ignore', sl: '_ignore', username: 'holderName', name: 'holderName', allotedto: 'holderName', allottedto: 'holderName', empmailid: 'holderEmail', emailid: 'holderEmail', email: 'holderEmail', empnumber: 'empCode', empid: 'empCode', emp: 'empCode', empcode: 'empCode', os: 'os', notgwindows: '_osnote', wingennotgen: 'osLicense', domainjoin: 'domainJoin', mouse: '_acc:Mouse', monitor: '_acc:Monitor', keyboard: '_acc:Keyboard', charger: '_acc', other: '_acc', extraitembag: '_acc', make: 'make', ramsizemb: 'ram', ramsizegb: 'ram', ram: 'ram', hddsizegb: 'storage', storage: 'storage', workingcondition: 'condition', physicalstatus: 'physical', engineer: 'engineer', remarks: 'remarks', remark: 'remarks', department: 'department', dep: 'department', dept: 'department', location: 'location', processor: 'processor', userallocateddate: 'allocatedDate', dateallocated: 'allocatedDate', allocateddate: 'allocatedDate', date: 'allocatedDate', qsyncbackup: 'qsync', sim: 'simNumber', simnumber: 'simNumber', imeinumber: 'imei', imei: 'imei', extradevice: 'extra', adobeacrobatid: 'adobeId', adobepassword: '_ignore', password: '_ignore', serialno: 'serialNo', serialnumber: 'serialNo', serialnumbermodelnumber: 'serialNo', namemodel: 'model', model: 'model', qty: '_ignore', checkedbyvikash: '_remark2', physicallyverifiedon10524: '_ignore' };
const RAM_MAP = { sno: '_ignore', username: 'name', empnumber: 'empCode', emailid: 'email', raminsystem: 'before', raminstock: '_stock', upgraderam: 'added', totalraminsystem: 'after', date: 'date', laptoppc: '_dev', engineer: 'engineer', device: 'tag', remark: 'notes', ram: '_ramtype' };
const SW_MAP = { sno: '_ignore', departments: 'departments', department: 'departments', softwares: 'names', software: 'names', category: 'category' };
function detectHeader(cells, forced) {
  const keys = cells.map(normKey);
  const has = k => keys.includes(k);
  const customEmpMap = {};
  (db.settings?.customEmpFields || []).forEach(cf => { if (cf.l) customEmpMap[normKey(cf.l)] = cf.k; });
  const customAssetMap = {};
  (db.settings?.customAssetFields || []).forEach(cf => { if (cf.l) customAssetMap[normKey(cf.l)] = cf.k; });

  const known = keys.filter(k => k && (EMP_MAP[k] || ASSET_MAP[k] || RAM_MAP[k] || SW_MAP[k] || customEmpMap[k] || customAssetMap[k] || /paid|pirat/.test(k))).length;
  if (known < 3 || cells.some(c => /@/.test(c))) return null;
  let kind = forced;
  if (!kind) {
    if (has('softwares') || has('software')) kind = 'software';
    else if (has('raminsystem') || has('upgraderam')) kind = 'ram';
    else if (has('employeefirstname') || (has('designation') && (has('dateofjoining') || has('payrollgroup')))) kind = 'employee';
    else if (has('namemodel')) kind = 'equipment';
    else if (has('assettag') || has('assets') || has('hostname')) kind = (has('charger') || has('imeinumber') || (has('sim') && !has('os'))) ? 'mobile' : 'asset';
    else if (has('mouse') && has('serialno')) kind = 'accessory';
    else return null;
  }
  const map = kind === 'employee' ? { ...EMP_MAP, ...customEmpMap } : kind === 'ram' ? RAM_MAP : kind === 'software' ? SW_MAP : { ...ASSET_MAP, ...customAssetMap };
  const cols = keys.map(k => { if (kind === 'software' && /paid|pirat|licen/.test(k)) return 'licenseType'; if (kind === 'accessory' && k === 'mouse') return 'make'; return map[k] || ''; });
  return { kind, cols, headers: cells };
}
function rowToRec(sec, cells) {
  const r = {}; const acc = []; const extraRemarks = [];
  sec.cols.forEach((f, i) => {
    const v = f === 'names' ? String(cells[i] ?? '').trim() : norm(cells[i]); if (!f || !v || f === '_ignore') return;
    if (f.startsWith('_acc')) { const lbl = f.split(':')[1]; if (!/^(no|-|na)$/i.test(v)) acc.push(lbl ? `${lbl}: ${v}` : v); return; }
    if (f === '_srno') { if (!/^\d{1,4}$/.test(v) && !BAD_SERIALS.has(normKey(v))) r.serialNo = v; return; }
    if (f === '_osnote' || f === '_remark2' || f === '_grade' || f === '_calendar') { if (f === '_osnote') extraRemarks.push(v); return; }
    if (f.startsWith('_')) { r[f] = v; return; }
    r[f] = r[f] ? r[f] + ' ' + v : v;
  });
  if (acc.length) r.accessories = acc.join('; ');
  if (extraRemarks.length) r.remarks = [r.remarks, ...extraRemarks].filter(Boolean).join(' · ');
  return r;
}
function cleanAsset(r, kind, ctx) {
  // holder email field sometimes contains notes
  if (r.holderEmail && !r.holderEmail.includes('@')) { r.remarks = [r.remarks, r.holderEmail].filter(Boolean).join(' · '); r.holderEmail = ''; }
  r.holderEmail = low(r.holderEmail);
  if (r.empCode) { if (validEmpCode(r.empCode)) r.empCode = normTag(r.empCode); else { if (r.empCode.length > 3) r.remarks = [r.remarks, r.empCode].filter(Boolean).join(' · '); r.empCode = ''; } }
  if (r.holderName && /^(in office|office|store|stock|-|na)$/i.test(r.holderName)) { r.location = r.location || r.holderName; r.holderName = ''; }
  r.tag = normTag(r.tag);
  // link to employee master: by code, then email, then unique exact name
  if (r.empCode && !IX.empCode.get(r.empCode)) {
    const byMail = r.holderEmail && IX.empEmail.get(r.holderEmail);
    const byName = r.holderName ? db.employees.filter(e => low(e.name) === low(r.holderName)) : [];
    const hit = byMail || (byName.length === 1 ? byName[0] : null);
    if (hit) { r.remarks = [r.remarks, `Emp code in sheet: ${r.empCode}`].filter(Boolean).join(' · '); r.empCode = hit.empCode || ''; }
  } else if (!r.empCode && r.holderName) {
    const hit = (r.holderEmail && IX.empEmail.get(r.holderEmail)) || (() => { const l = db.employees.filter(e => low(e.name) === low(r.holderName)); return l.length === 1 ? l[0] : null; })();
    if (hit) r.empCode = hit.empCode || '';
  }
  if (!r.tag && r.type === 'Monitor' || (!r.tag && /^monitor$/i.test(ctx.rawType || '') && r.screenTag)) r.tag = normTag(r.screenTag);
  if (kind === 'equipment' && r.serialNo && !/\d/.test(r.serialNo)) { r.model = [r.model, r.serialNo].filter(Boolean).join(' · '); r.serialNo = ''; }
  if (kind === 'equipment' || kind === 'accessory') {
    r.type = kind === 'accessory' ? 'Mouse' : normType(r.type || ctx.lastCategory || '', 'Accessory');
    if (kind === 'equipment' && r.type) ctx.lastCategory = r.type;
    if (!r.tag) r.tag = '__AUTO__';
  } else {
    if (/^sim$/i.test(r.make) || /^sim$/i.test(r.tag) || /^sim-?$/i.test(r.tag)) { const s = simList(r.simNumber)[0]; r.type = 'SIM'; r.make = ''; r.tag = s ? 'SIM-' + s : ''; }
    r.type = normType(r.type) || typeFromTag(r.tag) || (kind === 'mobile' ? 'Mobile' : 'Other');
    if (!r.tag && r.hostname && /\d/.test(r.hostname)) r.tag = normTag(r.hostname);
    if (!r.tag && r.type === 'Mobile' && !r.make && simList(r.simNumber).length) { r.type = 'SIM'; r.tag = 'SIM-' + simList(r.simNumber)[0]; }
    if (!r.tag && r.type === 'Monitor' && r.screenTag) r.tag = normTag(r.screenTag);
  }
  if (r.hostname) r.hostname = normTag(r.hostname);
  r.allocatedDate = parseDate(r.allocatedDate);
  r.ram = tidySize(r.ram); r.storage = tidySize(r.storage);
  if (r.condition) r.condition = r.condition.charAt(0).toUpperCase() + r.condition.slice(1).toLowerCase();
  if (r.physical) r.physical = r.physical.charAt(0).toUpperCase() + r.physical.slice(1).toLowerCase();
  if (/^(ok|active|checked|done|check)$/i.test(r.remarks || '')) r.remarks = '';
  if (/lost/i.test(r.remarks || '')) r.status = 'Lost';
  if (r.osLicense) r.osLicense = /not/i.test(r.osLicense) ? 'Not Genuine' : /gen/i.test(r.osLicense) ? 'Genuine' : r.osLicense;
  if (r.domainJoin) r.domainJoin = /^y/i.test(r.domainJoin) || /^pro$/i.test(r.domainJoin) ? 'Yes' : /^(no|home|mac|ubantu|ubuntu)$/i.test(r.domainJoin) ? 'No' : r.domainJoin;
  if (r.empCode) { const e = IX.empCode.get(r.empCode); if (e && !r.holderName) r.holderName = e.name; }
  if (!r.status) r.status = hasHolder(r) ? 'In Use' : 'In Stock';
  return r;
}
function runImport(rows, { forced = '', mode = 'skip', source = 'paste' } = {}) {
  const rep = { added: 0, updated: 0, skipped: 0, errors: 0, sections: [], problems: [] };
  let sec = null; const ctx = { lastCategory: '' };
  const prob = (row, kind, key, msg, type = 'error') => { rep.problems.push({ row, kind, key, msg, type }); if (type === 'error') rep.errors++; else rep.skipped++; };
  rows.forEach((cells, idx) => {
    const rowNo = idx + 1;
    const nonEmpty = cells.filter(Boolean).length;
    if (!nonEmpty) return;
    const h = detectHeader(cells, forced && forced !== 'auto' ? forced : '');
    if (h) { sec = h; rep.sections.push({ kind: h.kind, row: rowNo, count: 0 }); return; }
    if (!sec || nonEmpty < 2) return;
    const cur = rep.sections[rep.sections.length - 1];
    const r = rowToRec(sec, cells);
    if (sec.kind === 'employee') {
      if (!r.name) { if (r.empCode) prob(rowNo, 'Employee', r.empCode, `Name is blank in sheet (email: ${r.email || '—'}) — not imported, add manually`); return; }
      r.name = norm(r.name);
      if (/blocked/i.test(r.designation || '')) r.designation = '';
      if (r.empCode && !validEmpCode(r.empCode)) { r.notes = 'Emp code in sheet: ' + r.empCode; r.empCode = ''; } else r.empCode = normTag(r.empCode);
      r.email = r.email && r.email.includes('@') ? low(r.email) : '';
      r.doj = parseDate(r.doj);
      r.status = /^(TJ00558|TJ00559|TJ00560|TJ00561)$/.test(r.empCode) ? 'Blocked' : (EMP_STATUSES.find(s => low(s) === low(r.status)) || 'Active');
      const ex = (r.empCode && IX.empCode.get(r.empCode)) || (!r.empCode && r.email && IX.empEmail.get(r.email));
      if (ex) {
        if (mode === 'update') { for (const k in r) if (r[k] && !k.startsWith('_')) ex[k] = r[k]; IX.empEmail.set(low(ex.email), ex); rep.updated++; cur.count++; }
        else prob(rowNo, 'Employee', r.empCode || r.email, `Already exists (${ex.name}) — skipped`, 'skip');
        return;
      }
      const { errs } = validateEmployee(r, null);
      if (errs.length) return prob(rowNo, 'Employee', r.empCode || r.name, errs.join(' '));
      const e = { id: uid(), createdAt: new Date().toISOString(), ...Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_'))) };
      db.employees.push(e); indexEmp(e); rep.added++; cur.count++;
    } else if (sec.kind === 'software') {
      const names = String(r.names || '').split(/\r?\n|,(?![^(]*\))/).map(norm).filter(Boolean);
      const lic = LIC_TYPES.find(t => low(r.licenseType).includes(low(t))) || (/crack|pirat/i.test(r.licenseType) ? 'Pirated' : /open|free/i.test(r.licenseType) ? 'Open Source' : 'Paid');
      for (const n of names) {
        const ex = db.software.find(s => normKey(s.name) === normKey(n));
        if (ex) { const deps = new Set(String(ex.departments || '').split(',').map(norm).filter(Boolean)); if (r.departments) deps.add(r.departments); ex.departments = [...deps].join(', '); rep.updated++; }
        else { db.software.push({ id: uid(), name: n, licenseType: lic, departments: r.departments || '', category: '' }); rep.added++; }
        cur.count++;
      }
    } else if (sec.kind === 'ram') {
      r.tag = normTag(r.tag); r.date = parseDate(r.date);
      if (!r.tag && !r.name && !r.email) return;
      if (!r.empCode && r.email) { const e = IX.empEmail.get(low(r.email)); if (e) r.empCode = e.empCode; }
      const m = { id: uid(), type: 'RAM Upgrade', tag: r.tag, empCode: normTag(r.empCode), name: r.name || '', before: r.before || '', added: r.added || '', after: r.after || '', date: r.date, engineer: r.engineer || '', notes: [r.notes, r._ramtype].filter(Boolean).join(' · ') };
      if (db.maint.some(x => x.type === m.type && normTag(x.tag) === m.tag && x.date === m.date && (x.after || '') === m.after && low(x.name) === low(m.name))) return prob(rowNo, 'RAM upgrade', m.tag || m.name, 'Same entry already exists — skipped', 'skip');
      db.maint.push(m); rep.added++; cur.count++;
    } else {
      const a = cleanAsset(r, sec.kind, ctx);
      if (a.tag === '__AUTO__') {
        const sk = serialKey(a.serialNo);
        if (sk && IX.serial.get(sk)) { const ex = IX.serial.get(sk); return prob(rowNo, a.type, a.serialNo, `Serial already exists on ${ex.tag} — skipped`, 'skip'); }
        a.tag = nextTag(a.type);
      }
      if (!a.tag || !/\d/.test(a.tag)) return prob(rowNo, a.type || 'Asset', a.tag || '(blank)', `Asset tag missing/incomplete for "${a.holderName || a.remarks || cells.filter(Boolean).slice(0, 3).join(' ')}"`);
      const ex = IX.tag.get(a.tag);
      if (ex) {
        if (mode === 'update') {
          const oldKey = holderKey(ex); const clean = Object.fromEntries(Object.entries(a).filter(([k, v]) => v && !k.startsWith('_')));
          const { errs } = validateAsset({ ...ex, ...clean }, ex.id); if (errs.length) return prob(rowNo, a.type, a.tag, errs.join(' '));
          Object.assign(ex, clean); if (oldKey !== holderKey(ex)) log(ex.tag, 'Transferred', `import: ${oldKey} → ${holderName(ex)}`, [oldKey, holderKey(ex)]);
          indexAsset(ex); rep.updated++; cur.count++;
        } else prob(rowNo, a.type, a.tag, `Duplicate Asset Tag — ${a.tag} already exists (with ${holderName(ex) || ex.status}). This row: ${a.holderName || '—'}`);
        return;
      }
      // a SIM/IMEI already used elsewhere: keep the device, drop only that number and report it
      const dupSims = simList(a.simNumber).filter(x => IX.sim.get(x));
      if (dupSims.length) {
        const keep = simList(a.simNumber).filter(x => !IX.sim.get(x));
        a.remarks = [a.remarks, `SIM ${dupSims.join('/')} not saved — also listed on ${[...new Set(dupSims.map(x => IX.sim.get(x).tag))].join(', ')}`].filter(Boolean).join(' · ');
        a.simNumber = keep.join(' / ');
        prob(rowNo, a.type, a.tag, `SIM ${dupSims.join('/')} duplicate of ${[...new Set(dupSims.map(x => IX.sim.get(x).tag + ' (' + holderName(IX.sim.get(x)) + ')'))].join(', ')} — device imported WITHOUT that SIM (this row: ${a.holderName || '—'})`, 'skip');
      }
      const { errs } = validateAsset(a, null);
      if (errs.length) return prob(rowNo, a.type, a.tag, errs.join(' ') + (a.holderName ? ` (this row: ${a.holderName})` : ''));
      const na = { id: uid(), createdAt: new Date().toISOString(), ...Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith('_'))) };
      db.assets.push(na); indexAsset(na); rep.added++; cur.count++;
      log(na.tag, 'Imported', hasHolder(na) ? `with ${na.holderName || na.empCode}` : na.status, [holderKey(na)]);
    }
  });
  return rep;
}
function simulate(fn) { const saved = db; db = structuredClone(db); reindex(); try { return fn(); } finally { db = saved; reindex(); } }

PAGES.import = () => {
  const t = ui.importTab;
  $('#main').innerHTML = `<div class="page-head"><div><h1>Import / Export</h1><p class="sub">Bring in your Excel sheets, take backups, export reports.</p></div></div>
  <div class="tabs">${[['paste', '📋 Paste from Excel'], ['file', '📄 Upload Excel / CSV'], ['export', '⬇ Export & Backup'], ['restore', '♻ Restore']].map(([k, l]) => `<div class="tab ${t === k ? 'on' : ''}" data-act="imp-tab" data-v="${k}">${l}</div>`).join('')}</div>
  <div id="imp-body"></div>`;
  const body = $('#imp-body');
  const optsBlock = `<div class="toolbar">
     <label>Data type: <select id="imp-kind"><option value="auto">Auto-detect from headers</option><option value="employee">Employees</option><option value="asset">Assets (laptops / desktops / monitors)</option><option value="mobile">Mobiles & SIMs</option><option value="equipment">Equipment list (no tags)</option><option value="accessory">Mouse / accessory list</option><option value="software">Software list</option><option value="ram">RAM upgrade log</option></select></label>
     <label>If record already exists: <select id="imp-mode"><option value="skip">Report as duplicate & skip</option><option value="update">Update existing with sheet values</option></select></label></div>`;
  if (t === 'paste') {
    body.innerHTML = `<div class="card"><p>In Excel select the sheet <b>including the header row</b> (Ctrl+A), copy (Ctrl+C) and paste here. You can paste several sheets one after another — each header row starts a new section.
      <br><span class="hint">Recommended order: 1) Employees 2) Laptops/Desktops 3) Mobiles 4) Software & RAM log. Password columns are ignored on purpose.</span></p>
      ${optsBlock}<textarea class="paste" id="imp-text" placeholder="Paste Excel rows here…"></textarea>
      <div class="toolbar" style="margin-top:10px"><button class="btn primary" data-act="imp-preview">Check data (preview)</button><span class="hint">Nothing is saved until you click “Import”.</span></div><div id="imp-report"></div></div>`;
  } else if (t === 'file') {
    body.innerHTML = `<div class="card"><p>Choose an <b>.xlsx / .xls / .csv</b> file. Every sheet is read and auto-detected by its header row (Employees, Laptop, Mobile, Software, RAM…). Needs internet once to load the Excel reader.</p>
      ${optsBlock}<input type="file" id="imp-file" accept=".xlsx,.xls,.csv,.tsv,.txt"><div id="imp-report"></div></div>`;
  } else if (t === 'export') {
    body.innerHTML = `<div class="grid cards">
      <div class="card"><h3>💾 Full backup (JSON)</h3><p class="hint">Everything — employees, assets, software, history. Use “Restore” to load it on any PC.</p><button class="btn primary" data-act="backup">Download backup</button></div>
      <div class="card"><h3>📊 Excel workbook</h3><p class="hint">One sheet per asset type + employees, software, maintenance, history.</p><button class="btn" data-act="export-xlsx">Download .xlsx</button></div>
      <div class="card"><h3>CSV files</h3><div class="toolbar"><button class="btn sm" data-act="export-assets">Assets</button><button class="btn sm" data-act="export-emps">Employees</button><button class="btn sm" data-act="export-sw">Software</button><button class="btn sm" data-act="export-maint">Maintenance</button><button class="btn sm" data-act="export-history">History</button></div></div></div>`;
  } else {
    body.innerHTML = `<div class="card"><h3>Restore from backup file</h3><p class="hint">Replaces ALL current data with the backup file.</p><input type="file" id="restore-file" accept=".json"></div>
      <div class="card" style="margin-top:14px"><h3>Daily snapshots (automatic, in this browser)</h3><div id="snaps" class="hint">Loading…</div></div>`;
    IDB.keys().then(keys => {
      const snaps = keys.filter(k => String(k).startsWith('snap-')).sort().reverse();
      $('#snaps').innerHTML = snaps.map(k => `<div class="list-item">${esc(fmtDate(k.slice(5)))} <button class="btn sm" style="margin-left:auto" data-act="restore-snap" data-k="${esc(k)}">Restore this day</button></div>`).join('') || 'No snapshots yet — one is taken automatically each day you open the app.';
    });
  }
}

let pendingImport = null;
function showReport(rep, commit) {
  const sec = rep.sections.map(s => `${s.kind} (row ${s.row}): ${s.count}`).join(' · ');
  const probs = rep.problems;
  $('#imp-report').innerHTML = `<div style="margin-top:14px">
    ${!rep.sections.length ? '<div class="errbox">No header row recognised. Make sure you copied the header row too, or pick the Data type manually.</div>' : ''}
    <div class="stat-row"><div class="stat"><b style="color:var(--ok)">${rep.added}</b>new</div><div class="stat"><b style="color:var(--accent)">${rep.updated}</b>updated</div><div class="stat"><b style="color:var(--warn)">${rep.skipped}</b>skipped (already exist)</div><div class="stat"><b style="color:var(--err)">${rep.errors}</b>errors / duplicates</div></div>
    <div class="hint">Sections found: ${esc(sec || '—')}</div>
    ${commit ? `<div class="okbox" style="margin-top:10px">✔ Imported. ${rep.errors ? 'Rows with errors were NOT imported — fix them in Excel and paste just those rows again (with header), or add them manually.' : ''}</div>` :
      (rep.added + rep.updated ? `<div class="toolbar" style="margin-top:10px"><button class="btn primary" data-act="imp-commit">Import ${rep.added + rep.updated} records</button><span class="hint">Rows with errors will be left out.</span></div>` : '')}
    ${probs.length ? `<h3 style="margin-top:16px">Problems (${probs.length})</h3><div class="table-wrap" style="max-height:420px"><table><thead><tr><th>Row</th><th>Kind</th><th>Key</th><th>Problem</th></tr></thead><tbody>
      ${probs.map(p => `<tr style="cursor:default"><td>${p.row}</td><td>${esc(p.kind)}</td><td class="mono">${esc(p.key)}</td><td style="color:${p.type === 'error' ? 'var(--err)' : 'var(--warn)'}">${esc(p.msg)}</td></tr>`).join('')}</tbody></table></div>
      <button class="btn sm" style="margin-top:8px" data-act="imp-problems-csv">⬇ Download problem list</button>` : ''}</div>`;
  pendingImport && (pendingImport.problems = probs);
}
async function readImportFile(file) {
  const name = file.name.toLowerCase();
  if (/\.(csv|tsv|txt)$/.test(name)) return [{ name: file.name, rows: parseDelimited(await file.text()) }];
  const X = await loadXLSX();
  const wb = X.read(await file.arrayBuffer(), { type: 'array' });
  return wb.SheetNames.map(n => ({ name: n, rows: X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }).map(r => r.map(c => String(c ?? '').trim())) }));
}

PAGES.settings = () => {
  if (!isITAdmin()) {
    $('#main').innerHTML = `
      <div class="card" style="margin:40px auto;max-width:520px;text-align:center;padding:36px 24px;border:1px solid var(--line);">
        <div style="font-size:44px;margin-bottom:12px;">🔒</div>
        <h2 style="margin:0 0 8px;">Access Restricted</h2>
        <p class="muted" style="margin:0 0 18px;font-size:13px;">Settings &amp; configurations are restricted to IT Administrators only.</p>
        <button class="btn primary sm" data-act="nav" data-page="employees">← Go to Employees</button>
      </div>`;
    return;
  }
  const s = db.settings;
  const curLocs = sanitizeLocations(s.locations);
  const curDepts = getDepartments();
  const curComps = getCompanies();
  const curTypes = getAssetTypes();
  const curIT = getITTeam();
  const customEmp = s.customEmpFields || [];
  const customAsset = s.customAssetFields || [];
  const pendingEmails = (db.onboarding || []).filter(r => r.status === 'Pending' || r.status === 'In Progress').length;
  const pirated = (db.software || []).filter(s => s.licenseType === 'Pirated');
  const issues = computeIssues();
  const critIssues = issues.filter(i => i.sev === 'err');
  const lb = db.settings.lastBackup;
  const recent = (db.history || []).slice(0, 15);

  const selectedPermRole = ui.selectedPermRole || 'hr';
  const rolePerm = getRolePerms(selectedPermRole);
  const isSelectedAdmin = selectedPermRole === 'it_admin';

  const userOverrides = db.settings.userRoleOverrides || {};
  const allKnownEmails = uniqSorted([
    ...Object.keys(userOverrides),
    ...(db.settings.knownUsers || []),
    currentUser ? currentUser.email : ''
  ].filter(Boolean));

  const isOpen = id => (ui.openSettingsPanels && ui.openSettingsPanels.has(id)) ? 'open' : '';

  $('#main').innerHTML = `
  <div class="settings-acc-bar">
    <div>
      <h2 style="margin:0 0 4px;font-size:18px;">⚙️ System Settings &amp; Configuration</h2>
      <span class="hint">Sabhi settings cards collapsible hain. Kisi bhi heading par click karke card open ya close karein.</span>
    </div>
    <div class="settings-acc-actions">
      <button class="btn sm" data-act="expand-all-settings" title="Open all settings cards">▾ Expand All</button>
      <button class="btn sm" data-act="collapse-all-settings" title="Close all settings cards">▸ Collapse All</button>
    </div>
  </div>

  <!-- Accordion 1: System Alerts -->
  <details class="settings-accordion" data-panel="alerts" ${isOpen('alerts')}>
    <summary class="settings-accordion-header">
      <div class="settings-acc-title">
        <span class="settings-acc-icon">⚠️</span>
        <div class="settings-acc-text">
          <h3>System Health &amp; Active Alerts</h3>
          <span class="sub">Pending joiner email requests, unlicensed software, and critical data issues</span>
        </div>
      </div>
      <div class="settings-acc-meta">
        ${(pendingEmails || pirated.length || critIssues.length) ? `<span class="badge b-err" style="font-size:11px;font-weight:600;">${(pendingEmails ? 1 : 0) + (pirated.length ? 1 : 0) + critIssues.length} alert(s)</span>` : `<span class="badge b-ok" style="font-size:11px;font-weight:600;">All Clear</span>`}
        <span class="settings-acc-chevron">▼</span>
      </div>
    </summary>
    <div class="settings-accordion-body">
      <p class="hint" style="margin:0 0 12px;font-size:12px;">Items requiring IT action or attention:</p>
      <div>
        ${pendingEmails ? `<div class="list-item" data-act="nav" data-page="onboarding">${badge('Email Task', 'b-warn')} <b>${pendingEmails}</b> new joiner email request(s) awaiting IT action</div>` : ''}
        ${pirated.length ? `<div class="list-item" data-act="nav" data-page="software" data-f='{"lic":"Pirated"}'>${badge('Licence', 'b-err')} <b>${pirated.length}</b> pirated / unlicensed software in use</div>` : ''}
        ${critIssues.slice(0, 6).map(i => `<div class="list-item" data-act="${i.act}" data-id="${i.id}">${badge(i.cat.split(' ')[0], 'b-err')} ${esc(i.text)}</div>`).join('')}
        ${!pirated.length && !pendingEmails && !critIssues.length ? '<div class="muted" style="padding:16px 0;text-align:center;">No critical alerts 🎉 Everything is in order.</div>' : ''}
      </div>
      <div class="list-item" data-act="nav" data-page="issues" style="margin-top:12px;border-bottom:none;padding-bottom:0;"><a style="font-weight:600;color:var(--accent);">See all data issues →</a></div>
    </div>
  </details>

  <!-- Accordion 2: Recent Activity -->
  <details class="settings-accordion" data-panel="activity" ${isOpen('activity')}>
    <summary class="settings-accordion-header">
      <div class="settings-acc-title">
        <span class="settings-acc-icon">🕘</span>
        <div class="settings-acc-text">
          <h3>Recent Activity &amp; Audit Trail</h3>
          <span class="sub">Latest actions performed in portal across employees, assets, and software</span>
        </div>
      </div>
      <div class="settings-acc-meta">
        <span class="badge b-acc" style="font-size:11px;font-weight:600;">Last ${recent.length}</span>
        <span class="settings-acc-chevron">▼</span>
      </div>
    </summary>
    <div class="settings-accordion-body">
      <p class="hint" style="margin:0 0 10px;font-size:12px;">Recent audit log of changes &amp; actions:</p>
      <div style="max-height:280px;overflow-y:auto;padding-right:4px;">
        ${recent.length ? recent.map(h => `
          <div class="list-item" data-act="open-tag" data-tag="${esc(h.tag || '')}" style="align-items:flex-start;">
            <div style="font-weight:600;min-width:110px;max-width:140px;line-height:1.25;font-size:12px;">${esc(h.action)}</div>
            <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;line-height:1.25;font-size:12px;color:var(--text);">${esc(h.tag ? h.tag + ' ' : '')}${esc(h.detail || '')}</div>
            <div class="when" style="font-size:11px;">${ago(h.ts)}</div>
          </div>
        `).join('') : '<div class="muted" style="padding:16px 0;text-align:center;">No recent activity recorded.</div>'}
      </div>
      <div class="list-item" data-act="nav" data-page="history" style="margin-top:10px;border-bottom:none;padding-bottom:0;"><a style="font-weight:600;color:var(--accent);">View full audit log →</a></div>
    </div>
  </details>

  <!-- Accordion 3: User Roles & Permissions -->
  <details class="settings-accordion" data-panel="roles" ${isOpen('roles')}>
    <summary class="settings-accordion-header">
      <div class="settings-acc-title">
        <span class="settings-acc-icon">🔐</span>
        <div class="settings-acc-text">
          <h3>User Roles &amp; Permissions Manager</h3>
          <span class="sub">Control what each role (HR Team, Viewer, Finance) or specific user can see and do in the portal</span>
        </div>
      </div>
      <div class="settings-acc-meta">
        <span class="badge b-acc" style="font-size:11px;font-weight:600;">${allKnownEmails.length} User(s)</span>
        <span class="settings-acc-chevron">▼</span>
      </div>
    </summary>
    <div class="settings-accordion-body">
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; margin-bottom: 8px;">
        <!-- Card A: User Role Assignment (Expanded Full-Width) -->
        <div class="card" style="grid-column: 1 / -1; display: flex; flex-direction: column; margin-bottom: 16px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:12px;">
            <div>
              <h4 style="margin:0;font-size:15px;display:flex;align-items:center;gap:8px;">
                <span>👥 Assigned User Roles &amp; Access Management</span>
              </h4>
              <p class="hint" style="margin:3px 0 0;font-size:12.5px;">Authorized company users jinhe portal access diya gaya hai (Invite-Only System):</p>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="badge b-acc" style="font-size:12px;padding:4px 10px;font-weight:600;">${allKnownEmails.length} Authorized User(s)</span>
              <button class="btn primary" data-act="open-invite-user-modal" style="font-weight:600;padding:6px 14px;font-size:13px;display:inline-flex;align-items:center;gap:6px;">
                ✉️ + Invite New User (Email + WhatsApp)
              </button>
            </div>
          </div>
          
          <div style="margin-bottom:16px;background:var(--panel2);padding:14px 16px;border-radius:10px;border:1px solid var(--line);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
              <span style="font-size:12.5px;font-weight:700;color:var(--text);display:inline-flex;align-items:center;gap:6px;">
                <span>⚡ Quick User Provisioning &amp; Dual Invite (Email + WhatsApp):</span>
              </span>
              <span id="assign-role-hint-badge" style="font-size:12px;color:var(--muted);">
                ${getRoleHintText('employee')}
              </span>
            </div>

            <div class="inline" style="gap:10px;align-items:center;flex-wrap:wrap;">
              <div style="flex:1.8;min-width:240px;">
                <input id="assign-role-email" list="dl_quick_assign_emps" placeholder="Work Email (e.g. user@tractorjunction.com)" style="width:100%;font-size:13px;padding:9px 12px;" autocomplete="off">
                <datalist id="dl_quick_assign_emps">
                  ${(db.employees || []).slice(0, 300).map(e => `<option value="${esc(e.email || '')}">${esc(e.emp_id ? e.emp_id + ' - ' : '')}${esc(e.name || '')} (${esc(e.contact || e.phone || '')})</option>`).join('')}
                </datalist>
              </div>

              <div style="flex:1.4;min-width:190px;">
                <input id="assign-role-phone" type="tel" placeholder="Mobile / WhatsApp No. (e.g. 9876543210)" style="width:100%;font-size:13px;padding:9px 12px;">
              </div>

              <div style="flex:1.2;min-width:180px;">
                <select id="assign-role-select" style="width:100%;font-size:13px;padding:9px 10px;font-weight:600;">
                  <option value="employee">👤 Employee (Helpdesk Only)</option>
                  <option value="hr">👤 HR Team (Employees &amp; Onboarding)</option>
                  <option value="it_admin">👑 IT Admin (Full System Access)</option>
                  <option value="viewer">👁️ Read-Only Viewer</option>
                  <option value="finance">💼 Finance / Auditor</option>
                </select>
              </div>

              <button class="btn primary" data-act="save-user-role-btn" style="padding:9px 20px;font-size:13px;font-weight:700;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;">
                ✉️ + Assign &amp; Send Invite
              </button>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:8px;max-height:480px;overflow-y:auto;padding-right:4px;">
            ${allKnownEmails.length ? allKnownEmails.map(em => {
              const r = userOverrides[em] || (em.includes('hr') ? 'hr' : 'it_admin');
              const rMeta = DEFAULT_ROLE_PERMS[r] || { name: r, icon: '👤', badgeCls: 'role-hr' };
              const isMe = currentUser && currentUser.email && low(currentUser.email) === low(em);
              const emp = (db.employees || []).find(e => (e.email || '').toLowerCase() === low(em));
              const userPhone = (db.settings.userPhones && db.settings.userPhones[em]) || (emp ? (emp.contact || emp.phone || '') : '');
              
              return `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--panel2);border-radius:8px;border:1px solid var(--line);font-size:13px;gap:12px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:12px;flex:1.5;min-width:280px;">
                  <span class="user-role-badge ${rMeta.badgeCls}" style="font-size:11px;padding:4px 10px;white-space:nowrap;letter-spacing:0.04em;">${rMeta.icon} ${esc(rMeta.name)}</span>
                  <div style="display:flex;flex-direction:column;gap:2px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                      <span style="font-weight:700;color:var(--text);font-size:13px;">${esc(em)}</span>
                      ${isMe ? '<span class="badge b-ok" style="font-size:10px;font-weight:700;">You (Super Admin)</span>' : ''}
                    </div>
                    ${emp || userPhone ? `<span style="font-size:11.5px;color:var(--muted);">${emp ? esc(emp.name) : ''}${emp && emp.department ? ' · ' + esc(emp.department) : ''}${userPhone ? ' · 📱 ' + esc(userPhone) : ''}</span>` : ''}
                  </div>
                </div>

                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                  <div style="display:flex;align-items:center;gap:6px;">
                    <span style="font-size:11.5px;color:var(--muted);font-weight:600;">Role:</span>
                    <select class="user-role-quick-change" data-email="${esc(em)}" style="font-size:12px;padding:4px 10px;font-weight:600;min-width:140px;">
                      <option value="employee" ${r === 'employee' ? 'selected' : ''}>👤 Employee</option>
                      <option value="hr" ${r === 'hr' ? 'selected' : ''}>👤 HR Team</option>
                      <option value="it_admin" ${r === 'it_admin' ? 'selected' : ''}>👑 IT Admin</option>
                      <option value="viewer" ${r === 'viewer' ? 'selected' : ''}>👁️ Viewer</option>
                      <option value="finance" ${r === 'finance' ? 'selected' : ''}>💼 Finance</option>
                    </select>
                  </div>
                  
                  <button class="btn sm" data-act="send-invite-user" data-email="${esc(em)}" title="Send WhatsApp &amp; Email Invite with login link" style="padding:4px 12px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;">
                    ✉️ Invite / Share
                  </button>

                  ${userOverrides[em] && !isMe ? `
                    <button class="btn sm danger" data-act="del-user-role" data-email="${esc(em)}" title="Remove custom role override" style="padding:4px 10px;font-size:12px;">
                      ✕ Remove
                    </button>
                  ` : ''}
                </div>
              </div>`;
            }).join('') : '<span class="muted" style="font-size:13px;padding:16px;text-align:center;">No registered users yet. Type an email above to pre-assign a role.</span>'}
          </div>
        </div>

        <!-- Card B: Role Permissions Matrix -->
        <div class="card" style="grid-column: 1 / -1;margin-bottom:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
            <div>
              <h4 style="margin:0;font-size:14px;">🛡️ Role Permissions Matrix</h4>
              <p class="hint" style="margin:2px 0 0;font-size:12px;">Role choose karein aur uske liye allowed pages aur operational rights customize karein:</p>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <span style="font-size:12px;color:var(--muted);font-weight:600;">Customizing Role:</span>
              <select id="perm-role-select" style="font-weight:600;font-size:12px;padding:4px 10px;">
                <option value="employee" ${selectedPermRole === 'employee' ? 'selected' : ''}>👤 Employee (Self-Service)</option>
                <option value="hr" ${selectedPermRole === 'hr' ? 'selected' : ''}>👤 HR Team</option>
                <option value="viewer" ${selectedPermRole === 'viewer' ? 'selected' : ''}>👁️ Read-Only Viewer</option>
                <option value="finance" ${selectedPermRole === 'finance' ? 'selected' : ''}>💼 Finance / Auditor</option>
                <option value="it_admin" ${selectedPermRole === 'it_admin' ? 'selected' : ''}>👑 IT Admin (Full Access)</option>
              </select>
              <button class="btn sm" data-act="reset-role-perms" data-role="${esc(selectedPermRole)}" title="Reset this role to default permissions">↺ Reset Defaults</button>
            </div>
          </div>

          ${isSelectedAdmin ? `
            <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);padding:12px 14px;border-radius:8px;margin-bottom:12px;font-size:12px;color:#86efac;">
              👑 <b>IT Admin Role</b> ke paas system ke sabhi modules, settings, aur operational rights ka full access rehta hai taaki admin kabhi lock out na ho sake.
            </div>
          ` : ''}

          <form id="perm-matrix-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;background:var(--panel2);padding:16px;border-radius:8px;border:1px solid var(--line);">
            <!-- Column 1: Allowed Pages -->
            <div>
              <h4 style="margin:0 0 10px;font-size:13px;color:var(--text);border-bottom:1px solid var(--line);padding-bottom:6px;display:flex;align-items:center;justify-content:space-between;">
                <span>📑 Visible Pages in Navbar</span>
                <span style="font-size:11px;color:var(--muted)">${(rolePerm.pages || []).length} / ${ALL_PAGES_META.length} Active</span>
              </h4>
              <div style="display:flex;flex-direction:column;gap:8px;">
                ${ALL_PAGES_META.map(p => {
                  const checked = isSelectedAdmin || (rolePerm.pages && rolePerm.pages.includes(p.k));
                  return `<label class="perm-item">
                    <input type="checkbox" name="page_${p.k}" ${checked ? 'checked' : ''} ${isSelectedAdmin ? 'disabled' : ''}>
                    <div>
                      <span class="p-title">${p.l}</span>
                      <span class="p-desc">${p.desc}</span>
                    </div>
                  </label>`;
                }).join('')}
              </div>
            </div>

            <!-- Column 2: Operational Rights -->
            <div>
              <h4 style="margin:0 0 10px;font-size:13px;color:var(--text);border-bottom:1px solid var(--line);padding-bottom:6px;display:flex;align-items:center;justify-content:space-between;">
                <span>⚡ Operational Capabilities &amp; Rights</span>
                <span style="font-size:11px;color:var(--muted)">Action Level</span>
              </h4>
              <div style="display:flex;flex-direction:column;gap:8px;">
                ${ALL_ACTIONS_META.map(a => {
                  const checked = isSelectedAdmin || (rolePerm.actions && rolePerm.actions[a.k]);
                  return `<label class="perm-item">
                    <input type="checkbox" name="act_${a.k}" ${checked ? 'checked' : ''} ${isSelectedAdmin ? 'disabled' : ''}>
                    <div>
                      <span class="p-title">${a.l}</span>
                      <span class="p-desc">${a.desc}</span>
                    </div>
                  </label>`;
                }).join('')}
              </div>
            </div>
          </form>

          ${!isSelectedAdmin ? `
          <div style="margin-top:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <span class="hint" style="font-size:12px;">Changes save karte hi ${DEFAULT_ROLE_PERMS[selectedPermRole]?.name || selectedPermRole} users par turant live apply ho jayenge.</span>
            <button class="btn primary" data-act="save-role-perms-btn" data-role="${esc(selectedPermRole)}">💾 Save ${DEFAULT_ROLE_PERMS[selectedPermRole]?.name || selectedPermRole} Permissions</button>
          </div>` : ''}
        </div>
      </div>
    </div>
  </details>

  <!-- Accordion 4: IT Team Members -->
  <details class="settings-accordion" data-panel="it_team" ${isOpen('it_team')}>
    <summary class="settings-accordion-header">
      <div class="settings-acc-title">
        <span class="settings-acc-icon">🛠️</span>
        <div class="settings-acc-text">
          <h3>IT Team Members (Email Assignees)</h3>
          <span class="sub">IT personnel who receive onboarding email creation requests with manager tags</span>
        </div>
      </div>
      <div class="settings-acc-meta">
        <span class="badge b-acc" style="font-size:11px;font-weight:600;">${curIT.length} Members</span>
        <span class="settings-acc-chevron">▼</span>
      </div>
    </summary>
    <div class="settings-accordion-body">
      <p class="hint" style="margin:0 0 10px;font-size:12px;">HR new joiner email request inme se tag karegi (IT Person dropdown me dikhenge):</p>
      
      <!-- Option A: Quick Add by typing -->
      <div class="inline" style="margin-bottom:8px;">
        <input id="new-it-in" placeholder="Type new IT person name..." style="flex:1;">
        <button class="btn primary sm" data-act="add-it-btn">+ Add Member</button>
      </div>

      <!-- Option B: Quick Add from Employee Master (New Joiner in IT) -->
      <div class="inline" style="margin-bottom:12px;background:var(--panel2);padding:8px 10px;border-radius:6px;border:1px solid var(--line);">
        <span style="font-size:12px;color:var(--muted);white-space:nowrap;">👥 From Employees:</span>
        <select id="select-emp-it" style="flex:1;font-size:12px;">
          <option value="">-- Select employee who joined IT --</option>
          ${db.employees.filter(e => !curIT.some(t => low(t).includes(low(e.name)))).map(e => `<option value="${esc(e.name)}">${esc(e.name)} (${esc(e.department || 'No Dept')} - ${esc(e.empCode || '')})</option>`).join('')}
        </select>
        <button class="btn sm" data-act="add-it-from-emp">+ Add to IT</button>
      </div>

      <!-- Chips list with Manager crown -->
      <div class="chip-cloud" id="it-chips">
        ${curIT.map(t => {
          const isMgr = /manager/i.test(t);
          return `<span class="chip" style="cursor:default;display:inline-flex;align-items:center;gap:6px;${isMgr ? 'border-color:var(--accent);background:var(--accent-soft);font-weight:600;' : ''}">
            ${isMgr ? '👑' : '👤'} ${esc(t)} 
            <button type="button" class="del-it-btn" data-act="del-it-member" data-val="${esc(t)}" title="Remove IT member" style="border:none;background:transparent;cursor:pointer;color:var(--muted);font-weight:bold;padding:0 3px;">✕</button>
          </span>`;
        }).join('')}
      </div>

      <details style="margin-top:10px;font-size:12px">
        <summary style="cursor:pointer;color:var(--muted);margin-bottom:6px">Bulk edit / Paste list</summary>
        <div class="form-grid" id="it-form">
          <label class="full"><textarea name="itTeam" rows="5">${esc(curIT.join('\n'))}</textarea></label>
        </div>
        <div class="toolbar" style="margin-top:6px">
          <button class="btn sm primary" data-act="save-it-team">Save list</button>
          <button class="btn sm" data-act="reset-it-team">Reset to Default Team</button>
        </div>
      </details>
    </div>
  </details>

  <!-- Accordion 5: Locations -->
  <details class="settings-accordion" data-panel="locations" ${isOpen('locations')}>
    <summary class="settings-accordion-header">
      <div class="settings-acc-title">
        <span class="settings-acc-icon">📍</span>
        <div class="settings-acc-text">
          <h3>Locations &amp; Branches</h3>
          <span class="sub">Offices, warehouses, and remote branch locations for employees and assets</span>
        </div>
      </div>
      <div class="settings-acc-meta">
        <span class="badge b-acc" style="font-size:11px;font-weight:600;">${curLocs.length}</span>
        <span class="settings-acc-chevron">▼</span>
      </div>
    </summary>
    <div class="settings-accordion-body">
      <p class="hint" style="margin:0 0 10px;font-size:12px;">Employee aur Asset forms ke locations:</p>
      <div class="inline" style="margin-bottom:10px;">
        <input id="new-loc-in" placeholder="New location name..." style="flex:1;">
        <button class="btn primary sm" data-act="add-loc-btn">+ Add</button>
      </div>
      <div class="chip-cloud" id="loc-chips">
        ${curLocs.map(l => `<span class="chip" style="cursor:default;display:inline-flex;align-items:center;gap:6px;">📍 ${esc(l)} <button type="button" class="del-loc-btn" data-act="del-location" data-val="${esc(l)}" title="Remove location" style="border:none;background:transparent;cursor:pointer;color:var(--muted);font-weight:bold;padding:0 3px;">✕</button></span>`).join('')}
      </div>
      <details style="margin-top:10px;font-size:12px">
        <summary style="cursor:pointer;color:var(--muted);margin-bottom:6px">Bulk edit / Paste list</summary>
        <div class="form-grid" id="location-form">
          <label class="full"><textarea name="locations" rows="5" placeholder="Noida Sec-9&#10;Noida Sec-4&#10;Alwar&#10;Jaipur&#10;Nawabganj">${esc(curLocs.join('\n'))}</textarea></label>
        </div>
        <div class="toolbar" style="margin-top:6px">
          <button class="btn sm primary" data-act="save-locations">Save list</button>
          <button class="btn sm" data-act="reset-locations">Reset</button>
        </div>
      </details>
    </div>
  </details>

  <!-- Accordion 6: Departments -->
  <details class="settings-accordion" data-panel="depts" ${isOpen('depts')}>
    <summary class="settings-accordion-header">
      <div class="settings-acc-title">
        <span class="settings-acc-icon">🏢</span>
        <div class="settings-acc-text">
          <h3>Departments</h3>
          <span class="sub">Company organizational departments (IT, HR, Operations, Finance, etc.)</span>
        </div>
      </div>
      <div class="settings-acc-meta">
        <span class="badge b-acc" style="font-size:11px;font-weight:600;">${curDepts.length}</span>
        <span class="settings-acc-chevron">▼</span>
      </div>
    </summary>
    <div class="settings-accordion-body">
      <p class="hint" style="margin:0 0 10px;font-size:12px;">Employee &amp; Asset departments:</p>
      <div class="inline" style="margin-bottom:10px;">
        <input id="new-dept-in" placeholder="New department..." style="flex:1;">
        <button class="btn primary sm" data-act="add-dept-btn">+ Add</button>
      </div>
      <div class="chip-cloud" id="dept-chips">
        ${curDepts.map(d => `<span class="chip" style="cursor:default;display:inline-flex;align-items:center;gap:6px;">🏢 ${esc(d)} <button type="button" class="del-dept-btn" data-act="del-dept" data-val="${esc(d)}" title="Remove department" style="border:none;background:transparent;cursor:pointer;color:var(--muted);font-weight:bold;padding:0 3px;">✕</button></span>`).join('')}
      </div>
      <details style="margin-top:10px;font-size:12px">
        <summary style="cursor:pointer;color:var(--muted);margin-bottom:6px">Bulk edit / Paste list</summary>
        <div class="form-grid" id="dept-form">
          <label class="full"><textarea name="departments" rows="5">${esc(curDepts.join('\n'))}</textarea></label>
        </div>
        <div class="toolbar" style="margin-top:6px">
          <button class="btn sm primary" data-act="save-departments">Save list</button>
          <button class="btn sm" data-act="reset-departments">Reset</button>
        </div>
      </details>
    </div>
  </details>

  <!-- Accordion 7: Companies / Payroll -->
  <details class="settings-accordion" data-panel="companies" ${isOpen('companies')}>
    <summary class="settings-accordion-header">
      <div class="settings-acc-title">
        <span class="settings-acc-icon">🏛️</span>
        <div class="settings-acc-text">
          <h3>Companies / Payroll Entities</h3>
          <span class="sub">Legal companies and business entities for payroll and ownership</span>
        </div>
      </div>
      <div class="settings-acc-meta">
        <span class="badge b-acc" style="font-size:11px;font-weight:600;">${curComps.length}</span>
        <span class="settings-acc-chevron">▼</span>
      </div>
    </summary>
    <div class="settings-accordion-body">
      <p class="hint" style="margin:0 0 10px;font-size:12px;">Payroll / Company legal entities:</p>
      <div class="inline" style="margin-bottom:10px;">
        <input id="new-comp-in" placeholder="New company name..." style="flex:1;">
        <button class="btn primary sm" data-act="add-comp-btn">+ Add</button>
      </div>
      <div class="chip-cloud" id="comp-chips">
        ${curComps.map(c => `<span class="chip" style="cursor:default;display:inline-flex;align-items:center;gap:6px;">🏛️ ${esc(c)} <button type="button" class="del-comp-btn" data-act="del-comp" data-val="${esc(c)}" title="Remove company" style="border:none;background:transparent;cursor:pointer;color:var(--muted);font-weight:bold;padding:0 3px;">✕</button></span>`).join('')}
      </div>
      <details style="margin-top:10px;font-size:12px">
        <summary style="cursor:pointer;color:var(--muted);margin-bottom:6px">Bulk edit / Paste list</summary>
        <div class="form-grid" id="comp-form">
          <label class="full"><textarea name="companies" rows="5">${esc(curComps.join('\n'))}</textarea></label>
        </div>
        <div class="toolbar" style="margin-top:6px">
          <button class="btn sm primary" data-act="save-companies">Save list</button>
          <button class="btn sm" data-act="reset-companies">Reset</button>
        </div>
      </details>
    </div>
  </details>

  <!-- Accordion 8: Asset Types -->
  <details class="settings-accordion" data-panel="types" ${isOpen('types')}>
    <summary class="settings-accordion-header">
      <div class="settings-acc-title">
        <span class="settings-acc-icon">💻</span>
        <div class="settings-acc-text">
          <h3>Asset Hardware Types</h3>
          <span class="sub">Hardware device classifications (Laptop, Mobile, Desktop, Monitor, etc.)</span>
        </div>
      </div>
      <div class="settings-acc-meta">
        <span class="badge b-acc" style="font-size:11px;font-weight:600;">${curTypes.length}</span>
        <span class="settings-acc-chevron">▼</span>
      </div>
    </summary>
    <div class="settings-accordion-body">
      <p class="hint" style="margin:0 0 10px;font-size:12px;">Device types (Laptop, Mobile, Desktop, etc.):</p>
      <div class="inline" style="margin-bottom:10px;">
        <input id="new-type-in" placeholder="New asset type..." style="flex:1;">
        <button class="btn primary sm" data-act="add-type-btn">+ Add</button>
      </div>
      <div class="chip-cloud" id="type-chips">
        ${curTypes.map(t => `<span class="chip" style="cursor:default;display:inline-flex;align-items:center;gap:6px;">${TYPE_ICON[t] || '📦'} ${esc(t)} <button type="button" class="del-type-btn" data-act="del-type" data-val="${esc(t)}" title="Remove asset type" style="border:none;background:transparent;cursor:pointer;color:var(--muted);font-weight:bold;padding:0 3px;">✕</button></span>`).join('')}
      </div>
      <details style="margin-top:10px;font-size:12px">
        <summary style="cursor:pointer;color:var(--muted);margin-bottom:6px">Bulk edit / Paste list</summary>
        <div class="form-grid" id="type-form">
          <label class="full"><textarea name="types" rows="5">${esc(curTypes.join('\n'))}</textarea></label>
        </div>
        <div class="toolbar" style="margin-top:6px">
          <button class="btn sm primary" data-act="save-types">Save list</button>
          <button class="btn sm" data-act="reset-types">Reset</button>
        </div>
      </details>
    </div>
  </details>

  <!-- Accordion 9: Custom Extra Fields -->
  <details class="settings-accordion" data-panel="custom_fields" ${isOpen('custom_fields')}>
    <summary class="settings-accordion-header">
      <div class="settings-acc-title">
        <span class="settings-acc-icon">➕</span>
        <div class="settings-acc-text">
          <h3>Custom Extra Fields</h3>
          <span class="sub">Add extra custom fields to Employee and Asset forms</span>
        </div>
      </div>
      <div class="settings-acc-meta">
        <span class="badge b-acc" style="font-size:11px;font-weight:600;">${customEmp.length + customAsset.length} Field(s)</span>
        <span class="settings-acc-chevron">▼</span>
      </div>
    </summary>
    <div class="settings-accordion-body">
      <p class="hint" style="margin:0 0 10px;">Agar aapko Employee ya Asset me koi naya field (jaise Blood Group, Floor No, MAC Address, Charger Serial etc.) add karna ho, to yahan se add karein:</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:12px;align-items:end;background:var(--panel2, rgba(255,255,255,0.03));padding:14px;border-radius:8px;border:1px solid var(--line);">
        <div>
          <label style="font-size:12px;display:block;margin-bottom:4px;color:var(--muted);font-weight:600;">Apply To:</label>
          <select id="cf-target" style="width:100%">
            <option value="employee">👤 Employee (Add Employee form)</option>
            <option value="asset">💻 Asset (Add Asset form)</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;display:block;margin-bottom:4px;color:var(--muted);font-weight:600;">Field Name / Label:</label>
          <input id="cf-label" placeholder="e.g. Blood Group, MAC Address" style="width:100%">
        </div>
        <div>
          <label style="font-size:12px;display:block;margin-bottom:4px;color:var(--muted);font-weight:600;">Field Type:</label>
          <select id="cf-type" style="width:100%">
            <option value="text">Text Box</option>
            <option value="select">Dropdown (Select List)</option>
            <option value="date">Date Picker</option>
            <option value="number">Number</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;display:block;margin-bottom:4px;color:var(--muted);font-weight:600;">Options (if Dropdown, comma separated):</label>
          <input id="cf-opts" placeholder="e.g. A+, B+, O+, AB+" style="width:100%">
        </div>
        <div>
          <button class="btn primary" data-act="add-custom-field-btn" style="width:100%;min-height:38px;">+ Add Custom Field</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:16px;">
        <div style="background:var(--panel2, rgba(255,255,255,0.02));padding:12px;border-radius:8px;border:1px solid var(--line);">
          <div style="margin-bottom:8px;font-size:13px;"><b>👤 Employee Extra Fields (${customEmp.length}):</b></div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${customEmp.length ? customEmp.map(f => `<span class="chip" style="cursor:default;display:inline-flex;align-items:center;gap:6px;">👤 ${esc(f.l)} <span class="muted mono">(${esc(f.t)})</span> <button type="button" data-act="del-custom-field" data-target="employee" data-key="${esc(f.k)}" title="Delete field" style="border:none;background:transparent;cursor:pointer;color:var(--muted);font-weight:bold;padding:0 3px;">✕</button></span>`).join('') : '<span class="muted" style="font-size:12px">No extra employee fields yet.</span>'}
          </div>
        </div>
        <div style="background:var(--panel2, rgba(255,255,255,0.02));padding:12px;border-radius:8px;border:1px solid var(--line);">
          <div style="margin-bottom:8px;font-size:13px;"><b>💻 Asset Extra Fields (${customAsset.length}):</b></div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${customAsset.length ? customAsset.map(f => `<span class="chip" style="cursor:default;display:inline-flex;align-items:center;gap:6px;">💻 ${esc(f.l)} <span class="muted mono">(${esc(f.t)})</span> <button type="button" data-act="del-custom-field" data-target="asset" data-key="${esc(f.k)}" title="Delete field" style="border:none;background:transparent;cursor:pointer;color:var(--muted);font-weight:bold;padding:0 3px;">✕</button></span>`).join('') : '<span class="muted" style="font-size:12px">No extra asset fields yet.</span>'}
          </div>
        </div>
      </div>
    </div>
  </details>

  <!-- Accordion 10: Company Branding -->
  <details class="settings-accordion" data-panel="branding" ${isOpen('branding')}>
    <summary class="settings-accordion-header">
      <div class="settings-acc-title">
        <span class="settings-acc-icon">🏢</span>
        <div class="settings-acc-text">
          <h3>Company Branding &amp; Details</h3>
          <span class="sub">Company logo, organization name, subtitle, and recorded IT engineer name</span>
        </div>
      </div>
      <div class="settings-acc-meta">
        <span class="badge b-acc" style="font-size:11px;font-weight:600;">${esc(s.org || 'Branding')}</span>
        <span class="settings-acc-chevron">▼</span>
      </div>
    </summary>
    <div class="settings-accordion-body">
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;">
        <!-- Logo Uploader Box -->
        <div style="flex:0 0 240px;background:var(--panel2, rgba(0,0,0,0.02));border:1px dashed var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;align-items:center;text-align:center;">
          <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;">Company Logo</div>
          <div id="logo-preview-box" style="width:72px;height:72px;border-radius:14px;background:var(--side-active,#2563eb);color:#fff;display:grid;place-items:center;font-weight:700;font-size:24px;overflow:hidden;box-shadow:0 3px 10px rgba(0,0,0,.15);margin-bottom:12px;">
            ${s.logo ? `<img src="${esc(s.logo)}" style="width:100%;height:100%;object-fit:contain" alt="Logo">` : esc(initials(s.org || 'IT'))}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:6px;">
            <label class="btn sm primary" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
              📁 Upload Logo <input type="file" id="logo-file-input" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" style="display:none">
            </label>
            ${s.logo ? `<button type="button" class="btn sm" data-act="remove-logo" style="color:var(--err,#dc2626)">✕ Remove</button>` : ''}
          </div>
          <small class="muted" style="font-size:11px;">Recommended: PNG / SVG with transparent background.</small>
        </div>

        <!-- Form Inputs -->
        <div style="flex:1;min-width:280px;">
          <div class="form-grid" id="set-form">
            <label class="full"><span>Company / Organisation Name</span><input name="org" value="${esc(s.org || '')}" placeholder="e.g. Farm junction Marketing Pvt Ltd."></label>
            <label class="full"><span>Tagline / Subtitle (sidebar)</span><input name="sub" value="${esc(s.sub !== undefined ? s.sub : 'Assets · Employees · Software')}" placeholder="e.g. Assets · Employees · Software"></label>
            <label class="full"><span>Your Name (IT Engineer — recorded in history)</span><input name="engineer" value="${esc(s.engineer || '')}" list="dl_engineer" placeholder="e.g. Mo Vaseem"></label>
          </div>
          <div class="toolbar" style="margin-top:14px">
            <button class="btn primary" data-act="save-settings">💾 Save Branding</button>
          </div>
        </div>
      </div>
    </div>
  </details>

  <!-- Accordion 11: Storage, Cloud Backup & Live Sync -->
  <details class="settings-accordion" data-panel="storage_cloud" ${isOpen('storage_cloud')}>
    <summary class="settings-accordion-header">
      <div class="settings-acc-title">
        <span class="settings-acc-icon">💾</span>
        <div class="settings-acc-text">
          <h3>Storage, Cloud Backup &amp; Live Sync</h3>
          <span class="sub">Local file auto-save, Supabase cloud sync status, and database metrics</span>
        </div>
      </div>
      <div class="settings-acc-meta">
        <span class="badge ${sbOnline ? 'b-ok' : 'b-warn'}" style="font-size:11px;font-weight:600;">${sbOnline ? 'Cloud Synced' : 'Offline'}</span>
        <span class="settings-acc-chevron">▼</span>
      </div>
    </summary>
    <div class="settings-accordion-body">
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px;">
        <div class="card" style="margin-bottom:0;">
          <h4 style="margin:0 0 6px;font-size:14px;">💾 Auto-save to a file</h4>
          <p class="hint">Link a JSON file (e.g. inside OneDrive) or download backups. Every change is preserved safely.</p>
          <div class="list-item">Browser Support: <b>${fsOK() ? '🟢 Chrome/Edge (Live file-write)' : 'ℹ️ Standard Browser (IndexedDB + Cloud active)'}</b></div>
          <div class="list-item">Current File: <b>${fileHandle ? esc(fileHandle.name) + (fileOk ? ' ✔ connected' : ' (needs reconnect)') : 'not linked'}</b></div>
          <div class="toolbar" style="margin-top:10px">
            ${fsOK() ? '<button class="btn primary sm" data-act="link-file">Create / choose new</button>' : ''}
            <button class="btn ${fsOK() ? '' : 'primary'} sm" data-act="open-file">📂 Open JSON File</button>
            <button class="btn sm" data-act="backup">💾 Download Backup</button>
            ${fileHandle ? '<button class="btn danger sm" data-act="unlink-file">Unlink</button>' : ''}
          </div>
        </div>

        <div class="card" style="margin-bottom:0;">
          <h4 style="margin:0 0 6px;font-size:14px;">☁️ Supabase Cloud Database</h4>
          <p class="hint">Database is linked to Supabase PostgreSQL with real-time live sync across devices.</p>
          <div class="list-item">Status: <b>${sbOnline ? (sbRealtimeActive ? '🟢 Connected (⚡ Realtime Live Sync)' : '🟢 Connected (☁️ Cloud Sync)') : (sbClient ? '🟡 Ready / Connecting...' : '🔴 Not configured')}</b></div>
          <div class="list-item" style="font-size:11px;opacity:0.8;word-break:break-all;">URL: <code>${esc(SUPABASE_CONFIG.url)}</code></div>
          <div class="toolbar" style="margin-top:10px">
            <button class="btn primary sm" data-act="pull-cloud">⬇️ Pull from Supabase</button>
            <button class="btn sm" data-act="push-cloud">⬆️ Push local data</button>
          </div>
        </div>

        <div class="card" style="margin-bottom:0;">
          <h4 style="margin:0 0 6px;font-size:14px;">📊 Database Statistics</h4>
          ${kvGrid([['Employees', db.employees.length], ['Assets', db.assets.length], ['Software', db.software.length], ['Maintenance', db.maint.length], ['History', db.history.length], ['Last saved', esc(db.savedAt ? new Date(db.savedAt).toLocaleString() : '—')]])}
        </div>
      </div>
    </div>
  </details>

  <!-- Accordion 12: Danger Zone -->
  <details class="settings-accordion" data-panel="danger" ${isOpen('danger')}>
    <summary class="settings-accordion-header">
      <div class="settings-acc-title">
        <span class="settings-acc-icon" style="color:var(--err)">⚠️</span>
        <div class="settings-acc-text">
          <h3 style="color:var(--err)">Danger Zone &amp; System Reset</h3>
          <span class="sub">Wipe local database copy from this browser (download backup first)</span>
        </div>
      </div>
      <div class="settings-acc-meta">
        <span class="badge b-err" style="font-size:11px;font-weight:600;">Caution</span>
        <span class="settings-acc-chevron">▼</span>
      </div>
    </summary>
    <div class="settings-accordion-body">
      <p class="hint" style="margin:0 0 12px;color:var(--text);">Download a backup first. This will permanently delete all cached data and records in this browser session.</p>
      <button class="btn danger" data-act="wipe" style="max-width:280px;">Delete ALL Local Data</button>
    </div>
  </details>`;
};

// ---------------- file linking ----------------
const fsOK = () => 'showSaveFilePicker' in window;
async function linkFile() {
  if (!fsOK()) return toast('Live background file-linking requires Chrome or Edge (File System Access API). On this browser, use "Open JSON File" or "Download Backup".', 'err');
  try {
    const h = await window.showSaveFilePicker({ suggestedName: 'it-asset-data.json', types: [{ description: 'JSON data', accept: { 'application/json': ['.json'] } }] });
    fileHandle = h; fileOk = true; await IDB.set('fileHandle', h); await persist(); toast('Linked — changes now auto-save to ' + h.name, 'ok'); render();
  } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'err'); }
}
async function openFile() {
  if (!fsOK()) {
    // Universal fallback for Firefox, Safari, and mobile browsers
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.style.display = 'none';
    inp.onchange = async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.assets || !data.employees) throw new Error('Not a valid IT Asset Manager data file.');
        if (!(await confirmBox('Load backup file?', `Replace current data with <b>${esc(file.name)}</b> (${data.employees.length} employees, ${data.assets.length} assets)?`, 'Load', 'primary'))) return;
        db = migrate(data);
        dirtyQueue.fullSync = true;
        save();
        render();
        toast(`✔ Loaded ${file.name} successfully!`, 'ok');
      } catch (err) {
        toast('Error reading file: ' + err.message, 'err');
      } finally {
        inp.remove();
      }
    };
    document.body.appendChild(inp);
    inp.click();
    return;
  }
  try {
    const [h] = await window.showOpenFilePicker({ types: [{ description: 'JSON data', accept: { 'application/json': ['.json'] } }] });
    const data = JSON.parse(await (await h.getFile()).text());
    if (!data.assets || !data.employees) throw new Error('Not an IT Asset Manager data file.');
    if (!(await confirmBox('Load this file?', `Replace current data with <b>${esc(h.name)}</b> (${data.employees.length} employees, ${data.assets.length} assets) and keep auto-saving to it?`, 'Load'))) return;
    if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Write permission denied.');
    db = migrate(data); fileHandle = h; fileOk = true; await IDB.set('fileHandle', h); save(); render(); toast('Loaded ' + h.name, 'ok');
  } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'err'); }
}

// ---------------- global search ----------------
let searchHits = [];
function globalSearch(q) {
  const box = $('#search-results');
  if (!norm(q)) { box.hidden = true; return; }
  const canAssets = canAccessPage('assets');
  const canSw = canAccessPage('software');
  const canViewEmpAssets = canDo('canViewAssetsInEmp');
  const emps = db.employees.filter(e => matchQ(hayEmp(e), q)).slice(0, 8);
  const assets = canAssets ? db.assets.filter(a => matchQ(hayAsset(a), q)).slice(0, 10) : [];
  const sws = canSw ? db.software.filter(s => matchQ(low(s.name + ' ' + (s.category || '')), q)).slice(0, 5) : [];
  searchHits = [...emps.map(e => ['open-emp', e.id]), ...assets.map(a => ['open-asset', a.id]), ...sws.map(s => ['open-sw', s.id])];
  let h = '';
  if (emps.length) h += `<div class="sr-group">Employees</div>` + emps.map(e => `<div class="sr-item" data-act="open-emp" data-id="${e.id}"><div class="avatar" style="width:34px;height:34px;font-size:13px;border-radius:9px">${esc(initials(e.name))}</div><div style="min-width:0"><div class="t">${esc(e.name)} <span class="muted mono">${esc(e.empCode || '')}</span> ${e.status && e.status !== 'Active' ? empStatusBadge(e.status) : ''}</div><div class="s">${esc([e.designation, e.department, e.email].filter(Boolean).join(' · '))}</div>${canViewEmpAssets ? `<div>${assetsOf(e).map(a => `${TYPE_ICON[a.type] || ''} ${esc(a.tag)}`).join('  ') || '<span class="s">no assets</span>'}</div>` : ''}</div></div>`).join('');
  if (assets.length) h += `<div class="sr-group">Assets</div>` + assets.map(a => `<div class="sr-item" data-act="open-asset" data-id="${a.id}"><span style="font-size:22px">${TYPE_ICON[a.type] || '📦'}</span><div><div class="t">${esc(a.tag)} <span class="s">${esc(a.type)} · ${esc(norm((a.make || '') + ' ' + (a.model || '')))}</span> ${statusBadge(a.status)}</div><div class="s">${hasHolder(a) ? '👤 ' + esc(holderName(a)) + ' · ' + esc((holderOf(a) || a).department || '') : 'Not assigned'}${a.serialNo ? ' · S/N ' + esc(a.serialNo) : ''}${a.simNumber ? ' · SIM ' + esc(a.simNumber) : ''}</div></div></div>`).join('');
  if (sws.length) h += `<div class="sr-group">Software</div>` + sws.map(s => `<div class="sr-item" data-act="open-sw" data-id="${s.id}">🧩 <div class="t">${esc(s.name)}</div> ${badge(s.licenseType)}</div>`).join('');
  box.innerHTML = h || `<div class="sr-item muted">${!canAssets ? 'No employee matches found.' : 'No match. Try a tag (LAP-578), Emp Code, name, serial, IMEI or SIM number.'}</div>`;
  box.hidden = false;
}

// ---------------- events ----------------
function bindGlobal() {
  window.addEventListener('hashchange', () => { closeDrawer(); closeSide(); render(); });
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const p = page();
      if (LISTS[p]) {
        const st = ui[p];
        if (!st || st.pageSize === 'auto') {
          LISTS[p]();
        }
      }
    }, 120);
  });
  const gs = $('#gsearch');
  gs.addEventListener('input', () => globalSearch(gs.value));
  gs.addEventListener('focus', () => gs.value && globalSearch(gs.value));
  gs.addEventListener('keydown', e => {
    if (e.key === 'Enter' && searchHits[0]) { const [act, id] = searchHits[0]; act === 'open-emp' ? showEmp(id) : act === 'open-asset' ? showAsset(id) : showSw(id); $('#search-results').hidden = true; gs.blur(); }
    if (e.key === 'Escape') { gs.value = ''; $('#search-results').hidden = true; gs.blur(); }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); gs.focus(); gs.select(); }
    if (e.key === 'Escape' && !$('.modal-back') && document.activeElement !== gs) { closeDrawer(); closeSide(); }
    if (e.key === 'Enter') {
      if (e.target.id === 'new-loc-in') { e.preventDefault(); $('[data-act="add-loc-btn"]')?.click(); }
      else if (e.target.id === 'new-dept-in') { e.preventDefault(); $('[data-act="add-dept-btn"]')?.click(); }
      else if (e.target.id === 'new-comp-in') { e.preventDefault(); $('[data-act="add-comp-btn"]')?.click(); }
      else if (e.target.id === 'new-type-in') { e.preventDefault(); $('[data-act="add-type-btn"]')?.click(); }
      else if (e.target.id === 'new-it-in') { e.preventDefault(); $('[data-act="add-it-btn"]')?.click(); }
      else if (['cf-label', 'cf-opts'].includes(e.target.id)) { e.preventDefault(); $('[data-act="add-custom-field-btn"]')?.click(); }
    }
  });
  document.addEventListener('mousedown', e => { if (!e.target.closest('.search')) $('#search-results').hidden = true; });
  document.addEventListener('dragstart', e => { if (e.target.closest('table, tr, td, th')) e.preventDefault(); });
  document.addEventListener('input', e => {
    const f = e.target.dataset && e.target.dataset.filter; if (!f) return;
    const [pg, k] = f.split('.');
    if (ui[pg]) {
      ui[pg][k] = e.target.value;
      if (ui[pg].page) ui[pg].page = 1;
      LISTS[pg] && LISTS[pg]();
      if (NAV_PAGES.includes(pg)) renderNavSub(pg);
    }
  });
  document.addEventListener('change', async e => {
    if (e.target && e.target.dataset && e.target.dataset.act === 'page-size') {
      const pg = e.target.dataset.pg;
      const raw = e.target.value;
      const val = (raw === 'all' || raw === 'auto') ? raw : (parseInt(raw, 10) || 'auto');
      if (ui[pg]) {
        ui[pg].pageSize = val;
        ui[pg].page = 1;
        LISTS[pg] && LISTS[pg]();
      }
      return;
    }
    if (e.target && e.target.dataset && e.target.dataset.filter) {
      const [pg, k] = e.target.dataset.filter.split('.');
      if (ui[pg]) {
        ui[pg][k] = e.target.value;
        if (ui[pg].page) ui[pg].page = 1;
        LISTS[pg] && LISTS[pg]();
        if (NAV_PAGES.includes(pg)) renderNavSub(pg);
      }
      return;
    }
    if (e.target && e.target.id === 'logo-file-input') {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await readImageFile(file, 256);
        db.settings.logo = dataUrl;
        dirtyQueue.settings = true;
        await save();
        renderBrand();
        render();
        toast('Company logo uploaded successfully!', 'ok');
      } catch (err) {
        toast(err.message || 'Error reading image', 'err');
      }
      return;
    }
    if (e.target.matches && (e.target.matches('[data-smart-select]') || e.target.matches('[data-location-select]'))) {
      const sel = e.target;
      const v = sel.value;
      if (v === '__new__' || v === '__new_dept__' || v === '__new_comp__' || v === '__new_type__') {
        let title = 'Enter new item:';
        let placeholder = '';
        if (v === '__new__') { title = 'Enter new location name (e.g. Nawabganj):'; placeholder = 'Nawabganj'; }
        else if (v === '__new_dept__') { title = 'Enter new department name (e.g. Quality Assurance):'; placeholder = 'Quality Assurance'; }
        else if (v === '__new_comp__') { title = 'Enter new company name (e.g. FarmJunction):'; placeholder = 'FarmJunction'; }
        else if (v === '__new_type__') { title = 'Enter new asset type (e.g. Printer, iPad):'; placeholder = 'Printer'; }

        const name = norm(prompt(title, placeholder) || '');
        if (name) {
          if (v === '__new__') {
            const current = sanitizeLocations(db.settings.locations);
            if (!current.some(l => low(l) === low(name))) {
              db.settings.locations = uniqSorted([...current, name]);
              dirtyQueue.settings = true;
              save(); refreshDatalists();
            }
          } else if (v === '__new_dept__') {
            const current = getDepartments();
            if (!current.some(l => low(l) === low(name))) {
              db.settings.departments = uniqSorted([...current, name]);
              dirtyQueue.settings = true;
              save(); refreshDatalists();
            }
          } else if (v === '__new_comp__') {
            const current = getCompanies();
            if (!current.some(l => low(l) === low(name))) {
              db.settings.companies = uniqSorted([...current, name]);
              dirtyQueue.settings = true;
              save(); refreshDatalists();
            }
          } else if (v === '__new_type__') {
            const current = getAssetTypes();
            if (!current.some(l => low(l) === low(name))) {
              db.settings.assetTypes = uniqSorted([...current, name]);
              dirtyQueue.settings = true;
              save(); refreshDatalists();
            }
          }

          let opt = [...sel.options].find(o => o.value === name);
          if (!opt) {
            opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            const newOpt = sel.querySelector(`option[value="${v}"]`);
            if (newOpt) sel.insertBefore(opt, newOpt);
            else sel.appendChild(opt);
          }
          sel.value = name;
          toast(`Added "${name}"`, 'ok');
        } else {
          sel.value = '';
        }
      }
    }
    if (e.target.id === 'imp-file') {
      const file = e.target.files[0]; if (!file) return;
      try {
        const sheets = await readImportFile(file);
        const rows = sheets.flatMap(s => [[], ...s.rows]);
        const opt = { forced: $('#imp-kind').value, mode: $('#imp-mode').value };
        pendingImport = { rows, opt };
        showReport(simulate(() => runImport(rows, opt)), false);
      } catch (err) { toast(err.message, 'err'); }
    }
    if (e.target.id === 'restore-file') {
      const file = e.target.files[0]; if (!file) return;
      try {
        const data = JSON.parse(await file.text()); if (!data.assets || !data.employees) throw new Error('Not a valid backup file.');
        if (!(await confirmBox('Restore backup?', `Replace ALL current data with this backup (${data.employees.length} employees, ${data.assets.length} assets)?`, 'Restore', 'danger'))) return;
        db = migrate(data); log('', 'Restored backup', file.name); save(); render(); toast('Backup restored', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    }
    if (e.target && e.target.classList && e.target.classList.contains('user-role-quick-change')) {
      const email = norm(e.target.dataset.email || '').toLowerCase();
      const role = e.target.value;
      if (!email || !role) return;
      if (!db.settings.userRoleOverrides) db.settings.userRoleOverrides = {};
      db.settings.userRoleOverrides[email] = role;
      trackUserLogin(email);
      dirtyQueue.settings = true;
      save();
      updateAuthUI();
      render();
      toast(`Role updated to ${DEFAULT_ROLE_PERMS[role]?.name || role} for ${email}! 🔐`, 'ok');
      return;
    }
    if (e.target && e.target.id === 'perm-role-select') {
      ui.selectedPermRole = e.target.value;
      render();
      return;
    }
    if (e.target && e.target.id === 'assign-role-select') {
      const hint = document.getElementById('assign-role-hint-badge');
      if (hint) {
        hint.innerHTML = getRoleHintText(e.target.value);
      }
      return;
    }
  });
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'assign-role-email') {
      const val = (e.target.value || '').trim().toLowerCase();
      const phoneInp = document.getElementById('assign-role-phone');
      if (phoneInp && !phoneInp.value) {
        const found = (db.employees || []).find(emp => (emp.email || '').toLowerCase() === val);
        if (found && (found.contact || found.phone)) {
          phoneInp.value = found.contact || found.phone;
        }
      }
    }
  });
  document.addEventListener('toggle', e => {
    if (e.target && e.target.classList && e.target.classList.contains('settings-accordion')) {
      const panel = e.target.dataset.panel;
      if (!panel) return;
      if (!ui.openSettingsPanels) ui.openSettingsPanels = new Set();
      if (e.target.open) {
        ui.openSettingsPanels.add(panel);
      } else {
        ui.openSettingsPanels.delete(panel);
      }
    }
  }, true);
  document.addEventListener('click', e => {
    // clicking "Employees" again while on that page collapses / expands its sub-menu
    const l = e.target.closest('#nav > a[data-page]');
    const pg = l && l.dataset.page;
    if (l && NAV_PAGES.includes(pg)) {
      if (page() === pg) { e.preventDefault(); navOpen[pg] = !navOpen[pg]; renderNavSub(pg); }
      else navOpen[pg] = true;
    }
  });
  document.addEventListener('click', async e => {
    const sortEl = e.target.closest('th[data-sort]');
    if (sortEl) {
      const [pg, k] = sortEl.dataset.sort.split(':');
      const st = ui[pg];
      st.dir = st.sort === k ? -st.dir : 1;
      st.sort = k;
      if (st.page) st.page = 1;
      LISTS[pg]();
      return;
    }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const d = el.dataset, act = d.act;
    if (el.closest('.search-results')) { $('#search-results').hidden = true; }
    if (['open-asset', 'open-emp', 'open-sw', 'return'].includes(act) && el.tagName === 'TR') e.preventDefault();
    if (e.target.closest('button') && e.target.closest('button') !== el && act.startsWith('open')) return;
    switch (act) {
      case 'page-go': {
        const pg = d.pg;
        const targetPage = parseInt(d.page, 10);
        if (ui[pg] && !isNaN(targetPage)) {
          ui[pg].page = targetPage;
          LISTS[pg] && LISTS[pg]();
        }
        break;
      }
      case 'logout': {
        localStorage.removeItem('tj_mobile_auth');
        try { await IDB.del('db'); } catch (_) {}
        db = emptyDb();
        if (sbClient) {
          try { await sbClient.auth.signOut(); } catch (_) {}
        }
        currentUser = null;
        updateAuthUI();
        toast('Logged out successfully', 'ok');
        break;
      }
      case 'menu': { const o = $('#sidebar').classList.toggle('open'); $('#side-backdrop').hidden = !o; break; }
      case 'menu-close': closeSide(); break;
      case 'theme': {
        const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        db.settings.theme = cur;
        localStorage.setItem('tj_theme', cur);
        applyTheme();
        save();
        break;
      }
      case 'nav-group': navGroups[d.g] = !navGroups[d.g]; renderNavSub(d.g.split('.')[0]); break;
      case 'nav': if (el.classList.contains('subitem') || el.classList.contains('brand')) closeSide(); go(!canAccessPage(d.page) ? 'employees' : d.page, d.f ? JSON.parse(d.f) : null); break;
      case 'raise-ticket': raiseTicketModal(); break;
      case 'open-ticket': {
        const t = (db.tickets || []).find(x => x.id === d.id);
        if (t) processTicketModal(t);
        break;
      }
      case 'filter-ticket': {
        if (d.status !== undefined) ui.tickets.status = d.status;
        if (d.sla !== undefined) ui.tickets.sla = d.sla;
        ui.tickets.page = 1;
        render();
        break;
      }
      case 'export-tickets': exportTicketsCSV(); break;
      case 'req-email': requestEmailModal(); break;
      case 'open-onboard': {
        if (!canDo('canManageOnboarding') && !isITAdmin()) {
          toast('Only IT team can process work email provisioning', 'info');
          break;
        }
        const r = (db.onboarding || []).find(x => x.id === d.id);
        if (r) processOnboardingModal(r);
        break;
      }
      case 'filter-onboard': { ui.onboarding.status = d.status; ui.onboarding.page = 1; render(); break; }
      case 'print-qr': { const a = IX.assetId.get(d.id); if (a) qrStickerModal(a); break; }
      case 'print-qr-bulk': bulkQRStickersModal(); break;
      case 'handover-sig': { const emp = IX.empId.get(d.emp); const asset = d.asset ? IX.assetId.get(d.asset) : null; handoverWithSigModal(emp, asset); break; }
      case 'offboard-wizard': { const emp = IX.empId.get(d.id); if (emp) offboardingWizardModal(emp); break; }
      case 'bulk-assign': { const emp = d.emp ? IX.empId.get(d.emp) : null; bulkAssignModal(emp); break; }
      case 'export-onboarding': {
        const CSV_ONBOARD = [
          ['Priority', 'priority'],
          ['Name', 'name'],
          ['Personal Email', 'personalEmail'],
          ['Phone', 'phone'],
          ['Department', 'department'],
          ['Designation', 'designation'],
          ['Location', 'location'],
          ['Payroll Group', 'company'],
          ['Joining Date', 'doj'],
          ['Assigned IT', 'assignedTo'],
          ['Created Email', 'createdEmail'],
          ['Status', 'status'],
          ['Requested By', 'requestedBy'],
          ['Requested At', 'createdAt'],
          ['Completed At', 'completedAt'],
          ['Notes', 'notes']
        ];
        download(`onboarding-requests-${today()}.csv`, toCSV(filteredOnboarding(), CSV_ONBOARD), 'text/csv');
        break;
      }
      case 'add-it-btn': {
        const inp = $('#new-it-in');
        const val = norm(inp?.value || '');
        if (!val) return;
        const current = getITTeam();
        if (current.some(x => low(x) === low(val))) {
          toast(`IT member "${val}" already exists`, 'warn');
          return;
        }
        db.settings.itTeam = [...current, val];
        dirtyQueue.settings = true;
        save();
        render();
        toast(`IT member "${val}" added`, 'ok');
        break;
      }
      case 'add-it-from-emp': {
        const sel = $('#select-emp-it');
        const val = norm(sel?.value || '');
        if (!val) return toast('Please select an employee first', 'warn');
        const current = getITTeam();
        if (current.some(x => low(x) === low(val))) {
          toast(`IT member "${val}" already exists`, 'warn');
          return;
        }
        db.settings.itTeam = [...current, val];
        dirtyQueue.settings = true;
        save();
        render();
        toast(`Added "${val}" to IT Team! 🛠️`, 'ok');
        break;
      }
      case 'add-emp-to-it': {
        const name = d.name;
        if (!name) return;
        const current = getITTeam();
        if (current.some(x => low(x) === low(name))) {
          toast(`${name} is already in IT Team`, 'warn');
          return;
        }
        db.settings.itTeam = [...current, name];
        dirtyQueue.settings = true;
        save();
        render();
        refreshDrawer();
        toast(`Added "${name}" to IT Team! 🛠️`, 'ok');
        break;
      }
      case 'del-it-member': {
        const val = d.val;
        if (!val) return;
        const current = getITTeam();
        db.settings.itTeam = current.filter(x => x !== val);
        if (!db.settings.itTeam.length) db.settings.itTeam = [...DEFAULT_IT_TEAM];
        dirtyQueue.settings = true;
        save();
        render();
        refreshDrawer();
        toast(`IT member "${val}" removed`, 'ok');
        break;
      }
      case 'reset-it-team': {
        db.settings.itTeam = [...DEFAULT_IT_TEAM];
        dirtyQueue.settings = true;
        save();
        render();
        toast('IT Team reset to default members', 'ok');
        break;
      }
      case 'save-it-team': {
        const r = readForm($('#it-form'));
        const list = (r.itTeam || '').split('\n').map(norm).filter(Boolean);
        db.settings.itTeam = list.length ? list : [...DEFAULT_IT_TEAM];
        dirtyQueue.settings = true;
        save();
        render();
        toast('IT Team list saved', 'ok');
        break;
      }
      case 'expand-all-settings': {
        const allPanels = ['alerts', 'activity', 'roles', 'it_team', 'locations', 'depts', 'companies', 'types', 'custom_fields', 'branding', 'storage_cloud', 'danger'];
        ui.openSettingsPanels = new Set(allPanels);
        $$('details.settings-accordion').forEach(d => { d.open = true; });
        toast('All settings cards expanded', 'ok');
        break;
      }
      case 'collapse-all-settings': {
        ui.openSettingsPanels = new Set();
        $$('details.settings-accordion').forEach(d => { d.open = false; });
        toast('All settings cards collapsed', 'ok');
        break;
      }
      case 'open-invite-user-modal': {
        const el = $('#assign-role-email');
        if (el) {
          el.focus();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.5)';
          setTimeout(() => { el.style.boxShadow = ''; }, 1500);
        }
        break;
      }
      case 'invite-emp-user': {
        const e = IX.empId.get(d.id);
        if (!e) return;
        const em = (e.email || '').toLowerCase().trim();
        const role = (db.settings.userRoleOverrides && db.settings.userRoleOverrides[em]) || 'employee';
        const tempPass = 'TJ@' + Math.floor(1000 + Math.random() * 9000) + '#' + new Date().getFullYear().toString().slice(-2);
        if (!db.settings.userRoleOverrides) db.settings.userRoleOverrides = {};
        db.settings.userRoleOverrides[em] = role;
        trackUserLogin(em);
        dirtyQueue.settings = true;
        save();
        updateAuthUI();
        render();
        showUserInviteModal(em, role, e.contact || e.phone || '', e.name, tempPass);
        break;
      }
      case 'save-user-role-btn': {
        const emailInp = $('#assign-role-email');
        const phoneInp = $('#assign-role-phone');
        const roleSel = $('#assign-role-select');
        const email = norm(emailInp?.value || '').toLowerCase();
        let phone = norm(phoneInp?.value || '');
        const role = roleSel?.value || 'employee';

        if (!email) return toast('Please enter a user work email address', 'warn');
        if (!EMAIL_RE.test(email)) return toast('Please enter a valid email address', 'warn');

        if (email.includes('vaseem') || email === 'movaseem@tractorjunction.com') {
          return toast('⚠️ Aap apna Super IT Admin account demote nahi kar sakte.', 'warn');
        }

        const emp = (db.employees || []).find(e => (e.email || '').toLowerCase() === email);
        if (!phone && emp) {
          phone = emp.contact || emp.phone || '';
        }
        const name = emp ? emp.name : email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const tempPass = 'TJ@' + Math.floor(1000 + Math.random() * 9000) + '#' + new Date().getFullYear().toString().slice(-2);

        if (!db.settings.userRoleOverrides) db.settings.userRoleOverrides = {};
        db.settings.userRoleOverrides[email] = role;
        if (!db.settings.userPhones) db.settings.userPhones = {};
        if (phone) db.settings.userPhones[email] = phone;
        trackUserLogin(email);
        dirtyQueue.settings = true;
        save();
        updateAuthUI();
        render();

        toast(`User ${email} authorized as ${getUserRoleName(role)}! 🔐`, 'ok');
        showUserInviteModal(email, role, phone, name, tempPass);
        break;
      }
      case 'send-invite-user': {
        const email = norm(d.email || '').toLowerCase();
        if (!email) return;
        const role = (db.settings.userRoleOverrides && db.settings.userRoleOverrides[email]) || (email.includes('hr') ? 'hr' : 'it_admin');
        const emp = (db.employees || []).find(e => (e.email || '').toLowerCase() === email);
        const name = emp ? emp.name : email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const phone = (db.settings.userPhones && db.settings.userPhones[email]) || (emp ? (emp.contact || emp.phone || '') : '');
        const tempPass = 'TJ@' + Math.floor(1000 + Math.random() * 9000) + '#' + new Date().getFullYear().toString().slice(-2);
        showUserInviteModal(email, role, phone, name, tempPass);
        break;
      }
      case 'del-user-role': {
        const email = norm(d.email || '').toLowerCase();
        if (!email) return;
        if (db.settings.userRoleOverrides) {
          delete db.settings.userRoleOverrides[email];
        }
        if (db.settings.userPhones) {
          delete db.settings.userPhones[email];
        }
        if (Array.isArray(db.settings.knownUsers)) {
          db.settings.knownUsers = db.settings.knownUsers.filter(u => (u || '').toLowerCase().trim() !== email);
        }
        dirtyQueue.settings = true;
        save();
        updateAuthUI();
        render();
        toast(`Custom role override removed for ${email}`, 'ok');
        break;
      }
      case 'save-role-perms-btn': {
        const role = d.role;
        if (!role || role === 'it_admin') return;
        const form = $('#perm-matrix-form');
        if (!form) return;
        const pages = [];
        const actions = {};
        ALL_PAGES_META.forEach(p => {
          const chk = form.querySelector(`[name="page_${p.k}"]`);
          if (chk && chk.checked) pages.push(p.k);
        });
        ALL_ACTIONS_META.forEach(a => {
          const chk = form.querySelector(`[name="act_${a.k}"]`);
          actions[a.k] = Boolean(chk && chk.checked);
        });
        if (!db.settings.rolePermissions) db.settings.rolePermissions = {};
        db.settings.rolePermissions[role] = { pages, actions };
        dirtyQueue.settings = true;
        save();
        updateAuthUI();
        render();
        toast(`Saved permissions for ${DEFAULT_ROLE_PERMS[role]?.name || role}! 🛡️`, 'ok');
        break;
      }
      case 'reset-role-perms': {
        const role = d.role;
        if (!role) return;
        if (db.settings.rolePermissions) {
          delete db.settings.rolePermissions[role];
        }
        dirtyQueue.settings = true;
        save();
        updateAuthUI();
        render();
        toast(`Reset ${DEFAULT_ROLE_PERMS[role]?.name || role} to default permissions ↺`, 'ok');
        break;
      }
      case 'filter': { const [pg, k] = d.k.split('.'); ui[pg][k] = d.v; if (ui[pg] && ui[pg].page) ui[pg].page = 1; render(); break; }
      case 'open-emp': showEmp(d.id); break;
      case 'open-asset': if (!canAccessPage('assets')) { toast('Asset details are restricted for your role', 'info'); break; } showAsset(d.id); break;
      case 'open-sw': if (!canAccessPage('software')) { toast('Software licenses are restricted for your role', 'info'); break; } showSw(d.id); break;
      case 'open-tag': { const a = IX.tag.get(normTag(d.tag)); if (a) { if (!canAccessPage('assets')) toast(`Asset ${a.tag} is held by employee`, 'info'); else showAsset(a.id); } else { const em = IX.empCode.get(normTag(d.tag)); if (em) showEmp(em.id); } break; }
      case 'close-drawer': closeDrawer(); break;
      case 'add-asset': if (!canDo('canAddEditAsset')) { toast('Asset creation is restricted for your role', 'err'); break; } assetForm(null); break;
      case 'add-emp': if (!canDo('canAddEditEmp')) { toast('Employee creation is restricted for your role', 'err'); break; } employeeForm(null); break;
      case 'edit-emp': if (!canDo('canAddEditEmp')) { toast('Employee editing is restricted for your role', 'err'); break; } employeeForm(IX.empId.get(d.id)); break;
      case 'edit-asset': if (!canDo('canAddEditAsset')) { toast('Asset editing is restricted for your role', 'err'); break; } assetForm(IX.assetId.get(d.id)); break;
      case 'dup-asset': { if (!canDo('canAddEditAsset')) { toast('Asset copying is restricted for your role', 'err'); break; } const a = IX.assetId.get(d.id); const copy = { ...a }; ['id', 'tag', 'serialNo', 'imei', 'simNumber', 'empCode', 'holderName', 'holderEmail', 'allocatedDate', 'hostname', 'screenTag'].forEach(k => delete copy[k]); copy.status = 'In Stock'; copy.tag = nextTag(a.type); assetForm(null, copy); break; }
      case 'assign': if (!canDo('canAssignAsset')) { toast('Asset allocation is restricted for your role', 'err'); break; } assignModal({ asset: d.asset ? IX.assetId.get(d.asset) : null, emp: d.emp ? IX.empId.get(d.emp) : null }); break;
      case 'return': if (!canDo('canAssignAsset')) { toast('Asset returns are restricted for your role', 'err'); break; } returnModal(IX.assetId.get(d.id)); break;
      case 'status': if (!canDo('canAddEditAsset')) { toast('Status change is restricted for your role', 'err'); break; } statusModal(IX.assetId.get(d.id)); break;
      case 'offboard': offboardModal(IX.empId.get(d.id)); break;
      case 'print-handover': printHandover(IX.empId.get(d.emp), d.asset ? IX.assetId.get(d.asset) : null); break;
      case 'print-clearance': printClearance(IX.empId.get(d.id)); break;
      case 'del-asset': { if (!canDo('canDelete')) { toast('Only authorized admins can delete assets', 'err'); break; } const a = IX.assetId.get(d.id); if (!(await confirmBox('Delete asset?', `Permanently delete <b>${esc(a.tag)}</b>? Prefer “Change status → Scrapped” to keep history.`, 'Delete', 'danger'))) return; queueDelete('assets', a.id); db.assets = db.assets.filter(x => x.id !== a.id); log(a.tag, 'Deleted', `${a.type} ${a.make || ''}`, [holderKey(a)]); closeDrawer(); changed(); break; }
      case 'del-emp': {
        if (!canDo('canDelete')) { toast('Only authorized admins can delete employee records', 'err'); break; }
        const em = IX.empId.get(d.id); if (assetsOf(em).length) return toast(`${em.name} still holds ${assetsOf(em).length} asset(s). Return them first (use Exit / clearance).`, 'err');
        if (!(await confirmBox('Delete employee?', `Delete <b>${esc(em.name)}</b>? Prefer marking as “Exited” to keep records.`, 'Delete', 'danger'))) return;
        queueDelete('employees', em.id);
        db.swAssign.filter(x => x.empId === em.id).forEach(x => queueDelete('sw_assign', x.id));
        db.employees = db.employees.filter(x => x.id !== em.id); db.swAssign = db.swAssign.filter(x => x.empId !== em.id); log(em.empCode || em.name, 'Employee deleted', em.name, empKeys(em)); closeDrawer(); changed(); break;
      }
      case 'add-sw': if (!canDo('canManageSoftware')) { toast('Software management is restricted for your role', 'err'); break; } swForm(null); break;
      case 'edit-sw': if (!canDo('canManageSoftware')) { toast('Software management is restricted for your role', 'err'); break; } swForm(IX.swId.get(d.id)); break;
      case 'del-sw': { if (!canDo('canDelete')) { toast('Only authorized admins can delete software', 'err'); break; } const s = IX.swId.get(d.id); if (!(await confirmBox('Delete software?', `Delete <b>${esc(s.name)}</b> and its ${seatsUsed(s)} assignment(s)?`, 'Delete', 'danger'))) return; queueDelete('software', s.id); db.swAssign.filter(x => x.swId === s.id).forEach(x => queueDelete('sw_assign', x.id)); db.software = db.software.filter(x => x.id !== s.id); db.swAssign = db.swAssign.filter(x => x.swId !== s.id); closeDrawer(); changed(); break; }
      case 'assign-sw': if (!canDo('canManageSoftware')) { toast('Software assignments are restricted for your role', 'err'); break; } if (!db.software.length) { toast('Add software on the Software page first', 'err'); break; } swAssignModal({ sw: d.sw ? IX.swId.get(d.sw) : null, emp: d.emp ? IX.empId.get(d.emp) : null }); break;
      case 'unassign-sw': { if (!canDo('canManageSoftware')) { toast('Software assignments are restricted for your role', 'err'); break; } const x = db.swAssign.find(y => y.id === d.id); const s = IX.swId.get(x.swId); queueDelete('sw_assign', d.id); db.swAssign = db.swAssign.filter(y => y.id !== d.id); log(x.tag || (s && s.name), 'Software removed', `${s ? s.name : ''} from ${x.name}`, [x.name]); changed(); break; }
      case 'add-maint': if (!canDo('canManageMaint')) { toast('Maintenance logs are restricted for your role', 'err'); break; } maintForm(null, d.tag); break;
      case 'edit-maint': if (!canDo('canManageMaint')) { toast('Maintenance logs are restricted for your role', 'err'); break; } maintForm(db.maint.find(m => m.id === d.id)); break;
      case 'dismiss-banner': { bannerDismissed = true; localStorage.setItem('dismiss_backup_banner', 'true'); renderBanner(); break; }
      case 'backup': backup(); break;
      case 'export-assets': if (!canDo('canExportCSV')) { toast('Exporting assets is restricted for your role', 'err'); break; } download(`assets-${today()}.csv`, toCSV(page() === 'assets' ? sortRows('assets', filteredAssets(), ASSET_COLS) : db.assets, getAssetExportCols()), 'text/csv'); break;
      case 'export-emps': if (!canDo('canExportCSV')) { toast('Exporting employees is restricted for your role', 'err'); break; } download(`employees-${today()}.csv`, toCSV(page() === 'employees' ? filteredEmps() : db.employees, getEmpExportCols()), 'text/csv'); break;
      case 'export-sw': if (!canDo('canExportCSV')) { toast('Exporting software is restricted for your role', 'err'); break; } download(`software-${today()}.csv`, toCSV(db.software, CSV_SW), 'text/csv'); break;
      case 'export-maint': if (!canDo('canExportCSV')) { toast('Exporting maintenance is restricted for your role', 'err'); break; } download(`maintenance-${today()}.csv`, toCSV(db.maint, CSV_MAINT), 'text/csv'); break;
      case 'export-history': if (!canDo('canExportCSV')) { toast('Exporting history is restricted for your role', 'err'); break; } download(`history-${today()}.csv`, toCSV(db.history, CSV_HIST), 'text/csv'); break;
      case 'export-xlsx': if (!canDo('canExportCSV')) { toast('Exporting data is restricted for your role', 'err'); break; } exportExcel(); break;
      case 'imp-tab': ui.importTab = d.v; render(); break;
      case 'imp-preview': {
        const text = $('#imp-text').value; if (!text.trim()) return toast('Paste some rows first', 'err');
        const rows = parseDelimited(text); const opt = { forced: $('#imp-kind').value, mode: $('#imp-mode').value };
        pendingImport = { rows, opt }; showReport(simulate(() => runImport(rows, opt)), false); break;
      }
      case 'imp-commit': {
        if (!pendingImport) return;
        const rep = runImport(pendingImport.rows, pendingImport.opt);
        log('', 'Bulk import', `${rep.added} added, ${rep.updated} updated, ${rep.errors} errors`);
        dirtyQueue.fullSync = true;
        save(); refreshDatalists(); showReport(rep, true); $('#issue-count').textContent = computeIssues().filter(i => i.sev !== 'info').length || '';
        toast(`Imported: ${rep.added} new, ${rep.updated} updated`, 'ok'); break;
      }
      case 'imp-problems-csv': download(`import-problems-${today()}.csv`, toCSV(pendingImport.problems || [], [['Row', 'row'], ['Kind', 'kind'], ['Key', 'key'], ['Problem', 'msg']]), 'text/csv'); break;
      case 'restore-snap': { const data = await IDB.get(d.k); if (!data) return; if (!(await confirmBox('Restore snapshot?', `Replace current data with the snapshot of ${fmtDate(d.k.slice(5))}?`, 'Restore', 'danger'))) return; db = migrate(data); log('', 'Restored snapshot', d.k); dirtyQueue.fullSync = true; save(); render(); toast('Snapshot restored', 'ok'); break; }
      case 'save-settings': {
        const r = readForm($('#set-form'));
        db.settings.org = norm(r.org) || 'IT';
        db.settings.sub = norm(r.sub) || 'Assets · Employees · Software';
        db.settings.engineer = norm(r.engineer) || '';
        dirtyQueue.settings = true;
        save();
        renderBrand();
        render();
        toast('Company branding saved', 'ok');
        break;
      }
      case 'remove-logo': {
        db.settings.logo = '';
        dirtyQueue.settings = true;
        save();
        renderBrand();
        render();
        toast('Company logo removed', 'ok');
        break;
      }
      case 'pull-cloud': await syncFromSupabase(); render(); break;
      case 'push-cloud': {
        if (!(await confirmBox('Push all data to Supabase?', 'This will upload or update all records in Supabase with your current local data.', 'Upload', 'primary'))) return;
        await syncToSupabaseFull();
        break;
      }
      case 'add-loc-btn': {
        const inp = $('#new-loc-in');
        const val = norm(inp?.value || '');
        if (!val) return;
        const current = sanitizeLocations(db.settings.locations);
        if (current.some(l => low(l) === low(val))) {
          toast(`Location "${val}" already exists`, 'warn');
          return;
        }
        db.settings.locations = uniqSorted([...current, val]);
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast(`Location "${val}" added`, 'ok');
        break;
      }
      case 'del-location': {
        const val = d.val;
        if (!val) return;
        const current = sanitizeLocations(db.settings.locations);
        db.settings.locations = current.filter(l => l !== val);
        if (!db.settings.locations.length) db.settings.locations = [...DEFAULT_LOCATIONS];
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast(`Location "${val}" removed`, 'ok');
        break;
      }
      case 'reset-locations': {
        db.settings.locations = [...DEFAULT_LOCATIONS];
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast('Locations reset to defaults', 'ok');
        break;
      }
      case 'save-locations': {
        const r = readForm($('#location-form'));
        const locations = sanitizeLocations(parseLocationInput(r.locations));
        db.settings.locations = locations.length ? locations : [...DEFAULT_LOCATIONS];
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast('Locations saved', 'ok');
        break;
      }
      case 'add-dept-btn': {
        const inp = $('#new-dept-in');
        const val = norm(inp?.value || '');
        if (!val) return;
        const current = getDepartments();
        if (current.some(d => low(d) === low(val))) {
          toast(`Department "${val}" already exists`, 'warn');
          return;
        }
        db.settings.departments = uniqSorted([...(db.settings.departments || DEFAULT_DEPARTMENTS), val]);
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast(`Department "${val}" added`, 'ok');
        break;
      }
      case 'del-dept': {
        const val = d.val;
        if (!val) return;
        const current = db.settings.departments || DEFAULT_DEPARTMENTS;
        db.settings.departments = current.filter(x => x !== val);
        if (!db.settings.departments.length) db.settings.departments = [...DEFAULT_DEPARTMENTS];
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast(`Department "${val}" removed`, 'ok');
        break;
      }
      case 'reset-departments': {
        db.settings.departments = [...DEFAULT_DEPARTMENTS];
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast('Departments reset to defaults', 'ok');
        break;
      }
      case 'save-departments': {
        const r = readForm($('#dept-form'));
        const list = (r.departments || '').split('\n').map(norm).filter(Boolean);
        db.settings.departments = uniqSorted(list.length ? list : [...DEFAULT_DEPARTMENTS]);
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast('Departments saved', 'ok');
        break;
      }
      case 'add-comp-btn': {
        const inp = $('#new-comp-in');
        const val = norm(inp?.value || '');
        if (!val) return;
        const current = getCompanies();
        if (current.some(c => low(c) === low(val))) {
          toast(`Company "${val}" already exists`, 'warn');
          return;
        }
        db.settings.companies = uniqSorted([...(db.settings.companies || DEFAULT_COMPANIES), val]);
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast(`Company "${val}" added`, 'ok');
        break;
      }
      case 'del-comp': {
        const val = d.val;
        if (!val) return;
        const current = db.settings.companies || DEFAULT_COMPANIES;
        db.settings.companies = current.filter(x => x !== val);
        if (!db.settings.companies.length) db.settings.companies = [...DEFAULT_COMPANIES];
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast(`Company "${val}" removed`, 'ok');
        break;
      }
      case 'reset-companies': {
        db.settings.companies = [...DEFAULT_COMPANIES];
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast('Companies reset to defaults', 'ok');
        break;
      }
      case 'save-companies': {
        const r = readForm($('#comp-form'));
        const list = (r.companies || '').split('\n').map(norm).filter(Boolean);
        db.settings.companies = uniqSorted(list.length ? list : [...DEFAULT_COMPANIES]);
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast('Companies saved', 'ok');
        break;
      }
      case 'add-type-btn': {
        const inp = $('#new-type-in');
        const val = norm(inp?.value || '');
        if (!val) return;
        const current = getAssetTypes();
        if (current.some(t => low(t) === low(val))) {
          toast(`Asset type "${val}" already exists`, 'warn');
          return;
        }
        db.settings.assetTypes = uniqSorted([...(db.settings.assetTypes || ASSET_TYPES), val]);
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast(`Asset type "${val}" added`, 'ok');
        break;
      }
      case 'del-type': {
        const val = d.val;
        if (!val) return;
        const current = db.settings.assetTypes || ASSET_TYPES;
        db.settings.assetTypes = current.filter(x => x !== val);
        if (!db.settings.assetTypes.length) db.settings.assetTypes = [...ASSET_TYPES];
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast(`Asset type "${val}" removed`, 'ok');
        break;
      }
      case 'reset-types': {
        db.settings.assetTypes = [...ASSET_TYPES];
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast('Asset types reset to defaults', 'ok');
        break;
      }
      case 'save-types': {
        const r = readForm($('#type-form'));
        const list = (r.types || '').split('\n').map(norm).filter(Boolean);
        db.settings.assetTypes = uniqSorted(list.length ? list : [...ASSET_TYPES]);
        dirtyQueue.settings = true;
        save();
        refreshDatalists();
        render();
        toast('Asset types saved', 'ok');
        break;
      }
      case 'add-custom-field-btn': {
        const target = $('#cf-target')?.value || 'employee';
        const label = norm($('#cf-label')?.value || '');
        if (!label) {
          toast('Field name / label is required', 'warn');
          $('#cf-label')?.focus();
          return;
        }
        const type = $('#cf-type')?.value || 'text';
        const optsRaw = norm($('#cf-opts')?.value || '');
        const opts = type === 'select' ? optsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (type === 'select' && !opts.length) {
          toast('Dropdown ke liye options comma se separate karke likhein (e.g. A, B, C)', 'warn');
          $('#cf-opts')?.focus();
          return;
        }
        const k = 'cf_' + norm(label).toLowerCase().replace(/[^a-z0-9]/g, '_');
        const list = target === 'employee' ? (db.settings.customEmpFields = db.settings.customEmpFields || []) : (db.settings.customAssetFields = db.settings.customAssetFields || []);
        if (list.some(f => f.k === k || f.l.toLowerCase() === label.toLowerCase())) {
          toast(`Field "${label}" already exists`, 'warn');
          return;
        }
        list.push({ k, l: label, t: type, opts, full: false });
        dirtyQueue.settings = true;
        save();
        render();
        toast(`Custom field "${label}" added to ${target === 'employee' ? 'Employee' : 'Asset'} forms`, 'ok');
        break;
      }
      case 'del-custom-field': {
        const target = d.target;
        const key = d.key;
        if (!key) return;
        if (target === 'employee') {
          db.settings.customEmpFields = (db.settings.customEmpFields || []).filter(f => f.k !== key);
        } else {
          db.settings.customAssetFields = (db.settings.customAssetFields || []).filter(f => f.k !== key);
        }
        dirtyQueue.settings = true;
        save();
        render();
        toast('Custom field removed', 'ok');
        break;
      }
      case 'link-file': linkFile(); break;
      case 'open-file': openFile(); break;
      case 'unlink-file': fileHandle = null; fileOk = false; await IDB.del('fileHandle'); render(); break;
      case 'reconnect-file': try { fileOk = (await fileHandle.requestPermission({ mode: 'readwrite' })) === 'granted'; if (fileOk) { await persist(); toast('Reconnected', 'ok'); } render(); } catch (err) { toast(err.message, 'err'); } break;
      case 'wipe': {
        const ok = await new Promise(res => { const m = modal('Delete ALL data', `<p>Type <b>DELETE</b> to confirm. Download a backup first!</p><input name="c" style="width:100%">`, [{ label: 'Delete everything', cls: 'danger', onClick: root => { const v = readForm(root).c; res(v === 'DELETE'); return true; } }], 'sm'); });
        if (!ok) return; db = migrate({ settings: db.settings }); save(); render(); toast('All data deleted', 'ok'); break;
      }
    }
  });
}
function applyTheme() {
  const saved = localStorage.getItem('tj_theme');
  const t = db.settings.theme || saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  if (db.settings.theme) localStorage.setItem('tj_theme', db.settings.theme);
}

function cleanCorruptedDataLocations() {
  db.settings.locations = sanitizeLocations(db.settings.locations);
  if (!Array.isArray(db.settings.departments)) db.settings.departments = [...DEFAULT_DEPARTMENTS];
  if (!Array.isArray(db.settings.companies)) db.settings.companies = [...DEFAULT_COMPANIES];
  if (!Array.isArray(db.settings.assetTypes)) db.settings.assetTypes = [...ASSET_TYPES];
  if (!Array.isArray(db.settings.customEmpFields)) db.settings.customEmpFields = [];
  if (!Array.isArray(db.settings.customAssetFields)) db.settings.customAssetFields = [];
  if (!Array.isArray(db.settings.itTeam)) db.settings.itTeam = [...DEFAULT_IT_TEAM];
  if (!db.settings.rolePermissions || typeof db.settings.rolePermissions !== 'object') {
    db.settings.rolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMS));
  }
  if (!db.settings.userRoleOverrides || typeof db.settings.userRoleOverrides !== 'object') {
    db.settings.userRoleOverrides = {};
  }
  if (!db.settings.userPhones || typeof db.settings.userPhones !== 'object') {
    db.settings.userPhones = {};
  }
  if (!db.settings.smsApiKey) {
    db.settings.smsApiKey = '';
  }
  if (!Array.isArray(db.settings.knownUsers)) {
    db.settings.knownUsers = [];
  }
  if (!Array.isArray(db.onboarding)) db.onboarding = [];
  if (!Array.isArray(db.tickets)) db.tickets = [];
  if (!Array.isArray(db.handovers)) db.handovers = [];
  const fix = loc => {
    if (!loc) return loc;
    if (loc.includes('Noida Sec-9') && loc.includes('Noida Sec-4')) {
      return 'Noida Sec-9';
    }
    return loc;
  };
  (db.employees || []).forEach(e => {
    if (e.location) e.location = fix(e.location);
    if (e.notes && e.notes.includes('<!--CF:')) {
      const m = e.notes.match(/<!--CF:(.*?)-->/);
      if (m) {
        try { Object.assign(e, JSON.parse(m[1])); } catch (_) {}
        e.notes = e.notes.replace(/<!--CF:.*?-->/s, '').trim();
      }
    }
  });
  (db.assets || []).forEach(a => {
    if (a.location) a.location = fix(a.location);
    if (a.remarks && a.remarks.includes('<!--CF:')) {
      const m = a.remarks.match(/<!--CF:(.*?)-->/);
      if (m) {
        try { Object.assign(a, JSON.parse(m[1])); } catch (_) {}
        a.remarks = a.remarks.replace(/<!--CF:.*?-->/s, '').trim();
      }
    }
  });
}

// ---------------- start ----------------
async function init() {
  applyTheme();
  try { const d = await IDB.get('db'); if (d) db = migrate(d); }
  catch (e) { toast('Browser storage not available: ' + e.message, 'err'); }

  initSupabase();
  setupAuthListeners();
  await checkAuthOnLoad();

  if (!db.settings) db.settings = {};
  if (!db.settings.userPhones) db.settings.userPhones = {};
  // Ensure Mo Vaseem is ALWAYS restored as IT Admin in memory and in settings
  if (db.settings?.userRoleOverrides) {
    let cleaned = false;
    Object.keys(db.settings.userRoleOverrides).forEach(k => {
      if (k.toLowerCase().includes('vaseem')) {
        delete db.settings.userRoleOverrides[k];
        cleaned = true;
      }
    });
    if (cleaned) {
      dirtyQueue.settings = true;
      save();
    }
  }

  if (currentUser && currentUser.phone) {
    const refreshed = findUserByMobile(currentUser.phone);
    if (refreshed) currentUser = refreshed;
  }
  if (currentUser && ((currentUser.email && (currentUser.email.toLowerCase().includes('vaseem') || currentUser.email === 'movaseem@tractorjunction.com')) || cleanPhone(currentUser.phone) === '8881709248')) {
    currentUser.role = 'it_admin';
  }
  updateAuthUI();

  // Fallback to bundled JSON if IDB is empty on first load
  if (!db.employees.length && !db.assets.length) {
    try {
      const res = await fetch('it-asset-data.json');
      if (res.ok) {
        const d = await res.json();
        if (d && (d.employees || d.assets)) {
          db = migrate(d);
          await IDB.set('db', db);
        }
      }
    } catch (_) {}
  }

  cleanCorruptedDataLocations();
  reindex();
  await snapshotToday();
  try { fileHandle = (await IDB.get('fileHandle')) || null; if (fileHandle) fileOk = (await fileHandle.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch { fileHandle = null; }
  applyTheme(); bindGlobal();
  setSaveStatus(db.savedAt ? `Last saved ${new Date(db.savedAt).toLocaleString()}` : 'No data saved yet');

  if (sbClient && currentUser) {
    syncFromSupabase();
  }
  render();
}
init();
