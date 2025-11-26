const nodemailer = require('nodemailer');

// Configure transporter
// In production, use environment variables for these values
const transporter = nodemailer.createTransport({
    service: 'gmail', // Or your preferred service
    auth: {
        user: process.env.EMAIL_USER || 'notifications@eliphasx.com', // Placeholder
        pass: process.env.EMAIL_PASS || 'your-password' // Placeholder
    }
});

class EmailService {
    static async sendNewClientNotification(client, creatorEmail) {
        try {
            // If no email config is present, just log it (for dev/demo purposes)
            if (!process.env.EMAIL_USER) {
                console.log('---------------------------------------------------');
                console.log('📧 [MOCK EMAIL] New Client Notification');
                console.log(`To: Admin`);
                console.log(`Subject: New Client Registered: ${client.name}`);
                console.log(`Body: A new client has been registered by ${creatorEmail}.`);
                console.log(`Client Details: ${client.name} (${client.company})`);
                console.log('Please log in to verify pricing and details.');
                console.log('---------------------------------------------------');
                return;
            }

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: process.env.ADMIN_EMAIL || 'admin@eliphasx.com',
                subject: `New Client Registered: ${client.name}`,
                html: `
                    <h2>New Client Registration</h2>
                    <p>A new client has been registered by <strong>${creatorEmail}</strong>.</p>
                    
                    <h3>Client Details:</h3>
                    <ul>
                        <li><strong>Name:</strong> ${client.name}</li>
                        <li><strong>Company:</strong> ${client.company}</li>
                        <li><strong>Email:</strong> ${client.email}</li>
                        <li><strong>Phone:</strong> ${client.phone}</li>
                    </ul>

                    <p>Please log in to the Admin Panel to verify their information and configure their pricing tier.</p>
                    <br>
                    <p><em>ELIPHASx Notification System</em></p>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log(`Notification email sent for client: ${client.name}`);
        } catch (error) {
            console.error('Failed to send notification email:', error);
            // Don't throw, just log. We don't want to fail the client creation if email fails.
        }
    }
}

module.exports = EmailService;
