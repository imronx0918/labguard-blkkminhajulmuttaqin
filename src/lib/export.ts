// Ekspor Excel/PDF di sisi klien dari data yang diambil dari backend.
export async function exportExcel(filename: string, sheet: string, columns: string[], rows: (string | number | null | undefined)[][]) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([columns, ...rows.map((r) => r.map((c) => c ?? ''))]);
  ws['!cols'] = columns.map((c, i) => ({ wch: Math.min(50, Math.max(c.length, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length)) + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export async function readExcel(file: File): Promise<Record<string, any>[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' }).map((r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim().toLowerCase(), v])));
}

export async function exportPdf(opts: { title: string; subtitle?: string; institution?: string; columns: string[]; rows: (string | number)[][]; summary?: Record<string, string | number>; filename: string; demo?: boolean }) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: opts.columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(20, 42, 85); doc.rect(0, 0, w, 64, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(15); doc.setFont('helvetica', 'bold');
  doc.text('LABGUARD EDU', 36, 30);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.text(opts.institution || 'Laporan Sistem Pengendalian Akses Internet Laboratorium', 36, 46);
  doc.setTextColor(20, 42, 85); doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text(opts.title, 36, 92);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 100, 120);
  if (opts.subtitle) doc.text(opts.subtitle, 36, 108);
  if (opts.demo) { doc.setTextColor(124, 58, 237); doc.text('MODE DEMO — data dapat berisi contoh, bukan aktivitas jaringan nyata.', 36, 122); }
  let y = opts.demo ? 136 : 122;
  if (opts.summary) {
    doc.setTextColor(30, 41, 59);
    const s = Object.entries(opts.summary).map(([k, v]) => `${k}: ${v}`).join('   |   ');
    doc.text(doc.splitTextToSize(s, w - 72), 36, y); y += 18;
  }
  autoTable(doc, { head: [opts.columns], body: opts.rows.map((r) => r.map((c) => String(c ?? ''))), startY: y, styles: { fontSize: 7.5, cellPadding: 4 }, headStyles: { fillColor: [26, 55, 110] }, alternateRowStyles: { fillColor: [242, 247, 255] }, margin: { left: 36, right: 36 },
    didDrawPage: () => { doc.setFontSize(8); doc.setTextColor(140); doc.text(`Dicetak ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB — halaman ${doc.getNumberOfPages()}`, 36, doc.internal.pageSize.getHeight() - 18); } });
  doc.save(opts.filename.endsWith('.pdf') ? opts.filename : `${opts.filename}.pdf`);
}
