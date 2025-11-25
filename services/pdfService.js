const PDFDocument = require('pdfkit');
const { calculateQuote } = require('./calculationService');
const fs = require('fs');
const path = require('path');

class PDFService {
    static generateQuotePDF(quote, client, type = 'client') {
        return new Promise((resolve, reject) => {
            try {
                const calculations = calculateQuote(quote);
                const { sections, totals } = calculations;

                const doc = new PDFDocument({ margin: 50, size: 'A4' });
                const buffers = [];

                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => {
                    const pdfData = Buffer.concat(buffers);
                    resolve(pdfData);
                });

                const COLORS = {
                    primary: '#111827',
                    secondary: '#6B7280',
                    line: '#E5E7EB'
                };

                const formatCurrency = (amount) => {
                    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount || 0);
                };

                const drawLine = (y) => {
                    doc.strokeColor(COLORS.line).lineWidth(1).moveTo(50, y).lineTo(545, y).stroke();
                };

                // Page Break Logic
                const checkPageBreak = (currentY, heightNeeded = 40) => {
                    if (currentY + heightNeeded > 780) { // A4 height is ~842, margin 50
                        doc.addPage();
                        return 50; // Reset Y to top margin
                    }
                    return currentY;
                };

                const drawSectionHeader = (title, y) => {
                    y = checkPageBreak(y, 40);
                    doc.rect(50, y, 495, 24).fill('#F9FAFB');
                    doc.fillColor(COLORS.primary).fontSize(10).font('Helvetica-Bold').text(title.toUpperCase(), 60, y + 7);
                    return y + 35;
                };

                // Standard row for Client view (Full width)
                const drawRow = (label, value, y, isBold = false) => {
                    y = checkPageBreak(y, 20);
                    doc.fontSize(10).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(COLORS.primary);
                    doc.text(label, 50, y);
                    doc.text(value, 300, y, { align: 'right', width: 245 });
                    return y + 18;
                };

                // Compact 2-column row for Admin view
                const drawAdminRow = (label1, value1, label2, value2, y) => {
                    y = checkPageBreak(y, 20);
                    doc.fontSize(9).font('Helvetica').fillColor(COLORS.primary);

                    // Left Column
                    doc.text(label1, 50, y);
                    doc.text(value1, 200, y, { align: 'right', width: 80 });

                    // Right Column
                    if (label2) {
                        doc.text(label2, 310, y);
                        doc.text(value2, 460, y, { align: 'right', width: 80 });
                    }
                    return y + 16;
                };

                let y = 50;

                // Logo (Restored to decent size)
                const logoPath = path.join(__dirname, '../assets/logo.png');
                const logoJpgPath = path.join(__dirname, '../assets/logo.jpg');

                if (fs.existsSync(logoPath)) {
                    doc.image(logoPath, 222, y, { width: 150 });
                    y += 80;
                } else if (fs.existsSync(logoJpgPath)) {
                    doc.image(logoJpgPath, 222, y, { width: 150 });
                    y += 80;
                } else {
                    doc.fontSize(20).font('Helvetica-Bold').fillColor(COLORS.primary).text('RARE EARTH CREATIONS', 50, y, { align: 'center' });
                    y += 25;
                    doc.fontSize(9).font('Helvetica').fillColor(COLORS.secondary).text('EXQUISITE JEWELRY MANUFACTURING', 50, y, { align: 'center', letterSpacing: 2 });
                    y += 35;
                }

                drawLine(y);
                y += 20;

                // Client & Quote Info
                const infoTop = y;

                doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.primary).text('PREPARED FOR:', 50, y);
                y += 15;
                doc.font('Helvetica').text(client.name, 50, y);
                y += 15;
                if (client.company) {
                    doc.text(client.company, 50, y);
                    y += 15;
                }
                doc.fillColor(COLORS.secondary).text(client.email || '', 50, y);
                y += 15;
                doc.text(client.phone || '', 50, y);

                y = infoTop;
                doc.fillColor(COLORS.primary).font('Helvetica-Bold').text('QUOTE DETAILS:', 350, y);
                y += 15;
                doc.font('Helvetica').text(`Quote #: ${quote.quote_number || 'DRAFT'}`, 350, y);
                y += 15;
                doc.text(`Date: ${new Date(quote.created_at || Date.now()).toLocaleDateString()}`, 350, y);
                y += 15;
                doc.text(`Valid Until: ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString()}`, 350, y);

                y = Math.max(y, infoTop + 80) + 20;

                // 1. Metal
                if (quote.metal_type) {
                    y = drawSectionHeader('Metal Specification', y);

                    if (type === 'admin') {
                        // 2-Column Layout for Admin
                        y = drawAdminRow('Metal Type', quote.metal_type.replace(/_/g, ' '), 'Spot Price', formatCurrency(quote.metal_spot_price), y);
                        y = drawAdminRow('Weight', `${quote.metal_weight}g`, 'Wastage', `${quote.metal_wastage}%`, y);
                        y = drawAdminRow('Markup', `${quote.metal_markup}%`, '', '', y);
                        y += 5;
                        y = drawRow('Total Metal Price', formatCurrency(sections.metal.price), y, true);
                    } else {
                        y = drawRow('Metal Type', quote.metal_type.replace(/_/g, ' '), y);
                        y = drawRow('Weight', `${quote.metal_weight}g`, y);
                        y = drawRow('Total Price', formatCurrency(sections.metal.price), y, true);
                    }
                    y += 10;
                }

                // 2. Stones
                if (quote.stone_categories && quote.stone_categories.length > 0) {
                    y = drawSectionHeader('Stones & Setting', y);

                    // Compact Table Header
                    y = checkPageBreak(y, 30);
                    doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.secondary);
                    doc.text('TYPE', 60, y);
                    doc.text('SIZE', 160, y);
                    doc.text('STYLE', 240, y);
                    doc.text('QTY', 320, y);
                    if (type === 'admin') {
                        doc.text('COST', 380, y);
                        doc.text('SET', 460, y);
                    }
                    y += 15;
                    drawLine(y);
                    y += 8;

                    doc.font('Helvetica').fillColor(COLORS.primary);
                    quote.stone_categories.forEach(stone => {
                        y = checkPageBreak(y, 20);
                        doc.text(stone.type || '-', 60, y);
                        doc.text(stone.size_category || '-', 160, y);
                        doc.text(stone.setting_style || '-', 240, y);
                        doc.text(stone.count || 0, 320, y);

                        if (type === 'admin') {
                            doc.text(formatCurrency(stone.cost_per_stone), 380, y);
                            doc.text(formatCurrency(stone.setting_cost), 460, y);
                        }
                        y += 14;
                    });
                    y += 5;

                    if (type === 'admin') {
                        y = drawRow('Stone Markup', `${quote.stone_markup}%`, y);
                    }
                    y = drawRow('Total Stone Price', formatCurrency(sections.stones.price), y, true);
                    y += 10;
                }

                // 3. CAD
                if (quote.cad_hours > 0 || quote.cad_rendering_cost > 0) {
                    y = drawSectionHeader('Design & CAD', y);

                    if (type === 'admin') {
                        if (quote.cad_hours > 0) y = drawAdminRow('Design Hours', `${quote.cad_hours} hrs`, 'Base Rate', formatCurrency(quote.cad_base_rate), y);
                        y = drawAdminRow('Rendering', formatCurrency(quote.cad_rendering_cost), 'Technical', formatCurrency(quote.cad_technical_cost), y);
                        y = drawAdminRow('Markup', `${quote.cad_markup}%`, '', '', y);
                        y += 5;
                        y = drawRow('Total CAD Price', formatCurrency(sections.cad.price), y, true);
                    } else {
                        if (quote.cad_hours > 0) y = drawRow('Design Hours', `${quote.cad_hours} hrs`, y);
                        y = drawRow('Total Price', formatCurrency(sections.cad.price), y, true);
                    }
                    y += 10;
                }

                // 4. Manufacturing
                if (quote.manufacturing_hours > 0) {
                    y = drawSectionHeader('Manufacturing', y);

                    if (type === 'admin') {
                        y = drawAdminRow('Technique', quote.manufacturing_technique || 'Handmade', 'Base Rate', formatCurrency(quote.manufacturing_base_rate), y);
                        y = drawAdminRow('Labor Hours', `${quote.manufacturing_hours} hrs`, 'Markup', `${quote.manufacturing_markup}%`, y);
                        y += 5;
                        y = drawRow('Total Mfg Price', formatCurrency(sections.manufacturing.price), y, true);
                    } else {
                        y = drawRow('Technique', quote.manufacturing_technique || 'Handmade', y);
                        y = drawRow('Labor Hours', `${quote.manufacturing_hours} hrs`, y);
                        y = drawRow('Total Price', formatCurrency(sections.manufacturing.price), y, true);
                    }
                    y += 10;
                }

                // 5. Extras
                if (sections.finishing.price > 0 || sections.findings.price > 0) {
                    y = drawSectionHeader('Finishing & Extras', y);

                    if (type === 'admin') {
                        y = drawAdminRow('Finishing', formatCurrency(quote.finishing_cost), 'Plating', formatCurrency(quote.plating_cost), y);
                        y = drawAdminRow('Findings', formatCurrency(sections.findings.cost), 'Markup', `${quote.findings_markup}%`, y);
                        y += 5;
                        y = drawRow('Total Extras Price', formatCurrency(sections.finishing.price + sections.findings.price), y, true);
                    } else {
                        y = drawRow('Finishing & Findings', 'Included', y);
                        y = drawRow('Total Price', formatCurrency(sections.finishing.price + sections.findings.price), y, true);
                    }
                    y += 10;
                }

                // Totals
                y = checkPageBreak(y, 100); // Ensure totals block fits
                y += 10;
                drawLine(y);
                y += 20;

                if (type === 'admin') {
                    // Compact Admin Totals
                    y = drawAdminRow('Subtotal (Cost)', formatCurrency(totals.subtotalCost), 'Total Profit', formatCurrency(totals.profit), y);
                    y = drawRow('Margin', `${totals.margin.toFixed(2)}%`, y);
                    y += 10;
                }

                // Grand Total Box
                doc.rect(300, y - 10, 245, 40).fill('#F3F4F6');
                doc.fillColor(COLORS.primary).fontSize(14).font('Helvetica-Bold');
                doc.text('TOTAL ESTIMATE', 320, y + 2);
                doc.text(formatCurrency(totals.totalPrice), 320, y + 2, { align: 'right', width: 210 });

                // Footer
                doc.fontSize(8).fillColor(COLORS.secondary).text('This quote is valid for 7 days from the date of issue.', 50, 750, { align: 'center' });
                doc.text('Thank you for your business.', 50, 765, { align: 'center' });

                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }
}

module.exports = PDFService;
