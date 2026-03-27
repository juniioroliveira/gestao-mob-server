import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT || '3001'),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME || '',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
  },
  jwtSecret: process.env.JWT_SECRET || 'devsecret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  demoUserEmail: process.env.DEMO_USER_EMAIL || 'demo@local',
  demoUserName: process.env.DEMO_USER_NAME || 'Demo User',
  demoUserPassword: process.env.DEMO_USER_PASSWORD || 'demo123',
};
