import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type {
  Candidate,
  EvaluationReport,
  EvaluationScore,
  EvidenceSpan,
  ScoreOverride,
  SessionTranscript,
} from '@zios/shared-types';
import {
  evidenceForScore,
  formatDateTime,
  formatScore,
  metricsSummary,
  overallRecommendationLabel,
  scoreForDisplay,
} from './report-utils';

interface PdfInput {
  candidate: Candidate;
  kitTitle: string;
  report: EvaluationReport;
  scores: EvaluationScore[];
  evidenceSpans: EvidenceSpan[];
  overrides: ScoreOverride[];
  transcript: SessionTranscript[];
}

export function downloadReportPdf(input: PdfInput): void {
  const { candidate, kitTitle, report, scores, evidenceSpans, overrides, transcript } = input;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 16;

  doc.setFontSize(18);
  doc.setTextColor(0, 52, 65);
  doc.text('Interview Report', 14, y);
  y += 8;

  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text(`Candidate: ${candidate.name} <${candidate.email}>`, 14, y);
  y += 6;
  doc.text(`Kit: ${kitTitle}`, 14, y);
  y += 6;
  doc.text(`Report generated: ${formatDateTime(report.completedAt ?? report.createdAt)}`, 14, y);
  y += 10;

  doc.setFontSize(14);
  doc.setTextColor(0, 52, 65);
  doc.text('Overall recommendation', 14, y);
  y += 7;
  doc.setFontSize(12);
  doc.setTextColor(60, 60, 60);
  const recLabel = overallRecommendationLabel(report.overallRecommendation);
  const recScore = formatScore(report.overallRecommendation);
  const conf = formatScore(report.overallConfidence);
  doc.text(`${recLabel} — ${recScore} (confidence ${conf})`, 14, y);
  y += 10;

  doc.setFontSize(14);
  doc.setTextColor(0, 52, 65);
  doc.text('Communication metrics', 14, y);
  y += 7;
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  doc.text(metricsSummary(report.communicationMetrics), 14, y);
  y += 12;

  // Group scores by question prompt.
  const scoresByQuestion = new Map<string, EvaluationScore[]>();
  for (const score of scores) {
    const list = scoresByQuestion.get(score.questionId) ?? [];
    list.push(score);
    scoresByQuestion.set(score.questionId, list);
  }

  const questionPrompts = new Map<string, string>();
  for (const t of transcript) {
    if (!questionPrompts.has(t.questionId)) {
      questionPrompts.set(t.questionId, t.questionPrompt);
    }
  }

  doc.setFontSize(14);
  doc.setTextColor(0, 52, 65);
  doc.text('Per-question scores', 14, y);
  y += 8;

  const body: (string | number)[][] = [];
  for (const [questionId, questionScores] of scoresByQuestion) {
    const prompt = questionPrompts.get(questionId) ?? 'Question';
    for (const score of questionScores) {
      const display = scoreForDisplay(score, overrides);
      const evidence = evidenceForScore(score, evidenceSpans);
      const quote = evidence.map((e) => `"${e.quoteText.replace(/\s+/g, ' ').trim()}"`).join(' ');
      body.push([
        prompt,
        score.criterionText,
        display.isOverridden ? `${display.value}*` : display.value,
        quote || '—',
      ]);
    }
  }

  autoTable(doc, {
    startY: y,
    head: [['Question', 'Criterion', 'Score', 'Evidence']],
    body,
    styles: { fontSize: 10, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [0, 52, 65], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 40 },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 'auto' },
    },
    margin: { left: 14, right: 14 },
    didDrawPage: () => {
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Page ${doc.getNumberOfPages()}`,
        pageWidth - 14,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'right' },
      );
    },
  });

  // Transcript appendix.
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let ty = finalY + 10;

  doc.setFontSize(14);
  doc.setTextColor(0, 52, 65);
  doc.text('Transcript', 14, ty);
  ty += 8;

  doc.setFontSize(10);
  for (const t of transcript) {
    if (ty > 270) {
      doc.addPage();
      ty = 16;
    }
    doc.setTextColor(0, 52, 65);
    doc.setFont('helvetica', 'bold');
    const promptLines = doc.splitTextToSize(t.questionPrompt, pageWidth - 28);
    doc.text(promptLines, 14, ty);
    ty += promptLines.length * 4.5 + 2;

    doc.setTextColor(60, 60, 60);
    doc.setFont('helvetica', 'normal');
    const answer = t.answerText ?? '[No answer]';
    const answerLines = doc.splitTextToSize(answer, pageWidth - 28);
    doc.text(answerLines, 14, ty);
    ty += answerLines.length * 4.5 + 6;
  }

  const filename = `report-${candidate.name.replace(/\s+/g, '_')}-${report.id.slice(0, 8)}.pdf`;
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 1000);
}
