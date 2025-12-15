/**
 * AWS S3 Backup Service
 * Handles database backups and file uploads to AWS S3
 */

const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Initialize S3 Client
const getS3Client = () => {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        throw new Error('AWS credentials not configured');
    }

    return new S3Client({
        region: process.env.AWS_REGION || 'af-south-1',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });
};

/**
 * Upload a file to S3
 * @param {string} filePath - Local file path
 * @param {string} s3Key - S3 object key (path in bucket)
 * @returns {Promise<object>} Upload result
 */
const uploadToS3 = async (filePath, s3Key) => {
    const s3 = getS3Client();
    const bucket = process.env.AWS_S3_BUCKET || 'eliphasx-backups';

    const fileContent = fs.readFileSync(filePath);

    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: fileContent,
        ContentType: 'application/octet-stream'
    });

    const result = await s3.send(command);
    console.log(`✅ Uploaded to S3: s3://${bucket}/${s3Key}`);
    return result;
};

/**
 * Create a database backup and upload to S3
 * @returns {Promise<object>} Backup result
 */
const createDatabaseBackup = async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `eliphasx-backup-${timestamp}.sql`;
    const backupPath = path.join(__dirname, '..', 'backups', backupFileName);

    // Ensure backups directory exists
    const backupsDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }

    // Build DATABASE_URL from individual env vars (or use DATABASE_URL if set)
    let dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        const dbHost = process.env.DB_HOST || 'localhost';
        const dbPort = process.env.DB_PORT || '5432';
        const dbName = process.env.DB_NAME || 'eliphasx_db';
        const dbUser = process.env.DB_USER || 'postgres';
        const dbPassword = process.env.DB_PASSWORD || '';

        if (!dbHost || !dbName || !dbUser) {
            throw new Error('Database configuration not complete. Need DB_HOST, DB_NAME, DB_USER');
        }

        dbUrl = `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`;
    }

    // Use pg_dump to create backup (use full path on Windows)
    return new Promise((resolve, reject) => {
        // Try to find pg_dump in common locations
        const pgDumpPaths = [
            'pg_dump', // If in PATH
            'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
            'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
            'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe',
        ];

        let pgDumpPath = 'pg_dump';
        for (const p of pgDumpPaths) {
            if (require('fs').existsSync(p) || p === 'pg_dump') {
                pgDumpPath = p;
                if (p !== 'pg_dump') break; // Found a full path
            }
        }

        const pgDumpCmd = `"${pgDumpPath}" --dbname="${dbUrl}" -F p -f "${backupPath}"`;

        exec(pgDumpCmd, async (error, stdout, stderr) => {
            if (error) {
                console.error('Backup error:', stderr);
                reject(new Error(`Database backup failed: ${error.message}`));
                return;
            }

            try {
                // Upload to S3
                const s3Key = `database-backups/${backupFileName}`;
                await uploadToS3(backupPath, s3Key);

                // Clean up local backup file (optional)
                // fs.unlinkSync(backupPath);

                resolve({
                    success: true,
                    fileName: backupFileName,
                    s3Key: s3Key,
                    timestamp: new Date().toISOString()
                });
            } catch (uploadError) {
                reject(uploadError);
            }
        });
    });
};

/**
 * List recent backups from S3
 * @returns {Promise<Array>} List of backup files
 */
const listBackups = async () => {
    const s3 = getS3Client();
    const bucket = process.env.AWS_S3_BUCKET || 'eliphasx-backups';

    const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'database-backups/',
        MaxKeys: 20
    });

    const result = await s3.send(command);

    return (result.Contents || []).map(item => ({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified
    }));
};

/**
 * Check if S3 is properly configured
 * @returns {boolean}
 */
const isS3Configured = () => {
    return !!(
        process.env.AWS_ACCESS_KEY_ID &&
        process.env.AWS_SECRET_ACCESS_KEY &&
        process.env.AWS_S3_BUCKET
    );
};

module.exports = {
    uploadToS3,
    createDatabaseBackup,
    listBackups,
    isS3Configured
};
