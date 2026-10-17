/**
 * Building blocks for the Word reports, styled like an ordinary business document:
 * Calibri, black numbered headings, grey table headers, a running header and page numbers.
 * Colour appears only on ratings (grade, severity), and always next to the word itself.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  type IParagraphOptions,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

export type Block = Paragraph | Table;

/** A4 is 11,906 wide; minus two 1-inch margins. Word measures in DXA: 1/20 of a point, 1,440 per inch. */
export const CONTENT_WIDTH = 9026;

const MUTED = '595959';
const RULE = { style: BorderStyle.SINGLE, size: 4, color: 'A6A6A6' };
const HEADER_FILL = 'D9D9D9';
const LABEL_FILL = 'F2F2F2';
/** Text in tables is 10 pt (body text is 11 pt), as is usual in reports. */
const TABLE_TEXT = 20;
const NO_SPACING = { before: 0, after: 0 };

/** Fill and text colour for ratings (the familiar spreadsheet palette). */
export const TONES = {
  good: { fill: 'C6EFCE', color: '006100' },
  low: { fill: 'DDEBF7', color: '1F4E79' },
  medium: { fill: 'FFEB9C', color: '7F6000' },
  high: { fill: 'F8CBAD', color: '843C0C' },
  critical: { fill: 'FFC7CE', color: '9C0006' },
} as const;
export type Tone = keyof typeof TONES;

/** A table cell: plain text, rated or bold text, or configuration in a monospaced font. */
export type CellInput = string | { text: string; tone?: Tone | undefined; bold?: boolean } | { code: string };

/** The document itself: page setup, styles, running header (from page 2) and page numbers. */
export function reportDocument(options: { title: string; runningHead: string; children: Block[] }): Document {
  const pageNumbers = () =>
    new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: NO_SPACING,
          children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 16, color: MUTED })],
        }),
      ],
    });

  return new Document({
    creator: 'SecureWatch',
    title: options.title,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: '000000' }, // size is in half-points: 22 = 11 pt
          // Space before as well as after, so text that follows a table does not touch it.
          paragraph: { spacing: { before: 120, after: 120, line: 264 } },
        },
      },
      // Word's built-in style ids, restyled, so the navigation pane and outline still work.
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { size: 44, bold: true }, paragraph: { spacing: { before: 0, after: 60 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true }, paragraph: { spacing: { before: 360, after: 60 }, outlineLevel: 0, keepNext: true, keepLines: true } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1, keepNext: true, keepLines: true } },
      ],
    },
    sections: [
      {
        // titlePage: the first page gets its own (empty) header, as the title is already there.
        properties: { titlePage: true, page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        headers: {
          first: new Header({ children: [new Paragraph({})] }),
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: NO_SPACING,
                border: { bottom: { ...RULE, space: 4 } },
                children: [new TextRun({ text: options.runningHead, size: 16, color: MUTED })],
              }),
            ],
          }),
        },
        footers: { first: pageNumbers(), default: pageNumbers() },
        children: options.children,
      },
    ],
  });
}

/** The report title and what it covers, above a rule. */
export function titleBlock(title: string, subtitle: string): Paragraph[] {
  return [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }),
    new Paragraph({
      spacing: { before: 0, after: 360 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 6 } },
      children: [new TextRun({ text: subtitle, size: 28, color: MUTED })],
    }),
  ];
}

/** Numbers the headings as it goes: "1. Executive Summary", then "5.1 …" inside section 5. */
export class Outline {
  private sectionNumber = 0;
  private subsectionNumber = 0;

  section(title: string): Paragraph {
    this.sectionNumber += 1;
    this.subsectionNumber = 0;
    return heading(HeadingLevel.HEADING_1, `${this.sectionNumber}. ${title}`);
  }

  subsection(title: string): Paragraph {
    this.subsectionNumber += 1;
    return heading(HeadingLevel.HEADING_2, `${this.sectionNumber}.${this.subsectionNumber} ${title}`);
  }
}

/** An appendix heading: unnumbered, on a new page. */
export const appendix = (title: string) => heading(HeadingLevel.HEADING_1, title, true);

function heading(level: IParagraphOptions['heading'], text: string, pageBreakBefore = false): Paragraph {
  return new Paragraph({ heading: level, pageBreakBefore, children: [new TextRun(text)] });
}

interface TableOptions {
  /** Keep the whole table on one page (for short tables such as one finding). */
  keepTogether?: boolean;
  /** Keep the whole table on one page AND on the same page as what follows it. */
  keepWithNext?: boolean;
  /** Shade the first column, for label/value tables. */
  labelColumn?: boolean;
}

/** A table whose column widths are set on the table AND on every cell (both needed for Word and Google Docs). */
export function table(widths: number[], header: string[] | null, rows: CellInput[][], options: TableOptions = {}): Table {
  const { keepTogether = false, keepWithNext = false, labelColumn = false } = options;
  // Word keeps a table together when every paragraph in it is "kept with the next",
  // except in the last row (unless the table should also stay with what follows).
  const keepRow = (r: number) => keepWithNext || (keepTogether && r < rows.length - 1);
  return new Table({
    columnWidths: widths,
    width: { size: widths.reduce((sum, w) => sum + w, 0), type: WidthType.DXA },
    // FIXED: Word keeps these widths instead of resizing columns around long words
    // such as a certificate fingerprint.
    layout: TableLayoutType.FIXED,
    borders: { top: RULE, bottom: RULE, left: RULE, right: RULE, insideHorizontal: RULE, insideVertical: RULE },
    rows: [
      // tableHeader repeats the header row on every page the table runs onto.
      ...(header
        ? [new TableRow({ tableHeader: true, cantSplit: true, children: header.map((text, i) => cell({ text, bold: true }, widths[i]!, HEADER_FILL, true)) })]
        : []),
      ...rows.map(
        (row, r) =>
          new TableRow({
            cantSplit: true,
            children: row.map((value, i) => cell(value, widths[i]!, labelColumn && i === 0 ? LABEL_FILL : undefined, keepRow(r))),
          }),
      ),
    ],
  });
}

/** Two columns of label and value: the document details, the certificate, one finding. */
export function fieldTable(rows: [string, CellInput][], options: Omit<TableOptions, 'labelColumn'> = {}): Table {
  return table([2500, CONTENT_WIDTH - 2500], null, rows.map(([label, value]) => [{ text: label, bold: true }, value]), { ...options, labelColumn: true });
}

function cell(input: CellInput, width: number, fill: string | undefined, keepNext: boolean): TableCell {
  const value = typeof input === 'string' ? { text: input } : input;
  let shade = fill;
  let children: Paragraph[];

  if ('code' in value) {
    // One paragraph per line: Word has no line breaks inside a string.
    shade = LABEL_FILL;
    children = value.code.split('\n').map(
      (line) => new Paragraph({ keepNext, spacing: { ...NO_SPACING, line: 240 }, children: [new TextRun({ text: line, font: 'Consolas', size: 17 })] }),
    );
  } else {
    const tone = 'tone' in value && value.tone ? TONES[value.tone] : undefined;
    if (tone) shade = tone.fill;
    const run = new TextRun({ text: value.text, size: TABLE_TEXT, bold: 'bold' in value && value.bold === true, ...(tone && { color: tone.color }) });
    children = [new Paragraph({ keepNext, spacing: NO_SPACING, children: [run] })];
  }

  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    // CLEAR, not SOLID: SOLID paints the cell black.
    ...(shade && { shading: { type: ShadingType.CLEAR, color: 'auto', fill: shade } }),
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    children,
  });
}

export const para = (...runs: (string | TextRun)[]) =>
  new Paragraph({ children: runs.map((run) => (typeof run === 'string' ? new TextRun(run) : run)) });
/** A sentence that introduces the next table: kept on the same page as it. */
export const lead = (text: string) => new Paragraph({ keepNext: true, children: [new TextRun(text)] });
export const bold = (text: string) => new TextRun({ text, bold: true });
