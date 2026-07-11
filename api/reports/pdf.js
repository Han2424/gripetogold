import PDFDocument from "pdfkit";
import { readStore } from "../../lib/blob-store.js";
import { readJsonBody, requireAdmin, sendJson, setCors } from "../../lib/http.js";

const PLANS = {
  starter: { label: "Starter", periods: ["monthly"] },
  growth: { label: "Growth", periods: ["weekly", "monthly"] },
  team: { label: "Team", periods: ["weekly", "monthly"] }
};

function safeText(value, fallback = "Not available yet.") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function addDraft(doc, draft, index) {
  if (doc.y > 650) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#111827")
    .text(`${index + 1}. ${safeText(draft.title, "Opportunity signal")}`);
  doc.moveDown(0.25).font("Helvetica").fontSize(9).fillColor("#6b7280")
    .text(`${safeText(draft.category, "General")}  |  Pain score: ${Number(draft.pain_score || 0)}  |  Mentions: ${Number(draft.mention_count || 0)}`);
  doc.moveDown(0.5).fontSize(10).fillColor("#1f2937")
    .text(safeText(draft.problem_summary || draft.summary, "The collected signals do not yet contain a detailed problem summary."), { lineGap: 2 });
  doc.moveDown(0.35).font("Helvetica-Bold").text("Opportunity angle");
  doc.font("Helvetica").text(safeText(draft.opportunity_angle, "Review the underlying signals and validate the problem with potential customers."), { lineGap: 2 });
  doc.moveDown(0.35).font("Helvetica-Bold").text("Competitor gap");
  doc.font("Helvetica").text(safeText(draft.competitor_gap_summary, "No confirmed competitor gap is available yet."), { lineGap: 2 });
  doc.moveDown(1);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
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
    const drafts = (data.report_drafts || [])
      .filter((draft) => !draft.period || draft.period === period)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 12);

    const doc = new PDFDocument({ size: "A4", margin: 54, info: { Title: `GripeToGold ${config.label} Report` } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    const completed = new Promise((resolve, reject) => {
      doc.on("end", resolve);
      doc.on("error", reject);
    });

    doc.font("Helvetica-Bold").fontSize(24).fillColor("#111827").text("GripeToGold Opportunity Report");
    doc.moveDown(0.4).font("Helvetica").fontSize(11).fillColor("#6b7280")
      .text(`${config.label} | ${period === "weekly" ? "Weekly" : "Monthly"} | ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown(1).fontSize(10).fillColor("#1f2937")
      .text("A focused review of repeated customer problems and product opportunities. Use these signals as a starting point, then validate the strongest problem before building.", { lineGap: 3 });
    doc.moveDown(1.2);

    if (!drafts.length) {
      doc.font("Helvetica-Bold").fontSize(15).text("No qualified opportunities yet");
      doc.moveDown(0.5).font("Helvetica").fontSize(10)
        .text("The report was created successfully, but the live store does not contain qualified opportunity drafts for this period yet. Run the collector and analysis pipeline before producing the customer report.");
    } else {
      drafts.forEach((draft, index) => addDraft(doc, draft, index));
    }

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
