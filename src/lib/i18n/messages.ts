import type { Locale } from "./locale";

/**
 * Copy for sign-in and workspace entry. Bahasa Melayu first; every key must
 * exist in both languages (the type enforces it). Plain, short sentences: these
 * screens are read on a phone by drivers and warehouse staff.
 */
const ms = {
  language: { label: "Bahasa / Language", ms: "BM", en: "EN", msName: "Bahasa Melayu", enName: "English" },
  areas: {
    workspace: "Ruang kerja",
    operating: "Sistem Operasi",
    operatingShort: "Operasi",
    operatingSummary: "Jualan, bilik pameran, pertanyaan pelanggan, katalog, pemasaran dan laporan.",
    admin: "Sistem Admin",
    adminShort: "Admin",
    adminSummary: "Pentadbiran perniagaan: penyediaan pesanan dan penghantaran.",
    overview: "Gambaran Keseluruhan Pengurusan",
    overviewShort: "Gambaran",
    open: "Buka",
    current: "Sedang dibuka",
    switchTo: "Tukar ke",
    makeDefault: "Jadikan halaman mula saya",
    isDefault: "Halaman mula anda",
    askEachTime: "Tanya saya setiap kali",
    defaultSaved: "Halaman mula disimpan.",
    defaultCleared: "Anda akan ditanya setiap kali log masuk.",
    onlyArea: "Peranan anda hanya menggunakan ruang kerja ini.",
  },
  start: {
    title: "Pilih ruang kerja",
    description: "Kedua-dua sistem menggunakan data perniagaan yang sama. Anda boleh bertukar pada bila-bila masa dari menu ruang kerja di bahagian atas.",
    remember: "Ingat pilihan saya",
    rememberHint: "Disimpan pada akaun anda. Tukar atau padam dari menu ruang kerja.",
    enter: "Masuk",
    noneTitle: "Tiada ruang kerja untuk peranan anda",
    noneDescription: "Akaun anda log masuk tetapi peranan anda belum diberi akses ke Sistem Operasi atau Sistem Admin. Minta pentadbir platform menetapkan peranan anda.",
  },
  overview: {
    title: "Gambaran Keseluruhan Pengurusan",
    description: "Titik mula untuk pengurusan. Pilih sistem untuk dibuka; data adalah sama di kedua-duanya.",
    scopeNote: "Peranan pengurusan boleh melihat kedua-dua sistem. Ia tidak termasuk kelulusan stok, perakaunan atau pengurusan pengguna.",
    queues: "Barisan kerja operasi",
    queuesHint: "Barisan yang belum dibina ditunjukkan dengan jujur. Tiada angka dipaparkan sehingga data sebenar direkodkan.",
  },
  queues: {
    notBuilt: "Belum dibina",
    notBuiltHint: "Barisan ini belum wujud dalam Tile Concept OS, jadi tiada data atau jumlah dipaparkan.",
    preparation: "Penyediaan pesanan",
    preparationSummary: "Pesanan yang perlu disediakan untuk diambil atau dihantar.",
    deliveries: "Jadual penghantaran",
    deliveriesSummary: "Perancangan dan penugasan penghantaran kepada pemandu.",
    myDeliveries: "Penghantaran Saya",
    myDeliveriesSummary: "Penghantaran yang ditugaskan kepada anda.",
  },
  adminHome: {
    title: "Sistem Admin",
    description: "Pentadbiran perniagaan untuk Tile Concept. Peranan admin perniagaan berbeza daripada pentadbir platform.",
  },
  preparation: {
    title: "Penyediaan pesanan",
    emptyTitle: "Barisan penyediaan belum dibina",
    emptyDescription: "Tiada pesanan dipaparkan kerana penyediaan pesanan belum direkodkan dalam Tile Concept OS. Teruskan cara kerja semasa anda sehingga barisan ini dibina.",
  },
  myDeliveries: {
    title: "Penghantaran Saya",
    emptyTitle: "Senarai penghantaran belum dibina",
    emptyDescription: "Tiada penghantaran dipaparkan kerana jadual penghantaran belum direkodkan dalam Tile Concept OS. Teruskan cara kerja semasa anda sehingga senarai ini dibina.",
    checkAgain: "Semak semula",
    checking: "Sedang menyemak…",
  },
  denied: {
    title: "Tidak tersedia untuk peranan anda",
    goHome: "Ke halaman mula saya",
    reasons: {
      "workspace.operating": "Sistem Operasi adalah untuk peranan jualan, bilik pameran, pemasaran, katalog, stok dan pengurusan.",
      "workspace.admin": "Sistem Admin adalah untuk admin perniagaan, kakitangan gudang, pemandu, pengurusan dan pentadbir platform.",
      "overview.read": "Gambaran Keseluruhan Pengurusan adalah halaman mula untuk pengurusan.",
      "admin.coordinate": "Hab Sistem Admin adalah untuk admin perniagaan, pengurusan dan pentadbir platform.",
      "preparation.read": "Barisan penyediaan adalah untuk kakitangan gudang, admin perniagaan, pengurusan dan pentadbir platform.",
      "delivery.read_own": "Penghantaran Saya adalah untuk pemandu penghantaran.",
    },
  },
  noAccess: {
    title: "Tiada akses ruang kerja",
    signedInAs: "Log masuk sebagai",
    body: "Akaun ini telah log masuk, tetapi tiada keahlian aktif dalam mana-mana ruang kerja Tile Concept. Jemputan mungkin belum diterima, atau akses anda telah digantung atau dibuang.",
    ask: "Minta pentadbir anda menghantar jemputan atau memulihkan akses anda.",
    signOut: "Log keluar dan guna akaun lain",
    retry: "Semak semula",
    retryHint: "Gunakan Semak semula selepas pentadbir memulihkan akses anda.",
  },
  login: {
    subtitle: "Ruang kerja dalaman, dengan jemputan sahaja",
    password: "Kata laluan",
    emailLink: "Pautan e-mel",
    email: "E-mel",
    signIn: "Log masuk",
    signingIn: "Sedang log masuk…",
    sendLink: "Hantar pautan log masuk",
    sending: "Sedang menghantar…",
    linkHint: "Gunakan ini jika jemputan anda telah tamat tempoh atau anda belum menetapkan kata laluan.",
    or: "atau",
    guest: "Masuk sebagai tetamu",
    guestPreparing: "Sedang menyediakan demo anda…",
    guestDescription: "Tiada akaun diperlukan. Anda masuk ke ruang kerja demo bersama dengan data contoh dan boleh menggunakan setiap ciri — apa sahaja yang anda cipta disimpan. Demo ditetapkan semula setiap minggu dan tidak mengandungi data pelanggan, pembekal atau harga sebenar.",
    footer: "Akses diberi melalui jemputan. Sesi disimpan dalam kuki; kebenaran dikuatkuasakan dalam pangkalan data.",
    reasons: {
      "no-membership": "Akaun anda telah log masuk tetapi tiada keahlian ruang kerja. Minta jemputan daripada pentadbir.",
      "auth-callback-failed": "Pautan log masuk itu tidak dapat disahkan. Minta pautan baharu.",
      "invalid-link": "Pautan itu tidak sah atau telah tamat tempoh. Minta pautan baharu.",
    },
  },
};

type Messages = typeof ms;

const en: Messages = {
  language: { label: "Bahasa / Language", ms: "BM", en: "EN", msName: "Bahasa Melayu", enName: "English" },
  areas: {
    workspace: "Workspace",
    operating: "Operating System",
    operatingShort: "Operating",
    operatingSummary: "Sales, showroom, customer enquiries, catalogue, marketing and reports.",
    admin: "Admin System",
    adminShort: "Admin",
    adminSummary: "Business administration: order preparation and deliveries.",
    overview: "Management Overview",
    overviewShort: "Overview",
    open: "Open",
    current: "Open now",
    switchTo: "Switch to",
    makeDefault: "Make this my start page",
    isDefault: "Your start page",
    askEachTime: "Ask me each time",
    defaultSaved: "Start page saved.",
    defaultCleared: "You will be asked each time you sign in.",
    onlyArea: "Your role uses only this workspace.",
  },
  start: {
    title: "Choose a workspace",
    description: "Both systems use the same business data. You can switch at any time from the workspace menu at the top.",
    remember: "Remember my choice",
    rememberHint: "Saved to your account. Change or clear it from the workspace menu.",
    enter: "Enter",
    noneTitle: "No workspace for your role",
    noneDescription: "Your account is signed in, but your role has not been given the Operating System or the Admin System. Ask a platform administrator to set your role.",
  },
  overview: {
    title: "Management Overview",
    description: "The starting point for management. Choose a system to open; the data is the same in both.",
    scopeNote: "The management role can view both systems. It does not include stock, accounting or user-management approval.",
    queues: "Operational queues",
    queuesHint: "Queues that are not built yet are shown honestly. No numbers appear until real data is recorded.",
  },
  queues: {
    notBuilt: "Not built yet",
    notBuiltHint: "This queue does not exist in Tile Concept OS yet, so no data or totals are shown.",
    preparation: "Order preparation",
    preparationSummary: "Orders to prepare for collection or delivery.",
    deliveries: "Delivery schedule",
    deliveriesSummary: "Planning deliveries and assigning them to drivers.",
    myDeliveries: "My Deliveries",
    myDeliveriesSummary: "Deliveries assigned to you.",
  },
  adminHome: {
    title: "Admin System",
    description: "Business administration for Tile Concept. A business admin role is not a platform administrator.",
  },
  preparation: {
    title: "Order preparation",
    emptyTitle: "The preparation queue is not built yet",
    emptyDescription: "No orders are shown because order preparation is not recorded in Tile Concept OS yet. Keep to your current way of working until this queue is built.",
  },
  myDeliveries: {
    title: "My Deliveries",
    emptyTitle: "The delivery list is not built yet",
    emptyDescription: "No deliveries are shown because the delivery schedule is not recorded in Tile Concept OS yet. Keep to your current way of working until this list is built.",
    checkAgain: "Check again",
    checking: "Checking…",
  },
  denied: {
    title: "Not available to your role",
    goHome: "Go to my start page",
    reasons: {
      "workspace.operating": "The Operating System is for sales, showroom, marketing, catalogue, stock and management roles.",
      "workspace.admin": "The Admin System is for business admin employees, warehouse staff, drivers, management and platform administrators.",
      "overview.read": "The Management Overview is the starting page for management.",
      "admin.coordinate": "The Admin System hub is for business admin employees, management and platform administrators.",
      "preparation.read": "The preparation queue is for warehouse staff, business admin employees, management and platform administrators.",
      "delivery.read_own": "My Deliveries is for delivery drivers.",
    },
  },
  noAccess: {
    title: "No workspace access",
    signedInAs: "Signed in as",
    body: "This account is signed in, but it has no active membership in any Tile Concept workspace. The invitation may not have been accepted yet, or your access was suspended or removed.",
    ask: "Ask your administrator to send an invitation or restore your access.",
    signOut: "Sign out and use another account",
    retry: "Check again",
    retryHint: "Use Check again after an administrator has restored your access.",
  },
  login: {
    subtitle: "Invite-only internal workspace",
    password: "Password",
    emailLink: "Email link",
    email: "Email",
    signIn: "Sign in",
    signingIn: "Signing in…",
    sendLink: "Send sign-in link",
    sending: "Sending…",
    linkHint: "Use this if your invitation expired or you have not set a password yet.",
    or: "or",
    guest: "Enter as guest",
    guestPreparing: "Preparing your demo…",
    guestDescription: "No account needed. You land in a shared demo workspace with sample data and can use every feature — anything you create is saved. The demo is reset weekly, and it contains no real customer, supplier or price data.",
    footer: "Access is granted by invitation. Sessions are cookie-based; permissions are enforced in the database.",
    reasons: {
      "no-membership": "Your account is signed in but has no workspace membership. Ask an administrator for an invitation.",
      "auth-callback-failed": "That sign-in link could not be verified. Request a new one.",
      "invalid-link": "That link is invalid or has expired. Request a new one.",
    },
  },
};

export const MESSAGES: Record<Locale, Messages> = { ms, en };
export type { Messages };
export type DeniedPermission = keyof Messages["denied"]["reasons"];

export function messages(locale: Locale): Messages {
  return MESSAGES[locale];
}
