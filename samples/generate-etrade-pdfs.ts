/**
 * Generates synthetic E*TRADE quarterly PDF statements for testing.
 * Run: npx tsx samples/generate-etrade-pdfs.ts
 *
 * Uses pdfkit to create real PDFs that pdf-parse v2 can extract text from.
 * All data is synthetic — no real personal info.
 */
import PDFDocument from 'pdfkit';
import {
    createWriteStream,
    mkdirSync,
} from 'fs';
import { join } from 'path';

const OUT_DIR = join(import.meta.dirname, '.');

interface QuarterData {
    filename: string;
    periodStart: string;
    periodEnd: string;
    beginValue: string;
    endValue: string;
    cashStart: string;
    cashEnd: string;
    stocksStart: string;
    stocksEnd: string;
    sharePrice: string;
    totalCost: string;
    marketValue: string;
    unrealizedGain: string;
    dividends: { date: string; amount: string; comment?: string }[];
    netCredits: string;
}

const QUARTERS: QuarterData[] = [
    {
        filename: 'ClientStatements_9999_033125.pdf',
        periodStart: 'January 1',
        periodEnd: 'March 31, 2025',
        beginValue: '$72,100.00',
        endValue: '$65,800.50',
        cashStart: '$5,200.00',
        cashEnd: '$5,252.30',
        stocksStart: '66,900.00',
        stocksEnd: '60,548.20',
        sharePrice: '$60.548',
        totalCost: '$25,000.00',
        marketValue: '$60,548.20',
        unrealizedGain: '$35,548.20',
        dividends: [
            { date: '1/2', amount: '$18.50', comment: 'Transaction Reportable for the Prior Year.' },
            { date: '2/3', amount: '17.20' },
            { date: '3/3', amount: '16.60' },
        ],
        netCredits: '$52.30',
    },
    {
        filename: 'ClientStatements_9999_063025.pdf',
        periodStart: 'April 1',
        periodEnd: 'June 30, 2025',
        beginValue: '$65,800.50',
        endValue: '$71,200.75',
        cashStart: '$5,252.30',
        cashEnd: '$5,301.10',
        stocksStart: '60,548.20',
        stocksEnd: '65,899.65',
        sharePrice: '$65.900',
        totalCost: '$25,000.00',
        marketValue: '$65,899.65',
        unrealizedGain: '$40,899.65',
        dividends: [
            { date: '4/1', amount: '$16.30' },
            { date: '5/1', amount: '16.10' },
            { date: '6/2', amount: '16.40' },
        ],
        netCredits: '$48.80',
    },
    {
        filename: 'ClientStatements_9999_093025.pdf',
        periodStart: 'July 1',
        periodEnd: 'September 30, 2025',
        beginValue: '$71,200.75',
        endValue: '$58,500.00',
        cashStart: '$5,301.10',
        cashEnd: '$5,348.50',
        stocksStart: '65,899.65',
        stocksEnd: '53,151.50',
        sharePrice: '$53.152',
        totalCost: '$25,000.00',
        marketValue: '$53,151.50',
        unrealizedGain: '$28,151.50',
        dividends: [
            { date: '7/1', amount: '$15.90' },
            { date: '8/1', amount: '15.80' },
            { date: '9/2', amount: '15.70' },
        ],
        netCredits: '$47.40',
    },
    {
        filename: 'ClientStatements_9999_123125.pdf',
        periodStart: 'October 1',
        periodEnd: 'December 31, 2025',
        beginValue: '$58,500.00',
        endValue: '$55,200.30',
        cashStart: '$5,348.50',
        cashEnd: '$5,394.20',
        stocksStart: '53,151.50',
        stocksEnd: '49,806.10',
        sharePrice: '$49.806',
        totalCost: '$25,000.00',
        marketValue: '$49,806.10',
        unrealizedGain: '$24,806.10',
        dividends: [
            { date: '10/1', amount: '$15.40' },
            { date: '11/3', amount: '15.20' },
            { date: '12/1', amount: '15.10' },
        ],
        netCredits: '$45.70',
    },
];

function generateQuarterPdf(q: QuarterData): Promise<void> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
        const outPath = join(OUT_DIR, q.filename);
        const stream = createWriteStream(outPath);

        doc.pipe(stream);

        // Page 1: Cover
        doc.fontSize(10);
        doc.text(`Beginning Total Value (as of 1/1/25) ${q.beginValue}`);
        doc.text(`Ending Total Value (as of ${q.periodEnd.replace(/, \d{4}/, '/25')}) ${q.endValue}`);
        doc.text('Includes Accrued Interest');
        doc.text(`CLIENT STATEMENT For the Period ${q.periodStart}- ${q.periodEnd}`);
        doc.text('151 - 299999 - 100 - 4 - 1');
        doc.text('STATEMENT FOR:');
        doc.text('JOHN A SMITH');
        doc.text('Morgan Stanley Smith Barney LLC. Member SIPC.');
        doc.text('E*TRADE is a business of Morgan Stanley.');
        doc.text('#TESTID1');
        doc.text('JOHN A SMITH');
        doc.text('123 MAIN STREET');
        doc.text('APT 4B');
        doc.text('NEW YORK 10001 USA');

        // Page 2: Disclosures (minimal)
        doc.addPage();
        doc.text('Standard Disclosures');
        doc.text(`CLIENT STATEMENT For the Period ${q.periodStart}- ${q.periodEnd} Page 2 of 8`);
        doc.text('The following Disclosures are applicable to the enclosed statement(s).');

        // Page 3: Account Summary
        doc.addPage();
        doc.text('Morgan Stanley at Work Self-Directed Account');
        doc.text('151-299999-100');
        doc.text(`CLIENT STATEMENT For the Period ${q.periodStart}- ${q.periodEnd}`);
        doc.text('Account Summary JOHN A SMITH');
        doc.text('Page 3 of 8');

        // Page 4: Balance Sheet + Cash Flow
        doc.addPage();
        doc.text('Account Summary');
        doc.text(`CLIENT STATEMENT For the Period ${q.periodStart}- ${q.periodEnd}`);
        doc.text('Morgan Stanley at Work Self-Directed Account');
        doc.text('151-299999-100');
        doc.text('JOHN A SMITH');
        doc.text('Page 4 of 8');
        doc.moveDown();
        doc.text('BALANCE SHEET (^ includes accrued interest)');
        doc.text('Last Period');
        doc.text(`(as of ${q.periodStart === 'January 1' ? '12/31/24' : q.periodStart === 'April 1' ? '3/31/25' : q.periodStart === 'July 1' ? '6/30/25' : '9/30/25'})`);
        doc.text('This Period');
        doc.text(
            `(as of ${
                q.periodEnd.replace(/, \d{4}/, '/25').replace('January', '1').replace('February', '2').replace('March', '3').replace('April', '4').replace('May', '5').replace(
                    'June',
                    '6',
                ).replace('July', '7').replace('August', '8').replace('September', '9').replace('October', '10').replace('November', '11').replace('December', '12')
            })`,
        );
        doc.text(`Cash, BDP, MMFs $${q.cashStart.replace('$', '')} $${q.cashEnd.replace('$', '')}`);
        doc.text(`Stocks ${q.stocksStart} ${q.stocksEnd}`);
        doc.text(`Total Assets ${q.beginValue} ${q.endValue}`);

        // Page 5: Holdings
        doc.addPage();
        doc.text('Account Detail');
        doc.text(`CLIENT STATEMENT For the Period ${q.periodStart}- ${q.periodEnd}`);
        doc.text('Page 5 of 8');
        doc.text('HOLDINGS');
        doc.moveDown();
        doc.text('CASH, BANK DEPOSIT PROGRAM AND MONEY MARKET FUNDS');
        doc.text(`Description Market Value`);
        doc.text(`TREASURY LIQUIDITY FUND $${q.cashEnd.replace('$', '')}`);
        doc.moveDown();
        doc.text(`CASH, BDP, AND MMFs 8.50% $${q.cashEnd.replace('$', '')}`);

        // Page 6: Stocks + Activity
        doc.addPage();
        doc.text('Account Detail');
        doc.text(`CLIENT STATEMENT For the Period ${q.periodStart}- ${q.periodEnd}`);
        doc.text('Page 6 of 8');
        doc.moveDown();
        doc.text('STOCKS');
        doc.text('COMMON STOCKS');
        doc.text('Security Description Quantity Share Price Total Cost Market Value');
        doc.text('Unrealized');
        doc.text('Gain/(Loss) Est Ann Income');
        doc.text('Current');
        doc.text('Yield %');
        doc.text(`ACME TECHNOLOGY (ACME) 1,000.000 ${q.sharePrice} ${q.totalCost} ${q.marketValue} ${q.unrealizedGain} $700.00 1.15`);
        doc.text('1,000.000 shs from Stock Plan; Asset Class: Equities');
        doc.moveDown();
        doc.text('ALLOCATION OF ASSETS');
        doc.moveDown();
        doc.text('ACTIVITY');
        doc.text('CASH FLOW ACTIVITY BY DATE');
        doc.text('Activity');
        doc.text('Date');
        doc.text('Settlement');
        doc.text('Date Activity Type Description Comments Quantity Price Credits/(Debits)');

        for (const div of q.dividends) {
            if (div.comment) {
                doc.text(`${div.date} Dividend TREASURY LIQUIDITY FUND ${div.comment} ${div.amount}`);
            } else {
                doc.text(`${div.date} Dividend TREASURY LIQUIDITY FUND`);
                doc.text('DIV PAYMENT');
                doc.text(div.amount);
            }
        }

        // Page 7: Activity continued
        doc.addPage();
        doc.text(`NET CREDITS/(DEBITS) ${q.netCredits}`);
        doc.moveDown();
        doc.text('MONEY MARKET FUND (MMF) AND BANK DEPOSIT PROGRAM ACTIVITY');
        doc.text('Activity');
        doc.text('Date Activity Type Description Credits/(Debits)');

        for (const div of q.dividends) {
            doc.text(`${div.date.split('/')[0]}/${div.date.split('/')[1]} Automatic Investment TREASURY LIQUIDITY FUND ${div.amount}`);
        }

        doc.text(`NET ACTIVITY FOR PERIOD ${q.netCredits}`);
        doc.moveDown();
        doc.text('MESSAGES');

        // Page 8: Blank
        doc.addPage();
        doc.text('Page 8 of 8');
        doc.text('This page intentionally left blank');

        doc.end();
        stream.on('finish', () => {
            console.log(`Generated ${outPath}`);
            resolve();
        });
        stream.on('error', reject);
    });
}

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const q of QUARTERS) {
        await generateQuarterPdf(q);
    }
    console.log('Done! Generated 4 synthetic E*TRADE quarterly PDFs.');
}

main().catch(console.error);
