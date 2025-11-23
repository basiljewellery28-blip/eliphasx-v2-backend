const PDFDocument = require('pdfkit');

class PDFService {
    static generateQuotePDF(quote, client, type = 'client') {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({ margin: 50 });
                const buffers = [];

                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => {
                    const pdfData = Buffer.concat(buffers);
                    resolve(pdfData);
                });

                // Header
                doc.fontSize(20)
                    .fillColor('#1E3A8A')
                    .text('Rare Earth Creation', 50, 50);

                doc.fontSize(16)
                    .fillColor('#0F172A')
                    .text('Jewelry Manufacturing Quote', 50, 75);

                doc.moveDown();
                doc.fontSize(10).fillColor('black');
                doc.text(`Quote Number: ${quote.quote_number}`);
                doc.text(`Date: ${new Date(quote.created_at).toLocaleDateString()}`);
                doc.text(`Valid Until: ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString()}`);

                doc.moveDown();
                doc.fontSize(12).text('Client Details:', { underline: true });
                doc.fontSize(10).text(`Name: ${client.name}`);
                doc.text(`Company: ${client.company}`);
                doc.text(`Email: ${client.email}`);
                doc.text(`Phone: ${client.phone}`);

                doc.moveDown();
                doc.fontSize(12).text('Quote Details:', { underline: true });

                // Metal Section
                if (quote.metal_type) {
                    doc.moveDown();
                    doc.fontSize(11).text('Metal Specification');
                    doc.fontSize(10).text(`Type: ${quote.metal_type.replace(/_/g, ' ')}`);
                    doc.text(`Weight: ${quote.metal_weight}g`);
                    if (type === 'admin') {
                        doc.text(`Spot Price: R${quote.metal_spot_price}`);
                        doc.text(`Markup: ${quote.metal_markup}%`);
                    }
                }

                // Totals
                doc.moveDown();
                doc.fontSize(12).text('Financials:', { underline: true });

                if (type === 'admin') {
                    doc.fontSize(10).text(`Subtotal: R${quote.subtotal || 0}`);
                    doc.text(`Overhead: R${quote.overhead || 0}`);
                    doc.text(`Profit: R${quote.profit || 0}`);
                }

                doc.fontSize(14).font('Helvetica-Bold').text(`Total Estimate: R${quote.total || 0}`, { align: 'right' });

                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }
}

module.exports = PDFService;
