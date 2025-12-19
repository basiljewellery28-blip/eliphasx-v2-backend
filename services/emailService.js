const nodemailer = require('nodemailer');

// Configure transporter
// In production, use environment variables for these values. Defaulting to Zoho SMTP settings.
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtppro.zoho.com',
    port: process.env.SMTP_PORT || 465,
    secure: true, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER || process.env.EMAIL_USER,
        pass: process.env.SMTP_PASS || process.env.EMAIL_PASS
    }
});

class EmailService {
    static async sendNewClientNotification(client, creatorEmail) {
        try {
            // If no email config is present, just log it (for dev/demo purposes)
            if (!process.env.SMTP_USER && !process.env.EMAIL_USER) {
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
                from: process.env.SMTP_USER || process.env.EMAIL_USER,
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

    static async sendTeamInvite(invitation) {
        try {
            const { email, inviterName, inviterEmail, organizationName, inviteUrl, expiresAt } = invitation;

            // If no email config is present, just log it (for dev/demo purposes)
            if (!process.env.SMTP_USER && !process.env.EMAIL_USER) {
                console.log('---------------------------------------------------');
                console.log('📧 [MOCK EMAIL] Team Invitation');
                console.log(`To: ${email}`);
                console.log(`Subject: You've been invited to join ${organizationName} on ELIPHASx`);
                console.log(`Invited by: ${inviterName} (${inviterEmail})`);
                console.log(`Accept URL: ${inviteUrl}`);
                console.log(`Expires: ${expiresAt}`);
                console.log('---------------------------------------------------');
                return true;
            }

            const mailOptions = {
                from: `"ELIPHASx" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`,
                to: email,
                subject: `You've been invited to join ${organizationName} on ELIPHASx`,
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: linear-gradient(135deg, #2c3e50 0%, #1a252f 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                            .content { background: #f9f9f9; padding: 30px; border: 1px solid #e0e0e0; }
                            .button { display: inline-block; background: #27ae60; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
                            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
                            .highlight { background: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1 style="margin: 0;">ELIPHASx</h1>
                                <p style="margin: 10px 0 0 0; opacity: 0.9;">Jewellery Quote Management</p>
                            </div>
                            <div class="content">
                                <h2>You're Invited! 🎉</h2>
                                <p><strong>${inviterName}</strong> has invited you to join <strong>${organizationName}</strong> on ELIPHASx, the jewellery manufacturing quote management platform.</p>
                                
                                <p style="text-align: center;">
                                    <a href="${inviteUrl}" class="button">Accept Invitation</a>
                                </p>
                                
                                <div class="highlight">
                                    ⏰ <strong>This invitation expires in 24 hours.</strong><br>
                                    Please accept before it expires.
                                </div>
                                
                                <p>Once you accept, you'll be able to:</p>
                                <ul>
                                    <li>Create and manage jewellery quotes</li>
                                    <li>Access client information</li>
                                    <li>Collaborate with your team</li>
                                </ul>
                                
                                <p>If you have any questions, contact ${inviterName} at <a href="mailto:${inviterEmail}">${inviterEmail}</a>.</p>
                            </div>
                            <div class="footer">
                                <p>ELIPHASx by BASIL & Co (Pty) Ltd</p>
                                <p>If you didn't expect this invitation, you can safely ignore this email.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log(`Team invitation email sent to: ${email}`);
            return true;
        } catch (error) {
            console.error('Failed to send team invite email:', error);
            throw error;
        }
    }

    static async sendPasswordResetEmail(email, resetToken) {
        try {
            const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

            if (!process.env.SMTP_USER && !process.env.EMAIL_USER) {
                console.log('---------------------------------------------------');
                console.log('📧 [MOCK EMAIL] Password Reset');
                console.log(`To: ${email}`);
                console.log(`Reset URL: ${resetUrl}`);
                console.log('---------------------------------------------------');
                return true;
            }

            const mailOptions = {
                from: `"ELIPHASx" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Reset Your ELIPHASx Password',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2>Password Reset Request</h2>
                        <p>You requested to reset your password for your ELIPHASx account.</p>
                        <p>Click the button below to reset your password:</p>
                        <p style="text-align: center;">
                            <a href="${resetUrl}" style="display: inline-block; background: #2c3e50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Reset Password</a>
                        </p>
                        <p>This link will expire in 1 hour.</p>
                        <p>If you didn't request this, please ignore this email.</p>
                        <hr>
                        <p style="color: #666; font-size: 12px;">ELIPHASx by BASIL & Co</p>
                    </div>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log(`Password reset email sent to: ${email}`);
            return true;
        } catch (error) {
            console.error('Failed to send password reset email:', error);
            throw error;
        }
    }
}

module.exports = EmailService;
