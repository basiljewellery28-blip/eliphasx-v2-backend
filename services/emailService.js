const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

// Configure AWS SES Client
// SES uses SES_REGION (defaults to eu-west-1) which may be different from S3's AWS_REGION
const sesClient = new SESClient({
    region: process.env.SES_REGION || 'eu-west-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Sender email - must be verified in AWS SES
const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@basilx.co.za';

// Debug: Log FROM_EMAIL at startup
console.log(`📧 Email Service initialized. FROM_EMAIL: ${FROM_EMAIL}`);

class EmailService {

    /**
     * Send an email using AWS SES
     */
    static async sendEmail(to, subject, htmlBody, textBody = null) {
        // Debug: Log actual FROM address being used
        console.log(`📧 Sending email FROM: ${FROM_EMAIL} TO: ${to}`);

        // If no AWS credentials, mock the email
        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            console.log('---------------------------------------------------');
            console.log('📧 [MOCK EMAIL] No AWS credentials configured');
            console.log(`To: ${to}`);
            console.log(`Subject: ${subject}`);
            console.log('---------------------------------------------------');
            return true;
        }

        const params = {
            Source: FROM_EMAIL,
            Destination: {
                ToAddresses: [to]
            },
            Message: {
                Subject: {
                    Data: subject,
                    Charset: 'UTF-8'
                },
                Body: {
                    Html: {
                        Data: htmlBody,
                        Charset: 'UTF-8'
                    }
                }
            }
        };

        // Add plain text body if provided
        if (textBody) {
            params.Message.Body.Text = {
                Data: textBody,
                Charset: 'UTF-8'
            };
        }

        try {
            const command = new SendEmailCommand(params);
            await sesClient.send(command);
            console.log(`✅ Email sent successfully to: ${to}`);
            return true;
        } catch (error) {
            console.error('❌ AWS SES Error:', error.message);
            throw error;
        }
    }

    static async sendNewClientNotification(client, creatorEmail) {
        try {
            const subject = `New Client Registered: ${client.name}`;
            const htmlBody = `
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
            `;

            const adminEmail = process.env.ADMIN_EMAIL || 'admin@eliphasx.com';
            await this.sendEmail(adminEmail, subject, htmlBody);
            console.log(`Notification email sent for client: ${client.name}`);
        } catch (error) {
            console.error('Failed to send notification email:', error.message);
            // Don't throw, just log. We don't want to fail the client creation if email fails.
        }
    }

    static async sendTeamInvite(invitation) {
        try {
            const { email, inviterName, inviterEmail, organizationName, inviteUrl, expiresAt } = invitation;

            const subject = `You've been invited to join ${organizationName} on ELIPHASx`;
            const htmlBody = `
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
            `;

            await this.sendEmail(email, subject, htmlBody);
            console.log(`Team invitation email sent to: ${email}`);
            return true;
        } catch (error) {
            console.error('Failed to send team invite email:', error.message);
            throw error;
        }
    }

    static async sendPasswordResetEmail(email, resetToken) {
        try {
            const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
            const subject = 'Reset Your ELIPHASx Password';
            const htmlBody = `
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
            `;

            await this.sendEmail(email, subject, htmlBody);
            console.log(`Password reset email sent to: ${email}`);
            return true;
        } catch (error) {
            console.error('Failed to send password reset email:', error.message);
            throw error;
        }
    }

    /**
     * Send quota warning email when user reaches 80% of their limit
     */
    static async sendQuotaWarningEmail(email, currentCount, limit, organizationName) {
        try {
            const percentUsed = Math.round((currentCount / limit) * 100);
            const remaining = limit - currentCount;
            const billingUrl = `${process.env.FRONTEND_URL || 'https://www.basilx.co.za'}/billing`;

            const subject = `⚠️ You're approaching your monthly quote limit - ${organizationName}`;
            const htmlBody = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: linear-gradient(135deg, #f39c12 0%, #e74c3c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                        .content { background: #f9f9f9; padding: 30px; border: 1px solid #e0e0e0; }
                        .button { display: inline-block; background: #27ae60; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
                        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
                        .progress-bar { background: #e0e0e0; border-radius: 10px; overflow: hidden; height: 20px; margin: 15px 0; }
                        .progress-fill { background: linear-gradient(90deg, #f39c12, #e74c3c); height: 100%; transition: width 0.3s; }
                        .stats { display: flex; justify-content: space-between; margin: 10px 0; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1 style="margin: 0;">⚠️ Quota Alert</h1>
                            <p style="margin: 10px 0 0 0; opacity: 0.9;">You're using ${percentUsed}% of your monthly quotes</p>
                        </div>
                        <div class="content">
                            <h2>Hi there,</h2>
                            <p>You're approaching your monthly quote limit for <strong>${organizationName}</strong>.</p>
                            
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${percentUsed}%;"></div>
                            </div>
                            
                            <div class="stats">
                                <span><strong>${currentCount}</strong> quotes used</span>
                                <span><strong>${remaining}</strong> remaining</span>
                            </div>
                            
                            <p>To ensure uninterrupted service, consider upgrading to <strong>Professional</strong> for <strong>unlimited quotes</strong>.</p>
                            
                            <p style="text-align: center;">
                                <a href="${billingUrl}" class="button">Upgrade Now</a>
                            </p>
                            
                            <p style="color: #666; font-size: 14px;">Benefits of upgrading:</p>
                            <ul style="color: #666;">
                                <li>✅ Unlimited quotes</li>
                                <li>✅ Up to 5 team members</li>
                                <li>✅ White-label PDF branding</li>
                                <li>✅ Priority support</li>
                            </ul>
                        </div>
                        <div class="footer">
                            <p>ELIPHASx by BASIL & Co (Pty) Ltd</p>
                            <p>You're receiving this because you're an admin of ${organizationName}.</p>
                        </div>
                    </div>
                </body>
                </html>
            `;

            await this.sendEmail(email, subject, htmlBody);
            console.log(`Quota warning email sent to: ${email} (${currentCount}/${limit})`);
            return true;
        } catch (error) {
            console.error('Failed to send quota warning email:', error.message);
            // Don't throw - this is a non-critical notification
            return false;
        }
    }
}

module.exports = EmailService;
