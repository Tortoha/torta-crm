// Catalogue of every connector shown in the marketplace.
// `available: true` connectors render as clickable installable rows;
// `available: false` render as expandable "Coming soon" rows where the
// merchant can read the planned feature list and tap "Notify me when ready".
//
// `kind` discriminates routing:
//   - 'webhook'    → generic webhook modal (Custom Webhook / Slack / Discord)
//   - 'accounting' → AccountingExportModal (period + format + schedule)
//   - 'analytics' / 'marketing' / 'automation' → request-only for now
//
// `country` powers the region filter chips on the Browse tab so a merchant
// in Kazakhstan can hide US-only tools and vice-versa.

export const CONNECTOR_CATEGORIES = [
  { key: 'popular',    label: 'Popular' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'analytics',  label: 'Analytics' },
  { key: 'marketing',  label: 'Marketing' },
];

// Region filter list — grouped roughly by continent so a merchant scanning
// the dropdown finds her region quickly. With 20+ entries the picker now
// renders with `searchable={true}` — typing "japan" / "korea" / "polska"
// jumps straight to the row. Same UX as Stripe Connect's country selector.
export const CONNECTOR_COUNTRIES = [
  { key: 'all',    label: 'All regions' },
  { key: 'global', label: 'Global' },
  // ── Asia-Pacific ──
  { key: 'cn',     label: 'China' },
  { key: 'jp',     label: 'Japan' },
  { key: 'kr',     label: 'South Korea' },
  { key: 'in',     label: 'India' },
  { key: 'id',     label: 'Indonesia' },
  { key: 'th',     label: 'Thailand' },
  { key: 'vn',     label: 'Vietnam' },
  { key: 'my',     label: 'Malaysia' },
  { key: 'apac',   label: 'Australia / UK / NZ' },
  // ── Europe ──
  { key: 'eu',     label: 'Europe (DE)' },
  { key: 'pl',     label: 'Poland' },
  { key: 'tr',     label: 'Türkiye' },
  // ── CIS ──
  { key: 'cis',    label: 'Russia / CIS' },
  { key: 'kz',     label: 'Kazakhstan' },
  { key: 'uz',     label: 'Uzbekistan' },
  // ── Americas ──
  { key: 'us',     label: 'US / Canada' },
  { key: 'latam',  label: 'Latin America' },
];

export const CONNECTORS = [
  // ── Popular ──────────────────────────────────────────────
  {
    type: 'webhook', kind: 'webhook', category: 'popular', country: 'global',
    name: 'Custom Webhook',
    description: 'POST every event to your own server URL.',
    available: true, icon: 'webhook',
    features: ['HMAC-signed payloads', 'Retry on failure', 'Full event filtering'],
  },
  {
    type: 'slack', kind: 'webhook', category: 'popular', country: 'global',
    name: 'Slack',
    description: 'Get a Slack message every time something happens.',
    available: true, icon: 'slack',
    features: ['Posts to any channel via incoming webhook', 'Rich attachments', 'Per-event filter'],
  },
  {
    type: 'discord', kind: 'webhook', category: 'popular', country: 'global',
    name: 'Discord',
    description: 'Post events to a Discord channel via webhook.',
    available: true, icon: 'discord',
    features: ['Embed-formatted alerts', 'Server-side filtering', 'Test-send from CRM'],
  },
  {
    type: 'zapier', kind: 'webhook', category: 'popular', country: 'global',
    name: 'Zapier',
    description: 'Forward CRM events to a Zapier Catch Hook → 5000+ apps.',
    available: true, icon: 'zapier',
    primaryLabel: 'Catch Hook URL',
    primaryPlaceholder: 'https://hooks.zapier.com/hooks/catch/12345/abcdef/',
    primaryHelp: 'In Zapier: new Zap → Trigger "Webhooks by Zapier" → Catch Hook → copy the URL it generates.',
    docsUrl: 'https://zapier.com/help/create/code-webhooks/trigger-zaps-from-webhooks',
    features: [
      'Plain JSON payloads — Zapier auto-parses every field',
      'No HMAC overhead (Zapier doesn\'t verify) — simpler setup',
      'Per-event filter same as other webhooks',
    ],
  },

  // ── Accounting ───────────────────────────────────────────
  // All 5 now available via the generic export pipeline (CSV / IIF / XML).
  // No OAuth — merchant downloads on demand or receives signed email links.
  {
    type: 'acc_1c', kind: 'accounting', category: 'accounting', country: 'cis',
    name: '1C Бухгалтерия',
    description: 'Export orders to a 1C-compatible CSV (Windows-1251).',
    available: true, icon: '1c',
    accountingFormat: 'Semicolon CSV · Windows-1251 (Cyrillic)',
    features: [
      'One row per order with date / contact / amount / currency',
      'Cyrillic-safe encoding (cp1251) — imports straight into 1C 8.3',
      'Bulk historical export by period (day / week / month / custom)',
    ],
    setupSteps: [
      'Pick a delivery cadence (manual download / daily / weekly / monthly).',
      'Map currency in 1C Конфигуратор once — same file shape on every export.',
      'Open the file in 1C → Сервис → Загрузка данных из табличного документа.',
    ],
  },
  {
    type: 'acc_kompra', kind: 'accounting', category: 'accounting', country: 'kz',
    name: 'Kompra (ЭСФ Kazakhstan)',
    description: 'UTF-8 CSV ready for bulk ЭСФ upload in Kompra.kz.',
    available: true, icon: 'kompra',
    accountingFormat: 'Semicolon CSV · UTF-8 with BOM',
    features: [
      'VAT-split columns (Net / 12% NDS / Gross) — Kompra-import ready',
      'KZT currency, IIN/BIN column left blank for merchant fill-in',
      'BOM-prefixed UTF-8 so Excel keeps Cyrillic clean',
    ],
    setupSteps: [
      'Pick "Today / Last 7 days / Last month / Custom" period.',
      'Download the CSV — review IIN/BIN column before importing.',
      'In Kompra: Кабинет → ЭСФ → Загрузить из файла.',
    ],
  },
  {
    type: 'acc_quickbooks', kind: 'accounting', category: 'accounting', country: 'us',
    name: 'QuickBooks',
    description: 'IIF transaction files for QuickBooks Desktop / accountant tools.',
    available: true, icon: 'quickbooks',
    accountingFormat: '.IIF (Tab-delimited transactions)',
    features: [
      'TRNS / SPL / ENDTRNS blocks — one transaction per paid order',
      'Maps to Accounts Receivable + Sales accounts',
      'Compatible with every QuickBooks tool that ingests IIF',
    ],
    setupSteps: [
      'Download the .IIF file for the desired period.',
      'In QuickBooks Desktop: File → Utilities → Import → IIF Files.',
      'Review imported transactions before saving the session.',
    ],
  },
  {
    type: 'acc_xero', kind: 'accounting', category: 'accounting', country: 'apac',
    name: 'Xero',
    description: 'CSV in Xero’s Sales Invoice import schema.',
    available: true, icon: 'xero',
    accountingFormat: 'CSV · Xero Sales Invoice Template',
    features: [
      'Asterisked column headers (*ContactName / *InvoiceNumber / …) Xero requires',
      'Auto 14-day due date, currency snapshot from each order',
      'Multi-currency safe — Xero matches each line to the correct ledger',
    ],
    setupSteps: [
      'Download the CSV for the chosen period.',
      'In Xero: Business → Invoices → Import → choose CSV.',
      'Map AccountCode = 200 (Sales) on first import, Xero remembers it.',
    ],
  },
  {
    type: 'acc_datev', kind: 'accounting', category: 'accounting', country: 'eu',
    name: 'DATEV',
    description: 'German accounting CSV — DATEV Buchungsstapel format.',
    available: true, icon: 'datev',
    accountingFormat: 'Semicolon CSV · Windows-1252',
    features: [
      'Buchungsstapel columns: Umsatz, Soll/Haben, Konto/Gegenkonto, Belegfeld',
      'Comma decimal + DDMM date — DATEV-strict formatting',
      'Konto 1400 (Forderungen) → Gegenkonto 8400 (Erlöse) mapping',
    ],
    setupSteps: [
      'Export CSV → save to local disk.',
      'Open DATEV → Bestand → Importieren → wähle "Buchungsstapel CSV".',
      'Adjust Konto/Gegenkonto in DATEV before posting if your chart differs.',
    ],
  },

  // ── Country-bridge expansion ────────────────────────────
  // Each card delegates the heavy gov-compliance work (NFe / CFDI / GST / VAT)
  // to a dominant local accounting SaaS — Torta just exports orders in that
  // SaaS's import format. Same pattern as Kompra for ЭСФ.
  {
    type: 'acc_conta_azul', kind: 'accounting', category: 'accounting', country: 'latam',
    name: 'Conta Azul (Brasil)',
    description: 'UTF-8 CSV ready for Conta Azul import — NFe handled inside Conta Azul.',
    available: true, icon: 'conta_azul',
    accountingFormat: 'Semicolon CSV · UTF-8 with BOM',
    features: [
      'ICMS 18% pre-split (Net / ICMS / Total) — Conta Azul edits per-state in UI',
      'Comma decimal + DD/MM/YYYY date — Brazilian Portuguese locale',
      'CPF/CNPJ column blank — merchant maps clientes inside Conta Azul',
    ],
    setupSteps: [
      'Download the CSV for the chosen period.',
      'In Conta Azul: Cadastros → Importar → Vendas via CSV.',
      'Map cliente → CPF/CNPJ, then emit NFe directly from Conta Azul.',
    ],
  },
  {
    type: 'acc_nibo', kind: 'accounting', category: 'accounting', country: 'latam',
    name: 'Nibo (Brasil)',
    description: 'CSV in Nibo lançamentos format — VAT computed from each customer fiscal profile.',
    available: true, icon: 'nibo',
    accountingFormat: 'Semicolon CSV · UTF-8 with BOM',
    features: [
      'Gross value only — Nibo derives ICMS / ISS from each customer profile',
      'Lançamentos schema: Cliente / Documento / Categoria / Descrição',
      'Multi-currency safe (BRL default, USD/EUR snapshot when paid that way)',
    ],
    setupSteps: [
      'Download CSV → save to disk.',
      'In Nibo: Lançamentos → Importar → CSV → escolha o arquivo.',
      'Confirm categoria mapping on first import — Nibo lembra das próximas vezes.',
    ],
  },
  {
    type: 'acc_contpaqi', kind: 'accounting', category: 'accounting', country: 'latam',
    name: 'Contpaqi (México)',
    description: 'Windows-1252 CSV with IVA 16% split — CFDI emitted from Contpaqi.',
    available: true, icon: 'contpaqi',
    accountingFormat: 'Comma CSV · Windows-1252 (Latin-1)',
    features: [
      'IVA 16% pre-split (Subtotal / IVA / Total) — Mexican standard rate',
      'cp1252 encoding so Spanish accents (á/é/í/ó/ñ) survive in Contpaqi',
      'RFC column blank — merchant maps clientes before CFDI submission',
    ],
    setupSteps: [
      'Download CSV for the chosen period.',
      'In Contpaqi AdminPAQ: Pólizas → Importar → CSV.',
      'Map RFC → cliente, then submit CFDI to SAT through Contpaqi.',
    ],
  },
  {
    type: 'acc_aspel', kind: 'accounting', category: 'accounting', country: 'latam',
    name: 'Aspel COI (México)',
    description: 'Double-entry pólizas CSV — Cuentas por Cobrar (105) ↔ Ventas (401).',
    available: true, icon: 'aspel',
    accountingFormat: 'Comma CSV · Windows-1252',
    features: [
      'Two-row pólizas (Cargo + Abono) per order — Mexican accounting convention',
      'Maps to Cuentas por Cobrar 105 ↔ Ventas 401 (default plan de cuentas)',
      'Departamento column = 01 (sales) — change in Aspel if multi-dept',
    ],
    setupSteps: [
      'Download CSV → review the Cargo/Abono pairs before import.',
      'In Aspel COI: Diario → Importar → Pólizas desde CSV.',
      'Adjust cuentas if your chart differs from 105/401 defaults.',
    ],
  },
  {
    type: 'acc_tally', kind: 'accounting', category: 'accounting', country: 'in',
    name: 'Tally Prime (India)',
    description: 'GST-split CSV ready for Tally Prime Voucher import.',
    available: true, icon: 'tally',
    accountingFormat: 'Comma CSV · UTF-8 with BOM',
    features: [
      'GST 18% split into CGST 9% + SGST 9% — intra-state convention',
      'DD-MMM-YYYY date format (15-May-2026) — Tally native parser',
      'GSTIN column blank — merchant maps party ledgers in Tally',
    ],
    setupSteps: [
      'Download the CSV for the desired period.',
      'In Tally Prime: Import Data → Vouchers → choose CSV.',
      'Switch CGST/SGST → IGST 18% if billing inter-state in the Tally UI.',
    ],
  },
  {
    type: 'acc_zoho_books', kind: 'accounting', category: 'accounting', country: 'in',
    name: 'Zoho Books (India)',
    description: 'CSV in Zoho Books Invoice import schema — GST handled by Zoho.',
    available: true, icon: 'zoho',
    accountingFormat: 'Comma CSV · UTF-8 with BOM',
    features: [
      'GST Treatment column defaulted to "consumer" (B2C) — flip in Zoho per-line',
      'ISO date (YYYY-MM-DD) + Place of Supply auto-derived from customer record',
      'Multi-currency: each row carries its own payment_currency snapshot',
    ],
    setupSteps: [
      'Download CSV → save to disk.',
      'In Zoho Books: Sales → Invoices → Import → choose Zoho Books template.',
      'On first import, map GST Treatment → consumer/business_gst per-row.',
    ],
  },
  {
    type: 'acc_bas', kind: 'accounting', category: 'accounting', country: 'cis',
    name: 'BAS Бухгалтерія (Україна)',
    description: 'Ukrainian successor to 1C — UTF-8 BOM CSV with ПДВ 20% pre-split.',
    available: true, icon: 'bas',
    accountingFormat: 'Semicolon CSV · UTF-8 with BOM',
    features: [
      'ПДВ 20% split (Сума без ПДВ / ПДВ / Сума з ПДВ) — Ukrainian VAT standard',
      'UTF-8 BOM — Ukrainian glyphs (і/ї/є/ґ) survive in BAS / Excel',
      'ЄДРПОУ/ІПН column blank — merchant maps контрагентів in BAS',
    ],
    setupSteps: [
      'Pick a period and download the CSV.',
      'In BAS: Сервіс → Завантаження даних з табличного документа.',
      'Map контрагент → ЄДРПОУ, then post the document.',
    ],
  },
  {
    type: 'acc_1c_uz', kind: 'accounting', category: 'accounting', country: 'uz',
    name: '1C:Бухгалтерия (Узбекистан)',
    description: 'Uzbek 1C variant — НДС/QQS 12% pre-split, cp1251 encoding.',
    available: true, icon: '1c_uz',
    accountingFormat: 'Semicolon CSV · Windows-1251 (Cyrillic)',
    features: [
      'НДС 12% (Uzbek standard since 2023, down from 15%) pre-split',
      'cp1251 encoding — same as Russia 1C, ready for Uzbek 1C 8.3',
      'Default currency UZS — paid orders keep their snapshot currency',
    ],
    setupSteps: [
      'Pick period → download CSV.',
      'In 1C:Бухгалтерия для Узбекистана: Сервис → Загрузка данных из табличного документа.',
      'Map ИНН → контрагент on first import; 1C remembers per вид договора.',
    ],
  },
  {
    type: 'acc_logo_tiger', kind: 'accounting', category: 'accounting', country: 'tr',
    name: 'Logo Tiger (Türkiye)',
    description: 'KDV %20 pre-split CSV for Logo Tiger ERP.',
    available: true, icon: 'logo_tiger',
    accountingFormat: 'Semicolon CSV · UTF-8 with BOM',
    features: [
      'KDV %20 split (Tutar / KDV / Toplam) — Turkish standard since 2023',
      'Comma decimal + DD.MM.YYYY date — Turkish locale',
      'VKN/TCKN column blank — merchant maps cariler in Logo Tiger',
    ],
    setupSteps: [
      'Pick period → download CSV.',
      'In Logo Tiger: Veri Aktarımı → CSV İçeri Aktar → seçin.',
      'Cari kod auto-generated; map VKN/TCKN per müşteri in Logo.',
    ],
  },
  {
    type: 'acc_mikro_bulut', kind: 'accounting', category: 'accounting', country: 'tr',
    name: 'Mikro Bulut (Türkiye)',
    description: 'Cloud-native Turkish accounting — comma CSV in English headers.',
    available: true, icon: 'mikro_bulut',
    accountingFormat: 'Comma CSV · UTF-8 with BOM',
    features: [
      'Same KDV %20 split as Logo Tiger but comma-delimited CSV',
      'English column names — Mikro Bulut wizard parses both TR/EN headers',
      'Cloud-native: no desktop install needed for the accountant',
    ],
    setupSteps: [
      'Download CSV for the period.',
      'In Mikro Bulut: Veri → CSV İçeri Aktarma → yükleyin.',
      'Verify döviz mapping (TRY/USD/EUR) before kayıt.',
    ],
  },
  {
    type: 'acc_comarch', kind: 'accounting', category: 'accounting', country: 'pl',
    name: 'Comarch Optima (Polska)',
    description: 'CSV in Comarch Optima sales-invoice format — VAT 23% pre-split.',
    available: true, icon: 'comarch',
    accountingFormat: 'Semicolon CSV · Windows-1250',
    features: [
      'VAT 23% pre-split (Netto / VAT / Brutto) — Polish standard rate',
      'cp1250 (Central European Windows) — Polish glyphs (ą/ć/ę/ł/ń/ó/ś/ź/ż) safe',
      'NIP column blank — merchant maps kontrahentów in Optima',
    ],
    setupSteps: [
      'Download CSV → save to disk.',
      'In Comarch Optima: Narzędzia → Import danych → CSV.',
      'Map NIP → kontrahent for first batch — Optima remembers afterwards.',
    ],
  },
  {
    type: 'acc_ifirma', kind: 'accounting', category: 'accounting', country: 'pl',
    name: 'iFirma (Polska)',
    description: 'Cloud Polish accounting — UTF-8 CSV for faktury sprzedaży import.',
    available: true, icon: 'ifirma',
    accountingFormat: 'Semicolon CSV · UTF-8 with BOM',
    features: [
      'Same 23% VAT split as Comarch but UTF-8 — iFirma is web-native',
      'Numer faktury formatted FV-{order_id} — Polish invoice convention',
      'Multi-currency safe — iFirma matches each row to ledger by ISO code',
    ],
    setupSteps: [
      'Pick period → download CSV.',
      'In iFirma: Faktury → Import → wybierz plik CSV.',
      'Map NIP → kontrahent on first import.',
    ],
  },

  // ── Asia bridges (覆盖东亚 + 东南亚 + 印度) ─────────────
  {
    type: 'acc_yonyou', kind: 'accounting', category: 'accounting', country: 'cn',
    name: 'Yonyou 用友 (China)',
    description: 'GBK CSV ready for Yonyou NC / U8 / T+ import — 增值税 13% pre-split.',
    available: true, icon: 'yonyou',
    accountingFormat: 'Comma CSV · GBK (国标)',
    features: [
      '增值税 13% standard rate split into 不含税金额 / 增值税 / 价税合计',
      'GBK encoding (国标) so 中文 customer names survive Yonyou import',
      'USCC (统一社会信用代码) column blank — merchant maps 客户 in Yonyou',
    ],
    setupSteps: [
      '下载 CSV (按周期).',
      'Yonyou: 总账 → 凭证 → 外部数据导入 → 选 CSV.',
      '首次映射 USCC → 客户; Yonyou 记住下次自动映射.',
    ],
  },
  {
    type: 'acc_freee', kind: 'accounting', category: 'accounting', country: 'jp',
    name: 'Freee フリー (Japan)',
    description: '消費税 10%-pre-split CSV ready for Freee Accounting import.',
    available: true, icon: 'freee',
    accountingFormat: 'Comma CSV · UTF-8 with BOM',
    features: [
      '消費税 10% (standard rate) pre-split — switch to 8% for food/take-out in Freee',
      'JPY uses 0 decimals — exact integer yen, no rounding noise',
      'YYYY/MM/DD date format — native Freee parser',
    ],
    setupSteps: [
      '対象期間を選んで CSV をダウンロード.',
      'Freee: 取引 → インポート → CSV ファイルを選択.',
      '取引先コードは自動採番されます (空欄でも OK).',
    ],
  },
  {
    type: 'acc_money_forward', kind: 'accounting', category: 'accounting', country: 'jp',
    name: 'Money Forward マネーフォワード (Japan)',
    description: 'Double-entry 仕訳 CSV — 売掛金 (1140) ↔ 売上高 (4100) mapping.',
    available: true, icon: 'money_forward',
    accountingFormat: 'Comma CSV · UTF-8 with BOM',
    features: [
      'Journal entry format (借方 / 貸方) — Money Forward native schema',
      'Maps to 売掛金 (Accounts Receivable) / 売上高 (Sales) by default',
      'JPY 0-decimal precision, non-JPY currencies render with 2 decimals',
    ],
    setupSteps: [
      'Download CSV for the period.',
      'Money Forward: 仕訳帳 → 取込 → CSV ファイル.',
      '勘定科目が違う場合は MF 側で書き換え可能.',
    ],
  },
  {
    type: 'acc_douzone', kind: 'accounting', category: 'accounting', country: 'kr',
    name: 'Douzone iCUBE 더존 (Korea)',
    description: 'cp949 CSV with 부가가치세 10% pre-split for Douzone iCUBE / Smart-A.',
    available: true, icon: 'douzone',
    accountingFormat: 'Comma CSV · CP949 (한국어)',
    features: [
      '부가가치세 10% (Korea VAT) pre-split — 공급가액 / 부가세 / 합계',
      'cp949 encoding — Hangul (한국어) customer names safe in Douzone',
      'YYYY.MM.DD date format + KRW 0-decimal precision',
    ],
    setupSteps: [
      '기간을 선택해 CSV 다운로드.',
      'Douzone iCUBE: 전표 → 외부자료 가져오기 → CSV 선택.',
      '거래처 / 사업자번호 매핑은 Douzone 에서 자동 추론.',
    ],
  },
  {
    type: 'acc_mekari_jurnal', kind: 'accounting', category: 'accounting', country: 'id',
    name: 'Mekari Jurnal (Indonesia)',
    description: 'PPN 11% pre-split CSV ready for Jurnal sales-invoice import.',
    available: true, icon: 'mekari_jurnal',
    accountingFormat: 'Comma CSV · UTF-8 with BOM',
    features: [
      'PPN 11% (Indonesia VAT since April 2022) pre-split — DPP / PPN / Total',
      'DD/MM/YYYY date + IDR default currency (Indonesian Rupiah)',
      'NPWP column blank — merchant maps pelanggan before e-faktur submission',
    ],
    setupSteps: [
      'Pilih periode, unduh CSV.',
      'Jurnal: Penjualan → Impor Faktur → unggah CSV.',
      'Map NPWP → pelanggan, lalu submit e-faktur lewat Jurnal.',
    ],
  },
  {
    type: 'acc_flow_account', kind: 'accounting', category: 'accounting', country: 'th',
    name: 'FlowAccount (Thailand)',
    description: 'ภาษีมูลค่าเพิ่ม 7% pre-split CSV for FlowAccount import.',
    available: true, icon: 'flow_account',
    accountingFormat: 'Comma CSV · UTF-8 with BOM',
    features: [
      'VAT 7% (Thailand statutory by royal decree since 1999) pre-split',
      'Thai column headers (วันที่ / ยอดก่อน VAT / ภาษี / รวมสุทธิ)',
      'DD/MM/YYYY date format + THB default currency',
    ],
    setupSteps: [
      'เลือกช่วงเวลาและดาวน์โหลด CSV.',
      'FlowAccount: รายรับ → นำเข้าจาก CSV.',
      'แมป "เลขประจำตัวผู้เสียภาษี" กับลูกค้าใน FlowAccount.',
    ],
  },
  {
    type: 'acc_misa_sme', kind: 'accounting', category: 'accounting', country: 'vn',
    name: 'MISA SME (Vietnam)',
    description: 'Thuế GTGT 10% pre-split CSV — MISA bundles e-invoice submission.',
    available: true, icon: 'misa_sme',
    accountingFormat: 'Semicolon CSV · UTF-8 with BOM',
    features: [
      'GTGT 10% (Vietnam VAT) pre-split — Tiền hàng / Thuế / Tổng tiền',
      'VND uses 0 decimals; foreign currencies render with 2',
      'Mã số thuế column blank — MISA matches per-customer fiscal profile',
    ],
    setupSteps: [
      'Chọn kỳ kế toán, tải CSV xuống.',
      'MISA SME: Bán hàng → Nhập khẩu → tệp CSV.',
      'Ánh xạ Mã số thuế ↔ khách hàng; MISA tự gửi hóa đơn điện tử sau khi xác nhận.',
    ],
  },
  {
    type: 'acc_sql_account', kind: 'accounting', category: 'accounting', country: 'my',
    name: 'SQL Account (Malaysia)',
    description: 'SST 6% pre-split CSV for SQL Account — Malaysia / Singapore staple.',
    available: true, icon: 'sql_account',
    accountingFormat: 'Comma CSV · UTF-8',
    features: [
      'SST 6% (default service-tax rate) pre-split — toggle to Sales Tax 5/10% in SQL UI',
      'Dual-use: Malaysian SST + Singapore GST workflows both consume same CSV',
      'BRN (Business Reg Number) column blank — assigned in SQL Account',
    ],
    setupSteps: [
      'Pick a period and download CSV.',
      'SQL Account: File → Import → Sales Invoice CSV.',
      'Toggle SST/GST per-row in SQL if your goods category differs from default 6%.',
    ],
  },

  // ── Analytics ────────────────────────────────────────────
  {
    type: 'ga4', kind: 'apiconn', category: 'analytics', country: 'global',
    name: 'Google Analytics 4',
    description: 'Stream purchase events to GA4 via Measurement Protocol.',
    available: true, icon: 'ga4',
    primaryLabel: 'Measurement ID',
    primaryPlaceholder: 'G-XXXXXXXXXX',
    primaryHelp: 'GA4 Admin → Data Streams → your web stream → Measurement ID. Starts with G-.',
    configFields: [
      { key: 'api_secret', label: 'API Secret', placeholder: '••••••••••••••••', secret: true,
        help: 'GA4 Admin → Data Streams → your stream → Measurement Protocol API secrets → Create. Never shown to customers.' },
    ],
    defaultEvents: ['order.paid', 'order.created'],
    docsUrl: 'https://developers.google.com/analytics/devguides/collection/protocol/ga4',
    features: [
      'Server-side Measurement Protocol — no client snippet needed',
      'Maps order.paid → purchase, order.created → begin_checkout, returns → refund',
      'Per-currency revenue + items[] passthrough (up to 50 per event)',
    ],
  },
  {
    type: 'mixpanel', kind: 'apiconn', category: 'analytics', country: 'global',
    name: 'Mixpanel',
    description: 'Product analytics & user behavior tracking.',
    available: true, icon: 'mixpanel',
    primaryLabel: 'Project Token',
    primaryPlaceholder: '32-character hex token',
    primaryHelp: 'Mixpanel Project Settings → Access Keys → Project Token.',
    configFields: [],
    defaultEvents: [],  // empty = all events
    docsUrl: 'https://docs.mixpanel.com/docs/tracking-methods/sdks/server-sdks',
    features: [
      'Forwards every CRM event with its native name (e.g. "order.paid")',
      'distinct_id mapped from CRM customer id (or email / anon-id fallback)',
      '$insert_id set per event for idempotent ingestion',
    ],
  },

  // ── Marketing ────────────────────────────────────────────
  {
    type: 'mailchimp', kind: 'apiconn', category: 'marketing', country: 'global',
    name: 'Mailchimp',
    description: 'Subscribe new customers to a Mailchimp audience.',
    available: true, icon: 'mailchimp',
    primaryLabel: 'Audience (List) ID',
    primaryPlaceholder: 'a1b2c3d4e5',
    primaryHelp: 'Mailchimp Audience → Settings → Audience name and defaults → "Unique ID for audience".',
    configFields: [
      { key: 'api_key', label: 'API Key', placeholder: 'xxxxxxxxxxxxxxxx-us21', secret: true,
        help: 'Mailchimp Account → Extras → API Keys. Must include the -dcXX datacenter suffix.' },
    ],
    defaultEvents: ['customer.created'],
    docsUrl: 'https://mailchimp.com/developer/marketing/api/list-members/',
    features: [
      'Auto-subscribe on customer.created (other events are silently skipped)',
      'Splits name into FNAME / LNAME merge fields',
      'Audience-level double-opt-in settings respected by Mailchimp',
    ],
  },
];

export const CONNECTOR_BY_TYPE = Object.fromEntries(CONNECTORS.map(c => [c.type, c]));
