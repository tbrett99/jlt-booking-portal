import { createConnection } from 'mysql2/promise';

const conn = await createConnection(process.env.DATABASE_URL);
await conn.execute(`CREATE TABLE IF NOT EXISTS \`email_branding_settings\` (
  \`id\` int AUTO_INCREMENT NOT NULL,
  \`logoUrl\` text,
  \`headerBgColor\` varchar(20) NOT NULL DEFAULT '#70FFE8',
  \`headerTextColor\` varchar(20) NOT NULL DEFAULT '#414141',
  \`bodyBgColor\` varchar(20) NOT NULL DEFAULT '#f5f5f5',
  \`cardBgColor\` varchar(20) NOT NULL DEFAULT '#ffffff',
  \`accentColor\` varchar(20) NOT NULL DEFAULT '#02E6D2',
  \`companyName\` varchar(255) NOT NULL DEFAULT 'JLT Group',
  \`tagline\` varchar(255),
  \`footerText\` text,
  \`websiteUrl\` varchar(500),
  \`facebookUrl\` varchar(500),
  \`instagramUrl\` varchar(500),
  \`twitterUrl\` varchar(500),
  \`linkedinUrl\` varchar(500),
  \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  \`updatedBy\` int,
  CONSTRAINT \`email_branding_settings_id\` PRIMARY KEY(\`id\`)
)`);
console.log('email_branding_settings table created');
await conn.end();
