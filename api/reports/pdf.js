import PDFDocument from "pdfkit";
import { readStore } from "../../lib/blob-store.js";
import { readJsonBody, requireAdmin, sendJson, setCors } from "../../lib/http.js";

const PLANS = {
  starter: { label: "Starter", periods: ["monthly"] },
  growth: { label: "Growth", periods: ["weekly", "monthly"] },
  team: { label: "Team", periods: ["weekly", "monthly"] }
};

const C = { navy: "#101827", ink: "#182230", muted: "#667085", cream: "#F7F3EA", paper: "#FFFCF6", gold: "#B68A3A", paleGold: "#E8D8B6", line: "#DED6C7", white: "#FFFFFF", green: "#27735D" };

function safeText(value, fallback = "Not available yet.") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function pageBase(doc, dark = false) {
  doc.save().rect(0, 0, doc.page.width, doc.page.height).fill(dark ? C.navy : C.cream).restore();
  if (!dark) {
    doc.save().rect(32, 32, doc.page.width - 64, doc.page.height - 64).lineWidth(0.7).stroke(C.paleGold).restore();
  }
}

function label(doc, text, x, y, width = 150) {
  doc.save().roundedRect(x, y, width, 22, 11).fill(C.paleGold).restore();
  doc.font("Helvetica-Bold").fontSize(8).fillColor(C.navy).text(text.toUpperCase(), x + 10, y + 7, { width: width - 20, characterSpacing: 0.8 });
}

function metric(doc, x, y, value, caption) {
  doc.save().roundedRect(x, y, 132, 64, 7).fill(C.paper).lineWidth(0.7).stroke(C.line).restore();
  doc.font("Helvetica-Bold").fontSize(21).fillColor(C.navy).text(String(value), x + 14, y + 11, { width: 104 });
  doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(caption.toUpperCase(), x + 14, y + 39, { width: 104, characterSpacing: 0.5 });
}

function section(doc, title, body, y) {
  doc.save().rect(58, y + 2, 3, 15).fill(C.gold).restore();
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C.navy).text(title.toUpperCase(), 70, y + 1, { characterSpacing: 0.8 });
  doc.font("Helvetica").fontSize(10).fillColor(C.ink).text(safeText(body), 70, y + 24, { width: 467, lineGap: 4 });
  return doc.y + 19;
}

function addOpportunity(doc, draft, index) {
  doc.addPage();
  pageBase(doc);
  label(doc, `${safeText(draft.category, "General")} / Opportunity ${String(index + 1).padStart(2, "0")}`, 58, 58, 210);
  doc.font("Helvetica-Bold").fontSize(24).fillColor(C.navy).text(safeText(draft.title, "Opportunity signal"), 58, 102, { width: 479, lineGap: 2 });
  doc.save().moveTo(58, doc.y + 13).lineTo(537, doc.y + 13).lineWidth(1).stroke(C.gold).restore();

  const metricsY = doc.y + 35;
  metric(doc, 58, metricsY, Number(draft.mention_count || 0), "Unique matched mentions");
  metric(doc, 205, metricsY, Number(draft.pain_score || 0), "Pain score / 100");
  metric(doc, 352, metricsY, `${Number(draft.relevance_score || 0)}%`, "Query relevance");

  let y = metricsY + 88;
  y = section(doc, "Observed problem", draft.problem_summary || draft.summary, y);
  y = section(doc, "Product angle", draft.opportunity_angle, y);
  y = section(doc, "Competitive opening", draft.competitor_gap_summary, y);

  if (y > 610) y = 610;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C.navy).text("SOURCE EVIDENCE", 58, y, { characterSpacing: 0.8 });
  doc.font("Helvetica").fontSize(8.5).fillColor(C.muted).text("Clickable public discussions used in this signal", 58, y + 18);
  let sy = y + 38;
  const details = (draft.source_details || []).filter((item) => item.url).slice(0, 4);
  details.forEach((detail, sourceIndex) => {
    if (sy > 760) return;
    doc.font("Helvetica-Bold").fontSize(8.2).fillColor(C.ink)
      .text(`${sourceIndex + 1}. ${safeText(detail.title, "Source discussion").slice(0, 82)}`, 58, sy, { width: 479, height: 11, ellipsis: true });
    doc.font("Helvetica").fontSize(7.4).fillColor(C.green)
      .text(String(detail.url).slice(0, 112), 70, sy + 12, { width: 467, height: 10, ellipsis: true });
    sy += 29;
  });
  if (!details.length) doc.font("Helvetica").fontSize(9).fillColor(C.muted).text("No source links were stored for this signal.", 58, sy);
}

function addFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const dark = i === 0;
    doc.font("Helvetica").fontSize(8).fillColor(dark ? C.paleGold : C.muted)
      .text("GRIPETOGOLD  /  EVIDENCE BEFORE BUILD", 58, 808, { width: 360, characterSpacing: 0.5, lineBreak: false });
    doc.text(`${i + 1} / ${range.count}`, 475, 808, { width: 62, align: "right", lineBreak: false });
  }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  if (!requireAdmin(req, res)) return;

  try {
    const body = await readJsonBody(req);
    const plan = String(body.plan || "").toLowerCase();
    const period = body.period === "weekly" ? "weekly" : "monthly";
    const config = PLANS[plan];
    if (!config) return sendJson(res, 400, { error: "Choose Starter, Growth, or Team." });
    if (!config.periods.includes(period)) return sendJson(res, 400, { error: "Starter only includes a monthly PDF." });

    const { data } = await readStore();
    const drafts = (data.report_drafts || []).filter((draft) => !draft.period || draft.period === period)
      .sort((a, b) => Number(b.pain_score || 0) - Number(a.pain_score || 0)).slice(0, 12);
    const platforms = [...new Set(drafts.flatMap((draft) => (draft.source_details || []).map((source) => source.platform)).filter(Boolean))];

    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: `GripeToGold ${config.label} Opportunity Report`, Author: "GripeToGold" } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    const completed = new Promise((resolve, reject) => { doc.on("end", resolve); doc.on("error", reject); });

    pageBase(doc, true);
    doc.save().rect(58, 74, 54, 4).fill(C.gold).restore();
    doc.font("Helvetica-Bold").fontSize(11).fillColor(C.paleGold).text("GRIPETOGOLD", 58, 98, { characterSpacing: 2.2 });
    doc.font("Helvetica-Bold").fontSize(38).fillColor(C.white).text("Opportunity\nIntelligence", 58, 184, { width: 430, lineGap: 2 });
    doc.font("Helvetica").fontSize(15).fillColor(C.paleGold).text(`${config.label} / ${period === "weekly" ? "Weekly" : "Monthly"} Edition`, 61, 292);
    doc.font("Helvetica").fontSize(10).fillColor("#CBD2DC")
      .text("Repeated customer problems, scored with transparent evidence and linked to the public discussions behind each signal.", 61, 350, { width: 420, lineGap: 5 });
    doc.save().roundedRect(58, 455, 479, 122, 10).fill("#172235").lineWidth(0.7).stroke("#344054").restore();
    doc.font("Helvetica-Bold").fontSize(28).fillColor(C.white).text(String(drafts.length), 82, 480);
    doc.font("Helvetica").fontSize(8).fillColor(C.paleGold).text("QUALIFIED OPPORTUNITIES", 82, 520, { characterSpacing: 0.7 });
    doc.font("Helvetica-Bold").fontSize(18).fillColor(C.white).text(platforms.length ? String(platforms.length) : "-", 288, 484);
    doc.font("Helvetica").fontSize(8).fillColor(C.paleGold).text("PUBLIC SOURCE TYPES", 288, 520, { characterSpacing: 0.7 });
    doc.font("Helvetica").fontSize(9).fillColor("#CBD2DC").text(platforms.join(" / ") || "Run Scan & Prepare to collect evidence", 82, 548, { width: 420 });
    doc.font("Helvetica").fontSize(9).fillColor("#98A2B3").text(`Generated ${new Date().toISOString().slice(0, 10)}  |  Mention counts are unique topic-matched records, not search-result totals.`, 61, 694, { width: 455, lineGap: 4 });

    if (!drafts.length) {
      doc.font("Helvetica-Bold").fontSize(15).fillColor(C.white).text("No qualified opportunities yet", 61, 620);
    } else {
      drafts.forEach((draft, index) => addOpportunity(doc, draft, index));
    }
    addFooters(doc);
    doc.end();
    await completed;
    const pdf = Buffer.concat(chunks);
    const filename = `gripetogold-${plan}-${period}-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Length", String(pdf.length));
    return res.end(pdf);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Could not create PDF." });
  }
}
